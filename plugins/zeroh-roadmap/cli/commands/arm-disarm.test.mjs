#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for `roadmap arm` + `roadmap disarm` (cli/commands/arm.mjs and
 * cli/commands/disarm.mjs do NOT exist yet — these suites are RED until implemented:
 * the dispatcher emits the "not yet implemented" line and exits 1, so every
 * exit-0/exit-2 assertion below fails until the modules land).
 *
 * These are WIRED tests: they SPAWN `node <plugin>/bin/roadmap.mjs …` as a real
 * subprocess against REAL git repos + linked worktrees and assert the Step-3b
 * sidecar-registry contract end to end — the beacon-stamp landing under the MAIN
 * checkout, the foreign-worktree refusal, live-pid warn, `--inline` arc-mode marker,
 * and disarm's landed-claims-only release. Hermetic-tmp-git-estate pattern from
 * cli/commands/config.test.mjs + cli/lib/sidecar.test.mjs (mkdtempSync + realpathSync
 * + process.on('exit') cleanup; REAL `git init` / `git worktree add`, no mocking).
 *
 * Run: node --test cli/commands/arm-disarm.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

// A stray path override would defeat the git-toplevel resolution the CLI exercises.
delete process.env.ROADMAP_CONFIG

const tmps = []
function newTmp(prefix = 'zr-cli-armdis-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d) // tmp symlink-safe; matches gitToplevel's realpath
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

function git(dir, ...args) {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

/** A tmp MAIN git repo on `develop` with a seed commit + roadmap/phases/; realpath'd root. */
function newRepo() {
  const d = newTmp()
  git(d, 'init', '-q', '-b', 'develop')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  mkdirSync(join(d, 'roadmap', 'phases'), { recursive: true })
  return d
}

/** Add a LINKED worktree on a fresh branch off develop; returns its realpath'd root. */
function addWorktree(mainRepo, branch) {
  const wt = join(newTmp('zr-cli-armdis-wt-'), 'tree')
  git(mainRepo, 'worktree', 'add', '-q', '-b', branch, wt, 'develop')
  return realpathSync(wt)
}

/** Spawn `node <BIN> ...args` with `cwd`; returns { status, stdout, stderr }. */
function roadmap(cwd, ...args) {
  return spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' })
}

/** The .building sidecar path under the MAIN checkout for an arc. */
function sidecarPath(repo, arcId) {
  return join(repo, 'roadmap', 'arcs', '.building', `${arcId}.json`)
}

/** Read + JSON.parse the MAIN-checkout sidecar for an arc. */
function readSidecar(repo, arcId) {
  return JSON.parse(readFileSync(sidecarPath(repo, arcId), 'utf8'))
}

/** `roadmap status <repo>/roadmap` — the derived lane table (human stdout). */
function status(repo) {
  return spawnSync('node', [BIN, 'status', join(repo, 'roadmap')], { encoding: 'utf8' })
}

/** The shared, cross-worktree claims dir for a repo (git common dir = <repo>/.git). */
function claimsDir(repo) {
  return join(repo, '.git', 'zeroh-roadmap-claims')
}

/** Write + commit a phase file DECLARING `phase: N` (a LANDED number). */
function commitPhaseFile(repo, num, arcId = 'LANDED') {
  const rel = join('roadmap', 'phases', `phase-${num}.phase.ts`)
  writeFileSync(
    join(repo, rel),
    `export const phase = { arcId: '${arcId}', phase: ${num}, status: 'done' }\n`,
  )
  git(repo, 'add', rel)
  git(repo, 'commit', '-qm', `phase ${num}`)
}

const arcModePath = (repo) => join(repo, 'roadmap', '.arc-mode')

test('1) arm writes the Step-3b sidecar under the MAIN .building dir, stamped', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'arm', 'ARC')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  assert.ok(existsSync(sidecarPath(repo, 'ARC')), 'sidecar lands under <repo>/roadmap/arcs/.building')

  const s = readSidecar(repo, 'ARC')
  assert.equal(s.arcId, 'ARC')
  assert.equal(s.worktree, resolve(repo), 'worktree = the arm cwd, resolved')
  assert.equal(s.branch, 'develop', 'branch from git branch --show-current')
  assert.equal(s.mode, 'mixed', 'default mode is mixed')
  assert.ok(Number.isInteger(s.pid) && s.pid > 0, 'armSidecar stamps a numeric pid')
  assert.ok('sessionHint' in s, 'armSidecar stamps sessionHint')
  assert.ok(
    typeof s.armedAt === 'string' && !Number.isNaN(Date.parse(s.armedAt)),
    'armSidecar stamps an ISO armedAt',
  )
})

test('2) arm --mode heavy --note x --base-ref develop carries all three through', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'arm', 'ARC', '--mode', 'heavy', '--note', 'x', '--base-ref', 'develop')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)

  const s = readSidecar(repo, 'ARC')
  assert.equal(s.mode, 'heavy', '--mode wins over the default')
  assert.equal(s.note, 'x', '--note is recorded')
  assert.equal(s.baseRef, 'develop', '--base-ref is recorded only when given')
})

test('3) foreign-worktree refusal: exit 2, stderr names the holder worktree', () => {
  const repo = newRepo()
  const wtA = addWorktree(repo, 'arc/a')
  const wtB = addWorktree(repo, 'arc/b')

  const first = roadmap(wtA, 'arm', 'ARC')
  assert.equal(first.status, 0, `first arm (from wtA) must succeed; stderr:\n${first.stderr}`)
  // Beacon-stamp: the sidecar lands under the MAIN checkout even armed from a worktree.
  assert.ok(existsSync(sidecarPath(repo, 'ARC')), 'sidecar lands under the MAIN checkout')

  const second = roadmap(wtB, 'arm', 'ARC')
  assert.equal(second.status, 2, `a lane held by another worktree is REFUSED → exit 2; stderr:\n${second.stderr}`)
  assert.ok(
    second.stderr.includes(resolve(wtA)),
    `the refusal must name the holder worktree ${resolve(wtA)}; got stderr:\n${second.stderr}`,
  )
})

test('4) same-worktree re-arm is idempotent: exit 0 with a /re-arm/i note on stderr', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'arm', 'ARC').status, 0)

  const again = roadmap(repo, 'arm', 'ARC')
  assert.equal(again.status, 0, `same-worktree re-arm must exit 0; stderr:\n${again.stderr}`)
  assert.match(again.stderr, /re-arm/i, `stderr must note the re-arm; got:\n${again.stderr}`)
})

test('5) live-pid re-arm: exit 0 but a LOUD stderr warning naming the live pid', () => {
  const repo = newRepo()
  // Hand-write a same-worktree sidecar carrying THIS (alive) process's pid.
  const dir = join(repo, 'roadmap', 'arcs', '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    sidecarPath(repo, 'ARC'),
    JSON.stringify({
      arcId: 'ARC',
      worktree: resolve(repo),
      branch: 'develop',
      mode: 'mixed',
      pid: process.pid,
      armedAt: new Date().toISOString(),
    }),
  )

  const res = roadmap(repo, 'arm', 'ARC')
  assert.equal(res.status, 0, `a live-pid same-worktree re-arm still exits 0; stderr:\n${res.stderr}`)
  assert.match(
    res.stderr,
    new RegExp(String(process.pid)),
    `stderr must name the live pid ${process.pid}; got:\n${res.stderr}`,
  )
  assert.match(res.stderr, /warn|live/i, `stderr must carry a live-lane warning; got:\n${res.stderr}`)
})

test('6) arm --inline creates the arc-mode marker at <toplevel>/roadmap/.arc-mode', () => {
  const repo = newRepo()
  assert.ok(!existsSync(arcModePath(repo)), 'no marker before arm')
  const res = roadmap(repo, 'arm', 'ARC', '--inline')
  assert.equal(res.status, 0, `arm --inline must exit 0; stderr:\n${res.stderr}`)
  assert.ok(existsSync(arcModePath(repo)), '--inline writes <repo>/roadmap/.arc-mode')
})

test('7) lifecycle round-trip: arm → status BUILDING → disarm --paused → status PAUSED → disarm → gone', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'arm', 'ARC').status, 0)

  const s1 = status(repo)
  assert.equal(s1.status, 0, `status must exit 0; stderr:\n${s1.stderr}`)
  assert.match(s1.stdout, /ARC\s+BUILDING/, `status must show ARC BUILDING; got:\n${s1.stdout}`)

  const paused = roadmap(repo, 'disarm', 'ARC', '--paused')
  assert.equal(paused.status, 0, `disarm --paused must exit 0; stderr:\n${paused.stderr}`)
  const sPaused = readSidecar(repo, 'ARC')
  assert.equal(sPaused.paused, true, '--paused rewrites the sidecar paused:true (lane not removed)')

  const s2 = status(repo)
  assert.match(s2.stdout, /ARC\s+PAUSED/, `status must show ARC PAUSED after --paused; got:\n${s2.stdout}`)

  const gone = roadmap(repo, 'disarm', 'ARC')
  assert.equal(gone.status, 0, `plain disarm must exit 0; stderr:\n${gone.stderr}`)
  assert.ok(!existsSync(sidecarPath(repo, 'ARC')), 'plain disarm removes the sidecar')

  const s3 = status(repo)
  assert.ok(
    !/ARC\s+(BUILDING|PAUSED|IN-FLIGHT)/.test(s3.stdout),
    `status must no longer list ARC as a lane; got:\n${s3.stdout}`,
  )
})

test('8) disarm releases ONLY landed claims (phase file present); unlanded claim survives', () => {
  const repo = newRepo()
  // 1900 is LANDED (a committed phase file declares it); 1901 is an unlanded reservation.
  commitPhaseFile(repo, 1900)
  const cdir = claimsDir(repo)
  mkdirSync(cdir, { recursive: true })
  writeFileSync(join(cdir, '1900.claim'), '')
  writeFileSync(join(cdir, '1901.claim'), '')

  // --inline so the marker exists and we can prove the plain disarm clears it.
  assert.equal(roadmap(repo, 'arm', 'ARC', '--inline').status, 0)
  assert.ok(existsSync(arcModePath(repo)), 'arc-mode marker present after arm --inline')

  const res = roadmap(repo, 'disarm', 'ARC')
  assert.equal(res.status, 0, `disarm must exit 0; stderr:\n${res.stderr}`)

  assert.ok(!existsSync(join(cdir, '1900.claim')), 'the LANDED claim (1900 has a phase file) is released')
  assert.ok(
    existsSync(join(cdir, '1901.claim')),
    '1901 has NO phase file → it may be another session\'s reservation → LEFT',
  )
  assert.ok(!existsSync(arcModePath(repo)), 'plain disarm clears <repo>/roadmap/.arc-mode')
})

test('9) disarm of an unknown lane: exit 2, stderr names what was not found (never a silent 0)', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'disarm', 'NOPE')
  assert.equal(res.status, 2, `disarming a nonexistent lane must exit 2; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /NOPE/, `stderr must name the missing arc; got:\n${res.stderr}`)
  assert.match(res.stderr, /not found/i, `stderr must say what was not found; got:\n${res.stderr}`)
})
