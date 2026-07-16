#!/usr/bin/env node
/**
 * error-injection.test.mjs — the fixture-e2e bar (arc ROADCODE 1660.6, E1-E3): a deliberately
 * injected banding / scoping / landing error is caught by an ASSERTION, not by a reviewer
 * reading prose. Each case hard-codes the wrong thing a narrating session would have claimed
 * and asserts the CLI output refutes it. Run: node --test test/fixture-consumer/error-injection.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, runCli, writePhaseFile, commitPaths, commitAll, writeArcFile, gitShim, readGitLog, git } from './harness.mjs'

function seedPhase(root, phaseObj, { touch = [], create = {} } = {}) {
  const pf = writePhaseFile(root, phaseObj)
  const paths = [pf]
  for (const [rel, body] of Object.entries(create)) { writeFileSync(join(root, rel), body); paths.push(rel) }
  for (const rel of touch) { writeFileSync(join(root, rel), readFileSync(join(root, rel), 'utf8') + `\n// touched ${phaseObj.phase}\n`); paths.push(rel) }
  commitPaths(root, `feat: phase ${phaseObj.phase} — start`, paths)
}

// ── E1 — wrong band: the CLI output REFUTES a deliberately wrong hand-claim ───────────────
test('E1 — a hand-claimed band that contradicts the classifyBand echo is caught by the assertion', () => {
  // taskCount 10 — a narrating session might CLAIM "mid"; the CLI says heavy.
  const heavyRoot = makeFixtureRepo()
  seedPhase(heavyRoot, { phase: 9610, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: Array.from({ length: 10 }, (_, i) => ({ id: `9610.${i + 1}`, done: false })) })
  const heavy = runCli(heavyRoot, ['gate', 'plan', '9610', '--json'])
  const CLAIMED_MID = 'mid'
  assert.notEqual(heavy.json.band, CLAIMED_MID, 'a 10-task phase is NOT mid — the assertion refutes the wrong claim')
  assert.equal(heavy.json.band, 'heavy')

  // taskCount 2 — a narrating session might CLAIM "mid"; the CLI says trivial.
  const trivialRoot = makeFixtureRepo()
  seedPhase(trivialRoot, { phase: 9611, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: [{ id: '9611.1', done: false }, { id: '9611.2', done: false }] })
  const trivial = runCli(trivialRoot, ['gate', 'plan', '9611', '--json'])
  assert.notEqual(trivial.json.band, CLAIMED_MID)
  assert.equal(trivial.json.band, 'trivial')
})

// ── E2 — wrong scope: BOTH declarations below the floor refused in JSON ──────────────────
test('E2 — testScope static + reviewScope light over a src/spine/** diff → exit 2 refusing BOTH', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9620, status: 'in-progress', arcId: 'FX', kind: 'logic', testScope: 'static', reviewScope: 'light', tasks: [{ id: '9620.1', done: false }] }, { touch: ['src/spine/dummy.ts'] })
  const r = runCli(root, ['gate', 'plan', '9620', '--json'])
  assert.equal(r.code, 2, 'a declaration below the floor is the exit code, not a paragraph')
  assert.ok(r.json.testScope.refused, `testScope refused: ${JSON.stringify(r.json.testScope)}`)
  assert.ok(r.json.reviewScope.refused, `reviewScope refused: ${JSON.stringify(r.json.reviewScope)}`)
})

// ── E3 — landing shortcut: a narrated gate/landing can no longer sneak through ────────────
test('E3(a) — a phase flipped done with NO green GateRunReport → phase validate exit 2', () => {
  const root = makeFixtureRepo()
  seedPhase(root, { phase: 9630, status: 'in-progress', arcId: 'FX', kind: 'logic', testScope: 'full', tasks: [{ id: '9630.1', done: true }] }, { touch: ['src/plain.ts'] })
  // A RED gate run writes a non-green report on disk.
  const red = runCli(root, ['gate', 'run', '9630'], { FIXTURE_SLOT_LINT_EXIT: '1' })
  assert.equal(red.code, 2, 'the gate run is red')
  // Now flip the phase to done anyway (the shortcut) — validate refuses it against the red report.
  writePhaseFile(root, { phase: 9630, status: 'done', arcId: 'FX', kind: 'logic', tasks: [{ id: '9630.1', done: true }] })
  const v = runCli(root, ['phase', 'validate', '9630'])
  assert.equal(v.code, 2, 'a done flip with no GREEN gate report is refused')
  assert.match(v.stderr, /green gate report|done-without-green/, 'names the missing/red gate report')
})

test('E3(b) — arc land with a member missing executionResult → exit 2 before ANY git mutation', () => {
  const root = makeFixtureRepo()
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [9631] }], acceptanceCriteria: [{ id: 'c1', job: 'the fixture arc job here', surfaces: ['plugin'], signal: 'observable here now', tier: 'wired', bar: 'good enough to judge' }] })
  // A DONE member deliberately WITHOUT executionResult (the landing precondition).
  writePhaseFile(root, { phase: 9631, status: 'done', arcId: 'FX', kind: 'logic', tasks: [{ id: '9631.1', done: true }] })
  const bdir = join(root, 'roadmap', 'arcs', '.building')
  mkdirSync(bdir, { recursive: true })
  writeFileSync(join(bdir, 'FX.json'), JSON.stringify({ arcId: 'FX', worktree: root, branch: 'develop' }))
  commitAll(root, 'seed: FX member with no executionResult')
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  const shim = gitShim(root)
  const r = runCli(root, ['arc', 'land', 'FX', '--json'], shim.env)
  assert.equal(r.code, 2, 'the missing executionResult precondition refuses the landing')
  assert.match(JSON.stringify(r.json.held ?? []), /executionResult/, 'the blocker names the missing executionResult')
  // proves the refusal mutated NOTHING — no mutating git verb was recorded (only read-only probes)
  const mutating = readGitLog(shim.logPath).filter((a) => a.some((tok) => /^(merge|push|commit|checkout|switch|worktree|reset|branch)$/.test(tok)))
  assert.equal(mutating.length, 0, `the refused landing mutated nothing: ${JSON.stringify(mutating)}`)
})
