#!/usr/bin/env node
/**
 * TEST-FIRST for `roadmap phase start <N>` (cli/commands/phase.mjs today implements
 * only `validate`; `start` is a not-yet-implemented stub → RED until it lands). The
 * thin status→in-progress convenience: flip the phase file's FIRST `status:` match,
 * commit it with the canonical move-to-in-progress subject, and stamp an
 * executor-start beacon. The move-commit subject is LOAD-BEARING: cli/lib/gitscan.mjs
 * derivePhaseStartSha keys its Tier-1 (newest-move-commit) base derivation off it, so
 * this suite asserts the cross-contract directly.
 *
 * Seeded tmp git repos (execFileSync git, never a shell string) driven through the
 * REAL bin/roadmap.mjs — the makeRepo idiom from cli/commands/gate.test.mjs. Run:
 *   capbuild node --test cli/commands/phase.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { derivePhaseStartSha } from '../lib/gitscan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')

const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

/** A git repo with a roadmap/phases/ dir and a root commit (so every later commit has a parent). */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-phase-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  const git = (...a) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
  git('init', '-q')
  writeFileSync(join(root, '.gitkeep'), '')
  git('add', '.gitkeep')
  git('commit', '-q', '-m', 'root')
  return { root, git }
}

const phaseFile = (root, n) => join(root, 'roadmap', 'phases', `phase-${n}.phase.ts`)

/** Write a phase-<n>.phase.ts fixture and commit it in its own seed commit; returns the HEAD sha. */
function seedPhase(root, git, n, body) {
  writeFileSync(phaseFile(root, n), body)
  git('add', join('roadmap', 'phases', `phase-${n}.phase.ts`))
  git('commit', '-q', '-m', `seed phase-${n} file`)
  return git('rev-parse', 'HEAD').trim()
}

/** A backlog phase carrying a DECOY `status: 'backlog'` inside a notes string (must survive the flip). */
const backlogWithDecoy = (n) =>
  [
    'export default {',
    `  phase: ${n},`,
    "  status: 'backlog',",
    "  arcId: 'PHZ',",
    `  notes: "an earlier note said status: 'backlog' verbatim — keep it",`,
    '}',
    '',
  ].join('\n')

const phaseStart = (root, ...args) =>
  spawnSync('node', [BIN, 'phase', 'start', ...args], { cwd: root, encoding: 'utf8' })

// ── the happy path ────────────────────────────────────────────────────────────────

test('phase start — flips the FIRST status backlog→in-progress and leaves the notes-string decoy untouched', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4001, backlogWithDecoy(4001))

  const res = phaseStart(root, '4001')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)

  const after = readFileSync(phaseFile(root, 4001), 'utf8')
  const first = after.match(/status:\s*'([a-z-]+)'/)
  assert.ok(first, 'a status field remains after the flip')
  assert.equal(first[1], 'in-progress', 'the FIRST status: match is what flips')
  assert.equal((after.match(/status: 'in-progress'/g) || []).length, 1, 'exactly ONE status flipped (not a global replace)')
  assert.ok(
    after.includes("status: 'backlog' verbatim"),
    `the decoy status literal inside notes must be untouched (first-match-only); got:\n${after}`,
  )
})

test('phase start — commits the flip with the canonical move-to-in-progress subject', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4002, backlogWithDecoy(4002))

  const res = phaseStart(root, '4002')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)
  const subject = git('log', '-1', '--format=%s').trim()
  assert.equal(subject, 'docs(roadmap): phase 4002 — move to in-progress', `unexpected move-commit subject: ${subject}`)
})

test('phase start — stamps an executor-start beacon whose last line carries phase as a JSON number', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4003, backlogWithDecoy(4003))

  const res = phaseStart(root, '4003')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)
  const beacon = join(root, '.building', '4003-executor.jsonl')
  assert.ok(existsSync(beacon), `the executor beacon must be written at ${beacon}`)
  const lines = readFileSync(beacon, 'utf8').trim().split('\n').filter(Boolean)
  const last = JSON.parse(lines[lines.length - 1])
  assert.equal(last.event, 'executor-start', 'the last beacon event is executor-start')
  assert.equal(typeof last.phase, 'number', `phase must serialize as a JSON number; got ${typeof last.phase}`)
  assert.equal(last.phase, 4003, 'the beacon names the started phase')
})

// ── the load-bearing cross-contract: derivePhaseStartSha keys off the move-commit ──

test('CROSS-CONTRACT — after start, derivePhaseStartSha resolves to the PARENT of the move-commit (Tier-1 preference)', () => {
  const { root, git } = makeRepo()
  seedPhase(root, git, 4004, backlogWithDecoy(4004))
  // An ANCIENT `phase 4004 —` mention that is NOT a move commit — under the fallback
  // (oldest-match) rule its parent would win; Tier-1 must ignore it in favour of the move.
  writeFileSync(join(root, 'early.txt'), 'early\n')
  git('add', 'early.txt')
  git('commit', '-q', '-m', 'docs: phase 4004 — early mention')
  const moveParent = git('rev-parse', 'HEAD').trim() // parent-to-be of the move commit

  const res = phaseStart(root, '4004')
  assert.equal(res.status, 0, `phase start must exit 0; stderr:\n${res.stderr}`)
  // A later correctly-formed work commit also matches `phase 4004 —`.
  writeFileSync(join(root, 'work.txt'), 'work\n')
  git('add', 'work.txt')
  git('commit', '-q', '-m', 'feat(x): phase 4004 — 4004.1 something')

  assert.equal(
    derivePhaseStartSha(root, 4004),
    moveParent,
    'the base is the parent of the NEWEST move-to-in-progress commit, never the ancient mention',
  )
})

// ── refusals + idempotency ──────────────────────────────────────────────────────────

test('phase start — a DONE phase refuses with exit 2, no flip, no new commit', () => {
  const { root, git } = makeRepo()
  const body = ['export default {', '  phase: 4005,', "  status: 'done',", "  arcId: 'PHZ',", '}', ''].join('\n')
  seedPhase(root, git, 4005, body)
  const headBefore = git('rev-parse', 'HEAD').trim()

  const res = phaseStart(root, '4005')
  assert.equal(res.status, 2, `a done phase cannot be restarted → exit 2; stderr:\n${res.stderr}`)
  assert.equal(readFileSync(phaseFile(root, 4005), 'utf8'), body, 'the done phase file is unchanged')
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no commit is created on the refusal path')
})

test('phase start — a phase with NO backlog|in-progress status pattern refuses with exit 1', () => {
  const { root, git } = makeRepo()
  const body = ['export default {', '  phase: 4006,', "  arcId: 'PHZ',", '}', ''].join('\n') // no status: field
  seedPhase(root, git, 4006, body)
  const headBefore = git('rev-parse', 'HEAD').trim()

  const res = phaseStart(root, '4006')
  assert.equal(res.status, 1, `a missing flip-source pattern is a usage/malformed error → exit 1; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /status|backlog|in-progress|pattern/i, `stderr must name the missing pattern; got:\n${res.stderr}`)
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no commit on the exit-1 path')
})

test('phase start — an already in-progress phase is an idempotent no-op: exit 0, no second flip, no second commit', () => {
  const { root, git } = makeRepo()
  const body = ['export default {', '  phase: 4007,', "  status: 'in-progress',", "  arcId: 'PHZ',", '}', ''].join('\n')
  seedPhase(root, git, 4007, body)
  const headBefore = git('rev-parse', 'HEAD').trim()

  const res = phaseStart(root, '4007')
  assert.equal(res.status, 0, `already in-progress is not an error → exit 0; stderr:\n${res.stderr}`)
  assert.equal(readFileSync(phaseFile(root, 4007), 'utf8'), body, 'no second flip on an already-in-progress phase')
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no second move-commit on the idempotent path')
})

test('phase start — a FAILED move-commit reverts the flip and exits 2 (never flipped-but-uncommitted; a retry re-attempts cleanly)', () => {
  const { root, git } = makeRepo()
  const body = backlogWithDecoy(4008)
  seedPhase(root, git, 4008, body)
  const headBefore = git('rev-parse', 'HEAD').trim()
  // A failing pre-commit hook simulates index-lock/hook contention at commit time.
  const hookDir = join(root, '.git', 'hooks')
  mkdirSync(hookDir, { recursive: true })
  writeFileSync(join(hookDir, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

  const res = phaseStart(root, '4008')
  assert.equal(res.status, 2, `a failed move-commit refuses with exit 2; stderr:\n${res.stderr}`)
  assert.match(res.stderr, /move-commit FAILED.*flip reverted/s, 'stderr names the failure + the revert')
  assert.equal(readFileSync(phaseFile(root, 4008), 'utf8'), body, 'the flip is REVERTED — never flipped-but-uncommitted')
  assert.equal(git('rev-parse', 'HEAD').trim(), headBefore, 'no commit landed')
  assert.equal(existsSync(join(root, '.building', '4008-executor.jsonl')), false, 'no beacon on the failure path')

  // The retry (hook removed) re-attempts CLEANLY — the 1702-class silent no-op is impossible.
  rmSync(join(hookDir, 'pre-commit'))
  const retry = phaseStart(root, '4008')
  assert.equal(retry.status, 0, `the retry lands; stderr:\n${retry.stderr}`)
  assert.match(readFileSync(phaseFile(root, 4008), 'utf8'), /status: 'in-progress'/, 'retry flips')
  assert.match(git('log', '-1', '--format=%s').trim(), /^docs\(roadmap\): phase 4008 — move to in-progress$/, 'retry lands the move-commit')
})
