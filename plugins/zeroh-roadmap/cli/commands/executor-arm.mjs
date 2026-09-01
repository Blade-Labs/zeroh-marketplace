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
 * Before the arm is written it also CLAIMS the product trees those keyFiles name: a live sibling
 * arm — in this root or in any other worktree of this repository — whose own phase derives an
 * intersecting foreign repository is a REFUSAL (exit 2), because two arms on one checkout is the
 * shared-tree-and-branch incident again with two phase numbers on it. `--force` overrides and
 * records what it overrode. Underivable evidence (a pruned root, a missing sibling phase file) is
 * a stderr note and never a block.
 *
 * Returns its exit code to the dispatcher — never hard-exits the process.
 */
import { existsSync } from 'node:fs'
import { armExecutor, cardModelAlias, DEFAULT_AGENT_CARD, phaseKeyFiles, productRepoOverlaps } from '../lib/executor-arm.mjs'
import { gitToplevel } from '../lib/gitroot.mjs'
import { productRepos, newestKeyFileAgeMin } from '../lib/product-repos.mjs'

/** One line naming the derived product repos + newest declared keyFile age; best-effort. */
function preflightLine(keyFiles, repos, underivable = false) {
  if (underivable) {
    return 'roadmap executor-arm: cross-repo preflight — undetermined (keyFiles underivable); no local-only claim was made\n'
  }
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
  // ONE derivation of the declared keyFiles, shared by the overlap claim below and the preflight
  // line at the end: an unreadable phase file yields no claim rather than an error, because
  // missing evidence is not evidence of a conflict (and the preflight was never a gate).
  let keys
  let ownPhaseUnreadable = false
  try {
    const scannedKeys = phaseKeyFiles(worktree, phase)
    ownPhaseUnreadable = scannedKeys === null
    keys = scannedKeys ?? []
  } catch {
    ownPhaseUnreadable = true
    keys = []
  }
  if (ownPhaseUnreadable) {
    process.stderr.write(`roadmap executor-arm: phase ${phase}'s own phase file is missing, unreadable, or has underivable keyFiles — no product-tree claim derived\n`)
  }
  const repos = productRepos(keys, { worktree, maxRepos: Infinity })
  let claim
  try {
    claim = productRepoOverlaps(worktree, phase, repos)
  } catch (err) {
    process.stderr.write(`roadmap executor-arm: product-tree overlap scan failed: ${err.message}\n`)
    return 2
  }
  for (const note of claim.notes) process.stderr.write(note)
  if (claim.overlaps.length > 0) {
    const evidence = claim.overlaps
      .map((hit) => `phase ${hit.phase} in ${hit.root} shares ${hit.repos.join(', ')}`)
      .join('; ')
    const message = `roadmap executor-arm: phase ${phase} product-tree overlap — ${evidence}`
    if (!force) {
      process.stderr.write(`${message}. Refused before writing the arm; pass --force only after verifying the shared tree is safe.\n`)
      return 2
    }
    process.stderr.write(`${message}. --force overrides the overlap; both arms remain recorded.\n`)
  }
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
  process.stderr.write(preflightLine(keys, repos, ownPhaseUnreadable))
  return 0
}
