#!/usr/bin/env node
/**
 * arc-next.test.mjs — the full `arc next` action vocabulary + kill-and-resume + the
 * stalled-watch-wake fork (arc ROADCODE 1660.3). Locked decision 3 (files are the only
 * truth): every resume case spawns a FRESH CLI process — statelessness IS the kill — and no
 * test reads or writes a RESUME.md; the derivation is disk-only by construction. Titles carry
 * N1-N9. Run: node --test test/fixture-consumer/arc-next.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  makeFixtureRepo, runCli, writePhaseFile, writeArcFile, writePhaseRaw, commitAll, git,
} from './harness.mjs'
import arcPlaneWorkflow from '../../workflows/arc-plane.workflow.mjs'

/** Build arc FX over the given member phase objects (+ optional acceptanceCriteria).
 *  `config` is shallow-merged into the fixture's roadmap.config.json (makeFixtureRepo opts). */
function arcRepo(members, { criteria = true, arcId = 'FX', extra = {}, config } = {}) {
  const root = makeFixtureRepo(config ? { config } : {})
  writeArcFile(root, {
    id: arcId, baseRef: 'develop', planes: [{ name: 'P', phases: members.map((m) => m.phase) }],
    ...(criteria ? { acceptanceCriteria: [{ id: 'c1', job: 'the fixture arc job here', surfaces: ['plugin'], signal: 'observable signal here', tier: 'wired', bar: 'good enough to judge' }] } : {}),
    ...extra,
  })
  for (const m of members) writePhaseFile(root, m)
  commitAll(root, 'seed: FX arc + members')
  return root
}
const next = (root, extraArgs = []) => runCli(root, ['arc', 'next', 'FX', '--json', ...extraArgs])

// ── N1 — fresh arc → run-phase on the first member ──────────────────────────────────────
test('N1 — a fresh fixture arc → action run-phase on the first member', () => {
  const root = arcRepo([
    { phase: 9101, status: 'backlog', arcId: 'FX', tasks: [{ id: '9101.1', done: false }] },
    { phase: 9102, status: 'backlog', arcId: 'FX', tasks: [{ id: '9102.1', done: false }] },
  ])
  const r = nextUnder(root, CLEAR)
  assert.equal(r.code, 0)
  assert.equal(r.json.action, 'run-phase')
  assert.equal(r.json.phase, 9101)
})

// ── N2 — mid-phase post-commit kill → resume-phase listing the committed task ────────────
test('N2 — mid-phase post-commit kill → resume-phase with the committed task in resume.doneTasks', () => {
  const root = arcRepo([
    { phase: 9101, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9101.1', done: true }, { id: '9101.2', done: false }] },
    { phase: 9102, status: 'backlog', arcId: 'FX', tasks: [{ id: '9102.1', done: false }] },
  ])
  // a matching commit whose message carries the task id (verifyTaskCommit's --grep)
  git(root, 'commit', '-q', '--allow-empty', '-m', 'feat: phase 9101 — 9101.1 landed')
  const r = next(root) // FRESH process — statelessness is the kill
  assert.equal(r.json.action, 'resume-phase')
  assert.equal(r.json.phase, 9101)
  assert.ok(r.json.resume.doneTasks.includes('9101.1'), `committed task listed: ${JSON.stringify(r.json.resume)}`)
})

// ── N3 — done:true with NO matching commit → unverifiedDoneFlags, still resume-phase ─────
test('N3 — a done:true task with no matching commit → unverifiedDoneFlags + resume-phase scoping it', () => {
  const root = arcRepo([
    { phase: 9101, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9101.1', done: true }, { id: '9101.2', done: false }] },
  ])
  // NO commit carries "9101.1" → the done flag is unverified.
  const r = next(root)
  assert.equal(r.json.action, 'resume-phase')
  assert.ok(r.json.resume.unverifiedDoneFlags.includes('9101.1'), `unverified flag reported: ${JSON.stringify(r.json.resume)}`)
  assert.ok(!r.json.resume.doneTasks.includes('9101.1'), 'an unverified flag is NOT counted as done')
})

// ── N4 — between-phase kill → run-phase on the next member (pure disk fast-forward) ──────
test('N4 — member 1 done with executionResult → run-phase on member 2', () => {
  const root = arcRepo([
    { phase: 9101, status: 'done', arcId: 'FX', tasks: [{ id: '9101.1', done: true }], executionResult: { phase: 9101, status: 'done', gateRounds: 1, hardStops: [] } },
    { phase: 9102, status: 'backlog', arcId: 'FX', tasks: [{ id: '9102.1', done: false }] },
  ])
  const r = nextUnder(root, CLEAR)
  assert.equal(r.json.action, 'run-phase')
  assert.equal(r.json.phase, 9102)
})

// ── N5 — all done → sweep, then validate, then land (derived in order from disk) ─────────
test('N5 — the terminal chain: sweep → validate → land, each derived from disk state alone', () => {
  const members = [
    { phase: 9101, status: 'done', arcId: 'FX', tasks: [{ id: '9101.1', done: true }], executionResult: { phase: 9101, status: 'done', gateRounds: 1, hardStops: [] } },
    { phase: 9102, status: 'done', arcId: 'FX', tasks: [{ id: '9102.1', done: true }], executionResult: { phase: 9102, status: 'done', gateRounds: 1, hardStops: [] } },
  ]
  // (a) sweep — a broken registry makes the debt census unable-to-count ⇒ not-confirmed-swept.
  const sweepRoot = arcRepo(members)
  writeFileSync(join(sweepRoot, 'lib', 'roadmap', 'registry.ts'), 'export async function discoverPhases(){ throw new Error("boom") }\nexport async function discoverArcs(){ return { arcs: [] } }\n')
  commitAll(sweepRoot, 'chore: break the census registry')
  assert.equal(next(sweepRoot).json.action, 'sweep', 'census unable-to-count ⇒ sweep')

  // (b) validate — working (empty) census ⇒ swept; acceptanceCriteria present, no verdict.
  const root = arcRepo(members)
  assert.equal(next(root).json.action, 'validate', 'swept + criteria + no verdict ⇒ validate')

  // (c) land — stamp the validate verdict PASS → the derivation advances to land.
  assert.equal(runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS']).code, 0)
  assert.equal(next(root).json.action, 'land', 'swept + PASS verdict ⇒ land')
})

// ── N6 — landed arc → complete, idempotent no-op with an identical clean report ──────────
test('N6 — a landed arc → complete, invoked TWICE with deep-equal JSON and exit 0 both times', () => {
  const root = arcRepo([
    { phase: 9101, status: 'done', arcId: 'FX', tasks: [{ id: '9101.1', done: true }], executionResult: { phase: 9101, status: 'done', gateRounds: 1, hardStops: [] } },
  ], { criteria: false })
  writeFileSync(join(root, 'roadmap', 'arc-summary.json'), JSON.stringify({ arcId: 'FX', outcome: 'shipped' }))
  const a = next(root)
  const b = next(root)
  assert.equal(a.code, 0)
  assert.equal(b.code, 0)
  assert.equal(a.json.action, 'complete')
  assert.deepEqual(a.json, b.json, 'the completed-arc report is an idempotent no-op (resume-by-rederive)')
})

// ── N7 — blocked with the matching reason (all three reasons in the vocabulary) ──────────
test('N7 — blocked: unmet dep, foreign lane, and a malformed member file', () => {
  // (a) unmet cross-phase dependency
  const depRoot = arcRepo([{ phase: 9101, status: 'backlog', arcId: 'FX', dependsOn: [8888], tasks: [{ id: '9101.1', done: false }] }])
  let r = runCli(depRoot, ['arc', 'next', 'FX'])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /"action": "blocked"/)
  assert.match(r.stdout, /dependenc/i, 'names the unmet-dependency reason')

  // (b) foreign lane — a sidecar armed to a DIFFERENT worktree
  const foreignRoot = arcRepo([{ phase: 9101, status: 'backlog', arcId: 'FX', tasks: [{ id: '9101.1', done: false }] }])
  mkdirSync(join(foreignRoot, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(foreignRoot, 'roadmap', 'arcs', '.building', 'FX.json'), JSON.stringify({ arcId: 'FX', worktree: '/some/other/tree' }))
  r = runCli(foreignRoot, ['arc', 'next', 'FX'])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /foreign lane/, 'names the foreign lane')

  // (c) malformed member file (truncated export, no status:) — a contract exit, never a stack trace
  const badRoot = arcRepo([{ phase: 9101, status: 'backlog', arcId: 'FX', tasks: [{ id: '9101.1', done: false }] }])
  writePhaseRaw(badRoot, 9101, 'export default { phase: 9101,')
  commitAll(badRoot, 'chore: corrupt the member file')
  r = runCli(badRoot, ['arc', 'next', 'FX'])
  assert.equal(r.code, 2)
  assert.match(r.stdout, /malformed/, 'names the malformed FILE reason')
})

// ── N8/N9 — the stalled-watch-wake fork (the workflow LOOP's reaction is under test) ─────
/** Build a real fixture repo for a mid-band member + drive arcPlaneWorkflow with a canned
 *  `run` (the CLI decisions) and a two-step `agent` (the watch wake, then a terminal). */
function driveWorkflow(root, phase, { agentReturns, deps = {}, resultCheckExit = 0 }) {
  let laps = 0
  const fakeRun = (cmd, opts = {}) => {
    // ONE phase per drive: a second lap means the first finished, so the arc reads complete.
    // (A canned run-phase payload would otherwise re-spawn forever on the success path.)
    if (cmd.includes('arc next') && laps++ > 0) return { stdout: JSON.stringify({ arc: 'FX', action: 'complete', done: [phase], remaining: [] }), stderr: '', exitCode: 0 }
    if (cmd.includes('arc next')) return { stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase, band: 'mid', plane: 'P', done: [], remaining: [], gates: {} }), stderr: '', exitCode: 0 }
    if (cmd.includes('gate plan')) return { stdout: JSON.stringify({ phase, slots: [], testScope: { effective: 'relevant' }, reviewScope: { effective: 'full' }, agents: {} }), stderr: '', exitCode: 0 }
    // `result check` parses-or-dies then re-emits the executor's own JSON — the fake echoes it.
    if (cmd.includes('result check')) return { stdout: opts.input ?? '{}', stderr: resultCheckExit === 0 ? '' : 'invalid PhaseExecutionResult', exitCode: resultCheckExit }
    return { stdout: '{}', stderr: '', exitCode: 0 } // config check, arm, contract show, verify-complete
  }
  let calls = 0
  const fakeAgent = async () => agentReturns[Math.min(calls++, agentReturns.length - 1)]
  return { promise: arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, { run: fakeRun, agent: fakeAgent, cwd: root, ...deps }), calls: () => calls }
}
function beacon(root, phase, event) {
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(join(root, '.building', `${phase}-executor.jsonl`), JSON.stringify(event) + '\n')
}

test('N8 — a fresh live-pid background-run beacon suppresses the stalled halt on a watch exit 3 (keep-waiting)', async () => {
  const root = arcRepo([{ phase: 9801, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9801.1', done: false }] }])
  beacon(root, 9801, { ts: new Date().toISOString(), phase: 9801, event: 'background-run', log: '.test-logs/run.tap', pid: process.pid })
  const d = driveWorkflow(root, 9801, { agentReturns: [
    { watchExit: 3, watchVerdict: { verdict: 'STALLED' } }, // wake 1: keep-waiting (fresh, live)
    { watchExit: 4, watchVerdict: { verdict: 'EXITED' } },  // wake 2: a real exit → terminal
  ] })
  const result = await d.promise
  assert.notEqual(result.halt, 'stalled', 'the fresh live beacon must SUPPRESS the stalled halt')
  assert.equal(result.halt, 'exited', 'the loop kept waiting, then took the real EXITED terminal')
  assert.equal(d.calls(), 2, 'the executor was re-awaited (keep-waiting branch taken)')
})

test('N9 — a stale or absent beacon on a watch exit 3 → the TYPED stalled halt payload', async () => {
  // (a) absent beacon
  const absent = arcRepo([{ phase: 9801, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9801.1', done: false }] }])
  let result = await driveWorkflow(absent, 9801, { agentReturns: [{ watchExit: 3, watchVerdict: { verdict: 'STALLED' } }] }).promise
  assert.equal(result.halt, 'stalled', 'no beacon ⇒ typed stalled halt')
  assert.equal(result.phase, 9801)
  assert.ok(result.evidence, 'the halt carries the watch verdict evidence verbatim')

  // (b) STALE beacon (>10 min, live pid) — freshness gate fails ⇒ still a stalled halt
  const stale = arcRepo([{ phase: 9801, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9801.1', done: false }] }])
  beacon(stale, 9801, { ts: new Date(Date.now() - 20 * 60000).toISOString(), phase: 9801, event: 'background-run', log: '.test-logs/run.tap', pid: process.pid })
  const d = driveWorkflow(stale, 9801, { agentReturns: [{ watchExit: 3, watchVerdict: { verdict: 'STALLED' } }] })
  result = await d.promise
  assert.equal(result.halt, 'stalled', 'a >10-min beacon is not proof of life ⇒ stalled halt')
  assert.equal(d.calls(), 1, 'no keep-waiting on a stale beacon')
})

// ── N10-N13 — the workflow lane's half of the executor-arm exclusivity contract (2376) ───
// The unit of exclusivity is the EXECUTOR (cli/lib/executor-arm.mjs): the workflow arms
// pre-spawn with a minted executor id, refuses to spawn over an incumbent, and disarms only
// once the executor has demonstrably handed something back.
const armFile = (root, phase) => join(root, '.building', `${phase}-executor.armed`)
const readArm = (root, phase) => JSON.parse(readFileSync(armFile(root, phase), 'utf8'))
const lastBeacon = (root, phase) =>
  JSON.parse(readFileSync(join(root, '.building', `${phase}-executor.jsonl`), 'utf8').trim().split('\n').pop())
const memberRepo = (phase) => arcRepo([{ phase, status: 'in-progress', arcId: 'FX', tasks: [{ id: `${phase}.1`, done: false }] }])
const typedResult = (phase, status) => ({
  phase, status, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [], gateRounds: 1,
  ...(status === 'escalated' ? { escalation: { question: 'which lane owns this?', options: ['a', 'b'] } } : {}),
})

test('N10 — no sessionId ⇒ NO arm file is ever written (an unbound arm is inert noise, never a lock)', async () => {
  const root = memberRepo(9801)
  let armedAtSpawn = null
  const result = await driveWorkflow(root, 9801, {
    agentReturns: [],
    // The arm is written PRE-spawn, so the spawn itself is the only place to observe it.
    deps: {
      sessionId: null,
      agent: async () => {
        armedAtSpawn = existsSync(armFile(root, 9801))
        return { result: typedResult(9801, 'done') }
      },
    },
  }).promise
  assert.equal(result.done, true, 'the drive ran the phase and completed the arc')
  assert.equal(armedAtSpawn, false, 'without a session id the workflow arms NOTHING')
  assert.equal(existsSync(armFile(root, 9801)), false, 'and leaves no arm behind either')
})

test('N11 — a returned-and-checked result stamps result-returned itself and clears the arm (done AND escalated)', async () => {
  for (const status of ['done', 'escalated']) {
    const root = memberRepo(9801)
    const result = await driveWorkflow(root, 9801, {
      agentReturns: [{ result: typedResult(9801, status) }],
      deps: { sessionId: `sess-11-${status}` },
    }).promise
    // The Claude lane gets result-returned from the Stop hook; this harness may run no hooks,
    // so the workflow stamps the same proof itself — otherwise its own disarm would refuse.
    assert.equal(lastBeacon(root, 9801).event, 'result-returned', `${status}: the returned-result proof is stamped`)
    assert.equal(existsSync(armFile(root, 9801)), false, `${status}: a returned result clears the arm`)
    if (status === 'done') assert.equal(result.done, true)
    else assert.equal(result.halt, 'escalated', 'an escalated result still ENDS the workflow')
  }
})

test('N12 — an executor that never returns leaves the arm STANDING, bound to the minted executor id', async () => {
  const root = memberRepo(9801)
  beacon(root, 9801, { ts: new Date().toISOString(), phase: 9801, event: 'task-start', task: '9801.1' })
  const result = await driveWorkflow(root, 9801, {
    agentReturns: [{ watchExit: 4, watchVerdict: { verdict: 'EXITED' } }],
    deps: { sessionId: 'sess-12' },
  }).promise
  assert.equal(result.halt, 'exited', 'the watchdog terminal is still the typed halt')
  assert.ok(existsSync(armFile(root, 9801)), 'a live-beacon arm is load-bearing, not stale — the disarm refuses it')
  const body = readArm(root, 9801)
  assert.equal(body.sessionId, 'sess-12', 'the arm is session-bound (the JSON body the guard parses)')
  assert.match(body.executorId, /^[0-9a-f-]{36}$/, 'and names the executor minted for THIS spawn')
})

test('N12b — the workflow arm records the card alias too: the CLI is not the only door onto the arm', async () => {
  // arc-plane is the other caller of armExecutor, and it invokes `result check` itself further
  // down. An alias-less arm there makes that reconcile a silent no-op — the same hole task 3.4
  // closed on the CLI path — so both doors must record what was requested.
  const { cardModelAlias, DEFAULT_AGENT_CARD } = await import('../../cli/lib/executor-arm.mjs')
  const expected = cardModelAlias(DEFAULT_AGENT_CARD)
  assert.equal(typeof expected, 'string', 'precondition: the shipped phase-executor card declares a model alias')

  const root = memberRepo(9801)
  beacon(root, 9801, { ts: new Date().toISOString(), phase: 9801, event: 'task-start', task: '9801.1' })
  await driveWorkflow(root, 9801, {
    agentReturns: [{ watchExit: 4, watchVerdict: { verdict: 'EXITED' } }],
    deps: { sessionId: 'sess-12b' },
  }).promise
  assert.equal(
    readArm(root, 9801).expectedModelAlias,
    expected,
    'the workflow-written arm carries the requested alias, so result check has something to reconcile against',
  )
})

test('N13 — a second launch over a standing arm halts blocked, naming the incumbent, and spawns nothing', async () => {
  const root = memberRepo(9801)
  beacon(root, 9801, { ts: new Date().toISOString(), phase: 9801, event: 'task-start', task: '9801.1' })
  await driveWorkflow(root, 9801, {
    agentReturns: [{ watchExit: 4, watchVerdict: { verdict: 'EXITED' } }],
    deps: { sessionId: 'sess-13' },
  }).promise
  const incumbent = readArm(root, 9801).executorId

  let spawned = 0
  const second = await driveWorkflow(root, 9801, {
    agentReturns: [],
    deps: { sessionId: 'sess-13', agent: async () => { spawned++; return { watchExit: 4, watchVerdict: {} } } },
  }).promise
  assert.equal(second.halt, 'blocked', 'the second launch refuses the phase instead of rewriting the arm')
  assert.ok(
    second.evidence?.executorArm?.includes(incumbent),
    `the halt names the incumbent executor: ${JSON.stringify(second.evidence)}`,
  )
  assert.equal(spawned, 0, 'no second executor was spawned onto the first one\'s working tree')
  assert.equal(readArm(root, 9801).executorId, incumbent, 'the incumbent arm is left untouched')
})

test('N14 — an incumbent arm blocks the spawn even with NO sessionId (the check never depends on the write)', async () => {
  // The lane that cannot write an arm is exactly the lane that used to spawn straight over one.
  const root = memberRepo(9801)
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(armFile(root, 9801), JSON.stringify({ sessionId: 'sess-other', executorId: 'incumbent-E1', armedAt: new Date().toISOString() }) + '\n')
  beacon(root, 9801, { ts: new Date().toISOString(), phase: 9801, event: 'task-start', task: '9801.1' })
  let spawned = 0
  const result = await driveWorkflow(root, 9801, {
    agentReturns: [],
    deps: { sessionId: null, agent: async () => { spawned++; return { result: typedResult(9801, 'done') } } },
  }).promise
  assert.equal(result.halt, 'blocked', 'no session id is not a licence to spawn over a live executor')
  assert.ok(result.evidence?.executorArm?.includes('incumbent-E1'), `the halt names the incumbent: ${JSON.stringify(result.evidence)}`)
  assert.equal(spawned, 0, 'nothing was spawned')
  assert.equal(readArm(root, 9801).executorId, 'incumbent-E1', 'the foreign arm is untouched')
  assert.equal(lastBeacon(root, 9801).event, 'task-start', 'and no result-returned was stamped onto its beacon')
})

test('N15 — a watchdog exit with NO beacon at all still leaves the arm standing (the gate, not the lib)', async () => {
  // N12's task-start beacon lets the LIB's refusal do the work. Here there is no beacon, so
  // disarmExecutor would happily clear (no evidence is not proof) — only the workflow's own
  // "did OUR executor hand anything back" gate keeps a genuinely live executor's arm on disk.
  const root = memberRepo(9801)
  const result = await driveWorkflow(root, 9801, {
    agentReturns: [{ watchExit: 4, watchVerdict: { verdict: 'EXITED' } }],
    deps: { sessionId: 'sess-15' },
  }).promise
  assert.equal(result.halt, 'exited')
  assert.equal(existsSync(join(root, '.building', '9801-executor.jsonl')), false, 'no beacon was ever written')
  assert.ok(existsSync(armFile(root, 9801)), 'and the arm still stands')
  assert.match(readArm(root, 9801).executorId, /^[0-9a-f-]{36}$/)
})

test('N16 — an arm that names NO executor still blocks while its beacon reads work in flight', async () => {
  // --executor-id is optional, so --session-only arms exist in the wild (the 2026-08-17 body).
  const root = memberRepo(9801)
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(armFile(root, 9801), JSON.stringify({ sessionId: 'sess-other', armedAt: new Date().toISOString() }) + '\n')
  beacon(root, 9801, { ts: new Date().toISOString(), phase: 9801, event: 'task-start', task: '9801.1' })
  let spawned = 0
  const result = await driveWorkflow(root, 9801, {
    agentReturns: [],
    deps: { sessionId: 'sess-16', agent: async () => { spawned++; return { result: typedResult(9801, 'done') } } },
  }).promise
  assert.equal(result.halt, 'blocked', 'an unnamed incumbent is still an incumbent')
  assert.ok(result.evidence?.executorArm?.includes('task-start'), `the halt cites the beacon it judged on: ${JSON.stringify(result.evidence)}`)
  assert.equal(spawned, 0)
  assert.equal(readArm(root, 9801).sessionId, 'sess-other', 'the incumbent arm is not rewritten')
})

test('N17 — an executor that RETURNED garbage still clears its own arm (it is gone, not in flight)', async () => {
  // The failed-result-check path: the result check refuses the payload, but the executor did hand
  // something back, so leaving the arm would strand it where staleArms cannot reach (bound body,
  // live phase, no terminal beacon). Lane parity with the CLI, and R1 stays closed because the
  // gate is still "we armed it AND our own executor returned".
  const root = memberRepo(9801)
  const result = await driveWorkflow(root, 9801, {
    agentReturns: [{ result: { phase: 9801, status: 'done' } }],
    deps: { sessionId: 'sess-17' },
    resultCheckExit: 2,
  }).promise
  assert.equal(result.halt, 'failed', 'a red result check is still the typed failed halt')
  assert.equal(existsSync(armFile(root, 9801)), false, 'and the returned executor left no arm behind')
})

// ── 2384.3 — the workflow lane speaks the new verdict. Before this, ANY unrecognized watchdog wake
// fell through to a `stalled` halt, so a watch exit 5 would be relabelled with the exact word the
// UNOBSERVED verdict exists to stop over-claiming — and the session would judge a respawn on it.

test('N23 — a watch exit 5 → the TYPED unobserved halt, never relabelled stalled', async () => {
  const root = arcRepo([{ phase: 9801, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9801.1', done: false }] }])
  const verdict = { verdict: 'UNOBSERVED', evidence: { unobserved: 'no independent life signal could be probed — pass --transcript-dir' } }
  const result = await driveWorkflow(root, 9801, { agentReturns: [{ watchExit: 5, watchVerdict: verdict }] }).promise
  assert.equal(result.halt, 'unobserved', 'the closed halt vocabulary carries the new member')
  assert.notEqual(result.halt, 'stalled', 'the stalled halt no longer absorbs it')
  assert.equal(result.phase, 9801)
  assert.deepEqual(result.evidence, verdict, 'the watch verdict rides verbatim, never re-narrated')
})

test('N24 — an unrecognized wake STILL falls through to stalled (the fall-through is not widened)', async () => {
  const root = arcRepo([{ phase: 9801, status: 'in-progress', arcId: 'FX', tasks: [{ id: '9801.1', done: false }] }])
  const result = await driveWorkflow(root, 9801, { agentReturns: [{ watchExit: 99, watchVerdict: { verdict: 'WAT' } }] }).promise
  assert.equal(result.halt, 'stalled', 'only exit 5 maps to unobserved — an unknown wake keeps its old handling')
})

// ── N25-N29 — the capacity ADMISSION GATE at `arc next` (phase 11 task 11.4) ──────────────
// do-arc spawns whatever `arc next` hands it, so a starved box has to be refused HERE, in the
// CLI choke point, using the blocked action do-arc already halts on. Determinism comes from the
// SAME seam the capacity verb documents: ZEROH_ROADMAP_CAPACITY_PROBES replaces every live probe
// with fixed values, so these cases never read this box's real memory/load/units.
const probesEnv = (probes) => ({ ZEROH_ROADMAP_CAPACITY_PROBES: JSON.stringify(probes) })
/** A box with room to spare on every signal (default bounds: 6144+4096 MB, 2 cores, 3 executors). */
const CLEAR = { memAvailableMb: 64000, load1: 0.5, cores: 16, capbuildUnits: 0, liveArms: 0 }
/** Same box, but the executor bound is already spent (3 busy ≥ maxExecutors 3). */
const STARVED = { ...CLEAR, capbuildUnits: 3 }
const nextUnder = (root, probes, extraArgs = []) =>
  runCli(root, ['arc', 'next', 'FX', '--json', ...extraArgs], probesEnv(probes))
/** Two backlog members, so a runnable member exists AND `remaining` stays non-empty after
 *  selection — both shapes the capacity gate must preserve when it transforms the action.
 *  `config` (optional) is shallow-merged into the fixture's roadmap.config.json. */
const runnableRepo = (config) => arcRepo([
  { phase: 9101, status: 'backlog', arcId: 'FX', tasks: [{ id: '9101.1', done: false }] },
  { phase: 9102, status: 'backlog', arcId: 'FX', tasks: [{ id: '9102.1', done: false }] },
], config ? { config } : {})

test('N25 — a starved box turns run-phase into blocked, quoting the BINDING signal and the override (exit 2)', () => {
  const root = runnableRepo()
  // Control first: the ONLY difference between these two runs is the seam value.
  const clear = nextUnder(root, CLEAR)
  assert.equal(clear.code, 0)
  assert.equal(clear.json.action, 'run-phase', 'precondition: this fixture is runnable on a clear box')

  // (a) the executor bound binds
  const busy = nextUnder(root, STARVED)
  assert.equal(busy.code, 2, 'a capacity refusal exits on the existing blocked mapping, not a new code')
  assert.equal(busy.json.action, 'blocked')
  assert.ok(
    busy.json.reason.startsWith('box at capacity — '),
    `the reason opens with the capacity prefix do-arc reads: ${JSON.stringify(busy.json.reason)}`,
  )
  assert.match(busy.json.reason, /executors: 3 busy/, 'and quotes the reason that actually bound')
  assert.match(busy.json.reason, /maxExecutors 3/, 'naming the bound it hit')
  assert.match(busy.json.reason, /--ignore-capacity/, 'and the operator override, so the halt is actionable')
  assert.ok(busy.json.remaining.includes(9101), 'the refused member is still on the board, not consumed')

  // (b) a DIFFERENT signal binds → a different quoted reason (the gate reads the verdict, not one field)
  const starvedMem = { ...CLEAR, memAvailableMb: 2000 }
  const mem = nextUnder(root, starvedMem)
  assert.equal(mem.code, 2)
  assert.equal(mem.json.action, 'blocked')
  assert.ok(mem.json.reason.startsWith('box at capacity — '))
  assert.match(
    mem.json.reason,
    /memory: 2000 MB available < 10240 MB needed/,
    `the memory signal's own reason text rides through: ${JSON.stringify(mem.json.reason)}`,
  )
  assert.doesNotMatch(mem.json.reason, /executors: /, 'and a signal that did NOT bind is not invented into the halt')
})

test('N26 — --ignore-capacity restores the UNTRANSFORMED run-phase result byte-for-byte, with a stderr override note', () => {
  const root = runnableRepo()
  const clear = nextUnder(root, CLEAR)
  const overridden = nextUnder(root, STARVED, ['--ignore-capacity'])
  assert.equal(overridden.code, 0, 'the override is a full restore, including the exit code')
  assert.equal(
    overridden.stdout,
    clear.stdout,
    'the machine-read stdout is the derivation verbatim — an override must not narrate into the JSON',
  )
  assert.equal(overridden.json.action, 'run-phase')
  assert.equal(overridden.json.phase, 9101)
  // The note is the audit trail for a deliberate override: it must name what was overridden.
  assert.match(overridden.stderr, /--ignore-capacity/, `the override announces itself: ${JSON.stringify(overridden.stderr)}`)
  assert.match(overridden.stderr, /executors: 3 busy/, 'and names the capacity reason it is overriding')
  assert.doesNotMatch(clear.stderr, /capacity/i, 'a clear box says nothing about capacity anywhere')
})

test('N27 — a box WITH capacity leaves the derivation untouched: no capacity fields, no dependence on the numbers', () => {
  const root = runnableRepo()
  // Two clear boxes with DIFFERENT (still generous) readings. If any capacity-era field leaked
  // into the report, these two runs would differ; if the gate mis-fired, neither would be run-phase.
  const a = nextUnder(root, CLEAR)
  const b = nextUnder(root, { memAvailableMb: 31000, load1: 3.25, cores: 8, capbuildUnits: 1, liveArms: 0 })
  assert.equal(a.code, 0)
  assert.equal(b.code, 0)
  assert.equal(a.stdout, b.stdout, 'the run-phase report is byte-identical across two healthy boxes')
  assert.deepEqual(a.json, b.json)
  assert.equal(a.json.action, 'run-phase')
  assert.equal(a.json.phase, 9101)
  for (const leak of ['capacity', 'canSpawn', 'maxParallel', 'ignore-capacity']) {
    assert.doesNotMatch(a.stdout, new RegExp(leak), `no ${leak} field rides the healthy-box report`)
  }
})

test('N28 — the gate binds ONLY run-phase: a dependency block keeps its own reason, a complete arc stays complete', () => {
  // (a) an unmet cross-phase dependency on a STARVED box — same exit 2, but capacity must not
  // overwrite (or prepend itself to) the reason the driver has to act on.
  const depRoot = arcRepo([{ phase: 9101, status: 'backlog', arcId: 'FX', dependsOn: [8888], tasks: [{ id: '9101.1', done: false }] }])
  const dep = nextUnder(depRoot, STARVED)
  assert.equal(dep.code, 2)
  assert.equal(dep.json.action, 'blocked')
  assert.match(dep.json.reason, /dependenc/i, 'the unmet-dependency reason survives a starved box')
  assert.doesNotMatch(dep.json.reason, /box at capacity/, 'capacity never relabels a block it did not cause')
  assert.deepEqual(dep.json, nextUnder(depRoot, CLEAR).json, 'and the whole report is capacity-independent')

  // (b) a terminal action the gate has no business touching — nothing is spawned to complete an arc.
  const doneRoot = arcRepo([
    { phase: 9101, status: 'done', arcId: 'FX', tasks: [{ id: '9101.1', done: true }], executionResult: { phase: 9101, status: 'done', gateRounds: 1, hardStops: [] } },
  ], { criteria: false })
  writeFileSync(join(doneRoot, 'roadmap', 'arc-summary.json'), JSON.stringify({ arcId: 'FX', outcome: 'shipped' }))
  const starvedComplete = nextUnder(doneRoot, STARVED)
  assert.equal(starvedComplete.code, 0, 'a starved box still lets a finished arc report complete')
  assert.equal(starvedComplete.json.action, 'complete')
  assert.equal(starvedComplete.stdout, nextUnder(doneRoot, CLEAR).stdout, 'byte-identical to the clear-box report')
})

test('N29 — the gate honors the consumer config capacity block, not just the library defaults', () => {
  // ONE busy unit: clear under the default bound (3), at capacity under a box that declares 1.
  const probes = { ...CLEAR, capbuildUnits: 1 }
  const defaults = nextUnder(runnableRepo(), probes)
  assert.equal(defaults.code, 0, 'precondition: 1 busy unit is well inside the default maxExecutors 3')
  assert.equal(defaults.json.action, 'run-phase')

  const tight = nextUnder(runnableRepo({ capacity: { maxExecutors: 1 } }), probes)
  assert.equal(tight.code, 2, 'the same box refuses once the consumer declares a bound of one executor')
  assert.equal(tight.json.action, 'blocked')
  assert.match(tight.json.reason, /^box at capacity — /)
  assert.match(tight.json.reason, /executors: 1 busy/)
  assert.match(tight.json.reason, /maxExecutors 1/, 'the CONFIGURED bound is what was applied, not the default 3')
})

test('N30 — a broken seam under --ignore-capacity is NAMED, never silent: exit 0, run-phase stdout intact', () => {
  const root = runnableRepo()
  const clear = nextUnder(root, CLEAR, ['--ignore-capacity'])
  const broken = nextUnder(root, { memAvailableMb: 64000 }, ['--ignore-capacity'])
  assert.equal(broken.code, 0, 'the override stands — a broken advisory knob never blocks')
  assert.equal(broken.stdout, clear.stdout, 'the machine-read derivation is untouched by the seam failure')
  assert.match(broken.stderr, /ZEROH_ROADMAP_CAPACITY_PROBES/, `the operator's broken knob is named:\n${broken.stderr}`)
  assert.match(broken.stderr, /override active/, 'and the note says the override is why run-phase stands')
})
