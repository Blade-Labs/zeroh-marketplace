#!/usr/bin/env node
/**
 * TEST-FIRST for cli/lib/phasescan.mjs (module does NOT exist yet — RED on import
 * until implemented). The phase-file scanner extracted verbatim from
 * scripts/arc-status.mjs (status/phase/arcId regexes + the progress fold).
 * Hermetic-tmp-estate pattern from scripts/executor-liveness.test.mjs:
 * mkdtempSync + process.on('exit') cleanup, realpath'd tmp dirs, no mocking.
 * Run: node --test cli/lib/phasescan.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOD = join(HERE, 'phasescan.mjs')
const { scanPhaseFile, scanProgress, maxDeclaredPhase } = await import(MOD)

const tmps = []
function newTmp(prefix = 'zr-phasescan-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return realpathSync(d)
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
 * Write a *.phase.ts file with the given fields. `phase` omitted ⇒ no `phase:`
 * declaration (filename fallback exercised); `status`/`arcId` omitted ⇒ absent.
 */
function writePhase(dir, fileName, { phase, status, arcId } = {}) {
  mkdirSync(dir, { recursive: true })
  const lines = ['export const p = {']
  if (phase !== undefined) lines.push(`  phase: ${phase},`)
  if (status !== undefined) lines.push(`  status: '${status}',`)
  if (arcId !== undefined) lines.push(`  arcId: '${arcId}',`)
  lines.push('}')
  const path = join(dir, fileName)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

test('1) scanPhaseFile — declared phase beats the filename; status + arcId extracted', () => {
  const dir = newTmp()
  const p = writePhase(dir, 'phase-99.phase.ts', { phase: 1234, status: 'in-progress', arcId: 'ARCX' })
  const r = scanPhaseFile(p)
  assert.equal(r.phase, '1234', 'the declared phase: 1234 wins over the phase-99 filename')
  assert.equal(r.status, 'in-progress')
  assert.equal(r.arcId, 'ARCX')
})

test('1b) scanPhaseFile — no phase declaration falls back to the filename number', () => {
  const dir = newTmp()
  const p = writePhase(dir, 'phase-77.phase.ts', { status: 'done', arcId: 'ARCX' })
  const r = scanPhaseFile(p)
  assert.equal(r.phase, '77')
})

test('1c) scanPhaseFile — no status match returns null', () => {
  const dir = newTmp()
  const p = writePhase(dir, 'phase-5.phase.ts', { phase: 5, arcId: 'ARCX' }) // no status
  assert.equal(scanPhaseFile(p), null)
})

test('2) scanProgress — done+historical both count as done; inprog/backlog folded per arc', () => {
  const phases = join(newTmp(), 'phases')
  writePhase(phases, 'phase-1.phase.ts', { phase: 1, status: 'done', arcId: 'X' })
  writePhase(phases, 'phase-2.phase.ts', { phase: 2, status: 'historical', arcId: 'X' })
  writePhase(phases, 'phase-3.phase.ts', { phase: 3, status: 'in-progress', arcId: 'X' })
  writePhase(phases, 'phase-4.phase.ts', { phase: 4, status: 'backlog', arcId: 'X' })
  const { progress } = scanProgress(phases)
  const p = progress.get('X')
  assert.equal(p.done, 2, 'done + historical both increment done')
  assert.equal(p.inprog, 1)
  assert.equal(p.backlog, 1)
  assert.equal(p.total, 4)
})

test('3) scanProgress — in-progress numbers are unshifted, landing BEFORE backlog in next[]', () => {
  const phases = join(newTmp(), 'phases')
  writePhase(phases, 'phase-10.phase.ts', { phase: 10, status: 'backlog', arcId: 'X' })
  writePhase(phases, 'phase-11.phase.ts', { phase: 11, status: 'backlog', arcId: 'X' })
  writePhase(phases, 'phase-12.phase.ts', { phase: 12, status: 'in-progress', arcId: 'X' })
  const { progress } = scanProgress(phases)
  const next = progress.get('X').next
  assert.equal(next[0], '12', 'the in-progress number is unshifted to the front')
  assert.ok(
    next.indexOf('12') < next.indexOf('10') && next.indexOf('12') < next.indexOf('11'),
    `in-progress must precede all backlog numbers; got ${JSON.stringify(next)}`,
  )
})

test('3b) scanProgress — inProgress map keyed by arcId, arcless in-progress keyed by "?"', () => {
  const phases = join(newTmp(), 'phases')
  writePhase(phases, 'phase-20.phase.ts', { phase: 20, status: 'in-progress', arcId: 'X' })
  writePhase(phases, 'phase-21.phase.ts', { phase: 21, status: 'in-progress' }) // no arcId
  const { inProgress } = scanProgress(phases)
  assert.deepEqual(inProgress.get('X'), ['20'])
  assert.deepEqual(inProgress.get('?'), ['21'])
})

test('4) scanProgress — memoized per dir: two calls return the SAME object reference', () => {
  const phases = join(newTmp(), 'phases')
  writePhase(phases, 'phase-1.phase.ts', { phase: 1, status: 'done', arcId: 'X' })
  const a = scanProgress(phases)
  const b = scanProgress(phases)
  assert.equal(a, b, 'the memo must return the identical object, not a fresh scan')
})

test('5) maxDeclaredPhase — spans multiple roots recursively; archive numbers count', () => {
  const estate = newTmp()
  const phasesDir = join(estate, 'phases')
  const archiveDir = join(estate, 'archive', 'nested')
  writePhase(phasesDir, 'phase-100.phase.ts', { phase: 100, status: 'done', arcId: 'X' })
  writePhase(phasesDir, 'phase-101.phase.ts', { phase: 101, status: 'backlog', arcId: 'X' })
  // A HIGHER declared number, archived under a nested subdir of a second root.
  writePhase(archiveDir, 'phase-9.phase.ts', { phase: 9001, status: 'historical', arcId: 'X' })
  assert.equal(maxDeclaredPhase([phasesDir, archiveDir]), 9001, 'archived declared numbers are included')
})

test('5b) maxDeclaredPhase — no phase files anywhere returns 0', () => {
  const empty = newTmp()
  assert.equal(maxDeclaredPhase([empty]), 0)
})

test('5c) maxDeclaredPhase — uses the DECLARED value, not the filename', () => {
  const dir = join(newTmp(), 'phases')
  // filename says 500 but the body declares 42 — the declared value must win.
  writePhase(dir, 'phase-500.phase.ts', { phase: 42, status: 'done', arcId: 'X' })
  assert.equal(maxDeclaredPhase([dir]), 42)
})

test('6) scanProgress — a statusless / unparseable phase file is skipped, never crashes', () => {
  const phases = join(newTmp(), 'phases')
  writePhase(phases, 'phase-1.phase.ts', { phase: 1, status: 'done', arcId: 'X' })
  writePhase(phases, 'phase-2.phase.ts', { phase: 2, arcId: 'X' }) // NO status → skipped
  writeFileSync(join(phases, 'phase-3.phase.ts'), 'this is not a phase at all\n')
  const { progress } = scanProgress(phases)
  const p = progress.get('X')
  assert.equal(p.total, 1, 'only the one file that has both status and arcId counts toward total')
})
