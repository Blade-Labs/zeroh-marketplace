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
 * The review-lane tests below pin the property that makes two lanes safe to share one
 * command: separate journals, prompts and report names, so a review and an implementation of
 * the same phase can never read each other's verdict — plus the read-only mission rules,
 * which are the only thing standing between an unsandboxed Codex and the plans it reviews.
 *
 * Hermetic-tmp-git-repo pattern from cli/commands/claim.test.mjs; the launch-path tests put a
 * fake `codex` executable on PATH and pre-make the worktree so nothing real launches.
 *
 * Run: node --test cli/commands/codex.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, realpathSync, utimesSync } from 'node:fs'
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

test('codex run preserves a leftover CODEX-REPORT.md as .prev before launching', () => {
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
  assert.ok(!existsSync(report), 'the stale report must be moved aside at launch')
  assert.ok(existsSync(join(j.worktree, 'CODEX-REPORT.prev.md')), 'the hand-off is preserved, never deleted')
  assert.match(r.stderr, /preserved the previous run's CODEX-REPORT\.md/)
})

test('a relaunch whose phase file is missing destroys no evidence', () => {
  const root = tmpRepo()
  // No roadmap/phases/phase-48.phase.ts — buildPrompt throws.
  const j = writeJournal(root, [48])
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'previous run\nCODEX-RUN-BLOCKED\n')
  const r = spawnSync('node', [BIN, 'codex', 'run', '48', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.notEqual(r.status, 0)
  assert.ok(existsSync(report), 'a failed relaunch must leave the previous hand-off untouched')
})

test('a LIVE run under a different journal id refuses a launch into the same worktree', () => {
  const root = tmpRepo()
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const j = writeJournal(root, [50, 51], { pgid: child.pid }) // an arc journal, alive
  const report = join(j.worktree, 'CODEX-REPORT.md')
  writeFileSync(report, 'live run in progress\n')
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-50.phase.ts'), 'export default {}\n')
  const r = spawnSync('node', [BIN, 'codex', 'run', '50', '--worktree', j.worktree], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /LIVE run .* in this worktree — refusing/)
  assert.ok(existsSync(report), "the live run's report is untouched")
})

test('a journal with a malformed startedAt trusts the report', () => {
  const root = tmpRepo()
  const j = writeJournal(root, [47], { startedAt: 'not-a-date' })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'done\nCODEX-RUN-COMPLETE\n')
  const { code, out } = status(root, 47)
  assert.equal(out.state, 'complete', 'an unparseable startedAt must not eat a real verdict')
  assert.equal(code, 0)
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

// ── review lane ────────────────────────────────────────────────────────────

/** A premade worktree + fake `codex` on PATH: the launch path runs, nothing real spawns. */
function fakeLaunchEnv(root, worktree) {
  mkdirSync(worktree, { recursive: true })
  const fakeBin = join(root, 'fakebin')
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(fakeBin, 'codex'), 0o755)
  return { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` }
}

function writePhase(root, n) {
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`), 'export default {}\n')
}

test('review: the mission DELIVERS review-phase rather than restating it', () => {
  const root = tmpRepo()
  writePhase(root, 60)
  const worktree = join(root, 'wt-review-60')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'review', '60', '--worktree', worktree], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-review-60-prompt.txt'), 'utf8')

  // The protocol is handed over as a readable path, never pasted in.
  const skill = join(HERE, '..', '..', 'skills', 'review-phase', 'SKILL.md')
  assert.ok(existsSync(skill), 'a lane that names a missing protocol would brief on nothing')
  assert.match(prompt, /YOUR PROTOCOL IS A FILE/, 'the lane points at the protocol it runs')
  assert.ok(prompt.includes(skill), `the prompt must name the real skill path (${skill})`)

  // The duplication guard, and the reason this lane exists in this shape: the protocol BODY
  // stays in the skill so every driver reads the SAME one. These strings are Mode A's own —
  // finding them in the prompt means a second copy has been started.
  const protocol = readFileSync(skill, 'utf8')
  for (const owned of ['promise ledger', 'Step V', 'H4']) {
    assert.ok(protocol.includes(owned), `precondition: the skill owns "${owned}"`)
    assert.ok(!prompt.includes(owned), `"${owned}" belongs to the skill — the lane must not restate it`)
  }

  assert.match(prompt, /REPORT-ONLY/, 'a delegated review must not repair the plan it is judging')
  assert.match(prompt, /judged by:` in the verdict block is YOUR OWN model id/, 'attribution is per-driver, not per-lane')
  assert.match(prompt, /CODEX-REVIEW\.md/, "the review lane hands off its own report, never the run lane's")
  assert.doesNotMatch(prompt, /one commit|transparencyReport|roadmap gate run/i, 'implementation grammar must not leak into a review')
})

test('review: journal, prompt and report are separate from the run lane', () => {
  const root = tmpRepo()
  writePhase(root, 61)
  const worktree = join(root, 'wt-review-61')
  const env = fakeLaunchEnv(root, worktree)
  assert.equal(spawnSync('node', [BIN, 'codex', 'review', '61', '--worktree', worktree], { cwd: root, encoding: 'utf8', env }).status, 0)
  const j = JSON.parse(readFileSync(join(root, '.building', 'codex-review-61.json'), 'utf8'))
  assert.equal(j.lane, 'review')
  assert.equal(j.report, 'CODEX-REVIEW.md')
  assert.ok(!existsSync(join(root, '.building', 'codex-61.json')), 'a review must not write the run lane\'s journal')

  // The run-lane status must not adopt a review journal as its own verdict.
  const bare = spawnSync('node', [BIN, 'codex', 'status', '61'], { cwd: root, encoding: 'utf8' })
  assert.equal(bare.status, 1, 'run-lane status must not see a review journal')
  assert.match(bare.stderr, /no run journal covers/)

  writeFileSync(join(worktree, 'CODEX-REVIEW.md'), 'findings\nCODEX-RUN-COMPLETE\n')
  const reviewed = spawnSync('node', [BIN, 'codex', 'status', '61', '--review'], { cwd: root, encoding: 'utf8' })
  assert.equal(reviewed.status, 0, reviewed.stderr)
  assert.equal(JSON.parse(reviewed.stdout).state, 'complete')
})

test('review: a journal predating the lane still reads CODEX-REPORT.md', () => {
  const root = tmpRepo()
  // No `report` field — the pre-review-lane journal shape. startedAt is backdated for the same
  // reason as the fresh-report test: a report written in the launch millisecond can stat below
  // it, and this test is about the report NAME, not the freshness guard.
  const j = writeJournal(root, [62], { startedAt: new Date(Date.now() - 60_000).toISOString() })
  writeFileSync(join(j.worktree, 'CODEX-REPORT.md'), 'done\nCODEX-RUN-COMPLETE\n')
  const { code, out } = status(root, 62)
  assert.equal(out.state, 'complete', 'an old journal must not lose its verdict to the new report name')
  assert.equal(code, 0)
})

test('review: a missing --doc fails loudly and destroys no previous review', () => {
  const root = tmpRepo()
  writePhase(root, 63)
  const worktree = join(root, 'wt-review-63')
  const env = fakeLaunchEnv(root, worktree)
  const prior = join(worktree, 'CODEX-REVIEW.md')
  writeFileSync(prior, 'previous findings\nCODEX-RUN-COMPLETE\n')
  const r = spawnSync('node', [BIN, 'codex', 'review', '63', '--worktree', worktree, '--doc', '.building/nope.md'], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /context doc missing/)
  assert.equal(readFileSync(prior, 'utf8'), 'previous findings\nCODEX-RUN-COMPLETE\n', 'a failed launch must leave the previous hand-off intact')
})

test('review: an untracked --doc is copied into the worktree it names', () => {
  const root = tmpRepo()
  writePhase(root, 64)
  const worktree = join(root, 'wt-review-64')
  const env = fakeLaunchEnv(root, worktree)
  writeFileSync(join(root, '.building', 'PLAN.md'), '# the release plan\n')
  const r = spawnSync('node', [BIN, 'codex', 'review', '64', '--worktree', worktree, '--doc', '.building/PLAN.md'], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(join(worktree, '.building', 'PLAN.md'), 'utf8'), '# the release plan\n', 'a gitignored plan is absent from a fresh worktree — the lane must carry it in')
  assert.match(readFileSync(join(root, '.building', 'codex-review-64-prompt.txt'), 'utf8'), /CONTEXT DOC \(read before the phase files/)
})

test('review: --focus lands as the protocol\'s trailing prompt, not as a replacement step', () => {
  const root = tmpRepo()
  writePhase(root, 65)
  const worktree = join(root, 'wt-review-65')
  const env = fakeLaunchEnv(root, worktree)
  const r = spawnSync('node', [BIN, 'codex', 'review', '65', '--worktree', worktree, '--focus', 'weigh the shared policy release'], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  const prompt = readFileSync(join(root, '.building', 'codex-review-65-prompt.txt'), 'utf8')
  assert.match(prompt, /weigh the shared policy release/)
  // review-phase already defines what a trailing ask is ("extra checks AFTER the protocol");
  // --focus rides that convention instead of inventing a second one.
  assert.match(prompt, /TRAILING PROMPT/, 'a focus must enter through the protocol\'s own door')
  assert.match(prompt, /never displaces a step/, 'a focus must not become the whole mission')
})

test('review: a live review refuses an implementation run into the same worktree', () => {
  const root = tmpRepo()
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
  child.unref()
  cleanups.push(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  })
  const worktree = join(root, 'wt-shared')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(
    join(root, '.building', 'codex-review-66.json'),
    JSON.stringify({ phases: ['66'], lane: 'review', report: 'CODEX-REVIEW.md', worktree, pgid: child.pid, startedAt: new Date().toISOString() }) + '\n',
  )
  writePhase(root, 66)
  const r = spawnSync('node', [BIN, 'codex', 'run', '66', '--worktree', worktree], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /LIVE run .* in this worktree — refusing/, 'the liveness guard must span both lanes')
})

test("review: a flag's value is never parsed as a phase id", () => {
  const root = tmpRepo()
  writePhase(root, 67)
  const worktree = join(root, 'wt-review-67')
  const env = fakeLaunchEnv(root, worktree)
  // --base 719 is a ref; only 67 is a phase. A naive numeric filter would review both.
  const r = spawnSync('node', [BIN, 'codex', 'review', '67', '--worktree', worktree, '--base', '719'], { cwd: root, encoding: 'utf8', env })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(existsSync(join(root, '.building', 'codex-review-67.json')))
  assert.ok(!existsSync(join(root, '.building', 'codex-review-67-719.json')), "a --base ref must not join the phase list")
})
