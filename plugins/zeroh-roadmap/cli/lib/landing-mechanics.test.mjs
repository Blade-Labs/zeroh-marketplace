#!/usr/bin/env node
/**
 * landing-mechanics.test.mjs — the git ACTS of cli/lib/landing.mjs (arc ROADCODE 1657.5),
 * where the recorded incidents live (the ONEPROMPT branch:baseRef push; clobbered sibling
 * trees). Two fixture styles: (a) a RECORDING exec seam asserts the exact argv stream —
 * the "no ':' refspec token, ever" structural impossibility, the contention refusals with
 * the primary untouched, and the master/main rail; (b) a REAL scratch-git primary+worktree
 * proves the merge lands on LOCAL baseRef and a sibling's unpushed commit SURVIVES.
 * RunnerSummary is validated through the CONSUMER schema (re-export + zod symlink). Run:
 * node --test cli/lib/landing-mechanics.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { landArc, runArcEndSuite, validateRunnerSummary, buildRunnerSummary } from './landing.mjs'
import { defaultExec } from './exec.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = join(HERE, '..', '..')
const TEMPLATES_SCHEMA = join(PLUGIN_ROOT, 'templates', 'schema.ts')
const PLUGIN_ZOD = realpathSync(join(PLUGIN_ROOT, 'node_modules', 'zod'))
const bases = []
process.on('exit', () => bases.forEach((b) => rmSync(b, { recursive: true, force: true })))

const g = (root, ...a) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/** A git-inited consumer: lib/roadmap/schema.ts re-exports the plugin templates + a zod symlink. */
function makeConsumer(prefix = 'zr-landm-') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  bases.push(root)
  mkdirSync(join(root, 'lib', 'roadmap'), { recursive: true })
  writeFileSync(join(root, 'lib', 'roadmap', 'schema.ts'), `export * from '${TEMPLATES_SCHEMA}'\n`)
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  symlinkSync(PLUGIN_ZOD, join(root, 'node_modules', 'zod'), 'dir')
  mkdirSync(join(root, 'roadmap', 'arcs'), { recursive: true })
  g(root, 'init', '-q', '-b', 'develop')
  writeFileSync(join(root, 'base.txt'), 'base\n')
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', 'base on develop')
  return root
}

/** A recording exec — every git call logged; canned responses keyed on argv. */
function recordingExec(over = {}) {
  const calls = []
  const exec = (file, args) => {
    calls.push({ file, args })
    if (file !== 'git') return { status: 0, stdout: '', stderr: '' }
    if (args.includes('--abbrev-ref')) return { status: 0, stdout: (over.head ?? 'develop') + '\n', stderr: '' }
    if (args.includes('MERGE_HEAD')) return { status: over.mergeHead ? 0 : 1, stdout: '', stderr: '' }
    if (args.includes('merge-tree')) return { status: over.conflict ? 1 : 0, stdout: '', stderr: '' }
    if (args.includes('merge')) return { status: over.mergeFail ? 1 : 0, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  return { exec, calls }
}

const stateFor = (primary, over = {}) => ({
  arcId: 'A',
  members: [{ num: 10, done: true, kind: 'logic', executionResult: { status: 'done', hardStops: [] } }],
  hasCriteria: false,
  descopes: [],
  verdict: null,
  openFollowups: 0,
  openOperator: 0,
  censusEntries: [],
  mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: ['develop'], primaryCheckout: primary },
  baseRef: 'develop',
  arcBranch: 'arc/a',
  primaryCheckout: primary,
  sidecar: { worktree: join(primary, '..', 'wt-a'), branch: 'arc/a' },
  integrationModel: 'isolated',
  conflict: false,
  baseRefMoved: false,
  suiteGreen: true,
  reconciledGreen: false,
  ...over,
})
const configFor = (primary, over = {}) => ({ configVersion: 1, gateCommands: {}, mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: ['develop'], primaryCheckout: primary, ...over } })
const argvHasRefspec = (calls) => calls.some((c) => c.args.some((a) => String(a).includes(':')))

test('green isolated landing — merges into local baseRef; the recorded argv contains NO ":" refspec token', () => {
  const primary = makeConsumer()
  const { exec, calls } = recordingExec()
  const state = stateFor(primary)
  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state })
  assert.equal(res.outcome, 'landed')
  assert.equal(res.exitCode, 0)
  assert.ok(res.record.some((s) => s.step === 'merge' && s.into === 'develop'), 'merges arc branch INTO local develop')
  assert.equal(argvHasRefspec(calls), false, 'no push argv may carry a <branch>:<baseRef> refspec (structural impossibility)')
  assert.ok(calls.some((c) => c.args.includes('push') && c.args.includes('origin') && c.args.includes('develop')), 'push is `push origin develop`, exactly')
  assert.ok(existsSync(join(primary, 'roadmap', 'arc-summary.json')), 'RunnerSummary pointer written')
  assert.ok(existsSync(res.summaryPath), 'RunnerSummary keyed history written')
})

test('contention — primary HEAD is not baseRef ⇒ exit 2, primary UNTOUCHED (no merge attempted)', () => {
  const primary = makeConsumer()
  const { exec, calls } = recordingExec({ head: 'feature/sibling' })
  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary) })
  assert.equal(res.exitCode, 2)
  assert.equal(res.outcome, 'blocker')
  assert.match(res.held[0].reason, /wait for the sibling; never branch-switch/)
  assert.ok(!calls.some((c) => c.args.includes('merge') && !c.args.includes('merge-tree')), 'no merge attempted on the primary')
})

test('contention — a MERGE_HEAD in the primary ⇒ exit 2', () => {
  const primary = makeConsumer()
  const { exec } = recordingExec({ mergeHead: true })
  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary) })
  assert.equal(res.exitCode, 2)
  assert.match(res.held[0].name, /MERGE_HEAD/)
})

test('push — fires only when autonomousPushRefs contains baseRef; --no-push suppresses; master/main refused', () => {
  const primary = makeConsumer()
  // (a) develop listed → push fires
  let r = recordingExec()
  landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec: r.exec, flags: {}, state: stateFor(primary) })
  assert.ok(r.calls.some((c) => c.args.includes('push')), 'develop in autonomousPushRefs → push fires')
  // (b) --no-push suppresses
  r = recordingExec()
  landArc({ repoRoot: makeConsumer(), arcId: 'A', config: configFor(primary), exec: r.exec, flags: { noPush: true }, state: stateFor(primary) })
  assert.ok(!r.calls.some((c) => c.args.includes('push')), '--no-push wins')
  // (c) develop NOT listed → no push
  r = recordingExec()
  const noRefState = stateFor(primary, { mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: [], primaryCheckout: primary } })
  landArc({ repoRoot: makeConsumer(), arcId: 'A', config: configFor(primary, { autonomousPushRefs: [] }), exec: r.exec, flags: {}, state: noRefState })
  assert.ok(!r.calls.some((c) => c.args.includes('push')), 'baseRef not listed → no push')
  // (d) master rail — refused even when listed + --push
  r = recordingExec({ head: 'master' })
  const masterState = stateFor(makeConsumer(), { baseRef: 'master' })
  const res = landArc({ repoRoot: masterState.primaryCheckout, arcId: 'A', config: configFor(masterState.primaryCheckout), exec: r.exec, flags: { push: true }, state: masterState })
  assert.ok(!r.calls.some((c) => c.args.includes('push')), 'pushBaseRef refuses master BEFORE any git push call')
  assert.match(res.pushRefused, /refuses master/)
})

test('cleanup — landing removes the sidecar, RESUME.md, and claims', () => {
  const primary = makeConsumer()
  mkdirSync(join(primary, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(primary, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: primary }))
  writeFileSync(join(primary, 'roadmap', 'arcs', 'A-RESUME.md'), '# notes\n')
  const { exec } = recordingExec()
  landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary) })
  assert.ok(!existsSync(join(primary, 'roadmap', 'arcs', '.building', 'A.json')), 'sidecar removed')
  assert.ok(!existsSync(join(primary, 'roadmap', 'arcs', 'A-RESUME.md')), 'RESUME.md removed')
})

test('RunnerSummary — validated through the CONSUMER RunnerSummaryShape; a broken summary fails LOUD', () => {
  const consumer = makeConsumer()
  const good = buildRunnerSummary(stateFor(consumer), { suiteGreen: true })
  assert.doesNotThrow(() => validateRunnerSummary(consumer, good))
  assert.equal(good.receiptRef, 'none', 'honest receipt sentinel')
  assert.equal(good.gateSignals.fullSuiteGreen, true)
  // A summary missing required fields must fail .parse (never ship a broken artifact).
  assert.throws(() => validateRunnerSummary(consumer, { arcId: 'A', outcome: 'shipped' }))
})

test('RunnerSummary — no second Zod copy: landing.mjs defines no RunnerSummaryShape z.object', () => {
  const src = readFileSync(join(HERE, 'landing.mjs'), 'utf8')
  assert.equal(/RunnerSummaryShape\s*=\s*z\./.test(src), false, 'landing.mjs must validate through the consumer shape, never define its own')
})

test('runArcEndSuite — a red slot ⇒ suiteGreen false; all-green ⇒ true; all-absent ⇒ no-runtime note', async () => {
  const green = await runArcEndSuite({ config: { gateCommands: { unit: 'true', integration: 'true' } }, cwd: process.cwd() })
  assert.equal(green.suiteGreen, true)
  const red = await runArcEndSuite({ config: { gateCommands: { unit: 'true', integration: 'false' } }, cwd: process.cwd() })
  assert.equal(red.suiteGreen, false)
  const docsOnly = await runArcEndSuite({ config: { gateCommands: { unit: 'none', integration: 'none' } }, cwd: process.cwd() })
  assert.equal(docsOnly.ran, false)
  assert.match(docsOnly.note, /no runtime suite/)
})

// ── `roadmap arc land` end-to-end over the real bin (exits 0 / 3 / 2) ──
const BIN = join(PLUGIN_ROOT, 'bin', 'roadmap.mjs')
const tsSrc = (obj) => 'export default ' + JSON.stringify(obj, null, 2).replace(/"([\w$]+)":/g, '$1:').replace(/"/g, "'") + '\n'
function landBin(root, args) {
  try {
    const stdout = execFileSync('node', [BIN, 'arc', 'land', ...args], { cwd: root, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ROADMAP_CONFIG: join(root, 'roadmap', 'roadmap.config.json') } })
    return { code: 0, stdout }
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout ?? '').toString(), stderr: (e.stderr ?? '').toString() }
  }
}
/** A full arc consumer: schema + zod + registry stub + arc file + one member + config. */
function makeArcConsumer({ memberStatus = 'done', arcIntegration = 'autonomous', arcEndSuite = null, impacted = false, isolated = false } = {}) {
  const root = makeConsumer('zr-landbin-')
  writeFileSync(join(root, 'lib', 'roadmap', 'registry.ts'), 'export async function discoverPhases() { return { phases: [], errors: [] } }\nexport async function discoverArcs() { return { arcs: [] } }\n')
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', 'A.arc.ts'), tsSrc({ id: 'A', baseRef: 'develop', planes: [{ name: 'P', phases: [10] }] }))
  writeFileSync(join(root, 'roadmap', 'phases', 'phase-10.phase.ts'), tsSrc({ phase: 10, status: memberStatus, arcId: 'A', kind: 'logic', tasks: [{ id: '10.1', done: memberStatus === 'done' }], executionResult: { status: 'done', hardStops: [] } }))
  // Default slots stay SILENT ('true') so the existing JSON.parse(r.stdout) tests are
  // unmodified; the new impacted/isolated fixtures opt into echoing stubs to observe which
  // slot actually ran (those tests extract the JSON line rather than parse the whole stream).
  const observe = impacted || isolated
  const gateCommands = observe
    ? { lint: 'true', types: 'true', unit: 'echo FULL_UNIT_RAN', integration: 'echo FULL_INT_RAN', build: 'true', e2e: 'none', emit: 'true' }
    : { lint: 'true', types: 'true', unit: 'true', integration: 'true', build: 'true', e2e: 'none', emit: 'true' }
  if (impacted) {
    // range-echoing stubs so the substituted {range} proves impacted resolution in stdout
    gateCommands['unit-impacted'] = 'echo IMPACTED_UNIT_RAN {range}'
    gateCommands['integration-impacted'] = 'echo IMPACTED_INT_RAN {range}'
  }
  const mergePolicy = { arcIntegration, maxOpenFollowups: 0, autonomousPushRefs: [], primaryCheckout: root }
  if (arcEndSuite) mergePolicy.arcEndSuite = arcEndSuite
  writeFileSync(join(root, 'roadmap', 'roadmap.config.json'), JSON.stringify({ configVersion: 1, gateCommands, mergePolicy }))
  // Sidecar: worktree@develop ⇒ direct-on-baseRef model (no merge); branch 'arc/a' ⇒ isolated.
  mkdirSync(join(root, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(root, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: root, branch: isolated ? 'arc/a' : 'develop' }))
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', 'seed arc consumer')
  // A `phase 10 —` move-commit so deriveArcSuiteRange resolves a real <sha>..HEAD range.
  writeFileSync(join(root, 'member-work.txt'), 'work\n')
  g(root, 'add', '-A')
  g(root, 'commit', '-q', '-m', 'feat: phase 10 — move to in-progress')
  return root
}

test('arc land command — exit 3 held-for-user when mergePolicy.arcIntegration is hold', () => {
  const r = landBin(makeArcConsumer({ arcIntegration: 'hold' }), ['A', '--json'])
  assert.equal(r.code, 3)
  assert.equal(JSON.parse(r.stdout).action, 'held')
})

test('arc land command — exit 2 blocked when a member is not done', () => {
  const r = landBin(makeArcConsumer({ memberStatus: 'backlog' }), ['A', '--json'])
  assert.equal(r.code, 2)
  const out = JSON.parse(r.stdout)
  assert.equal(out.action, 'blocked')
  assert.equal(out.held[0].id, 1)
})

test('arc land command — exit 0 landed end-to-end (direct-on-baseRef, no member incomplete)', () => {
  // The consumer IS the primary checkout on develop → direct integration model (no merge).
  const root = makeArcConsumer()
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 0, `expected landed; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  assert.equal(JSON.parse(r.stdout).action, 'landed')
  assert.ok(existsSync(join(root, 'roadmap', 'arc-summary.json')), 'RunnerSummary written by the command')
})

test('arc land command — direct + arcEndSuite impacted runs the impacted slots with a <sha>..HEAD range, lands exit 0, summary defers honestly', () => {
  const root = makeArcConsumer({ arcEndSuite: 'impacted', impacted: true })
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 0, `expected landed; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  // the impacted stub ran with the derived range substituted verbatim (never the full slot)
  assert.match(r.stdout, /IMPACTED_UNIT_RAN [0-9a-f]{7,40}\.\.HEAD/, 'unit-impacted ran with the derived range')
  assert.match(r.stdout, /IMPACTED_INT_RAN [0-9a-f]{7,40}\.\.HEAD/, 'integration-impacted ran with the derived range')
  assert.doesNotMatch(r.stdout, /FULL_UNIT_RAN/, 'the full unit slot did NOT run')
  const summary = JSON.parse(readFileSync(join(root, 'roadmap', 'arc-summary.json'), 'utf8'))
  assert.equal(summary.gateSignals.fullSuiteGreen, false, 'an impacted landing never claims a full green')
  assert.match(summary.reason, /IMPACTED scope only/, 'the summary reason names the impacted scope')
  assert.match(summary.reason, /ci-pr-gate per PR \+ nightly/, 'the summary reason names the CI backstop')
})

test('arc land command — ISOLATED model IGNORES arcEndSuite impacted and runs the FULL slots (direct-only guard)', () => {
  // The sidecar branch is arc/a (≠ baseRef develop) ⇒ isolated model ⇒ the guard forces full.
  const root = makeArcConsumer({ arcEndSuite: 'impacted', impacted: true, isolated: true })
  const r = landBin(root, ['A', '--json'])
  // echoing slots interleave with the emitted JSON line — extract the JSON object line
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.suite.mode, 'full', 'an isolated landing runs the full suite regardless of arcEndSuite: impacted')
  assert.match(r.stdout, /FULL_UNIT_RAN/, 'the full unit slot ran')
  assert.doesNotMatch(r.stdout, /IMPACTED_UNIT_RAN/, 'the impacted slot did NOT run under the isolated model')
})

test('REAL merge — landing merges into LOCAL develop and a sibling unpushed commit SURVIVES (never clobbered)', () => {
  const primary = makeConsumer()
  // Arc branch off the base, with its own commit, checked out in a linked worktree.
  g(primary, 'branch', 'arc/a')
  const wt = realpathSync(mkdtempSync(join(tmpdir(), 'zr-landm-wt-')))
  bases.push(wt)
  g(primary, 'worktree', 'add', '-q', wt, 'arc/a')
  writeFileSync(join(wt, 'arc-work.txt'), 'arc feature\n')
  g(wt, 'add', '-A')
  g(wt, 'commit', '-q', '-m', 'feat: phase 10 — arc work')
  // A sibling's UNPUSHED commit on local develop (the ONEPROMPT clobber class).
  writeFileSync(join(primary, 'sibling.txt'), 'sibling unpushed\n')
  g(primary, 'add', '-A')
  g(primary, 'commit', '-q', '-m', 'sibling: unrelated unpushed develop work')

  const state = stateFor(primary, { arcBranch: 'arc/a', sidecar: { worktree: wt, branch: 'arc/a' }, mergePolicy: { arcIntegration: 'autonomous', maxOpenFollowups: 0, autonomousPushRefs: [], primaryCheckout: primary } })
  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary, { autonomousPushRefs: [] }), exec: defaultExec, flags: {}, state })
  assert.equal(res.outcome, 'landed')
  const log = g(primary, 'log', '--format=%s', 'develop')
  assert.match(log, /arc work/, 'the arc commit landed on local develop')
  assert.match(log, /sibling: unrelated unpushed develop work/, 'the sibling unpushed commit survived the merge — never clobbered')
})
