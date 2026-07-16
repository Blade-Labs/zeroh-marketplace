#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for the `roadmap` CLI dispatcher + `config check` command
 * (bin/roadmap.mjs and cli/commands/config.mjs do NOT exist yet — these suites
 * are RED until implemented: spawnSync returns non-zero / the bin is absent).
 *
 * These are WIRED tests: they SPAWN `node <plugin>/bin/roadmap.mjs …` as a real
 * subprocess and assert the universal exit-code contract (0 ok / 1 usage-config /
 * 2 check-failed) AND the stream-separation rule — ALL --json on stdout, human
 * narration on stderr. Hermetic-tmp-git-repo pattern from cli/lib/config.test.mjs
 * (mkdtempSync + realpathSync + process.on('exit') cleanup; real `git init`).
 *
 * Run: node --test cli/commands/config.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

// The path override is a test-only escape hatch; a stray one would defeat the
// git-toplevel resolution the CLI is meant to exercise. Never inherit it.
delete process.env.ROADMAP_CONFIG

const tmps = []
function newTmp(prefix = 'zr-cli-config-') {
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

/** Write an object to <repo>/roadmap/roadmap.config.json. */
function writeConfig(repo, obj) {
  mkdirSync(join(repo, 'roadmap'), { recursive: true })
  writeFileSync(join(repo, CONFIG_REL), JSON.stringify(obj, null, 2) + '\n')
}

/** A minimal §1-valid config (7 core gateCommands slots, real commands). */
function validConfig(overrides = {}) {
  return {
    configVersion: 1,
    gateCommands: {
      lint: 'npm run lint:boundaries',
      types: 'npm run type-check',
      unit: 'npm test',
      integration: 'npm run test:integration',
      build: 'npm run build',
      e2e: 'npm run test:e2e',
      emit: 'npm run emit:phases',
    },
    ...overrides,
  }
}

test('1) fresh consumer: init --config then `config check` exits 0 with `config OK` on stdout', () => {
  const repo = newRepo()
  const scaffold = roadmap(repo, 'init', '--config')
  assert.equal(scaffold.status, 0, `init --config must succeed; stderr:\n${scaffold.stderr}`)

  const res = roadmap(repo, 'config', 'check')
  assert.equal(res.status, 0, `config check must exit 0; stderr:\n${res.stderr}`)
  assert.match(res.stdout, /config OK/, 'the `config OK` line goes to STDOUT')
})

test('2) `config check --json` — pure JSON on stdout, narration on stderr, exit 0', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'init', '--config').status, 0)

  const res = roadmap(repo, 'config', 'check', '--json')
  assert.equal(res.status, 0, `--json must exit 0; stderr:\n${res.stderr}`)

  // Stream-separation invariant: stderr narration must NOT contaminate stdout —
  // stdout must be parseable JSON on its own.
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON (no narration bleed); got:\n${res.stdout}`)
  assert.equal(parsed.configVersion, 1, 'parsed config carries configVersion 1')
  assert.equal(typeof parsed.gateCommands, 'object', 'parsed config carries a gateCommands object')
  assert.notEqual(parsed.gateCommands, null)
})

test('3) unconfigured repo: `config check` exits 1 with the VERBATIM absence line on stderr', () => {
  const repo = newRepo() // no config written
  const res = roadmap(repo, 'config', 'check')
  assert.equal(res.status, 1, `absence is a usage/config error → exit 1; stderr:\n${res.stderr}`)
  const expected =
    `roadmap: no roadmap/roadmap.config.json at ${repo} — this consumer is not configured. Scaffold one: roadmap init --config`
  assert.ok(
    res.stderr.includes(expected),
    `stderr must contain the verbatim absence line.\nexpected substring:\n${expected}\ngot stderr:\n${res.stderr}`,
  )
  assert.equal(res.stdout.trim(), '', 'no `config OK` — nothing on stdout on the error path')
})

test('4) typo\'d nested key (gateCommands.typo): `config check` exits 1, stderr names gateCommands', () => {
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands.typo = 'x' // strict Zod → an "unrecognized key" issue at gateCommands.typo
  writeConfig(repo, cfg)

  const res = roadmap(repo, 'config', 'check')
  assert.equal(res.status, 1, `invalid config → exit 1; stderr:\n${res.stderr}`)
  assert.ok(
    /gateCommands\.typo/.test(res.stderr) || /unrecognized/i.test(res.stderr),
    `stderr must carry a dotted-path issue for gateCommands.typo (or the strict "unrecognized" wording); got:\n${res.stderr}`,
  )
  assert.match(res.stderr, /gateCommands/, 'the offending slot is named on stderr')
})

test('5) `roadmap --help` exits 0 and lists the command tree on stdout', () => {
  const repo = newRepo()
  const res = roadmap(repo, '--help')
  assert.equal(res.status, 0, `--help must exit 0; stderr:\n${res.stderr}`)
  for (const cmd of ['config', 'init', 'status', 'gate', 'arc']) {
    assert.ok(
      res.stdout.includes(cmd),
      `--help stdout must list the "${cmd}" command; got:\n${res.stdout}`,
    )
  }
})

test('6) `roadmap gate plan 1` — not-yet-implemented tree command exits 1 with the owning-phase note', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'init', '--config').status, 0)

  const res = roadmap(repo, 'gate', 'plan', '1')
  assert.equal(res.status, 1, `not-yet-implemented is a usage error → exit 1; stderr:\n${res.stderr}`)
  assert.match(
    res.stderr,
    /not yet implemented .*1656/,
    `stderr must carry the owning-phase not-implemented line; got:\n${res.stderr}`,
  )
})

test('7) unknown command `roadmap frobnicate` exits 1, stderr mentions unknown command', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'frobnicate')
  assert.equal(res.status, 1, `unknown command → exit 1; stderr:\n${res.stderr}`)
  assert.match(
    res.stderr,
    /unknown command/i,
    `stderr must name the unknown command; got:\n${res.stderr}`,
  )
})
