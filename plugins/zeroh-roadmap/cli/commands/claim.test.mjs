#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for the `roadmap claim` command (bin/roadmap.mjs's `claim`
 * dispatch + cli/commands/claim.mjs do NOT exist yet — this suite is RED until
 * implemented: spawnSync of the missing command module returns non-zero).
 *
 * These are WIRED tests: they SPAWN `node <plugin>/bin/roadmap.mjs claim …` as a
 * real subprocess against a hermetic tmp git repo and assert the claim contract:
 *   next free number = 1 + MAX(declared phase across phases/ + archive/,
 *                              outstanding .claim reservations in BOTH claim dirs)
 * NEW claims are written to the SHARED git-common-dir claim dir
 * (<repo>/.git/zeroh-roadmap-claims); the legacy <root>/phases/.claims dir is
 * scanned READ-ONLY for the max. Non-git roots fall back to the legacy dir.
 * Creation of `<N>.claim` with the `wx` flag IS the lock (EEXIST → retry N+1).
 *
 * Hermetic-tmp-git-repo pattern from cli/commands/config.test.mjs (mkdtempSync +
 * realpathSync + process.on('exit') cleanup; real `git init`). writePhase builder
 * copied from cli/lib/phasescan.test.mjs.
 *
 * Run: node --test cli/commands/claim.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  realpathSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const tmps = []
function newTmp(prefix = 'zr-cli-claim-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d) // tmp symlink-safe; matches git-toplevel realpath
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

/** A tmp git repo with one seed commit; returns its realpath'd root. */
function newRepo() {
  const d = newTmp()
  git(d, 'init', '-q')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  return d
}

/** Spawn `node <BIN> claim ...args` inside `repo`; returns { status, stdout, stderr }. */
function claim(repo, ...args) {
  return spawnSync('node', [BIN, 'claim', ...args], { cwd: repo, encoding: 'utf8' })
}

/**
 * Write a *.phase.ts file with the given fields (copied from phasescan.test.mjs).
 * `phase` omitted ⇒ no `phase:` declaration; `status`/`arcId` omitted ⇒ absent.
 */
function writePhase(dir, fileName, { phase, status, arcId } = {}) {
  mkdirSync(dir, { recursive: true })
  const lines = ['export const p = {']
  if (phase !== undefined) lines.push(`  phase: ${phase},`)
  if (status !== undefined) lines.push(`  status: '${status}',`)
  if (arcId !== undefined) lines.push(`  arcId: '${arcId}',`)
  lines.push('}')
  const path = join(dir, fileName)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

/** The SHARED claim dir for a normal single-worktree repo = <repo>/.git/zeroh-roadmap-claims. */
function sharedClaimsDir(repo) {
  return join(repo, '.git', 'zeroh-roadmap-claims')
}

/** The LEGACY read-only claim dir = <root>/phases/.claims. */
function legacyClaimsDir(root) {
  return join(root, 'phases', '.claims')
}

/** Reserve an outstanding `<n>.claim` in `dir` (creates the dir). */
function seedClaim(dir, n) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${n}.claim`), '')
}

/** The set of `<N>.claim` numbers currently present in `dir` (empty if absent). */
function claimNumbers(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.claim'))
    .map((f) => f.replace(/\.claim$/, ''))
}

test('1) max+1 across PHASES: highest declared 1700 → prints 1701 and writes 1701.claim to the shared dir', () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1699, status: 'done', arcId: 'X' })
  writePhase(join(root, 'phases'), 'phase-b.phase.ts', { phase: 1700, status: 'backlog', arcId: 'X' })

  const res = claim(repo, 'roadmap')
  assert.equal(res.status, 0, `claim must exit 0; stderr:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '1701', `stdout must be ONLY the claimed number; got:\n${res.stdout}`)
  assert.ok(
    existsSync(join(sharedClaimsDir(repo), '1701.claim')),
    `1701.claim must land in the shared <repo>/.git/zeroh-roadmap-claims dir`,
  )
})

test('2) ARCHIVE counts: a higher declared 1800 under roadmap/archive raises the max → prints 1801', () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })
  writePhase(join(root, 'archive'), 'phase-x.phase.ts', { phase: 1800, status: 'historical', arcId: 'X' })

  const res = claim(repo, 'roadmap')
  assert.equal(res.status, 0, `claim must exit 0; stderr:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '1801', 'archive numbers raise the max')
})

test('3) OUTSTANDING claims count: max declared 1700 + an existing 1701.claim → prints 1702', () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })
  seedClaim(sharedClaimsDir(repo), 1701) // an outstanding reservation is taken

  const res = claim(repo, 'roadmap')
  assert.equal(res.status, 0, `claim must exit 0; stderr:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '1702', 'an outstanding reservation is counted toward the max')
})

test('4) LEGACY .claims read-only: legacy 1750.claim raises the max → prints 1751 into the SHARED dir', () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })
  seedClaim(legacyClaimsDir(root), 1750) // legacy dir scanned for the max only

  const res = claim(repo, 'roadmap')
  assert.equal(res.status, 0, `claim must exit 0; stderr:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '1751', 'the legacy dir is scanned for the max')
  assert.ok(
    existsSync(join(sharedClaimsDir(repo), '1751.claim')),
    'the NEW claim lands in the SHARED dir',
  )
  assert.ok(
    !existsSync(join(legacyClaimsDir(root), '1751.claim')),
    'the NEW claim must NOT be written to the legacy read-only dir',
  )
})

test('5) ATOMICITY / EEXIST-skip: a pre-created 1701.claim forces a skip to 1702, leaving 1701 intact', () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })
  const shared = sharedClaimsDir(repo)
  seedClaim(shared, 1701) // candidate already exists → wx create EEXISTs

  // Note: an outstanding 1701.claim also raises the max to 1701, so the candidate
  // 1702 is free; either way the pre-created 1701 must be untouched and NOT re-claimed.
  const res = claim(repo, 'roadmap')
  assert.equal(res.status, 0, `claim must exit 0; stderr:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '1702', 'the EEXIST candidate is skipped, not overwritten')
  assert.ok(existsSync(join(shared, '1701.claim')), 'the pre-created 1701.claim is left intact')
  assert.ok(existsSync(join(shared, '1702.claim')), 'the claimed 1702.claim is created')
})

test('6) 10 PARALLEL claims yield 10 DISTINCT numbers', async () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })

  const runOne = () =>
    new Promise((resolve, reject) => {
      const child = spawn('node', [BIN, 'claim', 'roadmap'], { cwd: repo, encoding: 'utf8' })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => {
        out += d
      })
      child.stderr.on('data', (d) => {
        err += d
      })
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, out, err }))
    })

  const results = await Promise.all(Array.from({ length: 10 }, runOne))
  for (const r of results) {
    assert.equal(r.code, 0, `every parallel claim must exit 0; stderr:\n${r.err}`)
  }
  const numbers = results.map((r) => r.out.trim())
  const distinct = new Set(numbers)
  assert.equal(distinct.size, 10, `10 concurrent claims must be distinct; got: ${JSON.stringify(numbers)}`)

  // And the reservation files must match the printed numbers, one lock per claim.
  const onDisk = new Set(claimNumbers(sharedClaimsDir(repo)))
  for (const n of numbers) {
    assert.ok(onDisk.has(n), `claimed number ${n} must have a persisted ${n}.claim lock`)
  }
})

test('7) --count 3: prints 3 numbers one per line and creates 3 .claim files in the shared dir', () => {
  const repo = newRepo()
  const root = join(repo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })

  const res = claim(repo, 'roadmap', '--count', '3')
  assert.equal(res.status, 0, `claim --count must exit 0; stderr:\n${res.stderr}`)
  const lines = res.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  assert.deepEqual(lines, ['1701', '1702', '1703'], `three consecutive numbers, one per line; got:\n${res.stdout}`)

  const shared = sharedClaimsDir(repo)
  for (const n of ['1701', '1702', '1703']) {
    assert.ok(existsSync(join(shared, `${n}.claim`)), `${n}.claim must be created in the shared dir`)
  }
})

test('8) NON-REPO fallback: a non-git root prints max+1 and writes the claim into the legacy .claims dir', () => {
  const nonRepo = newTmp() // NO git init
  const root = join(nonRepo, 'roadmap')
  writePhase(join(root, 'phases'), 'phase-a.phase.ts', { phase: 1700, status: 'done', arcId: 'X' })

  const res = spawnSync('node', [BIN, 'claim', 'roadmap'], { cwd: nonRepo, encoding: 'utf8' })
  assert.equal(res.status, 0, `non-repo claim must exit 0; stderr:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '1701', 'max+1 without git')
  assert.ok(
    existsSync(join(legacyClaimsDir(root), '1701.claim')),
    'a non-git root falls back to writing the claim in <root>/phases/.claims',
  )
})
