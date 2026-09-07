import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
} from 'node:fs'
import { join, parse, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { buildingDir, publishImmutableFile } from './sidecar.mjs'
import { readExecutorRunArm } from './executor-arm.mjs'
import { readBeaconLine } from './beacon.mjs'
import { validateNativeObservation, validateRoleRunRequest } from './agent-driver.mjs'
import { reduceArcTransition } from './workflow-steps.mjs'

const VERSION = 1
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0
const safeId = (value) => nonBlank(value) && value !== '.' && value !== '..' && !/[\\/]/.test(value)
const stable = (value) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  throw new Error('receipt data must contain only finite plain JSON values')
}
const fingerprint = (value) => digest(JSON.stringify(stable(value)))

function validateAddress(input) {
  if (!input || !safeId(input.arcId) || !safeId(input.runId)) throw new Error('run receipt address requires safe nonempty arcId and runId')
}

function inspectAncestors(path) {
  const absolute = resolve(path)
  const { root } = parse(absolute)
  let cursor = root
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part)
    if (!existsSync(cursor)) continue
    const stat = lstatSync(cursor)
    if (stat.isSymbolicLink()) throw new Error('run receipt path crosses a symlink: ' + cursor)
    if (!stat.isDirectory()) throw new Error('run receipt ancestor is not a directory: ' + cursor)
  }
}

function ensureDir(path) {
  inspectAncestors(path)
  mkdirSync(path, { recursive: true })
  inspectAncestors(path)
  return realpathSync(path)
}

function runDir(cwd, address, create = false) {
  validateAddress(address)
  const base = join(buildingDir(cwd), 'run-receipts')
  const path = join(base, encodeURIComponent(address.arcId), encodeURIComponent(address.runId))
  if (!create && !existsSync(path)) return null
  const actual = create ? ensureDir(path) : (inspectAncestors(path), realpathSync(path))
  const root = realpathSync(buildingDir(cwd))
  if (!actual.startsWith(root + '/')) throw new Error('run receipt path escapes canonical building directory')
  return actual
}

function validateSnapshot(snapshot, address, revision, previousDigest) {
  if (!snapshot || snapshot.version !== VERSION || snapshot.arcId !== address.arcId || snapshot.runId !== address.runId
    || snapshot.revision !== revision || snapshot.previousDigest !== previousDigest) throw new Error('malformed run receipt snapshot identity or chain')
  validateRoleRunRequest(snapshot.request, snapshot.request.driverId)
  if (snapshot.request.arcId !== address.arcId || snapshot.request.runId !== address.runId) throw new Error('run receipt request identity mismatch')
  if (snapshot.requestFingerprint !== fingerprint(snapshot.request)) throw new Error('run receipt request fingerprint mismatch')
  if (!['pending', 'active', 'complete'].includes(snapshot.outcome)) throw new Error('malformed run receipt outcome')
  if (snapshot.pendingOperation !== null) {
    if (!['start', 'action'].includes(snapshot.pendingOperation.kind)
      || !/^[a-f0-9]{64}$/.test(snapshot.pendingOperation.actionFingerprint)) throw new Error('malformed pending operation')
  }
  if (snapshot.outcome === 'complete' && snapshot.terminalResult === null) throw new Error('complete run receipt lacks terminal result')
}

function readChain(cwd, address) {
  const dir = runDir(cwd, address, false)
  if (!dir) return []
  const names = readdirSync(dir).filter((name) => !(name.startsWith('.') && name.endsWith('.tmp')))
  if (names.some((name) => !/^\d{6}\.json$/.test(name))) throw new Error('run receipt directory contains a noncanonical revision')
  const sorted = names.sort()
  const chain = []
  let previousDigest = null
  let previousSnapshot = null
  for (let index = 0; index < sorted.length; index++) {
    const expected = String(index).padStart(6, '0') + '.json'
    if (sorted[index] !== expected) throw new Error('run receipt revision chain has a gap')
    const path = join(dir, expected)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('unsafe run receipt revision: ' + path)
    const bytes = readFileSync(path)
    let snapshot
    try { snapshot = JSON.parse(bytes) } catch (error) { throw new Error('malformed run receipt revision: ' + error.message) }
    validateSnapshot(snapshot, address, index, previousDigest)
    if (previousSnapshot) {
      if (!isDeepStrictEqual(snapshot.request, previousSnapshot.request) || snapshot.requestFingerprint !== previousSnapshot.requestFingerprint) throw new Error('run receipt request identity changed across revisions')
      if (previousSnapshot.nativeSessionId && snapshot.nativeSessionId !== previousSnapshot.nativeSessionId) throw new Error('run receipt native identity changed across revisions')
      if (previousSnapshot.terminalResult !== null && !isDeepStrictEqual(snapshot.terminalResult, previousSnapshot.terminalResult)) throw new Error('run receipt terminal result changed across revisions')
    }
    if (snapshot.pendingOperation) {
      const expectedOperation = operationRecord(snapshot.pendingOperation, snapshot.requestFingerprint)
      if (expectedOperation.actionFingerprint !== snapshot.pendingOperation.actionFingerprint) throw new Error('pending operation fingerprint mismatch')
    }
    const receipt = { path, digest: digest(bytes), snapshot }
    chain.push(receipt)
    previousDigest = receipt.digest
    previousSnapshot = snapshot
  }
  return chain
}

function latest(cwd, address) {
  const chain = readChain(cwd, address)
  return chain.length ? chain[chain.length - 1] : null
}

function conflict(reason, receipt, kind = 'receipt-conflict') {
  return { status: 'conflict', kind, reason, ...(receipt ? { receipt } : {}) }
}
function hold(reason, receipt, kind = 'unknown-native-outcome') {
  return { status: 'hold', kind, reason, ...(receipt ? { receipt } : {}) }
}

function publish(cwd, address, snapshot, sameMutation) {
  const dir = runDir(cwd, address, true)
  const path = join(dir, String(snapshot.revision).padStart(6, '0') + '.json')
  const bytes = jsonBytes(snapshot)
  if (publishImmutableFile(path, bytes)) return { status: 'recorded', receipt: { path, digest: digest(bytes), snapshot } }
  const incumbent = latest(cwd, address)
  if (incumbent?.snapshot.revision === snapshot.revision && sameMutation(incumbent.snapshot)) {
    return { status: 'duplicate', receipt: incumbent }
  }
  return conflict('immutable run receipt revision is already occupied by different evidence', incumbent)
}

function operationRecord(operation, requestFingerprint) {
  if (!operation || !['start', 'action'].includes(operation.kind)) throw new Error('operation kind must be start or action')
  if (operation.inputDigest !== undefined && (typeof operation.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(operation.inputDigest))) throw new Error('operation inputDigest must be a canonical byte digest')
  const inputBinding = operation.inputDigest === undefined ? {} : { inputDigest: operation.inputDigest }
  if (operation.kind === 'start') return { kind: 'start', ...inputBinding, actionFingerprint: fingerprint({ kind: 'start', requestFingerprint, ...inputBinding }) }
  if (!nonBlank(operation.action)) throw new Error('action operation requires a nonempty action')
  const actual = { kind: 'action', action: operation.action, payload: structuredClone(operation.payload), ...inputBinding }
  return { ...actual, actionFingerprint: fingerprint(actual) }
}

function verifyRawBytes(request, opts) {
  if (!Buffer.isBuffer(opts?.roleCardBytes) && !(opts?.roleCardBytes instanceof Uint8Array)) throw new Error('roleCardBytes are required')
  if (!Buffer.isBuffer(opts?.governanceBytes) && !(opts?.governanceBytes instanceof Uint8Array)) throw new Error('governanceBytes are required')
  if (digest(opts.roleCardBytes) !== request.roleCardDigest) throw new Error('roleCard bytes do not match roleCardDigest')
  if (digest(opts.governanceBytes) !== request.governanceDigest) throw new Error('governance bytes do not match governanceDigest')
}

function validateInitialSource(cwd, request) {
  const worktree = realpathSync(request.worktree)
  if (worktree !== realpathSync(cwd)) throw new Error('request worktree must match the current checkout')
  for (const field of ['baseHead', 'requestedHead']) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(request[field])) throw new Error(`request ${field} must be an exact commit id`)
    try {
      const commit = execFileSync('git', ['rev-parse', '--verify', `${request[field]}^{commit}`], { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
      if (commit !== request[field]) throw new Error('commit identity differs')
    } catch {
      throw new Error(`request ${field} is not an existing commit in the checkout`)
    }
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim()
  if (head !== request.requestedHead) throw new Error('requestedHead does not match current checkout HEAD')
}

export function persistRunRequest(cwd, request, opts) {
  validateRoleRunRequest(request, request?.driverId)
  verifyRawBytes(request, opts)
  const address = { arcId: request.arcId, runId: request.runId }
  validateAddress(address)
  const requestFingerprint = fingerprint(request)
  const operation = operationRecord(opts.operation, requestFingerprint)
  const current = latest(cwd, address)
  if (!current) {
    if (operation.kind !== 'start') return conflict('first run receipt operation must be start')
    validateInitialSource(cwd, request)
    const snapshot = {
      version: VERSION, arcId: address.arcId, runId: address.runId, revision: 0, previousDigest: null,
      request: structuredClone(request), requestFingerprint, pendingOperation: operation,
      nativeSessionId: null, latestObservation: null, terminalResult: null, outcome: 'pending',
    }
    return publish(cwd, address, snapshot, (other) => other.requestFingerprint === requestFingerprint
      && isDeepStrictEqual(other.pendingOperation, operation))
  }
  if (current.snapshot.requestFingerprint !== requestFingerprint || !isDeepStrictEqual(current.snapshot.request, request)) {
    return conflict('run address is already bound to a different request', current)
  }
  if (operation.kind === 'start') return { status: 'duplicate', receipt: current }
  if (current.snapshot.terminalResult !== null) return conflict('terminal run cannot accept another action', current)
  const historicalAction = readChain(cwd, address).find((receipt) => isDeepStrictEqual(receipt.snapshot.pendingOperation, operation))
  if (historicalAction) return { status: 'duplicate', receipt: historicalAction }
  if (current.snapshot.pendingOperation !== null) {
    if (isDeepStrictEqual(current.snapshot.pendingOperation, operation)) return { status: 'duplicate', receipt: current }
    return hold('a native operation is already pending and cannot be replayed or replaced', current)
  }
  if (opts.operation.expectedRevisionDigest !== current.digest) return conflict('stale expectedRevisionDigest for action', current)
  const snapshot = {
    ...structuredClone(current.snapshot), revision: current.snapshot.revision + 1, previousDigest: current.digest,
    pendingOperation: operation, outcome: 'pending',
  }
  return publish(cwd, address, snapshot, (other) => isDeepStrictEqual(other.pendingOperation, operation))
}

function mutate(cwd, input, apply, sameMutation) {
  validateAddress(input)
  const current = latest(cwd, input)
  if (!current) return conflict('run receipt does not exist')
  const duplicate = sameMutation(current.snapshot)
  if (duplicate) return { status: 'duplicate', receipt: current }
  if (input.expectedRevisionDigest !== current.digest) return conflict('stale expectedRevisionDigest', current)
  const next = apply(structuredClone(current.snapshot), current)
  if (next?.status) return next
  next.revision = current.snapshot.revision + 1
  next.previousDigest = current.digest
  return publish(cwd, input, next, sameMutation)
}

export function bindNativeSession(cwd, input) {
  if (!nonBlank(input?.nativeSessionId)) throw new Error('nativeSessionId is required')
  return mutate(cwd, input, (snapshot) => {
    if (snapshot.nativeSessionId !== null) return conflict('native session identity already differs')
    if (snapshot.pendingOperation?.kind !== 'start') return conflict('native session can bind only a pending start')
    snapshot.nativeSessionId = input.nativeSessionId
    return snapshot
  }, (snapshot) => snapshot.nativeSessionId === input.nativeSessionId)
}

function applyObservation(snapshot, input) {
  if (snapshot.terminalResult !== null) return conflict('terminal run cannot accept another observation')
  if (!snapshot.nativeSessionId) return conflict('observation arrived before native identity binding')
  const receipt = structuredClone(input.observation)
  if (!isDeepStrictEqual(receipt.handle?.request, snapshot.request)) return conflict('observation request identity mismatch')
  validateNativeObservation(receipt.observation, receipt.handle)
  if (receipt.handle.nativeSessionId !== snapshot.nativeSessionId) return conflict('observation native identity mismatch')
  if (receipt.transition?.prior?.arcId !== snapshot.request.arcId || !isDeepStrictEqual(receipt.transition?.prior?.authorityRef, snapshot.request.authorityRef)) return conflict('observation prior identity mismatch')
  const lastTransition = snapshot.latestObservation?.transition
  if (lastTransition && !isDeepStrictEqual(receipt.transition.prior, lastTransition.next)) return conflict('observation prior does not continue the last accepted lifecycle state')
  const recomputed = reduceArcTransition(receipt.transition?.prior, receipt.observation.event)
  if (!isDeepStrictEqual(recomputed, receipt.transition)) return conflict('observation transition does not match reducer output')
  snapshot.latestObservation = receipt
  if (snapshot.pendingOperation?.kind === 'start') {
    snapshot.pendingOperation = null
    snapshot.outcome = 'active'
  } else if (input.actionAcknowledgement) {
    const acknowledgement = input.actionAcknowledgement
    if (acknowledgement.nativeSessionId !== snapshot.nativeSessionId) return conflict('action acknowledgement native identity mismatch')
    const acknowledged = operationRecord(acknowledgement.operation)
    if (!isDeepStrictEqual(acknowledged, snapshot.pendingOperation)) return conflict('action acknowledgement does not match pending operation')
    snapshot.pendingOperation = null
    snapshot.outcome = 'active'
  }
  return snapshot
}
function historicalObservation(chain, observation) {
  const eventId = observation?.observation?.event?.eventId
  return chain.find((receipt) => receipt.snapshot.latestObservation?.observation?.event?.eventId === eventId)
}

export function persistRunObservation(cwd, input) {
  const chain = readChain(cwd, input)
  const currentBeforeObservation = chain.at(-1)
  if (currentBeforeObservation?.snapshot.terminalResult !== null) return conflict('terminal run cannot accept another observation', currentBeforeObservation)
  const priorEvent = historicalObservation(chain, input?.observation)
  if (priorEvent) {
    if (!isDeepStrictEqual(priorEvent.snapshot.latestObservation, input.observation)) return conflict('eventId was previously recorded with different observation bytes', priorEvent)
    if (!input.actionAcknowledgement) return { status: 'duplicate', receipt: priorEvent }
    const current = chain.at(-1)
    const acknowledgement = input.actionAcknowledgement
    if (acknowledgement.nativeSessionId !== current.snapshot.nativeSessionId) return conflict('action acknowledgement native identity mismatch', current)
    const acknowledged = operationRecord(acknowledgement.operation)
    if (current.snapshot.pendingOperation === null) {
      const historical = chain.some((receipt) => isDeepStrictEqual(receipt.snapshot.pendingOperation, acknowledged))
      return historical ? { status: 'duplicate', receipt: current } : conflict('action acknowledgement does not match historical operation', current)
    }
    if (input.expectedRevisionDigest !== current.digest) return conflict('stale expectedRevisionDigest', current)
    if (!isDeepStrictEqual(acknowledged, current.snapshot.pendingOperation)) return conflict('action acknowledgement does not match pending operation', current)
    const next = { ...structuredClone(current.snapshot), revision: current.snapshot.revision + 1, previousDigest: current.digest, pendingOperation: null, outcome: 'active' }
    return publish(cwd, input, next, (snapshot) => snapshot.pendingOperation === null && isDeepStrictEqual(snapshot.latestObservation, input.observation))
  }
  return mutate(cwd, input, (snapshot) => applyObservation(snapshot, input), (snapshot) => !input.actionAcknowledgement && isDeepStrictEqual(snapshot.latestObservation, input.observation))
}

export function persistRunResult(cwd, input) {
  if (!input || !input.result || typeof input.result !== 'object') throw new Error('terminal result is required')
  if (input.observation) {
    const priorEvent = historicalObservation(readChain(cwd, input), input.observation)
    if (priorEvent && !isDeepStrictEqual(priorEvent.snapshot.latestObservation, input.observation)) {
      return conflict('eventId was previously recorded with different observation bytes', priorEvent)
    }
  }
  return mutate(cwd, input, (snapshot) => {
    if (snapshot.terminalResult !== null) return conflict('a different terminal result is already recorded')
    if (!snapshot.nativeSessionId) return conflict('result arrived before native identity binding')
    if (input.observation) {
      const observed = applyObservation(snapshot, input)
      if (observed?.status) return observed
    }
    snapshot.pendingOperation = null
    snapshot.terminalResult = structuredClone(input.result)
    snapshot.outcome = 'complete'
    return snapshot
  }, (snapshot) => isDeepStrictEqual(snapshot.terminalResult, input.result)
    && (input.observation === undefined || isDeepStrictEqual(snapshot.latestObservation, input.observation)))
}

export function reconcileRunReceipt(cwd, input) {
  validateAddress(input)
  const current = latest(cwd, input)
  if (!current) return conflict('run receipt does not exist')
  if (current.snapshot.terminalResult !== null) {
    return { status: 'complete', result: structuredClone(current.snapshot.terminalResult), receipt: current }
  }
  const armEvidence = readExecutorRunArm(cwd, current.snapshot.request.phase)
  if (armEvidence.status !== 'valid') return hold('canonical executor arm is missing, legacy, or partial', current, 'identity-conflict')
  const arm = armEvidence.arm
  if (arm.runId !== current.snapshot.runId || arm.executorId !== current.snapshot.request.executorId
    || arm.requestFingerprint !== current.snapshot.requestFingerprint) return hold('executor arm identity conflicts with run receipt', current, 'identity-conflict')
  if (current.snapshot.pendingOperation?.kind === 'action') return hold('native action has no durable acknowledgement and must not be retried', current)
  const beaconPath = join(cwd, '.building', current.snapshot.request.phase + '-executor.jsonl')
  const beaconExists = existsSync(beaconPath)
  const beacon = readBeaconLine(beaconPath)
  if (beaconExists && !beacon) return hold('executor beacon is unparseable', current, 'identity-conflict')
  if (beacon) {
    const fields = ['runId', 'executorId', 'nativeSessionId', 'actionFingerprint', 'requestFingerprint', 'runReceiptDigest']
    const present = fields.filter((field) => Object.hasOwn(beacon, field))
    if (present.length > 0 && present.length !== fields.length) return hold('executor beacon carries partial run identity', current, 'identity-conflict')
    if (present.length === fields.length) {
      const chain = readChain(cwd, input)
      const referenced = chain.find((receipt) => receipt.digest === beacon.runReceiptDigest)
      if (!referenced || beacon.runId !== current.snapshot.runId || beacon.executorId !== current.snapshot.request.executorId
        || beacon.requestFingerprint !== current.snapshot.requestFingerprint
        || beacon.nativeSessionId !== referenced.snapshot.nativeSessionId
        || beacon.actionFingerprint !== referenced.snapshot.pendingOperation?.actionFingerprint) {
        return hold('beacon identity or referenced receipt conflicts with durable run', current, 'identity-conflict')
      }
      return { status: 'resume', operation: 'awaitEvent', receipt: current }
    }
  }
  if (current.snapshot.pendingOperation?.kind === 'start' && current.snapshot.nativeSessionId) return { status: 'resume', operation: 'awaitEvent', receipt: current }
  if (current.snapshot.pendingOperation !== null) return hold('native operation has no durable outcome evidence and must not be retried', current)
  return { status: 'active', receipt: current }
}

export function readRunReceipt(cwd, address, { revision, digest: requestedDigest, actionFingerprint } = {}) {
  if ([revision, requestedDigest, actionFingerprint].filter((value) => value !== undefined).length > 1
    || [requestedDigest, actionFingerprint].some((value) => value !== undefined && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)))) throw new Error('receipt lookup requires one revision, canonical digest, or action fingerprint')
  const chain = readChain(cwd, address)
  if (actionFingerprint !== undefined) return chain.find((receipt) => receipt.snapshot.pendingOperation?.actionFingerprint === actionFingerprint) ?? null
  if (requestedDigest !== undefined) return chain.find((receipt) => receipt.digest === requestedDigest) ?? null
  if (revision === undefined) return chain.at(-1) ?? null
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('receipt revision must be a nonnegative integer')
  return chain[revision] ?? null
}

// Sibling immutable native artifacts share these storage guards.
export { validateAddress as validateRunAddress, inspectAncestors as inspectReceiptAncestors, ensureDir as ensureReceiptDirectory }
