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
  // A BARE/legacy arm body (not session-bound JSON) is stale by definition (executor-arm.mjs).
  mkdirSync(join(wt, '.building'), { recursive: true })
  const armFile = join(wt, '.building', '2001-executor.armed')
  writeFileSync(armFile, 'sess-legacy-bare\n')

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
