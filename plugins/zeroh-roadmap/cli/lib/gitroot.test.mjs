#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/gitroot.mjs (module does NOT exist yet — this suite is
 * RED on import until implemented). Hermetic-tmp-estate pattern borrowed from
 * scripts/executor-liveness.test.mjs: mkdtempSync + process.on('exit') cleanup,
 * REAL tmp git repos via execFileSync('git', …) — no process/fs/network mocking.
 * Run: node --test cli/lib/gitroot.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'gitroot.mjs')
const { gitToplevel, gitCommonDir, mainCheckout } = await import(MOD)

const tmps = []
function newTmp(prefix = 'zr-gitroot-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  // realpath so macOS/tmp symlink prefixes (/var → /private/var) don't skew compares
  return realpathSync(d)
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

/** Run git in `dir` with a deterministic identity, return trimmed stdout. */
function git(dir, ...args) {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim()
}

/** A tmp git repo with one commit; returns its realpath'd root. */
function newRepo() {
  const d = newTmp()
  git(d, 'init', '-q')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  return d
}

test('1) gitToplevel returns the repo root (realpath-normalized)', () => {
  const repo = newRepo()
  assert.equal(realpathSync(gitToplevel(repo)), realpathSync(repo))
})

test('2) gitCommonDir returns <repo>/.git absolute', () => {
  const repo = newRepo()
  const common = gitCommonDir(repo)
  assert.ok(join(common).startsWith('/'), 'common dir is absolute')
  assert.equal(realpathSync(common), realpathSync(join(repo, '.git')))
})

test('3) linked worktree — common dir points at the MAIN .git, mainCheckout is the MAIN tree', () => {
  const repo = newRepo()
  const wt = newTmp('zr-gitroot-wt-')
  // git worktree add wants a fresh dir; remove the placeholder mkdtemp made.
  rmSync(wt, { recursive: true, force: true })
  git(repo, 'worktree', 'add', '-q', wt)

  // From INSIDE the worktree, the common dir is the MAIN repo's .git, NOT the
  // worktree's own `.git` file (which points into .git/worktrees/<name>).
  const common = gitCommonDir(wt)
  assert.equal(
    realpathSync(common),
    realpathSync(join(repo, '.git')),
    'common dir resolves to the shared main .git, not the worktree stub',
  )
  assert.notEqual(
    realpathSync(common),
    realpathSync(wt),
    'common dir is not the worktree tree itself',
  )
  // mainCheckout = dirname(common dir) = the main checkout tree.
  assert.equal(realpathSync(mainCheckout(wt)), realpathSync(repo))
})

test('4) non-repo dir — every function throws a typed error, never a guess', () => {
  const bare = newTmp('zr-gitroot-norepo-')
  assert.throws(() => gitToplevel(bare))
  assert.throws(() => gitCommonDir(bare))
  assert.throws(() => mainCheckout(bare))
})
