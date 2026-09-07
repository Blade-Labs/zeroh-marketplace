#!/usr/bin/env node
/**
 * derive-resume.test.mjs — the KILL/RESUME derivation fixtures (arc ROADCODE 1657.3,
 * §8 risk 5). The general ladder is proven in derive.test.mjs; THIS suite proves the
 * states a real dead session leaves on disk, over REAL scratch-git commits (commit
 * verification, the em-dash startSha rule, and idempotence must run against actual git,
 * not a mock). Git falls through the exec seam to the real binary; only the debt census
 * is faked (empty ⇒ swept). No fixture writes a RESUME.md — resume derivation reads
 * commits/flags/sidecars ONLY (locked decision 3). Run: node --test cli/lib/derive-resume.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { consumerSchemaPath } from './roadmap-root.mjs'
import { join, dirname, resolve } from 'node:path'
import { plantPrior } from '../testdata/eval.test-support.mjs'
import { deriveArcPosition } from './derive.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
import { defaultExec } from './exec.mjs'

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const tsSrc = (obj) =>
  'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
const CONFIG = { configVersion: 1, gateCommands: { lint: 'l', types: 't', unit: 'u', integration: 'i', build: 'b', e2e: 'none', emit: 'e' } }

/** git in the repo (identity pinned; quiet). */
const g = (root, ...a) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function newRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-resume-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  symlinkSync(consumerSchemaPath(resolve(HERE, '..', '..', '..', '..')), join(root, 'lib', 'roadmap', 'schema.ts'))
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  g(root, 'init', '-q')
  return root
}
function commit(root, msg, files = { 'work.txt': String(Math.random()) }) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, body)
  }
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', msg)
  return g(root, 'rev-parse', 'HEAD')
}
function writeArc(root, arcId, arc) {
  writeFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), tsSrc({ id: arcId, baseRef: 'develop', ...arc }))
}
function writePhase(root, p) {
  writeFileSync(join(root, 'roadmap', 'phases', `phase-${p.phase}.phase.ts`), tsSrc(p))
}
function writeSidecar(root, arcId, sidecar) {
  const dir = join(root, 'roadmap', 'arcs', '.building')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${arcId}.json`), JSON.stringify({ arcId, ...sidecar }))
}
/** exec seam: census faked empty (swept), everything else (git) real. */
const execSeam = (file, args, opts) => {
  if (args.some((a) => String(a).endsWith('debt-census.mts'))) {
    writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({ entries: [] }))
    return { status: 0, stdout: '', stderr: '' }
  }
  return defaultExec(file, args, opts)
}

test('KILL-BETWEEN-PHASES — member K done with real commits, K+1 backlog, stale sidecar → run-phase K+1', () => {
  const root = newRepo()
  writeArc(root, 'A', { planes: [{ name: 'P', phases: [20, 21] }] })
  writePhase(root, { phase: 20, status: 'done', arcId: 'A', tasks: [{ id: '20.1', done: true }] })
  writePhase(root, { phase: 21, status: 'backlog', arcId: 'A', tasks: [{ id: '21.1', done: false }] })
  writeSidecar(root, 'A', { worktree: root, branch: 'dev' }) // killed session never cleaned up
  commit(root, 'seed roadmap')
  commit(root, 'feat: phase 20 — 20.1 done')

  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: execSeam })
  assert.equal(pos.action, 'run-phase')
  assert.equal(pos.phase, 21)
  assert.deepEqual(pos.done, [20])
  assert.equal(pos.resume, undefined, 'a between-phases kill leaves no mid-phase resume')
})

test('KILL-MID-PHASE-POST-COMMIT — in-progress K, K.1/K.2 committed, K.3 open; startSha = parent of the move commit (em-dash guarded)', () => {
  const root = newRepo()
  writeArc(root, 'A', { planes: [{ name: 'P', phases: [20] }] })
  // Phase file with three tasks — 20.1 carries a real commit: sha, 20.2 relies on the
  // --grep fallback (no commit field), 20.3 still open.
  const seed = commit(root, 'seed roadmap')
  // A COLLIDING phase-200 commit BEFORE phase 20 starts: the em-dash boundary must keep
  // `phase 20 —` from matching `phase 200 —` (decision 3 collision guard).
  const collider = commit(root, 'feat: phase 200 — unrelated collider')
  const moveCommit = commit(root, 'docs(roadmap): phase 20 — move to in-progress')
  const t1 = commit(root, 'feat: phase 20 — 20.1 first task')
  commit(root, 'feat: phase 20 — 20.2 second task')

  writePhase(root, {
    phase: 20,
    status: 'in-progress',
    arcId: 'A',
    tasks: [
      { id: '20.1', done: true, commit: t1 },
      { id: '20.2', done: true }, // no commit field → --grep "20.2" fallback finds its commit
      { id: '20.3', done: false },
    ],
  })
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', 'record phase 20 in-progress file')

  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: execSeam })
  assert.equal(pos.action, 'resume-phase')
  assert.equal(pos.phase, 20)
  assert.equal(pos.resume.midPhase, true)
  assert.deepEqual(pos.resume.doneTasks, ['20.1', '20.2'])
  assert.deepEqual(pos.resume.unverifiedDoneFlags, [])
  const expectedStart = g(root, 'rev-parse', `${moveCommit}^`)
  assert.equal(pos.resume.startSha, expectedStart, 'startSha = parent of the move-to-in-progress commit')
  assert.equal(expectedStart, collider, 'the parent is the collider commit, not confused by phase 200')
  assert.notEqual(pos.resume.startSha, seed)
})

test('UNVERIFIED-DONE — a done:true task whose commit sha does not exist and greps to nothing → resume, task flagged + out of scope', () => {
  const root = newRepo()
  writeArc(root, 'A', { planes: [{ name: 'P', phases: [30] }] })
  commit(root, 'seed roadmap')
  commit(root, 'docs(roadmap): phase 30 — move to in-progress')
  commit(root, 'feat: phase 30 — 30.1 real work')
  const fakeSha = '0'.repeat(40)
  writePhase(root, {
    phase: 30,
    status: 'in-progress',
    arcId: 'A',
    tasks: [
      { id: '30.1', done: true }, // grep "30.1" hits the real commit → verified
      { id: '30.2', done: true, commit: fakeSha }, // sha absent + no "30.2" in any message → unverified
      { id: '30.3', done: false },
    ],
  })
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', 'record phase 30 file')

  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: execSeam })
  assert.equal(pos.action, 'resume-phase')
  assert.deepEqual(pos.resume.unverifiedDoneFlags, ['30.2'])
  assert.deepEqual(pos.resume.doneTasks, ['30.1'], 'the unverified task is excluded from doneTasks (never trust the flag)')
})

test('PROSE-FALSE-POSITIVE — a backlog member with literal done:true/executionResult in a notes string is NOT read as done', () => {
  const root = newRepo()
  writeArc(root, 'A', { planes: [{ name: 'P', phases: [40] }] })
  writePhase(root, {
    phase: 40,
    status: 'backlog',
    arcId: 'A',
    tasks: [{ id: '40.1', done: false }],
    notes: 'A prior task recorded done:true and an executionResult in its report; this phase is still backlog.',
  })
  commit(root, 'seed roadmap')

  const pos = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: execSeam })
  assert.equal(pos.action, 'run-phase', 'the typed re-read wins over the regex-visible prose noise')
  assert.equal(pos.phase, 40)
  assert.ok(!pos.done.includes(40), 'the prose done:true must not surface as a done member')
})

test('RE-RUN IDEMPOTENCE — a completed arc derives action complete twice with byte-identical JSON', () => {
  const root = newRepo()
  writeArc(root, 'A', { planes: [{ name: 'P', phases: [50] }] })
  writePhase(root, { phase: 50, status: 'done', arcId: 'A', tasks: [{ id: '50.1', done: true }] })
  const summaryPath = join(root, 'roadmap', 'arc-summary.json')
  writeFileSync(summaryPath, JSON.stringify({
    arcId: 'A', outcome: 'shipped', compromiseDisposition: [],
    gateSignals: { arcSweepClean: true, validateArcPassed: true, fullSuiteGreen: true }, receiptRef: 'none',
  }))
  const digest = `sha256:${createHash('sha256').update(readFileSync(summaryPath)).digest('hex')}`
  const reportPath = plantPrior(root, '2026-09-07', { arcId: 'A' })
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  writeFileSync(reportPath, JSON.stringify({ ...report, landSummaryDigest: digest }, null, 2) + '\n')
  commit(root, 'seed completed arc') // no sidecar

  const a = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: execSeam })
  const b = deriveArcPosition({ repoRoot: root, arcId: 'A', config: CONFIG, worktree: root, exec: execSeam })
  assert.equal(a.action, 'complete')
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'a re-run over a completed arc is a byte-identical no-op')
})
