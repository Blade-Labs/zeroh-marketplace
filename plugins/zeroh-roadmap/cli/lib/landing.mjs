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
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { bridgeImport, bridgeImportMany, TSX_ABSENT_HINT } from './tsx-bridge.mjs'
import { readSidecar } from './sidecar.mjs'
import { readValidateVerdict, runDebtCensus, DeriveError } from './derive.mjs'
import { derivePhaseStartSha, GitScanError } from './gitscan.mjs'
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
export const DEFAULT_STALE_BASE_CEILING = 100

/** Strict typed read (tsx absent ⇒ loud) — a landing precondition must never guess. */
function typedRead(path, repoRoot) {
  if (!existsSync(path)) throw new LandingError('load', [`roadmap: no file at ${path}`])
  const res = bridgeImport(path, { consumerRoot: repoRoot })
  if (res.ok) return res.parsed
  if (res.kind === 'tsx-absent') throw new LandingError('tsx-absent', [`roadmap: cannot typed-read ${path} — tsx unavailable`, TSX_ABSENT_HINT])
  throw new LandingError('load', [`roadmap: failed to typed-read ${path}`, (res.stderr ?? '').trim()])
}

/**
 * Batch typed-read (ONE tsx process for all N paths). Per-file failure maps to the SAME
 * LandingError typedRead throws (tsx-absent ⇒ loud hint; else load naming THAT file), so
 * the converted call site is behavior-identical to the per-file loop it replaces. Returns
 * a path→parsed map.
 */
function typedReadMany(paths, repoRoot) {
  for (const p of paths) if (!existsSync(p)) throw new LandingError('load', [`roadmap: no file at ${p}`])
  const res = bridgeImportMany(paths, { consumerRoot: repoRoot })
  if (!res.ok) {
    if (res.kind === 'tsx-absent') throw new LandingError('tsx-absent', ['roadmap: cannot typed-read member phase files — tsx unavailable', TSX_ABSENT_HINT])
    throw new LandingError('load', ['roadmap: failed to batch typed-read member phase files', (res.stderr ?? '').trim()])
  }
  const out = {}
  for (const p of paths) {
    const r = res.byPath[p]
    if (!r || !r.ok) {
      if (r?.kind === 'tsx-absent') throw new LandingError('tsx-absent', [`roadmap: cannot typed-read ${p} — tsx unavailable`, TSX_ABSENT_HINT])
      throw new LandingError('load', [`roadmap: failed to typed-read ${p}`, (r?.stderr ?? '').trim()])
    }
    out[p] = r.parsed
  }
  return out
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
  // Batch every member phase file in ONE tsx process (was one ~7s spawn per member).
  const parsedByPath = typedReadMany(memberNums.map((n) => phaseFilePath(repoRoot, n)), repoRoot)
  const members = memberNums.map((n) => {
    const parsed = parsedByPath[phaseFilePath(repoRoot, n)]
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
    check: (s) =>
      s.suiteGreen === true
        ? null
        : `the arc-end suite (${s.suiteMode === 'impacted' ? 'impacted scope' : 'full'}) is not green`,
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

/**
 * The detached-land JOURNAL (1792.4): a landing run's own state file beside the arc sidecar.
 * A session event reaps a plain background land, so `arc land --detach` self-daemonizes and
 * records its progress HERE — the next session reads the journal instead of re-deriving the
 * setsid+sentinel ladder by hand or starting a DUPLICATE suite over a live run.
 */
export function landJournalPath(worktree, arcId) {
  return join(worktree, '.building', `${arcId}-land.json`)
}

/** Merge `patch` into the journal (creating it when absent), always re-stamping updatedAt.
 *  Returns the written object — the caller never re-reads to know what landed. */
export function writeLandJournal(worktree, arcId, patch) {
  const path = landJournalPath(worktree, arcId)
  let current = {}
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      current = {} // a corrupt journal is replaced by the live run's truth, never merged into
    }
  }
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n')
  return next
}

/** Read the journal: null when absent, the parsed object when readable, and the named
 *  { corrupt, path } signal when it will not parse — NEVER a throw (a corrupt journal must
 *  not wedge the CLI, and the operator gets the path to inspect). */
export function readLandJournal(worktree, arcId) {
  const path = landJournalPath(worktree, arcId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { corrupt: true, path }
  }
}

/**
 * The resume verdict over a journal. `isAlive(pid)` is INJECTED (the caller supplies the real
 * process probe; tests pin a spy). Order is load-bearing: corrupt bytes carry no trustworthy
 * pid, and a recorded exitCode — INCLUDING 0 — is a finished run, never a liveness question.
 */
export function classifyLandJournal(journal, { isAlive } = {}) {
  if (journal == null) return { state: 'none' }
  if (journal.corrupt) return { state: 'corrupt' }
  if (typeof journal.exitCode === 'number') return { state: 'finished', exitCode: journal.exitCode }
  const alive = isAlive ? isAlive(journal.pid) : false
  return { state: alive ? 'live' : 'stale', pid: journal.pid, step: journal.step }
}

/**
 * The stale-base EARLY warning (1792.5): a long-lived arc worktree learns about drift only at
 * land today, where the blocker fires after a full reconciliation is already owed (TENANTCORE:
 * 763 files). From 40% of the ceiling this warns with the exact mid-arc merge checkpoint, and
 * it deliberately goes SILENT at/above the ceiling — there the land-time blocker owns the case
 * and a second voice would just dilute it. Pure; the caller supplies the ref.
 */
export function staleBaseWarning(behindCount, ceiling, baseRef) {
  if (!Number.isFinite(behindCount) || !Number.isFinite(ceiling) || ceiling <= 0) return null
  if (behindCount >= ceiling) return null // the blocker's territory
  const ratio = behindCount / ceiling
  if (ratio < 0.4) return null // compared BEFORE rounding: 39.6% must stay silent, not round into the band
  const pct = Math.round(ratio * 100)
  return {
    behind: behindCount,
    ceiling,
    pct,
    message: `arc base is ${behindCount} commits behind (${pct}% of the ${ceiling} stale ceiling) — checkpoint now with \`git merge origin/${baseRef}\` rather than reconciling the whole drift at land`,
  }
}

/** Evaluate every blocker against the state; return the held list ({ id, name, reason }). */
export function evaluateBlockers(state) {
  return BLOCKERS.map((b) => ({ id: b.id, name: b.name, reason: b.check(state) })).filter((x) => x.reason)
}

// ─────────────────────────────────────────────────────────────────────────────
// HALF 2 (1657.5) — the git ACTS: arc-end suite, landing mechanics, the
// structurally-impossible forbidden push, the RunnerSummary, exits 0/3/2.
// ─────────────────────────────────────────────────────────────────────────────
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolveSlot, resolveImpactedOrFallback, runSlot } from './slots.mjs'
import { sweepOrphanCapbuildUnits } from './orphan-sweep.mjs'
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
export async function runArcEndSuite({ config, cwd, includeE2e = false, mode = 'full', range = null, sweepOrphans = sweepOrphanCapbuildUnits }) {
  // A prior engine run reaped mid-suite leaves its capbuild unit running ownerless;
  // launching this suite beside it duplicates a full tier (see orphan-sweep.mjs).
  sweepOrphans()
  const wanted = ['unit', 'integration', ...(includeE2e ? ['e2e'] : [])]
  const results = []
  let anyRan = false
  let anyRed = false
  for (const slot of wanted) {
    // 'impacted' mode scopes unit/integration to the arc's commit range via the impacted
    // slot (byte-identical full fallback when unbound); e2e has no impacted variant, so it
    // ALWAYS resolves its full slot.
    const resolved =
      mode === 'impacted' && (slot === 'unit' || slot === 'integration')
        ? resolveImpactedOrFallback(config, slot, range)
        : resolveSlot(config, slot)
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
    results.push({ slot, exitCode: run.exitCode, durationMs: run.durationMs, ...(run.note ? { note: run.note } : {}) })
  }
  const note = !anyRan ? 'no runtime suite ran (every arc-end slot is declared none — docs-only arc)' : undefined
  return { slots: results, suiteGreen: !anyRed, ran: anyRan, mode, range, ...(note ? { note } : {}) }
}

/**
 * Derive the arc's own commit range `<sha>..HEAD` for the impacted arc-end suite (decision
 * 5): derivePhaseStartSha per member (a GitScanError — no matching commit / git failure —
 * SKIPS that member, never guesses), then pick the DEEPEST start (the most commits to HEAD,
 * so the range covers every member's work). Zero derivable shas ⇒ null (the caller then
 * falls back to a genuine full suite — never a fabricated range). The consumer's impacted
 * runner is itself fail-toward-full, so even a too-wide range degrades safe.
 */
/**
 * Derive the arc's OWN file scope for the impacted arc-end suite — the sharper form of
 * deriveArcSuiteRange. A contiguous `<start>..HEAD` range on a SHARED base branch sweeps
 * in sibling sessions' commits (work their own arcs already gated and landed), so the
 * impacted selector balloons toward the full tier for an arc whose own diff is tiny.
 * This derivation instead subject-scans the arc's member commits (`phase <N> —`, the
 * same grammar derivePhaseStartSha anchors on), unions the files THOSE commits touched,
 * and writes the list to a temp manifest. The caller passes `@<manifest>` through the
 * impacted slot's `{range}` template — the consumer's runner dispatches on the leading
 * `@` (files-from) vs a git range. Conservative by construction: zero member commits or
 * any git failure ⇒ null (the caller falls back to the contiguous range, then to full);
 * the consumer's selector remains fail-toward-full on whatever it is handed.
 */
export function deriveArcSuiteScope(worktree, memberNums, exec = defaultExec) {
  // Per-member server-side --grep narrows the scan (an unfiltered full-history log
  // overruns the exec buffer on a real repo), then a client-side SUBJECT-only check
  // confirms each hit: git's --grep searches the whole message, so a foreign commit
  // merely MENTIONING "phase N" in its body would otherwise leak into the scope. The
  // number boundary — not the em-dash derivePhaseStartSha anchors on — catches every
  // member commit grammar ("phase N task N.X —", "fix: phase N gate RX", "mark phase N
  // complete") while still refusing 136-inside-1369.
  const shas = new Set()
  for (const n of memberNums) {
    const r = exec('git', ['-C', worktree, 'log', `--grep=phase ${n}`, '--format=%H%x09%s'])
    if (r.status !== 0) return null // scan unavailable ⇒ no scope (conservative)
    const re = new RegExp(`(?:^|[^0-9])phase ${n}(?:[^0-9]|$)`)
    for (const line of r.stdout.split('\n')) {
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      if (re.test(line.slice(tab + 1))) shas.add(line.slice(0, tab))
    }
  }
  if (shas.size === 0) return null
  const files = new Set()
  for (const sha of shas) {
    const r = exec('git', ['-C', worktree, 'show', '--name-only', '--format=', sha])
    if (r.status !== 0) return null // cannot enumerate a member commit ⇒ no scope
    for (const f of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) files.add(f)
  }
  const first = shas.values().next().value
  const manifest = join(tmpdir(), `roadmap-arc-scope-${process.pid}-${first.slice(0, 8)}.txt`)
  writeFileSync(manifest, [...files].sort().join('\n') + '\n')
  return { filesFrom: manifest, fileCount: files.size, commitCount: shas.size }
}

export function deriveArcSuiteRange(worktree, memberNums, exec = defaultExec) {
  const shas = []
  for (const n of memberNums) {
    try {
      shas.push(derivePhaseStartSha(worktree, n))
    } catch (e) {
      if (e instanceof GitScanError) continue
      throw e
    }
  }
  let best = null
  let bestCount = -1
  for (const sha of shas) {
    const r = exec('git', ['-C', worktree, 'rev-list', '--count', `${sha}..HEAD`])
    if (r.status !== 0) continue // probe unavailable ⇒ skip this candidate (conservative)
    const c = parseInt(r.stdout.trim(), 10)
    if (Number.isFinite(c) && c > bestCount) {
      bestCount = c
      best = sha
    }
  }
  return best === null ? null : `${best}..HEAD`
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
  // Align with runDebtCensus's exemption (derive.mjs:96): limitations are release-sweep's
  // (reported via openLimitations, never budgeted OR sweep-signaled — D10 / census fix 171848e).
  const openCount =
    state.censusEntries === null
      ? null
      : state.censusEntries.filter((e) => e.state === 'OPEN' && e.field !== 'limitations').length
  const arcSweepClean = openCount === 0 // null census stays fail-closed: null !== 0 ⇒ false
  const validateArcPassed = state.hasCriteria ? state.verdict?.verdict === 'PASS' : true
  // An impacted-scope arc-end run NEVER claims a full green (decision 6): fullSuiteGreen is
  // true only when a genuinely-full suite ran green. When impacted, the honest deferral is
  // named in the top-level reason (RunnerSummaryShape.reason — the ANYPLAN precedent shape).
  const ranImpacted = state.suiteMode === 'impacted'
  const summary = {
    arcId: state.arcId,
    outcome: 'shipped',
    compromiseDisposition: [],
    gateSignals: { arcSweepClean, validateArcPassed, fullSuiteGreen: suiteGreen === true && !ranImpacted },
    receiptRef: 'none', // honest sentinel — no consumer governance-receipt surface
  }
  if (ranImpacted) {
    summary.reason =
      `arc-end suite ran IMPACTED scope only (${state.suiteRange}) — impacted slots green; `
      + 'full-suite backstop = ci-pr-gate per PR + nightly (testCadence.backstop)'
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
/** Liveness probe for a recorded pid — signal 0 never delivers, it only asks. */
export function pidAlive(pid) {
  if (typeof pid !== 'number') return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM' // alive but foreign-owned
  }
}

/**
 * Self-daemonize the landing run (1792.4): re-exec THIS CLI with the same flags minus --detach,
 * detached + own session (setsid semantics via detached:true) with output appended to the journal
 * log, so a session event that reaps the parent leaves the land running. The child records its own
 * pid/step/exitCode in the journal, which is how the next session resumes instead of duplicating.
 */
function spawnDetachedLand(arcId, rest, journalHome) {
  const logPath = join(journalHome, '.building', `${arcId}-land.log`)
  mkdirSync(dirname(logPath), { recursive: true })
  const out = openSync(logPath, 'a')
  const args = [process.argv[1], 'arc', 'land', ...rest.filter((a) => a !== '--detach')]
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ZEROH_LAND_DETACHED: '1', ZEROH_LAND_JOURNAL_HOME: journalHome },
  })
  child.unref()
  writeLandJournal(journalHome, arcId, { pid: child.pid, startedAt: new Date().toISOString(), step: 'starting', exitCode: null })
  process.stdout.write(
    `roadmap arc land: detached (pid ${child.pid}) — journal ${landJournalPath(journalHome, arcId)}, log ${logPath}. Re-run \`roadmap arc land ${arcId}\` (or \`arc next\`) to read its outcome.\n`,
  )
  return 0
}

export async function landCommand(rest) {
  const json = rest.includes('--json')
  const flags = { push: rest.includes('--push'), noPush: rest.includes('--no-push'), hold: rest.includes('--hold'), forceStale: rest.includes('--force-stale'), detach: rest.includes('--detach') }
  const arcId = rest.find((a) => !a.startsWith('--'))
  if (!arcId) {
    process.stderr.write('usage: roadmap arc land <arcId> [--push|--no-push|--hold|--force-stale|--detach] [--json]\n')
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
  // Detached-land coordination (1792.4). A landing run is long and session events reap plain
  // background shells, so the journal is the ONE place a run's liveness lives: a LIVE run is
  // never duplicated (a second arc-end suite beside a running one is the orphan-capbuild class
  // f57c6bc guards at the suite level — this guards the whole land), a FINISHED run is reported
  // and cleared, and a STALE journal (dead pid, no exit code — the reaped case) is named.
  const detachHome = process.env.ZEROH_LAND_JOURNAL_HOME ?? toplevel
  if (!process.env.ZEROH_LAND_DETACHED) {
    const verdict = classifyLandJournal(readLandJournal(detachHome, arcId), { isAlive: pidAlive })
    if (verdict.state === 'live') {
      process.stdout.write(
        `roadmap arc land: a detached land for ${arcId} is already running (pid ${verdict.pid}, step: ${verdict.step ?? 'starting'}) — journal ${landJournalPath(detachHome, arcId)}; not starting a duplicate\n`,
      )
      return 3
    }
    if (verdict.state === 'finished') {
      const p = landJournalPath(detachHome, arcId)
      process.stdout.write(`roadmap arc land: a detached land for ${arcId} finished with exit ${verdict.exitCode} (journal ${p})\n`)
      if (verdict.exitCode === 0) {
        try { rmSync(p) } catch { /* leaving a read journal behind is harmless */ }
        return 0
      }
      // A red detached run does NOT block a retry — clear it and fall through to run here.
      try { rmSync(p) } catch { /* ignore */ }
    }
    if (verdict.state === 'stale') {
      process.stdout.write(
        `roadmap arc land: a previous detached land for ${arcId} died without recording an exit (pid ${verdict.pid}, step: ${verdict.step ?? 'unknown'}) — stale journal cleared, running now\n`,
      )
      try { rmSync(landJournalPath(detachHome, arcId)) } catch { /* ignore */ }
    }
    if (verdict.state === 'corrupt') {
      process.stdout.write(`roadmap arc land: the ${arcId} land journal will not parse — replacing it with this run's state\n`)
    }
    if (flags.detach) return spawnDetachedLand(arcId, rest, detachHome)
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
  // Direct-only guard (decision 4): the impacted scope is honored ONLY for the direct
  // integration model (the code is already integrated on baseRef, the suite is fix-forward).
  // An isolated-branch landing ALWAYS runs the full suite regardless of config — there the
  // suite genuinely gates the merge. A null derivable range ⇒ a genuine full run (never a
  // guessed range).
  const suiteMode = state.integrationModel === 'direct' ? (mp.arcEndSuite ?? 'full') : 'full'
  let effectiveMode = suiteMode
  let suiteRange = null
  if (suiteMode === 'impacted') {
    const wt = state.sidecar?.worktree ?? toplevel
    // Prefer the arc's OWN file scope (subject-matched member commits → `@manifest`);
    // a shared-base contiguous range re-tests sibling arcs' already-gated work. Fall back
    // to the contiguous range, then to a genuine full run — never a guessed scope.
    const scope = deriveArcSuiteScope(wt, state.members.map((m) => m.num))
    if (scope !== null) {
      suiteRange = `@${scope.filesFrom}`
      state.suiteScope = { fileCount: scope.fileCount, commitCount: scope.commitCount }
    } else {
      suiteRange = deriveArcSuiteRange(wt, state.members.map((m) => m.num))
      if (suiteRange === null) effectiveMode = 'full'
    }
  }
  if (process.env.ZEROH_LAND_DETACHED) writeLandJournal(detachHome, arcId, { step: 'arc-end suite' })
  const suite = await runArcEndSuite({ config: cfg, cwd: state.sidecar?.worktree ?? toplevel, includeE2e, mode: effectiveMode, range: suiteRange })
  state.suiteGreen = suite.suiteGreen
  state.suiteMode = effectiveMode
  state.suiteRange = suiteRange
  const held = evaluateBlockers(state)
  if (held.length) {
    emit({ action: 'blocked', arcId, held, suite, suiteMode: effectiveMode, suiteRange, ...(staleBase ? { staleBase } : {}) })
    if (process.env.ZEROH_LAND_DETACHED) writeLandJournal(detachHome, arcId, { step: 'blocked', exitCode: 2 })
    return 2
  }
  if (process.env.ZEROH_LAND_DETACHED) writeLandJournal(detachHome, arcId, { step: 'merge + push' })

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
  emit({ action: res.outcome, arcId, ...res, suite, suiteMode: effectiveMode, suiteRange, ...(staleBase ? { staleBase } : {}) })
  if (process.env.ZEROH_LAND_DETACHED) writeLandJournal(detachHome, arcId, { step: res.outcome, exitCode: res.exitCode })
  return res.exitCode
}
