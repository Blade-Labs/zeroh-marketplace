#!/usr/bin/env node
/** Whole-arc normalization planning against typed records, real Git ownership, and gate evidence. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makeFixtureRepo, writeArcFile, writePhaseFile, commitAll, git, runCli } from '../../test/fixture-consumer/harness.mjs'
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

test('history normalization exposes the synchronous apply API', async () => {
  const module = await planner()
  assert.equal(typeof module.applyHistoryNormalization, 'function')
})

const normalizationDir = (root) => join(root, '.building', 'history-normalizations')
const rescueFor = (plan) => `refs/curate-rescue/${plan.expectedHead.slice(0, 12)}`
const applyWithDelivery = (applyHistoryNormalization, fixture, deps = {}) => applyHistoryNormalization(fixture.root, fixture.plan, {
  inspectDelivery: () => delivery(git(fixture.root, 'rev-parse', 'HEAD')),
  ...deps,
})
async function plannedFixture() {
  const fixture = arcFixture()
  writeFileSync(join(fixture.root, 'runtime-untracked.txt'), 'preserve me\n')
  return { ...fixture, plan: await plan(fixture) }
}

function assertApplyResult(result, fixture) {
  assert.equal(result.status, 'applied')
  assert.equal(result.planDigest, fixture.plan.planDigest)
  assert.equal(result.oldHead, fixture.plan.expectedHead)
  assert.equal(result.newHead, git(fixture.root, 'rev-parse', 'HEAD'))
  assert.equal(result.rescueRef, rescueFor(fixture.plan))
  assert.equal(result.receiptPath, join(normalizationDir(fixture.root), `${fixture.plan.planDigest}.receipt.json`))
  assert.equal(git(fixture.root, 'rev-parse', `${result.rescueRef}^{commit}`), result.oldHead)
  assert.equal(git(fixture.root, 'rev-parse', `${result.newHead}^{tree}`), fixture.plan.expectedTree)
  assert.equal(git(fixture.root, 'rev-list', '--count', `${fixture.base}..${result.newHead}`), String(fixture.phases.length))
  assert.deepEqual(result.outcomes.map((row) => row.phase), fixture.phases)
  for (const [index, row] of result.outcomes.entries()) {
    assert.equal(row.sourceCommit, fixture.plan.groups[index].sourceBoundary.sha)
    assert.equal(row.sourceTree, fixture.plan.groups[index].sourceBoundary.tree)
    assert.equal(git(fixture.root, 'rev-parse', `${row.normalizedCommit}^{tree}`), row.sourceTree)
    assert.equal(git(fixture.root, 'rev-parse', `${row.normalizedCommit}^`), index ? result.outcomes[index - 1].normalizedCommit : fixture.base)
  }
  assert.equal(readFileSync(join(fixture.root, 'runtime-untracked.txt'), 'utf8'), 'preserve me\n')
  assert.deepEqual(JSON.parse(readFileSync(result.receiptPath, 'utf8')), { version: 1, planDigest: result.planDigest, arcId: fixture.arcId, base: fixture.base, oldHead: result.oldHead, newHead: result.newHead, tree: fixture.plan.expectedTree, rescueRef: result.rescueRef, outcomes: result.outcomes })
}

test('apply lands one deterministic outcome commit per phase, preserves the original tree, and publishes rescue plus receipt', async () => {
  const fixture = await plannedFixture(); const { applyHistoryNormalization } = await planner()
  const result = applyWithDelivery(applyHistoryNormalization, fixture)
  assertApplyResult(result, fixture)
  const replay = applyWithDelivery(applyHistoryNormalization, fixture)
  assert.equal(replay.status, 'already-applied')
  assert.equal(replay.newHead, result.newHead)
  assert.equal(readdirSync(normalizationDir(fixture.root)).filter((name) => name.endsWith('.receipt.json')).length, 1)
})

test('tampered plans, stale gate bytes, rescue collisions, and a live pre-CAS ref advance refuse without overwriting recoverable history', async () => {
  const { applyHistoryNormalization } = await planner()
  for (const mode of ['plan', 'gate', 'rescue', 'concurrent']) {
    const fixture = await plannedFixture(); const original = fixture.head; const tree = fixture.plan.expectedTree
    let competitor = null
    if (mode === 'plan') fixture.plan.groups[0].sourceBoundary.tree = '0'.repeat(40)
    if (mode === 'gate') writeFileSync(join(fixture.root, fixture.plan.groups[0].gate.path), '{"changed":true}\n')
    if (mode === 'rescue') git(fixture.root, 'update-ref', rescueFor(fixture.plan), fixture.base)
    const deps = mode === 'concurrent' ? { beforeCas() {
      competitor = git(fixture.root, 'commit-tree', tree, '-p', original, '-m', 'concurrent advance')
      git(fixture.root, 'update-ref', 'refs/heads/feature/history', competitor, original)
    } } : {}
    assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture, deps), (error) => typeof error.kind === 'string', mode)
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), competitor ?? original, mode)
    if (mode === 'concurrent') assert.equal(git(fixture.root, 'rev-parse', `${rescueFor(fixture.plan)}^{commit}`), original)
    assert.equal(existsSync(join(normalizationDir(fixture.root), `${fixture.plan.planDigest}.receipt.json`)), false, mode)
    assert.equal(readFileSync(join(fixture.root, 'runtime-untracked.txt'), 'utf8'), 'preserve me\n')
  }
})

test('interruptions retain an exact rescue and deterministically resume before or after the ref CAS without duplicate receipts', async () => {
  const { applyHistoryNormalization } = await planner()
  for (const boundary of ['afterRescue', 'afterPrepare', 'afterCommit', 'afterCas', 'beforeReceipt', 'afterReceipt']) {
    const fixture = await plannedFixture(); let preparedHead = null; let partialOutcome = null
    const deps = { [boundary](value) {
      if (boundary === 'afterCommit') partialOutcome = value.outcomes.at(-1)
      else preparedHead = value.newHead ?? preparedHead
      throw new Error(`interrupt-${boundary}`)
    } }
    assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture, deps), new RegExp(`interrupt-${boundary}`))
    assert.equal(git(fixture.root, 'rev-parse', `${rescueFor(fixture.plan)}^{commit}`), fixture.head)
    const resumed = applyWithDelivery(applyHistoryNormalization, fixture)
    assert.ok(['applied', 'already-applied'].includes(resumed.status), boundary)
    if (preparedHead) assert.equal(resumed.newHead, preparedHead, `${boundary} must reconstruct the same deterministic commits`)
    if (partialOutcome) assert.equal(resumed.outcomes.find((row) => row.phase === partialOutcome.phase).normalizedCommit, partialOutcome.normalizedCommit, 'the interrupted prefix commit is reused exactly')
    assert.equal(git(fixture.root, 'rev-parse', `${resumed.newHead}^{tree}`), fixture.plan.expectedTree)
    assert.equal(readdirSync(normalizationDir(fixture.root)).filter((name) => name.endsWith('.receipt.json')).length, 1)
  }
})

test('an incomplete or conflicting incumbent receipt refuses byte-intact before history movement', async () => {
  const fixture = await plannedFixture(); const { applyHistoryNormalization } = await planner()
  const path = join(normalizationDir(fixture.root), `${fixture.plan.planDigest}.receipt.json`)
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '{"status":"interrupted"}\n')
  const bytes = readFileSync(path); const before = unchanged(fixture.root)
  assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture), (error) => typeof error.kind === 'string')
  assert.deepEqual(readFileSync(path), bytes)
  assert.deepEqual(unchanged(fixture.root), before)
  assert.equal(existsSync(join(fixture.root, '.building', 'history-normalizations', `${fixture.plan.planDigest}.receipt.json`)), true)
})


test('apply refuses untracked registry overlays and tracked record symlinks outside the worktree before creating a rescue', async () => {
  const { applyHistoryNormalization } = await planner()
  for (const mode of ['untracked-overlay', 'external-record']) {
    const fixture = await plannedFixture(); let external = null
    if (mode === 'untracked-overlay') writeFileSync(join(fixture.root, 'roadmap', 'phases', 'phase-4999.phase.ts'), "export default {phase:4999}\n")
    else {
      const phasePath = join(fixture.root, 'roadmap', 'phases', 'phase-4001.phase.ts')
      external = join(dirname(fixture.root), `external-phase-${fixture.plan.planDigest}.ts`)
      writeFileSync(external, readFileSync(phasePath)); rmSync(phasePath); symlinkSync(external, phasePath)
    }
    const before = unchanged(fixture.root)
    assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture), (error) => typeof error.kind === 'string', mode)
    assert.deepEqual(unchanged(fixture.root), before, mode)
    assert.throws(() => git(fixture.root, 'rev-parse', '--verify', rescueFor(fixture.plan)))
    if (external) rmSync(external)
  }
})

test('completed replay tolerates a later descendant without moving it or republishing the receipt', async () => {
  const fixture = await plannedFixture(); const { applyHistoryNormalization } = await planner()
  const applied = applyWithDelivery(applyHistoryNormalization, fixture)
  writeFileSync(join(fixture.root, 'later-after-normalization.txt'), 'later work\n')
  git(fixture.root, 'add', 'later-after-normalization.txt'); git(fixture.root, 'commit', '-q', '-m', 'chore: later descendant')
  const descendant = git(fixture.root, 'rev-parse', 'HEAD'); const receipt = readFileSync(applied.receiptPath)
  const replay = applyWithDelivery(applyHistoryNormalization, fixture)
  assert.equal(replay.status, 'already-applied'); assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), descendant)
  assert.deepEqual(readFileSync(applied.receiptPath), receipt)
})

test('publication appearing before CAS and descendants of an unreceipted normalized head refuse without overwriting either head', async () => {
  const { applyHistoryNormalization } = await planner()
  {
    const fixture = await plannedFixture(); let published = false
    const deps = {
      inspectDelivery: () => delivery(git(fixture.root, 'rev-parse', 'HEAD'), { publicationRefs: published ? ['refs/remotes/origin/develop'] : [] }),
      beforeCas() { git(fixture.root, 'update-ref', 'refs/remotes/origin/develop', fixture.head); published = true },
    }
    assert.throws(() => applyHistoryNormalization(fixture.root, fixture.plan, deps), (error) => error.kind === 'published')
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), fixture.head)
    assert.equal(git(fixture.root, 'rev-parse', `${rescueFor(fixture.plan)}^{commit}`), fixture.head)
  }
  {
    const fixture = await plannedFixture()
    assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture, { afterCas() { throw new Error('crash-after-cas') } }), /crash-after-cas/)
    const normalized = git(fixture.root, 'rev-parse', 'HEAD')
    writeFileSync(join(fixture.root, 'unreceipted-descendant.txt'), 'later\n'); git(fixture.root, 'add', 'unreceipted-descendant.txt'); git(fixture.root, 'commit', '-q', '-m', 'chore: descendant before receipt')
    const descendant = git(fixture.root, 'rev-parse', 'HEAD')
    assert.notEqual(descendant, normalized)
    assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture), (error) => typeof error.kind === 'string')
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), descendant)
    assert.equal(existsSync(join(normalizationDir(fixture.root), `${fixture.plan.planDigest}.receipt.json`)), false)
  }
})


test('recomputed plan digests cannot admit nested unknown fields or missing required bindings', async () => {
  const { applyHistoryNormalization } = await planner()
  for (const mode of ['unknown', 'missing']) {
    const fixture = await plannedFixture()
    if (mode === 'unknown') fixture.plan.groups[0].sourceBoundary.unrecognized = true
    else delete fixture.plan.groups[0].sourceBoundary.tree
    const { planDigest: _old, ...body } = fixture.plan
    fixture.plan.planDigest = createHash('sha256').update(JSON.stringify(body) + '\n').digest('hex')
    const before = unchanged(fixture.root)
    assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture), (error) => typeof error.kind === 'string', mode)
    assert.deepEqual(unchanged(fixture.root), before)
    assert.throws(() => git(fixture.root, 'rev-parse', '--verify', rescueFor(fixture.plan)))
  }
})

test('post-CAS recovery tolerates an unrelated integration branch advance and publishes the original normalization once', async () => {
  const fixture = await plannedFixture(); const { applyHistoryNormalization } = await planner(); let normalized = null
  assert.throws(() => applyWithDelivery(applyHistoryNormalization, fixture, { afterCas(prepared) {
    normalized = prepared.newHead
    const unrelated = git(fixture.root, 'commit-tree', git(fixture.root, 'rev-parse', `${fixture.base}^{tree}`), '-p', fixture.base, '-m', 'unrelated integration advance')
    git(fixture.root, 'update-ref', 'refs/heads/develop', unrelated, fixture.base)
    throw new Error('crash-after-cas-with-unrelated-integration')
  } }), /crash-after-cas-with-unrelated-integration/)
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), normalized)
  const resumed = applyWithDelivery(applyHistoryNormalization, fixture)
  assert.equal(resumed.status, 'applied'); assert.equal(resumed.newHead, normalized)
  assert.equal(readdirSync(normalizationDir(fixture.root)).filter((name) => name.endsWith('.receipt.json')).length, 1)
})

const arcCommand = async () => import('../commands/arc.mjs')
test('arc command exports the normalize orchestration API', async () => {
  assert.equal(typeof (await arcCommand()).normalizeArc, 'function')
})

test('first publication dry-run is mutation-free; apply records its exact plan and restart reuses it without new commits', async () => {
  const fixture = arcFixture(); const { normalizeArc } = await arcCommand(); const calls = []
  const deps = {
    inspectDelivery: ({ head }) => { calls.push(['inspect', head]); return delivery(head) },
    replacePublishedHead: (input) => { calls.push(['replace', input]); throw new Error('unpublished normalization must not push') },
  }
  const beforeHead = fixture.head; const beforeTree = git(fixture.root, 'rev-parse', 'HEAD^{tree}'); const beforeDry = unchanged(fixture.root)
  const dry = normalizeArc(fixture.root, fixture.arcId, {}, deps)
  assert.equal(dry.status, 'planned'); assert.match(dry.planDigest, /^[a-f0-9]{64}$/)
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), beforeHead); assert.deepEqual(unchanged(fixture.root), beforeDry)
  assert.equal(existsSync(join(normalizationDir(fixture.root), `${dry.planDigest}.plan.json`)), false)

  const applied = normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps)
  assert.equal(applied.status, 'applied'); assert.equal(applied.planDigest, dry.planDigest)
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^{tree}'), beforeTree)
  assert.equal(git(fixture.root, 'rev-list', '--count', `${fixture.base}..HEAD`), String(fixture.phases.length))
  const planPath = join(normalizationDir(fixture.root), `${dry.planDigest}.plan.json`)
  assert.ok(existsSync(planPath)); assert.equal(JSON.parse(readFileSync(planPath, 'utf8')).planDigest, dry.planDigest)
  const normalizedHead = git(fixture.root, 'rev-parse', 'HEAD'); const commits = git(fixture.root, 'rev-list', `${fixture.base}..HEAD`)

  const restarted = normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps)
  assert.equal(restarted.status, 'already-applied'); assert.equal(restarted.planDigest, dry.planDigest)
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), normalizedHead)
  assert.equal(git(fixture.root, 'rev-list', `${fixture.base}..HEAD`), commits)
  assert.equal(calls.filter(([kind]) => kind === 'replace').length, 0)
})

function latestGatePath(root, phase) {
  const dir = join(root, 'roadmap', '.gate', String(phase))
  return join(dir, readdirSync(dir).filter((name) => name.endsWith('.json')).sort().at(-1))
}
function appendReviewedCorrection(fixture, round, phase = fixture.phases.at(-1)) { const path = join(fixture.root, 'src', `published-correction-${round}.txt`)
  writeFileSync(path, `correction ${round}\n`); git(fixture.root, 'add', path)
  git(fixture.root, 'commit', '-q', '-m', `fix(history): phase ${phase} gate R${round} — published correction`)
  const head = git(fixture.root, 'rev-parse', 'HEAD'); const gatePath = latestGatePath(fixture.root, phase)
  const report = JSON.parse(readFileSync(gatePath, 'utf8'))
  report.agents = [{ round: 1, agent: 'code-reviewer', verdict: 'clean', summary: `correction ${round} reviewed`, sha: head, recordedAt: '2026-09-07T07:00:00.000Z' }]
  writeFileSync(gatePath, JSON.stringify(report, null, 2) + '\n')
  return head
}
function publishedDelivery(root, localHead, publishedHead, overrides = {}) {
  const ref = 'refs/remotes/origin/feature/history'; git(root, 'update-ref', ref, publishedHead)
  return { head: localHead, publication: 'published', pullRequest: { head: publishedHead, ref }, green: false, checks: { head: publishedHead, state: 'red' }, correction: { classification: 'causal', pushRequired: true }, publicationRefs: [ref], ...overrides }
}

test('one or two reviewed tree-changing corrections stay as useful published commits without rewrite or push', async () => {
  const fixture = arcFixture(); const { normalizeArc } = await arcCommand(); const firstDeps = { inspectDelivery: ({ head }) => delivery(head) }
  assert.equal(normalizeArc(fixture.root, fixture.arcId, { apply: true }, firstDeps).status, 'applied')
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); const pushes = []
  for (const count of [1, 2]) {
    const head = appendReviewedCorrection(fixture, count, fixture.phases.at(-3 + count)); const observed = publishedDelivery(fixture.root, head, publishedHead)
    const result = normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: () => observed, replacePublishedHead: (call) => { pushes.push(call); throw new Error('retained corrections never push') } })
    assert.equal(result.status, 'retained-corrections'); assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head)
  }
  assert.equal(pushes.length, 0)
})

test('the third reviewed red-CI correction plans then applies one fresh-rescue force-with-lease replacement', async () => {
  const fixture = arcFixture(); const { normalizeArc } = await arcCommand()
  assert.equal(normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) }).status, 'applied')
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); let observed
  for (const count of [1, 2, 3]) observed = publishedDelivery(fixture.root, appendReviewedCorrection(fixture, count, fixture.phases.at(-4 + count)), publishedHead)
  const oldHead = observed.pullRequest.head; const dryHead = git(fixture.root, 'rev-parse', 'HEAD'); const beforeDry = unchanged(fixture.root); const calls = []
  const deps = { inspectDelivery: () => ({ ...observed, head: git(fixture.root, 'rev-parse', 'HEAD') }), replacePublishedHead(call) { calls.push(call); git(fixture.root, 'update-ref', call.ref, call.newHead, call.expectedOld); return { ref: call.ref, head: call.newHead } } }
  const dry = normalizeArc(fixture.root, fixture.arcId, {}, deps)
  assert.equal(dry.status, 'published-rewrite-planned'); assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), dryHead); assert.deepEqual(unchanged(fixture.root), beforeDry); assert.equal(calls.length, 0)
  const applied = normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps)
  assert.equal(applied.status, 'published-rewrite-applied'); assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { ref: observed.pullRequest.ref, expectedOld: oldHead, newHead: git(fixture.root, 'rev-parse', 'HEAD'), arcId: fixture.arcId, planDigest: applied.planDigest })
  assert.equal(git(fixture.root, 'rev-list', '--count', `${fixture.base}..HEAD`), '7')
  const landedMessage = git(fixture.root, 'show', '-s', '--format=%s%n%n%b', 'HEAD')
  assert.doesNotMatch(landedMessage.split('\n')[0], /phase 400[456]/, 'the shared correction tail is neutral, not attributed to its last phase')
  for (const phase of fixture.phases.slice(-3)) assert.match(landedMessage, new RegExp(String(phase)), `tail body accounts for phase ${phase}`)
  assert.equal(git(fixture.root, 'rev-parse', `${rescueFor({ expectedHead: observed.head })}^{commit}`), observed.head)
})

test('green, unclassified, or non-push-required published correction evidence refuses without rewriting or pushing', async () => {
  const cases = [
    { green: true, checks: { head: null, state: 'green' } },
    { correction: null },
    { correction: { classification: 'causal', pushRequired: false } },
  ]
  for (const change of cases) {
    const fixture = arcFixture(); const { normalizeArc } = await arcCommand()
    normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) })
    const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); const head = appendReviewedCorrection(fixture, 1)
    const overrides = change.green ? { ...change, checks: { head: publishedHead, state: 'green' } } : change
    const observed = publishedDelivery(fixture.root, head, publishedHead, overrides); let pushes = 0
    assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: () => observed, replacePublishedHead() { pushes++ } }), (error) => typeof error.kind === 'string')
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head); assert.equal(pushes, 0)
  }
})


test('a failed force-with-lease resumes the exact published correction plan and never pushes twice after replacement', async () => {
  const fixture = arcFixture(); const { normalizeArc } = await arcCommand()
  normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) })
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); let observed
  for (const count of [1, 2, 3]) observed = publishedDelivery(fixture.root, appendReviewedCorrection(fixture, count, fixture.phases.at(-4 + count)), publishedHead)
  let attempts = 0
  const inspectDelivery = () => ({ ...observed, head: git(fixture.root, 'rev-parse', 'HEAD') })
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery, replacePublishedHead() { attempts++; throw new Error('lease unavailable') } }), /lease unavailable/)
  const preparedHead = git(fixture.root, 'rev-parse', 'HEAD'); assert.equal(attempts, 1)
  const recovered = normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery, replacePublishedHead(call) { attempts++; git(fixture.root, 'update-ref', call.ref, call.newHead, call.expectedOld); return { ref: call.ref, head: call.newHead } } })
  assert.equal(recovered.status, 'published-rewrite-applied'); assert.equal(recovered.newHead, preparedHead); assert.equal(attempts, 2)
  const settledObservation = { ...observed, head: preparedHead, pullRequest: { ...observed.pullRequest, head: preparedHead }, checks: { head: preparedHead, state: 'red' } }
  const settled = normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: () => settledObservation, replacePublishedHead() { attempts++ } })
  assert.equal(settled.status, 'already-applied'); assert.equal(attempts, 2)
})

test('malformed or orphaned stored normalization plans refuse, and CLI has no publication authority fallback', async () => {
  const { normalizeArc } = await arcCommand()
  for (const mode of ['malformed-plan', 'orphan-receipt']) {
    const fixture = arcFixture(); normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) })
    const dir = normalizationDir(fixture.root); const digest = mode === 'malformed-plan' ? 'a'.repeat(64) : 'b'.repeat(64)
    writeFileSync(join(dir, `${digest}.${mode === 'malformed-plan' ? 'plan' : 'receipt'}.json`), '{}\n')
    const before = unchanged(fixture.root)
    assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) }), (error) => error.kind === 'recovery')
    assert.deepEqual(unchanged(fixture.root), before)
  }
  const fixture = arcFixture(); const before = unchanged(fixture.root)
  const unavailable = runCli(fixture.root, ['arc', 'normalize', fixture.arcId, '--apply', '--json'])
  assert.equal(unavailable.code, 2); assert.match(unavailable.stderr, /delivery|provider|unavailable/i); assert.deepEqual(unchanged(fixture.root), before)
})


test('checks turning green after the correction receipt refuse the push while retaining exact recovery evidence', async () => {
  const fixture = arcFixture(); const { normalizeArc } = await arcCommand()
  normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) })
  const publishedHead = git(fixture.root, 'rev-parse', 'HEAD'); let observed
  for (const count of [1, 2, 3]) observed = publishedDelivery(fixture.root, appendReviewedCorrection(fixture, count, fixture.phases.at(-4 + count)), publishedHead)
  const correctionHead = observed.head; let green = false; let pushes = 0
  const deps = {
    inspectDelivery: () => ({ ...observed, head: git(fixture.root, 'rev-parse', 'HEAD'), green, checks: { head: publishedHead, state: green ? 'green' : 'red' } }),
    afterReceipt() { green = true },
    replacePublishedHead() { pushes++ },
  }
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps), (error) => typeof error.kind === 'string')
  const normalizedHead = git(fixture.root, 'rev-parse', 'HEAD')
  assert.notEqual(normalizedHead, correctionHead); assert.equal(pushes, 0)
  assert.equal(git(fixture.root, 'rev-parse', `${rescueFor({ expectedHead: correctionHead })}^{commit}`), correctionHead)
  assert.equal(readdirSync(normalizationDir(fixture.root)).filter((name) => name.endsWith('.receipt.json')).length, 2, 'original and correction receipts remain durable')
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, deps), (error) => typeof error.kind === 'string')
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), normalizedHead); assert.equal(pushes, 0)
})

test('arc normalization refuses an unpublished descendant of its completed first-publication receipt', async () => {
  const fixture = arcFixture(); const { normalizeArc } = await arcCommand(); let pushes = 0
  normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: ({ head }) => delivery(head) })
  writeFileSync(join(fixture.root, 'unpublished-descendant.txt'), 'new unreviewed work\n')
  git(fixture.root, 'add', 'unpublished-descendant.txt'); git(fixture.root, 'commit', '-q', '-m', 'feat: unpublished descendant')
  const head = git(fixture.root, 'rev-parse', 'HEAD'); const before = unchanged(fixture.root)
  assert.throws(() => normalizeArc(fixture.root, fixture.arcId, { apply: true }, { inspectDelivery: () => delivery(head), replacePublishedHead() { pushes++ } }), (error) => error.kind === 'head-changed')
  assert.deepEqual(unchanged(fixture.root), before); assert.equal(pushes, 0)
  assert.equal(readdirSync(normalizationDir(fixture.root)).filter((name) => name.endsWith('.receipt.json')).length, 1)
})
