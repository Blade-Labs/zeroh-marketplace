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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  bridgeImport,
  bridgeEval,
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
