#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

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

function containsFilename(path, filename) {
  return filesUnder(path).some((file) => readFileSync(file, 'utf8').includes(filename))
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
  const roadmap = join(repo, 'roadmap')
  const dir = join(roadmap, 'followups')
  const followupFiles = existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith('.md') && statSync(join(dir, name)).isFile()).sort()
    : []
  const backlog = join(roadmap, 'backlog.ts')
  const rows = followupFiles.map((file) => {
    const absolute = join(dir, file)
    const header = parseHeader(readFileSync(absolute, 'utf8'))
    const refs = {
      backlog: existsSync(backlog) && readFileSync(backlog, 'utf8').includes(file),
      phases: containsFilename(join(roadmap, 'phases'), file),
      arcs: containsFilename(join(roadmap, 'arcs'), file),
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
  process.stdout.write('FILE\tSTATUS\tTRIGGER\tAGE\tORPHAN\n')
  for (const row of report.rows) {
    process.stdout.write(`${row.file}\t${row.status}\t${row.trigger ?? '-'}\t${row.ageDays ?? '-'}\t${row.orphan ? 'yes' : 'no'}\n`)
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
