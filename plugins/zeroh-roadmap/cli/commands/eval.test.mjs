// Eval records scenarios; fixture state is private to this test process.
import { ARC, DATE, assert, commitAll, docFile, existsSync, join, makeConsumer, makeFixtureRepo, outPath, readFileSync, roadmap, runCli, test, validSweep, validVerdicts, writePhaseFile } from '../testdata/eval.test-support.mjs'

test('eval adherence — a phase number scores exactly that one phase as JSON', () => {
  const root = makeFixtureRepo()
  writePhaseFile(root, { phase: 81, status: 'done', completedDate: '2026-09-02', tasks: [], executionResult: { status: 'done', driver: { model: 'codex', lane: 'codex' }, roles: [] } })
  writePhaseFile(root, { phase: 82, status: 'done', completedDate: '2026-09-02', tasks: [], executionResult: { status: 'done', driver: { model: 'claude', lane: 'session' }, roles: [] } })
  commitAll(root, 'docs(roadmap): seed phases for adherence')
  const result = runCli(root, ['eval', 'adherence', '81', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.equal(result.json.phase, 81)
  assert.equal(result.json.driver.model, 'codex')
  assert.ok(Array.isArray(result.json.checks))
})

test('eval adherence --since — scores only completed phases on/after the date, oldest first', () => {
  const root = makeFixtureRepo()
  writePhaseFile(root, { phase: 80, status: 'done', completedDate: '2026-08-31', tasks: [], executionResult: { status: 'done', driver: { model: 'old', lane: 'session' }, roles: [] } })
  writePhaseFile(root, { phase: 83, status: 'done', completedDate: '2026-09-01', tasks: [], executionResult: { status: 'done', driver: { model: 'codex', lane: 'codex' }, roles: [] } })
  commitAll(root, 'docs(roadmap): mark phase 83 complete')
  writePhaseFile(root, { phase: 84, status: 'done', completedDate: '2026-09-02', tasks: [], executionResult: { status: 'done', driver: { model: 'claude', lane: 'session' }, roles: [] } })
  commitAll(root, 'docs(roadmap): mark phase 84 complete')
  const result = runCli(root, ['eval', 'adherence', '--since', '2026-09-01', '--json'])
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.deepEqual(result.json.map((row) => row.phase), [83, 84])
})

test('record-sweep — a valid report writes the dated archive file and round-trips (exit 0)', () => {
  const root = makeConsumer()
  const f = docFile(root, 'sweep.json', validSweep)
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, f])
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const path = outPath(root, 'sweep')
  assert.ok(existsSync(path), `expected the archive at ${path}`)
  assert.match(r.stdout, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'stdout names the written path')

  const raw = readFileSync(path, 'utf8')
  assert.ok(raw.endsWith('}\n'), 'pretty-printed with a trailing newline')
  const onDisk = JSON.parse(raw)
  assert.equal(onDisk.arcId, ARC)
  assert.equal(onDisk.date, DATE)
  assert.equal(onDisk.overall, 'green')
  assert.equal(onDisk.architectVerdict, 'no designRefs')
  assert.deepEqual(onDisk.debtDispositions, [
    { item: 'a named compromise', disposition: 'ACCEPT', ref: 'phase 9001' },
  ])
  assert.deepEqual(onDisk.phaseGates, [{ phase: 9001, done: true, gateGreen: true }])
})

test('record-verdicts — the document PIPED ON STDIN writes the verdicts archive (exit 0)', () => {
  const root = makeConsumer()
  // The stdin lane is what the skills use, so it is proven end-to-end here rather than
  // assumed from the file lane.
  const r = roadmap(root, ['eval', 'record-verdicts', '--arc', ARC], JSON.stringify(validVerdicts))
  assert.equal(r.code, 0, r.stdout + r.stderr)

  const path = outPath(root, 'verdicts')
  assert.ok(existsSync(path), `expected the archive at ${path}`)
  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(onDisk.judgeModel, 'claude-sonnet-5')
  assert.equal(onDisk.arcId, ARC)
  assert.equal(onDisk.verdicts.length, 1)
  assert.equal(onDisk.verdicts[0].criterionId, 'ac-1')
  assert.equal(onDisk.verdicts[0].tierUsed, 'wired')
})

test('record-sweep — an unknown disposition token is REFUSED (exit 2), named, and writes nothing', () => {
  const root = makeConsumer()
  const bad = {
    ...validSweep,
    debtDispositions: [{ item: 'a named compromise', disposition: 'MAYBE-LATER', ref: 'phase 9001' }],
  }
  const f = docFile(root, 'bad.json', bad)
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, f])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /debtDispositions\.0\.disposition: .+/, 'the Zod issue path is printed')
  // A refusal must read as a refusal, not as a crash leaking the recorder's internals.
  assert.doesNotMatch(r.stderr, /at .*\n.*at /, 'no raw node stack trace')
  assert.equal(existsSync(outPath(root, 'sweep')), false, 'a refused document never reaches disk')
  assert.equal(existsSync(join(root, 'roadmap', 'arc-evals')), false, 'no archive dir minted on refusal')
})

test('record-sweep — re-recording an existing path WITHOUT --force is refused; bytes unchanged', () => {
  const root = makeConsumer()
  const first = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, docFile(root, 'sweep.json', validSweep)])
  assert.equal(first.code, 0, first.stderr)
  const path = outPath(root, 'sweep')
  const before = readFileSync(path, 'utf8')

  const changed = { ...validSweep, architectVerdict: 'SECOND PASS VERDICT' }
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, docFile(root, 'sweep2.json', changed)])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'stderr names the existing path')
  assert.equal(readFileSync(path, 'utf8'), before, 'the recorded history is byte-for-byte untouched')
  assert.match(before, /"no designRefs"/)
})

test('record-sweep — the same re-record WITH --force overwrites and says so', () => {
  const root = makeConsumer()
  const first = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, docFile(root, 'sweep.json', validSweep)])
  assert.equal(first.code, 0, first.stderr)
  const path = outPath(root, 'sweep')

  const changed = { ...validSweep, architectVerdict: 'SECOND PASS VERDICT', overall: 'blocked', blockers: ['open gap'] }
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', ARC, '--force', docFile(root, 'sweep2.json', changed)])
  assert.equal(r.code, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /OVERWROTE/, 'an overwrite is loud, never silent')

  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(onDisk.architectVerdict, 'SECOND PASS VERDICT')
  assert.equal(onDisk.overall, 'blocked')
  assert.deepEqual(onDisk.blockers, ['open gap'])
})

test('record-sweep — --arc disagreeing with the document arcId is refused (exit 2), no file written', () => {
  const root = makeConsumer()
  const f = docFile(root, 'sweep.json', validSweep)
  const r = roadmap(root, ['eval', 'record-sweep', '--arc', 'OTHER', f])
  assert.equal(r.code, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /TESTARC.*OTHER/, 'the mismatch names both sides')
  assert.equal(existsSync(join(root, 'roadmap', 'arc-evals', `OTHER-${DATE}-sweep.json`)), false)
  assert.equal(existsSync(outPath(root, 'sweep')), false)
})

test('record-sweep — a missing --arc is USAGE (exit 1), not a refusal (exit 2)', () => {
  const root = makeConsumer()
  const f = docFile(root, 'sweep.json', validSweep)
  const r = roadmap(root, ['eval', 'record-sweep', f])
  // The codes carry meaning downstream: 1 = the caller invoked it wrong, 2 = the document
  // was rejected. Collapsing them would make a malformed aggregate look like a typo.
  assert.equal(r.code, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /--arc/)
  assert.equal(existsSync(outPath(root, 'sweep')), false)
})
