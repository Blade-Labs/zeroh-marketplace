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

test('1d) scanPhaseFile / matchStatusField — doc-comment prose status never shadows the definePhase field', async () => {
  const { matchStatusField } = await import(MOD)
  const dir = newTmp()
  const src = [
    '/**',
    " * Was status:'suspended' during the rework — prose only (phase 1787 class).",
    ' */',
    'export const p = definePhase({',
    '  phase: 42,',
    "  status: 'backlog',",
    '})',
  ].join('\n')
  const path = join(dir, 'phase-42.phase.ts')
  writeFileSync(path, src + '\n')
  assert.equal(scanPhaseFile(path).status, 'backlog', 'the field wins over doc-comment prose')
  const m = matchStatusField(src)
  assert.equal(m.status, 'backlog')
  assert.ok(src.slice(m.index).startsWith("status: 'backlog'"), 'index points at the field occurrence')
  // no definePhase in the file → scans from the top (fixture/plain-object compatibility)
  assert.equal(matchStatusField("export const p = { status: 'done' }").status, 'done')
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

// ── 1792.5a — claim remote-collision awareness (maxRemotePhase) ───────────────────────
// Dynamic import so a MISSING export reds only its own cases, never the whole file.
const SCAN = await import(MOD)

/** exec recorder mirroring exec.mjs's contract: (file, args, opts) → {status,stdout,stderr}. */
function recordExec(stdout, { status = 0, throws = false } = {}) {
  const calls = []
  const fn = (file, args, opts) => {
    calls.push({ file, args, opts })
    if (throws) throw new Error('fatal: not a valid object name: origin/develop')
    return { status, stdout, stderr: status === 0 ? '' : 'boom' }
  }
  fn.calls = calls
  return fn
}

const LS_TREE = [
  'roadmap/phases/phase-1710.phase.ts',
  'roadmap/phases/phase-1792.phase.ts',
  'roadmap/phases/phase-1674.phase.ts',
].join('\n') + '\n'

test('7) maxRemotePhase — parses a multi-file listing to the MAX number, not the last/first line', () => {
  const exec = recordExec(LS_TREE)
  assert.equal(SCAN.maxRemotePhase('/repo', 'origin/develop', exec), 1792)
})

test('7b) maxRemotePhase — non-phase basenames are ignored (no stray number leaks in)', () => {
  // A README with a big number, a .phase.ts.bak, and a dir entry must all be inert;
  // only real phase-<N>.phase.ts basenames count ⇒ 12 wins over the 9999s.
  const listing = [
    'roadmap/phases/README-9999.md',
    'roadmap/phases/phase-9999.phase.ts.bak',
    'roadmap/phases/archive-9999/',
    'roadmap/phases/phase-12.phase.ts',
  ].join('\n') + '\n'
  assert.equal(SCAN.maxRemotePhase('/repo', 'origin/develop', recordExec(listing)), 12)
})

test('7c) maxRemotePhase — an empty listing is 0 (never a fabricated number)', () => {
  assert.equal(SCAN.maxRemotePhase('/repo', 'origin/develop', recordExec('')), 0)
  assert.equal(SCAN.maxRemotePhase('/repo', 'origin/develop', recordExec('\n')), 0)
})

test('7d) maxRemotePhase — a FAILED listing (unknown ref / offline) is 0, best-effort', () => {
  const failed = recordExec('', { status: 128 })
  assert.equal(SCAN.maxRemotePhase('/repo', 'origin/nope', failed), 0, 'a non-zero exit yields 0, never a partial parse')
})

test('7e) maxRemotePhase — exec THROWING is swallowed: returns 0 and no exception escapes', () => {
  const thrower = recordExec('', { throws: true })
  let escaped = null
  let out
  try {
    out = SCAN.maxRemotePhase('/repo', 'origin/develop', thrower)
  } catch (e) {
    escaped = e
  }
  assert.equal(escaped, null, 'claim must never hard-fail on an offline/unknown upstream ref')
  assert.equal(out, 0)
  assert.equal(thrower.calls.length, 1, 'the throwing seam was genuinely exercised')
})

test('7f) maxRemotePhase — the injected exec receives the UPSTREAM REF and the phases dir (seam pinned)', () => {
  const exec = recordExec(LS_TREE)
  SCAN.maxRemotePhase('/repo', 'origin/develop', exec)
  assert.equal(exec.calls.length, 1, 'exactly one listing call — no shelling out per file')
  const { file, args } = exec.calls[0]
  assert.equal(file, 'git', 'the seam is git, not a shell string')
  const argv = args.map(String)
  assert.ok(argv.includes('ls-tree'), `expected an ls-tree listing; got ${JSON.stringify(argv)}`)
  assert.ok(
    argv.some((a) => a === 'origin/develop' || a.startsWith('origin/develop:')),
    `the caller-supplied upstream ref must be the tree read; got ${JSON.stringify(argv)}`,
  )
  assert.ok(
    argv.some((a) => /roadmap\/phases/.test(a)),
    `the listing must be scoped to the roadmap phases dir; got ${JSON.stringify(argv)}`,
  )
  // a DIFFERENT ref must reach git verbatim — the ref is never hardcoded
  const other = recordExec(LS_TREE)
  SCAN.maxRemotePhase('/repo', 'upstream/master', other)
  assert.ok(
    other.calls[0].args.map(String).some((a) => a === 'upstream/master' || a.startsWith('upstream/master:')),
    'the ref argument is honored, not pinned to origin/develop',
  )
})

// ── 2375.1 — keyFiles exposure (the only place absolute product paths live) ────────────

test('8) matchKeyFilesField — a multi-line array of absolute quoted paths yields them IN ORDER', async () => {
  const { matchKeyFilesField } = await import(MOD)
  const src = [
    'export default definePhase({',
    '  phase: 2375,',
    "  status: 'in-progress',",
    '  keyFiles: [',
    "    '/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/cli/lib/liveness.mjs',",
    "    '/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/cli/lib/phasescan.mjs',",
    "    '/home/patrik/azure_private_agent/roadmap/backlog.ts',",
    '  ],',
    '})',
  ].join('\n')
  assert.deepEqual(matchKeyFilesField(src), [
    '/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/cli/lib/liveness.mjs',
    '/home/patrik/zeroh-marketplace/plugins/zeroh-roadmap/cli/lib/phasescan.mjs',
    '/home/patrik/azure_private_agent/roadmap/backlog.ts',
  ])
})

test('8b) matchKeyFilesField — an absent field is an EMPTY array, never undefined', async () => {
  const { matchKeyFilesField } = await import(MOD)
  const src = ["export default definePhase({ phase: 1, status: 'backlog' })"].join('\n')
  assert.deepEqual(matchKeyFilesField(src), [], 'callers iterate the result; undefined would throw')
  // an EMPTY declared array is also [] — same shape, no special case
  assert.deepEqual(matchKeyFilesField("definePhase({ status: 'backlog', keyFiles: [] })"), [])
})

test('8c) matchKeyFilesField — doc-comment prose naming keyFiles never wins over the real field', async () => {
  const { matchKeyFilesField } = await import(MOD)
  const src = [
    '/**',
    " * Supersedes the old plan whose keyFiles: [ '/prose/decoy.mjs' ] listing is quoted here.",
    ' */',
    'export default definePhase({',
    '  phase: 7,',
    "  status: 'backlog',",
    '  keyFiles: [',
    "    '/real/field.mjs',",
    '  ],',
    '})',
  ].join('\n')
  assert.deepEqual(matchKeyFilesField(src), ['/real/field.mjs'], 'the field after the definePhase anchor supplies the value')
})

test('8d) scanPhaseFile — keyFiles ride alongside the UNCHANGED phase/status/arcId values', () => {
  const dir = newTmp()
  const src = [
    'export default definePhase({',
    '  phase: 2375,',
    "  status: 'in-progress',",
    "  arcId: 'ARCX',",
    '  keyFiles: [',
    "    '/product/repo/src/a.mjs',",
    "    '/product/repo/src/b.mjs',",
    '  ],',
    '})',
  ].join('\n')
  const path = join(dir, 'phase-2375.phase.ts')
  writeFileSync(path, src + '\n')
  const r = scanPhaseFile(path)
  assert.equal(r.phase, '2375')
  assert.equal(r.status, 'in-progress')
  assert.equal(r.arcId, 'ARCX')
  assert.deepEqual(r.keyFiles, ['/product/repo/src/a.mjs', '/product/repo/src/b.mjs'])
})

test('8e) scanPhaseFile — a phase file with no keyFiles field still yields an array', () => {
  const dir = newTmp()
  const p = writePhase(dir, 'phase-31.phase.ts', { phase: 31, status: 'done', arcId: 'X' })
  const r = scanPhaseFile(p)
  assert.deepEqual(r.keyFiles, [], 'the widening never hands back undefined')
  assert.equal(r.status, 'done', 'the pre-existing fields are untouched by the widening')
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
