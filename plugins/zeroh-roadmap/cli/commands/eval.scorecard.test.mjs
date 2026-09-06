// Eval scorecard scenarios; fixture state is private to this test process.
import { ARC_ID, EVAL_DATE, SCORECARD_N_FLOOR, assert, buildEvalFixture, evalsDir, existsSync, join, parsesConsumerShape, plantPrior, plantSiblingArc, printsNumber, ratchetRow, readFileSync, readPriorReports, readReport, readScorecard, renderingsOf, roadmap, samplesOf, scorecard, scorecardCells, scorecardPath, sharedFixture, test } from '../testdata/eval.test-support.mjs'

// ── 45. every cell under the floor ABSTAINS, all the way to disk ─────────────────────────
test('eval scorecard — an under-floor corpus writes a document whose every cell abstains with NO metrics key', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE) // the dated report is what enrols EVALFIX in the corpus
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(scorecardPath(root)), `expected the projection at ${scorecardPath(root)}`)

  const doc = readScorecard(root)
  assert.equal(doc.nFloor, SCORECARD_N_FLOOR, 'the floor is STAMPED into the document, not left implicit')
  assert.equal(doc.generatedAt, `${EVAL_DATE}T00:00:00.000Z`, '--date pins the stamp; a wall-clock read here is a diff every run')

  const cells = scorecardCells(doc)
  // Without this the loop below is vacuous — an empty document would "pass" every assertion.
  assert.ok(cells.length > 0, `fixture precondition: the corpus must produce cells; got ${JSON.stringify(doc)}`)
  for (const { kind, id, cell } of cells) {
    assert.ok(
      cell.samples < doc.nFloor,
      `fixture precondition: this corpus is under-floor everywhere; ${kind} ${id} had ${cell.samples}`,
    )
    assert.equal(cell.abstained, true, `${kind} ${id}: ${cell.samples} samples is under the floor and must abstain`)
    // Not `metrics === undefined`: an explicit `metrics: null` survives JSON and reads as a
    // measurement of nothing. The key must be genuinely ABSENT.
    assert.equal('metrics' in cell, false, `${kind} ${id}: an abstained cell carries no metrics key at all`)
  }

  // The shape belongs to the CONSUMER, and its superRefine is what makes abstention structural.
  const res = parsesConsumerShape(root, 'ScorecardShape', doc)
  assert.equal(res.ok, true, `the persisted projection must satisfy ScorecardShape; got: ${res.detail}`)
})

// ── 46. the abstention has to reach the READER, carrying both numbers ────────────────────
test('eval scorecard — each abstained cell prints an ABSTAINED marker carrying ITS n and the floor', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  const cells = scorecardCells(doc)
  assert.ok(cells.length > 0, 'fixture precondition: the corpus must produce cells')
  const markerLines = r.stdout.split('\n').filter((l) => /ABSTAINED/.test(l))

  for (const { kind, id, cell } of cells) {
    // One line has to carry all three facts together. A run that printed "ABSTAINED" on one
    // line and the sample count three lines away leaves the reader to guess which cell was
    // under-sampled and by how much — the exact judgement the floor exists to hand them.
    const line = markerLines.find(
      (l) => l.includes(id) && printsNumber(l, cell.samples) && printsNumber(l, doc.nFloor),
    )
    assert.ok(
      line,
      `${kind} ${id}: expected ONE ABSTAINED line naming it with n=${cell.samples} and the floor ${doc.nFloor};` +
        ` the ABSTAINED lines were:\n${markerLines.join('\n')}`,
    )
  }
  assert.equal(
    markerLines.length,
    cells.length,
    `exactly one marker per abstained cell — an extra marker is a row with no cell behind it;` +
      ` got:\n${markerLines.join('\n')}`,
  )
})

// ── 47. a SCORED cell is reachable through the CLI, and prints its metrics ───────────────
test('eval scorecard — a driver cell at or above the floor renders a metrics row, not an abstention', () => {
  const root = buildEvalFixture()
  // Six derived phases sharing 9001's driver, task count and surface, so their cohort cell
  // clears SCORECARD_N_FLOOR even before 9001 itself joins it.
  const SIBLING = 'EVALSIB'
  const siblingPhases = [9101, 9102, 9103, 9104, 9105, 9106]
  plantSiblingArc(root, SIBLING, siblingPhases)
  plantPrior(root, EVAL_DATE)
  plantPrior(root, EVAL_DATE, { arcId: SIBLING })

  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  const scored = doc.drivers.filter((c) => c.abstained === false)
  assert.equal(
    scored.length,
    1,
    `fixture precondition: exactly one driver cell should clear the floor of ${doc.nFloor};` +
      ` the driver cells were ${JSON.stringify(doc.drivers.map((c) => ({ model: c.model, band: c.taskCountBand, surface: c.surface, samples: c.samples })))}` +
      `\n(a zero here usually means the sibling arc's trace did not collect — check stdout for a WARN:\n${r.stdout})`,
  )
  const cell = scored[0]
  assert.ok(cell.samples >= doc.nFloor, `a scored cell is at or above the floor; got ${cell.samples}`)
  assert.equal(typeof cell.metrics, 'object', 'a scored cell carries its metrics')
  assert.ok(Object.keys(cell.metrics).length > 0, 'and the metrics record is not empty')

  const row = r.stdout
    .split('\n')
    .find((l) => l.includes(cell.model) && printsNumber(l, cell.samples) && !/ABSTAINED/.test(l))
  assert.ok(
    row,
    `the scored cell must render as a metrics row, never an abstention; stdout was:\n${r.stdout}`,
  )
  for (const [key, value] of Object.entries(cell.metrics))
    assert.ok(
      renderingsOf(value).some((v) => row.includes(v)),
      `the scored row must PRINT ${key}=${JSON.stringify(value)} (a metric computed and not shown is a metric nobody acts on); row was: ${row}`,
    )
  // The named absence rail travels to the reader too: a sentinel metric is printed as its word,
  // and the row above already proved it, so what is checked here is that it did not become 0.
  for (const [key, value] of Object.entries(cell.metrics))
    assert.notEqual(value, null, `${key} must be a number or a NAMED sentinel, never null`)

  const res = parsesConsumerShape(root, 'ScorecardShape', doc)
  assert.equal(res.ok, true, `got: ${res.detail}`)
})

// ── 48. THE PROJECTION IS NOT A BASELINE ─────────────────────────────────────────────────
test('eval scorecard — writing scorecard.json does not change what readPriorReports sees', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  plantPrior(root, EVAL_DATE, { all: 65 })

  const before = readPriorReports(evalsDir(root))
  assert.equal(before.length, 3, `fixture precondition: three dated reports; got ${before.length}`)

  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(scorecardPath(root)), 'fixture precondition: the projection was actually written')

  const after = readPriorReports(evalsDir(root))
  assert.equal(
    after.length,
    before.length,
    `the projection lands in the SAME directory the ratchet reads. A scorecard picked up as a` +
      ` prior would drag every future baseline toward a document that scores no dimension at all.` +
      ` Reports seen after: ${JSON.stringify(after.map((d) => d.date))}`,
  )

  // And the same fact through a REAL second command: the arc-eval run reports its baseline
  // sample count in the ratchet note, so a fourth "prior" would be visible there too.
  const second = roadmap(root, ['eval', ARC_ID, '--date', '2026-07-26'])
  assert.equal(second.code, 0, second.stdout + second.stderr)
  assert.equal(
    samplesOf(ratchetRow(readReport(root, '2026-07-26'), 'code-confidence')),
    before.length,
    'the ratchet counts exactly the dated REPORTS — the projection is not one of them',
  )
})

// ── 49. reproducibility — the committed artifact must not churn ──────────────────────────
test('eval scorecard — two runs at the same --date over the same corpus are BYTE-IDENTICAL', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)

  const first = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const firstBytes = readFileSync(scorecardPath(root), 'utf8')

  const second = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(second.code, 0, `the projection is regenerated in place, never refused: ${second.stdout + second.stderr}`)
  // Raw strings, not parsed objects: key order, indentation and the trailing newline are all
  // part of what shows up as a diff in the committed archive on every regeneration.
  assert.equal(
    readFileSync(scorecardPath(root), 'utf8'),
    firstBytes,
    'the same inputs and the same date must reproduce the same BYTES',
  )
})

// ── 50. the one wall-clock mint is LOUD ──────────────────────────────────────────────────
test('eval scorecard — an omitted --date defaults to today and SAYS so, naming the flag', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)

  const r = scorecard(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const now = new Date()
  const candidates = [now.toISOString().slice(0, 10), now.toLocaleDateString('sv-SE')]
  const doc = readScorecard(root)
  const today = candidates.find((d) => doc.generatedAt.startsWith(d))
  assert.ok(today, `generatedAt must be stamped with today; looked for ${candidates.join(' or ')}, got ${doc.generatedAt}`)

  const line = r.stdout.split('\n').find((l) => l.includes(today) && l.includes('--date'))
  assert.ok(
    line,
    `the defaulted date must be printed beside the --date flag that overrides it; stdout was:\n${r.stdout}`,
  )
})

// ── 51. --json ───────────────────────────────────────────────────────────────────────────
test('eval scorecard --json — stdout carries the document AND the file is still written', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)

  const r = scorecard(root, ['--date', EVAL_DATE, '--json'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(scorecardPath(root)), '--json is an ADDITIONAL lane; it does not suppress the write')

  const emitted = JSON.parse(r.stdout)
  assert.deepEqual(
    emitted,
    readScorecard(root),
    'the emitted document and the persisted one are the same document — two renderings that could drift are two contracts',
  )
})

// ── 52. NO POOLED ROW — checked against the document, not by grepping for a word ─────────
test('eval scorecard — nothing rendered or persisted claims a cross-cohort total', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = readScorecard(root)
  // (a) THE DOCUMENT: the envelope has exactly five keys, so there is nowhere for a summary,
  // an overall or a fleet mean to live. An added field would fail here by name.
  assert.deepEqual(
    Object.keys(doc).sort(),
    ['drivers', 'generatedAt', 'nFloor', 'notes', 'planners', 'reviewers'],
    'the envelope carries the three cell arrays and nothing that could hold a pooled figure',
  )

  const cells = scorecardCells(doc)
  assert.ok(cells.length > 1, 'fixture precondition: a pooled row is only meaningful over several cells')

  // (b) THE RENDERING: one row per cell and no row beyond them. Every rendered row is matched
  // back to a cell of the document rather than counted loosely.
  const rows = r.stdout.split('\n').filter((l) => /ABSTAINED/.test(l))
  assert.equal(rows.length, cells.length, `one row per cell; rows were:\n${rows.join('\n')}`)
  for (const line of rows)
    assert.ok(
      cells.some(({ id, cell }) => line.includes(id) && printsNumber(line, cell.samples)),
      `every rendered row must correspond to a real cell (identity + its own n); this one does not: ${line}`,
    )

  // (c) THE ONE NUMBER a pooled row would have to print: the cross-cohort sample total. It is
  // computed from the document rather than grepped for by name, so a summary row spelled
  // "fleet", "overall" or with no label at all is caught just the same.
  const total = cells.reduce((a, { cell }) => a + cell.samples, 0)
  assert.ok(
    !cells.some(({ cell }) => cell.samples === total),
    `fixture precondition: the pooled total (${total}) must not coincide with any cell's own n`,
  )
  // The scan covers the RENDERED REPORT only. The trailing `wrote <path>` confirmation carries
  // the fixture's mkdtemp suffix — a random filesystem name, never a claim about the data — and
  // printsNumber's lookarounds exclude only [\d.-], so a suffix like `zr-evalfix-WiQ4p8` reads
  // as "a line printing 8" and this test reds. It fires whenever mkdtemp's 6-char suffix happens
  // to carry the total's digits with non-[\d.-] neighbours — measured at ~6% of runs over the
  // 62-char alphabet, which is why it read as an intermittent flake rather than a defect.
  const rendered = r.stdout.split('\n').filter((l) => !l.startsWith('wrote '))
  assert.ok(
    rendered.length < r.stdout.split('\n').length,
    'precondition: the write confirmation is present and was the line excluded',
  )
  assert.deepEqual(
    rendered.filter((l) => printsNumber(l, total)),
    [],
    `no line may print the cross-cohort total ${total} — work is not randomly assigned, so a pooled` +
      ` figure is a comparison the data cannot support; stdout was:\n${r.stdout}`,
  )
})

// ── 53. an arc that will not collect is WARNed and EXCLUDED, never a hard failure ────────
test('eval scorecard — an enrolled arc whose trace cannot collect is named in a WARN and changes nothing', () => {
  const root = buildEvalFixture()
  plantPrior(root, EVAL_DATE)
  const clean = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(clean.code, 0, clean.stdout + clean.stderr)
  const cleanBytes = readFileSync(scorecardPath(root), 'utf8')

  // A dated report with no arc file behind it: enrolled by the corpus rule, uncollectable in
  // fact. The corpus is historical, so this is an ordinary state, not an error state.
  plantPrior(root, EVAL_DATE, { arcId: 'GHOSTARC' })
  const r = scorecard(root, ['--date', EVAL_DATE])
  assert.equal(r.code, 0, `one uncollectable arc must not fail the sweep: ${r.stdout + r.stderr}`)

  const out = r.stdout + r.stderr
  assert.match(out, /WARN[\s\S]{0,200}GHOSTARC/, `the excluded arc must be named in a WARN; output was:\n${out}`)
  assert.equal(
    readFileSync(scorecardPath(root), 'utf8'),
    cleanBytes,
    'an excluded arc contributes NOTHING — not a cell, not a sample, not a zero',
  )
})

// ── 54. NON-SHADOWING: the new literal must not swallow the arc-id lane ──────────────────
test('eval <ARCID> — the `scorecard` literal shadows nothing; a bare arcid still reaches the arc-eval path', () => {
  const root = sharedFixture()
  // The cheap proof (same idiom as the `lesson` non-shadowing test): an arc id that does not
  // exist must still be refused BY THE ARC-EVAL LANE, which names the missing arc file.
  const r = roadmap(root, ['eval', 'NOSUCHARC', '--date', EVAL_DATE])
  assert.notEqual(r.code, 0, `a missing arc must never exit 0: ${r.stdout}`)
  const out = r.stdout + r.stderr
  assert.match(out, /NOSUCHARC/, 'the refusal names the arc it could not find')
  assert.match(out, /\.arc\.ts|arc file/, `it is the ARC-EVAL refusal, not a scorecard usage line; got:\n${out}`)
  assert.equal(existsSync(scorecardPath(root)), false, 'and an arc id never regenerates the projection')
})
