#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/executor-arm.mjs (module does NOT exist yet — RED on
 * import until implemented). The CLI-owned lifecycle for the session-bound
 * <worktree>/.building/<N>-executor.armed files: today they are prose-written and
 * leak (a done phase kept its arm; a pre-2026-07-17 bare-format arm lingered and a
 * session-blind arm intercepted an UNRELATED session's subagent, which then
 * FABRICATED executor JSON). armExecutor writes SESSION-BOUND JSON, disarmExecutor
 * force-removes, staleArms flags the leak classes (done/historical phase, terminal
 * beacon incl. a legacy executor-done line, bare/legacy arm body).
 *
 * Hermetic-tmp-estate pattern from cli/lib/beacon.test.mjs + cli/commands/
 * arm-disarm.test.mjs (mkdtempSync + realpathSync + process.on('exit') cleanup).
 * Run: capbuild node --test cli/lib/executor-arm.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'executor-arm.mjs')
const { armExecutor, disarmExecutor, staleArms, liveArm } = await import(MOD)

const tmps = []
function newTmp(prefix = 'zr-exec-arm-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d)
}
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

function isoAgo(min) {
  return new Date(Date.now() - min * 60_000).toISOString()
}

/** The arm file path under <worktree>/.building/<phase>-executor.armed. */
function armPath(worktree, phase) {
  return join(worktree, '.building', `${phase}-executor.armed`)
}
/** The phase-executor beacon at <worktree>/.building/<phase>-executor.jsonl. */
function beaconPath(worktree, phase) {
  return join(worktree, '.building', `${phase}-executor.jsonl`)
}

/** Write a minimal *.phase.ts fixture declaring `status`. */
function writePhaseFile(phasesDir, n, status) {
  mkdirSync(phasesDir, { recursive: true })
  const lines = ['export const p = {', `  phase: ${n},`]
  if (status !== undefined) lines.push(`  status: '${status}',`)
  lines.push('}')
  writeFileSync(join(phasesDir, `phase-${n}.phase.ts`), lines.join('\n') + '\n')
}

/** Write raw JSONL beacon lines into <worktree>/.building/<phase>-executor.jsonl. */
function writeBeacon(worktree, phase, lines) {
  const dir = join(worktree, '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(beaconPath(worktree, phase), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

/** Hand-write a raw arm-file body (to plant a legacy/bare arm). */
function writeRawArm(worktree, phase, body) {
  const dir = join(worktree, '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(armPath(worktree, phase), body)
}

// --- armExecutor: shape + the cross-contract parse round-trip ------------------

test('1) armExecutor — writes session-bound JSON {sessionId, armedAt}, returns the path, mkdir recursive', () => {
  const worktree = newTmp()
  const before = Date.now()
  const path = armExecutor(worktree, 1727, 'sess-abc')
  assert.equal(path, armPath(worktree, 1727), 'returns the <phase>-executor.armed path')
  assert.ok(existsSync(path), 'arm file written even though .building did not pre-exist')

  const rec = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(rec.sessionId, 'sess-abc', 'sessionId is the arming session')
  const armedAt = Date.parse(rec.armedAt)
  assert.ok(!Number.isNaN(armedAt), 'armedAt is a valid ISO-8601 timestamp')
  assert.equal(new Date(armedAt).toISOString(), rec.armedAt, 'armedAt is canonical ISO-8601')
  assert.ok(armedAt >= before - 1000 && armedAt <= Date.now() + 1000, 'armedAt is ~now')
})

test('2) armExecutor — a string phase writes the <phase>-executor.armed filename verbatim', () => {
  const worktree = newTmp()
  const path = armExecutor(worktree, '1727', 'sess-abc')
  assert.equal(path, armPath(worktree, '1727'))
  assert.ok(existsSync(path))
})

test('3) CROSS-CONTRACT — the written file round-trips through executor-result-guard detectArm parse', () => {
  // detectArm (hooks/executor-result-guard.mjs:88-91): JSON.parse a body starting
  // with "{" and take .sessionId. Replicated verbatim so a shape drift RED-lights here.
  const worktree = newTmp()
  const path = armExecutor(worktree, 1727, 'sess-xyz-123')
  const raw = readFileSync(path, 'utf8').trim()
  let armedSession = null
  if (raw.startsWith('{')) armedSession = JSON.parse(raw).sessionId ?? null
  else if (raw.length > 0) armedSession = raw
  assert.equal(armedSession, 'sess-xyz-123', 'detectArm must recover the exact arming session id')
})

test('4) armExecutor — a missing sessionId THROWS and writes nothing (an unbound arm is the fabrication hazard)', () => {
  const worktree = newTmp()
  assert.throws(() => armExecutor(worktree, 1727), /session/i)
  assert.equal(existsSync(armPath(worktree, 1727)), false, 'nothing written when sessionId is missing')
})

test('5) armExecutor — an empty-string sessionId THROWS and writes nothing', () => {
  const worktree = newTmp()
  assert.throws(() => armExecutor(worktree, 1727, ''), /session/i)
  assert.equal(existsSync(armPath(worktree, 1727)), false, 'nothing written when sessionId is empty')
})

// --- disarmExecutor: remove + no-op ------------------------------------------

test('6) disarmExecutor — force-removes the arm file', () => {
  const worktree = newTmp()
  armExecutor(worktree, 1727, 'sess-abc')
  assert.ok(existsSync(armPath(worktree, 1727)), 'armed before disarm')
  disarmExecutor(worktree, 1727)
  assert.equal(existsSync(armPath(worktree, 1727)), false, 'arm file gone after disarm')
})

test('7) disarmExecutor — a missing arm file is a silent no-op (never throws)', () => {
  const worktree = newTmp()
  assert.doesNotThrow(() => disarmExecutor(worktree, 9999), 'disarming an absent arm is a no-op')
  assert.doesNotThrow(() => disarmExecutor(worktree, '1727'), 'string phase, absent arm — still a no-op')
})

// --- staleArms: the leak classes ---------------------------------------------

test('8) staleArms (a) — a JSON arm on a DONE phase is STALE (reason names the done phase)', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  armExecutor(worktree, 1727, 'sess-abc')
  writePhaseFile(phasesDir, 1727, 'done')

  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'exactly one stale arm')
  assert.equal(stale[0].phase, 1727)
  assert.equal(stale[0].file, armPath(worktree, 1727), 'reports the arm-file path')
  assert.match(stale[0].reason, /done|phase.?complete|status/i, `reason names the done-phase class; got ${stale[0].reason}`)
})

test('8h) staleArms (a) — a HISTORICAL phase arm is STALE too', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  armExecutor(worktree, 1727, 'sess-abc')
  writePhaseFile(phasesDir, 1727, 'historical')

  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'a historical phase arm is stale')
  assert.equal(stale[0].phase, 1727)
})

test('9) staleArms (b) — a JSON arm whose beacon last event is phase-complete is STALE', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  armExecutor(worktree, 1727, 'sess-abc')
  writePhaseFile(phasesDir, 1727, 'in-progress') // NOT done — the beacon is what flags it
  writeBeacon(worktree, 1727, [
    { ts: isoAgo(30), event: 'task-start', phase: 1727 },
    { ts: isoAgo(2), event: 'phase-complete', phase: 1727 },
  ])

  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'the terminal beacon flags the arm')
  assert.equal(stale[0].phase, 1727)
  assert.match(stale[0].reason, /beacon|phase.?complete|terminal|complete/i, `reason names the terminal-beacon class; got ${stale[0].reason}`)
})

test('9b) staleArms (b) — a LEGACY executor-done beacon line counts (normalized to phase-complete)', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  armExecutor(worktree, 1727, 'sess-abc')
  writePhaseFile(phasesDir, 1727, 'in-progress')
  writeBeacon(worktree, 1727, [
    { ts: isoAgo(30), event: 'task-start', phase: 1727 },
    { ts: isoAgo(2), event: 'executor-done', phase: 1727 }, // legacy terminal alias
  ])

  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'a legacy executor-done terminal line must be read through readBeaconLine and count')
  assert.equal(stale[0].phase, 1727)
})

test('10) staleArms (c) — a phase-number FOSSIL body (e.g. `1713`) is STALE; a raw session-id body is BOUND (the 1703 near-miss)', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  // The pre-D9 fossil: the file contains the PHASE NUMBER, not a session id → unbound → stale.
  writeRawArm(worktree, 1727, '1727')
  writePhaseFile(phasesDir, 1727, 'in-progress')
  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'a phase-number fossil arm is stale regardless of phase state')
  assert.equal(stale[0].phase, 1727)
  assert.match(stale[0].reason, /unbound|fossil|format|json|session/i, `reason names the unbound class; got ${stale[0].reason}`)

  // The OLD BOUND prose format: a raw session-id string — the guard's detectArm honors it
  // (`else if (raw.length > 0) armedSession = raw`), so on a LIVE phase it is NOT stale.
  // Sweeping it would disarm a running executor (the live 1703 near-miss, 2026-07-18).
  const worktree2 = newTmp()
  const phasesDir2 = join(newTmp(), 'phases')
  writeRawArm(worktree2, 1728, 'ed737add-1b2c-4d5e-8f90-a1b2c3d4e5f6')
  writePhaseFile(phasesDir2, 1728, 'in-progress')
  assert.deepEqual(staleArms(worktree2, phasesDir2), [], 'a raw session-id arm on a live phase is BOUND — never swept')
})

test('10b) staleArms (c) — a JSON body WITHOUT a sessionId key is bare/legacy ⇒ STALE', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  writeRawArm(worktree, 1727, JSON.stringify({ armedAt: isoAgo(5) })) // JSON but no sessionId
  writePhaseFile(phasesDir, 1727, 'in-progress')

  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'a JSON body lacking sessionId is not session-bound ⇒ stale')
  assert.equal(stale[0].phase, 1727)
})

test('11) staleArms — NOT stale: an in-progress phase, a live JSON arm, a task-start (non-terminal) beacon', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  armExecutor(worktree, 1727, 'sess-abc')
  writePhaseFile(phasesDir, 1727, 'in-progress')
  writeBeacon(worktree, 1727, [
    { ts: isoAgo(10), event: 'executor-start', phase: 1727 },
    { ts: isoAgo(2), event: 'task-start', phase: 1727 },
  ])

  const stale = staleArms(worktree, phasesDir)
  assert.deepEqual(stale, [], 'a live session-bound arm with no terminal signal is NOT stale')
})

test('11b) staleArms — NOT stale: a backlog phase with a JSON arm and NO beacon at all', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  armExecutor(worktree, 1727, 'sess-abc')
  writePhaseFile(phasesDir, 1727, 'backlog')

  assert.deepEqual(staleArms(worktree, phasesDir), [], 'no terminal beacon + non-terminal status ⇒ not stale')
})

test('12) staleArms — mixed estate returns the EXACT stale set, each reason naming its class', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')

  // 1720: done phase → stale (class a)
  armExecutor(worktree, 1720, 'sess-1')
  writePhaseFile(phasesDir, 1720, 'done')

  // 1721: terminal beacon → stale (class b)
  armExecutor(worktree, 1721, 'sess-2')
  writePhaseFile(phasesDir, 1721, 'in-progress')
  writeBeacon(worktree, 1721, [{ ts: isoAgo(2), event: 'phase-complete', phase: 1721 }])

  // 1722: phase-number fossil arm → stale (class c: unbound)
  writeRawArm(worktree, 1722, '1722')
  writePhaseFile(phasesDir, 1722, 'in-progress')

  // 1723: live JSON arm, in-progress, non-terminal beacon → NOT stale
  armExecutor(worktree, 1723, 'sess-4')
  writePhaseFile(phasesDir, 1723, 'in-progress')
  writeBeacon(worktree, 1723, [{ ts: isoAgo(1), event: 'task-start', phase: 1723 }])

  const stale = staleArms(worktree, phasesDir)
  const byPhase = new Map(stale.map((s) => [s.phase, s]))

  assert.deepEqual([...byPhase.keys()].sort((a, b) => a - b), [1720, 1721, 1722], 'exactly the three leaked arms')
  assert.match(byPhase.get(1720).reason, /done|phase.?complete|status/i, 'class a reason')
  assert.match(byPhase.get(1721).reason, /beacon|phase.?complete|terminal|complete/i, 'class b reason')
  assert.match(byPhase.get(1722).reason, /unbound|fossil|format|json|session/i, 'class c reason')
  assert.equal(byPhase.has(1723), false, 'the live in-progress arm is never flagged')

  for (const s of stale) {
    assert.equal(s.file, armPath(worktree, s.phase), `each entry names its own arm-file path (phase ${s.phase})`)
  }
})

test('13) staleArms — an empty .building (no arms) returns []', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  mkdirSync(join(worktree, '.building'), { recursive: true })
  assert.deepEqual(staleArms(worktree, phasesDir), [], 'no arm files ⇒ no stale entries')
})

// ── 2375.4 — EXECUTOR-SCOPED exclusivity (D5). The 2026-08-17 incident: two phase-executors were
// spawned by the SAME session onto the same phase, so the session-bound arm could not tell them
// apart and the disarm-then-rearm that handed a live phase to the second one looked entirely
// legitimate. Both executors then shared one working tree and one branch. The unit of exclusivity
// has to identify the EXECUTOR, and the disarm has to stop being silent.
//
// Age is deliberately NOT part of any rule below: age is exactly what lied in the incident (93
// minutes of silence was what a healthy cross-repo executor looked like).

test('14) disarmExecutor — a beacon whose last event is WORK refuses, and leaves the arm in place', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-abc')
  writeBeacon(worktree, 2333, [
    { ts: isoAgo(120), event: 'executor-start', phase: 2333 },
    { ts: isoAgo(93), event: 'task-start', phase: 2333, detail: '2333.4 dual-lane parity proof, then the deletion' },
  ])
  assert.throws(() => disarmExecutor(worktree, 2333), /task-start/, 'the refusal must name the beacon event so the caller can judge')
  assert.ok(existsSync(armPath(worktree, 2333)), 'a REFUSED disarm must not remove the arm it refused to clear')
})

test('14b) disarmExecutor — the refusal points at force and reports the beacon AGE as evidence', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-abc')
  writeBeacon(worktree, 2333, [{ ts: isoAgo(93), event: 'task-start', phase: 2333 }])
  let err = null
  try {
    disarmExecutor(worktree, 2333)
  } catch (e) {
    err = e
  }
  assert.ok(err, 'refusal expected')
  assert.match(err.message, /force/, 'the message must name the deliberate override')
  assert.match(err.message, /93/, 'the age is EVIDENCE for the human, never a rule input')
})

test('15) disarmExecutor — force clears the same live arm (the deliberate override)', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-abc')
  writeBeacon(worktree, 2333, [{ ts: isoAgo(93), event: 'task-start', phase: 2333 }])
  assert.doesNotThrow(() => disarmExecutor(worktree, 2333, { force: true }))
  assert.equal(existsSync(armPath(worktree, 2333)), false, 'forced disarm removes the arm')
})

test('16) disarmExecutor — phase-complete and result-returned both disarm with NO flag', () => {
  for (const event of ['phase-complete', 'result-returned', 'executor-done']) {
    const worktree = newTmp()
    armExecutor(worktree, 1727, 'sess-abc')
    writeBeacon(worktree, 1727, [
      { ts: isoAgo(30), event: 'task-start', phase: 1727 },
      { ts: isoAgo(2), event, phase: 1727 },
    ])
    assert.doesNotThrow(() => disarmExecutor(worktree, 1727), `${event} means this executor handed something back`)
    assert.equal(existsSync(armPath(worktree, 1727)), false, `${event} disarms silently`)
  }
})

test('17) disarmExecutor — NO beacon at all still disarms: no evidence is not proof', () => {
  // The engine's own unknown-is-not-proof idiom, and what keeps case 6 green.
  const worktree = newTmp()
  armExecutor(worktree, 1727, 'sess-abc')
  assert.doesNotThrow(() => disarmExecutor(worktree, 1727))
  assert.equal(existsSync(armPath(worktree, 1727)), false)
})

test('17b) disarmExecutor — a live beacon but NO arm file is still a silent no-op', () => {
  const worktree = newTmp()
  writeBeacon(worktree, 1727, [{ ts: isoAgo(5), event: 'task-start', phase: 1727 }])
  assert.doesNotThrow(() => disarmExecutor(worktree, 1727), 'there is no arm to protect, so there is nothing to refuse')
})

test('18) armExecutor — records the executorId alongside the session, and omits it when absent', () => {
  const worktree = newTmp()
  const withId = JSON.parse(readFileSync(armExecutor(worktree, 1727, 'sess-abc', { executorId: 'exec-1' }), 'utf8'))
  assert.equal(withId.sessionId, 'sess-abc')
  assert.equal(withId.executorId, 'exec-1')
  assert.ok(!Number.isNaN(Date.parse(withId.armedAt)))

  const worktree2 = newTmp()
  const withoutId = JSON.parse(readFileSync(armExecutor(worktree2, 1727, 'sess-abc'), 'utf8'))
  assert.equal('executorId' in withoutId, false, 'absent means absent — never an explicit null a reader must special-case')
  assert.equal(withoutId.sessionId, 'sess-abc')
})

test('19) armExecutor — arming over an arm naming a DIFFERENT executorId refuses, naming BOTH ids', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-first' })
  let err = null
  try {
    armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-second' })
  } catch (e) {
    err = e
  }
  assert.ok(err, 'the SAME session spawning a second executor is exactly the incident — it must refuse')
  assert.match(err.message, /exec-first/, 'names the incumbent')
  assert.match(err.message, /exec-second/, 'names the challenger')
  assert.match(err.message, /force/, 'names the deliberate override')
  assert.equal(JSON.parse(readFileSync(armPath(worktree, 2333), 'utf8')).executorId, 'exec-first', 'the incumbent arm is untouched')
})

test('19b) armExecutor — re-arming with the SAME executorId is fine (the legitimate resume path)', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-first' })
  assert.doesNotThrow(() => armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-first' }))
  assert.equal(JSON.parse(readFileSync(armPath(worktree, 2333), 'utf8')).executorId, 'exec-first')
})

test('19c) armExecutor — an INCOMING arm with no executorId over an identified arm also refuses', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-first' })
  assert.throws(() => armExecutor(worktree, 2333, 'sess-shared'), /exec-first/, 'an anonymous challenger cannot prove it is the incumbent')
})

test('19d) armExecutor — force wins over a conflicting arm', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-first' })
  assert.doesNotThrow(() => armExecutor(worktree, 2333, 'sess-shared', { executorId: 'exec-second', force: true }))
  assert.equal(JSON.parse(readFileSync(armPath(worktree, 2333), 'utf8')).executorId, 'exec-second')
})

test('20) armExecutor — a LEGACY arm carrying no executorId never refuses (nothing on disk breaks)', () => {
  const worktree = newTmp()
  armExecutor(worktree, 2333, 'sess-old') // the shape written before this change
  assert.doesNotThrow(() => armExecutor(worktree, 2333, 'sess-new', { executorId: 'exec-second' }))
  assert.equal(JSON.parse(readFileSync(armPath(worktree, 2333), 'utf8')).executorId, 'exec-second')

  // ...and neither does the raw prose format the guard still honors.
  const worktree2 = newTmp()
  writeRawArm(worktree2, 2333, 'ed737add-1b2c-4d5e-8f90-a1b2c3d4e5f6')
  assert.doesNotThrow(() => armExecutor(worktree2, 2333, 'sess-new', { executorId: 'exec-second' }))
})

test('21) armExecutor — the unbound-session throw is UNCHANGED by the opts widening', () => {
  const worktree = newTmp()
  assert.throws(() => armExecutor(worktree, 1727, undefined, { executorId: 'exec-1' }), /session/i)
  assert.throws(() => armExecutor(worktree, 1727, '', { executorId: 'exec-1' }), /session/i)
  assert.throws(() => armExecutor(worktree, 1727, '   ', { executorId: 'exec-1' }), /session/i)
  assert.equal(existsSync(armPath(worktree, 1727)), false, 'still nothing written')
})

test('22) THE REAL INCIDENT SHAPE — the 2026-08-17 arm + beacon bodies verbatim: the disarm REFUSES', () => {
  // Reproduced from the two files read at plan time:
  //   .building/2333-executor.armed  {"sessionId":"ea584379-...","armedAt":"2026-08-17T08:52:04.486Z"}
  //   .building/2333-executor.jsonl  last line event "task-start", detail "2333.4 ..."
  // One session id for what became two executors, and a WORK event as the last word. Under the
  // rule above the disarm that handed the phase to the second executor would not have happened.
  const worktree = newTmp()
  writeRawArm(worktree, 2333, JSON.stringify({ sessionId: 'ea584379-4810-40b6-bb67-20906c8bf6d3', armedAt: isoAgo(120) }) + '\n')
  writeBeacon(worktree, 2333, [
    { ts: isoAgo(120), event: 'executor-start', phase: 2333 },
    { ts: isoAgo(93), event: 'task-start', phase: 2333, detail: '2333.4 dual-lane parity proof, then the deletion' },
  ])
  assert.throws(() => disarmExecutor(worktree, 2333), /task-start/)
  assert.ok(existsSync(armPath(worktree, 2333)), 'the live arm survives — no second executor gets armed onto this phase')

  // And the sweep lane is unaffected: staleArms never judged this arm stale in the first place,
  // so the guard is not duplicating a judgement the sweep already makes.
  const phasesDir = join(newTmp(), 'phases')
  writePhaseFile(phasesDir, 2333, 'in-progress')
  assert.deepEqual(staleArms(worktree, phasesDir), [], 'a live arm was never in the stale set')
})

// ── liveArm — the CHECK door: what a NEW executor may not be spawned over ────────────────
test('23) liveArm — an arm naming an executor is live even with no beacon at all', () => {
  const worktree = newTmp()
  assert.equal(liveArm(worktree, 1727), null, 'no arm file ⇒ the phase is free')
  armExecutor(worktree, 1727, 'sess-1', { executorId: 'exec-1' })
  assert.deepEqual(liveArm(worktree, 1727), { executorId: 'exec-1', beaconEvent: null },
    'a named executor needs no beacon to prove it owns the phase')
})

test('24) liveArm — an arm with NO executorId is live while its beacon reads work in flight', () => {
  // The 2026-08-17 body shape exactly: --executor-id is optional, so a --session-only arm exists
  // in the wild. armExecutor OVERWRITES it (nothing on disk breaks), but nothing may SPAWN over it.
  const worktree = newTmp()
  writeRawArm(worktree, 2333, JSON.stringify({ sessionId: 'ea584379-4810-40b6-bb67-20906c8bf6d3', armedAt: isoAgo(120) }) + '\n')
  writeBeacon(worktree, 2333, [{ ts: isoAgo(93), event: 'task-start', phase: 2333 }])
  assert.deepEqual(liveArm(worktree, 2333), { executorId: null, beaconEvent: 'task-start' })
})

test('25) liveArm — a beacon-quiet arm with no executorId is a FOSSIL, not a live arm', () => {
  // Deliberate leniency, and the only one: judging fossils belongs to staleArms, which applies
  // its own definition. Blocking on any-arm-at-all would strand every legacy file on disk.
  const worktree = newTmp()
  writeRawArm(worktree, 1727, JSON.stringify({ sessionId: 'sess-old', armedAt: isoAgo(4000) }) + '\n')
  assert.equal(liveArm(worktree, 1727), null, 'no beacon, no name ⇒ no evidence of an owner')

  // A terminal beacon says the executor handed back — same allow-set the disarm door uses.
  writeBeacon(worktree, 1727, [{ ts: isoAgo(5), event: 'phase-complete', phase: 1727 }])
  assert.equal(liveArm(worktree, 1727), null, 'phase-complete is not work in flight')
  writeBeacon(worktree, 1727, [{ ts: isoAgo(5), event: 'result-returned', phase: 1727 }])
  assert.equal(liveArm(worktree, 1727), null, 'neither is result-returned')
  writeBeacon(worktree, 1727, [{ ts: isoAgo(5), event: 'commit', phase: 1727 }])
  assert.deepEqual(liveArm(worktree, 1727), { executorId: null, beaconEvent: 'commit' },
    'anything outside that allow-set IS work in flight')
})
