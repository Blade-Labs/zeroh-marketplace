/**
 * landing — THE landing implementation (arc ROADCODE singleSeam 4). `roadmap arc land`
 * is its only caller; no prose alternative survives in any skill. This module encodes
 * do-arc Step 8's landing LAW as CODE: the eight-blocker table, the openFollowups
 * computation, and the precondition list — exactly the transitions "nothing verifies"
 * today, where each historical breach got a paragraph, not a check.
 *
 * HALF 1 (1657.4 — this file's first section): the DECISIONS — gatherLandingState reads
 * persisted state only; BLOCKERS is the eight-entry data table; evaluateBlockers is one
 * pure function. HALF 2 (1657.5): the git ACTS — runArcEndSuite, landArc, landCommand,
 * the structurally-impossible forbidden push. Blocker 8 (arc base stale beyond ceiling)
 * is MECHRATCHET rank 6 — the stale-base/overlap refusal.
 *
 * "The blocker list (exactly eight — autonomous landing proceeds iff NONE hold)" and
 * "An item NOT on this list is NOT a blocker" are the ported law (do-arc Step 8).
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { bridgeImport, TSX_ABSENT_HINT } from './tsx-bridge.mjs'
import { readSidecar } from './sidecar.mjs'
import { readValidateVerdict, runDebtCensus, DeriveError } from './derive.mjs'
import { defaultExec } from './exec.mjs'

/** A typed landing failure. kind ∈ 'tsx-absent' | 'load' | 'usage'. */
export class LandingError extends Error {
  constructor(kind, messageLines, { exitCode = 1 } = {}) {
    super(messageLines.join('\n'))
    this.name = 'LandingError'
    this.kind = kind
    this.messageLines = messageLines
    this.exitCode = exitCode
  }
}

const arcFilePath = (repoRoot, arcId) => join(repoRoot, 'roadmap', 'arcs', `${arcId}.arc.ts`)
const phaseFilePath = (repoRoot, n) => join(repoRoot, 'roadmap', 'phases', `phase-${n}.phase.ts`)

// Use-site default for mergePolicy.staleBaseCeiling (blocker 8, MECHRATCHET rank 6). Applied
// wherever the ceiling is read so the ENFORCED ceiling and the emitted reconciliation ceiling
// can never drift apart. Not defaulted in the schema — every existing consumer config stays valid.
const DEFAULT_STALE_BASE_CEILING = 100

/** Strict typed read (tsx absent ⇒ loud) — a landing precondition must never guess. */
function typedRead(path, repoRoot) {
  if (!existsSync(path)) throw new LandingError('load', [`roadmap: no file at ${path}`])
  const res = bridgeImport(path, { consumerRoot: repoRoot })
  if (res.ok) return res.parsed
  if (res.kind === 'tsx-absent') throw new LandingError('tsx-absent', [`roadmap: cannot typed-read ${path} — tsx unavailable`, TSX_ABSENT_HINT])
  throw new LandingError('load', [`roadmap: failed to typed-read ${path}`, (res.stderr ?? '').trim()])
}

/**
 * Gather the landing preconditions from PERSISTED state only (do-arc Step 8 (1)): every
 * member typed-read (done + executionResult + debtResolutions), the validate verdict, the
 * census slice → openFollowups (decision 6), the integration model (decision 9), and the
 * git probes for conflict (blocker 6) + baseRef-moved (blocker 7). suiteGreen is NOT set
 * here — the caller (landCommand) runs the arc-end suite and injects it before evaluate.
 */
export function gatherLandingState({ repoRoot, arcId, config, exec = defaultExec }) {
  const arc = typedRead(arcFilePath(repoRoot, arcId), repoRoot)
  const memberNums = (arc.planes ?? []).flatMap((p) => p.phases ?? [])
  const members = memberNums.map((n) => {
    const parsed = typedRead(phaseFilePath(repoRoot, n), repoRoot)
    return {
      num: n,
      status: parsed.status,
      kind: parsed.kind ?? null,
      done: parsed.status === 'done' || parsed.status === 'historical',
      executionResult: parsed.executionResult ?? null,
      debtResolutions: parsed.debtResolutions ?? [],
    }
  })
  const hasCriteria = Array.isArray(arc.acceptanceCriteria) && arc.acceptanceCriteria.length > 0
  const verdict = readValidateVerdict(repoRoot, arcId)

  const census = runDebtCensus(repoRoot, arcId, { exec })
  const openFollowups = census === null ? null : census.open + census.openPlanned // decision 6; null = unable-to-count
  const openOperator = census?.openOperator ?? null // exempt from the count, reported in the RunnerSummary
  const openLimitations = census?.openLimitations ?? null // exempt (release-sweep's, per arc-sweep SKILL.md) — reported, never budgeted

  const mergePolicy = config.mergePolicy ?? null
  const sidecar = readSidecar(repoRoot, arcId)
  const baseRef = arc.baseRef
  const arcBranch = sidecar?.branch ?? null
  const primaryCheckout = mergePolicy?.primaryCheckout ?? null
  const integrationModel =
    sidecar && primaryCheckout && resolve(sidecar.worktree ?? '') === resolve(primaryCheckout) && arcBranch === baseRef
      ? 'direct'
      : 'isolated'

  // Git probes — best-effort against the primary checkout; a missing ref ⇒ conservative
  // default (false), the 1657.5 mechanics fixtures exercise the true positives over real refs.
  let conflict = false
  let baseRefMoved = false
  // Staleness probes (blocker 8, MECHRATCHET rank 6): commits-behind + both-sides-changed
  // overlap files. Isolated model only, isolated (read-only) git, conservative on any probe
  // failure (behind 0 / overlap [] — never a guessed refusal).
  let baseBehindCount = 0
  let overlapFiles = []
  if (primaryCheckout && arcBranch && baseRef && integrationModel === 'isolated') {
    const anc = exec('git', ['-C', primaryCheckout, 'merge-base', '--is-ancestor', baseRef, arcBranch])
    if (anc.status === 1) baseRefMoved = true // 1 = not an ancestor (baseRef moved); other codes = probe unavailable
    const mt = exec('git', ['-C', primaryCheckout, 'merge-tree', '--write-tree', baseRef, arcBranch])
    if (mt.status === 1) conflict = true // 1 = conflicts; 0 = clean; >1 = probe unavailable

    const mb = exec('git', ['-C', primaryCheckout, 'merge-base', baseRef, arcBranch])
    const mergeBase = mb.status === 0 ? mb.stdout.trim() : ''
    const rl = exec('git', ['-C', primaryCheckout, 'rev-list', '--count', `${arcBranch}..${baseRef}`])
    if (rl.status === 0) {
      const n = parseInt(rl.stdout.trim(), 10)
      if (Number.isFinite(n)) baseBehindCount = n
    }
    if (mergeBase) {
      const toSet = (r) => new Set((r.status === 0 ? r.stdout : '').split('\n').map((l) => l.trim()).filter(Boolean))
      const arcSide = toSet(exec('git', ['-C', primaryCheckout, 'diff', '--name-only', `${mergeBase}..${arcBranch}`]))
      const baseSide = toSet(exec('git', ['-C', primaryCheckout, 'diff', '--name-only', `${mergeBase}..${baseRef}`]))
      overlapFiles = [...baseSide].filter((f) => arcSide.has(f)).sort()
    }
  }

  return {
    arcId,
    arc,
    members,
    hasCriteria,
    descopes: arc.descopes ?? [],
    verdict,
    openFollowups,
    openOperator,
    openLimitations,
    censusEntries: census?.entries ?? null,
    mergePolicy,
    baseRef,
    arcBranch,
    primaryCheckout,
    sidecar,
    integrationModel,
    conflict,
    baseRefMoved,
    baseBehindCount,
    overlapFiles,
    staleAcknowledged: false, // set true by --force-stale in landCommand before evaluate (blocker 8 only)
    suiteGreen: null, // set by the caller after runArcEndSuite (1657.5)
    reconciledGreen: false, // set true after a post-reconciliation green suite (1657.5)
  }
}

/**
 * THE eight-blocker table (do-arc Step 8), encoded as DATA + one check per row.
 * Each check(state) → null (clear) | reason string. Exactly eight — an item NOT on this
 * list is NOT a blocker; the length is pinned by the test. maxOpenFollowups defaults to 0
 * (today's fail-safe) when no mergePolicy is configured; staleBaseCeiling defaults to 100
 * (blocker 8, MECHRATCHET rank 6).
 */
export const BLOCKERS = [
  {
    id: 1,
    name: 'member not done / executionResult failed or escalated',
    check: (s) => {
      for (const m of s.members) {
        if (!m.done) return `phase ${m.num} is not done (status ${m.status})`
        if (!m.executionResult) return `phase ${m.num} is done but has no executionResult (the typed roll-up is a landing precondition — do-arc Step 8 (1))`
        const st = m.executionResult?.status
        if (st === 'failed' || st === 'escalated') return `phase ${m.num} executionResult.status is ${st}`
      }
      return null
    },
  },
  {
    id: 2,
    name: 'unratified hardStop (no matching arc.descopes)',
    check: (s) => {
      for (const m of s.members) {
        for (const hs of m.executionResult?.hardStops ?? []) {
          const ratified = s.descopes.some((d) => (hs.text && d.includes(hs.text)) || (hs.text && hs.text.includes(d)))
          if (!ratified) return `phase ${m.num} hardStop ${hs.tag} is unratified (no matching arc.descopes entry)`
        }
      }
      return null
    },
  },
  {
    id: 3,
    name: 'validate verdict GAPS or absent-with-criteria',
    check: (s) => {
      if (!s.hasCriteria) return null
      if (s.verdict === null) return 'validate verdict artifact absent while the arc HAS acceptanceCriteria'
      if (s.verdict.verdict === 'GAPS') return 'validate verdict is GAPS'
      return null
    },
  },
  {
    id: 4,
    name: 'arc-end suite not green',
    check: (s) => (s.suiteGreen === true ? null : 'the arc-end full suite is not green'),
  },
  {
    id: 5,
    name: 'openFollowups over budget',
    check: (s) => {
      const max = s.mergePolicy?.maxOpenFollowups ?? 0
      if (s.openFollowups === null) return 'openFollowups unable-to-count (census invocation failed) ⇒ treated over budget'
      if (s.openFollowups > max) return `openFollowups ${s.openFollowups} > max-open-followups ${max}`
      return null
    },
  },
  {
    id: 6,
    name: 'merge conflict against baseRef',
    check: (s) => (s.conflict ? `merge conflict against baseRef ${s.baseRef}` : null),
  },
  {
    id: 7,
    name: 'baseRef moved with no post-reconciliation green suite',
    check: (s) => (s.baseRefMoved && !s.reconciledGreen ? `baseRef ${s.baseRef} moved under the arc with no post-reconciliation green suite` : null),
  },
  {
    id: 8,
    name: 'arc base stale beyond ceiling (unacknowledged)',
    check: (s) => {
      const ceiling = s.mergePolicy?.staleBaseCeiling ?? DEFAULT_STALE_BASE_CEILING
      if (s.staleAcknowledged) return null // --force-stale clears blocker 8 alone (6/7 still hold on their own terms)
      if ((s.baseBehindCount ?? 0) <= ceiling) return null
      const overlap = (s.overlapFiles ?? []).length
        ? `overlapping files: ${s.overlapFiles.join(', ')}`
        : 'no overlapping files'
      return `arc base is ${s.baseBehindCount} commits behind ${s.baseRef} (ceiling ${ceiling}) — ${overlap}; reconcile then acknowledge with --force-stale`
    },
  },
]

/** Evaluate every blocker against the state; return the held list ({ id, name, reason }). */
export function evaluateBlockers(state) {
  return BLOCKERS.map((b) => ({ id: b.id, name: b.name, reason: b.check(state) })).filter((x) => x.reason)
}

// ─────────────────────────────────────────────────────────────────────────────
// HALF 2 (1657.5) — the git ACTS: arc-end suite, landing mechanics, the
// structurally-impossible forbidden push, the RunnerSummary, exits 0/3/2.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolveSlot, runSlot } from './slots.mjs'
import { removeSidecar, releaseClaims } from './sidecar.mjs'
import { bridgeEval, consumerSchemaPath, BridgeError } from './tsx-bridge.mjs'
import { gitToplevel } from './gitroot.mjs'
import { loadConfig, ConfigError } from './config.mjs'

/**
 * The deferred arc-end full suite (do-arc Step 8, "First, the arc-end full-suite gate"):
 * the `unit` + `integration` slots verbatim, + `e2e` iff a member is release-kind. Each
 * slot runs through runSlot (the ONE slot executor); a red slot ⇒ suiteGreen false. A
 * declared-`none` slot is SKIPPED, recorded honestly (never a fake green); an arc whose
 * every slot is absent records the no-runtime-suite note rather than pretending it ran.
 */
export async function runArcEndSuite({ config, cwd, includeE2e = false }) {
  const wanted = ['unit', 'integration', ...(includeE2e ? ['e2e'] : [])]
  const results = []
  let anyRan = false
  let anyRed = false
  for (const slot of wanted) {
    const resolved = resolveSlot(config, slot)
    if (resolved.declaredAbsent) {
      results.push({ slot, skipped: 'declared none' })
      continue
    }
    if (resolved.refused) {
      results.push({ slot, refused: resolved.refused })
      anyRed = true // an unresolvable required slot is a red, not a silent skip
      continue
    }
    const run = await runSlot(resolved, { cwd })
    anyRan = true
    if (run.exitCode !== 0) anyRed = true
    results.push({ slot, exitCode: run.exitCode, durationMs: run.durationMs })
  }
  const note = !anyRan ? 'no runtime suite ran (every arc-end slot is declared none — docs-only arc)' : undefined
  return { slots: results, suiteGreen: !anyRed, ran: anyRan, ...(note ? { note } : {}) }
}

/**
 * The injectable git layer. Its ONLY push helper is pushBaseRef(checkout, baseRefName) →
 * argv ['push','origin', baseRefName]: no function accepts a refspec, no interpolation can
 * produce `<branch>:<baseRef>` (the ONEPROMPT 2026-07-13 incident class, made UNWRITABLE
 * rather than checked-after). Plus the hard rail ABOVE config (decision 8): pushBaseRef
 * REFUSES master/main regardless of autonomousPushRefs — a release is a held human act.
 */
function gitLayer(exec) {
  const run = (cwd, args) => exec('git', ['-C', cwd, ...args])
  return {
    fetch: (cwd, ref) => run(cwd, ['fetch', 'origin', ref]),
    headBranch: (cwd) => run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(),
    hasMergeHead: (cwd) => run(cwd, ['rev-parse', '--verify', '-q', 'MERGE_HEAD']).status === 0,
    mergeTreeConflict: (cwd, base, branch) => run(cwd, ['merge-tree', '--write-tree', base, branch]).status === 1,
    merge: (cwd, branch) => run(cwd, ['merge', '--no-edit', branch]),
    worktreeRemove: (cwd, wt) => run(cwd, ['worktree', 'remove', '--force', wt]),
    pushBaseRef: (checkout, baseRefName) => {
      if (baseRefName === 'master' || baseRefName === 'main') {
        return { refused: true, reason: `pushBaseRef refuses ${baseRefName} — a release is a held human act (do-arc Step 8 invariant)` }
      }
      return exec('git', ['-C', checkout, 'push', 'origin', baseRefName])
    },
  }
}

/** Build the RunnerSummary for a landed arc (decision 10 — honest gateSignals, 'none' receipt). */
export function buildRunnerSummary(state, { suiteGreen }) {
  const openCount = state.censusEntries === null ? null : state.censusEntries.filter((e) => e.state === 'OPEN').length
  const arcSweepClean = openCount === 0
  const validateArcPassed = state.hasCriteria ? state.verdict?.verdict === 'PASS' : true
  const summary = {
    arcId: state.arcId,
    outcome: 'shipped',
    compromiseDisposition: [],
    gateSignals: { arcSweepClean, validateArcPassed, fullSuiteGreen: suiteGreen === true },
    receiptRef: 'none', // honest sentinel — no consumer governance-receipt surface
  }
  if (state.openFollowups != null) summary.openFollowups = state.openFollowups
  return summary
}

/** Validate a RunnerSummary through the CONSUMER's RunnerSummaryShape (seam 3 — no second Zod copy). */
export function validateRunnerSummary(consumerRoot, summary) {
  const schemaPath = consumerSchemaPath(consumerRoot) // throws BridgeError('schema-missing') → caller maps exit 1
  const script = `
const schemaPath = process.argv[1]
import('file://' + schemaPath).then((m) => {
  const shape = m.RunnerSummaryShape || (m.default && m.default.RunnerSummaryShape)
  if (!shape) { process.stderr.write('RunnerSummaryShape not exported from ' + schemaPath); process.exit(4) }
  const r = shape.safeParse(JSON.parse(process.argv[2]))
  if (r.success) process.stdout.write('OK')
  else { process.stderr.write('ZODISSUES:' + JSON.stringify(r.error.issues)); process.exit(3) }
}).catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(4) })
`
  const res = bridgeEval(consumerRoot, script, { args: [schemaPath, JSON.stringify(summary)] })
  if (res.ok) return
  if (res.kind === 'tsx-absent') throw new LandingError('tsx-absent', ['roadmap arc land: cannot validate the RunnerSummary — tsx unavailable', TSX_ABSENT_HINT])
  throw new LandingError('load', ['roadmap arc land: the RunnerSummary failed RunnerSummaryShape.parse (a broken summary must fail loud, never ship)', (res.stderr ?? '').trim()])
}

/** Write the RunnerSummary keyed (never overwritten) + the latest pointer. */
function writeRunnerSummary(repoRoot, summary) {
  const day = new Date().toISOString().slice(0, 10)
  const dir = join(repoRoot, 'roadmap', 'arc-summaries')
  mkdirSync(dir, { recursive: true })
  const keyed = join(dir, `${summary.arcId}-${day}.json`)
  if (!existsSync(keyed)) writeFileSync(keyed, JSON.stringify(summary, null, 2) + '\n') // keyed history is never overwritten
  writeFileSync(join(repoRoot, 'roadmap', 'arc-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return keyed
}

/**
 * landArc — the decision-9 landing sequence over the injectable exec seam. Assumes
 * blockers already cleared (landCommand gates it). Returns { outcome, exitCode, record,
 * pushed, pushRefused, summaryPath }. record is the ordered step log the tests replay.
 */
export function landArc({ repoRoot, arcId, config, exec = defaultExec, flags = {}, state, consumerRoot = repoRoot }) {
  const git = gitLayer(exec)
  const mp = config.mergePolicy
  const primary = mp.primaryCheckout
  const baseRef = state.baseRef
  const arcBranch = state.arcBranch
  const record = []

  if (state.integrationModel === 'direct') {
    record.push({ step: 'direct-on-baseRef', note: 'sidecar worktree IS the primary checkout on baseRef — no merge performed' })
  } else {
    git.fetch(primary, baseRef)
    record.push({ step: 'fetch', ref: baseRef })
    const head = git.headBranch(primary)
    if (head !== baseRef) {
      return { outcome: 'blocker', exitCode: 2, held: [{ name: 'primary HEAD not baseRef', reason: `primary checkout ${primary} is on ${head}, not ${baseRef} — wait for the sibling; never branch-switch under it` }], record }
    }
    if (git.hasMergeHead(primary)) {
      return { outcome: 'blocker', exitCode: 2, held: [{ name: 'MERGE_HEAD present', reason: `primary checkout ${primary} has an in-progress merge (MERGE_HEAD) — resolve it first` }], record }
    }
    if (git.mergeTreeConflict(primary, baseRef, arcBranch)) {
      return { outcome: 'blocker', exitCode: 2, held: [{ name: 'merge conflict', reason: `merge of ${arcBranch} into ${baseRef} conflicts` }], record }
    }
    const merged = git.merge(primary, arcBranch)
    record.push({ step: 'merge', branch: arcBranch, into: baseRef, status: merged.status })
    if (merged.status !== 0) {
      return { outcome: 'blocker', exitCode: 2, held: [{ name: 'merge failed', reason: `git merge ${arcBranch} into ${baseRef} failed: ${merged.stderr}` }], record }
    }
  }

  // Backlog regroom against the landed baseRef is orchestrator-owned in arc mode (serial,
  // post-return) — landing records the hand-off point rather than forking a second groom.
  record.push({ step: 'regroom-handoff', note: 'backlog regroom against landed baseRef is orchestrator-owned (serial)' })

  // Cleanup — worktree, sidecar, RESUME.md, claims.
  if (state.integrationModel === 'isolated' && state.sidecar?.worktree) {
    git.worktreeRemove(primary, state.sidecar.worktree)
    record.push({ step: 'worktree-remove', worktree: state.sidecar.worktree })
  }
  removeSidecar(repoRoot, arcId)
  const resumeMd = join(repoRoot, 'roadmap', 'arcs', `${arcId}-RESUME.md`)
  rmSync(resumeMd, { force: true })
  releaseClaims(repoRoot, state.members.map((m) => m.num))
  record.push({ step: 'cleanup', removed: ['.building sidecar', 'RESUME.md', 'claims'] })

  // RunnerSummary — validated through the consumer shape (seam 3), written keyed + pointer.
  const summary = buildRunnerSummary(state, { suiteGreen: state.suiteGreen })
  validateRunnerSummary(consumerRoot, summary)
  const summaryPath = writeRunnerSummary(repoRoot, summary)
  record.push({ step: 'runner-summary', path: summaryPath })

  // Push — iff autonomousPushRefs contains baseRef (decision 9); --no-push forces skip;
  // --push is user authority over an absent listing, but NEVER the master/main rail (decision 8).
  const wantPush = flags.noPush ? false : flags.push ? true : (mp.autonomousPushRefs ?? []).includes(baseRef)
  let pushed = false
  let pushRefused = null
  if (wantPush) {
    const pr = git.pushBaseRef(primary, baseRef)
    if (pr.refused) pushRefused = pr.reason
    else pushed = pr.status === 0
    record.push({ step: 'push', pushed, ...(pushRefused ? { refused: pushRefused } : {}) })
  }

  return { outcome: 'landed', exitCode: 0, record, pushed, pushRefused, summaryPath, summary }
}

/** roadmap arc land <arcId> [--push|--no-push|--hold|--force-stale] [--json] — the §2 land command. */
export async function landCommand(rest) {
  const json = rest.includes('--json')
  const flags = { push: rest.includes('--push'), noPush: rest.includes('--no-push'), hold: rest.includes('--hold'), forceStale: rest.includes('--force-stale') }
  const arcId = rest.find((a) => !a.startsWith('--'))
  if (!arcId) {
    process.stderr.write('usage: roadmap arc land <arcId> [--push|--no-push|--hold|--force-stale] [--json]\n')
    return 1
  }
  let toplevel, cfg
  try {
    toplevel = gitToplevel(process.cwd())
    cfg = loadConfig(process.cwd())
  } catch (e) {
    for (const l of e instanceof ConfigError ? e.messageLines : [`roadmap arc land: ${e.message}`]) process.stderr.write(l + '\n')
    return 1
  }
  let state
  try {
    state = gatherLandingState({ repoRoot: toplevel, arcId, config: cfg })
  } catch (e) {
    if (e instanceof LandingError || e instanceof DeriveError || e instanceof BridgeError) {
      for (const l of e.messageLines ?? [e.message]) process.stderr.write(l + '\n')
      return e.exitCode ?? 1
    }
    throw e
  }

  const emit = (obj) => process.stdout.write(JSON.stringify(obj, null, json ? 0 : 2) + '\n')
  const mp = cfg.mergePolicy

  // Held-for-user (exit 3, the fail-safe default): --hold, an absent mergePolicy, or arcIntegration hold.
  if (flags.hold || !mp || mp.arcIntegration === 'hold') {
    emit({ action: 'held', arcId, reason: flags.hold ? 'user --hold' : !mp ? 'no mergePolicy configured (fail-safe hold)' : 'mergePolicy.arcIntegration is hold' })
    return 3
  }

  // Arc-end suite → suiteGreen → blockers. --force-stale is an ACKNOWLEDGMENT (blocker 8
  // alone), never a bypass of 6/7. The overlap list is the mandatory reconciliation output
  // whenever the base is behind — emitted under --force-stale too (arc honesty rail 3).
  if (flags.forceStale) state.staleAcknowledged = true
  const staleBase = state.baseBehindCount > 0
    ? { behind: state.baseBehindCount, ceiling: mp.staleBaseCeiling ?? DEFAULT_STALE_BASE_CEILING, overlapFiles: state.overlapFiles }
    : null
  const includeE2e = state.members.some((m) => m.kind === 'release')
  const suite = await runArcEndSuite({ config: cfg, cwd: state.sidecar?.worktree ?? toplevel, includeE2e })
  state.suiteGreen = suite.suiteGreen
  const held = evaluateBlockers(state)
  if (held.length) {
    emit({ action: 'blocked', arcId, held, suite, ...(staleBase ? { staleBase } : {}) })
    return 2
  }

  let res
  try {
    res = landArc({ repoRoot: toplevel, arcId, config: cfg, flags, state })
  } catch (e) {
    if (e instanceof LandingError || e instanceof BridgeError) {
      for (const l of e.messageLines ?? [e.message]) process.stderr.write(l + '\n')
      return e.exitCode ?? 1
    }
    throw e
  }
  emit({ action: res.outcome, arcId, ...res, suite, ...(staleBase ? { staleBase } : {}) })
  return res.exitCode
}
