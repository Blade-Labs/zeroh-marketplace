#!/usr/bin/env node
/**
 * Fixtures for hooks/executor-result-guard.mjs — SYNTHETIC transcripts (tmp jsonl) + a
 * tmp worktree (git + roadmap.config.json + a re-export lib/roadmap/schema.ts + a zod
 * symlink so `roadmap result check` resolves + .building beacons). Cases: prose-ending
 * block (verbatim two-exit reason string-pin), valid/escalated/checkpoint result allow,
 * a fresh background-run beacon NO LONGER licenses (path 3 deleted), payload-free
 * checkpoint block, done+executionResult allow, unarmed + internally-erroring fail-open,
 * BOTH arm channels (env + arm file), Stop+.arc-mode warn-not-block. Run:
 * node --test hooks/executor-result-guard.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..')
const GUARD = join(HERE, 'executor-result-guard.mjs')
const SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))

// The VERBATIM two-exit block reason (post-1753 contract), string-pinned here (NOT imported).
// blockReason() teaches the two-exit turn contract: a turn may end only on a running tool
// call or the typed PhaseExecutionResult — and checkpoint (committed + watch + resume) is a
// first-class exit alongside done/escalated/failed. The stale "beacon'd background-run"
// clause is GONE (path 3 deleted).
const REASON = (n, id) =>
  `phase ${n} is open (next task ${id}); a turn may end only on a running tool call or the typed PhaseExecutionResult — done, escalated, failed, or checkpoint (committed + watch + resume)`

const CONFIG = { configVersion: 1, gateCommands: { lint: 'true', types: 'true', unit: 'true', integration: 'true', build: 'true', e2e: 'none', emit: 'true' } }

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A tmp worktree: git + config + schema re-export + zod symlink + .building + a phase file. */
function makeWorktree({ phase = 1670, phaseStatus = 'in-progress', tasksDone = [true, false], executionResult = false, arcMode = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zr-guard-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, '.building'), { recursive: true })
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify(CONFIG))
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${SCHEMA}'\n`)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(PLUGIN_ZOD, join(root, 'node_modules', 'zod'), 'dir')
  if (arcMode) writeFileSync(join(root, 'roadmap', '.arc-mode'), '')
  const tasks = tasksDone.map((d, i) => `    { id: '${phase}.${i + 1}', done: ${d} }`).join(',\n')
  const src = `export default {
  phase: ${phase},
  status: '${phaseStatus}',${executionResult ? `\n  executionResult: { phase: ${phase}, status: 'done', gateRounds: 1 },` : ''}
  tasks: [
${tasks}
  ],
}
`
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${phase}.phase.ts`), src)
  execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' })
  return root
}

function writeTranscript(root, finalAssistantText) {
  const p = join(root, 'transcript.jsonl')
  const lines = [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'do phase 1670' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalAssistantText }] } },
  ]
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

function writeBeacon(root, phase, event) {
  writeFileSync(join(root, '.building', `${phase}-executor.jsonl`), JSON.stringify(event) + '\n')
}

/** Drive the guard: stdin = payload, cwd = worktree; returns { code, stdout, stderr }.
 *  spawnSync captures BOTH streams regardless of exit code (the warn writes to stderr on
 *  an exit-0 allow, which execFileSync's success path would drop). */
function guard(root, payload, env = {}) {
  const r = spawnSync('node', [GUARD], {
    cwd: root, input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json'), ...env },
  })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const validResult = { phase: 1670, status: 'done', gateRounds: 1, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] }
const fence = (obj) => 'Here is my result:\n```json\n' + JSON.stringify(obj, null, 2) + '\n```\n'

test('prose ending → BLOCK with the verbatim §3 reason (armed via ROADMAP_EXECUTOR_PHASE)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Committed 1656.1, prepping 1656.2. Standing by.')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block')
  assert.equal(decision.reason, REASON(1670, '1670.2')) // string-equality pin
})

test('valid typed result ending → ALLOW + a result-returned beacon is appended', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, fence(validResult))
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'no block JSON')
  const beacon = readFileSync(join(root, '.building', '1670-executor.jsonl'), 'utf8')
  assert.match(beacon, /"event":"result-returned"/)
})

test('escalated-status result ending → ALLOW (an honest escalated return is valid)', () => {
  const root = makeWorktree()
  const escalated = { phase: 1670, status: 'escalated', gateRounds: 0, escalation: { question: 'which option is right here?', options: ['A', 'B'] } }
  const t = writeTranscript(root, fence(escalated))
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', `escalated must be allowed; got: ${r.stdout}`)
})

test('checkpoint-status result ending → ALLOW (the two-exit unbounded-work hand-off is a valid typed return)', () => {
  const root = makeWorktree()
  const checkpoint = {
    phase: 1670,
    status: 'checkpoint',
    checkpoint: {
      committedSha: 'abc1234',
      reason: 'unbounded ingest running detached',
      resume: 'read the log tail, then continue task 2',
    },
    gateRounds: 0,
  }
  const t = writeTranscript(root, fence(checkpoint))
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  // The worktree re-exports the LIVE templates/schema.ts (1753.2 checkpoint schema), so
  // `roadmap result check` already parses this via license path 1 — GREEN pre-implementation.
  assert.equal(r.stdout.trim(), '', `a valid checkpoint result must be allowed; got: ${r.stdout}`)
  const beacon = readFileSync(join(root, '.building', '1670-executor.jsonl'), 'utf8')
  assert.match(beacon, /"event":"result-returned"/)
})

test('payload-free {"status":"checkpoint"} (no checkpoint field) → BLOCK (the superRefine rejects it at result check)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, fence({ phase: 1670, status: 'checkpoint', gateRounds: 0 }))
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'a checkpoint with no committed hand-off is a nap in a costume — it must not license a stop')
})

test('the block reason names the two-exit contract — mentions "checkpoint", never "background-run"', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Committed 1670.1, prepping 1670.2. Standing by.')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  const reason = JSON.parse(r.stdout).reason
  assert.match(reason, /checkpoint/, 'the reason must teach the checkpoint exit')
  assert.doesNotMatch(reason, /background-run/, 'the retired background-run license must not appear in the reason')
})

test('fresh background-run beacon with a log → BLOCK (path 3 deleted: a beacon no longer licenses bare prose)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Backgrounded the full suite; Monitor armed. See log.')
  writeBeacon(root, 1670, { ts: new Date().toISOString(), phase: 1670, event: 'background-run', log: '.test-logs/run.tap' })
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block', 'a fresh background-run beacon must NOT license a bare-prose stop — return a checkpoint result instead')
  assert.equal(decision.reason, REASON(1670, '1670.2'))
})

test('fresh background-run beacon with an EPOCH-MS ts → BLOCK (freshness window gone; unbounded work returns a checkpoint)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Backgrounded the full suite; Monitor armed. See log.')
  writeBeacon(root, 1670, { ts: Date.now(), phase: 1670, event: 'background-run', log: '.test-logs/run.tap' })
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'a numeric-ts fresh background-run must also block now')
})

test('Stop WITHOUT .arc-mode (executor-band orchestrator, arm file present) → WARN not block', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Waiting on the phase-1670 executor; will act on its return.')
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1') // session-bound; the Stop event still only warns
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'Stop' }, {})
  assert.equal(r.stdout.trim(), '', 'a main-session Stop must never hard-block')
  assert.match(r.stderr, /advisory: not blocking a Stop/)
})

test('background-run beacon of ANY age → BLOCK (no freshness window survives path-3 deletion)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Still waiting on the background run.')
  const stale = new Date(Date.now() - 20 * 60000).toISOString()
  writeBeacon(root, 1670, { ts: stale, phase: 1670, event: 'background-run', log: '.test-logs/run.tap' })
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block')
})

test('phase already done WITH executionResult → ALLOW', () => {
  const root = makeWorktree({ phaseStatus: 'done', tasksDone: [true, true], executionResult: true })
  const t = writeTranscript(root, 'All done.')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', 'persisted done must be allowed')
})

test('UNARMED (no env, no arm file, no matching beacon) → untouched (exit 0, empty stdout)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Standing by, prose ending.')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }) // no arm
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '')
})

test('arm file from a FOREIGN session → untouched (the 2026-07-17 fabrication class: never guard another session\'s agents)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Research summary: the repo has 10 skills. Done.')
  writeFileSync(join(root, '.building', '1670-executor.armed'), 'some-other-session-uuid')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, {})
  assert.equal(r.stdout.trim(), '', 'a foreign-session arm file must not arm')
})

test('bare/legacy arm file (no session id) → untouched (unbound files must never induce fabrication)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Plain prose ending mid-phase.')
  writeFileSync(join(root, '.building', '1670-executor.armed'), '')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, {})
  assert.equal(r.stdout.trim(), '', 'an unbound arm file must not arm')
})

test('arm FILE channel (.building/<N>-executor.armed) arms independently of env', () => {
  const root = makeWorktree()
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1') // session-bound to the payload session
  const t = writeTranscript(root, 'Prose ending, no result.')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }) // NO env — the arm file must arm
  assert.equal(JSON.parse(r.stdout).decision, 'block')
  assert.equal(JSON.parse(r.stdout).reason, REASON(1670, '1670.2'))
})

test('internally-erroring payload (unreadable transcript) → fail OPEN (exit 0, no block)', () => {
  const root = makeWorktree()
  const r = guard(root, { session_id: 's1', transcript_path: join(root, 'does-not-exist.jsonl'), hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'an unreadable transcript must not produce a block')
})

test('Stop + roadmap/.arc-mode → WARN not block (armed-and-open blocks under SubagentStop, only warns under Stop)', () => {
  const armedOpen = { session_id: 's1', hook_event_name: 'Stop' }
  const root = makeWorktree({ arcMode: true })
  writeFileSync(join(root, '.building', 'ROADCODE-executor.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'task-start' }) + '\n')
  const t = writeTranscript(root, 'Interrupting my own session.')
  const stop = guard(root, { ...armedOpen, transcript_path: t }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(stop.stdout.trim(), '', 'Stop + .arc-mode must NOT block')
  assert.match(stop.stderr, /roadmap arc next/)
  // the SAME armed-and-open state under SubagentStop DOES block
  const sub = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(sub.stdout).decision, 'block')
})
