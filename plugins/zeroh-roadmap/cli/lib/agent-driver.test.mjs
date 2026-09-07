#!/usr/bin/env node
/**
 * TEST-FIRST for the harness-neutral native-agent contract. RED means a wake can
 * accidentally spawn a second run, semantic roles can be replaced by provider
 * identity, or an observation can bypass the phase-37 lifecycle reducer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentDriver } from './agent-driver.mjs'
import { reduceArcTransition } from './workflow-steps.mjs'
import { MODEL_IDS } from './drivers.mjs'

const AUTHORITY_REF = Object.freeze({
  status: 'known',
  envelopeDigest: 'sha256:authority',
  source: Object.freeze({ kind: 'managed-host-receipt', ref: 'receipt-38-1' }),
})

function request(overrides = {}) {
  return {
    runId: 'run-38-1', executorId: 'executor-38', arcId: 'NATIVEGREEN', phase: 38,
    roleId: 'test-engineer', driverId: 'codex', model: MODEL_IDS.SOL,
    worktree: '/tmp/nativegreen-38', baseHead: '1111111111111111111111111111111111111111', requestedHead: '2222222222222222222222222222222222222222',
    roleCardDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', governanceDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    authority: {
      parent: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'supervisor' } },
      request: { profile: 'inherit', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: null },
      effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false } },
      native: { driver: 'codex', runtime: { version: null, verified: false }, argv: ['exec'], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['exact runtime is unverified'] },
    },
    authorityRef: AUTHORITY_REF,
    ...overrides,
  }
}

function lifecycle(overrides = {}) {
  return { arcId: 'NATIVEGREEN', stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: AUTHORITY_REF, ...overrides }
}

function fixtureDriver() {
  const calls = []
  const transport = {
    async probe(input) { calls.push(['probe', input]); return { reachable: true } },
    async start(input) { calls.push(['start', input]); return { nativeSessionId: 'native-session-1' } },
    async resume(handle) { calls.push(['resume', handle]); return { nativeSessionId: handle.nativeSessionId } },
    async awaitEvent(handle) {
      calls.push(['awaitEvent', handle])
      return { runId: handle.request.runId, executorId: handle.request.executorId, roleId: handle.request.roleId, driverId: handle.request.driverId, model: handle.request.model, nativeSessionId: handle.nativeSessionId, event: { eventId: `event-${calls.length}`, arcId: handle.request.arcId, source: 'native-agent', type: 'run-phase', phase: handle.request.phase, authorityRef: handle.request.authorityRef } }
    },
    async performAction(handle, action) { calls.push(['performAction', handle, action]); return { nativeSessionId: handle.nativeSessionId } },
  }
  return { calls, driver: new AgentDriver({ driverId: 'codex', capabilities: { actions: ['message'] }, transport }) }
}

test('start is distinct from repeated resume and awaitEvent calls on one recorded native identity', async () => {
  const { calls, driver } = fixtureDriver()
  const started = await driver.start(request())
  assert.equal(started.nativeSessionId, 'native-session-1')
  assert.deepEqual(started.request, request())

  const resumed = await driver.resume(started)
  const first = await driver.awaitEvent(resumed, lifecycle())
  const second = await driver.awaitEvent(resumed, first.transition.next)

  assert.equal(resumed.nativeSessionId, started.nativeSessionId)
  assert.equal(first.handle.nativeSessionId, started.nativeSessionId)
  assert.equal(second.handle.nativeSessionId, started.nativeSessionId)
  assert.deepEqual(calls.map(([operation]) => operation), ['start', 'resume', 'awaitEvent', 'awaitEvent'])
  assert.equal(calls.filter(([operation]) => operation === 'start').length, 1, 'wake paths cannot fall back to start')
})

test('semantic roleId survives independently of native driver, model, and session identity', async () => {
  const { driver } = fixtureDriver()
  const handle = await driver.start(request({ roleId: 'architect', driverId: 'codex', model: MODEL_IDS.SOL }))
  assert.equal(handle.request.roleId, 'architect')
  assert.equal(handle.request.driverId, 'codex')
  assert.equal(handle.request.model, MODEL_IDS.SOL)
  assert.equal(handle.nativeSessionId, 'native-session-1')
})

test('every accepted native observation is interpreted by the existing lifecycle reducer', async () => {
  const { driver } = fixtureDriver()
  const prior = lifecycle({ authorityRef: structuredClone(AUTHORITY_REF) })
  const receipt = await driver.awaitEvent(await driver.start(request()), prior)
  assert.deepEqual(receipt.transition, reduceArcTransition(prior, receipt.observation.event))
  assert.equal(receipt.transition.rejection, null)
  assert.deepEqual(receipt.handle.request, request())
  assert.equal(receipt.observation.nativeSessionId, receipt.handle.nativeSessionId)
})

test('unsupported actions return a typed capability refusal without touching the transport', async () => {
  const { calls, driver } = fixtureDriver()
  const handle = await driver.start(request())
  const refusal = await driver.performAction(handle, { action: 'merge', payload: { pullRequest: 38 } })
  assert.deepEqual(refusal, {
    kind: 'capability-refusal', driverId: 'codex', operation: 'performAction',
    action: 'merge', reason: "driver 'codex' does not support action 'merge'",
  })
  assert.deepEqual(calls.map(([operation]) => operation), ['start'])
})

test('probe reports the declared operations and action vocabulary', async () => {
  const { driver } = fixtureDriver()
  assert.deepEqual(await driver.probe(), {
    kind: 'capability-receipt', driverId: 'codex', reachable: true,
    operations: ['start', 'resume', 'awaitEvent', 'performAction'], actions: ['message'],
  })
})

test('changed transport identity is refused before it can become a durable observation', async () => {
  const base = request()
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: {
      async start() { return { nativeSessionId: 'native-session-1' } },
      async awaitEvent(handle) {
        return {
          runId: 'forged-run', executorId: handle.request.executorId, roleId: handle.request.roleId,
          driverId: handle.request.driverId, model: handle.request.model,
          nativeSessionId: handle.nativeSessionId,
          event: { eventId: 'forged', arcId: handle.request.arcId, source: 'native-agent', type: 'run-phase', phase: 38 },
        }
      },
    },
  })
  await assert.rejects(() => driver.awaitEvent({ request: base, nativeSessionId: 'native-session-1' }, lifecycle()), /runId|identity|mismatch/i)
})

test('an observation cannot widen recorded authority through the reducer seam', async () => {
  const base = request()
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: {
      async awaitEvent(handle) {
        return {
          runId: handle.request.runId, executorId: handle.request.executorId, roleId: handle.request.roleId,
          driverId: handle.request.driverId, model: handle.request.model, nativeSessionId: handle.nativeSessionId,
          event: { eventId: 'widen-authority', arcId: handle.request.arcId, source: 'native-agent', type: 'run-phase', phase: 38,
            authorityRef: { status: 'known', envelopeDigest: 'sha256:other', source: { kind: 'managed-host-receipt', ref: 'other' } } },
        }
      },
    },
  })
  const prior = lifecycle()
  const receipt = await driver.awaitEvent({ request: base, nativeSessionId: 'native-session-1' }, prior)
  assert.equal(receipt.transition.rejection?.kind, 'authority-conflict')
  assert.deepEqual(receipt.transition.next, prior)
})

test('a missing resume operation refuses without falling back to start', async () => {
  let starts = 0
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: { async start() { starts++; return { nativeSessionId: 'new-session' } } },
  })
  const refusal = await driver.resume({ request: request(), nativeSessionId: 'recorded-session' })
  assert.equal(refusal.kind, 'capability-refusal')
  assert.equal(refusal.driverId, 'codex')
  assert.equal(refusal.operation, 'resume')
  assert.equal(refusal.action, null)
  assert.equal(typeof refusal.reason, 'string')
  assert.ok(refusal.reason.length > 0)
  assert.equal(starts, 0, 'missing resume cannot fall back to a new start')
 })

test('transport mutation cannot alter the caller request or the recorded handle', async () => {
  const original = request()
  const before = structuredClone(original)
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: {
      async start(input) {
        input.roleId = 'forged-role'
        input.authority.effective.bounds.filesystem = 'unrestricted'
        return { nativeSessionId: 'native-session-1' }
      },
    },
  })
  const handle = await driver.start(original)
  assert.deepEqual(original, before, 'the caller-owned request stays byte-for-byte equivalent')
  assert.deepEqual(handle.request, before, 'the durable handle records the validated pre-transport request')
})

test('an incoherent effective authority is refused before any native operation', async () => {
  let starts = 0
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: { async start() { starts++; return { nativeSessionId: 'should-not-start' } } },
  })
  const widened = request()
  widened.authority.effective.bounds.filesystem = 'unrestricted'
  await assert.rejects(() => driver.start(widened), /authority|effective|intersection|filesystem/i)
  assert.equal(starts, 0)
})

test('a malformed probe result reports unreachable without inventing capability evidence', async () => {
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: ['message'] },
    transport: {
      async probe() { return { reachable: 'yes', operations: ['start-everything'] } },
      async start() { return { nativeSessionId: 'native-session-1' } },
    },
  })
  const receipt = await driver.probe()
  assert.equal(receipt.kind, 'capability-receipt')
  assert.equal(receipt.driverId, 'codex')
  assert.equal(receipt.reachable, false)
  assert.deepEqual(receipt.operations, ['start'])
  assert.deepEqual(receipt.actions, ['message'])
  assert.equal(typeof receipt.reason, 'string')
  assert.ok(receipt.reason.length > 0)
})

test('awaitEvent reduces against the pre-await lifecycle snapshot when caller state mutates while pending', async () => {
  let release
  const pendingObservation = new Promise((resolve) => { release = resolve })
  const baseRequest = request()
  const handle = { request: baseRequest, nativeSessionId: 'native-session-1' }
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: { async awaitEvent() { return pendingObservation } },
  })
  const prior = lifecycle({ authorityRef: structuredClone(AUTHORITY_REF) })
  const originalPrior = structuredClone(prior)
  const waiting = driver.awaitEvent(handle, prior)

  prior.arcId = 'MUTATED-WHILE-PENDING'
  prior.authorityRef.envelopeDigest = 'sha256:mutated-while-pending'
  prior.processedEventIds.push('caller-mutation')
  release({
    runId: baseRequest.runId, executorId: baseRequest.executorId, roleId: baseRequest.roleId,
    driverId: baseRequest.driverId, model: baseRequest.model, nativeSessionId: handle.nativeSessionId,
    event: { eventId: 'async-event-38', arcId: baseRequest.arcId, source: 'native-agent', type: 'run-phase', phase: baseRequest.phase, authorityRef: baseRequest.authorityRef },
  })

  const receipt = await waiting
  assert.deepEqual(receipt.transition, reduceArcTransition(originalPrior, receipt.observation.event))
  assert.deepEqual(receipt.transition.prior, originalPrior)
  assert.equal(receipt.transition.rejection, null)
})

test('awaitEvent refuses prior arc or authority mismatches against the handle before transport', async () => {
  for (const [name, prior] of [
    ['arc', lifecycle({ arcId: 'OTHER' })],
    ['authority', lifecycle({ authorityRef: { status: 'known', envelopeDigest: 'sha256:other', source: { kind: 'managed-host-receipt', ref: 'other-receipt' } } })],
  ]) {
    let awaits = 0
    const driver = new AgentDriver({
      driverId: 'codex', capabilities: { actions: [] },
      transport: { async awaitEvent() { awaits++; throw new Error('transport must remain untouched') } },
    })
    await assert.rejects(
      () => driver.awaitEvent({ request: request(), nativeSessionId: 'native-session-1' }, prior),
      new RegExp(`${name}|prior|handle|mismatch`, 'i'),
    )
    assert.equal(awaits, 0, `${name} mismatch must refuse before transport`)
  }
})

test('awaitEvent refuses an observation with no phase instead of normalizing it', async () => {
  let awaits = 0
  const baseRequest = request()
  const handle = { request: baseRequest, nativeSessionId: 'native-session-1' }
  const driver = new AgentDriver({
    driverId: 'codex', capabilities: { actions: [] },
    transport: {
      async awaitEvent() {
        awaits++
        return {
          runId: baseRequest.runId, executorId: baseRequest.executorId, roleId: baseRequest.roleId,
          driverId: baseRequest.driverId, model: baseRequest.model, nativeSessionId: handle.nativeSessionId,
          event: { eventId: 'missing-phase', arcId: baseRequest.arcId, source: 'native-agent', type: 'run-phase', authorityRef: baseRequest.authorityRef },
        }
      },
    },
  })
  await assert.rejects(() => driver.awaitEvent(handle, lifecycle()), /event.*phase|phase.*request|mismatch/i)
  assert.equal(awaits, 1)
})
