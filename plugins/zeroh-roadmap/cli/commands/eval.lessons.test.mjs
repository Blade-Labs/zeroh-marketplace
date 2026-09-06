// Eval lessons scenarios; fixture state is private to this test process.
import { EVAL_DATE, ISO_Z, assert, existsSync, join, lesson, lessonLines, lessonsPath, makeConsumer, parsesConsumerShape, readFileSync, roadmap, sharedFixture, test } from '../testdata/eval.test-support.mjs'

// ── 36. one capture, one line ────────────────────────────────────────────────────────────
test('eval lesson — appends exactly ONE line that round-trips, kind session, with a freshly minted ts', () => {
  const root = makeConsumer()
  const before = Date.now()
  const r = lesson(root, ['a masked category that fails open is a leak, not a fallback'])
  const after = Date.now()
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const lines = lessonLines(root)
  assert.equal(lines.length, 1, `exactly one line per capture; got ${JSON.stringify(lines)}`)

  const doc = JSON.parse(lines[0])
  assert.equal(doc.text, 'a masked category that fails open is a leak, not a fallback', 'the text rides in verbatim')
  assert.equal(doc.origin.kind, 'session', "this command's provenance is ALWAYS 'session' — the eval loop owns 'eval-loop'")

  assert.match(doc.ts, ISO_Z, `ts must be an ISO-8601 Z datetime (what LessonShape's .datetime() accepts); got ${doc.ts}`)
  const t = Date.parse(doc.ts)
  assert.ok(Number.isFinite(t), `ts must be parseable; got ${doc.ts}`)
  // Minted BY the command at capture time. A hardcoded or copied timestamp would still match the
  // regex above, so the window is what makes the assertion mean anything.
  assert.ok(
    t >= before - 1000 && t <= after + 1000,
    `ts must be minted during the run (${new Date(before).toISOString()}..${new Date(after).toISOString()}); got ${doc.ts}`,
  )

  // The shape belongs to the CONSUMER, so it is checked through the consumer's own schema rather
  // than against this test author's belief about the contract.
  const res = parsesConsumerShape(root, 'LessonShape', doc)
  assert.equal(res.ok, true, `the persisted lesson must satisfy LessonShape; got: ${res.detail}`)
})

// ── 37. APPEND-ONLY — the earlier line is never rewritten ────────────────────────────────
test('eval lesson — a second capture appends AFTER the first and leaves line 1 byte-identical', () => {
  const root = makeConsumer()
  assert.equal(lesson(root, ['first lesson', '--phase', '2015']).code, 0)
  const firstLine = lessonLines(root)[0]
  const firstBytes = readFileSync(lessonsPath(root), 'utf8')

  assert.equal(lesson(root, ['second lesson', '--phase', '2016']).code, 0)

  const lines = lessonLines(root)
  assert.equal(lines.length, 2, `the second capture ADDS a line, it does not replace the file; got ${JSON.stringify(lines)}`)
  assert.equal(lines[0], firstLine, 'line 1 is byte-for-byte what the first run wrote — a rewrite is a lost lesson')
  assert.equal(JSON.parse(lines[0]).text, 'first lesson', 'and in capture order')
  assert.equal(JSON.parse(lines[1]).text, 'second lesson')
  // Prefix identity catches the read-modify-write variant that reproduces line 1 but reflows
  // the bytes around it (reindented JSON, a rewritten terminator).
  assert.ok(
    readFileSync(lessonsPath(root), 'utf8').startsWith(firstBytes),
    'the whole of the previous file must survive as an exact PREFIX of the new one',
  )
})

// ── 38. no text at all is USAGE, and writes nothing ──────────────────────────────────────
test('eval lesson — with no text argument it is USAGE (exit 1), no stack, and no sidecar is minted', () => {
  const root = makeConsumer()
  const r = lesson(root, [])
  // 1 = the caller invoked it wrong; 2 is reserved for a document the contract refused. A capture
  // with nothing to capture never reaches the contract at all.
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /usage/i, `the empty call must teach the form; stderr was:\n${r.stderr}`)
  assert.match(r.stderr, /lesson/, 'and name the subcommand it is the usage for')
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'a usage error reads as usage, not a leaked stack')
  assert.equal(existsSync(lessonsPath(root)), false, 'a refused capture leaves no empty sidecar behind')
  assert.equal(existsSync(join(root, 'roadmap', 'arc-evals')), false, 'and mints no directory for it either')
})

// ── 39. the same, for text that is only whitespace ───────────────────────────────────────
test('eval lesson — whitespace-only text is the SAME usage refusal, not an empty lesson on disk', () => {
  const root = makeConsumer()
  // LessonShape's .min(1) would happily accept '   ': a blank lesson is a caller mistake the CLI
  // has to catch, not a document the contract can.
  const r = lesson(root, ['   '])
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /usage/i, `stderr was:\n${r.stderr}`)
  assert.doesNotMatch(r.stderr, /\n\s+at [^\n]*\n\s+at /, 'no leaked stack')
  assert.equal(existsSync(lessonsPath(root)), false, 'nothing on disk — a whitespace lesson is worse than none')
})

// ── 40. --phase and --writer ride in verbatim ────────────────────────────────────────────
test('eval lesson — --phase and --writer land in the record exactly as given', () => {
  const root = makeConsumer()
  const r = lesson(root, ['re-read the phase file before editing; it moves under you', '--phase', '2015', '--writer', 'claude-fable-5'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = JSON.parse(lessonLines(root)[0])
  assert.equal(doc.phase, 2015, 'the phase is a NUMBER in the record, not the string the shell handed over')
  assert.equal(doc.origin.writer, 'claude-fable-5', 'the self-reported writer is carried verbatim')
  assert.equal(doc.origin.kind, 'session', 'a named writer does not change the provenance kind')
  assert.equal(doc.text, 're-read the phase file before editing; it moves under you')

  const res = parsesConsumerShape(root, 'LessonShape', doc)
  assert.equal(res.ok, true, `got: ${res.detail}`)
})

// ── 41. the named gap, and the key that must simply be ABSENT ────────────────────────────
test("eval lesson — an unnamed writer is the literal 'unrecorded'; an unnamed phase omits the key entirely", () => {
  const root = makeConsumer()
  const r = lesson(root, ['a lesson from a session that did not say who it was'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = JSON.parse(lessonLines(root)[0])
  assert.equal(
    doc.origin.writer,
    'unrecorded',
    `an unnamed writer is a NAMED gap, never a guessed model id; got ${JSON.stringify(doc.origin.writer)}`,
  )
  // Not `=== undefined`: `phase: null` or `phase: 0` would read as an answer in the archive, and
  // JSON.parse turns an explicit null into a present key that a consumer has to defend against.
  assert.equal(
    'phase' in doc,
    false,
    `an unnamed phase must OMIT the key, not carry an empty answer; got ${JSON.stringify(doc)}`,
  )
  const res = parsesConsumerShape(root, 'LessonShape', doc)
  assert.equal(res.ok, true, `got: ${res.detail}`)
})

// ── 42. NON-SHADOWING: the new literal must not swallow the arc-id lane ──────────────────
test('eval <ARCID> — the `lesson` literal shadows nothing; a bare arcid still reaches the arc-eval path', () => {
  const root = sharedFixture()
  // The cheap proof: an arc id that does not exist must still be refused BY THE ARC-EVAL LANE
  // (which names the missing arc file), never handled as a lesson with a funny name. A new
  // literal checked in the wrong order is the regression this dispatch could most easily cause.
  const r = roadmap(root, ['eval', 'NOSUCHARC', '--date', EVAL_DATE])
  assert.notEqual(r.code, 0, `a missing arc must never exit 0: ${r.stdout}`)
  const out = r.stdout + r.stderr
  assert.match(out, /NOSUCHARC/, 'the refusal names the arc it could not find')
  assert.match(out, /\.arc\.ts|arc file/, `it is the ARC-EVAL refusal, not a lesson usage line; got:\n${out}`)
  assert.doesNotMatch(out, /lessons\.jsonl/, 'an arc id never touches the lessons sidecar')
  assert.equal(existsSync(lessonsPath(root)), false, 'and writes no lesson for it')
})

// ── 43. the receipt says what landed ─────────────────────────────────────────────────────
test('eval lesson — stdout on success reports what was written, INCLUDING the minted ts', () => {
  const root = makeConsumer()
  const r = lesson(root, ['the receipt has to carry the timestamp the caller never chose', '--writer', 'claude-fable-5'])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const doc = JSON.parse(lessonLines(root)[0])
  // The ts is the one field the CALLER did not supply, so it is the one the receipt must echo:
  // without it a session has no way to cite the line it just wrote.
  assert.ok(
    r.stdout.includes(doc.ts),
    `stdout must carry the minted ts ${doc.ts} that landed in the file; stdout was:\n${r.stdout}`,
  )
  assert.ok(r.stdout.includes('lessons.jsonl'), `stdout must name the sidecar it appended to; stdout was:\n${r.stdout}`)
})

// ── 44. the third exit code: a document the CONTRACT refuses, not the parser ─────────────
test('eval lesson — a non-positive --phase is a Zod REFUSAL (exit 2), distinct from usage (exit 1), and lands nothing', () => {
  const root = makeConsumer()
  // The exit-code contract only means something if all three lanes are reachable. `--phase 0`
  // is well-formed input the SHAPE rejects (phase is a positive int), so it separates "the
  // caller held the command wrong" (1) from "the caller's document is not a lesson" (2).
  const r = lesson(root, ['a lesson filed against a phase number that cannot exist', '--phase', '0'])
  assert.equal(r.code, 2, `a shape refusal is exit 2, not 1: ${r.stdout + r.stderr}`)
  assert.match(r.stderr, /LessonShape/, 'the refusal names the shape that refused it')
  assert.match(r.stderr, /phase/, 'and the field it refused on')
  assert.equal(existsSync(lessonsPath(root)), false, 'a refused lesson leaves NO file behind')
})
