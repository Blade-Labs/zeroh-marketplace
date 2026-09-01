#!/usr/bin/env node
/**
 * Fixture suite for the v2 roadmap-file validator (bin/validate-roadmap-file.mjs).
 *
 * Each case writes a minimal roadmap file to a tmp roadmap tree (fixtures import
 * templates/schema.ts by absolute path — the consumer `@/` alias is unavailable
 * here), drives the REAL validator through its stdin hook payload, and asserts
 * the exit code + the rule name in stderr. The five v2 rules each get a rejected
 * fixture and a corrected twin; (b) additionally gets the template-literal
 * false-positive guard; a Zod failure asserts one `<path>: <message>` line + no
 * stack. Run: node --test bin/validate-roadmap-file.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VALIDATOR = join(HERE, 'validate-roadmap-file.mjs')
const SCHEMA = join(HERE, '..', 'templates', 'schema.ts')

/** Drive the validator exactly as the PostToolUse hook does. */
function runValidator(filePath, env = {}) {
  try {
    execFileSync('node', [VALIDATOR], {
      input: JSON.stringify({ tool_input: { file_path: filePath } }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
      env: { ...process.env, ...env },
    })
    return { code: 0, stderr: '' }
  } catch (err) {
    return { code: err.status ?? 1, stderr: (err.stderr ?? '').toString() }
  }
}

const tmpBases = []
function writeRoadmapFile(name, body) {
  const base = mkdtempSync(join(tmpdir(), 'zr-validator-'))
  tmpBases.push(base)
  const sub = name.endsWith('.arc.ts') ? 'arcs' : 'phases'
  const dir = join(base, 'roadmap', sub)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, body)
  return { path: p, base }
}
process.on('exit', () => {
  for (const b of tmpBases) {
    try {
      rmSync(b, { recursive: true, force: true })
    } catch {
      /* best-effort cleanup */
    }
  }
})

const IMPORT = `import { definePhase, defineArc } from '${SCHEMA}'`

// ── (a) status:'done' ⇒ every task done ─────────────────────────────────────────
const doneGate = `
  completedDate: '2026-07-05',
  gate: { lint: 'clean', typeCheck: 'clean', unitTests: { passed: 1, total: 1 }, integrationTests: { passed: 0, total: 0 }, e2eTests: { passed: 0, total: 0 }, build: 'clean' },
  gateRounds: ['Architect: clean'],
  metrics: { commits: 1, linesAdded: 1, linesRemoved: 0, filesChanged: 1, testsAtStart: 0, testsAtEnd: 1, testsAdded: 1 },`
const donePhase = (taskDone) => `${IMPORT}
export default definePhase({
  phase: 9001, name: 'fixture done phase name', status: 'done',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',${doneGate}
  tasks: [{ id: '9001.1', title: 'the fixture task title', problem: 'the fixture problem statement is intentionally long', steps: [{ file: 'x', description: 'do the described thing' }], acceptanceCriteria: ['it works as specified'], files: ['x'], testMode: 'none', done: ${taskDone} }],
})
`

test('(a) status:done with a done:false task is REJECTED; done:true twin passes', () => {
  const bad = writeRoadmapFile('phase-9001.phase.ts', donePhase(false))
  const r1 = runValidator(bad.path)
  assert.equal(r1.code, 2, 'open task under done must reject')
  assert.match(r1.stderr, /done-with-open-task/)
  const good = writeRoadmapFile('phase-9001.phase.ts', donePhase(true))
  assert.equal(runValidator(good.path).code, 0, 'all-done twin passes')
})

// ── (b) duplicate top-level key + the template-literal false-positive guard ──────
// Reproduces the phase-1287 trap: `status` appears twice; JS last-wins makes the
// effective status 'done' (import-valid via the gate below), but the file lies.
const dupStatus = `${IMPORT}
export default definePhase({
  phase: 9002,
  name: 'fixture dup status phase',
  status: 'in-progress',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',${doneGate}
  tasks: [],
  status: 'done',
})
`
const noDup = `${IMPORT}
export default definePhase({
  phase: 9002, name: 'fixture no dup phase', status: 'done',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',${doneGate}
  tasks: [],
})
`
// Reproduces the phase-174/295/991 pattern: a notes BACKTICK template literal whose
// prose lines are two-space-indented `key:` samples — must NOT be read as top-level keys.
const templateProse = `${IMPORT}
export default definePhase({
  phase: 9003, name: 'fixture template prose phase', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  notes: \`Investigation notes with column-2 prose that looks like keys:
  Evidence: the model fabricated the token
  kind: bug
  status: open
  runtimeSwitchable: true\`,
  tasks: [],
})
`

test('(b) a duplicate top-level key is REJECTED; single-key twin passes', () => {
  const bad = writeRoadmapFile('phase-9002.phase.ts', dupStatus)
  const r = runValidator(bad.path)
  assert.equal(r.code, 2, 'duplicate status key must reject')
  assert.match(r.stderr, /duplicate-key.*status/s)
  const good = writeRoadmapFile('phase-9002.phase.ts', noDup)
  assert.equal(runValidator(good.path).code, 0, 'single-key twin passes')
})

test('(b) false-positive guard: 2-space `key:` prose inside a notes template literal PASSES', () => {
  const f = writeRoadmapFile('phase-9003.phase.ts', templateProse)
  const r = runValidator(f.path)
  assert.equal(r.code, 0, `template-literal prose must not be flagged; got: ${r.stderr}`)
})

// A lone backtick inside an ordinary '...'/"..." string value must NOT desync the
// template tracking (the code-review HIGH: otherwise the notes prose below is
// mis-scanned as top-level keys and false-flags a duplicate).
const backtickInStringProse = `${IMPORT}
export default definePhase({
  phase: 9008, name: 'fixture backtick-in-string phase', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'see the \\\` backtick char inline', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  notes: \`Notes with column-2 prose that looks like keys:
  status: open
  category: bug\`,
  tasks: [],
})
`

test('(b) a backtick inside a string value does not desync the template scan (no false dup)', () => {
  const f = writeRoadmapFile('phase-9008.phase.ts', backtickInStringProse)
  const r = runValidator(f.path)
  assert.equal(r.code, 0, `backtick-in-string must not false-flag a dup; got: ${r.stderr}`)
})

// ── (c) non-"None" compromise/skipped ⇒ decisionRef (floor-gated) ────────────────
const compromisePhase = (withRef) => `${IMPORT}
export default definePhase({
  phase: 9004, name: 'fixture compromise phase', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  tasks: [{ id: '9004.1', title: 'the fixture task title', problem: 'the fixture problem statement is intentionally long', steps: [{ file: 'x', description: 'do the described thing' }], acceptanceCriteria: ['it works as specified'], files: ['x'], testMode: 'none', done: true,
    transparencyReport: { whatWasDone: 'did the fixture work', how: 'by the documented way', compromises: 'a narrow trade-off was accepted', skipped: 'None', hardcoded: 'None', limitations: 'None'${withRef ? `, decisionRef: 'architect PROCEED_WITH_FIX 2026-07-05'` : ''} } }],
})
`

test('(c) a non-None compromise with no decisionRef is REJECTED (>= floor); with decisionRef passes', () => {
  const bad = writeRoadmapFile('phase-9004.phase.ts', compromisePhase(false))
  const r = runValidator(bad.path)
  assert.equal(r.code, 2, 'compromise without decisionRef must reject')
  assert.match(r.stderr, /compromise-without-decisionRef/)
  const good = writeRoadmapFile('phase-9004.phase.ts', compromisePhase(true))
  assert.equal(runValidator(good.path).code, 0, 'decisionRef twin passes')
})

// ── (d) userFacing:true ⇒ flag (floor-gated) ─────────────────────────────────────
const userFacingPhase = (withFlag) => `${IMPORT}
export default definePhase({
  phase: 9005, name: 'fixture userfacing phase', status: 'backlog',
  category: 'feature', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  userFacing: true,${withFlag ? `\n  flag: { id: 'FIXTURE_FLAG' },` : ''}
  tasks: [],
})
`

test('(d) userFacing:true with no flag is REJECTED (>= floor); with a flag passes', () => {
  const bad = writeRoadmapFile('phase-9005.phase.ts', userFacingPhase(false))
  const r = runValidator(bad.path)
  assert.equal(r.code, 2, 'userFacing without flag must reject')
  assert.match(r.stderr, /userFacing-without-flag/)
  const good = writeRoadmapFile('phase-9005.phase.ts', userFacingPhase(true))
  assert.equal(runValidator(good.path).code, 0, 'flagged twin passes')
})

// ── (e) arc acceptanceCriteria immutability once building ────────────────────────
const arcFile = (criterionSignal, ratifications) => `${IMPORT}
export default defineArc({
  id: 'TESTARC', name: 'a fixture test arc', baseRef: 'develop',
  planes: [{ name: 'only plane', phases: [9006] }],
  acceptanceCriteria: [{ id: 'ac-1', job: 'as a user I want the thing', surfaces: ['cli'], signal: '${criterionSignal}', tier: 'wired', bar: 'the bar is cleared' }],${ratifications}
})
`

test('(e) mutating a building arc\'s acceptanceCriteria without a ratification is REJECTED; adding one passes', () => {
  const base = mkdtempSync(join(tmpdir(), 'zr-validator-arc-'))
  tmpBases.push(base)
  const arcsDir = join(base, 'roadmap', 'arcs')
  mkdirSync(join(arcsDir, '.building'), { recursive: true })
  const arcPath = join(arcsDir, 'TESTARC.arc.ts')
  const git = (...args) => execFileSync('git', ['-C', base, ...args], { stdio: 'ignore' })

  // v1 committed to HEAD.
  writeFileSync(arcPath, arcFile('the original signal text', ''))
  git('init', '-q')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'v1')

  // Building marker present (past planning).
  writeFileSync(join(arcsDir, '.building', 'TESTARC.json'), JSON.stringify({ arcId: 'TESTARC' }))

  // Mutate the criterion WITHOUT a ratification → reject.
  writeFileSync(arcPath, arcFile('a SILENTLY CHANGED signal', ''))
  const bad = runValidator(arcPath)
  assert.equal(bad.code, 2, `silent criteria change must reject; stderr: ${bad.stderr}`)
  assert.match(bad.stderr, /acceptanceCriteria-immutable/)

  // Same change WITH a ratification entry → pass.
  writeFileSync(arcPath, arcFile('a SILENTLY CHANGED signal', `\n  criteriaRatifications: ['2026-07-05: broadened ac-1 signal per user ratification'],`))
  const good = runValidator(arcPath)
  assert.equal(good.code, 0, `ratified change must pass; stderr: ${good.stderr}`)
})

// ── Zod failure: one `<path>: <message>` line, NO stack ──────────────────────────
const zodBadLabel = `${IMPORT}
export default definePhase({
  phase: 9007, name: 'x', status: 'backlog',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable', tasks: [],
})
`

test('a Zod failure is pretty-printed (one path: message line) with NO stack trace', () => {
  // name too short (min 5) — a clean Zod rejection.
  const f = writeRoadmapFile('phase-9007.phase.ts', zodBadLabel)
  const r = runValidator(f.path)
  assert.equal(r.code, 2, 'invalid name must reject')
  assert.match(r.stderr, /schema validation failed/)
  assert.match(r.stderr, /name: /, 'names the offending path')
  assert.doesNotMatch(r.stderr, /at .*\(.*:\d+:\d+\)/, 'no stack frames in default (non-debug) output')
})

// ── `step → verify:` grammar lint — WARN-level, NEW-to-git phase files only ───────
// Grandfather rule (plan-phase authoring grammar): the lint reminds on a phase file that
// has no HEAD blob; the ~1,100 committed files are exempt; it NEVER changes the exit code.
const gitInit = (base) => {
  const g = (...a) => execFileSync('git', ['-C', base, ...a], { stdio: 'ignore' })
  g('init', '-q')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
}
/** Write a phase into a git-inited roadmap tree; `commit:true` makes it grandfathered. */
function writeGitPhase(name, body, { commit = false } = {}) {
  const { path, base } = writeRoadmapFile(name, body)
  gitInit(base)
  if (commit) {
    execFileSync('git', ['-C', base, 'add', `roadmap/phases/${name}`], { stdio: 'ignore' })
    execFileSync('git', ['-C', base, 'commit', '-qm', 'seed'], { stdio: 'ignore' })
  }
  return { path, base }
}
// runValidator discards stderr on exit 0; a WARN-level lint prints to stderr WITH exit 0,
// so the grammar tests capture stderr regardless of exit code via spawnSync.
function runValidatorCaptured(filePath) {
  const r = spawnSync('node', [VALIDATOR], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    timeout: 120_000,
  })
  return { code: r.status ?? 1, stderr: r.stderr ?? '' }
}
const stepsPhase = (desc) => `${IMPORT}
export default definePhase({
  phase: 9008, name: 'fixture verify-grammar phase', status: 'backlog',
  plannedBy: { model: 'fixture-model' },
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  tasks: [{ id: '9008.1', title: 'the fixture task title', problem: 'the fixture problem statement is intentionally long', steps: [{ file: 'x', description: '${desc}' }], acceptanceCriteria: ['it works as specified'], files: ['x'], testMode: 'none', done: false }],
})
`
const MISSING = 'do the described thing'
const COMPLIANT = 'do the described thing → verify: grep -n thing x'

test('grammar lint WARNS on a NEW-to-git phase step missing → verify: (exit still 0)', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(MISSING))
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0, 'the grammar lint NEVER blocks — exit stays 0 when the Zod parse passes')
  assert.match(r.stderr, /WARN phase 9008 task 9008\.1 step 1/, 'names the offending step')
  assert.match(r.stderr, /→ verify:/, 'the WARN cites the missing clause')
})

test('grammar lint is SILENT on a COMMITTED (grandfathered) phase missing → verify:', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(MISSING), { commit: true })
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.stderr, /WARN phase 9008/, 'a committed file is exempt forever')
})

test('grammar lint is SILENT on a NEW-to-git phase whose step carries → verify:', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(COMPLIANT))
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.stderr, /WARN phase 9008/, 'a compliant new file draws no warning')
})

// ── stepDescriptionLength lint — WARN-level, NEW-to-git phase files only ──────────
// Decisions-not-narration (phase 2420): a step description over 700 chars is narration
// creep (the gauntlet's "diff-re-narrating" theme); the cap is inclusive and advisory.
const pad = (n) => 'd'.repeat(n)
const V = ' → verify: grep -n thing x' // keeps the grammar lint silent
const OVER_700 = pad(700) + V
const EXACTLY_700 = pad(700 - V.length) + V

test('stepDescriptionLength lint WARNS on a NEW-to-git step over 700 chars (exit still 0)', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(OVER_700))
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0, 'the length lint NEVER blocks — exit stays 0')
  assert.match(r.stderr, /WARN phase 9008 task 9008\.1 step 1/, 'names the offending step')
  assert.match(r.stderr, /700/, 'the WARN names the cap')
  assert.match(r.stderr, /decision/i, 'the WARN states the decisions-not-narration rule')
})

test('stepDescriptionLength lint is SILENT at exactly 700 chars (inclusive cap)', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(EXACTLY_700))
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.stderr, /exceeds 700/, 'sitting exactly on the cap is within it')
})

test('stepDescriptionLength lint is SILENT on a COMMITTED (grandfathered) long step', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(OVER_700), { commit: true })
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0)
  assert.doesNotMatch(r.stderr, /WARN phase 9008/, 'a committed file is exempt forever')
})

// ── both faces of the ONE engine surface the WARNs ────────────────────────────────
// plan-phase Step 4 mandates `roadmap phase validate <N|file>`, so that face swallowing
// the warnings makes every WARN lint unreadable to the planner it exists for.
const ROADMAP_BIN = join(HERE, 'roadmap.mjs')

test('`roadmap phase validate` surfaces the WARN lints on stderr (exit still 0)', () => {
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(OVER_700))
  const r = spawnSync('node', [ROADMAP_BIN, 'phase', 'validate', f.path], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(r.status, 0, `a WARN never changes the exit code; stderr: ${r.stderr}`)
  assert.match(
    r.stderr,
    /WARN phase 9008 task 9008\.1 step 1: description exceeds 700 chars/,
    'the CLI face prints the same WARN the write-hook face does',
  )
  assert.match(r.stdout, /phase validate: .* — OK/, 'and still reports the OK verdict')
})

// ── driver.lane registry lint — WARN-level, names the value + every known driver id ─
// An unknown lane must LOAD and WARN, never fail import-time Zod. The known set is read
// from the registry so this suite carries no second copy of it.
import { DRIVERS } from '../cli/lib/drivers.mjs'

const KNOWN_DRIVER_IDS = Object.keys(DRIVERS)
const UNKNOWN_LANE = 'grok-exec'

const lanePhase = (lane) => `${IMPORT}
export default definePhase({
  phase: 9009, name: 'fixture driver lane phase', status: 'in-progress',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  executionResult: { phase: 9009, status: 'done', gateRounds: 1, driver: { model: 'fixture-model', lane: '${lane}' } },
  tasks: [],
})
`
const doneLanePhase = (lane) => `${IMPORT}
export default definePhase({
  phase: 9009, name: 'fixture done driver lane phase', status: 'done',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',${doneGate}
  executionResult: { phase: 9009, status: 'done', gateRounds: 1, driver: { model: 'fixture-model', lane: '${lane}' } },
  tasks: [],
})
`

test('driver.lane lint: an unknown lane import-PARSES and WARNS naming the value + every known driver id', () => {
  const f = writeGitPhase('phase-9009.phase.ts', lanePhase(UNKNOWN_LANE))
  const r = runValidatorCaptured(f.path)
  assert.doesNotMatch(r.stderr, /schema validation failed/, 'an unknown lane must load — the closed enum is dead')
  assert.doesNotMatch(r.stderr, /failed to load/i, 'an unknown lane is not a corrupt file')
  assert.match(r.stderr, /WARN phase 9009/, 'the lane lint names the offending phase')
  assert.match(r.stderr, new RegExp(UNKNOWN_LANE), 'the WARN names the offending lane value')
  for (const id of KNOWN_DRIVER_IDS) {
    assert.match(r.stderr, new RegExp(`\\b${id}\\b`), `the WARN names known driver id '${id}'`)
  }
  assert.match(r.stderr, /\bsession\b/, "the WARN names 'session' — always a valid lane")
})

test('driver.lane lint: an unknown lane exits EXACTLY as its lane:session twin does', () => {
  const unknown = runValidatorCaptured(writeGitPhase('phase-9009.phase.ts', lanePhase(UNKNOWN_LANE)).path)
  const twin = runValidatorCaptured(writeGitPhase('phase-9009.phase.ts', lanePhase('session')).path)
  assert.equal(unknown.code, twin.code, `a WARN never changes the exit code; stderr: ${unknown.stderr}`)
})

test('driver.lane lint: a KNOWN lane (session or a registry id) draws NO warning', () => {
  for (const lane of ['session', ...KNOWN_DRIVER_IDS]) {
    const f = writeGitPhase('phase-9009.phase.ts', lanePhase(lane))
    const r = runValidatorCaptured(f.path)
    assert.doesNotMatch(r.stderr, /WARN phase 9009/, `lane '${lane}' is known — the lint must stay quiet`)
  }
})

test('driver.lane lint: the unknown-lane WARN also fires on a status:done phase file', () => {
  const f = writeGitPhase('phase-9009.phase.ts', doneLanePhase(UNKNOWN_LANE), { commit: true })
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0, `a WARN never turns a passing file into a failing one; stderr: ${r.stderr}`)
  assert.match(r.stderr, /WARN phase 9009/, 'a done-flip edits an existing file — the lint is not status-gated')
  assert.match(r.stderr, new RegExp(UNKNOWN_LANE), 'the WARN names the offending lane value')
})

// ── attribution-stamp lints — WARN-level, grandfathered by STATUS not by git ───────
// A forgotten plannedBy/driver stamp surfaces months later as an empty column in the
// model-comparison scorecard, so validate time is the catch. Grandfathering is by STATUS
// ('historical'/'cancelled' never warn); it is NOT gated on isNewToGit, because the case
// these lints exist for is a done-flip — an edit to a file git already tracks.
const PLANNED_BY = `\n  plannedBy: { model: 'fixture-model' },`
const DRIVER = `\n  executionResult: { phase: 9011, status: 'done', gateRounds: 1, driver: { model: 'fixture-model', lane: 'session' } },`

const backlogAttribution = (stamp) => `${IMPORT}
export default definePhase({
  phase: 9010, name: 'fixture backlog attribution phase', status: 'backlog',${stamp}
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  tasks: [],
})
`
const doneAttribution = (stamp) => `${IMPORT}
export default definePhase({
  phase: 9011, name: 'fixture done attribution phase', status: 'done',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',${doneGate}${stamp}
  tasks: [],
})
`
const grandfatheredAttribution = (num, status) => `${IMPORT}
export default definePhase({
  phase: ${num}, name: 'fixture ${status} attribution phase', status: '${status}',
  category: 'infra', kind: 'logic', source: 'fixture source', priority: 'LOW',
  dependsOn: [], conflictsWith: [], keyFiles: ['x'], stakeholderDemo: 'a fixture outcome demoable',
  tasks: [],
})
`

/** Pin the fixture's git state. A lint that silently fires only on new-to-git files would
 *  miss every done-flip, so each attribution case states which side of that line it sits on. */
function assertGitTracked({ path, base }, expected) {
  const rel = path.slice(base.length + 1)
  const tracked = spawnSync('git', ['-C', base, 'cat-file', '-e', `HEAD:${rel}`], { encoding: 'utf8' }).status === 0
  assert.equal(tracked, expected, `fixture ${rel} must be ${expected ? 'COMMITTED' : 'NEW'} to git for this case to prove anything`)
}

/** The one stderr line naming `needle` — one line, so a fix wrapped across lines is not
 *  copy-pasteable and fails here. */
function warnLine(stderr, needle) {
  const lines = stderr.split('\n').filter((l) => l.includes(needle))
  assert.equal(lines.length, 1, `expected exactly ONE stderr line naming '${needle}'; got ${lines.length}. stderr:\n${stderr || '(empty)'}`)
  return lines[0]
}

test('attribution lint: a backlog phase with NO plannedBy WARNS with a copy-pasteable one-line fix', () => {
  for (const commit of [false, true]) {
    const f = writeGitPhase('phase-9010.phase.ts', backlogAttribution(''), { commit })
    assertGitTracked(f, commit)
    const r = runValidatorCaptured(f.path)
    const twin = runValidatorCaptured(writeGitPhase('phase-9010.phase.ts', backlogAttribution(PLANNED_BY), { commit }).path)
    assert.equal(r.code, twin.code, `a WARN never changes the exit code; stderr: ${r.stderr}`)
    assert.equal(r.code, 0, `the fixture parses clean — exit stays 0 (committed=${commit}); stderr: ${r.stderr}`)
    const line = warnLine(r.stderr, 'plannedBy')
    assert.match(line, /WARN phase 9010\b/, 'the WARN names the offending phase')
    assert.match(line, /missing/i, 'the WARN states the stamp is absent')
    assert.match(line, /plannedBy:\s*\{\s*model:/, 'the one-line fix is copy-pasteable as written')
  }
})

test('attribution lint: a backlog phase WITH plannedBy draws no warning (same exit code)', () => {
  for (const commit of [false, true]) {
    const f = writeGitPhase('phase-9010.phase.ts', backlogAttribution(PLANNED_BY), { commit })
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `stamped twin exits 0; stderr: ${r.stderr}`)
    assert.doesNotMatch(r.stderr, /WARN phase 9010/, 'a stamped phase is compliant — the lint stays quiet')
  }
})

test('attribution lint: a COMMITTED done phase with NO executionResult.driver WARNS (the done-flip case)', () => {
  const f = writeGitPhase('phase-9011.phase.ts', doneAttribution(''), { commit: true })
  assertGitTracked(f, true) // the 715–719 drop was a done-flip: a newness-gated lint never fires
  const r = runValidatorCaptured(f.path)
  const twin = runValidatorCaptured(writeGitPhase('phase-9011.phase.ts', doneAttribution(DRIVER), { commit: true }).path)
  assert.equal(r.code, twin.code, `a WARN never changes the exit code; stderr: ${r.stderr}`)
  assert.equal(r.code, 0, `an unstamped done phase still validates; stderr: ${r.stderr}`)
  const line = warnLine(r.stderr, 'executionResult.driver')
  assert.match(line, /WARN phase 9011\b/, 'the WARN names the offending phase')
  assert.match(line, /missing/i, 'the WARN states the stamp is absent')
  assert.match(line, /driver:\s*\{\s*model:/, 'the one-line fix is copy-pasteable as written')
})

test('attribution lint: a done phase WITH executionResult.driver draws no warning', () => {
  const f = writeGitPhase('phase-9011.phase.ts', doneAttribution(DRIVER), { commit: true })
  const r = runValidatorCaptured(f.path)
  assert.equal(r.code, 0, `stamped twin exits 0; stderr: ${r.stderr}`)
  assert.doesNotMatch(r.stderr, /WARN phase 9011/, 'a stamped done phase is compliant — the lint stays quiet')
})

test('attribution lint: a historical phase missing BOTH stamps never warns (the ~700-file floor)', () => {
  for (const commit of [false, true]) {
    const f = writeGitPhase('phase-9012.phase.ts', grandfatheredAttribution(9012, 'historical'), { commit })
    assertGitTracked(f, commit)
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `grandfathering is absolute — a historical file never REDs; stderr: ${r.stderr}`)
    assert.doesNotMatch(r.stderr, /WARN phase 9012/, 'historical phases predate attribution — they are exempt forever')
  }
})

test('attribution lint: a cancelled phase missing BOTH stamps never warns', () => {
  for (const commit of [false, true]) {
    const f = writeGitPhase('phase-9013.phase.ts', grandfatheredAttribution(9013, 'cancelled'), { commit })
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `a cancelled file never REDs; stderr: ${r.stderr}`)
    assert.doesNotMatch(r.stderr, /WARN phase 9013/, 'a cancelled phase was never executed — nothing to attribute')
  }
})

// ── widened polarity lint: the three MISSED vacuous classes (task 20.3) ────────────
//
// verifyPolarityWarnings caught bare `grep -c`, pipe-judged RUNNERS (npm/pnpm/yarn/tsc/
// capbuild/nx/vitest/`node --test` left-sides only) and loader-less `node --test` on .ts.
// Three RECORDED shapes matched no class and shipped:
//
//   1. PLAIN RUNNER THROUGH A FILTER PIPE — `node bin/validate-roadmap-file.mjs <path> | tail -1`.
//      The left side is a plain `node`/`npx`/`tsx` validator, not a package-script runner, so the
//      runner list never saw it; the exit code is `tail`'s and a schema failure read green.
//      Incident: azure 2421 — "a validate piped through tail -1 masked a schema failure and the
//      red phase file got pushed" (phase-20 header; MINESWEEP-execution-prompt §vacuity).
//   2. SWALLOWED EXIT — `cmd || true`. The clause cannot report anything but success.
//   3. TRAILING NO-OP — the final element of a `;` list is a bare `echo`/`true`, so the list's
//      exit code is the no-op's. Recorded row: `cmd; echo done`. An `&&` list is honest because
//      a failing left side skips the no-op and remains non-zero.
//      2 and 3 are the "Exit-0-always tails" class of the plan adversary catalogue
//      (skills/review-phase/references/plan-adversary.md §A).
//
// CITATION CONTRACT (arc MINESWEEP criterion `vacuity-flagged` bar: "each finding cites the
// incident class it encodes so the warning teaches"): class 1 names `azure 2421`; classes 2/3
// name the catalogue class (`exit-0-always`, or `plan-adversary`). Those are the only citations
// recorded for these shapes in this repo — an implementation citing neither teaches nothing.
//
// Each class gets: the recorded shape WARNs · its clean twin is silent · the grandfather rule is
// untouched (NEW-to-git warns, COMMITTED is exempt), asserted in BOTH directions per class.

/** Recorded shape → clean twin, one row per missed class. */
const VACUOUS_CLASSES = [
  {
    name: 'plain node validator judged through a filter pipe',
    bad: 'node bin/validate-roadmap-file.mjs roadmap/phases/phase-9000.phase.ts | tail -1',
    // Here grep's match IS the intended verdict, so the filter is an assertion rather than a mask.
    good: 'node bin/validate-roadmap-file.mjs roadmap/phases/phase-9000.phase.ts | grep -q expected',
    citation: /azure 2421/i,
  },
  {
    name: 'a later tail still owns the verdict after an intermediate grep assertion',
    bad: 'node bin/validate-roadmap-file.mjs roadmap/phases/phase-9000.phase.ts | grep -q expected | tail -1',
    good: 'node bin/validate-roadmap-file.mjs roadmap/phases/phase-9000.phase.ts | grep --quiet expected',
    citation: /azure 2421/i,
  },
  {
    name: '`|| true` swallows the exit code',
    bad: 'bash -c "node bin/roadmap.mjs phase validate 9000 || true"',
    good: 'grep -qF "|| true" roadmap/phases/phase-9000.phase.ts',
    citation: /exit-0-always|plan-adversary/i,
  },
  {
    name: 'a search-pattern literal does not hide a later real `|| true` swallow',
    bad: 'grep -qF "|| true" cli/lib/validate.mjs && node bin/roadmap.mjs phase validate 9000 || true',
    good: 'grep -qF "|| true" cli/lib/validate.mjs',
    citation: /exit-0-always|plan-adversary/i,
  },
  {
    name: 'a bare echo as the final list element after `;`',
    bad: 'node bin/roadmap.mjs phase validate 9000; echo done',
    // `echo` inside an expected-output ASSERTION, not as the final command: the assertion still
    // reds on wrong output, so a lint keyed on "mentions echo" false-fires here.
    good: 'test "$(node bin/roadmap.mjs phase show 9000)" = "$(echo done)"',
    citation: /exit-0-always|plan-adversary/i,
  },
  {
    name: 'a bare `true` after `;` warns while an `&& echo` tail stays honest',
    bad: 'bash -c "node bin/roadmap.mjs phase validate 9000; true"',
    good: 'grep -q expected output.txt && echo found',
    citation: /exit-0-always|plan-adversary/i,
  },
  {
    name: 'a quoted echo argument remains a trailing no-op',
    bad: 'bash -c "node bin/roadmap.mjs phase validate 9000; echo \\"done\\""',
    good: 'test "$(node bin/roadmap.mjs phase show 9000)" = "$(echo done)"',
    citation: /exit-0-always|plan-adversary/i,
  },
]

/** Every WARN line the polarity lint can raise for the 9008 fixture's single step. The grammar
 *  and length lints share this label but stay silent here (every fixture carries → verify: and
 *  sits far under the 700-char cap), so these lines are the polarity lint's alone. */
const stepWarns = (stderr) => stderr.split('\n').filter((l) => /WARN phase 9008 task 9008\.1 step 1\b/.test(l))

for (const { name, bad, good, citation } of VACUOUS_CLASSES) {
  test(`polarity lint: ${name} — the recorded shape WARNS with its incident citation`, () => {
    const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(`do the described thing → verify: ${bad}`))
    assertGitTracked(f, false) // the lint is authoring-time: this case only proves anything on a NEW file
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `a WARN never changes the exit code; stderr: ${r.stderr}`)
    const warns = stepWarns(r.stderr)
    assert.equal(warns.length, 1, `expected exactly ONE polarity WARN for '${bad}'; got ${warns.length}. stderr:\n${r.stderr || '(empty)'}`)
    assert.match(warns[0], /exit/i, 'the WARN says what is wrong: the clause reports the wrong exit code')
    assert.match(warns[0], citation, `the WARN cites the incident class it encodes (${citation})`)
  })

  test(`polarity lint: ${name} — the clean twin is SILENT`, () => {
    const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(`do the described thing → verify: ${good}`))
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `the clean twin parses clean; stderr: ${r.stderr}`)
    assert.deepEqual(stepWarns(r.stderr), [], `a falsifiable clause draws no polarity WARN: '${good}'`)
  })

  test(`polarity lint: ${name} — the grandfather rule is untouched (COMMITTED is exempt)`, () => {
    const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(`do the described thing → verify: ${bad}`), { commit: true })
    assertGitTracked(f, true)
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `a committed file never REDs; stderr: ${r.stderr}`)
    assert.deepEqual(stepWarns(r.stderr), [], 'the ~1,100 committed phase files stay exempt — the widening is authoring-time only')
  })
}

test('polarity lint: the widened classes also fire through the `roadmap phase validate` face', () => {
  // The arc criterion names THIS face ("`roadmap phase validate` on a phase whose verify pipes
  // through `| tail -1` … emits the polarity WARN"); plan-phase Step 4 mandates it, so a face
  // that swallows the WARN makes the widening unreadable to the planner it exists for.
  const piped = VACUOUS_CLASSES[0]
  const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(`do the described thing → verify: ${piped.bad}`))
  const r = spawnSync('node', [ROADMAP_BIN, 'phase', 'validate', f.path], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(r.status, 0, `a WARN never changes the exit code; stderr: ${r.stderr}`)
  assert.equal(stepWarns(r.stderr ?? '').length, 1, `the CLI face prints the same single WARN; stderr:\n${r.stderr || '(empty)'}`)
  assert.match(r.stdout, /phase validate: .* — OK/, 'and still reports the OK verdict')
})

test('polarity lint: the pre-existing classes are unchanged by the widening', () => {
  // A regression net around the three rules that already worked: the widening must ADD classes,
  // not re-key the ones arc SEODESKFIX paid for.
  const kept = [
    'grep -c thing x',
    'capbuild npm test | tail -20',
    'node --test bin/thing.test.ts',
  ]
  for (const cmd of kept) {
    const f = writeGitPhase('phase-9008.phase.ts', stepsPhase(`do the described thing → verify: ${cmd}`))
    const r = runValidatorCaptured(f.path)
    assert.equal(r.code, 0, `a WARN never changes the exit code; stderr: ${r.stderr}`)
    assert.ok(stepWarns(r.stderr).length >= 1, `'${cmd}' is an already-caught class and must still WARN; stderr:\n${r.stderr || '(empty)'}`)
  }
})
