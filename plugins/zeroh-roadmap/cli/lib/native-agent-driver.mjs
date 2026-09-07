import { createHash } from 'node:crypto'
import { existsSync, readFileSync, lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { freshProvenance, verifyDriver } from '../commands/driver.mjs'
import { ClaudeAgentDriver } from './claude-agent-driver.mjs'
import { CodexAgentDriver } from './codex-agent-driver.mjs'
import { intersectAuthority, launchArgv } from './drivers.mjs'
import { MODEL_DRIVERS } from './drivers.mjs'
import { DEFAULT_AGENT_CARD, readExecutorRunArm } from './executor-arm.mjs'
import { resolveGovernance } from './governance.mjs'
import * as defaultReceiptStore from './run-receipt.mjs'
import { ensureReceiptDirectory } from './run-receipt.mjs'
import { buildingDir, publishImmutableFile } from './sidecar.mjs'
import { resolveRole } from './roles.mjs'
import { createNativeProcessTransport } from './native-process-transport.mjs'

const hold = (reason) => ({ status: 'hold', kind: 'capability-provenance-unavailable', reason })

function phaseOutcome(terminal) {
  if (!terminal || typeof terminal !== 'object') return hold('native run has no durable terminal result')
  const protocol = terminal.protocolTerminal
  const type = typeof protocol === 'string' ? protocol : protocol?.type
  if (terminal.exitCode !== 0 || terminal.signal !== null || protocol?.is_error === true
    || (type === 'result' && protocol?.subtype !== undefined && protocol.subtype !== 'success')
    || ['turn.failed', 'error'].includes(type) || (typeof type === 'string' && type.startsWith('result.') && type !== 'result.success')) {
    return { status: 'hold', kind: 'native-transport-failed', reason: 'native process or protocol terminal reported failure', evidence: structuredClone(terminal) }
  }
  if (!terminal.phaseResult || typeof terminal.phaseResult !== 'object') return hold('native terminal result has no unambiguous phase result candidate')
  return { result: structuredClone(terminal.phaseResult) }
}

export class NativeAgentDriver {
  constructor({ cwd, parentDriverId, policy, modelPolicy, adapters, readFreshProvenance, provenanceStore, processTransports, processTransport, readLaunchInputs, receiptStore = defaultReceiptStore, ownershipStore, sessionId, parentAuthority }) {
    if (typeof cwd !== 'string' || !cwd.trim()) throw new Error('NativeAgentDriver cwd is required')
    if (typeof parentDriverId !== 'string' || !parentDriverId.trim()) throw new Error('NativeAgentDriver parentDriverId is required')
    this.phaseLaunchInputs = new Map()
    this.usesInjectedAdapters = adapters !== undefined
    const effectiveReadLaunchInputs = readLaunchInputs ?? ((request) => this.phaseLaunchInputs.get(JSON.stringify([request.arcId, request.runId])))
    if (adapters === undefined) {
      if (!processTransports) {
        const durableTransport = processTransport ?? createNativeProcessTransport({ receiptStore })
        processTransports = { codex: durableTransport, claude: durableTransport }
      }
      adapters = {
        codex: new CodexAgentDriver({ processTransport: processTransports.codex, readLaunchInputs: effectiveReadLaunchInputs, receiptStore, ownershipStore, sessionId }),
        claude: new ClaudeAgentDriver({ processTransport: processTransports.claude, readLaunchInputs: effectiveReadLaunchInputs, receiptStore, ownershipStore, sessionId }),
      }
    }
    if (!adapters || typeof adapters !== 'object') throw new Error('NativeAgentDriver adapters are required')
    const legacyReader = readFreshProvenance
    provenanceStore ??= legacyReader ? { read: legacyReader, verify: () => 1 } : { read: freshProvenance, verify: verifyDriver }
    if (typeof provenanceStore?.read !== 'function' || typeof provenanceStore?.verify !== 'function') throw new Error('NativeAgentDriver provenanceStore read/verify is required')
    this.cwd = cwd
    this.parentDriverId = parentDriverId
    this.modelPolicy = structuredClone(policy ?? modelPolicy ?? {})
    this.adapters = adapters
    this.provenanceStore = provenanceStore
    this.sessionId = sessionId
    this.parentAuthority = parentAuthority
    this.readLaunchInputs = effectiveReadLaunchInputs
    this.hasExternalLaunchInputs = typeof readLaunchInputs === 'function'
    this.receiptStore = receiptStore
  }

  selection(request) {
    if (!request || typeof request !== 'object') throw new Error('native agent request is required')
    const resolved = resolveRole(request.roleId, this.parentDriverId, { policy: this.modelPolicy })
    const selectedDriverId = MODEL_DRIVERS[resolved.model]
    if (!selectedDriverId || request.model !== resolved.model || request.driverId !== selectedDriverId) {
      throw new Error(`request driver/model does not match selected semantic role '${request.roleId}'`)
    }
    const adapter = this.adapters[selectedDriverId]
    if (!adapter) throw new Error(`selected driver '${selectedDriverId}' has no native adapter`)
    return { adapter, driverId: selectedDriverId }
  }

  provenance(driverId) {
    const evidence = this.provenanceStore.read(this.cwd, driverId)
    if (!evidence?.ok) return { ...hold(evidence?.reason ?? ('driver ' + driverId + ' has no fresh capability provenance')), refreshable: evidence?.refreshable === true }
    const doc = evidence.doc
    if (!doc || typeof doc !== 'object' || (doc.driverId !== undefined && doc.driverId !== driverId)) return hold(`capability provenance does not identify driver '${driverId}'`)
    const probes = Array.isArray(doc.probes) ? doc.probes : []
    if (!['version', 'capabilities'].every((name) => probes.some((probe) => probe?.name === name && probe.pass === true)) || probes.some((probe) => probe?.pass !== true)) {
      return hold(`driver '${driverId}' capability provenance does not pass every required probe`)
    }
    return null
  }

  route(request, { requireProvenance = true, refresh = true } = {}) {
    const selected = this.selection(request)
    let refusal = requireProvenance ? this.provenance(selected.driverId) : null
    if (refusal?.refreshable === true && refresh) {
      this.provenanceStore.verify(this.cwd, selected.driverId)
      refusal = this.provenance(selected.driverId)
    }
    return { ...selected, refusal }
  }

  async start(request, context = {}) {
    const { adapter, refusal } = this.route(request)
    if (refusal) return refusal
    const launchContext = context.schema ? this.schemaContext(request, context.schema, { publish: true }) : context
    const trustedRequest = structuredClone(request)
    if (typeof adapter.launchOptions === 'function') trustedRequest.authority.native.argv = launchArgv(trustedRequest.driverId, adapter.launchOptions(trustedRequest, launchContext))
    return adapter.start(trustedRequest, structuredClone(launchContext))
  }

  async resume(handle, context = {}) {
    const trusted = structuredClone(handle)
    const { adapter, refusal } = this.route(trusted?.request)
    if (refusal) return refusal
    const launchContext = context.schema ? this.schemaContext(trusted.request, context.schema, { publish: true }) : context
    if (typeof adapter.launchOptions === 'function') {
      const expected = launchArgv(trusted.request.driverId, adapter.launchOptions(trusted.request, launchContext))
      if (JSON.stringify(expected) !== JSON.stringify(trusted.request.authority.native.argv)) return hold('durable native argv does not match the current registry contract')
    }
    return adapter.resume(trusted, structuredClone(launchContext))
  }

  async awaitEvent(handle, state) {
    const trusted = structuredClone(handle)
    const { adapter, refusal } = this.route(trusted?.request, { requireProvenance: false })
    return refusal ?? adapter.awaitEvent(trusted, structuredClone(state))
  }

  async recover(receipt, state, context = {}) {
    const request = structuredClone(receipt?.snapshot?.request)
    const { adapter } = this.route(request, { requireProvenance: false })
    if (typeof adapter.recover !== 'function') return hold('selected native adapter cannot ingest durable completion evidence')
    return adapter.recover(structuredClone(receipt), structuredClone(state), structuredClone(context))
  }

  async performAction(handle, action) {
    const trusted = structuredClone(handle)
    const { adapter, refusal } = this.route(trusted?.request)
    return refusal ?? adapter.performAction(trusted, structuredClone(action))
  }
  schemaContext(request, schema, { publish = false } = {}) {
    if (request.driverId !== 'codex' || !publish || this.usesInjectedAdapters) return { schema, requirePhaseResult: true }
    const dir = ensureReceiptDirectory(join(buildingDir(this.cwd), 'native-schemas', encodeURIComponent(request.arcId), encodeURIComponent(request.runId)))
    const outputSchemaPath = join(dir, 'phase-result.schema.json')
    const bytes = Buffer.from(JSON.stringify(schema, null, 2) + '\n')
    if (!publishImmutableFile(outputSchemaPath, bytes)) {
      if (!existsSync(outputSchemaPath) || lstatSync(outputSchemaPath).isSymbolicLink() || !lstatSync(outputSchemaPath).isFile() || realpathSync(outputSchemaPath) !== outputSchemaPath || !readFileSync(outputSchemaPath).equals(bytes)) throw new Error('immutable native output schema conflicts with the existing run schema')
    }
    return { schema, outputSchemaPath, requirePhaseResult: true }
  }

  async runPhase({ arcId, phase, prompt, schema, plan, sourceCheckpoint }) {
    if (!plan || typeof plan.roleId !== 'string') throw new Error('native phase plan requires a semantic roleId')
    const resolved = resolveRole(plan.roleId, this.parentDriverId, { policy: this.modelPolicy })
    const driverId = MODEL_DRIVERS[resolved.model]
    if (plan.driverId !== driverId || plan.model !== resolved.model) throw new Error('native phase plan does not match selected role driver/model')
    const arm = readExecutorRunArm(this.cwd, phase)
    if (arm.status === 'partial') return hold('legacy or partial executor arm cannot recover a native run')
    if (arm.status === 'valid') {
      const receipt = this.receiptStore.readRunReceipt(this.cwd, { arcId, runId: arm.arm.runId })
      if (!receipt || receipt.snapshot.requestFingerprint !== arm.arm.requestFingerprint || receipt.snapshot.request.executorId !== arm.arm.executorId
        || receipt.snapshot.request.arcId !== arcId || receipt.snapshot.request.phase !== Number(phase) || receipt.snapshot.request.roleId !== plan.roleId
        || receipt.snapshot.request.driverId !== driverId || receipt.snapshot.request.model !== resolved.model) return hold('stable executor arm does not match its native run receipt')
      if (this.parentAuthority) {
        const derived = intersectAuthority(this.parentAuthority, receipt.snapshot.request.authority.request)
        if (JSON.stringify(derived.effective) !== JSON.stringify(receipt.snapshot.request.authority.effective)) return hold('stored native run exceeds the current parent authority ceiling')
      }
      if (receipt.snapshot.terminalResult !== null) return phaseOutcome(receipt.snapshot.terminalResult)
      const state = { arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: receipt.snapshot.request.authorityRef }
      if (receipt.snapshot.pendingOperation) {
        const observed = await this.recover(receipt, state, this.schemaContext(receipt.snapshot.request, schema))
        if (observed?.status === 'hold' || observed?.status === 'conflict') return observed
        return this.usesInjectedAdapters ? { result: observed?.result?.phaseResult ?? observed?.phaseResult ?? observed?.result } : phaseOutcome(observed?.result)
      }
      const handle = { request: receipt.snapshot.request, nativeSessionId: receipt.snapshot.nativeSessionId }
      if (!handle.nativeSessionId) return hold('active native receipt lacks durable session identity')
      const resumed = await this.resume(handle, this.schemaContext(handle.request, schema))
      if (resumed?.status === 'hold' || resumed?.status === 'conflict') return resumed
      const observed = await this.awaitEvent(handle, state)
      return this.usesInjectedAdapters ? { result: observed?.result?.phaseResult ?? observed?.phaseResult ?? observed?.result } : phaseOutcome(observed?.result)
    }
    if (arm.status !== 'missing') return hold('executor arm cannot be used for native recovery')
    const freshRoute = this.route({ roleId: plan.roleId, driverId, model: resolved.model })
    if (freshRoute.refusal) return freshRoute.refusal
    if (!sourceCheckpoint || !this.parentAuthority || typeof this.readLaunchInputs !== 'function' || typeof this.sessionId !== 'string') throw new Error('fresh native phase requires source checkpoint, parent authority, session, and launch inputs')
    const requestAuthority = { profile: 'inherit', bounds: structuredClone(this.parentAuthority.bounds), provenance: null }
    const authority = { ...intersectAuthority(this.parentAuthority, requestAuthority), native: { driver: driverId, runtime: { version: null, verified: false }, argv: [], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['runtime capability is verified separately'] } }
    const seed = JSON.stringify({ arcId, phase, plan, sourceCheckpoint, authorityRef: sourceCheckpoint.authorityRef })
    const hash = createHash('sha256').update(seed).digest('hex')
    const executorId = plan.executorId ?? ('executor-' + hash.slice(0, 24))
    const request = { runId: 'run-' + hash, executorId, arcId, phase: Number(phase), roleId: plan.roleId, driverId, model: resolved.model,
      worktree: this.cwd, baseHead: sourceCheckpoint.baseHead, requestedHead: sourceCheckpoint.requestedHead,
      roleCardDigest: sourceCheckpoint.roleCardDigest, governanceDigest: sourceCheckpoint.governanceDigest, authority, authorityRef: sourceCheckpoint.authorityRef }
    if (!this.hasExternalLaunchInputs) {
      const roleCardBytes = readFileSync(DEFAULT_AGENT_CARD)
      const governance = resolveGovernance(this.cwd, [join(this.cwd, 'roadmap', 'phases', 'phase-' + phase + '.phase.ts')])
      if (governance.hold) return hold('governance inputs are unavailable: ' + governance.hold.reason)
      const governanceBytes = Buffer.from(JSON.stringify({ ...governance, outputSchemaDigest: createHash('sha256').update(JSON.stringify(schema)).digest('hex') }, null, 2) + '\n')
      this.phaseLaunchInputs.set(JSON.stringify([arcId, request.runId]), { prompt, schema, roleCardBytes, governanceBytes })
    }
    const started = await this.start(request, this.schemaContext(request, schema))
    if (started?.status) return started
    const observed = await this.awaitEvent(started, { arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef: request.authorityRef })
    return this.usesInjectedAdapters ? { result: observed?.result?.phaseResult ?? observed?.phaseResult ?? observed?.result } : phaseOutcome(observed?.result)
  }

}
