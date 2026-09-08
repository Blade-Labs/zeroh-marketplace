import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { validateRoadmapFile } from '../cli/lib/validate.mjs'
import { bridgeImport, bridgeEval, bridgeSource } from '../cli/lib/tsx-bridge.mjs'

const criterion = { id: 'journey', description: 'A user completes the journey with real data' }
const review = { reviewer: 'independent', summary: 'Observed the actual journey' }
const phase = number => ({ phase: number, name: `Journey ${number}`, arcId: 'A', criteria: ['journey'], tasks: [{ id: 'work', description: 'Implement journey' }] })
function fixture(t, { legacy = false } = {}) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap ' Ω validation-"))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const roadmap = path.join(repo, 'roadmap')
  for (const dir of ['lib', 'phases', 'arcs']) fs.mkdirSync(path.join(roadmap, dir), { recursive: true })
  fs.symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(repo, 'node_modules'), 'dir')
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\n')
  const schema = path.join(roadmap, 'lib', 'schema.ts')
  if (legacy) fs.writeFileSync(schema, `// Representative consumer-vendored schema: legacy API exports and legacy fields remain local.
import { z } from 'zod';
export const ArcShape = z.object({ id: z.union([z.string(), z.number()]), status: z.string().optional(), acceptanceCriteria: z.array(z.object({ id: z.string(), description: z.string().optional(), job: z.string().optional(), signal: z.string().optional(), tier: z.string().optional(), bar: z.string().optional() }).passthrough()).optional() }).passthrough();
export const PhaseShape = z.object({ phase: z.number().int().positive(), name: z.string(), tasks: z.array(z.object({ id: z.string(), description: z.string() }).passthrough()) }).passthrough();
export const defineArc = value => ArcShape.parse(value); export const definePhase = value => PhaseShape.parse(value);`)
  else fs.copyFileSync(fileURLToPath(new URL('../templates/schema.ts', import.meta.url)), schema)
  const arcPath = path.join(roadmap, 'arcs', "A ' Ω.arc.ts")
  const phasePath = path.join(roadmap, 'phases', 'one.phase.ts')
  const write = (file, kind, record) => fs.writeFileSync(file, `import { define${kind} } from '../lib/schema';\nexport default define${kind}(${JSON.stringify(record)});\n`)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  git('init', '-q'); git('config', 'user.name', 'Roadmap test'); git('config', 'user.email', 'roadmap-test@example.invalid')
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
  const original = { id: 'A', name: 'Prototype', intent: 'Usable local prototype', scope: ['Local only'], acceptanceCriteria: [criterion], phases: [1], planning: { mode: 'rolling', windowSize: 2, deferredCriteria: [] } }
  write(arcPath, 'Arc', original); write(phasePath, 'Phase', phase(1))
  const baseline = commit()
  const current = { ...original, status: 'executing', intentRef: `${baseline}:roadmap/arcs/A ' Ω.arc.ts` }
  write(arcPath, 'Arc', current); commit()
  return { repo, roadmap, arcPath, phasePath, original, current, write, git, commit }
}
const rules = result => (result.errors ?? []).map(error => `${error.rule}: ${error.msg}`).join('\n')
function expectFailure(result, pattern) { assert.equal(result.ok, false, JSON.stringify(result)); if (pattern) assert.match(rules(result), pattern) }

test('committed intent validates through paths with spaces, quotes and unicode without writing consumer files', t => {
  const f = fixture(t)
  const before = f.git('status', '--porcelain', '--untracked-files=all')
  const filesBefore = fs.readdirSync(path.join(f.roadmap, 'arcs'))
  const result = validateRoadmapFile(f.arcPath)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(f.git('status', '--porcelain', '--untracked-files=all'), before)
  assert.deepEqual(fs.readdirSync(path.join(f.roadmap, 'arcs')), filesBefore)
  assert.equal(bridgeImport(f.arcPath, { consumerRoot: f.repo }).parsed.name, 'Prototype')
})

test('active arc cannot remove baseline or weaken criteria by resetting status', t => {
  const f = fixture(t)
  f.write(f.arcPath, 'Arc', { ...f.current, intentRef: undefined })
  expectFailure(validateRoadmapFile(f.arcPath), /intent-ref/)
  f.write(f.arcPath, 'Arc', { ...f.current, status: 'backlog', acceptanceCriteria: [{ ...criterion, description: 'A screenshot exists' }] })
  expectFailure(validateRoadmapFile(f.arcPath), /original-intent/)
})

test('owner ratification appends an explicit matching delta; committed ruling cannot be rewritten', t => {
  const f = fixture(t)
  const ruling = { criterionId: 'journey', previousDescription: criterion.description, description: 'User completes the approved revised journey', reason: 'Owner changed the product requirement', approvedBy: 'owner', approvedAt: '2026-09-08T12:00:00Z' }
  const ratified = { ...f.current, acceptanceCriteria: [{ id: 'journey', description: ruling.description }], criteriaRatifications: [ruling] }
  f.write(f.arcPath, 'Arc', ratified)
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
  f.commit()
  f.write(f.arcPath, 'Arc', { ...ratified, criteriaRatifications: [{ ...ruling, reason: 'rewritten history' }] })
  expectFailure(validateRoadmapFile(f.arcPath), /ratification-history/)
})

test('empty rolling window preserves deferred work and cannot complete', t => {
  const f = fixture(t)
  fs.unlinkSync(f.phasePath)
  const deferred = { ...f.current, phases: [], planning: { mode: 'rolling', windowSize: 2, deferredCriteria: ['journey'] } }
  f.write(f.arcPath, 'Arc', deferred)
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
  f.write(f.arcPath, 'Arc', { ...deferred, status: 'swept' })
  expectFailure(validateRoadmapFile(f.arcPath), /completion/)
  f.write(f.arcPath, 'Arc', { ...deferred, planning: { ...deferred.planning, deferredCriteria: [] } })
  expectFailure(validateRoadmapFile(f.arcPath), /coverage/)
})

test('multiple phases may contribute to a criterion while partial work remains deferred', t => {
  const f = fixture(t)
  f.write(f.arcPath, 'Arc', { ...f.current, planning: { ...f.current.planning, deferredCriteria: ['journey'] } })
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
  f.write(path.join(f.roadmap, 'phases', 'two.phase.ts'), 'Phase', phase(2))
  f.write(f.arcPath, 'Arc', { ...f.current, phases: [1, 2] })
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
})

test('completion depends on completed members, not merely acceptance text', t => {
  const f = fixture(t)
  const done = { ...f.current, status: 'done', independentReview: review, acceptanceResults: [{ criterionId: 'journey', accepted: true, summary: 'Observed' }] }
  f.write(f.arcPath, 'Arc', done)
  expectFailure(validateRoadmapFile(f.arcPath), /completion/)
  f.write(f.phasePath, 'Phase', { ...phase(1), status: 'done', independentReview: review, tasks: [{ id: 'work', description: 'Implement journey', status: 'done' }], checks: [{ command: 'node journey.mjs', exitCode: 0, summary: 'Passed' }] })
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
})

test('missing dependency and duplicate phase IDs are visible failures', t => {
  const f = fixture(t)
  f.write(f.phasePath, 'Phase', { ...phase(1), dependsOn: [999] })
  expectFailure(validateRoadmapFile(f.phasePath), /dependency/)
  f.write(path.join(f.roadmap, 'phases', 'duplicate.phase.ts'), 'Phase', phase(1))
  expectFailure(validateRoadmapFile(f.arcPath), /duplicate-phase/)
})

test('bridge uses the consumer schema for legacy records without rewriting them', t => {
  const f = fixture(t, { legacy: true })
  const historical = { id: 'old', status: 'historical', legacyOnly: 'preserved', planes: [{ name: 'Old', phases: [] }] }
  f.write(f.arcPath, 'Arc', historical)
  const before = fs.readFileSync(f.arcPath, 'utf8')
  const imported = bridgeImport(f.arcPath, { consumerRoot: f.repo })
  assert.equal(imported.ok, true, JSON.stringify(imported))
  assert.deepEqual(imported.parsed, historical)
  assert.equal(fs.readFileSync(f.arcPath, 'utf8'), before)
})

test('legacy active intent cannot be bypassed with historical status', t => {
  const f = fixture(t, { legacy: true })
  f.write(f.arcPath, 'Arc', { ...f.current, status: 'historical', acceptanceCriteria: [{ ...criterion, description: 'Only a screenshot' }] })
  expectFailure(validateRoadmapFile(f.arcPath), /original-intent/)
})

test('missing TS loader reports unavailable instead of successful validation', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-no-loader-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const result = bridgeEval(directory, 'process.stdout.write("ok")', { pluginTsx: path.join(directory, 'missing-tsx') })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'tsx-absent')
})

test('legacy original intent comparisons include actual job and signal fields', t => {
  const f = fixture(t, { legacy: true })
  const legacyCriterion = { id: 'journey', job: 'User completes the real journey', signal: 'Result uses saved real data', tier: 'wired', bar: 'No placeholder' }
  const approved = { ...f.original, acceptanceCriteria: [legacyCriterion] }
  f.write(f.arcPath, 'Arc', approved)
  const baseline = f.commit()
  const executing = { ...approved, status: 'executing', intentRef: `${baseline}:roadmap/arcs/A ' Ω.arc.ts` }
  f.write(f.arcPath, 'Arc', executing); f.commit()
  f.write(f.arcPath, 'Arc', { ...executing, acceptanceCriteria: [{ ...legacyCriterion, signal: 'Screenshot of a mock is enough' }] })
  expectFailure(validateRoadmapFile(f.arcPath), /original-intent|legacy/)
})


test('plain exports cannot bypass the consumer schema completion checks', t => {
  const f = fixture(t)
  fs.writeFileSync(f.phasePath, `export default ${JSON.stringify({ ...phase(1), status: 'done' })}`)
  const result = validateRoadmapFile(f.phasePath)
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'zod')
  assert.match(result.loadError, /independentReview|tasks done/)
})

test('committed imported or computed intent is refused without executing it or writing consumer files', t => {
  const f = fixture(t)
  const before = f.git('status', '--porcelain', '--untracked-files=all')
  const marker = path.join(f.repo, 'baseline-executed')
  for (const source of [
    "import { criteria } from './mutable'; export default defineArc({ id: 'A', acceptanceCriteria: criteria });",
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'bad'); export default defineArc({ id: 'A', acceptanceCriteria: (() => [])() });`,
  ]) {
    const result = bridgeSource(source, f.arcPath, f.repo)
    assert.equal(result.ok, false)
    assert.match(result.stderr, /literal|computed|imported/)
    assert.equal(fs.existsSync(marker), false)
  }
  assert.equal(f.git('status', '--porcelain', '--untracked-files=all'), before)
})

test('arc completion cannot trust an invalid plain-export member marked done', t => {
  const f = fixture(t)
  f.write(f.arcPath, 'Arc', { ...f.current, status: 'done', independentReview: review, acceptanceResults: [{ criterionId: 'journey', accepted: true, summary: 'Observed' }] })
  fs.writeFileSync(f.phasePath, `export default ${JSON.stringify({ ...phase(1), status: 'done' })}`)
  expectFailure(validateRoadmapFile(f.arcPath))
})

test('validation resolves a symlinked consumer path before looking up its Git intent', t => {
  const f = fixture(t), link = f.repo + '-link'
  fs.symlinkSync(f.repo, link, 'dir')
  t.after(() => fs.rmSync(link, { force: true }))
  const result = validateRoadmapFile(path.join(link, path.relative(f.repo, f.arcPath)))
  assert.equal(result.ok, true, JSON.stringify(result))
})

test('unborn HEAD allows backlog planning but cannot supply an active intent baseline', t => {
  const f = fixture(t)
  f.git('checkout', '--orphan', 'unborn')
  f.git('rm', '-r', '--cached', '.')
  f.write(f.arcPath, 'Arc', f.original)
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
  f.write(f.arcPath, 'Arc', { ...f.original, status: 'executing' })
  expectFailure(validateRoadmapFile(f.arcPath), /intent-ref/)
})

test('literal baseline comparison honors schema whitespace normalization', t => {
  const f = fixture(t)
  const spaced = { ...f.original, intent: '  Usable local prototype  ', scope: ['  Local only  '], acceptanceCriteria: [{ ...criterion, description: '  ' + criterion.description + '  ' }] }
  f.write(f.arcPath, 'Arc', spaced)
  const baseline = f.commit()
  f.write(f.arcPath, 'Arc', { ...f.original, status: 'executing', intentRef: `${baseline}:roadmap/arcs/A ' Ω.arc.ts` })
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
})

test('computed committed HEAD fails explicitly instead of skipping established history', t => {
  const f = fixture(t)
  fs.writeFileSync(f.arcPath, `import { defineArc } from '../lib/schema'; const data = ${JSON.stringify(f.current)}; export default defineArc(data);`)
  f.commit()
  f.write(f.arcPath, 'Arc', f.original)
  const result = validateRoadmapFile(f.arcPath)
  expectFailure(result, /intent-history/)
  assert.match(rules(result), /literal.*computed|computed.*literal/)
})

test('invalid related dependencies and parent arcs cannot supply trusted completion state', t => {
  const f = fixture(t)
  f.write(f.phasePath, 'Phase', { ...phase(1), status: 'in-progress', dependsOn: [2] })
  const dependency = path.join(f.roadmap, 'phases', 'two.phase.ts')
  fs.writeFileSync(dependency, `export default ${JSON.stringify({ ...phase(2), status: 'done' })}`)
  expectFailure(validateRoadmapFile(f.phasePath), /related-record/)
  fs.unlinkSync(dependency)
  f.write(f.phasePath, 'Phase', { ...phase(1), status: 'in-progress' })
  fs.writeFileSync(f.arcPath, 'export default { id: "A", phases: [1], status: "done" };')
  expectFailure(validateRoadmapFile(f.phasePath), /related-record/)
})

test('unrelated historical shapes are not subjected to a forced schema upgrade', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.roadmap, 'phases', 'archive.phase.ts'), 'export default { phase: 999, status: "historical", oldField: "preserved" };')
  assert.equal(validateRoadmapFile(f.arcPath).ok, true)
})
