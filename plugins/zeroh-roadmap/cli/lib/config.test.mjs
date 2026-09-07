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
import { MODEL_PRESETS } from './roles.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'config.mjs')
const SCHEMA_FILE = join(HERE, '..', 'roadmap.config.schema.json') // cli/roadmap.config.schema.json
const { RoadmapConfigShape, ConfigError, loadConfig, DEFAULT_WORKTREE_GC, worktreeGcPolicyOf, DeliveryPolicyShape, deliveryPolicyOf } = await import(MOD)

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
    `roadmap: no roadmap.config.json at ${join(repo, 'roadmap', 'roadmap.config.json')} — this consumer is not configured. Scaffold one: roadmap init --config`
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

test('8f3) top-level lintDiffMatches parses (strict-key acceptance); an empty array rejects', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ lintDiffMatches: ['src/**', 'web/src/**'] }))
  const cfg = loadConfig(repo)
  assert.deepEqual(cfg.lintDiffMatches, ['src/**', 'web/src/**'])
  const repo2 = newRepo()
  writeConfig(repo2, validConfig({ lintDiffMatches: [] }))
  const err = loadErr(repo2)
  assert.ok(err instanceof ConfigError, 'an empty estate list is a config error, not silent lint-everything')
})

test("8f2) mergePolicy.arcEndSuite 'defer-ci' parses (local suites skipped, CI is the gate)", () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      mergePolicy: {
        arcIntegration: 'autonomous',
        maxOpenFollowups: 0,
        autonomousPushRefs: ['develop'],
        primaryCheckout: '/tmp/x',
        arcEndSuite: 'defer-ci',
      },
    }),
  )
  const cfg = loadConfig(repo)
  assert.equal(cfg.mergePolicy.arcEndSuite, 'defer-ci')
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

test('11d) gateCommands keeps seven required base rows and accepts exactly the supported optional rows', () => {
  const supported = [
    'lint-diff',
    'types-web',
    'ratchets',
    'unit-scoped',
    'integration-scoped',
    'unit-impacted',
    'integration-impacted',
    'unit-affected',
    'integration-affected',
  ]
  const repo = newRepo()
  const cfg = validConfig()
  for (const key of supported) cfg.gateCommands[key] = `node runner.mjs ${key}`
  writeConfig(repo, cfg)
  const loaded = loadConfig(repo)
  assert.equal(Object.keys(loaded.gateCommands).length, 16, 'seven base rows plus nine supported optionals')
  assert.deepEqual(Object.keys(loaded.gateCommands).slice(0, 7), Object.keys(validConfig().gateCommands))

  const badRepo = newRepo()
  const bad = validConfig()
  bad.gateCommands['unit-affectd'] = 'nx affected --target=test'
  writeConfig(badRepo, bad)
  const err = loadErr(badRepo)
  assert.ok(err instanceof ConfigError)
  assert.ok(err.messageLines.some((line) => /gateCommands\.unit-affectd|unrecognized/i.test(line)))
})

test('12) gateConditionalSlots — a bound array of {whenDiffMatches, slot} entries parses', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      gateConditionalSlots: [
        { whenDiffMatches: ['src/contracts/**'], slot: 'integration' },
        { whenDiffMatches: ['web/**', 'office/**'], slot: 'unit' },
      ],
    }),
  )
  const cfg = loadConfig(repo)
  assert.equal(cfg.gateConditionalSlots.length, 2)
  assert.deepEqual(cfg.gateConditionalSlots[0], {
    whenDiffMatches: ['src/contracts/**'],
    slot: 'integration',
  })
  assert.deepEqual(cfg.gateConditionalSlots[1].whenDiffMatches, ['web/**', 'office/**'])
})

test('12b) gateConditionalSlots absent → stays absent (no invented default)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig())
  assert.equal(loadConfig(repo).gateConditionalSlots, undefined)
})

test('12c) gateConditionalSlots — an unknown MEMBER key rejects (strictObject), the entry named', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      gateConditionalSlots: [{ whenDiffMatches: ['src/**'], slot: 'unit', bogus: 1 }],
    }),
  )
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^gateConditionalSlots\.0(\.|:\s)/.test(l)),
    `expected an issue scoped to the entry (gateConditionalSlots.0…), not a root-level ` +
      `unrecognized-key line; got:\n${err.messageLines.join('\n')}`,
  )
})

test('12d) gateConditionalSlots — an EMPTY whenDiffMatches array rejects with the key named (min(1))', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      gateConditionalSlots: [{ whenDiffMatches: [], slot: 'unit' }],
    }),
  )
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^gateConditionalSlots\.0\.whenDiffMatches:\s/.test(l)),
    `expected a "gateConditionalSlots.0.whenDiffMatches: <message>" dotted-path line; ` +
      `got:\n${err.messageLines.join('\n')}`,
  )
})

test('12e) gateConditionalSlots — an EMPTY slot string rejects with the key named (nonEmpty)', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      gateConditionalSlots: [{ whenDiffMatches: ['src/**'], slot: '' }],
    }),
  )
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^gateConditionalSlots\.0\.slot:\s/.test(l)),
    `expected a "gateConditionalSlots.0.slot: <message>" dotted-path line; got:\n${err.messageLines.join('\n')}`,
  )
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

// ── executionIsolation (phase 2146.3) ───────────────────────────────────────

test('executionIsolation: absent reads primary through the accessor, and the raw parse invents nothing', async () => {
  const { executionIsolationOf } = await import(MOD)
  const repo = newRepo()
  writeConfig(repo, validConfig())
  const cfg = loadConfig(repo)
  assert.equal(cfg.executionIsolation, undefined, 'the raw parse invents nothing (round-trip identity holds)')
  assert.equal(executionIsolationOf(cfg), 'primary', 'absent knob = exactly today’s behavior')
})

test('executionIsolation: "worktree" round-trips and the accessor honors it', async () => {
  const { executionIsolationOf } = await import(MOD)
  const repo = newRepo()
  writeConfig(repo, validConfig({ executionIsolation: 'worktree' }))
  const cfg = loadConfig(repo)
  assert.equal(cfg.executionIsolation, 'worktree')
  assert.equal(executionIsolationOf(cfg), 'worktree')
})

test('executionIsolation: an unknown value fails the parse loud, naming the field', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ executionIsolation: 'chroot' }))
  const e = loadErr(repo)
  assert.ok(/executionIsolation/.test(String(e.message)), `the refusal names the field; got: ${e.message}`)
})

// ── capacity (phase 11.2) — the OPTIONAL per-box executor-admission policy ──────────────────
// The block only sets policy bounds; capacity.mjs spreads it over DEFAULT_CAPACITY, so every
// field is optional and an absent field must stay ABSENT (a shape-level default would overwrite
// the module default and break the byte-faithful round-trip test 1 relies on).

test('capacity: a FULL block parses and round-trips all four values deep-equal', () => {
  const repo = newRepo()
  const capacity = {
    memPerExecutorMb: 6144,
    minFreeMemMb: 4096,
    loadPerExecutor: 2,
    maxExecutors: 3,
  }
  const input = validConfig({ capacity })
  writeConfig(repo, input)
  const cfg = loadConfig(repo)
  assert.deepEqual(cfg, input, 'the whole config still round-trips byte-faithful with capacity bound')
  assert.deepEqual(
    cfg.capacity,
    capacity,
    'all four policy fields survive the parse with their exact values (no coercion, no drop)',
  )
})

test('capacity: a PARTIAL block round-trips EXACTLY the keys given (no invented per-field defaults)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ capacity: { maxExecutors: 1 } }))
  const cfg = loadConfig(repo)
  assert.deepEqual(
    cfg.capacity,
    { maxExecutors: 1 },
    'every other field stays ABSENT — the shape must not materialize defaults that would ' +
      'shadow capacity.mjs DEFAULT_CAPACITY in the { ...DEFAULT_CAPACITY, ...config } spread',
  )
  assert.deepEqual(Object.keys(cfg.capacity), ['maxExecutors'])
})

test('capacity: an EMPTY block {} parses (present-but-blank policy = every default stands)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ capacity: {} }))
  const cfg = loadConfig(repo)
  assert.deepEqual(cfg.capacity, {}, 'a blank block is legal and stays blank')
})

test('capacity: absent → stays absent; the key is never materialized (parses exactly as today)', () => {
  const repo = newRepo()
  const input = validConfig() // no capacity block
  writeConfig(repo, input)
  const cfg = loadConfig(repo)
  assert.deepEqual(cfg, input, 'a config with no capacity block parses exactly as it does today')
  assert.equal(cfg.capacity, undefined)
  assert.ok(
    !('capacity' in cfg),
    'the optional block must not appear as a key at all (an invented {} default would ' +
      'break round-trip identity for every consumer that never opted in)',
  )
})

test('capacity: an unknown key INSIDE the block rejects, scoped to capacity (strictObject, not passthrough)', () => {
  const repo = newRepo()
  writeConfig(
    repo,
    validConfig({
      // near-miss typo of the real field — a passthrough/loose block would silently accept it
      // and the box would run on DEFAULT_CAPACITY.maxExecutors while the operator believed 6.
      capacity: { memPerExecutorMb: 6144, maxExecutor: 6 },
    }),
  )
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^capacity:\s/.test(l) && /maxExecutor/.test(l)),
    `expected the unrecognized-key issue scoped to the block ("capacity: Unrecognized key: ` +
      `\\"maxExecutor\\"") — NOT a root-level line rejecting the whole capacity key, and not ` +
      `silent acceptance; got:\n${err.messageLines.join('\n')}`,
  )
})

test('capacity: a non-integer field rejects with the field named (integer contract)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ capacity: { memPerExecutorMb: 6144.5 } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^capacity\.memPerExecutorMb:\s/.test(l)),
    `expected a "capacity.memPerExecutorMb: <message>" dotted-path line; got:\n${err.messageLines.join('\n')}`,
  )

  const repo2 = newRepo()
  writeConfig(repo2, validConfig({ capacity: { maxExecutors: '3' } })) // string, not int
  const err2 = loadErr(repo2)
  assert.ok(err2 instanceof ConfigError)
  assert.ok(
    err2.messageLines.some((l) => /^capacity\.maxExecutors:\s/.test(l)),
    `expected a "capacity.maxExecutors: <message>" dotted-path line (a stringly-typed bound ` +
      `must not slip through); got:\n${err2.messageLines.join('\n')}`,
  )
})

test('capacity: zero rejects, one parses (positive-integer boundary — a zero bound would divide the admission math by zero)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ capacity: { memPerExecutorMb: 0 } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.ok(
    err.messageLines.some((l) => /^capacity\.memPerExecutorMb:\s/.test(l)),
    `expected a "capacity.memPerExecutorMb: <message>" rejection for 0; got:\n${err.messageLines.join('\n')}`,
  )

  const repo2 = newRepo()
  writeConfig(repo2, validConfig({ capacity: { memPerExecutorMb: 1 } }))
  const cfg = loadConfig(join(repo2, 'roadmap'))
  assert.equal(cfg.capacity.memPerExecutorMb, 1)
})

// ── modelPolicy (phase 24.2) — preset, default lead, per-role map ───────────────────────
// The resolver already ANSWERS to `{ preset, default, roles, judgeModel }` (task 24.1,
// cli/lib/roles.mjs leadFor); until this shape opens, no repo can WRITE one — ModelPolicyShape
// is `{ judgeModel: z.string() }` and STRICT, so every key below is an "Unrecognized key" today
// and `{}` fails for want of judgeModel. What these cases enforce is the loader contract the
// rest of the phase leans on: round-trip identity (loadConfig invents nothing, so the block a
// repo wrote is exactly the policy arm/codex-run later record as in force — task 24.3) and a
// NAMED refusal at the dotted path for every malformed spelling.

const PRESET_NAMES = Object.keys(MODEL_PRESETS)

test('modelPolicy: EVERY preset the resolver ships is spellable in config, and round-trips verbatim', () => {
  assert.deepEqual(
    PRESET_NAMES,
    ['claude', 'codex', 'codex-full'],
    'fixture guard: the three ruled presets (cli/lib/roles.mjs MODEL_PRESETS) are what a config may name',
  )
  for (const preset of PRESET_NAMES) {
    const repo = newRepo()
    const input = validConfig({ modelPolicy: { preset } })
    writeConfig(repo, input)
    assert.deepEqual(
      loadConfig(repo),
      input,
      `preset '${preset}' must parse and round-trip byte-faithful — a preset the RESOLVER honors but ` +
        `the LOADER rejects is a policy no consumer can ever opt into (cli/lib/config.mjs ModelPolicyShape)`,
    )
  }
})

test('modelPolicy: an UNKNOWN preset is refused at modelPolicy.preset, naming every legal preset', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ modelPolicy: { preset: 'gpt' } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  const line = err.messageLines.find((l) => /^modelPolicy\.preset:\s/.test(l))
  assert.ok(
    line,
    `expected a "modelPolicy.preset: <message>" dotted-path line — the operator must be told WHICH key ` +
      `is wrong, not that the block as a whole is; got:\n${err.messageLines.join('\n')}`,
  )
  for (const preset of PRESET_NAMES) {
    assert.ok(
      line.includes(preset),
      `the refusal must list the legal preset '${preset}' — a typo'd preset is a one-word fix and the ` +
        `message is the only place the legal set is written down; got:\n${line}`,
    )
  }
})

test('modelPolicy: every key is OPTIONAL — an empty block parses as "the roles table, unchanged"', () => {
  const repo = newRepo()
  const input = validConfig({ modelPolicy: {} })
  writeConfig(repo, input)
  assert.deepEqual(
    loadConfig(repo),
    input,
    '`{}` is the table (cli/lib/roles.mjs: an empty policy leads nothing) — requiring any key would ' +
      'force a repo that only wants ONE of preset/default/roles to invent the others',
  )
})

test('modelPolicy: preset + default + roles + legacy judgeModel coexist in ONE block, round-tripped verbatim', () => {
  const repo = newRepo()
  const input = validConfig({
    modelPolicy: {
      preset: 'codex',
      default: 'sol',
      roles: { 'software-architect': 'fable', 'test-engineer': 'opus' },
      judgeModel: 'fable',
    },
  })
  writeConfig(repo, input)
  const cfg = loadConfig(repo)
  assert.deepEqual(
    cfg,
    input,
    'the four keys are one policy object handed to resolveRole whole — a loader that dropped, ' +
      'reordered or defaulted any of them would silently re-route roles the repo never named',
  )
  assert.deepEqual(
    cfg.modelPolicy.roles,
    input.modelPolicy.roles,
    'the per-role map is a free record of role-id → model spelling; nothing in the loader may prune it',
  )
})

test('modelPolicy: the LEGACY judgeModel-only block still parses (every shipped consumer config spells it)', () => {
  const repo = newRepo()
  const input = validConfig({ modelPolicy: { judgeModel: 'fable' } })
  writeConfig(repo, input)
  assert.deepEqual(
    loadConfig(repo),
    input,
    'judgeModel is the key every consumer already carries — opening the shape must not break it',
  )
})

test('modelPolicy stays STRICT: an unknown key inside the block is refused, naming the offender', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ modelPolicy: { preset: 'codex', builderModel: 'sol' } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^modelPolicy:\s/.test(l) && l.includes('builderModel')),
    `a typo'd policy key must be an ERROR that names it, never a silent no-op that leaves the repo ` +
      `on Opus believing it opted into codex; got:\n${err.messageLines.join('\n')}`,
  )
})

test('modelPolicy.roles: a non-string lead is refused at its OWN dotted path (role id included)', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ modelPolicy: { roles: { 'software-developer': 5 } } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^modelPolicy\.roles\.software-developer:\s/.test(l)),
    `expected a "modelPolicy.roles.software-developer: <message>" line — the map's VALUES are model ` +
      `spellings, and the failing entry must be named; got:\n${err.messageLines.join('\n')}`,
  )
})

test('modelPolicy.default: an empty-string lead is refused rather than read as "no lead"', () => {
  const repo = newRepo()
  writeConfig(repo, validConfig({ modelPolicy: { default: '' } }))
  const err = loadErr(repo)
  assert.ok(err instanceof ConfigError)
  assert.equal(err.kind, 'invalid')
  assert.ok(
    err.messageLines.some((l) => /^modelPolicy\.default:\s/.test(l)),
    `'' is not a model — it must fail the parse, not reach leadFor as a falsy lead that resolves to ` +
      `the table while the repo believes it set a default; got:\n${err.messageLines.join('\n')}`,
  )
})

test('modelPolicy model values use the alias vocabulary — typos fail at their own paths', () => {
  const cases = [
    [{ default: 'gpt' }, 'modelPolicy.default'],
    [{ judgeModel: 'gpt' }, 'modelPolicy.judgeModel'],
    [{ roles: { 'software-developer': 'gpt' } }, 'modelPolicy.roles.software-developer'],
  ]
  for (const [modelPolicy, path] of cases) {
    const repo = newRepo()
    writeConfig(repo, validConfig({ modelPolicy }))
    const err = loadErr(repo)
    assert.ok(err instanceof ConfigError)
    assert.ok(err.messageLines.some((line) => line.startsWith(`${path}:`) && line.includes('sol')), err.message)
  }
})

test('40.7 worktreeGc defaults remain disabled and bounded when the block is absent', () => {
  const parsed = RoadmapConfigShape.parse(validConfig())
  assert.equal(parsed.worktreeGc, undefined, 'raw parsing preserves the authored optional shape')
  assert.deepEqual(worktreeGcPolicyOf(parsed), {
    enabled: false,
    inactiveObservations: 2,
    inactiveIntervalMs: 60_000,
    deleteIntegratedBranches: false,
  })
  assert.ok(Object.isFrozen(DEFAULT_WORKTREE_GC), 'shared defaults cannot drift through caller mutation')
})

test('40.7 worktreeGc accepts one strict bounded policy and rejects unsafe thresholds or unknown keys', () => {
  const accepted = { enabled: true, inactiveObservations: 3, inactiveIntervalMs: 1, deleteIntegratedBranches: true }
  assert.deepEqual(RoadmapConfigShape.parse(validConfig({ worktreeGc: accepted })).worktreeGc, accepted)
  for (const worktreeGc of [
    { ...accepted, inactiveObservations: 1 },
    { ...accepted, inactiveIntervalMs: 0 },
    { ...accepted, inactivityMs: 60_000 },
    { ...accepted, enabled: 'yes' },
  ]) assert.throws(() => RoadmapConfigShape.parse(validConfig({ worktreeGc })), /worktreeGc|unrecognized|number|boolean/i)
})

test('deliveryPolicy absence preserves raw config and yields safe unresolved defaults',()=>{
 const input=validConfig(),parsed=RoadmapConfigShape.parse(input);assert.deepEqual(parsed,input);assert.equal(Object.hasOwn(parsed,'deliveryPolicy'),false)
 assert.deepEqual(deliveryPolicyOf(parsed),{providerId:'github',remote:'origin',defaultBaseRef:null,terminal:'open',allowedPushRefs:null,requiredCapabilities:['create','lookup','pull-request','push','update'],requiredChecks:null,strategy:{}})
})
test('deliveryPolicy derives terminal capabilities and preserves explicit strategy declarations',()=>{
 const policy={provider:'github',remote:'upstream',defaultBase:'refs/heads/release',terminal:'merge',allowedPushRefs:[],requiredCapabilities:['audit','push'],requiredChecks:['lint','unit'],branchStrategy:{A:{kind:'independent'},B:{kind:'stacked',predecessorArcId:'A'},C:{kind:'grouped',groupId:'release-one',order:0}}}
 const result=deliveryPolicyOf(RoadmapConfigShape.parse(validConfig({deliveryPolicy:policy})))
 assert.deepEqual(result,{providerId:'github',remote:'upstream',defaultBaseRef:'refs/heads/release',terminal:'merge',allowedPushRefs:[],requiredCapabilities:['audit','create','lookup','merge','pull-request','push','update'],requiredChecks:['lint','unit'],strategy:policy.branchStrategy})
 const onlyStack=deliveryPolicyOf(RoadmapConfigShape.parse(validConfig({deliveryPolicy:{branchStrategy:{B:{kind:'stacked',predecessorArcId:'A'}}}})))
 assert.equal(Object.hasOwn(onlyStack.strategy,'A'),false)
})
test('deliveryPolicy queue adds one capability and retains exact allowed refs',()=>{
 const policy=deliveryPolicyOf(RoadmapConfigShape.parse(validConfig({deliveryPolicy:{terminal:'queue',allowedPushRefs:['refs/heads/roadmap/arc-a'],requiredCapabilities:['queue','pull-request'],requiredChecks:['unit']}})))
 assert.deepEqual(policy.requiredCapabilities,['create','lookup','pull-request','push','queue','update']);assert.deepEqual(policy.allowedPushRefs,['refs/heads/roadmap/arc-a'])
})
test('deliveryPolicy refuses unknown fields, unsafe refs and duplicate declarations',()=>{
 const invalid=[{surprise:true},{authority:{merge:true}},{provider:'gitlab'},{remote:''},{remote:'origin\0other'},{defaultBase:''},{terminal:'ship'},{allowedPushRefs:['main']},{allowedPushRefs:['refs/heads/*']},{allowedPushRefs:['refs/heads/main','refs/heads/main']},{requiredCapabilities:['push','push']},{requiredCapabilities:['']},{requiredChecks:[]},{requiredChecks:['unit','unit']},{branchStrategy:{A:{kind:'independent',predecessorArcId:'B'}}},{branchStrategy:{A:{kind:'stacked',predecessorArcId:''}}},{branchStrategy:{A:{kind:'grouped',groupId:'',order:0}}},{branchStrategy:{A:{kind:'grouped',groupId:'release',order:-1}}}]
 for(const deliveryPolicy of invalid)assert.throws(()=>RoadmapConfigShape.parse(validConfig({deliveryPolicy})),/deliveryPolicy|provider|remote|ref|unique|check|capabil|strategy|unrecognized|too small|invalid/i,JSON.stringify(deliveryPolicy))
})
test('deliveryPolicy ignores legacy local integration authority',()=>{
 const baseline=deliveryPolicyOf(RoadmapConfigShape.parse(validConfig()))
 assert.deepEqual(deliveryPolicyOf(RoadmapConfigShape.parse(validConfig({mergePolicy:{arcIntegration:'autonomous',maxOpenFollowups:0,autonomousPushRefs:['refs/heads/everything'],primaryCheckout:'/tmp/x'}}))),baseline)
})
test('DeliveryPolicyShape is strict and raw parsing adds no defaults',()=>{
 assert.deepEqual(DeliveryPolicyShape.parse({}),{});assert.throws(()=>DeliveryPolicyShape.parse({allowedPushRefs:['refs/heads/main'],unknown:true}),/unrecognized|unknown/i)
})


test('delivery JSON schema exposes uniqueness, nonempty checks and exact safe branch refs',()=>{
 const delivery=JSON.parse(readFileSync(SCHEMA_FILE,'utf8')).properties.deliveryPolicy
 assert.equal(delivery.additionalProperties,false)
 for(const field of ['allowedPushRefs','requiredCapabilities','requiredChecks'])assert.equal(delivery.properties[field].uniqueItems,true,field)
 assert.equal(delivery.properties.requiredChecks.minItems,1)
 const item=delivery.properties.allowedPushRefs.items
 const patterns=[...(item.pattern?[item.pattern]:[]),...(item.allOf??[]).filter(x=>x.pattern).map(x=>x.pattern)].map(pattern=>new RegExp(pattern))
 assert.ok(patterns.length)
 for(const ref of ['refs/heads/main','refs/heads/roadmap/arc-a'])assert.ok(patterns.every(pattern=>pattern.test(ref)),ref)
 for(const ref of ['main','refs/heads/*','refs/heads/a/','refs/heads/a.','refs/heads/a//b','refs/heads/.a','refs/heads/a.lock/b','refs/heads/a.lock']){
  assert.ok(patterns.some(pattern=>!pattern.test(ref)),ref)
  assert.equal(DeliveryPolicyShape.safeParse({allowedPushRefs:[ref]}).success,false,ref)
 }
})
