#!/usr/bin/env node
/**
 * WIRED tests for the NEW `roadmap status` surface — the --json machine shape and
 * the exit-code / stream-separation rails the parity oracle does NOT cover (the
 * legacy script had no --json). SPAWNs `node <plugin>/bin/roadmap.mjs status …`
 * over hermetic tmp estates. The ported derivation ladder itself is locked by
 * status.parity.test.mjs.
 *
 * Hermetic-tmp pattern from cli/commands/config.test.mjs. Run:
 *   node --test cli/commands/status.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CapacityVerdictShape, probeCapacity } from '../lib/capacity.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const tmps = []
function newTmp(prefix = 'zr-status-') {
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

/** Mirror of writePhase in cli/lib/phasescan.test.mjs. */
function writePhase(dir, fileName, { phase, status, arcId } = {}) {
  mkdirSync(dir, { recursive: true })
  const lines = ['export const p = {']
  if (phase !== undefined) lines.push(`  phase: ${phase},`)
  if (status !== undefined) lines.push(`  status: '${status}',`)
  if (arcId !== undefined) lines.push(`  arcId: '${arcId}',`)
  lines.push('}')
  writeFileSync(join(dir, fileName), lines.join('\n') + '\n')
}

/** An estate with one BUILDING sidecar + one in-progress phase; returns the root. */
function estateWithBuildingArc() {
  const root = join(newTmp(), 'roadmap')
  const phases = join(root, 'phases')
  const building = join(root, 'arcs', '.building')
  mkdirSync(building, { recursive: true })
  writePhase(phases, 'phase-2001.phase.ts', { phase: 2001, status: 'in-progress', arcId: 'BUILDA' })
  writePhase(phases, 'phase-2002.phase.ts', { phase: 2002, status: 'backlog', arcId: 'BUILDA' })
  writeFileSync(
    join(building, 'BUILDA.json'),
    JSON.stringify({ arcId: 'BUILDA', worktree: '/nonexistent/wt-builda', branch: 'arc/builda', mode: 'mixed' }) + '\n',
  )
  return root
}

/** An estate with an empty phases/ dir and no arcs; returns the root. */
function emptyEstate() {
  const root = join(newTmp(), 'roadmap')
  mkdirSync(join(root, 'phases'), { recursive: true })
  return root
}

const status = (...args) => spawnSync('node', [BIN, 'status', ...args], { encoding: 'utf8' })

test('1) --json emits the { derivedAt, repo, rows, otherWorktrees, warnings } shape on stdout', () => {
  const root = estateWithBuildingArc()
  const res = status(root, '--json')
  assert.equal(res.status, 0, `status --json must exit 0; stderr:\n${res.stderr}`)

  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON; got:\n${res.stdout}`)

  for (const key of ['derivedAt', 'repo', 'rows', 'otherWorktrees', 'warnings']) {
    assert.ok(key in parsed, `--json object must carry the "${key}" key; got keys ${Object.keys(parsed)}`)
  }
  assert.ok(Array.isArray(parsed.rows), 'rows is an array')
  assert.ok(parsed.rows.length >= 1, 'the BUILDING sidecar must produce at least one row')
  for (const row of parsed.rows) {
    for (const k of ['arc', 'state', 'where', 'age', 'note']) {
      assert.ok(k in row, `each row must carry "${k}"; got ${JSON.stringify(row)}`)
    }
  }
  const buildaRow = parsed.rows.find((r) => r.arc === 'BUILDA')
  assert.ok(buildaRow, 'the BUILDA lane must be present in rows')
  assert.equal(buildaRow.state, 'BUILDING', 'a non-paused sidecar lane is BUILDING')
})

test('2) --json keeps stdout parseable even when stderr carries narration', () => {
  const root = estateWithBuildingArc()
  const res = status(root, '--json')
  assert.equal(res.status, 0)
  // Stream-separation invariant: whatever lands on stderr, stdout parses alone.
  assert.doesNotThrow(() => {
    JSON.parse(res.stdout)
  }, `stdout must parse as JSON regardless of stderr content; stderr was:\n${res.stderr}\nstdout:\n${res.stdout}`)
})

test('3) empty estate → exit 0 and the human table reports All lanes free', () => {
  const root = emptyEstate()
  const res = status(root)
  assert.equal(res.status, 0, `an empty estate is not an error; stderr:\n${res.stderr}`)
  assert.match(res.stdout, /All lanes free/, `empty-estate body must say "All lanes free"; got:\n${res.stdout}`)
})

// ── the post-merge-watch marker banner (TESTARCH §1533 follow-up 2) ──────────────

/** Turn an estate's parent dir into a git repo (the marker resolves via git-common-dir). */
function gitify(repoDir) {
  const g = (...args) => spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
  g('init', '-q')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  writeFileSync(join(repoDir, 'seed.txt'), 'seed\n')
  g('add', 'seed.txt')
  g('commit', '-qm', 'seed')
  return g
}

function writeMarker(repoDir, marker) {
  mkdirSync(join(repoDir, '.test-logs'), { recursive: true })
  writeFileSync(join(repoDir, '.test-logs', 'post-merge-status.json'), marker)
}

const RED_MARKER = JSON.stringify({
  ref: 'develop',
  sha: 'abc1234def5678',
  treeSha: 'ffff',
  dirty: false,
  startedAt: '2026-07-18T00:00:00Z',
  finishedAt: '2026-07-18T00:10:00Z',
  result: 'red',
  tiers: { unit: 1, integration: 0 },
  headline: 'unit failed',
})

test('5) RED marker at the repo root → ONE bounded banner line in human output and --json warnings', () => {
  const repoDir = join(newTmp(), 'repo')
  const root = join(repoDir, 'roadmap')
  mkdirSync(join(root, 'phases'), { recursive: true })
  gitify(repoDir)
  writeMarker(repoDir, RED_MARKER)

  const human = status(root)
  assert.equal(human.status, 0)
  assert.match(
    human.stdout,
    /⚠ post-merge-watch RED @ abc1234 \(2026-07-18T00:10:00Z\): unit failed/,
    `human output must carry the RED banner; got:\n${human.stdout}`,
  )

  const json = status(root, '--json')
  const parsed = JSON.parse(json.stdout)
  assert.ok(
    parsed.warnings.some((w) => /post-merge-watch RED @ abc1234/.test(w)),
    `--json warnings must carry the RED line; got ${JSON.stringify(parsed.warnings)}`,
  )
})

test('6) linked worktree → the banner resolves the MAIN checkout\'s .test-logs (git-common-dir rule)', () => {
  const repoDir = join(newTmp(), 'repo')
  mkdirSync(repoDir, { recursive: true })
  const g = gitify(repoDir)
  writeMarker(repoDir, RED_MARKER)
  const wt = join(newTmp(), 'wt')
  const added = g('worktree', 'add', '-q', wt, '-b', 'wt-branch')
  assert.equal(added.status, 0, `worktree add must succeed; stderr:\n${added.stderr}`)
  const wtRoot = join(wt, 'roadmap')
  mkdirSync(join(wtRoot, 'phases'), { recursive: true })

  const res = status(wtRoot)
  assert.equal(res.status, 0)
  assert.match(
    res.stdout,
    /post-merge-watch RED @ abc1234/,
    `a linked-worktree status must surface the MAIN checkout's red marker; got:\n${res.stdout}`,
  )
})

test('7) absent / green / running / unparseable marker (or a non-repo root) → zero output change', () => {
  const cases = [
    { name: 'green', body: RED_MARKER.replace('"red"', '"green"') },
    { name: 'running', body: RED_MARKER.replace('"red"', '"running"') },
    { name: 'unparseable', body: '{ not json' },
  ]
  const baselineStrip = (s) => s.replace(/derived [^ ]+ /, 'derived T ')

  // absent marker + non-repo root — today's output exactly (the test-1 estate is not a repo)
  const plainRoot = emptyEstate()
  const plain = status(plainRoot)
  assert.doesNotMatch(plain.stdout, /post-merge-watch/, 'no marker → no banner')

  for (const c of cases) {
    const repoDir = join(newTmp(), 'repo')
    const root = join(repoDir, 'roadmap')
    mkdirSync(join(root, 'phases'), { recursive: true })
    gitify(repoDir)
    const before = status(root)
    writeMarker(repoDir, c.body)
    const after = status(root)
    assert.equal(
      baselineStrip(after.stdout),
      baselineStrip(before.stdout),
      `a ${c.name} marker must not change the human output`,
    )
    assert.doesNotMatch(after.stdout, /post-merge-watch/, `a ${c.name} marker never prints the banner`)
  }
})

test('8) missing roadmap root → exit 1 with the no-roadmap line on stderr', () => {
  const res = status('/no/such/roadmap')
  assert.equal(res.status, 1, `a missing root is a usage error → exit 1; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /no roadmap at/, `stderr must name the missing roadmap; got:\n${res.stderr}`)
  assert.equal(res.stdout.trim(), '', 'nothing on stdout on the error path')
})

// ── lane-integrity flags: DIVERGED? (phase/task-state drift) + STALE-ARM (leaked arm) ──
// Additive, like the post-merge-watch banner: absent whenever the condition does not
// hold, so the synthetic parity estate (no done-task-under-backlog, no arm files) stays
// byte-identical and status.parity.test.mjs is untouched.

/** A BUILDING lane whose backlog member carries a REAL done:true task → a status/task divergence. */
function estateWithDivergedArc() {
  const root = join(newTmp(), 'roadmap')
  const phases = join(root, 'phases')
  const building = join(root, 'arcs', '.building')
  mkdirSync(phases, { recursive: true })
  mkdirSync(building, { recursive: true })
  // done:true is a real task field (NOT prose in a notes string) — a genuine divergence:
  // work landed but the phase was never moved to in-progress.
  writeFileSync(
    join(phases, 'phase-3001.phase.ts'),
    [
      'export default {',
      '  phase: 3001,',
      "  status: 'backlog',",
      "  arcId: 'DIVERGE',",
      '  tasks: [',
      "    { id: '3001.1', done: true },",
      '  ],',
      '}',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(building, 'DIVERGE.json'),
    JSON.stringify({ arcId: 'DIVERGE', worktree: '/nonexistent/wt-diverge', branch: 'arc/diverge', mode: 'mixed' }) + '\n',
  )
  return root
}

/** A BUILDING lane with a REAL linked worktree carrying a bare-format (leaked) executor arm. */
function estateWithStaleArm() {
  const repoDir = join(newTmp(), 'repo')
  mkdirSync(repoDir, { recursive: true })
  const g = gitify(repoDir)
  const root = join(repoDir, 'roadmap')
  const phases = join(root, 'phases')
  const building = join(root, 'arcs', '.building')
  mkdirSync(phases, { recursive: true })
  mkdirSync(building, { recursive: true })

  const wt = join(newTmp(), 'wt')
  const added = g('worktree', 'add', '-q', wt, '-b', 'arc-stalearm')
  assert.equal(added.status, 0, `worktree add must succeed; stderr:\n${added.stderr}`)
  // The pre-D9 phase-number FOSSIL — genuinely unbound, stale by definition. (A raw
  // session-id string would be the old BOUND prose format the guard honors — it must
  // NOT flag on a live phase: the 1703 near-miss.)
  mkdirSync(join(wt, '.building'), { recursive: true })
  const armFile = join(wt, '.building', '2001-executor.armed')
  writeFileSync(armFile, '2001\n')

  writePhase(phases, 'phase-2001.phase.ts', { phase: 2001, status: 'in-progress', arcId: 'STALEARM' })
  writeFileSync(
    join(building, 'STALEARM.json'),
    JSON.stringify({ arcId: 'STALEARM', worktree: wt, branch: 'arc-stalearm', mode: 'mixed' }) + '\n',
  )
  return { root, wt, armFile }
}

test('9) DIVERGED? — a backlog member with a done:true task marks the lane diverged (--json row.diverged + human flag)', () => {
  const root = estateWithDivergedArc()

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  const row = parsed.rows.find((r) => r.arc === 'DIVERGE')
  assert.ok(row, 'the DIVERGE lane must be present in rows')
  assert.ok(Array.isArray(row.diverged), `row.diverged must be a typed array; got ${JSON.stringify(row.diverged)}`)
  assert.ok(
    row.diverged.map(String).includes('3001'),
    `row.diverged must name the diverged phase 3001; got ${JSON.stringify(row.diverged)}`,
  )

  const human = status(root)
  assert.equal(human.status, 0)
  assert.match(human.stdout, /DIVERGED\?/, `the human table must carry the DIVERGED? flag; got:\n${human.stdout}`)
})

test('10) STALE-ARM — a bare-format arm in the lane worktree marks the lane (--json row.staleArms + human flag)', () => {
  const { root } = estateWithStaleArm()

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  const row = parsed.rows.find((r) => r.arc === 'STALEARM')
  assert.ok(row, 'the STALEARM lane must be present in rows')
  assert.ok(Array.isArray(row.staleArms), `row.staleArms must be a typed array; got ${JSON.stringify(row.staleArms)}`)
  assert.ok(
    row.staleArms.some((f) => /2001-executor\.armed/.test(String(f))),
    `row.staleArms must name the leaked arm file; got ${JSON.stringify(row.staleArms)}`,
  )

  const human = status(root)
  assert.equal(human.status, 0)
  assert.match(human.stdout, /STALE-ARM/, `the human table must carry the STALE-ARM flag; got:\n${human.stdout}`)
})

test('11) clean lane — an in-progress member with no task divergence and no arm carries NEITHER marker', () => {
  const root = estateWithBuildingArc() // BUILDA: in-progress 2001 + backlog 2002, no done-tasks, no arms

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  const row = parsed.rows.find((r) => r.arc === 'BUILDA')
  assert.ok(row, 'the BUILDA lane is present')
  assert.deepEqual(row.diverged ?? [], [], 'a clean lane carries no diverged phases')
  assert.deepEqual(row.staleArms ?? [], [], 'a clean lane carries no stale arms')

  const human = status(root)
  assert.equal(human.status, 0)
  assert.doesNotMatch(human.stdout, /DIVERGED\?|STALE-ARM/, 'a clean lane prints neither integrity flag')
})

// ── box capacity on the --json machine shape ONLY (task 11.5) ────────────────────
// `capacity` rides --json because the human table is parity-pinned byte-compatible
// (status.parity.test.mjs). Case 14 pins that constraint from the behavior side, so a
// capacity line leaking into the human table reds HERE too, not only in the parity lock.

/**
 * A STARVED probe fixture that no live box can produce and NO policy block can rescue:
 * 0 MB available (memSlots 0 for any non-negative minFreeMemMb), load 64 on 1 core
 * (loadSlots 0), 198 busy executors (busySlots 0 for any sane maxExecutors). canSpawn is
 * therefore false on the fixture's own merits — the discriminating value, since a status
 * that ignored the seam and read this dev box would answer true.
 */
const STARVED_PROBES = Object.freeze({
  memAvailableMb: 0,
  load1: 64,
  cores: 1,
  capbuildUnits: 99,
  liveArms: 99,
})

/** The env-probe payload projected onto probeCapacity's injectable reader contract
 *  (same projection as capacity.test.mjs — the library stays the one source of truth). */
const asProbes = (p) => ({
  memAvailableMb: () => p.memAvailableMb,
  load: () => ({ load1: p.load1, cores: p.cores }),
  runningCapbuildUnits: () => p.capbuildUnits,
  liveExecutorArms: () => p.liveArms,
})

/**
 * A BUILDING estate inside a real git repo that carries a minimal roadmap.config.json with
 * NO `capacity` block — so the policy bounds are DEFAULT_CAPACITY, never this dev box's
 * consumer config. Returns { repoDir, root }.
 * NB the tmp prefix must not contain the word "capacity": case 14 greps the human output,
 * which prints repo + worktree paths.
 */
function configuredEstate() {
  const repoDir = join(newTmp('zr-status-seam-'), 'repo')
  const root = join(repoDir, 'roadmap')
  const building = join(root, 'arcs', '.building')
  mkdirSync(building, { recursive: true })
  gitify(repoDir)
  writeFileSync(
    join(root, 'roadmap.config.json'),
    JSON.stringify(
      {
        configVersion: 1,
        gateCommands: { lint: 'none', types: 'none', unit: 'none', integration: 'none', build: 'none', e2e: 'none', emit: 'none' },
      },
      null,
      2,
    ) + '\n',
  )
  writePhase(join(root, 'phases'), 'phase-2001.phase.ts', { phase: 2001, status: 'in-progress', arcId: 'BUILDA' })
  writeFileSync(
    join(building, 'BUILDA.json'),
    JSON.stringify({ arcId: 'BUILDA', worktree: '/nonexistent/wt-builda', branch: 'arc/builda', mode: 'mixed' }) + '\n',
  )
  return { repoDir, root }
}

/**
 * Spawn status FROM `cwd` (config resolution happens off the process cwd, as in
 * capacity.mjs). `probes` object → serialized into the seam env; omitted → the seam is
 * explicitly UNSET so the live-box case cannot be faked by an ambient var. ROADMAP_CONFIG
 * is stripped too: an inherited one would defeat the hermetic config above.
 */
function statusIn(cwd, { probes, args = [] } = {}) {
  const env = { ...process.env }
  delete env.ROADMAP_CONFIG
  delete env.ZEROH_ROADMAP_CAPACITY_PROBES
  if (probes !== undefined) env.ZEROH_ROADMAP_CAPACITY_PROBES = JSON.stringify(probes)
  return spawnSync('node', [BIN, 'status', ...args], { cwd, encoding: 'utf8', env })
}

test('12) --json carries a top-level capacity verdict computed from the probe seam (starved fixture → canSpawn false)', () => {
  const { repoDir, root } = configuredEstate()
  const expected = probeCapacity(undefined, asProbes(STARVED_PROBES)) // no config `capacity` block
  assert.equal(expected.canSpawn, false, 'fixture guard: the starved fixture must be a refusal')
  assert.equal(expected.maxParallel, 0, 'fixture guard: a refusal admits zero further executors')

  const res = statusIn(repoDir, { probes: STARVED_PROBES, args: [root, '--json'] })
  assert.equal(res.status, 0, `status --json must exit 0; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)

  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON; got:\n${res.stdout}`)

  assert.ok('capacity' in parsed, `--json must carry the "capacity" key; got keys ${Object.keys(parsed)}`)
  assert.doesNotThrow(
    () => CapacityVerdictShape.parse(parsed.capacity),
    `capacity must parse through CapacityVerdictShape; got:\n${JSON.stringify(parsed.capacity, null, 2)}`,
  )
  assert.equal(parsed.capacity.canSpawn, false, 'the starved fixture must report canSpawn false')
  assert.equal(parsed.capacity.maxParallel, 0, 'a refusal admits zero further executors')

  // The seam must supply EVERY signal — a status that read the live box (or wired only some
  // fields) cannot produce 0 MB available on a 1-core host.
  const mem = parsed.capacity.signals.find((s) => /mem/i.test(s.name))
  const load = parsed.capacity.signals.find((s) => /load/i.test(s.name))
  assert.equal(mem?.value, STARVED_PROBES.memAvailableMb, 'the memory signal reports the INJECTED MemAvailable, not the live box')
  assert.equal(load?.limit, STARVED_PROBES.cores, 'the load signal reports the INJECTED core count, not the live box')
  assert.deepEqual(parsed.capacity.degraded, [], 'fully injected probes degrade nothing')

  assert.deepEqual(
    parsed.capacity,
    expected,
    'capacity must be the probeCapacity verdict VERBATIM — status may not re-implement the admission math',
  )
})

test('13) --json WITHOUT the seam still carries a shape-valid capacity (live box; no value pinned)', () => {
  const { repoDir, root } = configuredEstate()
  const res = statusIn(repoDir, { args: [root, '--json'] }) // seam explicitly unset
  assert.equal(res.status, 0, `status --json must exit 0 on the live box; stdout:\n${res.stdout}\nstderr:\n${res.stderr}`)

  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(res.stdout)
  }, `stdout must be PURE JSON; got:\n${res.stdout}`)
  assert.ok('capacity' in parsed, `--json must carry the "capacity" key without the seam too; got keys ${Object.keys(parsed)}`)
  assert.doesNotThrow(
    () => CapacityVerdictShape.parse(parsed.capacity),
    `the live verdict must satisfy CapacityVerdictShape; got:\n${JSON.stringify(parsed.capacity, null, 2)}`,
  )
})

test('14) HUMAN output carries NO capacity text — byte-identical with and without the seam (the parity constraint)', () => {
  const { repoDir, root } = configuredEstate()
  const stripDerived = (s) => s.replace(/derived [0-9T:.Z-]+/g, 'derived <TS>')

  const seamed = statusIn(repoDir, { probes: STARVED_PROBES, args: [root] })
  assert.equal(seamed.status, 0, `human status must exit 0; stdout:\n${seamed.stdout}\nstderr:\n${seamed.stderr}`)
  assert.doesNotMatch(
    seamed.stdout,
    /capacity/i,
    `the human table must print NO capacity text (status.parity.test.mjs pins it byte-compatible); got:\n${seamed.stdout}`,
  )

  const bare = statusIn(repoDir, { args: [root] })
  assert.equal(bare.status, 0, `human status must exit 0 without the seam; stderr:\n${bare.stderr}`)
  assert.equal(
    stripDerived(seamed.stdout),
    stripDerived(bare.stdout),
    'a set probe seam may not change ONE byte of the human table (only --json is additive)',
  )
})

// ── the stray-lane line: status counts the lanes that outlived their run (task 14.4) ──
//
// `status` is the one command every protocol entry already runs, so it is the automatic
// surfacing seam for lane worktrees that outlive their run and are otherwise invisible
// from every command. ONE line, fed by the already-landed classifier surveyLanes(root) over
// the repo status already derives — never a second worktree-enumeration parser.
//
// The zero case is a ZERO-OUTPUT change on BOTH surfaces: no line, and the `strayLanes` key
// ABSENT (not 0) from --json — same additive-divergence discipline as postMergeRedLine, which
// the module docblock pins against the byte-compatible legacy oracle in status.parity.test.mjs.
//
// Imports live in this block rather than in the header so the whole seam lands as one
// contiguous append (ESM hoists them). Fixtures are REAL: real `git worktree add` at the
// launcher's own sibling path shape `<repo>-codex-<ids>`, real journals in <repo>/.building/,
// and real detached process GROUPS for liveness — a hand-written pgid would prove only that a
// number was compared to something.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/** THE sentence, verbatim per the contract — asserted whole, because a loose /strays/ substring
 *  would pass on a line that named no count and pointed at no remedy. */
const strayLine = (n) => `strays: ${n} lane worktree(s) past their done-moment — run \`roadmap audit\` for each remedy`

/** Occurrences of a literal — "exactly once" is the claim, and /match/ cannot tell one from three. */
const countOf = (haystack, needle) => haystack.split(needle).length - 1

/** The PHASE-11 LESSON, encoded: an absence assertion against stdout alone is a false green when
 *  the implementation writes the line to stderr. Every "not printed" claim reads BOTH streams. */
const bothStreams = (res) => `${res.stdout}\n${res.stderr}`

/** kill(0) against a process GROUP — the liveness a lane journal's pgid actually means. */
const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

const kids = []
process.on('exit', () => {
  for (const c of kids) {
    try {
      process.kill(-c.pid, 'SIGKILL')
    } catch {
      /* already reaped */
    }
  }
})

/** A real detached child: its own group leader, so pgid === pid and killing it kills the group.
 *  A non-detached child would share the RUNNER's group — live for the wrong reason, and unreapable,
 *  which would make the dead-pgid half of the seam impossible to prove. */
function liveGroup() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore', detached: true })
  child.unref()
  kids.push(child)
  assert.ok(groupAlive(child.pid), `fixture bug: the spawned group ${child.pid} must be alive before a live lane is asserted`)
  return child
}

/**
 * Reap a group and PROVE it gone — a "stale" fixture whose group is merely assumed dead proves
 * nothing. POLLED rather than `await once(child, 'exit')`: the child is unref'd, so its handle
 * holds nothing on the event loop, and awaiting its exit event in a loop with no other work
 * pending resolves the loop instead of the promise (measured — every async case here cancelled
 * with "Promise resolution is still pending"). The timer is what keeps the loop turning long
 * enough for libuv to see the SIGCHLD.
 */
async function reapGroup(child) {
  child.kill('SIGKILL')
  for (let i = 0; i < 300 && groupAlive(child.pid); i += 1) {
    await new Promise((r) => setTimeout(r, 10))
  }
  assert.equal(groupAlive(child.pid), false, `fixture bug: group ${child.pid} must be dead before a stray is asserted`)
}

const gitIn = (repoDir, ...args) => spawnSync('git', ['-C', repoDir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' })

/**
 * A git repo whose `roadmap/phases` exists — `roadmap status` takes the ROADMAP ROOT and derives
 * `repo` as that root's git toplevel, so the lane survey only has a repo to ask about when the
 * estate sits inside one. Returns { repoDir, root }.
 */
function strayEstate() {
  const repoDir = join(newTmp('zr-status-lane-'), 'repo')
  const root = join(repoDir, 'roadmap')
  mkdirSync(join(root, 'phases'), { recursive: true })
  gitify(repoDir)
  return { repoDir, root }
}

/**
 * A real lane worktree at the LAUNCHER's own sibling path shape, `<repo>-codex-<ids>`.
 * Deliberately NOT inside the repo and NOT `<repo>-wt-<k>`: a session slot is the one worktree
 * shape the survey excludes by design, and building lanes there would hide the count entirely.
 */
function laneWorktree(repoDir, suffix, branch) {
  const dir = `${repoDir}-${suffix}`
  tmps.push(dir) // swept by the suite's exit hook — no worktree survives the run
  const added = gitIn(repoDir, 'worktree', 'add', '-q', '-b', branch, dir, 'HEAD')
  assert.equal(added.status, 0, `fixture bug: git must create the lane worktree ${dir}; stderr:\n${added.stderr}`)
  const listed = gitIn(repoDir, 'worktree', 'list', '--porcelain').stdout
  assert.ok(listed.includes(dir), `fixture bug: git must KNOW ${dir} before status is asked to count it; list was:\n${listed}`)
  return dir
}

/** A REAL lane journal at <repo>/.building/codex-<ids>.json, in the launcher's own field set
 *  (launch() in cli/commands/codex.mjs writes exactly this). `worktree` is the absolute lane dir. */
function laneJournal(repoDir, { ids = ['21'], worktree, pgid }) {
  const building = join(repoDir, '.building')
  mkdirSync(building, { recursive: true })
  const path = join(building, `codex-${ids.join('-')}.json`)
  writeFileSync(
    path,
    JSON.stringify(
      {
        phases: ids,
        lane: 'run',
        report: 'CODEX-REPORT.md',
        worktree,
        base: 'develop',
        pgid,
        log: join(building, `codex-${ids.join('-')}.log`),
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  )
  return path
}

test('15) one dead-pgid lane → the human output carries the stray line ONCE and --json carries strayLanes: 1', async () => {
  const { repoDir, root } = strayEstate()
  const dir = laneWorktree(repoDir, 'codex-21', 'codex/21')
  const dead = liveGroup()
  await reapGroup(dead) // the deadness is REAL before the stray is asserted, never assumed
  laneJournal(repoDir, { ids: ['21'], worktree: dir, pgid: dead.pid })

  const human = status(root)
  assert.equal(human.status, 0, `a stray lane is a REPORT, not an error — status must still exit 0; stderr:\n${human.stderr}`)
  assert.equal(
    countOf(human.stdout, strayLine(1)),
    1,
    `the human output must carry the stray line VERBATIM exactly once — one lane past its done-moment, one line naming the count and the audit pointer; got:\n${human.stdout}`,
  )
  assert.equal(
    countOf(bothStreams(human), strayLine(1)),
    1,
    `and exactly once across BOTH streams — a line printed to stdout AND stderr tells the operator there are two strays; got stderr:\n${human.stderr}`,
  )

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0 over a stray lane; stderr:\n${json.stderr}`)
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(json.stdout)
  }, `stdout must stay PURE JSON with the stray key present; got:\n${json.stdout}`)
  assert.ok('strayLanes' in parsed, `--json must carry the "strayLanes" key when a stray exists; got keys ${Object.keys(parsed)}`)
  assert.equal(
    typeof parsed.strayLanes,
    'number',
    `strayLanes is a COUNT, so a number — a string or a boolean cannot be summed or compared by any consumer; got ${JSON.stringify(parsed.strayLanes)}`,
  )
  assert.equal(parsed.strayLanes, 1, 'one non-live lane worktree is one stray')
})

test('16) no lane worktrees → the stray line appears on NEITHER stream and --json omits the key entirely', () => {
  const { root } = strayEstate() // the same git estate, minus the lanes

  const human = status(root)
  assert.equal(human.status, 0, `a clean estate is not an error; stderr:\n${human.stderr}`)
  assert.doesNotMatch(
    bothStreams(human),
    /strays:/,
    `at zero the line is NOT printed — on stdout OR stderr (the phase-11 lesson: a stdout-only absence check is a false green); got:\n${bothStreams(human)}`,
  )
  assert.doesNotMatch(
    bothStreams(human),
    /past their done-moment/,
    `and no fragment of it survives either — the human table is parity-pinned byte-compatible with the legacy scripts/arc-status.mjs; got:\n${bothStreams(human)}`,
  )

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0 on a clean estate; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  assert.equal(
    'strayLanes' in parsed,
    false,
    `the key must be ABSENT at zero, not 0 — the zero case is a zero-output change on BOTH surfaces (the postMergeRedLine precedent); got ${JSON.stringify(parsed.strayLanes)} among keys ${Object.keys(parsed)}`,
  )
})

test('17) a LIVE-pgid lane is never counted — no line on either stream, no strayLanes key', async () => {
  const { repoDir, root } = strayEstate()
  const dir = laneWorktree(repoDir, 'codex-23', 'codex/23')
  const runner = liveGroup()
  laneJournal(repoDir, { ids: ['23'], worktree: dir, pgid: runner.pid })

  const human = status(root)
  const json = status(root, '--json')
  assert.ok(
    groupAlive(runner.pid),
    `fixture guard: the lane's process group ${runner.pid} must still be RUNNING at assert time — a group that died mid-test would make this the stale case wearing the live case's name`,
  )

  assert.equal(human.status, 0, `a live lane is ordinary operation; stderr:\n${human.stderr}`)
  assert.doesNotMatch(
    bothStreams(human),
    /strays:/,
    `a lane still writing into its tree has not outlived its run — counting it as a stray invites an operator to remove work in flight; got:\n${bothStreams(human)}`,
  )

  assert.equal(json.status, 0, `status --json must exit 0 over a live lane; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  assert.equal(
    'strayLanes' in parsed,
    false,
    `a live lane leaves the count at zero, and zero omits the key; got ${JSON.stringify(parsed.strayLanes)}`,
  )

  await reapGroup(runner)
})

test('18) TWO non-live lanes → strayLanes: 2 and a human line reading 2 (the count is a count, not a boolean)', async () => {
  const { repoDir, root } = strayEstate()
  const journalled = laneWorktree(repoDir, 'codex-31', 'codex/31')
  const dead = liveGroup()
  await reapGroup(dead)
  laneJournal(repoDir, { ids: ['31'], worktree: journalled, pgid: dead.pid })
  // A second lane no journal names at all — also non-live, also past its done-moment. A count
  // that only saw journal-matched rows would report 1 here and look perfectly correct.
  laneWorktree(repoDir, 'codex-32', 'codex/32')

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0 over two strays; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  assert.equal(
    parsed.strayLanes,
    2,
    `two non-live lane worktrees are TWO strays — a hardcoded 1 (or a boolean flag rendered as a number) reads the same at one lane and lies at two; got ${JSON.stringify(parsed.strayLanes)}`,
  )

  const human = status(root)
  assert.equal(
    countOf(human.stdout, strayLine(2)),
    1,
    `and the human line must READ 2 — the operator sizes the cleanup off this number; got:\n${human.stdout}`,
  )
  assert.equal(
    countOf(bothStreams(human), strayLine(1)),
    0,
    `never a per-lane line: ONE bounded line is the contract, so the count-1 sentence must not appear at all; got:\n${bothStreams(human)}`,
  )
})

test('19) status is a READ — the counted lane, its git registration and its branch all survive the run', async () => {
  const { repoDir, root } = strayEstate()
  const dir = laneWorktree(repoDir, 'codex-41', 'codex/41')
  const dead = liveGroup()
  await reapGroup(dead)
  const jPath = laneJournal(repoDir, { ids: ['41'], worktree: dir, pgid: dead.pid })

  const json = status(root, '--json')
  assert.equal(
    JSON.parse(json.stdout).strayLanes,
    1,
    'guard: the lane must actually be COUNTED here, or the survival assertions below prove nothing',
  )
  status(root) // the human path too — both surfaces run the same survey

  assert.ok(
    existsSync(dir),
    `the lane worktree must still be on disk: status REPORTS strays, it never disposes them — a command that quietly removed what it counted would satisfy every assertion above and eat an operator's tree`,
  )
  const listed = gitIn(repoDir, 'worktree', 'list', '--porcelain').stdout
  assert.ok(
    listed.includes(dir),
    `and git must still have it REGISTERED — a silent \`worktree prune\` behind a read command strands the disposal rail's own preconditions; list was:\n${listed}`,
  )
  const branch = gitIn(repoDir, 'rev-parse', '--verify', 'refs/heads/codex/41')
  assert.equal(
    branch.status,
    0,
    `and the lane branch must survive: it is the only named handle on that lane's commits until a done-moment lands them; stderr:\n${branch.stderr}`,
  )
  assert.ok(
    existsSync(jPath),
    `and the journal must survive unarchived — archiving it is the done-moment's stamp, and a read command may not claim a done-moment that never happened`,
  )
})

test('20) a live lane BESIDE a stale one → strayLanes: 1 — the count is the NON-LIVE rows, not every row', async () => {
  // Case 17 states the live rule where it can only be observed as silence, so it also passes on a
  // status that never learned to count at all. Here the live lane sits next to a real stray, so the
  // rule has a NUMBER to be wrong about: a count of every surveyLanes row reports 2 and sends an
  // operator to remove a tree a run is still writing into.
  const { repoDir, root } = strayEstate()

  const running = laneWorktree(repoDir, 'codex-51', 'codex/51')
  const runner = liveGroup()
  laneJournal(repoDir, { ids: ['51'], worktree: running, pgid: runner.pid })

  const finished = laneWorktree(repoDir, 'codex-52', 'codex/52')
  const dead = liveGroup()
  await reapGroup(dead)
  laneJournal(repoDir, { ids: ['52'], worktree: finished, pgid: dead.pid })

  const json = status(root, '--json')
  const human = status(root)
  assert.ok(
    groupAlive(runner.pid),
    `fixture guard: lane 51's group ${runner.pid} must still be RUNNING at assert time, or this is two stale lanes wearing one live lane's name`,
  )

  assert.equal(json.status, 0, `status --json must exit 0; stderr:\n${json.stderr}`)
  assert.equal(
    JSON.parse(json.stdout).strayLanes,
    1,
    'two lane worktrees, ONE of them past its done-moment — a live lane is never a stray, however many rows the survey returns',
  )
  assert.equal(
    countOf(human.stdout, strayLine(1)),
    1,
    `and the human line must read 1; got:\n${human.stdout}`,
  )
  assert.equal(
    countOf(bothStreams(human), strayLine(2)),
    0,
    `never 2 — counting the in-flight lane sends an operator at a tree that is still being written; got:\n${bothStreams(human)}`,
  )

  await reapGroup(runner)
})

// ── the per-arc EVAL gap (task 18.3) ─────────────────────────────────────────────────
// An arc whose every member phase is `done` and which carries NO dated eval report reads on
// this table exactly like an arc with nothing left to do: "all phases done" is the last thing
// the row says, and the missing report is invisible. The marker closes that, and it is scoped
// to the ANCHORED report name `^<ID>-YYYY-MM-DD.json$` — roadmap/arc-evals/ also holds
// `-verdicts.json` / `-sweep.json` siblings and OTHER arcs' reports, and reading any of those
// as "the eval ran" is the false all-clear the marker exists to stop. An arc still building
// shows nothing: its eval is not late, it is not yet due.

const EVAL_NONE = 'eval: none'

/**
 * A BUILDING lane whose members are all `done` — an arc past its last phase, awaiting
 * sweep/validate/land, which is exactly the moment a missing eval becomes visible.
 * `lastStatus` re-opens the arc for the in-progress direction; `evalFiles` names what sits in
 * roadmap/arc-evals/ (null = the directory does not exist at all).
 */
function estateWithLandedArc(arcId, { evalFiles = null, lastStatus = 'done' } = {}) {
  const root = join(newTmp(), 'roadmap')
  const phases = join(root, 'phases')
  const building = join(root, 'arcs', '.building')
  mkdirSync(building, { recursive: true })
  writePhase(phases, 'phase-4001.phase.ts', { phase: 4001, status: 'done', arcId })
  writePhase(phases, 'phase-4002.phase.ts', { phase: 4002, status: lastStatus, arcId })
  writeFileSync(
    join(building, `${arcId}.json`),
    JSON.stringify({ arcId, worktree: `/nonexistent/wt-${arcId}`, branch: `arc/${arcId}`, mode: 'mixed' }) + '\n',
  )
  if (evalFiles) {
    const evals = join(root, 'arc-evals')
    mkdirSync(evals, { recursive: true })
    // Shape-valid enough to be read as a report by anything that opens it — the point of the
    // sibling cases is that the NAME alone decides, so the bytes must not be the reason.
    for (const f of evalFiles) writeFileSync(join(evals, f), JSON.stringify({ arcId, dimensions: {} }) + '\n')
  }
  return root
}

/** The one row this arc owns, from the --json lane. */
function jsonRow(root, arcId) {
  const res = status(root, '--json')
  assert.equal(res.status, 0, `status --json must exit 0; stderr:\n${res.stderr}`)
  const row = JSON.parse(res.stdout).rows.find((r) => r.arc === arcId)
  assert.ok(row, `the ${arcId} lane must be present in rows`)
  return row
}

test('21) all member phases done + NO dated report → the eval: none marker and --json evalMissing: true', () => {
  const root = estateWithLandedArc('EVALGAP') // no roadmap/arc-evals/ at all

  const row = jsonRow(root, 'EVALGAP')
  // Without this the case could pass while the arc was merely mid-flight and the marker was
  // being printed for the wrong reason.
  assert.match(
    String(row.note ?? ''),
    /all phases done/,
    `precondition: EVALGAP's members must all read done; note was ${JSON.stringify(row.note)}`,
  )
  assert.equal(row.evalMissing, true, `a landed arc with no dated report must be flagged; row was ${JSON.stringify(row)}`)

  const human = status(root)
  assert.equal(human.status, 0, `status must exit 0; stderr:\n${human.stderr}`)
  assert.ok(
    human.stdout.includes(EVAL_NONE),
    `the human table must carry the '${EVAL_NONE}' marker — an unscored arc that reads as finished is the whole gap; got:\n${human.stdout}`,
  )
})

test('22) a dated report matching the anchored name SUPPRESSES both the marker and the flag', () => {
  const root = estateWithLandedArc('EVALDONE', { evalFiles: ['EVALDONE-2026-08-30.json'] })

  const row = jsonRow(root, 'EVALDONE')
  assert.match(String(row.note ?? ''), /all phases done/, 'precondition: the arc is landed, so the marker would be due')
  assert.notEqual(row.evalMissing, true, `the eval EXISTS — flagging it sends an operator to re-run a done job; row was ${JSON.stringify(row)}`)

  const human = status(root)
  assert.equal(human.status, 0)
  assert.equal(
    human.stdout.includes(EVAL_NONE),
    false,
    `a scored arc must not be marked; got:\n${human.stdout}`,
  )
})

test('23) an IN-PROGRESS arc with no report shows NEITHER marker nor flag — its eval is not yet due', () => {
  const root = estateWithLandedArc('EVALWIP', { lastStatus: 'in-progress' }) // no arc-evals dir either

  const row = jsonRow(root, 'EVALWIP')
  // The precondition is the test: if this arc read as all-done the case would be case 21 again.
  assert.doesNotMatch(
    String(row.note ?? ''),
    /all phases done/,
    `precondition: EVALWIP must still be mid-flight; note was ${JSON.stringify(row.note)}`,
  )
  assert.notEqual(
    row.evalMissing,
    true,
    `an arc that is still building owes no eval yet; row was ${JSON.stringify(row)}`,
  )

  const human = status(root)
  assert.equal(human.status, 0)
  assert.equal(human.stdout.includes(EVAL_NONE), false, `a building lane must not be marked; got:\n${human.stdout}`)
})

test('24) siblings in roadmap/arc-evals/ are NOT reports — verdicts, sweep, and every unanchored name still leave the marker', () => {
  const root = estateWithLandedArc('EVALSIB', {
    evalFiles: [
      'EVALSIB-2026-08-30-verdicts.json', // the mined class: verdicts recorded, eval never run
      'EVALSIB-2026-08-30-sweep.json',
      'pre-EVALSIB-2026-08-30.json', // PREFIXED — matches an unanchored search, is not this arc's report
      'EVALSIB-2026-08-30.json.bak', // SUFFIXED — not a .json report either
      'EVALSIB-2026-8-30.json', // wrong-shaped date, so not the dated-archive name at all
      'OTHERARC-2026-08-30.json', // a different arc's real report never scores this one
      'timing-stats.json',
    ],
  })

  const row = jsonRow(root, 'EVALSIB')
  assert.match(String(row.note ?? ''), /all phases done/, 'precondition: the arc is landed')
  assert.equal(
    row.evalMissing,
    true,
    `none of these names is \`EVALSIB-YYYY-MM-DD.json\` — reading one as the report is the false all-clear; row was ${JSON.stringify(row)}`,
  )

  const human = status(root)
  assert.equal(human.status, 0)
  assert.ok(
    human.stdout.includes(EVAL_NONE),
    `the marker must survive every sibling artifact; got:\n${human.stdout}`,
  )
})

// ── stale plugin-cache version drift (task 22.4) ──────────────────────────────────────
//
// A session can be RUNNING `~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/…` — the snapshot
// Claude installed — while the marketplace's DIRECTORY source on the same disk already carries a
// newer version. Every command then behaves like the older plugin and nothing on any surface says
// so. `status` is the command every protocol entry already runs, so it is the surfacing seam; the
// derivation is a PURE `versionDriftLine({ selfPath })` so both the drift and the silence can be
// proven over fixtures instead of over whatever this box happens to have installed.
//
// Same additive-divergence discipline as postMergeRedLine/strayLanes: absent whenever its
// condition is, so a non-cache checkout (this one) sees ZERO output change on both surfaces and
// status.parity.test.mjs stays byte-identical.
//
// The export is loaded DYNAMICALLY: a static named import of a binding status.mjs does not export
// yet is a link-time SyntaxError that takes all 24 cases above down with it, so the TDD red would
// name nothing. This way each case below reds on its own claim.
import { cpSync, readFileSync } from 'node:fs'

const statusModule = await import('./status.mjs')

/** Call the export under test, failing with the CONTRACT when it is missing rather than
 *  "versionDriftLine is not a function" thrown from somewhere inside a case. */
function drift(args) {
  assert.equal(
    typeof statusModule.versionDriftLine,
    'function',
    `status.mjs must EXPORT a pure versionDriftLine({ selfPath }) — status wires its advisory through it, and a seam only status can reach cannot be proven over a fixture; got exports ${Object.keys(statusModule)}`,
  )
  return statusModule.versionDriftLine(args)
}

/** Both manifests a plugin tree carries, agreeing — the cached snapshot's own version is a fact
 *  about the tree, not about the directory it was unpacked into. */
function writePluginManifests(dir, name, version) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version, description: 'fixture' }, null, 2) + '\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, private: true }, null, 2) + '\n')
}

/**
 * A hermetic mirror of a real `~/.claude/plugins` install root:
 *
 *   <home>/plugins/known_marketplaces.json      → { <mkt>: { source: { source: 'directory', path } } }
 *   <home>/plugins/cache/<mkt>/<plugin>/<ver>/  → the INSTALLED snapshot (what a session runs)
 *   <home>/plugins/cached/<plugin>/<ver>/       → a near-miss sibling: NOT the cache dir
 *   <src>/.claude-plugin/marketplace.json       → the directory source's manifest
 *   <src>/plugins/<plugin>/                     → the source tree, at its own version
 *
 * Shapes are copied from this box's real files (registry entry, marketplace `source: './plugins/x'`).
 * `registry: false` omits the registry file; `registryBody` writes arbitrary bytes instead.
 */
function cacheEstate({
  cachedVersion = '0.18.0',
  sourceVersion = '0.34.0',
  plugin = 'zeroh-roadmap',
  marketplace = 'zeroh-marketplace',
  registry = true,
  registryBody = null,
} = {}) {
  const home = newTmp('zr-status-drift-')
  const pluginsRoot = join(home, 'plugins')
  const srcDir = join(home, 'marketplace-src')

  const srcPlugin = join(srcDir, 'plugins', plugin)
  writePluginManifests(srcPlugin, plugin, sourceVersion)
  mkdirSync(join(srcDir, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(srcDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: marketplace, plugins: [{ name: plugin, source: `./plugins/${plugin}`, category: 'development' }] }, null, 2) + '\n',
  )
  mkdirSync(join(srcPlugin, 'cli', 'commands'), { recursive: true })

  const cacheDir = join(pluginsRoot, 'cache', marketplace, plugin, cachedVersion)
  writePluginManifests(cacheDir, plugin, cachedVersion)
  mkdirSync(join(cacheDir, 'cli', 'commands'), { recursive: true })

  // The near-miss: same depth, same manifests, one letter of directory name apart. A substring
  // test for 'plugins/cache' answers "inside the cache" here, and it is not.
  const nearMiss = join(pluginsRoot, 'cached', plugin, cachedVersion)
  writePluginManifests(nearMiss, plugin, cachedVersion)
  mkdirSync(join(nearMiss, 'cli', 'commands'), { recursive: true })

  if (registry || registryBody !== null) {
    writeFileSync(
      join(pluginsRoot, 'known_marketplaces.json'),
      registryBody ??
        JSON.stringify(
          {
            [marketplace]: {
              source: { source: 'directory', path: srcDir },
              installLocation: srcDir,
              lastUpdated: '2026-08-30T00:00:00.000Z',
              autoUpdate: true,
            },
          },
          null,
          2,
        ) + '\n',
    )
  }

  return {
    cacheDir,
    cachedSelfPath: join(cacheDir, 'cli', 'commands', 'status.mjs'),
    sourceSelfPath: join(srcPlugin, 'cli', 'commands', 'status.mjs'),
    nearMissSelfPath: join(nearMiss, 'cli', 'commands', 'status.mjs'),
  }
}

test('25) cached snapshot older than its directory source → ONE line naming BOTH versions', () => {
  const est = cacheEstate({ cachedVersion: '0.18.0', sourceVersion: '0.34.0' })

  const line = drift({ selfPath: est.cachedSelfPath })
  assert.equal(
    typeof line,
    'string',
    `a session running 0.18.0 while the source carries 0.34.0 is the whole gap — the advisory must be a string; got ${JSON.stringify(line)}`,
  )
  assert.ok(
    line.includes('0.18.0'),
    `the line must name the version this session is RUNNING — without it the operator cannot tell whether the restart already happened; got: ${line}`,
  )
  assert.ok(
    line.includes('0.34.0'),
    `and the version waiting in the directory source — a line that names only one version says "something is stale" and nothing actionable; got: ${line}`,
  )
  assert.equal(line.includes('\n'), false, `ONE bounded line, like every other status advisory; got: ${JSON.stringify(line)}`)
  assert.ok(line.length <= 300, `and bounded in width — status advisories never dump a payload; got ${line.length} chars: ${line}`)
})

test('26) equal versions → silent: the cache IS the source, and there is nothing to restart for', () => {
  const est = cacheEstate({ cachedVersion: '0.34.0', sourceVersion: '0.34.0' })

  // Guard: the fixture differs from case 25 ONLY in the source version, so a line here would be
  // the advisory firing on the mere fact of running from the cache.
  const drifted = cacheEstate({ cachedVersion: '0.34.0', sourceVersion: '0.35.0' })
  assert.equal(typeof drift({ selfPath: drifted.cachedSelfPath }), 'string', 'fixture guard: this shape DOES drift when the source moves ahead')

  assert.ok(
    !drift({ selfPath: est.cachedSelfPath }),
    `an up-to-date cache must be silent — an advisory every session prints unconditionally is noise the operator learns to skip past; got ${JSON.stringify(drift({ selfPath: est.cachedSelfPath }))}`,
  )
})

test('27) a selfPath outside plugins/cache is silent — even beside a registry that IS drifting', () => {
  const est = cacheEstate({ cachedVersion: '0.18.0', sourceVersion: '0.34.0' })
  // Guard: the drift is real in this very estate — the silence below is about the PATH.
  assert.equal(typeof drift({ selfPath: est.cachedSelfPath }), 'string', 'fixture guard: this estate drifts when asked from the cache path')

  assert.ok(
    !drift({ selfPath: est.sourceSelfPath }),
    `a session running the directory source itself IS the newest version — telling it to update is a false alarm on every dev checkout; got ${JSON.stringify(drift({ selfPath: est.sourceSelfPath }))}`,
  )
  assert.ok(
    !drift({ selfPath: est.nearMissSelfPath }),
    `and plugins/cached/… is not plugins/cache/… — a substring match on the path invents a cached version out of an unrelated directory; got ${JSON.stringify(drift({ selfPath: est.nearMissSelfPath }))}`,
  )
})

test('28) a cache path with no registry, or an unreadable one, is silent and never throws', () => {
  const missing = cacheEstate({ registry: false })
  const corrupt = cacheEstate({ registryBody: '{ not json' })

  for (const [name, est] of [
    ['absent', missing],
    ['unparseable', corrupt],
  ]) {
    let line
    assert.doesNotThrow(() => {
      line = drift({ selfPath: est.cachedSelfPath })
    }, `an ${name} known_marketplaces.json must not throw — status wires this advisory into every run, and an advisory that can crash the command is worse than the drift it reports`)
    assert.ok(!line, `and it must stay silent rather than guess: got ${JSON.stringify(line)} for the ${name} registry`)
  }
})

test('29) ONE spawned status from THIS checkout — a non-cache path prints no advisory on either stream', () => {
  const selfPath = join(HERE, 'status.mjs')
  const pluginRoot = join(HERE, '..', '..')
  const ownVersion = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version

  // Guards: this checkout really is the non-cache case, and the pure derivation agrees.
  assert.doesNotMatch(
    selfPath,
    /[\\/]plugins[\\/]cache[\\/]/,
    `precondition: the suite must be running from a directory checkout, not an installed snapshot; selfPath was ${selfPath}`,
  )
  assert.ok(!drift({ selfPath }), `precondition: the pure derivation must be silent here; got ${JSON.stringify(drift({ selfPath }))}`)

  const res = status(emptyEstate())
  assert.equal(res.status, 0, `status must exit 0; stderr:\n${res.stderr}`)
  const streams = bothStreams(res)
  assert.doesNotMatch(
    streams,
    new RegExp(ownVersion.replace(/\./g, '\\.')),
    `a drift line names versions, so this checkout's own version ${ownVersion} must appear NOWHERE in a run that has nothing to report — on stdout OR stderr (the phase-11 lesson); got:\n${streams}`,
  )
  assert.doesNotMatch(
    streams,
    /drift|newer version|stale plugin/i,
    `and no fragment of the advisory survives either — the human table is parity-pinned byte-compatible with the legacy scripts/arc-status.mjs; got:\n${streams}`,
  )
})

/**
 * The same plugin tree, planted at a REAL cache path `<tmp>/plugins/cache/<mkt>/<plugin>/<ver>/`
 * with its manifests rewritten to that version, beside a registry pointing at a directory source
 * one minor ahead. Spawning THIS copy's bin is the only way to observe the wiring: `selfPath` is
 * the running module's own location, so a fixture argument cannot fake it.
 */
function plantedCacheCheckout({ cachedVersion = '0.18.0', sourceVersion = '0.34.0' } = {}) {
  const est = cacheEstate({ cachedVersion, sourceVersion })
  cpSync(join(HERE, '..', '..'), est.cacheDir, { recursive: true })
  writePluginManifests(est.cacheDir, 'zeroh-roadmap', cachedVersion) // the snapshot's version, not the source's
  return { est, bin: join(est.cacheDir, 'bin', 'roadmap.mjs') }
}

/** Every string leaf of a parsed --json payload — "the machine shape exposes it" without pinning
 *  WHICH key carries it (warnings, a dedicated field) ahead of the implementation. */
function stringLeaves(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringLeaves(v, out)
  return out
}

test('30) status run FROM a stale cache path surfaces the advisory on BOTH surfaces, verbatim', () => {
  const { est, bin } = plantedCacheCheckout({ cachedVersion: '0.18.0', sourceVersion: '0.34.0' })
  const { root } = strayEstate()

  // The expected text is the PURE function's own answer for that path — the wiring claim is
  // "status prints what versionDriftLine returns", not a second copy of the sentence.
  const expected = drift({ selfPath: join(est.cacheDir, 'cli', 'commands', 'status.mjs') })
  assert.equal(typeof expected, 'string', 'fixture guard: the planted checkout must be a drifting one')

  const human = spawnSync('node', [bin, 'status', root], { encoding: 'utf8' })
  assert.equal(human.status, 0, `a stale cache is a REPORT, not an error — status must still exit 0; stderr:\n${human.stderr}`)
  assert.equal(
    countOf(bothStreams(human), expected),
    1,
    `the text surface must carry the advisory exactly once — twice tells the operator there are two drifts; got stdout:\n${human.stdout}\nstderr:\n${human.stderr}`,
  )

  const json = spawnSync('node', [bin, 'status', root, '--json'], { encoding: 'utf8' })
  assert.equal(json.status, 0, `status --json must exit 0 over a stale cache; stderr:\n${json.stderr}`)
  let parsed
  assert.doesNotThrow(() => {
    parsed = JSON.parse(json.stdout)
  }, `stdout must stay PURE JSON with the advisory present; got:\n${json.stdout}`)
  assert.ok(
    stringLeaves(parsed).some((s) => s.includes(expected)),
    `and the machine shape must expose it too — an advisory only the human table carries is invisible to every scripted consumer; got:\n${JSON.stringify(parsed, null, 2)}`,
  )
})

/**
 * A REAL detached worktree at a sibling path (`git worktree add --detach`) — the porcelain block
 * with NO `branch` line, which is the one shape the four independent parsers spell differently.
 * Swept by the suite's exit hook, like laneWorktree.
 */
function detachedWorktree(repoDir, suffix) {
  const dir = `${repoDir}-${suffix}`
  tmps.push(dir)
  const added = gitIn(repoDir, 'worktree', 'add', '-q', '--detach', dir, 'HEAD')
  assert.equal(added.status, 0, `fixture bug: git must create the detached worktree ${dir}; stderr:\n${added.stderr}`)
  const listed = gitIn(repoDir, 'worktree', 'list', '--porcelain').stdout
  const block = listed.split('\n\n').find((b) => b.includes(`worktree ${dir}`)) ?? ''
  assert.ok(block, `fixture bug: git must KNOW ${dir}; list was:\n${listed}`)
  assert.doesNotMatch(
    block,
    /^branch /m,
    `fixture bug: the block must carry NO branch line — that absence IS the detached case under test; block was:\n${block}`,
  )
  return dir
}

test('31) a DETACHED worktree still reads `(detached)` in otherWorktrees — the human line and --json alike', () => {
  // status is the one consumer that wants a LABEL where the shared enumerator reports null, and
  // its human table is parity-pinned byte-compatible with the legacy scripts/arc-status.mjs. So
  // routing derive() step (1) through listWorktrees must map null → '(detached)' at the status
  // boundary; a raw null would print `<path> @ null` and hand every --json consumer a new type.
  const { repoDir, root } = strayEstate()
  const dir = detachedWorktree(repoDir, 'detached-31')

  const json = status(root, '--json')
  assert.equal(json.status, 0, `status --json must exit 0 over a detached worktree; stderr:\n${json.stderr}`)
  const parsed = JSON.parse(json.stdout)
  const rows = parsed.otherWorktrees.filter((w) => realpathSync(w.path) === realpathSync(dir))
  assert.equal(
    rows.length,
    1,
    `the detached worktree appears exactly once in otherWorktrees; got ${JSON.stringify(parsed.otherWorktrees, null, 2)}`,
  )
  assert.equal(
    rows[0].branch,
    '(detached)',
    `a worktree on no branch is labelled '(detached)' — null, undefined or 'HEAD' would each be a shape change for every scripted reader; got ${JSON.stringify(rows[0])}`,
  )

  const human = status(root)
  assert.equal(human.status, 0, `the human table must exit 0 too; stderr:\n${human.stderr}`)
  assert.equal(
    countOf(human.stdout, `${dir} @ (detached)`),
    1,
    `and the printed line stays byte-identical to the parity oracle's "  <path> @ (detached)"; got:\n${human.stdout}`,
  )
})
