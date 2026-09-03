#!/usr/bin/env node
/**
 * Behavioral contract for the pre-registered GRAFT trial report.
 *
 * There is no `testConventions` key in roadmap/roadmap.config.json. Conventions are
 * inferred from the nearest relevant suites, eval-collect.test.mjs and
 * eval-scorecard.test.mjs: node:test, strict assertions, and real schema-backed fixtures.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCORECARD_N_FLOOR } from '../plugins/zeroh-roadmap/cli/lib/eval-scorecard.mjs'
import { bandFor, surfaceOf } from '../plugins/zeroh-roadmap/cli/lib/eval-score.mjs'
import { buildTrialReport, formatTrialReport, main } from './graft-trial-report.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const CONSUMER_SCHEMA = join(REPO_ROOT, 'lib', 'roadmap', 'schema.ts')

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'graft-trial-report-'))
  const evalDir = join(root, 'roadmap', 'arc-evals')
  mkdirSync(evalDir, { recursive: true })
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  symlinkSync(CONSUMER_SCHEMA, join(root, 'lib', 'roadmap', 'schema.ts'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, evalDir }
}

function record(phase, overrides = {}) {
  const metrics = {
    commits: 1,
    linesAdded: 10,
    linesRemoved: 2,
    filesChanged: 2,
    testsAtStart: 10,
    testsAtEnd: 11,
    testsAdded: 1,
    startedAt: '2026-08-01T10:00:00.000Z',
    completedAt: '2026-08-01T10:30:00.000Z',
    haltCount: 0,
    ...(overrides.metrics ?? {}),
  }
  for (const key of overrides.omitMetrics ?? []) delete metrics[key]

  return {
    phase,
    date: '2026-08-01',
    consumerFingerprint: { repo: 'fixture', language: 'javascript', corpusSize: 1 },
    taskCount: overrides.taskCount ?? 4,
    keyFiles: overrides.keyFiles ?? ['cli/report.mjs'],
    gate: {
      green: overrides.green ?? true,
      slots: overrides.slots ?? [{ slot: 'unit', exitCode: 0, durationMs: overrides.unitMs ?? 100 }],
    },
    metrics,
  }
}

function writeRecord(evalDir, doc) {
  const path = join(evalDir, `phase-${doc.phase}.peval.json`)
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`)
  return path
}

function cell(report, arm, band, surface) {
  return report.cells.find((candidate) =>
    candidate.arm === arm && candidate.band === band && candidate.surface === surface)
}

test('buildTrialReport splits at the exact cut and cohorts with the plugin helpers', (t) => {
  const { root, evalDir } = fixture(t)
  const atCut = record(25, { taskCount: 3, keyFiles: ['web/panel.tsx'] })
  const afterCut = record(26, { taskCount: 7, keyFiles: ['cli/report.mjs'] })
  writeRecord(evalDir, atCut)
  writeRecord(evalDir, afterCut)

  const report = buildTrialReport(root, { cut: 25 })
  const baseline = cell(report, 'baseline', bandFor(atCut.taskCount), surfaceOf(atCut))
  const treatment = cell(report, 'treatment', bandFor(afterCut.taskCount), surfaceOf(afterCut))

  assert.deepEqual(baseline, {
    arm: 'baseline', band: bandFor(atCut.taskCount), surface: surfaceOf(atCut),
    n: 1, phases: [25], abstain: true,
  }, 'phase === cut is baseline and is keyed by the shared band/surface helpers')
  assert.deepEqual(treatment, {
    arm: 'treatment', band: bandFor(afterCut.taskCount), surface: surfaceOf(afterCut),
    n: 1, phases: [26], abstain: true,
  }, 'phase > cut is treatment and remains in its distinct cohort')
})

test('an under-floor cell abstains structurally and renders no metric numbers', (t) => {
  const { root, evalDir } = fixture(t)
  const n = SCORECARD_N_FLOOR - 1
  for (let i = 0; i < n; i += 1) writeRecord(evalDir, record(101 + i, { unitMs: 987654 }))

  const report = buildTrialReport(root, { cut: 100 })
  const treatment = cell(report, 'treatment', bandFor(4), false)
  assert.deepEqual(Object.keys(treatment).sort(), ['abstain', 'arm', 'band', 'n', 'phases', 'surface'])
  assert.equal(treatment.n, n)
  assert.equal(treatment.abstain, true)

  const rendered = formatTrialReport(report)
  assert.match(rendered, new RegExp(`ABSTAIN\\(n=${n}\\)`))
  assert.doesNotMatch(rendered, /987654|medianSpanMinutes|haltRate|unitSlotMedianMs|greenRate/)
})

test('non-abstaining metrics preserve honest absence in halt and span denominators', (t) => {
  const { root, evalDir } = fixture(t)
  for (let i = 0; i < SCORECARD_N_FLOOR; i += 1) {
    writeRecord(evalDir, record(201 + i, {
      unitMs: (i + 1) * 100,
      green: i !== 0,
      metrics: { completedAt: `2026-08-01T10:${String(10 + i * 10).padStart(2, '0')}:00.000Z` },
      omitMetrics: ['haltCount', ...(i === 0 ? ['startedAt'] : [])],
    }))
  }

  const report = buildTrialReport(root, { cut: 200 })
  const treatment = cell(report, 'treatment', bandFor(4), false)
  assert.deepEqual(treatment, {
    arm: 'treatment', band: bandFor(4), surface: false,
    n: SCORECARD_N_FLOOR, phases: Array.from({ length: SCORECARD_N_FLOOR }, (_, i) => 201 + i),
    abstain: false,
    medianSpanMinutes: 35,
    haltRate: 'no-halt-evidence',
    unitSlotMedianMs: 300,
    greenRate: (SCORECARD_N_FLOOR - 1) / SCORECARD_N_FLOOR,
  })
})

test('missing haltCount stays out of a partially evidenced halt denominator', (t) => {
  const { root, evalDir } = fixture(t)
  for (let i = 0; i < SCORECARD_N_FLOOR; i += 1) {
    writeRecord(evalDir, record(301 + i, {
      metrics: i < 2 ? { haltCount: i } : {},
      omitMetrics: i < 2 ? [] : ['haltCount'],
    }))
  }

  const treatment = cell(buildTrialReport(root, { cut: 300 }), 'treatment', bandFor(4), false)
  assert.equal(treatment.haltRate, 0.5, 'one halted phase over the two records carrying halt evidence')
  assert.notEqual(treatment.haltRate, 1 / SCORECARD_N_FLOOR, 'absent haltCount is not silently read as zero')
})

test('malformed input throws loudly with the offending file and no partial report', (t) => {
  const { root, evalDir } = fixture(t)
  writeRecord(evalDir, record(401))
  const badPath = join(evalDir, 'phase-402.peval.json')
  writeFileSync(badPath, '{ definitely not JSON')

  assert.throws(
    () => buildTrialReport(root, { cut: 401 }),
    (error) => {
      assert.match(String(error?.message), new RegExp(badPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      return true
    },
    'a malformed sibling must abort rather than return the valid phase as a partial result',
  )
})

test('formatted cells print their member phases for transition-phase auditability', (t) => {
  const { root, evalDir } = fixture(t)
  writeRecord(evalDir, record(7))
  writeRecord(evalDir, record(26))

  const rendered = formatTrialReport(buildTrialReport(root, { cut: 25 }))
  assert.match(rendered, /baseline[^\n]*7|7[^\n]*baseline/i)
  assert.match(rendered, /treatment[^\n]*26|26[^\n]*treatment/i)
})

test('excluded transition phases leave BOTH arms and the aggregates they would have moved', (t) => {
  const { root, evalDir } = fixture(t)
  // Four clean baseline members plus the transition phase, so including phase 7 both
  // lifts the cell over the floor AND moves the median — the contamination this flag exists
  // to stop. Spans: 20,30,40,50 clean (median 35) and 300 for the transition phase.
  const spans = [20, 30, 40, 50]
  spans.forEach((mins, i) => writeRecord(evalDir, record(11 + i, {
    metrics: { completedAt: `2026-08-01T${String(10 + Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00.000Z` },
  })))
  writeRecord(evalDir, record(7, { metrics: { completedAt: '2026-08-01T15:00:00.000Z' } }))

  const contaminated = buildTrialReport(root, { cut: 25 })
  const dirty = contaminated.cells.find((c) => c.arm === 'baseline' && !c.abstain)
  assert.equal(dirty.n, SCORECARD_N_FLOOR, 'the transition phase is what carries this cell over the floor')
  assert.ok(dirty.phases.includes(7))

  const clean = buildTrialReport(root, { cut: 25, exclude: [7] })
  const cell7 = clean.cells.find((c) => c.arm === 'baseline')
  assert.ok(!cell7.phases.includes(7), 'an excluded phase is dropped before bucketing')
  assert.equal(cell7.n, spans.length)
  assert.equal(cell7.abstain, true, 'dropping it puts the cell back under the floor, so it must abstain')
  assert.notDeepEqual(clean.cells, contaminated.cells, 'exclusion must actually change the aggregates')
})

test('an exclusion is reported, never silently applied', (t) => {
  const { root, evalDir } = fixture(t)
  writeRecord(evalDir, record(7))
  writeRecord(evalDir, record(26))

  const rendered = formatTrialReport(buildTrialReport(root, { cut: 25, exclude: [26, 7] }))
  assert.match(rendered, /excluded from both arms: phase 7, 26/)
  assert.equal(main(['--cut', '25', '--exclude', '7,26', '--root', root]), 0)
})

test('a malformed --exclude FAILS rather than silently reinstating the phases', (t) => {
  const { root, evalDir } = fixture(t)
  for (let i = 0; i < SCORECARD_N_FLOOR; i += 1) writeRecord(evalDir, record(11 + i))
  writeRecord(evalDir, record(7))

  // Each of these once produced exclude=[] and exited 0, printing the contaminated cell
  // under a command line that reads as though it asked for a clean one.
  for (const argv of [
    ['--cut', '25', '--exclude', '--root', root],
    ['--cut', '25', '--exclude', '', '--root', root],
    ['--cut', '25', '--exclude', '7,', '--root', root],
    ['--cut', '25', '--exclude', '7,,26', '--root', root],
  ]) {
    assert.equal(main(argv), 2, `${argv.join(' ')} must be a usage error, never a silent no-op`)
  }
  assert.equal(main(['--cut', '25', '--exclude', '7', '--root', root]), 0, 'the well-formed form still works')
})

test('the exclusion note reports what was DROPPED, never merely what was asked for', (t) => {
  const { root, evalDir } = fixture(t)
  writeRecord(evalDir, record(7))

  const present = formatTrialReport(buildTrialReport(root, { cut: 25, exclude: [7] }))
  assert.match(present, /excluded from both arms: phase 7$/m)

  // Phase 26 is legitimately absent today (its record does not exist yet), so requesting it
  // must not claim a subtraction that never happened.
  const partly = formatTrialReport(buildTrialReport(root, { cut: 25, exclude: [7, 26] }))
  assert.match(partly, /excluded from both arms: phase 7 \(requested 7, 26; no record in this corpus for 26\)/)

  const none = formatTrialReport(buildTrialReport(root, { cut: 25, exclude: [999] }))
  assert.match(none, /excluded from both arms: nothing matched \(requested 999; no record in this corpus for 999\)/)
  assert.doesNotMatch(none, /excluded from both arms: phase 999/)
})

test('a non-integer exclusion is refused rather than silently ignored', (t) => {
  const { root, evalDir } = fixture(t)
  writeRecord(evalDir, record(7))

  assert.throws(
    () => buildTrialReport(root, { cut: 25, exclude: ['7'] }),
    /--exclude takes integer phase numbers/,
    'a string phase id would silently match nothing and quietly re-contaminate the arm',
  )
})

test('CLI smoke exits zero when every treatment cohort abstains', (t) => {
  const { root, evalDir } = fixture(t)
  for (let i = 0; i < SCORECARD_N_FLOOR; i += 1) writeRecord(evalDir, record(501 + i))
  writeRecord(evalDir, record(601, { taskCount: 2 }))
  writeRecord(evalDir, record(602, { taskCount: 7, keyFiles: ['web/view.tsx'] }))

  assert.equal(main(['--cut', '550', '--root', root]), 0)
})
