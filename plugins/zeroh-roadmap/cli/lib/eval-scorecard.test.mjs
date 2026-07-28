#!/usr/bin/env node
/**
 * eval-scorecard.test.mjs — PER-ACTOR outcome slicing (arc EVALLOOP). Who drove and who
 * reviewed is already captured (eval-score.mjs `assembleAttribution`) but never sliced into
 * outcomes. This file pins the three properties that make such a slice honest rather than
 * flattering:
 *
 *  - COHORT NORMALISATION. Work is not randomly assigned to actors, so a pooled mean is a
 *    lie: an actor handed every 7+ surface phase would "score worse" than one handed 1-3
 *    CLI phases no matter how well it worked. Every cell is keyed by the SAME two axes the
 *    timing table uses (`TASK_COUNT_BANDS`, `SURFACE_PATH_RE`), imported from eval-score.mjs
 *    rather than restated, and no cell or field may ever carry a cross-cohort figure.
 *  - THE N FLOOR. Below `SCORECARD_N_FLOOR` samples a cell ABSTAINS — no `metrics` key at
 *    all, so a reader cannot accidentally rank two actors on two phases of anecdote.
 *  - THE ANTI-ZERO RAIL. An unmeasurable signal is a NAMED string sentinel
 *    ('scan-unavailable', 'no-gate-rounds', 'no-halt-evidence', 'no-timestamps'), never 0.
 *    A zeroed escape rate reads as a spotless actor; a zeroed recall reads as a useless one.
 *    Every sentinel assertion here also asserts `!== 0` explicitly.
 *
 * Conventions: this plugin has no `testConventions` key in a roadmap.config.json — they are
 * inferred from the two nearest siblings, cli/lib/eval-collect.test.mjs (node:test, injected
 * `exec` recorder asserting the argv stream, no real git) and cli/lib/eval-score.test.mjs
 * (hand-built in-memory trace fixtures, one builder mutated by copy).
 *
 * Run: node --test cli/lib/eval-scorecard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TASK_COUNT_BANDS, SURFACE_PATH_RE, UNRECORDED_DRIVER } from './eval-score.mjs'
import { SCORECARD_N_FLOOR, findGateFixCommits, computeScorecard } from './eval-scorecard.mjs'

// ── the fixture builder ───────────────────────────────────────────────────────────────
// ONE phase builder, mutated by copy. Every option that can be ABSENT in a real trace takes
// `null` to mean "omit this", so an absence fixture is a one-word edit rather than a second
// hand-typed phase object.

const T0 = '2026-07-16T00:00:00.000Z'
const CLI_FILE = 'cli/lib/eval-scorecard.mjs'
const SURFACE_FILE = 'web/src/panels/scorecard-panel.tsx'
const DRIVER_A = { model: 'claude-opus-5', lane: 'session' }
const DRIVER_B = { model: 'grok-code', lane: 'runner' }

let seq = 0

/**
 * @param o.driver          driver object, or null for an executionResult WITHOUT a driver
 * @param o.executionResult null to omit executionResult entirely
 * @param o.gateRounds      number, or null for "not recorded"
 * @param o.haltCount       number, or null for "no halt evidence"
 * @param o.minutes         span length, or null to omit completedAt (an unusable span)
 * @param o.metrics         null to omit the metrics block entirely
 */
function mkPhase(o = {}) {
  const p = {
    phase: o.phase ?? 9000 + ++seq,
    taskCount: o.taskCount ?? 2,
    keyFiles: o.keyFiles ?? [CLI_FILE],
    gateRuns: o.gateRuns ?? [mkRun(o)],
  }
  if (o.executionResult !== null) {
    const er = {}
    if (o.driver !== null) er.driver = o.driver ?? DRIVER_A
    if (o.gateRounds !== null) er.gateRounds = o.gateRounds ?? 1
    p.executionResult = er
  }
  if (o.metrics !== null) {
    const m = { startedAt: o.startedAt ?? T0 }
    if (o.minutes !== null) m.completedAt = new Date(Date.parse(o.startedAt ?? T0) + (o.minutes ?? 30) * 60_000).toISOString()
    if (o.haltCount !== null) m.haltCount = o.haltCount ?? 0
    p.metrics = m
  }
  return p
}

function mkRun(o = {}) {
  return {
    startedAt: o.startedAt ?? T0,
    green: o.green ?? true,
    rounds: o.rounds ?? [{ round: 1, agent: 'code-reviewer', verdict: 'clean' }],
    slotFailures: 0,
  }
}

/** `n` copies of one phase shape; pass a function to vary by index. */
const nPhases = (n, o = {}) => Array.from({ length: n }, (_, i) => mkPhase(typeof o === 'function' ? o(i) : { ...o }))

const mkTrace = (phases, o = {}) => ({
  arcId: o.arcId ?? 'SCORECARDFIX',
  collectedAt: '2026-07-28T00:00:00.000Z',
  phases,
  git: { escapeScan: o.escapeScan ?? 'complete', escapeFixes: o.escapeFixes ?? [] },
})

const escapeFix = (subject) => ({ sha: 'deadbee00000', subject, files: 1 })

// ── cell lookups ──────────────────────────────────────────────────────────────────────
// A missing cell returns undefined, which several tests assert directly.

const driverCell = (sc, { model, lane = 'session', band = '1-3', surface = false }) =>
  sc.drivers.find((c) => c.model === model && c.lane === lane && c.taskCountBand === band && c.surface === surface)

const reviewerCell = (sc, { agent, band = '1-3', surface = false }) =>
  sc.reviewers.find((c) => c.agent === agent && c.taskCountBand === band && c.surface === surface)

const allCells = (sc) => [...sc.drivers, ...sc.reviewers]

/** Guarded sample access, same reason: an absent cell is a named failure, not a TypeError. */
const samplesOf = (cell, label) => {
  assert.ok(cell, `${label}: the cell must be emitted at all`)
  return cell.samples
}

/** Guarded metric access: a missing cell must read as a NAMED failure, not a TypeError. */
function metricsOf(cell, label) {
  assert.ok(cell, `${label}: the cell must be emitted at all`)
  assert.equal(cell.abstained, false, `${label}: this cell is at or above the floor and must not abstain`)
  assert.ok(cell.metrics, `${label}: a non-abstaining cell carries a metrics record`)
  return cell.metrics
}

const DRIVER_METRIC_KEYS = ['escapeFixesPerPhase', 'gateRoundsMean', 'haltRate', 'minutesPerTask']
const REVIEWER_METRIC_KEYS = ['catches', 'falsePositives', 'misses', 'recall']

function assertMetricKeys(cell, expected, label) {
  assert.ok(cell, `${label}: the cell must exist`)
  assert.equal(cell.abstained, false, `${label}: a cell at or above the floor does not abstain`)
  assert.ok(cell.metrics, `${label}: a non-abstaining cell carries metrics`)
  assert.deepEqual(
    Object.keys(cell.metrics).sort(),
    expected,
    `${label}: exactly the contract's metric keys, no more (an extra key is an unreviewed signal)`,
  )
}

function assertAbstains(cell, samples, label) {
  assert.ok(cell, `${label}: an under-floor cell is still EMITTED — the work must stay visible`)
  assert.equal(cell.samples, samples, `${label}: the sample count is reported even while abstaining`)
  assert.equal(cell.abstained, true, `${label}: under the floor the cell abstains`)
  assert.equal('metrics' in cell, false, `${label}: an abstaining cell carries NO metrics key at all`)
}

/** The named-sentinel rail: the exact string, a string TYPE, and explicitly not a zero. */
function assertSentinel(value, expected, label) {
  assert.equal(typeof value, 'string', `${label}: an unmeasurable signal is a named string, not a number`)
  assert.equal(value, expected, `${label}: the exact sentinel`)
  assert.notEqual(value, 0, `${label}: a zero here reads as a real measurement — it must never be one`)
}

/**
 * The hard invariant: no cell in `cells` carries the pooled figure `pooled`. The cell list is
 * a parameter rather than the whole scorecard because a reviewer who sat one round on every
 * phase of ONE cohort legitimately has the same total as a two-driver pool — that number is
 * cohort-local and is not the violation being hunted.
 */
function assertNoPooledCell(cells, pooled, label) {
  assert.equal(
    cells.filter((c) => c.samples === pooled).length,
    0,
    `${label}: no cell may carry the pooled sample count ${pooled}; got ${JSON.stringify(cells.map((c) => c.samples))}`,
  )
}

// ── 0. the exported vocabulary ────────────────────────────────────────────────────────
test('SCORECARD_N_FLOOR is 5, and the cohort axes come from eval-score, not a second copy', () => {
  assert.equal(SCORECARD_N_FLOOR, 5, 'the floor is a named export a reader can check the table against')
  // Restated here ONLY as the anchor the slicer must share: if eval-score re-bands, the
  // scorecard and the timing table must move together or two tables stop being comparable.
  assert.deepEqual(TASK_COUNT_BANDS.map((b) => b.label), ['1-3', '4-6', '7+'])
  assert.equal(SURFACE_PATH_RE.test(SURFACE_FILE), true, 'fixture precondition: the web/ file is a surface path')
  assert.equal(SURFACE_PATH_RE.test(CLI_FILE), false, 'fixture precondition: the cli/ file is not')
  assert.deepEqual(UNRECORDED_DRIVER, { model: 'unrecorded', lane: 'session' })
})

// ── 1. the acceptance criterion: abstention ───────────────────────────────────────────
test('computeScorecard — a 2-phase driver cell ABSTAINS: samples 2, no metrics key', () => {
  const sc = computeScorecard([mkTrace(nPhases(2))], [])

  const cell = driverCell(sc, { model: DRIVER_A.model })
  assertAbstains(cell, 2, 'a two-phase driver')
  assert.equal(sc.nFloor, SCORECARD_N_FLOOR, 'the floor the abstention was decided against rides the output')
})

test('computeScorecard — the floor bites EXACTLY at nFloor: n-1 abstains, n scores', () => {
  const below = computeScorecard([mkTrace(nPhases(SCORECARD_N_FLOOR - 1))], [])
  const at = computeScorecard([mkTrace(nPhases(SCORECARD_N_FLOOR))], [])

  assertAbstains(driverCell(below, { model: DRIVER_A.model }), SCORECARD_N_FLOOR - 1, 'one under the floor')
  const atCell = driverCell(at, { model: DRIVER_A.model })
  assert.equal(atCell.samples, SCORECARD_N_FLOOR)
  assert.equal(atCell.abstained, false, 'EXACTLY at the floor is enough evidence — the floor is inclusive')
  assertMetricKeys(atCell, DRIVER_METRIC_KEYS, 'at the floor')

  // The floor is injectable, and injecting it changes the SAME input's verdict.
  const lowered = computeScorecard([mkTrace(nPhases(2))], [], { nFloor: 2 })
  assert.equal(lowered.nFloor, 2, 'an injected floor rides the output verbatim')
  assert.equal(driverCell(lowered, { model: DRIVER_A.model }).abstained, false, 'two samples clear a floor of two')
})

// ── 2. a scored driver cell ───────────────────────────────────────────────────────────
test('computeScorecard — a 6-phase driver cell computes all four metrics as NUMBERS', () => {
  const phases = nPhases(6, (i) => ({ phase: 9200 + i, gateRounds: 2, haltCount: 0, minutes: 30, taskCount: 3 }))
  const sc = computeScorecard([mkTrace(phases, { escapeFixes: [escapeFix('fix(cli): phase 9203 gate R1 — an escape')] })], [])

  const cell = driverCell(sc, { model: DRIVER_A.model })
  assertMetricKeys(cell, DRIVER_METRIC_KEYS, 'a six-phase driver')
  assert.equal(cell.samples, 6)

  const m = cell.metrics
  for (const key of DRIVER_METRIC_KEYS) {
    assert.equal(typeof m[key], 'number', `${key} is a real number when every input is present`)
    assert.ok(Number.isFinite(m[key]), `${key} is finite`)
  }
  assert.equal(m.gateRoundsMean, 2, 'six phases at 2 recorded gate rounds')
  assert.equal(m.escapeFixesPerPhase, 1 / 6, 'one attributed escape over six phases')
  assert.equal(m.haltRate, 0, 'six phases recorded haltCount 0 — a MEASURED zero, unlike the sentinel case')
  assert.equal(m.minutesPerTask, 10, '30 minutes over 3 tasks, pooled across six identical phases')
})

// ── 3. THE HARD INVARIANT: two cohorts never merge ────────────────────────────────────
test('computeScorecard — one driver across two cohorts yields TWO cells and NO pooled figure', () => {
  // Cohort A: six 1-3-band CLI phases at 1 gate round. Cohort B: five 7+-band surface phases
  // at 3. A pooled mean would be (6*1 + 5*3)/11 = 1.909 — a number that describes NEITHER
  // cohort and would rank this driver against one handed only easy work.
  const cohortA = nPhases(6, (i) => ({ phase: 9300 + i, taskCount: 2, keyFiles: [CLI_FILE], gateRounds: 1 }))
  const cohortB = nPhases(5, (i) => ({ phase: 9400 + i, taskCount: 9, keyFiles: [SURFACE_FILE], gateRounds: 3 }))
  const sc = computeScorecard([mkTrace([...cohortA, ...cohortB])], [])

  const mine = sc.drivers.filter((c) => c.model === DRIVER_A.model && c.lane === DRIVER_A.lane)
  assert.equal(mine.length, 2, `exactly one cell per cohort; got ${JSON.stringify(mine)}`)

  const easy = driverCell(sc, { model: DRIVER_A.model, band: '1-3', surface: false })
  const hard = driverCell(sc, { model: DRIVER_A.model, band: '7+', surface: true })
  const easyMetrics = metricsOf(easy, 'the 1-3 CLI cohort')
  const hardMetrics = metricsOf(hard, 'the 7+ surface cohort')
  assert.equal(easy.samples, 6, 'the 1-3 CLI cohort keeps its own six')
  assert.equal(hard.samples, 5, 'the 7+ surface cohort keeps its own five')

  // The absence, asserted by an explicit compare rather than a negative grep.
  assertNoPooledCell(allCells(sc), 11, 'two cohorts, one driver')
  assert.equal(easy.samples + hard.samples, 11, 'and nothing was dropped on the way — the eleven phases are all here')

  // Sample counts alone are not the invariant: the METRIC must be cohort-local too.
  const POOLED_MEAN = (6 * 1 + 5 * 3) / 11
  assert.equal(easyMetrics.gateRoundsMean, 1, 'the easy cohort reports its own mean')
  assert.equal(hardMetrics.gateRoundsMean, 3, 'the hard cohort reports its own mean')
  assert.notEqual(easyMetrics.gateRoundsMean, POOLED_MEAN, `a pooled mean would have been ${POOLED_MEAN}`)
  assert.notEqual(hardMetrics.gateRoundsMean, POOLED_MEAN, `a pooled mean would have been ${POOLED_MEAN}`)
  assert.equal(
    allCells(sc).filter((c) => c.metrics && c.metrics.gateRoundsMean === POOLED_MEAN).length,
    0,
    'the pooled figure appears in NO cell and NO field',
  )
})

test('computeScorecard — two DIFFERENT drivers in one cohort never share a cell', () => {
  const sc = computeScorecard(
    [
      mkTrace([
        ...nPhases(6, (i) => ({ phase: 9500 + i, driver: DRIVER_A })),
        ...nPhases(5, (i) => ({ phase: 9600 + i, driver: DRIVER_B })),
      ]),
    ],
    [],
  )
  assert.equal(samplesOf(driverCell(sc, { model: DRIVER_A.model, lane: 'session' }), 'driver A, session lane'), 6)
  assert.equal(samplesOf(driverCell(sc, { model: DRIVER_B.model, lane: 'runner' }), 'driver B, runner lane'), 5)
  assert.equal(driverCell(sc, { model: DRIVER_B.model, lane: 'session' }), undefined, 'the LANE is part of the key')
  assertNoPooledCell(sc.drivers, 11, 'two drivers, one cohort')
  // The POSITIVE half of the same ruling, and the only coverage in this file that fails if a
  // driver term is ever added to the reviewer key: a reviewer is keyed agent × cohort, so the
  // one code-reviewer that sat all eleven rounds of this SINGLE cohort honestly carries 11. That
  // is a full single-cohort total, not a pooled figure — the invariant is over the cohort axis.
  assert.equal(
    samplesOf(reviewerCell(sc, { agent: 'code-reviewer' }), 'the single code-reviewer cell'),
    11,
    'the reviewer is not partitioned by who drove; splitting it here would fragment its evidence below the floor',
  )
})

// ── 4. escapeFixesPerPhase: attribution, and the digit boundary ───────────────────────
test('computeScorecard — escape fixes attribute by DIGIT-BOUNDARY phase match, divided by samples', () => {
  // Phases 900..904, so `phase 9001` is a live prefix hazard: a loose match would attribute
  // an unrelated arc's escape to this driver and halve its measured quality.
  const phases = nPhases(5, (i) => ({ phase: 900 + i }))
  const sc = computeScorecard(
    [
      mkTrace(phases, {
        escapeFixes: [
          escapeFix('fix(cli): phase 902 gate R1 — a real escape'),
          escapeFix('fix(cli): phase 9001 gate R1 — another arc entirely'),
          escapeFix('fix(cli): phase 90 gate R2 — a shorter neighbour'),
        ],
      }),
    ],
    [],
  )

  const m = metricsOf(driverCell(sc, { model: DRIVER_A.model }), 'the driver cell under test')
  assert.equal(m.escapeFixesPerPhase, 1 / 5, 'exactly ONE of the three fixes names a member phase')
  assert.notEqual(m.escapeFixesPerPhase, 3 / 5, 'a loose substring match would have counted all three')
  assert.notEqual(m.escapeFixesPerPhase, 2 / 5, "'phase 9001' must not match phase 900")
})

// ── 5. the anti-zero rail: an unavailable escape scan ─────────────────────────────────
test('computeScorecard — escapeScan unavailable sentinels escapeFixesPerPhase AND recall, never zeroes them', () => {
  const phases = nPhases(6, (i) => ({ phase: 9700 + i }))
  const sc = computeScorecard([mkTrace(phases, { escapeScan: 'unavailable' })], [])

  const driver = metricsOf(driverCell(sc, { model: DRIVER_A.model }), 'the driver cell under test')
  assertSentinel(driver.escapeFixesPerPhase, 'scan-unavailable', 'driver.escapeFixesPerPhase')
  assert.equal(typeof driver.gateRoundsMean, 'number', 'the signals the scan does not feed still measure')

  const reviewer = metricsOf(reviewerCell(sc, { agent: 'code-reviewer' }), 'the code-reviewer cell')
  assertSentinel(reviewer.recall, 'scan-unavailable', 'reviewer.recall')
  assert.equal(typeof reviewer.catches, 'number', 'catches are read from the gate record, not from git')
  assert.equal(typeof reviewer.misses, 'number', 'misses are still reported as the (unknowably incomplete) count')

  // The scanned twin proves the sentinel is caused by the scan and not by the empty fix list:
  // same phases, scan complete, zero fixes ⇒ a REAL zero, which is a different claim.
  const scanned = computeScorecard([mkTrace(nPhases(6, (i) => ({ phase: 9700 + i })))], [])
  const scannedMetrics = metricsOf(driverCell(scanned, { model: DRIVER_A.model }), 'the scanned twin')
  assert.equal(scannedMetrics.escapeFixesPerPhase, 0, 'a scan that RAN and found nothing reports a real zero')
})

test('computeScorecard — ONE contributing trace with an unavailable scan sentinels the cell it feeds', () => {
  // Cross-trace contamination: the cell fed by the degraded trace cannot claim a rate, while
  // a cohort no degraded trace touched keeps its real number.
  const degraded = mkTrace(nPhases(3, (i) => ({ phase: 9800 + i })), { escapeScan: 'unavailable' })
  const clean = mkTrace(nPhases(3, (i) => ({ phase: 9810 + i })))
  const untouched = mkTrace(nPhases(5, (i) => ({ phase: 9820 + i, taskCount: 9, keyFiles: [SURFACE_FILE] })))
  const sc = computeScorecard([degraded, clean, untouched], [])

  const mixed = driverCell(sc, { model: DRIVER_A.model, band: '1-3', surface: false })
  const mixedMetrics = metricsOf(mixed, 'the 1-3 cell fed by both a degraded and a clean trace')
  assert.equal(mixed.samples, 6, 'the two 1-3 traces pool into one cohort cell')
  assertSentinel(mixedMetrics.escapeFixesPerPhase, 'scan-unavailable', 'a cell with ANY degraded contributor')

  const isolated = metricsOf(driverCell(sc, { model: DRIVER_A.model, band: '7+', surface: true }), 'the 7+ surface cell')
  assert.equal(isolated.escapeFixesPerPhase, 0, 'a cohort no degraded trace fed still measures a real zero')
})

// ── 6. gateRoundsMean ─────────────────────────────────────────────────────────────────
test('computeScorecard — gateRoundsMean averages only phases that RECORDED a number', () => {
  const sc = computeScorecard(
    [mkTrace([...nPhases(4, () => ({ gateRounds: 3 })), ...nPhases(2, () => ({ gateRounds: null }))])],
    [],
  )
  const m = metricsOf(driverCell(sc, { model: DRIVER_A.model }), 'the driver cell under test')
  assert.equal(m.gateRoundsMean, 3, 'the two unrecorded phases are not zero-round phases')
  assert.notEqual(m.gateRoundsMean, 2, 'counting an unrecorded phase as 0 rounds would flatter the driver to 12/6')
})

test('computeScorecard — NO recorded gate rounds anywhere sentinels gateRoundsMean', () => {
  const sc = computeScorecard([mkTrace(nPhases(6, () => ({ gateRounds: null })))], [])
  const m = metricsOf(driverCell(sc, { model: DRIVER_A.model }), 'the driver cell under test')
  assertSentinel(m.gateRoundsMean, 'no-gate-rounds', 'gateRoundsMean with nothing recorded')
})

// ── 7. haltRate ───────────────────────────────────────────────────────────────────────
test('computeScorecard — haltRate is halted ÷ phases WITH halt evidence, sentinel when there is none', () => {
  const none = computeScorecard([mkTrace(nPhases(6, () => ({ haltCount: null })))], [])
  const m0 = metricsOf(driverCell(none, { model: DRIVER_A.model }), 'the driver cell under test')
  assertSentinel(m0.haltRate, 'no-halt-evidence', 'haltRate with no phase recording haltCount')
  // Absent halt evidence is not evidence of a halt: the timing signal still measures.
  assert.equal(typeof m0.minutesPerTask, 'number', 'a phase with no halt record is not known-halted, so its span still counts')

  const some = computeScorecard(
    [
      mkTrace([
        ...nPhases(2, () => ({ haltCount: 2 })),
        ...nPhases(2, () => ({ haltCount: 0 })),
        ...nPhases(2, () => ({ haltCount: null })),
      ]),
    ],
    [],
  )
  const m1 = metricsOf(driverCell(some, { model: DRIVER_A.model }), 'the driver cell under test')
  assert.equal(m1.haltRate, 0.5, 'two halted over the FOUR phases that carry halt evidence')
  assert.notEqual(m1.haltRate, 2 / 6, 'the two evidence-less phases must not enter the denominator as clean runs')
  assert.equal(samplesOf(driverCell(some, { model: DRIVER_A.model }), 'the driver cell under test'), 6, 'they are still samples of the cell')
})

// ── 8. minutesPerTask ─────────────────────────────────────────────────────────────────
test('computeScorecard — no usable span anywhere sentinels minutesPerTask', () => {
  const noMetrics = computeScorecard([mkTrace(nPhases(6, () => ({ metrics: null })))], [])
  const m0 = metricsOf(driverCell(noMetrics, { model: DRIVER_A.model }), 'the driver cell under test')
  assertSentinel(m0.minutesPerTask, 'no-timestamps', 'minutesPerTask with no metrics at all')
  assertSentinel(m0.haltRate, 'no-halt-evidence', 'and no metrics means no halt evidence either')

  const halfTimed = computeScorecard([mkTrace(nPhases(6, () => ({ minutes: null })))], [])
  assertSentinel(
    metricsOf(driverCell(halfTimed, { model: DRIVER_A.model }), 'the driver cell under test').minutesPerTask,
    'no-timestamps',
    'a startedAt with no completedAt is not a span',
  )
})

test('computeScorecard — minutesPerTask pools halt-free minutes over pooled tasks; halted and half-timed phases are OUT', () => {
  const sc = computeScorecard(
    [
      mkTrace([
        ...nPhases(5, (i) => ({ phase: 9900 + i, minutes: 30, taskCount: 3, haltCount: 0 })),
        mkPhase({ phase: 9910, minutes: 600, taskCount: 3, haltCount: 4 }),
        mkPhase({ phase: 9911, minutes: null, taskCount: 3, haltCount: 0 }),
      ]),
    ],
    [],
  )
  const cell = driverCell(sc, { model: DRIVER_A.model })
  const m = metricsOf(cell, 'the driver cell under test')
  assert.equal(cell.samples, 7, 'every phase is a sample of the cell, whatever the timing evidence')
  assert.equal(m.minutesPerTask, 10, '150 halt-free minutes over 15 pooled tasks')
  assert.notEqual(m.minutesPerTask, 750 / 18, "the halted phase's 600 minutes must not enter the pool")
  assert.notEqual(m.minutesPerTask, 150 / 18, 'and the half-timed phase must not contribute 3 tasks of zero minutes')
})

test('computeScorecard — taskCount 0 cannot divide by zero: the denominator floors at 1 per phase', () => {
  const sc = computeScorecard([mkTrace(nPhases(5, () => ({ taskCount: 0, minutes: 20, haltCount: 0 })))], [])
  const v = metricsOf(driverCell(sc, { model: DRIVER_A.model }), 'the driver cell under test').minutesPerTask
  assert.equal(v, 20, 'Math.max(1, taskCount) per phase — 100 minutes over 5')
  assert.ok(Number.isFinite(v), 'never Infinity: a zero-task phase is one unit of work, not a divide-by-zero')
})

// ── 9. the unrecorded driver ──────────────────────────────────────────────────────────
test('computeScorecard — an unattributed phase lands in its OWN unrecorded cell, never folded into a real actor', () => {
  const sc = computeScorecard(
    [
      mkTrace([
        ...nPhases(6, (i) => ({ phase: 9000 + i, driver: DRIVER_A })),
        mkPhase({ phase: 9010, driver: null }), // executionResult present, driver absent
        mkPhase({ phase: 9011, driver: null }),
        mkPhase({ phase: 9012, executionResult: null }), // no executionResult at all
      ]),
    ],
    [],
  )

  const real = driverCell(sc, { model: DRIVER_A.model })
  assert.ok(real, 'the recorded driver keeps a cell of its own')
  assert.equal(real.samples, 6, 'the recorded driver owns exactly the six phases it reported')

  const unrecorded = driverCell(sc, { model: 'unrecorded', lane: 'session' })
  assertAbstains(unrecorded, 3, 'the unrecorded bucket')
  assert.equal(unrecorded.model, 'unrecorded', 'the literal sentinel model id, never a guessed one')
  assert.equal(unrecorded.lane, 'session', 'and the literal UNRECORDED_DRIVER lane')

  assertNoPooledCell(sc.drivers, 9, 'recorded plus unrecorded')
  assert.equal(
    sc.drivers.filter((c) => c.model !== 'unrecorded' && c.samples > 6).length,
    0,
    'no real actor absorbed an unattributed phase',
  )
  // Attribution loss on the DRIVER axis must not fragment reviewer evidence: code-reviewer sat
  // all nine rounds of this one cohort whether or not the executor said who it was.
  assert.equal(
    samplesOf(reviewerCell(sc, { agent: 'code-reviewer' }), 'the single code-reviewer cell'),
    9,
    'a reviewer is keyed agent × cohort — an unrecorded driver does not split its cell',
  )
})

// ── 10. reviewer cells: samples are ROUNDS, not phases ────────────────────────────────
test('computeScorecard — a reviewer cell counts ROUNDS SAT, not phases reviewed', () => {
  const rounds = [
    { round: 1, agent: 'code-reviewer', verdict: 'findings-fixed' },
    { round: 2, agent: 'code-reviewer', verdict: 'clean' },
  ]
  const sc = computeScorecard([mkTrace(nPhases(3, (i) => ({ phase: 9100 + i, rounds })))], [])

  const cell = reviewerCell(sc, { agent: 'code-reviewer' })
  assertMetricKeys(cell, REVIEWER_METRIC_KEYS, 'a six-round reviewer')
  assert.equal(cell.samples, 6, 'three phases at two rounds each is six samples')
  assert.notEqual(cell.samples, 3, 'phases would have abstained under the floor — rounds are the sample unit')
  assert.equal(cell.abstained, false)
})

test('computeScorecard — reviewer cells split by cohort exactly like driver cells', () => {
  const rounds = [{ round: 1, agent: 'code-reviewer', verdict: 'clean' }]
  const sc = computeScorecard(
    [
      mkTrace([
        ...nPhases(6, (i) => ({ phase: 9120 + i, rounds, taskCount: 2, keyFiles: [CLI_FILE] })),
        ...nPhases(5, (i) => ({ phase: 9130 + i, rounds, taskCount: 9, keyFiles: [SURFACE_FILE] })),
      ]),
    ],
    [],
  )
  assert.equal(samplesOf(reviewerCell(sc, { agent: 'code-reviewer', band: '1-3', surface: false }), 'code-reviewer, 1-3 CLI'), 6)
  assert.equal(samplesOf(reviewerCell(sc, { agent: 'code-reviewer', band: '7+', surface: true }), 'code-reviewer, 7+ surface'), 5)
  assertNoPooledCell(allCells(sc), 11, 'one reviewer across two cohorts')
})

// ── 11. catches vs false positives ────────────────────────────────────────────────────
/**
 * Six phases reviewed by code-reviewer. 9150 and 9151 both get a non-clean round; 9150 is
 * always backed by a gate fix, and `backed` decides whether 9151 is too.
 */
function reviewerFixture({ backed }) {
  const phases = nPhases(6, (i) => ({
    phase: 9150 + i,
    rounds: [
      {
        round: 1,
        agent: 'code-reviewer',
        verdict: i <= 1 ? 'findings-fixed' : 'clean',
      },
    ],
  }))
  // 9150 always carries a gate fix; 9151 carries one only when `backed`.
  const gateFixes = [{ phase: 9150, round: 1 }, ...(backed ? [{ phase: 9151, round: 1 }] : [])]
  return { traces: [mkTrace(phases)], gateFixes }
}

test('computeScorecard — a non-clean round WITH a matching gate fix is a CATCH, not a false positive', () => {
  const { traces, gateFixes } = reviewerFixture({ backed: true })
  const m = metricsOf(reviewerCell(computeScorecard(traces, gateFixes), { agent: 'code-reviewer' }), 'the code-reviewer cell')

  assert.equal(m.catches, 2, 'both non-clean rounds are catches')
  assert.equal(m.falsePositives, 0, 'a round whose findings produced a real gate fix is NOT a false positive')
})

test('computeScorecard — the same round WITHOUT a gate fix, on a green run, IS a false positive', () => {
  const { traces, gateFixes } = reviewerFixture({ backed: false })
  const m = metricsOf(reviewerCell(computeScorecard(traces, gateFixes), { agent: 'code-reviewer' }), 'the code-reviewer cell')

  assert.equal(m.catches, 2, 'a false positive is still a non-clean round — catches does not drop it')
  assert.equal(m.falsePositives, 1, 'exactly the unbacked round on 9151; 9150 keeps its fix')
})

test('computeScorecard — a gate fix must match BOTH phase and round to back a finding', () => {
  const { traces } = reviewerFixture({ backed: false })
  const wrongRound = metricsOf(
    reviewerCell(computeScorecard(traces, [{ phase: 9150, round: 1 }, { phase: 9151, round: 7 }]), { agent: 'code-reviewer' }),
    'code-reviewer, wrong-round fix',
  )
  assert.equal(wrongRound.falsePositives, 1, "a fix for another ROUND does not back round 1's findings")

  const wrongPhase = metricsOf(
    reviewerCell(computeScorecard(traces, [{ phase: 9150, round: 1 }, { phase: 9999, round: 1 }]), { agent: 'code-reviewer' }),
    'code-reviewer, wrong-phase fix',
  )
  assert.equal(wrongPhase.falsePositives, 1, 'a fix on another PHASE does not back it either')
})

test('computeScorecard — an unbacked finding on a run that ended RED is not a false positive', () => {
  const { traces, gateFixes } = reviewerFixture({ backed: false })
  // 9151 is the phase whose finding no gate fix backs — put its run in the RED state, which is
  // the only difference from the false-positive test above.
  traces[0].phases.find((p) => p.phase === 9151).gateRuns[0].green = false

  const m = metricsOf(reviewerCell(computeScorecard(traces, gateFixes), { agent: 'code-reviewer' }), 'the code-reviewer cell')
  assert.equal(m.catches, 2, 'the finding still happened')
  assert.equal(m.falsePositives, 0, 'a run that never went green does not prove the finding was noise')
})

// ── 12. misses and recall ─────────────────────────────────────────────────────────────
test('computeScorecard — an escape fix on a phase whose FINAL GREEN run was clean is a MISS for that reviewer', () => {
  // Every phase carries a findings-fixed round from quality-pass (backed by a gate fix, so a
  // catch rather than a false positive) and a clean round from code-reviewer. One escape fix
  // then lands on 9170: code-reviewer signed it clean and missed it; quality-pass did not.
  const phases = nPhases(5, (i) => ({
    phase: 9170 + i,
    rounds: [
      { round: 1, agent: 'quality-pass', verdict: 'findings-fixed' },
      { round: 2, agent: 'code-reviewer', verdict: 'clean' },
    ],
  }))
  const gateFixes = phases.map((p) => ({ phase: p.phase, round: 1 }))
  const sc = computeScorecard(
    [mkTrace(phases, { escapeFixes: [escapeFix('fix(cli): phase 9170 gate R3 — the escape')] })],
    gateFixes,
  )

  assertMetricKeys(reviewerCell(sc, { agent: 'code-reviewer' }), REVIEWER_METRIC_KEYS, 'the missing reviewer')
  const missed = metricsOf(reviewerCell(sc, { agent: 'code-reviewer' }), 'the code-reviewer cell')
  assert.equal(missed.catches, 0, 'code-reviewer signed off clean five times')
  assert.equal(missed.misses, 1, 'the escape landed on a phase it called clean')
  assert.equal(missed.recall, 0, '0 catches out of 1 catchable defect — a measured zero, not a sentinel')
  assert.equal(typeof missed.recall, 'number', 'a computable recall is a number')

  const caught = metricsOf(reviewerCell(sc, { agent: 'quality-pass' }), 'the quality-pass cell')
  assert.equal(caught.catches, 5)
  assert.equal(caught.falsePositives, 0, 'every finding is backed by a gate fix')
  assert.equal(caught.misses, 0, 'a reviewer who did NOT sign the escaping phase clean is not charged for the escape')
  assert.equal(caught.recall, 1, '5 catches, 0 misses')
})

test('computeScorecard — the miss is charged on the FINAL GREEN run, not on an earlier red one', () => {
  const phases = nPhases(5, (i) => ({
    phase: 9180 + i,
    gateRuns: [
      // An earlier run where code-reviewer DID find something, then a later green run it cleared.
      { startedAt: T0, green: false, rounds: [{ round: 1, agent: 'code-reviewer', verdict: 'findings-fixed' }], slotFailures: 0 },
      { startedAt: T0, green: true, rounds: [{ round: 2, agent: 'code-reviewer', verdict: 'clean' }], slotFailures: 0 },
    ],
  }))
  const sc = computeScorecard(
    [mkTrace(phases, { escapeFixes: [escapeFix('fix(cli): phase 9182 gate R4 — the escape')] })],
    [{ phase: 9180, round: 1 }, { phase: 9181, round: 1 }, { phase: 9182, round: 1 }, { phase: 9183, round: 1 }, { phase: 9184, round: 1 }],
  )
  const m = metricsOf(reviewerCell(sc, { agent: 'code-reviewer' }), 'the code-reviewer cell')
  assert.equal(m.catches, 5, 'the five red-run findings')
  assert.equal(m.misses, 1, 'the clean verdict on the FINAL GREEN run is what let the escape through')
  assert.equal(m.recall, 5 / 6, 'five catches over five catches plus one miss')
})

test('computeScorecard — an escape fix naming a phase this cohort never saw charges nobody', () => {
  const phases = nPhases(5, (i) => ({ phase: 9190 + i }))
  const sc = computeScorecard([mkTrace(phases, { escapeFixes: [escapeFix('fix(cli): phase 91900 gate R1 — a longer number')] })], [])
  const m = metricsOf(reviewerCell(sc, { agent: 'code-reviewer' }), 'the code-reviewer cell')
  assert.equal(m.misses, 0, "'phase 91900' must not attribute to phase 9190")
  assert.equal(m.recall, 0, 'no catches and no misses is still an honest zero-numerator recall')
  assert.equal(
    metricsOf(driverCell(sc, { model: DRIVER_A.model }), 'the driver of the unnamed-escape cohort').escapeFixesPerPhase,
    0,
    'and the driver is not charged either',
  )
})

// ── 13. findGateFixCommits: the argv stream ───────────────────────────────────────────
function recorder(impl) {
  const calls = []
  return {
    calls,
    exec: (file, args, opts) => {
      calls.push({ file, args, opts })
      return impl(file, args, opts)
    },
  }
}

const grepOf = (args) => args.filter((a) => String(a).startsWith('--grep='))

test('findGateFixCommits — ONE bounded `git log` per phase, -C repoRoot, subject format', () => {
  const subjects = {
    1001: 'fix(cli): phase 1001 gate R1 — the first round\nfix(cli): phase 1001 gate R2 — the second round\nfeat(cli): phase 1001 — 1001.3 land it',
    1002: 'fix(web): phase 1002 gate R1 — a console guard',
  }
  const r = recorder((_file, args) => {
    const grep = grepOf(args)[0] ?? ''
    const n = grep.match(/phase (\d+)/)?.[1]
    return { status: 0, stdout: subjects[n] ?? '', stderr: '' }
  })

  const pairs = findGateFixCommits('/repo/root', [1001, 1002], { exec: r.exec })

  // The argv stream, exactly: one call per phase, in phase order, each anchored to the repo.
  assert.equal(r.calls.length, 2, `one bounded log per phase, no more; got ${JSON.stringify(r.calls.map((c) => c.args))}`)
  r.calls.forEach((call, i) => {
    const n = [1001, 1002][i]
    assert.equal(call.file, 'git', `call ${i}: the binary is git`)
    assert.deepEqual(call.args.slice(0, 3), ['-C', '/repo/root', 'log'], `call ${i}: -C <repoRoot> log, never a cwd-dependent read`)
    assert.deepEqual(grepOf(call.args), [`--grep=phase ${n}`], `call ${i}: exactly one server-side bound, naming the phase`)
    assert.ok(
      call.args.includes('--format=%s'),
      `call ${i}: subjects only — the pairs are parsed from the subject line; got ${JSON.stringify(call.args)}`,
    )
  })
  assert.equal(
    r.calls.filter((c) => grepOf(c.args).length === 0).length,
    0,
    'an unbounded full-history log would overrun the exec buffer on a real repo',
  )

  assert.deepEqual(
    [...pairs].sort((a, b) => a.phase - b.phase || a.round - b.round),
    [{ phase: 1001, round: 1 }, { phase: 1001, round: 2 }, { phase: 1002, round: 1 }],
    'exactly the gate-fix pairs — the plain feat commit carries no gate round and is not one',
  )
})

test('findGateFixCommits — the digit boundary holds: `phase 20150` is not phase 2015', () => {
  const r = recorder(() => ({
    status: 0,
    stdout: [
      'fix(cli): phase 20150 gate R1 — a decoy from another arc',
      'fix(cli): phase 2015 gate R2 — the real one',
      'chore(cli): mentions phase 2015 gate R9 in passing but is phase 2016 work',
    ].join('\n'),
    stderr: '',
  }))

  const pairs = findGateFixCommits('/repo/root', [2015], { exec: r.exec })
  assert.equal(pairs.filter((p) => p.phase === 20150).length, 0, 'the five-digit neighbour is never returned')
  assert.deepEqual(
    pairs.filter((p) => p.phase === 2015).map((p) => p.round).sort(),
    [2, 9],
    'both subjects that name phase 2015 at a digit boundary are pairs; the 20150 line is not',
  )
})

test('findGateFixCommits — a non-zero exec status yields NO pairs and never throws', () => {
  const r = recorder(() => ({ status: 128, stdout: '', stderr: 'fatal: not a git repository' }))
  const pairs = findGateFixCommits('/nowhere', [1001, 1002], { exec: r.exec })
  assert.deepEqual(pairs, [], 'a failed scan reports nothing — the caller must not read it as a clean gate')
  assert.equal(r.calls.length, 2, 'and the second phase is still attempted rather than aborting the sweep')
})

test('findGateFixCommits — one failing phase does not take the succeeding phase down with it', () => {
  const r = recorder((_file, args) =>
    grepOf(args)[0]?.includes('1001')
      ? { status: 1, stdout: '', stderr: 'boom' }
      : { status: 0, stdout: 'fix(cli): phase 1002 gate R3 — survived', stderr: '' },
  )
  assert.deepEqual(findGateFixCommits('/repo/root', [1001, 1002], { exec: r.exec }), [{ phase: 1002, round: 3 }])
})

test('findGateFixCommits — no phases means no git calls at all', () => {
  const r = recorder(() => ({ status: 0, stdout: '', stderr: '' }))
  assert.deepEqual(findGateFixCommits('/repo/root', [], { exec: r.exec }), [])
  assert.equal(r.calls.length, 0, 'an empty member list must not fall back to an unbounded log')
})

// ── 14. the envelope ──────────────────────────────────────────────────────────────────
test('computeScorecard — generatedAt and nFloor ride into the output verbatim', () => {
  const pinned = '2026-07-28T09:15:00.000Z'
  const sc = computeScorecard([mkTrace(nPhases(6))], [], { generatedAt: pinned, nFloor: 3 })

  assert.equal(sc.generatedAt, pinned, 'an injected clock survives untouched, or the projection is not reproducible')
  assert.equal(sc.nFloor, 3, 'the floor the table was computed against is reported with it')
  assert.deepEqual(Object.keys(sc).sort(), ['drivers', 'generatedAt', 'nFloor', 'notes', 'reviewers'].sort())
  assert.ok(Array.isArray(sc.drivers) && Array.isArray(sc.reviewers), 'drivers and reviewers are always arrays')
  assert.ok(Array.isArray(sc.notes), 'notes is always an array, even with nothing to name')

  const { generatedAt } = computeScorecard([mkTrace(nPhases(6))], [])
  assert.match(generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, 'the default clock is an ISO datetime')
  assert.ok(Number.isFinite(Date.parse(generatedAt)), 'and a real instant')
})

test('computeScorecard — no traces yields empty tables, never a table of zeros', () => {
  const sc = computeScorecard([], [])
  assert.deepEqual(sc.drivers, [], 'no phases ⇒ no driver cells to rank')
  assert.deepEqual(sc.reviewers, [], 'no rounds ⇒ no reviewer cells')
  assert.equal(sc.nFloor, SCORECARD_N_FLOOR)
})
