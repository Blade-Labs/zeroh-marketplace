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
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
  realpathSync,
} from 'node:fs'
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

const PLUGIN_ROOT = join(HERE, '..', '..')

/** stdout + stderr of a run, as one string — the copier's chatter arrives on stdout via stdio:'inherit'. */
function output(res) {
  return `${res.stdout}${res.stderr}`
}

test('4) init --scaffold leaves roadmap/arcs opt-in and empty — the template stays plugin-side reference material', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'init', '--scaffold')
  assert.equal(res.status, 0, `init --scaffold must exit 0; stderr:\n${res.stderr}`)

  // The directory IS still scaffolded: arcs are opt-in, and `roadmap/arcs/` is the
  // place an authored arc lands. Removing the copy step must not remove the mkdir.
  const arcsDir = join(repo, 'roadmap', 'arcs')
  assert.ok(
    existsSync(arcsDir) && statSync(arcsDir).isDirectory(),
    'scaffold still creates the roadmap/arcs/ directory (arcs are opt-in, not absent)',
  )

  // The whole listing, not just example.arc.ts — a differently-named seeded arc is
  // the same defect (a LIVE arc in a repo where no arc has been authored).
  const listing = readdirSync(arcsDir)
  assert.deepEqual(
    listing,
    [],
    `a fresh scaffold must leave roadmap/arcs/ EMPTY — no arc is live until one is authored; found: ${JSON.stringify(listing)}`,
  )
  assert.equal(
    existsSync(join(arcsDir, 'example.arc.ts')),
    false,
    'roadmap/arcs/example.arc.ts must NOT be created — a copied example is a live arc (id A, phases [1])',
  )

  // …and the copier must not narrate a file it no longer writes. One substring covers
  // both the "Created …" and the "Skipped … (already exists)" wordings.
  assert.equal(
    output(res).includes('example.arc.ts'),
    false,
    `scaffold output must never mention example.arc.ts; got:\n${output(res)}`,
  )

  // The fix is REMOVE-THE-COPY, not remove-the-template: the template stays installed
  // with the plugin as opt-in reference material for /plan-arc.
  assert.ok(
    existsSync(join(PLUGIN_ROOT, 'templates', 'example.arc.ts')),
    'plugins/zeroh-roadmap/templates/example.arc.ts must SURVIVE as plugin reference material',
  )

  // Positive control — the fix cannot be "scaffold nothing".
  assert.ok(existsSync(join(repo, 'lib', 'roadmap', 'schema.ts')), 'scaffold still created lib/roadmap/schema.ts')
  const phasesDir = join(repo, 'roadmap', 'phases')
  assert.ok(existsSync(phasesDir) && statSync(phasesDir).isDirectory(), 'scaffold still created roadmap/phases/')
  assert.ok(existsSync(join(repo, 'roadmap', 'backlog.ts')), 'scaffold still created roadmap/backlog.ts')
})

test('5) a SECOND init --scaffold is idempotent and never claims the example arc was created', () => {
  const repo = newRepo()
  const first = roadmap(repo, 'init', '--scaffold')
  assert.equal(first.status, 0, `first init --scaffold must exit 0; stderr:\n${first.stderr}`)

  const second = roadmap(repo, 'init', '--scaffold')
  assert.equal(second.status, 0, `a re-run of init --scaffold must exit 0; stderr:\n${second.stderr}`)

  const arcsDir = join(repo, 'roadmap', 'arcs')
  const listing = readdirSync(arcsDir)
  assert.deepEqual(
    listing,
    [],
    `the second scaffold must still leave roadmap/arcs/ EMPTY; found: ${JSON.stringify(listing)}`,
  )

  // The removed branch is the if/else that printed "Skipped … (already exists)" on
  // re-run — neither arm of it may survive.
  assert.equal(
    output(second).includes('example.arc.ts'),
    false,
    `the re-run must not mention example.arc.ts (created OR skipped); got:\n${output(second)}`,
  )

  assert.ok(
    existsSync(join(PLUGIN_ROOT, 'templates', 'example.arc.ts')),
    'the plugin template is still installed after two scaffolds',
  )
})
