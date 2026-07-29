#!/usr/bin/env node
/**
 * eval-propose.test.mjs (phase 2016.2) covers the ELICIT stage's clustering pass: the one
 * implementation that turns the committed eval corpus (dated arc-eval reports plus the lessons
 * sidecar) into recurring findings grouped under a CLOSED class vocabulary. Three properties
 * make that pass honest rather than merely productive:
 *
 *  - TYPED KEYS ONLY. Every cluster key is read off a structured field (a ratchet row's
 *    dimension, a dimension's sentinel, a lesson's extracted token, a workflow profile), never
 *    off free text, so two runs over the same corpus emit identical clusters. Test 7 asserts
 *    that directly with a deep-equal of two independent passes.
 *  - THE >=2 FLOOR, WITH THE SINGLETON COUNTED BY NAME. One observation is an anecdote, so it
 *    emits nothing. It must still be REPORTED: a silent drop is how a loop loses the finding it
 *    existed to surface. Same for a cluster whose home lane cannot be derived.
 *  - THE SENTINEL DISTINCTION. `pending-judge` is a PROMISE of a coming judge pass, not a
 *    measurement gap, so it produces no finding at all, while every other sentinel does. The
 *    fixture plants pending-judge on the SAME dimension that carries the unjudged-backfill
 *    cluster, so a skip that keyed on the dimension instead of the sentinel is caught.
 *
 * Conventions: this plugin has no `testConventions` key in a roadmap.config.json, so they are
 * inferred from the nearest siblings, cli/lib/eval-scorecard.test.mjs and cli/lib/eval-score.
 * test.mjs (node:test, node:assert/strict, one fixture definition mutated or reused by copy,
 * every absence asserted by an explicit compare rather than a negative grep). The corpus itself
 * lives in cli/testdata/eval-proposals/ behind ONE loader so a later command-level test reuses
 * the same planted facts.
 *
 * Run: node --test cli/lib/eval-propose.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { FIXTURE_DIR, FIXTURE_FILES, REPORT_FILES, LESSONS_FILE, loadFixtureCorpus } from '../testdata/eval-proposals/load-fixture.mjs'
import { LOW_SCORE_THRESHOLD, PROTOCOL_LOAD_BUDGET_TOKENS, extractFindings, clusterFindings } from './eval-propose.mjs'

// ── the closed vocabularies, restated as the anchor the pass must hit ──────────────────

const FINDING_CLASSES = [
  'recurring-regression',
  'recurring-sentinel',
  'recurring-low-score',
  'recurring-lesson-key',
  'protocol-load-over-budget',
]

const LANES = ['plugin-generic', 'consumer-specific']

/**
 * Every cluster the fixture corpus must emit, with the lane and kind its class routes to and the
 * number of independent sources behind it. This table is the spine of tests 1, 4, 6 and 10: lane
 * routing and kind routing are asserted for all five classes by walking it, so a class that
 * silently stopped emitting cannot hide behind another class's green row.
 */
const EXPECTED_CLUSTERS = [
  { findingClass: 'recurring-regression', clusterKey: 'speed', lane: 'consumer-specific', kind: 'review-focus-candidate', evidence: 3 },
  { findingClass: 'recurring-sentinel', clusterKey: 'standards-adherence:unjudged-backfill', lane: 'plugin-generic', kind: 'schema-tightening', evidence: 2 },
  { findingClass: 'recurring-low-score', clusterKey: 'code-confidence', lane: 'consumer-specific', kind: 'review-focus-candidate', evidence: 2 },
  { findingClass: 'recurring-lesson-key', clusterKey: 'cli/lib/eval-score.mjs', lane: 'plugin-generic', kind: 'process-change', evidence: 2 },
  { findingClass: 'recurring-lesson-key', clusterKey: 'skills/do-arc/skill.md', lane: 'plugin-generic', kind: 'process-change', evidence: 2 },
  { findingClass: 'recurring-lesson-key', clusterKey: 'src/relay/governed-turn.ts', lane: 'consumer-specific', kind: 'process-change', evidence: 2 },
  { findingClass: 'protocol-load-over-budget', clusterKey: 'prod-grade', lane: 'plugin-generic', kind: 'reduction', evidence: 2 },
]

/** The five planted one-source findings. Each is counted, and each is absent from `clusters`. */
const EXPECTED_SINGLETONS = [
  { findingClass: 'recurring-regression', clusterKey: 'doc-brevity' },
  { findingClass: 'recurring-sentinel', clusterKey: 'verified-vs-intent:no-verdicts-file' },
  { findingClass: 'recurring-low-score', clusterKey: 'plan-quality' },
  { findingClass: 'recurring-lesson-key', clusterKey: 'roadmap/backlog.ts' },
  { findingClass: 'protocol-load-over-budget', clusterKey: 'fast-lane' },
]

/** Findings the corpus must yield per class, so an invented extra finding fails somewhere. */
const EXPECTED_FINDINGS_PER_CLASS = {
  'recurring-regression': 4, // speed x3, doc-brevity x1
  'recurring-sentinel': 3, // unjudged-backfill x2, no-verdicts-file x1; pending-judge x2 produce NOTHING
  'recurring-low-score': 3, // code-confidence x2, plan-quality x1; the two exactly-70 scores produce nothing
  'recurring-lesson-key': 9, // 2 + 2 + 2 + 2 + 1 across the sidecar's nine lines
  'protocol-load-over-budget': 3, // 12499, 13200, 15000; the exactly-12000 report and the block-less report produce nothing
}

const NO_LANE_LESSON_KEY = 'capbuild'
const REGRESSION_DIMENSION = 'speed'
const SENTINEL_DIMENSION = 'standards-adherence'

// ── helpers ───────────────────────────────────────────────────────────────────────────

/** One full pass over the planted corpus: extract, then cluster. */
function runPass() {
  const { reports, lessons } = loadFixtureCorpus()
  return clusterFindings(extractFindings(reports, lessons))
}

const findFindings = (findings, findingClass, clusterKey) =>
  findings.filter((f) => f.findingClass === findingClass && f.clusterKey === clusterKey)

const findCluster = (result, findingClass, clusterKey) =>
  result.clusters.find((c) => c.findingClass === findingClass && c.clusterKey === clusterKey)

const clusterIds = (result) => result.clusters.map((c) => `${c.findingClass}/${c.clusterKey}`).sort()

/** A missing cluster must read as a NAMED failure listing what WAS emitted, not a TypeError. */
function needCluster(result, findingClass, clusterKey) {
  const c = findCluster(result, findingClass, clusterKey)
  assert.ok(c, `expected a cluster for ${findingClass} / ${clusterKey}; emitted: ${JSON.stringify(clusterIds(result))}`)
  return c
}

/** A minimal but real-shaped report, for the two boundary tests that need their own corpus. */
const mkReport = (arcId, date, o = {}) => ({
  arcId,
  date,
  dimensions: o.dimensions ?? {},
  ratchet: o.ratchet ?? [],
  profile: o.profile ?? 'prod-grade',
  notes: [],
  ...(o.workflow === undefined ? {} : { workflow: o.workflow }),
})

const scoredDimension = (score) => ({ owner: 'judge', score, signals: { testsAdded: 1 }, sourceRefs: ['roadmap/phases/phase-9999.phase.ts'] })

// ── 0. the fixture is what the table above claims ─────────────────────────────────────
// Read off the RAW corpus, not off the module under test: if this test fails, the fixture drifted
// and every other failure in this file is a false red about the implementation.

test('fixture preconditions: the planted corpus carries exactly the rows the expectation tables name', () => {
  const { reports, lessons } = loadFixtureCorpus()
  assert.equal(reports.length, 5, 'five dated reports')
  assert.equal(lessons.length, 9, 'nine lesson lines')

  const regressions = {}
  const sentinels = {}
  const lowScores = {}
  const overBudget = {}
  let exactlyAtScoreThreshold = 0
  let exactlyAtTokenBudget = 0
  let withoutWorkflow = 0

  for (const r of reports) {
    for (const row of r.ratchet) if (row.regression === true) regressions[row.dimension] = (regressions[row.dimension] ?? 0) + 1
    for (const [dim, d] of Object.entries(r.dimensions)) {
      if (d.sentinel) {
        assert.equal(d.score, undefined, `${r.arcId}/${dim}: a sentinelled dimension carries no score`)
        const key = `${dim}:${d.sentinel}`
        sentinels[key] = (sentinels[key] ?? 0) + 1
      } else if (d.score < LOW_SCORE_THRESHOLD) lowScores[dim] = (lowScores[dim] ?? 0) + 1
      else if (d.score === LOW_SCORE_THRESHOLD) exactlyAtScoreThreshold += 1
    }
    if (!r.workflow) withoutWorkflow += 1
    else if (r.workflow.protocolLoadTokens > PROTOCOL_LOAD_BUDGET_TOKENS)
      overBudget[r.workflow.profile] = (overBudget[r.workflow.profile] ?? 0) + 1
    else if (r.workflow.protocolLoadTokens === PROTOCOL_LOAD_BUDGET_TOKENS) exactlyAtTokenBudget += 1
  }

  assert.deepEqual(regressions, { speed: 3, 'doc-brevity': 1 }, 'one >=2 regression cluster and one singleton')
  assert.deepEqual(
    sentinels,
    { 'standards-adherence:unjudged-backfill': 2, 'standards-adherence:pending-judge': 2, 'verified-vs-intent:no-verdicts-file': 1 },
    'the skipped sentinel sits on the SAME dimension as the clustered one, which is what makes test 3 meaningful',
  )
  assert.deepEqual(lowScores, { 'code-confidence': 2, 'plan-quality': 1 }, 'one >=2 low-score cluster and one singleton')
  assert.deepEqual(overBudget, { 'prod-grade': 2, 'fast-lane': 1 }, 'one >=2 over-budget cluster and one singleton')
  assert.equal(exactlyAtScoreThreshold, 2, 'two dimensions sit EXACTLY on the low-score threshold')
  assert.equal(exactlyAtTokenBudget, 1, 'one report sits EXACTLY on the token budget')
  assert.equal(withoutWorkflow, 1, 'one report carries no workflow block at all')

  // Each lesson carries exactly ONE slash-bearing token, so a path-first extractor and a
  // backtick-first extractor read the same key and this file pins behaviour, not an accident.
  for (const [i, l] of lessons.entries()) {
    const pathish = l.text.match(/\S*\/\S*/g) ?? []
    assert.ok(pathish.length <= 1, `lesson ${i}: at most one path-shaped token, got ${JSON.stringify(pathish)}`)
    assert.equal((l.text.match(/`/g) ?? []).length, 2, `lesson ${i}: exactly one backticked token`)
  }
})

// ── 1. the acceptance criterion: what is emitted, and the >=2 + lane invariant ─────────

test('clusterFindings — the fixture emits exactly the expected clusters, each with >=2 evidence and a real lane', () => {
  const result = runPass()

  assert.deepEqual(
    clusterIds(result),
    EXPECTED_CLUSTERS.map((c) => `${c.findingClass}/${c.clusterKey}`).sort(),
    'exactly the planted >=2 clusters, no more (an extra one is an invented finding) and no fewer',
  )

  // The invariant over the WHOLE run, not one hand-picked cluster.
  for (const c of result.clusters) {
    const label = `${c.findingClass}/${c.clusterKey}`
    assert.ok(Array.isArray(c.evidence), `${label}: evidence is an array`)
    assert.ok(c.evidence.length >= 2, `${label}: the >=2 floor is structural, got ${c.evidence.length}`)
    assert.equal(typeof c.lane, 'string', `${label}: the lane is a string`)
    assert.notEqual(c.lane, '', `${label}: an empty lane is a lane-less proposal, which must never be emitted`)
    assert.ok(LANES.includes(c.lane), `${label}: the lane is one of the closed vocabulary, got ${JSON.stringify(c.lane)}`)
    assert.ok(FINDING_CLASSES.includes(c.findingClass), `${label}: the class is one of the closed vocabulary`)
  }

  for (const expected of EXPECTED_CLUSTERS) {
    const c = needCluster(result, expected.findingClass, expected.clusterKey)
    assert.equal(c.evidence.length, expected.evidence, `${expected.findingClass}/${expected.clusterKey}: one evidence entry per planted source`)
  }

  // The lesson-key clusters prove the lowercase normalization: `SKILL.md` and `skill.md` are one
  // key, so a raw-text grouping would have emitted two singletons here instead of this cluster.
  assert.equal(
    needCluster(result, 'recurring-lesson-key', 'skills/do-arc/skill.md').evidence.length,
    2,
    'the two spellings of the same skill file normalize to ONE key',
  )
})

test('extractFindings — one finding per class per source, and the skipped inputs produce none', () => {
  const { reports, lessons } = loadFixtureCorpus()
  const findings = extractFindings(reports, lessons)

  const perClass = {}
  for (const f of findings) {
    assert.ok(FINDING_CLASSES.includes(f.findingClass), `unknown finding class ${JSON.stringify(f.findingClass)}`)
    assert.equal(typeof f.clusterKey, 'string', 'every finding carries a typed cluster key')
    assert.notEqual(f.clusterKey, '', 'an empty cluster key would group unrelated findings together')
    perClass[f.findingClass] = (perClass[f.findingClass] ?? 0) + 1
  }
  assert.deepEqual(perClass, EXPECTED_FINDINGS_PER_CLASS, 'exactly the planted findings, class by class')
})

// ── 2. the singletons are counted, never emitted and never lost ───────────────────────

test('clusterFindings — every planted singleton is COUNTED and none of them reaches clusters', () => {
  const result = runPass()

  assert.equal(
    result.skippedSingletons,
    EXPECTED_SINGLETONS.length,
    `the five one-source findings are reported by count; a silent drop is how the loop loses a finding. Emitted: ${JSON.stringify(clusterIds(result))}`,
  )

  for (const s of EXPECTED_SINGLETONS) {
    assert.equal(
      findCluster(result, s.findingClass, s.clusterKey),
      undefined,
      `${s.findingClass}/${s.clusterKey}: a single observation is an anecdote and must not be emitted as a cluster`,
    )
  }

  // And the singleton keys really were extracted, so the count above is not a vacuous zero-in,
  // zero-out: each one exists as a FINDING and is dropped only at the clustering floor.
  const { reports, lessons } = loadFixtureCorpus()
  const findings = extractFindings(reports, lessons)
  for (const s of EXPECTED_SINGLETONS) {
    assert.equal(findFindings(findings, s.findingClass, s.clusterKey).length, 1, `${s.findingClass}/${s.clusterKey}: extracted exactly once`)
  }
})

// ── 3. the sentinel distinction ───────────────────────────────────────────────────────

test('extractFindings — pending-judge yields NO finding while unjudged-backfill on the SAME dimension clusters', () => {
  const { reports, lessons } = loadFixtureCorpus()
  const findings = extractFindings(reports, lessons)
  const result = clusterFindings(findings)

  const pending = findings.filter((f) => String(f.clusterKey).includes('pending-judge'))
  assert.deepEqual(pending, [], 'pending-judge is a PROMISE of a coming judge pass, not a measurement gap, so it is not a finding')
  assert.equal(findCluster(result, 'recurring-sentinel', `${SENTINEL_DIMENSION}:pending-judge`), undefined, 'and it reaches no cluster')

  // The positive half on the same dimension: had the skip keyed on the dimension rather than on
  // the sentinel, this cluster would have vanished with it.
  const backfill = needCluster(result, 'recurring-sentinel', `${SENTINEL_DIMENSION}:unjudged-backfill`)
  assert.equal(backfill.evidence.length, 2, 'the two unjudged-backfill reports on that same dimension still cluster')

  // A pending-judge report is not merely unclustered, it is not counted as a skipped singleton
  // either: the two pending-judge rows would otherwise inflate skippedSingletons past five.
  assert.equal(result.skippedSingletons, EXPECTED_SINGLETONS.length, 'a non-finding is not a skipped singleton')
})

// ── 4. lane routing, per class ────────────────────────────────────────────────────────

test('clusterFindings — lane routing holds for ALL FIVE classes, including both lesson-key homes', () => {
  const result = runPass()

  assert.deepEqual(
    [...new Set(EXPECTED_CLUSTERS.map((c) => c.findingClass))].sort(),
    [...FINDING_CLASSES].sort(),
    'the expectation table covers every class, so no class can skip this assertion',
  )

  for (const expected of EXPECTED_CLUSTERS) {
    const c = needCluster(result, expected.findingClass, expected.clusterKey)
    assert.equal(c.lane, expected.lane, `${expected.findingClass}/${expected.clusterKey}: routed to its class's home lane`)
  }

  // The two lesson-key homes, named explicitly: the routing is by the KEY, not by the class, so
  // the same class must land in different lanes for different keys or the rule is not implemented.
  const pluginHome = needCluster(result, 'recurring-lesson-key', 'cli/lib/eval-score.mjs')
  const consumerHome = needCluster(result, 'recurring-lesson-key', 'src/relay/governed-turn.ts')
  const skillsHome = needCluster(result, 'recurring-lesson-key', 'skills/do-arc/skill.md')
  assert.equal(pluginHome.lane, 'plugin-generic', 'a cli/lib key lives in the plugin repo')
  assert.equal(skillsHome.lane, 'plugin-generic', 'a skills/ key lives in the plugin repo too')
  assert.equal(consumerHome.lane, 'consumer-specific', 'any other path-shaped key belongs to the consumer repo')
  assert.notEqual(pluginHome.lane, consumerHome.lane, 'one class, two homes: the key decides, not the class')
})

// ── 5. the un-homed cluster is refused and counted ────────────────────────────────────

test('clusterFindings — a bare backticked key with no path home emits NOTHING and increments skippedNoLane', () => {
  const { reports, lessons } = loadFixtureCorpus()
  const findings = extractFindings(reports, lessons)
  const result = clusterFindings(findings)

  // It cleared the >=2 floor, so the refusal is provably about the missing lane and nothing else.
  assert.equal(
    findFindings(findings, 'recurring-lesson-key', NO_LANE_LESSON_KEY).length,
    2,
    `two lessons share the bare token ${NO_LANE_LESSON_KEY}, so this group clears the evidence floor`,
  )
  assert.equal(
    findCluster(result, 'recurring-lesson-key', NO_LANE_LESSON_KEY),
    undefined,
    'a cluster with no derivable home lane is not ready to be a proposal and must not be emitted',
  )
  assert.equal(result.skippedNoLane, 1, 'and it is counted by name, exactly once, rather than silently dropped')
  assert.equal(
    result.clusters.filter((c) => c.lane === undefined || c.lane === null || c.lane === '').length,
    0,
    'no cluster escaped with an empty lane instead of being counted here',
  )
})

// ── 6. kind routing, per class ────────────────────────────────────────────────────────

test('clusterFindings — kind routing holds for ALL FIVE classes', () => {
  const result = runPass()
  for (const expected of EXPECTED_CLUSTERS) {
    const c = needCluster(result, expected.findingClass, expected.clusterKey)
    assert.equal(c.kind, expected.kind, `${expected.findingClass}/${expected.clusterKey}: the class's kind`)
  }

  // The pairs that share a kind and the pairs that must not, stated as a compare rather than a
  // list of independent equals: regression and low-score both propose a reviewFocus entry, while
  // a sentinel proposes a schema change and an over-budget load proposes a reduction.
  const kindOf = (findingClass, clusterKey) => needCluster(result, findingClass, clusterKey).kind
  assert.equal(kindOf('recurring-regression', 'speed'), kindOf('recurring-low-score', 'code-confidence'), 'both measured-slide classes propose a review focus')
  assert.notEqual(kindOf('recurring-sentinel', `${SENTINEL_DIMENSION}:unjudged-backfill`), kindOf('recurring-regression', 'speed'), 'a measurement gap is not a review-focus proposal')
  assert.notEqual(kindOf('protocol-load-over-budget', 'prod-grade'), kindOf('recurring-lesson-key', 'cli/lib/eval-score.mjs'), 'a diet reduction is not a process change')
})

// ── 7. determinism ────────────────────────────────────────────────────────────────────

test('extractFindings + clusterFindings — two independent runs over the same corpus are identical', () => {
  const first = runPass()
  const second = runPass()

  // Two empty results are also identical, so the comparison below only means something once the
  // pass has something to be reproducible ABOUT.
  assert.equal(first.clusters.length, EXPECTED_CLUSTERS.length, 'the run must emit the planted clusters, or the comparison below is vacuous')

  // deepStrictEqual, so cluster ORDER and evidence order are pinned too: a pass that emitted the
  // same set in a hash-dependent order would produce a churning diff on every re-run.
  assert.deepStrictEqual(second, first, 'the pass reads only typed fields, so the same corpus must yield byte-identical clusters')

  const { reports, lessons } = loadFixtureCorpus()
  assert.deepStrictEqual(extractFindings(reports, lessons), extractFindings(reports, lessons), 'extraction alone is deterministic')
})

// ── 8. the protocol-load budget boundary ──────────────────────────────────────────────

test('extractFindings — protocolLoadTokens EXACTLY at the budget is within budget, and a report with no workflow block contributes nothing', () => {
  assert.equal(PROTOCOL_LOAD_BUDGET_TOKENS, 12000, 'the DIET budget is a named export a reader can check the ledger against')

  const wf = (protocolLoadTokens) => ({ pluginVersion: '0.18.0', pluginSha: 'eeee11112222', protocolLoadTokens, profile: 'prod-grade' })
  const atBudget = extractFindings(
    [mkReport('ATB', '2026-07-10', { workflow: wf(PROTOCOL_LOAD_BUDGET_TOKENS) }), mkReport('ATC', '2026-07-11', { workflow: wf(PROTOCOL_LOAD_BUDGET_TOKENS) })],
    [],
  )
  assert.deepEqual(
    atBudget.filter((f) => f.findingClass === 'protocol-load-over-budget'),
    [],
    'exactly at the budget is not OVER the budget, so two such reports are still not a finding',
  )

  const overBudget = extractFindings(
    [mkReport('OVA', '2026-07-10', { workflow: wf(PROTOCOL_LOAD_BUDGET_TOKENS + 1) }), mkReport('OVB', '2026-07-11', { workflow: wf(PROTOCOL_LOAD_BUDGET_TOKENS + 1) })],
    [],
  )
  assert.equal(overBudget.filter((f) => f.findingClass === 'protocol-load-over-budget').length, 2, 'one token over the budget IS over the budget')

  const noWorkflow = extractFindings([mkReport('NWA', '2026-07-10'), mkReport('NWB', '2026-07-11')], [])
  assert.deepEqual(
    noWorkflow.filter((f) => f.findingClass === 'protocol-load-over-budget'),
    [],
    'a report that predates the workflow stamp records no token count, and an absent count is never a breach',
  )

  // The same two rails proven over the planted corpus: the boundary report (DELTA, exactly 12000)
  // and the stamp-less report (ECHO) are absent from the prod-grade cluster's citations.
  const cited = needCluster(runPass(), 'protocol-load-over-budget', 'prod-grade').evidence.map((e) => basename(String(e.file)))
  assert.deepEqual(cited.sort(), ['ALPHA-2026-07-01.json', 'BRAVO-2026-07-02.json'], 'only the two genuinely over-budget reports are cited')
})

// ── 9. the low-score boundary ─────────────────────────────────────────────────────────

test('extractFindings — a score EXACTLY at the threshold is not low, 69.9 is', () => {
  assert.equal(LOW_SCORE_THRESHOLD, 70, 'the threshold is a named export, not a magic number in the pass')

  const at = extractFindings(
    [
      mkReport('ATA', '2026-07-10', { dimensions: { 'doc-brevity': scoredDimension(LOW_SCORE_THRESHOLD) } }),
      mkReport('ATB', '2026-07-11', { dimensions: { 'doc-brevity': scoredDimension(LOW_SCORE_THRESHOLD) } }),
    ],
    [],
  )
  assert.deepEqual(
    at.filter((f) => f.findingClass === 'recurring-low-score'),
    [],
    'the threshold is STRICT: a dimension sitting exactly on 70 is not scoring below 70',
  )

  const below = extractFindings(
    [
      mkReport('BLA', '2026-07-10', { dimensions: { 'doc-brevity': scoredDimension(69.9) } }),
      mkReport('BLB', '2026-07-11', { dimensions: { 'doc-brevity': scoredDimension(69.9) } }),
    ],
    [],
  )
  assert.equal(below.filter((f) => f.findingClass === 'recurring-low-score').length, 2, 'a tenth of a point under the threshold is a finding')
  assert.equal(clusterFindings(below).clusters.length, 1, 'and two such reports cluster')

  // The planted corpus says the same thing at scale: composability-testability scores exactly 70
  // in two reports, which is a >=2 group under a non-strict comparison and nothing under a strict one.
  const result = runPass()
  assert.equal(findCluster(result, 'recurring-low-score', 'composability-testability'), undefined, 'two boundary scores are still not a low-score cluster')
})

// ── 10. every citation is re-openable ─────────────────────────────────────────────────

test('clusterFindings — every evidence citation names a real corpus file and a non-empty jsonPath', () => {
  const result = runPass()
  assert.ok(result.clusters.length > 0, 'the fixture must emit clusters, or this test is vacuous')

  for (const c of result.clusters) {
    for (const [i, e] of c.evidence.entries()) {
      const label = `${c.findingClass}/${c.clusterKey} evidence[${i}]`
      assert.equal(typeof e.file, 'string', `${label}: file is a string`)
      const name = basename(e.file)
      assert.ok(FIXTURE_FILES.includes(name), `${label}: file names a real corpus document, got ${JSON.stringify(e.file)}`)
      assert.ok(existsSync(join(FIXTURE_DIR, name)), `${label}: a reader can re-open ${name}`)

      assert.equal(typeof e.jsonPath, 'string', `${label}: jsonPath is a string`)
      assert.notEqual(e.jsonPath.trim(), '', `${label}: an empty jsonPath is a citation nobody can follow back`)
      assert.equal(typeof e.excerpt, 'string', `${label}: the excerpt is a string`)
      assert.notEqual(e.excerpt.trim(), '', `${label}: an empty excerpt cites nothing`)
    }

    // A report-backed cluster cites reports, a lesson-backed cluster cites the sidecar. Crossing
    // the two would mean the jsonPath is being read against the wrong document shape.
    const names = c.evidence.map((e) => basename(String(e.file)))
    const expectLessons = c.findingClass === 'recurring-lesson-key'
    for (const n of names) {
      assert.equal(
        n === LESSONS_FILE,
        expectLessons,
        `${c.findingClass}/${c.clusterKey}: ${expectLessons ? 'lesson findings cite the sidecar' : 'report findings cite a dated report'}, got ${n}`,
      )
      assert.equal(REPORT_FILES.includes(n), !expectLessons, `${c.findingClass}: ${n} is ${expectLessons ? 'not' : ''} one of the dated reports`)
    }

    // Evidence is at least two DISTINCT sources, not one source cited twice.
    const distinct = new Set(c.evidence.map((e) => `${e.file}#${e.jsonPath}`))
    assert.equal(distinct.size, c.evidence.length, `${c.findingClass}/${c.clusterKey}: every citation points at a different place`)
  }
})

// ══════════════════════════════════════════════════════════════════════════════════════
// phase 2016.3 — the OPPORTUNITY score: a static ratified importance, a MEASURED
// satisfaction, and no third source of numbers
//
// `opportunity = importance + max(importance - satisfaction, 0)` prioritizes every proposal, so
// the two inputs have to come from places that cannot drift:
//
//  - IMPORTANCE is compile-time DATA carrying a version and a date (the
//    SPEED_REFERENCE_MINUTES_PER_TASK precedent in cli/lib/eval-score.mjs). Two machines reading
//    one corpus must not produce incomparable priorities, and a re-prioritization must show up as
//    a diff in a versioned table rather than as a quietly different ordering.
//  - SATISFACTION is MEASURED from the corpus, per class. The one thing that must be impossible
//    is an UNMEASURABLE satisfaction inflating a score: a class the corpus cannot measure ranks on
//    importance alone and SAYS SO BY NAME (`satisfaction-unmeasured`), never on a stand-in zero,
//    which would read as "maximally unsatisfied" and float the proposal to the top of the queue.
//
// Every corpus below is hand-built so the WRONG reading yields a DIFFERENT number: each case says
// in a comment what the wrong implementation would have produced.
//
// The exports under test do not exist yet, so they are reached through a NAMESPACE import: a
// static named import of a missing export is a link-time SyntaxError that would red the whole
// file, including the twelve tests above, and hide which export is actually missing.
// ══════════════════════════════════════════════════════════════════════════════════════

import { z } from 'zod'
import * as evalPropose from './eval-propose.mjs'

/** Read a phase-2016.3 export, failing by NAME rather than as an opaque TypeError. */
function needExport(name) {
  const v = evalPropose[name]
  assert.ok(v !== undefined, `cli/lib/eval-propose.mjs must export ${name} (phase 2016.3)`)
  return v
}

const rulingsTable = () => needExport('IMPORTANCE_RULINGS')
const computeOpportunity = (cluster, reports) => needExport('computeOpportunity')(cluster, reports)

/** The v1 ruling per class, restated here so a silent re-prioritization reds this suite. */
const EXPECTED_IMPORTANCE = {
  'recurring-regression': 8,
  'recurring-low-score': 7,
  'recurring-sentinel': 6,
  'protocol-load-over-budget': 6,
  'recurring-lesson-key': 5,
}

/** The documented table shape, owned by the TEST: the spec, not a re-export of the code's view. */
const ImportanceRulingsTableShape = z.strictObject({
  version: z.number().int().positive(),
  ratified: z.string().min(10),
  rulings: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        findingClass: z.enum(FINDING_CLASSES),
        importance: z.number().min(0).max(10),
        rationale: z.string().min(10),
      }),
    )
    .min(1),
})

const sentinelDimension = (sentinel) => ({ owner: 'judge', sentinel, signals: {}, sourceRefs: ['roadmap/phases/phase-9999.phase.ts'] })

const regressionRow = (dimension, value) => ({ dimension, baseline: value + 10, value, delta: -10, regression: true, note: 'synthetic regression' })

const workflowBlock = (protocolLoadTokens, profile) => ({ pluginVersion: '0.18.0', pluginSha: 'cccc11112222', protocolLoadTokens, profile })

/** Cluster a hand-built corpus and score ONE of its clusters, so the cluster under test has the
 *  exact shape clusterFindings really emits rather than a shape invented by this file. */
function opportunityFrom(reports, lessons, findingClass, clusterKey) {
  const result = clusterFindings(extractFindings(reports, lessons))
  const cluster = needCluster(result, findingClass, clusterKey)
  return computeOpportunity(cluster, reports)
}

/** A corpus where `speed` regressed in two reports and is SCORED at `score` in both, so the
 *  measured satisfaction of the regression cluster is exactly `score / 10`. */
const speedCorpusAt = (score) => [
  mkReport('SPA', '2026-07-10', { dimensions: { speed: scoredDimension(score) }, ratchet: [regressionRow('speed', score)] }),
  mkReport('SPB', '2026-07-11', { dimensions: { speed: scoredDimension(score) }, ratchet: [regressionRow('speed', score)] }),
]

// ── 11. the formula itself, on knowns ─────────────────────────────────────────────────

test('computeOpportunity — importance 8 with satisfaction 3 scores 13, and the max(...,0) floor holds at and above importance', () => {
  const table = rulingsTable()
  assert.equal(EXPECTED_IMPORTANCE['recurring-regression'], 8, 'this test is written against importance 8')

  // satisfaction 3.0: a mean speed score of 30 across two reports. 8 + max(8-3,0) = 13.
  const low = opportunityFrom(speedCorpusAt(30), [], 'recurring-regression', 'speed')
  assert.equal(low.importance, 8, 'importance comes from the ratified table, not from the corpus')
  assert.equal(low.satisfaction, 3, 'mean of the scored speed values (30 and 30), divided by 10')
  assert.equal(low.score, 13, 'importance + max(importance - satisfaction, 0) = 8 + 5')
  assert.equal(low.rulingsVersion, table.version, 'the score carries the table version it was computed under')

  // satisfaction EXACTLY at importance: the gap term is zero, not a rounding artefact.
  const level = opportunityFrom(speedCorpusAt(80), [], 'recurring-regression', 'speed')
  assert.equal(level.satisfaction, 8, 'mean 80 => satisfaction 8')
  assert.equal(level.score, 8, 'satisfaction equal to importance contributes exactly nothing extra')
  assert.equal(level.score, level.importance, 'and the score is the bare importance')

  // satisfaction ABOVE importance: a well-served class must never score BELOW a class nobody has
  // measured. Without the floor this would be 8 + (8 - 9.5) = 6.5, a negative contribution.
  const high = opportunityFrom(speedCorpusAt(95), [], 'recurring-regression', 'speed')
  assert.equal(high.satisfaction, 9.5, 'mean 95 => satisfaction 9.5')
  assert.equal(high.score, 8, 'the floor clamps the gap at 0, so an over-satisfied class scores its importance')
  assert.notEqual(high.score, 6.5, 'a negative contribution would let satisfaction DEMOTE a class below its ruling')
})

// ── 12. a sentinelled report is EXCLUDED from the mean, and an all-sentinel dimension is null ──

test('computeOpportunity — a sentinelled dimension is excluded from the mean rather than counted as zero, and the source names the count it used', () => {
  // doc-brevity: scored 40 and 80, sentinelled once. Mean of the SCORED values is 60 => 6.0.
  // Counting the sentinelled report as a zero would give (40+80+0)/3 = 40 => 4.0, a different
  // number and a materially different score (8+4=12 instead of 8+2=10), so this corpus cannot
  // pass under both readings.
  const corpus = [
    mkReport('EXA', '2026-07-10', { dimensions: { 'doc-brevity': scoredDimension(40) }, ratchet: [regressionRow('doc-brevity', 40)] }),
    mkReport('EXB', '2026-07-11', { dimensions: { 'doc-brevity': scoredDimension(80) }, ratchet: [regressionRow('doc-brevity', 80)] }),
    mkReport('EXC', '2026-07-12', { dimensions: { 'doc-brevity': sentinelDimension('no-verdicts-file') }, ratchet: [regressionRow('doc-brevity', 0)] }),
  ]
  const o = opportunityFrom(corpus, [], 'recurring-regression', 'doc-brevity')
  assert.equal(o.satisfaction, 6, 'the mean is over the two SCORED values only; a sentinel is an absent measurement, not a zero')
  assert.equal(o.score, 10, '8 + max(8 - 6, 0)')

  // The provenance has to name the same count the arithmetic used, or a reader cannot check it.
  // Expected phrasing: `mean of <n> scored <dimension> values across <m> reports`.
  assert.equal(typeof o.satisfactionSource, 'string', 'satisfactionSource is a string')
  assert.match(o.satisfactionSource, /doc-brevity/, 'the source names the dimension it measured')
  assert.match(o.satisfactionSource, /\b2 scored\b/, 'the source says TWO scored values were averaged, the count the mean actually used')
  assert.match(o.satisfactionSource, /\b3 reports\b/, 'and names the corpus size it read, so the exclusion is visible as 2 of 3')
  assert.doesNotMatch(o.satisfactionSource, /\b3 scored\b/, 'the sentinelled report must not be reported as a scored value')

  // The degenerate end of the same rule: a dimension NOBODY ever scored is unmeasurable, not
  // maximally unsatisfied. A stand-in zero here would score 8 + 8 = 16 and float this cluster
  // above every genuinely measured one, which is the exact failure this rail exists to stop.
  const blind = [
    mkReport('BLA', '2026-07-10', { dimensions: { 'plan-quality': sentinelDimension('no-verdicts-file') }, ratchet: [regressionRow('plan-quality', 0)] }),
    mkReport('BLB', '2026-07-11', { dimensions: { 'plan-quality': sentinelDimension('no-verdicts-file') }, ratchet: [regressionRow('plan-quality', 0)] }),
  ]
  const unmeasured = opportunityFrom(blind, [], 'recurring-regression', 'plan-quality')
  assert.equal(unmeasured.satisfaction, null, 'zero scored values anywhere in the corpus means UNMEASURABLE, spelled null')
  assert.equal(unmeasured.score, 8, 'a null satisfaction scores the bare importance')
  assert.notEqual(unmeasured.score, 16, 'never importance doubled: an unmeasured class must not outrank a measured one on nothing')
  assert.notEqual(unmeasured.satisfaction, 0, 'and never a stand-in zero, which reads as "measured, and terrible"')
  assert.notEqual(unmeasured.satisfactionSource, '', 'the refusal is still named')
})

// ── 13. the class the corpus cannot measure at all ────────────────────────────────────

test('computeOpportunity — recurring-lesson-key is UNMEASURABLE: null satisfaction, score === importance, and the literal source', () => {
  const { reports, lessons } = loadFixtureCorpus()
  const o = opportunityFrom(reports, lessons, 'recurring-lesson-key', 'cli/lib/eval-score.mjs')

  assert.equal(o.importance, EXPECTED_IMPORTANCE['recurring-lesson-key'], 'the v1 ruling for a shared lesson key')
  assert.equal(o.satisfaction, null, 'no dimension backs a lesson key, so the corpus can measure no satisfaction for it')
  assert.equal(o.score, o.importance, 'a null satisfaction contributes nothing at all')
  assert.equal(o.score, 5, 'and that is exactly the importance, not importance + importance')
  assert.notEqual(o.score, 10, 'never importance*2: the gap term is undefined, not maximal')
  assert.equal(
    o.satisfactionSource,
    'satisfaction-unmeasured',
    'the unmeasured case is a NAMED sentinel a reader can grep, not free prose that varies per cluster',
  )
})

// ── 14. the rulings table is versioned, closed and exhaustive ─────────────────────────

test('IMPORTANCE_RULINGS — a versioned table with exactly one ruling per finding class and the v1 values pinned', () => {
  const table = rulingsTable()

  const parsed = ImportanceRulingsTableShape.parse(table)
  assert.equal(parsed.version, 1, 'v1 of the ruling table')
  assert.match(parsed.ratified, /^\d{4}-\d{2}-\d{2}$/, 'the ratification date is a real date a reader can find in the ledger')

  const classes = parsed.rulings.map((r) => r.findingClass)
  // Sorted compares, so a MISSING class and an EXTRA/duplicate class both red here: a duplicate
  // survives a set comparison but not this one.
  assert.deepEqual([...classes].sort(), [...FINDING_CLASSES].sort(), 'exactly one ruling per finding class, no more and no fewer')
  assert.equal(new Set(classes).size, classes.length, 'no class is ruled on twice, which would make the lookup order-dependent')

  const ids = parsed.rulings.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, 'every ruling id is unique, so provenance points at one row')

  // The VALUES, explicitly: a silent re-prioritization is a change to the queue every consumer
  // reads, and it must fail this suite instead of shipping as a different ordering.
  assert.deepEqual(
    Object.fromEntries(parsed.rulings.map((r) => [r.findingClass, r.importance])),
    EXPECTED_IMPORTANCE,
    'the ratified v1 importances',
  )
})

// ── 15. the sentinel class: coverage IS the satisfaction ──────────────────────────────

test('computeOpportunity — a sentinel cluster measures COVERAGE: a dimension scored in 2 of 5 reports satisfies 4', () => {
  // standards-adherence: sentinelled in three reports, scored 88 and 92 in the other two.
  // Coverage gives 10 * 2/5 = 4. The two wrong readings both land elsewhere: averaging the scored
  // values (the dimension-backed path) gives 9.0, and scored-over-sentinelled gives 10*2/3 = 6.67.
  const corpus = [
    mkReport('COA', '2026-07-10', { dimensions: { 'standards-adherence': sentinelDimension('unjudged-backfill') } }),
    mkReport('COB', '2026-07-11', { dimensions: { 'standards-adherence': sentinelDimension('unjudged-backfill') } }),
    mkReport('COC', '2026-07-12', { dimensions: { 'standards-adherence': sentinelDimension('unjudged-backfill') } }),
    mkReport('COD', '2026-07-13', { dimensions: { 'standards-adherence': scoredDimension(88) } }),
    mkReport('COE', '2026-07-14', { dimensions: { 'standards-adherence': scoredDimension(92) } }),
  ]
  const o = opportunityFrom(corpus, [], 'recurring-sentinel', 'standards-adherence:unjudged-backfill')

  assert.equal(o.importance, EXPECTED_IMPORTANCE['recurring-sentinel'], 'the v1 ruling for a recurring measurement gap')
  assert.equal(o.satisfaction, 4, '10 * (2 reports that SCORED the dimension / 5 reports)')
  assert.notEqual(o.satisfaction, 9, 'the mean of the scored values is not the satisfaction of a COVERAGE finding')
  assert.equal(o.score, 8, '6 + max(6 - 4, 0)')

  // Both counts named, so the ratio is checkable from the string alone.
  assert.match(o.satisfactionSource, /standards-adherence/, 'the source names the dimension whose coverage it measured')
  assert.match(o.satisfactionSource, /\b2\b/, 'the numerator: reports that scored the dimension')
  assert.match(o.satisfactionSource, /\b5\b/, 'the denominator: reports in the corpus')
})

// ── 16. the protocol-load class: budget over measured, clamped ────────────────────────

test('computeOpportunity — protocol load satisfies 10 * budget / measured mean, over the CLUSTER\'S OWN cited values', () => {
  // prod-grade over budget at 20000 and 28000 => mean 24000, satisfaction 10 * 12000/24000 = 5.
  // The corpus also carries a prod-grade report UNDER budget (6000) and a fast-lane outlier
  // (120000), neither of which the cluster cites: folding in the under-budget report gives a mean
  // of 18000 (satisfaction 6.67, score 6), and averaging every report gives 43500 (satisfaction
  // 2.76, score 9.24). Only the cited-values reading produces the 7 asserted below.
  const corpus = [
    mkReport('PLA', '2026-07-10', { workflow: workflowBlock(20000, 'prod-grade') }),
    mkReport('PLB', '2026-07-11', { workflow: workflowBlock(28000, 'prod-grade') }),
    mkReport('PLC', '2026-07-12', { workflow: workflowBlock(6000, 'prod-grade') }),
    mkReport('PLD', '2026-07-13', { workflow: workflowBlock(120000, 'fast-lane') }),
    mkReport('PLE', '2026-07-14', { workflow: workflowBlock(90000, 'fast-lane') }),
  ]
  const o = opportunityFrom(corpus, [], 'protocol-load-over-budget', 'prod-grade')

  assert.equal(PROTOCOL_LOAD_BUDGET_TOKENS, 12000, 'the budget this arithmetic is written against')
  assert.equal(o.importance, EXPECTED_IMPORTANCE['protocol-load-over-budget'], 'the v1 ruling for an over-budget protocol load')
  assert.equal(o.satisfaction, 5, '10 * 12000 / 24000: twice the budget is half satisfied')
  assert.equal(o.score, 7, '6 + max(6 - 5, 0)')
  assert.match(o.satisfactionSource, /12000/, 'the source names the budget the ratio is against')
  assert.match(o.satisfactionSource, /24000/, 'and the measured mean, so the ratio can be recomputed by hand')

  // The clamp. A ratio above 1 must saturate at 10 rather than emit an 11 or a 12 that would
  // break the documented 0..10 satisfaction range and make one class's score incomparable with
  // another's. Unclamped this would be 10 * 12000/10000 = 12.
  const underBudget = [
    mkReport('CLA', '2026-07-10', { workflow: workflowBlock(9000, 'prod-grade') }),
    mkReport('CLB', '2026-07-11', { workflow: workflowBlock(11000, 'prod-grade') }),
  ]
  const clamped = computeOpportunity(
    {
      findingClass: 'protocol-load-over-budget',
      clusterKey: 'prod-grade',
      lane: 'plugin-generic',
      kind: 'reduction',
      evidence: [
        {
          file: 'roadmap/arc-evals/CLA-2026-07-10.json',
          jsonPath: 'workflow.protocolLoadTokens',
          excerpt: `protocol load measured 9000 tokens against the ${PROTOCOL_LOAD_BUDGET_TOKENS} budget on profile prod-grade`,
        },
        {
          file: 'roadmap/arc-evals/CLB-2026-07-11.json',
          jsonPath: 'workflow.protocolLoadTokens',
          excerpt: `protocol load measured 11000 tokens against the ${PROTOCOL_LOAD_BUDGET_TOKENS} budget on profile prod-grade`,
        },
      ],
    },
    underBudget,
  )
  assert.equal(clamped.satisfaction, 10, 'a mean under the budget is fully satisfied, and no more than fully')
  assert.notEqual(clamped.satisfaction, 12, 'an unclamped ratio would leave the 0..10 range every other class is compared on')
  assert.equal(clamped.score, 6, 'and the gap term stays floored at 0, so the score is the bare importance')
})

// ── 17. a class with no ruling row is a refusal, never a default ──────────────────────

test('computeOpportunity — a finding class with no ruling row THROWS, naming the class', () => {
  const stranger = {
    findingClass: 'recurring-vibes',
    clusterKey: 'atmosphere',
    lane: 'plugin-generic',
    kind: 'process-change',
    evidence: [
      { file: 'roadmap/arc-evals/ALPHA-2026-07-01.json', jsonPath: 'notes[0]', excerpt: 'x' },
      { file: 'roadmap/arc-evals/BRAVO-2026-07-02.json', jsonPath: 'notes[0]', excerpt: 'y' },
    ],
  }

  // The table is closed over the same enum as the classes, so this is unreachable except by
  // editing one without the other. A default importance is precisely what would let that editing
  // mistake ship as a plausible number nobody ratified.
  assert.throws(
    () => computeOpportunity(stranger, loadFixtureCorpus().reports),
    (err) => {
      assert.ok(err instanceof Error, 'a refusal is a thrown Error, not a returned sentinel object')
      assert.match(err.message, /recurring-vibes/, 'the message names the unruled class, so the fix is obvious from the failure alone')
      return true
    },
    'an unruled finding class must refuse to be scored',
  )

  // And the same call on a RULED class does not throw, so the assertion above is about the
  // missing ruling and not about a computeOpportunity that throws on everything.
  const { reports, lessons } = loadFixtureCorpus()
  assert.equal(typeof opportunityFrom(reports, lessons, 'recurring-regression', 'speed').score, 'number', 'a ruled class scores')
})

// ── 18. every real cluster scores, and the rails hold over all of them ────────────────

test('computeOpportunity — every cluster the fixture corpus emits scores, within the documented ranges', () => {
  const { reports, lessons } = loadFixtureCorpus()
  const table = rulingsTable()
  const result = clusterFindings(extractFindings(reports, lessons))
  assert.equal(result.clusters.length, EXPECTED_CLUSTERS.length, 'the corpus must emit its clusters, or the walk below is vacuous')

  for (const c of result.clusters) {
    const label = `${c.findingClass}/${c.clusterKey}`
    const o = computeOpportunity(c, reports)

    assert.equal(o.importance, EXPECTED_IMPORTANCE[c.findingClass], `${label}: importance is the ratified ruling for its class`)
    assert.equal(typeof o.score, 'number', `${label}: the score is a number`)
    assert.ok(Number.isFinite(o.score), `${label}: a NaN score is an unmeasured input leaking into the arithmetic`)
    assert.ok(o.score >= 0, `${label}: no proposal scores negative, got ${o.score}`)

    assert.equal(o.rulingsVersion, table.version, `${label}: every score carries the table version it was computed under`)
    const ruling = table.rulings.find((r) => r.id === o.rulingId)
    assert.ok(ruling, `${label}: rulingId ${JSON.stringify(o.rulingId)} names a real row in the table`)
    assert.equal(ruling.findingClass, c.findingClass, `${label}: and that row is the one for this cluster's class`)

    assert.equal(typeof o.satisfactionSource, 'string', `${label}: satisfactionSource is a string`)
    assert.notEqual(o.satisfactionSource.trim(), '', `${label}: an unnamed satisfaction is an unciteable number`)

    if (o.satisfaction === null) {
      // The rail that makes the whole design honest, asserted for EVERY unmeasured cluster the
      // real corpus produces rather than for the one hand-built case above.
      assert.equal(o.score, o.importance, `${label}: an unmeasurable satisfaction scores the bare importance`)
      assert.equal(o.satisfactionSource, 'satisfaction-unmeasured', `${label}: and says so with the named literal`)
    } else {
      assert.equal(typeof o.satisfaction, 'number', `${label}: satisfaction is a number or null, never undefined or a string`)
      assert.ok(o.satisfaction >= 0 && o.satisfaction <= 10, `${label}: satisfaction stays on the 0..10 scale, got ${o.satisfaction}`)
      assert.equal(o.score, o.importance + Math.max(o.importance - o.satisfaction, 0), `${label}: the score IS the formula, applied to its own reported inputs`)
    }
  }

  // At least one measured and one unmeasured cluster, or one branch above never ran.
  const scored = result.clusters.map((c) => computeOpportunity(c, reports))
  assert.ok(scored.some((o) => o.satisfaction === null), 'the corpus exercises the unmeasured branch')
  assert.ok(scored.some((o) => typeof o.satisfaction === 'number'), 'and the measured branch')
})

// ── 19. determinism ───────────────────────────────────────────────────────────────────

test('computeOpportunity — the same cluster against the same corpus scores identically twice', () => {
  const { reports, lessons } = loadFixtureCorpus()
  const cluster = needCluster(clusterFindings(extractFindings(reports, lessons)), 'recurring-low-score', 'code-confidence')

  const first = computeOpportunity(cluster, reports)
  const second = computeOpportunity(cluster, reports)

  // A measured cluster, so the comparison is about a real computation rather than two identical
  // "unmeasured" shrugs.
  assert.equal(typeof first.satisfaction, 'number', 'this cluster is measured, or the comparison below proves little')
  assert.deepStrictEqual(second, first, 'scoring reads only typed corpus fields, so a re-run cannot reorder the queue')
})

// ══════════════════════════════════════════════════════════════════════════════════════
// phase 2016.4 — PROVENANCE-GUARDED CONSOLIDATION: the loop may rewrite its OWN prior
// proposals and NOTHING else
//
// The Hermes cautionary tale is why this section exists: self-written artifacts with approval off
// produced real CVEs. This loop consolidates its own output, so the guarantee cannot be a sentence
// in a docblock — it has to be a RECORDED WRITE SET over an injected fs seam. The arc's acceptance
// signal is literally "zero edits outside roadmap/arc-evals/", and this is where it is proven at
// the unit seam, before any command can widen it.
//
// Four invariants, each with its own failure story:
//
//  - WRITE SET. Every recorded write lands directly under proposalsDir. The stub below records
//    EVERY path handed to EVERY fs method, so a read of ~/.ssh or a write to roadmap.config.json
//    reds here rather than in a postmortem. Each such test first asserts something INSIDE the
//    directory was written, because "nothing outside" is trivially true of a pass that did nothing.
//  - NO DELETION. Archiving is a status rewrite; the bytes stay. The stub's unlinkSync/rmSync/
//    rmdirSync THROW, so a deleting implementation reds at runtime, and a source scan asserts the
//    module cannot even reach a deleting API. Runtime and reachability are different claims and
//    both are made.
//  - PROVENANCE. A file the loop did not write is untouchable: unparseable and foreign-origin
//    files survive BYTE-IDENTICAL and are reported by name. Ratified/rejected files outrank a
//    regenerated cluster — the user's verdict is not something a re-run may overwrite — and an
//    archived file is not revived, counted separately because "you decided" and "the loop archived
//    it" are different facts a reader must be able to tell apart.
//  - VALIDATION AT THE SEAM. Every document is parsed BEFORE it is serialized, so a malformed
//    proposal never reaches disk at all.
//
// The exports under test do not exist yet, so they are reached through the same namespace-import
// guard the 2016.3 section uses: a static named import of a missing export would red this whole
// file and hide which export is missing.
// ══════════════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Read a phase-2016.4 export, failing by NAME rather than as an opaque TypeError. */
function needConsolidationExport(name) {
  const v = evalPropose[name]
  assert.ok(v !== undefined, `cli/lib/eval-propose.mjs must export ${name} (phase 2016.4)`)
  return v
}

const buildProposal = (cluster, reports, nowIso) => needConsolidationExport('buildProposal')(cluster, reports, nowIso)
const consolidateAndWrite = (clusters, reports, dir, deps) => needConsolidationExport('consolidateAndWrite')(clusters, reports, dir, deps)
/** Already exported (2016.2), but reached the same way so a rename fails by name here too. */
const proposalIdOf = (cluster) => needConsolidationExport('proposalId')(cluster)

const PROPOSALS_DIR = '/fake-repo/roadmap/arc-evals/proposals'
const OUTSIDE_PATHS = ['/fake-repo/roadmap/roadmap.config.json', '/fake-repo/CLAUDE.md', '/fake-repo/roadmap/arc-evals/ALPHA-2026-07-01.json']

const NOW_1 = '2026-08-01T09:00:00.000Z'
const NOW_2 = '2026-09-15T17:30:00.000Z'
const OLD_CREATED_AT = '2026-01-02T03:04:05.000Z'

const PROPOSAL_STATUSES = ['surfaced', 'ratified', 'rejected', 'archived']
const PROPOSAL_KINDS = ['review-focus-candidate', 'skill-amendment', 'schema-tightening', 'process-change', 'reduction']

/**
 * The ProposalShape spec, owned by the TEST rather than imported from templates/schema.ts (a .ts
 * module this .mjs suite cannot load): the same contract, restated, so `validate` at the seam is
 * checked against the documented shape instead of against whatever the implementation happens to
 * emit. Kept in step with templates/schema.ts:1415 by the 2016.1 schema tests.
 */
const ProposalDocShape = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    findingClass: z.enum(FINDING_CLASSES),
    lane: z.enum(LANES),
    kind: z.enum(PROPOSAL_KINDS),
    title: z.string().min(10),
    rationale: z.string().min(10),
    evidence: z.array(z.object({ file: z.string().min(1), jsonPath: z.string().min(1), excerpt: z.string().min(1) })).min(2),
    opportunity: z.object({
      importance: z.number().min(0).max(10),
      satisfaction: z.number().min(0).max(10).nullable(),
      score: z.number().min(0),
      rulingId: z.string().min(1),
      rulingsVersion: z.number().int().positive(),
      satisfactionSource: z.string().min(1),
    }),
    candidateReviewFocus: z.object({ id: z.string().min(1), signature: z.string().min(1), guidance: z.string().min(1) }).optional(),
    reductionTarget: z
      .object({ flow: z.string().min(1), measuredTokens: z.number().int().positive(), budgetTokens: z.number().int().positive(), ledger: z.string().min(1) })
      .optional(),
    writeOrigin: z.literal('roadmap-eval-loop'),
    status: z.enum(PROPOSAL_STATUSES),
    createdAt: z.string().min(10),
    updatedAt: z.string().min(10),
    supersededBy: z.string().min(1).optional(),
    archivedReason: z.string().min(10).optional(),
  })
  .superRefine((p, ctx) => {
    for (const [kind, field] of [
      ['review-focus-candidate', 'candidateReviewFocus'],
      ['reduction', 'reductionTarget'],
    ]) {
      const present = p[field] !== undefined
      if (p.kind === kind && !present) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `kind '${kind}' REQUIRES ${field}` })
      if (p.kind !== kind && present) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} belongs only to kind '${kind}'` })
    }
    if (p.status === 'archived' && p.archivedReason === undefined)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['archivedReason'], message: 'status archived REQUIRES archivedReason' })
  })

/**
 * A recording fs stub: an in-memory file map plus a log of every path every method was handed.
 *
 * The three deleting APIs are present and THROW. Their absence would prove nothing (an
 * implementation calling `fs.unlinkSync` on a stub without one throws a TypeError that reads like
 * a harness bug); present-and-throwing turns a deletion into a NAMED failure.
 */
function makeFsStub(seed = {}) {
  const files = new Map(Object.entries(seed))
  const dirs = new Set([PROPOSALS_DIR])
  const writes = []
  const mkdirs = []
  const touched = []
  const note = (p) => {
    touched.push(String(p))
    return String(p)
  }
  const forbidden = (name) => (p) => {
    note(p)
    throw new Error(`eval-propose called fs.${name}(${p}) — this pass archives by rewriting a status field and DELETES NOTHING, ever`)
  }
  return {
    files,
    writes,
    mkdirs,
    touched,
    snapshot: () => Object.fromEntries([...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    fs: {
      existsSync: (p) => dirs.has(note(p)) || files.has(String(p)),
      mkdirSync: (p, opts) => {
        mkdirs.push({ path: note(p), opts })
        dirs.add(String(p))
      },
      readdirSync: (p) => {
        const dir = note(p)
        if (!dirs.has(dir)) throw Object.assign(new Error(`ENOENT: no such directory ${dir}`), { code: 'ENOENT' })
        return [...files.keys()].filter((f) => dirname(f) === dir).map((f) => basename(f)).sort()
      },
      readFileSync: (p) => {
        const f = note(p)
        if (!files.has(f)) throw Object.assign(new Error(`ENOENT: no such file ${f}`), { code: 'ENOENT' })
        return files.get(f)
      },
      writeFileSync: (p, data) => {
        const f = note(p)
        writes.push({ path: f, data: String(data) })
        files.set(f, String(data))
      },
      unlinkSync: forbidden('unlinkSync'),
      rmSync: forbidden('rmSync'),
      rmdirSync: forbidden('rmdirSync'),
    },
  }
}

const fixtureClusters = () => {
  const { reports, lessons } = loadFixtureCorpus()
  return clusterFindings(extractFindings(reports, lessons)).clusters
}

const fixtureReports = () => loadFixtureCorpus().reports

/** Deps with all three seams present. `validate` is the real spec parse unless overridden. */
const mkDeps = (stub, nowIso, overrides = {}) => ({
  fs: stub.fs,
  now: () => nowIso,
  // The seam's contract: a throw that is a verdict about the DOCUMENT carries `documentRefused`,
  // so the pass can tell "this file is stale" from "the validator could not run".
  validate: (doc) => {
    try {
      return ProposalDocShape.parse(doc)
    } catch (e) {
      throw Object.assign(e, { documentRefused: true })
    }
  },
  ...overrides,
})

const proposalPath = (id) => `${PROPOSALS_DIR}/${id}.json`

/** A syntactically valid proposal document to plant in the stub before a pass. */
const plantedProposal = (id, o = {}) =>
  JSON.stringify(
    {
      id,
      findingClass: 'recurring-lesson-key',
      lane: 'plugin-generic',
      kind: 'process-change',
      title: 'a planted proposal title',
      rationale: 'a planted rationale long enough to clear the ten character floor',
      evidence: [
        { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[0]', excerpt: 'stale evidence one' },
        { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[1]', excerpt: 'stale evidence two' },
      ],
      opportunity: {
        importance: 5,
        satisfaction: null,
        score: 5,
        rulingId: 'importance-recurring-lesson-key',
        rulingsVersion: 1,
        satisfactionSource: 'satisfaction-unmeasured',
      },
      writeOrigin: 'roadmap-eval-loop',
      status: 'surfaced',
      createdAt: OLD_CREATED_AT,
      updatedAt: OLD_CREATED_AT,
      ...o,
    },
    null,
    2,
  )

/** The cluster the planted-file tests collide with, and its derived id. */
function liveLessonCluster() {
  const clusters = fixtureClusters()
  const cluster = clusters.find((c) => c.findingClass === 'recurring-lesson-key' && c.clusterKey === 'cli/lib/eval-score.mjs')
  assert.ok(cluster, 'the fixture must emit the lesson-key cluster these tests collide a planted file with')
  return cluster
}

// ── 20. the write set ─────────────────────────────────────────────────────────────────

test('consolidateAndWrite — every recorded write lands under proposalsDir, and NOTHING outside it is written, read or created', () => {
  const stub = makeFsStub(Object.fromEntries(OUTSIDE_PATHS.map((p) => [p, 'user-authored bytes\n'])))
  const clusters = fixtureClusters()
  const before = stub.snapshot()

  const res = consolidateAndWrite(clusters, fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  // Non-vacuity FIRST: a pass that wrote nothing satisfies every containment claim below for free.
  assert.ok(clusters.length > 0, 'the fixture emits clusters, or there is nothing to consolidate')
  assert.ok(Array.isArray(res.writes), 'the pass reports its own write set, so a caller can audit it without the stub')
  assert.ok(res.writes.length > 0, 'the pass must actually write, or "nothing outside the directory" is vacuously true')
  assert.equal(stub.writes.length, res.writes.length, 'the reported write set is the write set the fs seam actually saw')
  assert.equal(res.created, clusters.length, 'a virgin directory means one new file per cluster')

  for (const w of stub.writes) {
    assert.equal(dirname(w.path), PROPOSALS_DIR, `write to ${w.path} escaped the proposals directory`)
    assert.match(basename(w.path), /^[a-z0-9-]+\.json$/, `${w.path}: a proposal file is <id>.json and nothing else`)
  }

  // Every path the module handed to ANY fs method, not merely the writes: a pass that READ the
  // consumer's roadmap.config.json to "check" something has already widened its blast radius.
  for (const p of stub.touched) {
    assert.ok(p === PROPOSALS_DIR || dirname(p) === PROPOSALS_DIR, `the fs seam was handed ${p}, which is outside ${PROPOSALS_DIR}`)
  }

  // mkdir is allowed for exactly one directory, recursively.
  for (const m of stub.mkdirs) assert.equal(m.path, PROPOSALS_DIR, `mkdir of ${m.path}: the pass creates its own directory and no other`)
  assert.ok(stub.mkdirs.length > 0, 'the pass creates its directory rather than assuming it exists')
  assert.deepEqual(stub.mkdirs[0].opts, { recursive: true }, 'recursive, so a first run on a fresh corpus is not a crash')

  // The planted user-authored files are still exactly what they were.
  for (const p of OUTSIDE_PATHS) assert.equal(stub.files.get(p), before[p], `${p}: a file outside the proposals directory is not the loop's to touch`)
})

// ── 21. no deletion, at runtime AND by reachability ───────────────────────────────────

test('consolidateAndWrite — the pass never calls a deleting fs API, and the module cannot reach one', () => {
  const stub = makeFsStub()
  // A corpus that exercises the archive path too: a planted own file with no matching cluster is
  // exactly the case a naive implementation would clean up by deleting.
  stub.files.set(proposalPath('recurring-lesson-key-gone-forever'), plantedProposal('recurring-lesson-key-gone-forever'))

  const res = consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.equal(res.archived, 1, 'the dissolved cluster was archived, so the deletion temptation was actually reached')
  assert.ok(stub.files.has(proposalPath('recurring-lesson-key-gone-forever')), 'and the file is still on disk')
  // The stub's unlink/rm/rmdir throw, so reaching this line at all is the runtime half of the claim.

  const source = readFileSync(new URL('./eval-propose.mjs', import.meta.url), 'utf8')
  assert.ok(source.length > 0, 'the module source was read, or the scan below matches nothing for the wrong reason')
  assert.doesNotMatch(
    source,
    /unlinkSync|rmSync|rmdirSync/,
    'a deleting fs API must not be reachable from this module at all: the stub proves the pass does not call one today, ' +
      'this proves a later edit cannot add one without failing here',
  )
})

// ── 22. a file the loop did not write is untouchable ──────────────────────────────────

test('consolidateAndWrite — a foreign-origin file and an unparseable file survive BYTE-IDENTICAL and are reported by name', () => {
  const foreignPath = proposalPath('user-authored')
  const brokenPath = proposalPath('half-written')
  const foreignBytes = JSON.stringify(
    {
      id: 'user-authored',
      findingClass: 'recurring-regression',
      lane: 'consumer-specific',
      kind: 'process-change',
      title: 'a proposal a HUMAN wrote by hand',
      rationale: 'proposal-shaped in every field except the one that matters: who wrote it',
      evidence: [
        { file: 'roadmap/arc-evals/ALPHA-2026-07-01.json', jsonPath: 'notes[0]', excerpt: 'a' },
        { file: 'roadmap/arc-evals/BRAVO-2026-07-02.json', jsonPath: 'notes[0]', excerpt: 'b' },
      ],
      opportunity: { importance: 8, satisfaction: null, score: 8, rulingId: 'importance-recurring-regression', rulingsVersion: 1, satisfactionSource: 'satisfaction-unmeasured' },
      writeOrigin: 'user',
      status: 'surfaced',
      createdAt: OLD_CREATED_AT,
      updatedAt: OLD_CREATED_AT,
    },
    null,
    4, // a HUMAN'S formatting: a pass that reformatted it would fail the byte compare below
  )
  const brokenBytes = '{ "id": "half-written", "writeOrigin": "roadmap-eval-loop", '

  const stub = makeFsStub({ [foreignPath]: foreignBytes, [brokenPath]: brokenBytes })
  const res = consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.ok(res.writes.length > 0, 'the pass wrote its own proposals, so the two survivals below are a skip and not a no-op run')

  assert.equal(stub.files.get(foreignPath), foreignBytes, 'a file whose writeOrigin is not this loop is never rewritten, and never reformatted')
  assert.equal(stub.files.get(brokenPath), brokenBytes, 'a file the pass cannot parse is left exactly as found: the loop does not repair what it does not own')

  assert.deepEqual(res.foreignSkipped, ['user-authored.json'], 'the foreign file is reported BY NAME, not merely counted')
  assert.deepEqual(res.unreadable, ['half-written.json'], 'and so is the unparseable one — a silent skip is how a loop hides that it ignored something')

  const written = stub.writes.map((w) => w.path)
  assert.equal(written.includes(foreignPath), false, 'the foreign file appears nowhere in the write log')
  assert.equal(written.includes(brokenPath), false, 'nor does the unparseable one')
})

// ── 23. an adjudicated id is read-only, and the two refusals are counted apart ─────────

for (const status of ['ratified', 'rejected']) {
  test(`consolidateAndWrite — a ${status} proposal sharing an id with a live cluster is untouched and counted already-adjudicated`, () => {
    const cluster = liveLessonCluster()
    const id = proposalIdOf(cluster)
    const bytes = plantedProposal(id, { status })
    const stub = makeFsStub({ [proposalPath(id)]: bytes })

    const res = consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

    assert.ok(res.writes.length > 0, 'other clusters still wrote, so the untouched file below is a targeted refusal')
    assert.equal(stub.files.get(proposalPath(id)), bytes, `a ${status} proposal is the USER'S verdict; a re-run must not overwrite it`)
    assert.equal(res.alreadyAdjudicated, 1, 'and the dropped cluster is counted by name rather than silently re-emitted')
    assert.equal(res.skippedArchived, 0, 'an adjudicated verdict is not an archive: the two counts must not be pooled')
    assert.equal(
      res.proposals.filter((p) => p.id === id).length,
      0,
      'the regenerated cluster is DROPPED, so no downstream reader can see a surfaced twin of an adjudicated proposal',
    )
    assert.equal(stub.writes.filter((w) => w.path === proposalPath(id)).length, 0, 'and its file never entered the write log')
  })
}

test('consolidateAndWrite — an ARCHIVED proposal is not revived, and lands in skippedArchived rather than alreadyAdjudicated', () => {
  const cluster = liveLessonCluster()
  const id = proposalIdOf(cluster)
  const bytes = plantedProposal(id, { status: 'archived', archivedReason: 'no-longer-clustered' })
  const stub = makeFsStub({ [proposalPath(id)]: bytes })

  const res = consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.ok(res.writes.length > 0, 'the other clusters wrote, so this file being untouched is a decision')
  assert.equal(stub.files.get(proposalPath(id)), bytes, 'an archived proposal is read-only: the loop archived it and does not get to change its mind')
  assert.equal(res.skippedArchived, 1, '"the loop archived this" is its own fact')
  assert.equal(res.alreadyAdjudicated, 0, 'and it is NOT a user verdict — pooling the two would tell the reader something false')
  assert.equal(res.proposals.filter((p) => p.id === id).length, 0, 'the regenerated cluster does not reappear as a surfaced proposal')
})

// ── 24. archiving is a rewrite, never a removal ───────────────────────────────────────

test('consolidateAndWrite — a surfaced own-proposal whose cluster dissolved is ARCHIVED IN PLACE, file kept, createdAt preserved', () => {
  const id = 'recurring-low-score-dimension-that-recovered'
  const stub = makeFsStub({ [proposalPath(id)]: plantedProposal(id) })

  const res = consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.ok(stub.files.has(proposalPath(id)), 'THE FILE IS STILL THERE: an archive that removes the bytes is a delete with a nicer name')
  const doc = JSON.parse(stub.files.get(proposalPath(id)))
  assert.equal(doc.status, 'archived', 'the dissolved cluster flips its own proposal to archived')
  assert.equal(doc.archivedReason, 'no-longer-clustered', 'with the literal reason a reader can grep, not free prose that varies per run')
  assert.equal(doc.createdAt, OLD_CREATED_AT, 'the original creation time survives: an archive is not a new document')
  assert.equal(doc.updatedAt, NOW_1, 'and the archive itself is stamped with the injected clock')
  assert.equal(res.archived, 1, 'the archive is counted')
  assert.equal(res.alreadyAdjudicated, 0, 'and it is not confused with a user verdict')
  ProposalDocShape.parse(doc) // an archived document is still a valid proposal, reason field and all
})

// ── 25. refresh keeps the history it should keep ──────────────────────────────────────

test('consolidateAndWrite — a surfaced own-proposal matching a live cluster is refreshed in place: new evidence, OLD createdAt', () => {
  const cluster = liveLessonCluster()
  const id = proposalIdOf(cluster)
  const stub = makeFsStub({ [proposalPath(id)]: plantedProposal(id) })
  const reports = fixtureReports()

  const res = consolidateAndWrite(fixtureClusters(), reports, PROPOSALS_DIR, mkDeps(stub, NOW_1))

  const doc = JSON.parse(stub.files.get(proposalPath(id)))
  const fresh = buildProposal(cluster, reports, NOW_1)

  assert.equal(doc.status, 'surfaced', 'a refreshed proposal is still surfaced')
  assert.deepStrictEqual(doc.evidence, fresh.evidence, 'the stale citations are REPLACED by the freshly computed ones')
  assert.notDeepStrictEqual(doc.evidence, JSON.parse(plantedProposal(id)).evidence, 'and they really did change, or this test proves nothing')
  assert.deepStrictEqual(doc.opportunity, fresh.opportunity, 'the opportunity is recomputed against the current corpus')
  assert.equal(doc.createdAt, OLD_CREATED_AT, 'createdAt is the proposal\'s birthday and survives every refresh')
  assert.equal(doc.updatedAt, NOW_1, 'updatedAt moves, because the content moved')
  assert.equal(res.refreshed, 1, 'the refresh is counted')
  assert.equal(res.created, fixtureClusters().length - 1, 'and it is NOT counted as a creation: the file already existed')
})

// ── 26. idempotence: a second run over unchanged input changes no byte ────────────────

test('consolidateAndWrite — two passes over the same corpus leave byte-identical files, even under a different clock', () => {
  const stub = makeFsStub()
  const clusters = fixtureClusters()
  const reports = fixtureReports()

  const first = consolidateAndWrite(clusters, reports, PROPOSALS_DIR, mkDeps(stub, NOW_1))
  const afterFirst = stub.snapshot()
  assert.equal(first.created, clusters.length, 'run 1 created every proposal, so run 2 has something to be idempotent about')
  assert.ok(Object.keys(afterFirst).length > 0, 'and the directory is non-empty')

  const second = consolidateAndWrite(clusters, reports, PROPOSALS_DIR, mkDeps(stub, NOW_2))

  assert.deepStrictEqual(
    stub.snapshot(),
    afterFirst,
    'unchanged content keeps its existing updatedAt: bumping the stamp on every run would churn the git diff and make ' +
      '"what changed" unanswerable',
  )
  assert.equal(second.created, 0, 'nothing is created twice')
  assert.equal(second.unchanged, clusters.length, 'every cluster is reported as unchanged rather than silently rewritten')
  assert.equal(second.refreshed, 0, 'a refresh with no change is not a refresh')
  assert.equal(second.archived, 0, 'and nothing is archived, because every cluster is still live')
  for (const w of stub.writes) assert.equal(dirname(w.path), PROPOSALS_DIR, 'the second run stays inside the directory too')
})

// ── 27. validation happens BEFORE the bytes exist ─────────────────────────────────────

test('consolidateAndWrite — validate() runs once per written file, on a document already stamped with its origin and status', () => {
  const stub = makeFsStub()
  const seen = []
  const res = consolidateAndWrite(
    fixtureClusters(),
    fixtureReports(),
    PROPOSALS_DIR,
    mkDeps(stub, NOW_1, {
      validate: (doc) => {
        seen.push(doc)
        return ProposalDocShape.parse(doc)
      },
    }),
  )

  assert.ok(stub.writes.length > 0, 'files were written, or the count below is a vacuous zero-equals-zero')
  assert.equal(seen.length, stub.writes.length, 'exactly one parse per write: an unvalidated write is the whole failure mode this seam exists to stop')
  assert.equal(res.writes.length, seen.length, 'and the reported write set agrees')
  for (const doc of seen) {
    assert.equal(doc.writeOrigin, 'roadmap-eval-loop', 'every document the loop writes is stamped as its own before it is validated')
    assert.ok(PROPOSAL_STATUSES.includes(doc.status), `status ${JSON.stringify(doc.status)} is outside the closed lifecycle`)
    assert.match(doc.id, /^[a-z0-9-]+$/, 'and carries a slug-shaped id')
  }
})

test('consolidateAndWrite — a document that fails validation NEVER reaches disk: the throw propagates and no file is written', () => {
  const stub = makeFsStub()
  const boom = new Error('ProposalShape: refused at the seam')

  assert.throws(
    () =>
      consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1, { validate: () => { throw boom } })),
    (err) => {
      assert.equal(err, boom, 'the parse failure propagates unchanged rather than being swallowed into a warning')
      return true
    },
    'a proposal that will not parse must fail the run, not ship as a file nobody can read back',
  )

  assert.deepEqual(stub.writes, [], 'and NOTHING was written: validation precedes serialization, so a bad document leaves no trace')
  assert.deepEqual(stub.snapshot(), {}, 'the directory is still empty')
})

// ── 28. path traversal ────────────────────────────────────────────────────────────────

test('consolidateAndWrite — a derived proposal id CANNOT traverse: every id is slug-shaped and every write path sits directly in proposalsDir', () => {
  // Which of the two proofs this is, and why: the id is derived through the exported `slug`, whose
  // /[^a-z0-9]+/ fold makes a separator or a dot-segment structurally unrepresentable — there is no
  // cluster key that yields a traversing id, so an "escaping id rejected" test would assert against
  // an unreachable state. The claim proven instead is the stronger one: the id ALPHABET forbids
  // traversal, for the fixture's own clusters AND for adversarial keys, and the resulting write
  // path's dirname is exactly proposalsDir.
  const adversarial = ['../../etc/passwd', 'a/b', '..', '../..', './../../CLAUDE.md', 'C:\\Windows\\system32']
  const clusters = fixtureClusters()
  assert.ok(clusters.length > 0, 'the fixture clusters are walked below, so they must exist')

  const keys = [...clusters.map((c) => c.clusterKey), ...adversarial]
  for (const clusterKey of keys) {
    const id = proposalIdOf({ findingClass: 'recurring-lesson-key', clusterKey })
    assert.match(id, /^[a-z0-9-]+$/, `cluster key ${JSON.stringify(clusterKey)} derived a non-slug id ${JSON.stringify(id)}`)
    const target = join(PROPOSALS_DIR, `${id}.json`)
    assert.equal(dirname(target), PROPOSALS_DIR, `${JSON.stringify(clusterKey)} resolved outside the proposals directory`)
  }

  // And the runtime half, through the real pass: a hand-built cluster whose key is a traversal
  // string still writes exactly one file, inside the directory.
  const evil = {
    findingClass: 'recurring-lesson-key',
    clusterKey: '../../etc/passwd',
    lane: 'plugin-generic',
    kind: 'process-change',
    evidence: [
      { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[0]', excerpt: 'the first sighting of the adversarial key' },
      { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[1]', excerpt: 'the second sighting of the adversarial key' },
    ],
  }
  const stub = makeFsStub({ '/fake-repo/etc-passwd-decoy.json': 'untouched\n' })
  consolidateAndWrite([evil], fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.equal(stub.writes.length, 1, 'the adversarial cluster wrote exactly one file, so the containment claim is not vacuous')
  assert.equal(dirname(stub.writes[0].path), PROPOSALS_DIR, 'and it landed directly in the proposals directory')
  assert.equal(stub.files.get('/fake-repo/etc-passwd-decoy.json'), 'untouched\n', 'nothing outside was reached')
})

// ── 29. the document a cluster becomes ────────────────────────────────────────────────

test('buildProposal — every fixture cluster becomes a complete, kind-consistent proposal document', () => {
  const clusters = fixtureClusters()
  const reports = fixtureReports()
  assert.ok(clusters.length > 0, 'the walk below needs clusters')

  const kindsSeen = new Set()
  for (const cluster of clusters) {
    const label = `${cluster.findingClass}/${cluster.clusterKey}`
    const doc = buildProposal(cluster, reports, NOW_1)
    kindsSeen.add(doc.kind)

    ProposalDocShape.parse(doc) // the contract, in one line: every field, every enum, the evidence floor

    assert.equal(doc.id, proposalIdOf(cluster), `${label}: the id is the derived one, so a re-run addresses the same file`)
    assert.equal(doc.findingClass, cluster.findingClass, `${label}: the class survives into the document`)
    assert.equal(doc.lane, cluster.lane, `${label}: and so does the routed lane`)
    assert.equal(doc.kind, cluster.kind, `${label}: and the kind`)
    assert.ok(doc.title.length >= 10, `${label}: a title shorter than ten characters names nothing`)
    assert.ok(doc.rationale.length >= 10, `${label}: same for the rationale`)
    assert.ok(doc.evidence.length >= 2, `${label}: the >=2 floor is carried into the document, not just into the cluster`)
    assert.deepStrictEqual(doc.evidence, cluster.evidence, `${label}: the citations are the cluster's own, not a re-derived set`)
    assert.deepStrictEqual(doc.opportunity, computeOpportunity(cluster, reports), `${label}: the opportunity is the ONE scorer's output`)
    assert.equal(doc.writeOrigin, 'roadmap-eval-loop', `${label}: stamped as the loop's own, which is what makes consolidation safe`)
    assert.equal(doc.status, 'surfaced', `${label}: the pass emits surfaced and nothing else — ratified is a USER act`)
    assert.equal(doc.createdAt, NOW_1, `${label}: created at the injected clock`)
    assert.equal(doc.updatedAt, NOW_1, `${label}: and updated at the same instant on birth`)
    assert.equal(doc.archivedReason, undefined, `${label}: a surfaced proposal carries no archive reason`)

    // Payload pairing, asserted in BOTH directions for all three cases.
    if (doc.kind === 'review-focus-candidate') {
      assert.ok(doc.candidateReviewFocus, `${label}: a review-focus candidate must carry its candidate entry`)
      for (const f of ['id', 'signature', 'guidance'])
        assert.ok(String(doc.candidateReviewFocus[f] ?? '').length > 0, `${label}: candidateReviewFocus.${f} is non-empty`)
      assert.equal(doc.reductionTarget, undefined, `${label}: and never a reduction target`)
    } else if (doc.kind === 'reduction') {
      const t = doc.reductionTarget
      assert.ok(t, `${label}: a reduction must name what it reduces`)
      assert.equal(t.budgetTokens, PROTOCOL_LOAD_BUDGET_TOKENS, `${label}: the budget is the measured DIET figure, not an invented one`)
      assert.ok(Number.isInteger(t.measuredTokens) && t.measuredTokens > 0, `${label}: measuredTokens is a positive integer, got ${t.measuredTokens}`)
      assert.ok(
        t.measuredTokens > t.budgetTokens,
        `${label}: an over-budget cluster whose measured load is not over the budget is citing the wrong number (${t.measuredTokens} vs ${t.budgetTokens})`,
      )
      assert.equal(typeof t.ledger, 'string', `${label}: the ledger is named`)
      assert.notEqual(t.ledger.trim(), '', `${label}: an unnamed ledger is a figure nobody can check`)
      assert.notEqual(String(t.flow ?? '').trim(), '', `${label}: the flow being reduced is named`)
      assert.equal(doc.candidateReviewFocus, undefined, `${label}: and a reduction carries no reviewFocus candidate`)
    } else {
      assert.equal(doc.candidateReviewFocus, undefined, `${label}: kind ${doc.kind} promises no reviewFocus payload and must not smuggle one`)
      assert.equal(doc.reductionTarget, undefined, `${label}: nor a reduction target`)
    }
  }

  // All three payload branches above really ran, over this corpus.
  for (const kind of ['review-focus-candidate', 'reduction', 'process-change'])
    assert.ok(kindsSeen.has(kind), `the fixture must exercise kind ${kind}, or one branch of the pairing check never ran`)
})

// ── 30. the three seams are REQUIRED, never defaulted ─────────────────────────────────

test('consolidateAndWrite — a missing fs, now or validate dep THROWS by name: a defaulted fs would write to the real tree', () => {
  const stub = makeFsStub()
  const full = mkDeps(stub, NOW_1)
  const clusters = fixtureClusters()
  const reports = fixtureReports()

  for (const missing of ['fs', 'now', 'validate']) {
    const deps = { ...full }
    delete deps[missing]
    assert.throws(
      () => consolidateAndWrite(clusters, reports, PROPOSALS_DIR, deps),
      (err) => {
        assert.ok(err instanceof Error, `omitting ${missing} must throw an Error, not return a shrug`)
        assert.match(err.message, new RegExp(missing), `the message must name the missing dep '${missing}', got: ${err.message}`)
        return true
      },
      `dep '${missing}' is required — a silent default here is how a test-time pass writes to the real tree`,
    )
  }

  assert.throws(() => consolidateAndWrite(clusters, reports, PROPOSALS_DIR, undefined), /deps|fs/, 'and no deps object at all is refused too')

  // The complement, so the three assertions above are about the MISSING deps and not about a
  // function that throws on everything.
  const ok = consolidateAndWrite(clusters, reports, PROPOSALS_DIR, mkDeps(makeFsStub(), NOW_1))
  assert.equal(ok.created, clusters.length, 'with all three seams present the same call succeeds')
})

// ══════════════════════════════════════════════════════════════════════════════════════
// phase 2016 gate — TWO NAME COLLISIONS THAT USED TO OVERWRITE SILENTLY
//
// Test 22 above proves that a foreign or unparseable file the pass merely READS survives
// byte-identical. It cannot catch the case that actually destroys content: a file whose
// FILENAME is the one a live cluster derives. `readProposalDocs` files a non-own document under
// `foreign`/`unreadable` by NAME only, so `existingOwn` carries no entry for that id and the
// cluster took the CREATE branch — writing straight over a hand-authored file while the same run
// printed it as `foreign-skipped`. Destroyed bytes plus a false skip line, from one run.
//
// The second collision is between two clusters of the SAME run: `slug` folds every non-alphanumeric
// run to a hyphen, so `cli/lib` and `cli-lib` are one id. The later cluster overwrote the earlier
// one and `created` counted both, which is a proposal lost while the summary claims it was written.
//
// Both are refusals now, each with its own count, because a proposal dropped for a name is a fact
// the reader has to be told: silence here is exactly what made the two bugs survive review.
// ══════════════════════════════════════════════════════════════════════════════════════

/** A minimal lesson-key cluster with a caller-chosen key and traceable citations. Lane and kind are
 *  supplied directly rather than derived, because these tests are about the id, not about routing. */
const lessonClusterWithKey = (clusterKey, tag) => ({
  findingClass: 'recurring-lesson-key',
  clusterKey,
  lane: 'plugin-generic',
  kind: 'process-change',
  evidence: [
    { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[1]', excerpt: `${tag}: the first sighting of this key` },
    { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[2]', excerpt: `${tag}: the second sighting of this key` },
  ],
})

// ── 31. a non-own file HOLDS ITS NAME against the cluster that derives it ──────────────

for (const kind of ['foreign-origin', 'unparseable']) {
  test(`consolidateAndWrite — a ${kind} file occupying a live cluster's derived FILENAME blocks the create: bytes survive, and the loss is counted`, () => {
    const cluster = liveLessonCluster()
    const id = proposalIdOf(cluster)
    const path = proposalPath(id)

    // The bytes a human left at that exact name. The foreign document is indented FOUR spaces —
    // a human's formatting, not this pass's two — so a run that "helpfully" regenerated identical
    // content still fails the byte compare below.
    const bytes =
      kind === 'foreign-origin'
        ? `${JSON.stringify({ ...JSON.parse(plantedProposal(id)), writeOrigin: 'user', title: 'a proposal a HUMAN filed under this exact name' }, null, 4)}\n`
        : '{ "id": "half-written", "writeOrigin": "roadmap-eval-loop", '

    const stub = makeFsStub({ [path]: bytes })
    const clusters = fixtureClusters()
    const res = consolidateAndWrite(clusters, fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

    // Non-vacuity FIRST: the run really did consolidate, so the untouched file below is a targeted
    // refusal rather than a pass that did nothing at all.
    assert.ok(clusters.length > 1, 'the fixture emits more than the colliding cluster, or the write below proves nothing')
    assert.ok(res.writes.length > 0, 'the OTHER clusters still wrote')
    assert.equal(res.created, clusters.length - 1, 'exactly one cluster was withheld: every other one was created as usual')

    assert.equal(
      stub.files.get(path),
      bytes,
      `${path}: a file the loop did not write owns its NAME as much as its bytes — creating over it destroys hand-authored content`,
    )
    assert.equal(res.blockedByName, 1, 'and the withheld cluster is COUNTED, so the run cannot report a skip it did not honour')
    assert.equal(res.idCollisions, 0, 'a name held by another file is not the same fact as two clusters folding to one id')

    assert.equal(stub.writes.filter((w) => w.path === path).length, 0, 'the colliding path never entered the fs seam as a write')
    assert.equal(res.writes.includes(path), false, 'nor the reported write set')
    assert.equal(
      res.proposals.filter((p) => p.id === id).length,
      0,
      'and no proposal carrying that id is returned: a downstream reader must not see a document that was never written',
    )

    // The same run's report about the file has to agree with what it did to the file.
    const reportedBy = kind === 'foreign-origin' ? res.foreignSkipped : res.unreadable
    assert.deepEqual(reportedBy, [`${id}.json`], `the ${kind} file is still reported BY NAME`)
  })
}

// ── 32. two cluster keys that fold to one id: the FIRST wins, the second is counted ────

test('consolidateAndWrite — two clusters whose keys slug to ONE proposal id write ONE file: the later is refused, not silently laid over the earlier', () => {
  const slugOf = needConsolidationExport('slug')
  const KEY_FIRST = 'cli/lib'
  const KEY_SECOND = 'cli-lib'

  // Preconditions, stated rather than assumed: if the two keys did not really collapse to one id
  // this test would pass against the pre-fix code for the wrong reason.
  assert.notEqual(KEY_FIRST, KEY_SECOND, 'two genuinely distinct cluster keys')
  assert.equal(slugOf(KEY_FIRST), slugOf(KEY_SECOND), `slug folds both keys to one string, got ${slugOf(KEY_FIRST)} and ${slugOf(KEY_SECOND)}`)

  const first = lessonClusterWithKey(KEY_FIRST, 'FIRST')
  const second = lessonClusterWithKey(KEY_SECOND, 'SECOND')
  const id = proposalIdOf(first)
  assert.equal(proposalIdOf(second), id, 'and therefore both clusters derive the SAME proposal id, which is the collision under test')

  const stub = makeFsStub()
  const res = consolidateAndWrite([first, second], fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.equal(stub.writes.length, 1, `exactly one file for one id; writes were:\n${stub.writes.map((w) => w.path).join('\n')}`)
  assert.equal(stub.writes[0].path, proposalPath(id), 'and it is the shared id\'s file')
  assert.equal(res.idCollisions, 1, 'the dropped cluster is counted: a proposal lost to a name must not look like a proposal written')
  assert.equal(res.created, 1, 'created counts FILES written, not clusters attempted — counting both is the claim that made this bug invisible')
  assert.equal(res.proposals.length, 1, 'and one document is returned, not two')
  assert.equal(res.blockedByName, 0, 'nothing here is held by a file the loop does not own')

  // WHICH document survived. A refusal drops the LATER cluster; an overwrite would leave the later
  // one on disk, so this is what tells the two implementations apart.
  const doc = JSON.parse(stub.files.get(proposalPath(id)))
  assert.deepStrictEqual(doc.evidence, first.evidence, 'the surviving document is the FIRST cluster\'s, citations and all')
  assert.notDeepStrictEqual(doc.evidence, second.evidence, 'not the second\'s, which is what an overwrite would have left behind')
  assert.ok(doc.title.startsWith(`${KEY_FIRST} `), `the title names the first key; got ${JSON.stringify(doc.title)}`)
  assert.deepStrictEqual(res.proposals[0], doc, 'and the returned proposal is the document that actually reached disk')

  // Order-dependence, proven both ways: the rule is FIRST-WINS, not "cli/lib always wins". Fed in
  // the other order the same pair keeps the other document, so the assertion above is about
  // position rather than about these two particular keys.
  const reversed = makeFsStub()
  const res2 = consolidateAndWrite([second, first], fixtureReports(), PROPOSALS_DIR, mkDeps(reversed, NOW_1))
  assert.equal(res2.idCollisions, 1, 'the collision is symmetric')
  assert.equal(reversed.writes.length, 1, 'still one file')
  assert.deepStrictEqual(
    JSON.parse(reversed.files.get(proposalPath(id))).evidence,
    second.evidence,
    'fed second-first, the SECOND cluster is the one kept: the refusal drops whichever arrives later',
  )
})

// ── 33. an OWN file filed under the wrong name is a refusal, never an aborted run ──────
// Every other unusable file in this module is a named, counted refusal that lets the rest of the
// run proceed. An own document whose FILENAME is not `<id>.json` used to be the exception: it
// matched a live cluster by id, was pushed with its own path, and then hit the seam guard, which
// threw on the way to the fs and discarded every other proposal in the run. One misfiled byte
// range must not cost the operator the whole queue.

test('consolidateAndWrite — an own proposal filed under the wrong name does not abort the run, and is reported by name', () => {
  const cluster = liveLessonCluster()
  const id = proposalIdOf(cluster)
  const wrongName = 'hand-renamed.json'
  const bytes = plantedProposal(id) // the document says `id`, the FILE says something else
  const stub = makeFsStub({ [`${PROPOSALS_DIR}/${wrongName}`]: bytes })
  const clusters = fixtureClusters()

  // Pre-fix this call threw; the assertion is that it returns at all, and returns honestly.
  const res = consolidateAndWrite(clusters, fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.equal(res.created, clusters.length, 'every cluster still wrote: one misfiled document costs the run nothing')
  assert.deepEqual(res.misnamedOwn, [wrongName], 'and the misfiled document is reported BY NAME rather than silently ignored')
  assert.equal(stub.files.get(`${PROPOSALS_DIR}/${wrongName}`), bytes, 'its bytes are untouched: the pass cannot rewrite it in place without leaving the <id>.json rule')
  assert.ok(stub.files.has(proposalPath(id)), 'the live cluster still got its own correctly-named file')
  assert.equal(res.writes.filter((w) => w.endsWith(wrongName)).length, 0, 'and the wrong name never entered the write log')
})

test('consolidateAndWrite — an own file whose NAME a live cluster derives is blocked, not overwritten', () => {
  const cluster = liveLessonCluster()
  const id = proposalIdOf(cluster)
  // The file is called `<id>.json` but the document inside claims a DIFFERENT id, so it is an own
  // proposal the pass cannot address — and the name it occupies is one a live cluster wants.
  const bytes = plantedProposal('some-other-proposal-entirely')
  const stub = makeFsStub({ [proposalPath(id)]: bytes })
  const clusters = fixtureClusters()

  const res = consolidateAndWrite(clusters, fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.equal(stub.files.get(proposalPath(id)), bytes, 'an own proposal is not collateral damage for a name collision either')
  assert.equal(res.blockedByName, 1, 'the cluster that wanted that name is counted as blocked')
  assert.equal(res.created, clusters.length - 1, 'and exactly one cluster was withheld, so the rest of the run proceeded')
  assert.deepEqual(res.misnamedOwn, [`${id}.json`], 'the misfiled own file is named')
  assert.equal(res.proposals.filter((p) => p.id === id).length, 0, 'no proposal claims an id whose file the pass could not write')
})

// ── 34. a stale own document is a named refusal too, not an aborted run ────────────────
// The last unusable-own-file class. A document DERIVED from disk (an archive rewrite, or a
// refresh inheriting createdAt/updatedAt) carries content nobody validated on read, so a file
// written under an older schema — or hand-edited while it was still surfaced — used to reach the
// seam validator and throw, discarding every other proposal in the run. A document the loop built
// from the corpus alone still throws, because that one means the loop's own arithmetic is broken.

test('consolidateAndWrite — an own document whose ARCHIVED form will not parse is refused by name, and the rest of the run proceeds', () => {
  const id = 'recurring-lesson-key-vanished-long-ago'
  // One evidence entry: legal to plant, illegal under the >=2 floor, so the archive rewrite of it
  // is what fails validation rather than anything the loop computed.
  const bytes = plantedProposal(id, { evidence: [{ file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'lines[1]', excerpt: 'a lone citation' }] })
  const stub = makeFsStub({ [proposalPath(id)]: bytes })
  const clusters = fixtureClusters()

  const res = consolidateAndWrite(clusters, fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.equal(res.created, clusters.length, 'every live cluster still wrote: one stale file costs the run nothing')
  assert.deepEqual(res.unusableOwn, [`${id}.json`], 'and the stale document is reported BY NAME')
  assert.equal(res.archived, 0, 'a refusal is not an archive — counting it as one would claim a rewrite that never happened')
  assert.equal(stub.files.get(proposalPath(id)), bytes, 'its bytes are untouched, so a human can still read and fix it')
})

test('consolidateAndWrite — an own document whose REFRESHED form will not parse is refused by name, and the live cluster is not written over', () => {
  const cluster = liveLessonCluster()
  const id = proposalIdOf(cluster)
  // createdAt is inherited from disk by the refresh, so a too-short one fails the >=10 floor.
  const bytes = plantedProposal(id, { createdAt: 'x' })
  const stub = makeFsStub({ [proposalPath(id)]: bytes })
  const clusters = fixtureClusters()

  const res = consolidateAndWrite(clusters, fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1))

  assert.deepEqual(res.unusableOwn, [`${id}.json`], 'the unusable inheritance is named')
  assert.equal(res.refreshed, 0, 'and not counted as a refresh that did not happen')
  assert.equal(res.created, clusters.length - 1, 'every other cluster wrote')
  assert.equal(stub.files.get(proposalPath(id)), bytes, 'the file is left exactly as found rather than half-rewritten')
})

test('consolidateAndWrite — a FRESH document that will not parse still fails the run: that one means the loop is broken', () => {
  const stub = makeFsStub()
  const boom = new Error('ProposalShape: refused at the seam')
  assert.throws(
    () => consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, mkDeps(stub, NOW_1, { validate: () => { throw boom } })),
    (err) => {
      assert.equal(err, boom, 'the corpus-derived failure propagates unchanged')
      return true
    },
    'the disk-derived softening must not soften the loop grading its own arithmetic',
  )
  assert.deepEqual(stub.writes, [], 'and nothing was written: the refusal happened before any byte reached the fs')
})

// ── 35. a validator that could not RUN is not a corpus verdict ─────────────────────────
// The softening for disk-derived documents exists for one fact: this file is stale. A validator
// that never ran at all — a missing toolchain, a schema module that will not load — is a
// different fact entirely, and reporting it as "your files are stale" WITH A GREEN EXIT is the
// most expensive wrong answer this pass could give. Only an error the validator MARKS as a
// document verdict may be downgraded.

test('consolidateAndWrite — an UNMARKED validator failure on a disk-derived document aborts the run instead of being filed as a stale file', () => {
  const cluster = liveLessonCluster()
  const id = proposalIdOf(cluster)
  // A live cluster with an existing own file, so the refresh path (fromExisting) is what runs.
  const stub = makeFsStub({ [proposalPath(id)]: plantedProposal(id) })
  const toolchainFailure = new Error('tsx is not installed in the consumer') // NO documentRefused flag

  assert.throws(
    () =>
      // Scoped to the DISK-DERIVED document alone. A validator that threw for everything would
      // hit a corpus-built document first and throw for that reason in either version of the
      // guard, which would make this test pass without proving anything.
      consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, {
        ...mkDeps(stub, NOW_1),
        validate: (doc) => {
          if (doc.id === id) throw toolchainFailure
          return doc
        },
      }),
    (err) => {
      assert.equal(err, toolchainFailure, 'the failure propagates unchanged, so the caller can map it onto its own exit code')
      return true
    },
    'a validator that could not run must not be reported as a corpus problem',
  )
  assert.deepEqual(stub.writes, [], 'and nothing was written')

  // The complement, so the assertion above is about the MISSING flag and not about refresh
  // throwing on everything: the same failure MARKED as a document verdict is a named refusal.
  const marked = makeFsStub({ [proposalPath(id)]: plantedProposal(id) })
  const res = consolidateAndWrite(fixtureClusters(), fixtureReports(), PROPOSALS_DIR, {
    ...mkDeps(marked, NOW_1),
    validate: (doc) => {
      if (doc.id === id) throw Object.assign(new Error('stale document'), { documentRefused: true })
      return doc
    },
  })
  assert.deepEqual(res.unusableOwn, [`${id}.json`], 'marked, it is a named refusal')
  assert.ok(res.created > 0, 'and the rest of the run proceeded')
})
