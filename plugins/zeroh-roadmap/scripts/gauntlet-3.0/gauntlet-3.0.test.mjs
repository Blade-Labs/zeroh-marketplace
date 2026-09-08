import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
import { dispatchArmIndex, readArmJournal, resumeArm, runArm, runGauntlet3 } from './run.mjs'
import {
  EXPECTED_DISPOSITIONS,
  SENTINEL_NAMES,
  buildBlindJudgePacket,
  mergeBlindVerdict,
  pairGauntletOutcomes,
  scoreDeterministicSentinels,
} from './score.mjs'
import {
  bindNativeSession,
  persistRunRequest,
  persistRunResult,
  readRunReceipt,
  reconcileRunReceipt,
} from '../../cli/lib/run-receipt.mjs'
import { claimExecutorRun, readExecutorRunArm } from '../../cli/lib/executor-arm.mjs'
import { buildHaltPayload } from '../../cli/lib/workflow-steps.mjs'
import { finalizeCiObservation } from '../../cli/lib/providers/ci.mjs'
import { buildDeliverySummary } from '../../cli/lib/delivery-evaluation.mjs'
import { decideCorrectionRoute, deliveryKeyOf } from '../../cli/lib/delivery.mjs'
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
  repositoryNamespace: 'gauntlet-3-test',
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
function validLaunchable(fixtureSha = SHA) {
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
    fixtureSha,
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


function runnerAuthorityRef(contract) {
  return Object.freeze({
    status: 'known',
    envelopeDigest: 'sha256:gauntlet-3-authority',
    source: Object.freeze({
      kind: 'managed-host-receipt',
      ref: contract.externalActionAuthority.authorityRef,
    }),
  })
}
const RUN_DIGEST_A = '1'.repeat(64)
const RUN_DIGEST_B = '2'.repeat(64)

function runnerFixtures(contract, root) {
  return Object.freeze(contract.scenarios.flatMap(scenario =>
    contract.conditions.map(condition => Object.freeze({
      armId: scenario.id + ':' + condition.id,
      root: join(root, 'worktrees', scenario.id + '--' + condition.id),
      gitDir: join(root, 'gitdirs', scenario.id + '--' + condition.id),
      headSha: contract.fixture.baseSha,
      baseSha: contract.fixture.baseSha,
      fixtureSha: contract.fixture.baseSha,
      treeSha: 'b'.repeat(40),
      statusPorcelain: '',
      providerNamespace: contract.externalActionAuthority.providerNamespace + '/' + scenario.id + '-' + condition.id,
      repositoryId: contract.externalActionAuthority.repositoryNamespace + '/' + scenario.id + '-' + condition.id,
      runPacket: Object.freeze({ path: join(root, 'control', scenario.id + '--' + condition.id + '.json') }),
      sealedPacketIds: [...contract.fixture.sealedPacketIds],
    }))))
}

function runnerHarness(t, overrides = {}) {
  const fixtureSha = overrides.fixtureSha ?? SHA
  const adapterOverrides = { ...overrides }
  delete adapterOverrides.fixtureSha
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gauntlet-3-runner-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const outputDir = join(root, 'output')
  mkdirSync(outputDir)
  const contract = validLaunchable(fixtureSha)
  const authorityRef = runnerAuthorityRef(contract)
  const fixtures = runnerFixtures(contract, root)
  for (const fixture of fixtures) {
    mkdirSync(fixture.root, { recursive: true })
    mkdirSync(fixture.gitDir, { recursive: true })
  }
  const calls = { prepare: [], submit: [], start: [], awaitEvent: [], recover: [], resume: [], readReceipt: [], reconcile: [], delivery: [], usage: [] }
  const receipts = new Map()
  const deliveries = new Map()
  const prepareArm = async ({ arm, fixture, allocation }) => {
    calls.prepare.push(clone({ arm, fixture, allocation }))
    mkdirSync(join(root, 'launch-inputs'), { recursive: true })
    const launchInputsRef = join(root, 'launch-inputs', arm.runId + '.json')
    writeFileSync(launchInputsRef, JSON.stringify({
      armId: arm.armId,
      requestedChild: arm.requestedChild,
      policy: { driverId: arm.requestedChild.driverId, modelId: arm.requestedChild.modelId },
    }))
    const request = {
      runId: arm.runId,
      executorId: 'executor-' + arm.runId,
      arcId: arm.deliveryArcIds[0],
      phase: 43,
      roleId: 'gauntlet-parent',
      driverId: arm.requestedParent.driverId,
      model: arm.requestedParent.modelId,
      worktree: fixture.root,
      baseHead: fixture.baseSha,
      requestedHead: fixture.baseSha,
      roleCardDigest: RUN_DIGEST_A,
      governanceDigest: RUN_DIGEST_B,
      authority: {
        parent: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: { kind: 'managed-host-input', source: 'supervisor' } },
        request: { profile: 'inherit', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false }, provenance: null },
        effective: { profile: 'workspace-write', bounds: { filesystem: 'workspace-write', network: 'denied', gitPush: false, externalWrites: false } },
        native: { driver: arm.requestedParent.driverId, runtime: { version: null, verified: false }, argv: ['exec'], enforcement: { filesystem: 'sandbox', network: 'sandbox-config', gitPush: 'semantic-only', externalWrites: 'semantic-only' }, limitations: ['test identity unverified'] },
      },
      authorityRef,
    }
    return {
      request,
      initialState: { arcId: request.arcId, stage: 'phase', status: 'active', processedEventIds: [], lastHalt: null, authorityRef },
      launchInputsRef,
    }
  }
  const ownerReceipt = (request, {
    nativeSessionId = null,
    latestObservation = null,
    terminalResult = null,
    pendingOperation = nativeSessionId
      ? { kind: 'start', actionFingerprint: '3'.repeat(64) }
      : { kind: 'start', actionFingerprint: '4'.repeat(64) },
    outcome = terminalResult ? 'complete' : nativeSessionId ? 'active' : 'pending',
  } = {}) => ({
    path: join(request.worktree, '.building', 'run-receipts', encodeURIComponent(request.arcId), encodeURIComponent(request.runId), '000000.json'),
    digest: '5'.repeat(64),
    snapshot: {
      version: 1,
      arcId: request.arcId,
      runId: request.runId,
      revision: 0,
      previousDigest: null,
      request: clone(request),
      requestFingerprint: '6'.repeat(64),
      pendingOperation,
      nativeSessionId,
      latestObservation,
      terminalResult,
      outcome,
    },
  })
  const driver = driverId => ({
    async start(request) {
      calls.start.push(clone(request))
      const handle = { request: clone(request), nativeSessionId: driverId + '-session-' + request.runId }
      receipts.set(request.runId, ownerReceipt(request, { nativeSessionId: handle.nativeSessionId }))
      return handle
    },
    async awaitEvent(handle, initialState) {
      calls.awaitEvent.push(clone({ handle, initialState }))
      const observation = {
        runId: handle.request.runId,
        executorId: handle.request.executorId,
        roleId: handle.request.roleId,
        driverId: handle.request.driverId,
        model: handle.request.model,
        nativeSessionId: handle.nativeSessionId,
        event: { eventId: 'done-' + handle.request.runId, arcId: handle.request.arcId, source: 'native-agent', type: 'run-phase', phase: 43, authorityRef: handle.request.authorityRef },
      }
      const terminalResult = {
        status: 'transport-exited',
        driverId,
        nativeSessionId: handle.nativeSessionId,
        exitCode: 0,
        signal: null,
        protocolTerminal: 'turn.completed',
        usage: { nativeMs: 100, tokens: 50 },
        phaseResult: { status: 'done' },
      }
      const result = { handle: clone(handle), observation, result: terminalResult }
      receipts.set(handle.request.runId, ownerReceipt(handle.request, {
        nativeSessionId: handle.nativeSessionId,
        latestObservation: result,
        terminalResult,
        pendingOperation: null,
        outcome: 'complete',
      }))
      return result
    },
    async recover(receipt) { calls.recover.push(clone(receipt)); return { status: 'active', receipt } },
    async resume(handle) { calls.resume.push(clone(handle)); return handle },
  })
  const adapters = {
    fixtures,
    prepareArm,
    preflight: async ({ contract: actual }) => ({ status: 'ready', reasons: [], observed: { contractId: actual.contractId } }),
    admission: {
      async submit(allocation, operation) {
        calls.submit.push(clone(allocation))
        return operation()
      },
    },
    nativeDrivers: { claude: driver('claude'), codex: driver('codex') },
    runReceipts: {
      readRunReceipt(cwd, address) {
        calls.readReceipt.push(clone({ cwd, address }))
        return receipts.get(address.runId) ?? null

      },
      reconcileRunReceipt(cwd, input) {
        calls.reconcile.push(clone({ cwd, input }))
        const receipt = receipts.get(input.runId)
        if (!receipt) return { status: 'missing', receipt: null }
        if (receipt.snapshot.terminalResult) {
          return { status: 'complete', result: clone(receipt.snapshot.terminalResult), receipt }
        }
        if (receipt.snapshot.nativeSessionId) return { status: 'resume', operation: 'awaitEvent', receipt }
        if (receipt.snapshot.pendingOperation) return { status: 'hold', reason: 'pending operation has unknown outcome', receipt }
        return { status: 'active', receipt }
      },
    },
    deliveries: {
      loadArcDelivery(cwd, arcId) {
        calls.delivery.push(['load', cwd, arcId])
        return deliveries.get(arcId) ?? null
      },
      async resume(cwd, arcId) {
        calls.delivery.push(['resume', cwd, arcId])
        const value = { arcId, revision: 1, actions: [] }
        deliveries.set(arcId, value)
        return value
      },
    },
    usage: {
      read(receipt) {
        calls.usage.push(clone(receipt))
        return { nativeMs: 100, tokens: 50 }
      },
    },
    ...adapterOverrides,
  }
  return { root, outputDir, contract, fixtures, adapters, calls, receipts, deliveries, ownerReceipt }
}

test('runner writes a frozen sorted 24-arm index with derived allocations and exact parent requests', async t => {
  const f = runnerHarness(t)
  const result = await runGauntlet3({
    contract: f.contract,
    outputDir: f.outputDir,
    adapters: f.adapters,
    budget: f.contract.budget,
  })
  const indexPath = join(f.outputDir, 'arms.json')
  const bytes = readFileSync(indexPath)
  const index = JSON.parse(bytes)
  assert.equal(index.schemaVersion, 1)
  assert.deepEqual(index.contract, f.contract)
  assert.equal(index.arms.length, 24)
  assert.deepEqual(index.arms.map(arm => arm.armId), [...index.arms.map(arm => arm.armId)].sort())
  assert.deepEqual(index.budget, f.contract.budget)
  const nativeTotal = index.arms.reduce((sum, arm) => sum + arm.allocation.nativeMs, 0)
  const tokenTotal = index.arms.reduce((sum, arm) => sum + arm.allocation.tokens, 0)
  assert.equal(nativeTotal, f.contract.budget.totalNativeMs)
  assert.equal(tokenTotal, f.contract.budget.totalTokens)
  for (const arm of index.arms) {
    const condition = f.contract.conditions.find(c => c.id === arm.conditionId)
    const scenario = f.contract.scenarios.find(s => s.id === arm.scenarioId)
    assert.equal(arm.armId, scenario.id + ':' + condition.id)
    assert.equal(arm.runId, 'g3-' + scenario.id + '--' + condition.id)
    assert.equal(arm.runId.includes('/'), false)
    assert.deepEqual(arm.requestedParent, condition.parent)
    assert.deepEqual(arm.requestedChild, condition.child)
    assert.equal(arm.request.driverId, condition.parent.driverId)
    assert.equal(arm.request.model, condition.parent.modelId)
    assert.equal(arm.request.runId, arm.runId)
    assert.equal(arm.request.worktree, arm.worktree)
    assert.equal(arm.request.baseHead, f.contract.fixture.baseSha)
    assert.ok(scenario.arcIds.includes(arm.request.arcId))
    assert.equal(arm.initialState.arcId, arm.request.arcId)
    assert.deepEqual(arm.initialState.authorityRef, arm.request.authorityRef)
    assert.ok(arm.allocation.nativeMs > 0 && arm.allocation.nativeMs <= f.contract.budget.perArmTimeoutMs)
    assert.ok(arm.allocation.tokens > 0)
    const launch = JSON.parse(readFileSync(arm.launchInputsRef, 'utf8'))
    assert.deepEqual(launch.requestedChild, condition.child)
  }
  assert.ok(Object.isFrozen(result.index))
  assert.ok(Object.isFrozen(result.index.arms))
  assert.equal(f.calls.prepare.length, 24)

  const replay = await runGauntlet3({
    contract: f.contract,
    outputDir: f.outputDir,
    adapters: f.adapters,
    budget: f.contract.budget,
  })
  assert.deepEqual(readFileSync(indexPath), bytes)
  assert.deepEqual(replay.index, result.index)
  assert.equal(f.calls.start.length, 24)
})

test('native completion remains unjudged and a second resume performs no fresh start or duplicate delivery action', async t => {
  const f = runnerHarness(t)
  const run = await runGauntlet3({ contract: f.contract, outputDir: f.outputDir, adapters: f.adapters, budget: f.contract.budget })
  const armId = run.index.arms[0].armId
  const first = await runArm(armId, { index: run.index, adapters: f.adapters })
  assert.equal(first.status, 'unjudged')
  assert.notEqual(first.status, 'passed')
  const starts = f.calls.start.length
  const deliveryResumes = f.calls.delivery.filter(([op]) => op === 'resume').length
  const second = await resumeArm(armId, { index: run.index, adapters: f.adapters })
  assert.equal(second.status, 'unjudged')
  assert.equal(f.calls.start.length, starts)
  assert.equal(f.calls.delivery.filter(([op]) => op === 'resume').length, deliveryResumes)
  const journal = await readArmJournal(run.index, f.adapters)
  assert.equal(journal.find(arm => arm.armId === armId).status, 'unjudged')
})

test('pending unknown usage forbids a fresh launch and preserves unavailable usage-observed state', async t => {
  const f = runnerHarness(t, {
    usage: { read: () => null },
  })
  const run = await runGauntlet3({ contract: f.contract, outputDir: f.outputDir, adapters: f.adapters, budget: f.contract.budget })
  const arm = run.index.arms[0]
  f.receipts.set(arm.runId, f.ownerReceipt(arm.request, { nativeSessionId: 'existing-session' }))
  f.calls.start.length = 0
  const result = await resumeArm(arm.armId, { index: run.index, adapters: f.adapters })
  assert.equal(result.status, 'unavailable')
  assert.match(JSON.stringify(result), /usage-unobserved/i)
  assert.equal(f.calls.start.length, 0)
})

test('receipt identity mismatch, budget absence, admission limit, auth, and permission stay explicit non-pass', async t => {
  const f = runnerHarness(t)
  const built = await runGauntlet3({ contract: f.contract, outputDir: f.outputDir, adapters: f.adapters, budget: f.contract.budget })
  const arm = built.index.arms[0]
  f.receipts.set(arm.runId, f.ownerReceipt({ ...clone(arm.request), model: 'wrong-model' }, { nativeSessionId: 'wrong-session' }))
  const mismatch = await resumeArm(arm.armId, { index: built.index, adapters: f.adapters })
  assert.equal(mismatch.status, 'failed')
  assert.match(JSON.stringify(mismatch), /identity|model|mismatch/i)

  const noBudget = clone(f.contract)
  noBudget.budget = null
  const starts = f.calls.start.length
  const unavailable = await runGauntlet3({ contract: noBudget, outputDir: join(f.root, 'no-budget'), adapters: f.adapters, budget: null })
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(f.calls.start.length, starts)

  for (const [status, code] of [['unavailable', 'limit'], ['permission-held', 'auth'], ['permission-held', 'permission']]) {
    const g = runnerHarness(t, {
      admission: {
        async submit() { return { status, reason: { code, message: code + ' denied' } } },
      },
    })
    const result = await runGauntlet3({ contract: g.contract, outputDir: g.outputDir, adapters: g.adapters, budget: g.contract.budget })
    assert.equal(result.status, status)
    assert.notEqual(result.status, 'passed')
    assert.match(JSON.stringify(result), new RegExp(code, 'i'))
  }
})

test('default adapters refuse as unavailable before any native process can start', async t => {
  const outputDir = realpathSync(mkdtempSync(join(tmpdir(), 'gauntlet-3-no-adapters-')))
  t.after(() => rmSync(outputDir, { recursive: true, force: true }))
  const result = await runGauntlet3({ contract: validLaunchable(), outputDir })
  assert.equal(result.status, 'unavailable')
  assert.match(JSON.stringify(result), /adapter|preparation|token|unavailable/i)
})


test('twenty admitted fake lanes use canonical run receipts and executor arms exactly once across replay', async t => {
  const estate = realpathSync(mkdtempSync(join(tmpdir(), 'gauntlet-3-real-owner-')))
  t.after(() => rmSync(estate, { recursive: true, force: true }))
  const seed = join(estate, 'seed')
  mkdirSync(seed)
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
  git(seed, 'init', '-q')
  git(seed, 'config', 'user.email', 'gauntlet-owner@example.invalid')
  git(seed, 'config', 'user.name', 'Gauntlet Owner')
  writeFileSync(join(seed, 'seed.txt'), 'real owner fixture\n')
  git(seed, 'add', 'seed.txt')
  git(seed, 'commit', '-qm', 'seed')
  const fixtureSha = git(seed, 'rev-parse', 'HEAD')
  const f = runnerHarness(t, { fixtureSha })
  const admitted = new Set()
  const resultWrites = []
  const roleBytes = Buffer.from('---\nname: gauntlet-parent\n---\n')
  const governanceBytes = Buffer.from('GAUNTLET 3 TEST GOVERNANCE\n')
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const basePrepare = f.adapters.prepareArm
  f.adapters.prepareArm = async input => {
    const prepared = await basePrepare(input)
    prepared.request.roleCardDigest = hash(roleBytes)
    prepared.request.governanceDigest = hash(governanceBytes)
    return prepared
  }
  for (const fixture of f.fixtures) {
    rmSync(fixture.root, { recursive: true, force: true })
    execFileSync('git', ['clone', '-q', '--no-local', seed, fixture.root])
  }

  let admissions = 0
  f.adapters.admission = {
    async submit(allocation, operation) {
      admissions++
      if (admissions > 20) return { status: 'unavailable', reason: 'fixture-limit' }
      admitted.add(allocation.armId)
      return operation()
    },
  }
  const realDriver = driverId => ({
    async start(request) {
      assert.equal(request.driverId, driverId)
      const persisted = persistRunRequest(request.worktree, request, {
        operation: { kind: 'start' },
        roleCardBytes: roleBytes,
        governanceBytes,
      })
      assert.equal(persisted.status, 'recorded')
      const nativeSessionId = 'native-' + request.runId
      const claim = claimExecutorRun(request.worktree, request.phase, {
        sessionId: 'owner-' + request.runId,
        executorId: request.executorId,
        runReceipt: persisted.receipt,
      })
      assert.equal(claim.status, 'recorded')
      const bound = bindNativeSession(request.worktree, {
        arcId: request.arcId,
        runId: request.runId,
        expectedRevisionDigest: persisted.receipt.digest,
        nativeSessionId,
      })
      assert.equal(bound.status, 'recorded')
      return { request, nativeSessionId }
    },
    async awaitEvent(handle) {
      const receipt = readRunReceipt(handle.request.worktree, {
        arcId: handle.request.arcId,
        runId: handle.request.runId,
      })
      const terminalResult = {
        status: 'transport-exited',
        driverId,
        observedModelId: handle.request.model,
        nativeSessionId: handle.nativeSessionId,
        exitCode: 0,
        signal: null,
        protocolTerminal: 'turn.completed',
        usage: { nativeMs: 100, tokens: 50 },
        phaseResult: { status: 'done' },
      }
      const written = persistRunResult(handle.request.worktree, {
        arcId: handle.request.arcId,
        runId: handle.request.runId,
        expectedRevisionDigest: receipt.digest,
        result: terminalResult,
      })
      assert.equal(written.status, 'recorded')
      resultWrites.push(handle.request.runId)
      return { handle, result: terminalResult }
    },
    async recover() { throw new Error('terminal real receipt must not recover') },
    async resume() { throw new Error('terminal real receipt must not resume native execution') },
  })
  f.adapters.nativeDrivers = { claude: realDriver('claude'), codex: realDriver('codex') }
  f.adapters.runReceipts = { readRunReceipt, reconcileRunReceipt }
  f.adapters.usage = { read: receipt => receipt.snapshot.terminalResult?.usage ?? null }

  const first = await runGauntlet3({
    contract: f.contract,
    outputDir: f.outputDir,
    adapters: f.adapters,
    budget: f.contract.budget,
  })
  assert.equal(first.status, 'unavailable')
  assert.equal(admitted.size, 20)
  assert.equal(resultWrites.length, 20)
  const ownerIdentities = new Map()
  for (const arm of first.index.arms) {
    const receipt = readRunReceipt(arm.worktree, { arcId: arm.request.arcId, runId: arm.runId })
    const owner = readExecutorRunArm(arm.worktree, arm.request.phase)
    if (admitted.has(arm.armId)) {
      assert.ok(receipt)
      assert.equal(receipt.snapshot.outcome, 'complete')
      assert.equal(receipt.snapshot.terminalResult.status, 'transport-exited')
      assert.equal(receipt.snapshot.request.driverId, arm.requestedParent.driverId)
      assert.equal(receipt.snapshot.request.model, arm.requestedParent.modelId)
      assert.equal(owner.status, 'valid')
      assert.equal(owner.arm.runId, arm.runId)
      assert.equal(owner.arm.executorId, arm.request.executorId)
      ownerIdentities.set(arm.armId, {
        runId: receipt.snapshot.runId,
        nativeSessionId: receipt.snapshot.nativeSessionId,
        executorId: owner.arm.executorId,
        receiptPath: receipt.path,
      })
    } else {
      assert.equal(receipt, null)
      assert.equal(owner.status, 'missing')
    }
  }

  const firstIndexBytes = readFileSync(first.index.indexPath)
  const second = await runGauntlet3({
    contract: f.contract,
    outputDir: f.outputDir,
    adapters: f.adapters,
    budget: f.contract.budget,
  })
  assert.deepEqual(readFileSync(second.index.indexPath), firstIndexBytes)
  assert.equal(resultWrites.length, 20)
  assert.equal(f.calls.delivery.filter(([operation]) => operation === 'resume').length, 0)
  for (const arm of second.index.arms.filter(arm => admitted.has(arm.armId))) {
    const receipt = readRunReceipt(arm.worktree, { arcId: arm.request.arcId, runId: arm.runId })
    const owner = readExecutorRunArm(arm.worktree, arm.request.phase)
    assert.deepEqual({
      runId: receipt.snapshot.runId,
      nativeSessionId: receipt.snapshot.nativeSessionId,
      executorId: owner.arm.executorId,
      receiptPath: receipt.path,
    }, ownerIdentities.get(arm.armId))
  }

  const planned = second.index.arms.find(arm => !admitted.has(arm.armId))
  const before = readRunReceipt(planned.worktree, { arcId: planned.request.arcId, runId: planned.runId })
  assert.equal(before, null)
  const cli = spawnSync(process.execPath, [
    new URL('./run.mjs', import.meta.url).pathname,
    '--run-arm', planned.armId,
    '--index', second.index.indexPath,
  ], { encoding: 'utf8', timeout: 10000 })
  assert.notEqual(cli.status, 0)
  const stdout = JSON.parse(cli.stdout.trim())
  assert.equal(stdout.status, 'unavailable')
  assert.match(stdout.reason, /token-boundary-unavailable/i)
  assert.equal(readRunReceipt(planned.worktree, { arcId: planned.request.arcId, runId: planned.runId }), null)
})


test('pending provider success reconciles through the existing resume wrapper once and preserves delivery identity', async t => {
  const f = runnerHarness(t)
  const first = await runGauntlet3({
    contract: f.contract,
    outputDir: f.outputDir,
    adapters: f.adapters,
    budget: f.contract.budget,
  })
  const arm = first.index.arms[0]
  const arcId = arm.deliveryArcIds[0]
  const key = arm.worktree + '\0' + arcId
  const deliveryKey = 'delivery-key-' + arm.runId
  const providerPullRequestId = 'PR-' + arm.runId
  const stores = new Map([[key, {
    arcId,
    deliveryKey,
    revision: 1,
    target: { repositoryId: arm.repositoryId },
    pullRequest: { providerPullRequestId },
    actions: [{ id: 'create-pr', status: 'unknown' }],
    terminal: { status: 'preparing' },
  }]])
  const resumeCalls = []
  f.adapters.deliveries = {
    loadArcDelivery(cwd, requestedArcId) {
      return stores.get(cwd + '\0' + requestedArcId) ?? null
    },
    async resume(cwd, requestedArcId) {
      resumeCalls.push([cwd, requestedArcId])
      const prior = stores.get(cwd + '\0' + requestedArcId)
      stores.set(cwd + '\0' + requestedArcId, {
        ...clone(prior),
        revision: prior.revision + 1,
        actions: prior.actions.map(action => ({ ...action, status: 'succeeded' })),
        terminal: { status: 'preparing' },
      })
      return stores.get(cwd + '\0' + requestedArcId)
    },
  }

  const resumed = await resumeArm(arm.armId, { index: first.index, adapters: f.adapters })
  assert.equal(resumed.status, 'unjudged')
  assert.deepEqual(resumeCalls, [[arm.worktree, arcId]])
  assert.equal(resumed.deliveryReceiptRefs[0].deliveryKey, deliveryKey)
  assert.equal(resumed.deliveryReceiptRefs[0].providerPullRequestId, providerPullRequestId)

  const replay = await resumeArm(arm.armId, { index: first.index, adapters: f.adapters })
  assert.equal(replay.status, 'unjudged')
  assert.deepEqual(resumeCalls, [[arm.worktree, arcId]])
  assert.equal(stores.get(key).revision, 2)
  assert.equal(stores.size, 1)
})


test('installed pool dispatches the immutable index to static unavailable workers without native receipts', {
  skip: process.env.NATIVEGREEN_HOST_POOL_SMOKE !== '1'
    ? 'set NATIVEGREEN_HOST_POOL_SMOKE=1 on a host with jobs-manifest-v1'
    : false,
}, async t => {
  const f = runnerHarness(t, {
    admission: {
      async submit() { return { status: 'unavailable', reason: 'index-only' } },
    },
  })
  const seed = join(f.root, 'pool-seed')
  mkdirSync(seed)
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
  git(seed, 'init', '-q')
  git(seed, 'config', 'user.email', 'gauntlet-pool@example.invalid')
  git(seed, 'config', 'user.name', 'Gauntlet Pool')
  writeFileSync(join(seed, 'seed.txt'), 'installed pool static worker fixture\n')
  git(seed, 'add', 'seed.txt')
  git(seed, 'commit', '-qm', 'seed')
  for (const fixture of f.fixtures) {
    rmSync(fixture.root, { recursive: true, force: true })
    execFileSync('git', ['clone', '-q', '--no-local', seed, fixture.root])
  }

  const built = await runGauntlet3({
    contract: f.contract,
    outputDir: f.outputDir,
    adapters: f.adapters,
    budget: f.contract.budget,
  })
  assert.equal(built.status, 'unavailable')
  for (const arm of built.index.arms) {
    assert.equal(readRunReceipt(arm.worktree, { arcId: arm.request.arcId, runId: arm.runId }), null)
  }

  const dispatched = dispatchArmIndex(built.index.indexPath)
  assert.equal(dispatched.status, 'unavailable')
  assert.match(dispatched.reason, /production token|preparation|unavailable/i)
  assert.notEqual(dispatched.exitCode, 0)
  for (const arm of built.index.arms) {
    assert.equal(readRunReceipt(arm.worktree, { arcId: arm.request.arcId, runId: arm.runId }), null)
  }
})


function blindArmScore(contract, conditionId = contract.conditions[0].id, scenarioId = contract.scenarios[0].id) {
  return {
    armId: scenarioId + ':' + conditionId,
    status: 'valid',
    absoluteScore: 1,
    sentinels: SENTINEL_NAMES.map(name => ({
      name,
      status: 'pass',
      ownerRefs: ['owner://' + name],
      evidence: ['canonical ' + name + ' evidence'],
      reason: null,
    })),
  }
}

function judgeOwnerEvidence(expectedJudge, packet) {
  const stdin = Buffer.from(JSON.stringify(packet, null, 2) + '\n')
  const request = {
    runId: expectedJudge.runId,
    arcId: 'blind-judge',
    driverId: expectedJudge.driverId,
    model: expectedJudge.modelId,
  }
  const pendingReceipt = {
    path: '/evaluator/receipts/' + expectedJudge.runId + '-pending.json',
    digest: '7'.repeat(64),
    snapshot: {
      revision: 0,
      request,
      pendingOperation: {
        kind: 'start',
        actionFingerprint: '8'.repeat(64),
        inputDigest: createHash('sha256').update(stdin).digest('hex'),
      },
      nativeSessionId: 'judge-session',
      terminalResult: null,
      outcome: 'active',
    },
  }
  const terminalReceipt = {
    path: '/evaluator/receipts/' + expectedJudge.runId + '-terminal.json',
    digest: '9'.repeat(64),
    snapshot: {
      revision: 1,
      request: clone(request),
      pendingOperation: null,
      nativeSessionId: 'judge-session',
      terminalResult: {
        status: 'transport-exited',
        driverId: expectedJudge.driverId,
        observedModelId: expectedJudge.modelId,
        nativeSessionId: 'judge-session',
        exitCode: 0,
        signal: null,
        protocolTerminal: 'turn.completed',
      },
      outcome: 'complete',
    },
  }
  return { judgeEvidence: { stdin, pendingReceipt, terminalReceipt } }
}

function judgedVerdict(packet, status = 'judged') {
  return {
    packetId: packet.packetId,
    status,
    criteria: packet.criteria.map((criterion, index) => ({
      criterionId: criterion.id,
      status: status === 'abstained' ? 'abstain' : index === 0 ? 'gap' : 'met',
      confidence: index === 0 ? 'high' : 'medium',
      violations: index === 0 && status === 'judged' ? ['missing causal evidence'] : [],
      evidence: ['artifact-' + index],
    })),
  }
}

test('blind packet is stable, deeply frozen, anonymized, and contains deterministic names without absolute score', async () => {
  const contract = validLaunchable()
  const scenario = contract.scenarios[0]
  const armScore = blindArmScore(contract)
  const calls = []
  const readAnonymizedDeliverables = async input => {
    calls.push(clone(input))
    return [
      { artifactId: 'artifact-1', mediaType: 'text/plain', content: 'candidate output A' },
      { artifactId: 'artifact-2', mediaType: 'application/json', content: '{"result":"complete"}' },
    ]
  }
  const packet = await buildBlindJudgePacket({
    contract,
    scenarioId: scenario.id,
    armScore,
  }, { readAnonymizedDeliverables })
  const replay = await buildBlindJudgePacket({
    contract,
    scenarioId: scenario.id,
    armScore,
  }, { readAnonymizedDeliverables })
  assert.deepEqual(packet, replay)
  assert.equal(packet.version, 1)
  assert.match(packet.packetId, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(packet.criteria, scenario.criteria.map(id => ({
    id,
    expectedDisposition: EXPECTED_DISPOSITIONS[id],
  })))
  assert.deepEqual(Object.keys(EXPECTED_DISPOSITIONS).sort(), [...new Set(contract.requiredCriteria)].sort())
  assert.ok(packet.criteria.every(criterion =>
    typeof criterion.expectedDisposition === 'string' && criterion.expectedDisposition.trim()))
  assert.deepEqual(packet.deterministic, {
    status: 'valid',
    sentinelNames: armScore.sentinels.map(sentinel => sentinel.name),
  })
  assert.equal(Object.isFrozen(packet), true)
  assert.equal(Object.isFrozen(packet.criteria), true)
  assert.equal(Object.isFrozen(packet.criteria[0]), true)
  assert.equal(Object.isFrozen(packet.deliverables), true)
  assert.deepEqual(calls, [
    { armId: armScore.armId, scenarioId: scenario.id },
    { armId: armScore.armId, scenarioId: scenario.id },
  ])
  const serialized = JSON.stringify(packet)
  for (const forbidden of [
    'absoluteScore', 'pluginEnabled', 'matchedConditionId', 'requestedParent',
    'requestedChild', 'driverId', 'modelId', 'reasoning', 'transcript', 'priorVerdict',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden)
})

test('blind packet rejects invalid deterministic evidence and malformed or identity-leaking deliverables', async () => {
  const contract = validLaunchable()
  const scenarioId = contract.scenarios[0].id
  const base = { contract, scenarioId, armScore: blindArmScore(contract) }
  await assert.rejects(() => buildBlindJudgePacket({
    ...base,
    armScore: { ...base.armScore, status: 'invalid', absoluteScore: null },
  }, { readAnonymizedDeliverables: async () => [] }), /invalid|deterministic|score/i)

  for (const deliverables of [
    [{ artifactId: 'a', mediaType: 'text/plain', content: 'x', driverId: 'codex' }],
    [{ artifactId: 'a', mediaType: 'text/plain', content: 'x', priorVerdict: 'pass' }],
    [{ artifactId: 'plugin-artifact', mediaType: 'text/plain', content: 'x' }],
    [{ artifactId: 'codex-output', mediaType: 'text/plain', content: 'x' }],
    [{ artifactId: 'a', mediaType: 'text/plain', content: 'x' }, { artifactId: 'a', mediaType: 'text/plain', content: 'y' }],
    [{ artifactId: '', mediaType: 'text/plain', content: 'x' }],
  ]) {
    await assert.rejects(() => buildBlindJudgePacket(base, {
      readAnonymizedDeliverables: async () => deliverables,
    }), /deliverable|anonym|identity|duplicate|artifact/i)
  }
})

test('blind verdict requires exact packet-bound canonical judge identity and persists judged detail', async () => {
  const contract = validLaunchable()
  const packet = await buildBlindJudgePacket({
    contract,
    scenarioId: contract.scenarios[0].id,
    armScore: blindArmScore(contract),
  }, {
    readAnonymizedDeliverables: async () => [
      { artifactId: 'artifact-1', mediaType: 'text/plain', content: 'anonymous result' },
    ],
  })
  const expectedJudge = { driverId: 'codex', modelId: 'gpt-5.6-sol', runId: 'judge-g3-1' }
  const verdict = judgedVerdict(packet)
  const merged = mergeBlindVerdict({
    packet,
    expectedJudge,
    ...judgeOwnerEvidence(expectedJudge, packet),
    verdict,
  })
  assert.equal(merged.status, 'judged', JSON.stringify(merged))
  assert.deepEqual(merged.judge, expectedJudge)
  assert.deepEqual(merged.criteria, verdict.criteria)
  assert.equal(merged.confidence, 'medium')
  assert.deepEqual(merged.violations, ['missing causal evidence'])

  const absent = mergeBlindVerdict({
    packet,
    expectedJudge,
    judgeEvidence: null,
    verdict: null,
  })
  assert.equal(absent.status, 'unjudged')
  for (const mutate of [
    evidence => { evidence.judgeEvidence.stdin = Buffer.from('changed stdin') },
    evidence => { evidence.judgeEvidence.pendingReceipt.snapshot.request.runId = 'other-run' },
    evidence => { evidence.judgeEvidence.pendingReceipt.snapshot.request.driverId = 'claude' },
    evidence => { evidence.judgeEvidence.terminalReceipt.snapshot.terminalResult.observedModelId = 'wrong-model' },
    evidence => { evidence.judgeEvidence.terminalReceipt.snapshot.nativeSessionId = 'foreign-session' },
    evidence => { evidence.judgeEvidence.terminalReceipt.snapshot.revision = 0 },
  ]) {
    const evidence = judgeOwnerEvidence(expectedJudge, packet)
    mutate(evidence)
    const result = mergeBlindVerdict({ packet, expectedJudge, ...evidence, verdict })
    assert.equal(result.status, 'invalid')
  }
})

test('abstention is explicit and incomplete criteria or fabricated verdict fields cannot become judged', async () => {
  const contract = validLaunchable()
  const packet = await buildBlindJudgePacket({
    contract,
    scenarioId: contract.scenarios[0].id,
    armScore: blindArmScore(contract),
  }, { readAnonymizedDeliverables: async () => [{ artifactId: 'a', mediaType: 'text/plain', content: 'x' }] })
  const expectedJudge = { driverId: 'claude', modelId: 'claude-opus-4-1', runId: 'judge-g3-2' }
  const evidence = judgeOwnerEvidence(expectedJudge, packet)
  const abstained = mergeBlindVerdict({
    packet,
    expectedJudge,
    ...evidence,
    verdict: judgedVerdict(packet, 'abstained'),
  })
  assert.equal(abstained.status, 'abstained')

  for (const mutate of [
    verdict => { verdict.packetId = 'wrong' },
    verdict => { verdict.criteria.pop() },
    verdict => { verdict.criteria[0].criterionId = 'unknown' },
    verdict => { verdict.criteria[0].status = 'pass' },
    verdict => { verdict.criteria[0].confidence = 'certain' },
    verdict => { verdict.absoluteScore = 1 },
  ]) {
    const verdict = judgedVerdict(packet)
    mutate(verdict)
    const result = mergeBlindVerdict({ packet, expectedJudge, ...evidence, verdict })
    assert.notEqual(result.status, 'judged')
  }
})

function pairedRow(contract, condition, scenario, packet, judgment, score = blindArmScore(contract, condition.id, scenario.id)) {
  return {
    armId: scenario.id + ':' + condition.id,
    scenarioId: scenario.id,
    conditionId: condition.id,
    fixtureSha: contract.fixture.baseSha,
    score,
    judgment,
    packet,
  }
}

test('paired outcomes compare only frozen reciprocal plugin/baseline mates in the same scenario and judge model', async () => {
  const contract = validLaunchable()
  const scenario = contract.scenarios[0]
  const pluginCondition = contract.conditions.find(condition => condition.pluginEnabled)
  const baselineCondition = contract.conditions.find(condition => condition.id === pluginCondition.matchedConditionId)
  const pluginScore = blindArmScore(contract, pluginCondition.id, scenario.id)
  const baselineScore = blindArmScore(contract, baselineCondition.id, scenario.id)
  const pluginPacket = await buildBlindJudgePacket({ contract, scenarioId: scenario.id, armScore: pluginScore }, {
    readAnonymizedDeliverables: async () => [{ artifactId: 'a-001', mediaType: 'text/plain', content: 'A' }],
  })
  const baselinePacket = await buildBlindJudgePacket({ contract, scenarioId: scenario.id, armScore: baselineScore }, {
    readAnonymizedDeliverables: async () => [{ artifactId: 'a-002', mediaType: 'text/plain', content: 'B' }],
  })
  const judge = { driverId: 'codex', modelId: 'gpt-5.6-sol', runId: 'pair-judge' }
  const pluginJudgment = {
    status: 'judged', judge: clone(judge), confidence: 'high', violations: [],
    criteria: pluginPacket.criteria.map(c => ({ criterionId: c.id, status: 'met', confidence: 'high', violations: [], evidence: ['A'] })),
  }
  const baselineJudgment = {
    status: 'judged', judge: clone(judge), confidence: 'high', violations: ['gap'],
    criteria: baselinePacket.criteria.map((c, index) => ({ criterionId: c.id, status: index ? 'met' : 'gap', confidence: index === 1 ? 'medium' : 'high', violations: index ? [] : ['gap'], evidence: ['B'] })),
  }
  const plugin = pairedRow(contract, pluginCondition, scenario, pluginPacket, pluginJudgment, pluginScore)
  const baseline = pairedRow(contract, baselineCondition, scenario, baselinePacket, baselineJudgment, baselineScore)
  const compared = pairGauntletOutcomes({ contract, plugin, baseline })
  assert.equal(compared.comparison, 'plugin-better')
  assert.equal(compared.confidence, 'medium')

  const invalidPairs = [
    ['cross-scenario', rows => { rows.baseline.scenarioId = contract.scenarios[1].id }],
    ['non-mate', rows => { rows.baseline.conditionId = contract.conditions.find(c => c.id !== baselineCondition.id).id }],
    ['fixture drift', rows => { rows.baseline.fixtureSha = 'f'.repeat(40) }],
    ['different judge model', rows => { rows.baseline.judgment.judge.modelId = 'other-judge' }],
    ['unjudged', rows => { rows.baseline.judgment.status = 'unjudged' }],
    ['invalid deterministic score', rows => { rows.baseline.score.status = 'invalid'; rows.baseline.score.absoluteScore = null }],
    ['partial frozen criteria', rows => { rows.plugin.packet.criteria.pop() }],
  ]
  const incomplete = []
  for (const [label, mutate] of invalidPairs) {
    const rows = clone({ plugin, baseline })
    mutate(rows)
    const result = pairGauntletOutcomes({ contract, ...rows })
    incomplete.push([label, result.comparison, result.confidence])
  }
  assert.deepEqual(incomplete, invalidPairs.map(([label]) => [label, 'incomplete', null]))
})


function deterministicIndex(contract, armId = contract.scenarios[0].id + ':' + contract.conditions[0].id) {
  const [scenarioId, conditionId] = armId.split(':')
  const scenario = contract.scenarios.find(value => value.id === scenarioId)
  const condition = contract.conditions.find(value => value.id === conditionId)
  return {
    contract,
    arms: [{
      armId,
      scenarioId,
      conditionId,
      runId: 'g3-' + scenarioId + '--' + conditionId,
      request: {
        arcId: scenario.arcIds[0],
        runId: 'g3-' + scenarioId + '--' + conditionId,
        executorId: 'executor-' + conditionId,
        phase: 43,
        roleId: 'gauntlet-parent',
        driverId: condition.parent.driverId,
        model: condition.parent.modelId,
        worktree: '/tmp/gauntlet-3-score/' + scenarioId + '--' + conditionId,
        baseHead: contract.fixture.baseSha,
        requestedHead: contract.fixture.baseSha,
        authorityRef: runnerAuthorityRef(contract),
      },
      worktree: '/tmp/gauntlet-3-score/' + scenarioId + '--' + conditionId,
      deliveryArcIds: [...scenario.arcIds],
      repositoryId: contract.externalActionAuthority.repositoryNamespace + '/' + scenarioId + '-' + conditionId,
    }],
  }
}

function missingDeterministicPorts() {
  return {
    readRunReceipt: () => null,
    loadArcDelivery: () => null,
    readLifecycleCases: () => null,
    readResumeObservations: () => null,
    readNormalizationObservation: () => null,
    readCleanupObservation: () => null,
    readEvaluationObservation: () => null,
    git: () => { throw new Error('missing git evidence') },
  }
}

test('deterministic scoring is fail-closed for every named sentinel when canonical evidence is missing', async () => {
  const contract = validLaunchable()
  const index = deterministicIndex(contract)
  const armId = index.arms[0].armId
  const result = await scoreDeterministicSentinels({ contract, index, armId }, missingDeterministicPorts())
  assert.equal(result.armId, armId)
  assert.equal(result.status, 'invalid')
  assert.equal(result.absoluteScore, null)
  assert.deepEqual(result.sentinels.map(sentinel => sentinel.name), [...SENTINEL_NAMES])
  assert.equal(result.sentinels.length, 11)
  assert.ok(result.sentinels.every(sentinel =>
    ['missing', 'unreadable'].includes(sentinel.status) &&
    Array.isArray(sentinel.ownerRefs) &&
    Array.isArray(sentinel.evidence) &&
    typeof sentinel.reason === 'string' &&
    sentinel.reason.length > 0))
})

test('deterministic scoring preserves unreadable owner failures and rejects caller score fabrication', async () => {
  const contract = validLaunchable()
  const index = deterministicIndex(contract)
  const armId = index.arms[0].armId
  const ports = missingDeterministicPorts()
  ports.readLifecycleCases = () => { throw new Error('malformed retained lifecycle JSON') }
  ports.readResumeObservations = () => { throw new Error('stale canonical receipt') }
  ports.readNormalizationObservation = () => { throw new Error('normalization digest mismatch') }
  ports.readCleanupObservation = () => { throw new Error('unsafe cleanup observation') }
  ports.readEvaluationObservation = () => { throw new Error('evaluation summary unreadable') }
  const result = await scoreDeterministicSentinels({ contract, index, armId }, ports)
  assert.equal(result.status, 'invalid')
  assert.equal(result.absoluteScore, null)
  assert.ok(result.sentinels.some(sentinel =>
    sentinel.status === 'unreadable' && /malformed|stale|digest|unsafe|evaluation|unreadable/i.test(sentinel.reason)))

  assert.throws(() => scoreDeterministicSentinels({
    contract,
    index,
    armId,
    absoluteScore: 1,
  }, missingDeterministicPorts()), /absoluteScore|fabricat|caller|unknown/i)
})


function deterministicPositiveFixture(contract) {
  const index = deterministicIndex(contract)
  const arm = index.arms[0]
  const scenario = contract.scenarios.find(value => value.id === arm.scenarioId)
  const head = contract.fixture.baseSha
  const base = '0'.repeat(40)
  const at = '2026-09-11T10:00:00.000Z'
  const deliveries = new Map()
  for (const arcId of scenario.arcIds) {
    const target = {
      targetKey: 'target-' + arcId,
      providerId: 'github',
      repositoryId: arm.repositoryId,
      baseRef: 'main',
      headRef: 'feat/' + arcId,
      currentBaseSha: base,
      currentHeadSha: head,
    }
    deliveries.set(arcId, {
      schemaVersion: 1,
      revision: 4,
      arcId,
      deliveryKey: deliveryKeyOf(target),
      target,
      strategy: { kind: 'independent', arcId },
      requested: {
        terminal: 'open',
        allowedPushRefs: ['feat/' + arcId],
        requiredCapabilities: ['pull-request'],
        requiredChecks: ['unit'],
        authority: { queue: null, merge: null },
      },
      actions: [],
      pullRequest: {
        providerId: 'github',
        repositoryId: arm.repositoryId,
        targetKey: target.targetKey,
        providerPullRequestId: 'PR-' + arcId,
        number: 1,
        url: 'https://github.test/' + arcId,
        state: 'open',
        draft: false,
        baseRef: 'main',
        headRef: 'feat/' + arcId,
        baseSha: base,
        headSha: head,
        observedAt: at,
      },
      checks: {
        providerId: 'github',
        repositoryId: arm.repositoryId,
        providerPullRequestId: 'PR-' + arcId,
        headSha: head,
        requiredChecks: ['unit'],
        observedChecks: [{ name: 'unit', status: 'green', attemptId: '1', observedAt: at }],
        observedAt: at,
      },
      terminal: { status: 'open-green', headSha: head, checksObservedAt: at },
      createdAt: at,
      updatedAt: at,
    })
  }
  const routeFor = (arcId, planned = false) => {
    const input = 'a'.repeat(64), signature = 'b'.repeat(64)
    const failure = { checkKey: 'check-run:7:unit', attemptId: '1', kind: 'causal', editEligible: true, paths: ['src/fix.mjs'], signature, diagnostic: { category: 'product', summary: 'unit failed', nextStep: 'repair', signature } }
    const validationCheckpoint = { arcId, verdict: 'GAPS', at, note: 'CI repair', correction: { state: 'awaiting-repair', validationHead: head, gateInputKey: input, round: 0, bounds: { maxRounds: 2, deadlineAt: '2026-09-12T00:00:00.000Z', allowedPathPrefixes: ['src'], authority: { source: 'session', reference: contract.externalActionAuthority.authorityRef } }, route: null } }
    const policy = { at, sourceHeadSha: head, predecessorHeadSha: base, authority: validationCheckpoint.correction.bounds.authority, stop: false, needsPlanning: planned, smallRepair: planned ? null : { phaseId: 42, criterionIds: ['repair'] }, plannedCorrection: planned ? { correctionId: 'CORR-' + arcId, phaseId: 44, criterionIds: ['planned'] } : null }
    return decideCorrectionRoute({
      failureDecisions: { status: 'classified', headSha: head, gateInputKey: input, failures: [failure], editPaths: ['src/fix.mjs'], retryDecision: { blocked: false, failures: [] } },
      validationCheckpoint,
      policy,
      delivery: (() => {
        const delivery = clone(deliveries.get(arcId))
        delete delivery.correctionBinding
        return delivery
      })(),
    })
  }
  for (const arcId of scenario.arcIds) deliveries.get(arcId).correctionBinding = routeFor(arcId).deliveryBinding
  const requestForArc = arcId => ({ ...clone(arm.request), arcId })
  const receiptForArc = (arcId, revision = 2) => ({
    path: '/owners/' + arcId + '/receipt-' + revision + '.json',
    digest: createHash('sha256').update(arcId + ':' + revision).digest('hex'),
    snapshot: {
      arcId,
      runId: arm.runId,
      request: requestForArc(arcId),
      nativeSessionId: 'native-' + arm.runId + '-' + arcId,
      pendingOperation: null,
      latestObservation: null,
      terminalResult: {
        status: 'transport-exited',
        driverId: arm.request.driverId,
        observedModelId: arm.request.model,
        nativeSessionId: 'native-' + arm.runId + '-' + arcId,
        exitCode: 0,
        signal: null,
        protocolTerminal: 'turn.completed',
        phaseResult: { status: 'done' },
      },
      outcome: 'complete',
      revision,
    },
  })

  const casesFor = arcId => scenario.criteria.map(criterion => {
    let output
    if (['blocked', 'stalled', 'unobserved', 'exited', 'review-exhausted', 'auth'].includes(criterion)) {
      output = buildHaltPayload(criterion, { phase: 43, evidence: { arcId, observed: true } })
    } else if (['quota', 'timeout'].includes(criterion)) {
      output = finalizeCiObservation({
        providerId: 'github',
        repositoryId: arm.repositoryId,
        providerPullRequestId: 'PR-' + arcId,
        sourceHeadSha: head,
        baseSha: base,
        requiredChecks: ['unit'],
        headMode: 'source',
        mergeQueue: null,
      }, { hold: { kind: criterion, remedy: 'resume after ' + criterion }, observedAt: at })
    } else if (['causal', 'owned-preexisting', 'unrelated', 'infrastructure', 'flaky', 'indeterminate'].includes(criterion)) {
      const kind = criterion === 'infrastructure' ? 'infra' : criterion
      const eligible = ['causal', 'owned-preexisting'].includes(criterion)
      const scope = eligible ? 'editable'
        : criterion === 'unrelated' ? 'unrelated'
          : ['infrastructure', 'flaky'].includes(criterion) ? 'retryable' : 'held'
      output = {
        status: criterion === 'indeterminate' ? 'held' : 'classified',
        scope,
        headSha: head,
        gateInputKey: 'a'.repeat(64),
        failures: [{ kind, editEligible: eligible, paths: eligible ? ['src/fix.mjs'] : [] }],
        editPaths: eligible ? ['src/fix.mjs'] : [],
        retryDecision: { blocked: !eligible, failures: [] },
        reasons: [],
      }
    } else if (criterion === 'validation-small-repair' || criterion === 'validation-planned-correction') {
      const kind = criterion === 'validation-small-repair' ? 'small-repair' : 'planned-correction'
      output = routeFor(arcId, kind === 'planned-correction')
    } else if (criterion === 'repeated-input') {
      output = { blocked: true, failures: [{ failure: { signature: 'repeat-' + arcId }, inputKey: 'same-input' }] }
    } else {
      output = { arcId }
    }
    return { criterion, invocationId: 'invocation-' + arcId + '-' + criterion, output }
  })
  const lifecycle = {
    schemaVersion: 1,
    armId: arm.armId,
    scenarioId: scenario.id,
    arcs: scenario.arcIds.map(arcId => ({ arcId, cases: casesFor(arcId) })),
  }
  const resumes = {
    schemaVersion: 1,
    armId: arm.armId,
    scenarioId: scenario.id,
    arcs: scenario.arcIds.map(arcId => {
      const firstReceipt = receiptForArc(arcId, 1)
      const secondReceipt = receiptForArc(arcId, 2)
      const delivery = deliveries.get(arcId)
      return {
        arcId,
        first: { invocationId: 'first-' + arcId, runAddress: { arcId, runId: arm.runId }, runReceipt: firstReceipt, delivery: clone(delivery) },
        second: { invocationId: 'second-' + arcId, runAddress: { arcId, runId: arm.runId }, runReceipt: secondReceipt, delivery: clone(delivery) },
      }
    }),
  }
  const normalizations = {
    arcs: scenario.arcIds.map(arcId => {
      const planBody = {
        version: 1,
        arcId,
        base,
        expectedHead: head,
        expectedTree: 'a'.repeat(40),
        phases: [1, 2, 3, 4, 5, 6],
        groups: [1, 2, 3, 4, 5, 6].map(phase => ({
          phase,
          sourceBoundary: { sha: String(phase).repeat(40), tree: 'a'.repeat(40) },
        })),
        delivery: { publication: 'unpublished', green: false, pullRequest: null },
      }
      const planDigest = createHash('sha256').update(JSON.stringify(planBody) + '\n').digest('hex')
      const plan = { ...planBody, planDigest }
      return {
        arcId,
        plan,
        receipt: {
          version: 1,
          arcId,
          base,
          planDigest,
          oldHead: head,
          newHead: 'f'.repeat(40),
          tree: plan.expectedTree,
          rescueRef: 'refs/curate-rescue/' + head.slice(0, 12),
          outcomes: plan.groups.map(group => ({
            phase: group.phase,
            sourceCommit: group.sourceBoundary.sha,
            sourceTree: group.sourceBoundary.tree,
            normalizedCommit: String.fromCharCode(96 + group.phase).repeat(40),
          })),
        },
      }
    }),
  }
  const cleanup = {
    cases: Array.from({ length: 50 }, (_, index) => {
      const worktree = '/tmp/gc/' + index
      if (index !== 0) return {
        identity: null,
        worktree,
        result: { plan: { items: [{ worktree, identity: null, classification: 'ownership-uncertain', reason: 'ownership-uncertain', observations: [], evidence: null }] }, applied: { items: [] } },
        after: { exists: true, headSha: null, recoverableHeadSha: null, branchRefSha: null },
      }
      const identity = { ownershipId: 'ownership-0' }
      return {
        identity,
        worktree,
        result: {
          plan: { items: [{ worktree, identity, classification: 'eligible', evidence: { head, clean: true, recoverable: true, liveness: 'inactive', protection: { state: 'unprotected', evidence: [], reason: null } }, observations: [{ invocationId: 'gc-1', observedAt: at }, { invocationId: 'gc-2', observedAt: '2026-09-11T10:01:00.000Z' }] }] },
          applied: { items: [{ ownershipId: identity.ownershipId, state: 'removed', reason: 'eligible', disposal: { disposed: true } }] },
        },
        after: { exists: false, headSha: head, recoverableHeadSha: head, branchRefSha: head },
      }
    }),
  }
  const summaries = new Map([...deliveries].map(([arcId, delivery]) => [arcId, buildDeliverySummary({
    delivery,
    arc: { id: arcId, acceptanceCriteria: [] },
    sweep: { arcId, overall: 'green', blockers: [], debtDispositions: [], observation: { headSha: head, recordedAt: at } },
    validation: { arcId, verdict: 'PASS', at, headSha: head },
    panel: null,
  })]))
  for (const arc of lifecycle.arcs) {
    const byCriterion = new Map(arc.cases.map(row => [row.criterion, row]))
    const normalization = normalizations.arcs.find(row => row.arcId === arc.arcId)
    byCriterion.get('history-normalization').output = { plan: clone(normalization.plan), receipt: clone(normalization.receipt) }
    byCriterion.get('worktree-gc').output = clone(cleanup)
    byCriterion.get('exact-head-green').output = clone(deliveries.get(arc.arcId))
    byCriterion.get('evaluation').output = clone(summaries.get(arc.arcId))
    byCriterion.get('second-resume').output = clone(resumes.arcs.find(row => row.arcId === arc.arcId).second)
  }
  const ports = {
    readRunReceipt: (_cwd, address, opts) => {
      const first = receiptForArc(address.arcId, 1)
      const current = receiptForArc(address.arcId, 2)
      if (!opts) return current
      if (opts.digest === first.digest) return first
      if (opts.digest === current.digest) return current
      return null
    },
    loadArcDelivery: (_cwd, arcId) => clone(deliveries.get(arcId)),
    readLifecycleCases: () => clone(lifecycle),
    readResumeObservations: () => clone(resumes),
    readNormalizationObservation: () => clone(normalizations),
    readCleanupObservation: () => clone(cleanup),
    readEvaluationObservation: ({ arcId }) => ({ summary: clone(summaries.get(arcId)) }),
    git: (_root, argv) => {
      const joined = argv.join(' ')
      if (joined.includes('--name-only') || joined.includes('--name-only -z')) return ''
      if (joined.includes('--format=%P')) {
        const commit = argv.at(-1)
        const code = commit.charCodeAt(0)
        return code === 97 ? base : String.fromCharCode(code - 1).repeat(40)
      }
      if (joined.includes('merge-base')) return 'f'.repeat(40)
      if (joined.includes('^{tree}')) return 'a'.repeat(40)
      if (joined.includes('rev-parse')) return head
      return ''
    },
  }
  return { index, arm, scenario, ports, evidence: { lifecycle, resumes, normalizations, cleanup, deliveries, summaries } }
}

test('valid raw owner evidence passes all eleven deterministic sentinels and every named mutation removes the absolute score', async () => {
  const contract = validLaunchable()
  const make = () => deterministicPositiveFixture(contract)
  const valid = make()
  const baseline = await scoreDeterministicSentinels({
    contract,
    index: valid.index,
    armId: valid.arm.armId,
  }, valid.ports)
  assert.equal(baseline.status, 'valid', JSON.stringify(baseline))
  assert.equal(baseline.absoluteScore, 1)
  assert.deepEqual(baseline.sentinels.map(sentinel => [sentinel.name, sentinel.status]),
    SENTINEL_NAMES.map(name => [name, 'pass']))

  const mutations = [
    ['native-run-terminal', f => {
      const original = f.ports.readRunReceipt
      f.ports.readRunReceipt = (...args) => {
        const receipt = original(...args)
        receipt.snapshot.terminalResult.observedModelId = 'wrong-model'
        return receipt
      }
    }],
    ['stable-pr-identity', f => { f.evidence.resumes.arcs[0].second.delivery.pullRequest.providerPullRequestId = 'PR-changed' }],
    ['branch-strategy', f => { f.evidence.deliveries.get(f.scenario.arcIds[0]).strategy.kind = 'grouped' }],
    ['repair-classification', f => {
      const row = f.evidence.lifecycle.arcs[0].cases.find(value => value.criterion === 'causal')
      row.output.failures[0].editEligible = false
    }],
    ['bounded-review', f => { f.evidence.deliveries.get(f.scenario.arcIds[0]).correctionBinding.round = 3 }],
    ['history-normalization', f => { f.evidence.normalizations.arcs[0].receipt.tree = 'e'.repeat(40) }],
    ['gc-identity-recoverability', f => { f.evidence.cleanup.cases[0].after.exists = true }],
    ['exact-head-green', f => { f.evidence.deliveries.get(f.scenario.arcIds[0]).checks.headSha = 'e'.repeat(40) }],
    ['terminal-evaluation', f => { f.evidence.summaries.delete(f.scenario.arcIds[0]) }],
    ['idempotent-second-resume', f => { f.evidence.resumes.arcs[0].second.runAddress.runId = 'changed-run' }],
    ['scenario-lifecycle-coverage', f => { f.evidence.lifecycle.armId = 'foreign:arm' }],
    ['repair-classification', f => {
      const originalGit = f.ports.git
      f.ports.git = (root, argv) =>
        argv.includes('diff') && argv.includes('--name-only') ? 'unrelated/file.mjs\0' : originalGit(root, argv)
    }],
    ['history-normalization', f => {
      const row = f.evidence.normalizations.arcs[0]
      row.plan.delivery = { publication: 'published', green: true, pullRequest: null }
      const body = clone(row.plan)
      delete body.planDigest
      row.plan.planDigest = createHash('sha256').update(JSON.stringify(body) + '\n').digest('hex')
      row.receipt.planDigest = row.plan.planDigest
    }],
    ['idempotent-second-resume', f => {
      f.evidence.resumes.arcs[0].second.delivery.actions.push({
        id: 'late-provider-action',
        status: 'succeeded',
        attempts: [{ attempt: 1, status: 'succeeded' }],
      })
    }],
    ['terminal-evaluation', f => {
      f.evidence.summaries.get(f.scenario.arcIds[0]).delivery.sourceHeadSha = 'e'.repeat(40)
    }],
  ]
  for (const [name, mutate] of mutations) {
    const fixture = make()
    mutate(fixture)
    const result = await scoreDeterministicSentinels({
      contract,
      index: fixture.index,
      armId: fixture.arm.armId,
    }, fixture.ports)
    assert.equal(result.status, 'invalid', name + ': ' + JSON.stringify(result))
    assert.equal(result.absoluteScore, null, name)
    assert.notEqual(result.sentinels.find(sentinel => sentinel.name === name)?.status, 'pass', name)
  }
})
