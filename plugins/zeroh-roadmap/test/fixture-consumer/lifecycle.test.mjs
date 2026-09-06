#!/usr/bin/env node
/**
 * lifecycle.test.mjs — the fixture-consumer wired tier's claim → phase-validate → gate
 * plan/run stretch (arc ROADCODE 1660.2). Every case drives the REAL bin/roadmap.mjs over a
 * scratch consumer and asserts the EXIT CODE + a machine-read JSON/report/slot-log field —
 * never CLI narration. Titles carry L1-L9 (the 1660.8 reconciliation contract).
 * Run: node --test test/fixture-consumer/lifecycle.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, runCli, writePhaseFile, commitPaths, readSlotLog, git } from './harness.mjs'
import { SCOPED_FALLBACK_NOTE } from '../../cli/lib/slots.mjs'

/** Seed a phase file + optional source touches, committed under a `phase N —` boundary commit
 *  (the em-dash the gate greps for a phase-start SHA). Returns the phase number. */
function seedPhase(root, phaseObj, { kind = 'plain', touch = [], create = {}, msg } = {}) {
  const n = phaseObj.phase
  const pf = writePhaseFile(root, phaseObj, { kind })
  const paths = [pf]
  for (const [rel, body] of Object.entries(create)) {
    writeFileSync(join(root, rel), body)
    paths.push(rel)
  }
  for (const rel of touch) {
    // The touch marker must not narrate history (a phase number in a COMMENT) — the gate's
    // own history-comments scan reads this diff and reds the all-green fixtures (L6/L8).
    writeFileSync(join(root, rel), readFileSync(join(root, rel), 'utf8') + `\nexport const touchedBy${n} = ${n}\n`)
    paths.push(rel)
  }
  commitPaths(root, msg ?? `feat: phase ${n} — start`, paths)
  return n
}

const latestReport = (root, n) => {
  const dir = join(root, 'roadmap', '.gate', String(n))
  if (!existsSync(dir)) return null
  const f = readdirSync(dir).filter((x) => /^run-\d+-.*\.json$/.test(x)).sort().pop()
  return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null
}

// ── L1 — two sequential claims yield distinct consecutive numbers ───────────────────────
test('L1 — two `roadmap claim` calls return distinct consecutive numbers with claim files present', () => {
  const root = makeFixtureRepo()
  const a = runCli(root, ['claim'])
  const b = runCli(root, ['claim'])
  assert.equal(a.code, 0)
  assert.equal(b.code, 0)
  const na = Number(a.stdout.trim())
  const nb = Number(b.stdout.trim())
  assert.ok(Number.isInteger(na) && Number.isInteger(nb), 'both claims print a number')
  assert.equal(nb, na + 1, 'the second claim is exactly one higher')
  const claimsDir = join(root, '.git', 'zeroh-roadmap-claims')
  assert.ok(existsSync(join(claimsDir, `${na}.claim`)) && existsSync(join(claimsDir, `${nb}.claim`)), 'both claim files exist')
})

test('session worktree journal lets phase land fast-forward, dispose, and archive the lane', () => {
  const root = makeFixtureRepo()
  const phase = 9019
  seedPhase(root, { phase, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: [{ id: `${phase}.1`, done: true }] })
  const lane = `${root}-session-${phase}`
  try {
    git(root, 'worktree', 'add', '-q', '-b', `session/${phase}`, lane, 'HEAD')
    const armed = runCli(root, ['executor-arm', String(phase), '--session', 'fixture-session', '--worktree', lane])
    assert.equal(armed.code, 0, armed.stderr)
    writeFileSync(join(lane, 'session-work.txt'), 'session lane work\n')
    commitPaths(lane, `feat(cli): phase ${phase} — ${phase}.1 session work`, ['session-work.txt'])
    writeFileSync(join(lane, 'CODEX-REPORT.md'), 'CODEX-RUN-COMPLETE\n')
    const land = runCli(lane, ['phase', 'land', String(phase)])
    assert.equal(land.code, 0, land.stderr)
    assert.equal(existsSync(lane), false)
    const closed = join(root, '.building', `codex-${phase}.closed.json`)
    assert.ok(existsSync(closed))
    assert.equal(JSON.parse(readFileSync(closed, 'utf8')).closedBy, 'phase land')
  } finally {
    rmSync(lane, { recursive: true, force: true })
  }
})

// ── L2 — phase validate green on well-formed, exit 2 on malformed ───────────────────────
test('L2 — `roadmap phase validate` exits 0 on a well-formed phase and 2 on a task stripped of its problem field', () => {
  const root = makeFixtureRepo()
  const wellFormed = {
    phase: 9020, status: 'backlog', name: 'Well formed fixture phase', category: 'test', source: 'fixture-consumer',
    priority: 'LOW', dependsOn: [], conflictsWith: [], keyFiles: [], stakeholderDemo: 'a fixture phase used for validation',
    tasks: [{ minimal: true, id: '9020.1', title: 'do the thing', done: false }],
  }
  seedPhase(root, wellFormed, { kind: 'define' })
  const ok = runCli(root, ['phase', 'validate', '9020'])
  assert.equal(ok.code, 0, `well-formed must validate; stderr:\n${ok.stderr}`)

  const malformed = {
    phase: 9021, status: 'backlog', name: 'Malformed fixture phase', category: 'test', source: 'fixture-consumer',
    priority: 'LOW', dependsOn: [], conflictsWith: [], keyFiles: [], stakeholderDemo: 'a fixture phase used for validation',
    // a FULL task deliberately missing `problem` → the schema import-time Zod parse fails
    tasks: [{ id: '9021.1', title: 'a task with no problem field', steps: [{ file: 'x.ts', description: 'do something now' }], acceptanceCriteria: ['one criterion here'], files: ['x.ts'], done: false }],
  }
  seedPhase(root, malformed, { kind: 'define' })
  const bad = runCli(root, ['phase', 'validate', '9021'])
  assert.equal(bad.code, 2, 'a Zod-invalid phase file is exit 2')
  assert.match(bad.stderr, /schema validation failed/, 'the failure is a named schema-validation error')
  assert.match(bad.stderr, /tasks\.0/, 'the Zod issue names the malformed task (stripped of its problem field)')
})

// ── L3 — banding echo flips exactly at the classification boundaries ─────────────────────
test('L3 — `gate plan --json` band is trivial(2) / mid(3,logic) / heavy(10) at the boundaries', () => {
  const cases = [
    { phase: 9030, tasks: 2, kind: 'logic', band: 'trivial' },
    { phase: 9031, tasks: 3, kind: 'logic', band: 'mid' },
    { phase: 9032, tasks: 10, kind: 'logic', band: 'heavy' },
  ]
  for (const c of cases) {
    const root = makeFixtureRepo()
    const tasks = Array.from({ length: c.tasks }, (_, i) => ({ id: `${c.phase}.${i + 1}`, done: false }))
    seedPhase(root, { phase: c.phase, status: 'in-progress', arcId: 'FX', kind: c.kind, tasks })
    const r = runCli(root, ['gate', 'plan', String(c.phase), '--json'])
    assert.equal(r.code, 0, `gate plan should succeed; stderr:\n${r.stderr}`)
    assert.equal(r.json.band, c.band, `taskCount ${c.tasks} → band ${c.band} (got ${r.json.band})`)
  }
})

// ── L4 — reviewScope below the specialist floor → exit 2, refusal in JSON ────────────────
test('L4 — reviewScope light over a src/spine/** diff → exit 2 with reviewScope.refused in JSON', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9040, status: 'in-progress', arcId: 'FX', kind: 'logic', reviewScope: 'light', tasks: [{ id: '9040.1', done: false }] }, { touch: ['src/spine/dummy.ts'] })
  const r = runCli(root, ['gate', 'plan', '9040', '--json'])
  assert.equal(r.code, 2, 'a floor violation is the exit code, not a paragraph')
  assert.ok(r.json.reviewScope.refused, `reviewScope.refused must be named: ${JSON.stringify(r.json.reviewScope)}`)
})

// ── L5 — testScope below the derived floor → exit 2 ─────────────────────────────────────
test('L5 — testScope static over a source-touching diff → exit 2 (declared may not sneak under the floor)', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9050, status: 'in-progress', arcId: 'FX', kind: 'logic', testScope: 'static', tasks: [{ id: '9050.1', done: false }] }, { touch: ['src/plain.ts'] })
  const r = runCli(root, ['gate', 'plan', '9050', '--json'])
  assert.equal(r.code, 2)
  assert.ok(r.json.testScope.refused, `testScope.refused must be named: ${JSON.stringify(r.json.testScope)}`)
})

// ── L6 — all-green gate run → exit 0 + a GateRunReport with per-slot exit/duration/log ────
test('L6 — all-green `gate run` → exit 0 and a GateRunReport with per-slot exit/duration/log-path', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9060, status: 'in-progress', arcId: 'FX', kind: 'logic', testScope: 'full', tasks: [{ id: '9060.1', done: true }] }, { touch: ['src/plain.ts'] })
  const r = runCli(root, ['gate', 'run', '9060'])
  assert.equal(r.code, 0, `all fake slots exit 0 → green; stderr:\n${r.stderr}`)
  const report = latestReport(root, 9060)
  assert.ok(report && report.green === true, 'a green GateRunReport is persisted')
  for (const row of report.slots) {
    assert.ok(Number.isInteger(row.exitCode) && typeof row.durationMs === 'number' && 'logPath' in row, `slot ${row.slot} carries exit/duration/log`)
  }
})

// ── L7 — a red slot is BOTH a non-zero exit AND a recorded red row ──────────────────────
test('L7 — FIXTURE_SLOT_UNIT_EXIT=1 → exit 2 and the report records the unit slot red', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9070, status: 'in-progress', arcId: 'FX', kind: 'logic', testScope: 'full', tasks: [{ id: '9070.1', done: true }] }, { touch: ['src/plain.ts'] })
  const r = runCli(root, ['gate', 'run', '9070'], { FIXTURE_SLOT_UNIT_EXIT: '1' })
  assert.equal(r.code, 2, 'a red slot forces exit 2 the caller cannot narrate around')
  const report = latestReport(root, 9070)
  const unit = report.slots.find((s) => s.slot === 'unit')
  assert.ok(unit && unit.exitCode === 1, `the report records the unit slot red: ${JSON.stringify(unit)}`)
  assert.equal(report.green, false)
})

// ── L8 — scoped slot absent → full slot runs + the machine-written honest fallback note ──
test('L8 — integration-scoped removed → the full integration slot runs and the report carries the fallback note', () => {
  const root = makeFixtureRepo()
  // Remove the integration-scoped binding so the scoped resolution falls back to the full slot.
  const cfgPath = join(root, 'roadmap', 'roadmap.config.json')
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
  delete cfg.gateCommands['integration-scoped']
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'chore: drop integration-scoped binding')
  // testScope relevant (a plain source touch, no declared full) → the scoped branch runs. The
  // phase-own set MUST carry a test file so the scoped selection is non-empty and reaches the
  // scoped-OR-fallback resolution (post-1737 an EMPTY scoped selection is a skip, not a fallback —
  // this test exercises the fallback, so it seeds a test file to get there).
  seedPhase(root, { phase: 9080, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: [{ id: '9080.1', done: true }] }, { touch: ['src/plain.ts'], create: { 'src/plain.test.ts': 'export const t = 1\n' } })
  const r = runCli(root, ['gate', 'run', '9080'])
  assert.equal(r.code, 0, `green run; stderr:\n${r.stderr}`)
  const report = latestReport(root, 9080)
  const integ = report.slots.find((s) => s.slot === 'integration')
  assert.ok(integ, `the full integration slot ran: ${JSON.stringify(report.slots.map((s) => s.slot))}`)
  assert.equal(integ.note, SCOPED_FALLBACK_NOTE, 'the honest scoped-fallback note is machine-written into the report')
})

// ── L9 — {files} substitution lands verbatim in the fake-slot argv log ──────────────────
test('L9 — a scoped run substitutes {files} verbatim into the fake-slot argv (asserted from the JSONL)', () => {
  const root = makeFixtureRepo()
  // The phase touches a real test file → the scoped selection is exactly that file.
  seedPhase(root, { phase: 9090, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: [{ id: '9090.1', done: true }] }, { create: { 'src/feature.test.ts': 'export const t = 1\n' } })
  const r = runCli(root, ['gate', 'run', '9090'])
  assert.equal(r.code, 0, `green run; stderr:\n${r.stderr}`)
  const scoped = readSlotLog(root).find((s) => s.slot === 'unit-scoped')
  assert.ok(scoped, `the unit-scoped slot ran: ${JSON.stringify(readSlotLog(root).map((s) => s.slot))}`)
  assert.deepEqual(scoped.argv, ['unit-scoped', 'src/feature.test.ts'], 'only the slot selector and test target are passed; phase metadata is excluded')
})

test('L9 — a real uncovered executable beside a scoped test still requires affected/full coverage', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9091, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: [{ id: '9091.1', done: true }] }, {
    create: { 'src/feature.test.ts': 'export const t = 1\n', 'src/shared.ts': 'export const shared = true\n' },
  })
  const result = runCli(root, ['gate', 'plan', '9091', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const slots = result.json.slots.map(({ slot }) => slot)
  assert.ok(slots.includes('unit') && slots.includes('integration'), `uncovered source retains full fallback: ${slots}`)
  assert.ok(!slots.includes('unit-scoped') && !slots.includes('integration-scoped'), 'an unrelated test cannot hide uncovered executable source')
})

test('L10 — mixed-driver curation leaves published commits in place and the lane lands by fast-forward', () => {
  const root = makeFixtureRepo({
    config: {
      executionIsolation: 'worktree',
      mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: ['develop'], primaryCheckout: '/tmp/fixture-primary' },
    },
  })
  // Curation invokes Git inside the CLI, outside the seed helper's -c identity.
  git(root, 'config', 'user.name', 'fixture')
  git(root, 'config', 'user.email', 'fixture@test')
  const phase = 9100
  seedPhase(root, {
    phase,
    status: 'in-progress',
    name: 'Mixed driver fast-forward fixture',
    category: 'test',
    source: 'fixture-consumer',
    priority: 'LOW',
    dependsOn: [],
    conflictsWith: [],
    keyFiles: ['src/plain.ts'],
    stakeholderDemo: 'published work is not rewritten',
    kind: 'logic',
    tasks: [{ minimal: true, id: `${phase}.1`, title: 'publish task work', done: true, transparencyReport: { whatWasDone: 'published task work', how: 'fixture commit', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None' } }],
  })
  writeFileSync(join(root, 'src', 'published.ts'), 'export const published = true\n')
  commitPaths(root, `feat(cli): phase ${phase} — ${phase}.1 publish task work`, ['src/published.ts'])
  const publishedTip = git(root, 'rev-parse', 'HEAD')
  git(root, 'switch', '-q', '-c', `lane-${phase}`)
  writeFileSync(join(root, 'src', 'lane-fix.ts'), 'export const laneFix = true\n')
  commitPaths(root, `fix(cli): phase ${phase} gate R0 — lane-only repair`, ['src/lane-fix.ts'])

  const gate = runCli(root, ['gate', 'run', String(phase)])
  assert.equal(gate.code, 0, `the fixture gate must be green before curation; stderr:\n${gate.stderr}`)
  const dry = runCli(root, ['phase', 'curate', String(phase)])
  assert.equal(dry.code, 0, `mixed-driver dry run succeeds; stderr:\n${dry.stderr}`)
  assert.match(dry.stdout, /2 commits? already on develop — left out of the curation range/)
  const apply = runCli(root, ['phase', 'curate', String(phase), '--apply'])
  assert.equal(apply.code, 0, `mixed-driver curation applies; stderr:\n${apply.stderr}`)

  const curatedTip = git(root, 'rev-parse', 'HEAD')
  assert.equal(git(root, 'rev-parse', `${curatedTip}^`), publishedTip, 'the curated lane commit is parented directly on the published tip')
  const land = runCli(root, ['phase', 'land', String(phase)])
  assert.equal(land.code, 0, `the shipped phase land command succeeds; stderr:\n${land.stderr}`)
  assert.equal(git(root, 'rev-parse', 'develop'), curatedTip, 'the integration ref advances to the curated tip by fast-forward')
  assert.equal(git(root, 'rev-list', '--merges', `${publishedTip}..develop`), '', 'landing introduces no merge commit')
})
