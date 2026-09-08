import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import 'tsx/cjs'
import { register } from 'tsx/esm/api'
register()
const { defineArc, definePhase, defineBacklog } = await import('../templates/schema.ts')
const { crossValidate, discoverPhases } = await import('../templates/registry.ts')
const arc = () => ({ id: 'A', name: 'Usable app', intent: 'Finish the user journey', scope: ['Local app'], acceptanceCriteria: [{ id: 'journey', description: 'User can complete the journey' }], phases: [1] })
const phase = () => ({ phase: 1, name: 'Journey', arcId: 'A', criteria: ['journey'], tasks: [{ id: 'implement', description: 'Implement and check the user journey' }] })
const review = { reviewer: 'independent reviewer', summary: 'Drove the documented user journey and checked the diff' }

test('rolling is optional: fully planned new-format records remain valid', () => {
  assert.equal(defineArc(arc()).planning, undefined)
  const rolling = defineArc({ ...arc(), phases: [], planning: { mode: 'rolling', windowSize: 2, deferredCriteria: ['journey'] } })
  assert.equal(rolling.status, 'backlog')
  assert.equal(rolling.planning.deferredCriteria.length, 1)
  assert.deepEqual(defineBacklog([{ phase: 1, name: 'Journey' }]), [{ phase: 1, name: 'Journey' }])
})

test('criterion identities cannot duplicate, vanish from deferred references, or falsely complete', () => {
  assert.throws(() => defineArc({ ...arc(), acceptanceCriteria: [...arc().acceptanceCriteria, ...arc().acceptanceCriteria] }), /Duplicate acceptance/)
  for (const deferredCriteria of [['missing'], ['journey', 'journey']])
    assert.throws(() => defineArc({ ...arc(), planning: { mode: 'rolling', deferredCriteria } }), /Unknown criterion|Duplicate deferred/)
  const done = { ...arc(), status: 'done', independentReview: review, acceptanceResults: [{ criterionId: 'journey', accepted: true, summary: 'Journey observed' }] }
  assert.equal(defineArc(done).status, 'done')
  assert.throws(() => defineArc({ ...done, planning: { mode: 'rolling', deferredCriteria: ['journey'] } }), /deferred/)
  assert.throws(() => defineArc({ ...done, acceptanceResults: [] }), /acceptance result/)
})

test('baseline references must be immutable SHA and repository-relative arc paths', () => {
  const sha = 'a'.repeat(40)
  assert.equal(defineArc({ ...arc(), intentRef: `${sha}:roadmap/arcs/A.arc.ts` }).intentRef, `${sha}:roadmap/arcs/A.arc.ts`)
  for (const ref of ['HEAD:roadmap/arcs/A.arc.ts', `${sha}:/tmp/A.arc.ts`, `${sha}:../A.arc.ts`, `${sha}:roadmap/../A.arc.ts`, `${sha}:roadmap\\A.arc.ts`, `${sha}:A.phase.ts`])
    assert.throws(() => defineArc({ ...arc(), intentRef: ref }), /intentRef/)
})

test('phase completion needs actual successful required checks and resolved independent review', () => {
  const done = { ...phase(), status: 'done', tasks: [{ id: 'implement', description: 'Journey', status: 'done' }], independentReview: review, checks: [{ command: 'node --test journey.test.mjs', exitCode: 0, summary: 'Journey and error case passed' }] }
  assert.equal(definePhase(done).status, 'done')
  for (const exitCode of [null, 1]) assert.throws(() => definePhase({ ...done, checks: [{ ...done.checks[0], exitCode }] }), /unknown is not green/)
  assert.throws(() => definePhase({ ...done, independentReview: undefined }), /independentReview/)
  assert.deepEqual(definePhase({ ...done, checks: [] }).checks, [], 'A documentation-only phase does not need an invented shell check')
  assert.throws(() => definePhase({ ...done, findings: [{ ...review, resolved: false }] }), /unresolved/)
  assert.throws(() => definePhase({ ...done, tasks: phase().tasks }), /all tasks done/)
})

test('cross-record integrity rejects dangling membership, criteria and dependencies', () => {
  assert.deepEqual(crossValidate([definePhase(phase())], [defineArc(arc())]), [])
  assert.match(crossValidate([definePhase({ ...phase(), criteria: ['missing'], dependsOn: [2] })], [defineArc(arc())]).join('\n'), /unknown criterion missing/)
  assert.match(crossValidate([], [defineArc(arc())]).join('\n'), /missing phase 1/)
  assert.match(crossValidate([definePhase(phase())], []).join('\n'), /missing arc membership/)
})

test('discovery reports invalid files instead of silently emitting apparently complete progress', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-schema-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'bad.phase.ts'), 'export default { phase: 1, name: "Missing tasks" }')
  const result = await discoverPhases(root)
  assert.equal(result.phases.length, 0)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0].error, /tasks/)
})

function emitFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-emit-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'roadmap')
  for (const subdir of ['lib', 'phases', 'arcs']) fs.mkdirSync(path.join(root, subdir), { recursive: true })
  for (const filename of ['schema.ts', 'registry.ts', 'emit.ts'])
    fs.copyFileSync(fileURLToPath(new URL(`../templates/${filename}`, import.meta.url)), path.join(root, 'lib', filename))
  fs.symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), path.join(directory, 'node_modules'), 'dir')
  const write = (kind, name, record) => fs.writeFileSync(path.join(root, kind === 'Arc' ? 'arcs' : 'phases', `${name}.${kind.toLowerCase()}.ts`),
    `import { define${kind} } from '../lib/schema'; export default define${kind}(${JSON.stringify(record)})`)
  const run = () => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path.join(root, 'lib', 'emit.ts')], {
    cwd: directory, encoding: 'utf8', timeout: 10000, env: { ...process.env, ROADMAP_ROOT: root },
  })
  return { root, write, run }
}

test('real emit preserves five outcomes while only the next two phases are detailed', t => {
  const fixture = emitFixture(t)
  const acceptanceCriteria = Array.from({ length: 5 }, (_, i) => ({ id: `outcome-${i + 1}`, description: `User outcome ${i + 1}` }))
  fixture.write('Arc', 'A', { ...arc(), status: 'executing', acceptanceCriteria, phases: [1, 2],
    planning: { mode: 'rolling', windowSize: 2, deferredCriteria: ['outcome-3', 'outcome-4', 'outcome-5'] } })
  for (const number of [1, 2]) fixture.write('Phase', String(number), { ...phase(), phase: number, criteria: [`outcome-${number}`] })
  const result = fixture.run()
  assert.equal(result.status, 0, result.stderr)
  const progress = JSON.parse(result.stdout)
  assert.equal(progress.phases.length, 2)
  assert.equal(progress.arcs[0].status, 'executing')
  assert.equal(progress.arcs[0].acceptanceCriteria.length, 5)
  assert.deepEqual(progress.arcs[0].planning.deferredCriteria, ['outcome-3', 'outcome-4', 'outcome-5'])
  assert.deepEqual(progress.errors, [])
})

test('real emit fails on dangling phase and dependency references', t => {
  const fixture = emitFixture(t)
  fixture.write('Arc', 'A', { ...arc(), phases: [1, 2] })
  fixture.write('Phase', 'one', { ...phase(), dependsOn: [99] })
  const result = fixture.run()
  assert.equal(result.status, 1, result.stderr)
  const errors = JSON.parse(result.stdout).errors.map(e => e.error).join('\n')
  assert.match(errors, /missing phase 2/)
  assert.match(errors, /missing dependency 99/)
})

test('real emit reports both file paths for duplicate phase IDs', t => {
  const fixture = emitFixture(t)
  fixture.write('Phase', 'one', { ...phase(), arcId: undefined })
  fixture.write('Phase', 'duplicate', { ...phase(), arcId: undefined })
  const result = fixture.run()
  assert.equal(result.status, 1, result.stderr)
  const errors = JSON.parse(result.stdout).errors.map(e => e.error).join('\n')
  assert.match(errors, /Duplicate 1/)
  assert.match(errors, /one\.phase\.ts/)
  assert.match(errors, /duplicate\.phase\.ts/)
})

test('real emit rejects malformed arc exports instead of omitting their promises silently', t => {
  const fixture = emitFixture(t)
  fs.writeFileSync(path.join(fixture.root, 'arcs', 'bad.arc.ts'), 'export default { id: "A", phases: [] }')
  const result = fixture.run()
  assert.equal(result.status, 1, result.stderr)
  assert.equal(JSON.parse(result.stdout).errors.length, 1)
})
