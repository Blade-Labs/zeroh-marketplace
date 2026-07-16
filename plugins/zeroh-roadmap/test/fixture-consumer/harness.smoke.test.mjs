#!/usr/bin/env node
/**
 * harness.smoke.test.mjs — proves the fixture-consumer substrate itself (arc ROADCODE 1660.1)
 * BEFORE the wired suites lean on it: a scratch repo boots, `roadmap config check` + `roadmap
 * status` run green over it, the installed schema is byte-identical to templates/schema.ts
 * (pre-made decision 1), the fake slot honors FIXTURE_SLOT_<NAME>_EXIT + records verbatim
 * argv, `roadmap result check` parses through the symlinked tsx, and teardown leaves no tmp
 * dir behind. Run: node --test test/fixture-consumer/harness.smoke.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  makeFixtureRepo, runCli, writePhaseFile, writeArcFile, commitAll, readSlotLog,
  FAKE_SLOT, TEMPLATES_SCHEMA,
} from './harness.mjs'

test('smoke — a scratch repo boots and `roadmap config check` exits 0', () => {
  const root = makeFixtureRepo()
  const r = runCli(root, ['config', 'check'])
  assert.equal(r.code, 0, `config check failed:\n${r.stderr}`)
})

test('smoke — `roadmap status --json` parses; an armed fixture lane is surfaced', () => {
  const root = makeFixtureRepo()
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [9001] }] })
  writePhaseFile(root, { phase: 9001, status: 'backlog', arcId: 'FX', tasks: [{ id: '9001.1', done: false }] })
  commitAll(root, 'seed FX arc + member')
  assert.equal(runCli(root, ['arm', 'FX']).code, 0)
  const r = runCli(root, ['status', '--json'])
  assert.equal(r.code, 0, `status failed:\n${r.stderr}`)
  assert.ok(r.json && typeof r.json === 'object', 'status --json parses to an object')
  assert.ok(r.stdout.includes('FX'), 'the armed fixture lane FX is surfaced in status')
})

test('smoke — the installed schema is BYTE-IDENTICAL to templates/schema.ts (pre-made decision 1)', () => {
  const root = makeFixtureRepo()
  const installed = readFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), 'utf8')
  const template = readFileSync(TEMPLATES_SCHEMA, 'utf8')
  assert.equal(installed, template, 'lib/roadmap/schema.ts must be templates/schema.ts copied verbatim')
})

test('smoke — fake-slot honors FIXTURE_SLOT_<NAME>_EXIT and records verbatim argv JSONL', () => {
  const root = makeFixtureRepo()
  const log = join(root, '.slots-direct.jsonl')
  // red exit + verbatim argv recorded (asserted from the log, not narration)
  let code = 0
  try {
    execFileSync('bash', [FAKE_SLOT, 'unit', '--foo'], { env: { ...process.env, FIXTURE_SLOT_UNIT_EXIT: '1', FIXTURE_SLOT_LOG: log } })
  } catch (e) {
    code = e.status ?? 0
  }
  assert.equal(code, 1, 'FIXTURE_SLOT_UNIT_EXIT=1 → exit 1')
  const rec = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(rec[0].argv, ['unit', '--foo'], 'the full argv vector is recorded verbatim')
  assert.equal(rec[0].slot, 'unit')
})

test('smoke — `roadmap result check` succeeds inside a scratch repo via the symlinked tsx', () => {
  const root = makeFixtureRepo()
  const result = { phase: 9001, status: 'done', gateRounds: 1, compromises: [], skipped: [], hardcoded: [], surfaced: [], hardStops: [] }
  const r = runCli(root, ['result', 'check', '--phase', '9001'], {}, { input: JSON.stringify(result) })
  assert.equal(r.code, 0, `result check failed (tsx/schema resolution?):\n${r.stderr}`)
})

test('smoke — a green gate run drives the fake slots and records their argv in the slot log', () => {
  const root = makeFixtureRepo()
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [9002] }] })
  // A source-touching diff owned by the phase so the gate resolves real slots.
  writePhaseFile(root, { phase: 9002, status: 'in-progress', arcId: 'FX', kind: 'logic', testScope: 'full', tasks: [{ id: '9002.1', done: true }], keyFiles: ['src/plain.ts'] })
  commitAll(root, 'plan(roadmap): phase 9002 — start')
  const r = runCli(root, ['gate', 'run', '9002', '--json'])
  assert.equal(r.code, 0, `gate run should be green (all fake slots exit 0):\n${r.stderr}`)
  const slots = readSlotLog(root).map((s) => s.slot)
  assert.ok(slots.includes('lint') && slots.includes('types'), `expected lint+types in the slot log, got ${slots}`)
})

test('smoke — teardown is a plain rmSync (no scratch dir survives)', () => {
  const root = makeFixtureRepo()
  assert.ok(existsSync(root))
  rmSync(root, { recursive: true, force: true }) // the exact call the process-exit teardown makes
  assert.ok(!existsSync(root), 'rmSync removes the scratch dir cleanly — no residue')
})
