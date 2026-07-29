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
