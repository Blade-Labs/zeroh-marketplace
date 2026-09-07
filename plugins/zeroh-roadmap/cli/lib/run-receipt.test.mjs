#!/usr/bin/env node
/**
 * TEST-FIRST for durable native-run receipts. RED means a restart can replay an
 * externally uncertain start/action/result, or mismatched evidence can rewrite
 * the trusted run chain.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODEL_IDS } from './drivers.mjs'
import { armPath, claimExecutorRun } from './executor-arm.mjs'
import { appendExecutorEvent } from './beacon.mjs'
import { reduceArcTransition } from './workflow-steps.mjs'
import {
  persistRunRequest,
  bindNativeSession,
  persistRunObservation,
  persistRunResult,
  reconcileRunReceipt,
} from './run-receipt.mjs'

const MOD = fileURLToPath(new URL('./run-receipt.mjs', import.meta.url))
const tmps = []
process.on('exit', () => tmps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'run-receipt-'))
  tmps.push(root)
  execFileSync('git', ['init', '-q', '-b', 'develop'], { cwd: root })
  writeFileSync(join(root, 'seed'), 'seed\n')
  execFileSync('git', ['add', 'seed'], { cwd: root })
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'seed'], { cwd: root })
  return root
}

const ROLE_BYTES = Buffer.from('---\nname: phase-executor\nmodel: sol\n---\n')
const GOVERNANCE_BYTES = Buffer.from('ROOT GOVERNANCE\n')
const AUTHORITY_REF = { status: 'known', envelopeDigest: 'sha256:authority', source: { kind: 'managed-host-receipt', ref: 'receipt-38-2' } }
const ACTION = digest('start:run-38-2')

function request(overrides = {}) {
  return {
    runId: 'run-38-2', executorId: 'executor-38', arcId: 'NATIVEGREEN', phase: 38,
    roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL,
    worktree: '/tmp/replaced-per-test', baseHead: '1'.repeat(40), requestedHead: '2'.repeat(40),
    roleCardDigest: digest(ROLE_BYTES), governanceDigest: digest(GOVERNANCE_BYTES),
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

function recordRequest(root, overrides = {}) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const runRequest = request({ worktree: root, baseHead: head, requestedHead: head, ...overrides })
  return persistRunRequest(root, runRequest, {
    operation: { kind: 'start' },
    roleCardBytes: ROLE_BYTES,
    governanceBytes: GOVERNANCE_BYTES,
  })
}

function observationFor(runRequest, nativeSessionId = 'native-session-38') {
  const state = { arcId: runRequest.arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: runRequest.authorityRef }
  const event = { eventId: 'event-38-2', arcId: runRequest.arcId, source: 'native-agent', type: 'run-phase', phase: runRequest.phase, authorityRef: runRequest.authorityRef }
  return {
    handle: { request: runRequest, nativeSessionId },
    observation: { runId: runRequest.runId, executorId: runRequest.executorId, roleId: runRequest.roleId, driverId: runRequest.driverId, model: runRequest.model, nativeSessionId, event },
    transition: reduceArcTransition(state, event),
  }
}

test('request publication is immutable, digest-bound, and idempotent', () => {
  const root = repo()
  const first = recordRequest(root)
  assert.equal(first.status, 'recorded')
  assert.equal(first.receipt.snapshot.revision, 0)
  assert.equal(first.receipt.snapshot.previousDigest, null)
  assert.equal(first.receipt.snapshot.outcome, 'pending')
  assert.equal(first.receipt.snapshot.pendingOperation.kind, 'start')
  assert.match(first.receipt.snapshot.pendingOperation.actionFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(first.receipt.snapshot.nativeSessionId, null)
  assert.deepEqual(first.receipt.snapshot.latestObservation, null)
  assert.equal(first.receipt.snapshot.terminalResult, null)
  assert.equal(readFileSync(first.receipt.path, 'utf8').endsWith('\n'), true)

  const before = readFileSync(first.receipt.path)
  const duplicate = recordRequest(root)
  assert.equal(duplicate.status, 'duplicate')
  assert.equal(duplicate.receipt.digest, first.receipt.digest)
  assert.deepEqual(readFileSync(first.receipt.path), before)
})

test('wrong raw card/governance bytes refuse before publishing any receipt', () => {
  for (const [field, bytes] of [['roleCardBytes', Buffer.from('other card')], ['governanceBytes', Buffer.from('other governance')]]) {
    const root = repo()
    const opts = { operation: { kind: 'start' }, roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES, [field]: bytes }
    assert.throws(() => persistRunRequest(root, request({ worktree: root }), opts), new RegExp(field.replace('Bytes', ''), 'i'))
    assert.equal(readdirSync(root).includes('roadmap'), false, `${field}: mismatch publishes no receipt home`)
  }
})


test('request, native identity, observation, and result boundaries resume once and deduplicate', () => {
  const root = repo()
  const initial = recordRequest(root)
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const unknown = reconcileRunReceipt(root, { ...address, evidence: {} })
  assert.equal(unknown.status, 'hold')
  assert.ok(['unknown-native-outcome', 'identity-conflict'].includes(unknown.kind), JSON.stringify(unknown))

  const boundInput = { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' }
  const bound = bindNativeSession(root, boundInput)
  assert.equal(bound.status, 'recorded')
  assert.equal(bound.receipt.snapshot.revision, 1)
  assert.equal(bindNativeSession(root, boundInput).status, 'duplicate')

  const observationInput = { ...address, expectedRevisionDigest: bound.receipt.digest, observation: observationFor(bound.receipt.snapshot.request) }
  const observed = persistRunObservation(root, observationInput)
  assert.equal(observed.status, 'recorded')
  assert.equal(observed.receipt.snapshot.latestObservation.observation.event.eventId, 'event-38-2')
  assert.equal(persistRunObservation(root, observationInput).status, 'duplicate')

  const result = { status: 'done', phase: 38, resultDigest: digest('terminal-result') }
  const resultInput = { ...address, expectedRevisionDigest: observed.receipt.digest, result }
  const completed = persistRunResult(root, resultInput)
  assert.equal(completed.status, 'recorded')
  assert.equal(completed.receipt.snapshot.outcome, 'complete')
  assert.deepEqual(completed.receipt.snapshot.terminalResult, result)
  assert.equal(persistRunResult(root, resultInput).status, 'duplicate')
  const final = reconcileRunReceipt(root, { ...address, evidence: {} })
  assert.equal(final.status, 'complete')
  assert.deepEqual(final.result, result)
})

test('out-of-order or mismatched evidence returns typed conflict and preserves every published byte', () => {
  const root = repo()
  const initial = recordRequest(root)
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const initialBytes = readFileSync(initial.receipt.path)
  const cases = [
    () => persistRunObservation(root, { ...address, expectedRevisionDigest: initial.receipt.digest, observation: observationFor(initial.receipt.snapshot.request) }),
    () => persistRunResult(root, { ...address, expectedRevisionDigest: initial.receipt.digest, result: { status: 'done' } }),
    () => bindNativeSession(root, { arcId: 'NATIVEGREEN', runId: 'other-run', expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' }),
    () => bindNativeSession(root, { ...address, expectedRevisionDigest: '0'.repeat(64), nativeSessionId: 'native-session-38' }),
  ]
  for (const attempt of cases) {
    const refusal = attempt()
    assert.ok(['conflict', 'hold'].includes(refusal.status), JSON.stringify(refusal))
    assert.equal(typeof refusal.reason, 'string')
    assert.ok(refusal.reason.length > 0)
    assert.deepEqual(readFileSync(initial.receipt.path), initialBytes)
  }
})

test('claimExecutorRun binds the canonical pre-start receipt once and preserves conflicts byte-intact', () => {
  const root = repo()
  const initial = recordRequest(root)
  const binding = { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt }
  const first = claimExecutorRun(root, 38, binding)
  assert.equal(first.status, 'recorded')
  const stored = JSON.parse(readFileSync(first.path, 'utf8'))
  assert.deepEqual({ sessionId: stored.sessionId, executorId: stored.executorId, runId: stored.runId, requestFingerprint: stored.requestFingerprint }, {
    sessionId: 'session-38', executorId: 'executor-38', runId: 'run-38-2', requestFingerprint: initial.receipt.snapshot.requestFingerprint,
  })
  assert.ok(!Number.isNaN(Date.parse(stored.armedAt)))
  const before = readFileSync(first.path)
  assert.equal(claimExecutorRun(root, 38, binding).status, 'duplicate')
  const conflict = claimExecutorRun(root, 38, { ...binding, executorId: 'other-executor' })
  assert.equal(conflict.status, 'conflict')
  assert.deepEqual(readFileSync(first.path), before)
})

test('two processes binding different native identities have one CAS winner and one conflict', async () => {
  const root = repo()
  const initial = recordRequest(root)
  const program = `
    const m = await import(process.argv[1])
    const out = m.bindNativeSession(process.argv[2], JSON.parse(process.argv[3]))
    process.stdout.write(JSON.stringify(out))
  `
  const run = (nativeSessionId) => new Promise((resolve, reject) => {
    const input = { arcId: 'NATIVEGREEN', runId: 'run-38-2', expectedRevisionDigest: initial.receipt.digest, nativeSessionId }
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, MOD, root, JSON.stringify(input)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)))
  })
  const outcomes = await Promise.all([run('native-left'), run('native-right')])
  assert.deepEqual(outcomes.map((x) => x.status).sort(), ['conflict', 'recorded'])
  assert.equal(outcomes.find((x) => x.status === 'recorded').receipt.snapshot.revision, 1)
})

function advanceToObserved(root) {
  const initial = recordRequest(root)
  claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
  const observed = persistRunObservation(root, { ...address, expectedRevisionDigest: bound.receipt.digest, observation: observationFor(bound.receipt.snapshot.request) })
  return { address, initial, bound, observed }
}

test('an action is durably published before execution and unknown outcome never authorizes replay', () => {
  const root = repo()
  const { address, observed } = advanceToObserved(root)
  const action = { kind: 'action', action: 'message', payload: { text: 'continue task 38.2' }, expectedRevisionDigest: observed.receipt.digest }
  const pending = persistRunRequest(root, observed.receipt.snapshot.request, { operation: action, roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES })
  assert.equal(pending.status, 'recorded')
  assert.equal(pending.receipt.snapshot.outcome, 'pending')
  assert.equal(pending.receipt.snapshot.pendingOperation.kind, 'action')
  assert.equal(pending.receipt.snapshot.pendingOperation.action, 'message')
  assert.deepEqual(pending.receipt.snapshot.pendingOperation.payload, action.payload)
  assert.match(pending.receipt.snapshot.pendingOperation.actionFingerprint, /^[a-f0-9]{64}$/)

  const uncertain = reconcileRunReceipt(root, { ...address, evidence: {} })
  assert.equal(uncertain.status, 'hold')
  assert.equal(uncertain.kind, 'unknown-native-outcome')
  const second = persistRunRequest(root, observed.receipt.snapshot.request, {
    operation: { ...action, expectedRevisionDigest: pending.receipt.digest, payload: { text: 'replay' } },
    roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES,
  })
  assert.ok(['conflict', 'hold'].includes(second.status), JSON.stringify(second))
})

test('a conflicting terminal result is refused and the winning terminal revision stays byte-intact', () => {
  const root = repo()
  const { address, observed } = advanceToObserved(root)
  const firstResult = { status: 'done', phase: 38, resultDigest: digest('winner') }
  const completed = persistRunResult(root, { ...address, expectedRevisionDigest: observed.receipt.digest, result: firstResult })
  const before = readFileSync(completed.receipt.path)
  const conflict = persistRunResult(root, { ...address, expectedRevisionDigest: observed.receipt.digest, result: { ...firstResult, resultDigest: digest('loser') } })
  assert.equal(conflict.status, 'conflict')
  assert.deepEqual(readFileSync(completed.receipt.path), before)
  assert.deepEqual(reconcileRunReceipt(root, { ...address, evidence: {} }).result, firstResult)
})

test('stable request identity conflicts never rewrite the initial receipt', () => {
  const fields = [
    ['executorId', 'other-executor'], ['worktree', '/tmp/other-worktree'],
    ['baseHead', '3'.repeat(40)], ['requestedHead', '4'.repeat(40)],
    ['authorityRef', { status: 'known', envelopeDigest: 'sha256:other', source: { kind: 'managed-host-receipt', ref: 'other' } }],
  ]
  for (const [field, value] of fields) {
    const root = repo()
    const initial = recordRequest(root)
    const before = readFileSync(initial.receipt.path)
    const conflict = persistRunRequest(root, { ...initial.receipt.snapshot.request, [field]: value }, {
      operation: { kind: 'start' }, roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES,
    })
    assert.ok(['conflict', 'hold'].includes(conflict.status), `${field}: ${JSON.stringify(conflict)}`)
    assert.deepEqual(readFileSync(initial.receipt.path), before, field)
  }
})

test('corrupt, gapped, or symlinked receipt chains fail closed without changing trusted bytes', () => {
  for (const mode of ['corrupt', 'gap', 'symlink']) {
    const root = repo()
    const initial = recordRequest(root)
    const before = readFileSync(initial.receipt.path)
    const chainDir = dirname(initial.receipt.path)
    if (mode === 'corrupt') writeFileSync(join(chainDir, '000001.json'), '{broken\n')
    if (mode === 'gap') writeFileSync(join(chainDir, '000002.json'), JSON.stringify({ ...initial.receipt.snapshot, revision: 2, previousDigest: initial.receipt.digest }) + '\n')
    if (mode === 'symlink') {
      const outside = join(root, 'outside-receipt')
      writeFileSync(outside, 'outside\n')
      symlinkSync(outside, join(chainDir, '000001.json'))
    }
    assert.throws(() => reconcileRunReceipt(root, { arcId: 'NATIVEGREEN', runId: 'run-38-2', evidence: {} }), /corrupt|malformed|gap|symlink|unsafe|chain/i, mode)
    assert.deepEqual(readFileSync(initial.receipt.path), before, mode)
  }
})

test('disk reconciliation accepts a stale beacon bound to its exact historical receipt revision', () => {
  const root = repo()
  const initial = recordRequest(root)
  claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
  const observed = persistRunObservation(root, { ...address, expectedRevisionDigest: bound.receipt.digest, observation: observationFor(bound.receipt.snapshot.request) })
  appendExecutorEvent(root, 38, 'task-start', {
    runId: 'run-38-2', executorId: 'executor-38', nativeSessionId: 'native-session-38',
    actionFingerprint: bound.receipt.snapshot.pendingOperation.actionFingerprint,
    requestFingerprint: bound.receipt.snapshot.requestFingerprint,
    runReceiptDigest: bound.receipt.digest,
  })

  const reconciled = reconcileRunReceipt(root, { ...address, evidence: {} })
  assert.equal(reconciled.status, 'resume')
  assert.equal(reconciled.operation, 'awaitEvent')
  assert.equal(reconciled.receipt.digest, observed.receipt.digest, 'historical beacon does not roll back the latest receipt')
})

test('disk reconciliation holds wrong beacon identity or unknown receipt revision without mutation', () => {
  for (const [field, value] of [
    ['runId', 'other-run'], ['executorId', 'other-executor'],
    ['requestFingerprint', 'f'.repeat(64)], ['runReceiptDigest', 'e'.repeat(64)],
  ]) {
    const root = repo()
    const initial = recordRequest(root)
    claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
    const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
    const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
    const before = readFileSync(bound.receipt.path)
    const identity = {
      runId: 'run-38-2', executorId: 'executor-38', nativeSessionId: 'native-session-38',
      actionFingerprint: bound.receipt.snapshot.pendingOperation.actionFingerprint,
      requestFingerprint: bound.receipt.snapshot.requestFingerprint,
      runReceiptDigest: bound.receipt.digest,
      [field]: value,
    }
    appendExecutorEvent(root, 38, 'task-start', identity)
    const held = reconcileRunReceipt(root, { ...address, evidence: {} })
    assert.equal(held.status, 'hold', `${field}: ${JSON.stringify(held)}`)
    assert.equal(typeof held.reason, 'string')
    assert.deepEqual(readFileSync(bound.receipt.path), before, field)
  }
})

test('two processes claiming one executor arm have one first publisher and one preserved conflict', async () => {
  const root = repo()
  const left = recordRequest(root, { runId: 'run-left', executorId: 'executor-left' })
  const right = recordRequest(root, { runId: 'run-right', executorId: 'executor-right' })
  const armModule = fileURLToPath(new URL('./executor-arm.mjs', import.meta.url))
  const program = `
    const m = await import(process.argv[1])
    process.stdout.write(JSON.stringify(m.claimExecutorRun(process.argv[2], 38, JSON.parse(process.argv[3]))))
  `
  const run = (executorId, runReceipt) => new Promise((resolve, reject) => {
    const binding = { sessionId: 'session-38', executorId, runReceipt }
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, armModule, root, JSON.stringify(binding)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('close', (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)))
  })
  const outcomes = await Promise.all([run('executor-left', left.receipt), run('executor-right', right.receipt)])
  assert.deepEqual(outcomes.map((x) => x.status).sort(), ['conflict', 'recorded'])
  const winner = outcomes.find((x) => x.status === 'recorded')
  assert.deepEqual(readFileSync(armPath(root, 38)), readFileSync(winner.path))
})

test('claimExecutorRun preserves a legacy partial incumbent and holds the native path', () => {
  const root = repo()
  const initial = recordRequest(root)
  mkdirSync(dirname(armPath(root, 38)), { recursive: true })
  writeFileSync(armPath(root, 38), JSON.stringify({ sessionId: 'legacy-session', executorId: 'legacy-executor', armedAt: new Date().toISOString() }) + '\n')
  const before = readFileSync(armPath(root, 38))
  const held = claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  assert.ok(['hold', 'conflict'].includes(held.status), JSON.stringify(held))
  assert.match(held.reason, /legacy|partial|runId|requestFingerprint|identity/i)
  assert.deepEqual(readFileSync(armPath(root, 38)), before)
})

test('only an exact synchronous action acknowledgement clears the durable pending action', () => {
  for (const exact of [true, false]) {
    const root = repo()
    const { address, observed } = advanceToObserved(root)
    const operation = { kind: 'action', action: 'message', payload: { text: 'continue' }, expectedRevisionDigest: observed.receipt.digest }
    const pending = persistRunRequest(root, observed.receipt.snapshot.request, { operation, roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES })
    const prior = observed.receipt.snapshot.latestObservation.transition.next
    const event = { eventId: exact ? 'action-ack-exact' : 'action-ack-wrong', arcId: address.arcId, source: 'native-agent', type: 'run-phase', phase: 38, authorityRef: pending.receipt.snapshot.request.authorityRef }
    const nextObservation = {
      handle: { request: pending.receipt.snapshot.request, nativeSessionId: 'native-session-38' },
      observation: { runId: address.runId, executorId: 'executor-38', roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL, nativeSessionId: 'native-session-38', event },
      transition: reduceArcTransition(prior, event),
    }
    const acknowledgement = {
      operation: exact ? { kind: 'action', action: 'message', payload: { text: 'continue' } } : { kind: 'action', action: 'message', payload: { text: 'different' } },
      nativeSessionId: 'native-session-38',
    }
    const before = readFileSync(pending.receipt.path)
    const result = persistRunObservation(root, {
      ...address, expectedRevisionDigest: pending.receipt.digest,
      observation: nextObservation, actionAcknowledgement: acknowledgement,
    })
    assert.equal(result.status, exact ? 'recorded' : 'conflict')
    assert.deepEqual(readFileSync(pending.receipt.path), before)
    const reconciled = reconcileRunReceipt(root, { ...address, evidence: {} })
    assert.equal(reconciled.receipt.snapshot.outcome, exact ? 'active' : 'pending')
    assert.equal(reconciled.receipt.snapshot.pendingOperation?.kind ?? null, exact ? null : 'action')
    assert.equal(reconciled.kind, exact ? undefined : 'unknown-native-outcome')
  }
})

test('a bound native identity resumes awaiting its first observation instead of replaying start', () => {
  const root = repo()
  const initial = recordRequest(root)
  claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
  appendExecutorEvent(root, 38, 'executor-start', {
    runId: address.runId, executorId: 'executor-38', nativeSessionId: 'native-session-38',
    actionFingerprint: bound.receipt.snapshot.pendingOperation.actionFingerprint,
    requestFingerprint: bound.receipt.snapshot.requestFingerprint, runReceiptDigest: bound.receipt.digest,
  })
  const resume = reconcileRunReceipt(root, { ...address, evidence: {} })
  assert.equal(resume.status, 'resume')
  assert.equal(resume.operation, 'awaitEvent')
  assert.notEqual(resume.operation, 'start')
})

test('terminal receipts refuse later observations and preserve exact historical result replay', () => {
  const root = repo()
  const { address, observed } = advanceToObserved(root)
  const result = { status: 'done', phase: 38, resultDigest: digest('terminal-winner') }
  const completed = persistRunResult(root, { ...address, expectedRevisionDigest: observed.receipt.digest, result })
  const before = readFileSync(completed.receipt.path)
  const replay = persistRunResult(root, { ...address, expectedRevisionDigest: observed.receipt.digest, result })
  assert.equal(replay.status, 'duplicate')
  const lateObservation = observationFor(completed.receipt.snapshot.request)
  lateObservation.observation.event.eventId = 'after-terminal'
  lateObservation.transition = reduceArcTransition(lateObservation.transition.next, lateObservation.observation.event)
  const late = persistRunObservation(root, { ...address, expectedRevisionDigest: completed.receipt.digest, observation: lateObservation })
  assert.ok(['conflict', 'hold'].includes(late.status), JSON.stringify(late))
  assert.deepEqual(readFileSync(completed.receipt.path), before)
})

test('a repeated historical eventId with changed evidence conflicts after a later observation', () => {
  const root = repo()
  const { address, observed } = advanceToObserved(root)
  const prior = observed.receipt.snapshot.latestObservation.transition.next
  const laterEvent = { eventId: 'later-event', arcId: address.arcId, source: 'native-agent', type: 'run-phase', phase: 38, authorityRef: observed.receipt.snapshot.request.authorityRef }
  const later = observationFor(observed.receipt.snapshot.request)
  later.observation.event = laterEvent
  later.transition = reduceArcTransition(prior, laterEvent)
  const latest = persistRunObservation(root, { ...address, expectedRevisionDigest: observed.receipt.digest, observation: later })

  const repeated = observationFor(latest.receipt.snapshot.request)
  repeated.observation.event.evidence = { changed: true }
  repeated.transition = reduceArcTransition(later.transition.next, repeated.observation.event)
  const conflict = persistRunObservation(root, { ...address, expectedRevisionDigest: latest.receipt.digest, observation: repeated })
  assert.equal(conflict.status, 'conflict')
})

test('an owned live publisher temp file is ignored while the immutable chain remains valid', () => {
  const root = repo()
  const initial = recordRequest(root)
  const temp = join(dirname(initial.receipt.path), '.12345-00000000-0000-4000-8000-000000000000.tmp')
  writeFileSync(temp, 'partial private publication')
  const held = reconcileRunReceipt(root, { arcId: 'NATIVEGREEN', runId: 'run-38-2', evidence: {} })
  assert.equal(held.status, 'hold')
  assert.equal(readFileSync(temp, 'utf8'), 'partial private publication')
})

test('an old valid beacon cannot clear a newer pending action or authorize its replay', () => {
  const root = repo()
  const initial = recordRequest(root)
  claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
  const observed = persistRunObservation(root, { ...address, expectedRevisionDigest: bound.receipt.digest, observation: observationFor(bound.receipt.snapshot.request) })
  const pending = persistRunRequest(root, observed.receipt.snapshot.request, {
    operation: { kind: 'action', action: 'message', payload: { text: 'new action' }, expectedRevisionDigest: observed.receipt.digest },
    roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES,
  })
  appendExecutorEvent(root, 38, 'task-start', {
    runId: address.runId, executorId: 'executor-38', nativeSessionId: 'native-session-38',
    actionFingerprint: bound.receipt.snapshot.pendingOperation.actionFingerprint,
    requestFingerprint: bound.receipt.snapshot.requestFingerprint, runReceiptDigest: bound.receipt.digest,
  })
  const held = reconcileRunReceipt(root, { ...address, evidence: {} })
  assert.equal(held.status, 'hold')
  assert.equal(held.kind, 'unknown-native-outcome')
  assert.equal(held.receipt.digest, pending.receipt.digest)
})

test('a bound run with missing, legacy, or partial arm identity holds before resume', () => {
  for (const mode of ['missing', 'legacy', 'partial']) {
    const root = repo()
    const initial = recordRequest(root)
    const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
    const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
    if (mode !== 'missing') {
      mkdirSync(dirname(armPath(root, 38)), { recursive: true })
      writeFileSync(armPath(root, 38), mode === 'legacy' ? 'legacy-session\n' : JSON.stringify({ sessionId: 'session-38', executorId: 'executor-38' }) + '\n')
    }
    const held = reconcileRunReceipt(root, { ...address, evidence: {} })
    assert.equal(held.status, 'hold', `${mode}: ${JSON.stringify(held)}`)
    assert.match(held.reason, /arm|identity|legacy|partial|missing/i)
    assert.equal(held.receipt.digest, bound.receipt.digest)
  }
})

test('corrupt latest beacon or partial native identity holds instead of becoming permission', () => {
  for (const mode of ['corrupt', 'partial']) {
    const root = repo()
    const initial = recordRequest(root)
    claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
    const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
    const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
    const beacon = join(root, '.building', '38-executor.jsonl')
    if (mode === 'corrupt') {
      mkdirSync(dirname(beacon), { recursive: true })
      writeFileSync(beacon, '{corrupt latest beacon\n')
    } else {
      appendExecutorEvent(root, 38, 'task-start', { executorId: 'executor-38' })
    }
    const held = reconcileRunReceipt(root, { ...address, evidence: {} })
    assert.equal(held.status, 'hold', `${mode}: ${JSON.stringify(held)}`)
    assert.match(held.reason, /beacon|identity|partial|malformed|unreadable/i)
    assert.equal(held.receipt.digest, bound.receipt.digest)
  }
})

test('a later exact acknowledgement clears pending with the already-recorded observation exactly once', () => {
  for (const exact of [true, false]) {
    const root = repo()
    const { address, observed } = advanceToObserved(root)
    const operation = { kind: 'action', action: 'message', payload: { text: 'recover me' }, expectedRevisionDigest: observed.receipt.digest }
    const pending = persistRunRequest(root, observed.receipt.snapshot.request, { operation, roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES })
    const prior = observed.receipt.snapshot.latestObservation.transition.next
    const event = { eventId: 'recorded-before-ack', arcId: address.arcId, source: 'native-agent', type: 'run-phase', phase: 38, authorityRef: pending.receipt.snapshot.request.authorityRef }
    const sameObservation = {
      handle: { request: pending.receipt.snapshot.request, nativeSessionId: 'native-session-38' },
      observation: { runId: address.runId, executorId: 'executor-38', roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL, nativeSessionId: 'native-session-38', event },
      transition: reduceArcTransition(prior, event),
    }
    const ordinary = persistRunObservation(root, { ...address, expectedRevisionDigest: pending.receipt.digest, observation: sameObservation })
    assert.equal(ordinary.status, 'recorded')
    assert.equal(ordinary.receipt.snapshot.outcome, 'pending')
    assert.equal(ordinary.receipt.snapshot.pendingOperation.kind, 'action')
    const beforeNext = ordinary.receipt.snapshot.latestObservation.transition.next

    const acknowledgement = {
      operation: exact ? { kind: 'action', action: 'message', payload: { text: 'recover me' } } : { kind: 'action', action: 'message', payload: { text: 'wrong' } },
      nativeSessionId: 'native-session-38',
    }
    const recovered = persistRunObservation(root, {
      ...address, expectedRevisionDigest: ordinary.receipt.digest,
      observation: sameObservation, actionAcknowledgement: acknowledgement,
    })
    assert.equal(recovered.status, exact ? 'recorded' : 'conflict')
    const reconciled = reconcileRunReceipt(root, { ...address, evidence: {} })
    assert.equal(reconciled.receipt.snapshot.pendingOperation?.kind ?? null, exact ? null : 'action')
    assert.equal(reconciled.receipt.snapshot.outcome, exact ? 'active' : 'pending')
    assert.deepEqual(reconciled.receipt.snapshot.latestObservation.transition.next, beforeNext, 'acknowledgement does not apply the lifecycle event twice')
    assert.equal(persistRunObservation(root, { ...address, expectedRevisionDigest: ordinary.receipt.digest, observation: sameObservation, actionAcknowledgement: acknowledgement }).status, exact ? 'duplicate' : 'conflict')
    assert.equal(reconciled.kind, exact ? undefined : 'unknown-native-outcome')
  }
})

test('claimExecutorRun verifies canonical receipt bytes, path, phase, and worktree before arm publication', () => {
  const mutations = [
    ['digest', (receipt) => ({ ...receipt, digest: 'f'.repeat(64) })],
    ['snapshot', (receipt) => ({ ...receipt, snapshot: { ...receipt.snapshot, requestFingerprint: 'e'.repeat(64) } })],
    ['path', (receipt) => ({ ...receipt, path: join(dirname(receipt.path), '000999.json') })],
    ['phase', (receipt) => ({ ...receipt, snapshot: { ...receipt.snapshot, request: { ...receipt.snapshot.request, phase: 39 } } })],
    ['worktree', (receipt) => ({ ...receipt, snapshot: { ...receipt.snapshot, request: { ...receipt.snapshot.request, worktree: '/tmp/other-worktree' } } })],
  ]
  for (const [name, mutate] of mutations) {
    const root = repo()
    const initial = recordRequest(root)
    const forged = mutate(structuredClone(initial.receipt))
    assert.throws(() => claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: forged }), /receipt|canonical|digest|phase|worktree|identity|pre-start/i, name)
    assert.equal(existsSync(armPath(root, 38)), false, `${name}: forged receipt cannot create an arm`)
  }
})

test('a malformed incumbent copying stable arm IDs is preserved and never accepted as duplicate', () => {
  const root = repo()
  const initial = recordRequest(root)
  const malformed = {
    sessionId: 'session-38', executorId: 'executor-38', runId: 'run-38-2',
    requestFingerprint: initial.receipt.snapshot.requestFingerprint, armedAt: 'not-a-date',
  }
  mkdirSync(dirname(armPath(root, 38)), { recursive: true })
  writeFileSync(armPath(root, 38), JSON.stringify(malformed) + '\n')
  const before = readFileSync(armPath(root, 38))
  const result = claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  assert.ok(['conflict', 'hold'].includes(result.status), JSON.stringify(result))
  assert.notEqual(result.status, 'duplicate')
  assert.deepEqual(readFileSync(armPath(root, 38)), before)
})


test('claim cannot omit its receipt path to bypass canonical verification', () => {
  const root = repo()
  const initial = recordRequest(root)
  const { path, ...missingPath } = initial.receipt
  assert.throws(() => claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: missingPath }), /receipt|path|canonical/i)
  assert.equal(existsSync(armPath(root, 38)), false)
})

test('claim refuses a symlinked receipt ancestor even when the target bytes match', () => {
  const root = repo()
  const initial = recordRequest(root)
  const chainDir = dirname(initial.receipt.path)
  const moved = join(root, 'moved-receipts')
  renameSync(chainDir, moved)
  symlinkSync(moved, chainDir)
  assert.throws(() => claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt }), /symlink|unsafe/i)
  assert.equal(existsSync(armPath(root, 38)), false)
  assert.deepEqual(readFileSync(join(moved, '000000.json')), readFileSync(initial.receipt.path))
})

test('a null legacy arm is a preserving hold rather than an uncaught parser failure', () => {
  const root = repo()
  const initial = recordRequest(root)
  mkdirSync(dirname(armPath(root, 38)), { recursive: true })
  writeFileSync(armPath(root, 38), 'null\n')
  const result = claimExecutorRun(root, 38, { sessionId: 'session-38', executorId: 'executor-38', runReceipt: initial.receipt })
  assert.equal(result.status, 'hold')
  assert.equal(readFileSync(armPath(root, 38), 'utf8'), 'null\n')
})


test('a fresh run binds the real checkout and commits before publishing any receipt', () => {
  for (const change of [{ requestedHead: '0'.repeat(40) }, { baseHead: '0'.repeat(40) }, { worktree: '/tmp/another-unbound-checkout' }]) {
    const root = repo()
    assert.throws(() => recordRequest(root, change), /HEAD|head|commit|worktree|checkout|ENOENT/i)
    assert.equal(existsSync(join(root, 'roadmap')), false, 'failed source binding must not create receipt directories')
  }
})

test('non-JSON operation values cannot change meaning between fingerprinting and disk publication', () => {
  const root = repo()
  const initial = recordRequest(root)
  const address = { arcId: 'NATIVEGREEN', runId: 'run-38-2' }
  const bound = bindNativeSession(root, { ...address, expectedRevisionDigest: initial.receipt.digest, nativeSessionId: 'native-session-38' })
  const observed = persistRunObservation(root, { ...address, expectedRevisionDigest: bound.receipt.digest, observation: observationFor(bound.receipt.snapshot.request) })
  const before = readdirSync(dirname(observed.receipt.path)).sort()
  for (const payload of [{ value: NaN }, { value: undefined }, new Date(0)]) {
    assert.throws(() => persistRunRequest(root, observed.receipt.snapshot.request, {
      operation: { kind: 'action', action: 'message', payload, expectedRevisionDigest: observed.receipt.digest }, roleCardBytes: ROLE_BYTES, governanceBytes: GOVERNANCE_BYTES,
    }), /JSON|finite|plain/i)
    assert.deepEqual(readdirSync(dirname(observed.receipt.path)).sort(), before)
  }
})
