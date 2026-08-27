#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for the `roadmap role resolve` verb (task 13.2). NEITHER
 * cli/commands/role.mjs NOR the bin/roadmap.mjs TREE row exists yet — this suite is RED until
 * both land (`roadmap: unknown command 'role'`, exit 1).
 *
 * WIRED: every case SPAWNS `node <plugin>/bin/roadmap.mjs role …` as a real subprocess against a
 * hermetic tmp git repo carrying a minimal roadmap/roadmap.config.json. Hermetic pattern
 * (mkdtempSync + realpathSync + exit-sweep + real `git init`) from capacity.test.mjs /
 * claim.test.mjs; the in-process library as the one source of truth for expectations is the
 * capacity.test.mjs idiom.
 *
 * THE CONTRACT UNDER TEST
 *   roadmap role resolve <role> [--driver <id>] [--json]
 *   wrapping : resolveRole(roleId, driverId ?? 'claude',
 *                          { judgeModel: loadConfig(cwd).modelPolicy?.judgeModel })
 *   human    : the resolved model + mode on stdout, plus the substitution provenance when the
 *              walk fell past the head of the chain; exit 0.
 *   --json   : the resolved object VERBATIM on stdout ({role, model, mode, substituted?}), exit 0.
 *   unknown  : an unknown role OR an unknown driver is exit 1, and stderr carries the library's
 *              own named error (offender + the known set) — never a stack trace.
 *   refused  : RoleUnjudgedError is exit 2 (every tier unavailable), stderr carrying the error's
 *              own message, which names MULTI-DRIVER.md §1.
 *   seam     : ROADMAP_ROLE_FORCE_UNAVAILABLE (roles.mjs FORCE_UNAVAILABLE_ENV) forces tiers
 *              down, so substitution and the UNJUDGED refusal are provable without a live probe.
 *
 * WHAT THE ASSERTIONS PIN. The --json body is compared with deepEqual against resolveRole(…)
 * computed IN-PROCESS from the same role, driver, judgeModel and forced set — one source of
 * truth (the tested 1,150-line library), and it kills the real bugs: a command that
 * re-implements the chain walk, that drops the consumer's modelPolicy, that hands judgeModel to
 * a BUILDER seam, that ignores --driver, or that swallows the substitution record. On top of
 * that, the judge-routing case asserts the CONCRETE model id (MODEL_ALIASES.fable) so a
 * command + library that agreed on the wrong answer still reds. Prose beyond the model id, the
 * mode and the two substituted model ids is deliberately NOT pinned.
 *
 * Run: node --test cli/commands/role.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MODEL_ALIASES, MODEL_IDS } from '../lib/drivers.mjs'
import { FORCE_UNAVAILABLE_ENV, ROLES, RoleUnjudgedError, resolveRole } from '../lib/roles.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const { FABLE, SOL, OPUS } = MODEL_IDS
const JUDGE_ALIAS = 'fable' // what a consumer can actually write in modelPolicy.judgeModel

// Test-only / ambient escape hatches must never be inherited: ROADMAP_CONFIG would defeat the
// git-toplevel config resolution, and an ambient forced-unavailable set would rewrite every
// chain out from under the fixtures.
delete process.env.ROADMAP_CONFIG
delete process.env[FORCE_UNAVAILABLE_ENV]

const tmps = []
function newTmp(prefix = 'zr-cli-role-') {
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
  return execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/** A minimal §1-valid config (7 core gateCommands slots) + an optional `modelPolicy` block. */
function configWith(judgeModel) {
  const cfg = {
    configVersion: 1,
    gateCommands: {
      lint: 'none',
      types: 'none',
      unit: 'none',
      integration: 'none',
      build: 'none',
      e2e: 'none',
      emit: 'none',
    },
  }
  if (judgeModel !== undefined) cfg.modelPolicy = { judgeModel }
  return cfg
}

/** A tmp git repo with one seed commit and roadmap/roadmap.config.json; returns its realpath. */
function newRepo(judgeModel) {
  const d = newTmp()
  git(d, 'init', '-q')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  mkdirSync(join(d, 'roadmap'), { recursive: true })
  writeFileSync(
    join(d, 'roadmap', 'roadmap.config.json'),
    JSON.stringify(configWith(judgeModel), null, 2) + '\n',
  )
  return d
}

/**
 * Spawn `node <BIN> role ...args` inside `repo`.
 * `force` (an array of model ids) is serialized into ROADMAP_ROLE_FORCE_UNAVAILABLE; unset, the
 * whole chain is available.
 */
function role(repo, args, { force } = {}) {
  const env = { ...process.env }
  if (force !== undefined) env[FORCE_UNAVAILABLE_ENV] = force.join(',')
  return spawnSync('node', [BIN, 'role', ...args], { cwd: repo, encoding: 'utf8', env })
}

/**
 * The resolution the CLI MUST reproduce — the library is the one truth. `env: {}` mirrors the
 * subprocess exactly: there, the same ids arrive through ROADMAP_ROLE_FORCE_UNAVAILABLE.
 */
function expected(roleId, { driver = 'claude', judgeModel, force } = {}) {
  return resolveRole(roleId, driver, { judgeModel, forceUnavailable: force ?? [], env: {} })
}

/** Parse stdout as JSON with both raw streams quoted on failure (stream-separation evidence). */
function parseStdout(res) {
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON (no human narration bleed); got stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  return parsed
}

/** A CLI never answers with a crash report: a stack frame in stderr is a bug, not a verdict. */
function assertNoStackTrace(res) {
  assert.ok(
    !/^\s+at\s/m.test(res.stderr),
    `the command must map the library's named error, never leak a stack trace; got stderr:\n${res.stderr}`,
  )
}

/** The message the library itself throws for `fn` — asserted verbatim against stderr. */
function thrownMessage(fn) {
  let message
  assert.throws(fn, (e) => {
    message = e.message
    return true
  })
  return message
}

// ── the registry row (bin/roadmap.mjs) ─────────────────────────────────────────────────

test('1) REGISTRY: `roadmap --help` lists a `role` row carrying its `resolve` subcommand', () => {
  const repo = newRepo()
  const res = spawnSync('node', [BIN, '--help'], { cwd: repo, encoding: 'utf8' })
  assert.equal(res.status, 0, `--help must exit 0; stderr:\n${res.stderr}`)
  const row = res.stdout.split('\n').find((l) => /^\s*role\b/.test(l))
  assert.ok(row, `--help must list the role command; got stdout:\n${res.stdout}`)
  assert.match(row, /\bresolve\b/, `the role row must advertise its resolve subcommand; got row:\n${row}`)
})

// ── judge-class routing: the point of the verb ─────────────────────────────────────────

test('2) JUDGE with config: `resolve intent-validator --json` returns the fable id LEADING the chain, unsubstituted', () => {
  const repo = newRepo(JUDGE_ALIAS)
  const res = role(repo, ['resolve', 'intent-validator', '--json'])
  assert.equal(res.status, 0, `a resolvable role exits 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)

  const body = parseStdout(res)
  assert.deepEqual(
    Object.keys(body).sort(),
    ['mode', 'model', 'role'],
    `--json is the resolved object VERBATIM: keys role/model/mode (and substituted only when the walk fell); got:\n${res.stdout}`,
  )
  assert.equal(body.role, 'intent-validator', 'the payload names the role it resolved')
  assert.equal(
    body.model,
    MODEL_ALIASES[JUDGE_ALIAS],
    `the consumer's modelPolicy.judgeModel '${JUDGE_ALIAS}' must lead a JUDGE-class chain, normalised through MODEL_ALIASES to its model id — the chain head now EQUALS this alias, so a config-dropping command is caught by case 3's NON-head contrast instead; one that prepends the raw ALIAS resolves ${OPUS} WITH a bogus substitution record; got:\n${res.stdout}`,
  )
  assert.deepEqual(
    body,
    expected('intent-validator', { judgeModel: JUDGE_ALIAS }),
    'the --json body must be the resolveRole result VERBATIM (same role, same default driver claude, same judgeModel)',
  )
})

test('3) JUDGE without config: the SAME role with no modelPolicy resolves to its chain default instead', () => {
  const res = role(newRepo(), ['resolve', 'intent-validator', '--json'])
  assert.equal(res.status, 0, `a resolvable role exits 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  // The chain head EQUALS the shipped judge alias 'fable', so proving the config is actually
  // READ (not hardcoded) needs a NON-head alias on the contrast leg — 'opus' here.
  const configured = role(newRepo('opus'), ['resolve', 'intent-validator', '--json'])
  assert.equal(configured.status, 0, `a resolvable role exits 0; stdout:\n${configured.stdout}\nstderr:\n${configured.stderr}`)
  const withConfig = parseStdout(configured)

  const body = parseStdout(res)
  assert.equal(
    body.model,
    FABLE,
    `with no modelPolicy the role falls to its own tierChain head; got:\n${res.stdout}`,
  )
  assert.deepEqual(
    body,
    expected('intent-validator'),
    'the --json body must be the resolveRole result VERBATIM for an absent judgeModel',
  )
  // Only the config differs between the two runs. A command that hardcoded either answer — or
  // that read modelPolicy from its own cwd rather than the consumer repo — reds here.
  assert.notEqual(
    body.model,
    withConfig.model,
    `the consumer config is a real input: ${JUDGE_ALIAS} configured must not resolve identically to no modelPolicy at all`,
  )
})

test('4) BUILDER ignores judgeModel: software-developer in the SAME fable config resolves its own chain', () => {
  const repo = newRepo(JUDGE_ALIAS)
  const res = role(repo, ['resolve', 'software-developer', '--json'])
  assert.equal(res.status, 0, `a resolvable role exits 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)

  const body = parseStdout(res)
  assert.equal(
    ROLES['software-developer'].class,
    'builder',
    'fixture guard: this case only means anything while software-developer is builder-class',
  )
  assert.equal(
    body.model,
    OPUS,
    `a BUILDER seam ignores modelPolicy.judgeModel — only a role returning a verdict on work it did not produce may be re-routed (MULTI-DRIVER.md §1); got:\n${res.stdout}`,
  )
  assert.equal(
    body.substituted,
    undefined,
    'the builder was never asked for fable, so nothing was substituted away from it',
  )
  assert.deepEqual(
    body,
    expected('software-developer', { judgeModel: JUDGE_ALIAS }),
    'the --json body must be the resolveRole result VERBATIM (judgeModel passed, and ignored BY THE LIBRARY for a builder)',
  )
})

// ── human output ───────────────────────────────────────────────────────────────────────

test('5) HUMAN: exit 0 and stdout carries the resolved model AND the reach mode', () => {
  const repo = newRepo(JUDGE_ALIAS)
  const want = expected('intent-validator', { judgeModel: JUDGE_ALIAS })
  const res = role(repo, ['resolve', 'intent-validator'])

  assert.equal(res.status, 0, `a resolvable role exits 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(
    res.stdout.includes(want.model),
    `the human line must name the resolved model '${want.model}'; got stdout:\n${res.stdout}`,
  )
  assert.ok(
    res.stdout.includes(want.mode),
    `the human line must name the reach mode '${want.mode}' — how this driver reaches that model is half the answer; got stdout:\n${res.stdout}`,
  )
})

test('6) SUBSTITUTION: a forced-down head falls to the next tier — provenance in --json AND in the human output', () => {
  // software-architect is the one role carrying a real multi-tier chain (FABLE, SOL, OPUS).
  const repo = newRepo()
  const want = expected('software-architect', { force: [FABLE] })
  assert.equal(want.model, SOL, 'fixture guard: forcing the head down must land the walk on the next tier')
  assert.equal(want.substituted?.from, FABLE, 'fixture guard: the walk must RECORD what it fell from')

  const json = role(repo, ['resolve', 'software-architect', '--json'], { force: [FABLE] })
  assert.equal(json.status, 0, `a substituted resolution still SUCCEEDS (exit 0); stdout:\n${json.stdout}\nstderr:\n${json.stderr}`)
  const body = parseStdout(json)
  assert.deepEqual(
    body,
    want,
    'the substitution record must ride the payload verbatim — a command that returns only {role, model, mode} silently hides that the asked-for tier was unavailable',
  )

  const human = role(repo, ['resolve', 'software-architect'], { force: [FABLE] })
  assert.equal(human.status, 0, `a substituted resolution still SUCCEEDS (exit 0); stdout:\n${human.stdout}\nstderr:\n${human.stderr}`)
  for (const id of [want.substituted.from, want.substituted.to]) {
    assert.ok(
      human.stdout.includes(id),
      `the human provenance must name BOTH the asked-for tier and the one that ran (missing '${id}'); got stdout:\n${human.stdout}`,
    )
  }
})

// ── the driver seam ────────────────────────────────────────────────────────────────────

test('7) --driver: the same role and the same forced set resolve the same tier with a DIFFERENT reach mode', () => {
  // Reach is a property of the (driver, runner) pair: codex runs SOL itself (native), claude
  // can only drive it as a headless child. Same tier, two answers — a command that ignored
  // --driver, or that defaulted to something other than 'claude', reds here.
  const repo = newRepo()
  const viaClaude = role(repo, ['resolve', 'software-architect', '--json'], { force: [FABLE] })
  const viaCodex = role(repo, ['resolve', 'software-architect', '--driver', 'codex', '--json'], { force: [FABLE] })

  assert.equal(viaClaude.status, 0, `stdout:\n${viaClaude.stdout}\nstderr:\n${viaClaude.stderr}`)
  assert.equal(viaCodex.status, 0, `stdout:\n${viaCodex.stdout}\nstderr:\n${viaCodex.stderr}`)

  const defaulted = parseStdout(viaClaude)
  const overridden = parseStdout(viaCodex)
  assert.deepEqual(
    defaulted,
    expected('software-architect', { driver: 'claude', force: [FABLE] }),
    "no --driver means driver 'claude' — the documented default, not the ambient host",
  )
  assert.deepEqual(
    overridden,
    expected('software-architect', { driver: 'codex', force: [FABLE] }),
    '--driver <id> must reach the library as the resolving driver',
  )
  assert.equal(defaulted.model, overridden.model, 'fixture guard: both drivers land on the same tier')
  assert.notEqual(
    defaulted.mode,
    overridden.mode,
    `--driver changes how the tier is REACHED (${defaulted.mode} vs ${overridden.mode}); identical modes mean the flag was never read`,
  )
})

// ── named refusals (exit 1) ────────────────────────────────────────────────────────────

test('8) UNKNOWN ROLE: exit 1, stderr carries the library error naming the offender and every known role, no stack trace', () => {
  const repo = newRepo(JUDGE_ALIAS)
  const message = thrownMessage(() => resolveRole('no-such-role', 'claude', { env: {} }))

  const res = role(repo, ['resolve', 'no-such-role'])
  assert.equal(res.status, 1, `an unknown role is a usage error (exit 1); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(
    res.stderr.includes(message),
    `stderr must carry the library's own named error VERBATIM.\nexpected substring:\n${message}\ngot stderr:\n${res.stderr}`,
  )
  assert.ok(res.stderr.includes('no-such-role'), `the error must NAME the offender; got stderr:\n${res.stderr}`)
  for (const known of Object.keys(ROLES)) {
    assert.ok(
      res.stderr.includes(known),
      `the error must name the whole known set (missing '${known}'); got stderr:\n${res.stderr}`,
    )
  }
  assertNoStackTrace(res)
  assert.equal(res.stdout.trim(), '', `nothing resolved, so nothing may be printed on stdout; got stdout:\n${res.stdout}`)
})

test('9b) --driver WITHOUT a value is USAGE, never a resolve against a driver named "undefined"', () => {
  // The flag last, or followed by another flag, means the VALUE was omitted. Falling through
  // would hand the operator the registry's unknown-driver remediation for a driver id they never
  // typed — "land the undefined entry in cli/lib/drivers.mjs" is not the fix for a missing value.
  for (const args of [['resolve', 'intent-validator', '--driver'], ['resolve', 'intent-validator', '--driver', '--json']]) {
    const res = role(newRepo(), args)
    const where = `args ${JSON.stringify(args)}`
    assert.equal(res.status, 1, `${where}: a missing flag value is usage (exit 1); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
    assert.match(res.stderr, /--driver needs a value/, `${where}: the command's OWN usage line, not the library error; got:\n${res.stderr}`)
    assert.doesNotMatch(res.stderr, /unknown driver/, `${where}: never the registry's unknown-driver remediation; got:\n${res.stderr}`)
    assert.equal(res.stdout.trim(), '', `${where}: no verdict is emitted`)
  }
})

test('9) UNKNOWN DRIVER: exit 1, stderr carries the registry error naming the offender and the known drivers, no stack trace', () => {
  const repo = newRepo(JUDGE_ALIAS)
  const message = thrownMessage(() => resolveRole('intent-validator', 'grok', { env: {} }))

  const res = role(repo, ['resolve', 'intent-validator', '--driver', 'grok'])
  assert.equal(res.status, 1, `an unknown driver is a usage error (exit 1); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(
    res.stderr.includes(message),
    `stderr must carry the registry's own named error VERBATIM (an unregistered id is an EMPTY SLOT, never a guess).\nexpected substring:\n${message}\ngot stderr:\n${res.stderr}`,
  )
  assert.ok(res.stderr.includes('grok'), `the error must NAME the offending driver; got stderr:\n${res.stderr}`)
  assertNoStackTrace(res)
  assert.equal(res.stdout.trim(), '', `nothing resolved, so nothing may be printed on stdout; got stdout:\n${res.stdout}`)
})

test('10) USAGE: a missing or unknown subcommand exits 1 naming `resolve`, and never resolves anything', () => {
  const repo = newRepo(JUDGE_ALIAS)
  for (const args of [[], ['bogus'], ['resolve']]) {
    const res = role(repo, args)
    const where = `args ${JSON.stringify(args)}`
    assert.equal(res.status, 1, `${where}: a usage error is exit 1; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
    assert.match(res.stderr, /\bresolve\b/, `${where}: the usage line must name the subcommand; got stderr:\n${res.stderr}`)
    assertNoStackTrace(res)
    assert.equal(res.stdout.trim(), '', `${where}: nothing may be printed on stdout; got stdout:\n${res.stdout}`)
  }
})

// ── the REFUSED verdict (exit 2) ───────────────────────────────────────────────────────

test('11) UNJUDGED: every tier forced down is exit 2, carrying the error\'s own message (which names MULTI-DRIVER.md §1)', () => {
  // Forcing the WHOLE chain is deterministic and derived — the ids come from the role's own
  // tierChain, so a future tier added to the chain is forced too rather than silently rescuing
  // the walk and turning this case green by accident.
  const chain = [...ROLES['software-architect'].tierChain]
  assert.deepEqual(chain, [FABLE, SOL, OPUS], 'fixture guard: the multi-tier chain is the one worth starving')
  const repo = newRepo()
  let message
  assert.throws(
    () => resolveRole('software-architect', 'claude', { forceUnavailable: chain, env: {} }),
    (e) => {
      assert.ok(
        e instanceof RoleUnjudgedError,
        `fixture guard: a starved walk throws RoleUnjudgedError, not a generic Error (got ${e?.name})`,
      )
      message = e.message
      return true
    },
  )
  assert.match(message, /MULTI-DRIVER\.md §1/, 'fixture guard: the library error cites the protocol home')

  for (const args of [
    ['resolve', 'software-architect'],
    ['resolve', 'software-architect', '--json'],
  ]) {
    const res = role(repo, args, { force: chain })
    const where = `args ${JSON.stringify(args)}`
    assert.equal(
      res.status,
      2,
      `${where}: an UNJUDGED stage is REFUSED (exit 2), never a usage error and never a silent 0 — the caller cannot narrate around it; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
    )
    assert.ok(
      res.stderr.includes(message),
      `${where}: stderr must carry the RoleUnjudgedError's own message VERBATIM (it names the role, every skipped tier and MULTI-DRIVER.md §1).\nexpected substring:\n${message}\ngot stderr:\n${res.stderr}`,
    )
    assertNoStackTrace(res)
  }

  const human = role(repo, ['resolve', 'software-architect'], { force: chain })
  assert.equal(
    human.stdout.trim(),
    '',
    `no tier ran, so no resolution may be printed on stdout — a model id here would seat a judge that was never reachable; got stdout:\n${human.stdout}`,
  )
})
