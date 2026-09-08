import { pathToFileURL } from 'node:url'

const CRITERIA = ['blocked', 'stalled', 'unobserved', 'exited', 'review-exhausted',
  'validation-small-repair', 'validation-planned-correction', 'causal', 'owned-preexisting',
  'unrelated', 'infrastructure', 'flaky', 'indeterminate', 'auth', 'quota', 'timeout',
  'repeated-input', 'history-normalization', 'worktree-gc', 'exact-head-green', 'evaluation', 'second-resume']
const STRATEGIES = ['independent', 'stacked', 'grouped']
const PAIRS = [['claude', 'claude'], ['claude', 'codex'], ['codex', 'codex'], ['codex', 'claude']]
const OPERATIONS = ['create-repository', 'push', 'pull-request', 'read-ci']
const LIMITS = { laneCount: 20, gcIdentityCount: 50, historyPhaseCount: 6, maxConcurrentArcs: 3 }
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
const namespace = value => typeof value === 'string' && value.split('/').every(identifier)
const nonblank = value => typeof value === 'string' && value.trim().length > 0
function requireThat(ok, message) { if (!ok) throw new Error(`Invalid gauntlet contract: ${message}`) }
function keys(value, expected, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`)
  requireThat(Object.keys(value).every(key => expected.includes(key)), `${name} unknown field`)
  for (const key of expected) requireThat(Object.hasOwn(value, key), `${name}.${key} required`)
}
function setOf(value, expected, name) {
  requireThat(Array.isArray(value) && value.length === expected.length && new Set(value).size === value.length && expected.every(x => value.includes(x)), `${name} missing, duplicated or unexpected values`)
}
function strings(value, name) {
  requireThat(Array.isArray(value) && value.length > 0 && value.every(nonblank) && new Set(value).size === value.length, `${name} requires unique nonempty strings`)
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value) }
  return value
}

export const SCENARIOS = deepFreeze(STRATEGIES.map(branchStrategy => ({
  id: branchStrategy, branchStrategy,
  arcIds: [1, 2, 3].map(n => `${branchStrategy}-arc-${n}`),
  fixtureKey: `lifecycle-${branchStrategy}`, fixtureSha: null,
  criteria: [...CRITERIA], expectedDisposition: 'exact-head-green',
  interruptionPoints: ['before-pr-creation', 'after-provider-success', 'second-resume'],
})))
export const GAUNTLET_3_CONTRACT = deepFreeze({
  schemaVersion: 3, contractId: 'gauntlet-3.0',
  conditions: PAIRS.flatMap(([parent, child]) => [true, false].map(pluginEnabled => ({
    id: `${parent}-${child}-${pluginEnabled ? 'plugin' : 'baseline'}`,
    parent: { driverId: parent, modelId: null }, child: { driverId: child, modelId: null }, pluginEnabled,
    matchedConditionId: `${parent}-${child}-${pluginEnabled ? 'baseline' : 'plugin'}`,
  }))),
  scenarios: structuredClone(SCENARIOS), requiredCriteria: [...CRITERIA],
  fixture: { baseSha: null, sealedPacketIds: ['lifecycle-acceptance-v1'] },
  limits: { ...LIMITS }, budget: null, externalActionAuthority: null,
})

/** Validate declarations only. Current authority expiry is checked by the preflight clock. */
export function validateGauntletContract(value, { requireLaunchable = false } = {}) {
  keys(value, ['schemaVersion', 'contractId', 'conditions', 'scenarios', 'requiredCriteria', 'fixture', 'limits', 'budget', 'externalActionAuthority'], 'contract')
  requireThat(value.schemaVersion === 3 && value.contractId === 'gauntlet-3.0', 'unsupported contract version')
  setOf(value.requiredCriteria, CRITERIA, 'requiredCriteria')
  keys(value.fixture, ['baseSha', 'sealedPacketIds'], 'fixture')
  requireThat(sha(value.fixture.baseSha) || (!requireLaunchable && value.fixture.baseSha === null), 'fixture base SHA required')
  strings(value.fixture.sealedPacketIds, 'sealedPacketIds')
  keys(value.limits, Object.keys(LIMITS), 'limits')
  for (const [key, expected] of Object.entries(LIMITS)) requireThat(value.limits[key] === expected, `limits.${key} must equal ${expected}`)
  requireThat(Array.isArray(value.conditions), 'conditions required')
  setOf(value.conditions.map(c => c?.id), GAUNTLET_3_CONTRACT.conditions.map(c => c.id), 'conditions baseline pairs')
  for (const condition of value.conditions) {
    keys(condition, ['id', 'parent', 'child', 'pluginEnabled', 'matchedConditionId'], 'condition')
    const expected = GAUNTLET_3_CONTRACT.conditions.find(c => c.id === condition.id)
    requireThat(condition.pluginEnabled === expected.pluginEnabled && condition.matchedConditionId === expected.matchedConditionId, 'condition matched pair mismatch')
    const mate = value.conditions.find(c => c.id === condition.matchedConditionId)
    for (const role of ['parent', 'child']) {
      keys(condition[role], ['driverId', 'modelId'], role)
      requireThat(condition[role].driverId === expected[role].driverId, `${role} driver mismatch`)
      requireThat(nonblank(condition[role].modelId) || (!requireLaunchable && condition[role].modelId === null), `${role} model required`)
      requireThat(condition[role].modelId === mate?.[role]?.modelId, `${role} model matched pair mismatch`)
    }
  }
  requireThat(Array.isArray(value.scenarios) && value.scenarios.length === 3, 'three scenarios required')
  setOf(value.scenarios.map(s => s?.branchStrategy), STRATEGIES, 'scenario branch strategies')
  strings(value.scenarios.map(s => s.id), 'scenario IDs')
  const arcIds = []
  for (const scenario of value.scenarios) {
    keys(scenario, ['id', 'branchStrategy', 'arcIds', 'fixtureKey', 'fixtureSha', 'criteria', 'expectedDisposition', 'interruptionPoints'], 'scenario')
    strings(scenario.arcIds, 'scenario arcIds')
    requireThat(identifier(scenario.id) && identifier(scenario.fixtureKey) && scenario.arcIds.every(identifier), 'scenario identifiers must be safe namespace components')
    requireThat(scenario.arcIds.length === 3, 'scenario requires three arcIds')
    arcIds.push(...scenario.arcIds)
    requireThat(nonblank(scenario.fixtureKey) && nonblank(scenario.expectedDisposition), 'scenario fixtureKey and expectedDisposition required')
    requireThat(scenario.fixtureSha === value.fixture.baseSha, 'scenario fixture SHA mismatch')
    strings(scenario.criteria, 'scenario criteria')
    requireThat(scenario.criteria.every(c => CRITERIA.includes(c)), 'unknown scenario criteria')
    strings(scenario.interruptionPoints, 'scenario interruptionPoints')
  }
  requireThat(new Set(arcIds).size === arcIds.length, 'duplicate scenario arcIds')
  setOf([...new Set(value.scenarios.flatMap(s => s.criteria))], CRITERIA, 'scenario criteria coverage')
  if (value.budget === null) requireThat(!requireLaunchable, 'budget required for launch')
  else {
    keys(value.budget, ['totalNativeMs', 'totalTokens', 'perArmTimeoutMs', 'maxConcurrentArms'], 'budget')
    for (const [key, n] of Object.entries(value.budget)) requireThat(Number.isSafeInteger(n) && n > 0, `budget.${key} must be a positive safe integer`)
    requireThat(value.budget.maxConcurrentArms <= value.limits.laneCount, 'budget.maxConcurrentArms exceeds lane limit')
    requireThat(value.budget.perArmTimeoutMs <= value.budget.totalNativeMs, 'budget perArmTimeoutMs exceeds totalNativeMs')
  }
  if (value.externalActionAuthority === null) requireThat(!requireLaunchable, 'externalActionAuthority required for launch')
  else {
    const authority = value.externalActionAuthority
    keys(authority, ['authorityRef', 'repositoryNamespace', 'providerNamespace', 'allowedOperations', 'expiresAt'], 'externalActionAuthority')
    for (const field of ['authorityRef', 'repositoryNamespace', 'providerNamespace']) requireThat(nonblank(authority[field]) && !/[\s\x00-\x1f]/.test(authority[field]), `authority.${field} required and must be explicit`)
    requireThat(namespace(authority.repositoryNamespace) && namespace(authority.providerNamespace), 'authority namespace must contain safe explicit components')
    strings(authority.allowedOperations, 'authority allowedOperations')
    requireThat(authority.allowedOperations.every(op => OPERATIONS.includes(op)), 'unsupported authority allowedOperations')
    requireThat(typeof authority.expiresAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(authority.expiresAt) && Number.isFinite(Date.parse(authority.expiresAt)), 'authority expiresAt must be ISO UTC')
  }
  return deepFreeze(structuredClone(value))
}

export function freezeGauntletContract(template, { budget, externalActionAuthority, fixtureSha }) {
  const value = structuredClone(validateGauntletContract(template))
  requireThat(value.budget === null && value.externalActionAuthority === null && value.fixture.baseSha === null && value.scenarios.every(s => s.fixtureSha === null), 'launch fields already frozen; fill once only')
  value.budget = structuredClone(budget)
  value.externalActionAuthority = structuredClone(externalActionAuthority)
  value.fixture.baseSha = fixtureSha
  for (const scenario of value.scenarios) scenario.fixtureSha = fixtureSha
  return validateGauntletContract(value, { requireLaunchable: true })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--validate') throw new Error('Usage: scenarios.mjs --validate')
  validateGauntletContract(GAUNTLET_3_CONTRACT)
  console.log('Gauntlet 3 authoring contract valid; launch fields remain unset.')
}
