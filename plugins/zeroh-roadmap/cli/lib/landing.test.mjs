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
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOCKERS, evaluateBlockers, gatherLandingState, buildRunnerSummary, runArcEndSuite, deriveArcSuiteRange, deriveArcSuiteScope } from './landing.mjs'
import * as landingMod from './landing.mjs'
import { arcEvalsDir, LESSONS_FILE } from '../commands/eval.mjs'
import { IMPACTED_FALLBACK_NOTE } from './slots.mjs'
import { defaultExec } from './exec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const tsSrc = (obj) =>
  'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
const CONFIG = { configVersion: 1, gateCommands: { lint: 'l', types: 't', unit: 'u', integration: 'i', build: 'b', e2e: 'none', emit: 'e' }, mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: ['develop'], primaryCheckout: '/nope' } }

// Lazy resolution keeps the missing test-first export a focused RED instead of preventing the
// rest of this mature suite from loading.
const carryLaneEvidence = (...args) => {
  assert.equal(typeof landingMod.carryLaneEvidence, 'function', 'landing.mjs must export carryLaneEvidence(primaryRoot, laneDir, phaseNum)')
  return landingMod.carryLaneEvidence(...args)
}

test('carryLaneEvidence — carries novel gate reports and beacon lines without overwriting primary evidence', () => {
  const primary = mkdtempSync(join(tmpdir(), 'zr-evidence-primary-'))
  const lane = mkdtempSync(join(tmpdir(), 'zr-evidence-lane-'))
  bases.push(primary, lane)
  const phaseNum = 2801
  const primaryGate = join(primary, 'roadmap', '.gate', String(phaseNum))
  const laneGate = join(lane, 'roadmap', '.gate', String(phaseNum))
  mkdirSync(primaryGate, { recursive: true })
  mkdirSync(laneGate, { recursive: true })
  const keptBytes = '{"owner":"primary","must":"survive byte-identical"}\n'
  writeFileSync(join(primaryGate, 'run-1.json'), keptBytes)
  writeFileSync(join(laneGate, 'run-1.json'), '{"owner":"lane","must":"not overwrite"}\n')
  writeFileSync(join(laneGate, 'run-2.json'), '{"owner":"lane","round":2}\n')
  mkdirSync(join(primary, '.building'), { recursive: true })
  mkdirSync(join(lane, '.building'), { recursive: true })
  const shared = '{"event":"executor-start","task":"28.1"}'
  const second = '{"event":"test-red","task":"28.1"}'
  const third = '{"event":"test-green","task":"28.1"}'
  writeFileSync(join(primary, '.building', `${phaseNum}-executor.jsonl`), `${shared}\n`)
  writeFileSync(join(lane, '.building', `${phaseNum}-executor.jsonl`), `${shared}\n${second}\n${third}\n`)

  const result = carryLaneEvidence(primary, lane, phaseNum)

  assert.deepEqual(result, { reports: 1, kept: 1, beaconLines: 2 })
  assert.equal(readFileSync(join(primaryGate, 'run-1.json'), 'utf8'), keptBytes, 'same-named primary report remains byte-identical')
  assert.equal(readFileSync(join(primaryGate, 'run-2.json'), 'utf8'), '{"owner":"lane","round":2}\n', 'the novel report is copied byte-for-byte')
  assert.deepEqual(
    readFileSync(join(primary, '.building', `${phaseNum}-executor.jsonl`), 'utf8').trim().split('\n'),
    [shared, second, third],
    'the existing beacon line stays first and only missing exact lines append',
  )
})

test('carryLaneEvidence — a lane with no gate directory or beacon carries zero and does not throw', () => {
  const primary = mkdtempSync(join(tmpdir(), 'zr-evidence-primary-empty-'))
  const lane = mkdtempSync(join(tmpdir(), 'zr-evidence-lane-empty-'))
  bases.push(primary, lane)
  assert.deepEqual(carryLaneEvidence(primary, lane, 2802), { reports: 0, kept: 0, beaconLines: 0 })
})

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
  s.descopes = [{ item: 'touched the live marketplace checkout', ratifiedBy: 'user', ratifiedAt: '2026-07-28' }]
  assert.deepEqual(evaluateBlockers(s), [], 'a TYPED descope object matches on its item text')
  s.descopes = [{ item: 'an unrelated ratification entry', ratifiedBy: 'user', ratifiedAt: '2026-07-28' }]
  assert.deepEqual(ids(evaluateBlockers(s)), [2], 'a non-matching typed descope does not ratify')
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

test('blocker 4 — suiteMode defer-ci is a NAMED deferral: clears with suiteGreen null (CI is the gate)', () => {
  const s = clear(); s.suiteGreen = null; s.suiteMode = 'defer-ci'
  assert.deepEqual(evaluateBlockers(s), [], 'defer-ci never holds blocker 4 — the deferral is recorded in the RunnerSummary, not faked as green')
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

test('deriveArcSuiteScope — unions ONLY the member commits\' files into an @manifest; sibling commits excluded; zero members ⇒ null', () => {
  const root = mkdtempSync(join(tmpdir(), 'zr-scope-'))
  bases.push(root)
  const gg = (...a) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' })
  gg('init', '-q')
  writeFileSync(join(root, 'seed.txt'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'seed')
  writeFileSync(join(root, 'mine-a.txt'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'feat: phase 10 — task one')
  writeFileSync(join(root, 'sibling.txt'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'feat: other arc work')
  writeFileSync(join(root, 'mine-b.txt'), '1'); gg('add', '-A'); gg('commit', '-q', '-m', 'docs: phase 10 — task two')
  const scope = deriveArcSuiteScope(root, [10], defaultExec)
  assert.ok(scope !== null, 'scope derives')
  assert.equal(scope.commitCount, 2)
  const manifest = JSON.parse(readFileSync(scope.filesFrom, 'utf8'))
  assert.equal(manifest.protocol, 'scope-manifest-json-v1')
  assert.deepEqual(manifest.paths, ['mine-a.txt', 'mine-b.txt'], 'only the member commits\' files — the sibling commit is excluded')
  scope.cleanup()
  assert.equal(existsSync(scope.filesFrom), false, 'the landing owner removes its temporary manifest')
  // no member commit matches ⇒ null (the caller falls back to the contiguous range)
  assert.equal(deriveArcSuiteScope(root, [9999], defaultExec), null)
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

test('buildRunnerSummary — an externally-landed arc reports fullSuiteGreen:false + a reason naming the external land', () => {
  const state = { arcId: 'A', censusEntries: [], hasCriteria: false, suiteMode: 'external', landedExternally: true, suiteRange: null }
  const s = buildRunnerSummary(state, { suiteGreen: null })
  assert.equal(s.gateSignals.fullSuiteGreen, false, 'an external land never claims a green suite')
  assert.match(s.reason, /landed EXTERNALLY/, 'the reason names the external land')
  assert.match(s.reason, /bookkeeping only/, 'the reason scopes what arc land actually did')
})

test('buildRunnerSummary — a defer-ci landing reports fullSuiteGreen:false + a reason naming the CI deferral', () => {
  const state = { arcId: 'A', censusEntries: [], hasCriteria: false, suiteMode: 'defer-ci', suiteRange: null }
  const s = buildRunnerSummary(state, { suiteGreen: null })
  assert.equal(s.gateSignals.fullSuiteGreen, false, 'a deferred suite is NEVER reported green')
  assert.match(s.reason, /DEFERRED to CI/, 'the reason names the deferral')
  assert.match(s.reason, /release pipeline is the full-suite gate/, 'the reason names who owns the gate')
})

// ── zero-overlap auto-reconcile (postmortem 3.5) ──────────────────────────────────────
test('reconcileZeroOverlap — overlap present ⇒ no merge attempted; zero overlap ⇒ merges baseRef in the worktree and re-probes', async () => {
  const { reconcileZeroOverlap } = await import('./landing.mjs')
  // overlap present → refuses to touch git
  const calls = []
  const spy = (file, args) => { calls.push(args); return { status: 0, stdout: '', stderr: '' } }
  const held = { integrationModel: 'isolated', baseRefMoved: true, overlapFiles: ['src/shared.ts'], sidecar: { worktree: tmpdir() } }
  const r1 = reconcileZeroOverlap(held, spy)
  assert.equal(r1.attempted, false)
  assert.match(r1.reason, /overlapping files/)
  assert.equal(calls.length, 0, 'no git command ran')
  // direct model / base not moved → not applicable
  assert.equal(reconcileZeroOverlap({ integrationModel: 'direct', baseRefMoved: true }, spy).attempted, false)
  assert.equal(reconcileZeroOverlap({ integrationModel: 'isolated', baseRefMoved: false }, spy).attempted, false)
  // worktree gone → refuses (the blockers hold honestly, nothing fatals)
  const gone = { integrationModel: 'isolated', baseRefMoved: true, overlapFiles: [], sidecar: { worktree: join(tmpdir(), 'zr-no-such-wt') } }
  assert.match(reconcileZeroOverlap(gone, spy).reason, /worktree missing/)
  // zero overlap + live worktree ON the arc branch → merge fires, probes re-run, state updated
  const mergeCalls = []
  const okSpy = (file, args) => {
    mergeCalls.push(args)
    if (args.includes('--abbrev-ref')) return { status: 0, stdout: 'arc/a\n', stderr: '' }
    if (args.includes('--is-ancestor')) return { status: 0, stdout: '', stderr: '' } // ancestor again post-merge
    if (args.includes('rev-list')) return { status: 0, stdout: '0\n', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const state = { integrationModel: 'isolated', baseRefMoved: true, overlapFiles: [], baseRef: 'develop', arcBranch: 'arc/a', primaryCheckout: '/p', sidecar: { worktree: tmpdir() } }
  const r2 = reconcileZeroOverlap(state, okSpy)
  assert.deepEqual(r2, { attempted: true, merged: true })
  assert.ok(mergeCalls.some((a) => a.includes('merge') && a.includes('--no-edit') && a.includes('develop')), 'merged baseRef into the arc branch')
  assert.equal(state.baseRefMoved, false, 'the re-probe wrote the cleared state back')
  // a re-purposed worktree (HEAD ≠ arc branch) → refuses to merge in place, no git mutation
  const parkedSpy = (file, args) => {
    if (args.includes('--abbrev-ref')) return { status: 0, stdout: 'feature/other\n', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const parked = { integrationModel: 'isolated', baseRefMoved: true, overlapFiles: [], baseRef: 'develop', arcBranch: 'arc/a', primaryCheckout: '/p', sidecar: { worktree: tmpdir() } }
  const rp = reconcileZeroOverlap(parked, parkedSpy)
  assert.equal(rp.attempted, false)
  assert.match(rp.reason, /feature\/other, not arc\/a/, 'a foreign-branch worktree is never merged into')
  assert.equal(parked.baseRefMoved, true, 'state stands — the blockers hold honestly')
  // merge failure → abort + honest refusal, state NOT falsely cleared
  const failSpy = (file, args) => {
    if (args.includes('--abbrev-ref')) return { status: 0, stdout: 'arc/a\n', stderr: '' }
    if (args.includes('--no-edit')) return { status: 1, stdout: '', stderr: 'merge failed' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const s3 = { integrationModel: 'isolated', baseRefMoved: true, overlapFiles: [], baseRef: 'develop', arcBranch: 'arc/a', primaryCheckout: '/p', sidecar: { worktree: tmpdir() } }
  const r3 = reconcileZeroOverlap(s3, failSpy)
  assert.equal(r3.merged, false)
  assert.equal(s3.baseRefMoved, true, 'a failed merge leaves the moved state standing')
})

// ── 1792.4 — detached arc-land journal + resume detection ─────────────────────────────
// Dynamic import so a MISSING export reds only its own case, never the whole file.
const LAND = await import('./landing.mjs')
const wt = (tag) => {
  const d = mkdtempSync(join(tmpdir(), `zr-landjrnl-${tag}-`))
  bases.push(d)
  return d
}

test('landJournalPath — <worktree>/.building/<arcId>-land.json (mirrors the sidecar shape)', () => {
  const root = wt('path')
  assert.equal(LAND.landJournalPath(root, 'FRONTDOOR'), join(root, '.building', 'FRONTDOOR-land.json'))
})

test('writeLandJournal — creates the journal (mkdir -p), stamps updatedAt, returns what it wrote', () => {
  const root = wt('write')
  const started = '2026-07-20T10:00:00.000Z'
  const written = LAND.writeLandJournal(root, 'ARC1', { pid: 4242, startedAt: started, step: 'suite' })
  const onDisk = JSON.parse(readFileSync(LAND.landJournalPath(root, 'ARC1'), 'utf8'))
  assert.deepEqual(onDisk, written, 'the returned object IS the persisted object')
  assert.equal(written.pid, 4242)
  assert.equal(written.startedAt, started)
  assert.equal(written.step, 'suite')
  assert.ok(!Number.isNaN(Date.parse(written.updatedAt)), 'updatedAt is a real timestamp')
})

test('writeLandJournal — a second write MERGES: earlier fields survive, step/updatedAt advance', async () => {
  const root = wt('merge')
  const first = LAND.writeLandJournal(root, 'ARC1', { pid: 7, startedAt: '2026-07-20T10:00:00.000Z', step: 'suite' })
  await new Promise((r) => setTimeout(r, 5))
  const second = LAND.writeLandJournal(root, 'ARC1', { step: 'merge', exitCode: 0 })
  assert.equal(second.pid, 7, 'pid from the first write survives the merge')
  assert.equal(second.startedAt, first.startedAt, 'startedAt is never re-stamped')
  assert.equal(second.step, 'merge', 'the patched field wins')
  assert.equal(second.exitCode, 0)
  assert.notEqual(second.updatedAt, first.updatedAt, 'updatedAt advances on every write')
  assert.deepEqual(JSON.parse(readFileSync(LAND.landJournalPath(root, 'ARC1'), 'utf8')), second)
})

test('readLandJournal — absent ⇒ null; present ⇒ the parsed object', () => {
  const root = wt('read')
  assert.equal(LAND.readLandJournal(root, 'ARC1'), null, 'no journal is null, never a fabricated shell')
  LAND.writeLandJournal(root, 'ARC1', { pid: 11, step: 'push' })
  const got = LAND.readLandJournal(root, 'ARC1')
  assert.equal(got.pid, 11)
  assert.equal(got.step, 'push')
  assert.notEqual(got.corrupt, true)
})

test('readLandJournal — corrupt bytes ⇒ { corrupt:true, path }, never a throw', () => {
  const root = wt('corrupt')
  const p = LAND.landJournalPath(root, 'ARC1')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, '{"pid": 12, "step": ')
  const got = LAND.readLandJournal(root, 'ARC1')
  assert.equal(got.corrupt, true, 'a corrupt journal must not wedge the CLI')
  assert.equal(got.path, p, 'the corrupt shape names the file the operator must inspect')
})

test('classifyLandJournal — none / finished / live / stale, with the injected isAlive receiving the journal pid', () => {
  const calls = []
  const spy = (v) => (calls.push(v), spy.next)

  assert.deepEqual(LAND.classifyLandJournal(null, { isAlive: spy }), { state: 'none' })
  assert.deepEqual(calls, [], 'an absent journal probes nothing')

  // exitCode present ⇒ finished, whatever the pid's liveness (never probed as the verdict)
  assert.deepEqual(
    LAND.classifyLandJournal({ pid: 5, step: 'merge', exitCode: 0 }, { isAlive: () => true }),
    { state: 'finished', exitCode: 0 },
  )
  assert.deepEqual(
    LAND.classifyLandJournal({ pid: 5, step: 'merge', exitCode: 1 }, { isAlive: () => false }),
    { state: 'finished', exitCode: 1 },
    'a NON-zero exit is still finished — the CLI reports it, never re-runs blind',
  )

  spy.next = true
  assert.deepEqual(LAND.classifyLandJournal({ pid: 4242, step: 'suite' }, { isAlive: spy }), {
    state: 'live', pid: 4242, step: 'suite',
  })
  assert.deepEqual(calls, [4242], 'isAlive is probed with the JOURNAL\'s pid, not process.pid')

  // dead pid, no exitCode ⇒ the reaped-land case: named stale, never silently overwritten
  spy.next = false
  assert.deepEqual(LAND.classifyLandJournal({ pid: 99, step: 'push' }, { isAlive: spy }), {
    state: 'stale', pid: 99, step: 'push',
  })
  assert.deepEqual(calls, [4242, 99])
})

test('classifyLandJournal — a corrupt journal is its own state, decided BEFORE any liveness probe', () => {
  let probed = false
  const v = LAND.classifyLandJournal({ corrupt: true, path: '/x/.building/A-land.json' }, {
    isAlive: () => { probed = true; return true },
  })
  assert.deepEqual(v, { state: 'corrupt' })
  assert.equal(probed, false, 'unparseable bytes carry no trustworthy pid to probe')
})

test('classifyLandJournal — a journal missing pid never throws (falls to stale on a false probe)', () => {
  const seen = []
  const v = LAND.classifyLandJournal({ step: 'suite' }, { isAlive: (p) => (seen.push(p), false) })
  assert.equal(v.state, 'stale', 'no pid ⇒ nothing provably alive ⇒ stale, not live and not a crash')
  assert.equal(v.step, 'suite')
  assert.deepEqual(seen, [undefined], 'the probe is still called — the seam decides, not a silent short-circuit')
})

// ── 1792.5b — stale-base EARLY WARNING (staleBaseWarning) ─────────────────────────────
// Pure band [40% of ceiling, ceiling) — at/over the ceiling blocker 8 owns it, so the
// warning must go silent there rather than double-report the same drift.
// Ceiling 250 keeps the 40% boundary exact (100) with no rounding ambiguity.
const warn = (behind, ceiling, ref = 'develop') => LAND.staleBaseWarning(behind, ceiling, ref)

test('staleBaseWarning — below 40% of the ceiling is silent (null), including one commit under', () => {
  assert.equal(warn(0, 250), null)
  assert.equal(warn(1, 250), null)
  assert.equal(warn(99, 250), null, '99/250 = 39.6% — still under the band, exactly at the boundary-1')
})

test('staleBaseWarning — EXACTLY 40% of the ceiling warns (the band is inclusive at its floor)', () => {
  const w = warn(100, 250)
  assert.ok(w, '100/250 = 40% must warn — the boundary itself is in the band')
  assert.equal(w.behind, 100)
  assert.equal(w.ceiling, 250)
  assert.equal(w.pct, 40)
})

test('staleBaseWarning — inside the band the pct is the real ratio, not a constant', () => {
  assert.equal(warn(175, 250).pct, 70)
  assert.equal(warn(200, 250).pct, 80)
  assert.equal(warn(40, 100).pct, 40, 'a different ceiling rescales the band, not just the pct')
  assert.equal(warn(39, 100), null, 'and rescales the floor with it')
})

test('staleBaseWarning — one commit UNDER the ceiling still warns; AT and OVER the ceiling are silent', () => {
  assert.ok(warn(249, 250), 'the last commit inside the band still warns')
  assert.equal(warn(250, 250), null, 'at the ceiling blocker 8 owns the case — no duplicate warning')
  assert.equal(warn(251, 250), null, 'over the ceiling is the land-time BLOCKER, not a warning')
  assert.equal(warn(10_000, 250), null)
})

test('staleBaseWarning — the message names behind, ceiling AND the caller-supplied merge ref', () => {
  const w = warn(175, 250, 'develop')
  assert.match(w.message, /\b175\b/, 'the message names the behind-count')
  assert.match(w.message, /\b250\b/, 'the message names the ceiling it is approaching')
  assert.ok(
    w.message.includes('git merge origin/develop'),
    `the remedy must be the exact runnable command; got: ${w.message}`,
  )
})

test('staleBaseWarning — the ref is NOT baked in: a different baseRef changes the remedy', () => {
  const w = warn(175, 250, 'master')
  assert.ok(w.message.includes('git merge origin/master'), `got: ${w.message}`)
  assert.ok(!w.message.includes('origin/develop'), 'no hardcoded develop leaks into another arc\'s remedy')
})

// ── mergeLaneLessons — a disposed lane's lessons survive into the primary corpus (18.2) ────────
//
// A codex lane records its lessons in ITS OWN roadmap/arc-evals/lessons.jsonl (the append-only
// sidecar cli/commands/eval.mjs writes and `roadmap eval propose` reads). `land` then REMOVES
// that worktree, and every lesson the lane learned dies with the directory — the corpus the next
// proposal pass reads never hears them. These tests pin the merge itself; the WIRING of the two
// land paths is pinned beside the disposal each already performs (cli/lib/landing-mechanics.test.mjs
// for `arc land`, cli/commands/phase.test.mjs for `phase land`).
//
// Run: capbuild node --test cli/lib/landing.test.mjs

// Lazily resolved: a named import of a not-yet-existing export is a link-time SyntaxError that
// reds the WHOLE file, and a suite that cannot even load says nothing about the contract. Each
// test must red on its own, naming the signature it wanted (the cli/commands/phase.test.mjs idiom).
const mergeLaneLessons = (...args) => {
  assert.equal(
    typeof landingMod.mergeLaneLessons,
    'function',
    'cli/lib/landing.mjs must export mergeLaneLessons(primaryRoot, laneDir) => { merged: number }',
  )
  return landingMod.mergeLaneLessons(...args)
}

/** The corpus path, taken from the CONSTANTS the eval corpus itself uses — a second literal here
 *  would let the two halves drift and the merge would silently write to a file nobody reads. */
const lessonsPathOf = (root) => join(arcEvalsDir(root), LESSONS_FILE)

/**
 * A checkout root carrying a lessons corpus. `contents` null ⇒ no corpus file at all;
 * `mkdir` true additionally creates the (empty) roadmap/arc-evals directory, so "no file" and
 * "no directory either" are distinguishable cases rather than one blurred one.
 */
function lessonsTree(contents, { mkdir = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'zr-lessons-'))
  bases.push(root)
  if (contents !== null || mkdir) mkdirSync(arcEvalsDir(root), { recursive: true })
  if (contents !== null) writeFileSync(lessonsPathOf(root), contents)
  return root
}

/** Every line of a corpus as its reader sees it: split on \n with ONLY the final empty element
 *  (the trailing newline) dropped — a blank line in the middle is a real defect and stays visible. */
function corpusLines(root) {
  const parts = readFileSync(lessonsPathOf(root), 'utf8').split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts
}

test('mergeLaneLessons — a lane-only lesson is APPENDED to the primary corpus, after the primary’s own lines, in the lane’s order', () => {
  const primary = lessonsTree('{"k":"P1"}\n{"k":"P2"}\n')
  const lane = lessonsTree('{"k":"P1"}\n{"k":"L1"}\n{"k":"L2"}\n')
  const before = corpusLines(primary)

  const res = mergeLaneLessons(primary, lane)

  const after = corpusLines(primary)
  assert.deepEqual(
    after,
    ['{"k":"P1"}', '{"k":"P2"}', '{"k":"L1"}', '{"k":"L2"}'],
    'the primary keeps its own lines FIRST and in order; the lane-only lines arrive at the end in the order the lane recorded them',
  )
  assert.equal(res.merged, after.length - before.length, 'merged counts exactly the lines that reached the corpus, never the lines it read')
  assert.equal(res.merged, 2, 'two of the lane’s three lines were new')
  assert.deepEqual(
    corpusLines(lane),
    ['{"k":"P1"}', '{"k":"L1"}', '{"k":"L2"}'],
    'the lane corpus is READ, never rewritten — the lane is about to be deleted, but not by this function',
  )
})

test('mergeLaneLessons — an exact duplicate line never doubles, however many times the lane repeats it', () => {
  const primary = lessonsTree('{"k":"P1"}\n{"k":"P2"}\n')
  const lane = lessonsTree('{"k":"P1"}\n{"k":"L1"}\n{"k":"L1"}\n{"k":"P2"}\n{"k":"L1"}\n')

  const res = mergeLaneLessons(primary, lane)

  assert.deepEqual(
    corpusLines(primary),
    ['{"k":"P1"}', '{"k":"P2"}', '{"k":"L1"}'],
    'the two lines the primary already carried are not re-appended, and the lane’s own triple of L1 lands exactly once',
  )
  assert.equal(res.merged, 1, 'one line actually reached the corpus')
})

test('mergeLaneLessons — the duplicate rule is EXACT LINE identity: two different spellings of the same object are two lessons', () => {
  // Re-serializing to compare would rewrite the operator's own text (and cannot be done at all
  // for the malformed lines the corpus is required to keep verbatim).
  const primary = lessonsTree('{"a":1,"b":2}\n')
  const lane = lessonsTree('{"b":2,"a":1}\n')

  const res = mergeLaneLessons(primary, lane)

  assert.deepEqual(corpusLines(primary), ['{"a":1,"b":2}', '{"b":2,"a":1}'], 'a different line is a different lesson')
  assert.equal(res.merged, 1)
})

test('mergeLaneLessons — a SECOND merge of the same lane is a no-op: merged 0 and a byte-identical corpus', () => {
  const primary = lessonsTree('{"k":"P1"}\n')
  const lane = lessonsTree('{"k":"L1"}\n{"k":"L2"}\n')

  const first = mergeLaneLessons(primary, lane)
  const afterFirst = readFileSync(lessonsPathOf(primary), 'utf8')
  const second = mergeLaneLessons(primary, lane)

  assert.equal(first.merged, 2)
  assert.equal(second.merged, 0, 'a re-run merges nothing — a retried land must not grow the corpus by one copy per attempt')
  assert.equal(
    readFileSync(lessonsPathOf(primary), 'utf8'),
    afterFirst,
    'and it rewrites NOTHING: byte-identical, so no reordering, no re-spacing, no extra newline',
  )
})

test('mergeLaneLessons — an absent lane corpus (no file, and no directory at all) is merged 0 with the primary untouched, never a throw', () => {
  const primary = lessonsTree('{"k":"P1"}\n{"k":"P2"}\n')
  const bytes = readFileSync(lessonsPathOf(primary), 'utf8')
  const lanes = [
    lessonsTree(null, { mkdir: true }), // the arc-evals dir exists, the corpus does not
    lessonsTree(null), // no roadmap/arc-evals at all
    join(tmpdir(), 'zr-lessons-lane-that-never-existed-18-2'), // the whole lane directory is gone
  ]

  for (const lane of lanes) {
    const res = mergeLaneLessons(primary, lane)
    assert.equal(res.merged, 0, `a lane with nothing to say merges nothing (${lane})`)
    assert.equal(readFileSync(lessonsPathOf(primary), 'utf8'), bytes, `and the primary corpus is untouched (${lane})`)
  }
})

test('mergeLaneLessons — an absent PRIMARY corpus is created, directory and all: a first lesson is not a reason to drop it', () => {
  for (const primary of [lessonsTree(null), lessonsTree(null, { mkdir: true })]) {
    const lane = lessonsTree('{"k":"L1"}\n{"k":"L2"}\n')

    const res = mergeLaneLessons(primary, lane)

    assert.equal(res.merged, 2, `both lane lessons are kept (${primary})`)
    assert.deepEqual(corpusLines(primary), ['{"k":"L1"}', '{"k":"L2"}'], `the corpus was created carrying them (${primary})`)
  }
})

test('mergeLaneLessons — malformed and non-JSON lines survive VERBATIM on both sides; the primary is never reformatted', () => {
  // The corpus is append-only text a human also edits. A merge that parsed it would drop the
  // half-written line that is often the only record of what went wrong.
  const messy = 'not json at all\n{"k":"P2"\n   \n{"k":"P3"}\n'
  const primary = lessonsTree(messy)
  const lane = lessonsTree('{"k":"P2"\n### a lane note nobody parsed\n')

  const res = mergeLaneLessons(primary, lane)

  assert.deepEqual(
    corpusLines(primary),
    ['not json at all', '{"k":"P2"', '   ', '{"k":"P3"}', '### a lane note nobody parsed'],
    'every original line kept its exact text and position, and the lane’s unparseable note arrived intact',
  )
  assert.equal(res.merged, 1, 'the malformed line the primary ALREADY carried is a duplicate like any other')
})

test('mergeLaneLessons — a primary corpus with NO trailing newline is not glued to the appended line', () => {
  const primary = lessonsTree('{"k":"P1"}') // hand-edited file, last line unterminated
  const lane = lessonsTree('{"k":"L1"}\n')

  const res = mergeLaneLessons(primary, lane)

  assert.deepEqual(corpusLines(primary), ['{"k":"P1"}', '{"k":"L1"}'], 'two lines, not one glued `{"k":"P1"}{"k":"L1"}`')
  assert.equal(res.merged, 1)
  assert.ok(
    readFileSync(lessonsPathOf(primary), 'utf8').endsWith('\n'),
    'and the corpus is left newline-terminated, so the NEXT appender cannot glue either',
  )
})

test('mergeLaneLessons — empty lines in the lane corpus are not appended as lessons', () => {
  const primary = lessonsTree('{"k":"P1"}\n')
  const lane = lessonsTree('\n{"k":"L1"}\n\n')

  const res = mergeLaneLessons(primary, lane)

  assert.deepEqual(corpusLines(primary), ['{"k":"P1"}', '{"k":"L1"}'], 'the blank line and the trailing newline are separators, not lessons')
  assert.equal(res.merged, 1)
})
