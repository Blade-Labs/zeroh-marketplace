// Eval proposal-trend scenarios; fixture state is private to this test process.
import { PROPOSAL_BASE, TSX_ABSENT_HINT, assert, buildEvalFixture, escHtml, evalTrend, existsSync, flattenTags, join, makeConsumer, parsesConsumerShape, plantPrior, plantProposal, plantRawProposal, printsNumber, proposalFiles, proposalRows, proposalsDir, proposalsSection, propose, proposeWithoutTsx, readFileSync, readProposal, renderingsOf, rx, seedProposalCorpus, statesCount, test, trendPath, writeFileSync } from '../testdata/eval.test-support.mjs'

// ── 66. POPULATED: surfaced rows in score order, the archived one COUNTED and not tabled ──
test('eval trend — the Open proposals table lists surfaced proposals highest-score first and only COUNTS the archived one', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const top = plantProposal(root, {
    id: 'recurring-regression-code-confidence',
    title: 'anchor the escape window to the land record',
    kind: 'schema-tightening',
    lane: 'plugin-generic',
    createdAt: '2026-07-10',
    evidence: [
      { file: 'roadmap/arc-evals/A-2026-07-02.json', jsonPath: 'ratchet[0]', excerpt: 'regression: true' },
      { file: 'roadmap/arc-evals/A-2026-07-03.json', jsonPath: 'ratchet[0]', excerpt: 'regression: true' },
      { file: 'roadmap/arc-evals/lessons.jsonl', jsonPath: 'line 4', excerpt: 'the escape window drifted again' },
    ],
    opportunity: { importance: 9, satisfaction: 4, score: 14 },
  })
  const lower = plantProposal(root, {
    id: 'recurring-lesson-key-phase-file',
    title: 're-read the phase file before editing it',
    kind: 'process-change',
    lane: 'consumer-specific',
    createdAt: '2026-07-11',
    opportunity: { importance: 6, satisfaction: 5, score: 7 },
  })
  const archived = plantProposal(root, {
    id: 'recurring-low-score-speed',
    title: 'raise the speed reference for surface-heavy phases',
    status: 'archived',
    archivedReason: 'superseded by the declared speed-reference-8 reset, which already recalibrated it',
    createdAt: '2026-07-09',
    opportunity: { importance: 8, satisfaction: 2, score: 14 },
  })

  // The factory is only trustworthy if the CONSUMER's own contract accepts what it produces —
  // otherwise these fixtures encode a belief about ProposalShape rather than the shape itself.
  for (const doc of [top, lower, archived]) {
    const res = parsesConsumerShape(root, 'ProposalShape', doc)
    assert.equal(res.ok, true, `fixture precondition: ${doc.id} must satisfy ProposalShape; got: ${res.detail}`)
  }
  // Ordering is only a claim if the two scores can distinguish a right order from a wrong one.
  assert.notEqual(
    top.opportunity.score,
    lower.opportunity.score,
    'fixture precondition: two DIFFERENT scores, or "sorted descending" is satisfied by any order',
  )
  assert.ok(top.opportunity.score > lower.opportunity.score, 'fixture precondition: `top` is the higher-scoring one')

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.ok(existsSync(trendPath(root)), `the existing contract holds: the page at ${trendPath(root)}`)
  assert.match(r.stdout, rx(trendPath(root)), 'and the run still names the file it wrote')

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)

  // PRESENT first, so the absence assertion below cannot pass over a section that rendered nothing.
  assert.ok(section.includes(escHtml(top.title)), `the higher-scoring proposal must be listed; section was:\n${section}`)
  assert.ok(section.includes(escHtml(lower.title)), `the lower-scoring proposal must be listed; section was:\n${section}`)
  assert.ok(
    section.indexOf(escHtml(top.title)) < section.indexOf(escHtml(lower.title)),
    `the table reads highest-opportunity first: ${top.id} (${top.opportunity.score}) must precede ` +
      `${lower.id} (${lower.opportunity.score}); section was:\n${section}`,
  )

  // A decided proposal that reappears in the open queue is a decision re-opened by a renderer.
  assert.equal(
    html.includes(escHtml(archived.title)),
    false,
    `an archived proposal is COUNTED, never tabled — its title must not appear anywhere on the page;` +
      ` page was:\n${html}`,
  )
  assert.ok(statesCount(section, 'archived', 1), `the section must state the archived count of 1; section was:\n${section}`)
  // All three non-surfaced statuses are accounted for, or a reader cannot tell "none rejected"
  // from "rejections are not counted here at all".
  for (const word of ['ratified', 'rejected', 'archived'])
    assert.match(flattenTags(section), new RegExp(word, 'i'), `the one-line count must name ${word}`)

  const rows = proposalRows(html)
  assert.equal(
    rows.length,
    2,
    `exactly the two SURFACED proposals are rows — three files, one of them decided; rows were:\n${rows.join('\n')}`,
  )
  for (const doc of [top, lower]) {
    const row = rows.find((tr) => tr.includes(escHtml(doc.title)))
    assert.ok(row, `${doc.id} must own a table row; rows were:\n${rows.join('\n')}`)
    assert.ok(row.includes(doc.lane), `${doc.id}: the row must name its lane ${doc.lane}; got ${row}`)
    assert.ok(row.includes(doc.kind), `${doc.id}: the row must name its kind ${doc.kind}; got ${row}`)
    assert.ok(
      renderingsOf(doc.opportunity.score).some((v) => row.includes(v)),
      `${doc.id}: the row must print the score it is ranked by (${doc.opportunity.score}); got ${row}`,
    )
    assert.ok(
      printsNumber(row, doc.evidence.length),
      `${doc.id}: the row must carry its evidence count (${doc.evidence.length}) — a proposal's weight is how` +
        ` much backs it; got ${row}`,
    )
    assert.ok(row.includes(doc.createdAt), `${doc.id}: the row must carry createdAt ${doc.createdAt}; got ${row}`)
  }
})

// ── 67. EMPTY, TWO WAYS — a missing directory and an empty result are DIFFERENT code paths ──
// One returns early on a stat, the other falls through the filter with nothing left, and an
// implementation can easily get one right and the other wrong. Both must produce the same honest
// sentence, because to a reader they are the same fact: there is nothing open to look at.
test('eval trend — with NO proposals directory the section still renders and says "no open proposals"', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  assert.equal(existsSync(proposalsDir(root)), false, 'fixture precondition: no proposals directory at all')

  const r = evalTrend(root)
  assert.equal(r.code, 0, `an absent proposals directory is an ordinary corpus state: ${r.stdout + r.stderr}`)

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)
  assert.ok(
    section.includes('no open proposals'),
    `an empty table with no sentence reads as a claim nobody made; section was:\n${section}`,
  )
  assert.deepEqual(proposalRows(html), [], 'and nothing is tabled — there is nothing to table')
  assert.equal(existsSync(proposalsDir(root)), false, 'rendering the page mints no directory as a side effect')
})

test('eval trend — a proposals directory holding ONLY a non-surfaced proposal says "no open proposals" too', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  const ratified = plantProposal(root, {
    id: 'recurring-sentinel-plan-quality',
    title: 'require a named plan artifact per phase',
    status: 'ratified',
  })

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)
  assert.ok(
    section.includes('no open proposals'),
    `zero SURFACED rows is the same fact as no directory, and must read the same; section was:\n${section}`,
  )
  assert.deepEqual(proposalRows(html), [], 'a ratified proposal is not an open one and may not be tabled')
  assert.equal(
    html.includes(escHtml(ratified.title)),
    false,
    'a decided proposal is counted, never surfaced back into the open queue',
  )
  assert.ok(statesCount(section, 'ratified', 1), `the count must be DATA-driven — 1 ratified here; section was:\n${section}`)
})

// ── 68. PROVENANCE FOOTNOTE — an unreadable and a foreign file are named, never dropped ─────
test('eval trend — an unparseable and a foreign-origin proposal file are named in a footnote, tabled as nothing, and untouched', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })
  const valid = plantProposal(root, {
    id: 'recurring-regression-speed',
    title: 'record the reference minutes on every timed phase',
  })

  const brokenName = 'half-written-proposal.json'
  const brokenPath = join(proposalsDir(root), brokenName)
  const brokenBytes = '{"id":"half-written-proposal","status":"surfaced"'
  writeFileSync(brokenPath, brokenBytes)

  const foreignName = 'user-authored-note.json'
  const foreignPath = join(proposalsDir(root), foreignName)
  const FOREIGN_TITLE = 'a proposal a human wrote by hand in this directory'
  const foreignBytes =
    JSON.stringify({ ...PROPOSAL_BASE, id: 'user-authored-note', title: FOREIGN_TITLE, writeOrigin: 'user' }, null, 2) + '\n'
  writeFileSync(foreignPath, foreignBytes)

  const r = evalTrend(root)
  assert.equal(r.code, 0, `two unusable files must not fail the render: ${r.stdout + r.stderr}`)
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'an unreadable file is a reported fact, not a leaked stack')

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)

  // PRESENT first: the row assertions below mean nothing if the section rendered empty.
  assert.ok(section.includes(escHtml(valid.title)), `the readable own proposal must still be tabled; section was:\n${section}`)
  assert.ok(section.includes(brokenName), `the unparseable file must be named BY FILENAME; section was:\n${section}`)
  assert.ok(section.includes(foreignName), `the foreign-origin file must be named BY FILENAME; section was:\n${section}`)

  const rows = proposalRows(html)
  assert.equal(rows.length, 1, `exactly the ONE own, readable, surfaced proposal is a row; rows were:\n${rows.join('\n')}`)
  assert.ok(rows[0].includes(escHtml(valid.title)), `and it is the valid one; got ${rows[0]}`)
  assert.equal(
    rows.some((tr) => tr.includes(escHtml(FOREIGN_TITLE))),
    false,
    'a file the loop did not write is REPORTED, never rendered as one of its own proposals',
  )

  // Rendering is a read. A page generator that "repaired" a file it could not parse would be
  // editing a committed archive nobody asked it to touch.
  assert.equal(readFileSync(brokenPath, 'utf8'), brokenBytes, 'the unparseable file is byte-for-byte untouched')
  assert.equal(readFileSync(foreignPath, 'utf8'), foreignBytes, 'and so is the foreign one')
})

// ── 69. HTML SAFETY — the new section escapes through the page's own esc() ──────────────────
test('eval trend — a proposal title carrying markup is ESCAPED into the table, not dropped and not injected', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  const HOSTILE = 'audit <script>alert(1)</script> & the rehydration map'
  const doc = plantProposal(root, { id: 'recurring-lesson-key-masking', title: HOSTILE })
  const res = parsesConsumerShape(root, 'ProposalShape', doc)
  assert.equal(res.ok, true, `fixture precondition: the hostile-titled proposal is a VALID proposal; got: ${res.detail}`)

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  const html = readFileSync(trendPath(root), 'utf8')

  assert.equal(
    html.includes('<script>alert(1)</script>'),
    false,
    'the raw markup must never reach the page — the section owes the same esc() every other cell uses',
  )
  // Escaping, not dropping: a renderer that silently skipped the row would also pass the line
  // above while losing a real proposal.
  assert.ok(
    proposalsSection(html).includes(escHtml(HOSTILE)),
    `the title must be present in ESCAPED form; section was:\n${proposalsSection(html)}`,
  )
  assert.ok(html.includes('&amp;'), 'the ampersand is escaped too, or the escaper is a < > special case')
  const rows = proposalRows(html)
  assert.equal(rows.length, 1, `the row is rendered, not dropped; rows were:\n${rows.join('\n')}`)
})

for (const [label, mangle] of [
  ['NO opportunity block at all', (d) => { delete d.opportunity }],
  ['a STRING where the score should be', (d) => { d.opportunity = { ...d.opportunity, score: '14' } }],
]) {
  test(`eval trend — a surfaced own proposal with ${label} is named in the footnote, never tabled with a stand-in 0`, () => {
    const root = buildEvalFixture()
    plantPrior(root, '2026-07-02', { all: 60 })
    plantPrior(root, '2026-07-03', { all: 70 })

    const valid = plantProposal(root, {
      id: 'recurring-regression-speed',
      title: 'record the reference minutes on every timed phase',
      opportunity: { importance: 9, satisfaction: 4, score: 14 },
    })

    const SCORELESS_TITLE = 'a truncated own document nobody ever scored'
    const scoreless = { ...PROPOSAL_BASE, id: 'recurring-sentinel-plan-quality', title: SCORELESS_TITLE }
    mangle(scoreless)
    const scorelessName = plantRawProposal(root, scoreless)

    // Preconditions: this document is the loop's OWN and SURFACED, so test 68's provenance routes
    // cannot be what excludes it. Without these the assertions below would pass for the wrong reason.
    assert.equal(scoreless.writeOrigin, 'roadmap-eval-loop', 'fixture precondition: own write origin, not foreign')
    assert.equal(scoreless.status, 'surfaced', 'fixture precondition: surfaced, so it is an OPEN proposal by status')
    assert.notEqual(typeof scoreless.opportunity?.score, 'number', 'fixture precondition: and it carries no numeric score')
    assert.equal(typeof valid.opportunity.score, 'number', 'fixture precondition: the control document DOES carry one')

    const r = evalTrend(root)
    assert.equal(r.code, 0, `a truncated own document must not fail the render: ${r.stdout + r.stderr}`)
    assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'an unusable document is a reported fact, not a leaked stack')

    const html = readFileSync(trendPath(root), 'utf8')
    const section = proposalsSection(html)

    // PRESENT first, or every absence below is satisfied by a section that rendered nothing.
    assert.ok(section.includes(escHtml(valid.title)), `the fully scored proposal must still be tabled; section was:\n${section}`)

    // The LABEL it is filed under, not merely that it is named somewhere. Filing a document that
    // parses perfectly under `unreadable` sends the reader hunting for a parse error that does not
    // exist, and makes the page's `unreadable` mean something different from the propose command's.
    const footnoteLine = flattenTags(section)
      .split(/(?=surfaced but carrying|unreadable:|foreign write-origin|status outside)/)
      .find((chunk) => chunk.includes(scorelessName))
    assert.ok(
      footnoteLine,
      `the score-less document must be named in a footnote; section was:\n${section}`,
    )
    assert.match(
      footnoteLine,
      /surfaced but carrying no numeric score/,
      `and under the label that describes it, not "unreadable"; the chunk naming it was:\n${footnoteLine}`,
    )

    const rows = proposalRows(html)
    assert.equal(
      rows.length,
      1,
      `exactly ONE row: the scored document. A document with no score is not a row with a zero in it; rows were:\n${rows.join('\n')}`,
    )
    assert.ok(rows[0].includes(escHtml(valid.title)), `and the surviving row is the scored one; got ${rows[0]}`)
    assert.ok(
      renderingsOf(valid.opportunity.score).some((v) => rows[0].includes(v)),
      `the surviving row prints the score it is ranked by (${valid.opportunity.score}); got ${rows[0]}`,
    )
    assert.equal(
      rows.some((tr) => tr.includes(escHtml(SCORELESS_TITLE))),
      false,
      `the score-less document must own no row at all — tabling it means inventing the number it is ranked by; rows were:\n${rows.join('\n')}`,
    )
    assert.equal(
      html.includes(escHtml(SCORELESS_TITLE)),
      false,
      `and its title appears nowhere on the page: the footnote names the FILE, not a half-rendered proposal; page was:\n${html}`,
    )

    // Named, not dropped. A silent skip is how a reader comes to believe the queue is shorter.
    assert.ok(
      section.includes(scorelessName),
      `the unusable document must be named BY FILENAME in the section footnote; section was:\n${section}`,
    )

    // The precise form of the old bug: a rendered score cell holding 0. Asserted as the cell, not
    // as "the page contains no 0" — the page is full of numbers, and that weaker claim would be a
    // test that fails for reasons unrelated to this rail.
    assert.equal(
      /<td[^>]*>\s*0\s*<\/td>/.test(section),
      false,
      `no score cell may render 0 for a document that was never measured — 0 reads as "measured, and worthless"; section was:\n${section}`,
    )
  })
}

// ── 71. A STATUS THE LIFECYCLE NEVER NAMED IS NAMED, NOT DROPPED ─────────────────────────
// The section's own rule is that a file it cannot use is a fact about the corpus. An own,
// parseable document whose `status` is outside ProposalStatusShape — hand-edited, or written by an
// older vintage — matched none of the surfaced / decided branches and so was neither tabled, nor
// counted, nor mentioned. Not inflating a count and not being mentioned at all are different
// decisions, and only the first of them was the intent.
test('eval trend — an own proposal carrying a status outside the lifecycle is named in a footnote, not silently dropped', () => {
  const root = buildEvalFixture()
  plantPrior(root, '2026-07-02', { all: 60 })
  plantPrior(root, '2026-07-03', { all: 70 })

  const valid = plantProposal(root, { id: 'recurring-regression-speed', title: 'record the reference minutes on every timed phase' })

  const STRANGE_TITLE = 'a document filed under a status nobody defined'
  const strange = { ...PROPOSAL_BASE, id: 'recurring-sentinel-plan-quality', title: STRANGE_TITLE, status: 'deferred' }
  const strangeName = plantRawProposal(root, strange)

  // Preconditions: own origin and parseable, so neither provenance route can be what excluded it.
  assert.equal(strange.writeOrigin, 'roadmap-eval-loop', 'fixture precondition: the loop owns this file')
  assert.equal(
    ['surfaced', 'ratified', 'rejected', 'archived'].includes(strange.status),
    false,
    'fixture precondition: the status really is outside the contract lifecycle',
  )

  const r = evalTrend(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const html = readFileSync(trendPath(root), 'utf8')
  const section = proposalsSection(html)

  assert.ok(section.includes(escHtml(valid.title)), 'the valid proposal is still tabled, so the assertions below are not about an empty section')
  assert.equal(proposalRows(html).length, 1, 'and it is the only row: a document with no known status is not an open proposal')
  assert.equal(html.includes(escHtml(STRANGE_TITLE)), false, 'nor is it tabled under some other heading')
  assert.ok(section.includes(strangeName), `it must be named BY FILENAME; section was:\n${section}`)
  assert.ok(statesCount(section, 'ratified', 0), 'and it inflates no decided count')
  assert.ok(statesCount(section, 'archived', 0), 'under any of them')
})

test('eval propose — an UNRESOLVABLE tsx bridge aborts the run with the worktree hint (exit 1), never a stale-file count', () => {
  const root = seedProposalCorpus(makeConsumer())

  // A full pass with a working bridge first, so the proposals directory holds this loop's own files.
  const first = propose(root)
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const files = proposalFiles(root)
  assert.ok(files.length > 0, 'fixture precondition: the first run wrote the proposals the second run derives from')

  // One hand-edit to a REGENERATED field, which is what turns the next run's staging into a
  // refresh. Left on disk exactly so: every assertion below is about a disk-derived document.
  const edited = join(proposalsDir(root), files[0])
  writeFileSync(
    edited,
    JSON.stringify({ ...readProposal(root, files[0]), title: 'hand-edited, so the pass has something to refresh' }, null, 2) + '\n',
  )
  const before = Object.fromEntries(files.map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')]))

  // The precondition that makes this test about the FLAG: with the toolchain present, this corpus
  // stages exactly one document and that document is disk-derived. A run that also created or
  // archived one would throw on that one first, in EITHER version of the guard, and prove nothing.
  const dry = propose(root, ['--dry-run'])
  assert.equal(dry.code, 0, dry.stdout + dry.stderr)
  assert.match(
    dry.stdout + dry.stderr,
    /created 0 {2}refreshed 1\b/,
    `fixture precondition: exactly one staged document, and it is a refresh; output was:\n${dry.stdout + dry.stderr}`,
  )
  const archivedLine = (dry.stdout + dry.stderr).split('\n').find((l) => /^\s*archived\b/.test(l))
  assert.ok(
    archivedLine && printsNumber(archivedLine, 0),
    `fixture precondition: no cluster dissolved, so the refresh really is the only staged document; the line was: ${archivedLine}`,
  )

  const r = proposeWithoutTsx(root)
  assert.equal(
    r.code,
    1,
    `a toolchain that could not run is the exit-1 lane: never 0 (a stale-file count) and never 2 (a refused document); output was:\n${r.stdout + r.stderr}`,
  )
  assert.ok(
    r.stderr.includes(TSX_ABSENT_HINT),
    `and it has to print the one line that says how to fix it; stderr was:\n${r.stderr}`,
  )
  assert.equal(
    (r.stdout + r.stderr).includes('unusable-own'),
    false,
    `the corpus was never judged, so nothing may be filed as an unusable own file; output was:\n${r.stdout + r.stderr}`,
  )
  assert.deepEqual(
    Object.fromEntries(proposalFiles(root).map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')])),
    before,
    'and the refusal left the directory exactly as it found it',
  )
})
