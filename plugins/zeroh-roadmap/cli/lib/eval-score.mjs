/**
 * eval-score — the DETERMINISTIC dimensions, the actor attribution and the rolling-baseline
 * RATCHET (arc EVALCORE, 1996.3). One scoring implementation, consumed by the CLI command,
 * the trend page, do-arc's post-land step AND the backfill: a second copy would let two
 * readers disagree about what an arc scored.
 *
 * ## The ownership split is structural, not stylistic
 * Three dimensions are computable from recorded artifacts and are scored HERE
 * (code-confidence, verified-vs-intent, speed). Four are rubric judgements no arithmetic can
 * stand in for (standards-adherence, doc-brevity, composability-testability, plan-quality);
 * they are emitted with `owner: 'judge'` and the `pending-judge` sentinel, carrying their
 * deterministic FEEDER signals so the judge reads numbers instead of re-deriving them. The
 * scorer never fakes a judge value; the judge never recomputes a deterministic one.
 *
 * ## A missing input is a NAMED sentinel, never a zero
 * A zero score reads as a real, terrible arc — it would drag a rolling baseline down and
 * manufacture regressions out of absent data. Every missing-input path here produces a
 * sentinel from the closed vocabulary and NO score, and the ratchet excludes a sentinelled
 * dimension from the baseline rather than zeroing it in.
 *
 * ## Why the weights are constants and not configuration
 * The penalties below are the scoring MODEL. Making them configurable would make two
 * reports from two machines incomparable, which is the one thing a ratchet cannot survive.
 * They are named, documented, and changed deliberately — a change is a baseline reset.
 */

/** The CLOSED seven, in contract order. Mirrors EvalDimensionKeyShape. */
export const DIMENSION_KEYS = [
  'code-confidence',
  'verified-vs-intent',
  'standards-adherence',
  'doc-brevity',
  'composability-testability',
  'speed',
  'plan-quality',
]

/** The rubric dimensions no arithmetic can stand in for. Mirrors JUDGE_OWNED_DIMENSION_KEYS,
 *  whose contract home is templates/schema.ts (the coverage a judge verdict must satisfy). */
export const JUDGE_DIMENSIONS = new Set([
  'standards-adherence',
  'doc-brevity',
  'composability-testability',
  'plan-quality',
])

/** Below this many comparable priors there is no baseline — one prior is an anecdote. */
export const MIN_COMPARABLE_PRIORS = 2

/**
 * The two judge-owned sentinels, and the difference between them is a PROMISE.
 *
 * `pending-judge` says a pass is still coming — a reader is right to wait for it, and
 * merge-judge is the seam that resolves it. `unjudged-backfill` is TERMINAL: over a historical
 * arc the promise would be false, because its diffs predate the rubric and no judge will ever
 * read them. Scoring those arcs now would manufacture the very baseline the first honestly
 * judged arc gets measured against, so the backfill declines to and says so permanently.
 *
 * Both are score-less, so `computeRatchet` already excludes either from a baseline; the naming
 * is what stops a later reader from mistaking a closed book for an open one.
 */
export const PENDING_JUDGE_SENTINEL = 'pending-judge'
export const BACKFILL_SENTINEL = 'unjudged-backfill'

/**
 * The speed reference class: minutes of halt-free wall clock per completed task. A use-site
 * default in the DEFAULT_STALE_BASE_CEILING mould — an absolute speed score needs SOME
 * reference, and on the first run there is no timing-stats table to supply one. The raw
 * elapsed and halt-adjusted figures ride in `signals` either way, so a reader who disagrees
 * with the reference can re-derive their own view without re-running anything.
 */
export const SPEED_REFERENCE_MINUTES_PER_TASK = 45

/**
 * The reference-class bands a planner reads. Task count is the only size axis the record
 * reliably carries across ~1,900 historical phases, and the top band is open-ended so a
 * forty-task phase lands somewhere instead of falling out of the table.
 */
export const TASK_COUNT_BANDS = [
  { label: '1-3', max: 3 },
  { label: '4-6', max: 6 },
  { label: '7+', max: Infinity },
]

/**
 * The surface axis, decided from a phase's keyFiles. This is a HEURISTIC — a path guess,
 * not a declared fact — which is why it is a named export and why computeTimingStats says
 * so in its notes rather than presenting the split as ground truth. No `g` flag: a stateful
 * regex would return false on every second identical call and silently flip half the phases
 * out of the surface cohort.
 */
export const SURFACE_PATH_RE = /(^|\/)(web|office|spa)\//

/** Points lost per gate round beyond the first — rework is the cost the round count measures. */
const GATE_ROUND_PENALTY = 12
/** Points lost per escape fix per phase — a defect that reached the base branch costs more
 *  than one caught at the gate, which is why this weight is the heaviest. */
const ESCAPE_FIX_PENALTY = 25
/** Points lost when gate runs did not END clean — the reviewer TRAJECTORY, not the count. */
const UNCLEAN_FINAL_ROUND_PENALTY = 20

/** Evidence tiers rank by how close the check ran to the real thing. */
const TIER_RANK = { wired: 1, 'live-ui': 2, 'live-host': 3 }
/** A low-confidence verdict is weaker evidence in BOTH directions, so it weighs less. */
const CONFIDENCE_WEIGHT = { high: 1, medium: 0.8, low: 0.6 }

/** The honest stand-in for an executor that did not self-report — never a guessed model id. */
export const UNRECORDED_DRIVER = { model: 'unrecorded', lane: 'session' }

const clamp = (n) => Math.min(100, Math.max(0, n))
/** One decimal: enough to see movement, few enough digits that float noise cannot fake a delta. */
const round1 = (n) => Math.round(n * 10) / 10
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const sum = (xs) => xs.reduce((a, b) => a + b, 0)

const phaseRef = (n) => `roadmap/phases/phase-${n}.phase.ts`

/** A dimension that could not be computed: the named sentinel and NO number beside it. */
const sentinelDimension = (owner, sentinel, signals, sourceRefs) => ({ owner, sentinel, signals, sourceRefs })

/**
 * Minutes between two timestamps, or null when the pair is unusable. A NEGATIVE span
 * (completedAt before startedAt) is corrupt, not fast: the metrics shape does not enforce
 * ordering, and left alone a negative span would score speed at the maximum — bad data
 * becoming the best possible number, the exact inversion of the honesty rail. Zero IS kept:
 * a single-commit phase legitimately derives both timestamps from the same commit.
 */
function spanMinutes(metrics) {
  if (!metrics?.startedAt || !metrics?.completedAt) return null
  const ms = Date.parse(metrics.completedAt) - Date.parse(metrics.startedAt)
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms / 60_000
}

/**
 * code-confidence — how much rework the code needed before it was trusted, and how much
 * escaped anyway. Three signals: the mean gate rounds per phase (rework at the gate), the
 * share of gate runs that ENDED clean (the reviewer trajectory: a first-round
 * findings-fixed followed by a clean second round is a different story from a run that
 * never converged), and post-land fixes per phase — only those whose subject names a member
 * phase, so the signal is the arc's OWN rework that escaped the gate rather than every fix
 * that later brushed a file the arc touched.
 */
function scoreCodeConfidence(trace, readable) {
  const runs = readable.flatMap((p) => p.gateRuns ?? [])
  const recorded = readable.filter((p) => typeof p.executionResult?.gateRounds === 'number')
  const sourceRefs = [
    ...readable.map((p) => phaseRef(p.phase)),
    ...readable.filter((p) => (p.gateRuns ?? []).length > 0).map((p) => `roadmap/.gate/${p.phase}/`),
  ]
  // An empty escape list counts as evidence ONLY when the scan actually ran. A failed scan
  // that reported zero would RAISE this score, turning a broken git read into a reward.
  const escapeScanRan = trace.git?.escapeScan !== 'unavailable'
  const escapeCount = trace.git?.escapeFixes?.length ?? 0
  for (const f of trace.git?.escapeFixes ?? []) sourceRefs.push(`git:${f.sha}`)

  if (recorded.length === 0 && runs.length === 0)
    return sentinelDimension(
      'deterministic',
      'no-gate-records',
      { phasesConsidered: readable.length, escapeFixes: escapeScanRan ? escapeCount : 'scan-unavailable' },
      sourceRefs.length > 0 ? sourceRefs : ['roadmap/.gate/'],
    )

  // Recorded gateRounds is the phase's own claim; the .gate run files are the corroboration.
  // Prefer the claim when present, fall back to counting correctness rounds off the runs.
  // DISTINCT round numbers, not agent entries: two reviewers recorded in one round is one
  // round of rework, and counting entries would inflate the penalty for a wider panel.
  const gateRoundsMean =
    recorded.length > 0
      ? mean(recorded.map((p) => p.executionResult.gateRounds))
      : mean(runs.map((r) => new Set(r.rounds.filter((x) => x.round >= 1).map((x) => x.round)).size))

  const runsWithRounds = runs.filter((r) => r.rounds.length > 0)
  const cleanFinal = runsWithRounds.filter((r) => r.rounds[r.rounds.length - 1].verdict === 'clean').length
  // No runs to read ⇒ no trajectory evidence ⇒ no trajectory penalty. Assuming "unclean"
  // would invent a failure; assuming "clean" would invent a success. Neither is applied.
  const trajectoryPenalty =
    runsWithRounds.length > 0 ? UNCLEAN_FINAL_ROUND_PENALTY * (1 - cleanFinal / runsWithRounds.length) : 0

  const escapesPerPhase = escapeScanRan ? escapeCount / Math.max(1, readable.length) : 0
  const score = clamp(
    100 -
      GATE_ROUND_PENALTY * Math.max(0, gateRoundsMean - 1) -
      ESCAPE_FIX_PENALTY * escapesPerPhase -
      trajectoryPenalty,
  )

  return {
    owner: 'deterministic',
    score: round1(score),
    signals: {
      gateRoundsMean: round1(gateRoundsMean),
      gateRunsObserved: runsWithRounds.length,
      finalRoundCleanRatio: runsWithRounds.length > 0 ? round1(cleanFinal / runsWithRounds.length) : 'no-runs',
      escapeFixes: escapeScanRan ? escapeCount : 'scan-unavailable',
      escapeFixesPerPhase: escapeScanRan ? round1(escapesPerPhase) : 'scan-unavailable',
      // UNSCORED, carried for inspection only: the previous unbounded count, which rose with
      // the arc's AGE. Reading it as a quality signal is the mistake the bounded window fixes.
      escapeFixesFileIntersection: trace.git?.escapeFixesFileIntersection ?? 'scan-unavailable',
      // How the window was bounded is part of reading the count above: a tip-anchored window had
      // nothing to look in at all.
      escapeWindow: trace.git?.escapeWindow ?? 'unrecorded',
      phasesConsidered: readable.length,
    },
    sourceRefs: sourceRefs.length > 0 ? sourceRefs : ['roadmap/.gate/'],
  }
}

/**
 * verified-vs-intent — did the shipped flow meet its stated intent, and how good was the
 * evidence? A met verdict driven live-host with high confidence is worth more than a met
 * verdict inferred at the wired tier, so each verdict weighs tier-rank x confidence and the
 * score is the weighted met share. Weighting the DENOMINATOR the same way is what keeps a
 * weak-evidence arc from scoring high just by asking easy questions.
 */
function scoreVerifiedVsIntent(trace) {
  if (!trace.verdicts)
    return sentinelDimension('deterministic', 'no-verdicts-file', { verdicts: 0 }, ['roadmap/arc-evals/ (no verdicts file)'])

  const verdicts = trace.verdicts.verdicts ?? []
  const ref = `roadmap/arc-evals/${trace.arcId}-${trace.verdicts.date}-verdicts.json`
  if (verdicts.length === 0)
    return sentinelDimension('deterministic', 'no-verdicts-file', { verdicts: 0 }, [ref])

  // STRICT tokens. Defaulting an unrecognised tier or confidence to a weight of 1 would score
  // a typo'd `live-host` as if it had been checked at the weakest tier, and a typo'd status as
  // a gap — a real-looking number out of unreadable evidence. An unreadable verdicts file is
  // an ABSENT verdicts file, which is what the sentinel already means.
  const unreadable = verdicts.filter(
    (v) => !(v.tierUsed in TIER_RANK) || !(v.confidence in CONFIDENCE_WEIGHT) || !['met', 'gap'].includes(v.status),
  )
  if (unreadable.length > 0)
    return sentinelDimension(
      'deterministic',
      'no-verdicts-file',
      {
        verdicts: verdicts.length,
        unreadableVerdicts: unreadable.length,
        firstUnreadable: unreadable[0].criterionId ?? 'unnamed',
      },
      [ref],
    )

  const weight = (v) => TIER_RANK[v.tierUsed] * CONFIDENCE_WEIGHT[v.confidence]
  const total = sum(verdicts.map(weight))
  const met = sum(verdicts.filter((v) => v.status === 'met').map(weight))

  const tiers = {}
  for (const v of verdicts) tiers[v.tierUsed] = (tiers[v.tierUsed] ?? 0) + 1

  return {
    owner: 'deterministic',
    score: round1(total > 0 ? (100 * met) / total : 0),
    signals: {
      verdicts: verdicts.length,
      met: verdicts.filter((v) => v.status === 'met').length,
      gaps: verdicts.filter((v) => v.status === 'gap').length,
      weightedMetShare: round1(total > 0 ? met / total : 0),
      tierDistribution: Object.entries(tiers)
        .map(([t, n]) => `${t}:${n}`)
        .sort()
        .join(' '),
      judgeModel: trace.verdicts.judgeModel ?? 'unrecorded',
    },
    sourceRefs: [ref],
  }
}

/**
 * speed — halt-adjusted minutes per completed task against the reference class. Elapsed
 * alone is dishonest on a shared box (an arc paused overnight is not a slow arc), so the
 * SCORE is driven by the halt-free phases while BOTH figures ride in the signals. When
 * every timed phase recorded a halt there is nothing halt-free left to score, so the
 * elapsed view is used and the fallback is named in the signals rather than hidden.
 */
function scoreSpeed(readable) {
  const timed = readable.filter((p) => spanMinutes(p.metrics) !== null)
  const refs = timed.map((p) => `${phaseRef(p.phase)}#metrics`)
  if (timed.length === 0)
    return sentinelDimension('deterministic', 'no-timestamps', { timedPhases: 0 }, ['roadmap/phases/ (no phase records a time axis)'])

  const elapsedMinutes = sum(timed.map((p) => spanMinutes(p.metrics)))
  const haltFree = timed.filter((p) => !(p.metrics.haltCount > 0))
  const haltAdjustedMinutes = sum(haltFree.map((p) => spanMinutes(p.metrics)))

  const basis = haltFree.length > 0 ? haltFree : timed
  const basisMinutes = haltFree.length > 0 ? haltAdjustedMinutes : elapsedMinutes
  // A phase file with no task list still represents at least one unit of work; counting it
  // as zero tasks would divide by zero and read as infinitely slow.
  const tasks = sum(basis.map((p) => Math.max(1, p.taskCount ?? 0)))
  const minutesPerTask = basisMinutes / tasks

  const score = minutesPerTask <= 0 ? 100 : clamp((100 * SPEED_REFERENCE_MINUTES_PER_TASK) / minutesPerTask)

  return {
    owner: 'deterministic',
    score: round1(score),
    signals: {
      elapsedMinutes: round1(elapsedMinutes),
      haltAdjustedMinutes: round1(haltAdjustedMinutes),
      minutesPerTask: round1(minutesPerTask),
      referenceMinutesPerTask: SPEED_REFERENCE_MINUTES_PER_TASK,
      timedPhases: timed.length,
      interruptedPhases: timed.length - haltFree.length,
      basis: haltFree.length > 0 ? 'halt-free-phases' : 'elapsed-fallback-every-phase-halted',
    },
    sourceRefs: refs,
  }
}

/**
 * The four judge-owned dimensions: the caller's `sentinel` plus the deterministic FEEDERS the
 * judge would otherwise have to re-derive by hand (and would re-derive differently). Feeders are
 * counts of things already recorded — they are inputs to a judgement, never a judgement, which
 * is why a backfill keeps every one of them and changes only which sentinel sits beside them.
 */
function judgeDimensions(trace, readable, sentinel) {
  const refs = readable.map((p) => phaseRef(p.phase))
  const results = readable.map((p) => p.executionResult).filter(Boolean)
  const reports = readable.flatMap((p) => p.transparency ?? [])
  const withMetrics = readable.filter((p) => p.metrics)
  const findingsRounds = readable
    .flatMap((p) => p.gateRuns ?? [])
    .flatMap((r) => r.rounds)
    .filter((r) => r.verdict !== 'clean').length

  const nonNone = (field) => reports.filter((r) => r[field] && r[field] !== 'None').length
  const testsAdded = sum(withMetrics.map((p) => p.metrics.testsAdded ?? 0))
  const filesChanged = sum(withMetrics.map((p) => p.metrics.filesChanged ?? 0))

  return {
    'standards-adherence': sentinelDimension(
      'judge',
      sentinel,
      {
        nonCleanReviewRounds: findingsRounds,
        compromisesRecorded: sum(results.map((r) => (r.compromises ?? []).length)),
        hardcodedRecorded: sum(results.map((r) => (r.hardcoded ?? []).length)),
        skippedRecorded: sum(results.map((r) => (r.skipped ?? []).length)),
        transparencyDebtEntries: nonNone('compromises') + nonNone('hardcoded') + nonNone('skipped'),
        sweepVerdict: trace.sweep?.overall ?? 'no-sweep-report',
      },
      refs,
    ),
    'doc-brevity': sentinelDimension(
      'judge',
      sentinel,
      {
        transparencyReports: reports.length,
        transparencyChars: sum(reports.map((r) => (r.whatWasDone ?? '').length + (r.how ?? '').length)),
        meanCharsPerReport:
          reports.length > 0
            ? round1(sum(reports.map((r) => (r.whatWasDone ?? '').length + (r.how ?? '').length)) / reports.length)
            : 0,
      },
      refs,
    ),
    'composability-testability': sentinelDimension(
      'judge',
      sentinel,
      {
        testsAdded,
        filesChanged,
        // Not a quality claim — a ratio the judge reads beside the diff. A phase that
        // changed 20 files and added 1 test looks different from the reverse.
        testsPerFileChanged: filesChanged > 0 ? round1(testsAdded / filesChanged) : 'no-files-changed-recorded',
        phasesWithMetrics: withMetrics.length,
      },
      refs,
    ),
    'plan-quality': sentinelDimension(
      'judge',
      sentinel,
      {
        escalations: results.filter((r) => r.status === 'escalated').length,
        checkpoints: results.filter((r) => r.status === 'checkpoint').length,
        hardStops: sum(results.map((r) => (r.hardStops ?? []).length)),
        surfaced: sum(results.map((r) => (r.surfaced ?? []).length)),
        haltCountTotal: sum(readable.map((p) => p.metrics?.haltCount ?? 0)),
        plannedByRecorded: readable.filter((p) => p.plannedBy).length,
      },
      refs,
    ),
  }
}

/**
 * Score a whole trace. Returns `{ dimensions, notes }` — `dimensions` carries exactly the
 * seven closed keys in contract order, `notes` names every gap a reader would otherwise
 * have to infer from a suspiciously round number.
 *
 * Phases whose record could not be read are EXCLUDED from every signal and NAMED in notes:
 * folding an unreadable phase in as zeros would invent data, and dropping it silently would
 * quietly improve every average it should have dragged down.
 */
export function scoreArcTrace(trace, { backfill = false } = {}) {
  const notes = []
  // Named in notes rather than left to be inferred from the sentinel: the sentinel says a
  // dimension is unjudged, the note says WHY it will stay that way and what it cost.
  if (backfill)
    notes.push(
      'backfill mode — the judge pass is deliberately NOT run over this historical arc (its diff predates the ' +
        'rubric), so judge-owned dimensions carry the terminal unjudged-backfill sentinel and enter no baseline',
    )
  const phases = trace.phases ?? []
  const readable = phases.filter((p) => !p.parseError)
  for (const p of phases)
    if (p.parseError) notes.push(`phase ${p.phase}: record unreadable (${p.parseError}) — excluded from every signal`)

  if (!trace.verdicts) notes.push('no verdicts file on disk — verified-vs-intent carries the no-verdicts-file sentinel')
  if (!trace.sweep) notes.push('no sweep report on disk — the standards-adherence feeder has no sweep verdict')
  if (!trace.summary) notes.push('no RunnerSummary on disk (roadmap/arc-summaries/ is gitignored by design)')
  if (!trace.git?.landedAt) notes.push('no member commits found — the land boundary and escape rate are underivable')
  // The withheld penalty makes code-confidence numerically identical to a spotless arc, and
  // that number now enters every future arc's rolling baseline. Naming it inside `signals`
  // alone is not enough: the note is what a reader actually sees.
  if (trace.git?.escapeScan === 'unavailable')
    notes.push(
      'the post-land escape scan did not run — its penalty is withheld, so code-confidence is an UPPER BOUND, not a measurement',
    )
  // On a COMMIT-anchored window an empty escape list is NOT a clean record: a phase-named
  // post-land fix is itself a member commit, so it moves the boundary it should sit behind and
  // the scored list comes back empty either way. Said out loud on every report that banks the
  // full escape credit, because the number is indistinguishable from a spotless arc and it
  // enters every future baseline. A LAND-RECORD window has no such self-defeat — its anchor is
  // a non-member artifact that no later commit can move — so there zero escapes IS a
  // measurement, and the note states what was measured instead of disclaiming it.
  if (trace.git?.escapeScan === 'complete' && (trace.git?.escapeFixes ?? []).length === 0)
    notes.push(
      trace.git.escapeWindow === 'land-record-anchored'
        ? `escape rate measured over the land-record window anchored ${trace.git.landedAt} — zero scored escapes is a ` +
          'result, not an absent measurement'
        : `zero scored escapes on a ${trace.git.escapeWindow ?? 'unrecorded'} window — the bounded rule cannot see a ` +
          'post-land fix that names a member phase (such a commit is itself a member and moves the boundary), so this ' +
          'is an UNMEASURED escape rate, not a clean one; the unscored file-intersection figure rides in signals',
    )
  // The scoring model changed, so every report says so: a reader comparing an old committed
  // report against a new one is comparing two models, and the report is the only place that
  // fact can travel.
  notes.push(
    'scoring-model reset 2026-07-28: escape attribution bounded to phase-named fix commits (user ruling); ' +
      'prior file-intersection figure retained unscored in signals',
  )

  const dimensions = {
    'code-confidence': scoreCodeConfidence(trace, readable),
    'verified-vs-intent': scoreVerifiedVsIntent(trace),
    ...judgeDimensions(trace, readable, backfill ? BACKFILL_SENTINEL : PENDING_JUDGE_SENTINEL),
    speed: scoreSpeed(readable),
  }
  // Rebuild in contract order: the report's key order IS part of the archive's readability.
  const ordered = {}
  for (const key of DIMENSION_KEYS) ordered[key] = dimensions[key]
  return { dimensions: ordered, notes }
}

/**
 * Who drove, and who reviewed. CAPTURE ONLY — no dimension is scored by actor in this arc
 * (per-actor comparison is EVALLOOP's job); recording it now is what gives that work real
 * data instead of a reconstruction from commit metadata.
 *
 * An executor that did not self-report attributes to the literal `unrecorded` model, never
 * a guess: a wrong attribution is worse than a named gap.
 */
export function assembleAttribution(trace) {
  const drivers = new Map()
  for (const p of trace.phases ?? []) {
    const d = p.executionResult?.driver ?? UNRECORDED_DRIVER
    // NUL joins the composite key because it cannot occur in either half: a printable
    // separator would let a model id that contains it collide two distinct driver rows.
    const key = `${d.model}\u0000${d.lane}`
    if (!drivers.has(key)) drivers.set(key, { model: d.model, lane: d.lane, phases: [] })
    drivers.get(key).phases.push(p.phase)
  }
  const reviewers = new Map()
  for (const p of trace.phases ?? [])
    for (const run of p.gateRuns ?? [])
      for (const r of run.rounds) reviewers.set(r.agent, (reviewers.get(r.agent) ?? 0) + 1)

  return {
    drivers: [...drivers.values()],
    reviewers: [...reviewers.entries()].map(([agent, rounds]) => ({ agent, rounds })),
  }
}

/**
 * The rolling-baseline ratchet: one row per dimension, always, so a dimension that cannot be
 * compared is a PRESENT row saying so rather than a missing row a reader could mistake for
 * "not regressed".
 *
 * COMPARABILITY has two independent rules:
 *  1. a prior contributes only where it carries a real number — a sentinelled prior is
 *     EXCLUDED from that dimension, never zeroed into the mean (zeroing would manufacture a
 *     regression out of absent data);
 *  2. for a JUDGE-owned dimension the prior must have been judged by the SAME model — a
 *     different judge is baseline-reset material. Deterministic dimensions compare across
 *     judge models freely, because no judge touched them.
 *
 * Under MIN_COMPARABLE_PRIORS the row is `no-baseline`. When the CURRENT report has no
 * number, value and delta stay null and `regression` stays false: a regression must always
 * have a computable delta, so an unfalsifiable one is not raised.
 *
 * The sample count rides the row's `note` as `samples=<n>` rather than a field, because
 * ArcEvalReportShape's strict row object would strip an extra field and the count would be
 * lost from the archive.
 */
export function computeRatchet(report, priorReports = []) {
  const rows = []
  for (const dimension of DIMENSION_KEYS) {
    const current = report?.dimensions?.[dimension]
    const value = typeof current?.score === 'number' ? current.score : null
    const judgeOwned = JUDGE_DIMENSIONS.has(dimension)

    const comparable = []
    for (const prior of priorReports ?? []) {
      const d = prior?.dimensions?.[dimension]
      if (typeof d?.score !== 'number') continue
      if (judgeOwned && (prior.judgeModel ?? null) !== (report?.judgeModel ?? null)) continue
      comparable.push(d.score)
    }

    if (comparable.length < MIN_COMPARABLE_PRIORS) {
      rows.push({ dimension, baseline: null, value, delta: null, regression: false, note: 'no-baseline' })
      continue
    }
    const baseline = round1(mean(comparable))
    if (value === null) {
      rows.push({
        dimension,
        baseline,
        value: null,
        delta: null,
        regression: false,
        note: `${current?.sentinel ?? 'no-score'} — no current value to compare (samples=${comparable.length})`,
      })
      continue
    }
    const delta = round1(value - baseline)
    rows.push({
      dimension,
      baseline,
      value,
      delta,
      regression: delta < 0,
      note: `samples=${comparable.length}`,
    })
  }
  return rows
}

/** The band a phase's task count falls in. */
const bandFor = (taskCount) => (TASK_COUNT_BANDS.find((b) => (taskCount ?? 0) <= b.max) ?? TASK_COUNT_BANDS.at(-1)).label

/** The usual middle; an even count averages the two middles rather than picking a side. */
function median(sorted) {
  const n = sorted.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The slow tail, not the maximum: the sorted value at ceil(0.8n) - 1. */
function p80(sorted) {
  if (sorted.length === 0) return 0
  return sorted[Math.ceil(0.8 * sorted.length) - 1]
}

/**
 * computeTimingStats — the reference-class table plan-phase and plan-arc cite when they
 * estimate, aggregated across EVERY report's trace. A PROJECTION: regenerated on each eval
 * run into one un-dated path, while the dated reports stay the archive.
 *
 * Elapsed time on a shared box is not effort, so a phase is EXCLUDED from the sample set —
 * and COUNTED in `interruptedExcluded` — when it recorded a halt, is missing either
 * timestamp, or could not be read at all. Excluding without counting would quietly shrink
 * the denominator and teach the estimator that work is faster than it is; the count is what
 * keeps the loss visible.
 *
 * A cohort nobody worked in is not emitted (an invented row of zeros is noise). A cohort
 * whose every phase was excluded IS emitted at zero, because that lost work is exactly what
 * a planner needs to see.
 */
export function computeTimingStats(traces, { generatedAt = new Date().toISOString() } = {}) {
  const cohorts = new Map()
  let excludedTotal = 0
  let noHaltEvidence = 0

  for (const trace of traces ?? []) {
    for (const p of trace.phases ?? []) {
      const band = bandFor(p.taskCount)
      const surface = (p.keyFiles ?? []).some((f) => SURFACE_PATH_RE.test(f))
      const key = `${band} ${surface}`
      if (!cohorts.has(key)) cohorts.set(key, { taskCountBand: band, surface, spans: [], interruptedExcluded: 0 })
      const cohort = cohorts.get(key)

      const span = spanMinutes(p.metrics)
      const halted = (p.metrics?.haltCount ?? 0) > 0
      // An ABSENT haltCount is not a zero. `?? 0` above reads "no evidence" as "ran clean", so
      // count how many spans rest on that assumption; the note below is what keeps it visible.
      if (span !== null && p.metrics?.haltCount === undefined) noHaltEvidence++
      if (p.parseError || span === null || halted) {
        cohort.interruptedExcluded++
        excludedTotal++
        continue
      }
      cohort.spans.push(span)
    }
  }

  const bandIndex = (label) => TASK_COUNT_BANDS.findIndex((x) => x.label === label)
  const ordered = [...cohorts.values()].sort(
    (a, b) => bandIndex(a.taskCountBand) - bandIndex(b.taskCountBand) || Number(a.surface) - Number(b.surface),
  )

  return {
    generatedAt,
    cohorts: ordered.map((c) => {
      const sorted = [...c.spans].sort((a, b) => a - b)
      return {
        taskCountBand: c.taskCountBand,
        surface: c.surface,
        samples: sorted.length,
        // No samples means 0, never a number carried over: the cohort exists to show its
        // exclusion count, and inventing a median for it would be the exact lie the
        // exclusion is protecting against.
        medianMinutes: round1(median(sorted)),
        p80Minutes: round1(p80(sorted)),
        interruptedExcluded: c.interruptedExcluded,
      }
    }),
    notes: [
      'the surface axis is a HEURISTIC over each phase keyFiles (web/, office/, spa/ paths), not a declared field',
      `${excludedTotal} phase(s) excluded from the samples and counted per cohort: a recorded halt, a missing timestamp, or an unreadable record`,
      'elapsed wall clock on a shared box is not effort - an interrupted phase is excluded rather than averaged in',
      `${noHaltEvidence} sampled phase(s) carry NO halt evidence - a historical backfill derives its span from commits, which survive, while the executor beacons that would evidence a halt do not; those spans are elapsed wall clock no halt count could correct`,
    ],
  }
}
