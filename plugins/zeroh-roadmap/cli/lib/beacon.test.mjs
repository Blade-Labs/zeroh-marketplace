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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'beacon.mjs')
const { beaconPath, lastEvent, appendEvent, ALIVE_MAX_MIN, GATE_QUIET_MAX_MIN, WORK_EVENTS } =
  await import(MOD)

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
