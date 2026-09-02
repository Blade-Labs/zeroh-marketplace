#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isTerminalPhaseSource } from '../lib/phasescan.mjs'
import { roadmapRoot } from '../lib/roadmap-root.mjs'

const STATUSES = new Set(['live', 'parked', 'superseded', 'spent'])
const emptySummary = () => ({
  total: 0, untriaged: 0, orphaned: 0, live: 0, parked: 0, superseded: 0, spent: 0,
})

function scalar(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseHeader(source) {
  if (!source.startsWith('---\n')) return { status: 'UNTRIAGED', trigger: null, reviewBy: null }
  const end = source.indexOf('\n---\n', 4)
  if (end < 0) return { status: 'UNTRIAGED', trigger: null, reviewBy: null }
  const values = {}
  for (const line of source.slice(4, end).split('\n')) {
    const match = line.match(/^([a-z-]+):\s*(.*?)\s*$/)
    if (match) values[match[1]] = scalar(match[2])
  }
  const status = values.status
  const reviewBy = values['review-by'] ?? null
  const validDate = reviewBy == null || /^\d{4}-\d{2}-\d{2}$/.test(reviewBy)
  if (!STATUSES.has(status) || (status === 'parked' && !values.trigger) || !validDate) {
    return { status: 'UNTRIAGED', trigger: values.trigger ?? null, reviewBy }
  }
  return { status, trigger: values.trigger ?? null, reviewBy }
}

function filesUnder(path) {
  if (!existsSync(path)) return []
  const found = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) found.push(...filesUnder(child))
    else if (entry.isFile()) found.push(child)
  }
  return found
}

const MD_REFERENCE = /[A-Za-z0-9._/\\-]+\.md/g

/**
 * The `*.md` basenames a text references. Basename-exact, never substring: `WORKFORCE.md`
 * is a substring of a reference to `HQWORKFORCE.md`, and a substring hit would report the
 * shorter file as referenced — an orphan silently under-counted is the one failure this
 * census exists to prevent.
 */
function basenamesIn(source) {
  const names = new Set()
  for (const token of source.match(MD_REFERENCE) ?? []) names.add(token.split(/[\\/]/).pop())
  return names
}

/** ONE pass over the corpus; a per-followup scan re-read the whole tree per file. */
function referencedBasenames(path, { liveOnly = false } = {}) {
  const names = new Set()
  for (const file of filesUnder(path)) {
    const text = readFileSync(file, 'utf8')
    // A DONE phase's record cites its inputs historically — that citation must not block a
    // deletion, or the remedy becomes editing shipped history. Only a phase that can still
    // CONSUME the followup as a plan input counts as a live reference. The skip applies to
    // PHASE FILES only — a note or an arc file has no status field to read at all.
    if (liveOnly && file.endsWith('.phase.ts') && isTerminalPhaseSource(text)) continue
    for (const name of basenamesIn(text)) names.add(name)
  }
  return names
}

function ageDays(repo, absoluteFile) {
  try {
    const date = execFileSync(
      'git', ['-C', repo, 'log', '-1', '--format=%ad', '--date=short', '--', relative(repo, absoluteFile)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    if (!date) return null
    return Math.max(0, Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000))
  } catch {
    return null
  }
}

/** One metering home shared by the census command and audit check 14. */
export function censusFollowups(repo = process.cwd()) {
  const roadmap = roadmapRoot(repo)
  const dir = join(roadmap, 'followups')
  const followupFiles = existsSync(dir)
    ? readdirSync(dir)
        // README.md is the directory's own index, not a followup — counting it skews every figure.
        .filter((name) => name.endsWith('.md') && name !== 'README.md' && statSync(join(dir, name)).isFile())
        .sort()
    : []
  if (followupFiles.length === 0) return { rows: [], summary: emptySummary() }
  const backlog = join(roadmap, 'backlog.ts')
  const referenced = {
    backlog: existsSync(backlog) ? basenamesIn(readFileSync(backlog, 'utf8')) : new Set(),
    phases: referencedBasenames(join(roadmap, 'phases'), { liveOnly: true }),
    arcs: referencedBasenames(join(roadmap, 'arcs')),
  }
  const rows = followupFiles.map((file) => {
    const absolute = join(dir, file)
    const header = parseHeader(readFileSync(absolute, 'utf8'))
    const refs = {
      backlog: referenced.backlog.has(file),
      phases: referenced.phases.has(file),
      arcs: referenced.arcs.has(file),
    }
    return {
      file, status: header.status, trigger: header.trigger, reviewBy: header.reviewBy,
      refs, ageDays: ageDays(repo, absolute), orphan: !Object.values(refs).some(Boolean),
    }
  })
  const summary = emptySummary()
  summary.total = rows.length
  for (const row of rows) {
    if (row.status === 'UNTRIAGED') summary.untriaged++
    else summary[row.status]++
    if (row.orphan) summary.orphaned++
  }
  return { rows, summary }
}

function printHuman(report) {
  // REVIEW-BY is a column, not JSON-only: release-sweep's triage gate flags a past review-by,
  // and the human table is what that step reads.
  process.stdout.write('FILE\tSTATUS\tTRIGGER\tREVIEW-BY\tAGE\tORPHAN\n')
  for (const row of report.rows) {
    process.stdout.write(`${row.file}\t${row.status}\t${row.trigger ?? '-'}\t${row.reviewBy ?? '-'}\t${row.ageDays ?? '-'}\t${row.orphan ? 'yes' : 'no'}\n`)
  }
  const s = report.summary
  process.stdout.write(`${s.total} total · ${s.untriaged} UNTRIAGED · ${s.orphaned} orphaned · ${s.live} live · ${s.parked} parked · ${s.superseded} superseded · ${s.spent} spent\n`)
}

export default async function run(argv) {
  const [subcommand, ...flags] = argv
  if (subcommand !== 'census' || flags.some((flag) => flag !== '--json')) {
    process.stderr.write('Usage: roadmap followups census [--json]\n')
    return 1
  }
  const report = censusFollowups(process.cwd())
  if (flags.includes('--json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else printHuman(report)
  return 0
}
