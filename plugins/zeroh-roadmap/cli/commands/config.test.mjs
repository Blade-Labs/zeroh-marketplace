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

test('6) `roadmap debt` — a not-yet-implemented tree command exits 1 with the owning-phase note', () => {
  // (gate/result/contract/phase landed in 1656; audit/measure landed in 1659; debt still lands in 1658.)
  const repo = newRepo()
  assert.equal(roadmap(repo, 'init', '--config').status, 0)

  const res = roadmap(repo, 'debt')
  assert.equal(res.status, 1, `not-yet-implemented is a usage error → exit 1; stderr:\n${res.stderr}`)
  assert.match(
    res.stderr,
    /not yet implemented .*1658/,
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

// ════════════════════════════════════════════════════════════════════════════
// Schema drift — `config check` is where a consumer LEARNS its schema predates the plugin
// ════════════════════════════════════════════════════════════════════════════
// A consumer whose lib/roadmap/schema.ts is missing a shape loses every downstream sample
// silently (the bridge's shape-parse exits 4 and the record is dropped), and the scorecard then
// reads as NO DATA instead of as a broken pipe. `roadmap audit` reports it as HIGH; this surface
// is the one an operator runs while CONFIGURING, so it says the same thing as a line.
//
// Fixture form matches cli/commands/audit.test.mjs: lib/roadmap/schema.ts is either the
// `export * from '<templates>'` re-export (in sync) or a real copy with an export demoted to a
// plain `const` (stale), plus a node_modules/zod symlink so the file resolves as a consumer's own.
import { readFileSync, symlinkSync } from 'node:fs'

const PLUGIN_ROOT = join(HERE, '..', '..')
const SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))

const DRIFT_SHAPE = 'PhaseEvalRecordShape'
const NAMES_CONSEQUENCE = /samples?|scorecard/i
const NAMES_REMEDY = /re-?vendor|re-?sync/i

/** Give `repo` a lib/roadmap/schema.ts (plus the zod symlink a consumer schema resolves through). */
function putSchema(repo, source) {
  mkdirSync(join(repo, 'lib', 'roadmap'), { recursive: true })
  mkdirSync(join(repo, 'node_modules'), { recursive: true })
  try {
    symlinkSync(PLUGIN_ZOD, join(repo, 'node_modules', 'zod'), 'dir')
  } catch {
    /* already linked */
  }
  writeFileSync(join(repo, 'lib', 'roadmap', 'schema.ts'), source)
}

const inSyncSchema = () => `export * from '${SCHEMA}'\n`

/** templates/schema.ts with `export const <name>` demoted to `const` — the export vanishes while
 *  every internal reference still resolves, exactly like a consumer that skipped a re-vendor. */
function staleSchemaSource(name) {
  const src = readFileSync(SCHEMA, 'utf8')
  const decl = `export const ${name} = `
  assert.ok(src.includes(decl), `fixture precondition: templates/schema.ts must export ${name}`)
  return src.replace(decl, `const ${name} = `)
}

/** A configured git repo carrying `schemaSource` as its consumer schema. */
function configuredRepo(schemaSource) {
  const repo = newRepo()
  writeConfig(repo, validConfig())
  putSchema(repo, schemaSource)
  return repo
}

test('8) stale consumer schema: `config check` prints a drift line naming the shape, the consequence and the re-vendor remedy', () => {
  const repo = configuredRepo(staleSchemaSource(DRIFT_SHAPE))

  const res = roadmap(repo, 'config', 'check')
  const line = res.stderr.split('\n').find((l) => l.includes(DRIFT_SHAPE))
  assert.ok(
    line,
    `stderr must carry a line naming the missing export — without it the operator's only signal is a scorecard that says "no data"; got stderr:\n${res.stderr}`,
  )
  assert.match(
    line,
    NAMES_CONSEQUENCE,
    `the line must name the CONSEQUENCE (the samples/scorecard go silent), not just the absent symbol; got: ${line}`,
  )
  assert.match(line, NAMES_REMEDY, `and the re-vendor remedy; got: ${line}`)
  assert.ok(line.includes('lib/roadmap/schema.ts'), `naming the ONE file to re-vendor into; got: ${line}`)

  // The config document itself is VALID — a drifted vendored file is not a ConfigError, and
  // exit 1 here would fail every gate that runs `config check` on a repo the audit already
  // reports as BROKEN. The severity call belongs to `roadmap audit` (HIGH → exit 2).
  assert.equal(res.status, 0, `a valid config with a stale schema still exits 0; stderr:\n${res.stderr}`)
  assert.match(res.stdout, /config OK/, 'and stdout keeps its one line — narration never bleeds across the streams')
})

test('9) stale consumer schema + `--json`: the drift line is on stderr, stdout stays PURE JSON', () => {
  const repo = configuredRepo(staleSchemaSource(DRIFT_SHAPE))

  const res = roadmap(repo, 'config', 'check', '--json')
  assert.ok(res.stderr.includes(DRIFT_SHAPE), `the warning still fires under --json; got stderr:\n${res.stderr}`)

  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON — a warning printed there breaks every caller that pipes this into jq; got:\n${res.stdout}`)
  assert.equal(parsed.configVersion, 1, 'and the parsed config is unchanged by the warning')
  assert.equal(res.status, 0)
})

test('10) in-sync consumer schema: `config check` says nothing about drift, in either output mode', () => {
  // Silence is half the criterion: a check that warns on a healthy consumer gets muted, and
  // then the real drift goes past unread. The `export * from` re-export IS the in-sync form.
  const repo = configuredRepo(inSyncSchema())

  for (const args of [['config', 'check'], ['config', 'check', '--json']]) {
    const res = roadmap(repo, ...args)
    assert.equal(res.status, 0, `${args.join(' ')} must exit 0; stderr:\n${res.stderr}`)
    assert.equal(
      /predates|re-?vendor|not exported/i.test(res.stderr),
      false,
      `${args.join(' ')} warned about a consumer that re-exports the plugin templates verbatim; got stderr:\n${res.stderr}`,
    )
  }
})

test('10b) extensionless and cyclic export-star barrels terminate and preserve the in-sync inventory', () => {
  const repo = configuredRepo("export * from './shapes'\n")
  const schemaDir = join(repo, 'lib', 'roadmap')
  writeFileSync(join(schemaDir, 'shapes.ts'), `${inSyncSchema()}export * from './schema'\n`)

  const res = roadmap(repo, 'config', 'check')

  assert.equal(res.status, 0, `a valid cyclic barrel terminates; stderr:\n${res.stderr}`)
  assert.equal(/schemaDrift:/.test(res.stderr), false, `extensionless forwarding preserves the inventory; stderr:\n${res.stderr}`)
})

test('11) a repo with NO lib/roadmap/schema.ts is not a stale consumer — no drift line, exit 0', () => {
  // `roadmap init --config` configures a repo BEFORE `init --scaffold` vendors the schema, so
  // this is the ordinary fresh-consumer state. Reporting "every shape is missing" here would
  // fire the warning on the one repo that has nothing to re-vendor yet.
  const repo = newRepo()
  assert.equal(roadmap(repo, 'init', '--config').status, 0)

  const res = roadmap(repo, 'config', 'check')
  assert.equal(res.status, 0, `a fresh consumer still checks out; stderr:\n${res.stderr}`)
  assert.match(res.stdout, /config OK/)
  assert.equal(
    /PhaseEvalRecordShape|DriverShape|re-?vendor/i.test(res.stderr),
    false,
    `an absent schema is "not vendored yet", not "drifted"; got stderr:\n${res.stderr}`,
  )
})
