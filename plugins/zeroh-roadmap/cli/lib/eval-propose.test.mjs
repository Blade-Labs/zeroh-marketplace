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
