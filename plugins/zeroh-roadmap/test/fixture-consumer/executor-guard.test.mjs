#!/usr/bin/env node
/**
 * executor-guard.test.mjs — the Stop/SubagentStop executor-result-guard driven over fixture
 * consumers on every allow / block / warn branch (arc ROADCODE 1660.5). Risk 2 (false blocks)
 * says the guard must be proven on every branch BEFORE any real arc runs under it: a hook that
 * blocks a legitimate beacon'd yield fights long-run survival; one that fails closed on a
 * non-roadmap agent bricks unrelated sessions. Titles carry H1-H8. Invocation mirrors
 * hooks.json exactly: `node hooks/executor-result-guard.mjs` with a synthetic payload on stdin
 * (pre-made decision 5). Run: node --test test/fixture-consumer/executor-guard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, writePhaseFile, PLUGIN_ROOT } from './harness.mjs'

const GUARD = join(PLUGIN_ROOT, 'hooks', 'executor-result-guard.mjs')
/** The VERBATIM block reason (the two-exit turn contract, phase 1753), string-pinned here (NOT imported). */
const REASON = (n, id) =>
  `phase ${n} is open (next task ${id}); a turn may end only on a running tool call or the typed PhaseExecutionResult — done, escalated, failed, or checkpoint (committed + watch + resume)`

/** Mirror the hooks.json registration: spawn the guard with the payload on stdin. spawnSync
 *  captures BOTH streams (the Stop warn writes to stderr on an exit-0 allow). */
function runGuard(root, payload, env = {}) {
  const r = spawnSync('node', [GUARD], {
    cwd: root, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json'), ...env },
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
/** A fixture consumer + a phase file + the .building dir. */
function guardRepo({ phase = 9500, status = 'in-progress', tasksDone = [true, false], executionResult = false, arcMode = false } = {}) {
  const root = makeFixtureRepo()
  mkdirSync(join(root, '.building'), { recursive: true })
  const tasks = tasksDone.map((d, i) => ({ id: `${phase}.${i + 1}`, done: d }))
  const obj = { phase, status, arcId: 'FX', tasks, ...(executionResult ? { executionResult: { phase, status: 'done', gateRounds: 1, hardStops: [] } } : {}) }
  writePhaseFile(root, obj)
  if (arcMode) writeFileSync(join(root, 'roadmap', '.arc-mode'), '')
  return root
}
function transcript(root, finalText) {
  const p = join(root, 'transcript.jsonl')
  writeFileSync(p, [
    // The spawn prompt names the phase FILE — the contract both spawn lanes satisfy, and what the
    // arm-file/beacon channels match the stopping agent on since 2384.4 (before that, any arm in
    // the session armed any agent, which woke one executor with another's arm).
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'do phase 9500 — roadmap/phases/phase-9500.phase.ts' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalText }] } }),
  ].join('\n') + '\n')
  return p
}
function beacon(root, phase, event) { writeFileSync(join(root, '.building', `${phase}-executor.jsonl`), JSON.stringify(event) + '\n') }
const validResult = { phase: 9500, status: 'done', gateRounds: 1, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] }
const fence = (obj) => 'Here is my result:\n```json\n' + JSON.stringify(obj, null, 2) + '\n```\n'

// ── H1 — armed prose ending → BLOCK naming phase + next task + the three turn-ends ───────
test('H1 — an armed executor ending in bare prose → block with the exact §3 reason', () => {
  const root = guardRepo()
  const t = transcript(root, 'Committed 9500.1, prepping 9500.2. Standing by.')
  const r = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(r.code, 0)
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block')
  assert.equal(decision.reason, REASON(9500, '9500.2'), 'the reason is the verbatim §3 contract')
  assert.match(decision.reason, /phase 9500 is open/)
  assert.match(decision.reason, /next task 9500\.2/)
  for (const end of ['running tool call', 'typed PhaseExecutionResult', 'checkpoint'])
    assert.ok(decision.reason.includes(end), `names the sanctioned turn end: ${end}`)
  assert.ok(!decision.reason.includes('background-run'), 'the deleted background-run park is NOT offered')
})

// ── H2 — a valid typed result → ALLOW + a result-returned beacon ─────────────────────────
test('H2 — a final message carrying a valid typed PhaseExecutionResult → allow + result-returned beacon', () => {
  const root = guardRepo()
  const t = transcript(root, fence(validResult))
  const r = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(r.stdout.trim(), '', `no block; got: ${r.stdout}`)
  const b = readFileSync(join(root, '.building', '9500-executor.jsonl'), 'utf8')
  assert.match(b, /"event":"result-returned"/, 'the result-returned beacon event is stamped')
})

// ── H3 — already done with executionResult persisted → ALLOW ─────────────────────────────
test('H3 — phase already done with executionResult persisted, prose ending → allow', () => {
  const root = guardRepo({ status: 'done', tasksDone: [true, true], executionResult: true })
  const t = transcript(root, 'All done here.')
  const r = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(r.stdout.trim(), '', 'a durable persisted result allows a prose ending')
})

// ── H4 — a background-run beacon NO LONGER licenses a bare park; a typed checkpoint does ──
test('H4 — a background-run beacon (fresh or stale) with a prose ending → BLOCK; the honest yield is a typed checkpoint', () => {
  // The background-run license (path 3) is DELETED (phase 1753): a beacon can never license a
  // bare-prose park, because the wake it promised was reaper-bait with no owner.
  const fresh = guardRepo()
  beacon(fresh, 9500, { ts: new Date().toISOString(), phase: 9500, event: 'background-run', log: '.test-logs/run.tap' })
  const r1 = runGuard(fresh, { session_id: 's1', transcript_path: transcript(fresh, 'Backgrounded the suite; standing by.'), hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(JSON.parse(r1.stdout).decision, 'block', 'a fresh background-run beacon no longer licenses a prose park')

  const stale = guardRepo()
  beacon(stale, 9500, { ts: new Date(Date.now() - 20 * 60000).toISOString(), phase: 9500, event: 'background-run', log: '.test-logs/run.tap' })
  const r2 = runGuard(stale, { session_id: 's1', transcript_path: transcript(stale, 'Still waiting on the run.'), hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(JSON.parse(r2.stdout).decision, 'block', 'a stale beacon blocks too — the license is gone, not merely narrowed')

  // The honest unbounded-work hand-off: a typed checkpoint result (committed + reason + resume)
  // passes result-check (license path 1), so it licenses the turn end.
  const cp = guardRepo()
  const checkpoint = { phase: 9500, status: 'checkpoint', checkpoint: { committedSha: 'abc1234', reason: 'unbounded ingest running detached', resume: 'read the log tail, then continue task 9500.2' }, gateRounds: 0, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] }
  const r3 = runGuard(cp, { session_id: 's1', transcript_path: transcript(cp, fence(checkpoint)), hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(r3.stdout.trim(), '', `a typed checkpoint result is the licensed yield; got: ${r3.stdout}`)
})

// ── H5 — fail-open for the unarmed agent AND the broken-config path ──────────────────────
test('H5 — fail-open: an unarmed agent AND a broken-config path both stay untouched (exit 0, no block)', () => {
  const root = guardRepo()
  const t = transcript(root, 'Standing by, prose ending.')
  // (a) no arm channel at all
  const unarmed = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' })
  assert.equal(unarmed.code, 0)
  assert.equal(unarmed.stdout.trim(), '', 'unarmed → untouched')
  // (b) config load failure (ROADMAP_CONFIG → nonexistent) even WITH arming env → still fail-open
  const broken = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_CONFIG: join(root, 'roadmap', 'does-not-exist.json'), ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(broken.code, 0)
  assert.equal(broken.stdout.trim(), '', 'a config load failure fail-opens — the hook never bricks an unrelated agent')
})

// ── H6 — Stop + .arc-mode → WARN, never block (names `roadmap arc next`) ─────────────────
test('H6 — a main-session Stop with roadmap/.arc-mode + a member in-progress → WARN, never block', () => {
  const root = guardRepo({ arcMode: true })
  writeFileSync(join(root, '.building', 'FX-executor.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'task-start' }) + '\n')
  const t = transcript(root, 'Interrupting my own session.')
  const r = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'Stop' }, { ROADMAP_EXECUTOR_PHASE: '9500' })
  assert.equal(r.stdout.trim(), '', 'a Stop with .arc-mode must NOT block')
  assert.match(r.stderr, /roadmap arc next/, 'the warning names the re-entry')
})

// ── H7/H8 — the arm-FILE channel: armed-by-file blocks; file removed fail-opens ──────────
test('H7 — the arm-FILE channel (.building/<N>-executor.armed) blocks a prose ending with NO env', () => {
  const root = guardRepo()
  writeFileSync(join(root, '.building', '9500-executor.armed'), 's1') // session-bound to the payload session
  const t = transcript(root, 'Prose ending, no result.')
  const r = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }) // NO env
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'file arming ≡ env arming')
  assert.equal(JSON.parse(r.stdout).reason, REASON(9500, '9500.2'))
})

test('H8 — the arm file removed after the result-check (disarm) → fail-open (exit 0, untouched)', () => {
  const root = guardRepo()
  // No arm file present (the disarm removed it), no env → a disarmed lane never blocks a later turn.
  assert.ok(!existsSync(join(root, '.building', '9500-executor.armed')))
  const t = transcript(root, 'A later prose turn after disarm.')
  const r = runGuard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'a disarmed lane fail-opens')
})
