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
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { initializeCiCorrection } from '../../cli/commands/arc.mjs'
import { decideCorrectionRoute, persistCorrectionCheckpoint } from '../../cli/lib/delivery.mjs'
import { gateInputKey } from '../../cli/lib/gate-diagnostics.mjs'
import { writeReport, recordCorrectionReview } from '../../cli/lib/gate-report.mjs'
import { makeFixtureRepo, runCli, writePhaseFile, writeArcFile, commitPaths, readSlotLog, git } from './harness.mjs'
import { SCOPED_FALLBACK_NOTE } from '../../cli/lib/slots.mjs'
import arcPlaneWorkflow from '../../workflows/arc-plane.workflow.mjs'

import { groomBacklogSource, reduceArcTransition, HALT_KINDS } from '../../cli/lib/workflow-steps.mjs'
import { claimResultConsumption, listResultClaims } from '../../cli/lib/sidecar.mjs'
import { appendExecutorEvent } from '../../cli/lib/beacon.mjs'
import { armExecutor } from '../../cli/lib/executor-arm.mjs'
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

test('legacy session worktree lands fast-forward while preserving the unowned lane and its recovery evidence', () => {
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
    assert.match(git(root, 'log', '--format=%s', 'develop'), new RegExp(`${phase}\\.1 session work`), 'the session commit is integrated locally')
    assert.equal(readFileSync(join(root, 'session-work.txt'), 'utf8'), 'session lane work\n', 'the integrated tree contains the lane result')
    assert.equal(existsSync(lane), true, 'an identity-free legacy lane is not upgraded into removable ownership')
    assert.equal(readFileSync(join(lane, 'CODEX-REPORT.md'), 'utf8'), 'CODEX-RUN-COMPLETE\n', 'the sole source report remains intact')
    const live = join(root, '.building', `codex-${phase}.json`)
    assert.ok(existsSync(live), 'the live legacy journal remains available for recovery')
    assert.match(land.stderr, /KEPT.*ownership-uncertain/i, 'the successful land names the conservative ownership hold')
    const closed = join(root, '.building', `codex-${phase}.closed.json`)
    assert.equal(existsSync(closed), false, 'a legacy journal is not closed as if its output had an owned archive')
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

function driveEarlyArcWorkflow(run, input = {}) {
  let agentCalls = 0
  const root = makeFixtureRepo()
  return {
    root,
    calls: [],
    agentCalls: () => agentCalls,
    async result() {
      return arcPlaneWorkflow(
        { arcId: 'FX', planeName: 'P', ...input },
        {
          cwd: root,
          run: (command, options = {}) => {
            this.calls.push(command)
            return run(command, options)
          },
          agent: async () => {
            agentCalls++
            return { result: {} }
          },
        },
      )
    },
  }
}

test('arc workflow lifecycle — backlog startup returns a pre-start HEAD plan without mutating the phase', async () => {
  let baseline
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase: 9037, band: 'mid', plane: 'P', done: [], remaining: [], gates: {} }),
      stderr: '',
      exitCode: 0,
    }
    if (command === `roadmap gate plan 9037 --base ${baseline} --json`) return {
      stdout: JSON.stringify({ phase: 9037, slots: [], baselineKind: 'pre-start-head', baseHead: baseline }),
      stderr: '',
      exitCode: 0,
    }
    throw new Error(`unexpected command after startup: ${command}`)
  }, { force: 'inline' })
  writePhaseFile(drive.root, { phase: 9037, status: 'backlog', arcId: 'FX', tasks: [{ id: '9037.1', done: false }] })
  writeArcFile(drive.root,{id:'FX',name:'Inline startup',baseRef:'develop',planes:[{name:'P',phases:[9037]}]})
  baseline = git(drive.root, 'rev-parse', 'HEAD')
  const result = await drive.result()
  assert.equal(result.plan.baselineKind, 'pre-start-head')
  assert.equal(result.plan.baseHead, baseline)
  assert.ok(!drive.calls.some((command) => command.includes('phase start')))
  assert.match(readFileSync(join(drive.root, 'roadmap', 'phases', 'phase-9037.phase.ts'), 'utf8'), /status:\s*'backlog'/)
  assert.equal(drive.agentCalls(), 0)
})

test('arc workflow lifecycle — empty failed gate plan is a typed halt with raw evidence', async () => {
  let baseline
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase: 9037, band: 'mid', plane: 'P', done: [], remaining: [], gates: {} }),
      stderr: '',
      exitCode: 0,
    }
    if (command === `roadmap gate plan 9037 --base ${baseline} --json`) return { stdout: '', stderr: 'no phase baseline', exitCode: 2 }
    throw new Error(`unexpected command after gate-plan failure: ${command}`)
  })
  baseline = git(drive.root, 'rev-parse', 'HEAD')
  const result = await drive.result()
  assert.equal(result.halt, 'failed')
  assert.match(result.evidence.gatePlan, /no phase baseline/)
  assert.equal(result.transitionReceipt.event.type, 'failed')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(drive.agentCalls(), 0)
})

test('arc workflow lifecycle — a nonzero arc-next result halts before any mutation', async () => {
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return { stdout: JSON.stringify({ error: 'malformed arc member' }), stderr: 'arc next refused', exitCode: 2 }
    throw new Error(`mutation ran after red arc-next: ${command}`)
  })
  const result = await drive.result()
  assert.equal(result.halt, 'failed')
  assert.match(result.evidence.arcNext, /arc next refused/)
  assert.equal(result.transitionReceipt.event.type, 'failed')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.deepEqual(drive.calls, ['roadmap config check', 'roadmap arm FX', 'roadmap arc next FX --json'])
  assert.equal(drive.agentCalls(), 0)
})

test('arc workflow lifecycle — a failed lane arm produces a reducer halt and never launches an agent', async () => {
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command === 'roadmap arm FX') return { stdout: '', stderr: 'lane already owned', exitCode: 2 }
    throw new Error(`command ran after failed arm: ${command}`)
  })
  const result = await drive.result()
  assert.equal(result.halt, 'blocked')
  assert.match(result.evidence.arcArm, /lane already owned/)
  assert.equal(result.transitionReceipt.event.type, 'blocked')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.deepEqual(drive.calls, ['roadmap config check', 'roadmap arm FX'])
  assert.equal(drive.agentCalls(), 0)
})

test('arc workflow lifecycle — durable validation gaps return the reducer corrective decision', async () => {
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({ arc: 'FX', action: 'gaps', done: [9037], remaining: [], gates: { swept: true, validated: false }, reason: 'verdict GAPS' }),
      stderr: '', exitCode: 0,
    }
    throw new Error(`unexpected command after gaps decision: ${command}`)
  })
  const result = await drive.result()
  assert.equal(result.halt, 'gaps')
  assert.equal(result.resume, 'run-correction')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(result.transitionReceipt.next.stage, 'validate')
  assert.equal(drive.agentCalls(), 0)
})

test('arc workflow lifecycle — proven land hands off only the missing evaluation action', async () => {
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({ arc: 'FX', action: 'evaluate', done: [9037], remaining: [], gates: { swept: true, validated: true } }),
      stderr: '', exitCode: 0,
    }
    throw new Error(`landing replayed after proven land: ${command}`)
  })
  const result = await drive.result()
  assert.equal(result.handoff, 'evaluate')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(result.transitionReceipt.next.stage, 'evaluate')
  assert.ok(!drive.calls.some((command) => /arc land/.test(command)))
  assert.equal(drive.agentCalls(), 0)
})

test('arc correction lifecycle — correction-ready binds actual heads, preserves GAPS evidence, and retries byte-identically', () => {
  const root = makeFixtureRepo()
  writePhaseFile(root, { phase: 9042, name: 'Bounded correction fixture', status: 'backlog', category: 'test', kind: 'logic', arcId: 'FX', source: 'physical fixture', priority: 'LOW', dependsOn: [], conflictsWith: [], keyFiles: ['repair-evidence.txt'], stakeholderDemo: 'The observed correction passes.', tasks: [{ minimal: true, id: '9042.1', title: 'Repair observed gap', done: false }] })
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [9042] }], acceptanceCriteria: [{ id: 'c1', job: 'repair the observed gap' }] })
  commitPaths(root, 'feat: seed correction fixture', ['roadmap/phases/phase-9042.phase.ts', 'roadmap/arcs/FX.arc.ts'])
  const validationHead = git(root, 'rev-parse', 'HEAD')
  let cli = runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'GAPS', '--note', 'one bounded repair remains'])
  assert.equal(cli.code, 0, cli.stderr)
  const artifactPath = join(root, 'roadmap', '.gate', 'arc-FX', 'validate.json')
  const legacyBytes = readFileSync(artifactPath, 'utf8')
  const bounds = { maxRounds: 2, deadlineAt: new Date(Date.now() + 1200000).toISOString(), allowedPathPrefixes: ['repair-evidence.txt'], authority: { source: 'session', reference: 'fixture-approved-repair' } }
  assert.throws(() => initializeCiCorrection(root, 'FX', { headSha: validationHead, inputKey: gateInputKey(root), bounds }), /Legacy correction usage is unknown/)
  assert.equal(readFileSync(artifactPath, 'utf8'), legacyBytes, 'unknown legacy usage cannot acquire a new budget')
  cli = runCli(root, ['arc', 'record-validate', 'FX', '--correction-ready'])
  assert.notEqual(cli.code, 0, 'unchanged HEAD is not repair evidence')
  assert.equal(readFileSync(artifactPath, 'utf8'), legacyBytes)

  // Seed an explicitly accepted source before the production CI initializer creates its bounded checkpoint.
  cli = runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  assert.equal(cli.code, 0, cli.stderr)
  const initialized = initializeCiCorrection(root, 'FX', { headSha: validationHead, inputKey: gateInputKey(root), bounds })
  const routed = decideCorrectionRoute({
    validationCheckpoint: initialized,
    delivery: { arcId: 'FX', target: { currentHeadSha: validationHead } },
    policy: { at: new Date().toISOString(), sourceHeadSha: validationHead, predecessorHeadSha: git(root, 'rev-parse', 'HEAD^'), authority: bounds.authority, stop: false, needsPlanning: false, smallRepair: { phaseId: 9042, criterionIds: ['c1'] }, plannedCorrection: null },
    failureDecisions: { status: 'classified', headSha: validationHead, gateInputKey: initialized.correction.gateInputKey, failures: [{ checkKey: 'unit', attemptId: 'fixture-1', kind: 'causal', editEligible: true, paths: ['repair-evidence.txt'], signature: 'b'.repeat(64) }], editPaths: ['repair-evidence.txt'], retryDecision: { blocked: false, failures: [] } },
  })
  assert.equal(routed.status, 'routed', routed.reason)
  persistCorrectionCheckpoint(root, 'FX', initialized, routed.routedCheckpoint)
  const awaiting = JSON.parse(readFileSync(artifactPath, 'utf8'))
  assert.equal(awaiting.correction.round, 1)
  assert.deepEqual(awaiting.correction.bounds, bounds)
  writeFileSync(join(root, 'repair-evidence.txt'), 'bounded correction evidence\n')
  commitPaths(root, 'fix: repair validated gap', ['repair-evidence.txt'])
  const repairHead = git(root, 'rev-parse', 'HEAD')
  cli = runCli(root, ['arc', 'record-validate', 'FX', '--correction-ready'])
  assert.notEqual(cli.code, 0, 'an unreviewed repair cannot advance')
  assert.deepEqual(JSON.parse(readFileSync(artifactPath, 'utf8')), awaiting)
  const assertion = "require('assert/strict').equal(require('fs').readFileSync('repair-evidence.txt','utf8'),'bounded correction evidence\\n')"
  execFileSync(process.execPath, ['-e', assertion], { cwd: root })
  const inputKey = gateInputKey(root, { exclude: ['roadmap/.gate', 'roadmap/arc-evals/phase-9042.peval.json'] })
  writeReport(root, { phase: 9042, startedAt: new Date().toISOString(), baseSha: validationHead, mode: 'arc', kind: 'logic', testScope: { derived: 'relevant', declared: null, effective: 'relevant' }, reviewScope: { derived: 'none', declared: null, effective: 'none' }, slots: [{ slot: 'unit-affected', command: 'node -e ' + JSON.stringify(assertion), exitCode: 0 }], agents: [], green: true, notes: [], slotFilter: 'unit', attempt: { inputKey, headSha: repairHead } })
  recordCorrectionReview(root, 9042, { arcId: 'FX', agent: 'code-reviewer', model: 'fixture-independent', verdict: 'clean', summary: 'The physical affected assertion passes.', findings: [] })
  cli = runCli(root, ['arc', 'record-validate', 'FX', '--correction-ready'])
  assert.equal(cli.code, 0, cli.stderr)
  const readyBytes = readFileSync(artifactPath, 'utf8'), ready = JSON.parse(readyBytes)
  assert.equal(ready.verdict, awaiting.verdict)
  assert.equal(ready.at, awaiting.at)
  assert.equal(ready.note, awaiting.note)
  assert.equal(ready.correction.state, 'needs-sweep')
  assert.equal(ready.correction.validationHead, validationHead)
  assert.equal(ready.correction.repairHead, repairHead)
  assert.deepEqual(ready.correction.bounds, bounds)
  assert.equal(ready.correction.round, 1)
  assert.match(ready.correction.readyAt, /^\d{4}-\d{2}-\d{2}T/)
  cli = runCli(root, ['arc', 'record-validate', 'FX', '--correction-ready'])
  assert.equal(cli.code, 0, cli.stderr)
  assert.equal(readFileSync(artifactPath, 'utf8'), readyBytes, 'same-head retry is a byte no-op')
  cli = runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'GAPS'])
  assert.equal(cli.code, 0, cli.stderr)
  const nextRound = JSON.parse(readFileSync(artifactPath, 'utf8'))
  assert.equal(nextRound.note, awaiting.note)
  assert.deepEqual(nextRound.correction.bounds, bounds)
  assert.equal(nextRound.correction.round, 1, 'recording another gap does not reset or spend a route round')
  assert.equal(nextRound.correction.route, null)
  assert.equal(nextRound.correction.state, 'awaiting-repair')
  assert.equal(nextRound.correction.validationHead, repairHead)
  assert.equal(nextRound.correction.repairHead, undefined)
  assert.equal(nextRound.correction.readyAt, undefined)
})

test('arc correction lifecycle — missing or corrupt correction checkpoints refuse byte-intact', () => {
  for (const correction of [
    undefined,
    { state: 'awaiting-repair', validationHead: 'not-a-git-head' },
  ]) {
    const root = makeFixtureRepo()
    const path = join(root, 'roadmap', '.gate', 'arc-FX', 'validate.json')
    mkdirSync(join(root, 'roadmap', '.gate', 'arc-FX'), { recursive: true })
    writeFileSync(join(root, 'roadmap', 'seed.txt'), 'seed\n')
    commitPaths(root, 'seed correction refusal', ['roadmap/seed.txt'])
    const artifact = { arcId: 'FX', verdict: 'GAPS', at: '2026-09-07T00:00:00.000Z', note: 'preserve me', ...(correction ? { correction } : {}) }
    writeFileSync(path, JSON.stringify(artifact, null, 2) + '\n')
    const before = readFileSync(path, 'utf8')
    const cli = runCli(root, ['arc', 'record-validate', 'FX', '--correction-ready'])
    assert.notEqual(cli.code, 0)
    assert.equal(readFileSync(path, 'utf8'), before)
  }
})

for (const layout of ['toplevel', 'docs']) test(`arc workflow lifecycle — ${layout} concurrent identical results run exactly one verify/groom/emit tail`, async () => {
  const root = makeFixtureRepo({
    layout,
    config: {
      gateCommands: {
        emit: `node -e "require('fs').appendFileSync('emit.log','emit\\n')"`,
      },
    },
  })
  const phase = 9038
  const rr = layout === 'docs' ? 'docs/roadmap' : 'roadmap'
  writePhaseFile(root, { phase, status: 'backlog', arcId: 'FX', tasks: [{ id: '9038.1', done: false }] })
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [phase] }] })
  writeFileSync(join(root, rr, 'backlog.ts'), `export default defineBacklog({
  "tiers": [
    {
      "tier": 0,
      "label": "Queued work",
      "items": [
        {
          "phase": 9038,
          "name": "Consume one executor result"
        },
        {
          "phase": 9039,
          "name": "Preserve literal \\"phase\\": 9038 inside sibling data"
        }
      ]
    }
  ]
})
`)
  commitPaths(root, 'docs(roadmap): seed concurrent result fixture', [
    `${rr}/phases/phase-9038.phase.ts`,
    `${rr}/arcs/FX.arc.ts`,
    `${rr}/backlog.ts`,
  ])

  let completed = false
  let arrivals = 0
  let releaseAgents
  const bothArrived = new Promise((resolve) => { releaseAgents = resolve })
  const agent = async () => {
    arrivals++
    if (arrivals === 2) releaseAgents()
    await bothArrived
    return { result: { phase, status: 'done', gateRounds: 1, compromises: [], skipped: [] } }
  }
  let verifyCount = 0
  const run = (command, options = {}) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify(completed
        ? { arc: 'FX', action: 'complete', done: [phase], remaining: [], gates: {} }
        : {
            arc: 'FX', action: 'run-phase', phase, band: 'mid', plane: 'P', done: [], remaining: [],
            gates: {}, sourceCheckpoint: { digest: 'sha256:checkpoint-9038' },
          }),
      stderr: '',
      exitCode: 0,
    }
    if (command.includes('gate plan')) return { stdout: JSON.stringify({ phase, slots: [] }), stderr: '', exitCode: 0 }
    if (command === 'roadmap contract show --json-schema') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('result check')) return { stdout: options.input, stderr: '', exitCode: 0 }
    if (command.includes('--verify-complete')) {
      verifyCount++
      completed = true
      return { stdout: '{}', stderr: '', exitCode: 0 }
    }
    throw new Error(`unexpected concurrent-tail command: ${command}`)
  }

  const results = await Promise.all([
    arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, { cwd: root, run, agent }),
    arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, { cwd: root, run, agent }),
  ])
  assert.equal(verifyCount, 1, 'only the claim winner verifies completion')
  assert.equal(results.filter((result) => result.done === true).length, 1, JSON.stringify(results))
  assert.equal(readFileSync(join(root, 'emit.log'), 'utf8'), 'emit\n', 'only the claim winner emits once')
  const backlog = readFileSync(join(root, rr, 'backlog.ts'), 'utf8')
  assert.doesNotMatch(backlog, /"phase":\s*9038/)
  assert.match(backlog, /"phase":\s*9039/, 'the multiline quoted sibling survives')
  assert.match(backlog, /literal \\"phase\\": 9038/, 'a target-looking string in sibling data survives')
  assert.equal(results.filter((result) => result.done === true).length, 1)
  const winner = results.find((result) => result.done === true)
  const [claim] = listResultClaims(root, 'FX')
  const acceptedResult = winner.trace.receipts.find((receipt) => receipt.event.type === 'done')
  assert.equal(acceptedResult.rejection, null)
  assert.equal(acceptedResult.event.eventId, claim.eventId)
  const duplicate = results.find((result) => result.halt === 'blocked')
  assert.equal(duplicate.transitionReceipt.rejection.kind, 'duplicate-event')
  assert.deepEqual(duplicate.transitionReceipt.next, duplicate.transitionReceipt.prior)
})

test('arc workflow lifecycle — pauseAfter halts only after the successful result tail is durable', async () => {
  const root = makeFixtureRepo({ config: { gateCommands: { emit: 'true' } } })
  const phase = 9041
  writePhaseFile(root, { phase, status: 'backlog', arcId: 'FX', tasks: [{ id: '9041.1', done: false }] })
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [phase] }] })
  writeFileSync(join(root, 'roadmap', 'backlog.ts'), `export default defineBacklog({
  "tiers": [{ "tier": 0, "label": "queued", "items": [{ "phase": ${phase}, "name": "pause target" }] }]
})\n`)
  commitPaths(root, 'docs(roadmap): seed pause-after fixture', [
    `roadmap/phases/phase-${phase}.phase.ts`, 'roadmap/arcs/FX.arc.ts', 'roadmap/backlog.ts',
  ])
  let arcNextCalls = 0
  let agentCalls = 0
  const run = (command, options = {}) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) {
      arcNextCalls++
      return { stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase, band: 'mid', plane: 'P', done: [], remaining: [], gates: {}, sourceCheckpoint: { digest: 'sha256:pause-checkpoint' } }), stderr: '', exitCode: 0 }
    }
    if (command.includes('gate plan')) return { stdout: JSON.stringify({ phase, slots: [] }), stderr: '', exitCode: 0 }
    if (command === 'roadmap contract show --json-schema') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('result check')) return { stdout: options.input, stderr: '', exitCode: 0 }
    if (command.includes('--verify-complete')) return { stdout: '{}', stderr: '', exitCode: 0 }
    throw new Error(`unexpected pause-after command: ${command}`)
  }
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P', pauseAfter: phase }, {
    cwd: root,
    run,
    agent: async () => {
      agentCalls++
      return { result: { phase, status: 'done', gateRounds: 1, compromises: [], skipped: [] } }
    },
  })
  const events = readFileSync(join(root, '.building', `${phase}-executor.jsonl`), 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(result.halt, 'pause-after', JSON.stringify(result))
  assert.equal(result.phase, phase)
  assert.deepEqual(result.evidence, { pauseAfter: phase })
  assert.equal(result.resume, 'relaunch-plane')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(result.transitionReceipt.event.type, 'pause-after')
  assert.equal(events.at(-1).event, 'phase-complete')
  assert.equal(events.at(-1).resultTailComplete, true)
  assert.equal(arcNextCalls, 1, 'pause returns before deriving another action')
  assert.equal(agentCalls, 1, 'pause never respawns the completed phase')
})

test('arc workflow lifecycle — invalid pauseAfter fails before config, arm, derive, or spawn', async () => {
  let actions = 0
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P', pauseAfter: 0 }, {
    cwd: makeFixtureRepo(),
    run: () => { actions++; throw new Error('invalid pauseAfter must fail before commands') },
    agent: async () => { actions++; throw new Error('invalid pauseAfter must fail before spawn') },
  })
  assert.equal(result.halt, 'failed')
  assert.match(JSON.stringify(result.evidence), /pauseAfter/)
  assert.equal(result.transitionReceipt.event.type, 'failed')
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(actions, 0)
})

test('arc workflow lifecycle — reconciled unobserved recovery still refuses a standing executor arm', async () => {
  const phase = 9043
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({ arc: 'FX', action: 'resume-phase', phase, band: 'mid', plane: 'P', done: [], remaining: [], gates: {} }),
      stderr: '', exitCode: 0,
    }
    if (command.includes('gate plan')) return { stdout: JSON.stringify({ phase, slots: [] }), stderr: '', exitCode: 0 }
    if (command === 'roadmap contract show --json-schema') return { stdout: '{}', stderr: '', exitCode: 0 }
    throw new Error(`unexpected recovery command: ${command}`)
  }, { recovery: { kind: 'unobserved', phase, evidence: { reconciled: true } } })
  writePhaseFile(drive.root, {
    phase, status: 'in-progress', arcId: 'FX', keyFiles: [],
    tasks: [{ id: `${phase}.1`, done: false }],
  })
  writeArcFile(drive.root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [phase] }] })
  armExecutor(drive.root, phase, 'incumbent-session', { executorId: 'incumbent-executor' })

  const result = await drive.result()
  assert.equal(result.trace.receipts.some((receipt) => receipt.event.type === 'resume'), false)
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(result.transitionReceipt.event.type, 'unobserved')
  assert.equal(result.transitionReceipt.next.status, 'halted')
  assert.equal(result.halt, 'unobserved')
  assert.match(JSON.stringify(result.evidence), /executor.*arm|standing|incumbent/i)
  assert.equal(result.resume, 'reconcile')
  assert.equal(drive.agentCalls(), 0, 'caller reconciliation evidence cannot bypass the actual arm')
})

test('arc workflow lifecycle — every recoverable halt keeps its safe decision closed while an arm stands', async () => {
  for (const [kind, evidence, resume] of [
    ['failed', { inspected: true }, 'inspect-failure'],
    ['stalled', { reconciled: true }, 'reconcile'],
    ['exited', { reconciled: true }, 'reconcile'],
    ['unobserved', { reconciled: true }, 'reconcile'],
  ]) {
    const root = makeFixtureRepo()
    armExecutor(root, 9044, 'incumbent-session', { executorId: `incumbent-${kind}` })
    let actions = 0
    const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P', recovery: { kind, phase: 9044, evidence } }, {
      cwd: root,
      run: () => { actions++; throw new Error('standing recovery arm must hold before commands') },
      agent: async () => { actions++; throw new Error('standing recovery arm must hold before spawn') },
    })
    assert.equal(result.halt, kind)
    assert.equal(result.resume, resume)
    assert.equal(result.transitionReceipt.event.type, kind)
    assert.equal(result.transitionReceipt.rejection, null)
    assert.equal(result.trace.receipts.some((receipt) => receipt.event.type === 'resume'), false)
    assert.equal(actions, 0)
  }
})

test('arc workflow lifecycle — a standing arm blocks before gate planning and inline handoff', async () => {
  const phase = 9045
  const drive = driveEarlyArcWorkflow((command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase, band: 'trivial', plane: 'P', done: [], remaining: [], gates: {} }),
      stderr: '', exitCode: 0,
    }
    throw new Error(`standing arm must block before inline preparation: ${command}`)
  })
  writePhaseFile(drive.root, { phase, status: 'backlog', arcId: 'FX', keyFiles: [], tasks: [{ id: `${phase}.1`, done: false }] })
  writeArcFile(drive.root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [phase] }] })
  armExecutor(drive.root, phase, 'incumbent-session', { executorId: 'incumbent-inline' })
  const result = await drive.result()
  assert.equal(result.halt, 'blocked')
  assert.equal(result.resume, 'inspect-blocker')
  assert.match(JSON.stringify(result.evidence), /executor.*arm|incumbent/i)
  assert.equal(drive.calls.some((command) => command.includes('gate plan')), false)
  assert.equal(result.handoffInline, undefined)
  assert.equal(drive.agentCalls(), 0)
})

test('arc workflow lifecycle — malformed quoted backlog refuses without changing actual file bytes', () => {
  const root = makeFixtureRepo()
  const file = join(root, 'roadmap', 'backlog.ts')
  const malformed = `export default defineBacklog({
  "tiers": [
    { "tier": 0, "label": "Broken queue", "items": [
      { "phase": 9038, "name": "truncated"
  ]
})
`
  writeFileSync(file, malformed)
  const before = readFileSync(file, 'utf8')
  const result = groomBacklogSource(before, 9038)
  assert.match(result.error, /malformed|parse|unsupported/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

function interruptedTailFixture({ complete }) {
  const root = makeFixtureRepo()
  const phase = 9040
  const result = { phase, status: 'done', gateRounds: 1, compromises: [], skipped: [] }
  writePhaseFile(root, { phase, status: 'done', arcId: 'FX', executionResult: result, tasks: [{ id: '9040.1', done: true }] })
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [phase] }] })
  commitPaths(root, 'feat: seed result-tail recovery fixture', [
    'roadmap/phases/phase-9040.phase.ts',
    'roadmap/arcs/FX.arc.ts',
  ])
  const identity = {
    arcId: 'FX',
    phase,
    checkpointDigest: 'sha256:checkpoint-9040',
    resultDigest: 'sha256:result-9040',
    eventId: 'result:FX:9040:sha256:checkpoint-9040',
    owner: { pid: process.pid, sessionId: 'interrupted-owner' },
    authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
  }
  claimResultConsumption(root, identity)
  if (complete) appendExecutorEvent(root, phase, 'phase-complete', {
    resultTailComplete: true,
    checkpointDigest: identity.checkpointDigest,
    resultDigest: identity.resultDigest,
  })
  const calls = []
  const run = (command) => {
    calls.push(command)
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return {
      stdout: JSON.stringify({
        arc: 'FX',
        action: 'complete',
        done: [phase],
        remaining: [],
        gates: {},
        transitionReceipt: { forged: true },
      }),
      stderr: '',
      exitCode: 0,
    }
    throw new Error(`unexpected interrupted-tail command: ${command}`)
  }
  return { root, phase, calls, run }
}

test('arc workflow lifecycle — claim without matching completion halts before arc-next', async () => {
  const fixture = interruptedTailFixture({ complete: false })
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, {
    cwd: fixture.root,
    run: fixture.run,
    agent: async () => { throw new Error('agent must not launch for interrupted result tail') },
  })
  assert.equal(result.halt, 'failed')
  assert.ok(result.evidence.resultConsumptionInterrupted)
  assert.equal(result.transitionReceipt.event.type, 'failed')
  assert.ok(!fixture.calls.some((command) => command.includes('arc next')))
})

test('arc workflow lifecycle — exact completion beacon lets the next workflow derive progress', async () => {
  const fixture = interruptedTailFixture({ complete: true })
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, {
    cwd: fixture.root,
    run: fixture.run,
    agent: async () => { throw new Error('completed result tail must not relaunch agent') },
  })
  assert.equal(result.done, true)
  assert.ok(fixture.calls.some((command) => command.includes('arc next')))
  assert.equal(result.transitionReceipt.rejection, null)
  assert.equal(result.transitionReceipt.event.type, 'complete')
  assert.equal(result.transitionReceipt.next.stage, 'complete')
  assert.notDeepEqual(result.transitionReceipt, { forged: true })
})

test('37.6 — every advertised lifecycle halt has one stable safe resume and duplicate delivery is a no-op', () => {
  const expected = new Map([
    ['blocked', 'inspect-blocker'], ['escalated', 'wait-user'], ['failed', 'inspect-failure'],
    ['self-descope', 'wait-user'], ['stalled', 'reconcile'], ['exited', 'reconcile'],
    ['unobserved', 'reconcile'], ['permission', 'wait-user'], ['auth', 'wait-user'],
    ['review-exhausted', 'wait-user'], ['gaps', 'run-correction'],
    ['pause-after', 'relaunch-plane'], ['land-unproven', 'reconcile'],
  ])
  assert.deepEqual(new Set(HALT_KINDS), new Set(expected.keys()), 'new advertised halt tokens require an explicit safe-resume decision')
  for (const [index, kind] of HALT_KINDS.entries()) {
    const stage = kind === 'gaps' ? 'validate' : kind === 'land-unproven' ? 'land' : 'phase'
    const state = {
      arcId: 'FX', stage, status: 'active', processedEventIds: [], lastHalt: null,
      authorityRef: { status: 'unknown', reason: 'read-only-projection', sourceRef: null },
    }
    const event = { eventId: `legacy-${index}`, arcId: 'FX', source: 'fixture-conformance', type: kind, phase: 37, evidence: { legacyOutcome: index } }
    const accepted = reduceArcTransition(state, event)
    assert.equal(accepted.rejection, null, kind)
    assert.equal(accepted.resume, expected.get(kind), kind)
    assert.equal(accepted.next.lastHalt.resume, expected.get(kind), kind)
    const duplicate = reduceArcTransition(accepted.next, event)
    assert.equal(duplicate.rejection.kind, 'duplicate-event', kind)
    assert.deepEqual(duplicate.next, accepted.next, kind)
    assert.equal(duplicate.resume, expected.get(kind), kind)
  }
})

test('inline handoff auto-consumes its embedded done result and shared tail exactly once before deriving',async()=>{
 let baseline
 const first=driveEarlyArcWorkflow(command=>{
  if(command==='roadmap config check'||command==='roadmap arm FX')return {stdout:'{}',stderr:'',exitCode:0}
  if(command.includes('arc next'))return {stdout:JSON.stringify({arc:'FX',action:'run-phase',phase:9037,band:'mid',plane:'P',done:[],remaining:[],gates:{}}),stderr:'',exitCode:0}
  if(command===`roadmap gate plan 9037 --base ${baseline} --json`)return {stdout:JSON.stringify({phase:9037,slots:[],baselineKind:'pre-start-head',baseHead:baseline}),stderr:'',exitCode:0}
  throw Error(`unexpected first-inline command: ${command}`)
 },{force:'inline'})
 const configPath=join(first.root,'roadmap','roadmap.config.json'),cfg=JSON.parse(readFileSync(configPath,'utf8'));cfg.gateCommands.emit='FIXTURE_SLOT_LOG=.fixture-slots.jsonl bash bin/fake-slot.sh emit';writeFileSync(configPath,JSON.stringify(cfg))
 writePhaseFile(first.root,{phase:9037,status:'backlog',arcId:'FX',tasks:[{id:'9037.1',done:false}]})
 writeArcFile(first.root,{id:'FX',name:'Inline fixture',baseRef:'develop',planes:[{name:'P',phases:[9037]}]})
 writeFileSync(join(first.root,'roadmap','backlog.ts'),"export default { entries: [ { phase: 9037, name: 'inline' } ] }\n")
 baseline=git(first.root,'rev-parse','HEAD')
 assert.equal((await first.result()).handoffInline.route,'handoff-inline')
 const embedded={phase:9037,status:'done',compromises:[],skipped:[],gateRounds:1}
 writePhaseFile(first.root,{phase:9037,status:'done',arcId:'FX',tasks:[{id:'9037.1',done:true}],executionResult:embedded})
 const calls=[],run=(command,options={})=>{
  calls.push(command)
  if(command==='roadmap config check'||command==='roadmap arm FX')return {stdout:'{}',stderr:'',exitCode:0}
  if(command==='roadmap result check --phase 9037')return {stdout:options.input,stderr:'',exitCode:0}
  if(command==='roadmap gate run 9037 --verify-complete')return {stdout:'{}',stderr:'',exitCode:0}
  if(command.includes('arc next'))return {stdout:JSON.stringify({arc:'FX',action:'complete',done:[9037],remaining:[],gates:{}}),stderr:'',exitCode:0}
  throw Error(`unexpected completion command: ${command}`)
 }
 const deps={cwd:first.root,run,agent:async()=>{throw Error('completed inline phase must not spawn')}}
 const dirty=await arcPlaneWorkflow({arcId:'FX',planeName:'P',force:'inline'},deps);assert.equal(dirty.halt,'failed');assert.match(JSON.stringify(dirty.evidence),/committed/);assert.equal(calls.some(command=>command.includes('result check')),false)
 commitPaths(first.root,'feat: phase 9037 — 9037.1 complete',['roadmap/phases/phase-9037.phase.ts'])
 assert.equal((await arcPlaneWorkflow({arcId:'FX',planeName:'P',force:'inline'},deps)).done,true)
 const checkAt=calls.indexOf('roadmap result check --phase 9037'),verifyAt=calls.indexOf('roadmap gate run 9037 --verify-complete'),nextAt=calls.findIndex(command=>command.includes('arc next'))
 assert.ok(checkAt>=0&&verifyAt>checkAt&&nextAt>verifyAt,JSON.stringify(calls));assert.doesNotMatch(readFileSync(join(first.root,'roadmap','backlog.ts'),'utf8'),/9037/)
 const emits=readSlotLog(first.root).filter(row=>row.slot==='emit').length;assert.equal(emits,1)
 assert.equal((await arcPlaneWorkflow({arcId:'FX',planeName:'P',force:'inline'},deps)).done,true)
 assert.equal(calls.filter(command=>command==='roadmap result check --phase 9037').length,1);assert.equal(readSlotLog(first.root).filter(row=>row.slot==='emit').length,emits)
})
