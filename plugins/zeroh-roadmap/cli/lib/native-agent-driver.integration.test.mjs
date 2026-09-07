#!/usr/bin/env node
/** Production native factory: real receipts/arm/detached transport, fake registered CLI only. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { NativeAgentDriver } from './native-agent-driver.mjs'
import { DEFAULT_AGENT_CARD } from './executor-arm.mjs'
import { resolveGovernance } from './governance.mjs'
import { MODEL_IDS } from './drivers.mjs'
import { makeFixtureRepo, writePhaseFile, git } from '../../test/fixture-consumer/harness.mjs'

const sha = (v) => createHash('sha256').update(v).digest('hex')
const parentAuthority = { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'integration supervisor' } }
const authorityRef = { status: 'known', envelopeDigest: 'sha256:integration', source: { kind: 'managed-host-receipt', ref: '38.5-integration' } }
const green = { ok: true, doc: { host: 'fixture', date: new Date().toISOString(), probes: ['version','capabilities','exec-smoke','resume-smoke','model-pin'].map((name) => ({ name, command: `codex ${name}`, output: 'fixture', pass: true })) } }

test('production NativeAgentDriver returns one schema result and a fresh instance recovers it after HEAD changes without another invocation', async (t) => {
  const root = makeFixtureRepo()
  const phase = 3855
  writePhaseFile(root, { phase, status: 'in-progress', arcId: 'FX', tasks: [{ id: '3855.1', done: false }] })
  const schema = { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { const: 'candidate' } } }
  const roleCardBytes = readFileSync(DEFAULT_AGENT_CARD)
  const governance = resolveGovernance(root, [join(root, 'roadmap', 'phases', `phase-${phase}.phase.ts`)])
  assert.equal(governance.hold, null)
  const governanceBytes = Buffer.from(JSON.stringify({ ...governance, outputSchemaDigest: sha(JSON.stringify(schema)) }, null, 2) + '\n')
  const originalHead = git(root, 'rev-parse', 'HEAD')
  const sourceCheckpoint = { baseHead: originalHead, requestedHead: originalHead, roleCardDigest: sha(roleCardBytes), governanceDigest: sha(governanceBytes), authorityRef }
  const binDir = join(root, 'fakebin'); mkdirSync(binDir)
  const count = join(root, 'codex-count'); const fake = join(binDir, 'codex')
  writeFileSync(fake, `#!/bin/sh\necho x >> '${count}'\nprintf '%s\\n' '{"type":"thread.started","thread_id":"native-integration-38"}' '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"status\\":\\"candidate\\"}"}}' '{"type":"turn.completed"}'\n`); chmodSync(fake, 0o755)
  const oldPath = process.env.PATH; process.env.PATH = `${binDir}${delimiter}${oldPath ?? ''}`; t.after(() => { process.env.PATH = oldPath })
  const options = { cwd: root, parentDriverId: 'codex', policy: { preset: 'codex' }, sessionId: 'parent-integration-38', parentAuthority, provenanceStore: { read: () => green, verify: () => 0 } }
  const input = { arcId: 'FX', phase, prompt: 'execute fixture', schema, plan: { roleId: 'phase-executor', driverId: 'codex', model: MODEL_IDS.SOL }, sourceCheckpoint }
  const first = await new NativeAgentDriver(options).runPhase(input)
  assert.deepEqual(first, { result: { status: 'candidate' } })
  writeFileSync(join(root, 'child-change'), 'changed after child\n'); git(root, 'add', 'child-change'); git(root, 'commit', '-q', '-m', 'child changed HEAD')
  assert.notEqual(git(root, 'rev-parse', 'HEAD'), originalHead)
  const second = await new NativeAgentDriver(options).runPhase(input)
  assert.deepEqual(second, first)
  assert.equal(readFileSync(count, 'utf8').trim().split('\n').length, 1)
})
