// Eval run scenarios; fixture state is private to this test process.
import { ARC_ID, EVAL_DATE, EVAL_DETERMINISTIC_KEYS, EVAL_JUDGE_KEYS, EVAL_KEYS, assert, buildEvalFixture, docFile, evalsDir, existsSync, git, join, mkdirSync, parsesConsumerShape, plantPrior, ratchetRow, readFileSync, readReport, renameSync, reportPath, roadmap, samplesOf, sharedFixture, test, timingPath, writeFileSync } from '../testdata/eval.test-support.mjs'
import { createHash } from 'node:crypto'

// ── 1. end to end ─────────────────────────────────────────────────────────────────────
test('eval <ARCID> — writes the dated report with all seven dimensions, three scored and four pending-judge', () => {
  const root = buildEvalFixture()
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({
    arcId: ARC_ID,
    outcome: 'shipped',
    compromiseDisposition: [],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true },
    receiptRef: 'none',
  }))
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(reportPath(root, EVAL_DATE)), `expected the report at ${reportPath(root, EVAL_DATE)}`)

  const report = readReport(root, EVAL_DATE)
  assert.equal(report.arcId, ARC_ID)
  const summaryBytes = readFileSync(join(root, 'roadmap', 'arc-summary.json'))
  assert.equal(report.landSummaryDigest, `sha256:${createHash('sha256').update(summaryBytes).digest('hex')}`)
  assert.equal(report.date, EVAL_DATE, 'the report is dated by the flag, not by a second wall-clock read')
  assert.deepEqual(Object.keys(report.dimensions).sort(), [...EVAL_KEYS].sort(), 'exactly the seven closed keys')

  for (const key of EVAL_DETERMINISTIC_KEYS) {
    const d = report.dimensions[key]
    assert.equal(typeof d.score, 'number', `${key} is deterministic — it must carry a real number`)
    assert.equal(d.sentinel, undefined, `${key} has every input it needs in this fixture`)
  }
  for (const key of EVAL_JUDGE_KEYS) {
    const d = report.dimensions[key]
    assert.equal(d.sentinel, 'pending-judge', `${key} awaits the judge pass`)
    assert.equal(d.score, undefined, `${key} must not carry a CLI-invented number`)
    assert.notEqual(d.score, 0, `${key} must sentinel, never zero — a zero reads as a real, terrible arc`)
  }

  assert.equal(report.ratchet.length, 7, 'one ratchet row per dimension, always — a missing row reads as "not regressed"')
  const unrecorded = report.attribution.drivers.find((d) => d.model === 'unrecorded')
  assert.ok(
    unrecorded,
    `the fixture's driver-less phase must land as the literal 'unrecorded'; got ${JSON.stringify(report.attribution.drivers)}`,
  )
})

// ── 2. the written report really parses the consumer contract ─────────────────────────
test('eval <ARCID> — the file on disk satisfies the CONSUMER ArcEvalReportShape through the tsx bridge', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const res = parsesConsumerShape(root, 'ArcEvalReportShape', readReport(root, EVAL_DATE))
  assert.equal(res.ok, true, `the persisted report must satisfy ArcEvalReportShape; got: ${res.detail}`)
})

// ── 3. idempotence — the reproducibility bar ──────────────────────────────────────────
test('eval <ARCID> — a second run at the same --date is BYTE-IDENTICAL with --force, refused without it', () => {
  const root = buildEvalFixture()
  const first = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const before = readFileSync(reportPath(root, EVAL_DATE), 'utf8')

  const refused = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(refused.code, 2, refused.stdout + refused.stderr)
  assert.match(
    refused.stderr,
    new RegExp(reportPath(root, EVAL_DATE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'the refusal names the path it will not clobber',
  )
  assert.equal(readFileSync(reportPath(root, EVAL_DATE), 'utf8'), before, 'a refused re-run leaves the first report untouched')

  const forced = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--force'])
  assert.equal(forced.code, 0, forced.stdout + forced.stderr)
  // Byte-identity also pins that the run does NOT ratchet against its OWN previous report:
  // a re-run that read its predecessor as a prior would produce a different ratchet table.
  assert.equal(
    readFileSync(reportPath(root, EVAL_DATE), 'utf8'),
    before,
    'the same inputs and the same date must reproduce the same bytes',
  )
})

// ── 4. the regenerated projection ─────────────────────────────────────────────────────
test('eval <ARCID> — timing-stats.json is regenerated, parses TimingStatsShape, and names its heuristic', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(timingPath(root)), `expected the projection at ${timingPath(root)}`)

  const stats = JSON.parse(readFileSync(timingPath(root), 'utf8'))
  const res = parsesConsumerShape(root, 'TimingStatsShape', stats)
  assert.equal(res.ok, true, `the projection must satisfy TimingStatsShape; got: ${res.detail}`)
  assert.ok(stats.cohorts.length >= 1, 'the fixture arc has timed phases — the table must not be empty')
  assert.ok(
    stats.notes.some((n) => /heuristic/i.test(n)),
    `the surface axis is a path guess and must SAY so; got ${JSON.stringify(stats.notes)}`,
  )
})

// ── 5. a corrupted prior is skipped BY NAME, never silently ───────────────────────────
test('eval <ARCID> — an unparseable prior report WARNs by filename and never becomes a baseline', () => {
  const root = buildEvalFixture()
  mkdirSync(evalsDir(root), { recursive: true })
  const corruptName = `${ARC_ID}-2026-07-01.json`
  writeFileSync(join(evalsDir(root), corruptName), '{"broken":')
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, `one bad prior must not fail the run: ${r.stdout + r.stderr}`)
  const out = r.stdout + r.stderr
  assert.match(out, new RegExp(`WARN[\\s\\S]{0,200}${corruptName.replace(/\./g, '\\.')}`), 'the skipped file is named in a WARN')

  // The two readable priors still formed the baseline: a corrupt file that had been read as
  // an empty/zero report would show up here as a third sample or a collapsed baseline.
  const row = ratchetRow(readReport(root, EVAL_DATE), 'code-confidence')
  assert.equal(samplesOf(row), 2, 'exactly the two VALID priors are the baseline')
  assert.equal(typeof row.baseline, 'number')
  assert.ok(row.baseline >= 60 && row.baseline <= 70, `the baseline is the mean of 60 and 70; got ${row.baseline}`)
})

// ── 6. the non-report siblings in the same directory ──────────────────────────────────
test('eval <ARCID> — the -sweep/-verdicts siblings and timing-stats.json are NOT priors', () => {
  const root = buildEvalFixture()
  // The fixture ships EVALFIX-2026-07-20-sweep.json, -verdicts.json and an earlier sweep;
  // they live in the same directory and match the same arc prefix.
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-sweep.json`)), 'fixture precondition: the sweep sibling')
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-verdicts.json`)), 'fixture precondition: the verdicts sibling')

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const out = r.stdout + r.stderr
  assert.doesNotMatch(out, /-sweep\.json/, 'a sweep record is not a report and must not be warned about as one')
  assert.doesNotMatch(out, /-verdicts\.json/, 'a verdicts record is not a report and must not be warned about as one')
  assert.doesNotMatch(out, /timing-stats\.json[^\n]*(WARN|parse)/i, 'the projection is not a prior report either')

  const row = ratchetRow(readReport(root, EVAL_DATE), 'code-confidence')
  assert.equal(row.baseline, null, 'no dated REPORT exists yet — the siblings must not manufacture a baseline')
  assert.equal(row.note, 'no-baseline', `got ${JSON.stringify(row.note)}`)
  assert.equal(row.regression, false, 'a baseline nobody can compute is never a regression')
})

// ── 7. --collect-only ─────────────────────────────────────────────────────────────────
test('eval <ARCID> --collect-only — writes NOTHING and, with --json, emits the trace on stdout', () => {
  const root = buildEvalFixture()
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({
    arcId: ARC_ID,
    outcome: 'shipped',
    compromiseDisposition: [{ item: 'current-pointer-proof', disposition: 'ACCEPT' }],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true },
    receiptRef: 'current-pointer-receipt',
  }))
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--collect-only'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, '--collect-only stops before the report')
  assert.equal(existsSync(timingPath(root)), false, '--collect-only regenerates no projection either')

  const j = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--collect-only', '--json'])
  assert.equal(j.code, 0, j.stdout + j.stderr)
  const trace = JSON.parse(j.stdout)
  assert.ok(Array.isArray(trace.phases) && trace.phases.length > 0, 'the emitted trace carries its phases')
  assert.equal(typeof trace.git, 'object', 'and the git facts the scorer reads')
  assert.equal(trace.summary.receiptRef, 'current-pointer-receipt', 'the current shipped pointer replaces a stale dated summary before scoring')
  assert.equal(trace.summary.compromiseDisposition[0].item, 'current-pointer-proof')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, '--json does not smuggle a write back in')
})

// ── 8. --json on a full run ───────────────────────────────────────────────────────────
test('eval <ARCID> --json — stdout is the report JSON, parseable on its own', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--json'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const report = JSON.parse(r.stdout)
  assert.ok(report.dimensions, 'the JSON lane carries the dimensions record')
  assert.deepEqual(Object.keys(report.dimensions).sort(), [...EVAL_KEYS].sort())
})

// ── 9. the printed summary ────────────────────────────────────────────────────────────
test('eval <ARCID> — stdout names every dimension and states plainly which ones await the judge', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  for (const key of EVAL_KEYS) assert.ok(r.stdout.includes(key), `stdout must name ${key}`)
  for (const key of EVAL_JUDGE_KEYS) {
    const line = r.stdout.split('\n').find((l) => l.includes(key) && /pending-judge/.test(l))
    assert.ok(line, `${key}'s line must show its sentinel, not a blank or a zero; stdout was:\n${r.stdout}`)
  }
  // One line that says WHICH dimensions are outstanding, so a reader never mistakes a
  // three-dimension report for a seven-dimension one.
  const awaits = r.stdout.split('\n').find((l) => /await/i.test(l))
  assert.ok(awaits, `stdout must carry a line saying the judge pass is outstanding; stdout was:\n${r.stdout}`)
  for (const key of EVAL_JUDGE_KEYS) assert.ok(awaits.includes(key), `the awaiting line must name ${key}; got ${awaits}`)
})

// ── 10. a regression is named ─────────────────────────────────────────────────────────
test('eval <ARCID> — a drop below the rolling baseline prints a REGRESSION line naming the dimension', () => {
  const root = buildEvalFixture()
  // Far above anything this fixture can score, so the current run is unambiguously a drop.
  plantPrior(root, '2026-07-02', { all: 60, per: { 'code-confidence': 99 } })
  plantPrior(root, '2026-07-03', { all: 60, per: { 'code-confidence': 98 } })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, EVAL_DATE)
  assert.ok(
    report.dimensions['code-confidence'].score < 98,
    `fixture precondition: the current score must sit below the planted baseline; got ${report.dimensions['code-confidence'].score}`,
  )
  const row = ratchetRow(report, 'code-confidence')
  assert.equal(row.regression, true, 'the row itself must flag')
  assert.ok(row.delta < 0, 'a flagged regression always has a computable negative delta')

  const line = r.stdout.split('\n').find((l) => /REGRESSION/.test(l))
  assert.ok(line, `a regression must be shouted, not buried in the JSON; stdout was:\n${r.stdout}`)
  assert.ok(line.includes('code-confidence'), `the REGRESSION line must name the dimension; got ${line}`)
  // The dimensions that did NOT regress must not be dressed up as regressions.
  const shouted = r.stdout.split('\n').filter((l) => /REGRESSION/.test(l))
  assert.equal(shouted.length, 1, `exactly the one regressed dimension is shouted; got ${JSON.stringify(shouted)}`)
})

// ── 11. the one wall-clock mint is LOUD ───────────────────────────────────────────────
test('eval <ARCID> — an omitted --date defaults to today and SAYS so, naming the flag', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const now = new Date()
  // Either reading of "today" is acceptable; what is not acceptable is minting a date silently.
  const candidates = [now.toISOString().slice(0, 10), now.toLocaleDateString('sv-SE')]
  const today = candidates.find((d) => existsSync(reportPath(root, d)))
  assert.ok(today, `the report must land under today's date; looked for ${candidates.join(' or ')}`)

  const line = r.stdout.split('\n').find((l) => l.includes(today) && l.includes('--date'))
  assert.ok(
    line,
    `the defaulted date must be printed beside the --date flag that overrides it; stdout was:\n${r.stdout}`,
  )
})

// ── 12. an unknown arc ────────────────────────────────────────────────────────────────
test('eval <ARCID> — an arc with no arc file is REFUSED by name, not scored as an empty arc', () => {
  const root = sharedFixture()
  const r = roadmap(root, ['eval', 'NOSUCHARC', '--date', EVAL_DATE])
  assert.notEqual(r.code, 0, `a missing arc must never exit 0: ${r.stdout}`)
  assert.ok([1, 2].includes(r.code), `the three-way contract holds (got ${r.code})`)
  assert.match(r.stdout + r.stderr, /NOSUCHARC/, 'the refusal names the arc it could not find')
  // A stack frame is an INDENTED `at ` line. Matching a bare `at ` anywhere would fire on
  // any prose containing "that " — which is a test that fails on good English, not on a leak.
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a refusal reads as a refusal, not a leaked stack')
  assert.equal(
    existsSync(join(evalsDir(root), `NOSUCHARC-${EVAL_DATE}.json`)),
    false,
    'a zero-phase report for an arc that does not exist would be fabricated data',
  )
})

// ── 13. discoverability ───────────────────────────────────────────────────────────────
test('roadmap --help — the eval entry advertises the bare-arc collect/score form', () => {
  const root = sharedFixture()
  const r = roadmap(root, ['--help'])
  assert.equal(r.code, 0, r.stderr)
  const line = r.stdout.split('\n').find((l) => /^\s*eval\b/.test(l))
  assert.ok(line, `--help must list eval; stdout was:\n${r.stdout}`)
  assert.match(line, /<arc/i, 'the bare-arcid subform is the one callers reach for — it must be shown')
  assert.match(line, /collect/i)
  assert.match(line, /score/i)
})

// ── 14. the recorders are not shadowed ────────────────────────────────────────────────
test('eval record-sweep — still works from the fixture root; the bare-arcid form shadows nothing', () => {
  const root = buildEvalFixture()
  // A bare positional that happens to look like an arc id must not swallow the two literal
  // subcommand names; this is the regression the new dispatch could most easily cause.
  const sweep = JSON.parse(readFileSync(join(evalsDir(root), `${ARC_ID}-2026-07-20-sweep.json`), 'utf8'))
  const f = docFile(root, 'resweep.json', { ...sweep, date: '2026-07-26' })
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC_ID, f])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(join(evalsDir(root), `${ARC_ID}-2026-07-26-sweep.json`)), 'the recorder still lands its suffixed file')
})

// ── gate R1: the baseline is CROSS-ARC ────────────────────────────────────────────────
test('eval <ARCID> — prior reports from OTHER arcs form the baseline (an arc lands once)', () => {
  const root = buildEvalFixture()
  // Two priors filed under a DIFFERENT arc id. Scoped to this arc alone there would be zero
  // comparable priors and every row would read no-baseline forever, so the PROVE stage would
  // never fire on a workflow where each arc lands exactly once.
  for (const [date, all] of [['2026-07-02', 60], ['2026-07-03', 70]]) {
    const p = plantPrior(root, date, { all })
    renameSync(p, join(evalsDir(root), `OTHERARC-${date}.json`))
  }

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const row = ratchetRow(readReport(root, EVAL_DATE), 'code-confidence')
  assert.equal(samplesOf(row), 2, 'both foreign-arc reports are part of the reference class')
  assert.ok(row.baseline >= 60 && row.baseline <= 70, `the mean of 60 and 70; got ${row.baseline}`)
})

// ── gate R1: a mis-shaped artifact is refused at the trace boundary ────────────────────
test('eval <ARCID> — a well-formed-JSON but MIS-SHAPED verdicts artifact is REFUSED, not scored', () => {
  const root = buildEvalFixture()
  const vp = join(evalsDir(root), `${ARC_ID}-2026-07-20-verdicts.json`)
  const doc = JSON.parse(readFileSync(vp, 'utf8'))
  // Valid JSON, invalid contract: the tier is not a member of the closed enum. Without the
  // trace parse this would reach the scorer and become a real-looking number.
  doc.verdicts[0].tierUsed = 'live-hosts'
  writeFileSync(vp, JSON.stringify(doc, null, 2) + '\n')

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 2, `a mis-shaped artifact must be refused, not scored: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /ArcTraceShape/, 'the refusal names the contract that rejected it')
  assert.equal(existsSync(reportPath(root, EVAL_DATE)), false, 'nothing derived from unreadable evidence reaches disk')
})

// ── gate R1: the regenerated projection is reproducible ───────────────────────────────
test('eval <ARCID> — timing-stats.json is byte-identical across a --force re-run at the same date', () => {
  const root = buildEvalFixture()
  assert.equal(roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE]).code, 0)
  const first = readFileSync(timingPath(root), 'utf8')
  assert.equal(roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE, '--force']).code, 0)
  assert.equal(
    readFileSync(timingPath(root), 'utf8'),
    first,
    'a second wall-clock read here would put a spurious diff in the committed archive on every run',
  )
})
