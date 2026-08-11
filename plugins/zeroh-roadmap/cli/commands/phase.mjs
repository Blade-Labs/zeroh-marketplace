/**
 * roadmap phase validate <N|file> [--json] — the CLI face of the roadmap-file validator
 * (same engine cli/lib/validate.mjs the write-hook calls). Unlike the hook, this is a
 * STRICT context (design §2): tsx absence is exit 1 here, not fail-open.
 *
 * roadmap phase start <N> (1737.3) — the ATOMIC backlog→in-progress flip the do-phase
 * Step 0 prose used to own (1702 ran 5/6 tasks under status:'backlog'): first-match
 * regex flip (the phasescan tier — the status: field precedes notes, so match #1 is
 * the field, a notes-string literal is untouched), ONE commit with the exact
 * move-to-in-progress subject gitscan's newest-move-commit base rule prefers, then an
 * executor-start beacon. Idempotent on in-progress (exit 0, no second commit);
 * terminal status refuses exit 2; no recognizable status pattern refuses exit 1.
 *
 * Exit: 0 clean · 1 usage/config/toolchain · 2 validation failed / refused.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'
import { validateRoadmapFile, renderZodIssues } from '../lib/validate.mjs'
import { TSX_ABSENT_HINT, bridgeImport } from '../lib/tsx-bridge.mjs'
import { appendExecutorEvent } from '../lib/beacon.mjs'
import { matchStatusField } from '../lib/phasescan.mjs'
import { deriveCurationRange, executeCurate, composeLandedMessage, CurateError } from '../lib/curate.mjs'

function runStart(argv) {
  const n = argv.find((a) => /^\d+$/.test(a))
  if (!n) {
    process.stderr.write('roadmap phase start: usage: roadmap phase start <N>\n')
    return 1
  }
  const toplevel = gitToplevel(process.cwd())
  const file = join(toplevel, 'roadmap', 'phases', `phase-${n}.phase.ts`)
  if (!existsSync(file)) {
    process.stderr.write(`roadmap phase start: no such file: ${file}\n`)
    return 1
  }
  const src = readFileSync(file, 'utf8')
  // Field-anchored match (phasescan.matchStatusField): a status literal in the doc-comment
  // header must never shadow the real field (phase 1787 false refusal).
  const m = matchStatusField(src)
  const status = m?.status
  if (!status || (status !== 'backlog' && status !== 'in-progress')) {
    if (status === 'done' || status === 'historical') {
      process.stderr.write(`roadmap phase start: phase ${n} is terminal (status '${status}') — refusing to flip\n`)
      return 2
    }
    process.stderr.write(
      `roadmap phase start: phase ${n} carries no status: 'backlog'|'in-progress' pattern (found: ${status ?? 'none'}) — nothing to flip\n`,
    )
    return 1
  }
  if (status === 'in-progress') {
    process.stderr.write(`roadmap phase start: phase ${n} is already in-progress — idempotent no-op\n`)
    return 0
  }
  // Field-only flip: replace exactly the matched field occurrence.
  const flipped = src.slice(0, m.index) + src.slice(m.index).replace("'backlog'", "'in-progress'")
  writeFileSync(file, flipped)
  const rel = relative(toplevel, file)
  // Pathspec-scoped commit: the move-commit must be provably the phase file ONLY — a
  // bare `git commit` commits the whole index, sweeping a shared worktree's
  // sibling-session dirt under the move subject that gitscan's Tier-1 base derivation
  // keys off (CLAUDE.md: stage explicit paths only).
  try {
    execFileSync('git', ['-C', toplevel, 'commit', rel, '-m', `docs(roadmap): phase ${n} — move to in-progress`], {
      timeout: 30_000,
      stdio: 'ignore',
    })
  } catch (e) {
    // The flip is atomic WITH its commit: a failed commit (index-lock contention, a
    // failing hook) must not leave the file flipped-but-uncommitted — a retry would
    // then hit the idempotent branch and return 0 with NO move-commit and NO beacon,
    // silently reintroducing the 1702 class. Revert and refuse so a retry re-attempts.
    writeFileSync(file, src)
    process.stderr.write(`roadmap phase start: the move-commit FAILED (${e?.message?.split('\n')[0] ?? e}) — flip reverted, nothing landed; fix the repo state and retry\n`)
    return 2
  }
  const sid = process.env.CLAUDE_SESSION_ID
  appendExecutorEvent(toplevel, n, 'executor-start', sid ? { session_id: sid } : {})
  process.stderr.write(`roadmap phase start: phase ${n} → in-progress (move-commit landed, executor-start beacon stamped)\n`)
  return 0
}

function parseArgs(argv) {
  const opts = {}
  const positional = []
  for (const a of argv) {
    if (a === '--json') opts.json = true
    else if (!a.startsWith('--')) positional.push(a)
  }
  return { opts, positional }
}

function resolveTarget(arg) {
  if (/^\d+$/.test(arg)) {
    const toplevel = gitToplevel(process.cwd())
    return join(toplevel, 'roadmap', 'phases', `phase-${arg}.phase.ts`)
  }
  return arg
}

/** The production phase-record loader: the tsx bridge, consumer-rooted. */
function bridgeLoadPhase(phaseFile, toplevel) {
  const imp = bridgeImport(phaseFile, { consumerRoot: toplevel })
  if (!imp.ok) {
    if (imp.kind === 'tsx-absent') throw new Error(TSX_ABSENT_HINT)
    throw new Error(`phase curate: failed to read ${phaseFile}: ${imp.stderr || `bridge ${imp.kind}`}`)
  }
  return imp.parsed
}

/** Parse a --groups spec ("1-3,4-6,7") into inclusive task-index ranges. */
function parseGroupsSpec(spec) {
  const ranges = String(spec)
    .split(',')
    .map((part) => {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
      if (!m) throw new Error(`phase curate: unparseable --groups segment '${part.trim()}'`)
      return [Number(m[1]), Number(m[2] ?? m[1])]
    })
  if (ranges.length > 3) throw new Error(`phase curate: --groups asks for ${ranges.length} groups — the ceiling is 3 (born-clean means 1-3 logical commits)`)
  return ranges
}

/**
 * `roadmap phase curate <N>` — dry-run by default (a destructive tool shows its hand);
 * only --apply executes. Groups: default ONE; a --groups task-id spec yields up to
 * three, with non-task commits folding into the group of the nearest PRECEDING task
 * commit (the first group when none precedes). A foreign interleave refuses with exit
 * 2 and every offender named — never forced.
 */
export function runCurate({
  cwd,
  toplevel,
  phaseNum,
  apply = false,
  groupsSpec = null,
  loadPhase = (phaseFile) => bridgeLoadPhase(phaseFile, toplevel),
  out = process.stdout,
  err = process.stderr,
}) {
  const range = deriveCurationRange(cwd, phaseNum)
  if (!range.ok) {
    err.write(`${range.reason}\n`)
    for (const f of range.foreign) err.write(`  foreign: ${f.sha} ${f.subject}\n`)
    return 2
  }

  let ranges
  try {
    ranges = groupsSpec ? parseGroupsSpec(groupsSpec) : null
  } catch (e) {
    err.write(`${e.message}\n`)
    return 1
  }

  // Group assembly: a task commit picks its group by task index; everything else folds
  // into the nearest preceding task commit's group (the first group when none precedes).
  const taskIndexOf = (subject) => {
    const m = new RegExp(`\\b${phaseNum}\\.(\\d+)\\b`).exec(subject)
    return m ? Number(m[1]) : null
  }
  const groupOfIndex = (idx) => {
    if (!ranges) return 0
    const at = ranges.findIndex(([lo, hi]) => idx >= lo && idx <= hi)
    return at === -1 ? ranges.length - 1 : at
  }
  const groupCount = ranges ? ranges.length : 1
  const buckets = Array.from({ length: groupCount }, () => [])
  let current = 0
  for (const c of range.commits) {
    if (c.kind === 'task') {
      const idx = taskIndexOf(c.subject)
      if (idx !== null) current = groupOfIndex(idx)
    }
    buckets[current].push(c)
  }
  const nonEmpty = buckets.filter((b) => b.length > 0)

  const phaseFile = join(toplevel, 'roadmap', 'phases', `phase-${phaseNum}.phase.ts`)
  const record = loadPhase(phaseFile)
  const groups = nonEmpty.map((commits) => ({ commits, message: composeLandedMessage(record, { commits }) }))

  out.write(`phase ${phaseNum} curation plan — base ${range.base}\n`)
  for (const c of range.commits) out.write(`  ${c.sha.slice(0, 9)} [${c.kind}] ${c.subject}\n`)
  for (const [i, g] of groups.entries()) {
    out.write(`group ${i + 1}/${groups.length} (${g.commits.length} commits):\n`)
    out.write(`  subject: ${g.message.subject}\n`)
    out.write(`${g.message.body.replace(/^/gm, '  ')}\n`)
  }

  if (!apply) {
    out.write('dry run — nothing moved; re-run with --apply to land the curated commits\n')
    return 0
  }
  try {
    const { tip } = executeCurate(cwd, { base: range.base, groups })
    out.write(`landed ${groups.length} curated commit(s), tip ${tip}\n`)
    for (const g of groups) out.write(`  ${g.message.subject}\n`)
    return 0
  } catch (e) {
    err.write(`${e.message}\n`)
    return e instanceof CurateError ? 2 : 1
  }
}

function runCurateCli(argv) {
  const n = argv.find((a) => /^\d+$/.test(a))
  if (!n) {
    process.stderr.write('roadmap phase curate: usage: roadmap phase curate <N> [--apply] [--groups "1-3,4-6,7"]\n')
    return 1
  }
  const apply = argv.includes('--apply')
  const gi = argv.indexOf('--groups')
  const groupsSpec = gi >= 0 ? argv[gi + 1] : null
  const toplevel = gitToplevel(process.cwd())
  return runCurate({ cwd: toplevel, toplevel, phaseNum: Number(n), apply, groupsSpec })
}

export default async function run(argv) {
  const sub = argv[0]
  if (sub === 'start') return runStart(argv.slice(1))
  if (sub === 'curate') return runCurateCli(argv.slice(1))
  if (sub !== 'validate') {
    process.stderr.write(
      'roadmap phase: usage: roadmap phase validate <N|file> [--json] | start <N> | curate <N> [--apply] [--groups "1-3,4-6,7"]\n',
    )
    return 1
  }
  const { opts, positional } = parseArgs(argv.slice(1))
  const arg = positional[0]
  if (!arg) {
    process.stderr.write('roadmap phase validate: a phase number or file path is required\n')
    return 1
  }

  let target
  try {
    target = resolveTarget(arg)
  } catch (e) {
    process.stderr.write(`roadmap phase validate: ${e.message}\n`)
    return 1
  }
  if (!existsSync(target)) {
    process.stderr.write(`roadmap phase validate: no such file: ${target}\n`)
    return 1
  }

  const result = validateRoadmapFile(target, { strict: true })

  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    if (result.kind === 'toolchain-missing') process.stderr.write(TSX_ABSENT_HINT + '\n')
    else if (result.kind === 'load-error') {
      process.stderr.write(`[zeroh-roadmap] roadmap file failed to load:\n${result.loadError}\n`)
    } else if (result.kind === 'zod') {
      for (const l of renderZodIssues(result.zod.file, result.zod.issues, { debug: process.env.ZEROH_ROADMAP_DEBUG === '1' }))
        process.stderr.write(l + '\n')
    } else if (result.kind === 'errors') {
      for (const e of result.errors) {
        if (e.rawLines) for (const l of e.rawLines) process.stderr.write(l + '\n')
        else process.stderr.write(`[zeroh-roadmap] ${e.rule}: ${e.msg} — fix: ${e.fix}\n`)
      }
    } else {
      process.stdout.write(`phase validate: ${target} — OK\n`)
    }
  }

  if (result.kind === 'ok' || result.kind === 'skip') return 0
  if (result.kind === 'toolchain-missing') return 1
  return 2 // zod / load-error / errors
}
