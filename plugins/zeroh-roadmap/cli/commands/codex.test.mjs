#!/usr/bin/env node
/**
 * WIRED tests for `roadmap codex status` + the launch path's stale-report clearing.
 *
 * The stale-sentinel bug (2026-08-11): a relaunch reused the previous run's worktree, and
 * `codex status` read the OLD CODEX-REPORT.md's sentinel as the live run's verdict — a
 * working run polled "blocked". Two defenses, both tested here:
 *   - status trusts a report only when its mtime is >= the journal's startedAt (older = a
 *     previous run's hand-off, surfaced as staleReport, never as the verdict);
 *   - `codex run` deletes any existing CODEX-REPORT.md before spawning (the report is never
 *     committed, so the launching run owns the file).
 *
 * Hermetic-tmp-git-repo pattern from cli/commands/claim.test.mjs; the run-path test puts a
 * fake `codex` executable on PATH so nothing real launches.
 *
 * Run: node --test cli/commands/codex.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const cleanups = []
process.on('exit', () => cleanups.forEach((fn) => fn()))

function tmpRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codex-test-')))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(join(root, '.building'), { recursive: true })
  return root
}

function writeJournal(root, ids, extra = {}) {
  const worktree = join(root, `wt-${ids.join('-')}`)
  mkdirSync(worktree, { recursive: true })
  const j = {
    phases: ids.map(String),
    worktree,
    base: 'develop',
    pgid: 999999999, // never a live group
    log: join(root, '.building', 'x.log'),
    startedAt: new Date().toISOString(),
    ...extra,
  }
  writeFileSync(join(root, '.building', `codex-${ids.join('-')}.json`), JSON.stringify(j) + '\n')
  return j
}

function status(root, id) {
  const r = spawnSync('node', [BIN, 'codex', 'status', String(id)], { cwd: root, encoding: 'utf8' })
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

/** Backdate a file to well before any startedAt written in this test run. */
function backdate(path) {
  const old = (Date.now() - 3600_000) / 1000
  utimesSync(path, old, old)
}

test('stale sentinel: a report older than startedAt is NOT the verdict (dead run)', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [42])
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'old hand-off\nCODEX-RUN-BLOCKED\n')
  backdate(report)
  const { code, out } = status(root, 42)
  assert.equal(out.state, 'dead-no-report', 'a stale sentinel must not read as blocked')
  assert.equal(out.report, null)
  assert.equal(out.staleReport, report, 'the stale report is surfaced, not silently ignored')
  assert.equal(code, 2)
})

test('stale sentinel: a live relaunch over a stale report reads running', () => {
  const root = tmpRepo()
  // A real detached process group standing in for the live run.
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const j = writeJournal(root, [43], { pgid: child.pid })
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'previous run\nCODEX-RUN-BLOCKED\n')
  backdate(report)
  const { code, out } = status(root, 43)
  assert.equal(out.state, 'running', 'alive group + stale report = running, never blocked')
  assert.equal(out.alive, true)
  assert.equal(code, 3)
})

test('fresh report: sentinel written after launch is the verdict', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [44], { startedAt: new Date(Date.now() - 60_000).toISOString() })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'done\nCODEX-RUN-COMPLETE\n')
  const { code, out } = status(root, 44)
  assert.equal(out.state, 'complete')
  assert.equal(out.report, join(j.worktree, 'CODEX-REPORT.md'))
  assert.equal(code, 0)
})

test('codex run clears a leftover CODEX-REPORT.md before launching', () => {
  const root = tmpRepo()
  // Phase file so buildPrompt resolves; premade worktree so no git-worktree/npm-ci runs.
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-45.phase.ts'), 'export default {}\n')
  const j = writeJournal(root, [45]) // dead pgid → relaunch path
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'previous run\nCODEX-RUN-BLOCKED\n')
  // Fake `codex` on PATH: exits immediately, launches nothing real.
  const fakeBin = join(root, 'fakebin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(fakeBin, 'codex'), 0o755)
  const r = spawnSync('node', [BIN, 'codex', 'run', '45', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!existsSync(report), 'the stale report must be cleared at launch')
  assert.match(r.stderr, /cleared a stale CODEX-REPORT\.md/)
})

test('the lane prompt carries the cross-repo instruction', () => {
  const root = tmpRepo()
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-46.phase.ts'), 'export default {}\n')
  const j = writeJournal(root, [46])
  const fakeBin = join(root, 'fakebin')
  mkdirSync(fakeBin)
  writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(fakeBin, 'codex'), 0o755)
  const r = spawnSync('node', [BIN, 'codex', 'run', '46', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  })
  assert.equal(r.status, 0, r.stderr)
  const prompt = execFileSync('cat', [join(root, '.building', 'codex-46-prompt.txt')], { encoding: 'utf8' })
  assert.match(prompt, /CROSS-REPO PHASES/, 'the cross-repo rule ships in every lane prompt')
  assert.match(prompt, /roadmap-state commit .*stays in THIS worktree/i)
})
