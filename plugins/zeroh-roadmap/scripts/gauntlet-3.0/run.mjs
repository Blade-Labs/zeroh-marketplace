import { readFileSync, existsSync, realpathSync, lstatSync, mkdirSync } from 'node:fs'
import { join, dirname, isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual as equal } from 'node:util'
import { spawnSync } from 'node:child_process'
import { validateGauntletContract } from './scenarios.mjs'
import { validateRoleRunRequest } from '../../cli/lib/agent-driver.mjs'
import * as runReceipts from '../../cli/lib/run-receipt.mjs'
import * as deliveries from '../../cli/lib/delivery.mjs'
import { publishImmutableFile } from '../../cli/lib/sidecar.mjs'

const check = (ok, message) => { if (!ok) throw new Error(`Gauntlet runner: ${message}`) }
const frozen = value => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) }; return value }
const inside = (path, root) => { const r = relative(root, path); return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)) }
function canonical(path) {
  check(typeof path === 'string' && isAbsolute(path) && realpathSync(path) === path, 'canonical existing path required')
  let p = path
  while (true) { check(!lstatSync(p).isSymbolicLink(), 'symlink path refused'); const parent = dirname(p); if (parent === p) break; p = parent }
  return path
}
const unavailable = reason => ({ status: 'unavailable', reason, arms: [] })
const integer = value => Number.isSafeInteger(value) && value >= 0
const command = arm => ({ command: process.execPath, args: [fileURLToPath(import.meta.url), '--resume', arm.armId, '--index', arm.indexPath], armId: arm.armId })
const indexedArm = (index, armId) => { const arm = index.arms.find(a => a.armId === armId); check(arm, 'unknown arm'); return { ...arm, indexPath: index.indexPath } }
function row(arm, status, reason, receipt = null) {
  return { armId: arm.armId, request: arm.request, status, reason, resume: reason === 'identity-conflict' ? null : command(arm), runReceiptRef: receipt?.path ?? null,
    observedDriverId: receipt?.snapshot?.terminalResult?.driverId ?? null, observedModelId: receipt?.snapshot?.terminalResult?.observedModelId ?? null }
}
function declaredArms(contract) {
  return contract.scenarios.flatMap(scenario => contract.conditions.map(condition => ({
    armId: `${scenario.id}:${condition.id}`, conditionId: condition.id, scenarioId: scenario.id,
    runId: `g3-${scenario.id}--${condition.id}`, requestedParent: condition.parent, requestedChild: condition.child,
    deliveryArcIds: scenario.arcIds,
  }))).sort((a, b) => a.armId.localeCompare(b.armId, 'en'))
}
function allocations(budget, count) {
  const split = n => Array.from({ length: count }, (_, i) => Math.floor(n / count) + (i < n % count ? 1 : 0))
  const times = split(budget.totalNativeMs), tokens = split(budget.totalTokens)
  check(times.every(n => n > 0 && n <= budget.perArmTimeoutMs) && tokens.every(n => n > 0), 'budget cannot allocate every arm within its timeout')
  return times.map((nativeMs, i) => ({ nativeMs, tokens: tokens[i] }))
}
function validateIndex(value) {
  check(value?.schemaVersion === 1, 'unsupported index')
  check(typeof value.indexPath === 'string' && isAbsolute(value.indexPath), 'absolute index path required')
  canonical(dirname(value.indexPath))
  const contract = validateGauntletContract(value.contract, { requireLaunchable: true })
  check(equal(value.budget, contract.budget), 'index budget differs from frozen contract')
  const declared = declaredArms(contract), portions = allocations(contract.budget, declared.length)
  check(Array.isArray(value.arms) && value.arms.length === declared.length, 'index must contain all 24 arms')
  const roots = new Set(), repositories = new Set(), namespaces = new Set(), runs = new Set()
  value.arms.forEach((arm, i) => {
    for (const [key, expected] of Object.entries(declared[i])) check(equal(arm[key], expected), `index ${key} identity mismatch`)
    check(/^[A-Za-z0-9_-]+$/.test(arm.runId) && !runs.has(arm.runId), 'unsafe or duplicate runId'); runs.add(arm.runId)
    check(equal(arm.allocation, portions[i]), 'index allocation changed')
    canonical(arm.worktree); canonical(arm.launchInputsRef)
    check(lstatSync(arm.worktree).isDirectory() && lstatSync(arm.launchInputsRef).isFile() && !inside(arm.launchInputsRef, arm.worktree), 'launch inputs must be outside arm checkout')
    check(!roots.has(arm.worktree) && !repositories.has(arm.repositoryId) && !namespaces.has(arm.providerNamespace), 'shared arm identity')
    for (const root of roots) check(!inside(root, arm.worktree) && !inside(arm.worktree, root), 'nested arm worktrees')
    roots.add(arm.worktree); repositories.add(arm.repositoryId); namespaces.add(arm.providerNamespace)
    check(typeof arm.repositoryId === 'string' && arm.repositoryId.startsWith(contract.externalActionAuthority.repositoryNamespace + '/') && typeof arm.providerNamespace === 'string' && arm.providerNamespace.startsWith(contract.externalActionAuthority.providerNamespace + '/'), 'namespace exceeds authority')
    const request = arm.request
    validateRoleRunRequest(request, arm.requestedParent.driverId)
    check(request.runId === arm.runId && request.worktree === arm.worktree && request.model === arm.requestedParent.modelId && arm.deliveryArcIds.includes(request.arcId), 'parent request identity mismatch')
    check(request.baseHead === contract.fixture.baseSha && request.requestedHead === contract.fixture.baseSha, 'request source SHA mismatch')
    check(request.authorityRef.status === 'known' && request.authorityRef.source.ref === contract.externalActionAuthority.authorityRef, 'request authority is not bound to supplied authority')
    check(/^[a-f0-9]{64}$/.test(request.roleCardDigest) && /^[a-f0-9]{64}$/.test(request.governanceDigest), 'request input digests unavailable')
    check(arm.initialState?.arcId === request.arcId && equal(arm.initialState.authorityRef, request.authorityRef), 'initial state authority/arc mismatch')
    const packet = JSON.parse(readFileSync(arm.launchInputsRef, 'utf8'))
    check(packet.armId === arm.armId && equal(packet.requestedChild, arm.requestedChild), 'launch child routing differs from frozen condition')
  })
  return frozen(structuredClone(value))
}
function receiptFor(arm, adapters) { return adapters.runReceipts.readRunReceipt(arm.worktree, { arcId: arm.request.arcId, runId: arm.runId }) }
function usageOf(receipt, adapters) {
  const usage = adapters.usage?.read(receipt)
  return usage && integer(usage.nativeMs) && integer(usage.tokens) ? usage : null
}
function project(arm, receipt, adapters) {
  if (!receipt) return row(arm, 'planned', 'not-started')
  if (!equal(receipt.snapshot?.request, arm.request)) return row(arm, 'failed', 'identity-conflict', receipt)
  const terminal = receipt.snapshot.terminalResult
  const usage = usageOf(receipt, adapters)
  if (!usage) return row(arm, 'unavailable', 'usage-unobserved', receipt)
  if (usage.nativeMs > arm.allocation.nativeMs || usage.tokens > arm.allocation.tokens) return row(arm, 'failed', 'allocation-exhausted', receipt)
  if (!terminal) return row(arm, 'active', 'native-outcome-pending', receipt)
  if (terminal.driverId !== arm.request.driverId || (terminal.observedModelId && terminal.observedModelId !== arm.request.model)) return row(arm, 'failed', 'identity-conflict', receipt)
  if (terminal.exitCode !== 0 || terminal.signal != null || terminal.phaseResult?.status !== 'done') return row(arm, 'failed', 'native-outcome-failed', receipt)
  const result = row(arm, 'unjudged', 'parent-complete; child attestation and outcome judgment remain separate', receipt)
  result.deliveryReceiptRefs = arm.deliveryArcIds.map(arcId => {
    const delivery = adapters.deliveries?.loadArcDelivery(arm.worktree, arcId)
    if (!delivery) return { arcId, status: 'missing' }
    check(delivery.arcId === arcId && delivery.target?.repositoryId === arm.repositoryId, 'delivery identity mismatch')
    return { arcId, deliveryKey: delivery.deliveryKey, revision: delivery.revision, status: delivery.terminal?.status, providerPullRequestId: delivery.pullRequest?.providerPullRequestId ?? null }
  })
  return result
}
export async function readArmJournal(index, adapters) {
  index = validateIndex(index)
  return index.arms.map(arm => project(indexedArm(index, arm.armId), receiptFor(arm, adapters), adapters))
}
function budgetHold(index, adapters) {
  let nativeMs = 0, tokens = 0
  for (const arm of index.arms) {
    const receipt = receiptFor(arm, adapters)
    if (!receipt) continue
    if (!equal(receipt.snapshot?.request, arm.request)) return 'identity-conflict'
    const usage = usageOf(receipt, adapters)
    if (!usage) return 'usage-unobserved'
    if (usage.nativeMs > arm.allocation.nativeMs || usage.tokens > arm.allocation.tokens) return 'allocation-exhausted'
    nativeMs += usage.nativeMs; tokens += usage.tokens
  }
  return nativeMs >= index.budget.totalNativeMs || tokens >= index.budget.totalTokens ? 'budget-exhausted' : null
}
function fromHold(arm, value) {
  if (value?.status === 'hold' && /authority-refusal|permission|auth-denied|sandbox-refusal/.test(value.kind ?? '')) return row(arm, 'permission-held', value.reason ?? value.kind)
  if (value?.status === 'hold' && value.kind === 'native-transport-failed') return row(arm, 'failed', value.reason ?? value.kind)
  if (['failed', 'unavailable', 'permission-held', 'active'].includes(value?.status)) return row(arm, value.status, value.reason ?? value.kind ?? 'owner-held')
  return row(arm, 'unavailable', value?.reason ?? value?.kind ?? 'native-outcome-unobserved')
}
async function reconcileDeliveries(arm, adapters, receipt) {
  for (const arcId of arm.deliveryArcIds) {
    const before = adapters.deliveries?.loadArcDelivery(arm.worktree, arcId)
    if (!before) continue // The gauntlet does not create missing delivery intent.
    check(before.arcId === arcId && before.target?.repositoryId === arm.repositoryId, 'delivery identity mismatch')
    if (['open-green', 'queued', 'merged'].includes(before.terminal?.status)) { deliveries.assertReachedDeliveryTerminal(before); continue }
    if (!before.actions?.some(action => ['requested', 'unknown'].includes(action.status))) continue
    if (typeof adapters.deliveries.resume !== 'function') return row(arm, 'unavailable', 'delivery-reconciliation-unavailable', receipt)
    await adapters.deliveries.resume(arm.worktree, arcId)
    const after = adapters.deliveries.loadArcDelivery(arm.worktree, arcId)
    check(after && after.deliveryKey === before.deliveryKey && after.target.repositoryId === before.target.repositoryId, 'delivery identity changed during resume')
    if (before.pullRequest) check(after.pullRequest?.providerPullRequestId === before.pullRequest.providerPullRequestId, 'delivery PR identity changed during resume')
    if (after.actions.some(action => ['requested', 'unknown'].includes(action.status))) return row(arm, 'active', 'provider-outcome-pending', receipt)
  }
  return project(arm, receipt, adapters)
}
export async function resumeArm(armId, { index, adapters }) {
  index = validateIndex(index)
  const arm = indexedArm(index, armId)
  const receipt = receiptFor(arm, adapters)
  if (!receipt) return row(arm, 'unavailable', 'no-existing-run-to-resume')
  const before = project(arm, receipt, adapters)
  if (before.status === 'unjudged') return reconcileDeliveries(arm, adapters, receipt)
  if (before.status !== 'active') return before
  const reconciled = adapters.runReceipts.reconcileRunReceipt(arm.worktree, { arcId: arm.request.arcId, runId: arm.runId, evidence: {} })
  const driver = adapters.nativeDrivers?.[arm.requestedParent.driverId]
  if (!driver) return row(arm, 'unavailable', 'native-adapter-unavailable', receipt)
  // Recovery asks the existing owner to ingest prior completion; it never repeats start.
  if (receipt.snapshot.pendingOperation) {
    if (typeof driver.recover !== 'function') return fromHold(arm, reconciled)
    const recovered = await driver.recover(receipt, arm.initialState)
    const after = project(arm, receiptFor(arm, adapters), adapters)
    return after.status === 'active' ? fromHold(arm, recovered) : after
  }
  if (!['resume', 'active'].includes(reconciled.status)) return fromHold(arm, reconciled)
  // A resumed native operation spends the existing allocation through the same admission owner.
  if (!adapters.admission?.submit) return row(arm, 'unavailable', 'resume-admission-required', receipt)
  const held = budgetHold(index, adapters)
  if (held) return row(arm, 'unavailable', held, receipt)
  const used = usageOf(receipt, adapters)
  const remaining = { nativeMs: arm.allocation.nativeMs - used.nativeMs, tokens: arm.allocation.tokens - used.tokens }
  if (remaining.nativeMs <= 0 || remaining.tokens <= 0) return row(arm, 'unavailable', 'allocation-exhausted', receipt)
  const result = await adapters.admission.submit({ armId, ...remaining }, async () => {
    const preflight = await adapters.preflight({ contract: index.contract })
    if (preflight.status !== 'ready') return fromHold(arm, { status: preflight.status === 'refused' ? 'permission-held' : 'unavailable', reason: preflight.reasons })
    const handle = { request: arm.request, nativeSessionId: receipt.snapshot.nativeSessionId }
    const resumed = await driver.resume(handle)
    if (resumed?.status) return fromHold(arm, resumed)
    await driver.awaitEvent(resumed, arm.initialState)
    return project(arm, receiptFor(arm, adapters), adapters)
  })
  return result?.armId ? result : fromHold(arm, result)
}
export async function runArm(armId, { index, adapters }) {
  index = validateIndex(index)
  const arm = indexedArm(index, armId)
  if (receiptFor(arm, adapters)) return resumeArm(armId, { index, adapters })
  const held = budgetHold(index, adapters)
  if (held) return row(arm, held === 'identity-conflict' ? 'failed' : 'unavailable', held)
  const preflight = await adapters.preflight({ contract: index.contract })
  if (preflight.status !== 'ready') return fromHold(arm, { status: preflight.status === 'refused' ? 'permission-held' : 'unavailable', reason: preflight.reasons })
  const driver = adapters.nativeDrivers?.[arm.requestedParent.driverId]
  if (!driver) return row(arm, 'unavailable', 'native-adapter-unavailable')
  const handle = await driver.start(arm.request)
  if (handle?.status) return fromHold(arm, handle)
  check(equal(handle?.request, arm.request), 'native handle identity mismatch')
  await driver.awaitEvent(handle, arm.initialState)
  return project(arm, receiptFor(arm, adapters), adapters)
}
export async function runGauntlet3({ contract, outputDir, adapters, budget }) {
  if (!contract?.budget || !budget) return unavailable('budget-unavailable')
  contract = validateGauntletContract(contract, { requireLaunchable: true })
  check(equal(budget, contract.budget), 'operational budget differs from frozen contract')
  if (!adapters) return unavailable('token-boundary-unavailable')
  if (!adapters.admission?.submit) return unavailable('admission-unavailable')
  const preflight = await adapters.preflight({ contract })
  if (preflight.status !== 'ready') return { ...unavailable(preflight.reasons), status: preflight.status === 'refused' ? 'permission-held' : 'unavailable' }
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true, mode: 0o700 })
  canonical(outputDir)
  const path = join(outputDir, 'arms.json')
  let index
  if (existsSync(path)) {
    canonical(path)
    index = validateIndex(JSON.parse(readFileSync(path, 'utf8')))
    check(equal(index.contract, contract) && equal(index.budget, budget), 'existing immutable index differs from requested contract')
  } else {
    const arms = declaredArms(contract), portions = allocations(budget, arms.length)
    check(Array.isArray(adapters.fixtures) && adapters.fixtures.length === arms.length, 'all isolated fixtures required')
    for (const [i, arm] of arms.entries()) {
      const matches = adapters.fixtures.filter(f => f.armId === arm.armId)
      check(matches.length === 1 && matches[0].fixtureSha === contract.fixture.baseSha, 'fixture identity/SHA mismatch')
      const fixture = matches[0]
      Object.assign(arm, { worktree: fixture.root, repositoryId: fixture.repositoryId, providerNamespace: fixture.providerNamespace, allocation: portions[i] })
      const prepared = await adapters.prepareArm({ arm: structuredClone(arm), fixture, contract, allocation: portions[i] })
      const { request, initialState, launchInputsRef } = prepared
      Object.assign(arm, { request, initialState, launchInputsRef })
    }
    index = validateIndex({ schemaVersion: 1, indexPath: path, contract, budget, arms })
    const bytes = JSON.stringify(index, null, 2) + '\n'
    if (!publishImmutableFile(path, bytes)) check(readFileSync(path, 'utf8') === bytes, 'immutable index publication conflict')
  }
  // Injected deterministic admission only. Production workers are admitted by dispatchArmIndex.
  const arms = await Promise.all(index.arms.map(async entry => {
    const arm = indexedArm(index, entry.armId)
    try {
      const receipt = receiptFor(arm, adapters)
      if (receipt) return await resumeArm(arm.armId, { index, adapters })
      const result = await adapters.admission.submit({ armId: arm.armId, ...arm.allocation }, () => runArm(arm.armId, { index, adapters }))
      return result?.armId ? result : fromHold(arm, result)
    } catch (error) {
      // The existing receipt is retained. Unknown exceptions never trigger a retry/start.
      return row(arm, 'unavailable', { code: 'owner-operation-interrupted', message: error.message })
    }
  }))
  const status = ['failed', 'permission-held', 'unavailable', 'active', 'planned', 'unjudged'].find(value => arms.some(arm => arm.status === value)) ?? 'unjudged'
  return { status, index, arms }
}

function fixedReadOnlyAdapters() {
  return { runReceipts, deliveries, usage: { read: () => null } }
}
/** Static argv jobs; no callbacks or executable programs are serialized. */
export function dispatchArmIndex(indexPath, { poolBin = 'capbuild-node-tests' } = {}) {
  canonical(indexPath)
  const index = validateIndex(JSON.parse(readFileSync(indexPath, 'utf8')))
  check(index.indexPath === indexPath, 'index location mismatch')
  const capability = spawnSync(poolBin, ['--capabilities'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  let capabilities
  try { capabilities = JSON.parse(capability.stdout).capabilities } catch { return unavailable('admission-unavailable') }
  if (capability.status !== 0 || !Array.isArray(capabilities) || !capabilities.includes('jobs-manifest-v1')) return unavailable('admission-unavailable')
  const jobs = index.arms.map(arm => ({ id: arm.runId, cwd: arm.worktree, argv: [process.execPath, fileURLToPath(import.meta.url), '--run-arm', arm.armId, '--index', indexPath], timeoutSeconds: Math.floor(arm.allocation.nativeMs / 1000) }))
  if (jobs.some(job => job.timeoutSeconds < 1 || job.timeoutSeconds > 3600)) return unavailable('admission-timeout-unrepresentable')
  const manifest = join(dirname(indexPath), 'jobs.json'), bytes = JSON.stringify({ version: 1, jobs }, null, 2) + '\n'
  if (!publishImmutableFile(manifest, bytes)) check(readFileSync(manifest, 'utf8') === bytes, 'job manifest conflict')
  const result = spawnSync(poolBin, ['--workers', String(Math.min(8, index.budget.maxConcurrentArms)), '--jobs-manifest', manifest], { cwd: dirname(indexPath), stdio: 'inherit' })
  return { status: 'unavailable', reason: 'workers have no production token/preparation boundary', exitCode: result.status, signal: result.signal }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    check(args.length === 4 && ['--run-arm', '--resume'].includes(args[0]) && args[2] === '--index', 'Usage: run.mjs --run-arm ARM --index PATH')
    canonical(args[3])
    const index = validateIndex(JSON.parse(readFileSync(args[3], 'utf8')))
    check(index.indexPath === args[3], 'index location mismatch')
    const arm = indexedArm(index, args[1])
    const adapters = fixedReadOnlyAdapters(), receipt = receiptFor(arm, adapters)
    const result = receipt ? project(arm, receipt, adapters) : row(arm, 'unavailable', 'token-boundary-unavailable')
    console.log(JSON.stringify(result)); process.exitCode = 3
  } catch (error) { console.error(error.message); process.exitCode = 2 }
}
