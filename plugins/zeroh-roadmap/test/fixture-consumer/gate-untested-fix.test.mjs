#!/usr/bin/env node
/**
 * gate-untested-fix.test.mjs — the MECHRATCHET rank-9 warning driven through the REAL
 * bin/roadmap.mjs over a scratch consumer: a `fix(scope): phase N gate R*` commit that
 * patched ONLY source with no test in its diff surfaces as a NAMED warning in the gate
 * report notes AND on `--verify-complete` stdout, and NEVER changes an exit code (warn,
 * not block). Every assertion reads an exit code + a machine field (report notes[] /
 * stdout), never CLI narration. Composes ONLY harness primitives (the fixture-consumer
 * contract — no reach into cli/lib). Run: node --test test/fixture-consumer/gate-untested-fix.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, runCli, writePhaseFile, commitPaths, git } from './harness.mjs'

const latestReport = (root, n) => {
  const dir = join(root, 'roadmap', '.gate', String(n))
  if (!existsSync(dir)) return null
  const f = readdirSync(dir).filter((x) => /^run-\d+-.*\.json$/.test(x)).sort().pop()
  return f ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null
}
const hasWarning = (notes) => (notes ?? []).some((s) => /untested gate-fix/.test(s))

/**
 * Seed an in-progress phase whose move-to-in-progress commit carries the em-dash boundary
 * the gate greps for, then a source `— work` commit, then a first green `gate run`. Returns
 * { root, phase }. The caller adds the gate-fix commit and drives the assertions.
 */
function seedGatedPhase(phase, { touchWork = 'src/plain.ts' } = {}) {
  const root = makeFixtureRepo()
  const pf = writePhaseFile(root, { phase, status: 'in-progress', arcId: 'FX', kind: 'logic', tasks: [{ id: `${phase}.1`, done: true }] })
  commitPaths(root, `plan(roadmap): phase ${phase} — move to in-progress`, [pf])
  writeFileSync(join(root, touchWork), 'export const plain = 2\n')
  commitPaths(root, `feat(core): phase ${phase} — work`, [touchWork])
  const first = runCli(root, ['gate', 'run', String(phase)])
  assert.equal(first.code, 0, `the pre-fix gate run is green; stderr:\n${first.stderr}`)
  return { root, phase }
}

test('G1 — a source-only gate-fix warns in --verify-complete stdout (naming the fix sha7) AND in the persisted report notes; exit codes unchanged', () => {
  const { root, phase } = seedGatedPhase(9401)
  // A gate-fix commit touching ONLY source (no test in its diff).
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const plain = 3\n')
  commitPaths(root, `fix(core): phase ${phase} gate R1`, ['src/plain.ts'])
  const fixSha7 = git(root, 'rev-parse', 'HEAD').slice(0, 7)

  const vc = runCli(root, ['gate', 'run', String(phase), '--verify-complete'])
  assert.equal(vc.code, 0, `consistent phase → verify-complete exits 0 (warn never blocks); stderr:\n${vc.stderr}`)
  assert.match(vc.stdout, /untested gate-fix/, 'the warning prints to stdout')
  assert.match(vc.stdout, new RegExp(fixSha7), 'the warning names the fix sha7')

  // Rerun the default gate run → the latest report notes[] carries the warning.
  const rerun = runCli(root, ['gate', 'run', String(phase)])
  assert.equal(rerun.code, 0, 'a warning-bearing green gate run still exits 0')
  assert.ok(hasWarning(latestReport(root, phase).notes), 'the persisted report notes[] carry the named warning')
})

test('G2 — a gate-fix that ALSO touches a sibling test warns NOWHERE; its exit codes equal the warned run\'s (warn never blocks)', () => {
  const { root, phase } = seedGatedPhase(9402)
  // A gate-fix touching source AND a colocated test → no warning anywhere.
  writeFileSync(join(root, 'src', 'plain.ts'), 'export const plain = 3\n')
  writeFileSync(join(root, 'src', 'plain.test.mjs'), 'export const t = 1\n')
  commitPaths(root, `fix(core): phase ${phase} gate R1`, ['src/plain.ts', 'src/plain.test.mjs'])

  const vc = runCli(root, ['gate', 'run', String(phase), '--verify-complete'])
  assert.equal(vc.code, 0, 'consistent phase → verify-complete exits 0 (identical to the warned run)')
  assert.doesNotMatch(vc.stdout, /untested gate-fix/, 'a tested gate-fix produces no warning')

  const rerun = runCli(root, ['gate', 'run', String(phase)])
  assert.equal(rerun.code, 0, 'green gate run exits 0, identical to the warned run')
  assert.ok(!hasWarning(latestReport(root, phase).notes), 'no warning reaches the report notes')
})

test('G3 — a docs-only gate-fix warns nowhere (no executable source touched)', () => {
  const { root, phase } = seedGatedPhase(9403)
  writeFileSync(join(root, 'roadmap', 'NOTES.md'), '# notes\n')
  commitPaths(root, `fix(docs): phase ${phase} gate R1`, ['roadmap/NOTES.md'])
  const rerun = runCli(root, ['gate', 'run', String(phase)])
  assert.equal(rerun.code, 0)
  assert.ok(!hasWarning(latestReport(root, phase).notes), 'a non-executable gate-fix is not a source-without-test fix')
})
