#!/usr/bin/env node
/**
 * landing.test.mjs — the DECISION half of cli/lib/landing.mjs (arc ROADCODE 1657.4):
 * the eight-blocker table (each blocker individually provoked + an all-clear fixture,
 * BLOCKERS.length pinned at exactly 8, blocker 8 the MECHRATCHET rank-6 stale-base gate),
 * the openFollowups arithmetic over the wrapped
 * census (planned counted, operator exempt+reported, census-failure ⇒ null ⇒ hold),
 * hardStop-vs-descopes matching, and the validate-artifact absent-with-criteria rule.
 * Run: node --test cli/lib/landing.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCKERS, evaluateBlockers, gatherLandingState, buildRunnerSummary, runArcEndSuite, deriveArcSuiteRange } from './landing.mjs'
import { IMPACTED_FALLBACK_NOTE } from './slots.mjs'
import { defaultExec } from './exec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const tsSrc = (obj) =>
  'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
const CONFIG = { configVersion: 1, gateCommands: { lint: 'l', types: 't', unit: 'u', integration: 'i', build: 'b', e2e: 'none', emit: 'e' }, mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: ['develop'], primaryCheckout: '/nope' } }

function makeRepo(arcId, arc, phases) {
  const root = mkdtempSync(join(tmpdir(), 'zr-land-'))
  bases.push(root)
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', `${arcId}.arc.ts`), tsSrc({ id: arcId, baseRef: 'develop', ...arc }))
  for (const p of phases) writeFileSync(join(root, 'roadmap', 'phases', `phase-${p.phase}.phase.ts`), tsSrc(p))
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'init', '-q'])
  execFileSync('git', ['-C', root, 'add', '-A'])
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'seed'])
  return root
}
const censusExec = (entries) => (file, args, opts) => {
  if (args.some((a) => String(a).endsWith('debt-census.mts'))) {
    writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({ entries }))
    return { status: 0, stdout: '', stderr: '' }
  }
  return defaultExec(file, args, opts)
}

/** A fully-clear landing state — each blocker test mutates ONE field off this. */
const clear = () => ({
  arcId: 'A',
  members: [{ num: 10, status: 'done', done: true, executionResult: { status: 'done', hardStops: [] }, debtResolutions: [] }],
  hasCriteria: true,
  descopes: [],
  verdict: { verdict: 'PASS' },
  openFollowups: 0,
  openOperator: 0,
  mergePolicy: { maxOpenFollowups: 0 },
  baseRef: 'develop',
  conflict: false,
  baseRefMoved: false,
  baseBehindCount: 0,
  overlapFiles: [],
  staleAcknowledged: false,
  suiteGreen: true,
  reconciledGreen: false,
})
const ids = (held) => held.map((h) => h.id).sort((a, b) => a - b)

test('BLOCKERS is exactly eight; an all-clear state holds none', () => {
  assert.equal(BLOCKERS.length, 8)
  assert.deepEqual(evaluateBlockers(clear()), [])
})

test('blocker 1 — a member not done, and a member executionResult failed/escalated', () => {
  const s1 = clear(); s1.members[0].done = false
  assert.deepEqual(ids(evaluateBlockers(s1)), [1])
  const s2 = clear(); s2.members[0].executionResult.status = 'escalated'
  assert.deepEqual(ids(evaluateBlockers(s2)), [1])
})

test('blocker 2 — an unratified hardStop fires; a matching descope clears it', () => {
  const s = clear()
  s.members[0].executionResult.hardStops = [{ tag: '[MULTI-REPO]', text: 'touched the live marketplace checkout' }]
  assert.deepEqual(ids(evaluateBlockers(s)), [2])
  s.descopes = ['[MULTI-REPO] touched the live marketplace checkout — ratified 2026-07-15']
  assert.deepEqual(evaluateBlockers(s), [], 'a descope quoting the hardStop text ratifies it')
})

test('blocker 3 — GAPS or artifact-absent-with-criteria; absent-WITHOUT-criteria does NOT fire', () => {
  const gaps = clear(); gaps.verdict = { verdict: 'GAPS' }
  assert.deepEqual(ids(evaluateBlockers(gaps)), [3])
  const absent = clear(); absent.verdict = null
  assert.deepEqual(ids(evaluateBlockers(absent)), [3])
  const noCriteria = clear(); noCriteria.verdict = null; noCriteria.hasCriteria = false
  assert.deepEqual(evaluateBlockers(noCriteria), [], 'no acceptanceCriteria ⇒ blocker 3 is inert')
})

test('blocker 4 — suite not green (false OR null both hold)', () => {
  const f = clear(); f.suiteGreen = false
  assert.deepEqual(ids(evaluateBlockers(f)), [4])
  const n = clear(); n.suiteGreen = null
  assert.deepEqual(ids(evaluateBlockers(n)), [4])
})

test('blocker 5 — openFollowups over max, and census-failure (null) counts as over', () => {
  const over = clear(); over.openFollowups = 1
  assert.deepEqual(ids(evaluateBlockers(over)), [5])
  const unknown = clear(); unknown.openFollowups = null
  assert.deepEqual(ids(evaluateBlockers(unknown)), [5])
  const budgeted = clear(); budgeted.openFollowups = 2; budgeted.mergePolicy = { maxOpenFollowups: 2 }
  assert.deepEqual(evaluateBlockers(budgeted), [], 'exactly at max is not over')
})

test('blocker 6 — a merge conflict against baseRef', () => {
  const s = clear(); s.conflict = true
  assert.deepEqual(ids(evaluateBlockers(s)), [6])
})

test('blocker 7 — baseRef moved with no reconciliation; a green reconciliation clears it', () => {
  const s = clear(); s.baseRefMoved = true
  assert.deepEqual(ids(evaluateBlockers(s)), [7])
  s.reconciledGreen = true
  assert.deepEqual(evaluateBlockers(s), [])
})

test('blocker 8 — behind beyond the default ceiling holds; the reason names count, ceiling AND overlap', () => {
  const s = clear(); s.baseBehindCount = 101; s.overlapFiles = ['src/foo.ts', 'src/bar.ts']
  const held = evaluateBlockers(s)
  assert.deepEqual(ids(held), [8])
  const reason = held.find((h) => h.id === 8).reason
  assert.match(reason, /\b101\b/, 'names the behind-count')
  assert.match(reason, /\b100\b/, 'names the default ceiling')
  assert.match(reason, /src\/foo\.ts/, 'names the overlapping files')
  assert.match(reason, /src\/bar\.ts/, 'names every overlapping file')
})

test('blocker 8 — --force-stale acknowledgment clears it; behind AT the ceiling never held', () => {
  const ack = clear(); ack.baseBehindCount = 101; ack.staleAcknowledged = true
  assert.deepEqual(evaluateBlockers(ack), [], 'acknowledgment clears blocker 8 alone')
  const atCeiling = clear(); atCeiling.baseBehindCount = 100
  assert.deepEqual(evaluateBlockers(atCeiling), [], 'behind == ceiling is not over')
})

test('blocker 8 — an explicit low ceiling holds one commit over it; no-overlap reason is honest', () => {
  const s = clear(); s.mergePolicy = { maxOpenFollowups: 0, staleBaseCeiling: 5 }; s.baseBehindCount = 6; s.overlapFiles = []
  const held = evaluateBlockers(s)
  assert.deepEqual(ids(held), [8])
  assert.match(held.find((h) => h.id === 8).reason, /no overlapping files/, 'honest when the sets do not intersect')
})

test('gatherLandingState — openFollowups = OPEN + OPEN-planned; OPEN-operator exempt but reported', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [{ phase: 10, status: 'done', arcId: 'A', tasks: [{ id: '10.1', done: true }], executionResult: { status: 'done', hardStops: [] } }])
  const entries = [
    { arcId: 'A', state: 'OPEN' },
    { arcId: 'A', state: 'OPEN-planned' },
    { arcId: 'A', state: 'OPEN-operator' },
    { arcId: 'B', state: 'OPEN' },
  ]
  const s = gatherLandingState({ repoRoot: root, arcId: 'A', config: CONFIG, exec: censusExec(entries) })
  assert.equal(s.openFollowups, 2, 'OPEN(1) + OPEN-planned(1), sliced to arc A; B excluded')
  assert.equal(s.openOperator, 1, 'operator-pending exempt from the count but reported')
})

test('gatherLandingState — OPEN limitations are EXEMPT from openFollowups (release-sweep\'s) but reported', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [{ phase: 10, status: 'done', arcId: 'A', tasks: [{ id: '10.1', done: true }], executionResult: { status: 'done', hardStops: [] } }])
  const entries = [
    { arcId: 'A', state: 'OPEN', field: 'limitations' },
    { arcId: 'A', state: 'OPEN', field: 'limitations' },
    { arcId: 'A', state: 'OPEN', field: 'hardcoded' },
  ]
  const s = gatherLandingState({ repoRoot: root, arcId: 'A', config: CONFIG, exec: censusExec(entries) })
  assert.equal(s.openFollowups, 1, 'only the hardcoded entry counts — limitations never budget (arc-sweep SKILL.md: release-sweep disposes them pre-archive)')
  assert.equal(s.openLimitations, 2, 'limitations exempt but reported')
  assert.deepEqual(ids(evaluateBlockers({ ...clear(), openFollowups: 0, openLimitations: 5 })), [], 'limitations alone never hold blocker 5')
})

test('gatherLandingState — census invocation failure ⇒ openFollowups null (never a fabricated 0)', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }] }, [{ phase: 10, status: 'done', arcId: 'A', tasks: [{ id: '10.1', done: true }] }])
  const s = gatherLandingState({ repoRoot: root, arcId: 'A', config: CONFIG, exec: () => ({ status: 1, stdout: '', stderr: 'boom' }) })
  assert.equal(s.openFollowups, null)
  assert.deepEqual(ids(evaluateBlockers({ ...clear(), openFollowups: s.openFollowups })), [5])
})

test('gatherLandingState — reads members typed + validate verdict; absent-with-criteria yields blocker 3', () => {
  const root = makeRepo('A', { planes: [{ name: 'P', phases: [10] }], acceptanceCriteria: [{ id: 'c1', job: 'x' }] }, [{ phase: 10, status: 'done', arcId: 'A', tasks: [{ id: '10.1', done: true }], executionResult: { status: 'done', hardStops: [] } }])
  const s = gatherLandingState({ repoRoot: root, arcId: 'A', config: CONFIG, exec: censusExec([]) })
  assert.equal(s.members.length, 1)
  assert.equal(s.members[0].done, true)
  assert.equal(s.hasCriteria, true)
  assert.equal(s.verdict, null)
  s.suiteGreen = true
  assert.deepEqual(ids(evaluateBlockers(s)), [3], 'no verdict artifact while criteria exist ⇒ blocker 3 only')
})

test('singleSeam — landing.mjs consumes derive.runDebtCensus; no debt-census import, no second census parser', () => {
  const src = readFileSync(join(HERE, 'landing.mjs'), 'utf8')
  assert.ok(!/debt-census\.mts/.test(src), 'landing.mjs must not import/reference debt-census.mts directly')
  assert.match(src, /runDebtCensus/)
})

// ── buildRunnerSummary — arcSweepClean exempts limitations exactly as openFollowups does ──
test('buildRunnerSummary — an OPEN limitations entry does NOT deny arcSweepClean (D10/171848e)', () => {
  const state = { arcId: 'A', censusEntries: [{ state: 'OPEN', field: 'limitations' }], hasCriteria: false }
  const s = buildRunnerSummary(state, { suiteGreen: true })
  assert.equal(s.gateSignals.arcSweepClean, true, 'limitations are release-sweep\'s — never sweep-signaled, exactly as never budgeted')
})

test('buildRunnerSummary — an OPEN non-limitations entry (hardcoded) DENIES arcSweepClean', () => {
  const state = { arcId: 'A', censusEntries: [{ state: 'OPEN', field: 'hardcoded' }], hasCriteria: false }
  const s = buildRunnerSummary(state, { suiteGreen: true })
  assert.equal(s.gateSignals.arcSweepClean, false, 'a real open compromise still denies a clean sweep')
})

test('buildRunnerSummary — a null census stays fail-closed (arcSweepClean false)', () => {
  const state = { arcId: 'A', censusEntries: null, hasCriteria: false }
  const s = buildRunnerSummary(state, { suiteGreen: true })
  assert.equal(s.gateSignals.arcSweepClean, false, 'null !== 0 ⇒ fail-closed, unchanged')
})

// ── 1719.2 — impacted-mode arc-end suite + honest deferral summary ────────────────────
test('runArcEndSuite — mode impacted resolves the impacted slots and substitutes {range} verbatim', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zr-impacted-'))
  bases.push(dir)
  const cfg = {
    gateCommands: {
      unit: 'echo FULL_UNIT',
      integration: 'echo FULL_INT',
      'unit-impacted': 'echo IMP_UNIT {range} > u.txt',
      'integration-impacted': 'echo IMP_INT {range} > i.txt',
    },
  }
  const r = await runArcEndSuite({ config: cfg, cwd: dir, mode: 'impacted', range: 'seedsha..HEAD' })
  assert.equal(r.suiteGreen, true)
  assert.equal(r.mode, 'impacted')
  assert.equal(r.range, 'seedsha..HEAD')
  // the impacted slot ran (not the full one) and the range was substituted verbatim
  assert.match(readFileSync(join(dir, 'u.txt'), 'utf8'), /IMP_UNIT seedsha\.\.HEAD/)
  assert.match(readFileSync(join(dir, 'i.txt'), 'utf8'), /IMP_INT seedsha\.\.HEAD/)
})

test('runArcEndSuite — mode impacted with NO impacted bindings runs the full commands byte-identical + the note', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zr-impacted-fb-'))
  bases.push(dir)
  const cfg = { gateCommands: { unit: 'true', integration: 'true' } } // no *-impacted bindings
  const r = await runArcEndSuite({ config: cfg, cwd: dir, mode: 'impacted', range: 'x..HEAD' })
  assert.equal(r.suiteGreen, true)
  assert.equal(r.mode, 'impacted')
  // every scoped slot fell back to the full binding + surfaced the verbatim fallback note
  assert.ok(r.slots.every((s) => s.note === IMPACTED_FALLBACK_NOTE), 'each slot carries the impacted-fallback note')
})

test('deriveArcSuiteRange — picks the DEEPEST member start sha; zero derivable shas ⇒ null', () => {
  const root = mkdtempSync(join(tmpdir(), 'zr-range-'))
  bases.push(root)
  const gg = (...a) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' })
  gg('init', '-q')
  writeFileSync(join(root, 'a'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'seed')
  writeFileSync(join(root, 'b'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'feat: phase 10 — move to in-progress')
  writeFileSync(join(root, 'c'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'feat: phase 11 — move to in-progress')
  writeFileSync(join(root, 'd'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'work')
  // phase 10's start (parent of its move-commit) is DEEPER than phase 11's → range anchors on 10.
  const range = deriveArcSuiteRange(root, [10, 11], defaultExec)
  assert.match(range, /^[0-9a-f]{7,40}\.\.HEAD$/, 'a <sha>..HEAD range')
  const deepestSha = range.split('..')[0]
  const count = parseInt(execFileSync('git', ['-C', root, 'rev-list', '--count', range], { encoding: 'utf8' }).trim(), 10)
  assert.equal(count, 3, 'phase 10 start = parent of its move-commit ⇒ 3 commits to HEAD (deepest)')
  assert.ok(deepestSha)
  // no member matches ⇒ null (never a guessed range)
  assert.equal(deriveArcSuiteRange(root, [9999], defaultExec), null)
})

test('buildRunnerSummary — an impacted-scope landing reports fullSuiteGreen:false + a reason naming the range and the CI backstop', () => {
  const state = { arcId: 'A', censusEntries: [], hasCriteria: false, suiteMode: 'impacted', suiteRange: 'abc123..HEAD' }
  const s = buildRunnerSummary(state, { suiteGreen: true })
  assert.equal(s.gateSignals.fullSuiteGreen, false, 'an impacted run never claims a full green')
  assert.match(s.reason, /IMPACTED scope only \(abc123\.\.HEAD\)/, 'the reason names the impacted range')
  assert.match(s.reason, /ci-pr-gate per PR \+ nightly/, 'the reason names the CI full-suite backstop')
})

test('buildRunnerSummary — a full-scope landing keeps fullSuiteGreen:true with no reason', () => {
  const state = { arcId: 'A', censusEntries: [], hasCriteria: false, suiteMode: 'full', suiteRange: null }
  const s = buildRunnerSummary(state, { suiteGreen: true })
  assert.equal(s.gateSignals.fullSuiteGreen, true)
  assert.equal(s.reason, undefined, 'a genuine full green carries no deferral reason')
})
