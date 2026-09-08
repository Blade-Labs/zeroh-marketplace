import { createHash } from 'node:crypto'
import { isDeepStrictEqual as same } from 'node:util'

import { deliveryKeyOf, isDeliverySha } from './delivery.mjs'
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const exact = (value, keys, label) => {
  if (!plain(value) || !same(Object.keys(value).sort(), [...keys].sort())) throw new Error(`${label} has unknown or missing fields`)
}
const arcIdOf = value => {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('arc id must be a string or finite number')
  const id = String(value)
  if (!nonempty(id)) throw new Error('arc id must be nonempty')
  return id
}
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24)
const arcHead = id => `refs/heads/roadmap/arc-${hash(id)}`
const groupHead = id => `refs/heads/roadmap/group-${hash(id)}`
const arcTargetKey = id => JSON.stringify(['arc', id])
const groupTargetKey = id => JSON.stringify(['group', id])
function held(memberArcId, reason, ownerArcId = null, expected = null, observed = null) {
  return { status: 'held', ownerArcId, memberArcId, reason, expected, observed }
}
function validateInputs(input) {
  exact(input, ['arc', 'policy', 'deliveries', 'refs'], 'branch strategy input')
  if (!plain(input.arc)) throw new Error('arc must be an object')
  const memberArcId = arcIdOf(input.arc.id)
  exact(input.policy, ['providerId', 'repositoryId', 'defaultBaseRef', 'strategy'], 'branch policy')
  if (![input.policy.providerId, input.policy.repositoryId, input.policy.defaultBaseRef].every(nonempty)) throw new Error('branch policy provider, repository and default base ref must be nonempty')
  if (!plain(input.policy.strategy)) throw new Error('branch policy strategy must be a complete record')
  exact(input.refs, ['heads'], 'branch refs')
  if (!plain(input.refs.heads)) throw new Error('refs.heads must be a record')
  for (const [ref, sha] of Object.entries(input.refs.heads)) {
    if (!nonempty(ref) || typeof sha !== 'string' || !isDeliverySha(sha)) throw new Error(`malformed ref binding for ${ref}`)
  }
  if (!Array.isArray(input.deliveries)) throw new Error('deliveries must be an array')
  const strategies = new Map()
  for (const [rawId, rawStrategy] of Object.entries(input.policy.strategy)) {
    const id = arcIdOf(rawId)
    let strategy = rawStrategy
    if (strategies.has(id)) throw new Error(`duplicate normalized policy arc id ${id}`)
    if (!plain(strategy) || !nonempty(strategy.kind)) throw new Error(`malformed strategy for arc ${id}`)
    if (strategy.kind === 'independent') exact(strategy, ['kind'], `independent strategy for ${id}`)
    else if (strategy.kind === 'stacked') {
      exact(strategy, ['kind', 'predecessorArcId'], `stacked strategy for ${id}`)
      strategy = { kind: 'stacked', predecessorArcId: arcIdOf(strategy.predecessorArcId) }
    } else if (strategy.kind === 'grouped') {
      exact(strategy, ['kind', 'groupId', 'order'], `grouped strategy for ${id}`)
      if (!nonempty(strategy.groupId) || !Number.isInteger(strategy.order) || strategy.order < 0) throw new Error(`malformed grouped strategy for ${id}`)
    } else throw new Error(`unknown branch strategy kind for arc ${id}`)
    strategies.set(id, strategy)
  }
  if (!strategies.has(memberArcId)) throw new Error(`policy strategy is missing arc ${memberArcId}`)
  const visiting = new Set(), visited = new Set()
  function visit(id) {
    if (visiting.has(id)) throw new Error(`cycle in stacked branch strategy at arc ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    const strategy = strategies.get(id)
    if (strategy?.kind === 'stacked') {
      if (strategy.predecessorArcId === id) throw new Error(`self cycle in stacked branch strategy for arc ${id}`)
      const predecessor = strategies.get(strategy.predecessorArcId)
      if (!predecessor) throw new Error(`stacked predecessor ${strategy.predecessorArcId} is absent from policy`)
      if (predecessor.kind === 'grouped') throw new Error('grouped delivery cannot be a stacked predecessor')
      visit(strategy.predecessorArcId)
    }
    visiting.delete(id); visited.add(id)
  }
  for (const id of strategies.keys()) visit(id)
  const groups = new Map()
  for (const [id, strategy] of strategies) {
    if (strategy.kind !== 'grouped') continue
    const members = groups.get(strategy.groupId) ?? []
    members.push({ id, order: strategy.order }); groups.set(strategy.groupId, members)
  }
  for (const [groupId, members] of groups) {
    if (members.length < 2) throw new Error(`group ${groupId} must contain at least two members`)
    const orders = members.map(member => member.order).sort((a, b) => a - b)
    if (new Set(orders).size !== orders.length) throw new Error(`duplicate-order in group ${groupId}`)
    if (orders.some((order, index) => order !== index)) throw new Error(`group ${groupId} orders must be contiguous from zero`)
  }
  const deliveries = input.deliveries.map((entry, index) => {
    exact(entry, ['ownerArcId', 'delivery'], `delivery entry ${index}`)
    const ownerArcId = arcIdOf(entry.ownerArcId)
    if (!plain(entry.delivery) || !plain(entry.delivery.target) || !plain(entry.delivery.strategy) || !nonempty(entry.delivery.arcId) || !nonempty(entry.delivery.deliveryKey)) throw new Error(`malformed delivery entry ${index}`)
    return { ownerArcId, delivery: entry.delivery }
  })
  return { memberArcId, strategies, groups, deliveries }
}
function oneOwnedDelivery(deliveries, ownerArcId) {
  const found = deliveries.filter(entry => entry.ownerArcId === ownerArcId)
  if (found.length > 1) throw new Error(`multiple delivery receipts claim owner arc ${ownerArcId}`)
  return found[0]?.delivery ?? null
}

export function resolveBranchStrategy(input) {
  const { memberArcId, strategies, groups, deliveries } = validateInputs(input)
  const configured = strategies.get(memberArcId)
  let ownerArcId = memberArcId, memberOrder = null
  let targetKey = arcTargetKey(memberArcId), headRef = arcHead(memberArcId)
  let baseRef = input.policy.defaultBaseRef, baseSha, strategy
  if (configured.kind === 'stacked') {
    const predecessor = oneOwnedDelivery(deliveries, configured.predecessorArcId)
    if (!predecessor) return held(memberArcId, 'missing-predecessor', memberArcId, { predecessorArcId: configured.predecessorArcId }, null)
    if (predecessor.strategy.kind === 'grouped') throw new Error('grouped delivery cannot be a stacked predecessor')
    const predecessorId = configured.predecessorArcId
    if (predecessor.arcId !== predecessorId || predecessor.target.providerId !== input.policy.providerId || predecessor.target.repositoryId !== input.policy.repositoryId || predecessor.target.targetKey !== arcTargetKey(predecessorId) || predecessor.target.headRef !== arcHead(predecessorId) || predecessor.strategy.arcId !== predecessorId || predecessor.strategy.kind !== strategies.get(predecessorId).kind || predecessor.deliveryKey !== deliveryKeyOf({...input.policy,targetKey:arcTargetKey(predecessorId)})) throw new Error('stacked predecessor receipt has conflicting policy identity')
    const predecessorPolicy = strategies.get(predecessorId)
    const expectedStrategy = predecessorPolicy.kind === 'independent'
      ? { kind: 'independent', arcId: predecessorId }
      : { kind: 'stacked', arcId: predecessorId, predecessorTargetKey: arcTargetKey(predecessorPolicy.predecessorArcId), predecessorDeliveryKey: deliveryKeyOf({...input.policy,targetKey:arcTargetKey(predecessorPolicy.predecessorArcId)}) }
    if (!same(predecessor.strategy, expectedStrategy)) throw new Error('stacked predecessor strategy drift')
    baseRef = predecessor.target.headRef
    baseSha = predecessor.target.currentHeadSha
    const observedBase = input.refs.heads[baseRef]
    if (observedBase === undefined) return held(memberArcId, 'missing-ref', memberArcId, { ref: baseRef, sha: baseSha }, null)
    if (observedBase !== baseSha) return held(memberArcId, 'base-churn', memberArcId, { ref: baseRef, sha: baseSha }, { ref: baseRef, sha: observedBase })
    strategy = { kind: 'stacked', arcId: memberArcId, predecessorDeliveryKey: predecessor.deliveryKey, predecessorTargetKey: predecessor.target.targetKey }
  } else if (configured.kind === 'grouped') {
    ownerArcId = groups.get(configured.groupId).find(member => member.order === 0).id
    memberOrder = configured.order
    targetKey = groupTargetKey(configured.groupId)
    headRef = groupHead(configured.groupId)
    strategy = { kind: 'grouped', groupId: configured.groupId, order: 0 }
  } else strategy = { kind: 'independent', arcId: memberArcId }
  if (baseSha === undefined) {
    baseSha = input.refs.heads[baseRef]
    if (baseSha === undefined) return held(memberArcId, 'missing-ref', ownerArcId, { ref: baseRef }, null)
  }
  const headSha = input.refs.heads[headRef]
  if (headSha === undefined) return held(memberArcId, 'missing-ref', ownerArcId, { ref: headRef }, null)
  const target = { targetKey, providerId: input.policy.providerId, repositoryId: input.policy.repositoryId, baseRef, headRef, currentBaseSha: baseSha, currentHeadSha: headSha }
  const targetClaims = deliveries.filter(entry => entry.delivery.target.targetKey === targetKey)
  if (targetClaims.length > 1) throw new Error(`multiple delivery receipts claim target ${targetKey}`)
  const ownerReceipt = oneOwnedDelivery(deliveries, ownerArcId), targetReceipt = targetClaims[0] ?? null
  if (targetReceipt && targetReceipt.ownerArcId !== ownerArcId) throw new Error('delivery target is claimed by a nonowner arc')
  if (ownerReceipt && targetReceipt && ownerReceipt !== targetReceipt.delivery) throw new Error('delivery owner and target resolve to conflicting receipts')
  const existing = ownerReceipt ?? targetReceipt?.delivery ?? null
  if (configured.kind === 'grouped') {
    const members = new Set(groups.get(configured.groupId).map(member => member.id))
    for (const entry of deliveries) {
      if (members.has(entry.ownerArcId) && entry.ownerArcId !== ownerArcId) throw new Error('grouped delivery receipt is stored under a nonowner member')
    }
  }
  if (existing) {
    const stableFields = ['targetKey', 'providerId', 'repositoryId', 'baseRef', 'headRef']
    const stableDrift = stableFields.some(field => existing.target[field] !== target[field])
    const identityDrift = existing.arcId !== ownerArcId || !same(existing.strategy, strategy) || existing.deliveryKey !== deliveryKeyOf(target)
    if (stableDrift || identityDrift) return held(memberArcId, 'target-drift', ownerArcId, target, existing.target)
    if (existing.target.currentBaseSha !== target.currentBaseSha) return held(memberArcId, 'base-churn', ownerArcId, target, existing.target)
    if (existing.target.currentHeadSha !== target.currentHeadSha) return held(memberArcId, 'head-churn', ownerArcId, target, existing.target)
  }
  return { status: 'ready', ownerArcId, memberArcId, memberOrder, target, strategy, existing }
}
