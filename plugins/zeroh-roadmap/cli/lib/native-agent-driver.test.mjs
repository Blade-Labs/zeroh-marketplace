#!/usr/bin/env node
/** TEST-FIRST: semantic roles route through one proven native adapter and durable identity. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_IDS } from './drivers.mjs'
import { MODEL_PRESETS } from './roles.mjs'
import { NativeAgentDriver } from './native-agent-driver.mjs'

const request = (overrides = {}) => ({
  runId: 'run-38-5', executorId: 'executor-38', arcId: 'NATIVEGREEN', phase: 38,
  roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL,
  worktree: '/tmp/native-38-5', baseHead: '1'.repeat(40), requestedHead: '2'.repeat(40),
  roleCardDigest: 'a'.repeat(64), governanceDigest: 'b'.repeat(64),
  authority: {
    parent: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'supervisor' } },
    request: { profile: 'inherit', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: null },
    effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false } },
    native: { driver: 'codex', runtime: { version: null, verified: false }, argv: ['exec'], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['runtime unverified'] },
  },
  authorityRef: { status: 'known', envelopeDigest: 'sha256:authority', source: { kind: 'managed-host-receipt', ref: '38.5' } },
  ...overrides,
})
const fresh = (driverId) => ({ ok: true, doc: { driverId, host: 'current-host', date: new Date().toISOString(), probes: [{ name: 'version', pass: true }, { name: 'capabilities', pass: true }] } })

function fixture(provenance = fresh('codex'), options = {}) {
  const calls = []
  const adapter = (id) => ({
    async probe() { calls.push([id, 'probe']); return { reachable: true } },
    async start(req) { calls.push([id, 'start', structuredClone(req)]); return { request: req, nativeSessionId: `${id}-native` } },
    async resume(handle) { calls.push([id, 'resume', structuredClone(handle)]); return handle },
    async awaitEvent(handle) { calls.push([id, 'awaitEvent']); return { handle, result: { status: 'transport-exited' } } },
    async recover(receipt) { calls.push([id, 'recover', structuredClone(receipt)]); return { result: { status: 'transport-exited' } } },
    async performAction(handle, action) { calls.push([id, 'performAction', action]); return { kind: 'capability-refusal', driverId: id, operation: 'performAction', action: action.action, reason: 'unsupported' } },
  })
  const driver = new NativeAgentDriver({
    cwd: '/tmp/native-38-5', parentDriverId: 'codex', modelPolicy: { preset: 'codex' }, sessionId: 'parent-38-5', parentAuthority: request().authority.parent, readLaunchInputs: () => ({ roleCardBytes: Buffer.from('role'), governanceBytes: Buffer.from('governance') }), adapters: { codex: adapter('codex'), claude: adapter('claude') },
    readFreshProvenance: (_cwd, id) => typeof provenance === 'function' ? provenance(id) : provenance,
    ...options,
  })
  return { calls, driver }
}

test('the codex preset is the existing policy that selects the fixture model', () => {
  assert.equal(MODEL_PRESETS.codex.default, MODEL_IDS.SOL)
})

test('one semantic role selects exactly one registered adapter without becoming its native type', async () => {
  const { calls, driver } = fixture()
  const req = request()
  const handle = await driver.start(req)
  assert.equal(handle.request.roleId, 'phase-executor')
  assert.equal(handle.nativeSessionId, 'codex-native')
  assert.deepEqual(calls.filter(([, op]) => op === 'start').map(([id]) => id), ['codex'])
})

test('a request model or driver that differs from the selected semantic role refuses before effects', async () => {
  for (const forged of [request({ model: MODEL_IDS.SONNET }), request({ driverId: 'claude', model: MODEL_IDS.SONNET })]) {
    const { calls, driver } = fixture()
    await assert.rejects(() => driver.start(forged), /role|model|driver|selected/i)
    assert.equal(calls.length, 0)
  }
})

test('unavailable, stale, foreign-host, or failed required-operation evidence holds before persistence or launch', async () => {
  for (const [name, evidence] of [
    ['unavailable', { ok: false, reason: 'missing receipt' }],
    ['stale', { ok: false, reason: 'stale receipt' }],
    ['foreign', { ok: false, reason: 'foreign host' }],
    ['failed probe', { ok: true, doc: { host: 'current-host', date: new Date().toISOString(), probes: [{ name: 'version', pass: false }] } }],
  ]) {
    const { calls, driver } = fixture(evidence)
    const held = await driver.start(request())
    assert.equal(held.status, 'hold', name)
    assert.match(held.kind, /capability|unavailable|provenance/, name)
    assert.equal(calls.length, 0, name)
  }
})

test('restart routes the recorded handle to resume and await without a second start or semantic completion', async () => {
  const { calls, driver } = fixture()
  const handle = { request: request(), nativeSessionId: 'codex-recorded' }
  assert.deepEqual(await driver.resume(handle), handle)
  const observed = await driver.awaitEvent(handle, { arcId: 'NATIVEGREEN', status: 'active' })
  assert.equal(observed.result.status, 'transport-exited')
  assert.equal(calls.filter(([, op]) => op === 'start').length, 0)
  assert.equal(calls.filter(([, op]) => op === 'resume').length, 1)
  assert.equal(calls.filter(([, op]) => op === 'awaitEvent').length, 1)
})

test('a new native operation auto-verifies invalid provenance once, rereads, then starts only if fresh', async () => {
  for (const succeeds of [true, false]) {
    const calls = []
    let reads = 0
    const base = fixture()
    const driver = new NativeAgentDriver({
      cwd: '/tmp/native-38-5', parentDriverId: 'codex', policy: { preset: 'codex' }, adapters: base.driver.adapters,
      provenanceStore: {
        read(_cwd, id) { calls.push(['read', id]); reads++; return reads === 1 || !succeeds ? { ok: false, reason: 'stale', refreshable: true } : fresh(id) },
        verify(_cwd, id) { calls.push(['verify', id]); return succeeds ? 0 : 2 },
      },
    })
    const result = await driver.start(request())
    assert.equal(calls.filter(([op]) => op === 'verify').length, 1)
    assert.equal(base.calls.filter(([, op]) => op === 'start').length, succeeds ? 1 : 0)
    if (!succeeds) assert.equal(result.status, 'hold')
  }
})

test('historical completion ingestion is not freshness-gated and never auto-verifies', async () => {
  const base = fixture()
  const calls = []
  const driver = new NativeAgentDriver({
    cwd: '/tmp/native-38-5', parentDriverId: 'codex', policy: { preset: 'codex' }, adapters: base.driver.adapters,
    provenanceStore: {
      read() { calls.push('read'); return { ok: false, reason: 'stale' } },
      verify() { calls.push('verify'); return 2 },
    },
  })
  const handle = { request: request(), nativeSessionId: 'codex-recorded' }
  const result = await driver.awaitEvent(handle, { arcId: 'NATIVEGREEN', status: 'active' })
  assert.equal(result.result.status, 'transport-exited')
  assert.deepEqual(calls, [])
})

test('runPhase drives the selected durable adapter and returns transport result without declaring phase completion', async () => {
  const { calls, driver } = fixture()
  const output = await driver.runPhase({
    arcId: 'NATIVEGREEN', phase: 38, prompt: 'execute phase', schema: { type: 'object' },
    plan: { roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL },
    sourceCheckpoint: { baseHead: '1'.repeat(40), requestedHead: '2'.repeat(40), roleCardDigest: 'a'.repeat(64), governanceDigest: 'b'.repeat(64), authorityRef: request().authorityRef },
  })
  assert.equal(output.result.status, 'transport-exited')
  assert.equal(output.result.phaseCompleted, undefined)
  assert.equal(calls.filter(([, operation]) => operation === 'start').length, 1)
  assert.equal(calls.filter(([, operation]) => operation === 'awaitEvent').length, 1)
})


test('a fresh isolated-unsafe parent without a separate child authorization holds before provenance or launch effects', async () => {
  const broadParent = {
    profile: 'isolated-unsafe',
    bounds: { filesystem: 'unrestricted', network: 'allowed', gitPush: true, externalWrites: true },
    provenance: { kind: 'explicit-user-authorization', source: 'parent authorization only; no child acknowledgement' },
  }
  let provenanceReads = 0
  const { calls, driver } = fixture(() => { provenanceReads++; return fresh('codex') }, { parentAuthority: broadParent })
  const held = await driver.runPhase({
    arcId: 'NATIVEGREEN', phase: 38, prompt: 'execute phase', schema: { type: 'object' },
    plan: { roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL },
    sourceCheckpoint: { baseHead: '1'.repeat(40), requestedHead: '2'.repeat(40), roleCardDigest: 'a'.repeat(64), governanceDigest: 'b'.repeat(64), authorityRef: request().authorityRef },
  })
  assert.equal(held.status, 'hold')
  assert.match(JSON.stringify(held), /explicit|authorization/i)
  assert.equal(provenanceReads, 0)
  assert.equal(calls.length, 0)
})

test('normal workspace authority still inherits into a fresh native run', async () => {
  const { calls, driver } = fixture()
  const output = await driver.runPhase({
    arcId: 'NATIVEGREEN', phase: 38, prompt: 'execute phase', schema: { type: 'object' },
    plan: { roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL },
    sourceCheckpoint: { baseHead: '1'.repeat(40), requestedHead: '2'.repeat(40), roleCardDigest: 'a'.repeat(64), governanceDigest: 'b'.repeat(64), authorityRef: request().authorityRef },
  })
  assert.equal(output.result.status, 'transport-exited')
  const started = calls.find(([, operation]) => operation === 'start')[2]
  assert.deepEqual(started.authority.effective, request().authority.effective)
})

test('recovery routes stored explicit unsafe authorization without provenance probes or relaunch', async () => {
  const broadParent = {
    profile: 'isolated-unsafe',
    bounds: { filesystem: 'unrestricted', network: 'allowed', gitPush: true, externalWrites: true },
    provenance: { kind: 'managed-host-input', source: 'unsafe parent envelope' },
  }
  const explicit = { profile: 'isolated-unsafe', bounds: { ...broadParent.bounds }, provenance: { kind: 'explicit-user-authorization', source: 'recorded child approval' } }
  const durable = request({ authority: { ...request().authority, parent: broadParent, request: explicit, effective: { profile: 'isolated-unsafe', bounds: { ...broadParent.bounds } } } })
  let provenanceReads = 0
  const { calls, driver } = fixture(() => { provenanceReads++; return fresh('codex') }, { parentAuthority: broadParent })
  const recovered = await driver.recover({ snapshot: { request: durable } }, { arcId: 'NATIVEGREEN', status: 'active' })
  assert.equal(recovered.result.status, 'transport-exited')
  assert.equal(provenanceReads, 0)
  assert.equal(calls.filter(([, operation]) => operation === 'recover').length, 1)
  assert.equal(calls.filter(([, operation]) => operation === 'start' || operation === 'resume').length, 0)
})
