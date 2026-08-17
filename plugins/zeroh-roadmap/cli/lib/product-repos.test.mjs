#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/product-repos.mjs (2375.2) — the derivation that turns a phase's
 * declared absolute keyFiles into the set of repositories that are NOT the arc worktree's own.
 *
 * Hermetic per D8: every case builds its own estate under mkdtempSync — a real `git init` arc
 * worktree, a real `git init` product repo, and a real `git worktree add` linked worktree to
 * prove the common-dir exclusion. Nothing here references a path outside the tmp estate.
 * Run: node --test cli/lib/product-repos.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, utimesSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'product-repos.mjs')
const { productRepos, newestKeyFileAgeMin, PRODUCT_REPO_CAP } = await import(MOD)

const tmps = []
function newTmp(prefix = 'zr-prodrepo-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
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

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

/** A real git repo with one commit (a linked worktree cannot be added to a commitless repo). */
function initRepo(dir) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'seed.txt'), 'seed\n')
  git(dir, 'add', 'seed.txt')
  git(dir, 'commit', '-q', '-m', 'seed')
  return realpathSync(dir)
}

function writeAt(path, body = 'x\n') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  return path
}

test('1) a keyFile under a SEPARATE repository yields that repository root', () => {
  const estate = newTmp()
  const arc = initRepo(join(estate, 'arc'))
  const product = initRepo(join(estate, 'product'))
  const kf = writeAt(join(product, 'src', 'a.mjs'))
  assert.deepEqual(productRepos([kf], { worktree: arc }), [product])
})

test('2) a keyFile in a LINKED WORKTREE of the arc\'s OWN repo yields nothing (common-dir match)', () => {
  // The phase 2333 case exactly: keyFiles named both the product repo AND a path in the
  // consumer repo the arc worktree is itself a linked worktree of. Comparing TOPLEVELS would
  // call the sibling checkout foreign; comparing git-common-dir is what makes it ours.
  const estate = newTmp()
  const main = initRepo(join(estate, 'consumer'))
  const linked = join(estate, 'consumer-wt-2')
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', linked)
  const linkedReal = realpathSync(linked)

  const inMain = writeAt(join(main, 'roadmap', 'backlog.ts'))
  const inLinked = writeAt(join(linkedReal, 'lib', 'thing.ts'))

  // Running FROM the linked worktree: neither the main checkout nor the linked one is foreign.
  assert.deepEqual(productRepos([inMain, inLinked], { worktree: linkedReal }), [])
  // And symmetrically from the main checkout.
  assert.deepEqual(productRepos([inLinked], { worktree: main }), [])
})

test('2b) the linked-worktree exclusion does NOT swallow a genuine product repo alongside it', () => {
  const estate = newTmp()
  const main = initRepo(join(estate, 'consumer'))
  const linked = join(estate, 'consumer-wt-2')
  git(main, 'worktree', 'add', '-q', '-b', 'wt2', linked)
  const product = initRepo(join(estate, 'product'))
  const kfOurs = writeAt(join(main, 'roadmap', 'backlog.ts'))
  const kfForeign = writeAt(join(product, 'plugins', 'x', 'y.mjs'))
  assert.deepEqual(productRepos([kfOurs, kfForeign], { worktree: realpathSync(linked) }), [product])
})

test('3) a NOT-YET-CREATED nested path still resolves through its nearest existing ancestor', () => {
  const estate = newTmp()
  const arc = initRepo(join(estate, 'arc'))
  const product = initRepo(join(estate, 'product'))
  mkdirSync(join(product, 'cli', 'lib'), { recursive: true })
  const unborn = join(product, 'cli', 'lib', 'does-not-exist-yet.mjs')
  assert.deepEqual(productRepos([unborn], { worktree: arc }), [product], 'a phase legitimately names files it has not created')
  // Even several levels of not-yet-created directories resolve to the same repo.
  const deeper = join(product, 'cli', 'lib', 'nope', 'nor', 'this.mjs')
  assert.deepEqual(productRepos([deeper], { worktree: arc }), [product])
})

test('4) a relative path, and a path in no repository at all, yield nothing and never throw', () => {
  const estate = newTmp()
  const arc = initRepo(join(estate, 'arc'))
  const loose = writeAt(join(estate, 'not-a-repo', 'file.mjs')) // real file, no git repo above it in the estate
  let out
  assert.doesNotThrow(() => {
    out = productRepos(['cli/lib/relative.mjs', './also-relative.mjs', loose], { worktree: arc })
  })
  assert.deepEqual(out, [], 'best-effort by construction: unresolvable is simply not a product repo')
})

test('4b) an empty / absent keyFiles list is inert', () => {
  const estate = newTmp()
  const arc = initRepo(join(estate, 'arc'))
  assert.deepEqual(productRepos([], { worktree: arc }), [])
  assert.deepEqual(productRepos(undefined, { worktree: arc }), [])
})

test('4c) a worktree that is not a repository yields nothing rather than calling the world foreign', () => {
  // Without our OWN common dir there is nothing to exclude against, so every repo would look
  // foreign. Returning nothing is the safe degrade: this feeds an ALIVE arm of a liveness
  // verdict, and a false ALIVE is the one direction that must never happen.
  const estate = newTmp()
  const product = initRepo(join(estate, 'product'))
  const kf = writeAt(join(product, 'src', 'a.mjs'))
  const bare = join(estate, 'plain-dir')
  mkdirSync(bare, { recursive: true })
  assert.deepEqual(productRepos([kf], { worktree: bare }), [])
})

test('5) duplicates collapse: many keyFiles in one repository yield ONE root', () => {
  const estate = newTmp()
  const arc = initRepo(join(estate, 'arc'))
  const product = initRepo(join(estate, 'product'))
  const kfs = ['a.mjs', 'b.mjs', 'nested/c.mjs', 'nested/deep/d.mjs'].map((r) => writeAt(join(product, r)))
  assert.deepEqual(productRepos(kfs, { worktree: arc }), [product])
})

test('6) more than PRODUCT_REPO_CAP distinct repositories are capped', () => {
  assert.equal(PRODUCT_REPO_CAP, 4, 'the cap is a named constant, not a magic number at the call site')
  const estate = newTmp()
  const arc = initRepo(join(estate, 'arc'))
  const kfs = []
  for (let i = 0; i < PRODUCT_REPO_CAP + 2; i++) {
    const r = initRepo(join(estate, `product-${i}`))
    kfs.push(writeAt(join(r, 'src', 'a.mjs')))
  }
  const out = productRepos(kfs, { worktree: arc })
  assert.equal(out.length, PRODUCT_REPO_CAP, 'the row can never fan out into a dozen git calls')
  assert.equal(out[0], realpathSync(join(estate, 'product-0')), 'the cap keeps declaration order, it does not shuffle')
})

test('7) newestKeyFileAgeMin reports the FRESHEST declared file age in minutes', () => {
  const estate = newTmp()
  const now = Date.now()
  const old = writeAt(join(estate, 'old.mjs'))
  const fresh = writeAt(join(estate, 'fresh.mjs'))
  const sec = (msAgo) => (now - msAgo) / 1000
  utimesSync(old, sec(90 * 60_000), sec(90 * 60_000))
  utimesSync(fresh, sec(2 * 60_000), sec(2 * 60_000))
  const age = newestKeyFileAgeMin([old, fresh], now)
  assert.ok(Math.abs(age - 2) < 0.5, `expected ~2min (the freshest), got ${age}`)
  // Order of declaration must not matter.
  assert.ok(Math.abs(newestKeyFileAgeMin([fresh, old], now) - 2) < 0.5)
})

test('7b) newestKeyFileAgeMin is null when none of the declared files exist yet', () => {
  const estate = newTmp()
  const now = Date.now()
  assert.equal(newestKeyFileAgeMin([join(estate, 'unborn.mjs')], now), null, 'null is honest; 0 would read as brand new')
  assert.equal(newestKeyFileAgeMin([], now), null)
  assert.equal(newestKeyFileAgeMin(undefined, now), null)
  // A relative path is not stat-able against an unknown cwd, so it never contributes.
  assert.equal(newestKeyFileAgeMin(['relative/path.mjs'], now), null)
})
