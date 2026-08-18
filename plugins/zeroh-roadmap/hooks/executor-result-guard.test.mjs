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
    // The spawn prompt names the phase FILE — the contract both spawn lanes satisfy, and what arm
    // channels (b)/(c) match the stopping agent on since 2384.4. 'do phase 1670' alone was never a
    // real spawn prompt; the fixture now carries the shape the guard reads.
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'do phase 1670 — roadmap/phases/phase-1670.phase.ts' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalAssistantText }] } },
  ]
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

/** A transcript ending on a tool_use entry after a valid result. CORRECTED 2026-07-26 by an
 *  adversarial architect review: this is NOT "the real-world shape" as originally claimed — across
 *  122 phase-executor subagent transcripts, 118 end on a TEXT entry and the 4 tool_use tails are
 *  interrupted or in-flight runs, none a completed SubagentStop. The don't-clobber behaviour it
 *  pins is still correct and worth keeping; the claim that it was the production failure was
 *  wrong. The real cause was the guard reading the SESSION transcript and never checking
 *  stop_hook_active — see the tests below.
 *  Against the original reader the trailing entry's text parts filtered to [], joined to '', and
 *  CLOBBERED the real result. '' is not null, so it slipped past the `text == null` fail-open,
 *  lastJsonBlock('') returned null, and every typed return that was not `done` became
 *  undeliverable — a one-way valve pressuring executors to fabricate a `done`. */
function writeTranscriptEndingOnToolUse(root, finalAssistantText) {
  const p = join(root, 'transcript.jsonl')
  const lines = [
    // The spawn prompt names the phase FILE — the contract both spawn lanes satisfy, and what arm
    // channels (b)/(c) match the stopping agent on since 2384.4. 'do phase 1670' alone was never a
    // real spawn prompt; the fixture now carries the shape the guard reads.
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'do phase 1670 — roadmap/phases/phase-1670.phase.ts' }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalAssistantText }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'git log -1' } }] } },
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
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block')
  assert.equal(decision.reason, REASON(1670, '1670.2')) // string-equality pin
})

test('valid typed result ending → ALLOW + a result-returned beacon is appended', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, fence(validResult))
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'no block JSON')
  const beacon = readFileSync(join(root, '.building', '1670-executor.jsonl'), 'utf8')
  assert.match(beacon, /"event":"result-returned"/)
})

test('escalated-status result ending → ALLOW (an honest escalated return is valid)', () => {
  const root = makeWorktree()
  const escalated = { phase: 1670, status: 'escalated', gateRounds: 0, escalation: { question: 'which option is right here?', options: ['A', 'B'] } }
  const t = writeTranscript(root, fence(escalated))
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
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
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  // The worktree re-exports the LIVE templates/schema.ts (1753.2 checkpoint schema), so
  // `roadmap result check` already parses this via license path 1 — GREEN pre-implementation.
  assert.equal(r.stdout.trim(), '', `a valid checkpoint result must be allowed; got: ${r.stdout}`)
  const beacon = readFileSync(join(root, '.building', '1670-executor.jsonl'), 'utf8')
  assert.match(beacon, /"event":"result-returned"/)
})

test('payload-free {"status":"checkpoint"} (no checkpoint field) → BLOCK (the superRefine rejects it at result check)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, fence({ phase: 1670, status: 'checkpoint', gateRounds: 0 }))
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'a checkpoint with no committed hand-off is a nap in a costume — it must not license a stop')
})

test('the block reason names the two-exit contract — mentions "checkpoint", never "background-run"', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Committed 1670.1, prepping 1670.2. Standing by.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  const reason = JSON.parse(r.stdout).reason
  assert.match(reason, /checkpoint/, 'the reason must teach the checkpoint exit')
  assert.doesNotMatch(reason, /background-run/, 'the retired background-run license must not appear in the reason')
})

test('fresh background-run beacon with a log → BLOCK (path 3 deleted: a beacon no longer licenses bare prose)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Backgrounded the full suite; Monitor armed. See log.')
  writeBeacon(root, 1670, { ts: new Date().toISOString(), phase: 1670, event: 'background-run', log: '.test-logs/run.tap' })
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block', 'a fresh background-run beacon must NOT license a bare-prose stop — return a checkpoint result instead')
  assert.equal(decision.reason, REASON(1670, '1670.2'))
})

test('fresh background-run beacon with an EPOCH-MS ts → BLOCK (freshness window gone; unbounded work returns a checkpoint)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Backgrounded the full suite; Monitor armed. See log.')
  writeBeacon(root, 1670, { ts: Date.now(), phase: 1670, event: 'background-run', log: '.test-logs/run.tap' })
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
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
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block')
})

test('phase already done WITH executionResult → ALLOW', () => {
  const root = makeWorktree({ phaseStatus: 'done', tasksDone: [true, true], executionResult: true })
  const t = writeTranscript(root, 'All done.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', 'persisted done must be allowed')
})

test('UNARMED (no env, no arm file, no matching beacon) → untouched (exit 0, empty stdout)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Standing by, prose ending.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }) // no arm
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '')
})

test('arm file from a FOREIGN session → untouched (the 2026-07-17 fabrication class: never guard another session\'s agents)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Research summary: the repo has 10 skills. Done.')
  writeFileSync(join(root, '.building', '1670-executor.armed'), 'some-other-session-uuid')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, {})
  assert.equal(r.stdout.trim(), '', 'a foreign-session arm file must not arm')
})

test('bare/legacy arm file (no session id) → untouched (unbound files must never induce fabrication)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Plain prose ending mid-phase.')
  writeFileSync(join(root, '.building', '1670-executor.armed'), '')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, {})
  assert.equal(r.stdout.trim(), '', 'an unbound arm file must not arm')
})

test('arm FILE channel (.building/<N>-executor.armed) arms independently of env', () => {
  const root = makeWorktree()
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1') // session-bound to the payload session
  const t = writeTranscript(root, 'Prose ending, no result.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }) // NO env — the arm file must arm
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
  const stop = guard(root, { ...armedOpen, transcript_path: t, agent_transcript_path: t }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(stop.stdout.trim(), '', 'Stop + .arc-mode must NOT block')
  assert.match(stop.stderr, /roadmap arc next/)
  // the SAME armed-and-open state under SubagentStop DOES block
  const sub = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(sub.stdout).decision, 'block')
})

// ── 1792.6: guard scoping — a SIBLING subagent in the armed session is not the executor ──
// The SubagentStop payload carries no per-agent identity (session_id + transcript_path only),
// but the TRANSCRIPT self-identifies via attributionAgent. A non-executor agent that ends its
// turn with prose owes no PhaseExecutionResult and must pass through untouched (the misfire
// class: architect/reviewer spawns killed mid-arc while an executor sentinel is armed).

/** A transcript whose lines carry an attributionAgent (the real Claude Code shape). */
function writeAttributedTranscript(root, agent, finalAssistantText) {
  const p = join(root, `transcript-${agent.replace(/[^\w]/g, '_')}.jsonl`)
  const lines = [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'review the diff' }] }, attributionAgent: agent },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalAssistantText }] }, attributionAgent: agent },
  ]
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

test('1792.6 — an armed session\'s REVIEWER subagent ending in prose passes through (never blocked)', () => {
  const root = makeWorktree()
  const t = writeAttributedTranscript(root, 'zeroh-roadmap:code-reviewer', 'Verdict: clean. No findings.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'a non-executor subagent must never be blocked by the executor guard')
})

test('1792.6 — the EXECUTOR agent ending in prose still blocks (scoping narrows, never disarms)', () => {
  const root = makeWorktree()
  const t = writeAttributedTranscript(root, 'zeroh-roadmap:phase-executor', 'I did some work and stopped.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'the armed executor still owes a result')
})

test('1792.6 — a transcript with NO attributionAgent keeps today\'s behavior (conservative fallback)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Prose ending, no attribution field.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'an unattributed transcript is not silently exempted')
})

// ── Regression: transcript ending on a tool_use entry (the REAL-WORLD shape) ──────────────────
// Every fixture above ends the transcript on a text entry, which is why this class went unseen.
// Claude Code writes each content block as its own entry, so an executor's final turn commonly
// ends on a tool_use entry. Before the lastAssistantText fix, that entry's text parts filtered to
// [] and joined to '', clobbering the real result; '' is not null, so it slipped past the
// `text == null` fail-open and lastJsonBlock('') returned null. The first three cases below then
// BLOCKED — escalated / failed / checkpoint were structurally undeliverable — while a `done`
// return survived anyway via the separate status-done + persisted-executionResult license. That
// asymmetry is why the defect read as "the guard sometimes misfires" rather than "the guard only
// ever lets `done` through", and it is what pressured executors to fabricate a done.

test('REGRESSION: escalated result + trailing tool_use entry → ALLOW (was: undeliverable)', () => {
  const root = makeWorktree()
  const escalated = { phase: 1670, status: 'escalated', gateRounds: 0, escalation: { question: 'the route count moved under the plan; how should it be handled?', options: ['re-parameterize', 'pin the literal'] } }
  const t = writeTranscriptEndingOnToolUse(root, fence(escalated))
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', `an honest escalated return must survive a trailing tool_use entry; got: ${r.stdout}`)
})

test('REGRESSION: failed result + trailing tool_use entry → ALLOW (was: undeliverable)', () => {
  const root = makeWorktree()
  const failed = { phase: 1670, status: 'failed', gateRounds: 0, compromises: [], skipped: [], hardcoded: [], surfaced: ['the dependency is unbuildable on this host'], hardStops: [] }
  const t = writeTranscriptEndingOnToolUse(root, fence(failed))
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', `an honest failed return must survive a trailing tool_use entry; got: ${r.stdout}`)
})

test('REGRESSION: checkpoint result + trailing tool_use entry → ALLOW (was: undeliverable)', () => {
  const root = makeWorktree()
  const checkpoint = { phase: 1670, status: 'checkpoint', gateRounds: 0, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [], checkpoint: { committedSha: 'abc1234', reason: 'the suite outlives this turn', resume: 'respawn and run the on-wake drill' } }
  const t = writeTranscriptEndingOnToolUse(root, fence(checkpoint))
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', `a checkpoint hand-off must survive a trailing tool_use entry; got: ${r.stdout}`)
})

test('REGRESSION: prose + trailing tool_use entry → STILL BLOCKS (the fix must not fail open)', () => {
  const root = makeWorktree()
  const t = writeTranscriptEndingOnToolUse(root, 'Committed 1656.1, prepping 1656.2. Standing by.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.code, 0)
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block', 'a bare-prose ending is the class this guard exists to catch — the fix must not fail open on it')
})

// ── The REAL defect, found by adversarial review 2026-07-26 ────────────────────────────────────
// Under SubagentStop, `transcript_path` is the MAIN SESSION transcript; `agent_transcript_path` is
// the stopping subagent's. Reading the session file made license path 1 evaluate the ORCHESTRATOR's
// last message, so it could only pass by accident. And with no `stop_hook_active` check the hook
// block-LOOPED until the harness force-ended the agent — which is what actually produced the
// "reviewer returned an empty body with zero tool uses" failures, not a trailing tool_use entry.

test('REGRESSION: stop_hook_active:true is never blocked (the block-loop that force-ends agents)', () => {
  const root = makeWorktree()
  const t = writeTranscript(root, 'Bare prose that would normally block.')
  const r = guard(root, { session_id: 's1', transcript_path: t, hook_event_name: 'SubagentStop', stop_hook_active: true }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', 're-entry on an already-blocked turn must return success, or the hook loops until the harness force-ends the agent')
})

test('REGRESSION: a result in the SUBAGENT transcript licenses the stop', () => {
  const root = makeWorktree()
  const agentT = join(root, 'agent-transcript.jsonl')
  writeFileSync(agentT, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: fence(validResult) }] } }) + '\n')
  const sessionT = writeTranscript(root, 'orchestrator prose, no result here')
  const r = guard(root, { session_id: 's1', transcript_path: sessionT, agent_transcript_path: agentT, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', 'the stopping subagent’s own transcript must be what licenses its stop')
})

test('REGRESSION: last_assistant_message licenses the stop without any transcript read', () => {
  const root = makeWorktree()
  const sessionT = writeTranscript(root, 'orchestrator prose, no result here')
  const r = guard(root, { session_id: 's1', transcript_path: sessionT, hook_event_name: 'SubagentStop', last_assistant_message: fence(validResult) }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(r.stdout.trim(), '', 'the payload delivers the subagent’s final text directly — prefer it')
})

test('REGRESSION: a result ONLY in the session transcript does NOT license a subagent stop', () => {
  const root = makeWorktree()
  const agentT = join(root, 'agent-transcript.jsonl')
  writeFileSync(agentT, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I am the reviewer, not the executor.' }] } }) + '\n')
  const sessionT = writeTranscript(root, fence(validResult))
  const r = guard(root, { session_id: 's1', transcript_path: sessionT, agent_transcript_path: agentT, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  assert.equal(JSON.parse(r.stdout).decision, 'block', 'the orchestrator’s prose must never license a subagent’s stop — that is the widening the first fix introduced')
})

// ── 2384.4: the guard wakes ONLY the executor whose phase is armed ─────────────────────────
// The 2026-08-18 incident: with 2164 and 2335 both armed by ONE session, detectArm channel (b)
// returned the FIRST arm file whose sessionId matched — readdir order — and woke executor pe-2335
// with the 2164 arm, demanding work on a phase that was not its own. The agent correctly refused
// and burned two ~500k-token turns doing it. The durable identity is the phase named in the
// agent's own spawn prompt, which the hook already reads the transcript for.

/** A second (or third) phase file in an existing worktree, so one root can hold two armed lanes. */
function addPhaseFile(root, phase, tasksDone = [true, false]) {
  const tasks = tasksDone.map((d, i) => `    { id: '${phase}.${i + 1}', done: ${d} }`).join(',\n')
  writeFileSync(
    join(root, 'roadmap', 'phases', `phase-${phase}.phase.ts`),
    `export default {\n  phase: ${phase},\n  status: 'in-progress',\n  tasks: [\n${tasks}\n  ],\n}\n`,
  )
}

/** A transcript whose spawn prompt names `phase`'s file — the contract both spawn lanes satisfy
 *  (do-arc's prompt and buildExecutorPrompt both carry the phase file PATH). `phase: null` writes
 *  a prompt that names no phase at all: an unrelated subagent. */
function writeSpawnedTranscript(root, phase, finalAssistantText, tag = String(phase)) {
  const p = join(root, `transcript-spawn-${tag}.jsonl`)
  const prompt = phase == null
    ? 'Review the diff on this branch and report findings.'
    : `Run do-phase for phase ${phase} end to end. Read roadmap/phases/phase-${phase}.phase.ts FIRST.`
  const lines = [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: finalAssistantText }] } },
  ]
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

test('2384.4a — TWO arms in one session: the stopping agent is matched to ITS OWN phase, never the sibling', () => {
  const root = makeWorktree() // phase 1670
  addPhaseFile(root, 1671)
  // Both armed by the same session. 1670 sorts first in readdir order, which is exactly how the
  // incident handed a 2335 executor the 2164 arm.
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1')
  writeFileSync(join(root, '.building', '1671-executor.armed'), 's1')
  const t = writeSpawnedTranscript(root, 1671, 'Prose ending mid-phase, no typed result.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' })
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block')
  assert.equal(decision.reason, REASON(1671, '1671.2'), 'the demand must name the agent\'s OWN phase')
  assert.ok(!decision.reason.includes('1670'), `never the sibling's arm: ${decision.reason}`)
})

test('2384.4b — the agent names a phase with NO arm → SILENT (its arm is already cleared)', () => {
  const root = makeWorktree()
  addPhaseFile(root, 1671)
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1') // only 1670 is armed
  const t = writeSpawnedTranscript(root, 1671, 'Prose ending, no result.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'an unarmed phase owes nothing — and the sibling arm is not a substitute')
})

test('2384.4c — the agent names NO phase → SILENT even with arms present (the misfire class, retired)', () => {
  const root = makeWorktree()
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1')
  const t = writeSpawnedTranscript(root, null, 'Verdict: clean, no findings.', 'noph')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'reviewers and test-engineers name no phase file — the armor-prompt workaround retires here')
})

test('2384.4d — ROADMAP_EXECUTOR_PHASE still wins outright, whatever the transcript names', () => {
  const root = makeWorktree()
  addPhaseFile(root, 1671)
  const t = writeSpawnedTranscript(root, 1671, 'Prose ending, no result.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' }, { ROADMAP_EXECUTOR_PHASE: '1670' })
  const decision = JSON.parse(r.stdout)
  assert.equal(decision.decision, 'block')
  assert.equal(decision.reason, REASON(1670, '1670.2'), 'the workflow lane sets the env explicitly — one phase by construction')
})

test('2384.4e — the SINGLE-arm executor with a matching transcript behaves exactly as today', () => {
  const root = makeWorktree()
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1')
  const t = writeSpawnedTranscript(root, 1670, 'Prose ending, no result.')
  const r = guard(root, { session_id: 's1', transcript_path: t, agent_transcript_path: t, hook_event_name: 'SubagentStop' })
  assert.equal(JSON.parse(r.stdout).reason, REASON(1670, '1670.2'))
})

test('2384.4f — an UNREADABLE transcript is no-phase, so the arm-file channel stays silent (fail-open)', () => {
  const root = makeWorktree()
  writeFileSync(join(root, '.building', '1670-executor.armed'), 's1')
  const r = guard(root, { session_id: 's1', transcript_path: join(root, 'gone.jsonl'), hook_event_name: 'SubagentStop' })
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '', 'never block on a payload we could not inspect')
})
