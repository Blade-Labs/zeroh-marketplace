import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { AgentDriver, validateRoleRunRequest } from './agent-driver.mjs'
import { launchArgv, parseNativeResult, resumeArgv, resolveDriver } from './drivers.mjs'
import * as defaultReceiptStore from './run-receipt.mjs'
import * as defaultOwnershipStore from './executor-arm.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}
const hold = (kind, reason, receipt) => ({ status: 'hold', kind, reason, ...(receipt ? { receipt } : {}) })
const runKey = (request) => JSON.stringify([request.arcId, request.runId])

function completionEvidence(handle, result, terminal) {
  return {
    driverId: handle.request.driverId,
    nativeSessionId: handle.nativeSessionId,
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    protocolTerminal: terminal.type,
    protocolSubtype: terminal.subtype ?? null,
    protocolError: terminal.is_error ?? null,
    stdoutDigest: sha256(String(result.stdout ?? '')),
    stderrDigest: sha256(String(result.stderr ?? '')),
    usage: terminal.usage ?? null,
  }
}

export class DurableProcessAgentDriver {
  constructor({ processTransport, readLaunchInputs, receiptStore = defaultReceiptStore, ownershipStore = defaultOwnershipStore, sessionId, driverId, acceptsModel, launchOptions, parseOptions }) {
    if (typeof driverId !== 'string' || !driverId.trim()) throw new Error('durable process driverId is required')
    if (typeof acceptsModel !== 'function' || typeof launchOptions !== 'function' || typeof parseOptions !== 'function') throw new Error('durable process driver registry contract is required')
    if (!processTransport || typeof processTransport.execute !== 'function') throw new Error(driverId + ' processTransport.execute is required')
    if (typeof readLaunchInputs !== 'function') throw new Error(driverId + ' readLaunchInputs is required')
    if (!receiptStore || typeof receiptStore.persistRunRequest !== 'function' || typeof receiptStore.persistRunResult !== 'function') throw new Error(driverId + ' receiptStore is required')
    if (!ownershipStore || typeof ownershipStore.claimExecutorRun !== 'function') throw new Error(driverId + ' ownershipStore is required')
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw new Error(driverId + ' owner sessionId is required')
    this.driverId = driverId
    this.acceptsModel = acceptsModel
    this.launchOptions = launchOptions
    this.parseOptions = parseOptions
    this.processTransport = processTransport
    this.readLaunchInputs = readLaunchInputs
    this.receiptStore = receiptStore
    this.ownershipStore = ownershipStore
    this.sessionId = sessionId
    this.pending = new Map()
    this.neutral = new AgentDriver({
      driverId,
      capabilities: { actions: [] },
      transport: {
        probe: async () => typeof processTransport.probe === 'function' ? processTransport.probe() : { reachable: false },
        start: async () => { throw new Error('durable adapter owns start') },
        resume: async () => { throw new Error('durable adapter owns resume') },
        awaitEvent: async (handle) => {
          const buffered = this.pending.get(runKey(handle.request))
          if (!buffered) throw new Error(driverId + ' has no buffered native completion for this run')
          return buffered.observation
        },
        performAction: async () => { throw new Error('unsupported driver action') },
      },
    })
  }

  probe() { return this.neutral.probe() }

  async start(request) {
    const trustedRequest = structuredClone(request)
    validateRoleRunRequest(trustedRequest, this.driverId)
    if (!this.acceptsModel(trustedRequest.model)) throw new Error('request model is not registered to driver ' + this.driverId)
    const entry = resolveDriver(this.driverId)
    const argv = launchArgv(this.driverId, this.launchOptions(trustedRequest))
    const inputs = await this.readLaunchInputs(structuredClone(trustedRequest))
    if (!inputs || typeof inputs.prompt !== 'string') throw new Error('native launch inputs require a prompt')
    const persisted = this.receiptStore.persistRunRequest(trustedRequest.worktree, structuredClone(trustedRequest), {
      operation: { kind: 'start' }, roleCardBytes: inputs.roleCardBytes, governanceBytes: inputs.governanceBytes,
    })
    if (persisted.status !== 'recorded') return hold('unknown-native-outcome', 'persisted native start cannot be replayed', persisted.receipt)
    const ownership = this.ownershipStore.claimExecutorRun(trustedRequest.worktree, trustedRequest.phase, {
      sessionId: this.sessionId, executorId: trustedRequest.executorId, runReceipt: persisted.receipt,
    })
    if (!['recorded', 'duplicate'].includes(ownership.status)) return hold('ownership-conflict', ownership.reason ?? 'native executor ownership is unavailable', persisted.receipt)
    const result = await this.processTransport.execute({
      bin: entry.bin,
      argv,
      stdin: inputs.prompt, cwd: trustedRequest.worktree,
    })
    const parsed = parseNativeResult(this.driverId, result, this.parseOptions(trustedRequest, null))
    const bound = this.receiptStore.bindNativeSession(trustedRequest.worktree, {
      arcId: trustedRequest.arcId, runId: trustedRequest.runId,
      expectedRevisionDigest: persisted.receipt.digest, nativeSessionId: parsed.nativeSessionId,
    })
    if (!['recorded', 'duplicate'].includes(bound.status)) return bound
    const handle = { request: trustedRequest, nativeSessionId: parsed.nativeSessionId }
    this.pending.set(runKey(trustedRequest), { handle: structuredClone(handle), result: structuredClone(result), terminal: parsed.terminal, receipt: bound.receipt, actionAcknowledgement: null })
    return handle
  }

  async resume(handle) {
    const trustedHandle = structuredClone(handle)
    validateRoleRunRequest(trustedHandle?.request, this.driverId)
    if (!this.acceptsModel(trustedHandle.request.model)) throw new Error('request model is not registered to driver ' + this.driverId)
    if (typeof trustedHandle.nativeSessionId !== 'string' || !trustedHandle.nativeSessionId.trim() || trustedHandle.nativeSessionId.startsWith('-')) {
      throw new Error('native resume requires an exact native session identity')
    }
    const entry = resolveDriver(this.driverId)
    const argv = resumeArgv(this.driverId, trustedHandle.nativeSessionId, this.launchOptions(trustedHandle.request))
    const buffered = this.pending.get(runKey(trustedHandle.request))
    if (buffered && isDeepStrictEqual(buffered.handle, trustedHandle)) return trustedHandle
    const reconciled = this.receiptStore.reconcileRunReceipt(trustedHandle.request.worktree, {
      arcId: trustedHandle.request.arcId, runId: trustedHandle.request.runId, evidence: {},
    })
    if (!['resume', 'active'].includes(reconciled.status)) return reconciled
    const stored = reconciled.receipt?.snapshot
    if (!stored || !isDeepStrictEqual(stored.request, trustedHandle.request) || stored.nativeSessionId !== trustedHandle.nativeSessionId) {
      return hold('identity-conflict', 'native resume identity does not match the durable run receipt', reconciled.receipt)
    }
    const inputs = await this.readLaunchInputs(structuredClone(trustedHandle.request))
    if (!inputs || typeof inputs.prompt !== 'string') throw new Error('native resume inputs require a prompt')
    const operation = { kind: 'action', action: 'resume', payload: { nativeSessionId: trustedHandle.nativeSessionId }, expectedRevisionDigest: reconciled.receipt.digest }
    const pendingAction = this.receiptStore.persistRunRequest(trustedHandle.request.worktree, structuredClone(trustedHandle.request), {
      operation, roleCardBytes: inputs.roleCardBytes, governanceBytes: inputs.governanceBytes,
    })
    if (pendingAction.status !== 'recorded') return hold('unknown-native-outcome', 'persisted native resume cannot be replayed', pendingAction.receipt)
    const result = await this.processTransport.execute({
      bin: entry.bin,
      argv,
      stdin: inputs.prompt, cwd: trustedHandle.request.worktree,
    })
    const parsed = parseNativeResult(this.driverId, result, this.parseOptions(trustedHandle.request, trustedHandle.nativeSessionId))
    this.pending.set(runKey(trustedHandle.request), {
      handle: structuredClone(trustedHandle), result: structuredClone(result), terminal: parsed.terminal, receipt: pendingAction.receipt,
      actionAcknowledgement: { operation: { kind: 'action', action: 'resume', payload: { nativeSessionId: trustedHandle.nativeSessionId } }, nativeSessionId: trustedHandle.nativeSessionId },
    })
    return trustedHandle
  }

  async awaitEvent(handle, state) {
    const trustedHandle = structuredClone(handle)
    const trustedState = structuredClone(state)
    validateRoleRunRequest(trustedHandle?.request, this.driverId)
    const buffered = this.pending.get(runKey(trustedHandle.request))
    if (!buffered || !isDeepStrictEqual(buffered.handle, trustedHandle)) throw new Error('native transport completion is not bound to this run/session')
    const evidence = completionEvidence(trustedHandle, buffered.result, buffered.terminal)
    const eventId = this.driverId + '-exit-' + sha256(JSON.stringify(stable({ runId: trustedHandle.request.runId, ...evidence })))
    buffered.observation = {
      runId: trustedHandle.request.runId, executorId: trustedHandle.request.executorId, roleId: trustedHandle.request.roleId,
      driverId: trustedHandle.request.driverId, model: trustedHandle.request.model, nativeSessionId: trustedHandle.nativeSessionId,
      event: { eventId, arcId: trustedHandle.request.arcId, source: 'native-agent', type: 'exited', phase: trustedHandle.request.phase, authorityRef: trustedHandle.request.authorityRef, evidence },
    }
    const normalized = await this.neutral.awaitEvent(trustedHandle, trustedState)
    const terminalResult = { status: 'transport-exited', ...evidence }
    const completed = this.receiptStore.persistRunResult(trustedHandle.request.worktree, {
      arcId: trustedHandle.request.arcId, runId: trustedHandle.request.runId,
      expectedRevisionDigest: buffered.receipt.digest, result: terminalResult, observation: normalized,
      ...(buffered.actionAcknowledgement ? { actionAcknowledgement: buffered.actionAcknowledgement } : {}),
    })
    if (!['recorded', 'duplicate'].includes(completed.status)) return completed
    this.pending.delete(runKey(trustedHandle.request))
    return { ...normalized, receipt: completed.receipt, result: terminalResult }
  }

  performAction(handle, action) { return this.neutral.performAction(handle, action) }
}
