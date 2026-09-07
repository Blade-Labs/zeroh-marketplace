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
    if (!processTransport || (typeof processTransport.execute !== 'function' && (typeof processTransport.launch !== 'function' || typeof processTransport.observe !== 'function'))) throw new Error(driverId + ' durable process transport is required')
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


  async waitForCompletion(operationRef) {
    while (true) {
      const observed = await this.processTransport.observe(operationRef)
      if (observed.status !== 'running') return observed
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  probe() { return this.neutral.probe() }

  async start(request, context = {}) {
    const trustedRequest = structuredClone(request)
    validateRoleRunRequest(trustedRequest, this.driverId)
    if (!this.acceptsModel(trustedRequest.model)) throw new Error('request model is not registered to driver ' + this.driverId)
    const entry = resolveDriver(this.driverId)
    const argv = launchArgv(this.driverId, this.launchOptions(trustedRequest, context))
    const inputs = await this.readLaunchInputs(structuredClone(trustedRequest))
    if (!inputs || typeof inputs.prompt !== 'string') throw new Error('native launch inputs require a prompt')
    const persisted = this.receiptStore.persistRunRequest(trustedRequest.worktree, structuredClone(trustedRequest), {
      operation: { kind: 'start', inputDigest: sha256(inputs.prompt) }, roleCardBytes: inputs.roleCardBytes, governanceBytes: inputs.governanceBytes,
    })
    if (persisted.status !== 'recorded') return hold('unknown-native-outcome', 'persisted native start cannot be replayed', persisted.receipt)
    const ownership = this.ownershipStore.claimExecutorRun(trustedRequest.worktree, trustedRequest.phase, {
      sessionId: this.sessionId, executorId: trustedRequest.executorId, runReceipt: persisted.receipt,
    })
    if (!['recorded', 'duplicate'].includes(ownership.status)) return hold('ownership-conflict', ownership.reason ?? 'native executor ownership is unavailable', persisted.receipt)
    let parsed
    let result
    let completion = null
    if (typeof this.processTransport.launch === 'function') {
      const launched = await this.processTransport.launch({ bin: entry.bin, argv, launchOptions: this.launchOptions(trustedRequest, context), stdin: inputs.prompt, cwd: trustedRequest.worktree, runReceipt: persisted.receipt,
        parseOptions: { driverId: this.driverId, ...this.parseOptions(trustedRequest, null), ...(context.schema ? { schema: context.schema, requirePhaseResult: context.requirePhaseResult === true } : {}) } })
      if (launched.status !== 'running') return launched
      const observed = await this.waitForCompletion(launched.operationRef)
      if (observed.status !== 'complete') return observed
      completion = observed.completion
      parsed = { nativeSessionId: completion.nativeSessionId, terminal: { type: completion.protocolTerminal } }
      result = null
    } else {
      result = await this.processTransport.execute({ bin: entry.bin, argv, stdin: inputs.prompt, cwd: trustedRequest.worktree })
      parsed = parseNativeResult(this.driverId, result, this.parseOptions(trustedRequest, null, context))
    }
    const bound = this.receiptStore.bindNativeSession(trustedRequest.worktree, {
      arcId: trustedRequest.arcId, runId: trustedRequest.runId,
      expectedRevisionDigest: persisted.receipt.digest, nativeSessionId: parsed.nativeSessionId,
    })
    if (!['recorded', 'duplicate'].includes(bound.status)) return bound
    const handle = { request: trustedRequest, nativeSessionId: parsed.nativeSessionId }
    this.pending.set(runKey(trustedRequest), { handle: structuredClone(handle), result: result && structuredClone(result), terminal: parsed.terminal, completion: completion && structuredClone(completion), receipt: bound.receipt, actionAcknowledgement: null })
    return handle
  }

  async resume(handle, context = {}) {
    const trustedHandle = structuredClone(handle)
    validateRoleRunRequest(trustedHandle?.request, this.driverId)
    if (!this.acceptsModel(trustedHandle.request.model)) throw new Error('request model is not registered to driver ' + this.driverId)
    if (typeof trustedHandle.nativeSessionId !== 'string' || !trustedHandle.nativeSessionId.trim() || trustedHandle.nativeSessionId.startsWith('-')) {
      throw new Error('native resume requires an exact native session identity')
    }
    const entry = resolveDriver(this.driverId)
    const argv = resumeArgv(this.driverId, trustedHandle.nativeSessionId, this.launchOptions(trustedHandle.request, context))
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
    const operation = { kind: 'action', action: 'resume', payload: { nativeSessionId: trustedHandle.nativeSessionId }, inputDigest: sha256(inputs.prompt), expectedRevisionDigest: reconciled.receipt.digest }
    const pendingAction = this.receiptStore.persistRunRequest(trustedHandle.request.worktree, structuredClone(trustedHandle.request), {
      operation, roleCardBytes: inputs.roleCardBytes, governanceBytes: inputs.governanceBytes,
    })
    if (pendingAction.status !== 'recorded') return hold('unknown-native-outcome', 'persisted native resume cannot be replayed', pendingAction.receipt)
    let parsed
    let result
    let completion = null
    if (typeof this.processTransport.launch === 'function') {
      const launched = await this.processTransport.launch({ bin: entry.bin, argv, launchOptions: this.launchOptions(trustedHandle.request, context), stdin: inputs.prompt, cwd: trustedHandle.request.worktree, runReceipt: pendingAction.receipt,
        parseOptions: { driverId: this.driverId, ...this.parseOptions(trustedHandle.request, trustedHandle.nativeSessionId), ...(context.schema ? { schema: context.schema, requirePhaseResult: context.requirePhaseResult === true } : {}) } })
      if (launched.status !== 'running') return launched
      const observed = await this.waitForCompletion(launched.operationRef)
      if (observed.status !== 'complete') return observed
      completion = observed.completion
      if (completion.nativeSessionId !== trustedHandle.nativeSessionId) return hold('identity-conflict', 'native completion session does not match durable resume identity', pendingAction.receipt)
      parsed = { nativeSessionId: completion.nativeSessionId, terminal: { type: completion.protocolTerminal } }
      result = null
    } else {
      result = await this.processTransport.execute({ bin: entry.bin, argv, stdin: inputs.prompt, cwd: trustedHandle.request.worktree })
      parsed = parseNativeResult(this.driverId, result, this.parseOptions(trustedHandle.request, trustedHandle.nativeSessionId, context))
    }
    this.pending.set(runKey(trustedHandle.request), {
      handle: structuredClone(trustedHandle), result: result && structuredClone(result), terminal: parsed.terminal, completion: completion && structuredClone(completion), receipt: pendingAction.receipt,
      actionAcknowledgement: { operation: { kind: 'action', action: 'resume', payload: { nativeSessionId: trustedHandle.nativeSessionId }, inputDigest: sha256(inputs.prompt) }, nativeSessionId: trustedHandle.nativeSessionId },
    })
    return trustedHandle
  }

  async recover(receipt, state, context = {}) {
    const request = structuredClone(receipt?.snapshot?.request)
    validateRoleRunRequest(request, this.driverId)
    if (!this.acceptsModel(request.model) || !receipt?.snapshot?.pendingOperation) return hold('receipt-conflict', 'native recovery requires the selected pending receipt', receipt)
    if (typeof this.processTransport.observe !== 'function') return hold('unknown-native-outcome', 'native transport cannot observe durable operations', receipt)
    const operationRef = { cwd: request.worktree, arcId: request.arcId, runId: request.runId, pendingReceiptDigest: receipt.digest }
    const observed = await this.waitForCompletion(operationRef)
    if (observed.status !== 'complete') return observed
    const completion = observed.completion
    let current = receipt
    if (receipt.snapshot.nativeSessionId === null) {
      const bound = this.receiptStore.bindNativeSession(request.worktree, { arcId: request.arcId, runId: request.runId, expectedRevisionDigest: receipt.digest, nativeSessionId: completion.nativeSessionId })
      if (!['recorded', 'duplicate'].includes(bound.status)) return bound
      current = bound.receipt
    } else if (receipt.snapshot.nativeSessionId !== completion.nativeSessionId) {
      return hold('identity-conflict', 'native completion session does not match durable receipt identity', receipt)
    }
    const handle = { request, nativeSessionId: completion.nativeSessionId }
    const pending = receipt.snapshot.pendingOperation
    this.pending.set(runKey(request), { handle: structuredClone(handle), result: null, terminal: { type: completion.protocolTerminal }, completion: structuredClone(completion), receipt: current,
      actionAcknowledgement: pending.kind === 'action' ? { operation: { kind: 'action', action: pending.action, payload: structuredClone(pending.payload), inputDigest: pending.inputDigest }, nativeSessionId: completion.nativeSessionId } : null })
    return this.awaitEvent(handle, structuredClone(state))
  }

  async awaitEvent(handle, state) {
    const trustedHandle = structuredClone(handle)
    const trustedState = structuredClone(state)
    validateRoleRunRequest(trustedHandle?.request, this.driverId)
    const buffered = this.pending.get(runKey(trustedHandle.request))
    if (!buffered || !isDeepStrictEqual(buffered.handle, trustedHandle)) throw new Error('native transport completion is not bound to this run/session')
    const evidence = buffered.completion ? { driverId: trustedHandle.request.driverId, nativeSessionId: trustedHandle.nativeSessionId, exitCode: buffered.completion.exitCode, signal: buffered.completion.signal, protocolTerminal: buffered.completion.protocolTerminal, stdoutDigest: buffered.completion.stdoutDigest, stderrDigest: buffered.completion.stderrDigest, usage: null } : completionEvidence(trustedHandle, buffered.result, buffered.terminal)
    const eventId = this.driverId + '-exit-' + sha256(JSON.stringify(stable({ runId: trustedHandle.request.runId, ...evidence })))
    buffered.observation = {
      runId: trustedHandle.request.runId, executorId: trustedHandle.request.executorId, roleId: trustedHandle.request.roleId,
      driverId: trustedHandle.request.driverId, model: trustedHandle.request.model, nativeSessionId: trustedHandle.nativeSessionId,
      event: { eventId, arcId: trustedHandle.request.arcId, source: 'native-agent', type: 'exited', phase: trustedHandle.request.phase, authorityRef: trustedHandle.request.authorityRef, evidence },
    }
    const normalized = await this.neutral.awaitEvent(trustedHandle, trustedState)
    const terminalResult = { status: 'transport-exited', ...evidence, ...(buffered.completion ? { phaseResult: buffered.completion.phaseResult } : {}) }
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
