#!/usr/bin/env node
/** TEST-FIRST: Codex fulfills AgentDriver through registry argv and durable receipts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { MODEL_IDS, launchArgv, resumeArgv } from './drivers.mjs'
import { CodexAgentDriver } from './codex-agent-driver.mjs'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const ROLE_BYTES = Buffer.from('---\nname: phase-executor\nmodel: sol\n---\n')
const GOVERNANCE_BYTES = Buffer.from('governance bytes\n')
const PARENT_SESSION_ID = 'session-parent-38-3'
const AUTHORITY_REF = { status: 'known', envelopeDigest: 'sha256:authority', source: { kind: 'managed-host-receipt', ref: 'run-38-3' } }

function request(overrides = {}) {
  return {
    runId: 'run-38-3', executorId: 'executor-38', arcId: 'NATIVEGREEN', phase: 38,
    roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL,
    worktree: '/tmp/codex-driver-38', baseHead: '1'.repeat(40), requestedHead: '2'.repeat(40),
    roleCardDigest: hash(ROLE_BYTES), governanceDigest: hash(GOVERNANCE_BYTES),
    authority: {
      parent: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'supervisor' } },
      request: { profile: 'inherit', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: null },
      effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false } },
      native: { driver: 'codex', runtime: { version: null, verified: false }, argv: ['exec'], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['exact runtime unverified'] },
    },
    authorityRef: AUTHORITY_REF,
    ...overrides,
  }
}

function fixture({ nativeSessionId = '0199aabb-ccdd-7000-8000-112233445566', bound = false, duplicatePending = false } = {}) {
  const calls = []
  let revision = 0
  const runRequest = request()
  const receipt = (patch = {}) => ({
    path: `/tmp/receipt-${revision}.json`, digest: String(revision).padStart(64, 'a'),
    snapshot: { request: runRequest, requestFingerprint: hash(JSON.stringify(runRequest)), revision, pendingOperation: { kind: 'start', actionFingerprint: hash('start') }, nativeSessionId: null, latestObservation: null, terminalResult: null, outcome: 'pending', ...patch },
  })
  if (bound) revision = 1
  let current = receipt(bound ? { nativeSessionId, outcome: 'active' } : {})
  const receiptStore = {
    persistRunRequest(cwd, actual, opts) { calls.push(['persistRunRequest', cwd, structuredClone(actual), opts]); return { status: duplicatePending ? 'duplicate' : 'recorded', receipt: current } },
    bindNativeSession(cwd, input) { calls.push(['bindNativeSession', cwd, structuredClone(input)]); revision++; current = receipt({ nativeSessionId }); return { status: 'recorded', receipt: current } },
    persistRunObservation() { throw new Error('terminal completion must be atomic') },
    persistRunResult(cwd, input) { calls.push(['persistRunResult', cwd, structuredClone(input)]); revision++; current = receipt({ nativeSessionId, latestObservation: input.observation, terminalResult: input.result, outcome: 'complete', pendingOperation: null }); return { status: 'recorded', receipt: current } },
    reconcileRunReceipt() { calls.push(['reconcileRunReceipt']); return { status: 'resume', operation: 'awaitEvent', receipt: current } },
  }
  const ownershipStore = {
    claimExecutorRun(worktree, phase, binding) { calls.push(['claimExecutorRun', worktree, phase, structuredClone(binding)]); return { status: 'recorded', arm: { sessionId: binding.sessionId, executorId: binding.executorId } } },
  }
  const processTransport = {
    async probe() { return { reachable: true } },
    async execute(input) {
      calls.push(['execute', structuredClone(input)])
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: 'thread.started', thread_id: nativeSessionId }),
          JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3 } }),
        ].join('\n') + '\n',
        stderr: '',
      }
    },
  }
  const readLaunchInputs = (actual) => {
    calls.push(['readLaunchInputs', structuredClone(actual)])
    return { roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES, prompt: 'execute phase 38.3' }
  }
  return { calls, runRequest, receiptStore, ownershipStore, processTransport, readLaunchInputs, nativeSessionId }
}

test('fresh Codex run persists exact source and authority before launch, then binds native JSON identity once', async () => {
  const fx = fixture()
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const handle = await driver.start(fx.runRequest)
  assert.equal(handle.request.runId, fx.runRequest.runId)
  assert.equal(handle.nativeSessionId, fx.nativeSessionId)
  assert.deepEqual(fx.calls.map(([name]) => name).slice(0, 4), ['readLaunchInputs', 'persistRunRequest', 'claimExecutorRun', 'execute'])
  const persisted = fx.calls.find(([name]) => name === 'persistRunRequest')
  assert.deepEqual(persisted[2], fx.runRequest)
  assert.deepEqual(persisted[3].roleCardBytes, ROLE_BYTES)
  assert.deepEqual(persisted[3].governanceBytes, GOVERNANCE_BYTES)
  const launched = fx.calls.find(([name]) => name === 'execute')[1]
  assert.equal(launched.bin, 'codex')
  assert.deepEqual(launched.argv, launchArgv('codex', { worktree: fx.runRequest.worktree, authority: fx.runRequest.authority, json: true }))
  assert.equal(launched.stdin, 'execute phase 38.3')
})

test('resume addresses the recorded native session and never launches start/latest/last', async () => {
  const fx = fixture({ bound: true })
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const handle = { request: fx.runRequest, nativeSessionId: fx.nativeSessionId }
  const resumed = await driver.resume(handle)
  assert.deepEqual(resumed, handle)
  const executions = fx.calls.filter(([name]) => name === 'execute')
  assert.equal(executions.length, 1)
  assert.deepEqual(executions[0][1].argv, resumeArgv('codex', fx.nativeSessionId, { worktree: fx.runRequest.worktree, authority: fx.runRequest.authority, json: true }))
  assert.equal(executions[0][1].argv.includes('--last'), false)
  assert.equal(executions[0][1].argv.includes('--latest'), false)
  assert.equal(executions[0][1].stdin, 'execute phase 38.3')
  assert.equal(fx.calls.filter(([name]) => name === 'persistRunRequest').length, 1)
  const pending = fx.calls.find(([name]) => name === 'persistRunRequest')
  assert.deepEqual(pending[3].operation, { kind: 'action', action: 'resume', payload: { nativeSessionId: fx.nativeSessionId }, inputDigest: hash('execute phase 38.3'), expectedRevisionDigest: pending[3].operation.expectedRevisionDigest })
})

test('fresh and resumed native JSON retain one runId and persist one terminal result', async () => {
  for (const mode of ['fresh', 'resume']) {
    const fx = fixture({ bound: mode === 'resume' })
    const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
    const handle = mode === 'fresh' ? await driver.start(fx.runRequest) : await driver.resume({ request: fx.runRequest, nativeSessionId: fx.nativeSessionId })
    const result = await driver.awaitEvent(handle, { arcId: 'NATIVEGREEN', stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: AUTHORITY_REF })
    assert.equal(result.handle.request.runId, 'run-38-3', mode)
    assert.equal(result.handle.nativeSessionId, fx.nativeSessionId, mode)
    assert.equal(fx.calls.filter(([name]) => name === 'persistRunResult').length, 1, mode)
    const terminal = fx.calls.find(([name]) => name === 'persistRunResult')[2]
    assert.equal(terminal.observation.observation.event.type, 'exited', mode)
    assert.equal(terminal.observation.transition.next.status, 'halted', mode)
    assert.equal(terminal.result.status, 'transport-exited', mode)
    assert.equal(terminal.result.nativeSessionId, fx.nativeSessionId, mode)
    assert.equal(fx.calls.filter(([name]) => name === 'persistRunObservation').length, 0, mode)
    assert.equal(fx.calls.filter(([name]) => name === 'bindNativeSession').length, mode === 'fresh' ? 1 : 0, mode)
    assert.equal(fx.calls.filter(([name]) => name === 'persistRunRequest').length, 1, mode)
  }
})

test('a duplicate pending start holds unknown native outcome without executing Codex again', async () => {
  const fx = fixture({ duplicatePending: true })
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const held = await driver.start(fx.runRequest)
  assert.equal(held.status, 'hold')
  assert.equal(held.kind, 'unknown-native-outcome')
  assert.ok(held.reason.length > 0)
  assert.equal(fx.calls.filter(([name]) => name === 'execute').length, 0)
  assert.equal(fx.calls.filter(([name]) => name === 'bindNativeSession').length, 0)
})

test('resume refuses a handle whose native identity conflicts with its durable receipt', async () => {
  const fx = fixture({ bound: true })
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const refusal = await driver.resume({ request: fx.runRequest, nativeSessionId: '0199ffff-ffff-7000-8000-ffffffffffff' })
  assert.ok(['hold', 'conflict'].includes(refusal.status))
  assert.equal(refusal.kind, 'identity-conflict')
  assert.ok(refusal.reason.length > 0)
  assert.equal(fx.calls.filter(([name]) => name === 'execute').length, 0)
})

test('unsupported collaboration messaging is a typed refusal with no process or fallback start', async () => {
  const fx = fixture()
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const refusal = await driver.performAction({ request: fx.runRequest, nativeSessionId: fx.nativeSessionId }, { action: 'message', payload: { text: 'hello' } })
  assert.equal(refusal.kind, 'capability-refusal')
  assert.equal(refusal.driverId, 'codex')
  assert.equal(refusal.operation, 'performAction')
  assert.equal(refusal.action, 'message')
  assert.ok(refusal.reason.length > 0)
  assert.equal(fx.calls.filter(([name]) => name === 'execute').length, 0)
  assert.equal(fx.calls.filter(([name]) => name === 'persistRunRequest').length, 0)
})

test('malformed or changing native thread identity fails before durable binding/result', async () => {
  for (const stdout of [
    JSON.stringify({ type: 'turn.completed' }) + '\n',
    JSON.stringify({ type: 'thread.started', thread_id: 'first' }) + '\n' + JSON.stringify({ type: 'thread.started', thread_id: 'second' }) + '\n',
  ]) {
    const fx = fixture()
    fx.processTransport.execute = async (input) => { fx.calls.push(['execute', structuredClone(input)]); return { exitCode: 0, stdout, stderr: '' } }
    const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
    await assert.rejects(() => driver.start(fx.runRequest), /thread|session|identity|json/i)
    assert.equal(fx.calls.filter(([name]) => name === 'bindNativeSession').length, 0)
    assert.equal(fx.calls.filter(([name]) => name === 'persistRunResult').length, 0)
  }
})

test('a model outside the Codex registry pin refuses before durable or process effects', async () => {
  const fx = fixture()
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  await assert.rejects(() => driver.start({ ...fx.runRequest, model: 'gpt-forged' }), /model|registry|pin/i)
  assert.deepEqual(fx.calls, [])
})

test('caller authority mismatch refuses before reading source, persisting, or launching Codex', async () => {
  const fx = fixture()
  const forged = request({
    authority: {
      ...fx.runRequest.authority,
      effective: { ...fx.runRequest.authority.effective, bounds: { ...fx.runRequest.authority.effective.bounds, network: 'allowed' } },
    },
  })
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  await assert.rejects(() => driver.start(forged), /authority|effective|network|intersection/i)
  assert.deepEqual(fx.calls, [])
})

test('fresh Codex transport composes with real receipt and ownership stores through atomic terminal persistence', async (t) => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const receiptStore = await import('./run-receipt.mjs')
  const ownershipStore = await import('./executor-arm.mjs')
  const root = mkdtempSync(join(tmpdir(), 'codex-adapter-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'seed'], { cwd: root })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const runRequest = request({ worktree: root, baseHead: head, requestedHead: head, runId: 'run-real-38-3' })
  const transport = {
    async execute() {
      return { exitCode: 0, signal: null, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: 'native-real-38-3' })}\n${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })}\n`, stderr: '' }
    },
  }
  const driver = new CodexAgentDriver({
    processTransport: transport,
    readLaunchInputs: () => ({ roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES, prompt: 'execute phase 38.3' }),
    receiptStore, ownershipStore, sessionId: PARENT_SESSION_ID,
  })
  const handle = await driver.start(runRequest)
  const completed = await driver.awaitEvent(handle, { arcId: 'NATIVEGREEN', stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: AUTHORITY_REF })
  assert.equal(completed.observation.event.type, 'exited')
  assert.equal(completed.transition.next.status, 'halted')
  assert.equal(completed.result.status, 'transport-exited')
  const stored = JSON.parse(readFileSync(completed.receipt.path, 'utf8'))
  assert.equal(stored.nativeSessionId, 'native-real-38-3')
  assert.equal(stored.latestObservation.observation.event.type, 'exited')
  assert.equal(stored.terminalResult.status, 'transport-exited')
})

test('resume of an exact handle with buffered completion does not execute a second native turn', async () => {
  const fx = fixture()
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const handle = await driver.start(fx.runRequest)
  assert.equal(fx.calls.filter(([name]) => name === 'execute').length, 1)
  assert.deepEqual(await driver.resume(handle), handle)
  assert.equal(fx.calls.filter(([name]) => name === 'execute').length, 1)
  await driver.awaitEvent(handle, { arcId: fx.runRequest.arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: AUTHORITY_REF })
  assert.equal(fx.calls.filter(([name]) => name === 'persistRunResult').length, 1)
})

test('the same runId in two arcs retains two separately addressed buffered completions', async () => {
  const calls = []
  const receipts = new Map()
  const key = ({ arcId, runId }) => `${arcId}\0${runId}`
  const makeReceipt = (req, nativeSessionId = null, revision = 0) => ({
    path: `/tmp/${req.arcId}-${revision}.json`, digest: hash(`${req.arcId}:${revision}`),
    snapshot: { request: structuredClone(req), requestFingerprint: hash(JSON.stringify(req)), revision, pendingOperation: revision ? null : { kind: 'start', actionFingerprint: hash(`start:${req.arcId}`) }, nativeSessionId, latestObservation: null, terminalResult: null, outcome: revision ? 'active' : 'pending' },
  })
  const receiptStore = {
    persistRunRequest(cwd, req) { const receipt = makeReceipt(req); receipts.set(key(req), receipt); return { status: 'recorded', receipt } },
    bindNativeSession(cwd, input) { const prior = receipts.get(key(input)); const receipt = makeReceipt(prior.snapshot.request, input.nativeSessionId, 1); receipts.set(key(input), receipt); return { status: 'recorded', receipt } },
    persistRunObservation() { throw new Error('terminal completion must be atomic') },
    persistRunResult(cwd, input) { const prior = receipts.get(key(input)); const receipt = makeReceipt(prior.snapshot.request, prior.snapshot.nativeSessionId, 2); receipt.snapshot.latestObservation = input.observation; receipt.snapshot.terminalResult = input.result; receipt.snapshot.outcome = 'complete'; receipts.set(key(input), receipt); calls.push(['result', input.arcId, input.observation.handle.nativeSessionId]); return { status: 'recorded', receipt } },
    reconcileRunReceipt(cwd, input) { return { status: 'active', operation: 'awaitEvent', receipt: receipts.get(key(input)) } },
  }
  let launch = 0
  const processTransport = { async execute() { launch++; const id = `native-arc-${launch}`; return { exitCode: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: id })}\n${JSON.stringify({ type: 'turn.completed' })}\n`, stderr: '' } } }
  const ownershipStore = { claimExecutorRun() { return { status: 'recorded' } } }
  const driver = new CodexAgentDriver({ processTransport, readLaunchInputs: () => ({ roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES, prompt: 'run' }), receiptStore, ownershipStore, sessionId: PARENT_SESSION_ID })
  const leftRequest = request({ arcId: 'ARC-LEFT' })
  const rightRequest = request({ arcId: 'ARC-RIGHT' })
  const left = await driver.start(leftRequest)
  const right = await driver.start(rightRequest)
  assert.notEqual(left.nativeSessionId, right.nativeSessionId)
  for (const handle of [left, right]) await driver.awaitEvent(handle, { arcId: handle.request.arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: AUTHORITY_REF })
  assert.deepEqual(calls, [['result', 'ARC-LEFT', left.nativeSessionId], ['result', 'ARC-RIGHT', right.nativeSessionId]])
  assert.equal(launch, 2)
})


function detachedCompletionFixture({ usage = { input_tokens: 13, cached_input_tokens: 5, output_tokens: 8 }, terminalType = 'turn.completed', terminalSubtype, terminalError, phaseStatus = 'done' } = {}) {
  const fx = fixture({ bound: true })
  const pendingReceipt = {
    path: '/tmp/detached-pending-receipt.json',
    digest: hash('detached-pending-receipt'),
    snapshot: {
      request: structuredClone(fx.runRequest),
      requestFingerprint: hash(JSON.stringify(fx.runRequest)),
      revision: 4,
      pendingOperation: { kind: 'start', inputDigest: hash('execute phase 38.3'), actionFingerprint: hash('detached-start') },
      nativeSessionId: fx.nativeSessionId,
      latestObservation: null,
      terminalResult: null,
      outcome: 'active',
    },
  }
  const completion = {
    version: 1,
    arcId: fx.runRequest.arcId,
    runId: fx.runRequest.runId,
    pendingReceiptDigest: pendingReceipt.digest,
    actionFingerprint: pendingReceipt.snapshot.pendingOperation.actionFingerprint,
    nativeSessionId: fx.nativeSessionId,
    phaseResult: { status: phaseStatus },
    protocolTerminal: {
      type: terminalType,
      ...(terminalSubtype === undefined ? {} : { subtype: terminalSubtype }),
      ...(terminalError === undefined ? {} : { is_error: terminalError }),
      ...(usage === null ? {} : { usage: structuredClone(usage) }),
    },
    exitCode: terminalType === 'turn.completed' ? 0 : 1,
    signal: null,
    stdoutBytes: 120,
    stderrBytes: terminalType === 'turn.completed' ? 0 : 40,
    stdoutDigest: hash('detached stdout'),
    stderrDigest: hash('detached stderr'),
  }
  fx.receiptStore.readRunReceipt = () => structuredClone(pendingReceipt)
  fx.receiptStore.persistRunResult = (cwd, input) => {
    fx.calls.push(['persistRunResult', cwd, structuredClone(input)])
    return {
      status: 'recorded',
      receipt: {
        ...structuredClone(pendingReceipt),
        digest: hash('detached terminal receipt'),
        snapshot: { ...structuredClone(pendingReceipt.snapshot), revision: 5, pendingOperation: null, latestObservation: input.observation, terminalResult: input.result, outcome: 'complete' },
      },
    }
  }
  fx.processTransport = {
    async launch(input) {
      fx.calls.push(['launch', structuredClone(input)])
      return { status: 'running', operationRef: { cwd: fx.runRequest.worktree, arcId: fx.runRequest.arcId, runId: fx.runRequest.runId, pendingReceiptDigest: pendingReceipt.digest } }
    },
    async observe(ref) {
      fx.calls.push(['observe', structuredClone(ref)])
      return { status: 'complete', completion: structuredClone(completion) }
    },
  }
  return { ...fx, pendingReceipt, completion }
}

const activeState = (arcId = 'NATIVEGREEN') => ({ arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: AUTHORITY_REF })

test('detached fresh completion preserves raw usage and all protocol evidence in the durable run result', async () => {
  const fx = detachedCompletionFixture()
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const handle = await driver.start(fx.runRequest)
  const completed = await driver.awaitEvent(handle, activeState())

  assert.deepEqual(completed.result.usage, fx.completion.protocolTerminal.usage)
  assert.deepEqual(completed.result.protocolTerminal, fx.completion.protocolTerminal)
  assert.equal(completed.result.stdoutDigest, fx.completion.stdoutDigest)
  assert.equal(completed.result.stderrDigest, fx.completion.stderrDigest)
  assert.equal(Object.hasOwn(completed.result, 'observedModelId'), false)
  assert.equal(completed.result.model, undefined)
})

test('receipt recovery preserves the same raw detached completion usage and protocol evidence', async () => {
  const fx = detachedCompletionFixture()
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const recovered = await driver.recover(fx.pendingReceipt, activeState())

  assert.deepEqual(recovered.result.usage, fx.completion.protocolTerminal.usage)
  assert.deepEqual(recovered.result.protocolTerminal, fx.completion.protocolTerminal)
  assert.equal(recovered.result.nativeSessionId, fx.nativeSessionId)
  assert.equal(Object.hasOwn(recovered.result, 'observedModelId'), false)
  assert.equal(fx.calls.filter(([name]) => name === 'launch').length, 0)
  assert.equal(fx.calls.filter(([name]) => name === 'persistRunResult').length, 1)
})

test('absent usage stays null and a failed protocol terminal cannot become a passing phase result or observed model identity', async () => {
  const fx = detachedCompletionFixture({ usage: null, terminalType: 'turn.failed', terminalError: true, phaseStatus: 'transport-exited' })
  const driver = new CodexAgentDriver({ processTransport: fx.processTransport, readLaunchInputs: fx.readLaunchInputs, receiptStore: fx.receiptStore, ownershipStore: fx.ownershipStore, sessionId: PARENT_SESSION_ID })
  const handle = await driver.start(fx.runRequest)
  const completed = await driver.awaitEvent(handle, activeState())

  assert.equal(completed.result.usage, null)
  assert.deepEqual(completed.result.protocolTerminal, { type: 'turn.failed', is_error: true })
  assert.notEqual(completed.result.phaseResult.status, 'done')
  assert.equal(Object.hasOwn(completed.result, 'observedModelId'), false)
  assert.equal(completed.result.model, undefined)
})
