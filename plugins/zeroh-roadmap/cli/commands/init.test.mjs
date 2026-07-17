#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for `roadmap init [--config] [--scaffold]` (bin/roadmap.mjs
 * and cli/commands/init.mjs do NOT exist yet — RED until implemented).
 *
 * WIRED: SPAWN `node <plugin>/bin/roadmap.mjs …` as a real subprocess and assert
 * the exit-code contract (0 ok / 1 usage-config), the no-clobber refusal, and the
 * scaffold-through-CLI contract (init --scaffold execs scripts/scaffold-roadmap.sh).
 * Hermetic-tmp-git-repo pattern from cli/lib/config.test.mjs.
 *
 * Run: node --test cli/commands/init.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

delete process.env.ROADMAP_CONFIG

const tmps = []
function newTmp(prefix = 'zr-cli-init-') {
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

/** Spawn `node <BIN> ...args` inside `repo`; returns { status, stdout, stderr }. */
function roadmap(repo, ...args) {
  return spawnSync('node', [BIN, ...args], { cwd: repo, encoding: 'utf8' })
}

const CONFIG_REL = join('roadmap', 'roadmap.config.json')

test('1) `init --config` writes a self-consistent config that `config check` then accepts', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--config')
  assert.equal(res.status, 0, `init --config must exit 0; stderr:\n${res.stderr}`)

  const cfgPath = join(repo, CONFIG_REL)
  assert.ok(existsSync(cfgPath), 'roadmap/roadmap.config.json now exists')

  // Self-consistency: the scaffolded config must parse through the loader the
  // check command drives — a placeholder that fails its own validator is a bug.
  const check = roadmap(repo, 'config', 'check')
  assert.equal(check.status, 0, `the scaffolded config must pass config check; stderr:\n${check.stderr}`)
})

test('2) `init --config` is no-clobber: a SECOND run exits 1 and leaves the file byte-identical', () => {
  const repo = newRepo()
  const first = roadmap(repo, 'init', '--config')
  assert.equal(first.status, 0, `first init --config must succeed; stderr:\n${first.stderr}`)

  const cfgPath = join(repo, CONFIG_REL)
  const before = readFileSync(cfgPath, 'utf8')

  const second = roadmap(repo, 'init', '--config')
  assert.equal(second.status, 1, `re-running over an existing config must REFUSE → exit 1; stderr:\n${second.stderr}`)
  assert.match(
    second.stderr,
    /exists|refus/i,
    `stderr must explain the no-clobber refusal; got:\n${second.stderr}`,
  )

  const after = readFileSync(cfgPath, 'utf8')
  assert.equal(after, before, 'the refused second run must NOT rewrite the existing config')
})

test('3) `init --scaffold` execs scaffold-roadmap.sh — schema.ts + roadmap/phases/ appear', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--scaffold')
  assert.equal(res.status, 0, `init --scaffold must exit 0; stderr:\n${res.stderr}`)

  const schemaTs = join(repo, 'lib', 'roadmap', 'schema.ts')
  assert.ok(existsSync(schemaTs), 'scaffold created lib/roadmap/schema.ts')

  const phasesDir = join(repo, 'roadmap', 'phases')
  assert.ok(existsSync(phasesDir) && statSync(phasesDir).isDirectory(), 'scaffold created the roadmap/phases/ directory')
})
