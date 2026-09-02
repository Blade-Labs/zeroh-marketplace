import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const CHECKS = [
  'tripwires-ran',
  'one-commit-per-task',
  'six-field-transparency-reports',
  'gate-rounds-carry-model',
  'rounds-carry-findings',
  'guard-mutation-proofs-quoted',
  'curation-evidence',
  'verify-complete-passed',
  'no-self-review-round',
  'plan-verify-clauses-unchanged',
  'lessons-flushed',
  'execution-result-roles-recorded',
]

const fullTransparency = {
  whatWasDone: 'implemented the complete fixture behavior',
  how: 'used the fixture repository and its observable records',
  compromises: 'None',
  skipped: 'None',
  hardcoded: 'None',
  limitations: 'None',
}

async function scorer() {
  return (await import('./adherence.mjs')).scoreAdherence
}

const git = (root, ...args) => execFileSync('git', ['-C', root, '-c', 'user.email=fixture@test', '-c', 'user.name=fixture', ...args], { encoding: 'utf8' }).trim()
const roadmapDir = (root) => join(root, 'roadmap')
function makeFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), 'zr-adherence-'))
  mkdirSync(join(root, 'roadmap', 'phases'), { recursive: true })
  git(root, 'init', '-q', '-b', 'develop')
  writeFileSync(join(root, 'seed'), 'seed\n')
  commitAll(root, 'seed: fixture')
  return root
}
function writePhaseFile(root, value) {
  writeFileSync(join(roadmapDir(root), 'phases', `phase-${value.phase}.phase.ts`), 'export default ' + JSON.stringify(value, null, 2) + '\n')
}
function commitAll(root, subject) {
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', subject)
}

function report(root, phase, overrides = {}) {
  const dir = join(roadmapDir(root), '.gate', String(phase))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run-000001-2026-09-02.json'), JSON.stringify({
    phase,
    startedAt: '2026-09-02T10:00:00.000Z',
    baseSha: git(root, 'rev-parse', 'HEAD'),
    mode: 'worktree',
    kind: 'logic',
    testScope: { derived: 'scoped', declared: null, effective: 'scoped' },
    reviewScope: { derived: 'scoped', declared: null, effective: 'scoped' },
    slots: [{ slot: 'unit', exitCode: 0 }],
    agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: 'independent review is clean', model: 'review-model', findings: [], recordedAt: '2026-09-02T10:02:00.000Z' }],
    green: true,
    notes: ['gate run --verify-complete passed', 'MUTATION PROOF: baseline red; mutated guard green; restored green'],
    curation: { squashedCount: 1, landedSubjects: [`feat(cli): phase ${phase} — fixture`], redProofs: [] },
    ...overrides,
  }, null, 2))
}

function phaseFixture({ phase = 7026, legacy = false, omit } = {}) {
  const root = makeFixtureRepo()
  const task = { id: `${phase}.1`, done: true, transparencyReport: { ...fullTransparency } }
  const executionResult = { status: 'done', driver: { model: 'codex', lane: 'codex' }, roles: [{ role: 'test-engineer', model: 'codex' }] }
  const obj = { phase, status: 'done', kind: 'logic', created: legacy ? '2026-01-01' : '2026-09-02', tasks: [task], gateRounds: [{ round: 1, agent: 'code-reviewer', model: 'review-model', findings: [], verdict: 'clean', summary: 'clean' }], executionResult, limitations: 'None' }
  if (omit === 'six-field-transparency-reports') delete task.transparencyReport.how
  if (omit === 'execution-result-roles-recorded') delete executionResult.roles
  if (omit === 'gate-rounds-carry-model') delete obj.gateRounds[0].model
  if (omit === 'rounds-carry-findings') delete obj.gateRounds[0].findings
  if (omit === 'no-self-review-round') obj.gateRounds[0].agent = 'self-review'
  writePhaseFile(root, obj)
  commitAll(root, `feat(cli): phase ${phase} — ${phase}.1 fixture task`)
  const phasePath = join(roadmapDir(root), 'phases', `phase-${phase}.phase.ts`)
  if (omit === 'one-commit-per-task') {
    const src = readFileSync(phasePath, 'utf8').replace('"done": true', '"done": false')
    writeFileSync(phasePath, src)
    commitAll(root, `docs(roadmap): phase ${phase} — remove task evidence`)
  }
  const building = join(root, '.building')
  mkdirSync(building, { recursive: true })
  const events = omit === 'tripwires-ran'
    ? [{ ts: '2026-09-02T10:01:00.000Z', phase, event: 'task-start', task: task.id }]
    : [{ ts: '2026-09-02T10:00:00.000Z', phase, event: 'executor-start' }, { ts: '2026-09-02T10:01:00.000Z', phase, event: 'task-start', task: task.id }]
  if (omit !== 'lessons-flushed') events.push({ ts: '2026-09-02T10:03:00.000Z', phase, event: 'result-returned' })
  writeFileSync(join(building, `${phase}-executor.jsonl`), events.map(JSON.stringify).join('\n') + '\n')
  if (omit === 'lessons-flushed') writeFileSync(join(building, `${phase}-executor.jsonl`), events.concat({ ts: '2026-09-02T10:02:00.000Z', phase, event: 'resume' }).map(JSON.stringify).join('\n') + '\n')
  else writeFileSync(join(roadmapDir(root), 'lessons.jsonl'), JSON.stringify({ ts: '2026-09-02T10:02:30.000Z', phase, lesson: 'fixture lesson flushed immediately' }) + '\n')
  const reportOverrides = {}
  if (omit === 'curation-evidence') reportOverrides.curation = undefined
  if (omit === 'verify-complete-passed') reportOverrides.notes = ['ordinary green run only']
  if (omit === 'guard-mutation-proofs-quoted') reportOverrides.notes = ['gate run --verify-complete passed']
  report(root, phase, reportOverrides)
  if (omit === 'plan-verify-clauses-unchanged') {
    writeFileSync(phasePath, readFileSync(phasePath, 'utf8') + '// verify: changed after queue\n')
  }
  return root
}

test('scoreAdherence — a complete landed phase passes all twelve protocol checks', async () => {
  const scoreAdherence = await scorer()
  const result = scoreAdherence(phaseFixture(), 7026)
  assert.equal(result.phase, 7026)
  assert.equal(result.driver.model, 'codex')
  assert.deepEqual(result.checks.map((c) => c.id), CHECKS)
  assert.ok(result.checks.every((c) => c.applicable && c.passed && c.evidence), JSON.stringify(result.checks, null, 2))
  assert.equal(result.score, 1)
})

for (const id of CHECKS) {
  test(`scoreAdherence — ${id} fails when its required evidence is absent`, async () => {
    const scoreAdherence = await scorer()
    const check = scoreAdherence(phaseFixture({ omit: id }), 7026).checks.find((row) => row.id === id)
    assert.deepEqual({ applicable: check.applicable, passed: check.passed }, { applicable: true, passed: false })
    assert.ok(check.evidence, 'a failure names the evidence that is absent or invalid')
  })
}

test('scoreAdherence — a phase predating the conventions abstains instead of throwing or failing', async () => {
  const scoreAdherence = await scorer()
  for (const [index, id] of CHECKS.entries()) {
    const phase = 70 + index
    const result = scoreAdherence(phaseFixture({ phase, legacy: true, omit: id }), phase)
    assert.deepEqual(result.checks.map((c) => c.id), CHECKS)
    const check = result.checks.find((c) => c.id === id)
    assert.deepEqual({ applicable: check.applicable, passed: check.passed }, { applicable: false, passed: false }, `${id} must abstain when the phase predates its convention`)
    assert.ok(check.evidence, `${id} abstention explains why it is inapplicable`)
    const applicable = result.checks.filter((c) => c.applicable)
    assert.equal(result.score, applicable.length ? applicable.filter((c) => c.passed).length / applicable.length : null)
  }
})
