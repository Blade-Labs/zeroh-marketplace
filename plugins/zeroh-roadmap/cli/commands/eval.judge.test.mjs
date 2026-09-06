// Eval judge scenarios; fixture state is private to this test process.
import { ARC_ID, EVAL_DATE, EVAL_DETERMINISTIC_KEYS, EVAL_JUDGE_KEYS, JUDGE_PIN, PINNED_PRIORS, PLUGIN_ROOT, assert, buildEvalFixture, evalsDir, evidenceFor, existsSync, fixtureWithSkeleton, join, judgeVerdict, mergeJudge, parsesConsumerShape, ratchetRow, readFileSync, readReport, readdirSync, reportPath, samplesOf, test } from '../testdata/eval.test-support.mjs'

// ── 15. the happy path: four judge dimensions filled, nothing pending left ─────────────
test('eval merge-judge — a pin-matching verdict FILLS all four judge dimensions and clears every sentinel', () => {
  const root = fixtureWithSkeleton({ priors: PINNED_PRIORS })
  const before = readReport(root, EVAL_DATE)

  const r = mergeJudge(root, judgeVerdict({ scores: { 'doc-brevity': 72.5 } }))
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const after = readReport(root, EVAL_DATE)
  for (const key of EVAL_JUDGE_KEYS) {
    const d = after.dimensions[key]
    assert.equal(d.owner, 'judge', `${key} stays judge-owned — merging a verdict does not transfer ownership`)
    assert.equal(d.score, key === 'doc-brevity' ? 72.5 : 80, `${key} carries the verdict's own number`)
    assert.equal(d.evidence, evidenceFor(key), `${key} carries the judge's quoted proof verbatim`)
    // The contract STRIPS an unknown top-level key on a dimension (ArcEvalReportShape's objects
    // are strip-mode), so `signals` is the only home a confidence can survive the pre-write
    // .parse() in. A confidence written anywhere else vanishes silently on the way to disk.
    assert.equal(d.signals.confidence, 'high', `${key}'s confidence must survive to disk; got ${JSON.stringify(d.signals)}`)
    assert.equal(d.sentinel, undefined, `${key} is scored — score XOR sentinel forbids it keeping the disclaimer too`)
    assert.ok(d.sourceRefs.length >= 1, `${key} keeps its skeleton sourceRefs`)
  }
  assert.doesNotMatch(
    JSON.stringify(after),
    /pending-judge/,
    'with all four scored the finalized report has NOTHING outstanding — a leftover sentinel is a half-merged report',
  )

  assert.equal(after.judgeModel, JUDGE_PIN, 'the report records which model judged it (item 6)')
  // The deterministic side is not the judge's to touch, even incidentally.
  for (const key of EVAL_DETERMINISTIC_KEYS)
    assert.deepEqual(after.dimensions[key], before.dimensions[key], `${key} is byte-for-byte what the scorer wrote`)

  // A merged report whose ratchet still says "no current value" would be internally incoherent:
  // the row's value IS the dimension's score, and with two same-model priors it now compares.
  for (const key of EVAL_JUDGE_KEYS) {
    const row = ratchetRow(after, key)
    assert.equal(row.value, after.dimensions[key].score, `${key}'s ratchet row must carry the merged value`)
    assert.equal(samplesOf(row), 2, `${key}: both PIN-judged priors are comparable now the report shares their judge`)
    assert.equal(row.baseline, 60, `${key}: the mean of the two planted 60s; got ${row.baseline}`)
  }

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', after)
  assert.equal(res.ok, true, `the finalized report must still satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 16. the ownership seam — a judge may not score a deterministic dimension ───────────
test('eval merge-judge — a verdict SCORING a deterministic dimension is REFUSED (exit 2), report untouched', () => {
  const root = fixtureWithSkeleton()
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  const verdict = judgeVerdict({
    extraDimensions: {
      'code-confidence': { score: 95, evidence: evidenceFor('code-confidence'), confidence: 'high' },
    },
  })
  const r = mergeJudge(root, verdict)
  assert.equal(r.code, 2, `a judge overriding a deterministic signal is a refusal, not a merge: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /code-confidence/, 'the refusal names the offending dimension')
  assert.match(r.stderr, /owner/i, 'and names the seam it violated — ownership, not "already scored"')
  assert.match(r.stderr, /deterministic/i, "and the owner the report actually records for it")
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a refusal reads as a refusal, not a leaked stack')
  assert.equal(
    readFileSync(reportPath(root, EVAL_DATE), 'utf8'),
    before,
    'a refused verdict leaves the report byte-for-byte untouched — no partial merge',
  )
})

// ── 17. the same seam, the SKIP variant ───────────────────────────────────────────────
test('eval merge-judge — a verdict SKIPPING a deterministic dimension is refused by the same seam', () => {
  const root = fixtureWithSkeleton()
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  // The skip carries no score, so an "already has a number" check would wave it through and let
  // a judge annotate a dimension it does not own. The rule is OWNER, which catches both shapes.
  const verdict = judgeVerdict({
    skipped: [{ dimension: 'code-confidence', why: 'could not read the gate records for this one' }],
  })
  const r = mergeJudge(root, verdict)
  assert.equal(r.code, 2, `the skip variant is the same violation: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /code-confidence/, 'the refusal names the offending dimension')
  assert.match(r.stderr, /owner/i, 'and names the ownership seam')
  assert.equal(readFileSync(reportPath(root, EVAL_DATE), 'utf8'), before, 'report untouched')
})

// ── 18. the model pin — an off-pin judge merges LOUDLY and stops the ratchet ───────────
test('eval merge-judge — an OFF-PIN verdict merges, names itself baseline-reset material, and un-compares judge rows', () => {
  // Priors judged by the PIN, so a judge-owned baseline WOULD exist: without them every judge
  // row reads no-baseline anyway and the assertion below would be vacuous.
  const root = fixtureWithSkeleton({ priors: PINNED_PRIORS })
  const OFF_PIN = 'some-other-model-4'

  const r = mergeJudge(root, judgeVerdict({ judgeModel: OFF_PIN }))
  assert.equal(r.code, 0, `an off-pin pass is not refused — it is recorded honestly: ${r.stdout + r.stderr}`)

  const after = readReport(root, EVAL_DATE)
  assert.equal(after.judgeModel, OFF_PIN, 'the report records the model that ACTUALLY judged it, not the pin')
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(after.dimensions[key].score, 80, `${key} is still filled — the merge happens, the ratchet is what changes`)

  const note = after.notes.find((n) => n.includes(OFF_PIN))
  assert.ok(note, `a note must NAME the off-pin model; notes were ${JSON.stringify(after.notes)}`)
  assert.match(note, /baseline[- ]reset/i, `the note must say what it means for the baseline; got ${JSON.stringify(note)}`)

  for (const key of EVAL_JUDGE_KEYS) {
    const row = ratchetRow(after, key)
    assert.equal(row.regression, false, `${key}: a differently-judged prior can never evidence a regression`)
    assert.equal(typeof row.note, 'string', `${key}: an un-compared row must SAY why`)
    assert.match(row.note, /incomparable-judge/, `${key}: got ${JSON.stringify(row.note)}`)
    assert.equal(row.baseline, null, `${key}: an incomparable row must not carry a number it refuses to compare against`)
  }

  // The reset is scoped to the judge, not global: nobody judged the deterministic dimensions,
  // so their priors stay comparable in the very same run.
  const det = ratchetRow(after, 'code-confidence')
  assert.equal(det.baseline, 60, `a deterministic row still compares across judge models; got ${det.baseline}`)
  assert.equal(samplesOf(det), 2, 'both priors remain in the deterministic reference class')
  assert.equal(det.value, after.dimensions['code-confidence'].score)
  assert.doesNotMatch(det.note, /incomparable-judge/, 'no judge touched code-confidence — it cannot be judge-incomparable')

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', after)
  assert.equal(res.ok, true, `the off-pin report must still satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 19. a partial pass stays honestly partial ─────────────────────────────────────────
test('eval merge-judge — two scored + two SKIPPED: the skipped keep pending-judge and their reasons reach notes', () => {
  const root = fixtureWithSkeleton()
  const skipped = [
    { dimension: 'doc-brevity', why: 'the transparency reports were unreadable in this arc' },
    { dimension: 'plan-quality', why: 'no plan artifacts survived the phase rewrite' },
  ]
  const r = mergeJudge(root, judgeVerdict({ skipped }))
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const after = readReport(root, EVAL_DATE)
  for (const key of ['standards-adherence', 'composability-testability']) {
    assert.equal(after.dimensions[key].score, 80, `${key} was scored and must be filled`)
    assert.equal(after.dimensions[key].sentinel, undefined, `${key} carries no leftover disclaimer`)
  }
  for (const { dimension } of skipped) {
    const d = after.dimensions[dimension]
    assert.equal(d.owner, 'judge', `${dimension} is still the judge's to score one day`)
    assert.equal(d.sentinel, 'pending-judge', `${dimension} was skipped — it is still PENDING, not resolved`)
    assert.equal(d.score, undefined, `${dimension} must not gain a number from a pass that declined to score it`)
    assert.equal(d.evidence, undefined, `${dimension} has no proof, so it must not carry one`)
  }
  for (const { dimension, why } of skipped) {
    const note = after.notes.find((n) => n.includes(why))
    assert.ok(note, `the reason for skipping ${dimension} must reach notes; notes were ${JSON.stringify(after.notes)}`)
  }
  const res = parsesConsumerShape(root, 'ArcEvalReportShape', after)
  assert.equal(res.ok, true, `a partially merged report must still satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 20. a mis-shaped verdict never reaches the report ─────────────────────────────────
test('eval merge-judge — a mis-shaped verdict is REFUSED (exit 2) with a Zod issue line; report untouched', () => {
  const root = fixtureWithSkeleton()
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  // (a) evidence below the .min(30) traceability floor — an opinion wearing a number's clothes.
  const thin = judgeVerdict()
  thin.dimensions['doc-brevity'].evidence = 'looked fine'
  const a = mergeJudge(root, thin)
  assert.equal(a.code, 2, a.stdout + a.stderr)
  assert.match(a.stderr, /dimensions\.doc-brevity\.evidence: .+/, 'the Zod issue path is printed')
  assert.doesNotMatch(a.stderr, /\n\s+at [^\n]*\n\s+at /, 'a refusal reads as a refusal, not a leaked stack')

  // (b) a judge-owned dimension neither scored nor skipped — the silent omission the coverage
  // refine exists to stop. It must not be readable as "leave that one pending, then".
  const omitted = judgeVerdict()
  delete omitted.dimensions['plan-quality']
  const b = mergeJudge(root, omitted)
  assert.equal(b.code, 2, b.stdout + b.stderr)
  assert.match(b.stderr, /dimensions\.plan-quality: .+/, 'the omission is named by key')
  assert.match(b.stderr, /skip/i, 'and points at the reachable downgrade path')

  assert.equal(readFileSync(reportPath(root, EVAL_DATE), 'utf8'), before, 'neither refusal touched the report')
})

// ── 21. no report to merge into ───────────────────────────────────────────────────────
test('eval merge-judge — an arc with no dated report is REFUSED (exit 2) by name, and mints nothing', () => {
  const root = buildEvalFixture()
  // Precondition: the arc-evals dir EXISTS and holds the -sweep/-verdicts siblings, so this
  // pins "no REPORT", not "no directory" — a record is not a report.
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-sweep.json`)), 'fixture precondition: the sweep sibling')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, 'fixture precondition: no dated report yet')

  const r = mergeJudge(root, judgeVerdict())
  assert.equal(r.code, 2, `a verdict with nowhere to land is refused: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, new RegExp(ARC_ID), 'the refusal names the arc it found no report for')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, 'a merge never CREATES a report — it finalizes one')
  assert.equal(
    readdirSync(evalsDir(root)).filter((f) => /^EVALFIX-\d{4}-\d{2}-\d{2}\.json$/.test(f)).length,
    0,
    'no dated report was minted anywhere in the archive',
  )
})

// ── 22. the pin lives in exactly ONE place ────────────────────────────────────────────
test('eval merge-judge — the judge model pin appears EXACTLY once in cli/commands/eval.mjs', () => {
  const src = readFileSync(join(PLUGIN_ROOT, 'cli', 'commands', 'eval.mjs'), 'utf8')
  const hits = src.split(JUDGE_PIN).length - 1
  // Two homes drift: one gets bumped for a new judge and the other keeps waving the old model
  // past the off-pin check, which is precisely the silent baseline contamination this seam
  // exists to prevent. Zero homes means the check is not implemented at all.
  assert.equal(hits, 1, `expected exactly ONE '${JUDGE_PIN}' pin home in cli/commands/eval.mjs; found ${hits}`)
})
