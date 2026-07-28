#!/usr/bin/env node
/**
 * eval-score.test.mjs — the deterministic SCORER and the rolling-baseline RATCHET (arc
 * EVALCORE, 1996.3). Input is a REAL trace: the shared fixture corpus
 * (cli/testdata/eval-arc/build-fixture.mjs) collected through the REAL collector, then
 * mutated IN MEMORY when a test needs one input to differ. Nothing here re-implements the
 * scoring arithmetic — a test that recomputes the formula only proves the formula equals
 * itself. What is asserted instead:
 *
 * - STRUCTURE: exactly the seven closed keys, in contract order, each with score XOR
 *   sentinel and at least one sourceRef.
 * - THE ANTI-ZERO INVARIANT (the acceptance criterion): every missing-input path yields
 *   its NAMED sentinel with `score` undefined — asserted as `!== 0` explicitly, so a
 *   future regression that zeroes a dimension instead of sentinelling it reds here
 *   rather than reading as a real, terrible arc.
 * - DIRECTION: two traces differing in ONE input move the score the right way (an extra
 *   escape fix lowers code-confidence, a closed gap raises verified-vs-intent, more
 *   minutes per task never raises speed).
 * - COMPARABILITY: a sentinel prior and a different-judge prior are EXCLUDED from a
 *   baseline rather than zeroed into a fake regression, asserted through the sample count.
 *
 * ## Ratchet sample-count convention (decided here, implement to match)
 * `computeRatchet` returns the plain `EvalRatchetRow[]` the contract declares — no second
 * return value — and each row that HAS a baseline names the count in its `note` as the
 * literal token `samples=<n>`. The count then survives `ArcEvalReportShape.parse()` into
 * the persisted archive (an extra row field would be stripped by the object shape), so a
 * human reading a year-old report can see how many priors formed the baseline. The
 * fewer-than-2 case keeps the exact note `no-baseline`, which the contract's comment pins.
 *
 * Run: node --test cli/lib/eval-score.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEvalFixture, ARC_ID } from '../testdata/eval-arc/build-fixture.mjs'
import { collectArcTrace } from './eval-collect.mjs'
import {
  scoreArcTrace,
  assembleAttribution,
  computeRatchet,
  computeTimingStats,
  DIMENSION_KEYS,
  SPEED_REFERENCE_MINUTES_PER_TASK,
  MIN_COMPARABLE_PRIORS,
  TASK_COUNT_BANDS,
  SURFACE_PATH_RE,
} from './eval-score.mjs'

/** The contract's key order, restated ONCE here so a reorder upstream is a visible diff. */
const EXPECTED_KEYS = [
  'code-confidence',
  'verified-vs-intent',
  'standards-adherence',
  'doc-brevity',
  'composability-testability',
  'speed',
  'plan-quality',
]
const DETERMINISTIC_KEYS = ['code-confidence', 'verified-vs-intent', 'speed']
const JUDGE_KEYS = ['standards-adherence', 'doc-brevity', 'composability-testability', 'plan-quality']

// ── fixture + trace memos ─────────────────────────────────────────────────────────────
// Fixture roots are expensive (a git script + tsx bridge reads) and collection spawns tsx,
// so both are built once per variant; every caller gets a structuredClone so a test that
// mutates its trace cannot leak that mutation into the next test's "unchanged" baseline.
const fixtureMemo = new Map()
const fixture = (opts = {}) => {
  const key = JSON.stringify(opts)
  if (!fixtureMemo.has(key)) fixtureMemo.set(key, buildEvalFixture(opts))
  return fixtureMemo.get(key)
}

const traceMemo = new Map()
const traceFor = (opts = {}) => {
  const key = JSON.stringify(opts)
  if (!traceMemo.has(key)) traceMemo.set(key, collectArcTrace(fixture(opts), ARC_ID).trace)
  return structuredClone(traceMemo.get(key))
}

const byNum = (trace, n) => trace.phases.find((p) => p.phase === n)

/** Every structural invariant the contract enforces, applied to a whole dimensions record. */
function assertDimensionsWellFormed(dimensions, label) {
  assert.deepEqual(Object.keys(dimensions), EXPECTED_KEYS, `${label}: exactly the seven closed keys, in contract order`)
  for (const key of EXPECTED_KEYS) {
    const d = dimensions[key]
    assert.ok(d, `${label}: ${key} present`)
    assert.ok(['deterministic', 'judge'].includes(d.owner), `${label}: ${key} owner is a contract value`)
    assert.equal(
      (d.score === undefined) !== (d.sentinel === undefined),
      true,
      `${label}: ${key} carries EXACTLY one of score / sentinel (got score=${d.score} sentinel=${d.sentinel})`,
    )
    if (d.score !== undefined) {
      assert.equal(typeof d.score, 'number', `${label}: ${key} score is a number`)
      assert.ok(Number.isFinite(d.score), `${label}: ${key} score is finite`)
      assert.ok(d.score >= 0 && d.score <= 100, `${label}: ${key} score within 0..100, got ${d.score}`)
    }
    assert.ok(Array.isArray(d.sourceRefs) && d.sourceRefs.length >= 1, `${label}: ${key} names at least one sourceRef`)
    for (const ref of d.sourceRefs) assert.ok(typeof ref === 'string' && ref.length > 0, `${label}: ${key} sourceRef non-empty`)
    assert.equal(typeof d.signals, 'object', `${label}: ${key} carries a signals record`)
  }
}

/** The anti-zero assertion, in one place: a named sentinel and NO number standing in for it. */
function assertSentinel(dimensions, key, sentinel) {
  const d = dimensions[key]
  assert.equal(d.sentinel, sentinel, `${key} must carry the named sentinel '${sentinel}'`)
  assert.equal(d.score, undefined, `${key} must have NO score beside its sentinel`)
  assert.notEqual(d.score, 0, `${key} must sentinel, never zero — a zero reads as a real, terrible arc`)
}

const isScored = (dimensions, key) => typeof dimensions[key].score === 'number' && dimensions[key].sentinel === undefined

// ── synthetic reports for the ratchet ─────────────────────────────────────────────────
const ownerOf = (key) => (JUDGE_KEYS.includes(key) ? 'judge' : 'deterministic')

/** `per` values: a number is a score, a string is that sentinel. `all` fills the rest. */
function mkReport({ all = 60, per = {}, judgeModel, date = '2026-07-01' } = {}) {
  const dimensions = {}
  for (const key of DIMENSION_KEYS) {
    const v = Object.prototype.hasOwnProperty.call(per, key) ? per[key] : all
    dimensions[key] =
      typeof v === 'number'
        ? { owner: ownerOf(key), score: v, signals: { synthetic: v }, sourceRefs: ['synthetic-prior'] }
        : { owner: ownerOf(key), sentinel: v, signals: {}, sourceRefs: ['synthetic-prior'] }
  }
  return { arcId: ARC_ID, date, judgeModel, dimensions, ratchet: [], attribution: { drivers: [], reviewers: [] }, notes: [] }
}

const rowOf = (rows, key) => rows.find((r) => r.dimension === key)

/** The chosen convention: the baseline sample count rides the row's `note` as `samples=<n>`. */
function samplesFromNote(row) {
  assert.equal(typeof row.note, 'string', `${row.dimension}: a row with a baseline must carry a note`)
  const m = row.note.match(/samples=(\d+)/)
  assert.ok(m, `${row.dimension}: the note must name the baseline sample count as samples=<n>; got ${JSON.stringify(row.note)}`)
  return Number(m[1])
}

// ── 0. the exported vocabulary ────────────────────────────────────────────────────────
test('DIMENSION_KEYS is the closed seven in contract order; MIN_COMPARABLE_PRIORS is 2', () => {
  assert.deepEqual([...DIMENSION_KEYS], EXPECTED_KEYS)
  assert.equal(MIN_COMPARABLE_PRIORS, 2)
  assert.equal(typeof SPEED_REFERENCE_MINUTES_PER_TASK, 'number')
  assert.ok(SPEED_REFERENCE_MINUTES_PER_TASK > 0, 'a reference of zero would make every speed score degenerate')
})

// ── 1. the deterministic three ────────────────────────────────────────────────────────
test('scoreArcTrace — the fully-recorded fixture scores all three deterministic dimensions, sentinel-free', () => {
  const { dimensions, notes } = scoreArcTrace(traceFor())
  assertDimensionsWellFormed(dimensions, 'fixture')
  assert.ok(Array.isArray(notes), 'notes is always an array, even when there is nothing to name')

  for (const key of DETERMINISTIC_KEYS) {
    const d = dimensions[key]
    assert.equal(d.owner, 'deterministic', `${key} is deterministic-owned`)
    assert.equal(d.sentinel, undefined, `${key} has every input it needs in this fixture — no sentinel`)
    assert.equal(typeof d.score, 'number', `${key} scores a real number`)
    assert.ok(Object.keys(d.signals).length > 0, `${key} shows the raw inputs behind its score`)
    assert.ok(d.sourceRefs.length >= 1, `${key} names the artifact its signals came from`)
  }
})

// ── 2. the judge four ─────────────────────────────────────────────────────────────────
test('scoreArcTrace — the four judge dimensions are pending-judge with their FEEDERS precomputed', () => {
  const { dimensions } = scoreArcTrace(traceFor())
  for (const key of JUDGE_KEYS) {
    const d = dimensions[key]
    assert.equal(d.owner, 'judge', `${key} is judge-owned`)
    assert.equal(d.sentinel, 'pending-judge', `${key} awaits the judge pass`)
    assert.equal(d.score, undefined, `${key} must not carry a scorer-invented number`)
    assert.notEqual(d.score, 0, `${key} must not zero itself while waiting for the judge`)
    assert.ok(
      Object.keys(d.signals).length > 0,
      `${key}: the deterministic FEEDERS must be precomputed — an empty signals record hands the judge nothing to judge`,
    )
    assert.ok(d.sourceRefs.length >= 1, `${key} names where its feeders came from`)
  }
})

// ── 3. absence: the verdicts file ─────────────────────────────────────────────────────
test('scoreArcTrace — no verdicts file flips ONLY verified-vs-intent, to no-verdicts-file', () => {
  const { dimensions } = scoreArcTrace(traceFor({ omitVerdicts: true }))
  assertDimensionsWellFormed(dimensions, 'omitVerdicts')
  assertSentinel(dimensions, 'verified-vs-intent', 'no-verdicts-file')
  assert.ok(isScored(dimensions, 'code-confidence'), 'code-confidence does not read the verdicts file')
  assert.ok(isScored(dimensions, 'speed'), 'speed does not read the verdicts file')
  for (const key of JUDGE_KEYS) assert.equal(dimensions[key].sentinel, 'pending-judge', `${key} is untouched`)
})

test('scoreArcTrace — dropping verdicts is SURGICAL: the other six dimensions are byte-identical', () => {
  // Same collected trace, one field removed in memory — so the ONLY difference between the
  // two runs is the verdicts input (two fixture ROOTS would also differ in their git shas).
  const base = traceFor()
  const without = traceFor()
  delete without.verdicts
  const a = scoreArcTrace(base).dimensions
  const b = scoreArcTrace(without).dimensions

  assert.notDeepEqual(a['verified-vs-intent'], b['verified-vs-intent'], 'the dimension that reads verdicts must change')
  assert.equal(b['verified-vs-intent'].sentinel, 'no-verdicts-file')
  for (const key of EXPECTED_KEYS) {
    if (key === 'verified-vs-intent') continue
    assert.deepEqual(b[key], a[key], `${key} must not move when an artifact it does not read disappears`)
  }
})

// ── 4. absence: timestamps ────────────────────────────────────────────────────────────
test('scoreArcTrace — no phase metrics flips ONLY speed, to no-timestamps with score undefined', () => {
  const trace = traceFor()
  for (const p of trace.phases) delete p.metrics
  const { dimensions } = scoreArcTrace(trace)
  assertDimensionsWellFormed(dimensions, 'no-metrics')
  assertSentinel(dimensions, 'speed', 'no-timestamps')
  assert.ok(isScored(dimensions, 'code-confidence'), 'gate records still score code-confidence')
  assert.ok(isScored(dimensions, 'verified-vs-intent'), 'the verdicts file still scores verified-vs-intent')
  for (const key of JUDGE_KEYS) assert.equal(dimensions[key].sentinel, 'pending-judge', `${key} is untouched`)
})

test('scoreArcTrace — a HALF-timed phase pair still scores speed: only ZERO usable pairs sentinel', () => {
  const trace = traceFor()
  delete byNum(trace, 9002).metrics.completedAt
  const { dimensions } = scoreArcTrace(trace)
  assert.equal(dimensions.speed.sentinel, undefined, 'one phase with both timestamps is enough evidence to score')
  assert.equal(typeof dimensions.speed.score, 'number')
})

// ── 5. absence: gate records ──────────────────────────────────────────────────────────
test('scoreArcTrace — no gate runs AND no recorded gateRounds flips ONLY code-confidence', () => {
  const trace = traceFor()
  for (const p of trace.phases) {
    p.gateRuns = []
    if (p.executionResult) delete p.executionResult.gateRounds
  }
  const { dimensions } = scoreArcTrace(trace)
  assertDimensionsWellFormed(dimensions, 'no-gates')
  assertSentinel(dimensions, 'code-confidence', 'no-gate-records')
  assert.ok(isScored(dimensions, 'verified-vs-intent'))
  assert.ok(isScored(dimensions, 'speed'))
  for (const key of JUDGE_KEYS) assert.equal(dimensions[key].sentinel, 'pending-judge', `${key} is untouched`)
})

test('scoreArcTrace — recorded gateRounds ALONE (no .gate run files) still scores code-confidence', () => {
  const trace = traceFor()
  for (const p of trace.phases) p.gateRuns = []
  const { dimensions } = scoreArcTrace(trace)
  assert.equal(dimensions['code-confidence'].sentinel, undefined, 'executionResult.gateRounds is gate evidence too')
  assert.equal(typeof dimensions['code-confidence'].score, 'number')
})

// ── 6. speed signals: elapsed AND halt-adjusted ───────────────────────────────────────
test('scoreArcTrace — speed.signals reports BOTH elapsed and halt-adjusted minutes (elapsed alone is dishonest)', () => {
  const { dimensions } = scoreArcTrace(traceFor())
  const s = dimensions.speed.signals
  assert.equal(typeof s.elapsedMinutes, 'number', 'speed.signals.elapsedMinutes')
  assert.equal(typeof s.haltAdjustedMinutes, 'number', 'speed.signals.haltAdjustedMinutes')
  assert.ok(s.elapsedMinutes > 0, 'the fixture arc took real time')
  // Fixture phase 9002 records haltCount 2: the discount MUST be visible, or the halt
  // record is being collected and then thrown away.
  assert.equal(byNum(traceFor(), 9002).metrics.haltCount, 2, 'fixture precondition: the interrupted phase')
  assert.notEqual(s.haltAdjustedMinutes, s.elapsedMinutes, 'a recorded halt must move the halt-adjusted figure')
  assert.ok(s.haltAdjustedMinutes < s.elapsedMinutes, 'halts are DISCOUNTED from elapsed, not added to it')
})

// ── 7. direction: one input at a time ─────────────────────────────────────────────────
test('scoreArcTrace — an extra post-land escape fix scores code-confidence STRICTLY LOWER', () => {
  const base = scoreArcTrace(traceFor()).dimensions['code-confidence']
  const worse = traceFor()
  worse.git.escapeFixes.push({ sha: 'deadbee0000', subject: 'fix(x): a second escape', files: 2 })
  const after = scoreArcTrace(worse).dimensions['code-confidence']

  assert.equal(base.sentinel, undefined)
  assert.equal(after.sentinel, undefined)
  assert.ok(after.score < base.score, `a second escaping fix must lower code-confidence (${base.score} → ${after.score})`)
})

test('scoreArcTrace — closing the fixture gap scores verified-vs-intent STRICTLY HIGHER', () => {
  const base = scoreArcTrace(traceFor()).dimensions['verified-vs-intent']
  const better = traceFor()
  const gap = better.verdicts.verdicts.find((v) => v.status === 'gap')
  assert.ok(gap, 'fixture precondition: one gap verdict')
  gap.status = 'met'
  delete gap.gap
  const after = scoreArcTrace(better).dimensions['verified-vs-intent']

  assert.ok(after.score > base.score, `a met criterion must beat a gap (${base.score} → ${after.score})`)
})

test('scoreArcTrace — more halt-adjusted minutes per task never scores speed higher, and 2x the reference is strictly worse', () => {
  const atReference = scoreArcTrace(withMinutesPerTask(traceFor(), SPEED_REFERENCE_MINUTES_PER_TASK)).dimensions.speed
  const twiceReference = scoreArcTrace(withMinutesPerTask(traceFor(), SPEED_REFERENCE_MINUTES_PER_TASK * 2)).dimensions.speed
  const halfReference = scoreArcTrace(withMinutesPerTask(traceFor(), SPEED_REFERENCE_MINUTES_PER_TASK / 2)).dimensions.speed

  assert.equal(atReference.sentinel, undefined)
  assert.ok(
    twiceReference.score < atReference.score,
    `twice the reference minutes per task must score strictly lower (${atReference.score} → ${twiceReference.score})`,
  )
  assert.ok(halfReference.score >= atReference.score, 'faster than the reference is never penalised')
})

/** Rewrite every phase's timing to exactly `mins` uninterrupted minutes per recorded task. */
function withMinutesPerTask(trace, mins) {
  const start = '2026-07-16T00:00:00.000Z'
  for (const p of trace.phases) {
    const tasks = Math.max(1, p.taskCount)
    p.metrics = {
      ...(p.metrics ?? {}),
      startedAt: start,
      completedAt: new Date(Date.parse(start) + mins * tasks * 60_000).toISOString(),
      haltCount: 0,
    }
  }
  return trace
}

// ── 8. the quarantined phase ──────────────────────────────────────────────────────────
test('scoreArcTrace — a quarantined phase does not throw and IS NAMED in notes', () => {
  const trace = traceFor({ malformedPhase: 9002 })
  assert.equal(typeof byNum(trace, 9002).parseError, 'string', 'fixture precondition: 9002 is quarantined')

  const { dimensions, notes } = scoreArcTrace(trace)
  assertDimensionsWellFormed(dimensions, 'malformed')
  assert.ok(
    notes.some((n) => /9002/.test(n)),
    `notes must name the phase whose record could not be read; got ${JSON.stringify(notes)}`,
  )
  assert.ok(!notes.some((n) => /\b9001\b/.test(n)), 'the healthy phase is not named as a gap')
})

// ── 9. attribution: recorded or 'unrecorded', never guessed ───────────────────────────
test('assembleAttribution — a recorded driver travels; an unrecorded one is the literal unrecorded/session', () => {
  const { drivers, reviewers } = assembleAttribution(traceFor())

  const recorded = drivers.find((d) => d.model === 'claude-opus-5')
  assert.ok(recorded, `phase 9001's recorded driver must appear; got ${JSON.stringify(drivers)}`)
  assert.equal(recorded.lane, 'session')
  assert.deepEqual(recorded.phases, [9001])

  const unrecorded = drivers.find((d) => d.model === 'unrecorded')
  assert.ok(unrecorded, `phase 9002 has no driver — it must land as 'unrecorded', never a guessed model id`)
  assert.equal(unrecorded.lane, 'session')
  assert.deepEqual(unrecorded.phases, [9002])

  assert.equal(drivers.length, 2, `exactly the two attribution buckets; got ${JSON.stringify(drivers)}`)
  assert.ok(
    !drivers.some((d) => d.model !== 'unrecorded' && d.phases.includes(9002)),
    'no real model id may be back-filled onto the unrecorded phase',
  )

  // 9001's gate run: quality-pass x1 + code-reviewer x2. 9002's: code-reviewer x1.
  const sorted = [...reviewers].sort((a, b) => a.agent.localeCompare(b.agent))
  assert.deepEqual(sorted, [
    { agent: 'code-reviewer', rounds: 3 },
    { agent: 'quality-pass', rounds: 1 },
  ])
})

// ── 10. the ratchet: too few comparable priors ────────────────────────────────────────
test('computeRatchet — ONE comparable prior yields a full no-baseline table, never a fake delta', () => {
  const current = mkReport({ all: 70, judgeModel: 'judge-A' })
  const rows = computeRatchet(current, [mkReport({ all: 60, judgeModel: 'judge-A' })])

  assert.deepEqual(rows.map((r) => r.dimension), EXPECTED_KEYS, 'one row per dimension, in contract order')
  for (const r of rows) {
    assert.equal(r.baseline, null, `${r.dimension}: fewer than ${MIN_COMPARABLE_PRIORS} priors ⇒ no baseline`)
    assert.equal(r.delta, null, `${r.dimension}: no baseline ⇒ no delta`)
    assert.equal(r.regression, false, `${r.dimension}: an unquantifiable regression is not a regression`)
    assert.equal(r.note, 'no-baseline', `${r.dimension}: the row carries the sentinel word in its note`)
    assert.equal(r.value, 70, `${r.dimension}: the current value is still reported`)
  }
})

test('computeRatchet — ZERO priors is the same honest no-baseline table, not a throw', () => {
  const rows = computeRatchet(mkReport({ all: 70, judgeModel: 'judge-A' }), [])
  assert.equal(rows.length, EXPECTED_KEYS.length)
  for (const r of rows) {
    assert.equal(r.baseline, null)
    assert.equal(r.regression, false)
    assert.equal(r.note, 'no-baseline')
  }
})

// ── 11. the ratchet: real baselines ───────────────────────────────────────────────────
test('computeRatchet — THREE comparable priors: a planted regression is flagged, an improvement is not', () => {
  const priors = [60, 70, 80].map((n, i) => mkReport({ all: n, judgeModel: 'judge-A', date: `2026-07-0${i + 1}` }))
  const current = mkReport({ all: 70, per: { speed: 20, 'code-confidence': 90 }, judgeModel: 'judge-A' })
  const rows = computeRatchet(current, priors)

  const slower = rowOf(rows, 'speed')
  assert.equal(slower.value, 20)
  assert.ok(slower.baseline >= 60 && slower.baseline <= 80, `the baseline is a mean of the priors; got ${slower.baseline}`)
  assert.ok(slower.delta < 0, 'a value below the baseline is a negative delta')
  assert.equal(slower.regression, true, 'a quantified drop IS the named regression')

  const faster = rowOf(rows, 'code-confidence')
  assert.ok(faster.delta > 0)
  assert.equal(faster.regression, false, 'an improvement is never a regression')

  // Exactly AT the baseline: the boundary is not a regression.
  const flat = rowOf(rows, 'doc-brevity')
  assert.equal(flat.value, 70)
  assert.equal(flat.delta, 0, 'a value equal to the mean of 60/70/80 is a zero delta')
  assert.equal(flat.regression, false, 'delta === 0 is the boundary and must NOT flag')

  // The baseline is a MEAN over the priors, not the newest prior: adding a low outlier moves it.
  const withOutlier = computeRatchet(current, [...priors, mkReport({ all: 10, judgeModel: 'judge-A', date: '2026-07-04' })])
  assert.ok(
    rowOf(withOutlier, 'speed').baseline < slower.baseline,
    'a low extra prior must drag the rolling baseline down (a last-value baseline would not move)',
  )
  assert.equal(samplesFromNote(rowOf(withOutlier, 'speed')), 4)
})

// ── 12. comparability: the two exclusion reasons, independently ───────────────────────
test('computeRatchet — a prior with a SENTINEL on a dimension is excluded from THAT dimension only', () => {
  const good = [1, 2, 3].map((i) => mkReport({ all: 60, judgeModel: 'judge-A', date: `2026-07-0${i}` }))
  const sentinelled = mkReport({ all: 60, per: { speed: 'no-timestamps' }, judgeModel: 'judge-A', date: '2026-07-04' })
  const rows = computeRatchet(mkReport({ all: 50, judgeModel: 'judge-A' }), [...good, sentinelled])

  assert.equal(samplesFromNote(rowOf(rows, 'speed')), 3, 'the sentinel prior contributes NO speed sample')
  assert.equal(samplesFromNote(rowOf(rows, 'code-confidence')), 4, 'that same prior still counts where it HAS a score')
  assert.ok(
    rowOf(rows, 'speed').baseline === rowOf(rows, 'code-confidence').baseline,
    'excluding a sentinel prior must not zero it into the mean — both baselines are 60-flat here',
  )
})

test('computeRatchet — a DIFFERENT judgeModel is excluded from judge dimensions and kept for deterministic ones', () => {
  const sameJudge = [1, 2, 3].map((i) => mkReport({ all: 60, judgeModel: 'judge-A', date: `2026-07-0${i}` }))
  const otherJudge = mkReport({ all: 90, judgeModel: 'judge-B', date: '2026-07-04' })
  const rows = computeRatchet(mkReport({ all: 50, judgeModel: 'judge-A' }), [...sameJudge, otherJudge])

  const judged = rowOf(rows, 'standards-adherence')
  assert.equal(samplesFromNote(judged), 3, 'a different judge is baseline-reset material for a JUDGE-owned dimension')
  assert.ok(judged.baseline >= 60 && judged.baseline <= 60, `the judge-B 90 must not enter the mean; got ${judged.baseline}`)

  const deterministic = rowOf(rows, 'speed')
  assert.equal(samplesFromNote(deterministic), 4, 'a deterministic dimension compares across judge models freely')
  assert.ok(deterministic.baseline > 60, 'the judge-B prior DOES raise the deterministic baseline')
})

// ── 13. a sentinel on the CURRENT report ──────────────────────────────────────────────
test('computeRatchet — a sentinel on the current dimension yields value/delta null and no regression', () => {
  const priors = [1, 2, 3].map((i) => mkReport({ all: 80, judgeModel: 'judge-A', date: `2026-07-0${i}` }))
  const current = mkReport({ all: 80, per: { speed: 'no-timestamps' }, judgeModel: 'judge-A' })
  const rows = computeRatchet(current, priors)

  const row = rowOf(rows, 'speed')
  assert.equal(row.value, null, 'there is no current number to compare')
  assert.equal(row.delta, null, 'a regression must always have a computable delta')
  assert.equal(row.regression, false, 'an unmeasured dimension is never a regression')
  assert.notEqual(row.value, 0, 'an unmeasured value must not become a zero that reads as a total collapse')
  assert.equal(typeof row.baseline, 'number', 'the baseline the priors DO support is still reported')
  assert.ok(/no-timestamps/.test(row.note ?? ''), `the note must name why the value is missing; got ${JSON.stringify(row.note)}`)

  // The healthy dimensions are unaffected by their neighbour's absence.
  const other = rowOf(rows, 'code-confidence')
  assert.equal(other.value, 80)
  assert.equal(other.regression, false)
})

// ── 14. end to end over the real trace ────────────────────────────────────────────────
test('scoreArcTrace + computeRatchet — a scorer output feeds the ratchet directly', () => {
  const scored = scoreArcTrace(traceFor())
  const rows = computeRatchet({ judgeModel: undefined, dimensions: scored.dimensions }, [])
  assert.deepEqual(rows.map((r) => r.dimension), EXPECTED_KEYS)
  for (const key of JUDGE_KEYS) {
    const row = rowOf(rows, key)
    assert.equal(row.value, null, `${key} awaits the judge — it has no value to ratchet`)
    assert.equal(row.regression, false)
  }
})

// ══ TIMING STATS (1996.4) ═════════════════════════════════════════════════════════════
// The reference-class table plan-phase cites when it estimates. The invariant that matters
// is HONESTY about what is NOT in a sample: an interrupted, half-timed or unreadable phase
// must be excluded from the minutes AND stay visible as a count, because a shared-box halt
// is not effort and folding it in would teach the estimator a lie. Nothing below restates
// the median/p80 arithmetic against itself — the spans are chosen so the expected values are
// obvious by inspection, and every other assertion is about what got in and what did not.

/** Cohort lookup by its two axes — a missing cohort returns undefined, which tests assert. */
const cohortOf = (stats, taskCountBand, surface) =>
  stats.cohorts.find((c) => c.taskCountBand === taskCountBand && c.surface === surface)

const totalSamples = (stats) => stats.cohorts.reduce((a, c) => a + c.samples, 0)
const totalExcluded = (stats) => stats.cohorts.reduce((a, c) => a + c.interruptedExcluded, 0)

// Synthetic phases: plain objects, because the timing axis reads only taskCount, keyFiles
// and metrics — dragging the fixture into the arithmetic tests would hide the spans.
let synthSeq = 0
const SYNTH_START = '2026-07-16T00:00:00.000Z'
function minutesPhase(minutes, { taskCount = 2, keyFiles = ['cli/lib/eval-score.mjs'], haltCount = 0 } = {}) {
  return {
    phase: 8000 + ++synthSeq,
    taskCount,
    keyFiles,
    metrics: {
      startedAt: SYNTH_START,
      completedAt: new Date(Date.parse(SYNTH_START) + minutes * 60_000).toISOString(),
      haltCount,
    },
  }
}
const synthTrace = (...phases) => ({ arcId: 'SYNTH', phases })
/** One phase per trace — the aggregation path, not the within-trace path. */
const spansAcrossTraces = (spans, opts) => spans.map((m) => synthTrace(minutesPhase(m, opts)))

// ── 15. the acceptance criterion: an interrupted phase leaves the sample set ───────────
test('computeTimingStats — the HALTED fixture phase is excluded from its cohort and counted, never averaged in', () => {
  const trace = traceFor()
  assert.equal(byNum(trace, 9002).metrics.haltCount, 2, 'fixture precondition: 9002 recorded halts')
  assert.equal(byNum(trace, 9001).metrics.haltCount, 0, 'fixture precondition: 9001 ran uninterrupted')
  assert.equal(byNum(trace, 9002).taskCount, 2, 'fixture precondition: 9002 is a 1-3 band phase')
  assert.equal(byNum(trace, 9001).taskCount, 4, 'fixture precondition: 9001 is a 4-6 band phase')

  const stats = computeTimingStats([trace])

  const interrupted = cohortOf(stats, '1-3', false)
  assert.ok(interrupted, `9002's cohort (band 1-3, non-surface) must be emitted; got ${JSON.stringify(stats.cohorts)}`)
  assert.equal(interrupted.interruptedExcluded, 1, 'the halted phase is counted as excluded, visibly')
  assert.equal(interrupted.samples, 0, '9002 contributed NO minutes — its 90 elapsed minutes are not a sample')
  assert.equal(interrupted.medianMinutes, 0, 'no samples ⇒ no median to invent')
  assert.equal(interrupted.p80Minutes, 0, 'no samples ⇒ no p80 to invent')

  const healthy = cohortOf(stats, '4-6', true)
  assert.ok(healthy, `9001's cohort (band 4-6, surface) must be emitted; got ${JSON.stringify(stats.cohorts)}`)
  assert.equal(healthy.samples, 1, 'the uninterrupted phase IS a sample')
  assert.equal(healthy.interruptedExcluded, 0, 'nothing was excluded from the healthy cohort')
  assert.equal(healthy.medianMinutes, 40, "9001's single 40-minute span is its own median")

  // The halted phase's 90 minutes must not have leaked into ANY cohort's numbers.
  assert.equal(totalSamples(stats), 1, 'exactly one of the two fixture phases is a timing sample')
  for (const c of stats.cohorts)
    assert.ok(c.medianMinutes !== 90 && c.p80Minutes !== 90, `the halted 90-minute span leaked into ${JSON.stringify(c)}`)
})

// ── 16. the surface axis ──────────────────────────────────────────────────────────────
test('computeTimingStats — the surface axis splits the fixture: the web/ phase is surface, the cli-only phase is not', () => {
  const stats = computeTimingStats([traceFor()])
  assert.equal(cohortOf(stats, '4-6', true)?.surface, true, '9001 carries a web/ keyFile')
  assert.equal(cohortOf(stats, '1-3', false)?.surface, false, '9002 touches no surface path')
  assert.equal(cohortOf(stats, '4-6', false), undefined, '9001 must not ALSO land in the non-surface half of its band')
  assert.equal(cohortOf(stats, '1-3', true), undefined, '9002 must not ALSO land in the surface half of its band')
})

test('SURFACE_PATH_RE — matches the SPA/pane paths, not the CLI ones, and is not lastIndex-stateful', () => {
  assert.ok(SURFACE_PATH_RE instanceof RegExp, 'the heuristic is exported as a NAMED regex, not buried in a closure')
  assert.equal(SURFACE_PATH_RE.test('web/src/panels/eval-panel.tsx'), true, 'a web/ path is a surface change')
  assert.equal(SURFACE_PATH_RE.test('cli/lib/eval-score.mjs'), false, 'a CLI library path is not a surface change')
  assert.equal(SURFACE_PATH_RE.test('office/src/taskpane.ts'), true, 'the Office pane is a surface too')
  // A /g regex would return false on the second identical call — that bug would silently
  // flip every other phase out of the surface cohort.
  assert.equal(SURFACE_PATH_RE.test('web/src/panels/eval-panel.tsx'), true, 'the same path must match twice in a row')
})

// ── 17. the other two exclusion reasons ───────────────────────────────────────────────
test('computeTimingStats — a phase MISSING a timestamp leaves the sample set and is counted', () => {
  const before = computeTimingStats([traceFor()])
  const trace = traceFor()
  delete byNum(trace, 9001).metrics.completedAt
  const after = computeTimingStats([trace])

  assert.equal(totalSamples(before), 1)
  assert.equal(totalSamples(after), 0, 'a half-timed phase has no derivable span — it cannot be a sample')
  assert.equal(totalExcluded(after), totalExcluded(before) + 1, 'and the loss is COUNTED, not silently dropped')

  const cohort = cohortOf(after, '4-6', true)
  assert.ok(cohort, 'the cohort survives with zero samples so the excluded work stays visible')
  assert.equal(cohort.samples, 0)
  assert.equal(cohort.interruptedExcluded, 1)
  assert.equal(cohort.medianMinutes, 0, 'an unsampled cohort reports 0, never a number carried over from before')
})

test('computeTimingStats — a QUARANTINED phase leaves the sample set and is counted', () => {
  const trace = traceFor({ malformedPhase: 9002 })
  assert.equal(typeof byNum(trace, 9002).parseError, 'string', 'fixture precondition: 9002 is quarantined')

  const stats = computeTimingStats([trace])
  assert.equal(totalSamples(stats), 1, 'only the readable phase is a sample')
  assert.equal(totalExcluded(stats), 1, 'an unreadable phase is an excluded phase, named in the count')
  assert.equal(cohortOf(stats, '4-6', true).samples, 1, 'the healthy phase is untouched by its neighbour')
})

// ── 18. median and p80 over known spans ───────────────────────────────────────────────
test('computeTimingStats — median and p80 over an ODD sample set of known spans', () => {
  const stats = computeTimingStats(spansAcrossTraces([30, 10, 50, 20, 40]))
  assert.equal(stats.cohorts.length, 1, 'five identically-shaped phases are ONE cohort')
  const c = stats.cohorts[0]
  assert.equal(c.samples, 5)
  assert.equal(c.interruptedExcluded, 0)
  assert.equal(c.medianMinutes, 30, 'the middle of 10/20/30/40/50, regardless of input order')
  assert.equal(c.p80Minutes, 40, 'p80 of five samples is the 4th smallest — the slow tail, not the max')
  assert.notEqual(c.p80Minutes, 50, 'p80 must not degenerate into the maximum')
  assert.ok(c.p80Minutes >= c.medianMinutes, 'p80 can never sit below the median')
})

test('computeTimingStats — an EVEN sample set averages the two middles', () => {
  const c = computeTimingStats(spansAcrossTraces([10, 20, 30, 40])).cohorts[0]
  assert.equal(c.samples, 4)
  assert.equal(c.medianMinutes, 25, 'the mean of 20 and 30 — not a lower-middle pick')
  assert.equal(c.p80Minutes, 40)
})

// ── 19. aggregation across reports ────────────────────────────────────────────────────
test('computeTimingStats — cohorts aggregate ACROSS traces: same cohort from two arcs is one row', () => {
  const stats = computeTimingStats([synthTrace(minutesPhase(20)), synthTrace(minutesPhase(60))])
  assert.equal(stats.cohorts.length, 1, `two traces feeding one cohort must not emit two rows; got ${JSON.stringify(stats.cohorts)}`)
  assert.equal(stats.cohorts[0].samples, 2, 'both traces contribute to the same reference class')
  assert.equal(stats.cohorts[0].medianMinutes, 40, 'the pooled median spans both traces')
})

// ── 20. which cohorts get emitted at all ──────────────────────────────────────────────
test('computeTimingStats — an EMPTY cohort is not invented; an all-excluded cohort IS emitted at zero', () => {
  const stats = computeTimingStats([
    synthTrace(minutesPhase(30, { taskCount: 2 })),
    synthTrace(minutesPhase(90, { taskCount: 9, keyFiles: ['web/src/app.tsx'], haltCount: 1 })),
  ])

  assert.equal(stats.cohorts.length, 2, `only the two cohorts with phases in them; got ${JSON.stringify(stats.cohorts)}`)
  assert.equal(cohortOf(stats, '4-6', true), undefined, 'a band nobody worked in is noise, not a row')
  assert.equal(cohortOf(stats, '7+', false), undefined, 'the non-surface half of the 7+ band saw no phases')

  const allExcluded = cohortOf(stats, '7+', true)
  assert.ok(allExcluded, 'a cohort whose only phase was excluded must STILL appear, or the lost work goes invisible')
  assert.equal(allExcluded.samples, 0)
  assert.equal(allExcluded.medianMinutes, 0)
  assert.equal(allExcluded.p80Minutes, 0)
  assert.equal(allExcluded.interruptedExcluded, 1)

  assert.equal(computeTimingStats([]).cohorts.length, 0, 'no traces at all ⇒ no cohorts, not a table of zeros')
})

// ── 21. the band boundaries ───────────────────────────────────────────────────────────
test('computeTimingStats — the task-count bands bite EXACTLY at 3/4 and 6/7', () => {
  assert.deepEqual(
    TASK_COUNT_BANDS.map((b) => b.label),
    ['1-3', '4-6', '7+'],
    'the ordered band table, restated here so a silent re-banding is a visible diff',
  )
  assert.equal(TASK_COUNT_BANDS[0].max, 3)
  assert.equal(TASK_COUNT_BANDS[1].max, 6)
  assert.equal(TASK_COUNT_BANDS[2].max, Infinity, 'the top band must be open-ended or a 40-task phase falls out of the table')

  const stats = computeTimingStats([
    synthTrace(
      minutesPhase(10, { taskCount: 3 }),
      minutesPhase(20, { taskCount: 4 }),
      minutesPhase(30, { taskCount: 6 }),
      minutesPhase(40, { taskCount: 7 }),
    ),
  ])
  assert.equal(cohortOf(stats, '1-3', false).samples, 1, 'taskCount 3 is the TOP of the first band, not the bottom of the second')
  assert.equal(cohortOf(stats, '4-6', false).samples, 2, 'taskCount 4 and 6 share the middle band')
  assert.equal(cohortOf(stats, '7+', false).samples, 1, 'taskCount 7 opens the top band')
  assert.equal(cohortOf(stats, '4-6', false).medianMinutes, 25, 'the 4-and-6 phases pooled — 20 and 30')
})

// ── 22. the honesty rails: notes ──────────────────────────────────────────────────────
test('computeTimingStats — notes NAME the surface heuristic as a heuristic and report the total excluded', () => {
  const stats = computeTimingStats([
    synthTrace(minutesPhase(30)),
    synthTrace(minutesPhase(40, { haltCount: 1 }), minutesPhase(50, { haltCount: 3 })),
    synthTrace({ phase: 8999, taskCount: 2, keyFiles: [], parseError: 'Error: boom' }),
  ])
  assert.ok(Array.isArray(stats.notes) && stats.notes.length > 0, 'a projection with caveats must carry them')
  assert.ok(
    stats.notes.some((n) => /heuristic/i.test(n)),
    `the surface axis is a path guess and must SAY so; got ${JSON.stringify(stats.notes)}`,
  )
  assert.equal(totalExcluded(stats), 3, 'two halted phases plus one unreadable one')
  assert.ok(
    stats.notes.some((n) => /exclud/i.test(n) && /\b3\b/.test(n)),
    `a note must report the total excluded count (3 here); got ${JSON.stringify(stats.notes)}`,
  )
})

// ── 23. generatedAt ───────────────────────────────────────────────────────────────────
test('computeTimingStats — generatedAt is injectable and echoed verbatim; the default is an ISO datetime', () => {
  const pinned = '2026-07-27T09:15:00.000Z'
  assert.equal(
    computeTimingStats([traceFor()], { generatedAt: pinned }).generatedAt,
    pinned,
    'an injected clock must survive untouched, or a regenerated projection is not reproducible',
  )

  const { generatedAt } = computeTimingStats([traceFor()])
  assert.equal(typeof generatedAt, 'string')
  assert.match(generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'TimingStatsShape parses generatedAt as z.string().datetime()')
  assert.ok(Number.isFinite(Date.parse(generatedAt)), 'and it must be a real instant')
})

// ── 24. gate R1: a FAILED escape scan is not a clean arc ──────────────────────────────
test('scoreArcTrace — escapeScan unavailable withholds the escape penalty instead of rewarding it', () => {
  const clean = traceFor()
  clean.git.escapeFixes = []
  const withEscapes = traceFor()

  const failed = traceFor()
  failed.git.escapeScan = 'unavailable'
  failed.git.escapeFixes = []

  const cleanScore = scoreArcTrace(clean).dimensions['code-confidence']
  const failedDim = scoreArcTrace(failed).dimensions['code-confidence']

  // A scan that did not run must NOT read as the spotless case: the signal says so by name.
  assert.equal(failedDim.signals.escapeFixes, 'scan-unavailable', 'the absence is NAMED, not a zero')
  assert.equal(failedDim.signals.escapeFixesPerPhase, 'scan-unavailable')
  assert.equal(cleanScore.signals.escapeFixes, 0, 'a scan that DID run and found nothing reports a real zero')

  // gate R2: naming it inside `signals` is not enough — the withheld penalty makes the score
  // numerically identical to a spotless arc, and that number enters every future baseline.
  const notes = scoreArcTrace(failed).notes
  assert.ok(
    notes.some((n) => /escape scan did not run/i.test(n) && /upper bound/i.test(n)),
    `the notes must say the score is an upper bound, not a measurement; got ${JSON.stringify(notes)}`,
  )
  assert.ok(
    !scoreArcTrace(clean).notes.some((n) => /escape scan did not run/i.test(n)),
    'a scan that ran is not caveated'
  )
  assert.ok(
    scoreArcTrace(withEscapes).dimensions['code-confidence'].score < cleanScore.score,
    'fixture precondition: a real escape fix costs points',
  )
})

// ── 25. gate R1: a negative span is corrupt, not instantaneous ────────────────────────
test('scoreArcTrace — an inverted timestamp pair is UNUSABLE, never the maximum speed score', () => {
  const inverted = traceFor()
  for (const p of inverted.phases) {
    p.metrics = { ...p.metrics, startedAt: '2026-07-16T12:00:00.000Z', completedAt: '2026-07-16T09:00:00.000Z' }
  }
  const d = scoreArcTrace(inverted).dimensions.speed
  assert.equal(d.sentinel, 'no-timestamps', 'every span unusable means no timestamps to score')
  assert.equal(d.score, undefined, 'bad data must never become the best possible number')
  assert.notEqual(d.score, 100)

  // And the timing table excludes it rather than emitting a negative median (which
  // TimingStatsShape's nonnegative bound would reject, failing the whole run).
  const stats = computeTimingStats([inverted])
  assert.equal(stats.cohorts.reduce((a, c) => a + c.samples, 0), 0)
  assert.equal(stats.cohorts.reduce((a, c) => a + c.interruptedExcluded, 0), inverted.phases.length)
})

// ── 26. gate R1: an unreadable verdict token is an unreadable verdicts file ────────────
test('scoreArcTrace — an unrecognised tier/confidence/status sentinels instead of guessing a weight', () => {
  for (const mutate of [
    (v) => { v.tierUsed = 'live-hosts' },
    (v) => { v.confidence = 'very-high' },
    (v) => { v.status = 'MET' },
  ]) {
    const trace = traceFor()
    mutate(trace.verdicts.verdicts[0])
    const d = scoreArcTrace(trace).dimensions['verified-vs-intent']
    assert.equal(d.sentinel, 'no-verdicts-file', 'a token nobody can read is evidence nobody can read')
    assert.equal(d.score, undefined, 'a typo must not be silently weighted as the weakest tier or a gap')
    assert.equal(d.signals.unreadableVerdicts, 1)
  }
})

// ══ BACKFILL — the run whose judge pass will never happen ══════════════════════════════
// `pending-judge` is a PROMISE ("a pass is still coming"). Over historical arcs that promise
// is false: their diffs predate the rubric and no judge will ever read them. Those reports
// therefore carry the TERMINAL `unjudged-backfill` sentinel, and the ratchet must treat it as
// INCOMPARABLE — a corpus made entirely of backfilled arcs must never add up to a baseline,
// or the first judged arc would be measured against a number nobody scored.

const BACKFILL_SENTINEL = 'unjudged-backfill'

// ── 27. the scorer's backfill mode: terminal sentinel, feeders intact ──────────────────
test('scoreArcTrace(trace, { backfill: true }) — judge dims carry unjudged-backfill, never pending-judge', () => {
  const { dimensions, notes } = scoreArcTrace(traceFor(), { backfill: true })
  assertDimensionsWellFormed(dimensions, 'backfill')

  for (const key of JUDGE_KEYS) {
    assertSentinel(dimensions, key, BACKFILL_SENTINEL)
    assert.equal(dimensions[key].owner, 'judge', `${key} stays judge-owned — the mode changes the sentinel, not the seam`)
  }
  // The promise must not survive anywhere in the output: a reader (or the trend page) that
  // finds `pending-judge` would wait for a pass that is never coming.
  assert.equal(
    JSON.stringify({ dimensions, notes }).includes('pending-judge'),
    false,
    'a backfill scoring may not emit the string pending-judge anywhere',
  )
})

test('scoreArcTrace — a backfill changes ONLY the judge sentinels: deterministic scores and every FEEDER are identical', () => {
  // Same collected trace both ways, so the ONLY difference between the two runs is the mode.
  const plain = scoreArcTrace(traceFor()).dimensions
  const back = scoreArcTrace(traceFor(), { backfill: true }).dimensions

  assert.deepEqual(Object.keys(back), Object.keys(plain), 'contract key ORDER is part of the archive and must not move')
  for (const key of DETERMINISTIC_KEYS)
    assert.deepEqual(back[key], plain[key], `${key} reads recorded artifacts — a backfill has the same ones`)

  for (const key of JUDGE_KEYS) {
    assert.deepEqual(
      back[key].signals,
      plain[key].signals,
      `${key}: the feeders are COUNTS of recorded things, not judgements — a backfill must not drop them`,
    )
    assert.ok(Object.keys(back[key].signals).length > 0, `${key}: an empty signals record hands a later reader nothing`)
    assert.deepEqual(back[key].sourceRefs, plain[key].sourceRefs, `${key}: the same artifacts are cited`)
    assert.notEqual(back[key].sentinel, plain[key].sentinel, `${key}: the sentinel is the one thing that DOES change`)
  }
})

test('scoreArcTrace — the backfill mode is NAMED in notes, and the artifact-gap notes still are too', () => {
  const trace = traceFor({ omitVerdicts: true })
  const plainNotes = scoreArcTrace(trace).notes
  assert.ok(plainNotes.length > 0, 'fixture precondition: this variant produces at least one gap note')

  const { notes } = scoreArcTrace(trace, { backfill: true })
  const modeNote = notes.find((n) => /backfill/i.test(n))
  assert.ok(modeNote, `the mode must be named in notes, not inferred from a sentinel; got ${JSON.stringify(notes)}`)
  assert.match(modeNote, /judge/i, `the mode note must say what it costs (the judge pass); got ${JSON.stringify(modeNote)}`)

  for (const n of plainNotes)
    assert.ok(notes.includes(n), `the mode note ADDS to the honesty rails; ${JSON.stringify(n)} must survive`)
})

// ── 28. regression guard: the default mode is untouched ────────────────────────────────
test('scoreArcTrace — WITHOUT the backfill option nothing carries unjudged-backfill', () => {
  for (const args of [[traceFor()], [traceFor(), {}], [traceFor(), { backfill: false }]]) {
    const scored = scoreArcTrace(...args)
    for (const key of JUDGE_KEYS) assert.equal(scored.dimensions[key].sentinel, 'pending-judge', `${key} still awaits a pass`)
    assert.equal(
      JSON.stringify(scored).includes(BACKFILL_SENTINEL),
      false,
      'the terminal sentinel must never leak into an ordinary run — that would cancel a pass that IS coming',
    )
  }
})

// ── 29. the ratchet: a backfilled prior is INCOMPARABLE, not a data point ──────────────
test('computeRatchet — backfilled priors contribute NOTHING to a judge dimension baseline', () => {
  const scored = [1, 2, 3].map((i) => mkReport({ all: 60, judgeModel: 'judge-A', date: `2026-07-0${i}` }))
  const backfilled = [4, 5, 6].map((i) =>
    mkReport({
      all: 90,
      per: Object.fromEntries(JUDGE_KEYS.map((k) => [k, BACKFILL_SENTINEL])),
      judgeModel: 'judge-A',
      date: `2026-07-0${i}`,
    }),
  )
  const rows = computeRatchet(mkReport({ all: 50, judgeModel: 'judge-A' }), [...scored, ...backfilled])

  for (const key of JUDGE_KEYS) {
    const row = rowOf(rows, key)
    assert.equal(samplesFromNote(row), 3, `${key}: only the three JUDGED priors are samples`)
    assert.equal(row.baseline, 60, `${key}: the backfilled 90s must not enter the mean; got ${row.baseline}`)
  }
  // The deterministic dimensions of those same reports are ordinary data and still count.
  assert.equal(samplesFromNote(rowOf(rows, 'speed')), 6, 'a backfilled report is only unjudged, not unread')
})

test('computeRatchet — a corpus of ONLY backfilled priors never adds up to a baseline', () => {
  const backfilled = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    mkReport({
      all: 90,
      per: Object.fromEntries(JUDGE_KEYS.map((k) => [k, BACKFILL_SENTINEL])),
      judgeModel: 'judge-A',
      date: `2026-07-0${i}`,
    }),
  )
  const rows = computeRatchet(mkReport({ all: 70, judgeModel: 'judge-A' }), backfilled)

  for (const key of JUDGE_KEYS) {
    const row = rowOf(rows, key)
    assert.equal(row.baseline, null, `${key}: eight unjudged priors are still zero comparable samples`)
    assert.equal(row.note, 'no-baseline', `${key}: got ${JSON.stringify(row.note)}`)
    assert.equal(row.regression, false, `${key}: a baseline nobody can compute is never a regression`)
    assert.equal(row.value, 70, `${key}: the CURRENT judged value is still reported`)
  }
})

test('computeRatchet — an unjudged-backfill CURRENT dimension is null/null/false and names the sentinel', () => {
  const priors = [1, 2, 3].map((i) => mkReport({ all: 80, judgeModel: 'judge-A', date: `2026-07-0${i}` }))
  const current = mkReport({
    all: 80,
    per: Object.fromEntries(JUDGE_KEYS.map((k) => [k, BACKFILL_SENTINEL])),
    judgeModel: 'judge-A',
  })
  const rows = computeRatchet(current, priors)

  for (const key of JUDGE_KEYS) {
    const row = rowOf(rows, key)
    assert.equal(row.value, null, `${key}: there is no current number to compare`)
    assert.equal(row.delta, null, `${key}: a regression must always have a computable delta`)
    assert.equal(row.regression, false, `${key}: an arc nobody judged is not a regression`)
    assert.notEqual(row.value, 0, `${key}: an unmeasured value must not become a zero that reads as a collapse`)
    assert.ok(
      new RegExp(BACKFILL_SENTINEL).test(row.note ?? ''),
      `${key}: the note must name WHY the value is missing; got ${JSON.stringify(row.note)}`,
    )
  }
  assert.equal(rowOf(rows, 'speed').value, 80, 'the deterministic dimensions of a backfilled report still ratchet')
})
