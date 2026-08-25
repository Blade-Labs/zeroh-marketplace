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
    if (args.includes('--is-ancestor')) return { status: over.ffPossible ? 0 : 1, stdout: '', stderr: '' }
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

test('contention — primary parked off baseRef but the arc merge is FAST-FORWARD ⇒ ref surgery lands it (no checkout, no merge, master rail intact)', () => {
  const primary = makeConsumer()
  const { exec, calls } = recordingExec({ head: 'feature/sibling', ffPossible: true })
  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary) })
  assert.equal(res.outcome, 'landed', 'a FF arc lands under a parked primary')
  assert.ok(res.record.some((s) => s.step === 'ff-ref-update'), `ref surgery recorded: ${JSON.stringify(res.record)}`)
  assert.ok(calls.some((c) => c.args.includes('fetch') && c.args.includes('.') && c.args.includes('arc/a:develop')), 'the update is `git fetch . arc/a:develop` — git refuses non-FF and checked-out targets itself')
  assert.ok(!calls.some((c) => c.args.includes('checkout') || c.args.includes('switch')), 'the primary is never branch-switched')
  assert.ok(!calls.some((c) => c.args.includes('merge') && !c.args.includes('merge-tree') && !c.args.includes('merge-base')), 'no merge on the parked primary')
  // The master rail holds in the FF lane exactly like pushBaseRef.
  const m = recordingExec({ head: 'feature/sibling', ffPossible: true })
  const mres = landArc({ repoRoot: makeConsumer(), arcId: 'A', config: configFor(primary), exec: m.exec, flags: {}, state: stateFor(primary, { baseRef: 'master' }) })
  assert.equal(mres.outcome, 'blocker')
  assert.match(mres.held[0].reason, /refuses master/)
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
  g(root, 'config', 'user.email', 't@t')
  g(root, 'config', 'user.name', 't')
  if (isolated) {
    // A REAL isolated topology: arc/a in its own worktree (at `${root}-wt`), carrying the
    // member commit AHEAD of develop — a branch parked AT the develop tip reads (correctly)
    // as already-landed and would short-circuit the flows these fixtures exercise.
    g(root, 'branch', 'arc/a')
    const wt = `${root}-wt`
    bases.push(wt)
    g(root, 'worktree', 'add', '-q', wt, 'arc/a')
    writeFileSync(join(wt, 'member-work.txt'), 'work\n')
    g(wt, 'add', '-A')
    g(wt, 'commit', '-q', '-m', 'feat: phase 10 — move to in-progress')
    writeFileSync(join(root, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: wt, branch: 'arc/a' }))
  } else {
    // A `phase 10 —` move-commit so deriveArcSuiteRange resolves a real <sha>..HEAD range.
    writeFileSync(join(root, 'member-work.txt'), 'work\n')
    g(root, 'add', '-A')
    g(root, 'commit', '-q', '-m', 'feat: phase 10 — move to in-progress')
  }
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

test('arc land command — direct + arcEndSuite impacted runs the impacted slots with the arc-scope @manifest (never the full slot), lands exit 0, summary defers honestly', () => {
  const root = makeArcConsumer({ arcEndSuite: 'impacted', impacted: true })
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 0, `expected landed; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  // the impacted stub ran with the ARC-SCOPE manifest substituted verbatim (the member-commit
  // file union — sharper than the contiguous <sha>..HEAD range, which is now the fallback)
  assert.match(r.stdout, /IMPACTED_UNIT_RAN @\S+roadmap-arc-scope-\S+/, 'unit-impacted ran with the arc-scope @manifest')
  assert.match(r.stdout, /IMPACTED_INT_RAN @\S+roadmap-arc-scope-\S+/, 'integration-impacted ran with the arc-scope @manifest')
  assert.doesNotMatch(r.stdout, /FULL_UNIT_RAN/, 'the full unit slot did NOT run')
  const summary = JSON.parse(readFileSync(join(root, 'roadmap', 'arc-summary.json'), 'utf8'))
  assert.equal(summary.gateSignals.fullSuiteGreen, false, 'an impacted landing never claims a full green')
  assert.match(summary.reason, /IMPACTED scope only/, 'the summary reason names the impacted scope')
  assert.match(summary.reason, /ci-pr-gate per PR \+ nightly/, 'the summary reason names the CI backstop')
})

test('arc land command — ISOLATED model HONORS arcEndSuite impacted (direct-only guard retired — touched scope lands, CI is the full-suite gate)', () => {
  // The sidecar branch is arc/a (≠ baseRef develop) ⇒ isolated model; config impacted now wins.
  const root = makeArcConsumer({ arcEndSuite: 'impacted', impacted: true, isolated: true })
  const r = landBin(root, ['A', '--json'])
  // echoing slots interleave with the emitted JSON line — extract the JSON object line
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.suite.mode, 'impacted', 'an isolated landing honors arcEndSuite: impacted')
  assert.match(r.stdout, /IMPACTED_UNIT_RAN @\S+roadmap-arc-scope-\S+/, 'the impacted slot ran with the arc-scope @manifest')
  assert.doesNotMatch(r.stdout, /FULL_UNIT_RAN/, 'the full unit slot did NOT run for an isolated arc')
})

test('arc land command — arcEndSuite defer-ci skips local suites entirely; the summary records the deferral, never a green', () => {
  const root = makeArcConsumer({ arcEndSuite: 'defer-ci', impacted: true })
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 0, `expected landed; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.action, 'landed')
  assert.equal(out.suite.mode, 'defer-ci')
  assert.match(out.suite.note, /deferred to CI/)
  assert.doesNotMatch(r.stdout, /FULL_UNIT_RAN|IMPACTED_UNIT_RAN/, 'no test slot ran')
  const summary = JSON.parse(readFileSync(join(root, 'roadmap', 'arc-summary.json'), 'utf8'))
  assert.equal(summary.gateSignals.fullSuiteGreen, false, 'a deferred suite is never reported green')
  assert.match(summary.reason, /DEFERRED to CI/)
})

test('arc land command — --defer-suite flag defers per-invocation even with NO arcEndSuite configured', () => {
  const root = makeArcConsumer({ impacted: true })
  const r = landBin(root, ['A', '--json', '--defer-suite'])
  assert.equal(r.code, 0, `expected landed; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.suite.mode, 'defer-ci')
  assert.doesNotMatch(r.stdout, /FULL_UNIT_RAN|IMPACTED_UNIT_RAN/, 'no test slot ran under --defer-suite')
})

test('arc land command — cheap blockers refuse BEFORE any suite starts (postmortem 3.2 ordering)', () => {
  const root = makeArcConsumer({ memberStatus: 'backlog', impacted: true })
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 2)
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.action, 'blocked')
  assert.equal(out.held[0].id, 1)
  assert.match(out.suite.skipped, /pre-suite blockers held/)
  assert.doesNotMatch(r.stdout, /FULL_UNIT_RAN|IMPACTED_UNIT_RAN/, 'a refusal knowable in milliseconds never starts a suite')
  assert.match(r.stderr, /roadmap arc land: A — blocked \(pre-suite\) \(exit 2\)/, 'explicit terminal verdict on stderr')
})

test('arc land command — zero-overlap auto-reconcile: a moved baseRef touching NONE of the arc files merges automatically and the arc lands', () => {
  const root = makeArcConsumer({ arcEndSuite: 'impacted', impacted: true, isolated: true })
  const wt = `${root}-wt` // the fixture's real arc worktree
  writeFileSync(join(wt, 'arc-only.txt'), 'arc work\n')
  g(wt, 'add', 'arc-only.txt')
  g(wt, 'commit', '-q', '-m', 'feat: phase 10 — arc-only work')
  // …while develop moves on with a NON-overlapping file (METERTENANT attempts 1/3/5 shape).
  writeFileSync(join(root, 'develop-only.txt'), 'sibling work\n')
  g(root, 'add', 'develop-only.txt')
  g(root, 'commit', '-q', '-m', 'sibling: develop moved, zero overlap')
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 0, `expected landed; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.action, 'landed')
  assert.ok(out.reconciles?.some((x) => x.when === 'pre-suite' && x.merged === true), `the pre-suite zero-overlap reconcile merged baseRef into the arc branch; got ${JSON.stringify(out.reconciles)}`)
  const log = g(root, 'log', '--format=%s', 'develop')
  assert.match(log, /arc-only work/, 'the arc commit landed on develop')
  assert.match(log, /sibling: develop moved/, 'the sibling develop commit survived')
})

test('arc land command — an EXTERNALLY landed arc (hand-land direct push) completes the bookkeeping: exit 0, no suite, sidecar cleaned, summary names it', () => {
  const root = makeArcConsumer({ arcEndSuite: 'impacted', impacted: true, isolated: true })
  // The hand-land shape: someone merged the arc branch into develop outside the engine.
  g(root, 'merge', '--no-edit', 'arc/a')
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 0, `expected bookkeeping completion; stderr:\n${r.stderr}\nstdout:\n${r.stdout}`)
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.action, 'landed')
  assert.ok(out.record.some((s) => s.step === 'external-land-detected'), `external land recorded: ${JSON.stringify(out.record)}`)
  assert.match(out.suite.skipped, /externally landed/)
  assert.doesNotMatch(r.stdout, /IMPACTED_UNIT_RAN|FULL_UNIT_RAN/, 'no suite ran for an already-done merge')
  assert.ok(!existsSync(join(root, 'roadmap', 'arcs', '.building', 'A.json')), 'the stale sidecar is cleaned')
  const summary = JSON.parse(readFileSync(join(root, 'roadmap', 'arc-summary.json'), 'utf8'))
  assert.equal(summary.gateSignals.fullSuiteGreen, false, 'an external land never claims a green suite')
  assert.match(summary.reason, /EXTERNALLY/)
})

test('arc land command — an arc branch already on baseRef with an UNDONE member is NOT external-land: falls through and blocks honestly', () => {
  const root = makeArcConsumer({ memberStatus: 'backlog', impacted: true, isolated: true })
  g(root, 'merge', '--no-edit', 'arc/a')
  const r = landBin(root, ['A', '--json'])
  assert.equal(r.code, 2)
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.trimStart().startsWith('{')))
  assert.equal(out.held[0].id, 1, 'blocker 1 (member not done) holds — an unstarted/unfinished arc is never auto-completed')
  assert.ok(existsSync(join(root, 'roadmap', 'arcs', '.building', 'A.json')), 'the sidecar is NOT cleaned for an unfinished arc')
})

test('landArc — repoRoot pointing at a DELETED worktree still lands: post-merge acts anchor on the primary checkout (postmortem 3.6)', () => {
  const primary = makeConsumer()
  mkdirSync(join(primary, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(primary, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: primary }))
  const goneWt = join(primary, '..', 'zr-gone-wt-does-not-exist')
  const { exec } = recordingExec()
  const state = stateFor(primary, { sidecar: { worktree: goneWt, branch: 'arc/a' } })
  const res = landArc({ repoRoot: goneWt, arcId: 'A', config: configFor(primary), exec, flags: {}, state })
  assert.equal(res.outcome, 'landed', 'a vanished invocation root must never fail a completed merge')
  assert.ok(!existsSync(join(primary, 'roadmap', 'arcs', '.building', 'A.json')), 'sidecar removed via the primary checkout')
  assert.ok(existsSync(join(primary, 'roadmap', 'arc-summary.json')), 'RunnerSummary written to the primary checkout')
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

// ── arc land disposes every landed member's codex lane (6.2) ──────────────────────────────────
//
// do-arc's SKILL already names `arc land` the cleanup owner ("arc land completes the BOOKKEEPING
// only"). An audited checkout falsified the claim: two FULLY MERGED codex exec lanes squatted
// slot dirs for weeks. The disposal RAIL (cli/lib/worktree.mjs disposeWorktree) is committed and
// tested on its own; these tests pin the WIRING — one injected seam, inside the cleanup block
// that already removes the sidecar/RESUME.md/claims, best-effort by the same law.

/** A codex RUN-lane journal where codex.mjs launch() writes it — the PRIMARY's .building/, which
 *  is also where findJournal looks. `phases` is what makes a lane cover a member id. */
function seedCodexJournal(primary, phases, worktree) {
  const dir = join(primary, '.building')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `codex-${phases.join('-')}.json`)
  writeFileSync(
    path,
    JSON.stringify(
      { phases, lane: 'run', report: 'CODEX-REPORT.md', worktree, base: 'develop', pgid: null, startedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  )
  return path
}

/** The injected disposal seam: records every (repoRoot, dir, opts) and answers with a rail-shaped
 *  result. `answer` may be a function of the dir (per-lane outcomes) and may throw. */
function disposeRecorder(answer = { disposed: true, alreadyDisposed: false, reason: null, detail: null, branchDeleted: true }) {
  const calls = []
  const dispose = (repoRoot, dir, opts = {}) => {
    calls.push({ repoRoot, dir, opts })
    return typeof answer === 'function' ? answer(dir) : answer
  }
  return { dispose, calls }
}

const doneMember = (num) => ({ num, done: true, kind: 'logic', executionResult: { status: 'done', hardStops: [] } })

/** The record entry that NAMES a lane worktree, serialized. Which key carries the path is the
 *  implementer's choice; that the path AND its outcome are both readable from the record is not. */
function laneRecord(record, dir) {
  const hit = record.find((e) => e.worktree === dir || e.dir === dir || JSON.stringify(e).includes(dir))
  assert.ok(hit, `the land record must carry an entry naming the lane worktree ${dir}; got:\n${JSON.stringify(record, null, 2)}`)
  return JSON.stringify(hit)
}

test('cleanup — arc landing disposes EVERY landed member’s codex lane through the rail, anchored at the primary, beside the sidecar/RESUME.md/claims it already removed', () => {
  const primary = makeConsumer()
  mkdirSync(join(primary, 'roadmap', 'arcs', '.building'), { recursive: true })
  writeFileSync(join(primary, 'roadmap', 'arcs', '.building', 'A.json'), JSON.stringify({ arcId: 'A', worktree: primary }))
  writeFileSync(join(primary, 'roadmap', 'arcs', 'A-RESUME.md'), '# notes\n')
  const laneTen = `${primary}-codex-10`
  const laneEleven = `${primary}-codex-11`
  seedCodexJournal(primary, [10], laneTen)
  seedCodexJournal(primary, [11], laneEleven)
  const { exec } = recordingExec()
  const rec = disposeRecorder()
  // `arc land` routinely runs from INSIDE the arc worktree, so the invocation root may be the
  // very tree the land removes (postmortem 3.6): a disposal anchored on repoRoot would spawn
  // git in a deleted cwd and fail ENOENT before git ever parses argv.
  const goneWt = join(primary, '..', 'zr-gone-arc-wt-does-not-exist')

  const res = landArc({
    repoRoot: goneWt,
    arcId: 'A',
    config: configFor(primary),
    exec,
    flags: {},
    state: stateFor(primary, { members: [doneMember(10), doneMember(11)], sidecar: { worktree: goneWt, branch: 'arc/a' } }),
    dispose: rec.dispose,
  })

  assert.equal(res.outcome, 'landed')
  assert.deepEqual(
    rec.calls.map((c) => c.dir).sort(),
    [laneTen, laneEleven].sort(),
    `both landed members' lanes are disposed; got ${JSON.stringify(rec.calls.map((c) => c.dir))}`,
  )
  for (const c of rec.calls) {
    assert.equal(
      c.repoRoot,
      primary,
      'every disposal anchors at the PRIMARY checkout — the invocation root may be the very tree being removed (the METERTENANT rule)',
    )
    assert.ok(
      (c.opts?.allowUntracked ?? []).includes('CODEX-REPORT.md'),
      `the run lane's never-committed hand-off file must be excepted or every lane refuses on its own report; got ${JSON.stringify(c.opts)}`,
    )
  }
  // The new work EXTENDS the existing best-effort block; it never forks a second cleanup.
  assert.ok(!existsSync(join(primary, 'roadmap', 'arcs', '.building', 'A.json')), 'the sidecar is still removed')
  assert.ok(!existsSync(join(primary, 'roadmap', 'arcs', 'A-RESUME.md')), 'RESUME.md is still removed')
  assert.ok(
    res.record.some((s) => s.step === 'cleanup' && !s.warning),
    `the pre-existing cleanup step still records its removals; got:\n${JSON.stringify(res.record, null, 2)}`,
  )
})

test('cleanup — an arc delegated as ONE codex run shares one journal and one worktree: it is disposed EXACTLY once, not once per member', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10-11`
  seedCodexJournal(primary, [10, 11], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder()

  const res = landArc({
    repoRoot: primary,
    arcId: 'A',
    config: configFor(primary),
    exec,
    flags: {},
    state: stateFor(primary, { members: [doneMember(10), doneMember(11)] }),
    dispose: rec.dispose,
  })

  assert.equal(res.outcome, 'landed')
  assert.equal(
    rec.calls.length,
    1,
    `one worktree means one disposal — a second call would re-run the rail against a directory the first call removed; got ${JSON.stringify(rec.calls.map((c) => c.dir))}`,
  )
  assert.equal(rec.calls[0].dir, lane, 'and it is the shared multi-phase lane')
})

test('cleanup — a lane worktree that is ALREADY gone reports already-disposed and never fails the land', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10`
  seedCodexJournal(primary, [10], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder({ disposed: true, alreadyDisposed: true, reason: null, detail: null, branchDeleted: false })

  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.equal(res.outcome, 'landed')
  assert.equal(res.exitCode, 0, 'a vanished worktree is a state, not an error — /tmp dies and the land is still complete')
  assert.match(
    laneRecord(res.record, lane),
    /already-disposed/,
    'the record says already-disposed rather than claiming a removal this land did not perform',
  )
})

test('cleanup — the land record names each lane outcome, and a REFUSED disposal changes neither the outcome nor the exit code', () => {
  const primary = makeConsumer()
  const kept = `${primary}-codex-10`
  const gone = `${primary}-codex-11`
  seedCodexJournal(primary, [10], kept)
  seedCodexJournal(primary, [11], gone)
  const { exec } = recordingExec()
  const rec = disposeRecorder((dir) =>
    dir === kept
      ? {
          disposed: false,
          alreadyDisposed: false,
          reason: 'dirty',
          detail: `${kept} still carries uncommitted work — refusing to remove it:\n  ?? notes.txt (untracked, not a named lane artifact)`,
          branchDeleted: false,
        }
      : { disposed: true, alreadyDisposed: false, reason: null, detail: null, branchDeleted: true },
  )

  const res = landArc({
    repoRoot: primary,
    arcId: 'A',
    config: configFor(primary),
    exec,
    flags: {},
    state: stateFor(primary, { members: [doneMember(10), doneMember(11)] }),
    dispose: rec.dispose,
  })

  assert.equal(res.outcome, 'landed', 'the merge already happened — a refused cleanup never rewrites the land’s verdict')
  assert.equal(res.exitCode, 0)
  const refused = laneRecord(res.record, kept)
  assert.match(refused, /dirty/, 'the refusal REASON is in the record')
  assert.match(refused, /notes\.txt/, 'together with the detail naming what blocked it — an operator has to know what to do next')
  assert.match(laneRecord(res.record, gone), /disposed/, 'and the lane that went is recorded as disposed')
})

test('cleanup — a dispose that THROWS is still best-effort: the land keeps its outcome and the EXISTING cleanup catch records the warning', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10`
  seedCodexJournal(primary, [10], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder(() => {
    throw new Error('rm -rf exploded')
  })

  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.equal(res.outcome, 'landed', 'a cleanup fatal after a completed merge reads as a failed land — the exact crash the best-effort law exists to prevent')
  assert.equal(res.exitCode, 0)
  const warned = res.record.find((s) => s.step === 'cleanup' && s.warning)
  assert.ok(warned, `the new disposal work must sit INSIDE the existing best-effort catch; got:\n${JSON.stringify(res.record, null, 2)}`)
  assert.match(warned.warning, /rm -rf exploded/, 'and the warning names the real failure, never a generic one')
  assert.ok(existsSync(join(primary, 'roadmap', 'arc-summary.json')), 'everything after the cleanup block still runs — the RunnerSummary lands')
})

test('cleanup — a disposed member lane gets its journal ARCHIVED, so `codex status` reads the same closed answer whichever verb landed it', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10`
  const jPath = seedCodexJournal(primary, [10], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder()

  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.equal(res.outcome, 'landed')
  assert.ok(
    !existsSync(jPath),
    'the LIVE journal name must go — leaving it means `codex status 10` reads dead-no-report for a lane that ran and landed, while the same lane landed by `phase land` reads closed',
  )
  const closed = join(primary, '.building', 'codex-10.closed.json')
  assert.ok(existsSync(closed), `the journal is renamed to ${closed}, never deleted`)
  const j = JSON.parse(readFileSync(closed, 'utf8'))
  assert.deepEqual(j.phases, [10], 'carrying its phases')
  assert.ok(Number.isFinite(Date.parse(j.closedAt)), 'stamped with when it closed')
  assert.equal(typeof j.closedBy, 'string', 'and by which verb')
})

test('cleanup — a REFUSED member lane keeps its live journal: nothing may claim a lane closed while its worktree stands', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10`
  const jPath = seedCodexJournal(primary, [10], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder({ disposed: false, alreadyDisposed: false, reason: 'dirty', detail: `${lane} carries uncommitted work`, branchDeleted: false })

  landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.ok(existsSync(jPath), 'the journal stays LIVE — the lane is still there and still needs an operator')
  assert.ok(!existsSync(join(primary, '.building', 'codex-10.closed.json')), 'and nothing was archived')
})

test('cleanup — one lane throwing does not skip the REST: each disposal is isolated and named', () => {
  const primary = makeConsumer()
  const boom = `${primary}-codex-10`
  const ok = `${primary}-codex-11`
  seedCodexJournal(primary, [10], boom)
  seedCodexJournal(primary, [11], ok)
  const { exec } = recordingExec()
  const rec = disposeRecorder((dir) => {
    if (dir === boom) throw new Error('rm -rf exploded')
    return { disposed: true, alreadyDisposed: false, reason: null, detail: null, branchDeleted: true }
  })

  const res = landArc({
    repoRoot: primary,
    arcId: 'A',
    config: configFor(primary),
    exec,
    flags: {},
    state: stateFor(primary, { members: [doneMember(10), doneMember(11)] }),
    dispose: rec.dispose,
  })

  assert.equal(res.outcome, 'landed')
  assert.equal(res.exitCode, 0)
  assert.deepEqual(
    rec.calls.map((c) => c.dir).sort(),
    [boom, ok].sort(),
    'every lane is attempted — one exploding rm must not silently strand the arc\'s remaining worktrees',
  )
  assert.match(laneRecord(res.record, boom), /rm -rf exploded/, 'the lane that threw is named WITH its real failure')
  assert.match(laneRecord(res.record, ok), /disposed/, 'and the one after it still went')
})

test('cleanup — a lane whose directory is ALREADY gone still gets its journal archived', () => {
  const primary = makeConsumer()
  const jPath = seedCodexJournal(primary, [10], `${primary}-codex-10`)
  const { exec } = recordingExec()
  // /tmp died, or a sibling removed it first. The lane IS gone — which is precisely when the
  // journal must stop reading live, or `codex status 10` answers dead-no-report for a member
  // that ran and landed: the symptom the archive was added to remove.
  const rec = disposeRecorder({ disposed: true, alreadyDisposed: true, reason: null, detail: null, branchDeleted: false })

  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.equal(res.outcome, 'landed')
  assert.ok(!existsSync(jPath), 'the live journal name is gone for a lane that is gone')
  assert.ok(existsSync(join(primary, '.building', 'codex-10.closed.json')), 'archived, exactly as phase land would have')
})

test('cleanup — a journal naming a SLOT worktree is never disposed by arc land either', () => {
  const primary = makeConsumer()
  const slot = `${primary}-wt-1`
  seedCodexJournal(primary, [10], slot)
  const { exec } = recordingExec()
  const rec = disposeRecorder()

  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.equal(res.outcome, 'landed')
  assert.deepEqual(
    rec.calls,
    [],
    'a slot is not a lane: removing one takes its node_modules with it and leaves the slot registry holding a live claim on a deleted path — slot retirement is out of this rail\'s scope',
  )
})

test('cleanup — a disposed lane whose JOURNAL fails to archive records that, not a second contradictory dispose outcome', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10`
  seedCodexJournal(primary, [10], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder()

  const res = landArc({
    repoRoot: primary,
    arcId: 'A',
    config: configFor(primary),
    exec,
    flags: {},
    state: stateFor(primary),
    dispose: rec.dispose,
    archive: () => {
      throw new Error('EACCES writing the closed journal')
    },
  })

  assert.equal(res.outcome, 'landed')
  const laneEntries = res.record.filter((s) => s.step === 'codex-lane-dispose' && s.worktree === lane)
  assert.equal(
    laneEntries.length,
    1,
    `one lane, ONE outcome — a record carrying both 'disposed' and 'errored' for the same worktree blames the disposal for an archive failure and misleads a first-match reader; got:\n${JSON.stringify(laneEntries, null, 2)}`,
  )
  assert.equal(laneEntries[0].outcome, 'disposed', 'the disposal really did happen and the record must say so')
  const warned = res.record.find((s) => s.step === 'cleanup' && /archive/i.test(s.warning ?? ''))
  assert.ok(warned, `the archive failure gets its OWN warning; got:\n${JSON.stringify(res.record, null, 2)}`)
  assert.match(warned.warning, /EACCES/, 'naming the real failure')
})

test('cleanup — a merged lane branch that could not be deleted is NAMED in the land record', () => {
  const primary = makeConsumer()
  const lane = `${primary}-codex-10`
  seedCodexJournal(primary, [10], lane)
  const { exec } = recordingExec()
  const rec = disposeRecorder({
    disposed: true,
    alreadyDisposed: false,
    reason: null,
    detail: `${lane} was removed, but its merged branch codex/10 could NOT be deleted — a ref lock is held`,
    branchDeleted: false,
  })

  const res = landArc({ repoRoot: primary, arcId: 'A', config: configFor(primary), exec, flags: {}, state: stateFor(primary), dispose: rec.dispose })

  assert.match(
    laneRecord(res.record, lane),
    /could NOT be deleted/,
    'the rail reports a leaked merged branch in `detail` on the PASS path — a record that drops it makes the field dead and the leak invisible',
  )
})
