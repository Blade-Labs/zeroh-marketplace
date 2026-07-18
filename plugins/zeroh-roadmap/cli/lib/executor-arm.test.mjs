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
const { armExecutor, disarmExecutor, staleArms } = await import(MOD)

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

test('10) staleArms (c) — a BARE/legacy arm body (not JSON with sessionId) is STALE by definition', () => {
  const worktree = newTmp()
  const phasesDir = join(newTmp(), 'phases')
  writeRawArm(worktree, 1727, 'sess-abc') // pre-session-binding raw-string body
  writePhaseFile(phasesDir, 1727, 'in-progress') // otherwise-live phase, no terminal beacon

  const stale = staleArms(worktree, phasesDir)
  assert.equal(stale.length, 1, 'a bare-format arm is stale regardless of phase state')
  assert.equal(stale[0].phase, 1727)
  assert.match(stale[0].reason, /bare|legacy|format|json|session/i, `reason names the bare-format class; got ${stale[0].reason}`)
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

  // 1722: bare-format arm → stale (class c)
  writeRawArm(worktree, 1722, 'sess-3')
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
  assert.match(byPhase.get(1722).reason, /bare|legacy|format|json|session/i, 'class c reason')
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
