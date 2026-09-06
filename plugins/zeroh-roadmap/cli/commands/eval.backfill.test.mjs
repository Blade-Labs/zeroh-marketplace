// Eval backfill scenarios; fixture state is private to this test process.
import { ARC_ID, BACKFILL_DATE, EVAL_DATE, EVAL_DETERMINISTIC_KEYS, EVAL_JUDGE_KEYS, EVAL_KEYS, assert, buildEvalFixture, existsSync, parsesConsumerShape, rawReport, readReport, reportPath, roadmap, test, timingPath } from '../testdata/eval.test-support.mjs'

// ── 31. the headline: same pipeline, terminal sentinel, no `pending-judge` anywhere ─────
test('eval <ARCID> --backfill — same collect/score/ratchet/persist pipeline, judge dims TERMINAL unjudged-backfill', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(reportPath(root, BACKFILL_DATE)), `expected the report at ${reportPath(root, BACKFILL_DATE)}`)

  const report = readReport(root, BACKFILL_DATE)
  assert.equal(report.arcId, ARC_ID)
  assert.equal(report.date, BACKFILL_DATE, 'a backfill is dated by the flag like any other run')
  assert.deepEqual(Object.keys(report.dimensions).sort(), [...EVAL_KEYS].sort(), 'exactly the seven closed keys')

  // The deterministic half is UNTOUCHED by the mode: those dimensions read recorded artifacts,
  // which a backfill has as much of as a live run.
  for (const key of EVAL_DETERMINISTIC_KEYS) {
    const d = report.dimensions[key]
    assert.equal(typeof d.score, 'number', `${key} is deterministic — a backfill still scores it`)
    assert.equal(d.sentinel, undefined, `${key} has every input it needs in this fixture`)
  }
  for (const key of EVAL_JUDGE_KEYS) {
    const d = report.dimensions[key]
    assert.equal(d.sentinel, 'unjudged-backfill', `${key} will never be judged — the sentinel must say so terminally`)
    assert.equal(d.score, undefined, `${key} must not carry a CLI-invented number`)
    assert.notEqual(d.score, 0, `${key} must sentinel, never zero — a zero reads as a real, terrible arc`)
  }

  // The whole point of a separate sentinel is that a reader can never mistake the file for one
  // awaiting a pass, so the promise must not survive anywhere in the bytes (notes included).
  assert.equal(
    rawReport(root, BACKFILL_DATE).includes('pending-judge'),
    false,
    'a backfilled report may not contain the string pending-judge ANYWHERE — the judge pass is not coming',
  )

  assert.equal(report.ratchet.length, 7, 'one ratchet row per dimension, always — the mode changes no shape')
  assert.ok(existsSync(timingPath(root)), 'the identical pipeline still regenerates the projection')
})

// ── 32. the persisted backfill really parses the consumer contract ──────────────────────
test('eval <ARCID> --backfill — the written report satisfies the CONSUMER ArcEvalReportShape', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  // The precondition IS the point: without it this test would pass over an ordinary report
  // while --backfill was silently ignored, and prove nothing about the new sentinel parsing.
  const doc = readReport(root, BACKFILL_DATE)
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(doc.dimensions[key].sentinel, 'unjudged-backfill', `precondition: ${key} is the backfill sentinel`)

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', doc)
  assert.equal(res.ok, true, `a backfilled report must satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 33. no judge attribution, and the deterministic FEEDERS survive ─────────────────────
test('eval <ARCID> --backfill — carries NO judgeModel key, and keeps every judge dimension FEEDER', () => {
  // ONE root, two runs: the plain run is the reference for the feeders, and sharing the root
  // keeps the git history (and therefore every collected signal) identical between them.
  const root = buildEvalFixture()
  const plain = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(plain.code, 0, plain.stdout + plain.stderr)
  const back = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(back.code, 0, back.stdout + back.stderr)

  const plainReport = readReport(root, EVAL_DATE)
  const report = readReport(root, BACKFILL_DATE)
  // Without this the test would compare a plain report with a plain report and pass while
  // --backfill did nothing at all.
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(report.dimensions[key].sentinel, 'unjudged-backfill', `precondition: ${key} is the backfill sentinel`)

  // Not `=== undefined`: an explicit `judgeModel: null`/'none'/'backfill' would still be an
  // attribution line in the archive, and the trend page reads the KEY to mark baseline resets.
  assert.equal(
    Object.prototype.hasOwnProperty.call(report, 'judgeModel'),
    false,
    `an unjudged report may carry no judge attribution at all; got judgeModel=${JSON.stringify(report.judgeModel)}`,
  )

  for (const key of EVAL_JUDGE_KEYS) {
    const d = report.dimensions[key]
    assert.ok(
      Object.keys(d.signals ?? {}).length > 0,
      `${key}: the feeders are COUNTS of recorded things, not judgements — a backfill must not drop them`,
    )
    assert.deepEqual(
      d.signals,
      plainReport.dimensions[key].signals,
      `${key}: the deterministic feeders must be byte-identical to the plain run — only the sentinel differs`,
    )
    assert.deepEqual(d.sourceRefs, plainReport.dimensions[key].sourceRefs, `${key}: same artifacts cited`)
    assert.equal(d.owner, 'judge', `${key} stays judge-owned — nobody else may score it later either`)
  }
})

// ── 34. the mode is NAMED in the notes, beside the gaps it did not stop naming ──────────
test('eval <ARCID> --backfill — a note names the backfill MODE and the existing gap notes survive', () => {
  // omitVerdicts is the fixture variant that produces a real collector/scorer gap note, so
  // this pins that the mode note is ADDED to the honesty rails rather than replacing them.
  const root = buildEvalFixture({ omitVerdicts: true })
  const r = roadmap(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, BACKFILL_DATE)
  const notes = report.notes ?? []
  const modeNote = notes.find((n) => /backfill/i.test(n))
  assert.ok(modeNote, `a backfilled report must NAME its mode in notes; got ${JSON.stringify(notes)}`)
  assert.match(
    modeNote,
    /judge/i,
    `the mode note must say what the mode COSTS (the judge pass); got ${JSON.stringify(modeNote)}`,
  )

  const gapNote = notes.find((n) => /no-verdicts-file|verdicts file/i.test(n))
  assert.ok(
    gapNote,
    `the pre-existing artifact-gap note must still be present alongside the mode note; got ${JSON.stringify(notes)}`,
  )
  assert.equal(report.dimensions['verified-vs-intent'].sentinel, 'no-verdicts-file', 'the gap itself is unchanged')

  // The human lane prints notes; a mode this consequential must not be JSON-only.
  assert.ok(
    r.stdout.split('\n').some((l) => /note:/.test(l) && /backfill/i.test(l)),
    `stdout must print the backfill mode note; stdout was:\n${r.stdout}`,
  )
})

// ── 35. regression guard: WITHOUT the flag nothing changes ──────────────────────────────
test('eval <ARCID> — WITHOUT --backfill the judge dims stay pending-judge and unjudged-backfill never appears', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, EVAL_DATE)
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(report.dimensions[key].sentinel, 'pending-judge', `${key} still awaits a real judge pass`)
  assert.equal(
    rawReport(root, EVAL_DATE).includes('unjudged-backfill'),
    false,
    'the terminal sentinel must never leak into an ordinary run — that would cancel a pass that IS coming',
  )
})
