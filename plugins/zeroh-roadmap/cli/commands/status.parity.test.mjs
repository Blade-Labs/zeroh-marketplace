#!/usr/bin/env node
/**
 * PARITY LOCK for `roadmap status` (ROADCODE §8 risk 5: a wrong derivation
 * mis-sequences a live arc). `roadmap status <root>` is a function-by-function
 * PORT of the old scripts/arc-status.mjs; this suite diffs the new command's
 * human stdout against the FROZEN legacy oracle byte-for-byte (timestamp +
 * age tokens normalized) over the SAME snapshot estate.
 *
 * Estate modes:
 *   - ROADMAP_PARITY_ESTATE set → COPY that real roadmap's phases/ + arcs/
 *     subtrees (including .building sidecars, *-executor.jsonl beacons, and
 *     *-RESUME.md handoffs) into the snapshot.
 *   - unset → a SYNTHETIC estate exercising every flag class (WORKTREE GONE,
 *     PAUSED, IN-FLIGHT/UNREGISTERED, resume-only, NO arcId).
 *
 * Hermetic-tmp pattern from cli/commands/config.test.mjs (mkdtempSync +
 * realpathSync + process.on('exit') cleanup). Run:
 *   node --test cli/commands/status.parity.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)) // cli/commands/
const BIN = join(HERE, '..', '..', 'bin', 'roadmap.mjs')
const LEGACY = join(HERE, '..', 'testdata', 'arc-status-legacy.mjs')

const tmps = []
function newTmp(prefix = 'zr-status-parity-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d) // tmp symlink-safe; matches the derivation's resolve()
}
process.on('exit', () => {
  for (const d of tmps) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }
})

/**
 * Write a *.phase.ts file (mirrors writePhase in cli/lib/phasescan.test.mjs).
 * `phase` omitted ⇒ filename fallback; `status`/`arcId` omitted ⇒ absent.
 */
function writePhase(dir, fileName, { phase, status, arcId } = {}) {
  mkdirSync(dir, { recursive: true })
  const lines = ['export const p = {']
  if (phase !== undefined) lines.push(`  phase: ${phase},`)
  if (status !== undefined) lines.push(`  status: '${status}',`)
  if (arcId !== undefined) lines.push(`  arcId: '${arcId}',`)
  lines.push('}')
  writeFileSync(join(dir, fileName), lines.join('\n') + '\n')
}

const isoAgo = (min) => new Date(Date.now() - min * 60_000).toISOString()

/** COPY the real estate's phases/ + arcs/ subtrees into <snapshot>/. */
function copyRealEstate(realRoot, snapshotRoot) {
  mkdirSync(snapshotRoot, { recursive: true })
  for (const sub of ['phases', 'arcs']) {
    const src = join(realRoot, sub)
    if (existsSync(src)) cpSync(src, join(snapshotRoot, sub), { recursive: true })
  }
}

/**
 * SYNTHETIC estate covering EVERY flag class. Worktrees are all absent (the tmp
 * snapshot is not a git checkout), so each sidecar lane trips WORKTREE GONE — the
 * derivation's reachable classes for a hermetic snapshot.
 */
function buildSyntheticEstate(snapshotRoot) {
  const phases = join(snapshotRoot, 'phases')
  const building = join(snapshotRoot, 'arcs', '.building')
  const arcs = join(snapshotRoot, 'arcs')
  mkdirSync(phases, { recursive: true })
  mkdirSync(building, { recursive: true })

  // BUILDING arc — an in-progress + a backlog phase.
  writePhase(phases, 'phase-1001.phase.ts', { phase: 1001, status: 'in-progress', arcId: 'BUILDA' })
  writePhase(phases, 'phase-1002.phase.ts', { phase: 1002, status: 'backlog', arcId: 'BUILDA' })
  // PAUSED arc.
  writePhase(phases, 'phase-1003.phase.ts', { phase: 1003, status: 'done', arcId: 'PAUSEB' })
  writePhase(phases, 'phase-1004.phase.ts', { phase: 1004, status: 'backlog', arcId: 'PAUSEB' })
  // Resume-only arc (no sidecar).
  writePhase(phases, 'phase-1005.phase.ts', { phase: 1005, status: 'done', arcId: 'RESUMEC' })
  writePhase(phases, 'phase-1006.phase.ts', { phase: 1006, status: 'backlog', arcId: 'RESUMEC' })
  // UNREGISTERED in-progress arc (no sidecar, no resume) → IN-FLIGHT.
  writePhase(phases, 'phase-1007.phase.ts', { phase: 1007, status: 'in-progress', arcId: 'UNREGD' })
  // In-progress phase with NO arcId → the '?' NO arcId warning.
  writePhase(phases, 'phase-1008.phase.ts', { phase: 1008, status: 'in-progress' })

  writeFileSync(
    join(building, 'BUILDA.json'),
    JSON.stringify({ arcId: 'BUILDA', worktree: '/nonexistent/wt-builda', branch: 'arc/builda', mode: 'mixed' }, null, 2) + '\n',
  )
  writeFileSync(
    join(building, 'BUILDA-executor.jsonl'),
    JSON.stringify({ ts: isoAgo(3), event: 'task-start' }) + '\n',
  )
  writeFileSync(
    join(building, 'PAUSEB.json'),
    JSON.stringify({ arcId: 'PAUSEB', worktree: '/nonexistent/wt-pauseb', branch: 'arc/pauseb', mode: 'mixed', paused: true }, null, 2) + '\n',
  )
  writeFileSync(join(arcs, 'RESUMEC-RESUME.md'), '# resume headline\n\nbody\n')
}

const REAL = process.env.ROADMAP_PARITY_ESTATE

/** Build the snapshot estate for this run; returns the roadmap root path. */
function makeSnapshot() {
  const snapshotRoot = join(newTmp(), 'roadmap')
  if (REAL) copyRealEstate(realpathSync(REAL), snapshotRoot)
  else buildSyntheticEstate(snapshotRoot)
  return snapshotRoot
}

/** Normalize the volatile bits: derived timestamp header + age tokens. */
function normalize(out) {
  return out
    .replace(/derived [0-9T:.Z-]+/g, 'derived <TS>')
    .replace(/\b\d+[mhd]\b/g, '<AGE>')
}

test('1) roadmap status human output is BYTE-COMPATIBLE with the frozen legacy oracle', () => {
  const snapshotRoot = makeSnapshot()

  const legacy = spawnSync('node', [LEGACY, snapshotRoot], { encoding: 'utf8' })
  assert.equal(legacy.status, 0, `legacy oracle must exit 0; stderr:\n${legacy.stderr}`)

  const now = spawnSync('node', [BIN, 'status', snapshotRoot], { encoding: 'utf8' })
  assert.equal(now.status, 0, `roadmap status must exit 0; stderr:\n${now.stderr}`)

  const legacyOut = normalize(legacy.stdout)
  const newOut = normalize(now.stdout)
  assert.equal(
    newOut,
    legacyOut,
    `roadmap status drifted from the legacy oracle.\n--- new ---\n${newOut}\n--- legacy ---\n${legacyOut}`,
  )
})

test('2) synthetic estate actually exercises every flag class (skipped under a real estate)', (t) => {
  if (REAL) {
    t.skip('ROADMAP_PARITY_ESTATE set — real-estate flag classes vary')
    return
  }
  const snapshotRoot = makeSnapshot()
  const now = spawnSync('node', [BIN, 'status', snapshotRoot], { encoding: 'utf8' })
  assert.equal(now.status, 0, `status must exit 0; stderr:\n${now.stderr}`)
  const out = normalize(now.stdout)
  for (const marker of ['WORKTREE GONE', 'PAUSED', 'IN-FLIGHT', 'NO arcId']) {
    assert.ok(
      out.includes(marker),
      `the synthetic estate must exercise "${marker}"; got:\n${out}`,
    )
  }
})
