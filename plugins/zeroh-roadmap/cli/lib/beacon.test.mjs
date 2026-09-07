#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/beacon.mjs (module does NOT exist yet — RED on import
 * until implemented). The executor-heartbeat JSONL reader/writer shared by
 * arc-status + executor-liveness, generalized to the dual-dir (main .building
 * PLUS the worktree .building) freshest-wins contract. Hermetic-tmp-estate from
 * scripts/executor-liveness.test.mjs. Run: node --test cli/lib/beacon.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'beacon.mjs')
const {
  beaconPath,
  lastEvent,
  appendEvent,
  ALIVE_MAX_MIN,
  GATE_QUIET_MAX_MIN,
  WORK_EVENTS,
  EXECUTOR_EVENTS,
  appendExecutorEvent,
  readBeaconLine,
  readResultTailCompletion,
} = await import(MOD)

const tmps = []
function newTmp(prefix = 'zr-beacon-') {
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

/** Write raw JSONL lines (so we can corrupt them) into an explicit .building dir. */
function writeBeaconIn(buildingDir, arcId, lines) {
  mkdirSync(buildingDir, { recursive: true })
  writeFileSync(
    join(buildingDir, `${arcId}-executor.jsonl`),
    lines.join('\n') + (lines.length ? '\n' : ''),
  )
}
/** The MAIN beacon dir is <mainRoot>/arcs/.building (mirrors beaconPath). */
function writeMainBeacon(mainRoot, arcId, lines) {
  writeBeaconIn(join(mainRoot, 'arcs', '.building'), arcId, lines)
}
/** The worktree beacon dir is <worktree>/.building (no arcs segment). */
function writeWorktreeBeacon(worktree, arcId, lines) {
  writeBeaconIn(join(worktree, '.building'), arcId, lines)
}

test('1) lastEvent — parses the LAST line and reports its age (main dir only)', () => {
  const main = newTmp()
  writeMainBeacon(main, 'A', [
    JSON.stringify({ ts: isoAgo(40), event: 'task-start' }),
    JSON.stringify({ ts: isoAgo(5), event: 'gate-stage-start' }),
  ])
  const r = lastEvent('A', { mainRoot: main })
  assert.equal(r.event, 'gate-stage-start', 'the LAST line wins')
  assert.ok(r.ageMin >= 0 && r.ageMin <= 7, `ageMin ≈ 5, got ${r.ageMin}`)
})

test('2) lastEvent — a corrupt last line degrades to null (never throws)', () => {
  const main = newTmp()
  writeMainBeacon(main, 'A', [JSON.stringify({ ts: isoAgo(5), event: 'task-start' }), 'not json{'])
  assert.equal(lastEvent('A', { mainRoot: main }), null)
})

test('3) lastEvent — empty file ⇒ null; absent file ⇒ null', () => {
  const main = newTmp()
  writeMainBeacon(main, 'EMPTY', []) // empty file exists
  assert.equal(lastEvent('EMPTY', { mainRoot: main }), null, 'empty file')
  assert.equal(lastEvent('NOPE', { mainRoot: main }), null, 'absent file')
})

test('4) lastEvent — dual-dir freshest-wins: fresh worktree beacon beats an old main beacon', () => {
  const main = newTmp()
  const worktree = newTmp()
  writeMainBeacon(main, 'A', [JSON.stringify({ ts: isoAgo(30), event: 'task-start' })])
  writeWorktreeBeacon(worktree, 'A', [JSON.stringify({ ts: isoAgo(2), event: 'gate-stage-start' })])
  const r = lastEvent('A', { mainRoot: main, worktree })
  assert.equal(r.event, 'gate-stage-start', 'the fresher worktree event wins')
  assert.ok(r.ageMin >= 0 && r.ageMin <= 5, `ageMin ≈ 2, got ${r.ageMin}`)
})

test('5) lastEvent — worktree OMITTED scans the MAIN dir ONLY (legacy beaconOf parity)', () => {
  const main = newTmp()
  const worktree = newTmp()
  writeMainBeacon(main, 'A', [JSON.stringify({ ts: isoAgo(30), event: 'task-start' })])
  writeWorktreeBeacon(worktree, 'A', [JSON.stringify({ ts: isoAgo(2), event: 'gate-stage-start' })])
  const r = lastEvent('A', { mainRoot: main }) // no worktree → ignore the fresher one
  assert.equal(r.event, 'task-start', 'without worktree the main beacon is the only source')
  assert.ok(r.ageMin >= 25 && r.ageMin <= 35, `ageMin ≈ 30, got ${r.ageMin}`)
})

test('6) appendEvent — round-trips through lastEvent (main-only)', () => {
  const main = newTmp()
  const path = appendEvent('A', 'background-run', { mainRoot: main, log: '/tmp/x.log' })
  assert.equal(path, beaconPath('A', { mainRoot: main }))
  const r = lastEvent('A', { mainRoot: main })
  assert.equal(r.event, 'background-run')
  assert.ok(r.ageMin >= 0 && r.ageMin <= 1, 'just written → ~0 min old')
})

test('6b) beaconPath — <mainRoot>/arcs/.building/<arcId>-executor.jsonl', () => {
  const main = newTmp()
  assert.equal(
    beaconPath('MKT', { mainRoot: main }),
    join(main, 'arcs', '.building', 'MKT-executor.jsonl'),
  )
})

test('7) exported constants carry the liveness thresholds + the work-event set', () => {
  assert.equal(ALIVE_MAX_MIN, 20)
  assert.equal(GATE_QUIET_MAX_MIN, 45)
  assert.ok(WORK_EVENTS instanceof Set)
  for (const e of ['gate-stage-start', 'task-start', 'background-run']) {
    assert.ok(WORK_EVENTS.has(e), `WORK_EVENTS must contain ${e}`)
  }
})

// --- phase-executor writer + closed vocabulary (NEW contract, RED until implemented) ---

/** The phase-executor beacon lives at <worktree>/.building/<phase>-executor.jsonl. */
function phaseBeaconPath(worktree, phase) {
  return join(worktree, '.building', `${phase}-executor.jsonl`)
}
function readLines(path) {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
}

test('8) EXECUTOR_EVENTS is the exact closed vocabulary', () => {
  assert.ok(EXECUTOR_EVENTS instanceof Set)
  const expected = [
    'executor-start',
    'task-start',
    'commit',
    'gate-stage-start',
    'gate-stage-end',
    'background-run',
    'escalated',
    'resume',
    'result-returned',
    'phase-complete',
    // 2384.5 — the throttled PostToolUse heartbeat, so one long task stays legible to liveness.
    // A WORK event by meaning: it says the executor is still running, never that it finished.
    'heartbeat',
  ]
  assert.equal(EXECUTOR_EVENTS.size, expected.length, 'no extra members')
  for (const e of expected) assert.ok(EXECUTOR_EVENTS.has(e), `EXECUTOR_EVENTS must contain ${e}`)
  // legacy terminal aliases are NOT in the closed set (they are read-time only)
  for (const alias of ['phase-done', 'executor-complete', 'executor-done']) {
    assert.ok(!EXECUTOR_EVENTS.has(alias), `${alias} is a legacy alias, not a writer vocab member`)
  }
})

test('9) appendExecutorEvent — round-trips; phase is a JSON number for numeric input; ts is ISO; extra rides', () => {
  const worktree = newTmp()
  const before = Date.now()
  const path = appendExecutorEvent(worktree, 1727, 'task-start', {
    detail: 'step 3',
    session_id: 'sess-abc',
  })
  assert.equal(path, phaseBeaconPath(worktree, 1727), 'returns the phase-executor path')
  const lines = readLines(path)
  assert.equal(lines.length, 1, 'exactly one line written')
  const rec = JSON.parse(lines[0])
  assert.equal(typeof rec.phase, 'number', 'phase serialized as a JSON number')
  assert.equal(rec.phase, 1727)
  assert.equal(rec.event, 'task-start')
  assert.equal(rec.detail, 'step 3', 'extra field rides through')
  assert.equal(rec.session_id, 'sess-abc', 'extra field rides through')
  const parsedTs = Date.parse(rec.ts)
  assert.ok(!Number.isNaN(parsedTs), 'ts is a valid ISO-8601 timestamp')
  assert.equal(new Date(parsedTs).toISOString(), rec.ts, 'ts is canonical ISO-8601')
  assert.ok(parsedTs >= before - 1000 && parsedTs <= Date.now() + 1000, 'ts is ~now')
})

test('10) appendExecutorEvent — a STRING phase still serializes as a JSON number', () => {
  const worktree = newTmp()
  const path = appendExecutorEvent(worktree, '1727', 'commit')
  const rec = JSON.parse(readLines(path)[0])
  assert.equal(typeof rec.phase, 'number', 'string phase coerced to a JSON number')
  assert.equal(rec.phase, 1727)
})

test('11) appendExecutorEvent — a legacy alias (phase-done) is OUT of the closed set ⇒ throws, writes nothing', () => {
  const worktree = newTmp()
  const path = phaseBeaconPath(worktree, 1727)
  assert.throws(() => appendExecutorEvent(worktree, 1727, 'phase-done'), /phase-done|EXECUTOR_EVENTS|closed/i)
  assert.equal(existsSync(path), false, 'nothing written on a rejected event')
})

test('12) appendExecutorEvent — a bogus event ⇒ throws, writes nothing', () => {
  const worktree = newTmp()
  const path = phaseBeaconPath(worktree, 1727)
  assert.throws(() => appendExecutorEvent(worktree, 1727, 'not-a-real-event'), /not-a-real-event|EXECUTOR_EVENTS|closed/i)
  assert.equal(existsSync(path), false, 'nothing written on a rejected event')
})

test('13) appendExecutorEvent — appends (never truncates) on a second call', () => {
  const worktree = newTmp()
  const p1 = appendExecutorEvent(worktree, 1727, 'executor-start')
  const p2 = appendExecutorEvent(worktree, 1727, 'phase-complete')
  assert.equal(p1, p2, 'same path both calls')
  const lines = readLines(p1)
  assert.equal(lines.length, 2, 'both lines present')
  assert.equal(JSON.parse(lines[0]).event, 'executor-start')
  assert.equal(JSON.parse(lines[1]).event, 'phase-complete')
})

test('14) readBeaconLine — legacy terminal aliases normalize to phase-complete', () => {
  for (const alias of ['phase-done', 'executor-complete', 'executor-done']) {
    const worktree = newTmp()
    const dir = join(worktree, '.building')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, '1727-executor.jsonl')
    writeFileSync(p, JSON.stringify({ ts: isoAgo(1), event: alias, phase: 1727 }) + '\n')
    const r = readBeaconLine(p)
    assert.equal(r.event, 'phase-complete', `${alias} must normalize to phase-complete`)
  }
})

test('15) readBeaconLine — a non-terminal event (task-start) passes through unchanged', () => {
  const worktree = newTmp()
  const dir = join(worktree, '.building')
  mkdirSync(dir, { recursive: true })
  const p = join(dir, '1727-executor.jsonl')
  writeFileSync(p, JSON.stringify({ ts: isoAgo(1), event: 'task-start', phase: 1727 }) + '\n')
  assert.equal(readBeaconLine(p).event, 'task-start', 'non-terminal events are not rewritten')
})

test('16) WORK_EVENTS is UNCHANGED — exactly the three liveness events', () => {
  assert.equal(WORK_EVENTS.size, 3, 'no members added/removed')
  for (const e of ['gate-stage-start', 'task-start', 'background-run']) {
    assert.ok(WORK_EVENTS.has(e), `WORK_EVENTS must still contain ${e}`)
  }
  assert.ok(!WORK_EVENTS.has('phase-complete'), 'phase-complete is not a liveness/work event')
})

test('17) readResultTailCompletion — later heartbeat does not erase exact completion proof', () => {
  const worktree = newTmp()
  appendExecutorEvent(worktree, 1727, 'phase-complete', {
    resultTailComplete: true,
    checkpointDigest: 'sha256:checkpoint-one',
    resultDigest: 'sha256:result-one',
  })
  appendExecutorEvent(worktree, 1727, 'heartbeat', { detail: 'later observation' })
  const completion = readResultTailCompletion(worktree, 1727, {
    checkpointDigest: 'sha256:checkpoint-one',
    resultDigest: 'sha256:result-one',
  })
  assert.equal(completion.event, 'phase-complete')
  assert.equal(completion.resultTailComplete, true)
  assert.equal(completion.phase, 1727)
})

test('18) readResultTailCompletion — wrong binding or incomplete marker returns null', () => {
  const worktree = newTmp()
  appendExecutorEvent(worktree, 1727, 'phase-complete', {
    resultTailComplete: true,
    checkpointDigest: 'sha256:checkpoint-one',
    resultDigest: 'sha256:result-one',
  })
  appendExecutorEvent(worktree, 1727, 'phase-complete', {
    checkpointDigest: 'sha256:checkpoint-two',
    resultDigest: 'sha256:result-two',
  })
  assert.equal(readResultTailCompletion(worktree, 1727, {
    checkpointDigest: 'sha256:checkpoint-one',
    resultDigest: 'sha256:different',
  }), null)
  assert.equal(readResultTailCompletion(worktree, 1727, {
    checkpointDigest: 'sha256:checkpoint-two',
    resultDigest: 'sha256:result-two',
  }), null)
})

test('19) readResultTailCompletion — unreadable or phase-ambiguous beacon fails closed', () => {
  const worktree = newTmp()
  const path = phaseBeaconPath(worktree, 1727)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, [
    JSON.stringify({
      ts: isoAgo(2), event: 'phase-complete', phase: 9999, resultTailComplete: true,
      checkpointDigest: 'sha256:checkpoint-one', resultDigest: 'sha256:result-one',
    }),
    '{ unreadable latest line',
  ].join('\n') + '\n')
  assert.equal(readResultTailCompletion(worktree, 1727, {
    checkpointDigest: 'sha256:checkpoint-one',
    resultDigest: 'sha256:result-one',
  }), null)
})
