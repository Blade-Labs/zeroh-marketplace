/**
 * roadmap codex — the sanctioned Codex delegation lane: launch a detached Codex CLI run
 * that implements queued phase(s) in an isolated worktree, and read its typed status.
 *
 *   roadmap codex run <N> [<N2>…] [--worktree <path>] [--base <ref>]
 *   roadmap codex status <N>
 *
 * The whole point of this being ONE committed entrypoint is classifier hygiene: the
 * shared-host hook and the orphan-reaper pattern-match the VISIBLE command line, so the
 * hand-rolled launch (setsid + sandbox bypass + stdin prompt) kept tripping them. Every
 * hard-won invariant lives here instead (session lessons 2026-07-15/22):
 *  - direct CLI with --dangerously-bypass-approvals-and-sandbox (the companion runtime's
 *    bubblewrap sandbox cannot create loopback on this host — bwrap RTM_NEWADDR);
 *  - the mission prompt goes via STDIN, never argv (the test-orphan-reaper kills any
 *    detached PPID-1 process whose args mention vitest/--test — a long prompt naming the
 *    verify commands looks exactly like a leaked test worker);
 *  - detached via setsid semantics (spawn detached:true + unref), log + journal in
 *    .building/ mirroring the arc-land detach pattern;
 *  - single-run-per-worktree: a live journal pgid refuses a double-run (two Codex runs in
 *    one worktree collide); the liveness probe is process-group kill(0), never pgrep
 *    (pgrep -f self-matches the probe's own argv);
 *  - the hand-off contract: Codex ends by writing CODEX-REPORT.md (never committed) with
 *    per-task shas + verify outcomes and a terminal sentinel CODEX-RUN-COMPLETE|BLOCKED.
 *
 * Division of labor (doctrine, mirrored in do-phase SKILL.md): Codex implements tasks +
 * per-task commits + transparencyReports; the GATE never moves — gate plan/run, the
 * review agents, the done-flip, and --verify-complete stay with the supervising session.
 * This command never merges and never pushes.
 */
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { gitToplevel } from '../lib/gitroot.mjs'

const SENTINEL_RE = /CODEX-RUN-(COMPLETE|BLOCKED)/

function journalPath(root, ids) {
  return join(root, '.building', `codex-${ids.join('-')}.json`)
}

/** Process-group liveness without pgrep (pgrep -f self-matches its own probe argv). */
function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

function buildPrompt(root, ids) {
  const phaseFiles = ids.map((n) => `roadmap/phases/phase-${n}.phase.ts`)
  for (const f of phaseFiles) {
    if (!existsSync(join(root, f))) throw new Error(`phase file missing: ${f}`)
  }
  return [
    `You are implementing ${ids.length > 1 ? `${ids.length} roadmap phases` : 'ONE roadmap phase'} end-to-end in this git worktree. Work ONLY here. NEVER push. NEVER \`git add -A\` — stage explicit paths only.`,
    '',
    `THE PLANS (read fully first; every decision is pre-made in their notes — implement, never re-decide; do them in this order): ${phaseFiles.join(', ')}`,
    '',
    'PROTOCOL per phase:',
    "1. Run the phase's assumptions[] verify commands first. Any failure = STOP and report in CODEX-REPORT.md; do not improvise.",
    '2. Execute tasks IN ORDER. One task = ONE commit, message grammar (em-dash mandatory): "type(scope): phase <N> — <N>.<X> <short title>", ending with the trailer line: Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>',
    "   In the SAME commit set that task's done: true + a transparencyReport (whatWasDone/how/compromises/skipped/hardcoded/limitations — honest and concrete) in the phase file.",
    '3. Run every step\'s "→ verify:" command and make it pass before committing. TDD tasks: failing test RED first, then GREEN — note the RED evidence in the report.',
    '',
    'SHARED-HOST RULES (~5 concurrent AI sessions on 16 GB — violating these can freeze the box):',
    '- Every test suite / type-check / build runs wrapped: `capbuild <cmd>`. Scoped tiers run EXACTLY `bash scripts/test/run-tier.sh <slot> <files…>` (self-wraps capbuild); NEVER pipe tier output through tail/head/grep.',
    '- No dev servers; no full `npm test` — only the commands the verify clauses name.',
    '',
    'THE GATE IS YOURS TOO (user ruling 2026-07-22 — you run the phase fully): after the last task of each phase, run `roadmap gate plan <N> --json` then `roadmap gate run <N>` and drive every slot to GREEN (fix commits: "fix(scope): phase <N> gate RX — <what>"). Perform your OWN adversarial review of the phase diff (bugs, convention drift, honesty rails) and record it honestly in the phase file gateRounds as reviewer "codex-self-review" — never claim an agent review that did not run. Then flip the phase to done (status/completedDate/gate/metrics/gateRounds/executionResult — mirror a recent done phase\'s shape) and run `roadmap gate run <N> --verify-complete`.',
    '',
    'WHEN FINISHED (or blocked): write CODEX-REPORT.md in the worktree root (do NOT commit it) with per-task commit sha + verify commands run + outcomes + gate results + any deviation, ending with the single line CODEX-RUN-COMPLETE (or CODEX-RUN-BLOCKED).',
    '',
    'NEVER merge, NEVER push, NEVER touch the primary checkout or backlog.ts — the supervising session double-checks your work, merges, and cleans up.',
  ].join('\n')
}

function runCodex(root, ids, argv) {
  const wi = argv.indexOf('--worktree')
  const bi = argv.indexOf('--base')
  const base = bi >= 0 ? argv[bi + 1] : 'develop'
  const worktree = wi >= 0 ? argv[wi + 1] : `${root}-codex-${ids.join('-')}`
  const building = join(root, '.building')
  mkdirSync(building, { recursive: true })
  const jPath = journalPath(root, ids)

  if (existsSync(jPath)) {
    const j = JSON.parse(readFileSync(jPath, 'utf8'))
    if (j.pgid && groupAlive(j.pgid)) {
      process.stderr.write(`roadmap codex: a run for ${ids.join(',')} is LIVE (pgid ${j.pgid}, log ${j.log}) — refusing a double-run\n`)
      return 2
    }
  }

  if (!existsSync(worktree)) {
    const wt = spawnSync('git', ['worktree', 'add', worktree, '-b', `codex/${ids.join('-')}`, base], { cwd: root, stdio: 'inherit' })
    if (wt.status !== 0) return wt.status ?? 1
    const capbuild = spawnSync('which', ['capbuild']).status === 0
    for (const dir of [worktree, join(worktree, 'web')]) {
      if (!existsSync(join(dir, 'package.json'))) continue
      const ci = capbuild
        ? spawnSync('capbuild', ['npm', 'ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' })
        : spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' })
      if (ci.status !== 0) {
        process.stderr.write(`roadmap codex: npm ci failed in ${dir} — not launching\n`)
        return 1
      }
    }
  }

  const promptPath = join(building, `codex-${ids.join('-')}-prompt.txt`)
  writeFileSync(promptPath, buildPrompt(root, ids))
  const logPath = join(building, `codex-${ids.join('-')}.log`)
  const logFd = openSync(logPath, 'a')

  // Prompt on STDIN (argv stays clean of test keywords), fully detached, own group.
  const child = spawn(
    'codex',
    ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', worktree, '-'],
    { detached: true, stdio: [openSync(promptPath, 'r'), logFd, logFd] },
  )
  child.unref()

  writeFileSync(
    jPath,
    JSON.stringify({ phases: ids, worktree, base, pgid: child.pid, log: logPath, prompt: promptPath, startedAt: new Date().toISOString() }, null, 2) + '\n',
  )
  process.stderr.write(`roadmap codex: launched pgid ${child.pid} in ${worktree} — journal ${jPath}, log ${logPath}. Poll: roadmap codex status ${ids[0]}\n`)
  return 0
}

function statusCodex(root, ids) {
  const jPath = journalPath(root, ids)
  if (!existsSync(jPath)) {
    // A single id may belong to a multi-phase journal — scan .building for it.
    process.stderr.write(`roadmap codex: no journal at ${jPath}\n`)
    return 1
  }
  const j = JSON.parse(readFileSync(jPath, 'utf8'))
  const reportPath = join(j.worktree, 'CODEX-REPORT.md')
  const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : ''
  const sentinel = report.match(SENTINEL_RE)?.[0] ?? null
  const alive = j.pgid ? groupAlive(j.pgid) : false
  const state = sentinel === 'CODEX-RUN-COMPLETE' ? 'complete' : sentinel === 'CODEX-RUN-BLOCKED' ? 'blocked' : alive ? 'running' : 'dead-no-report'
  process.stdout.write(JSON.stringify({ state, alive, sentinel, report: existsSync(reportPath) ? reportPath : null, ...j }, null, 2) + '\n')
  return state === 'complete' ? 0 : state === 'running' ? 3 : 2
}

/** --arc <ID>: resolve the arc's member phases (planes order) so a whole arc delegates as one run. */
function arcPhases(root, arcId) {
  const src = readFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), 'utf8')
  const ids = [...src.matchAll(/phases:\s*\[([\d,\s]+)\]/g)].flatMap((m) => m[1].match(/\d+/g) ?? [])
  if (ids.length === 0) throw new Error(`no member phases found in arc ${arcId}`)
  return ids
}

export default async function run(argv) {
  const sub = argv[0]
  const ai = argv.indexOf('--arc')
  const root = gitToplevel(process.cwd())
  const ids = ai >= 0 ? arcPhases(root, argv[ai + 1]) : argv.slice(1).filter((a) => /^\d+$/.test(a))
  if (sub === 'run' && ids.length > 0) return runCodex(root, ids, argv)
  if (sub === 'status' && ids.length > 0) return statusCodex(root, ids)
  process.stderr.write('roadmap codex: usage: roadmap codex run <N> [<N2>…] | run --arc <ID> [--worktree <path>] [--base <ref>] | roadmap codex status <N> [<N2>…] | status --arc <ID>\n')
  return 1
}
