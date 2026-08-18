#!/usr/bin/env node
/**
 * heartbeat-stamp.test.mjs — the THROTTLED PostToolUse heartbeat (2384.5). Beacons are otherwise
 * emitted only at task and gate-stage boundaries, so one long task is beacon-silent for hours and
 * indistinguishable, by the primary signal, from a dead executor (the 2026-08-18 incident: 2h18m
 * of silence from a fully alive executor driving a live estate, which produces no Bash calls for
 * the existing commit-stamp hook to ride).
 *
 * The decision function is exported and driven hermetically over a fake .building estate; the hook
 * binary itself is driven end-to-end through stdin for the throttle and the never-brick contract.
 * Run: capbuild node --test hooks/heartbeat-stamp.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, 'heartbeat-stamp.mjs')
const { HEARTBEAT_MIN_MIN, armDirs, heartbeatsDue } = await import(HOOK)

const tmps = []
function newTmp() {
  const d = mkdtempSync(join(tmpdir(), 'zr-heartbeat-'))
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

const isoAgo = (min) => new Date(Date.now() - min * 60_000).toISOString()

/** A worktree with a .building estate: an arm bound to `session`, and a beacon last event. */
function makeEstate({ phase = 2384, session = 's1', armBody = null, beaconEvents = null, isMain = false } = {}) {
  const root = newTmp()
  mkdirSync(join(root, '.building'), { recursive: true })
  if (armBody !== null) writeFileSync(join(root, '.building', `${phase}-executor.armed`), armBody)
  else if (session) writeFileSync(join(root, '.building', `${phase}-executor.armed`), JSON.stringify({ sessionId: session, executorId: 'exec-1' }))
  if (beaconEvents) {
    writeFileSync(
      join(root, '.building', `${phase}-executor.jsonl`),
      beaconEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
    )
  }
  if (isMain) mkdirSync(join(root, '.git'), { recursive: true })
  return root
}

const beaconLines = (root, phase) =>
  readFileSync(join(root, '.building', `${phase}-executor.jsonl`), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('1) DUE: an arm for this session whose beacon went quiet past the throttle window', () => {
  const root = makeEstate({ beaconEvents: [{ ts: isoAgo(140), phase: 2384, event: 'task-start' }] })
  const due = heartbeatsDue([root], 's1')
  assert.deepEqual(due, [{ worktree: root, phase: 2384 }])
})

test('2) FRESH: a beacon inside the window is not stamped — the throttle IS the design', () => {
  const root = makeEstate({ beaconEvents: [{ ts: isoAgo(HEARTBEAT_MIN_MIN - 1), phase: 2384, event: 'task-start' }] })
  assert.deepEqual(heartbeatsDue([root], 's1'), [], 'at most one heartbeat per phase per window')
})

test('3) FOREIGN SESSION: another session\'s arm is never touched', () => {
  const root = makeEstate({ session: 'other-session', beaconEvents: [{ ts: isoAgo(140), phase: 2384, event: 'task-start' }] })
  assert.deepEqual(heartbeatsDue([root], 's1'), [], 'the 2026-07-17 cross-session class stays closed')
})

test('4) UNBOUND arm (bare/legacy body, no session) is never touched either', () => {
  const root = makeEstate({ armBody: '', beaconEvents: [{ ts: isoAgo(140), phase: 2384, event: 'task-start' }] })
  assert.deepEqual(heartbeatsDue([root], 's1'), [])
})

test('5) TERMINAL last event → never stamped: a heartbeat would resurrect a finished executor', () => {
  // heartbeat is not in executor-arm's DISARM_ALLOWED, so stamping one after phase-complete would
  // make disarm refuse forever — an arm nobody can clear.
  for (const event of ['phase-complete', 'result-returned']) {
    const root = makeEstate({ beaconEvents: [{ ts: isoAgo(140), phase: 2384, event }] })
    assert.deepEqual(heartbeatsDue([root], 's1'), [], `${event} means it handed something back`)
  }
})

test('6) NO BEACON at all → not stamped (the pre-beacon window belongs to executor-start)', () => {
  const root = makeEstate({ beaconEvents: null })
  assert.deepEqual(heartbeatsDue([root], 's1'), [])
})

test('7) UNREADABLE estate → silent empty, never a throw', () => {
  assert.deepEqual(heartbeatsDue([join(newTmp(), 'does-not-exist')], 's1'), [])
  assert.deepEqual(heartbeatsDue([], 's1'), [])
  assert.deepEqual(heartbeatsDue([newTmp()], null), [], 'no session id ⇒ nothing is attributable')
})

test('8) armDirs finds a LINKED WORKTREE from the main checkout, with no git spawn', () => {
  // The phase lane runs in a worktree while the SESSION cwd stays the main checkout, so the arm
  // lives somewhere the cwd toplevel alone can never see. .git/worktrees/<name>/gitdir names it.
  const main = makeEstate({ isMain: true, phase: 9999 })
  const linked = makeEstate({ phase: 2384 })
  mkdirSync(join(main, '.git', 'worktrees', 'wt-6'), { recursive: true })
  writeFileSync(join(main, '.git', 'worktrees', 'wt-6', 'gitdir'), `${join(linked, '.git')}\n`)
  const dirs = armDirs(main)
  assert.ok(dirs.includes(main), 'the cwd toplevel is always first')
  assert.ok(dirs.includes(linked), `the linked worktree must be discovered: ${JSON.stringify(dirs)}`)
})

test('9) armDirs on a LINKED worktree (.git is a file) yields just itself', () => {
  const root = makeEstate()
  writeFileSync(join(root, '.git'), 'gitdir: /somewhere/main/.git/worktrees/wt-6\n')
  assert.deepEqual(armDirs(root), [root])
})

// ── the hook binary end-to-end ────────────────────────────────────────────────────────────
function runHook(cwd, payload) {
  const r = spawnSync('node', [HOOK], { cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000 })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

test('10) END TO END: a due phase gets exactly ONE heartbeat, and the next call adds none', () => {
  const root = makeEstate({ beaconEvents: [{ ts: isoAgo(140), phase: 2384, event: 'task-start' }] })
  const payload = { session_id: 's1', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Read' }
  const first = runHook(root, payload)
  assert.equal(first.code, 0)
  const after = beaconLines(root, 2384)
  assert.equal(after.length, 2, 'one heartbeat appended')
  assert.equal(after[1].event, 'heartbeat')
  assert.equal(after[1].phase, 2384)

  // Immediately again: the beacon is now fresh, so the throttle refuses.
  assert.equal(runHook(root, payload).code, 0)
  assert.equal(beaconLines(root, 2384).length, 2, 'at most one per window, whatever the tool traffic')
})

test('11) END TO END: garbage stdin, no stdin, and a non-repo cwd all exit 0 and write nothing', () => {
  const root = makeEstate({ beaconEvents: [{ ts: isoAgo(140), phase: 2384, event: 'task-start' }] })
  const bad = spawnSync('node', [HOOK], { cwd: root, input: 'not json at all', encoding: 'utf8', timeout: 60_000 })
  assert.equal(bad.status, 0, 'a hook must never brick a tool call')
  const empty = spawnSync('node', [HOOK], { cwd: root, input: '', encoding: 'utf8', timeout: 60_000 })
  assert.equal(empty.status, 0)
  assert.equal(beaconLines(root, 2384).length, 1, 'nothing was written on either error path')
  assert.ok(existsSync(join(root, '.building', '2384-executor.armed')))
})
