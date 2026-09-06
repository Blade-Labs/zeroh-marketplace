// Eval phase-records scenarios; fixture state is private to this test process.
import { ARC_ID, BACKFILL_DATE, EVAL_DATE, EVAL_JUDGE_KEYS, MERGE_JUDGE_CMD, SCORECARD_N_FLOOR, assert, buildEvalFixture, evalsDir, existsSync, join, parsesConsumerShape, pendingCountLine, plantPhaseEvalRecords, printsNumber, readPriorReports, readReport, readScorecard, readdirSync, reportPath, roadmapCapturingBothStreams, scorecard, test, writeFileSync } from '../testdata/eval.test-support.mjs'

// ── 55. phase records alone fill a driver cell, end to end ───────────────────────────────
test('eval scorecard — a repo with NO arc report at all still scores a driver cell from phase records', { timeout: 300_000 }, () => {
  const root = buildEvalFixture()
  const RECORDS = [8801, 8802, 8803, 8804, 8805]
  plantPhaseEvalRecords(root, RECORDS)

  // The precondition that makes this test mean anything: NOTHING enrols an arc, so the
  // arc-trace loop contributes zero and every cell below came from the records.
  assert.deepEqual(
    readPriorReports(evalsDir(root)).map((d) => d.date),
    [],
    `fixture precondition: no dated report, so no arc is enrolled; the dir held ${JSON.stringify(readdirSync(evalsDir(root)))}`,
  )
  assert.equal(RECORDS.length, SCORECARD_N_FLOOR, 'fixture precondition: exactly at the floor, so an off-by-one in the inlet shows here')

  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  assert.equal(doc.nFloor, SCORECARD_N_FLOOR)
  const scored = doc.drivers.filter((c) => c.abstained === false)
  assert.equal(
    scored.length,
    1,
    `exactly one driver cell clears the floor of ${doc.nFloor}; the driver cells were` +
      ` ${JSON.stringify(doc.drivers.map((c) => ({ model: c.model, lane: c.lane, band: c.taskCountBand, surface: c.surface, samples: c.samples })))}` +
      `\n(stdout was:\n${r.stdout})`,
  )
  const cell = scored[0]
  assert.equal(cell.model, 'claude-opus-5', 'the cell is named for the driver the RECORDS attribute to')
  assert.equal(cell.lane, 'session')
  assert.equal(cell.samples, SCORECARD_N_FLOOR, 'one sample per record')

  // THE ANTI-ZERO RAIL through the whole pipe: slicer → ScorecardShape → disk → renderer.
  assert.equal(
    cell.metrics.escapeFixesPerPhase,
    'scan-unavailable',
    `a phase record has no arc, no land boundary and no escape scan — a minted 0 reads as a spotless driver;` +
      ` the metrics were ${JSON.stringify(cell.metrics)}`,
  )
  assert.notEqual(cell.metrics.escapeFixesPerPhase, 0, 'and it is emphatically not a zero')

  // Planner cells fill the same way; reviewers stay arc-fed, so a record-only corpus has none.
  const plannerScored = (doc.planners ?? []).filter((c) => c.abstained === false)
  assert.deepEqual(
    plannerScored.map((c) => ({ model: c.model, samples: c.samples })),
    [{ model: 'claude-fable-5', samples: SCORECARD_N_FLOOR }],
    `the planner axis fills from attribution.plannedBy; got ${JSON.stringify(doc.planners)}`,
  )
  assert.deepEqual(doc.reviewers, [], `v1 reads no reviewer rounds off a phase record; got ${JSON.stringify(doc.reviewers)}`)

  // The notes name BOTH source counts, so a reader can tell a record-fed table from an arc-fed
  // one without going back to the directory listing.
  const sourceNotes = doc.notes.filter((n) => printsNumber(n, RECORDS.length) && printsNumber(n, 0))
  assert.equal(
    sourceNotes.length,
    1,
    `exactly one note must name both source counts (${RECORDS.length} phase records, 0 arc traces); notes were ${JSON.stringify(doc.notes)}`,
  )

  // And the sentinel reaches the READER as its word. A metric that is right in the document and
  // blank in the table is a metric nobody acts on.
  const row = r.stdout
    .split('\n')
    .find((l) => l.includes(cell.model) && printsNumber(l, cell.samples) && !/ABSTAINED/.test(l))
  assert.ok(row, `the scored cell must render as a metrics row; stdout was:\n${r.stdout}`)
  assert.ok(
    row.includes('scan-unavailable'),
    `the row must PRINT the named absence, never a dash or a 0 standing in for it; row was: ${row}`,
  )

  const res = parsesConsumerShape(root, 'ScorecardShape', doc)
  assert.equal(res.ok, true, `the persisted projection must satisfy ScorecardShape; got: ${res.detail}`)
})

// ── 56. an unreadable record is NAMED on the say channel, and its siblings still count ───
test('eval scorecard — an unreadable phase record is WARNED by name and the rest still score', { timeout: 300_000 }, () => {
  const root = buildEvalFixture()
  plantPhaseEvalRecords(root, [8801, 8802, 8803, 8804, 8805])
  const corrupt = join(evalsDir(root), 'phase-8899.peval.json')
  writeFileSync(corrupt, '{"phase": 8899, "date": "2026-08-20",')

  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, `a corrupt record is missing measurement, never a reason to fail the command:\n${r.stdout + r.stderr}`)
  assert.ok(
    r.stdout.includes('phase-8899.peval.json'),
    `the warning must NAME the file on the say channel — one that dies in the library is the silent skip again;` +
      ` stdout was:\n${r.stdout}\nstderr was:\n${r.stderr}`,
  )

  const doc = readScorecard(root)
  const scored = doc.drivers.filter((c) => c.abstained === false)
  assert.equal(scored.length, 1, `the five readable records still reach the floor; drivers were ${JSON.stringify(doc.drivers)}`)
  assert.equal(scored[0].samples, SCORECARD_N_FLOOR, 'and the corrupt one contributes NO sample — not a zero-filled one either')
})

// ── 57. the signal: a count and the remediation command, on stderr ───────────────────────
test('eval <ARCID> — a persisted report with pending-judge dimensions COUNTS them on stderr and names merge-judge', { timeout: 300_000 }, () => {
  const root = buildEvalFixture()
  const r = roadmapCapturingBothStreams(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(reportPath(root, EVAL_DATE)), 'precondition: the dated report really was persisted')

  // Without this the assertions below could pass over a report that had nothing pending.
  const report = readReport(root, EVAL_DATE)
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(report.dimensions[key].sentinel, 'pending-judge', `precondition: ${key} is pending`)

  const line = pendingCountLine(r.stderr, EVAL_JUDGE_KEYS.length)
  assert.ok(
    line,
    `stderr must carry a line COUNTING the ${EVAL_JUDGE_KEYS.length} pending-judge dimensions — ` +
      `"wrote <path>" alone reads as a finished report; stderr was:\n${r.stderr}\nstdout was:\n${r.stdout}`,
  )
  assert.ok(
    r.stderr.includes(MERGE_JUDGE_CMD),
    `stderr must NAME the remediation command verbatim (\`${MERGE_JUDGE_CMD}\`) — a count with no next step ` +
      `is a complaint, not a signal; stderr was:\n${r.stderr}`,
  )
})

// ── 58. the silence: nothing pending → no count, no command ──────────────────────────────
test('eval <ARCID> --backfill — with NOTHING pending, stderr carries neither the count nor merge-judge', { timeout: 300_000 }, () => {
  const root = buildEvalFixture()
  const r = roadmapCapturingBothStreams(root, ['eval', ARC_ID, '--backfill', '--date', BACKFILL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  // The precondition IS the case: these dimensions are terminal, so zero are pending.
  const report = readReport(root, BACKFILL_DATE)
  for (const key of EVAL_JUDGE_KEYS)
    assert.equal(report.dimensions[key].sentinel, 'unjudged-backfill', `precondition: ${key} is terminal, not pending`)

  assert.equal(
    r.stderr.includes('merge-judge'),
    false,
    `nothing is pending — pointing at the merge seam sends an operator to run a pass this mode declined; stderr was:\n${r.stderr}`,
  )
  assert.equal(
    pendingCountLine(r.stderr, EVAL_JUDGE_KEYS.length) ?? null,
    null,
    `a count of pending dimensions must not be printed when the count is zero; stderr was:\n${r.stderr}`,
  )
  assert.equal(
    /pending-judge/.test(r.stderr),
    false,
    `the word promises a pass that is not coming for a backfill; stderr was:\n${r.stderr}`,
  )
})
