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
