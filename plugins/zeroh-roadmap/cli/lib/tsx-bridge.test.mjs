#!/usr/bin/env node
/**
 * Fixtures for cli/lib/tsx-bridge.mjs against a tmp consumer tree that imports the
 * REAL templates/schema.ts by absolute path (the validate-test fixture pattern):
 * consumerSchemaPath resolution + exists-check, bridgeImport of a valid + a
 * zod-invalid roadmap file, bridgeEval of a trivial script, and the verbatim
 * tsx-absent hint string-pin. Run: node --test cli/lib/tsx-bridge.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgeImport,
  bridgeEval,
  resolveTsxInvocation,
  consumerSchemaPath,
  BridgeError,
  TSX_ABSENT_HINT,
} from './tsx-bridge.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA = join(HERE, '..', '..', 'templates', 'schema.ts')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A tmp consumer whose lib/roadmap/schema.ts re-exports the REAL plugin schema. */
function makeConsumer() {
  const root = mkdtempSync(join(tmpdir(), 'zr-bridge-'))
  bases.push(root)
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${SCHEMA}'\n`)
  return root
}

const validPhase = `import { definePhase } from '${SCHEMA}'
export default definePhase({
  phase: 9101, name: 'a fixture bridge phase', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a demoable fixture outcome',
  tasks: [],
})
`
// name too short (min 5) — a clean Zod rejection at import time
const zodBadPhase = `import { definePhase } from '${SCHEMA}'
export default definePhase({
  phase: 9102, name: 'x', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a demoable fixture outcome',
  tasks: [],
})
`

test('consumerSchemaPath — resolves lib/roadmap/schema.ts; throws schema-missing otherwise', () => {
  const root = makeConsumer()
  assert.equal(consumerSchemaPath(root), join(root, 'lib', 'roadmap', 'schema.ts'))
  const bare = mkdtempSync(join(tmpdir(), 'zr-bridge-bare-'))
  bases.push(bare)
  assert.throws(() => consumerSchemaPath(bare), (e) => e instanceof BridgeError && e.kind === 'schema-missing')
})

test('bridgeImport — imports a valid roadmap file and returns its parsed default', () => {
  const root = makeConsumer()
  const f = join(root, 'phase-9101.phase.ts')
  writeFileSync(f, validPhase)
  const res = bridgeImport(f)
  assert.equal(res.ok, true)
  assert.equal(res.parsed.phase, 9101)
  assert.equal(res.parsed.status, 'backlog')
})

test('bridgeImport — a zod-invalid file classifies as kind:zod with issues (exit 3)', () => {
  const root = makeConsumer()
  const f = join(root, 'phase-9102.phase.ts')
  writeFileSync(f, zodBadPhase)
  const res = bridgeImport(f)
  assert.equal(res.ok, false)
  assert.equal(res.kind, 'zod')
  assert.ok(Array.isArray(res.issues) && res.issues.length > 0)
})

test('bridgeEval — runs an inline script and returns its stdout', () => {
  const root = makeConsumer()
  const res = bridgeEval(root, "process.stdout.write('BRIDGE_OK')")
  assert.equal(res.ok, true)
  assert.match(res.stdout, /BRIDGE_OK/)
})

test('TSX_ABSENT_HINT — the verbatim worktree-hazard line (string-pinned)', () => {
  assert.equal(
    TSX_ABSENT_HINT,
    'fresh worktrees have no node_modules — run npm ci in the consumer checkout (worktree node_modules are NOT shared)',
  )
})

// ── 1719.3 — resolved binary + content-keyed cache ────────────────────────────────────
const bareRoot = () => {
  const r = mkdtempSync(join(tmpdir(), 'zr-bridge-bare2-'))
  bases.push(r)
  return r
}
/** An injected exec that counts calls and returns a canned PARSED payload. */
const countingExec = (payload) => {
  const state = { calls: 0 }
  const exec = () => {
    state.calls++
    return 'PARSED:' + JSON.stringify(payload)
  }
  return { exec, state }
}

test('resolveTsxInvocation — local node_modules/.bin/tsx wins with empty prefix; else npx; memoized', () => {
  const withLocal = bareRoot()
  mkdirSync(join(withLocal, 'node_modules', '.bin'), { recursive: true })
  writeFileSync(join(withLocal, 'node_modules', '.bin', 'tsx'), '#!/bin/sh\n')
  const inv = resolveTsxInvocation(withLocal)
  assert.equal(inv.file, join(withLocal, 'node_modules', '.bin', 'tsx'))
  assert.deepEqual(inv.prefix, [])
  assert.equal(resolveTsxInvocation(withLocal), inv, 'memoized — same object per resolved root')

  const without = bareRoot()
  const inv2 = resolveTsxInvocation(without)
  assert.equal(inv2.file, 'npx')
  assert.deepEqual(inv2.prefix, ['--no-install', 'tsx'])
})

test('bridgeEval — composes the resolved invocation and passes -e + args through the injected exec', () => {
  const root = bareRoot() // no local tsx → npx fallback
  const calls = []
  const fakeExec = (file, args) => {
    calls.push({ file, args })
    return 'OUT'
  }
  const res = bridgeEval(root, 'SCRIPT_BODY', { args: ['ARG1'], exec: fakeExec })
  assert.equal(res.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].file, 'npx')
  assert.deepEqual(calls[0].args, ['--no-install', 'tsx', '-e', 'SCRIPT_BODY', 'ARG1'])
})

test('bridgeImport — cache HIT: two calls on an unchanged file make ONE exec (+ a disk mirror written)', () => {
  const root = makeConsumer()
  mkdirSync(join(root, 'roadmap'), { recursive: true }) // enables the disk mirror
  const f = join(root, 'roadmap', 'p.ts')
  writeFileSync(f, 'CONTENT_V1')
  const { exec, state } = countingExec({ phase: 42 })
  const r1 = bridgeImport(f, { consumerRoot: root, exec })
  const r2 = bridgeImport(f, { consumerRoot: root, exec })
  assert.equal(r1.parsed.phase, 42)
  assert.equal(r2.parsed.phase, 42)
  assert.equal(state.calls, 1, 'second call served from cache')
  const cacheDir = join(root, 'roadmap', '.gate', '.typed-cache')
  assert.ok(existsSync(cacheDir) && readdirSync(cacheDir).length === 1, 'a content-keyed disk mirror was written')
})

test('bridgeImport — cache MISS on content change: two execs (staleness structurally impossible)', () => {
  const root = makeConsumer()
  const f = join(root, 'p.ts')
  writeFileSync(f, 'V1')
  const { exec, state } = countingExec({ phase: 1 })
  bridgeImport(f, { consumerRoot: root, exec })
  writeFileSync(f, 'V2-different-bytes') // new content ⇒ new hash ⇒ miss
  bridgeImport(f, { consumerRoot: root, exec })
  assert.equal(state.calls, 2, 'changed content bypasses the cache')
})

test('bridgeImport — cache:false always execs (the phase-validate bypass)', () => {
  const root = makeConsumer()
  const f = join(root, 'p.ts')
  writeFileSync(f, 'V1')
  const { exec, state } = countingExec({ phase: 7 })
  bridgeImport(f, { consumerRoot: root, cache: false, exec })
  bridgeImport(f, { consumerRoot: root, cache: false, exec })
  assert.equal(state.calls, 2, 'cache:false never serves a cached parse')
})

test('bridgeImport — a FAILED parse is never cached (two calls ⇒ two execs)', () => {
  const root = makeConsumer()
  const f = join(root, 'bad.ts')
  writeFileSync(f, 'BROKEN')
  let calls = 0
  const failExec = () => {
    calls++
    const e = new Error('load boom')
    e.status = 4
    e.stderr = Buffer.from('load failed')
    throw e
  }
  const a = bridgeImport(f, { consumerRoot: root, exec: failExec })
  const b = bridgeImport(f, { consumerRoot: root, exec: failExec })
  assert.equal(a.ok, false)
  assert.equal(b.ok, false)
  assert.equal(calls, 2, 'failures re-parse every time — only ok results are cached')
})
