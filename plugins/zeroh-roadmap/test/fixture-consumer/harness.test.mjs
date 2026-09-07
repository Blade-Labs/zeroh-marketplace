#!/usr/bin/env node
/** TEST-FIRST: arc-plane selects the native-driver factory for phase execution. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import arcPlaneWorkflow from '../../workflows/arc-plane.workflow.mjs'
import { makeFixtureRepo, writePhaseFile, writeArcFile, commitPaths, git, runNativeDriverFixture } from './harness.mjs'

test('run-phase selects createNativeAgentDriver and leaves the legacy agent primitive untouched', async () => {
  const root = makeFixtureRepo()
  writePhaseFile(root, { phase: 3851, status: 'backlog', arcId: 'FX', tasks: [{ id: '3851.1', done: false }] })
  const head = git(root, 'rev-parse', 'HEAD')
  let factories = 0
  let legacy = 0
  const run = (command) => {
    if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
    if (command === 'roadmap contract show --json-schema') return { stdout: JSON.stringify({ type: 'object' }), stderr: '', exitCode: 0 }
    if (command.includes('arc next')) return { stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase: 3851, band: 'mid', plane: 'P', done: [], remaining: [3851], gates: {} }), stderr: '', exitCode: 0 }
    if (command === `roadmap gate plan 3851 --base ${head} --json`) return { stdout: JSON.stringify({ phase: 3851, slots: [], baselineKind: 'pre-start-head', baseHead: head }), stderr: '', exitCode: 0 }
    throw new Error(`unexpected command ${command}`)
  }
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, {
    cwd: root, run,
    createNativeAgentDriver(options) {
      factories++
      assert.equal(options.cwd, root)
      return { async runPhase(input) { assert.equal(input.arcId, 'FX'); assert.equal(input.phase, 3851); return { status: 'hold', kind: 'capability-provenance-unavailable', reason: 'fixture unavailable' } } }
    },
    legacyAgent: async () => { legacy++; throw new Error('legacy agent must not run') },
  })
  assert.equal(factories, 1)
  assert.equal(legacy, 0)
  assert.equal(result.status, 'hold')
})

test('orphan stable arm holds before native factory or current-source planning', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs'); const { dirname } = await import('node:path'); const { armPath } = await import('../../cli/lib/executor-arm.mjs')
  const root = makeFixtureRepo(); const phase = 3852
  const arm = armPath(root, phase); mkdirSync(dirname(arm), { recursive: true }); writeFileSync(arm, JSON.stringify({ sessionId: 'parent', executorId: 'executor', runId: 'missing-run', requestFingerprint: 'a'.repeat(64), armedAt: new Date().toISOString() }) + '\n')
  let factories = 0
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, { cwd: root, run(command) { if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }; throw new Error(`planning after orphan arm: ${command}`) }, createNativeAgentDriver() { factories++; return {} } })
  assert.equal(factories, 0); assert.equal(result.halt, 'blocked')
})

test('canonical stable-arm result enters result-check before arc-next after child HEAD changes', async () => {
  const { createHash } = await import('node:crypto'); const { persistRunRequest, bindNativeSession, persistRunResult } = await import('../../cli/lib/run-receipt.mjs'); const { reduceArcTransition } = await import('../../cli/lib/workflow-steps.mjs'); const { claimExecutorRun } = await import('../../cli/lib/executor-arm.mjs')
  const root = makeFixtureRepo(); const phase = 3853
  writePhaseFile(root, { phase, status: 'in-progress', arcId: 'FX', acceptanceCriteria: ['candidate recorded'], tasks: [{ id: '3853.1', title: 'record candidate', done: false }] })
  writeArcFile(root, { id: 'FX', baseRef: 'develop', acceptanceCriteria: [{ job: 'candidate recorded' }], planes: [{ name: 'P', phases: [phase] }] })
  commitPaths(root, 'feat: seed native recovery metadata', [`roadmap/phases/phase-${phase}.phase.ts`, 'roadmap/arcs/FX.arc.ts'])
  const originalHead = git(root, 'rev-parse', 'HEAD'); const hash = (v) => createHash('sha256').update(v).digest('hex'); const role = Buffer.from('role\n'); const governance = Buffer.from('governance\n')
  const authority = { parent: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'supervisor' } }, request: { profile: 'inherit', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: null }, effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false } }, native: { driver: 'codex', runtime: { version: null, verified: false }, argv: ['exec'], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['fixture'] } }
  const request = { runId: 'run-original', executorId: 'executor-original', arcId: 'FX', phase, roleId: 'phase-executor', driverId: 'codex', model: 'gpt-5.6-sol', worktree: root, baseHead: originalHead, requestedHead: originalHead, roleCardDigest: hash(role), governanceDigest: hash(governance), authority, authorityRef: { status: 'known', envelopeDigest: 'sha256:fixture', source: { kind: 'managed-host-receipt', ref: 'harness' } } }
  const recorded = persistRunRequest(root, request, { operation: { kind: 'start', inputDigest: hash('') }, roleCardBytes: role, governanceBytes: governance }); claimExecutorRun(root, phase, { sessionId: 'parent', executorId: request.executorId, runReceipt: recorded.receipt })
  writePhaseFile(root, { phase, status: 'done', arcId: 'FX', acceptanceCriteria: ['candidate recorded'], executionResult: { phase, status: 'done', gateRounds: 1, compromises: [], skipped: [] }, tasks: [{ id: '3853.1', title: 'record candidate', done: true }] })
  commitPaths(root, 'feat: child completed native phase', [`roadmap/phases/phase-${phase}.phase.ts`]); assert.notEqual(git(root, 'rev-parse', 'HEAD'), originalHead)
  const order = []; const phaseResult = { phase, status: 'done', gateRounds: 1, compromises: [], skipped: [] }
  const candidate = { phase, status: 'done', gateRounds: 1 } // Consumer validation supplies default arrays.

  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, { cwd: root, createNativeAgentDriver() { return { async runPhase(input) { order.push('recover'); assert.equal(input.recovery.runId, request.runId); const bound = bindNativeSession(root, { arcId: 'FX', runId: request.runId, expectedRevisionDigest: recorded.receipt.digest, nativeSessionId: 'native-harness' }); const prior = { arcId: 'FX', stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: request.authorityRef }; const event = { eventId: 'native-harness-exit', arcId: 'FX', source: 'native-agent', type: 'exited', phase, authorityRef: request.authorityRef }; const observation = { handle: { request, nativeSessionId: 'native-harness' }, observation: { runId: request.runId, executorId: request.executorId, roleId: request.roleId, driverId: request.driverId, model: request.model, nativeSessionId: 'native-harness', event }, transition: reduceArcTransition(prior, event) }; persistRunResult(root, { arcId: 'FX', runId: request.runId, expectedRevisionDigest: bound.receipt.digest, observation, result: { status: 'transport-exited', phaseResult: candidate } }); return { result: candidate } } } }, run(command) { if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }; if (command.includes('result check')) { order.push('result-check'); return { stdout: JSON.stringify(phaseResult), stderr: '', exitCode: 0 } }; if (command.includes('arc next')) { order.push('arc-next'); return { stdout: JSON.stringify({ arc: 'FX', action: 'complete', done: [phase], remaining: [], gates: {} }), stderr: '', exitCode: 0 } }; return { stdout: '{}', stderr: '', exitCode: 0 } } })
  assert.deepEqual(order.slice(0, 2), ['recover', 'result-check']); assert.equal(result.done, true)
  const { existsSync } = await import('node:fs')
  const { armPath, claimExecutorRun: reclaimExecutorRun } = await import('../../cli/lib/executor-arm.mjs')
  assert.equal(existsSync(armPath(root, phase)), false, 'normal completed tail removes the exact native arm')
  let secondFactories = 0
  const completeRun = (factory) => arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, { cwd: root, createNativeAgentDriver: factory, run(command) { if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }; if (command.includes('result check')) return { stdout: JSON.stringify(phaseResult), stderr: '', exitCode: 0 }; if (command.includes('arc next')) return { stdout: JSON.stringify({ arc: 'FX', action: 'complete', done: [phase], remaining: [], gates: {} }), stderr: '', exitCode: 0 }; return { stdout: '{}', stderr: '', exitCode: 0 } } })
  const second = await completeRun(() => { secondFactories++; return {} })
  assert.equal(second.done, true, JSON.stringify(second)); assert.equal(secondFactories, 0)
  reclaimExecutorRun(root, phase, { sessionId: 'parent', executorId: request.executorId, runReceipt: recorded.receipt })
  let crashFactories = 0
  const crashRecovery = await completeRun(() => { crashFactories++; return {} })
  assert.equal(crashRecovery.done, true, JSON.stringify(crashRecovery)); assert.equal(crashFactories, 0)
  assert.equal(existsSync(armPath(root, phase)), false, 'crash-after-tail recovery removes the exact reintroduced arm')
})

test('native runPhase races the supplied watchdog and returns unobserved without duplicating the retained run', { timeout: 1_000 }, async () => {
  const root = makeFixtureRepo()
  const phase = 3854
  writePhaseFile(root, { phase, status: 'backlog', arcId: 'FX', tasks: [{ id: '3854.1', done: false }] })
  const head = git(root, 'rev-parse', 'HEAD')
  let factories = 0
  let phases = 0
  const result = await arcPlaneWorkflow({ arcId: 'FX', planeName: 'P' }, {
    cwd: root,
    bg: () => Promise.resolve({ watchExit: 5, watchVerdict: { reason: 'fixture unobserved' } }),
    createNativeAgentDriver() {
      factories++
      return { runPhase() { phases++; return new Promise(() => {}) } }
    },
    run(command) {
      if (command === 'roadmap config check' || command === 'roadmap arm FX') return { stdout: '{}', stderr: '', exitCode: 0 }
      if (command.includes('arc next')) return { stdout: JSON.stringify({ arc: 'FX', action: 'run-phase', phase, band: 'mid', plane: 'P', done: [], remaining: [phase], gates: {} }), stderr: '', exitCode: 0 }
      if (command === `roadmap gate plan ${phase} --base ${head} --json`) return { stdout: JSON.stringify({ phase, slots: [], baselineKind: 'pre-start-head', baseHead: head }), stderr: '', exitCode: 0 }
      if (command === 'roadmap contract show --json-schema') return { stdout: JSON.stringify({ type: 'object' }), stderr: '', exitCode: 0 }
      throw new Error(`unexpected command ${command}`)
    },
  })
  assert.equal(result.halt, 'unobserved')
  assert.deepEqual(result.evidence, { reason: 'fixture unobserved' })
  assert.equal(factories, 1)
  assert.equal(phases, 1)
})

const NATIVE_COMBINATIONS = [
  { parentDriverId: 'claude', policy: { preset: 'claude' }, expectedDriver: 'claude' },
  { parentDriverId: 'claude', policy: { preset: 'codex' }, expectedDriver: 'codex' },
  { parentDriverId: 'codex', policy: { preset: 'claude' }, expectedDriver: 'claude' },
  { parentDriverId: 'codex', policy: { preset: 'codex' }, expectedDriver: 'codex' },
]

test('four available parent-to-native combinations complete with equivalent transitions and exact resume', async () => {
  const rows = []
  for (const [index, combination] of NATIVE_COMBINATIONS.entries()) {
    const row = await runNativeDriverFixture({ ...combination, laneId: `matrix-${index}`, schedule: { resume: true } })
    assert.equal(row.outcome, 'complete', JSON.stringify(row))
    assert.equal(row.selected.roleId, 'phase-executor'); assert.equal(row.selected.driverId, combination.expectedDriver)
    assert.equal(row.ownerCount, 1); assert.equal(row.terminalResultCount, 1); assert.equal(row.externalLaunchCount, 1)
    assert.equal(row.owner.runId, row.runId); assert.equal(row.owner.executorId, row.executorId)
    assert.equal(row.receipts.filter(({ snapshot }) => snapshot.terminalResult !== null).length, 1)
    for (const receipt of row.receipts) { assert.match(receipt.digest, /^[a-f0-9]{64}$/); assert.deepEqual(JSON.parse((await import('node:fs')).readFileSync(receipt.path, 'utf8')), receipt.snapshot); assert.equal(receipt.snapshot.request.runId, row.runId); assert.equal(receipt.snapshot.request.executorId, row.executorId) }
    rows.push(row)
  }
  for (const row of rows.slice(1)) assert.deepEqual(row.semanticTransition, rows[0].semanticTransition)
})

test('an explicitly unavailable host holds before owner or launch', async () => {
  const row = await runNativeDriverFixture({ ...NATIVE_COMBINATIONS[0], laneId: 'unavailable', unavailableHost: true })
  assert.equal(row.outcome, 'hold'); assert.match(row.kind, /capability|provenance|unavailable/); assert.ok(row.reason.length > 0)
  assert.equal(row.externalLaunchCount, 0); assert.equal(row.ownerCount, 0); assert.equal(row.terminalResultCount, 0)
})

test('twenty concurrent native lanes survive duplicate wake, refused action, compaction, and parent restart with one owner/result', async () => {
  const rows = await Promise.all(Array.from({ length: 20 }, (_, lane) => {
    const combination = NATIVE_COMBINATIONS[lane % NATIVE_COMBINATIONS.length]
    return runNativeDriverFixture({
      ...combination,
      laneId: `race-${lane}`,
      schedule: { duplicateWake: true, action: { action: 'message', payload: { text: `lane-${lane}` } }, compact: true, newDriverInstance: true, parentRestart: true },
    })
  }))
  assert.equal(rows.length, 20)
  for (const [lane, row] of rows.entries()) {
    assert.equal(row.outcome, 'complete', `lane ${lane}: ${JSON.stringify(row)}`)
    assert.equal(row.selected.roleId, 'phase-executor', `lane ${lane}`)
    assert.equal(row.ownerCount, 1, `lane ${lane}`)
    assert.equal(row.terminalResultCount, 1, `lane ${lane}`)
    assert.equal(row.externalLaunchCount, 1, `lane ${lane}`)
    assert.equal(new Set(row.receipts.map((receipt) => receipt.runId)).size, 1, `lane ${lane}: one run`)
    assert.equal(new Set(row.receipts.map((receipt) => receipt.executorId)).size, 1, `lane ${lane}: one executor`)
    assert.equal(row.refusals.length, 1, `lane ${lane}: one action refusal`)
    assert.equal(row.refusals[0].kind, 'capability-refusal', `lane ${lane}`)
    assert.equal(row.owner.runId, row.runId); assert.equal(row.owner.executorId, row.executorId)
    assert.equal(row.receipts.filter(({ snapshot }) => snapshot.terminalResult !== null).length, 1)
    for (const receipt of row.receipts) assert.deepEqual(JSON.parse((await import('node:fs')).readFileSync(receipt.path, 'utf8')), receipt.snapshot)
  }
})
