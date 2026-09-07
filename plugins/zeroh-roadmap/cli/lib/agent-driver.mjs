import { isDeepStrictEqual } from 'node:util'
import { intersectAuthority } from './drivers.mjs'
import { reduceArcTransition } from './workflow-steps.mjs'

const OPERATIONS = Object.freeze(['start', 'resume', 'awaitEvent', 'performAction'])
const IDENTITY_FIELDS = Object.freeze(['runId', 'executorId', 'roleId', 'driverId', 'model'])

function nonBlank(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} must be a nonempty string`)
}

function capabilityRefusal(driverId, operation, action, reason) {
  return { kind: 'capability-refusal', driverId, operation, ...(action === undefined ? {} : { action }), reason }
}

function unavailableOperation(transport, driverId, operation, action = null) {
  if (typeof transport[operation] === 'function') return null
  return capabilityRefusal(driverId, operation, action, "driver '" + driverId + "' does not support operation '" + operation + "'")
}

function validateAuthority(authority) {
  if (!authority || typeof authority !== 'object') throw new Error('request authority envelope is required')
  const derived = intersectAuthority(authority.parent, authority.request)
  if (!isDeepStrictEqual(derived.effective, authority.effective)) {
    throw new Error('effective authority does not match the parent/request intersection')
  }
}

function validateAuthorityRef(value, field) {
  if (!value || typeof value !== 'object') throw new Error(field + ' must be a valid authority reference')
  if (value.status === 'known') {
    nonBlank(value.envelopeDigest, field + '.envelopeDigest')
    if (!value.source || !['codex-journal', 'managed-host-receipt'].includes(value.source.kind)) throw new Error(field + '.source is invalid')
    nonBlank(value.source.ref, field + '.source.ref')
    return
  }
  if (value.status === 'unknown' && ['read-only-projection', 'legacy-unrecorded', 'source-unreadable'].includes(value.reason)
    && (value.sourceRef === null || (typeof value.sourceRef === 'string' && value.sourceRef.trim().length > 0))) return
  throw new Error(field + ' must be a valid authority reference')
}

function validateRequest(request, driverId) {
  if (!request || typeof request !== 'object') throw new Error('role run request is required')
  for (const field of ['runId', 'executorId', 'arcId', 'roleId', 'driverId', 'model', 'worktree', 'baseHead', 'requestedHead', 'roleCardDigest', 'governanceDigest']) {
    nonBlank(request[field], `request.${field}`)
  }
  if (!Number.isInteger(request.phase) || request.phase <= 0) throw new Error('request.phase must be a positive integer')
  if (request.driverId !== driverId) throw new Error(`request driverId '${request.driverId}' does not match driver '${driverId}'`)
  validateAuthority(request.authority)
  if (request.authority.native?.driver !== driverId) throw new Error('native authority driver does not match request driverId')
  validateAuthorityRef(request.authorityRef, 'request.authorityRef')
}

function cloneHandle(handle, driverId) {
  if (!handle || typeof handle !== 'object') throw new Error('agent run handle is required')
  validateRequest(handle.request, driverId)
  nonBlank(handle.nativeSessionId, 'handle.nativeSessionId')
  return structuredClone({ request: handle.request, nativeSessionId: handle.nativeSessionId })
}

function validateObservation(observation, handle) {
  if (!observation || typeof observation !== 'object') throw new Error('native observation is required')
  for (const field of IDENTITY_FIELDS) {
    if (observation[field] !== handle.request[field]) throw new Error(`native observation identity mismatch for ${field}`)
  }
  if (observation.nativeSessionId !== handle.nativeSessionId) throw new Error('native observation identity mismatch for nativeSessionId')
  if (!observation.event || typeof observation.event !== 'object') throw new Error('native observation event is required')
  if (observation.event.arcId !== handle.request.arcId) throw new Error('native observation event arcId mismatch')
  if (observation.event.phase !== handle.request.phase) {
    throw new Error('native observation event phase mismatch')
  }
}

/**
 * Harness-neutral boundary around one native agent transport. This class binds
 * native identity and validates authority; lifecycle meaning remains exclusively
 * in reduceArcTransition.
 */
export class AgentDriver {
  constructor({ driverId, capabilities = {}, transport }) {
    nonBlank(driverId, 'driverId')
    if (!transport || typeof transport !== 'object') throw new Error('transport is required')
    const actions = capabilities.actions ?? []
    if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string' || action.trim().length === 0)) {
      throw new Error('capabilities.actions must contain nonempty strings')
    }
    this.driverId = driverId
    this.actions = Object.freeze([...new Set(actions)])
    this.transport = transport
  }

  async probe() {
    let reachable = false
    let reason
    if (typeof this.transport.probe !== 'function') {
      reason = "driver '" + this.driverId + "' has no probe operation"
    } else {
      try {
        const result = await this.transport.probe({ driverId: this.driverId })
        reachable = result?.reachable === true
        if (!reachable) reason = typeof result?.reason === 'string' && result.reason.trim() ? result.reason : 'transport probe did not attest reachability'
      } catch (error) {
        reason = error instanceof Error && error.message.trim() ? error.message : 'transport probe failed'
      }
    }
    return {
      kind: 'capability-receipt',
      driverId: this.driverId,
      reachable,
      operations: OPERATIONS.filter((operation) => typeof this.transport[operation] === 'function'),
      actions: [...this.actions],
      ...(reason ? { reason } : {}),
    }
  }

  async start(request) {
    const unavailable = unavailableOperation(this.transport, this.driverId, 'start')
    if (unavailable) return unavailable
    validateRequest(request, this.driverId)
    const trustedRequest = structuredClone(request)
    const result = await this.transport.start(structuredClone(trustedRequest))
    nonBlank(result?.nativeSessionId, 'nativeSessionId')
    return { request: trustedRequest, nativeSessionId: result.nativeSessionId }
  }

  async resume(handle) {
    const unavailable = unavailableOperation(this.transport, this.driverId, 'resume')
    if (unavailable) return unavailable
    const trustedHandle = cloneHandle(handle, this.driverId)
    const result = await this.transport.resume(structuredClone(trustedHandle))
    if (result?.nativeSessionId !== trustedHandle.nativeSessionId) throw new Error('resume native identity mismatch')
    return trustedHandle
  }

  async awaitEvent(handle, state) {
    const unavailable = unavailableOperation(this.transport, this.driverId, 'awaitEvent')
    if (unavailable) return unavailable
    const trustedHandle = cloneHandle(handle, this.driverId)
    const trustedState = structuredClone(state)
    if (trustedState?.arcId !== trustedHandle.request.arcId) throw new Error('prior state arcId mismatch')
    validateAuthorityRef(trustedState?.authorityRef, 'prior.authorityRef')
    if (!isDeepStrictEqual(trustedState.authorityRef, trustedHandle.request.authorityRef)) throw new Error('prior state authorityRef mismatch')
    const observation = await this.transport.awaitEvent(structuredClone(trustedHandle), structuredClone(trustedState))
    validateObservation(observation, trustedHandle)
    const trustedObservation = structuredClone(observation)
    const transition = reduceArcTransition(trustedState, trustedObservation.event)
    return { handle: trustedHandle, observation: trustedObservation, transition }
  }

  async performAction(handle, { action, payload }) {
    nonBlank(action, 'action')
    if (!this.actions.includes(action)) {
      return capabilityRefusal(
        this.driverId,
        'performAction',
        action,
        `driver '${this.driverId}' does not support action '${action}'`,
      )
    }
    const unavailable = unavailableOperation(this.transport, this.driverId, 'performAction', action)
    if (unavailable) return unavailable
    const trustedHandle = cloneHandle(handle, this.driverId)
    const result = await this.transport.performAction(structuredClone(trustedHandle), { action, payload: structuredClone(payload) })
    if (result?.nativeSessionId !== trustedHandle.nativeSessionId) throw new Error('performAction native identity mismatch')
    return trustedHandle
  }
}
