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
import { TSX_ABSENT_HINT } from '../lib/tsx-bridge.mjs'
import { appendExecutorEvent } from '../lib/beacon.mjs'
import { matchStatusField } from '../lib/phasescan.mjs'

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

export default async function run(argv) {
  const sub = argv[0]
  if (sub === 'start') return runStart(argv.slice(1))
  if (sub !== 'validate') {
    process.stderr.write('roadmap phase: usage: roadmap phase validate <N|file> [--json]\n')
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
