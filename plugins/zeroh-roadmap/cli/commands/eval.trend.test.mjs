// Eval trend scenarios; fixture state is private to this test process.
import { ARC_ID, BIN, EVAL_DATE, EVAL_KEYS, FOREIGN_NOTE, PLUGIN_ROOT, POST_RESET_SIGNALS, SPEED_RESET_ID, SPEED_RESET_RX, TREND_JUDGE_A, TREND_JUDGE_B, WORKFLOW_GAP_RX, assert, buildEvalFixture, dimSection, evalTrend, evalsDir, execFileSync, existsSync, join, makeConsumer, mkdirSync, plantPrior, readFileSync, readReport, roadmap, rx, seriesDraw, speedResetNote, test, trendPath, writeFileSync } from '../testdata/eval.test-support.mjs'

// ── 23. the headline: seven sections, the judge-change marker, and ZERO external assets ──
test('eval trend — renders every dimension, marks the judgeModel change, and links to NOTHING remote', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60, judgeModel: TREND_JUDGE_A })
  plantPrior(root, '2026-07-03', { all: 70, judgeModel: TREND_JUDGE_B })
  plantPrior(root, '2026-07-04', { all: 65, judgeModel: TREND_JUDGE_B })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(trendPath(root)), `expected the page at ${trendPath(root)}`)
  assert.match(r.stdout, rx(trendPath(root)), 'the run names the file it wrote')

  const html = readFileSync(trendPath(root), 'utf8')
  // All SEVEN, by name: a corpus-driven renderer that only draws the dimensions it found data
  // for would quietly shrink a seven-dimension picture to a three-dimension one.
  for (const key of EVAL_KEYS) {
    assert.ok(html.includes(key), `the page must name ${key}`)
    assert.ok(dimSection(html, key).length > 0, `${key} must have its own section`)
  }

  // The judge change is a BASELINE RESET, not a data point on the same line: both models are
  // named and the page says what the change means, beside a drawn vertical marker.
  assert.ok(html.includes(TREND_JUDGE_B), `the off-pin judge must be named on the page`)
  assert.ok(html.includes(TREND_JUDGE_A), `and the model it replaced, or the marker names one side only`)
  assert.match(html, /baseline[- ]reset/i, 'a judge change must be labelled for what it is')
  assert.match(html, /<(?:line|rect)\b[^>]*>/, 'the marker is DRAWN, not merely mentioned in prose')

  // The no-CDN bar. This is the criterion the phase names explicitly: one file, no network.
  assert.doesNotMatch(html, /https?:\/\//, 'a self-contained page carries no absolute URL at all')
})

// ── 24. a sentinel is a GAP in the line, never an interpolation ────────────────────────
test('eval trend — a sentinel dimension BREAKS its series rather than being connected across', () => {
  const root = buildEvalFixture()
  // doc-brevity: scored, ABSENT, scored. The two scored points are non-adjacent, so a correct
  // rendering draws zero connecting segments for this dimension while every other dimension
  // (three scored points) draws two.
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70, sentinels: { 'doc-brevity': 'pending-judge' } })
  plantPrior(root, '2026-07-04', { all: 65 })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  const gapped = seriesDraw(dimSection(html, 'doc-brevity'))
  const whole = seriesDraw(dimSection(html, 'code-confidence'))

  // Harness sanity FIRST: a fully-scored dimension really does register as connected segments
  // here. Without this the zero below could mean "this counter never sees anything".
  assert.ok(whole.points >= 3, `code-confidence has three scored reports; counted ${whole.points} plotted points`)
  assert.ok(whole.segments >= 2, `a fully-scored line is connected; counted ${whole.segments} segments`)

  assert.ok(gapped.points >= 2, `both SCORED doc-brevity reports must still be plotted; counted ${gapped.points}`)
  // The assertion that kills the naive implementation: one that drops sentinel reports from the
  // series and hands the surviving [60, 65] to a single polyline draws a segment straight over
  // the date nobody measured. Any such rendering registers segments >= 1 here.
  assert.equal(
    gapped.segments,
    0,
    `doc-brevity's two scored points flank an unmeasured date — connecting them draws a trend nobody measured (counted ${gapped.segments} segments)`,
  )
  // And the hole is stated, not merely left blank: a reader must be able to tell "no data" from
  // "the renderer forgot".
  assert.match(
    dimSection(html, 'doc-brevity'),
    /gap|pending-judge|no score|not scored|unmeasured/i,
    'the doc-brevity section must SAY that a report carried no score',
  )
})

// ── 25. a dimension nobody ever scored still gets a section ────────────────────────────
test('eval trend — a dimension with NO data anywhere renders a section saying so, never vanishes', () => {
  const root = buildEvalFixture()
  const noData = { speed: 'no-timestamps' }
  plantPrior(root, '2026-07-02', { all: 60, sentinels: noData })
  plantPrior(root, '2026-07-03', { all: 70, sentinels: noData })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  const section = dimSection(html, 'speed')
  assert.equal(seriesDraw(section).points, 0, 'nothing was measured — nothing may be plotted')
  assert.equal(seriesDraw(section).segments, 0, 'and certainly nothing connected')
  assert.match(section, /no data|no score|not scored|no-timestamps|unmeasured/i, 'the empty section must say WHY it is empty')
  // The other six are unaffected: an empty dimension must not blank the page.
  assert.ok(seriesDraw(dimSection(html, 'code-confidence')).segments >= 1, 'the scored dimensions still render')
})

// ── 26. a corrupted report is skipped BY NAME and the rest still render ────────────────
test('eval trend — an unparseable report WARNs by filename, exits 0, and the remaining reports render', () => {
  const root = buildEvalFixture()
  mkdirSync(evalsDir(root), { recursive: true })
  const corruptName = `${ARC_ID}-2026-07-01.json`
  writeFileSync(join(evalsDir(root), corruptName), '{"broken":')
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const r = evalTrend(root)
  assert.equal(r.code, 0, `one bad report must not fail the render: ${r.stdout + r.stderr}`)
  const out = r.stdout + r.stderr
  assert.match(out, new RegExp(`WARN[\\s\\S]{0,200}${corruptName.replace(/\./g, '\\.')}`), 'the skipped file is named in a WARN')
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a skipped file is a WARN, not a leaked stack')

  const html = readFileSync(trendPath(root), 'utf8')
  const drawn = seriesDraw(dimSection(html, 'code-confidence'))
  assert.ok(drawn.points >= 2, `the two readable reports still render; counted ${drawn.points} points`)
  assert.ok(drawn.segments >= 1, 'and they are connected — a corrupt neighbour is not a gap in the data')
  assert.doesNotMatch(html, /2026-07-01/, 'a file that did not parse contributes no point to the line')
})

// ── 27. the non-report siblings are not reports ────────────────────────────────────────
test('eval trend — -sweep/-verdicts siblings and timing-stats.json are neither read nor warned about', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  // Planted as FULL report documents under sibling names and a date shared with no real report:
  // an implementation that globbed *.json would happily plot them, and the distinctive score
  // plus the unique date make that visible rather than a coin flip.
  plantPrior(root, '2026-07-05', { all: 11, name: `${ARC_ID}-2026-07-05-sweep.json` })
  plantPrior(root, '2026-07-05', { all: 11, name: `${ARC_ID}-2026-07-05-verdicts.json` })
  plantPrior(root, '2026-07-05', { all: 11, name: 'timing-stats.json' })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const out = r.stdout + r.stderr
  assert.doesNotMatch(out, /-sweep\.json/, 'a sweep record is not a report and must not be warned about as one')
  assert.doesNotMatch(out, /-verdicts\.json/, 'a verdicts record is not a report either')
  assert.doesNotMatch(out, /timing-stats\.json/, 'the projection is not a report either')

  const html = readFileSync(trendPath(root), 'utf8')
  assert.doesNotMatch(html, /2026-07-05/, 'the siblings must contribute no data point')
  const drawn = seriesDraw(dimSection(html, 'code-confidence'))
  assert.ok(drawn.points >= 2, `the two real reports are plotted; counted ${drawn.points}`)
  // Two reports = ONE connecting segment. Had the three siblings been read as reports the line
  // would carry a third point and a second segment — counting segments says that regardless of
  // whether the renderer also marks each point with a circle.
  assert.equal(
    drawn.segments,
    1,
    `exactly the two dated REPORTS are the line — five files in the directory, two of them reports (counted ${drawn.segments} segments)`,
  )
})

test('eval <ARCID> — a fresh report is stamped with profile, fingerprint and a real workflow block', () => {
  const root = buildEvalFixture()
  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const report = readReport(root, EVAL_DATE)
  assert.equal(report.profile, 'prod-grade')
  assert.equal(report.workflow.profile, report.profile, 'the block snapshots the profile it ran under')
  // The sha is the PLUGIN's HEAD, and it is a measurement rather than a placeholder — plus the
  // `-dirty` marker whenever the plugin tree that RAN differs from the commit it points at,
  // which on this shared checkout is the usual case rather than the exception.
  const head = execFileSync('git', ['-C', PLUGIN_ROOT, 'rev-parse', '--short=12', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
  const dirty = execFileSync('git', ['-C', PLUGIN_ROOT, 'status', '--porcelain', '.'], { encoding: 'utf8' }).trim() !== ''
  assert.equal(report.workflow.pluginSha, dirty ? `${head}-dirty` : head, 'the producing build is named, not guessed')
  const measured = JSON.parse(
    execFileSync('node', [BIN, 'measure', '--flow', 'do-arc', '--json'], { encoding: 'utf8' }),
  )
  assert.equal(report.workflow.protocolLoadTokens, measured.totalTokens, 'one metering implementation, one number')
  // The fixture consumer ships no tsconfig.json, so 'unknown' is the HONEST answer here rather
  // than a defect — the language ladder itself is pinned rung by rung in eval-collect.test.mjs.
  assert.equal(report.fingerprint.language, 'unknown')
  assert.equal(report.fingerprint.corpusSize, 2, 'the consumer corpus is COUNTED, not asserted')
  assert.ok(!report.notes.some((n) => WORKFLOW_GAP_RX.test(n)), 'a stamped report names no provenance gap')
})

test('eval restamp — adds profile + fingerprint additively and leaves every SCORE byte-identical', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', { all: 60 })
  const before = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(before.profile, undefined, 'fixture precondition: an unstamped report')

  const r = roadmap(root, ['eval', 'restamp'])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /stamped/, 'the run prints what it did per file')

  const after = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(after.profile, 'prod-grade')
  assert.equal(after.fingerprint.repo.length > 0, true)
  // The honesty rail, asserted structurally rather than trusted: restamp NEVER re-scores.
  for (const key of ['dimensions', 'ratchet', 'attribution', 'date', 'arcId', 'judgeModel'])
    assert.deepEqual(after[key], before[key], `${key} must be untouched by a restamp`)
  // And it never invents provenance for a build nobody recorded.
  assert.equal(after.workflow, undefined, 'a retro-stamped plugin sha would be a fabricated fact')
  assert.ok(after.notes.some((n) => WORKFLOW_GAP_RX.test(n)), 'instead the absence is a NAMED gap')
})

test('eval restamp — a second run is byte-identical (idempotent, and the gap note is appended once)', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', { all: 60 })
  assert.equal(roadmap(root, ['eval', 'restamp']).code, 0)
  const first = readFileSync(p, 'utf8')

  const second = roadmap(root, ['eval', 'restamp'])
  assert.equal(second.code, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /unchanged/, 'a settled corpus reports unchanged, not a rewrite')
  assert.equal(readFileSync(p, 'utf8'), first, 'a settled restamp writes nothing')
  assert.equal(
    (JSON.parse(first).notes.filter((n) => WORKFLOW_GAP_RX.test(n))).length,
    1,
    'the gap note is appended once, never once per run',
  )
})

test('eval restamp — a RETIRED reset note is dropped from an existing report, foreign prose is not', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', {
    all: 60,
    signals: POST_RESET_SIGNALS,
    notes: [FOREIGN_NOTE, speedResetNote],
  })

  assert.equal(roadmap(root, ['eval', 'restamp']).code, 0)
  const notes = JSON.parse(readFileSync(p, 'utf8')).notes
  assert.ok(
    !notes.includes(speedResetNote),
    `nothing pre-reset survives in the corpus, so the archive's copy retires too; got ${JSON.stringify(notes)}`,
  )
  assert.ok(notes.includes(FOREIGN_NOTE), 'a note the registry does not own is never the restamp\'s to edit')
})

test('eval restamp — the SAME note is KEPT while one pre-reset report is still in the corpus', () => {
  const root = buildEvalFixture()
  const p = plantPrior(root, '2026-07-02', {
    all: 60,
    signals: POST_RESET_SIGNALS,
    notes: [FOREIGN_NOTE, speedResetNote],
  })
  // One report still scored under the old reference — the disclaimer is still true of the corpus.
  plantPrior(root, '2026-07-03', {
    all: 70,
    signals: { ...POST_RESET_SIGNALS, speed: { referenceMinutesPerTask: 45 } },
  })

  assert.equal(roadmap(root, ['eval', 'restamp']).code, 0)
  const notes = JSON.parse(readFileSync(p, 'utf8')).notes
  assert.ok(notes.includes(speedResetNote), 'retirement is a CORPUS question, not a per-file one')
})

/**
 * The all-or-nothing rail at the CLI boundary. The FAILURE legs are unit-tested at their seam
 * (assembleWorkflowStamp with an injected failing exec, cli/lib/eval-collect.test.mjs) because
 * that is where a failure can be injected without faking a git-less world; what only the CLI
 * can prove is that the two states are mutually exclusive and that a written block is complete.
 */
test('eval <ARCID> — a workflow block and a workflow-gap warning never coexist, and a written block is COMPLETE', () => {
  const root = buildEvalFixture()
  assert.equal(roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE]).code, 0)
  const report = readReport(root, EVAL_DATE)

  const hasBlock = report.workflow !== undefined
  assert.equal(
    hasBlock,
    !report.notes.some((n) => /no workflow block written/.test(n)),
    'never both, never neither — a partial stamp has no representation',
  )
  if (hasBlock)
    for (const k of ['pluginVersion', 'pluginSha', 'protocolLoadTokens', 'profile'])
      assert.notEqual(report.workflow[k], undefined, `a written block is COMPLETE (${k} present)`)
})

test('eval <ARCID> — a PRE-reset report in the corpus stamps the speed reset note onto the new report', () => {
  const root = buildEvalFixture()
  // referenceMinutesPerTask 45 is the SIGNAL of a report scored under the old model. The
  // predicate reads that, never the note's own presence, which would be circular.
  plantPrior(root, '2026-07-02', { all: 60, signals: { speed: { referenceMinutesPerTask: 45 } } })
  plantPrior(root, '2026-07-03', { all: 70, signals: { speed: { referenceMinutesPerTask: 45 } } })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const notes = readReport(root, EVAL_DATE).notes
  assert.ok(
    notes.some((n) => SPEED_RESET_RX.test(n)),
    `a corpus still holding pre-reset reports must carry the stamp; got ${JSON.stringify(notes)}`,
  )
})

test('eval <ARCID> — once NO pre-reset report is left the stamp AUTO-RETIRES, and the trend marker survives it', () => {
  const root = buildEvalFixture()
  // The same corpus, post-reset: every prior was produced under the new reference.
  plantPrior(root, '2026-07-02', { all: 60, signals: { speed: { referenceMinutesPerTask: 8 } } })
  plantPrior(root, '2026-07-03', { all: 70, signals: { speed: { referenceMinutesPerTask: 8 } } })

  const r = roadmap(root, ['eval', ARC_ID, '--date', EVAL_DATE])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const notes = readReport(root, EVAL_DATE).notes
  assert.ok(
    !notes.some((n) => SPEED_RESET_RX.test(n)),
    `nothing pre-reset remains, so the disclaimer is noise and must retire; got ${JSON.stringify(notes)}`,
  )

  // The RECORD of the reset is permanent even so: the trend page draws it from the registry,
  // not from a surviving note, exactly as it does for a judge-model reset.
  assert.equal(evalTrend(root).code, 0)
  const html = readFileSync(trendPath(root), 'utf8')
  assert.ok(html.includes(SPEED_RESET_ID), 'the permanent marker names the reset by its registry id')
  assert.match(html, /scoring-model reset/i, 'and says what kind of reset it was')
  assert.match(html, /class="reset"/, 'the marker is DRAWN, not merely listed in prose')
})

test('eval trend — every registry reset is marked even on a corpus that never saw one', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60, signals: { speed: { referenceMinutesPerTask: 8 } } })
  plantPrior(root, '2026-07-03', { all: 70, signals: { speed: { referenceMinutesPerTask: 8 } } })

  assert.equal(evalTrend(root).code, 0)
  const html = readFileSync(trendPath(root), 'utf8')
  for (const id of ['escape-attribution', 'escape-anchor-option-c', SPEED_RESET_ID])
    assert.ok(html.includes(id), `the timeline must mark ${id} whether or not any report still predates it`)
})

// ── 28. self-containment, spelled out ──────────────────────────────────────────────────
test('eval trend — the page loads NO script, stylesheet, font or image from anywhere', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60, judgeModel: TREND_JUDGE_A })
  plantPrior(root, '2026-07-03', { all: 70, judgeModel: TREND_JUDGE_B })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  assert.doesNotMatch(html, /<script[^>]*\bsrc\s*=/i, 'no external script')
  assert.doesNotMatch(html, /<link[^>]*rel\s*=\s*["']?stylesheet/i, 'no external stylesheet')
  assert.doesNotMatch(html, /\bsrc\s*=\s*["']https?:/i, 'no remote image or iframe source')
  assert.doesNotMatch(html, /@import/i, 'no CSS @import — the back door around the link rule')
  assert.doesNotMatch(html, /https?:\/\//, 'one file, zero network')
  // And it really is a rendered page, so the assertions above are not passing over an empty file.
  assert.match(html, /<svg\b/i, 'the charts are INLINE SVG')
  assert.ok(html.length > 500, `a rendered corpus page is not a stub; got ${html.length} bytes`)
})

// ── 29. regressions are LISTED, not left to a slope ────────────────────────────────────
test('eval trend — a ratchet row flagged regression:true is listed as text under its dimension', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', {
    all: 40,
    ratchet: [
      { dimension: 'doc-brevity', baseline: 60, value: 40, delta: -20, regression: true, note: 'samples=1' },
      { dimension: 'speed', baseline: 60, value: 40, delta: -20, regression: false, note: 'samples=1' },
    ],
  })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')
  const section = dimSection(html, 'doc-brevity')
  // The CLI already shouts REGRESSION in caps (§10); the page keeps that vocabulary, which also
  // keeps a section HEADING like "Regressions" from being mistaken for a listed row.
  assert.match(section, /REGRESSION/, 'the regression is stated in words under the dimension it hit')
  assert.match(section, /2026-07-03/, 'and dated, so a reader knows which report regressed')
  assert.match(section, /[-−]20\b/, 'and carries its signed delta rather than leaving the size to a slope')
  // A row that did NOT flag must not be dressed up as a regression somewhere else on the page.
  assert.doesNotMatch(dimSection(html, 'speed'), /REGRESSION/, 'speed carried regression:false — it is not a regression')
})

// ── 30. an empty corpus is not a crash and not a fabricated chart ──────────────────────
test('eval trend — an absent/empty corpus exits 0 or refuses BY NAME, never a stack or a zero line', () => {
  const root = makeConsumer()
  const r = evalTrend(root)
  assert.ok([0, 1, 2].includes(r.code), `the three-way contract holds (got ${r.code})`)
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'an empty corpus is a fact, not an exception')

  if (r.code !== 0) {
    assert.match(r.stdout + r.stderr, /arc-evals/, 'a refusal names the corpus directory it found nothing in')
    return
  }
  if (!existsSync(trendPath(root))) return
  const html = readFileSync(trendPath(root), 'utf8')
  const drawn = seriesDraw(html)
  assert.equal(drawn.points, 0, 'no reports means no plotted points — a zero line is a fabricated score of zero')
  assert.equal(drawn.segments, 0, 'and nothing connected')
  assert.match(html, /no reports|no data|empty/i, 'the page must say the corpus is empty')
})
