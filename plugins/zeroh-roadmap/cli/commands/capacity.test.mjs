#!/usr/bin/env node
/**
 * TEST-FIRST, WIRED for the `roadmap capacity` verb (task 11.3). NEITHER
 * cli/commands/capacity.mjs NOR the bin/roadmap.mjs registry row exists yet — this suite is
 * RED until both land (`roadmap: unknown command 'capacity'`, exit 1).
 *
 * WIRED: every case SPAWNS `node <plugin>/bin/roadmap.mjs capacity …` as a real subprocess
 * against a hermetic tmp git repo carrying a minimal roadmap/roadmap.config.json. Hermetic
 * pattern (mkdtempSync + realpathSync + exit-sweep + real `git init`) from claim.test.mjs /
 * config.test.mjs.
 *
 * THE CONTRACT UNDER TEST
 *   human   : verdict line + per-signal table + reasons when present; exit 0 when canSpawn,
 *             exit 3 when NOT (the scriptable gate — a caller can `if roadmap capacity`).
 *   --json  : the CapacityVerdictShape object VERBATIM on stdout, ALWAYS exit 0 (the JSON
 *             carries the verdict; the exit code must not double-encode it).
 *   seam    : env ZEROH_ROADMAP_CAPACITY_PROBES = {memAvailableMb, load1, cores, capbuildUnits,
 *             liveArms} makes EVERY probe fixed — no live read at all. Malformed JSON in it is
 *             a NAMED error, exit 2, and NEVER a silent fallback to live probes (a fallback
 *             would make a scripted gate silently consult the wrong box).
 *   policy  : the consumer config's `capacity` block still applies on top of the fixed signals.
 *             Signals and policy are separate inputs — same probes + different maxExecutors
 *             must flip the verdict (cases 6/7).
 *
 * WHAT THE ASSERTIONS PIN. The --json body is compared with deepEqual against
 * probeCapacity(<the same config block>, <the same fixed probes>) computed IN-PROCESS from
 * cli/lib/capacity.mjs — that is one source of truth (11.1's tested library), and it kills the
 * real bugs: a command that re-implements the math, that drops the config block, that maps
 * `liveArms` onto the wrong probe, or that reads the live box past the seam. Prose beyond the
 * signal names and the verdict's own reasons[] lines is deliberately NOT pinned.
 *
 * Run: node --test cli/commands/capacity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CapacityVerdictShape, probeCapacity } from '../lib/capacity.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

// Test-only escape hatches must never be inherited: ROADMAP_CONFIG would defeat the
// git-toplevel config resolution, and an ambient probe env would defeat the live-run case.
delete process.env.ROADMAP_CONFIG
delete process.env.ZEROH_ROADMAP_CAPACITY_PROBES

const tmps = []
function newTmp(prefix = 'zr-cli-capacity-') {
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

/** A minimal §1-valid config (7 core gateCommands slots) + an optional `capacity` block. */
function configWith(capacity) {
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
  if (capacity !== undefined) cfg.capacity = capacity
  return cfg
}

/** A tmp git repo with one seed commit and roadmap/roadmap.config.json; returns its realpath. */
function newRepo(capacity) {
  const d = newTmp()
  git(d, 'init', '-q')
  writeFileSync(join(d, 'seed.txt'), 'seed\n')
  git(d, 'add', 'seed.txt')
  git(d, 'commit', '-qm', 'seed')
  mkdirSync(join(d, 'roadmap'), { recursive: true })
  writeFileSync(
    join(d, 'roadmap', 'roadmap.config.json'),
    JSON.stringify(configWith(capacity), null, 2) + '\n',
  )
  return d
}

/**
 * Spawn `node <BIN> capacity ...args` inside `repo`.
 * `probes` (an object) is serialized into ZEROH_ROADMAP_CAPACITY_PROBES; a STRING is passed
 * through verbatim (the malformed-JSON case); `undefined` leaves the seam unset (live box).
 */
function capacity(repo, { probes, args = [] } = {}) {
  const env = { ...process.env }
  if (probes !== undefined) {
    env.ZEROH_ROADMAP_CAPACITY_PROBES = typeof probes === 'string' ? probes : JSON.stringify(probes)
  }
  return spawnSync('node', [BIN, 'capacity', ...args], { cwd: repo, encoding: 'utf8', env })
}

// ── fixtures ───────────────────────────────────────────────────────────────────────────
/**
 * ONE set of fixed signals used by both the starved and the clear case, so the ONLY thing
 * that differs between them is the config policy. Memory and load are deliberately generous
 * (memSlots 9, loadSlots 7) — the executor signal is the sole binding constraint, which is
 * what makes "the binding reason" unambiguous.
 */
const SIGNALS = Object.freeze({
  memAvailableMb: 64_000,
  load1: 0.5,
  cores: 16,
  capbuildUnits: 2,
  liveArms: 0,
})

const STARVED_POLICY = Object.freeze({ maxExecutors: 2 }) // busy 2 >= 2 → refuse
const CLEAR_POLICY = Object.freeze({ maxExecutors: 4 }) // busy 2 < 4 → admit

/** The env-probe payload projected onto probeCapacity's injectable reader contract. */
const asProbes = (p) => ({
  memAvailableMb: () => p.memAvailableMb,
  load: () => ({ load1: p.load1, cores: p.cores }),
  runningCapbuildUnits: () => p.capbuildUnits,
  liveExecutorArms: () => p.liveArms,
})

/** The verdict the CLI MUST reproduce for (policy, signals) — the library is the one truth. */
const expectedVerdict = (policy, signals = SIGNALS) => probeCapacity(policy, asProbes(signals))

/** Parse stdout as JSON with the raw text quoted on failure (stream-separation evidence). */
function parseStdout(res) {
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON (no human narration bleed); got stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  return parsed
}

// ── the registry row (bin/roadmap.mjs) ─────────────────────────────────────────────────

test('1) REGISTRY: `roadmap --help` lists a `capacity` row carrying its --json subcommand', () => {
  const repo = newRepo()
  const res = spawnSync('node', [BIN, '--help'], { cwd: repo, encoding: 'utf8' })
  assert.equal(res.status, 0, `--help must exit 0; stderr:\n${res.stderr}`)
  const row = res.stdout.split('\n').find((l) => /^\s*capacity\b/.test(l))
  assert.ok(row, `--help must list the capacity command; got stdout:\n${res.stdout}`)
  assert.match(row, /--json/, `the capacity row must advertise --json; got row:\n${row}`)
})

// ── starved: the scriptable refusal ────────────────────────────────────────────────────

test('2) STARVED human: exit 3, and every reasons[] line of the verdict is printed on stdout', () => {
  const repo = newRepo(STARVED_POLICY)
  const expected = expectedVerdict(STARVED_POLICY)
  assert.equal(expected.canSpawn, false, 'fixture guard: this fixture must be a refusal')
  assert.ok(expected.reasons.length > 0, 'fixture guard: a refusal must carry a binding reason')

  const res = capacity(repo, { probes: SIGNALS })
  assert.equal(
    res.status,
    3,
    `a box that cannot carry another executor exits 3 (the scriptable gate); stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  )
  for (const reason of expected.reasons) {
    assert.ok(
      res.stdout.includes(reason),
      `the binding reason must be printed on STDOUT verbatim.\nexpected substring:\n${reason}\ngot stdout:\n${res.stdout}`,
    )
  }
})

test('3) STARVED --json: exit 0 (the JSON carries the verdict) with canSpawn false and the verdict verbatim', () => {
  const repo = newRepo(STARVED_POLICY)
  const expected = expectedVerdict(STARVED_POLICY)

  const res = capacity(repo, { probes: SIGNALS, args: ['--json'] })
  assert.equal(
    res.status,
    0,
    `--json ALWAYS exits 0 — the refusal rides the payload, not the exit code; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  )
  const body = parseStdout(res)
  assert.doesNotThrow(
    () => CapacityVerdictShape.parse(body),
    `--json must emit a CapacityVerdictShape-valid object; got:\n${res.stdout}`,
  )
  assert.equal(body.canSpawn, false, 'the starved fixture must report canSpawn false')
  assert.equal(body.maxParallel, 0, 'a refusal admits zero further executors')
  assert.deepEqual(
    body,
    expected,
    'the --json body must be the probeCapacity verdict VERBATIM (same math, same config block, same probes)',
  )
})

// ── clear: the admission ───────────────────────────────────────────────────────────────

test('4) CLEAR human: exit 0 and the per-signal table names every signal in the verdict', () => {
  const repo = newRepo(CLEAR_POLICY)
  const expected = expectedVerdict(CLEAR_POLICY)
  assert.equal(expected.canSpawn, true, 'fixture guard: this fixture must admit a spawn')

  const res = capacity(repo, { probes: SIGNALS })
  assert.equal(res.status, 0, `a box with room exits 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  for (const s of expected.signals) {
    assert.ok(
      res.stdout.includes(s.name),
      `the per-signal table must carry a row for "${s.name}"; got stdout:\n${res.stdout}`,
    )
  }
  assert.ok(
    !res.stdout.includes('≥ maxExecutors'),
    `a clear box must print NO refusal reason (reasons are printed only when present); got stdout:\n${res.stdout}`,
  )
})

test('5) CLEAR --json: exit 0, parses through CapacityVerdictShape, canSpawn true, verdict verbatim', () => {
  const repo = newRepo(CLEAR_POLICY)
  const expected = expectedVerdict(CLEAR_POLICY)

  const res = capacity(repo, { probes: SIGNALS, args: ['--json'] })
  assert.equal(res.status, 0, `--json must exit 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  const body = parseStdout(res)
  assert.doesNotThrow(
    () => CapacityVerdictShape.parse(body),
    `--json must emit a CapacityVerdictShape-valid object; got:\n${res.stdout}`,
  )
  assert.equal(body.canSpawn, true, 'the clear fixture must report canSpawn true')
  assert.deepEqual(body, expected, 'the --json body must be the probeCapacity verdict VERBATIM')
})

// ── policy vs signals stay separate ────────────────────────────────────────────────────

test('6) POLICY APPLIES: identical fixed signals, only the config `capacity` block differs → exit 3 vs exit 0', () => {
  // busy = capbuildUnits 2 + liveArms 0. maxExecutors 2 refuses; maxExecutors 4 admits.
  // A command that ignored the consumer config (or hardcoded DEFAULT_CAPACITY) would exit 0
  // for both — this is the case that catches it.
  const starved = capacity(newRepo({ maxExecutors: 2 }), { probes: SIGNALS })
  const clear = capacity(newRepo({ maxExecutors: 4 }), { probes: SIGNALS })

  assert.equal(
    starved.status,
    3,
    `maxExecutors 2 with 2 busy must refuse; stdout:\n${starved.stdout}\nstderr:\n${starved.stderr}`,
  )
  assert.equal(
    clear.status,
    0,
    `maxExecutors 4 with 2 busy must admit; stdout:\n${clear.stdout}\nstderr:\n${clear.stderr}`,
  )
})

test('7) BOUNDARY: busy == maxExecutors refuses, busy == maxExecutors − 1 admits (exactly at the edge)', () => {
  const repo = newRepo({ maxExecutors: 3 })
  const at = capacity(repo, { probes: { ...SIGNALS, capbuildUnits: 2, liveArms: 1 } }) // busy 3
  const under = capacity(repo, { probes: { ...SIGNALS, capbuildUnits: 2, liveArms: 0 } }) // busy 2

  assert.equal(at.status, 3, `busy 3 == maxExecutors 3 must refuse; stdout:\n${at.stdout}\nstderr:\n${at.stderr}`)
  assert.equal(
    under.status,
    0,
    `busy 2 == maxExecutors − 1 must admit; stdout:\n${under.stdout}\nstderr:\n${under.stderr}`,
  )
})

// ── the determinism seam itself ────────────────────────────────────────────────────────

test('8) SEAM: every signal comes from the env probes — no live read leaks into the verdict', () => {
  // Values no live box can produce: 987654 MB available on a 999-core host. Each env field
  // must land on its own signal, so a partially-wired seam (load read live, mem from env)
  // reds here rather than silently mixing this box into a fixed fixture.
  const impossible = { memAvailableMb: 987_654, load1: 0, cores: 999, capbuildUnits: 0, liveArms: 0 }
  const repo = newRepo(CLEAR_POLICY)

  const res = capacity(repo, { probes: impossible, args: ['--json'] })
  assert.equal(res.status, 0, `--json must exit 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  const body = parseStdout(res)
  assert.deepEqual(
    body,
    expectedVerdict(CLEAR_POLICY, impossible),
    'with the seam set, the verdict is a pure function of the env values and the config policy',
  )
  const mem = body.signals.find((s) => /mem/i.test(s.name))
  const load = body.signals.find((s) => /load/i.test(s.name))
  assert.equal(mem?.value, impossible.memAvailableMb, 'the memory signal reports the injected MemAvailable')
  assert.equal(load?.limit, impossible.cores, 'the load signal reports the injected core count')
  assert.deepEqual(body.degraded, [], 'fully injected probes degrade nothing')
})

test('9) MALFORMED seam JSON: exit 2, the env var is NAMED, and NO verdict is emitted (never a silent live fallback)', () => {
  const repo = newRepo(CLEAR_POLICY)
  for (const bad of ['{"memAvailableMb": 64000', 'not-json-at-all']) {
    for (const args of [[], ['--json']]) {
      const res = capacity(repo, { probes: bad, args })
      const where = `input ${JSON.stringify(bad)} args ${JSON.stringify(args)}`
      assert.equal(
        res.status,
        2,
        `${where}: a malformed probe env is a refusal (exit 2), not a fallback; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
      )
      assert.match(
        res.stderr,
        /ZEROH_ROADMAP_CAPACITY_PROBES/,
        `${where}: the error must NAME the offending env var; got stderr:\n${res.stderr}`,
      )
      assert.equal(
        res.stdout.trim(),
        '',
        `${where}: nothing may be printed on stdout — a verdict here would be a silent fallback to live probes; got stdout:\n${res.stdout}`,
      )
    }
  }
})

// ── the live box (smoke) ───────────────────────────────────────────────────────────────

test('10) LIVE (no seam): `capacity --json` exits 0 and emits a CapacityVerdictShape-valid object', () => {
  // Host-touching smoke: this box's mood is not asserted, only that the live path runs and
  // the payload is shape-valid (degraded probes fail open, so an unreadable signal is fine).
  const repo = newRepo()
  const res = capacity(repo, { args: ['--json'] })
  assert.equal(res.status, 0, `--json must exit 0 on the live box; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)
  const body = parseStdout(res)
  assert.doesNotThrow(
    () => CapacityVerdictShape.parse(body),
    `the live verdict must satisfy CapacityVerdictShape; got:\n${res.stdout}`,
  )
})
