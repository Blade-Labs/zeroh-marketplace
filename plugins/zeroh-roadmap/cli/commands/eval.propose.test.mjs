// Eval propose scenarios; fixture state is private to this test process.
import { LESSONS_FILE, REPORT_FILES, assert, evalsDir, existsSync, expectedFromCorpus, join, makeConsumer, mkdirSync, parsesConsumerShape, printsNumber, proposalFiles, proposalsDir, propose, readFileSync, readProposal, readdirSync, renderingsOf, roadmap, seedProposalCorpus, sharedFixture, sharedProposeRun, test, writeFileSync } from '../testdata/eval.test-support.mjs'

// ── 55. end to end: one document per cluster, and every one of them is a PROPOSAL ────────
test('eval propose — writes one proposal per emitted cluster and every file satisfies the CONSUMER ProposalShape', () => {
  const { root, run } = sharedProposeRun()
  assert.equal(run.code, 0, run.stdout + run.stderr)

  const expected = expectedFromCorpus()
  assert.ok(expected.ids.length > 1, `fixture precondition: the corpus must support several clusters; got ${expected.ids.length}`)

  assert.deepEqual(
    proposalFiles(root),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'exactly one <id>.json per cluster the library emits — an extra file is a proposal with no cluster behind it',
  )

  for (const name of proposalFiles(root)) {
    const doc = readProposal(root, name)
    assert.equal(`${doc.id}.json`, name, `${name}: the file is addressed by the id inside it, or a re-run cannot find it`)
    assert.equal(doc.status, 'surfaced', `${name}: the pass may only ever mint 'surfaced' — anything else is self-ratification`)
    assert.ok(doc.evidence.length >= 2, `${name}: the >=2 floor reaches disk; got ${doc.evidence.length}`)
    const res = parsesConsumerShape(root, 'ProposalShape', doc)
    assert.equal(res.ok, true, `${name} must satisfy ProposalShape; got: ${res.detail}`)
  }
})

// ── 56. the queue is printed in priority order ───────────────────────────────────────────
test('eval propose — the printed proposal lines run in opportunity.score DESCENDING order', () => {
  const { root, run } = sharedProposeRun()
  assert.equal(run.code, 0, run.stdout + run.stderr)

  const written = proposalFiles(root).map((name) => readProposal(root, name))
  assert.ok(written.length > 1, 'fixture precondition: ordering needs more than one proposal')
  // Without two DIFFERENT scores any ordering satisfies "descending" and the assertion below is
  // vacuous — the corpus has to be able to tell a right order from a wrong one.
  assert.ok(
    new Set(written.map((d) => d.opportunity.score)).size >= 2,
    `fixture precondition: at least two distinct scores; got ${JSON.stringify(written.map((d) => d.opportunity.score))}`,
  )

  const positions = written.map((d) => ({ id: d.id, score: d.opportunity.score, at: run.stdout.indexOf(d.id) }))
  for (const p of positions)
    assert.notEqual(p.at, -1, `every written proposal must appear in the human output; ${p.id} did not:\n${run.stdout}`)

  const printed = [...positions].sort((a, b) => a.at - b.at)
  for (let i = 1; i < printed.length; i += 1)
    assert.ok(
      printed[i - 1].score >= printed[i].score,
      `the queue must read highest-opportunity first: ${printed[i - 1].id} (${printed[i - 1].score}) printed above ` +
        `${printed[i].id} (${printed[i].score}); stdout was:\n${run.stdout}`,
    )

  // Each line carries what a reader needs to triage without opening the file.
  for (const d of written) {
    const line = run.stdout.split('\n').find((l) => l.includes(d.id))
    assert.ok(line, `${d.id} must own a line; stdout was:\n${run.stdout}`)
    assert.ok(line.includes(d.lane), `${d.id}: the line must name its lane ${d.lane}; got ${line}`)
    assert.ok(line.includes(d.kind), `${d.id}: the line must name its kind ${d.kind}; got ${line}`)
    assert.ok(line.includes(d.status), `${d.id}: the line must name its status ${d.status}; got ${line}`)
    assert.ok(printsNumber(line, d.evidence.length), `${d.id}: the line must carry its evidence count; got ${line}`)
    assert.ok(
      renderingsOf(d.opportunity.score).some((v) => line.includes(v)),
      `${d.id}: the line must print the score it is ranked by (${d.opportunity.score}); got ${line}`,
    )
  }
})

// ── 57. the two lanes: stdout is machine-clean under --json ──────────────────────────────
test('eval propose --json — stdout ALONE parses as the proposal array; the human summary is on stderr', () => {
  const root = seedProposalCorpus(makeConsumer())
  const r = propose(root, ['--json'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const emitted = JSON.parse(r.stdout)
  assert.ok(Array.isArray(emitted), `the --json lane emits an ARRAY of proposals; got ${typeof emitted}`)
  const files = proposalFiles(root)
  assert.ok(files.length > 0, 'fixture precondition: the run must have written something to compare against')
  assert.equal(emitted.length, files.length, 'the emitted array and the written set are the same set')
  assert.deepEqual(
    emitted.map((d) => d.id).sort(),
    files.map((f) => f.replace(/\.json$/, '')).sort(),
    'and the same documents, not two renderings that could drift',
  )

  // The token is one of the named counts, which is prose no JSON consumer can swallow. If it
  // appears on stdout the pipe into JSON.parse breaks for every caller.
  assert.doesNotMatch(r.stdout, /skippedSingletons/, `the human summary must not leak into the JSON lane; stdout was:\n${r.stdout}`)
  assert.match(r.stderr, /skippedSingletons/, `the summary still has to reach the operator, on stderr; stderr was:\n${r.stderr}`)
})

// ── 58. --dry-run writes NOTHING, and the same corpus proves it would have ───────────────
test('eval propose --dry-run — creates no directory and no file, but names the paths it would write', () => {
  const root = seedProposalCorpus(makeConsumer())
  const expected = expectedFromCorpus()

  const dry = propose(root, ['--dry-run'])
  assert.equal(dry.code, 0, dry.stdout + dry.stderr)
  assert.equal(
    existsSync(proposalsDir(root)),
    false,
    'a dry run may not even mint the directory — an empty directory in a committed archive is a side effect',
  )
  assert.deepEqual(proposalFiles(root), [], 'and nothing at all was written')
  for (const id of expected.ids)
    assert.ok(
      dry.stdout.includes(`${id}.json`),
      `a dry run has to name the path it WOULD have written (${id}.json); stdout was:\n${dry.stdout}`,
    )

  // The assertion above is only about the FLAG if the very same corpus writes when the flag is
  // dropped. Otherwise a run that is simply broken passes the dry-run test.
  const real = propose(root)
  assert.equal(real.code, 0, real.stdout + real.stderr)
  assert.deepEqual(
    proposalFiles(root),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'the identical invocation without --dry-run writes every one of those files',
  )
})

// ── 59. an absent lessons sidecar is a NAMED absence, not a crash and not a zero ─────────
test('eval propose — with no lessons.jsonl the run succeeds, SAYS the sidecar is absent, and still emits the report-backed proposals', () => {
  const root = seedProposalCorpus(makeConsumer(), { lessons: false })
  assert.equal(existsSync(join(evalsDir(root), LESSONS_FILE)), false, 'fixture precondition: no sidecar')

  const r = propose(root)
  assert.equal(r.code, 0, `an absent sidecar is an ordinary corpus state, not a failure: ${r.stdout + r.stderr}`)

  const out = r.stdout + r.stderr
  assert.match(out, /lessons\.jsonl/, `the absence must be NAMED, not silently read as zero lessons; output was:\n${out}`)

  const expected = expectedFromCorpus({ lessons: false })
  const withLessons = expectedFromCorpus()
  assert.ok(
    expected.ids.length < withLessons.ids.length,
    'fixture precondition: the sidecar really does contribute proposals, or this test proves nothing',
  )
  assert.deepEqual(
    proposalFiles(root),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'exactly the report-backed subset survives',
  )
  assert.deepEqual(
    proposalFiles(root).filter((f) => f.startsWith('recurring-lesson-key')),
    [],
    'and no lesson-key proposal is minted out of a file that does not exist',
  )
})

// ── 60. a corpus that supports nothing says so, honestly, and exits 0 ────────────────────
test('eval propose — a single-report corpus prints the exact too-thin line, writes nothing, exits 0', () => {
  const root = seedProposalCorpus(makeConsumer(), { reports: [REPORT_FILES[0]], lessons: false })
  const expected = expectedFromCorpus({ reports: [REPORT_FILES[0]], lessons: false })
  assert.equal(expected.clusters.length, 0, 'fixture precondition: one report can only produce singletons')
  assert.ok(expected.skippedSingletons > 0, 'fixture precondition: and it does produce some')

  const r = propose(root)
  assert.equal(r.code, 0, `nothing to propose is not an error: ${r.stdout + r.stderr}`)
  assert.ok(
    (r.stdout + r.stderr).includes('corpus too thin: every candidate cluster below the 2-finding floor'),
    `the empty result must be stated in words rather than shown as an empty list; output was:\n${r.stdout + r.stderr}`,
  )
  assert.deepEqual(proposalFiles(root), [], 'and no proposal is manufactured to fill the silence')
})

// ── 61. idempotence through the CLI — a committed artifact must not churn ────────────────
test('eval propose — a second run over the same corpus is BYTE-IDENTICAL and reports zero created', () => {
  const root = seedProposalCorpus(makeConsumer())
  const first = propose(root)
  assert.equal(first.code, 0, first.stdout + first.stderr)
  const before = Object.fromEntries(proposalFiles(root).map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')]))
  assert.ok(Object.keys(before).length > 0, 'fixture precondition: the first run wrote something')

  const second = propose(root)
  assert.equal(second.code, 0, `a re-run regenerates in place, it is not refused: ${second.stdout + second.stderr}`)
  const after = Object.fromEntries(proposalFiles(root).map((f) => [f, readFileSync(join(proposalsDir(root), f), 'utf8')]))
  // Raw strings, not parsed objects: indentation, key order, the trailing newline and the
  // updatedAt stamp are all part of what shows up as a diff in the committed archive every run.
  assert.deepEqual(after, before, 'the same corpus must reproduce the same BYTES on every run')
  assert.match(
    second.stdout + second.stderr,
    /created\D{0,4}0(?!\d)/,
    `the second run created nothing and has to say so; output was:\n${second.stdout + second.stderr}`,
  )
})

// ── 62. the refusals are COUNTED, by name, with their real numbers ───────────────────────
test('eval propose — the output names skippedSingletons and skippedNoLane carrying the values the library computed', () => {
  const { run } = sharedProposeRun()
  assert.equal(run.code, 0, run.stdout + run.stderr)

  const expected = expectedFromCorpus()
  assert.ok(expected.skippedSingletons > 0 && expected.skippedNoLane > 0, 'fixture precondition: both refusals are exercised')

  const out = run.stdout + run.stderr
  for (const [name, value] of [
    ['skippedSingletons', expected.skippedSingletons],
    ['skippedNoLane', expected.skippedNoLane],
  ]) {
    // One line has to carry the label AND its number: a count printed three lines from its name
    // leaves the reader to guess which refusal it belongs to.
    const line = out.split('\n').find((l) => l.includes(name) && printsNumber(l, value))
    assert.ok(line, `expected a line naming ${name} with its value ${value}; output was:\n${out}`)
  }
})

// ── 63. provenance through the CLI — a foreign file is untouched and reported ────────────
test('eval propose — a foreign writeOrigin file in the proposals dir survives byte-for-byte and is named', () => {
  const root = seedProposalCorpus(makeConsumer())
  mkdirSync(proposalsDir(root), { recursive: true })
  const foreignName = 'user-authored-note.json'
  const foreignPath = join(proposalsDir(root), foreignName)
  const foreignBytes = JSON.stringify({ id: 'user-authored-note', writeOrigin: 'user', note: 'written by hand' }, null, 2) + '\n'
  writeFileSync(foreignPath, foreignBytes)

  const r = propose(root)
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.equal(
    readFileSync(foreignPath, 'utf8'),
    foreignBytes,
    'a file the loop did not write is not the loop\'s to reformat, repair or replace',
  )
  assert.ok(
    (r.stdout + r.stderr).includes('user-authored-note'),
    `the skipped foreign file must be reported BY NAME; output was:\n${r.stdout + r.stderr}`,
  )
  const expected = expectedFromCorpus()
  assert.deepEqual(
    proposalFiles(root).filter((f) => f !== foreignName),
    [...expected.ids].map((id) => `${id}.json`).sort(),
    'and it neither blocks nor displaces the run\'s own proposals',
  )
})

// ── 64. NON-SHADOWING: `propose` is a literal, never an arc id ───────────────────────────
test('eval propose — the literal is dispatched before the arc-id fallthrough, so no dated report is minted', () => {
  const { root, run } = sharedProposeRun()
  // The artifacts are the proof, not the exit code: the arc-id fallthrough ALSO exits non-zero
  // on a missing arc, so "it failed" would look identical before the subcommand existed.
  assert.equal(run.code, 0, run.stdout + run.stderr)
  assert.ok(existsSync(proposalsDir(root)), 'the run really reached the propose lane')

  const dated = readdirSync(evalsDir(root)).filter((f) => /^propose-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  assert.deepEqual(dated, [], `'propose' must never be scored as an arc; found ${JSON.stringify(dated)}`)
})

// ── 65. discoverability ──────────────────────────────────────────────────────────────────
test('roadmap --help — the eval entry advertises the propose subcommand', () => {
  const root = sharedFixture()
  const r = roadmap(root, ['--help'])
  assert.equal(r.code, 0, r.stderr)
  const line = r.stdout.split('\n').find((l) => /^\s*eval\b/.test(l))
  assert.ok(line, `--help must list eval; stdout was:\n${r.stdout}`)
  assert.match(line, /propose/, `a subcommand missing from the TREE is a subcommand nobody finds; the eval line was:\n${line}`)
})
