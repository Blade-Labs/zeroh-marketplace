#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/config.mjs (module does NOT exist yet — RED on import
 * until implemented). Hermetic-tmp-estate pattern from
 * scripts/executor-liveness.test.mjs: mkdtempSync + process.on('exit') cleanup,
 * REAL tmp git repos, no fs/network mocking. zod 4.4.3 resolves from the
 * plugin's own node_modules. Run: node --test cli/lib/config.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'config.mjs')
const SCHEMA_FILE = join(HERE, '..', 'roadmap.config.schema.json') // cli/roadmap.config.schema.json
const { RoadmapConfigShape, ConfigError, loadConfig } = await import(MOD)

// The env override is a test-only escape hatch; never inherit a stray one.
delete process.env.ROADMAP_CONFIG

const tmps = []
function newTmp(prefix = 'zr-config-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d) // macOS/tmp symlink-safe; matches gitToplevel's realpath
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

/** Call loadConfig expecting a throw; return the caught error. */
function loadErr(cwd, opts) {
  try {
    loadConfig(cwd, opts)
  } catch (e) {
    return e
  }
  return assert.fail('expected loadConfig to throw, it returned')
}

test('1) valid §1 config loads and round-trips deep-equal ($schema preserved)', () => {
  const repo = newRepo()
  const input = validConfig({ $schema: './roadmap.config.schema.json' })
  writeConfig(repo, input)
  const cfg = loadConfig(repo)
  assert.deepEqual(cfg, input)
  assert.equal(cfg.$schema, './roadmap.config.schema.json')
})

test('2) unknown TOP-LEVEL key rejects (strict) — ConfigError kind invalid', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ bogus: 1 }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
})

test('3) unknown NESTED key (gateCommands.typo) rejects (strict everywhere)', () => {
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands.typo = 'x'
  writeConfig(repo, cfg)
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
})

test('4) absence → ConfigError kind absent with the verbatim scaffold line', () => {
  const repo = newRepo() // no config written
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'absent')
  const expected =
    `roadmap: no roadmap/roadmap.config.json at ${repo} — this consumer is not configured. Scaffold one: roadmap init --config`
  assert.ok(
    err.messageLines.includes(expected),
    `messageLines must contain the verbatim scaffold line; got:\n${err.messageLines.join('\n')}`,
  )
})

test('5) pre-cutover branch diagnostic — baseRef tip carries the config', () => {
  const repo = newRepo()
  const orig = git(repo, 'branch', '--show-current')
  git(repo, 'checkout', '-q', '-b', 'base')
  writeConfig(repo, validConfig())
  git(repo, 'add', CONFIG_REL)
  git(repo, 'commit', '-qm', 'add config on base')
  git(repo, 'checkout', '-q', orig) // config now ABSENT in the working tree, present at base's tip

  const err = loadErr(repo, { baseRef: 'base' })
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'absent')
  const cutoverLine =
    `this branch predates the config cutover — merge base or copy roadmap/roadmap.config.json from it`
  assert.ok(
    err.messageLines.includes(cutoverLine),
    `messageLines must contain the verbatim pre-cutover line; got:\n${err.messageLines.join('\n')}`,
  )
})

test('5b) pre-cutover line is NOT emitted when baseRef tip lacks the config', () => {
  const repo = newRepo() // base has only seed.txt, no config anywhere
  git(repo, 'branch', 'base')
  const err = loadErr(repo, { baseRef: 'base' })
  assert.equal(err.kind, 'absent')
  assert.ok(
    !err.messageLines.some((l) => /predates the config cutover/.test(l)),
    'must not fabricate a pre-cutover hint when the base tip has no config',
  )
})

test('6) malformed config — one dotted-path line per zod issue, first line names the file', () => {
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands.types = 123 // wrong type → issue at gateCommands.types
  writeConfig(repo, cfg)
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.match(
    err.messageLines[0],
    /roadmap\.config\.json/,
    'first line names the config file path',
  )
  assert.ok(
    err.messageLines.some((l) => /^gateCommands\.types:\s/.test(l)),
    `expected a "gateCommands.types: <message>" dotted-path line; got:\n${err.messageLines.join('\n')}`,
  )
})

test('7) configVersion 2 fails loud (invalid) with a migration hint', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ configVersion: 2 }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /migrat/i.test(l)),
    `expected a migration hint; got:\n${err.messageLines.join('\n')}`,
  )
})

test('8) mergePolicy absent → loaded config invents no default policy', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig()) // no mergePolicy block
  const cfg = loadConfig(repo)
  assert.equal(cfg.mergePolicy, undefined)
})

test('8b) mergePolicy.staleBaseCeiling positive int parses (strict-key acceptance)', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      mergePolicy: {
        arcIntegration: 'autonomous',
        maxOpenFollowups: 0,
        autonomousPushRefs: ['develop'],
        primaryCheckout: '/tmp/x',
        staleBaseCeiling: 50,
      },
    }),
  )
  const cfg = loadConfig(repo)
  assert.equal(cfg.mergePolicy.staleBaseCeiling, 50)
})

test('8c) mergePolicy.staleBaseCeiling: 0 (non-positive) rejects with the key named', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      mergePolicy: {
        arcIntegration: 'autonomous',
        maxOpenFollowups: 0,
        autonomousPushRefs: ['develop'],
        primaryCheckout: '/tmp/x',
        staleBaseCeiling: 0,
      },
    }),
  )
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^mergePolicy\.staleBaseCeiling:\s/.test(l)),
    `expected a "mergePolicy.staleBaseCeiling: <message>" dotted-path line; got:\n${err.messageLines.join('\n')}`,
  )
})

test('8d) testCadence.build "arc-end" parses; absent stays absent (no invented default)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ testCadence: { enabled: true, build: 'arc-end' } }))
  const cfg = loadConfig(repo)
  assert.equal(cfg.testCadence.build, 'arc-end')

  const repo2 = newRepo()
  writeConfig(repo2, validConfig({ testCadence: { enabled: true } }))
  assert.equal(loadConfig(repo2).testCadence.build, undefined)
})

test('8e) testCadence.build outside the enum rejects with the key named', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ testCadence: { enabled: true, build: 'never' } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^testCadence\.build:\s/.test(l)),
    `expected a "testCadence.build: <message>" dotted-path line; got:\n${err.messageLines.join('\n')}`,
  )
})

test("8f) mergePolicy.arcEndSuite 'impacted' parses (strict-key acceptance)", () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      mergePolicy: {
        arcIntegration: 'autonomous',
        maxOpenFollowups: 0,
        autonomousPushRefs: ['develop'],
        primaryCheckout: '/tmp/x',
        arcEndSuite: 'impacted',
      },
    }),
  )
  const cfg = loadConfig(repo)
  assert.equal(cfg.mergePolicy.arcEndSuite, 'impacted')
})

test('8g) mergePolicy WITHOUT arcEndSuite still parses (optional key — behavior-identical when absent)', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      mergePolicy: {
        arcIntegration: 'autonomous',
        maxOpenFollowups: 0,
        autonomousPushRefs: ['develop'],
        primaryCheckout: '/tmp/x',
      },
    }),
  )
  const cfg = loadConfig(repo)
  assert.equal(cfg.mergePolicy.arcEndSuite, undefined)
})

test("8h) mergePolicy.arcEndSuite 'sometimes' (outside the enum) rejects with the key named", () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      mergePolicy: {
        arcIntegration: 'autonomous',
        maxOpenFollowups: 0,
        autonomousPushRefs: ['develop'],
        primaryCheckout: '/tmp/x',
        arcEndSuite: 'sometimes',
      },
    }),
  )
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^mergePolicy\.arcEndSuite:\s/.test(l)),
    `expected a "mergePolicy.arcEndSuite: <message>" dotted-path line; got:\n${err.messageLines.join('\n')}`,
  )
})

test('9) gateCommands.e2e "none" is accepted', () => {
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands.e2e = 'none'
  writeConfig(repo, cfg)
  const loaded = loadConfig(repo)
  assert.equal(loaded.gateCommands.e2e, 'none')
})

test('11) hygiene gateCommands (lint-diff, types-web, ratchets) — binding all three parses', () => {
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands['lint-diff'] = 'npm run lint:diff {base}'
  cfg.gateCommands['types-web'] = 'npm --prefix web run type-check'
  cfg.gateCommands['ratchets'] = 'node scripts/ratchets.mjs'
  writeConfig(repo, cfg)
  const loaded = loadConfig(repo)
  assert.equal(loaded.gateCommands['lint-diff'], 'npm run lint:diff {base}')
  assert.equal(loaded.gateCommands['types-web'], 'npm --prefix web run type-check')
  assert.equal(loaded.gateCommands['ratchets'], 'node scripts/ratchets.mjs')
})

test('11b) a hygiene slot bound to an EMPTY string fails with the key named (nonEmpty preserved)', () => {
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands['ratchets'] = '' // empty — must fail like every other command binding
  writeConfig(repo, cfg)
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^gateCommands\.ratchets:\s/.test(l)),
    `expected a "gateCommands.ratchets: <message>" dotted-path line (empty binding rejected AT the key, ` +
      `not swept up as an unrecognized key); got:\n${err.messageLines.join('\n')}`,
  )
})

test('11c) hygiene slots are OPTIONAL yet strictness holds — an unknown gateCommands key still rejects', () => {
  // the new optionals must not be added via a loosened/passthrough object
  const repo = newRepo()
  const cfg = validConfig()
  cfg.gateCommands['lint-diffs'] = 'x' // near-miss typo of the real slot — must NOT slip through
  writeConfig(repo, cfg)
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
})

test('10) DRIFT — z.toJSONSchema(RoadmapConfigShape) equals the committed schema file', () => {
  const generated = z.toJSONSchema(RoadmapConfigShape)
  const committed = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))
  assert.deepEqual(
    generated,
    committed,
    'cli/roadmap.config.schema.json is stale — rerun node cli/generate-config-schema.mjs',
  )
})
