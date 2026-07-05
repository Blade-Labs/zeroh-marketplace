#!/usr/bin/env node
/**
 * Fixtures for executor-liveness.mjs — the five verdict rows, each hermetic
 * (fake pgrep via LIVENESS_PGREP_CMD, shrink the inter-probe delay via
 * LIVENESS_PROBE_MS, growth driven by a short-lived `sh` appender — no real
 * sleeps, no real process table). Run: node --test scripts/executor-liveness.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'executor-liveness.mjs')

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

function isoAgo(min) {
  return new Date(Date.now() - min * 60_000).toISOString()
}

/** Write a sidecar + optional beacon lines; return the sidecar path. */
function makeArc(dir, arcId, beaconLines) {
  const registry = join(dir, '.building')
  mkdirSync(registry, { recursive: true })
  const sidecar = join(registry, `${arcId}.json`)
  writeFileSync(sidecar, JSON.stringify({ arcId, worktree: dir, branch: 'develop', baseRef: 'develop', mode: 'inline' }))
  if (beaconLines) {
    writeFileSync(join(registry, `${arcId}-executor.jsonl`), beaconLines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }
  return sidecar
}

function run(sidecar, extraArgs = [], env = {}) {
  const out = execFileSync('node', [SCRIPT, sidecar, '--json', ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, LIVENESS_PGREP_CMD: 'true', LIVENESS_PROBE_MS: '20', ...env },
  })
  return JSON.parse(out)
}

/** Start a short-lived appender that grows `file` for ~2s; returns a stop fn. */
function startAppender(file) {
  const p = spawn('sh', ['-c', `for i in $(seq 1 100); do printf x >> "${file}"; sleep 0.02; done`], {
    stdio: 'ignore',
  })
  return () => {
    try {
      p.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

test('1) fresh commit beacon → ALIVE', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A1', [{ ts: isoAgo(2), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  const r = run(sc)
  assert.equal(r.verdict, 'ALIVE')
  assert.match(r.evidence.beacon, /age 2\.\dmin/)
})

test('2) 30-min gate-stage-start beacon → QUIET (mid-gate-quiet)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A2', [{ ts: isoAgo(30), phase: null, event: 'gate-stage-start', detail: 'code-review' }])
  const r = run(sc)
  assert.equal(r.verdict, 'QUIET')
  assert.match(r.evidence.beacon, /gate-stage-start/)
})

test('3) 90-min beacon + symlink .output not growing + no pgrep → STALLED (symlink trap dead)', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A3', [{ ts: isoAgo(90), phase: 100, event: 'commit', detail: 'abc123 feat: x' }])
  // A transcript dir whose .output is a SYMLINK to a 5000-byte target. A bare
  // lstat would report the tiny symlink size; the script must report 5000.
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

test('5) no beacon + growing transcript → pre-beacon QUIET', () => {
  const d = newTmp()
  const sc = makeArc(d, 'A5', null) // no beacon file
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
