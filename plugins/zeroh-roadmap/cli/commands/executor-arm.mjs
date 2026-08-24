/**
 * roadmap executor-arm <N> --session <id> [--executor-id <id>] [--force] — write the
 * session-bound executor arm file (the guard's channel (b)) via the ONE lifecycle lib (1737.2).
 * Missing --session is a usage error: an unbound arm is the cross-session fabrication hazard,
 * never written. A conflicting --executor-id is a REFUSAL (exit 2), not a usage error.
 *
 * After a successful arm it prints the CROSS-REPO PREFLIGHT: the repositories this phase's
 * keyFiles point into, and how fresh the freshest declared file is. No CLI can compute "newer
 * than YOUR spawn" — that fact lives only in the agent's head — so the CLI carries its half as
 * OUTPUT and the orchestrator sees the tell before it spawns a second executor into work that is
 * already underway (2026-08-17).
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { armExecutor, cardModelAlias, DEFAULT_AGENT_CARD } from '../lib/executor-arm.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'
import { scanPhaseFile } from '../lib/phasescan.mjs'
import { productRepos, newestKeyFileAgeMin } from '../lib/product-repos.mjs'

/** One line naming the derived product repos + newest declared keyFile age; best-effort. */
function preflightLine(worktree, phase) {
  let keyFiles = []
  try {
    keyFiles = scanPhaseFile(join(worktree, 'roadmap', 'phases', `phase-${phase}.phase.ts`))?.keyFiles ?? []
  } catch {
    /* the preflight is diagnostic, never a gate */
  }
  const repos = productRepos(keyFiles, { worktree })
  if (repos.length === 0) {
    return `roadmap executor-arm: cross-repo preflight — none (${keyFiles.length} keyFile(s) declared, all in this worktree's repository)\n`
  }
  const age = newestKeyFileAgeMin(keyFiles)
  return (
    `roadmap executor-arm: cross-repo preflight — ${repos.length} product repo(s): ${repos.join(', ')};`
    + ` newest declared keyFile ${age == null ? 'not written yet' : `${age.toFixed(1)}min old`}.`
    + ' Stat those files before your first write: anything newer than your own spawn is another executor at work.\n'
  )
}

export default async function run(argv) {
  const phase = argv.find((a) => /^\d+$/.test(a))
  const si = argv.indexOf('--session')
  const session = si >= 0 ? argv[si + 1] : undefined
  const ei = argv.indexOf('--executor-id')
  const rawExecutorId = ei >= 0 ? argv[ei + 1] : undefined
  // `--executor-id --force` means the id was OMITTED, not that the id is literally "--force".
  // Resolved once, so the arm and the line reporting it can never disagree.
  const executorId = rawExecutorId?.startsWith('--') ? undefined : rawExecutorId
  const force = argv.includes('--force')
  const ci = argv.indexOf('--agent-card')
  const rawCard = ci >= 0 ? argv[ci + 1] : undefined
  // `--agent-card --force` means the path was OMITTED. Falling back to the DEFAULT card there
  // would record the default's alias against an executor the caller meant to point elsewhere,
  // and result check would then red an honest return — so a flag-shaped value is a usage error.
  const cardMissing = ci >= 0 && (rawCard === undefined || rawCard.startsWith('--'))
  const cardPath = rawCard && !rawCard.startsWith('--') ? rawCard : DEFAULT_AGENT_CARD
  if (!phase || !session || session.startsWith('--') || cardMissing) {
    process.stderr.write(
      'roadmap executor-arm: usage: roadmap executor-arm <N> --session <id> [--executor-id <id>]'
        + ' [--agent-card <path>] [--force] (an unbound arm is never written)\n',
    )
    return 1
  }
  const expectedModelAlias = cardModelAlias(cardPath)
  const worktree = gitToplevel(process.cwd())
  let p
  try {
    p = armExecutor(worktree, phase, session, { executorId, expectedModelAlias, force })
  } catch (err) {
    process.stderr.write(`roadmap executor-arm: ${err.message}\n`)
    return 2
  }
  process.stderr.write(
    `roadmap executor-arm: phase ${phase} armed for session ${session}${executorId ? ` / executor ${executorId}` : ''} → ${p}\n`,
  )
  process.stderr.write(
    expectedModelAlias
      ? `roadmap executor-arm: requested model alias '${expectedModelAlias}' recorded from ${cardPath}`
        + ' — the executor stamps its own exact id and `roadmap result check` reconciles the two by family\n'
      : `roadmap executor-arm: no model alias recorded (${existsSync(cardPath) ? `${cardPath} declares no frontmatter model: line` : `no agent card at ${cardPath}`})`
        + ' — the returned driver.model will NOT be reconciled\n',
  )
  process.stderr.write(preflightLine(worktree, phase))
  return 0
}
