#!/usr/bin/env node
/**
 * layout-docs.test.mjs — the DISCOVERED-root wired tier.
 *
 * The roadmap root is DISCOVERED, not pinned (cli/lib/roadmap-root.mjs:
 * ROOT_CANDIDATES = ['roadmap', 'docs/roadmap'], marker = roadmap.config.json | phases/,
 * ROADMAP_ROOT overrides, both marked = a named refusal). Nothing in the fixture-consumer
 * tier has ever run against the SECOND candidate, so every existing suite would stay green
 * if discovery silently kept answering `<repo>/roadmap` forever. This suite drives the REAL
 * bin/roadmap.mjs over a consumer whose whole roadmap lives at `<repo>/docs/roadmap` — with
 * NO `<repo>/lib/` and no tsconfig alias anywhere — through seven directions:
 *
 *   D1 status (no root argument)  · D2 phase validate over a `../lib/schema` import
 *   D3a audit CLEAN + read from the docs root · D3b check 16 names the DOCS seam on drift
 *   D4 gate plan · D5 claim · D6 ROADMAP_ROOT at a THIRD directory wins over both candidates
 *   D7 both roots marked ⇒ ONE named refusal at status, phase validate and audit
 *
 * House rules (identical to the sibling suites): the CLI's exit code + its machine
 * fields are the contract — no cli/lib internals are imported, and prose is asserted ONLY
 * where the criterion demands a NAMED message (D3b's located finding, D7's refusal). Every
 * direction carries its anti-vacuity assertion: a docs-layout run that found NOTHING must
 * fail, not pass quietly.
 *
 * Run: capbuild node --test test/fixture-consumer/layout-docs.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as harness from './harness.mjs'
import { commitAll, git, makeFixtureRepo, plainSrc, runCli, writePhaseFile, TEMPLATES_SCHEMA } from './harness.mjs'

// The two candidate roots, spelled here ON PURPOSE: this suite is the one place that must
// pin WHICH directories discovery answers with, and D7's refusal must name both by path.
const TOPLEVEL_ROOT = (repo) => join(repo, 'roadmap')
const DOCS_ROOT = (repo) => join(repo, 'docs', 'roadmap')
/** The legacy seam a docs-layout consumer must NOT have (root-first `<root>/lib/schema.ts`). */
const LEGACY_SEAM = (repo) => join(repo, 'lib', 'roadmap', 'schema.ts')

/**
 * The layout root the harness reports (`roadmapDir(root)`), reached through the
 * namespace: a named import of a not-yet-existing export fails the whole MODULE link and
 * would collapse seven independent directions into one unreadable error, so each direction
 * reds on its own with the contract line it needs.
 */
function roadmapDir(repo) {
  assert.equal(
    typeof harness.roadmapDir,
    'function',
    'harness.mjs must export roadmapDir(root) → the absolute layout root (the harness contract)',
  )
  return harness.roadmapDir(repo)
}

/**
 * A docs-layout fixture consumer, with the whole layout contract pinned on the way out:
 * root at `<repo>/docs/roadmap`, config + phases INSIDE it, the root-first schema seam
 * vendored VERBATIM from templates/schema.ts (the harness's standing rule — a hand-written
 * stub is the seam-3 split-brain this tier exists to catch), and NO `<repo>/lib/` at all.
 */
function docsFixture(opts = {}) {
  const repo = makeFixtureRepo({ ...opts, layout: 'docs' })
  const dir = roadmapDir(repo)
  assert.equal(dir, DOCS_ROOT(repo), "layout 'docs' must root the roadmap at <repo>/docs/roadmap")
  assert.ok(existsSync(join(dir, 'roadmap.config.json')), 'the config lives INSIDE the docs root')
  assert.ok(existsSync(join(dir, 'phases')), 'the docs root carries phases/')
  assert.ok(existsSync(join(dir, 'arcs')), 'the docs root carries arcs/')
  assert.equal(
    readFileSync(join(dir, 'lib', 'schema.ts'), 'utf8'),
    readFileSync(TEMPLATES_SCHEMA, 'utf8'),
    '<root>/lib/schema.ts must be templates/schema.ts copied VERBATIM (never a hand-written stub)',
  )
  assert.ok(!existsSync(join(repo, 'lib')), 'a docs-layout consumer has NO <repo>/lib/ — the legacy seam must not exist')
  assert.ok(!existsSync(TOPLEVEL_ROOT(repo)), 'a docs-layout consumer has NO <repo>/roadmap/ — discovery is the only way in')
  return repo
}

/** A schema-valid phase object (definePhase parses this at import time). */
function fullPhase(n, extra = {}) {
  return {
    phase: n,
    status: 'backlog',
    name: `Docs layout fixture phase ${n}`,
    category: 'test',
    kind: 'logic',
    source: 'fixture-consumer',
    priority: 'LOW',
    dependsOn: [],
    conflictsWith: [],
    keyFiles: [],
    stakeholderDemo: 'a fixture phase used by the docs-layout suite',
    tasks: [{ minimal: true, id: `${n}.1`, title: 'do the thing', done: false }],
    ...extra,
  }
}

/** Every file in the repo except node_modules/.git — for the "no alias anywhere" assertion. */
function walkRepo(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkRepo(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/**
 * The refusal BODY: stderr with each line's command prefix (`roadmap: `, `roadmap phase
 * validate: `) stripped and blank lines dropped. Doors may name themselves; the MESSAGE is
 * what must be one and the same at every door, so this compares the message and nothing else.
 * A stack frame is NOT stripped — a crash is not a refusal, and D7 asserts that separately.
 */
function refusalBody(stderr) {
  const prefix = /^roadmap(?: [a-z-]+){0,2}: /
  return stderr
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((line) => {
      let s = line
      while (prefix.test(s)) s = s.replace(prefix, '')
      return s
    })
    .join('\n')
}

// ── harness contract — discovery, not a defaulted ROADMAP_CONFIG, is what answers ────────
test('D0 — runCli OMITS ROADMAP_CONFIG for the docs layout (discovery answers), and a caller env still wins', () => {
  const repo = docsFixture()
  // If runCli still defaulted ROADMAP_CONFIG to <repo>/roadmap/roadmap.config.json, this
  // would exit 1 'absent' — the whole suite would then be testing the harness, not discovery.
  const discovered = runCli(repo, ['config', 'check'])
  assert.equal(discovered.code, 0, `config check must resolve the docs config by DISCOVERY; stderr:\n${discovered.stderr}`)

  const overridden = runCli(repo, ['config', 'check'], { ROADMAP_CONFIG: join(repo, 'nowhere', 'roadmap.config.json') })
  assert.equal(overridden.code, 1, 'a caller-supplied ROADMAP_CONFIG still WINS over discovery')
  assert.match(overridden.stderr, /no roadmap\.config\.json at .*nowhere/, 'the refusal names the path the caller supplied')
})

// ── D1 — `roadmap status` with NO root argument reads the docs layout ────────────────────
test('D1 — `roadmap status` with no root argument lists the phase written into the docs layout', () => {
  const repo = docsFixture()
  writePhaseFile(repo, { phase: 9601, status: 'in-progress', arcId: 'DOCSFX', kind: 'logic', tasks: [{ id: '9601.1', done: false }] })
  commitAll(repo, 'seed: docs-layout in-progress phase 9601')
  assert.ok(
    existsSync(join(DOCS_ROOT(repo), 'phases', 'phase-9601.phase.ts')),
    'writePhaseFile must place the phase under the LAYOUT root, not <repo>/roadmap/phases',
  )

  const r = runCli(repo, ['status', '--json'])
  assert.equal(r.code, 0, `status must resolve the docs root with no argument; stderr:\n${r.stderr}`)
  const row = r.json?.rows?.find((x) => x.arc === 'DOCSFX')
  // Anti-vacuity: an empty lane table is exactly what a status that read <repo>/roadmap
  // (absent here) would print, and it would exit 0 all the same.
  assert.ok(row, `the docs-layout lane must be surfaced; rows=${JSON.stringify(r.json?.rows)}`)
  assert.match(row.note, /in-progress: 9601/, 'the row names the phase number read out of docs/roadmap/phases')
})

// ── D2 — `phase validate` over a RELATIVE `../lib/schema` import, no alias anywhere ───────
test('D2 — `roadmap phase validate` exits 0 for a docs-layout phase importing ../lib/schema (and no tsconfig alias exists)', () => {
  const repo = docsFixture()
  const good = writePhaseFile(repo, fullPhase(9602), { kind: 'define' })
  const src = readFileSync(good, 'utf8')
  assert.match(src, /from '\.\.\/lib\/schema(\.ts)?'/, 'the docs-layout define file imports the ROOT-FIRST seam relatively')
  assert.doesNotMatch(src, /lib\/roadmap\/schema/, 'it must NOT reach for the legacy <repo>/lib/roadmap seam')

  // Without this, the direction is vacuous: a repo carrying a tsconfig `paths` alias would
  // resolve the import through the alias and prove nothing about relative resolution.
  const files = walkRepo(repo)
  const tsconfigs = files.filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f))
  assert.deepEqual(tsconfigs, [], 'a docs-layout consumer carries NO tsconfig at all — hence no paths alias')
  const aliased = files.filter((f) => readFileSync(f, 'utf8').includes('@/lib/roadmap/schema'))
  assert.deepEqual(aliased, [], 'no file in the repo cites the @/lib/roadmap/schema alias')

  const ok = runCli(repo, ['phase', 'validate', '9602', '--json'])
  assert.equal(ok.code, 0, `a well-formed docs-layout phase must validate; stderr:\n${ok.stderr}`)
  // 'skip' (path not recognized as a roadmap file) and 'toolchain-missing' are the two ways
  // this exits 0 having validated NOTHING — the seam must have genuinely parsed.
  assert.equal(ok.json?.kind, 'ok', `validation must be a real parse, not a skip: ${JSON.stringify(ok.json)}`)

  // The seam is LIVE: the same relative import runs the consumer Zod, so a bad phase reds.
  writePhaseFile(
    repo,
    fullPhase(9603, {
      tasks: [{ id: '9603.1', title: 'a task with no problem field', steps: [{ file: 'x.ts', description: 'do something now' }], acceptanceCriteria: ['one criterion here'], files: ['x.ts'], done: false }],
    }),
    { kind: 'define' },
  )
  const bad = runCli(repo, ['phase', 'validate', '9603'])
  assert.equal(bad.code, 2, 'a Zod-invalid docs-layout phase is exit 2 (the docs seam really validates)')
  assert.match(bad.stderr, /schema validation failed/, 'the failure is the consumer schema speaking, not a load error')
})

// ── D3a — `roadmap audit` is CLEAN in the docs layout, and READ the docs root ────────────
test('D3a — `roadmap audit` is CLEAN in the docs layout and reads phase files from docs/roadmap/phases', () => {
  const repo = docsFixture()
  const phaseFile = writePhaseFile(repo, fullPhase(9604))
  commitAll(repo, 'seed: docs-layout phase 9604')

  const clean = runCli(repo, ['audit', '--json'])
  // Exit 1 is the tsx/typed-tier failure door — an audit that never ran is not a clean audit.
  // (The consumer registry stub beside the docs seam must export discoverPhases, discoverArcs
  // AND crossValidate; cli/audit-checks.mts calls all three.)
  assert.notEqual(clean.code, 1, `the typed tier must RUN in the docs layout; stderr:\n${clean.stderr}`)
  assert.equal(clean.code, 0, `audit must be clean in the docs layout; stderr:\n${clean.stderr}`)
  const blocking = (clean.json?.findings ?? []).filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
  assert.deepEqual(blocking, [], 'no CRITICAL/HIGH finding in a freshly scaffolded docs-layout consumer')

  // Anti-vacuity: the clean verdict above is worth nothing unless the audit was LOOKING at
  // the docs root. Plant a marker in the docs-layout phase file; check 4 must find it THERE.
  appendFileSync(phaseFile, '\n// [NEEDS CLARIFICATION: which root does the audit read?]\n')
  const planted = runCli(repo, ['audit', '--json'])
  const marker = (planted.json?.findings ?? []).find((f) => f.check === 4)
  assert.ok(marker, `check 4 must find the planted marker; findings=${JSON.stringify(planted.json?.findings)}`)
  assert.equal(marker.phase, 9604)
  assert.ok(
    marker.location.startsWith(join(DOCS_ROOT(repo), 'phases', 'phase-9604.phase.ts')),
    `the finding must locate the DOCS phase file, got ${marker.location}`,
  )
})

// ── D3b — check 16 reads <root>/lib/schema.ts: drift there fires HIGH naming THAT path ───
test('D3b — drifting docs/roadmap/lib/schema.ts fires check 16 HIGH naming the DOCS seam, not the legacy one', () => {
  const repo = docsFixture()
  const seam = join(DOCS_ROOT(repo), 'lib', 'schema.ts')

  // Control: the vendored-verbatim seam reports no drift — so the HIGH below is the EDIT.
  const before = runCli(repo, ['audit', '--json'])
  assert.equal(before.code, 0, `the un-drifted docs consumer audits clean; stderr:\n${before.stderr}`)
  assert.deepEqual((before.json?.findings ?? []).filter((f) => f.check === 16), [], 'no schema drift before the edit')

  appendFileSync(seam, "\nexport * from './schema-drift-seam.ts'\n")
  const after = runCli(repo, ['audit', '--json'])
  assert.equal(after.code, 2, 'a HIGH schema-drift finding BREAKS the audit (exit 2)')
  const drift = (after.json?.findings ?? []).filter((f) => f.check === 16)
  assert.equal(drift.length, 1, `exactly one check-16 finding; got ${JSON.stringify(after.json?.findings)}`)
  assert.equal(drift[0].severity, 'HIGH')
  assert.equal(drift[0].location, seam, 'the finding is LOCATED at the docs seam that drifted')
  assert.ok(drift[0].message.includes(seam), `the message names the drifted docs seam: ${drift[0].message}`)
  // …and never the legacy seam, which does not even exist in this layout.
  assert.ok(!existsSync(LEGACY_SEAM(repo)), 'the legacy seam is absent in a docs-layout consumer')
  assert.ok(!after.stdout.includes(LEGACY_SEAM(repo)), 'no finding names the legacy <repo>/lib/roadmap/schema.ts path')
})

// ── D4 — `roadmap gate plan <N>` resolves in the docs layout ─────────────────────────────
test('D4 — `roadmap gate plan <N>` builds the plan from the docs-layout phase file', () => {
  const repo = docsFixture()
  // kind 'mockup' is the anti-vacuity: its cell is lint+types ONLY, so a plan built from a
  // default/legacy-fallback phase (treated as 'logic') would carry build/unit and red here.
  writePhaseFile(repo, fullPhase(9605, { status: 'in-progress', arcId: 'DOCSFX', kind: 'mockup', keyFiles: ['src/plain.ts'] }), { kind: 'define' })
  commitAll(repo, 'feat: phase 9605 — start')

  // gate plan ALSO loads roadmap.config.json through discovery — a docs-layout consumer with
  // no <repo>/roadmap/roadmap.config.json can only get here if the config was discovered too.
  const r = runCli(repo, ['gate', 'plan', '9605', '--json'])
  assert.equal(r.code, 0, `gate plan must resolve the docs layout; stderr:\n${r.stderr}`)
  assert.equal(r.json?.phase, 9605)
  assert.equal(r.json?.kind, 'mockup', 'the kind is READ from the docs-layout phase file (bridge-imported through <root>/lib/schema.ts)')
  const slots = (r.json?.slots ?? []).map((s) => s.slot)
  assert.ok(slots.includes('lint') && slots.includes('types'), `the mockup cell resolves lint+types; got ${slots}`)
  assert.deepEqual(slots.filter(slot => /^(build|unit|integration|e2e)(-|$)/.test(slot)), [], 'the mockup cell excludes every runtime gate variant')
})

test('D4 — explicit relevant/full scopes cannot add runtime slots to a mockup cell', () => {
  for (const testScope of ['relevant', 'full']) {
    const repo = docsFixture()
    writePhaseFile(repo, fullPhase(9606, { status: 'in-progress', arcId: 'DOCSFX', kind: 'mockup', testScope }), { kind: 'define' })
    writeFileSync(join(repo, 'src/preview.test.ts'), 'export const preview = true\n')
    commitAll(repo, 'feat: phase 9606 — start')
    const result = runCli(repo, ['gate', 'plan', '9606', '--json'])
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(result.json.slots.filter(({ slot }) => /^(build|unit|integration|e2e)(-|$)/.test(slot)), [], `${testScope} must honor the mockup cell`)
  }
})

// ── D5 — `roadmap claim` reserves the next number in the docs layout ─────────────────────
test('D5 — `roadmap claim` reserves the number after the highest phase declared in the docs layout', () => {
  const repo = docsFixture()
  writePhaseFile(repo, fullPhase(9700))
  commitAll(repo, 'seed: docs-layout phase 9700')

  const r = runCli(repo, ['claim'])
  assert.equal(r.code, 0, `claim must resolve the docs root; stderr:\n${r.stderr}`)
  // Anti-vacuity: a claim that never found docs/roadmap/phases would print 1, not 9701.
  assert.equal(r.stdout.trim(), '9701', 'the claim is max(declared phase in the DOCS root) + 1')
  assert.ok(
    existsSync(join(repo, '.git', 'zeroh-roadmap-claims', '9701.claim')),
    'the reservation file is written (creation IS the lock)',
  )
})

// ── D6 — ROADMAP_ROOT at a THIRD directory wins over BOTH candidates ─────────────────────
test('D6 — ROADMAP_ROOT=<abs> at a third directory wins over both candidates (control: the same repo answers differently without it)', () => {
  const repo = makeFixtureRepo({ layout: 'both' })
  const top = TOPLEVEL_ROOT(repo)
  const docs = DOCS_ROOT(repo)
  assert.ok(existsSync(top) && existsSync(docs), "layout 'both' must materialize BOTH candidate roots")

  // A phase in each candidate, so "the override wins" is provable by CONTENT, not by silence.
  mkdirSync(join(top, 'phases'), { recursive: true })
  mkdirSync(join(docs, 'phases'), { recursive: true })
  writeFileSync(join(top, 'phases', 'phase-9797.phase.ts'), plainSrc({ phase: 9797, status: 'in-progress', arcId: 'TOPFX', kind: 'logic', tasks: [{ id: '9797.1', done: false }] }))
  writeFileSync(join(docs, 'phases', 'phase-9798.phase.ts'), plainSrc({ phase: 9798, status: 'in-progress', arcId: 'DOCSFX', kind: 'logic', tasks: [{ id: '9798.1', done: false }] }))

  // The third root is NEITHER candidate — discovery could never reach it on its own.
  const third = join(repo, 'ops', 'phase-registry')
  assert.ok(isAbsolute(third), 'ROADMAP_ROOT is exercised as an ABSOLUTE path')
  mkdirSync(join(third, 'phases'), { recursive: true })
  cpSync(join(docs, 'roadmap.config.json'), join(third, 'roadmap.config.json'))
  writeFileSync(join(third, 'phases', 'phase-9799.phase.ts'), plainSrc({ phase: 9799, status: 'in-progress', arcId: 'THIRDFX', kind: 'logic', tasks: [{ id: '9799.1', done: false }] }))
  commitAll(repo, 'seed: both candidate roots plus a third directory')

  // NEGATIVE CONTROL — without the override the same repo answers differently: two marked
  // candidates is the named refusal, and the third root is invisible.
  const control = runCli(repo, ['status', '--json'])
  assert.notEqual(control.code, 0, 'without the override the ambiguous repo is REFUSED')
  assert.ok(!(control.stdout ?? '').includes('THIRDFX'), 'the third root is unreachable by discovery')

  const over = runCli(repo, ['status', '--json'], { ROADMAP_ROOT: third })
  assert.equal(over.code, 0, `ROADMAP_ROOT must be honored ahead of the ambiguity refusal; stderr:\n${over.stderr}`)
  const arcs = (over.json?.rows ?? []).map((row) => row.arc)
  assert.deepEqual(arcs, ['THIRDFX'], `the override root is the ONLY root read; rows=${JSON.stringify(over.json?.rows)}`)
  assert.ok(!arcs.includes('TOPFX') && !arcs.includes('DOCSFX'), 'the override wins over BOTH candidates')
})

// ── D8 — a flagless command resolves against the git TOPLEVEL, not the cwd ───────────────
test('D8 — from a SUBDIRECTORY, status and claim still read the docs root, and an ambiguous repo is still refused', () => {
  const repo = docsFixture()
  writePhaseFile(repo, { phase: 9800, status: 'in-progress', arcId: 'DOCSFX', kind: 'logic', tasks: [{ id: '9800.1', done: false }] })
  commitAll(repo, 'seed: docs-layout phase 9800')
  const deep = join(repo, 'src', 'spine')
  assert.ok(existsSync(deep), 'the fixture carries a nested source directory to run from')

  // Both commands default their ROOT ARGUMENT. Resolving it against the cwd instead of the
  // git toplevel invents `<subdir>/roadmap`, which exists in no layout — the exact shape of
  // the defect this direction pins (cli/commands/claim.mjs called an UNIMPORTED gitToplevel
  // inside a bare try/catch, so the ReferenceError was swallowed and the branch was dead).
  const st = runCli(repo, ['status', '--json'], {}, { cwd: deep })
  assert.equal(st.code, 0, `status from a subdirectory must resolve the toplevel's docs root; stderr:\n${st.stderr}`)
  assert.ok((st.json?.rows ?? []).some((row) => row.arc === 'DOCSFX'), `the docs lane is read from a subdirectory; rows=${JSON.stringify(st.json?.rows)}`)

  const cl = runCli(repo, ['claim'], {}, { cwd: deep })
  assert.equal(cl.code, 0, `claim from a subdirectory must resolve the toplevel's docs root; stderr:\n${cl.stderr}`)
  assert.equal(cl.stdout.trim(), '9801', 'the claim is max(declared phase in the DOCS root) + 1, read from a subdirectory')

  // …and the refusal is not escapable by standing somewhere else: an ambiguous repo has no
  // answer from a subdirectory either, where a cwd-relative fallback would have invented one.
  const both = makeFixtureRepo({ layout: 'both' })
  const deepBoth = join(both, 'src', 'spine')
  for (const args of [['status'], ['claim']]) {
    const r = runCli(both, args, {}, { cwd: deepBoth })
    assert.notEqual(r.code, 0, `\`roadmap ${args.join(' ')}\` from a subdirectory must still REFUSE an ambiguous repo (stdout: ${r.stdout.slice(0, 200)})`)
    assert.ok(r.stderr.includes(TOPLEVEL_ROOT(both)) && r.stderr.includes(DOCS_ROOT(both)), `the subdirectory refusal still names BOTH roots:\n${r.stderr}`)
    assert.doesNotMatch(r.stderr, /^\s+at /m, `the subdirectory refusal is a MESSAGE, not a stack:\n${r.stderr}`)
  }
})

// ── D7 — both roots marked ⇒ ONE named refusal at every door ─────────────────────────────
test('D7 — a repo carrying both marked roots is refused by status, phase validate and audit with the SAME message', () => {
  const repo = makeFixtureRepo({ layout: 'both' })
  const top = TOPLEVEL_ROOT(repo)
  const docs = DOCS_ROOT(repo)
  const marked = (dir) => existsSync(join(dir, 'roadmap.config.json')) || existsSync(join(dir, 'phases'))
  assert.ok(marked(top), `${top} must be MARKED (roadmap.config.json or phases/)`)
  assert.ok(marked(docs), `${docs} must be MARKED (roadmap.config.json or phases/)`)

  // Each of these three doors is green in the single-root docs fixture (D1/D2/D3a), so a
  // non-zero exit here is the ambiguity refusal and nothing else.
  mkdirSync(join(docs, 'phases'), { recursive: true })
  writeFileSync(join(docs, 'phases', 'phase-9798.phase.ts'), plainSrc({ phase: 9798, status: 'backlog', kind: 'logic', tasks: [{ id: '9798.1', done: false }] }))
  commitAll(repo, 'seed: two marked roots')

  const doors = [
    ['status'],
    ['phase', 'validate', '9798'],
    ['audit', '--json'],
  ]
  const runs = doors.map((args) => ({ args: args.join(' '), r: runCli(repo, args) }))

  for (const { args, r } of runs) {
    assert.notEqual(r.code, 0, `\`roadmap ${args}\` must REFUSE an ambiguous repo (stdout: ${r.stdout.slice(0, 200)})`)
    assert.ok(r.stderr.includes(top), `\`roadmap ${args}\` must name ${top}:\n${r.stderr}`)
    assert.ok(r.stderr.includes(docs), `\`roadmap ${args}\` must name ${docs}:\n${r.stderr}`)
    assert.match(r.stderr, /ROADMAP_ROOT=/, `\`roadmap ${args}\` must name the ROADMAP_ROOT=<dir> remedy:\n${r.stderr}`)
    // A stack trace is a crash, not a refusal — the operator gets a message at every door.
    assert.doesNotMatch(r.stderr, /^\s+at /m, `\`roadmap ${args}\` must refuse with a MESSAGE, not a stack:\n${r.stderr}`)
  }

  // One message, not three: the doors may prefix themselves, the refusal body may not differ.
  const [status, phaseValidate, audit] = runs.map(({ r }) => refusalBody(r.stderr))
  assert.equal(phaseValidate, status, 'phase validate must refuse with the SAME message as status')
  assert.equal(audit, status, 'audit must refuse with the SAME message as status')
})


test('D9 — migration audit reads the selected docs root and its root-local schema', () => {
  const repo = docsFixture()
  writePhaseFile(repo, fullPhase(9901), { kind: 'define' })
  commitAll(repo, 'seed: migration audit docs layout')
  const audit = new URL('../../scripts/migrate/audit.ts', import.meta.url)
  const run = spawnSync(join(repo, 'node_modules', '.bin', 'tsx'), [audit.pathname, '--project', repo], { cwd: repo, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(run.stdout, /NO SCHEMA|lib\/roadmap\/schema\.ts/, 'audit must not diagnose the retired legacy schema owner')
  assert.match(run.stdout, /docs\/roadmap\/lib\/schema\.ts/, 'audit evidence names the selected root-local schema')
  assert.match(run.stdout, /Total scanned: 1(?:\n|$)/)
})


test('D10 — record operations from a linked nested checkout select the docs roadmap', () => {
  const repo = docsFixture()
  writePhaseFile(repo, fullPhase(9902, { status: 'in-progress', arcId: 'LINKEDDOCS' }), { kind: 'define' })
  cpSync(new URL('../../templates/registry.ts', import.meta.url), join(DOCS_ROOT(repo), 'lib', 'registry.ts'))
  commitAll(repo, 'seed: linked docs operation')
  const linked = join(repo, '..', `linked-docs-${Date.now()}`)
  git(repo, 'worktree', 'add', '-q', '-b', `linked-docs-${Date.now()}`, linked)
  try {
    const nested = join(linked, 'src', 'spine')
    const result = runCli(linked, ['status', '--json'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.equal(result.code, 0, result.stderr)
    assert.ok((result.json?.rows ?? []).some((row) => row.arc === 'LINKEDDOCS'))
    const validate = runCli(linked, ['phase', 'validate', '9902', '--json'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.equal(validate.code, 0, validate.stderr); assert.equal(validate.json?.kind, 'ok')
    const audit = runCli(linked, ['audit', '--json'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.ok([0, 2].includes(audit.code), audit.stderr)
    assert.equal(audit.json?.summary?.phases, 1, 'audit really scanned the linked phase: ' + JSON.stringify(audit.json))
    const base = git(linked, 'rev-parse', 'HEAD')
    const gate = runCli(linked, ['gate', 'plan', '9902', '--base', base, '--json'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.equal(gate.code, 0, gate.stderr); assert.equal(gate.json?.phase, 9902)
    const claim = runCli(linked, ['claim'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.equal(claim.code, 0, claim.stderr); assert.equal(claim.stdout.trim(), '9903')
    const arm = runCli(linked, ['arm', 'LINKEDDOCS', '--mode', 'inline'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.equal(arm.code, 0, arm.stderr)
    const shared = join(repo, 'docs', 'roadmap', 'arcs', '.building')
    assert.ok(existsSync(join(shared, 'LINKEDDOCS.json')), 'real arm uses the main checkout docs registry')
    writeFileSync(join(shared, 'LINKEDDOCS-executor.jsonl'), JSON.stringify({ ts: new Date().toISOString(), phase: 9902, event: 'commit', detail: 'fixture' }) + '\n')
    const watch = runCli(linked, ['watch', 'LINKEDDOCS', '--once', '--json'], { ROADMAP_CONFIG: undefined, LIVENESS_PGREP_CMD: 'true', LIVENESS_PROBE_MS: '20' }, { cwd: nested })
    assert.equal(watch.code, 0, watch.stderr); assert.equal(watch.json?.arcId, 'LINKEDDOCS'); assert.equal(watch.json?.verdict, 'ALIVE')
    mkdirSync(join(repo, 'roadmap', 'phases'), { recursive: true })
    const ambiguousWatch = runCli(linked, ['watch', 'LINKEDDOCS', '--once', '--json'], { ROADMAP_CONFIG: undefined }, { cwd: nested })
    assert.notEqual(ambiguousWatch.code, 0)
    assert.match(ambiguousWatch.stderr, /more than one roadmap root/, 'watch must retain the shared registry ambiguity refusal')

  } finally {
    git(repo, 'worktree', 'remove', '--force', linked)
  }
})
