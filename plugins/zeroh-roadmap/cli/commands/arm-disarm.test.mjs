#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for `roadmap arm` + `roadmap disarm` (cli/commands/arm.mjs and
 * cli/commands/disarm.mjs do NOT exist yet — these suites are RED until implemented:
 * the dispatcher emits the "not yet implemented" line and exits 1, so every
 * exit-0/exit-2 assertion below fails until the modules land).
 *
 * These are WIRED tests: they SPAWN `node <plugin>/bin/roadmap.mjs …` as a real
 * subprocess against REAL git repos + linked worktrees and assert the Step-3b
 * sidecar-registry contract end to end — the beacon-stamp landing under the MAIN
 * checkout, the foreign-worktree refusal, live-pid warn, `--inline` arc-mode marker,
 * and disarm's landed-claims-only release. Hermetic-tmp-git-estate pattern from
 * cli/commands/config.test.mjs + cli/lib/sidecar.test.mjs (mkdtempSync + realpathSync
 * + process.on('exit') cleanup; REAL `git init` / `git worktree add`, no mocking).
 *
 * The phase-24.3 block at the foot of the file is TEST-FIRST too, against the same wired seam:
 * `roadmap arm <arc> --models <preset|pairs>` must parse through the shared policyFromArg/
 * mergePolicy seam and stamp the resulting snapshot — provenance included — into the sidecar,
 * and that snapshot must validate as a phase record's `executionResult.modelPolicy` in BOTH
 * schema homes (the templates/ original and the consumer's vendored copy).
 *
 * Run: node --test cli/commands/arm-disarm.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
  realpathSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_PRESETS, ROLES, mergePolicy, policyFromArg } from '../lib/roles.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

// A stray path override would defeat the git-toplevel resolution the CLI exercises.
delete process.env.ROADMAP_CONFIG

const tmps = []
function newTmp(prefix = 'zr-cli-armdis-') {
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

/** A tmp MAIN git repo on `develop` with a seed commit + roadmap/phases/; realpath'd root. */
function newRepo() {
  const d = newTmp()
  git(d, 'init', '-q', '-b', 'develop')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  mkdirSync(join(d, 'roadmap', 'phases'), { recursive: true })
  return d
}

/** Add a LINKED worktree on a fresh branch off develop; returns its realpath'd root. */
function addWorktree(mainRepo, branch) {
  const wt = join(newTmp('zr-cli-armdis-wt-'), 'tree')
  git(mainRepo, 'worktree', 'add', '-q', '-b', branch, wt, 'develop')
  return realpathSync(wt)
}

/** Spawn `node <BIN> ...args` with `cwd`; returns { status, stdout, stderr }. */
function roadmap(cwd, ...args) {
  return spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' })
}

/** The .building sidecar path under the MAIN checkout for an arc. */
function sidecarPath(repo, arcId) {
  return join(repo, 'roadmap', 'arcs', '.building', `${arcId}.json`)
}

/** Read + JSON.parse the MAIN-checkout sidecar for an arc. */
function readSidecar(repo, arcId) {
  return JSON.parse(readFileSync(sidecarPath(repo, arcId), 'utf8'))
}

/** `roadmap status <repo>/roadmap` — the derived lane table (human stdout). */
function status(repo) {
  return spawnSync('node', [BIN, 'status', join(repo, 'roadmap')], { encoding: 'utf8' })
}

/** The shared, cross-worktree claims dir for a repo (git common dir = <repo>/.git). */
function claimsDir(repo) {
  return join(repo, '.git', 'zeroh-roadmap-claims')
}

/** Write + commit a phase file DECLARING `phase: N` (a LANDED number). */
function commitPhaseFile(repo, num, arcId = 'LANDED') {
  const rel = join('roadmap', 'phases', `phase-${num}.phase.ts`)
  writeFileSync(
    join(repo, rel),
    `export const phase = { arcId: '${arcId}', phase: ${num}, status: 'done' }\n`,
  )
  git(repo, 'add', rel)
  git(repo, 'commit', '-qm', `phase ${num}`)
}

const arcModePath = (repo) => join(repo, 'roadmap', '.arc-mode')

test('1) arm writes the Step-3b sidecar under the MAIN .building dir, stamped', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'arm', 'ARC')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)
  assert.ok(existsSync(sidecarPath(repo, 'ARC')), 'sidecar lands under <repo>/roadmap/arcs/.building')

  const s = readSidecar(repo, 'ARC')
  assert.equal(s.arcId, 'ARC')
  assert.equal(s.worktree, resolve(repo), 'worktree = the arm cwd, resolved')
  assert.equal(s.branch, 'develop', 'branch from git branch --show-current')
  assert.equal(s.mode, 'mixed', 'default mode is mixed')
  assert.ok(Number.isInteger(s.pid) && s.pid > 0, 'armSidecar stamps a numeric pid')
  assert.ok('sessionHint' in s, 'armSidecar stamps sessionHint')
  assert.ok(
    typeof s.armedAt === 'string' && !Number.isNaN(Date.parse(s.armedAt)),
    'armSidecar stamps an ISO armedAt',
  )
})

test('2) arm --mode heavy --note x --base-ref develop carries all three through', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'arm', 'ARC', '--mode', 'heavy', '--note', 'x', '--base-ref', 'develop')
  assert.equal(res.status, 0, `arm must exit 0; stderr:\n${res.stderr}`)

  const s = readSidecar(repo, 'ARC')
  assert.equal(s.mode, 'heavy', '--mode wins over the default')
  assert.equal(s.note, 'x', '--note is recorded')
  assert.equal(s.baseRef, 'develop', '--base-ref is recorded only when given')
})

test('3) foreign-worktree refusal: exit 2, stderr names the holder worktree', () => {
  const repo = newRepo()
  const wtA = addWorktree(repo, 'arc/a')
  const wtB = addWorktree(repo, 'arc/b')

  const first = roadmap(wtA, 'arm', 'ARC')
  assert.equal(first.status, 0, `first arm (from wtA) must succeed; stderr:\n${first.stderr}`)
  // Beacon-stamp: the sidecar lands under the MAIN checkout even armed from a worktree.
  assert.ok(existsSync(sidecarPath(repo, 'ARC')), 'sidecar lands under the MAIN checkout')

  const second = roadmap(wtB, 'arm', 'ARC')
  assert.equal(second.status, 2, `a lane held by another worktree is REFUSED → exit 2; stderr:\n${second.stderr}`)
  assert.ok(
    second.stderr.includes(resolve(wtA)),
    `the refusal must name the holder worktree ${resolve(wtA)}; got stderr:\n${second.stderr}`,
  )
})

test('4) same-worktree re-arm is idempotent: exit 0 with a /re-arm/i note on stderr', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'arm', 'ARC').status, 0)

  const again = roadmap(repo, 'arm', 'ARC')
  assert.equal(again.status, 0, `same-worktree re-arm must exit 0; stderr:\n${again.stderr}`)
  assert.match(again.stderr, /re-arm/i, `stderr must note the re-arm; got:\n${again.stderr}`)
})

test('5) live-pid re-arm: exit 0 but a LOUD stderr warning naming the live pid', () => {
  const repo = newRepo()
  // Hand-write a same-worktree sidecar carrying THIS (alive) process's pid.
  const dir = join(repo, 'roadmap', 'arcs', '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    sidecarPath(repo, 'ARC'),
    JSON.stringify({
      arcId: 'ARC',
      worktree: resolve(repo),
      branch: 'develop',
      mode: 'mixed',
      pid: process.pid,
      armedAt: new Date().toISOString(),
    }),
  )

  const res = roadmap(repo, 'arm', 'ARC')
  assert.equal(res.status, 0, `a live-pid same-worktree re-arm still exits 0; stderr:\n${res.stderr}`)
  assert.match(
    res.stderr,
    new RegExp(String(process.pid)),
    `stderr must name the live pid ${process.pid}; got:\n${res.stderr}`,
  )
  assert.match(res.stderr, /warn|live/i, `stderr must carry a live-lane warning; got:\n${res.stderr}`)
})

test('6) arm --inline creates the arc-mode marker at <toplevel>/roadmap/.arc-mode', () => {
  const repo = newRepo()
  assert.ok(!existsSync(arcModePath(repo)), 'no marker before arm')
  const res = roadmap(repo, 'arm', 'ARC', '--inline')
  assert.equal(res.status, 0, `arm --inline must exit 0; stderr:\n${res.stderr}`)
  assert.ok(existsSync(arcModePath(repo)), '--inline writes <repo>/roadmap/.arc-mode')
})

test('7) lifecycle round-trip: arm → status BUILDING → disarm --paused → status PAUSED → disarm → gone', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'arm', 'ARC').status, 0)

  const s1 = status(repo)
  assert.equal(s1.status, 0, `status must exit 0; stderr:\n${s1.stderr}`)
  assert.match(s1.stdout, /ARC\s+BUILDING/, `status must show ARC BUILDING; got:\n${s1.stdout}`)

  const paused = roadmap(repo, 'disarm', 'ARC', '--paused')
  assert.equal(paused.status, 0, `disarm --paused must exit 0; stderr:\n${paused.stderr}`)
  const sPaused = readSidecar(repo, 'ARC')
  assert.equal(sPaused.paused, true, '--paused rewrites the sidecar paused:true (lane not removed)')

  const s2 = status(repo)
  assert.match(s2.stdout, /ARC\s+PAUSED/, `status must show ARC PAUSED after --paused; got:\n${s2.stdout}`)

  const gone = roadmap(repo, 'disarm', 'ARC')
  assert.equal(gone.status, 0, `plain disarm must exit 0; stderr:\n${gone.stderr}`)
  assert.ok(!existsSync(sidecarPath(repo, 'ARC')), 'plain disarm removes the sidecar')

  const s3 = status(repo)
  assert.ok(
    !/ARC\s+(BUILDING|PAUSED|IN-FLIGHT)/.test(s3.stdout),
    `status must no longer list ARC as a lane; got:\n${s3.stdout}`,
  )
})

test('8) disarm releases ONLY landed claims (phase file present); unlanded claim survives', () => {
  const repo = newRepo()
  // 1900 is LANDED (a committed phase file declares it); 1901 is an unlanded reservation.
  commitPhaseFile(repo, 1900)
  const cdir = claimsDir(repo)
  mkdirSync(cdir, { recursive: true })
  writeFileSync(join(cdir, '1900.claim'), '')
  writeFileSync(join(cdir, '1901.claim'), '')

  // --inline so the marker exists and we can prove the plain disarm clears it.
  assert.equal(roadmap(repo, 'arm', 'ARC', '--inline').status, 0)
  assert.ok(existsSync(arcModePath(repo)), 'arc-mode marker present after arm --inline')

  const res = roadmap(repo, 'disarm', 'ARC')
  assert.equal(res.status, 0, `disarm must exit 0; stderr:\n${res.stderr}`)

  assert.ok(!existsSync(join(cdir, '1900.claim')), 'the LANDED claim (1900 has a phase file) is released')
  assert.ok(
    existsSync(join(cdir, '1901.claim')),
    '1901 has NO phase file → it may be another session\'s reservation → LEFT',
  )
  assert.ok(!existsSync(arcModePath(repo)), 'plain disarm clears <repo>/roadmap/.arc-mode')
})

test('9) disarm of an unknown lane: exit 2, stderr names what was not found (never a silent 0)', () => {
  const repo = newRepo()
  const res = roadmap(repo, 'disarm', 'NOPE')
  assert.equal(res.status, 2, `disarming a nonexistent lane must exit 2; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /NOPE/, `stderr must name the missing arc; got:\n${res.stderr}`)
  assert.match(res.stderr, /not found/i, `stderr must say what was not found; got:\n${res.stderr}`)
})

// ── capacity advisory on arm (phase 11 gate R1: pin the disclosed coverage gap) ──────────────

const seamEnv = (o) => ({ ...process.env, ZEROH_ROADMAP_CAPACITY_PROBES: typeof o === 'string' ? o : JSON.stringify(o) })
const armWithSeam = (cwd, arcId, seam) =>
  spawnSync('node', [BIN, 'arm', arcId], { cwd, encoding: 'utf8', env: seamEnv(seam) })

test('10) arm on a STARVED box still succeeds but prints the capacity advisory; a clear box says nothing', () => {
  const starved = armWithSeam(newRepo(), 'CAPX', { memAvailableMb: 64000, load1: 0.5, cores: 16, capbuildUnits: 99, liveArms: 0 })
  assert.equal(starved.status, 0, `arming is a claim, not a spawn — never refused for capacity; stderr:\n${starved.stderr}`)
  assert.match(starved.stderr, /box at capacity/, `the advisory names the starvation:\n${starved.stderr}`)

  const clear = armWithSeam(newRepo(), 'CAPY', { memAvailableMb: 64000, load1: 0.5, cores: 16, capbuildUnits: 0, liveArms: 0 })
  assert.equal(clear.status, 0)
  assert.doesNotMatch(clear.stderr, /box at capacity/, `a clear box arms without capacity noise:\n${clear.stderr}`)
})

test('11) a broken seam never blinds arm SILENTLY: the arm succeeds and the seam error is NAMED', () => {
  const r = armWithSeam(newRepo(), 'CAPZ', '{"memAvailableMb": 64000}')
  assert.equal(r.status, 0, 'advisory failure never fails the arm')
  assert.match(r.stderr, /ZEROH_ROADMAP_CAPACITY_PROBES/, `the operator's broken knob is named:\n${r.stderr}`)
})

// ── the per-run model policy (phase 24.3): --models travels into the sidecar ──────────────
// 24.2 gave `roadmap role resolve` a --models door and the shared policyFromArg/mergePolicy
// seam. 24.3 gives the ARC LANE one: "do arc with codex" is ARMED, and the policy the run was
// armed with must survive the session that typed it — the sidecar is the only record that does.
// Today arm.mjs parses --inline/--note/--base-ref/--mode only (arm.mjs:22-25) and armSidecar
// stamps mode/note/baseRef (sidecar.mjs:109-111), so every case below reds: the flag is skipped
// as an unknown token, its VALUE lands in the positional list, and no sidecar carries a policy.
//
// The library is the one truth for the expected snapshot (the cli/commands/role.test.mjs idiom):
// arm, `codex run` and the verb all parse through policyFromArg/mergePolicy, so a second merge
// written into arm.mjs re-routes a whole arc without ever disagreeing with itself. Each case
// ALSO pins the concrete answer, so a command and a library that agreed on the wrong policy red.

const PINNED_JUDGE = ROLES['arc-eval-judge'].tierChain[0] // claude-sonnet-5 — the eval trend baseline

/** The sidecar filenames registered under the MAIN checkout — evidence for a WRONG-arc failure. */
function buildingNames(repo) {
  const dir = join(repo, 'roadmap', 'arcs', '.building')
  return existsSync(dir) ? readdirSync(dir) : ['(no .building dir — nothing was armed at all)']
}

/** A minimal §1-valid config (7 core gateCommands slots) + an optional `modelPolicy` block,
 *  written into the roadmap root newRepo() already creates. Absent modelPolicy = an empty policy. */
function writeConfig(repo, modelPolicy) {
  const cfg = {
    configVersion: 1,
    gateCommands: { lint: 'none', types: 'none', unit: 'none', integration: 'none', build: 'none', e2e: 'none', emit: 'none' },
  }
  if (modelPolicy !== undefined) cfg.modelPolicy = modelPolicy
  writeFileSync(join(repo, 'roadmap', 'roadmap.config.json'), JSON.stringify(cfg, null, 2) + '\n')
}

test('12) arm --models codex stamps the invocation policy into the sidecar, and stamps nothing else away', () => {
  const repo = newRepo()
  const want = mergePolicy(undefined, policyFromArg('codex'))
  assert.deepEqual(
    want,
    { source: 'invocation', preset: 'codex' },
    'fixture guard: the shared seam must read `--models codex` as the codex preset named BY THE RUN — if this ' +
      'ever changes, the sidecar contract below is being pinned against the wrong object',
  )

  const res = roadmap(repo, 'arm', 'ARC', '--models', 'codex')
  assert.equal(res.status, 0, `arm --models must be accepted, not refused as an unknown flag; stderr:\n${res.stderr}`)

  const s = readSidecar(repo, 'ARC')
  assert.deepEqual(
    s.modelPolicy,
    want,
    'the armed lane must carry the policy it was armed with — a snapshot the arm drops leaves the scorecard unable ' +
      'to tell a codex arc from a claude one, and the executor with nothing to resolve roles against; fix ' +
      'cli/commands/arm.mjs (parse --models through policyFromArg + mergePolicy) and cli/lib/sidecar.mjs (stamp it)',
  )

  // Additive: the key JOINS the sidecar — everything status, disarm and the beacon read survives.
  assert.equal(s.arcId, 'ARC')
  assert.equal(s.worktree, resolve(repo), 'worktree = the arm cwd, resolved')
  assert.equal(s.branch, 'develop')
  assert.equal(s.mode, 'mixed', 'the default mode is untouched by a policy stamp')
  assert.ok(Number.isInteger(s.pid) && s.pid > 0, 'the liveness probe still has its pid')
  assert.ok(typeof s.armedAt === 'string' && !Number.isNaN(Date.parse(s.armedAt)), 'the stamp still carries an ISO armedAt')
})

test('13) the --models VALUE is never mistaken for the ARC ID, whatever the flag order', () => {
  // arm's parser pushes every non-`--` token onto `positional` and takes positional[0] as the arc.
  // A --models whose value is not CONSUMED therefore arms an arc literally named `codex` — a lane
  // registered under a name no one typed, which `status` then shows and `disarm <ID>` cannot find.
  const repo = newRepo()
  const res = roadmap(repo, 'arm', '--models', 'codex', 'ARC')
  assert.equal(res.status, 0, `the arc id is still ARC; stderr:\n${res.stderr}`)
  assert.ok(
    existsSync(sidecarPath(repo, 'ARC')),
    `flag order must not change WHICH arc is armed; the sidecar for ARC is missing — the .building dir holds ${JSON.stringify(buildingNames(repo))}`,
  )
  assert.ok(
    !existsSync(sidecarPath(repo, 'codex')),
    "the policy VALUE was armed as an arc id — arm.mjs must CONSUME --models' value the way --note and --mode consume theirs",
  )
  assert.deepEqual(readSidecar(repo, 'ARC').modelPolicy, mergePolicy(undefined, policyFromArg('codex')))
})

test('14) with NO --models the sidecar records the policy actually in force: source config, or table on an empty config', () => {
  // The provenance is the point: a phase run under a repo DEFAULT and one run under a per-run
  // OVERRIDE are different data points, and "no flag" must never be recorded as a choice someone
  // made — nor left blank, which is indistinguishable from an arm that predates the snapshot.
  const configured = newRepo()
  writeConfig(configured, { preset: 'codex' })
  assert.equal(roadmap(configured, 'arm', 'ARC').status, 0)
  const fromConfig = mergePolicy({ preset: 'codex' }, undefined)
  assert.equal(fromConfig.source, 'config', 'fixture guard: a repo default in force is recorded as config')
  assert.deepEqual(
    readSidecar(configured, 'ARC').modelPolicy,
    fromConfig,
    'the repo modelPolicy is what runs when the invocation names nothing — the sidecar must say so, whole ' +
      '(preset included), and label its source config; fix cli/commands/arm.mjs',
  )

  const empty = newRepo()
  writeConfig(empty, undefined)
  assert.equal(roadmap(empty, 'arm', 'ARC').status, 0)
  assert.deepEqual(
    readSidecar(empty, 'ARC').modelPolicy,
    { source: 'table' },
    'a consumer that declared no policy runs the committed roles table — recorded as table, never as an empty ' +
      'config anyone chose, and never omitted; fix cli/commands/arm.mjs',
  )

  const unconfigured = newRepo() // no roadmap.config.json at all — the pre-config estate
  assert.equal(
    roadmap(unconfigured, 'arm', 'ARC').status,
    0,
    'an unconfigured consumer still arms: loading the policy must tolerate an ABSENT config (the ' +
      'cli/commands/role.mjs precedent), never fail the arm over a file the repo never had',
  )
  assert.deepEqual(readSidecar(unconfigured, 'ARC').modelPolicy, { source: 'table' })
})

test('15) an unspellable or PINNED --models refuses the arm outright — exit 1, no lane registered', () => {
  // A refusal that armed anyway would leave the lane HELD (every later attempt from another
  // worktree earns the exit-2 foreign refusal) under a policy the operator was just told is illegal.
  const pinned = newRepo()
  const res = roadmap(pinned, 'arm', 'ARC', '--models', 'arc-eval-judge=sol')
  assert.equal(res.status, 1, `moving the pinned judge is a usage refusal (exit 1); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  assert.ok(res.stderr.includes('arc-eval-judge'), `the refusal must NAME the pinned role; got stderr:\n${res.stderr}`)
  assert.ok(
    res.stderr.includes(PINNED_JUDGE),
    `the refusal must name the model the role is pinned TO (${PINNED_JUDGE}) — the eval trend is only comparable ` +
      `while every arc was judged by it (cli/commands/eval.mjs PINNED_JUDGE_MODEL); got stderr:\n${res.stderr}`,
  )
  assert.doesNotMatch(res.stderr, /^\s+at .*:\d+:\d+\)?$/m, `a refusal is a diagnosis, never a stack trace; got stderr:\n${res.stderr}`)
  assert.ok(!existsSync(sidecarPath(pinned, 'ARC')), 'a refused arm must register NO lane — the sidecar is a claim on the arc')

  const unknown = newRepo()
  const bad = roadmap(unknown, 'arm', 'ARC', '--models', 'gpt')
  assert.equal(bad.status, 1, `an unknown preset is a usage refusal; stderr:\n${bad.stderr}`)
  assert.ok(bad.stderr.includes('gpt'), `the refusal must name the offender; got stderr:\n${bad.stderr}`)
  for (const preset of Object.keys(MODEL_PRESETS)) {
    assert.ok(bad.stderr.includes(preset), `the refusal must list the legal preset '${preset}'; got stderr:\n${bad.stderr}`)
  }
  assert.ok(!existsSync(sidecarPath(unknown, 'ARC')), 'an unparseable policy must register no lane either')

  const novalue = newRepo()
  const missing = roadmap(novalue, 'arm', 'ARC', '--models')
  assert.equal(missing.status, 1, `a missing flag value is usage, never an arm under a policy named "undefined"; stderr:\n${missing.stderr}`)
  assert.match(missing.stderr, /--models/, `the usage line must name the flag whose value is missing; got stderr:\n${missing.stderr}`)
  assert.ok(!existsSync(sidecarPath(novalue, 'ARC')), 'and it registers no lane')
})

// ── the recorded snapshot is ONE shape in three places: sidecar, journal, phase record ────────
// The object arm stamps into the sidecar is the same object a phase record carries as
// executionResult.modelPolicy (the executor stamps it from the lane it was armed in). Validating
// the ACTUAL stamp — never a hand-written twin — is what catches the real regression: a stamp
// shape the record schema then rejects, discovered at `result check` time, one arc later.
//
// BOTH homes, because they are a VENDOR PAIR (templates/schema.ts is what a consumer installs as
// its lib/roadmap/schema.ts): an edit landing in one only passes here in one only. And the
// positive leg asserts the ECHOED PARSE, not the exit code: PhaseExecutionResultShape is a
// non-strict z.object, so an UNKNOWN modelPolicy key exits 0 today and is silently stripped —
// exit 0 alone would pass on nothing.

const PLUGIN_ROOT = resolve(HERE, '..', '..')
const CONSUMER_ROOT = resolve(PLUGIN_ROOT, '..', '..')
const SCHEMA_HOMES = {
  'plugins/zeroh-roadmap/templates/schema.ts': join(PLUGIN_ROOT, 'templates', 'schema.ts'),
  'lib/roadmap/schema.ts': join(CONSUMER_ROOT, 'lib', 'roadmap', 'schema.ts'),
}
/** tsx for the bridge: the plugin's own devDependency, else the consumer checkout's. */
const TSX_CANDIDATES = [join(PLUGIN_ROOT, 'node_modules', '.bin', 'tsx'), join(CONSUMER_ROOT, 'node_modules', '.bin', 'tsx')]

/** A tmp consumer whose lib/roadmap/schema.ts RE-EXPORTS one schema home — the
 *  cli/commands/result.test.mjs makeConsumer idiom, so `result check` validates through THAT home. */
function schemaConsumer(homePath) {
  const root = newTmp('zr-cli-armdis-schema-')
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${homePath}'\n`)
  const tsx = TSX_CANDIDATES.find((p) => existsSync(p))
  if (tsx) {
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
    symlinkSync(tsx, join(root, 'node_modules', '.bin', 'tsx'))
  }
  git(root, 'init', '-q')
  return root
}

/** `roadmap result check <file>` inside a schema consumer: 0 valid · 2 invalid · 1 toolchain. */
function resultCheck(consumer, result) {
  const f = join(consumer, 'result.json')
  writeFileSync(f, JSON.stringify(result))
  const r = spawnSync('node', [BIN, 'result', 'check', f], { cwd: consumer, encoding: 'utf8', timeout: 180_000 })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const A_RESULT = { phase: 9001, status: 'done', gateRounds: 1, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] }

test('16) the snapshot arm stamps is a VALID executionResult.modelPolicy in BOTH schema homes, and an invented one is refused', () => {
  const repo = newRepo()
  assert.equal(roadmap(repo, 'arm', 'ARC', '--models', 'codex').status, 0)
  const stamped = readSidecar(repo, 'ARC').modelPolicy
  assert.ok(
    stamped && typeof stamped === 'object',
    'precondition: case 12 owns the stamp — with no sidecar policy written there is nothing to validate here',
  )

  for (const [home, path] of Object.entries(SCHEMA_HOMES)) {
    assert.ok(existsSync(path), `precondition: the ${home} schema home must exist for this leg to mean anything`)
    const consumer = schemaConsumer(path)

    const ok = resultCheck(consumer, { ...A_RESULT, modelPolicy: stamped })
    assert.notEqual(
      ok.code,
      1,
      `${home}: exit 1 is a TOOLCHAIN failure (tsx/zod could not run), not a verdict on the record — install the ` +
        `consumer checkout's dependencies and re-run; stderr:\n${ok.stderr}`,
    )
    assert.equal(ok.code, 0, `${home}: a record carrying the policy arm just stamped must VALIDATE; stderr:\n${ok.stderr}`)
    assert.deepEqual(
      JSON.parse(ok.stdout).modelPolicy,
      stamped,
      `${home}: the parsed record came back WITHOUT modelPolicy — a non-strict z.object silently strips keys it does ` +
        'not know, so exit 0 proves nothing here; PhaseExecutionResultShape must DECLARE modelPolicy ' +
        '{ source: enum(invocation|config|table), preset?, default?, roles? }',
    )

    const legacy = { source: 'config', judgeModel: 'fable' }
    const legacyOk = resultCheck(consumer, { ...A_RESULT, modelPolicy: legacy })
    assert.equal(legacyOk.code, 0, `${home}: the supported legacy judge lead must remain recordable; stderr:\n${legacyOk.stderr}`)
    assert.deepEqual(
      JSON.parse(legacyOk.stdout).modelPolicy,
      legacy,
      `${home}: schema parsing must not silently strip the legacy judgeModel from the launch snapshot`,
    )

    const invented = resultCheck(consumer, { ...A_RESULT, modelPolicy: { ...stamped, source: 'guessed' } })
    assert.equal(
      invented.code,
      2,
      `${home}: a source outside invocation|config|table must be REFUSED (exit 2) — an unconstrained provenance is a ` +
        `provenance the scorecard cannot slice; stdout:\n${invented.stdout}\nstderr:\n${invented.stderr}`,
    )
    assert.ok(
      invented.stderr.includes('modelPolicy'),
      `${home}: the refusal must name the offending path (modelPolicy.source); got stderr:\n${invented.stderr}`,
    )

    const sourceless = resultCheck(consumer, { ...A_RESULT, modelPolicy: { preset: 'codex' } })
    assert.equal(
      sourceless.code,
      2,
      `${home}: a snapshot with no \`source\` must be refused — a policy that cannot say whether it came from the ` +
        `invocation, the config or the table is exactly what this record exists to disambiguate; stdout:\n${sourceless.stdout}`,
    )
  }
})
