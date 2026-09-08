import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  closeSync, ftruncateSync, mkdtempSync, mkdirSync, openSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  GAUNTLET_3_CONTRACT,
  SCENARIOS,
  freezeGauntletContract,
  validateGauntletContract,
} from './scenarios.mjs'
import { preflightGauntlet } from './preflight.mjs'
import {
  FIXTURE_SCAN_LIMITS,
  assertFixtureIsolation,
  buildGauntletFixture,
} from './fixtures.mjs'

const SHA = 'a'.repeat(40)
const NOW = '2026-09-11T12:00:00.000Z'
const BUDGET = Object.freeze({
  totalNativeMs: 3_600_000,
  totalTokens: 600_000,
  perArmTimeoutMs: 300_000,
  maxConcurrentArms: 3,
})
const AUTHORITY = Object.freeze({
  authorityRef: 'authority://nativegreen/gauntlet-3',
  repositoryNamespace: 'gauntlet-3-test/repository',
  providerNamespace: 'gauntlet-3-test/provider',
  allowedOperations: ['create-repository', 'push', 'pull-request', 'read-ci'],
  expiresAt: '2026-09-12T12:00:00.000Z',
})
const REQUIRED_LIFECYCLE = [
  'blocked', 'stalled', 'unobserved', 'exited', 'review-exhausted',
  'validation-small-repair', 'validation-planned-correction', 'causal',
  'owned-preexisting', 'unrelated', 'infrastructure', 'flaky', 'indeterminate',
  'auth', 'quota', 'timeout', 'repeated-input', 'history-normalization',
  'worktree-gc', 'exact-head-green', 'evaluation', 'second-resume',
]

function clone(value) { return structuredClone(value) }
function validLaunchable() {
  const template = clone(GAUNTLET_3_CONTRACT)
  for (const condition of template.conditions) {
    condition.parent.modelId = condition.parent.driverId === 'claude'
      ? 'claude-opus-4-1'
      : 'gpt-5.6-sol'
    condition.child.modelId = condition.child.driverId === 'claude'
      ? 'claude-opus-4-1'
      : 'gpt-5.6-sol'
  }
  return clone(freezeGauntletContract(template, {
    budget: BUDGET,
    externalActionAuthority: AUTHORITY,
    fixtureSha: SHA,
  }))
}
function assertInvalid(mutator, pattern = /invalid|contract|required|mismatch|missing/i) {
  const value = validLaunchable()
  mutator(value)
  assert.throws(() => validateGauntletContract(value, { requireLaunchable: true }), pattern)
}

test('template declares four parent/child combinations as symmetric plugin and baseline conditions', () => {
  assert.equal(GAUNTLET_3_CONTRACT.schemaVersion, 3)
  assert.equal(GAUNTLET_3_CONTRACT.contractId, 'gauntlet-3.0')
  assert.equal(GAUNTLET_3_CONTRACT.conditions.length, 8)
  assert.equal(Object.isFrozen(GAUNTLET_3_CONTRACT), true)

  const combinations = ['claude:claude', 'claude:codex', 'codex:codex', 'codex:claude']
  for (const combination of combinations) {
    const [parentDriver, childDriver] = combination.split(':')
    const pair = GAUNTLET_3_CONTRACT.conditions.filter(c =>
      c.parent.driverId === parentDriver && c.child.driverId === childDriver)
    assert.equal(pair.length, 2)
    const plugin = pair.find(c => c.pluginEnabled === true)
    const baseline = pair.find(c => c.pluginEnabled === false)
    assert.ok(plugin)
    assert.ok(baseline)
    assert.equal(plugin.matchedConditionId, baseline.id)
    assert.equal(baseline.matchedConditionId, plugin.id)
    assert.equal(plugin.parent.modelId, null)
    assert.equal(plugin.child.modelId, null)
    assert.equal(baseline.parent.modelId, null)
    assert.equal(baseline.child.modelId, null)
  }

  assert.equal(GAUNTLET_3_CONTRACT.fixture.baseSha, null)
  assert.ok(GAUNTLET_3_CONTRACT.fixture.sealedPacketIds.length > 0)
  assert.deepEqual(GAUNTLET_3_CONTRACT.limits, {
    laneCount: 20, gcIdentityCount: 50, historyPhaseCount: 6, maxConcurrentArcs: 3,
  })
  assert.equal(GAUNTLET_3_CONTRACT.budget, null)
  assert.equal(GAUNTLET_3_CONTRACT.externalActionAuthority, null)
})

test('three scenarios cover independent, stacked, and grouped strategy invariants and all lifecycle criteria', () => {
  assert.equal(SCENARIOS.length, 3)
  assert.deepEqual(SCENARIOS.map(s => s.branchStrategy).sort(), ['grouped', 'independent', 'stacked'])
  for (const scenario of SCENARIOS) {
    assert.equal(scenario.arcIds.length, 3)
    assert.equal(new Set(scenario.arcIds).size, 3)
    assert.ok(scenario.fixtureKey)
    assert.equal(scenario.fixtureSha, null)
    assert.ok(scenario.expectedDisposition)
    assert.ok(Array.isArray(scenario.interruptionPoints))
  }
  assert.deepEqual(
    [...new Set(SCENARIOS.flatMap(s => s.criteria))].sort(),
    [...new Set(REQUIRED_LIFECYCLE)].sort(),
  )
  assert.deepEqual(
    [...new Set(GAUNTLET_3_CONTRACT.requiredCriteria)].sort(),
    [...new Set(REQUIRED_LIFECYCLE)].sort(),
  )
  assert.equal(GAUNTLET_3_CONTRACT.limits.laneCount, 20)
  assert.equal(GAUNTLET_3_CONTRACT.limits.gcIdentityCount, 50)
  assert.equal(GAUNTLET_3_CONTRACT.limits.historyPhaseCount, 6)
  assert.equal(GAUNTLET_3_CONTRACT.limits.maxConcurrentArcs, 3)
})

test('authoring validation accepts null launch fields; launch validation requires exact matched requested model IDs', () => {
  const authored = validateGauntletContract(GAUNTLET_3_CONTRACT)
  assert.notEqual(authored, GAUNTLET_3_CONTRACT)
  assert.deepEqual(authored, GAUNTLET_3_CONTRACT)
  assert.equal(Object.isFrozen(authored), true)
  assert.throws(
    () => validateGauntletContract(GAUNTLET_3_CONTRACT, { requireLaunchable: true }),
    /budget|authority|sha|model|launch/i,
  )

  const launchable = validLaunchable()
  const validated = validateGauntletContract(launchable, { requireLaunchable: true })
  assert.equal(Object.isFrozen(validated), true)
  for (const condition of validated.conditions) {
    const mate = validated.conditions.find(c => c.id === condition.matchedConditionId)
    assert.ok(mate)
    assert.equal(condition.parent.modelId, mate.parent.modelId)
    assert.equal(condition.child.modelId, mate.child.modelId)
    assert.ok(condition.parent.modelId)
    assert.ok(condition.child.modelId)
  }

  assertInvalid(v => { v.conditions[0].parent.modelId = null }, /model/i)
  assertInvalid(v => { v.conditions[0].child.modelId = null }, /model/i)
  assertInvalid(v => {
    const mate = v.conditions.find(c => c.id === v.conditions[0].matchedConditionId)
    mate.child.modelId = 'different-model'
  }, /model|match/i)
  assertInvalid(v => { delete v.conditions[0].parent.modelId }, /model/i)
})

test('freeze fills launch fields exactly once, clones inputs, and deeply freezes the result', () => {
  const template = clone(GAUNTLET_3_CONTRACT)
  for (const condition of template.conditions) {
    condition.parent.modelId = condition.parent.driverId === 'claude' ? 'claude-opus-4-1' : 'gpt-5.6-sol'
    condition.child.modelId = condition.child.driverId === 'claude' ? 'claude-opus-4-1' : 'gpt-5.6-sol'
  }
  const before = clone(template)
  const budget = clone(BUDGET)
  const authority = clone(AUTHORITY)
  const frozen = freezeGauntletContract(template, {
    budget, externalActionAuthority: authority, fixtureSha: SHA,
  })
  assert.deepEqual(template, before)
  budget.totalTokens = 1
  authority.allowedOperations.push('delete-repository')
  assert.deepEqual(frozen.budget, BUDGET)
  assert.deepEqual(frozen.externalActionAuthority, AUTHORITY)
  assert.equal(frozen.fixture.baseSha, SHA)
  assert.equal(Object.isFrozen(frozen), true)
  assert.equal(Object.isFrozen(frozen.conditions), true)
  assert.equal(Object.isFrozen(frozen.conditions[0]), true)
  assert.equal(Object.isFrozen(frozen.externalActionAuthority.allowedOperations), true)
  assert.throws(() => freezeGauntletContract(frozen, {
    budget: BUDGET, externalActionAuthority: AUTHORITY, fixtureSha: SHA,
  }), /already|frozen|once|non-null/i)
})

test('budget and external authority are explicit, positive, bounded, and default-free', () => {
  for (const field of Object.keys(BUDGET)) {
    assertInvalid(v => { v.budget[field] = 0 }, new RegExp(field, 'i'))
    assertInvalid(v => { delete v.budget[field] }, new RegExp(field, 'i'))
  }
  assertInvalid(v => { v.budget.maxConcurrentArms = 21 }, /concurrent|lane|limit|20/i)
  assertInvalid(v => { v.budget.perArmTimeoutMs = v.budget.totalNativeMs + 1 }, /timeout|total|budget/i)
  for (const field of Object.keys(AUTHORITY)) {
    assertInvalid(v => { delete v.externalActionAuthority[field] }, new RegExp(field, 'i'))
  }
  assertInvalid(v => { v.externalActionAuthority.allowedOperations = [] }, /operations|authority/i)
  assertInvalid(v => { v.externalActionAuthority.allowedOperations.push('delete-repository') }, /operations|authority/i)
  assertInvalid(v => { v.externalActionAuthority.expiresAt = 'tomorrow' }, /expires|ISO|timestamp/i)
})

test('contract mutation guards reject omitted baselines and incomplete required judgment coverage', () => {
  assertInvalid(v => { v.conditions = v.conditions.filter(c => c.pluginEnabled === true) }, /baseline|pair|condition/i)
  assertInvalid(v => { v.requiredCriteria = v.requiredCriteria.filter(c => c !== 'evaluation') }, /evaluation|criteria|judg/i)
  assertInvalid(v => {
    v.requiredCriteria = v.requiredCriteria.filter(c => c !== 'exact-head-green')
    for (const scenario of SCENARIOS) assert.ok(Array.isArray(scenario.criteria))
  }, /criteria|exact-head|judg/i)
})

function preflightObservations(contract) {
  const requestedByDriver = driverId => [...new Set(contract.conditions.flatMap(condition => [
    condition.parent, condition.child,
  ]).filter(agent => agent.driverId === driverId).map(agent => agent.modelId))].sort()
  return {
    binary: ['claude', 'codex'].map(driverId => ({
      driverId,
      realpath: '/opt/gauntlet/bin/' + driverId,
      version: driverId + '-fixture-1.0',
      requestedModelIds: requestedByDriver(driverId),
      modelCapability: 'declared',
    })),
    plugin: {
      manifestPath: '/opt/gauntlet/plugins/zeroh-roadmap/.codex-plugin/plugin.json',
      manifestHash: 'd'.repeat(64),
      installedRoot: '/opt/gauntlet/plugins/zeroh-roadmap',
      installedHash: 'd'.repeat(64),
      status: 'matched',
    },
    namespace: contract.scenarios.flatMap((scenario, scenarioIndex) =>
      contract.conditions.map((condition, conditionIndex) => {
        const index = scenarioIndex * contract.conditions.length + conditionIndex
        return {
          armId: scenario.id + ':' + condition.id,
          repository: {
            id: 'repository-' + index,
            canonicalRoot: '/tmp/gauntlet-3-preflight/repository-' + index,
            gitDir: '/tmp/gauntlet-3-preflight/git-' + index,
            remoteIdentity: AUTHORITY.repositoryNamespace + '/repository-' + index,
            isProduct: false,
          },
          provider: {
            id: AUTHORITY.providerNamespace + '/provider-' + index,
            accountId: 'test-account-' + index,
            credentialStatus: 'ready',
            capabilities: [...AUTHORITY.allowedOperations],
          },
          isolated: true,
        }
      })),
  }
}

test('preflight requires exact read-only driver, plugin, and 24-arm namespace observations', async () => {
  const calls = []
  const contract = validLaunchable()
  const observations = preflightObservations(contract)
  const result = await preflightGauntlet({ contract }, {
    probeBinary: async input => { calls.push(['binary', clone(input)]); return clone(observations.binary) },
    probePlugin: async input => { calls.push(['plugin', clone(input)]); return clone(observations.plugin) },
    probeNamespace: async input => { calls.push(['namespace', clone(input)]); return clone(observations.namespace) },
    clock: () => NOW,
  })
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(calls.map(c => c[0]).sort(), ['binary', 'namespace', 'plugin'])
  for (const [, input] of calls) assert.deepEqual(input, { contract })
  assert.deepEqual(result.observed, {
    at: NOW,
    contractId: 'gauntlet-3.0',
    binaries: observations.binary,
    plugin: observations.plugin,
    namespaces: observations.namespace,
    budget: contract.budget,
    authority: contract.externalActionAuthority,
  })
  assert.equal(result.observed.namespaces.length, 24)
  for (const forbidden of ['receipt', 'nativeSessionId', 'modelIdentity', 'judgment', 'score', 'outcome']) {
    assert.equal(forbidden in result, false)
    assert.equal(forbidden in result.observed, false)
  }
})

test('preflight reports missing prerequisites unavailable, contradictions refused, and expiry before probes', async () => {
  const run = async (observations, contract = validLaunchable()) => preflightGauntlet({ contract }, {
    probeBinary: observations.binary === undefined ? undefined : async () => observations.binary,
    probePlugin: observations.plugin === undefined ? undefined : async () => observations.plugin,
    probeNamespace: observations.namespace === undefined ? undefined : async () => observations.namespace,
    clock: () => NOW,
  })
  const complete = preflightObservations(validLaunchable())
  for (const missing of ['binary', 'plugin', 'namespace']) {
    const observations = clone(complete)
    delete observations[missing]
    const unavailable = await run(observations)
    assert.equal(unavailable.status, 'unavailable', missing)
    assert.ok(unavailable.reasons.every(reason =>
      typeof reason.code === 'string' && typeof reason.message === 'string'))
    assert.match(JSON.stringify(unavailable.reasons), new RegExp(missing, 'i'))
  }

  const contradictionCases = [
    ['wrong requested model', observations => { observations.binary[0].requestedModelIds = ['wrong-model'] }],
    ['changed installed bytes', observations => { observations.plugin.installedHash = 'e'.repeat(64) }],
    ['plugin mismatch', observations => { observations.plugin.status = 'mismatch' }],
    ['duplicate arm identity', observations => { observations.namespace[1].armId = observations.namespace[0].armId }],
    ['product repository', observations => { observations.namespace[0].repository.isProduct = true }],
    ['denied credentials', observations => { observations.namespace[0].provider.credentialStatus = 'denied' }],
    ['non-isolated namespace', observations => { observations.namespace[0].isolated = false }],
  ]
  const contradictionResults = []
  for (const [label, mutate] of contradictionCases) {
    const observations = clone(complete)
    mutate(observations)
    const result = await run(observations)
    contradictionResults.push([label, result.status])
    assert.ok(result.reasons.every(reason =>
      typeof reason.code === 'string' && typeof reason.message === 'string'))
  }
  assert.deepEqual(contradictionResults, contradictionCases.map(([label]) => [label, 'refused']))

  let calls = 0
  const expired = validLaunchable()
  expired.externalActionAuthority.expiresAt = '2026-09-10T00:00:00.000Z'
  const refused = await preflightGauntlet({ contract: expired }, {
    probeBinary: async () => { calls++; return complete.binary },
    probePlugin: async () => { calls++; return complete.plugin },
    probeNamespace: async () => { calls++; return complete.namespace },
    clock: () => NOW,
  })
  assert.equal(refused.status, 'refused')
  assert.match(JSON.stringify(refused.reasons), /authority|expired/i)
  assert.equal(calls, 0)
})

test('fixture builder allocates canonical isolated roots, gitdirs, namespaces, shared SHA, and sealed packet exclusion', async t => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gauntlet-3-real-git-')))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const source = join(scratch, 'source')
  mkdirSync(source)
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
  git(source, 'init', '-q')
  git(source, 'config', 'user.email', 'gauntlet@example.invalid')
  git(source, 'config', 'user.name', 'Gauntlet Fixture')
  writeFileSync(join(source, 'README.md'), 'deterministic gauntlet seed\n')
  writeFileSync(join(source, 'estate.json'), JSON.stringify({
    arcs: ['arc-independent', 'arc-stacked', 'arc-grouped'],
    historyPhases: 6,
    laneIds: Array.from({ length: 20 }, (_, index) => 'lane-' + (index + 1)),
    gcManifests: Array.from({ length: 50 }, (_, index) => 'gc-' + (index + 1)),
  }))
  git(source, 'add', 'README.md', 'estate.json')
  git(source, 'commit', '-qm', 'fixture')
  const sha = git(source, 'rev-parse', 'HEAD')
  const template = clone(GAUNTLET_3_CONTRACT)
  for (const condition of template.conditions) {
    condition.parent.modelId = condition.parent.driverId === 'claude' ? 'claude-opus-4-1' : 'gpt-5.6-sol'
    condition.child.modelId = condition.child.driverId === 'claude' ? 'claude-opus-4-1' : 'gpt-5.6-sol'
  }
  const contract = freezeGauntletContract(template, {
    budget: BUDGET, externalActionAuthority: AUTHORITY, fixtureSha: sha,
  })
  const packetRoot = join(scratch, 'run-packets')
  const sealedRoot = join(scratch, 'evaluator-sealed')
  mkdirSync(sealedRoot)
  for (const id of contract.fixture.sealedPacketIds) {
    writeFileSync(join(sealedRoot, id), 'evaluator-secret-bytes-for-' + id)
  }
  for (const scenario of contract.scenarios) assert.equal(scenario.fixtureSha, sha)
  const fixtures = []
  for (const condition of contract.conditions) {
    const target = join(scratch, 'lanes', condition.id)
    const fixture = await buildGauntletFixture({
      contract,
      scenario: contract.scenarios[0],
      condition,
      root: target,
    }, {
      cloneFixture: async ({ root }) => {
        mkdirSync(join(scratch, 'lanes'), { recursive: true })
        execFileSync('git', ['clone', '-q', '--no-local', source, root])
        return { root, gitDir: git(root, 'rev-parse', '--absolute-git-dir'), headSha: git(root, 'rev-parse', 'HEAD') }
      },
      writeRunPacket: async ({ condition, scenario, seedSha, sealedPacketIds }) => {
        mkdirSync(packetRoot, { recursive: true })
        const path = join(packetRoot, condition.id + '.json')
        writeFileSync(path, JSON.stringify({
          conditionId: condition.id,
          scenarioId: scenario.id,
          seedSha,
          sealedPacketIds,
        }))
        return { path }
      },
      git: async (root, args) => git(root, ...args),
    })
    fixtures.push(fixture)
  }
  const result = await assertFixtureIsolation(fixtures, {
    git: async (root, args) => git(root, ...args),
    readPrompt: async fixture => readFileSync(fixture.runPacket.path, 'utf8'),
    readNamespace: async fixture => fixture.providerNamespace,
    readSealedPackets: async () => contract.fixture.sealedPacketIds.map(id => ({
      id,
      path: realpathSync(join(sealedRoot, id)),
      bytes: readFileSync(join(sealedRoot, id)),
    })),
  })
  assert.equal(result, true)
  assert.equal(new Set(fixtures.map(f => realpathSync(f.root))).size, fixtures.length)
  assert.equal(new Set(fixtures.map(f => realpathSync(f.gitDir))).size, fixtures.length)
  assert.equal(new Set(fixtures.map(f => f.providerNamespace)).size, fixtures.length)
  assert.deepEqual(new Set(fixtures.map(f => f.headSha)), new Set([sha]))
  for (const fixture of fixtures) {
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), sha)
    assert.equal(git(fixture.root, 'rev-parse', 'HEAD^{tree}'), git(source, 'rev-parse', 'HEAD^{tree}'))
    assert.equal(git(fixture.root, 'status', '--porcelain'), '')
    assert.equal(realpathSync(fixture.runPacket.path).startsWith(realpathSync(fixture.root) + '/'), false)
    const packet = JSON.parse(readFileSync(fixture.runPacket.path, 'utf8'))
    assert.deepEqual(packet.sealedPacketIds, contract.fixture.sealedPacketIds)
  }
})

test('fixture isolation mutations for shared trees, changed SHA, and sealed byte leakage cannot pass', async t => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'gauntlet-3-isolation-mutations-')))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const roots = [join(scratch, 'arms', 'one'), join(scratch, 'arms', 'two')]
  const controlRoot = join(scratch, 'control')
  mkdirSync(controlRoot, { recursive: true })
  const packets = [join(controlRoot, 'one.json'), join(controlRoot, 'two.json')]
  for (const root of roots) mkdirSync(join(root, '.git'), { recursive: true })
  for (const packet of packets) writeFileSync(packet, '{"sealedPacketIds":["packet-secret"]}')
  const sealedRoot = join(scratch, 'evaluator-only')
  mkdirSync(sealedRoot)
  const sealedPath = join(sealedRoot, 'packet-secret')
  writeFileSync(sealedPath, 'EVALUATOR-OWNED-SECRET-BYTES')

  const base = {
    id: 'claude-plugin-a',
    armId: 'independent:claude-claude-plugin',
    repositoryId: 'gauntlet-3-test/repository/one',
    root: realpathSync(roots[0]),
    gitDir: realpathSync(join(roots[0], '.git')),
    providerNamespace: 'gauntlet-3-test/ns-one',
    headSha: SHA,
    baseSha: SHA,
    fixtureSha: SHA,
    treeSha: 'c'.repeat(40),
    statusPorcelain: '',
    runPacket: { path: realpathSync(packets[0]) },
    sealedPacketIds: ['packet-secret'],
  }
  const deps = {
    git: async (fixtureRoot, args) =>
      args.includes('--absolute-git-dir') ? realpathSync(join(fixtureRoot, '.git'))
        : args.includes('HEAD^{tree}') ? 'c'.repeat(40)
          : args.includes('status') ? '' : SHA,
    readPrompt: async fixture => readFileSync(fixture.runPacket.path, 'utf8'),
    readNamespace: async fixture => fixture.providerNamespace,
    readSealedPackets: async () => [{
      id: 'packet-secret',
      path: realpathSync(sealedPath),
      bytes: readFileSync(sealedPath),
    }],
  }
  const good = [base, {
    ...base,
    id: 'claude-baseline-a',
    armId: 'independent:claude-claude-baseline',
    repositoryId: 'gauntlet-3-test/repository/two',
    root: realpathSync(roots[1]),
    gitDir: realpathSync(join(roots[1], '.git')),
    providerNamespace: 'gauntlet-3-test/ns-two',
    runPacket: { path: realpathSync(packets[1]) },
  }]
  assert.equal(await assertFixtureIsolation(clone(good), deps), true)

  for (const mutate of [
    fixtures => { fixtures[1].root = fixtures[0].root },
    fixtures => { fixtures[1].gitDir = fixtures[0].gitDir },
    fixtures => { fixtures[1].providerNamespace = fixtures[0].providerNamespace },
    fixtures => { fixtures[1].headSha = 'b'.repeat(40) },
  ]) {
    const changed = clone(good)
    mutate(changed)
    await assert.rejects(() => assertFixtureIsolation(changed, deps), /root|git|namespace|sha|isolat/i)
  }

  writeFileSync(packets[1], '{"prompt":"EVALUATOR-OWNED-SECRET-BYTES","sealedPacketIds":["packet-secret"]}')
  await assert.rejects(() => assertFixtureIsolation(clone(good), deps), /sealed|bytes|leak|prompt/i)
  writeFileSync(packets[1], '{"sealedPacketIds":["packet-secret"]}')

  const dirty = clone(good)
  dirty[1].statusPorcelain = '?? leaked-file'
  await assert.rejects(() => assertFixtureIsolation(dirty, deps), /clean|status|dirty/i)
  const changedTree = clone(good)
  changedTree[1].treeSha = 'd'.repeat(40)
  await assert.rejects(() => assertFixtureIsolation(changedTree, deps), /tree|sha/i)

  const ignoredLeak = join(roots[1], 'ignored-evaluator-content.bin')
  writeFileSync(ignoredLeak, 'prefix EVALUATOR-OWNED-SECRET-BYTES suffix')
  await assert.rejects(() => assertFixtureIsolation(clone(good), deps), /sealed|bytes|leak/i)
  rmSync(ignoredLeak)

  const symlink = join(roots[1], 'fixture-link')
  symlinkSync(join(roots[1], '.git'), symlink)
  await assert.rejects(() => assertFixtureIsolation(clone(good), deps), /symlink/i)
  rmSync(symlink)

  const misplacedSealed = join(controlRoot, 'misplaced-sealed.bin')
  writeFileSync(misplacedSealed, 'EVALUATOR-OWNED-SECRET-BYTES')
  await assert.rejects(() => assertFixtureIsolation(clone(good), {
    ...deps,
    readSealedPackets: async () => [{
      id: 'packet-secret',
      path: realpathSync(misplacedSealed),
      bytes: readFileSync(misplacedSealed),
    }],
  }), /sealed|control|inside/i)
  rmSync(misplacedSealed)

  const oversized = join(roots[1], 'oversized-sparse-fixture')
  const fd = openSync(oversized, 'w')
  try { ftruncateSync(fd, FIXTURE_SCAN_LIMITS.maxFixtureBytes + 1) } finally { closeSync(fd) }
  await assert.rejects(() => assertFixtureIsolation(clone(good), deps), /scan|limit|bytes/i)
  rmSync(oversized)
})

test('fixture builder refuses an existing target before cloneFixture is called', async t => {
  const existing = realpathSync(mkdtempSync(join(tmpdir(), 'gauntlet-3-preclone-')))
  t.after(() => rmSync(existing, { recursive: true, force: true }))
  const contract = validLaunchable()
  let cloneCalls = 0
  await assert.rejects(() => buildGauntletFixture({
    contract,
    scenario: contract.scenarios[0],
    condition: contract.conditions[0],
    root: existing,
  }, {
    cloneFixture: async () => { cloneCalls++ },
    writeRunPacket: async () => { throw new Error('writeRunPacket must not run') },
    git: async () => { throw new Error('git must not run') },
  }), /exist|target|empty|clone/i)
  assert.equal(cloneCalls, 0)
})
