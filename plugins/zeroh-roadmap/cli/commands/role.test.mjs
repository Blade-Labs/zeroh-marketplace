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
import { FORCE_UNAVAILABLE_ENV, MODEL_PRESETS, ROLES, RoleUnjudgedError, resolveRole } from '../lib/roles.mjs'

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

// ── the model policy seam (phase 24.2) ──────────────────────────────────────────────────
// 24.1 gave the LIBRARY a policy (`resolveRole(role, driver, { policy })`, presets, per-role
// leads, the arc-eval-judge pin). 24.2 gives the OPERATOR two doors onto it and this suite owns
// both: the repo's `modelPolicy` block (whole, not judgeModel alone) and `--models <preset|pairs>`
// on the verb, invocation winning. Today `--models` is an unrecognized token the arg walk skips,
// so every case below resolves the table instead — RED with the real answer printed.
//
// policyFromArg/mergePolicy are asserted here too, in-process: cli/lib/roles.test.mjs is not a
// file of task 24.2, and these two functions are the verb's own parsing/merge seam. They are
// reached through a DYNAMIC import so a missing export fails its own case with a named message
// rather than link-erroring the whole file and hiding the eleven cases above.

const ROLES_MOD = join(HERE, '..', 'lib', 'roles.mjs')

/** The 24.2 policy helpers, each asserted present before use (a named RED, never `undefined is not a function`). */
async function policyLib() {
  const mod = await import(ROLES_MOD)
  for (const name of ['policyFromArg', 'mergePolicy']) {
    assert.equal(
      typeof mod[name],
      'function',
      `cli/lib/roles.mjs must export ${name}() (task 24.2) — the verb, arm and codex run all parse ` +
        `--models through the SAME function; got ${typeof mod[name]}`,
    )
  }
  return mod
}

/** Spawn any `roadmap` subcommand (not just `role`) inside `repo` — same env discipline as role(). */
function cli(repo, args, { force } = {}) {
  const env = { ...process.env }
  if (force !== undefined) env[FORCE_UNAVAILABLE_ENV] = force.join(',')
  return spawnSync('node', [BIN, ...args], { cwd: repo, encoding: 'utf8', env })
}

/** A tmp repo whose config carries `modelPolicy` VERBATIM (absent entirely when undefined). */
function newPolicyRepo(modelPolicy) {
  const repo = newRepo()
  const cfg = configWith()
  if (modelPolicy !== undefined) cfg.modelPolicy = modelPolicy
  writeFileSync(join(repo, 'roadmap', 'roadmap.config.json'), JSON.stringify(cfg, null, 2) + '\n')
  return repo
}

/** The resolution the CLI must reproduce for a POLICY (the library is the one truth, as in expected()). */
function expectedUnder(roleId, { driver = 'claude', policy, force } = {}) {
  return resolveRole(roleId, driver, { policy, forceUnavailable: force ?? [], env: {} })
}

const PINNED_JUDGE = ROLES['arc-eval-judge'].tierChain[0] // claude-sonnet-5 — the eval trend baseline

test('12) --models on an EMPTY-config repo: `resolve quality-pass --driver codex --models codex` is gpt-6-astra (native)', () => {
  // The phase's headline: a repo that has opted into nothing at all still runs a codex arc when
  // the RUN says so. quality-pass carries a 1-entry [OPUS] chain, so without the flag reaching
  // the resolver this is claude-opus-5 (child-cli) — the exact waste 24 exists to end.
  const repo = newPolicyRepo(undefined)
  const want = expectedUnder('quality-pass', { driver: 'codex', policy: { preset: 'codex' } })
  assert.equal(want.model, SOL, 'fixture guard: preset codex leads a builder seam with the codex model')
  assert.equal(want.mode, 'native', 'fixture guard: the codex driver runs its own model as a native subagent')

  const json = cli(repo, ['role', 'resolve', 'quality-pass', '--driver', 'codex', '--models', 'codex', '--json'])
  assert.equal(json.status, 0, `a resolvable role exits 0; stdout:\n${json.stdout}\nstderr:\n${json.stderr}`)
  assert.deepEqual(
    parseStdout(json),
    want,
    '--models <preset> must reach resolveRole as the policy — an empty repo config must not erase it',
  )

  const human = cli(repo, ['role', 'resolve', 'quality-pass', '--driver', 'codex', '--models', 'codex'])
  assert.equal(human.status, 0, `a resolvable role exits 0; stdout:\n${human.stdout}\nstderr:\n${human.stderr}`)
  assert.ok(
    human.stdout.includes(`${SOL} (native)`),
    `the human line must read "${SOL} (native)" — task 24.5's live probe greps this verbatim; got stdout:\n${human.stdout}`,
  )
})

test('13) PRECEDENCE: --models beats the repo modelPolicy, for the role the two policies disagree on', () => {
  // preset codex keeps the architect on fable; codex-full moves it to sol. Same repo, same role,
  // same driver — only the flag differs, so a command that read the config and ignored the flag
  // (or vice versa) reds on one leg or the other.
  const repo = newPolicyRepo({ preset: 'codex' })
  const fromConfig = expectedUnder('software-architect', { driver: 'codex', policy: { preset: 'codex' } })
  const fromFlag = expectedUnder('software-architect', { driver: 'codex', policy: { preset: 'codex-full' } })
  assert.equal(fromConfig.model, FABLE, 'fixture guard: preset codex keeps the architect on fable')
  assert.equal(fromFlag.model, SOL, 'fixture guard: preset codex-full moves the architect to the codex model')

  const configured = cli(repo, ['role', 'resolve', 'software-architect', '--driver', 'codex', '--json'])
  const overridden = cli(repo, ['role', 'resolve', 'software-architect', '--driver', 'codex', '--models', 'codex-full', '--json'])
  assert.equal(configured.status, 0, `stdout:\n${configured.stdout}\nstderr:\n${configured.stderr}`)
  assert.equal(overridden.status, 0, `stdout:\n${overridden.stdout}\nstderr:\n${overridden.stderr}`)
  assert.deepEqual(
    parseStdout(configured),
    fromConfig,
    'with no flag the REPO policy is in force, whole (preset included) — not judgeModel alone',
  )
  assert.deepEqual(
    parseStdout(overridden),
    fromFlag,
    'the invocation wins over the repo default (MULTI-DRIVER §1: --models > modelPolicy > table)',
  )
})

test('14) CONFIG: a repo `modelPolicy.preset` alone re-routes a BUILDER seam — judgeModel is no longer the only key read', () => {
  const codexRepo = newPolicyRepo({ preset: 'codex' })
  const bareRepo = newPolicyRepo(undefined)
  const want = expectedUnder('quality-pass', { driver: 'codex', policy: { preset: 'codex' } })
  const table = expectedUnder('quality-pass', { driver: 'codex' })
  assert.notEqual(want.model, table.model, 'fixture guard: the two configs must disagree for this contrast to mean anything')

  const configured = cli(codexRepo, ['role', 'resolve', 'quality-pass', '--driver', 'codex', '--json'])
  const unconfigured = cli(bareRepo, ['role', 'resolve', 'quality-pass', '--driver', 'codex', '--json'])
  assert.equal(configured.status, 0, `stdout:\n${configured.stdout}\nstderr:\n${configured.stderr}`)
  assert.equal(unconfigured.status, 0, `stdout:\n${unconfigured.stdout}\nstderr:\n${unconfigured.stderr}`)
  assert.deepEqual(
    parseStdout(configured),
    want,
    'a repo that declared preset codex gets a codex quality-pass with NO flag — that is what "per-repo default" means',
  )
  assert.deepEqual(
    parseStdout(unconfigured),
    table,
    'and a repo that declared nothing is untouched: the committed roles table, byte for byte',
  )
})

test('15) --models PAIRS: `default=sol,software-architect=fable` resolves both roles the pairs describe', () => {
  const repo = newPolicyRepo(undefined)
  const policy = { default: 'sol', roles: { 'software-architect': 'fable' } }
  for (const roleId of ['quality-pass', 'software-architect']) {
    const want = expectedUnder(roleId, { driver: 'codex', policy })
    const res = cli(repo, ['role', 'resolve', roleId, '--driver', 'codex', '--models', 'default=sol,software-architect=fable', '--json'])
    assert.equal(res.status, 0, `${roleId}: stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
    assert.deepEqual(
      parseStdout(res),
      want,
      `${roleId}: the pair spelling must parse to the same policy as the object — "codex builders with a ` +
        `fable architect" is the combination the phase exists to express`,
    )
  }
})

test('16) --models UNKNOWN preset: exit 1 naming the offender and every legal preset, no stack trace', () => {
  const repo = newPolicyRepo(undefined)
  const res = cli(repo, ['role', 'resolve', 'quality-pass', '--driver', 'codex', '--models', 'gpt'])
  assert.equal(res.status, 1, `an unspellable policy is a usage error (exit 1); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes('gpt'), `the error must NAME the offender; got stderr:\n${res.stderr}`)
  for (const preset of Object.keys(MODEL_PRESETS)) {
    assert.ok(
      res.stderr.includes(preset),
      `the error must list the legal preset '${preset}' — the operator typed one word and needs the ` +
        `other three; got stderr:\n${res.stderr}`,
    )
  }
  assertNoStackTrace(res)
  assert.equal(res.stdout.trim(), '', `nothing resolved, so nothing may be printed on stdout; got stdout:\n${res.stdout}`)
})

test('17) --models WITHOUT a value is USAGE, never a resolve against a policy named "undefined"', () => {
  for (const args of [
    ['role', 'resolve', 'quality-pass', '--models'],
    ['role', 'resolve', 'quality-pass', '--models', '--json'],
  ]) {
    const res = cli(newPolicyRepo(undefined), args)
    const where = `args ${JSON.stringify(args)}`
    assert.equal(res.status, 1, `${where}: a missing flag value is usage (exit 1); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
    assert.match(res.stderr, /--models needs a value/, `${where}: the command's OWN usage line; got stderr:\n${res.stderr}`)
    assertNoStackTrace(res)
    assert.equal(res.stdout.trim(), '', `${where}: no verdict is emitted`)
  }
})

test('18) the --models VALUE is never mistaken for the role id, whatever the flag order', () => {
  // `--models codex` before the role would make 'codex' the first non-flag token. The verb already
  // skips --driver's value the same way (case 9b's sibling); a policy value that shadows the role
  // resolves the wrong seam, or reds as an unknown role the operator never typed.
  const repo = newPolicyRepo(undefined)
  const res = cli(repo, ['role', 'resolve', '--models', 'codex', 'quality-pass', '--driver', 'codex', '--json'])
  assert.equal(res.status, 0, `the role is still 'quality-pass'; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  const body = parseStdout(res)
  assert.equal(body.role, 'quality-pass', `the flag VALUE is not a role id; got:\n${res.stdout}`)
  assert.deepEqual(
    body,
    expectedUnder('quality-pass', { driver: 'codex', policy: { preset: 'codex' } }),
    'flag order must not change the answer',
  )
})

test('19) the PIN refused at --models: naming arc-eval-judge exits 1 naming the role, no stack trace', () => {
  const repo = newPolicyRepo(undefined)
  const res = cli(repo, ['role', 'resolve', 'quality-pass', '--driver', 'codex', '--models', 'arc-eval-judge=sol'])
  assert.equal(
    res.status,
    1,
    `a policy that moves the pinned judge is REFUSED, never quietly served for some other role; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  )
  assert.ok(res.stderr.includes('arc-eval-judge'), `the refusal must NAME the pinned role; got stderr:\n${res.stderr}`)
  assertNoStackTrace(res)
  assert.equal(res.stdout.trim(), '', `nothing resolved, so nothing may be printed on stdout; got stdout:\n${res.stdout}`)
})

test('20) the PIN refused at `config check`: a repo naming arc-eval-judge in modelPolicy.roles reds, naming the pin', () => {
  // The eval trend is only comparable while every arc was judged by the same model
  // (cli/commands/eval.mjs PINNED_JUDGE_MODEL). A repo that re-pointed it must be told at the
  // door — config check is where a consumer learns its own policy is illegal.
  const repo = newPolicyRepo({ roles: { 'arc-eval-judge': 'sol' } })
  const res = cli(repo, ['config', 'check'])
  assert.equal(res.status, 1, `an illegal policy fails config check; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes('arc-eval-judge'), `the refusal must NAME the pinned role; got stderr:\n${res.stderr}`)
  assert.ok(
    res.stderr.includes(PINNED_JUDGE),
    `the refusal must name the model the role is pinned TO (${PINNED_JUDGE}) — the operator's next ` +
      `question is "pinned to what?"; got stderr:\n${res.stderr}`,
  )
  assertNoStackTrace(res)
  assert.ok(!res.stdout.includes('config OK'), `a refused config is never OK; got stdout:\n${res.stdout}`)
})

test('21) `config check` on a preset policy exits 0 and NAMES the effective policy, not judge= alone', () => {
  const repo = newPolicyRepo({ preset: 'codex' })
  const res = cli(repo, ['config', 'check'])
  assert.equal(res.status, 0, `a legal policy passes; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(res.stdout.includes('config OK'), `the verdict rides stdout; got stdout:\n${res.stdout}`)
  const line = res.stderr.split('\n').find((l) => /modelPolicy/.test(l))
  assert.ok(line, `the resolved-bindings summary must carry a modelPolicy line; got stderr:\n${res.stderr}`)
  assert.ok(
    line.includes('codex'),
    `the summary must name the policy IN FORCE ('codex') — printing judge= alone hides which model ` +
      `every builder seam will actually spawn; got:\n${line}`,
  )
})

// ── policyFromArg / mergePolicy — the shared --models parsing + merge seam ──────────────

test('22) policyFromArg: every preset NAME parses to that preset, proven through the resolutions it produces', async () => {
  const { policyFromArg } = await policyLib()
  for (const preset of Object.keys(MODEL_PRESETS)) {
    for (const roleId of ['quality-pass', 'software-architect', 'test-engineer']) {
      assert.deepEqual(
        expectedUnder(roleId, { driver: 'codex', policy: policyFromArg(preset) }),
        expectedUnder(roleId, { driver: 'codex', policy: { preset } }),
        `${roleId} under '${preset}': the parsed arg and the written policy are ONE input — arm, codex ` +
          `run and the verb all go through this function, so a divergence here re-routes a whole arc`,
      )
    }
  }
})

test('23) policyFromArg: comma pairs carry a default AND per-role leads, equal to the written policy', async () => {
  const { policyFromArg } = await policyLib()
  const parsed = policyFromArg('default=sol,software-architect=fable,test-engineer=opus')
  const written = { default: 'sol', roles: { 'software-architect': 'fable', 'test-engineer': 'opus' } }
  for (const roleId of ['quality-pass', 'software-architect', 'test-engineer']) {
    assert.deepEqual(
      expectedUnder(roleId, { driver: 'codex', policy: parsed }),
      expectedUnder(roleId, { driver: 'codex', policy: written }),
      `${roleId}: 'default=' is the DEFAULT lead and every other pair is a per-role lead`,
    )
  }
  assert.equal(
    expectedUnder('quality-pass', { driver: 'codex', policy: parsed }).model,
    SOL,
    'fixture guard: the pairs must actually move a role, or this case proves nothing',
  )
})

test('24) policyFromArg: an unknown preset, role or alias each throw NAMING the offender and the legal set', async () => {
  const { policyFromArg } = await policyLib()

  const preset = thrownMessage(() => policyFromArg('gpt'))
  assert.ok(preset.includes('gpt'), `the preset error names the offender; got: ${preset}`)
  for (const name of Object.keys(MODEL_PRESETS)) {
    assert.ok(preset.includes(name), `the preset error lists '${name}'; got: ${preset}`)
  }

  const roleMsg = thrownMessage(() => policyFromArg('no-such-role=sol'))
  assert.ok(roleMsg.includes('no-such-role'), `the role error names the offender; got: ${roleMsg}`)
  for (const known of Object.keys(ROLES)) {
    assert.ok(roleMsg.includes(known), `the role error names the whole known set (missing '${known}'); got: ${roleMsg}`)
  }

  const aliasMsg = thrownMessage(() => policyFromArg('software-developer=gpt-4'))
  assert.ok(aliasMsg.includes('gpt-4'), `the alias error names the offender; got: ${aliasMsg}`)
  for (const alias of Object.keys(MODEL_ALIASES)) {
    assert.ok(aliasMsg.includes(alias), `the alias error lists the spellable model '${alias}'; got: ${aliasMsg}`)
  }
})

test('25) mergePolicy: source is invocation > config > table, and it describes where the policy CAME FROM', async () => {
  const { mergePolicy } = await policyLib()

  for (const [repo, invocation] of [[undefined, undefined], [{}, {}], [{}, undefined], [undefined, {}]]) {
    assert.equal(
      mergePolicy(repo, invocation).source,
      'table',
      `repo ${JSON.stringify(repo)} + invocation ${JSON.stringify(invocation)}: nothing was named, so the ` +
        `committed roles table is what runs — an empty object must not be recorded as a choice anyone made`,
    )
  }

  const fromConfig = mergePolicy({ preset: 'codex' }, undefined)
  assert.equal(fromConfig.source, 'config', 'the repo default in force is recorded as config')
  assert.equal(fromConfig.preset, 'codex', 'and the policy itself rides the same object (task 24.3 stamps it whole)')

  const fromInvocation = mergePolicy({ preset: 'codex' }, { preset: 'codex-full' })
  assert.equal(fromInvocation.source, 'invocation', 'a run that named a policy is recorded as invocation')
  assert.equal(fromInvocation.preset, 'codex-full', 'and the invocation key wins over the repo one')

  const presetOverride = mergePolicy(
    { default: 'opus', roles: { 'software-architect': 'fable' }, judgeModel: 'fable' },
    { preset: 'codex-full' },
  )
  assert.deepEqual(
    presetOverride,
    { source: 'invocation', preset: 'codex-full' },
    'a named invocation preset is the whole policy: no repo lead may survive and outrank that preset',
  )
})

test('26) mergePolicy: the invocation wins KEY BY KEY — repo keys it does not name survive', async () => {
  const { mergePolicy } = await policyLib()
  const merged = mergePolicy({ judgeModel: 'fable', default: 'opus' }, { default: 'sol' })
  assert.equal(merged.default, 'sol', 'the named key is overridden')
  assert.equal(
    merged.judgeModel,
    'fable',
    "a repo key the run never mentioned must survive the merge — `--models default=sol` says nothing " +
      'about the judge lead, and silently dropping it re-routes every judge seam in the arc',
  )
  assert.equal(merged.source, 'invocation', 'the run still named part of the policy')
})

test('27) mergePolicy mutates neither argument — the repo config is read many times per run', async () => {
  const { mergePolicy } = await policyLib()
  const repo = { preset: 'codex', roles: { 'test-engineer': 'opus' } }
  const invocation = { preset: 'codex-full' }
  const repoCopy = structuredClone(repo)
  const invocationCopy = structuredClone(invocation)
  mergePolicy(repo, invocation)
  assert.deepEqual(repo, repoCopy, 'the loaded config object must come back unchanged')
  assert.deepEqual(invocation, invocationCopy, 'and so must the parsed --models policy')
})
