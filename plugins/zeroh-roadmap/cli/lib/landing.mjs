/**
 * landing — THE landing implementation (arc ROADCODE singleSeam 4). `roadmap arc land`
 * is its only caller; no prose alternative survives in any skill. This module encodes
 * do-arc Step 8's landing LAW (SKILL.md:290-326) as CODE: the seven-blocker table, the
 * openFollowups computation, and the precondition list — exactly the transitions
 * "nothing verifies" today, where each historical breach got a paragraph, not a check.
 *
 * HALF 1 (1657.4 — this file's first section): the DECISIONS — gatherLandingState reads
 * persisted state only; BLOCKERS is the seven-entry data table; evaluateBlockers is one
 * pure function. HALF 2 (1657.5): the git ACTS — runArcEndSuite, landArc, landCommand,
 * the structurally-impossible forbidden push.
 *
 * "The blocker list (exactly seven — autonomous landing proceeds iff NONE hold)" and
 * "An item NOT on this list is NOT a blocker" are the ported law (do-arc SKILL.md:313).
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
  if (primaryCheckout && arcBranch && baseRef && integrationModel === 'isolated') {
    const anc = exec('git', ['-C', primaryCheckout, 'merge-base', '--is-ancestor', baseRef, arcBranch])
    if (anc.status === 1) baseRefMoved = true // 1 = not an ancestor (baseRef moved); other codes = probe unavailable
    const mt = exec('git', ['-C', primaryCheckout, 'merge-tree', '--write-tree', baseRef, arcBranch])
    if (mt.status === 1) conflict = true // 1 = conflicts; 0 = clean; >1 = probe unavailable
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
    censusEntries: census?.entries ?? null,
    mergePolicy,
    baseRef,
    arcBranch,
    primaryCheckout,
    sidecar,
    integrationModel,
    conflict,
    baseRefMoved,
    suiteGreen: null, // set by the caller after runArcEndSuite (1657.5)
    reconciledGreen: false, // set true after a post-reconciliation green suite (1657.5)
  }
}

/**
 * THE seven-blocker table (do-arc Step 8:313-321), encoded as DATA + one check per row.
 * Each check(state) → null (clear) | reason string. Exactly seven — an item NOT on this
 * list is NOT a blocker; the length is pinned by the test. maxOpenFollowups defaults to 0
 * (today's fail-safe) when no mergePolicy is configured.
 */
export const BLOCKERS = [
  {
    id: 1,
    name: 'member not done / executionResult failed or escalated',
    check: (s) => {
      for (const m of s.members) {
        if (!m.done) return `phase ${m.num} is not done (status ${m.status})`
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
]

/** Evaluate every blocker against the state; return the held list ({ id, name, reason }). */
export function evaluateBlockers(state) {
  return BLOCKERS.map((b) => ({ id: b.id, name: b.name, reason: b.check(state) })).filter((x) => x.reason)
}

// LandingError/DeriveError are surfaced so half 2 (1657.5) and the command layer map exits.
export { DeriveError }
