#!/usr/bin/env node
/** Whole-arc normalization planning against typed records, real Git ownership, and gate evidence. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeFixtureRepo, writeArcFile, writePhaseFile, commitAll, git } from '../../test/fixture-consumer/harness.mjs'
import { writeReport } from './gate-report.mjs'

const dirs = []
process.on('exit', () => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
const planner = async () => (await import('./history-normalize.mjs'))
const delivery = (head, overrides = {}) => ({ head, publication: 'unpublished', pullRequest: null, green: false, publicationRefs: [], ...overrides })

function arcFixture() {
  const root = makeFixtureRepo(); dirs.push(root)
  cpSync(new URL('../../templates/registry.ts', import.meta.url), join(root, 'lib', 'roadmap', 'registry.ts'))
  git(root, 'config', 'user.email', 'history@test'); git(root, 'config', 'user.name', 'history fixture')
  const arcId = 'HISTORY'; const phases = [4001, 4002, 4003, 4004, 4005, 4006]
  writeArcFile(root, { id: arcId, name: 'History normalization fixture', baseRef: 'develop', planes: [{ name: 'delivery', phases }] })
  for (const phase of phases) writePhaseFile(root, {
    phase, arcId, status: 'done', name: `History phase ${phase}`, category: 'test', kind: 'logic', source: 'fixture-consumer', priority: 'LOW',
    dependsOn: [], conflictsWith: [], keyFiles: [`src/history-${phase}.txt`], stakeholderDemo: `phase ${phase} is represented once`,
    tasks: [{ minimal: true, id: `${phase}.1`, title: `deliver phase ${phase}`, done: true, transparencyReport: { whatWasDone: `delivered ${phase}`, how: 'fixture commit', compromises: 'None', skipped: 'None', hardcoded: 'None', limitations: 'None' } }],
    gate: { lint: 'clean', typeCheck: 'clean', unitTests: { passed: 1, total: 1 }, integrationTests: { passed: 1, total: 1 }, e2eTests: { passed: 0, total: 0, skipped: 0 }, build: 'clean' },
    gateRounds: [{ round: 1, agent: 'code-reviewer', model: 'test-reviewer', verdict: 'clean', findings: [], summary: 'independent fixture review clean' }],
    metrics: { commits: 1, linesAdded: 1, linesRemoved: 0, filesChanged: 1, testsAtStart: 1, testsAtEnd: 1, testsAdded: 0 },
    completedDate: '2026-09-07',
    executionResult: { phase, status: 'done', gateRounds: 1, hardStops: [] },
  }, { kind: 'define' })
  commitAll(root, 'seed: typed six-phase arc'); const base = git(root, 'rev-parse', 'HEAD')
  git(root, 'checkout', '-q', '-b', 'feature/history')
  const expected = []
  for (const [index, phase] of phases.entries()) {
    const commits = []
    const commit = (subject, suffix) => {
      const path = join(root, 'src', `history-${phase}-${suffix}.txt`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, subject + '\n')
      git(root, 'add', path); git(root, 'commit', '-q', '-m', subject); const sha = git(root, 'rev-parse', 'HEAD'); commits.push(sha); return sha
    }
    commit(`docs(roadmap): phase ${phase} — move to in-progress`, 'state')
    const task = commit(index === 2 ? `feat(history): deliver phase (${phase}.1)` : `feat(history): phase ${phase} — ${phase}.1 deliver phase`, 'task')
    let reviewSha = task
    for (let round = 0; round < index % 3; round++) reviewSha = commit(`fix(history): phase ${phase} gate R${round} — review findings`, `gate-${round}`)
    commit(`docs(roadmap): phase ${phase} — record transparency report`, 'done')
    if (index === phases.length - 1) reviewSha = commit(`fix(history): phase ${phase} gate R2 — trailing findings`, 'trailing')
    expected.push({ phase, commits, reviewSha, boundary: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}') })
  }
  const head = git(root, 'rev-parse', 'HEAD')
  for (const row of expected) writeReport(root, {
    phase: row.phase, startedAt: '2026-09-07T06:00:00.000Z', baseSha: base, mode: 'phase', kind: 'logic',
    testScope: { derived: 'relevant', declared: null, effective: 'relevant' }, reviewScope: { derived: 'full', declared: null, effective: 'full' },
    slots: [{ slot: 'types', command: 'test', exitCode: 0, durationMs: 1, logPath: null }],
    agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: 'clean', sha: row.reviewSha, recordedAt: '2026-09-07T06:01:00.000Z' }], green: true, notes: [],
  })
  return { root, arcId, phases, base, head, expected }
}

function unchanged(root) {
  return { head: git(root, 'rev-parse', 'HEAD'), tree: git(root, 'rev-parse', 'HEAD^{tree}'), refs: git(root, 'show-ref'), objects: git(root, 'count-objects', '-v'), status: git(root, 'status', '--porcelain', '-uall') }
}

async function plan(f, overrides = {}, observed = delivery(f.head)) {
  const { planHistoryNormalization } = await planner()
  return planHistoryNormalization(f.root, { arcId: f.arcId, base: f.base, head: f.head, ...overrides }, { inspectDelivery: () => observed })
}

function assertPlanShape(out, f) {
  assert.equal(out.version, 1); assert.equal(out.arcId, f.arcId); assert.equal(out.base, f.base); assert.equal(out.expectedHead, f.head)
  assert.equal(out.expectedTree, git(f.root, 'rev-parse', `${f.head}^{tree}`)); assert.deepEqual(out.phases, f.phases)
  assert.deepEqual(out.groups.map((group) => group.phase), f.phases)
  assert.deepEqual(out.groups.flatMap((group) => group.commits.map((commit) => commit.sha)), f.expected.flatMap((row) => row.commits))
  for (const [index, group] of out.groups.entries()) {
    assert.equal(group.sourceBoundary.sha, f.expected[index].boundary); assert.equal(group.sourceBoundary.tree, f.expected[index].tree)
    assert.deepEqual(group.parent, index ? { phase: f.phases[index - 1] } : { base: f.base })
    assert.match(group.message.subject, new RegExp(`phase ${group.phase} —`)); assert.ok(group.message.body.length > 0)
  }
  assert.match(out.planDigest, /^[a-f0-9]{64}$/)
}

test('six noisy typed phases produce one complete ordered boundary group per phase without mutating Git', async () => {
  const f = arcFixture(); writeFileSync(join(f.root, 'roadmap', '.arc-mode'), 'HISTORY\n'); git(f.root, 'update-ref', 'refs/heads/unrelated', f.head); const before = unchanged(f.root); const out = await plan(f)
  assertPlanShape(out, f); assert.equal((await plan(f)).planDigest, out.planDigest); assert.deepEqual(unchanged(f.root), before)
})

test('delivery uncertainty, publication, dirty tracked files, and head mismatch refuse before planning', async () => {
  const deliveryChanges = [
    ['delivery-unproven', () => null],
    ['delivery-unproven', () => delivery('f'.repeat(40))],
    ['published', (f) => delivery(f.head, { publication: 'published' })],
    ['green', (f) => delivery(f.head, { green: true })],
    ['publication-unproven', (f) => delivery(f.head, { publicationRefs: ['refs/remotes/origin/missing'] })],
    ['published', (f) => { git(f.root, 'update-ref', 'refs/heads/develop', f.expected[1].boundary); return delivery(f.head) }],
    ['published', (f) => { git(f.root, 'update-ref', 'refs/remotes/origin/develop', f.head); return delivery(f.head, { publicationRefs: ['refs/remotes/origin/develop'] }) }],
  ]
  for (const [kind, observation] of deliveryChanges) {
    const f = arcFixture(); const observed = observation(f); const before = unchanged(f.root)
    await assert.rejects(() => plan(f, {}, observed), (error) => error.kind === kind)
    assert.deepEqual(unchanged(f.root), before)
  }
  const dirty = arcFixture(); writeFileSync(join(dirty.root, 'src', 'plain.ts'), 'tracked dirt\n'); const dirtyBefore = unchanged(dirty.root)
  await assert.rejects(() => plan(dirty), (error) => error.kind === 'dirty'); assert.deepEqual(unchanged(dirty.root), dirtyBefore)
  const mismatch = arcFixture(); const mismatchBefore = unchanged(mismatch.root)
  await assert.rejects(() => plan(mismatch, { head: mismatch.base }, delivery(mismatch.base)), (error) => error.kind === 'head-changed'); assert.deepEqual(unchanged(mismatch.root), mismatchBefore)
})

test('foreign, merge, unknown terminal suffix, missing phase, and stale or subset gate evidence refuse byte-intact', async () => {
  const mutations = [
    ['foreign', 'ownership', (f) => { writeFileSync(join(f.root, 'foreign.txt'), 'x\n'); git(f.root, 'add', 'foreign.txt'); git(f.root, 'commit', '-q', '-m', 'feat: foreign work'); f.head = git(f.root, 'rev-parse', 'HEAD') }],
    ['merge', 'merge', (f) => { git(f.root, 'checkout', '-q', '-b', 'side', f.base); writeFileSync(join(f.root, 'side.txt'), 'x\n'); git(f.root, 'add', 'side.txt'); git(f.root, 'commit', '-q', '-m', 'side'); git(f.root, 'checkout', '-q', 'feature/history'); git(f.root, 'merge', '--no-ff', '-m', `fix(history): phase ${f.phases.at(-1)} gate R9 — merge`, 'side'); f.head = git(f.root, 'rev-parse', 'HEAD') }],
    ['unknown-terminal', 'ownership', (f) => { writeFileSync(join(f.root, 'bad.txt'), 'x\n'); git(f.root, 'add', 'bad.txt'); git(f.root, 'commit', '-q', '-m', `feat(history): phase ${f.phases.at(-1)} — deliver phase (${f.phases.at(-1)}.99)`); f.head = git(f.root, 'rev-parse', 'HEAD') }],
    ['substring', 'ownership', (f) => { writeFileSync(join(f.root, 'substring.txt'), 'x\n'); git(f.root, 'add', 'substring.txt'); git(f.root, 'commit', '-q', '-m', `feat(history): deliver phase (x${f.phases.at(-1)}.1y)`); f.head = git(f.root, 'rev-parse', 'HEAD') }],
    ['nonmonotonic', 'ordering', (f) => { writeFileSync(join(f.root, 'nonmonotonic.txt'), 'x\n'); git(f.root, 'add', 'nonmonotonic.txt'); git(f.root, 'commit', '-q', '-m', `fix(history): phase ${f.phases[0]} gate R8 — late old phase`); f.head = git(f.root, 'rev-parse', 'HEAD') }],
    ['missing-phase', 'records', (f) => { rmSync(join(f.root, 'roadmap', 'phases', `phase-${f.phases[2]}.phase.ts`)); git(f.root, 'add', '-A'); git(f.root, 'commit', '-q', '-m', `docs(roadmap): phase ${f.phases[2]} — remove source`); f.head = git(f.root, 'rev-parse', 'HEAD') }],
  ]
  for (const [label, kind, mutate] of mutations) {
    const f = arcFixture(); mutate(f); const before = unchanged(f.root)
    await assert.rejects(() => plan(f, {}, delivery(f.head)), (error) => error.kind === kind, `${label} expected ${kind}`)
    assert.deepEqual(unchanged(f.root), before)
  }
  for (const [kind, reportChange] of [['gate-unproven', { green: false }], ['gate-unproven', { slotFilter: 'types' }], ['gate-unproven', { agents: [] }], ['gate-stale', { stale: true }]]) {
    const f = arcFixture(); const phase = f.phases.at(-1); const dir = join(f.root, 'roadmap', '.gate', String(phase)); const latest = readdirSync(dir).filter((name) => name.endsWith('.json')).sort().at(-1); const path = join(dir, latest)
    const changed = reportChange.stale ? { agents: [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: 'stale', sha: f.base, recordedAt: '2026-09-07T06:01:00.000Z' }] } : reportChange
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), ...changed }, null, 2) + '\n'); const before = unchanged(f.root)
    await assert.rejects(() => plan(f), (error) => error.kind === kind); assert.deepEqual(unchanged(f.root), before)
  }
})

test('terminal review may bind an exact-tree curated replacement, while ordinary reviewed ancestors stay stale', async () => {
  const f = arcFixture()
  const row = f.expected.at(-1); const original = row.commits.at(-1)
  const parent = git(f.root, 'rev-parse', `${original}^`); const tree = git(f.root, 'rev-parse', `${original}^{tree}`)
  git(f.root, 'update-ref', `refs/curate-rescue/${original.slice(0, 12)}`, original)
  const subject = git(f.root, 'show', '-s', '--format=%s', original)
  const replacement = git(f.root, 'commit-tree', tree, '-p', parent, '-m', subject + '\n\ncurated replacement')
  git(f.root, 'update-ref', 'refs/heads/feature/history', replacement, original)
  f.head = replacement; row.commits[row.commits.length - 1] = replacement; row.boundary = replacement
  const before = unchanged(f.root); const out = await plan(f)
  assert.equal(out.groups.at(-1).sourceBoundary.sha, replacement)
  assert.deepEqual(unchanged(f.root), before)
})
