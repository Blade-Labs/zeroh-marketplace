import { isAbsolute, normalize, sep } from 'node:path'
import { validateGauntletContract } from './scenarios.mjs'

const text = x => typeof x === 'string' && x.trim().length > 0
const canonical = x => text(x) && isAbsolute(x) && normalize(x) === x
const unique = xs => Array.isArray(xs) && xs.every(text) && new Set(xs).size === xs.length
const shape = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(f => Object.hasOwn(value, f))
const sameSet = (a, b) => unique(a) && a.length === b.length && b.every(x => a.includes(x))
const beneath = (a, b) => a === b || a.startsWith(b.endsWith(sep) ? b : b + sep)

/** Read-only dependency observations. Ready is not a native run or provider mutation receipt. */
export async function preflightGauntlet({ contract }, { probeBinary, probePlugin, probeNamespace, clock = () => new Date().toISOString() } = {}) {
  const reasons = []
  let refused = false
  const issue = (code, message, contradiction = false) => { reasons.push({ code, message }); refused ||= contradiction }
  const observed = { at: clock(), contractId: 'gauntlet-3.0', binaries: [], plugin: null, namespaces: [], budget: null, authority: null }
  const result = () => ({ status: refused ? 'refused' : reasons.length ? 'unavailable' : 'ready', reasons, observed })
  try { contract = validateGauntletContract(contract) }
  catch (error) { issue('contract', error.message, true); return result() }
  observed.budget = contract.budget
  observed.authority = contract.externalActionAuthority
  if (!Number.isFinite(Date.parse(observed.at))) { issue('clock', 'Invalid preflight clock', true); return result() }
  if (!contract.budget) issue('budget', 'Explicit native budget unavailable')
  if (!contract.externalActionAuthority) issue('authority', 'Explicit external action authority unavailable')
  if (!contract.fixture.baseSha) issue('fixture', 'Frozen fixture SHA unavailable')
  if (contract.conditions.some(c => !c.parent.modelId || !c.child.modelId)) issue('model', 'Exact requested parent/child models unavailable')
  if (contract.externalActionAuthority && Date.parse(contract.externalActionAuthority.expiresAt) <= Date.parse(observed.at)) issue('authority-expired', 'External action authority expired', true)
  if (reasons.length) return result()
  const probe = async (name, fn) => {
    if (typeof fn !== 'function') { issue(name, `${name} probe unavailable`); return null }
    try { return await fn({ contract }) }
    catch (error) { issue(name, `${name} probe failed: ${error.message}`); return null }
  }
  const binaries = await probe('binary', probeBinary)
  if (!Array.isArray(binaries)) issue('binary', 'Binary observations unavailable')
  else {
    observed.binaries = binaries
    if (!sameSet(binaries.map(b => b?.driverId), ['claude', 'codex'])) issue('binary', 'Both unique driver observations required', true)
    for (const binary of binaries) {
      if (!shape(binary, ['driverId', 'realpath', 'version', 'requestedModelIds', 'modelCapability'])) { issue('binary', 'Incomplete or unknown binary observation fields'); continue }
      if (!canonical(binary.realpath) || !text(binary.version)) { issue('binary', 'Binary canonical realpath/version unavailable'); continue }
      const requested = [...new Set(contract.conditions.flatMap(c => [c.parent, c.child]).filter(r => r.driverId === binary.driverId).map(r => r.modelId))]
      if (!sameSet(binary.requestedModelIds, requested)) issue('binary-model', 'Binary requested models mismatch', true)
      if (binary.modelCapability !== 'declared') issue('binary-capability', 'Requested model capability unavailable')
    }
    if (new Set(binaries.map(b => b?.realpath)).size !== binaries.length) issue('binary-path', 'Driver executables share a realpath', true)
  }
  // Both hashes describe corresponding candidate/installed manifest bytes, never a whole-tree hash.
  const plugin = await probe('plugin', probePlugin)
  observed.plugin = plugin
  if (!plugin || plugin.status === 'missing') issue('plugin', 'Installed plugin unavailable')
  else if (!shape(plugin, ['manifestPath', 'manifestHash', 'installedRoot', 'installedHash', 'status']) || plugin.status !== 'matched' || !canonical(plugin.manifestPath) || !canonical(plugin.installedRoot)
    || !/^[a-f0-9]{64}$/.test(plugin.manifestHash) || !/^[a-f0-9]{64}$/.test(plugin.installedHash)
    || plugin.manifestHash !== plugin.installedHash || !beneath(plugin.manifestPath, plugin.installedRoot)) issue('plugin', 'Installed plugin bytes/identity mismatch', true)
  const namespaces = await probe('namespace', probeNamespace)
  if (!Array.isArray(namespaces)) issue('namespace', 'Namespace observations unavailable')
  else {
    observed.namespaces = namespaces
    const expected = contract.scenarios.flatMap(s => contract.conditions.map(c => `${s.id}:${c.id}`))
    if (!sameSet(namespaces.map(n => n?.armId), expected)) issue('namespace', 'Unique isolated namespace per arm required', true)
    const authority = contract.externalActionAuthority
    for (const ns of namespaces) {
      const repo = ns?.repository, provider = ns?.provider
      if (!shape(ns, ['armId', 'repository', 'provider', 'isolated']) || !shape(repo, ['id', 'canonicalRoot', 'gitDir', 'remoteIdentity', 'isProduct']) || !shape(provider, ['id', 'accountId', 'credentialStatus', 'capabilities'])) { issue('namespace', 'Repository/provider identity unavailable'); continue }
      if (ns.isolated !== true || repo.isProduct !== false) issue('namespace-product', 'Product or non-isolated namespace refused', true)
      if (!text(repo.id) || !canonical(repo.canonicalRoot) || !canonical(repo.gitDir) || !text(provider.id) || !text(provider.accountId)) issue('namespace-identity', 'Canonical repository/provider identity unavailable')
      if (!text(repo.remoteIdentity) || !repo.remoteIdentity.startsWith(authority.repositoryNamespace + '/') || !text(provider.id) || !provider.id.startsWith(authority.providerNamespace + '/')) issue('namespace-authority', 'Namespace contradicts external authority', true)
      if (provider.credentialStatus !== 'ready') issue('credentials', 'Provider credentials unavailable or denied', provider.credentialStatus === 'denied')
      if (!unique(provider.capabilities) || !authority.allowedOperations.every(op => provider.capabilities.includes(op))) issue('capabilities', 'Required provider capabilities unavailable')
    }
    for (const get of [n => n?.repository?.id, n => n?.repository?.canonicalRoot, n => n?.repository?.gitDir, n => n?.provider?.id]) {
      if (new Set(namespaces.map(get)).size !== namespaces.length) issue('namespace-shared', 'Shared arm namespace refused', true)
    }
    const roots = namespaces.map(n => n?.repository?.canonicalRoot).filter(canonical)
    for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) {
      if (beneath(roots[i], roots[j]) || beneath(roots[j], roots[i])) issue('namespace-overlap', 'Nested arm roots refused', true)
    }
  }
  return result()
}
