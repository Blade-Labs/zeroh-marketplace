import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { StringDecoder } from 'node:string_decoder'
import { buildingDir, publishImmutableFile } from './sidecar.mjs'
import { launchArgv, resumeArgv, projectNativeFrame, resolveDriver, validateNativeTerminal } from './drivers.mjs'
import { appendExecutorEvent, readBeaconLine } from './beacon.mjs'
import { spawnNativeChild } from './native-child-process.mjs'
import { validateRunAddress, inspectReceiptAncestors, ensureReceiptDirectory } from './run-receipt.mjs'
import * as defaultReceiptStore from './run-receipt.mjs'

const MAX_OUTPUT = 10 * 1024 * 1024
const hold = (reason) => ({ status: 'hold', kind: 'unknown-native-outcome', reason })
const validDigest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const canonical = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n')

function completionPath(ref) {
  validateRunAddress(ref)
  if (!validDigest(ref.pendingReceiptDigest) || typeof ref.cwd !== 'string' || realpathSync(ref.cwd) !== resolve(ref.cwd)) throw new Error('native operation requires a canonical worktree and pending receipt digest')
  const root = buildingDir(ref.cwd)
  const path = join(root, 'native-operations', encodeURIComponent(ref.arcId), encodeURIComponent(ref.runId), ref.pendingReceiptDigest, 'completion.json')
  inspectReceiptAncestors(dirname(path))
  return path
}

function pendingReceipt(ref, receiptStore) {
  completionPath(ref)
  const receipt = receiptStore.readRunReceipt(ref.cwd, ref, { digest: ref.pendingReceiptDigest })
  if (!receipt || receipt.digest !== ref.pendingReceiptDigest || !receipt.snapshot.pendingOperation) throw new Error('native operation reference does not match a canonical pending receipt')
  if (realpathSync(receipt.snapshot.request.worktree) !== realpathSync(ref.cwd)) throw new Error('native operation worktree does not match its receipt')
  return receipt
}

function validateLaunch(input, receiptStore) {
  const { cwd, runReceipt, launchOptions, parseOptions } = input
  const request = runReceipt?.snapshot?.request
  const ref = { cwd, arcId: request?.arcId, runId: request?.runId, pendingReceiptDigest: runReceipt?.digest }
  const actual = pendingReceipt(ref, receiptStore)
  if (!isDeepStrictEqual(actual, runReceipt)) throw new Error('pending run receipt does not match canonical durable bytes')
  if (!isDeepStrictEqual(launchOptions?.authority, request.authority) || launchOptions?.worktree !== request.worktree || typeof input.stdin !== 'string') throw new Error('native launch inputs do not match durable authority/worktree')
  const entry = resolveDriver(request.driverId)
  if (input.bin !== entry.bin || parseOptions?.driverId !== request.driverId || (launchOptions.model !== undefined && launchOptions.model !== request.model)) throw new Error('native launch does not match the registered request driver/model')
  const operation = actual.snapshot.pendingOperation
  if (operation.inputDigest !== createHash('sha256').update(Buffer.from(input.stdin)).digest('hex')) throw new Error('native stdin bytes differ from their pending operation binding')
  let argv
  if (operation.kind === 'start') argv = launchArgv(request.driverId, launchOptions)
  else {
    if (operation.action !== 'resume' || !actual.snapshot.nativeSessionId || operation.payload?.nativeSessionId !== actual.snapshot.nativeSessionId) throw new Error('unsupported native pending action')
    argv = resumeArgv(request.driverId, actual.snapshot.nativeSessionId, launchOptions)
    if (parseOptions.expectedSessionId !== actual.snapshot.nativeSessionId) throw new Error('native resume parser does not bind the stored session')
  }
  if (!isDeepStrictEqual(argv, input.argv)) throw new Error('native argv differs from the registered authority-bound invocation')
  if (parseOptions.requirePhaseResult) {
    if (!parseOptions.schema || typeof parseOptions.schema !== 'object') throw new Error('native phase launch requires an output schema')
    if (request.driverId === 'claude' && !isDeepStrictEqual(launchOptions.schema, parseOptions.schema)) throw new Error('native schema options differ')
    if (request.driverId === 'codex') {
      const expected = join(buildingDir(cwd), 'native-schemas', encodeURIComponent(ref.arcId), encodeURIComponent(ref.runId), 'phase-result.schema.json')
      inspectReceiptAncestors(dirname(expected))
      const stat = lstatSync(expected)
      if (launchOptions.outputSchemaPath !== expected || stat.isSymbolicLink() || !stat.isFile() || !readFileSync(expected).equals(canonical(parseOptions.schema))) throw new Error('native output schema differs from the immutable run artifact')
    }
  }
  return { ref, receipt: actual }
}

function validateCompletion(value, ref, receipt) {
  const keys = ['version','arcId','runId','pendingReceiptDigest','actionFingerprint','nativeSessionId','phaseResult','protocolTerminal','exitCode','signal','stdoutBytes','stderrBytes','stdoutDigest','stderrDigest']
  if (!value || Object.keys(value).sort().join('|') !== keys.sort().join('|') || value.version !== 1 || value.arcId !== ref.arcId || value.runId !== ref.runId || value.pendingReceiptDigest !== ref.pendingReceiptDigest
    || value.actionFingerprint !== receipt.snapshot.pendingOperation.actionFingerprint || typeof value.nativeSessionId !== 'string' || !value.nativeSessionId.trim()
    || !((Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.signal === null) || (value.exitCode === null && typeof value.signal === 'string' && value.signal.startsWith('SIG')))
    || !Number.isSafeInteger(value.stdoutBytes) || value.stdoutBytes < 0 || !Number.isSafeInteger(value.stderrBytes) || value.stderrBytes < 0 || value.stdoutBytes + value.stderrBytes > MAX_OUTPUT
    || !validDigest(value.stdoutDigest) || !validDigest(value.stderrDigest) || !validateNativeTerminal(receipt.snapshot.request.driverId, value.protocolTerminal)
    || !(value.phaseResult === null || (typeof value.phaseResult === 'object' && !Array.isArray(value.phaseResult)))) throw new Error('native operation completion is malformed or mismatched')
  if (receipt.snapshot.nativeSessionId && value.nativeSessionId !== receipt.snapshot.nativeSessionId) throw new Error('completion session differs from its durable request')
  return value
}

function matchingLive(ref, receipt) {
  const beacon = readBeaconLine(join(ref.cwd, '.building', `${receipt.snapshot.request.phase}-executor.jsonl`))
  if (!beacon || !Number.isFinite(beacon.ageMin) || beacon.ageMin < 0 || beacon.ageMin > 1.5 || !['background-run', 'heartbeat'].includes(beacon.event) || beacon.runId !== ref.runId || beacon.executorId !== receipt.snapshot.request.executorId
    || beacon.requestFingerprint !== receipt.snapshot.requestFingerprint || beacon.actionFingerprint !== receipt.snapshot.pendingOperation.actionFingerprint
    || beacon.runReceiptDigest !== ref.pendingReceiptDigest || !Number.isSafeInteger(beacon.pid) || beacon.pid <= 0 || beacon.pgid !== beacon.pid) return null
  try { process.kill(beacon.pid, 0); process.kill(-beacon.pgid, 0); return { status: 'running' } } catch { return null }
}

async function defaultSpawnProcess(input) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--supervise'], { cwd: input.cwd, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  return new Promise((resolveLaunch) => {
    let finished = false
    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (child.connected) child.disconnect()
      child.unref()
      resolveLaunch(result)
    }
    // Startup handoff only; native execution has no wall-clock cutoff.
    const timer = setTimeout(() => finish(hold('native supervisor did not acknowledge startup')), 10000)
    child.once('error', (error) => finish(hold(error.message)))
    child.once('exit', () => finish(hold('native supervisor exited before acknowledging startup')))
    child.on('message', (message) => {
      if (message?.type === 'ready') child.send(input, (error) => { if (error) finish(hold(error.message)) })
      else if (message?.type === 'started') finish({ pid: child.pid })
      else if (message?.type === 'refused') finish(hold(message.reason))
    })
  })
}

async function supervise(input) {
  const { ref, receipt } = validateLaunch(input, defaultReceiptStore)
  const { request, pendingOperation, requestFingerprint } = receipt.snapshot
  const path = completionPath(ref)
  const { child, completion } = spawnNativeChild(input.bin, input.argv, { cwd: input.cwd, detached: false, stdio: ['pipe', 'pipe', 'pipe'] })
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') }
  const counts = { stdout: 0, stderr: 0 }
  const decoder = new StringDecoder('utf8')
  let line = ''
  let invalid = null
  let identity = null
  let terminal = null
  let phaseResult = null
  let candidates = 0
  const reject = (reason) => {
    invalid ??= reason
    child.kill('SIGKILL')
    // Do not keep this supervisor alive on inherited pipes after its child exits.
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
  function frame(text) {
    if (!text.trim() || invalid) return
    let projected
    try { projected = projectNativeFrame(request.driverId, JSON.parse(text)) } catch { reject('native stream JSON is malformed'); return }
    if (!projected) return
    if (projected.kind === 'identity') {
      if (identity || typeof projected.nativeSessionId !== 'string' || !projected.nativeSessionId.trim()) { reject('native identity is missing or ambiguous'); return }
      identity = projected
    }
    if (projected.kind === 'terminal') {
      if (terminal) { reject('native terminal result is ambiguous'); return }
      terminal = projected
    }
    if (projected.phaseResult != null) { candidates++; phaseResult = projected.phaseResult }
  }
  function stdout(chunk) {
    line += decoder.write(chunk)
    let index
    while ((index = line.indexOf('\n')) !== -1) { frame(line.slice(0, index)); line = line.slice(index + 1) }
  }
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', (chunk) => {
    counts[stream] += chunk.length
    hashes[stream].update(chunk)
    if (counts.stdout + counts.stderr > MAX_OUTPUT) { reject('native output exceeded the bounded limit'); return }
    if (stream === 'stdout') stdout(chunk)
  })
  child.stdin.on('error', () => {}) // Native early exit is recorded by the completion owner.
  child.stdin.end(input.stdin)
  const stamp = () => appendExecutorEvent(input.cwd, request.phase, 'background-run', { pid: process.pid, pgid: process.pid, runId: request.runId, executorId: request.executorId, requestFingerprint, actionFingerprint: pendingOperation.actionFingerprint, runReceiptDigest: receipt.digest })
  await new Promise((accept, rejectSpawn) => { child.once('spawn', accept); child.once('error', rejectSpawn) })
  stamp()
  process.send?.({ type: 'started' })
  const heartbeat = setInterval(stamp, 30000)
  const outcome = await completion
  clearInterval(heartbeat)
  frame(line + decoder.end())
  if (invalid || outcome.error || !identity || !terminal) throw new Error(invalid ?? outcome.error ?? 'native completion lacks identity or terminal evidence')
  if (input.parseOptions.expectedSessionId && input.parseOptions.expectedSessionId !== identity.nativeSessionId) throw new Error('native resumed session identity differs')
  if (request.driverId === 'claude' && identity.model !== request.model) throw new Error('native model identity differs from requested model')
  if (terminal.nativeSessionId !== undefined && terminal.nativeSessionId !== identity.nativeSessionId) throw new Error('native terminal identity differs')
  if (candidates > 1 || (input.parseOptions.requirePhaseResult && candidates !== 1)) throw new Error('native phase result is missing or ambiguous')
  const value = { version: 1, arcId: ref.arcId, runId: ref.runId, pendingReceiptDigest: ref.pendingReceiptDigest,
    actionFingerprint: pendingOperation.actionFingerprint, nativeSessionId: identity.nativeSessionId, phaseResult,
    protocolTerminal: terminal.protocolTerminal, exitCode: outcome.code, signal: outcome.signal ?? null,
    stdoutBytes: counts.stdout, stderrBytes: counts.stderr, stdoutDigest: hashes.stdout.digest('hex'), stderrDigest: hashes.stderr.digest('hex') }
  validateCompletion(value, ref, receipt)
  const bytes = canonical(value)
  if (!publishImmutableFile(path, bytes) && !readFileSync(path).equals(bytes)) throw new Error('native completion conflicts with existing immutable bytes')
}

export function createNativeProcessTransport({ receiptStore = defaultReceiptStore, spawnProcess = defaultSpawnProcess, readLiveness = matchingLive } = {}) {
  const transport = {
    async launch(input) {
      try {
        const trusted = structuredClone(input)
        const { ref } = validateLaunch(trusted, receiptStore)
        const dir = dirname(completionPath(ref))
        ensureReceiptDirectory(dirname(dir))
        // The operation directory is occupied once. An uncertain prior launch is never replayed.
        try { mkdirSync(dir) } catch (error) {
          if (error.code !== 'EEXIST') throw error
          const observed = await transport.observe(ref)
          return observed.status === 'running' ? { ...observed, operationRef: ref } : observed
        }
        const child = await spawnProcess(trusted)
        if (child?.status === 'hold') return child
        if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return hold('native supervisor did not establish a process identity')
        child.unref?.()
        return { status: 'running', operationRef: ref }
      } catch (error) { return hold(error.message) }
    },
    async observe(ref) {
      try {
        const receipt = pendingReceipt(ref, receiptStore)
        const path = completionPath(ref)
        if (existsSync(path)) {
          const stat = lstatSync(path)
          if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_OUTPUT || realpathSync(path) !== path) throw new Error('native operation completion path is unsafe or oversized')
          const bytes = readFileSync(path)
          const value = JSON.parse(bytes)
          if (!bytes.equals(canonical(value))) throw new Error('native completion JSON bytes are noncanonical')
          return { status: 'complete', completion: validateCompletion(value, ref, receipt) }
        }
        return readLiveness(ref, receipt)?.status === 'running' ? { status: 'running' } : hold('native operation has no durable completion or live matching beacon')
      } catch (error) { return hold(error.message) }
    },
  }
  return transport
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--supervise' && process.send) {
  let received = false
  process.once('disconnect', () => { if (!received) process.exitCode = 1 })
  process.once('message', async (input) => {
    received = true
    try { await supervise(input) } catch (error) { if (process.connected) process.send({ type: 'refused', reason: error.message }); process.exitCode = 1 }
    finally { if (process.connected) process.disconnect() }
  })
  process.send({ type: 'ready' })
}
