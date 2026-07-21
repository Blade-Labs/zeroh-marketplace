#!/usr/bin/env node
/**
 * arc-land.test.mjs — the eight landing blockers individually forced, contention refusal,
 * structural push discipline, RunnerSummary, and disarm (arc ROADCODE 1660.4; blocker 8 the
 * MECHRATCHET rank-6 stale-base/overlap gate). Landing is where prose historically leaked
 * worst (the ONEPROMPT branch:baseRef push); every assertion here reads an EXIT CODE + a
 * machine-named blocker / staleBase field / recorded git argv, never human prose.
 * Titles carry B0-B15. Run: node --test test/fixture-consumer/arc-land.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  makeFixtureRepo, makeIsolatedArc, gitShim, readGitLog, runCli, writePhaseFile, writeArcFile, commitAll, git,
} from './harness.mjs'

const CRITERIA = [{ id: 'c1', job: 'the fixture arc job here', surfaces: ['plugin'], signal: 'an observable signal here', tier: 'wired', bar: 'good enough to judge' }]

/** A DIRECT-model arc (sidecar worktree == primary on baseRef → no merge): the base for the
 *  persisted-state blockers B1-B5, B11, B12. Returns { root, member, arcId }. */
function directArc({ arcId = 'FX', member = 9301, exec = { phase: member, status: 'done', gateRounds: 1, hardStops: [] }, memberStatus = 'done', memberDone = true, criteria = true, recordPass = true } = {}) {
  const root = makeFixtureRepo()
  writeArcFile(root, { id: arcId, baseRef: 'develop', planes: [{ name: 'P', phases: [member] }], ...(criteria ? { acceptanceCriteria: CRITERIA } : {}) })
  writePhaseFile(root, { phase: member, status: memberStatus, arcId, kind: 'logic', tasks: [{ id: `${member}.1`, done: memberDone }], executionResult: exec })
  const bdir = join(root, 'roadmap', 'arcs', '.building')
  mkdirSync(bdir, { recursive: true })
  writeFileSync(join(bdir, `${arcId}.json`), JSON.stringify({ arcId, worktree: root, branch: 'develop' }))
  commitAll(root, `seed: direct ${arcId} arc`)
  if (recordPass) runCli(root, ['arc', 'record-validate', arcId, '--verdict', 'PASS'])
  return { root, member, arcId }
}
function patchConfig(root, fn) {
  const p = join(root, 'roadmap', 'roadmap.config.json')
  const cfg = JSON.parse(readFileSync(p, 'utf8'))
  fn(cfg)
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n')
}
const land = (root, env = {}) => runCli(root, ['arc', 'land', 'FX', '--json'], env)
const heldIds = (json) => (json.held ?? []).map((h) => h.id)

// ── B1-B7 — each blocker forced in isolation ────────────────────────────────────────────
test('B1 — a member executionResult status failed → exit 2 naming blocker 1', () => {
  const { root } = directArc({ exec: { phase: 9301, status: 'failed', gateRounds: 1, hardStops: [] } })
  const r = land(root)
  assert.equal(r.code, 2)
  assert.equal(r.json.action, 'blocked')
  assert.ok(heldIds(r.json).includes(1), `blocker 1 held: ${JSON.stringify(r.json.held)}`)
})

test('B2 — an undisposed [MULTI-REPO] hardStop → exit 2 naming blocker 2', () => {
  const { root } = directArc({ exec: { phase: 9301, status: 'done', gateRounds: 1, hardStops: [{ tag: '[MULTI-REPO]', text: 'touched the live marketplace checkout here' }] } })
  const r = land(root)
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(2), `blocker 2 held: ${JSON.stringify(r.json.held)}`)
})

test('B3 — acceptanceCriteria present with no verdict (and a GAPS verdict) → exit 2 naming blocker 3', () => {
  const { root } = directArc({ recordPass: false }) // no validate artifact
  let r = land(root)
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(3), `absent-with-criteria → blocker 3: ${JSON.stringify(r.json.held)}`)
  const gaps = directArc({ arcId: 'FX', member: 9302, recordPass: false })
  runCli(gaps.root, ['arc', 'record-validate', 'FX', '--verdict', 'GAPS'])
  r = land(gaps.root)
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(3), 'GAPS verdict → blocker 3')
})

test('B4 — a red arc-end suite (FIXTURE_SLOT_INTEGRATION_EXIT=1) → exit 2 naming blocker 4', () => {
  const { root } = directArc()
  const r = land(root, { FIXTURE_SLOT_INTEGRATION_EXIT: '1' })
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(4), `blocker 4 held: ${JSON.stringify(r.json.held)}`)
})

test('B5 — an OPEN-planned debt over maxOpenFollowups 0 → exit 2 naming blocker 5', () => {
  const { root } = directArc()
  // A registry that surfaces one OPEN-planned debt for FX (via-phase not done → stays open).
  writeFileSync(join(root, 'lib', 'roadmap', 'registry.ts'),
    'export async function discoverPhases(){ return { phases: [{ phase: 9401, status: "done", arcId: "FX", '
    + 'tasks: [{ id: "9401.1", transparencyReport: { compromises: "a genuine unresolved compromise here", hardcoded: "None", skipped: "None", limitations: "None" } }], '
    + 'debtResolutions: [{ ref: "9401.1.compromises", status: "planned", via: "phase-9999" }] }], errors: [] } }\n'
    + 'export async function discoverArcs(){ return { arcs: [] } }\n')
  commitAll(root, 'chore: registry surfaces an OPEN-planned debt')
  const r = land(root)
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(5), `blocker 5 held: ${JSON.stringify(r.json.held)}`)
})

test('B6 — a merge conflict against baseRef → exit 2 naming blocker 6', () => {
  const root = makeFixtureRepo()
  const iso = makeIsolatedArc(root, { arcId: 'FX', member: 9306 })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  // Conflicting edits to the SAME line on develop and on the arc branch.
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const plain = "DEVELOP"\n')
  commitAll(root, 'develop: touch plain.ts')
  writeFileSync(join(iso.worktree, 'src', 'plain.ts'), 'export const plain = "ARC"\n')
  git(iso.worktree, 'add', '-A'); git(iso.worktree, 'commit', '-q', '-m', 'arc: touch plain.ts')
  const r = land(root)
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(6), `blocker 6 held: ${JSON.stringify(r.json.held)}`)
})

test('B7 — baseRef moved WITH overlapping files → exit 2 naming blocker 7 (auto-reconcile refuses to touch an overlap)', () => {
  // The overlap-without-conflict topology: both sides changed src/shared.ts (different hunks).
  // A high ceiling keeps blocker 8 out — this pins blocker 7 alone under the drift.
  const { root } = staleTopology({ ceiling: 100, member: 9307 })
  const r = land(root)
  assert.equal(r.code, 2)
  assert.ok(heldIds(r.json).includes(7), `blocker 7 held: ${JSON.stringify(r.json.held)}`)
  assert.ok(!heldIds(r.json).includes(8), `behind 3 < ceiling 100 → blocker 8 not held: ${JSON.stringify(r.json.held)}`)
})

// ── B13-B15 — the stale-base / overlap gate (MECHRATCHET rank 6) ─────────────────────────
const SHARED = ['export const a = 1', 'export const b = 2', 'export const c = 3', 'export const d = 4', 'export const e = 5', 'export const f = 6'].join('\n') + '\n'

/** An isolated arc whose base advanced THREE commits past a low ceiling, with a
 *  both-sides-changed (non-conflicting, different-hunk) overlap file src/shared.ts. The arc
 *  edits line 1; develop edits line 6 + two unrelated files. Returns { root, iso }. */
function staleTopology({ ceiling = 2, member = 9314 } = {}) {
  const root = makeFixtureRepo()
  writeFileSync(join(root, 'src', 'shared.ts'), SHARED)
  commitAll(root, 'develop: seed the shared file') // in the branch point, so it is common ancestor
  const iso = makeIsolatedArc(root, { arcId: 'FX', member })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  patchConfig(root, (c) => { c.mergePolicy.staleBaseCeiling = ceiling })
  // Arc-branch edit (in the worktree): change line 1.
  writeFileSync(join(iso.worktree, 'src', 'shared.ts'), SHARED.replace('export const a = 1', 'export const a = 100'))
  git(iso.worktree, 'add', '-A'); git(iso.worktree, 'commit', '-q', '-m', 'arc: edit shared line 1')
  // develop advances THREE: edit line 6 (different hunk → overlap without conflict) + two unrelated files.
  writeFileSync(join(root, 'src', 'shared.ts'), SHARED.replace('export const f = 6', 'export const f = 600'))
  commitAll(root, 'develop: edit shared line 6')
  writeFileSync(join(root, 'src', 'other1.ts'), 'export const o1 = 1\n'); commitAll(root, 'develop: other1')
  writeFileSync(join(root, 'src', 'other2.ts'), 'export const o2 = 1\n'); commitAll(root, 'develop: other2')
  return { root, iso }
}

test('B13 — base beyond a low ceiling with a both-sides-changed file → exit 2 naming blocker 8, staleBase.overlapFiles names the file', () => {
  const { root } = staleTopology({ ceiling: 2, member: 9314 })
  const r = land(root)
  assert.equal(r.code, 2)
  assert.equal(r.json.action, 'blocked')
  assert.ok(heldIds(r.json).includes(8), `blocker 8 held: ${JSON.stringify(r.json.held)}`)
  assert.ok(r.json.staleBase, 'the blocked JSON carries the staleBase reconciliation object')
  assert.equal(r.json.staleBase.behind, 3, `three develop advances → behind 3: ${JSON.stringify(r.json.staleBase)}`)
  assert.ok(r.json.staleBase.overlapFiles.includes('src/shared.ts'), `overlap names the both-sides file (machine field): ${JSON.stringify(r.json.staleBase)}`)
})

test('B14 — --force-stale acknowledges blocker 8 (held excludes 8) yet still emits the reconciliation overlap list', () => {
  const { root } = staleTopology({ ceiling: 2, member: 9315 })
  const r = runCli(root, ['arc', 'land', 'FX', '--json', '--force-stale'])
  assert.equal(r.code, 2, `blocker 7 (baseRef moved) legitimately remains → still exit 2; stderr:\n${r.stderr}`)
  assert.ok(!heldIds(r.json).includes(8), `--force-stale clears blocker 8 alone: ${JSON.stringify(r.json.held)}`)
  assert.ok(r.json.staleBase && r.json.staleBase.overlapFiles.includes('src/shared.ts'), `the overlap list survives the acknowledgment: ${JSON.stringify(r.json.staleBase)}`)
})

test('B15 — baseRef moved with ZERO overlapping files → auto-reconciled (baseRef merged into the arc branch) and LANDS exit 0', () => {
  const root = makeFixtureRepo()
  makeIsolatedArc(root, { arcId: 'FX', member: 9316 })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  // Repo-level identity: the CLI's own reconcile merge commits in the worktree and must
  // not depend on the runner's global git config.
  git(root, 'config', 'user.email', 'fixture@test')
  git(root, 'config', 'user.name', 'fixture')
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const plain = 2\n')
  commitAll(root, 'develop: one advance, zero overlap with the arc files')
  const r = land(root)
  assert.equal(r.code, 0, `zero-overlap drift must auto-reconcile and land; stderr:\n${r.stderr}\njson: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.action, 'landed')
  assert.ok(r.json.reconciles?.some((x) => x.when === 'pre-suite' && x.merged === true), `the pre-suite reconcile is recorded: ${JSON.stringify(r.json.reconciles)}`)
  assert.match(git(root, 'log', '--format=%s', 'develop'), /arc FX member work/, 'the arc commit landed on develop')
  assert.match(git(root, 'log', '--format=%s', 'develop'), /one advance, zero overlap/, 'the develop drift commit survived')
})

// ── B8 contention + B9 push discipline + B12 hold ───────────────────────────────────────
test('B8 — primary HEAD ≠ baseRef → refuse (exit 2), and the primary is NEVER branch-switched', () => {
  const root = makeFixtureRepo()
  makeIsolatedArc(root, { arcId: 'FX', member: 9308 })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  git(root, 'checkout', '-q', '-b', 'feature/sibling') // a sibling parked the primary off baseRef
  const shim = gitShim(root)
  const r = land(root, shim.env)
  assert.equal(r.code, 2)
  const held = r.json.held ?? []
  assert.match(JSON.stringify(held), /never branch-switch|not baseRef|not develop/, `contention reason: ${JSON.stringify(held)}`)
  const argv = readGitLog(shim.logPath)
  assert.ok(!argv.some((a) => a.includes('merge') && !a.includes('merge-tree')), 'no merge attempted on the contended primary')
  assert.ok(!argv.some((a) => a.includes('checkout') || a.includes('switch')), 'the primary is never branch-switched under a sibling')
})

test('B9 — structural push discipline: no branch:baseRef refspec ever; no push under autonomousPushRefs []', () => {
  const root = makeFixtureRepo()
  makeIsolatedArc(root, { arcId: 'FX', member: 9309 })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  const shim = gitShim(root)
  const r = land(root, shim.env) // autonomousPushRefs [] (the fixture default)
  assert.equal(r.code, 0, `clean landing expected; stderr:\n${r.stderr}`)
  const argv = readGitLog(shim.logPath)
  assert.ok(!argv.some((a) => a.some((tok) => /^[^\s:]+:[^\s:]+$/.test(tok))), 'NO <branch>:<baseRef> refspec token anywhere in the recorded git argv')
  assert.ok(!argv.some((a) => a.includes('push')), 'autonomousPushRefs [] → no push call at all')

  // variant: authorize develop → exactly `git -C <primary> push origin develop`
  const root2 = makeFixtureRepo()
  makeIsolatedArc(root2, { arcId: 'FX', member: 9310 })
  runCli(root2, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  patchConfig(root2, (c) => { c.mergePolicy.autonomousPushRefs = ['develop'] })
  const shim2 = gitShim(root2)
  land(root2, shim2.env)
  const argv2 = readGitLog(shim2.logPath)
  const push = argv2.find((a) => a.includes('push'))
  assert.ok(push, 'develop authorized → a push fires')
  assert.deepEqual(push, ['-C', root2, 'push', 'origin', 'develop'], `push is exactly origin develop from the primary: ${JSON.stringify(push)}`)
})

test('B12 — mergePolicy arcIntegration hold → exit 3 held-for-user, nothing merged', () => {
  const { root } = directArc()
  patchConfig(root, (c) => { c.mergePolicy.arcIntegration = 'hold' })
  const shim = gitShim(root)
  const r = land(root, shim.env)
  assert.equal(r.code, 3)
  assert.equal(r.json.action, 'held')
  assert.ok(!readGitLog(shim.logPath).some((a) => a.includes('merge') && !a.includes('merge-tree')), 'held → no merge')
})

// ── B10 green landing + B11 disarm ──────────────────────────────────────────────────────
test('B10 — a clean isolated arc lands: exit 0, the arc commit is reachable from LOCAL develop, RunnerSummary written', () => {
  const root = makeFixtureRepo()
  makeIsolatedArc(root, { arcId: 'FX', member: 9311 })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  const r = land(root)
  assert.equal(r.code, 0, `clean landing expected; stderr:\n${r.stderr}`)
  assert.equal(r.json.action, 'landed')
  assert.match(git(root, 'log', '--format=%s', 'develop'), /arc FX member work/, 'the arc commit is reachable from the primary local develop')
  assert.ok(existsSync(join(root, 'roadmap', 'arc-summary.json')), 'the RunnerSummary pointer is written (validates against RunnerSummaryShape)')
  assert.ok(!existsSync(join(root, 'roadmap', 'arcs', '.building', 'FX.json')), 'the sidecar is cleaned')
})

test('B11 — disarm frees the lane (a second arm succeeds); --paused preserves the lane', () => {
  const root = makeFixtureRepo()
  writeArcFile(root, { id: 'FX', baseRef: 'develop', planes: [{ name: 'P', phases: [9312] }] })
  writePhaseFile(root, { phase: 9312, status: 'backlog', arcId: 'FX', tasks: [{ id: '9312.1', done: false }] })
  commitAll(root, 'seed FX')
  assert.equal(runCli(root, ['arm', 'FX']).code, 0)
  assert.equal(runCli(root, ['disarm', 'FX']).code, 0, 'disarm exits 0')
  assert.equal(runCli(root, ['arm', 'FX']).code, 0, 'the lane is free → a second arm succeeds')
  // --paused preserves the sidecar (the lane stays visibly claimed)
  assert.equal(runCli(root, ['disarm', 'FX', '--paused']).code, 0)
  assert.ok(existsSync(join(root, 'roadmap', 'arcs', '.building', 'FX.json')), '--paused leaves the sidecar in place')
})

// ── harness smoke — the isolated topology + git shim actually record ─────────────────────
test('B0 — makeIsolatedArc + gitShim: a clean landing records a non-empty git argv stream', () => {
  const root = makeFixtureRepo()
  makeIsolatedArc(root, { arcId: 'FX', member: 9313 })
  runCli(root, ['arc', 'record-validate', 'FX', '--verdict', 'PASS'])
  const shim = gitShim(root)
  land(root, shim.env)
  assert.ok(readGitLog(shim.logPath).length > 0, 'the git shim recorded the landing argv stream')
})
