#!/usr/bin/env node
/**
 * watch.test.mjs — the PORTED executor-watch suite driving `node bin/roadmap.mjs watch
 * <sidecar> …` (arc ROADCODE 1657.6). The three exit contracts (sidecar-gone → 0, STALLED
 * → 3, EXITED → 4) + the pre-beacon grace loop-to-max, verbatim from
 * scripts/executor-watch.test.mjs — only the entry invocation changed.
 * Run: node --test cli/lib/watch.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const tmps = []
function newTmp() {
  const d = mkdtempSync(join(tmpdir(), 'zr-watch-'))
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

function runWatch(sidecar, extraArgs = []) {
  return spawnSync('node', [BIN, 'watch', sidecar, ...extraArgs], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, LIVENESS_PGREP_CMD: 'true', LIVENESS_PROBE_MS: '20', LIVENESS_WATCH_INTERVAL_MS: '50' },
  })
}

test('sidecar gone → exit 0 immediately', () => {
  const d = newTmp()
  const r = runWatch(join(d, '.building', 'NOPE.json'))
  assert.equal(r.status, 0)
  assert.match(r.stdout, /sidecar gone/)
})

test('stale beacon + a transcript measured FLAT → exit 3 with the STALLED verdict JSON', () => {
  // 2384.2: STALLED now demands corroboration, so the fixture supplies the life probe that comes
  // back negative — which is what the production estate looks like for a genuinely dead executor
  // (its transcript is still on disk; it simply stopped growing).
  const d = newTmp()
  const sc = makeArc(d, 'W1', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = join(d, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const target = join(tdir, 'agent-w1.jsonl')
  writeFileSync(target, 'x'.repeat(4096))
  symlinkSync(target, join(tdir, 'aw1.output'))
  const r = runWatch(sc, ['--transcript-dir', tdir])
  assert.equal(r.status, 3)
  assert.match(r.stdout, /"verdict": "STALLED"/)
})

test('stale beacon, NOTHING probeable → exit 5 with the UNOBSERVED verdict JSON, never 3', () => {
  // The whole point of the split: a caller that respawns on 3 must not respawn on this.
  const d = newTmp()
  const sc = makeArc(d, 'W1b', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const r = runWatch(sc)
  assert.equal(r.status, 5)
  assert.match(r.stdout, /"verdict": "UNOBSERVED"/)
})

test('completed final assistant turn → exit 4 with the EXITED verdict JSON', () => {
  const d = newTmp()
  const sc = makeArc(d, 'W2', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const tdir = join(d, 'transcripts')
  mkdirSync(tdir, { recursive: true })
  const target = join(tdir, 'agent-w2.jsonl')
  const rec = { type: 'assistant', timestamp: isoAgo(10), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Committed 1397.1, prepping 1397.2.' }] } }
  writeFileSync(target, JSON.stringify(rec) + '\n')
  symlinkSync(target, join(tdir, 'aw2.output'))
  const r = runWatch(sc, ['--transcript-dir', tdir])
  assert.equal(r.status, 4)
  assert.match(r.stdout, /"verdict": "EXITED"/)
  assert.match(r.stdout, /prepping 1397\.2/)
})

test('just-spawned executor (no beacon yet, fresh sidecar) → does NOT exit 3; runs to max duration', () => {
  const d = newTmp()
  const sc = makeArc(d, 'W3', null)
  const r = runWatch(sc, ['--max-hours', '0.0002'])
  assert.equal(r.status, 0)
  assert.match(r.stdout, /max duration reached/)
})
