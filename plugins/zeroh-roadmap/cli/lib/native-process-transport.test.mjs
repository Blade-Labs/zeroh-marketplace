#!/usr/bin/env node
/** TEST-FIRST: detached native operations are addressed by durable receipt identity. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNativeProcessTransport } from './native-process-transport.mjs'
import { persistRunRequest, bindNativeSession } from './run-receipt.mjs'
import { MODEL_IDS, launchArgv } from './drivers.mjs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { buildingDir } from './sidecar.mjs'
import { appendExecutorEvent } from './beacon.mjs'

const sha = (v) => createHash('sha256').update(v).digest('hex')
const ROLE = Buffer.from('role: phase-executor\n')
const GOV = Buffer.from('governance\n')
function realPending(t, name = 'native-operation', { inputDigest = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`)); t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'test'], { cwd: root }); execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root }); execFileSync('git', ['commit', '--allow-empty', '-qm', 'seed'], { cwd: root })
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true }); writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), '{}\n')
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const authority = { parent: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'supervisor' } }, request: { profile: 'inherit', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: null }, effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false } }, native: { driver: 'codex', runtime: { version: null, verified: false }, argv: ['exec'], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['unverified'] } }
  authority.native.argv = launchArgv('codex', { worktree: root, authority, json: true })
  const request = { runId: `run-${name}`, executorId: 'executor-38', arcId: 'NATIVEGREEN', phase: 38, roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL, worktree: root, baseHead: head, requestedHead: head, roleCardDigest: sha(ROLE), governanceDigest: sha(GOV), authority, authorityRef: { status: 'known', envelopeDigest: 'sha256:authority', source: { kind: 'managed-host-receipt', ref: '38.5' } } }
  const recorded = persistRunRequest(root, request, { operation: inputDigest ? { kind: 'start', inputDigest: sha('') } : { kind: 'start' }, roleCardBytes: ROLE, governanceBytes: GOV })
  return { root, request, receipt: recorded.receipt }
}


function completionFor(fx, overrides = {}) {
  return { version: 1, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest, actionFingerprint: fx.receipt.snapshot.pendingOperation.actionFingerprint, nativeSessionId: 'native-38-5', phaseResult: { status: 'transport-exited' }, protocolTerminal: 'turn.completed', exitCode: 0, signal: null, stdoutBytes: 10, stderrBytes: 0, stdoutDigest: 'c'.repeat(64), stderrDigest: 'd'.repeat(64), ...overrides }
}

function completionPath(fx) {
  return join(buildingDir(fx.root), 'native-operations', encodeURIComponent(fx.request.arcId), encodeURIComponent(fx.request.runId), fx.receipt.digest, 'completion.json')
}

test('canonical completion is accepted while noncanonical JSON is held byte-intact', async (t) => {
  const fx = realPending(t, 'canonical')
  const ref = { cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest }
  const path = completionPath(fx); mkdirSync(join(path, '..'), { recursive: true })
  const completion = completionFor(fx); writeFileSync(path, JSON.stringify(completion, null, 2) + '\n')
  assert.deepEqual(await createNativeProcessTransport().observe(ref), { status: 'complete', completion })
  writeFileSync(path, JSON.stringify(completion) + '\n'); let before = readFileSync(path)
  assert.equal((await createNativeProcessTransport().observe(ref)).status, 'hold')
  assert.deepEqual(readFileSync(path), before)
  writeFileSync(path, '{corrupt\n'); before = readFileSync(path)
  assert.equal((await createNativeProcessTransport().observe(ref)).status, 'hold')
  assert.deepEqual(readFileSync(path), before)
})

test('historical pending completion remains readable after native identity creates a later receipt revision', async (t) => {
  const fx = realPending(t, 'after-bind')
  const ref = { cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest }
  const bound = bindNativeSession(fx.root, { arcId: fx.request.arcId, runId: fx.request.runId, expectedRevisionDigest: fx.receipt.digest, nativeSessionId: 'native-38-5' })
  assert.notEqual(bound.receipt.digest, fx.receipt.digest)
  const path = completionPath(fx); mkdirSync(join(path, '..'), { recursive: true })
  const completion = completionFor(fx); writeFileSync(path, JSON.stringify(completion, null, 2) + '\n')
  assert.deepEqual(await createNativeProcessTransport().observe(ref), { status: 'complete', completion })
})

test('completion with a different action fingerprint holds and preserves its immutable bytes', async (t) => {
  const fx = realPending(t, 'mismatch')
  const ref = { cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest }
  const path = join(buildingDir(fx.root), 'native-operations', encodeURIComponent(ref.arcId), encodeURIComponent(ref.runId), ref.pendingReceiptDigest, 'completion.json')
  mkdirSync(join(path, '..'), { recursive: true })
  const body = JSON.stringify({ version: 1, arcId: ref.arcId, runId: ref.runId, pendingReceiptDigest: ref.pendingReceiptDigest, actionFingerprint: 'f'.repeat(64), nativeSessionId: 'native', phaseResult: {}, protocolTerminal: 'turn.completed', exitCode: 0, signal: null, stdoutBytes: 1, stderrBytes: 0, stdoutDigest: 'c'.repeat(64), stderrDigest: 'd'.repeat(64) }, null, 2) + '\n'
  writeFileSync(path, body); const before = readFileSync(path)
  const held = await createNativeProcessTransport().observe(ref)
  assert.equal(held.status, 'hold')
  assert.deepEqual(readFileSync(path), before)
})

test('default detached owner survives its launch parent and publishes one canonical completion', async (t) => {
  const fx = realPending(t, 'detached')
  const binDir = join(fx.root, 'bin'); mkdirSync(binDir)
  const count = join(fx.root, 'invocations'); const fake = join(binDir, 'codex')
  writeFileSync(fake, `#!/bin/sh\necho x >> '${count}'\nsleep 0.2\nprintf '%s\n' '{"type":"thread.started","thread_id":"detached-native-38"}' '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'\n`); chmodSync(fake, 0o755)
  const parent = join(fx.root, 'launch-parent.mjs')
  writeFileSync(parent, `import {createNativeProcessTransport} from ${JSON.stringify(new URL('./native-process-transport.mjs', import.meta.url).href)}; const receipt=JSON.parse(process.argv[2]); const t=createNativeProcessTransport(); const r=await t.launch({bin:'codex',argv:JSON.parse(process.argv[3]),stdin:'',cwd:process.argv[4],runReceipt:receipt,launchOptions:{worktree:process.argv[4],authority:receipt.snapshot.request.authority,json:true},parseOptions:{driverId:'codex',model:${JSON.stringify(MODEL_IDS.SOL)}}}); process.stdout.write(JSON.stringify(r));`)
  const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` }
  const launched = JSON.parse(execFileSync(process.execPath, [parent, JSON.stringify(fx.receipt), JSON.stringify(launchArgv('codex', { worktree: fx.root, authority: fx.request.authority, json: true })), fx.root], { encoding: 'utf8', env }))
  assert.equal(launched.status, 'running')
  const observer = createNativeProcessTransport()
  const immediate = await observer.observe(launched.operationRef)
  assert.notEqual(immediate.status, 'complete')
  let observed
  for (let i = 0; i < 80; i++) { observed = await observer.observe(launched.operationRef); if (observed.status === 'complete') break; await new Promise((resolve) => setTimeout(resolve, 25)) }
  assert.equal(observed.status, 'complete')
  assert.equal(observed.completion.nativeSessionId, 'detached-native-38')
  assert.equal(observed.completion.actionFingerprint, fx.receipt.snapshot.pendingOperation.actionFingerprint)
  assert.equal(readFileSync(count, 'utf8').trim().split('\n').length, 1)
})

test('unsafe digest and symlinked completion ancestor refuse without changing external bytes', async (t) => {
  const { symlinkSync } = await import('node:fs')
  const fx = realPending(t, 'unsafe')
  const transport = createNativeProcessTransport()
  const unsafe = await transport.observe({ cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: '../escape' })
  assert.equal(unsafe.status, 'hold')
  const outside = mkdtempSync(join(tmpdir(), 'native-outside-')); t.after(() => rmSync(outside, { recursive: true, force: true }))
  const nativeRoot = join(buildingDir(fx.root), 'native-operations'); mkdirSync(join(nativeRoot, '..'), { recursive: true }); symlinkSync(outside, nativeRoot, 'dir')
  const external = join(outside, encodeURIComponent(fx.request.arcId), encodeURIComponent(fx.request.runId), fx.receipt.digest, 'completion.json')
  mkdirSync(join(external, '..'), { recursive: true }); writeFileSync(external, JSON.stringify(completionFor(fx)) + '\n'); const before = readFileSync(external)
  const held = await transport.observe({ cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest })
  assert.equal(held.status, 'hold')
  assert.deepEqual(readFileSync(external), before)
})

test('repeated launch of the same canonical pending receipt never spawns a second external action', async (t) => {
  const fx = realPending(t, 'duplicate-launch')
  let spawns = 0
  const transport = createNativeProcessTransport({ spawnProcess() { spawns++; return { pid: 3805, unref() {} } } })
  const input = { bin: 'codex', argv: launchArgv('codex', { worktree: fx.root, authority: fx.request.authority, json: true }), stdin: '', cwd: fx.root, runReceipt: fx.receipt, launchOptions: { worktree: fx.root, authority: fx.request.authority, json: true }, parseOptions: { driverId: 'codex', model: fx.request.model } }
  const first = await transport.launch(input)
  const second = await transport.launch(input)
  assert.equal(first.status, 'running')
  assert.ok(['running', 'hold'].includes(second.status))
  assert.equal(spawns, 1)
})


test('launch binds stdin digest and refuses altered input before spawning', async (t) => {
  const fx = realPending(t, 'stdin-binding')
  let spawns = 0
  const transport = createNativeProcessTransport({ spawnProcess() { spawns++; return { pid: 1, unref() {} } } })
  const held = await transport.launch({ bin: 'codex', argv: launchArgv('codex', { worktree: fx.root, authority: fx.request.authority, json: true }), stdin: 'altered', cwd: fx.root, runReceipt: fx.receipt, launchOptions: { worktree: fx.root, authority: fx.request.authority, json: true }, parseOptions: { driverId: 'codex', model: fx.request.model } })
  assert.equal(held.status, 'hold')
  assert.equal(spawns, 0)
})

test('legacy pending receipt without inputDigest cannot launch', async (t) => {
  const fx = realPending(t, 'legacy-input', { inputDigest: false })
  const legacy = fx.receipt
  let spawns = 0
  const held = await createNativeProcessTransport({ spawnProcess() { spawns++; return { pid: 1 } } }).launch({ bin: 'codex', argv: launchArgv('codex', { worktree: fx.root, authority: fx.request.authority, json: true }), stdin: '', cwd: fx.root, runReceipt: legacy, launchOptions: { worktree: fx.root, authority: fx.request.authority, json: true }, parseOptions: { driverId: 'codex', model: fx.request.model } })
  assert.equal(held.status, 'hold')
  assert.equal(spawns, 0)
})

test('completion requires a typed protocol terminal and accepts signal-only exit', async (t) => {
  const fx = realPending(t, 'terminal-shape')
  const ref = { cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest }
  const path = completionPath(fx); mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(completionFor(fx, { protocolTerminal: {} }), null, 2) + '\n')
  assert.equal((await createNativeProcessTransport().observe(ref)).status, 'hold')
  const completion = completionFor(fx, { exitCode: null, signal: 'SIGTERM', protocolTerminal: 'turn.completed' })
  writeFileSync(path, JSON.stringify(completion, null, 2) + '\n')
  assert.deepEqual(await createNativeProcessTransport().observe(ref), { status: 'complete', completion })
})

test('stale matching beacon cannot prove liveness even when its process group is live', async (t) => {
  const { spawn } = await import('node:child_process')
  const fx = realPending(t, 'stale-beacon')
  const ref = { cwd: fx.root, arcId: fx.request.arcId, runId: fx.request.runId, pendingReceiptDigest: fx.receipt.digest }
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' }); child.unref()
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} })
  const path = appendExecutorEvent(fx.root, fx.request.phase, 'background-run', { pid: child.pid, pgid: child.pid, runId: fx.request.runId, executorId: fx.request.executorId, actionFingerprint: fx.receipt.snapshot.pendingOperation.actionFingerprint, requestFingerprint: fx.receipt.snapshot.requestFingerprint, runReceiptDigest: fx.receipt.digest, log: 'native fixture' })
  const row = JSON.parse(readFileSync(path, 'utf8')); row.ts = new Date(Date.now() - 90_001).toISOString(); writeFileSync(path, JSON.stringify(row) + '\n')
  const held = await createNativeProcessTransport().observe(ref)
  assert.equal(held.status, 'hold')
  assert.equal(held.kind, 'unknown-native-outcome')
})

test('malformed native output releases the supervisor without a completion claim', async (t) => {
  const fx = realPending(t, 'malformed-output')
  const binDir = join(fx.root, 'bin'); mkdirSync(binDir)
  const fake = join(binDir, 'codex')
  writeFileSync(fake, '#!/usr/bin/env node\nsetTimeout(() => process.stdout.write("malformed\\n"), 100); setInterval(() => {}, 1000);\n')
  chmodSync(fake, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${binDir}${delimiter}${oldPath ?? ''}`
  t.after(() => { process.env.PATH = oldPath })
  const launchOptions = { worktree: fx.root, authority: fx.request.authority, json: true }
  const transport = createNativeProcessTransport()
  const launched = await transport.launch({ bin: 'codex', argv: launchArgv('codex', launchOptions), stdin: '', cwd: fx.root, runReceipt: fx.receipt, launchOptions, parseOptions: { driverId: 'codex' } })
  assert.equal(launched.status, 'running')
  let observed
  for (let i = 0; i < 80; i++) {
    observed = await transport.observe(launched.operationRef)
    if (observed.status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(observed.status, 'hold')
  assert.equal(observed.kind, 'unknown-native-outcome')
})
