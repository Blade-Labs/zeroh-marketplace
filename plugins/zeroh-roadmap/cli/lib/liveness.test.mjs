#!/usr/bin/env node
/**
 * liveness.test.mjs — the PORTED executor-liveness suite driving the CLI entry
 * `node bin/roadmap.mjs watch --once <sidecar> --json` (arc ROADCODE 1657.6). Every case
 * keeps its assertion verbatim from scripts/executor-liveness.test.mjs; only the entry
 * invocation changed (the verdict engine is now cli/lib/liveness.mjs). Hermetic via the
 * LIVENESS_* seams. Run: node --test cli/lib/liveness.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const tmps = []
function newTmp() {
  const d = mkdtempSync(join(tmpdir(), 'zr-liveness-'))
  tmps.push(d)
  return d
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

function makeArc(dir, arcId, beaconLines) {
  const registry = join(dir, '.building')
  mkdirSync(registry, { recursive: true })
  const sidecar = join(registry, `${arcId}.json`)
  writeFileSync(sidecar, JSON.stringify({ arcId, worktree: dir, branch: 'develop', baseRef: 'develop', mode: 'inline' }))
  if (beaconLines) writeFileSync(join(registry, `${arcId}-executor.jsonl`), beaconLines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return sidecar
}

function run(sidecar, extraArgs = [], env = {}) {
  const merged = { ...process.env, LIVENESS_PGREP_CMD: 'true', LIVENESS_PROBE_MS: '20', ...env }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k]
  const out = execFileSync('node', [BIN, 'watch', '--once', sidecar, '--json', ...extraArgs], { encoding: 'utf8', env: merged })
  return JSON.parse(out)
}

function agentRecord(type, stopReason, text, tsIso) {
  return {
    type,
    timestamp: tsIso,
    message: type === 'assistant' ? { role: 'assistant', stop_reason: stopReason, content: [{ type: 'text', text }] } : { role: 'user', content: [] },
  }
}
function makeAgentTranscript(dir, records) {
  const tdir = join(dir, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const target = join(tdir, 'agent-abc123.jsonl')
  writeFileSync(target, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  symlinkSync(target, join(tdir, 'aabc123.output'))
  return tdir
}
function startAppender(file) {
  const p = spawn('sh', ['-c', `for i in $(seq 1 100); do printf x >> "${file}"; sleep 0.02; done`], { stdio: 'ignore' })
  return () => {
    try {
      p.kill('SIGKILL')
    } catch {
      /* gone */
    }
  }
}

test('1) fresh commit beacon → ALIVE', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A1', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }]))
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.beacon, /age 2\.\dmin/)
})

test('2) 30-min gate-stage-start beacon → QUIET', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A2', [{ ts: isoAgo(30), phase: null, event: 'gate-stage-start', detail: 'code-review' }]))
  assert.equal(r.verdict, 'QUIET')
  assert.match(r.evidence.beacon, /gate-stage-start/)
})

test('3) 90-min beacon + symlink .output not growing + no pgrep → STALLED (symlink trap dead)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A3', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = join(d, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const target = join(tdir, 'real-transcript.jsonl')
  writeFileSync(target, 'x'.repeat(5000))
  symlinkSync(target, join(tdir, 'agent.output'))
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'STALLED')
  assert.match(r.evidence.transcript, /5000B/, 'reports the realpath TARGET size, not a symlink stub')
})

test('4) background-run beacon + a log that grows between probes → ALIVE', () => {
  const d = newTmp()
  const logFile = join(d, 'bg.log')
  writeFileSync(logFile, '')
  const sc = makeArc(d, 'A4', [{ ts: isoAgo(30), phase: 100, event: 'background-run', detail: 'full suite', log: logFile }])
  const stop = startAppender(logFile)
  try {
    const r = run(sc, [], { LIVENESS_PROBE_MS: '400' })
    assert.equal(r.verdict, 'ALIVE')
    assert.match(r.evidence.log, /grew: true/)
  } finally {
    stop()
  }
})

test('6) DEFAULT pgrep path must not self-match its own invocation', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A6', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const r = run(sc, [], { LIVENESS_PGREP_CMD: undefined })
  assert.equal(r.verdict, 'STALLED')
  assert.match(r.evidence.pgrep, /^0 process/)
})

test('7) final transcript record = assistant end_turn (old) → EXITED, outranking a fresh beacon', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A7', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = makeAgentTranscript(d, [
    agentRecord('assistant', 'tool_use', 'committing task 1', isoAgo(12)),
    agentRecord('assistant', 'end_turn', 'Task 1397.1 committed. Preparing 1397.2 next.', isoAgo(10)),
  ])
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'EXITED')
  assert.match(r.evidence.exit, /end_turn/)
  assert.match(r.evidence.finalMessage, /Preparing 1397\.2/)
})

test('8) mid-turn transcript → no EXITED, normal rows decide', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A8', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = makeAgentTranscript(d, [agentRecord('assistant', 'end_turn', 'earlier turn', isoAgo(60)), agentRecord('user', null, '', isoAgo(10))])
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'STALLED')
  assert.equal(r.evidence.exit, undefined)
})

test('9) end_turn younger than the settle window → not yet EXITED', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A9', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = makeAgentTranscript(d, [agentRecord('assistant', 'end_turn', 'done-ish', isoAgo(1))])
  const r = run(sc, ['--transcript-dir', tdir])
  assert.equal(r.verdict, 'ALIVE')
})

test('5) no beacon + growing transcript → pre-beacon QUIET', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A5', null)
  const tdir = join(d, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const out = join(tdir, 'agent.output')
  writeFileSync(out, '')
  const stop = startAppender(out)
  try {
    const r = run(sc, ['--transcript-dir', tdir], { LIVENESS_PROBE_MS: '400' })
    assert.equal(r.verdict, 'pre-beacon QUIET')
    assert.equal(r.preBeacon, true)
    assert.match(r.evidence.transcript, /grew: true/)
  } finally {
    stop()
  }
})

test('10) PRODUCTION layout — beacon in <worktree>/.building keyed by PHASE → discovered, ALIVE', () => {
  const d = newTmp()
  const registry = join(d, 'roadmap', 'arcs', '.building')
  mkdirSync(registry, { recursive: true })
  const sidecar = join(registry, 'MKT.json')
  writeFileSync(sidecar, JSON.stringify({ arcId: 'MKT', worktree: d, branch: 'arc/mkt', baseRef: 'develop', mode: 'mixed' }))
  const beaconDir = join(d, '.building')
  mkdirSync(beaconDir, { recursive: true })
  writeFileSync(join(beaconDir, '1333-executor.jsonl'), JSON.stringify({ ts: isoAgo(2), phase: 1333, event: 'task-start' }) + '\n')
  const r = run(sidecar)
  assert.equal(r.verdict, 'ALIVE')
  assert.equal(r.preBeacon, false)
  assert.match(r.evidence.beacon, /1333-executor\.jsonl/)
})

test('11) stale beacon but a worktree file touched moments ago → ALIVE (activity row)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A11', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  mkdirSync(join(d, 'src'), { recursive: true })
  writeFileSync(join(d, 'src', 'turn.ts'), 'export {}\n')
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.activity, /newest worktree file/)
})

test('12) stale beacon but a git commit minutes ago → ALIVE (activity row, commit signal)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A12', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: ['ignore', 'pipe', 'ignore'] })
  g('init', '-q')
  writeFileSync(join(d, 'work.txt'), 'x')
  g('add', 'work.txt')
  g('commit', '-qm', 'work')
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.activity, /last commit/)
})

test('13) no beacon, nothing else, sidecar just written → pre-beacon QUIET (grace window)', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A13', null))
  assert.equal(r.verdict, 'pre-beacon QUIET')
  assert.match(r.evidence.grace, /grace window/)
})

test('14) no beacon, grace expired, no activity → pre-beacon STALLED', () => {
  const d = newTmp()
  const r = run(makeArc(d, 'A14', null), [], { LIVENESS_PREBEACON_GRACE_MIN: '0' })
  assert.equal(r.verdict, 'pre-beacon STALLED')
  assert.equal(r.evidence.grace, undefined)
})
