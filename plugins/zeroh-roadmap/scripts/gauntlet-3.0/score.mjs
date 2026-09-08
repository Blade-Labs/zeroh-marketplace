import { createHash } from 'node:crypto'
import { isDeepStrictEqual as same } from 'node:util'
import { assertExactCurrentGreen, assertReachedDeliveryTerminal, correctionBindingOf, deliveryKeyOf } from '../../cli/lib/delivery.mjs'
import { assertDeliverySummary } from '../../cli/lib/delivery-evaluation.mjs'
import { worktreeCleanupOutcome } from '../../cli/lib/worktree.mjs'
import { RESUME_LINE } from '../../cli/lib/workflow-steps.mjs'
import { ExactHeadCiResultShape } from '../../cli/lib/providers/ci.mjs'
import { validateGauntletContract } from './scenarios.mjs'

const check = (ok, message) => { if (!ok) throw Error(message) }
const text = value => typeof value === 'string' && value.trim().length > 0
const integer = value => Number.isSafeInteger(value) && value >= 0
const frozen = value => { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) }; return value }
const exact = (value, fields) => check(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...fields].sort()), 'Unknown or missing evidence fields')
const hash = value => createHash('sha256').update(value).digest('hex')
const confidenceOrder = ['low', 'medium', 'high']
const confidence = values => confidenceOrder[Math.min(...values.map(value => confidenceOrder.indexOf(value)))] ?? null

export const SENTINEL_NAMES = frozen(['native-run-terminal', 'stable-pr-identity', 'branch-strategy', 'repair-classification', 'bounded-review', 'history-normalization', 'gc-identity-recoverability', 'exact-head-green', 'terminal-evaluation', 'idempotent-second-resume', 'scenario-lifecycle-coverage'])
export const EXPECTED_DISPOSITIONS = frozen({
  blocked: 'blocked with a bounded resume instruction', stalled: 'nonterminal and resumable',
  unobserved: 'unobserved, never successful', exited: 'exact native exit identity retained',
  'review-exhausted': 'held at the fixed review bound',
  'validation-small-repair': 'bounded small-repair route',
  'validation-planned-correction': 'planned-correction route',
  causal: 'eligible scoped repair', 'owned-preexisting': 'eligible scoped repair',
  unrelated: 'held without unrelated edits', infrastructure: 'held without code edits',
  flaky: 'held without code edits', indeterminate: 'held without code edits',
  auth: 'held without retry', quota: 'held without retry', timeout: 'held without replay',
  'repeated-input': 'unchanged repeated failure blocks retry',
  'history-normalization': 'tree-equivalent normalization with recoverable source',
  'worktree-gc': 'only owned inactive clean recoverable worktrees removed',
  'exact-head-green': 'non-draft PR with all required checks green on the current head',
  evaluation: 'current terminal delivery evaluation', 'second-resume': 'same run and PR without extra actions',
})
function scoreValid(score) {
  check(score?.status === 'valid' && score.absoluteScore === 1 && text(score.armId), 'Invalid deterministic score')
  check(Array.isArray(score.sentinels) && same([...score.sentinels.map(row => row.name)].sort(), [...SENTINEL_NAMES].sort()) && score.sentinels.every(row => row.status === 'pass'), 'Incomplete deterministic sentinel evidence')
}
function criteriaFor(scenario) { return scenario.criteria.map(id => ({ id, expectedDisposition: EXPECTED_DISPOSITIONS[id] })) }
function packetIdFor(contract, scenario, condition) {
  const ordinal = contract.scenarios.findIndex(row => row.id === scenario.id) * contract.conditions.length + contract.conditions.findIndex(row => row.id === condition.id)
  return `packet-${String(ordinal + 1).padStart(3, '0')}`
}
function packetShape(packet) {
  exact(packet, ['version', 'packetId', 'criteria', 'deliverables', 'deterministic'])
  check(packet.version === 1 && /^packet-\d{3}$/.test(packet.packetId), 'Invalid blind packet identity')
  check(Array.isArray(packet.criteria) && packet.criteria.length > 0 && new Set(packet.criteria.map(row => row.id)).size === packet.criteria.length, 'Invalid packet criteria')
  for (const row of packet.criteria) { exact(row, ['id', 'expectedDisposition']); check(text(row.id) && text(row.expectedDisposition), 'Missing expected criterion disposition') }
  exact(packet.deterministic, ['status', 'sentinelNames'])
  check(packet.deterministic.status === 'valid' && same([...packet.deterministic.sentinelNames].sort(), [...SENTINEL_NAMES].sort()), 'Invalid packet deterministic evidence')
  check(Array.isArray(packet.deliverables) && packet.deliverables.length > 0, 'Missing anonymized deliverables')
  const ids = new Set()
  for (const row of packet.deliverables) {
    try { exact(row, ['artifactId', 'mediaType', 'content']) } catch { throw Error('Unknown or missing anonymized artifact field') }
    check(text(row.artifactId) && /^[A-Za-z0-9_-]+$/.test(row.artifactId) && !ids.has(row.artifactId) && text(row.mediaType) && text(row.content), 'Invalid or duplicate anonymized artifact')
    ids.add(row.artifactId)
  }
}
/** Validity is a prerequisite; the packet contains no builder identity or quality score. */
export async function buildBlindJudgePacket({ contract, scenarioId, armScore }, { readAnonymizedDeliverables }) {
  contract = validateGauntletContract(contract, { requireLaunchable: true })
  scoreValid(armScore)
  const scenario = contract.scenarios.find(row => row.id === scenarioId)
  const condition = contract.conditions.find(row => armScore.armId === `${scenarioId}:${row.id}`)
  check(scenario && condition, 'Blind packet arm does not belong to frozen scenario')
  const deliverables = await readAnonymizedDeliverables({ armId: armScore.armId, scenarioId })
  const packet = { version: 1, packetId: packetIdFor(contract, scenario, condition), criteria: criteriaFor(scenario), deliverables: structuredClone(deliverables), deterministic: { status: 'valid', sentinelNames: armScore.sentinels.map(row => row.name) } }
  packetShape(packet)
  const serialized = JSON.stringify(deliverables).toLowerCase()
  const forbidden = ['plugin', 'baseline', 'claude', 'codex', 'driverid', 'modelid', 'requestedparent', 'requestedchild', 'matchedcondition', 'priorverdict', 'reasoning', 'transcript', 'absolutescore', ...contract.conditions.flatMap(row => [row.id, row.parent.modelId, row.child.modelId]), contract.externalActionAuthority.repositoryNamespace, contract.externalActionAuthority.providerNamespace, ...armScore.sentinels.flatMap(row => row.ownerRefs ?? []).filter(ref => typeof ref === 'string' && ref.startsWith('/'))].map(value => value.toLowerCase())
  check(!forbidden.some(value => serialized.includes(value)), 'Anonymized deliverable leaks condition, model, plugin or builder identity')
  return frozen(packet)
}
function verdictShape(packet, verdict) {
  exact(verdict, ['packetId', 'status', 'criteria'])
  check(verdict.packetId === packet.packetId && ['judged', 'abstained'].includes(verdict.status), 'Invalid verdict packet/status')
  check(Array.isArray(verdict.criteria) && same([...verdict.criteria.map(row => row.criterionId)].sort(), packet.criteria.map(row => row.id).sort()), 'Incomplete or duplicated verdict criteria')
  for (const row of verdict.criteria) {
    exact(row, ['criterionId', 'status', 'confidence', 'violations', 'evidence'])
    check(['met', 'gap', 'abstain'].includes(row.status) && confidenceOrder.includes(row.confidence), 'Invalid criterion judgment/confidence')
    check(Array.isArray(row.violations) && row.violations.every(text) && Array.isArray(row.evidence) && row.evidence.length > 0 && row.evidence.every(text), 'Judgment evidence missing')
    check(row.status !== 'gap' || row.violations.length > 0, 'Gap requires a violation')
    check(row.status !== 'met' || row.violations.length === 0, 'Met criterion contradicts violations')
  }
  check(verdict.status !== 'judged' || verdict.criteria.every(row => row.status !== 'abstain'), 'Abstained criterion cannot be judged')
  check(verdict.status !== 'abstained' || verdict.criteria.some(row => row.status === 'abstain'), 'Abstention needs an abstained criterion')
}
/** Judge identity is observed, never taken from model-authored verdict text. */
export function mergeBlindVerdict({ packet, expectedJudge, judgeEvidence, verdict }) {
  const result = status => ({ status, judge: null, criteria: [], confidence: null, violations: [] })
  if (!judgeEvidence || !verdict) return result('unjudged')
  try {
    packetShape(packet); exact(expectedJudge, ['driverId', 'modelId', 'runId'])
    check(Object.values(expectedJudge).every(text), 'Exact judge identity required')
    exact(judgeEvidence, ['pendingReceipt', 'terminalReceipt', 'stdin'])
    const { pendingReceipt: pending, terminalReceipt: terminal, stdin } = judgeEvidence
    const before = pending?.snapshot, after = terminal?.snapshot, request = before?.request, outcome = after?.terminalResult
    check(text(pending?.path) && text(terminal?.path) && /^[a-f0-9]{64}$/.test(pending?.digest) && /^[a-f0-9]{64}$/.test(terminal?.digest), 'Missing canonical judge receipts')
    check(request && same(request, after?.request) && request.runId === expectedJudge.runId && request.driverId === expectedJudge.driverId && request.model === expectedJudge.modelId, 'Judge request identity mismatch')
    check(integer(before.revision) && integer(after.revision) && after.revision > before.revision && before.terminalResult === null && after.pendingOperation === null && after.outcome === 'complete', 'Judge receipts are not pending-to-terminal')
    check(typeof stdin === 'string' || stdin instanceof Uint8Array, 'Judge stdin bytes missing')
    const inputBytes = Buffer.from(stdin), inputText = inputBytes.toString('utf8')
    check(inputBytes.equals(Buffer.from(inputText)) && before.pendingOperation?.kind === 'start' && before.pendingOperation.inputDigest === hash(inputBytes), 'Judge stdin binding mismatch')
    check(same(JSON.parse(inputText), packet), 'Judge input differs from exact blind packet')
    check(text(after.nativeSessionId) && outcome?.nativeSessionId === after.nativeSessionId && outcome.driverId === expectedJudge.driverId && outcome.observedModelId === expectedJudge.modelId && outcome.exitCode === 0 && outcome.signal === null, 'Judge terminal identity or exit mismatch')
    check(outcome.protocolError !== true && (outcome.protocolSubtype == null || outcome.protocolSubtype === 'success'), 'Judge native protocol error')
    const protocol = outcome.protocolTerminal, type = typeof protocol === 'string' ? protocol : protocol?.type
    check(['turn.completed', 'result', 'result.success'].includes(type) && protocol?.is_error !== true && (protocol?.subtype === undefined || protocol.subtype === 'success'), 'Judge protocol did not succeed')
    verdictShape(packet, verdict)
    return frozen({ status: verdict.status, judge: structuredClone(expectedJudge), criteria: structuredClone(verdict.criteria), confidence: confidence(verdict.criteria.map(row => row.confidence)), violations: [...new Set(verdict.criteria.flatMap(row => row.violations))] })
  } catch (error) { return { ...result('invalid'), violations: [error.message] } }
}
export function pairGauntletOutcomes({ contract, plugin, baseline }) {
  const incomplete = reason => ({ comparison: 'incomplete', confidence: null, reason })
  try {
    contract = validateGauntletContract(contract, { requireLaunchable: true })
    const condition = contract.conditions.find(row => row.id === plugin?.conditionId), mate = contract.conditions.find(row => row.id === baseline?.conditionId)
    check(condition?.pluginEnabled === true && mate?.pluginEnabled === false && condition.matchedConditionId === mate.id && mate.matchedConditionId === condition.id, 'Not frozen reciprocal mates')
    const scenario = contract.scenarios.find(row => row.id === plugin.scenarioId)
    check(scenario && baseline.scenarioId === scenario.id, 'Scenario mismatch')
    for (const [row, cond] of [[plugin, condition], [baseline, mate]]) {
      scoreValid(row.score); packetShape(row.packet)
      check(row.armId === `${scenario.id}:${cond.id}` && row.score.armId === row.armId && row.fixtureSha === contract.fixture.baseSha && row.packet.packetId === packetIdFor(contract, scenario, cond) && same(row.packet.criteria, criteriaFor(scenario)), 'Pair evidence does not match frozen arm')
      check(row.judgment?.status === 'judged' && Object.values(row.judgment.judge ?? {}).length === 3 && Object.values(row.judgment.judge).every(text), 'Missing exact judge identity')
      verdictShape(row.packet, { packetId: row.packet.packetId, status: row.judgment.status, criteria: row.judgment.criteria })
    }
    check(plugin.judgment.judge.driverId === baseline.judgment.judge.driverId && plugin.judgment.judge.modelId === baseline.judgment.judge.modelId, 'Different judge models')
    const met = row => row.judgment.criteria.filter(c => c.status === 'met').length
    const difference = met(plugin) - met(baseline)
    return { comparison: difference > 0 ? 'plugin-better' : difference < 0 ? 'baseline-better' : 'tie', confidence: confidence([...plugin.judgment.criteria, ...baseline.judgment.criteria].map(row => row.confidence)), reason: null }
  } catch (error) { return incomplete(error.message) }
}


class EvidenceError extends Error {
  constructor(status, message) { super(message); this.evidenceStatus = status }
}
const present = (value, label) => { if (value === null || value === undefined) throw new EvidenceError('missing', `${label} missing`); return value }
const sha = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
function members(rows, ids, label) {
  check(Array.isArray(rows) && same(rows.map(row => row.arcId).sort(), [...ids].sort()), `${label} missing, duplicate or foreign arc`)
  return rows
}
function envelope(value, arm, fields) {
  exact(value, ['schemaVersion', 'armId', 'scenarioId', ...fields])
  check(value.schemaVersion === 1 && value.armId === arm.armId && value.scenarioId === arm.scenarioId, 'Cross-arm observation')
  return value
}
function nativeTerminal(receipt, request) {
  const snapshot = present(receipt?.snapshot, 'run snapshot'), terminal = present(snapshot.terminalResult, 'native terminal')
  check(same(snapshot.request, request) && snapshot.runId === request.runId && snapshot.arcId === request.arcId && integer(snapshot.revision), 'Native request identity mismatch')
  check(text(receipt.path) && /^[a-f0-9]{64}$/.test(receipt.digest) && text(snapshot.nativeSessionId) && snapshot.pendingOperation === null && snapshot.outcome === 'complete', 'Incomplete canonical native receipt')
  check(terminal.nativeSessionId === snapshot.nativeSessionId && terminal.driverId === request.driverId && terminal.observedModelId === request.model && terminal.exitCode === 0 && terminal.signal === null && terminal.phaseResult?.status === 'done', 'Native terminal or model identity mismatch')
  check(terminal.protocolError !== true && (terminal.protocolSubtype == null || terminal.protocolSubtype === 'success'), 'Native protocol reported failure')
  const protocol = terminal.protocolTerminal, type = typeof protocol === 'string' ? protocol : protocol?.type
  check(['turn.completed', 'result', 'result.success'].includes(type) && protocol?.is_error !== true && (protocol?.subtype === undefined || protocol.subtype === 'success'), 'Native terminal protocol failed')
}
function bindingValid(binding) {
  present(binding, 'correction binding')
  const { bounds, route } = binding
  check(integer(binding.round) && binding.round > 0 && binding.round <= bounds?.maxRounds && integer(bounds.maxRounds) && bounds.maxRounds <= 2 && bounds.maxRounds > 0, 'Review round bound exceeded')
  check(sha(binding.validationHead) && sha(binding.gateInputKey) && route?.sourceHeadSha === binding.validationHead && sha(route.predecessorHeadSha), 'Correction source/input mismatch')
  check(Number.isFinite(Date.parse(route.recordedAt)) && Date.parse(route.recordedAt) < Date.parse(bounds.deadlineAt) && text(bounds.authority?.reference) && ['session', 'config'].includes(bounds.authority.source), 'Correction deadline/authority missing or exhausted')
  check(['small-repair', 'planned-correction'].includes(route.kind) && (route.kind === 'small-repair' ? route.trace && route.plannedCorrection === null : route.trace === null && text(route.plannedCorrection?.correctionId)), 'Missing correction route trace')
  check(Array.isArray(route.scopePaths) && route.scopePaths.length > 0 && route.scopePaths.every(path => text(path) && !path.startsWith('/') && !path.split('/').some(p => !p || p === '..' || p === '.') && bounds.allowedPathPrefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'))), 'Correction exceeds path authority')
  check(Array.isArray(route.selected) && route.selected.length > 0 && route.selected.every(row => ['causal', 'owned-preexisting'].includes(row.kind) && sha(row.signature) && row.paths.length > 0 && row.paths.every(path => route.scopePaths.includes(path))), 'Unrelated or unproven repair selected')
  check(Array.isArray(route.residual) && route.residual.every(row => row.paths.every(path => !route.scopePaths.includes(path))), 'Correction edits residual failure')
}
/** Read-only scorer. Reader ports return canonical records or raw retained outputs, never verdicts. */
export function scoreDeterministicSentinels(input, ports) {
  exact(input, ['contract', 'index', 'armId'])
  const contract = validateGauntletContract(input.contract, { requireLaunchable: true }), { index, armId } = input
  check(same(contract, index?.contract), 'Scoring contract differs from frozen index')
  const found = index.arms?.filter(row => row.armId === armId)
  check(found?.length === 1, 'Missing or duplicate indexed arm')
  const arm = found[0], scenario = contract.scenarios.find(row => row.id === arm.scenarioId), condition = contract.conditions.find(row => row.id === arm.conditionId)
  check(scenario && condition && armId === `${scenario.id}:${condition.id}` && same(arm.deliveryArcIds, scenario.arcIds), 'Frozen arm identity mismatch')
  const ownerIds = scenario.branchStrategy === 'grouped' ? [scenario.arcIds[0]] : scenario.arcIds
  const cache = new Map(), context = { armId, scenarioId: scenario.id }
  const read = (name, ...args) => {
    const key = JSON.stringify([name, args])
    if (!cache.has(key)) {
      try { check(typeof ports?.[name] === 'function', `${name} reader unavailable`); cache.set(key, { value: ports[name](...args) }); check(!cache.get(key).value?.then, 'Scorer readers must be synchronous') }
      catch (error) { cache.set(key, { error: new EvidenceError('unreadable', `${name}: ${error.message}`) }) }
    }
    const result = cache.get(key); if (result.error) throw result.error
    return present(result.value, name)
  }
  const git = args => read('git', arm.worktree, args)
  const delivery = arcId => {
    const row = read('loadArcDelivery', arm.worktree, scenario.branchStrategy === 'grouped' ? ownerIds[0] : arcId)
    check(row.arcId === (scenario.branchStrategy === 'grouped' ? ownerIds[0] : arcId) && row.target?.repositoryId === arm.repositoryId && row.deliveryKey === deliveryKeyOf(row.target), 'Delivery owner identity mismatch')
    return row
  }
  const deliveries = () => ownerIds.map(delivery)
  const lifecycle = () => {
    const value = envelope(read('readLifecycleCases', context), arm, ['arcs'])
    members(value.arcs, scenario.arcIds, 'Lifecycle')
    const invocations = new Set()
    for (const row of value.arcs) {
      exact(row, ['arcId', 'cases'])
      check(Array.isArray(row.cases) && same(row.cases.map(c => c.criterion).sort(), [...scenario.criteria].sort()), 'Lifecycle coverage missing or duplicated')
      for (const item of row.cases) {
        exact(item, ['criterion', 'invocationId', 'output'])
        check(text(item.invocationId) && !invocations.has(item.invocationId), 'Duplicate lifecycle invocation'); invocations.add(item.invocationId)
        present(item.output, `${item.criterion} output`)
        check(!Object.hasOwn(item.output, 'passed') && !Object.hasOwn(item.output, 'absoluteScore'), 'Caller verdict is not lifecycle evidence')
      }
    }
    return value.arcs
  }
  const resumed = () => {
    const value = envelope(read('readResumeObservations', context), arm, ['arcs'])
    members(value.arcs, scenario.arcIds, 'Resume')
    for (const row of value.arcs) {
      exact(row, ['arcId', 'first', 'second'])
      for (const point of [row.first, row.second]) {
        exact(point, ['invocationId', 'runAddress', 'runReceipt', 'delivery'])
        check(text(point.invocationId) && point.runAddress.arcId === row.arcId, 'Resume invocation/address mismatch')
        const canonical = read('readRunReceipt', arm.worktree, point.runAddress, { digest: point.runReceipt.digest })
        check(same(canonical, point.runReceipt), 'Retained resume receipt differs from canonical history')
      }
      const first = row.first, second = row.second, a = first.runReceipt.snapshot, b = second.runReceipt.snapshot
      check(first.invocationId !== second.invocationId && same(first.runAddress, second.runAddress) && same(a.request, b.request) && a.nativeSessionId === b.nativeSessionId && same(a.terminalResult, b.terminalResult) && integer(a.revision) && integer(b.revision) && b.revision >= a.revision, 'Resume changed stable run identity or terminal')
      check(same(read('readRunReceipt', arm.worktree, second.runAddress), second.runReceipt), 'Second resume is stale')
      const d = delivery(row.arcId)
      check(same(second.delivery, d) && first.delivery?.deliveryKey === d.deliveryKey && same(first.delivery.target, d.target) && first.delivery.pullRequest?.providerPullRequestId === d.pullRequest?.providerPullRequestId && same(first.delivery.actions, d.actions) && integer(first.delivery.revision) && first.delivery.revision <= d.revision, 'Resume changed PR, head, actions or attempts')
    }
    return value.arcs
  }
  const normalizations = () => {
    const value = read('readNormalizationObservation', context); exact(value, ['arcs'])
    members(value.arcs, ownerIds, 'Normalization')
    for (const row of value.arcs) {
      exact(row, ['arcId', 'plan', 'receipt'])
      const p = row.plan, r = row.receipt, { planDigest, ...body } = p
      check(p.version === 1 && p.arcId === row.arcId && r.arcId === row.arcId && planDigest === hash(JSON.stringify(body) + '\n') && r.planDigest === planDigest && r.base === p.base && r.oldHead === p.expectedHead && r.tree === p.expectedTree, 'Normalization plan/receipt binding mismatch')
      check(!Object.hasOwn(r, 'kind') && p.delivery?.publication === 'unpublished' && p.delivery.green === false && p.delivery.pullRequest === null, 'Cosmetic or unreceipted published normalization')
      check(p.groups?.length === contract.limits.historyPhaseCount && r.outcomes?.length === p.groups.length && same(p.phases, p.groups.map(group => group.phase)) && new Set(p.phases).size === p.groups.length, 'Normalization phase coverage mismatch')
      for (const head of [r.oldHead, r.newHead]) check(sha(head) && git(['rev-parse', head + '^{tree}']) === r.tree, 'Normalization changed final tree')
      check(git(['rev-parse', r.rescueRef]) === r.oldHead && git(['merge-base', r.newHead, delivery(row.arcId).target.currentHeadSha]) === r.newHead, 'Normalization rescue or current ancestry missing')
      let parent = p.base
      for (const [i, outcome] of r.outcomes.entries()) {
        const group = p.groups[i]
        check(outcome.phase === group.phase && outcome.sourceCommit === group.sourceBoundary.sha && outcome.sourceTree === group.sourceBoundary.tree && git(['rev-parse', outcome.sourceCommit + '^{tree}']) === outcome.sourceTree && git(['rev-parse', outcome.normalizedCommit + '^{tree}']) === outcome.sourceTree && git(['show', '-s', '--format=%P', outcome.normalizedCommit]) === parent, 'Normalization outcome mapping/tree/parent mismatch')
        parent = outcome.normalizedCommit
      }
      check(parent === r.newHead, 'Normalization chain does not reach receipt head')
    }
    return value
  }
  const cleanup = () => {
    const value = read('readCleanupObservation', context); exact(value, ['cases'])
    check(Array.isArray(value.cases) && value.cases.length === contract.limits.gcIdentityCount && new Set(value.cases.map(row => row.worktree)).size === value.cases.length, 'Cleanup identity estate incomplete or duplicated')
    for (const row of value.cases) {
      exact(row, ['identity', 'worktree', 'result', 'after']); exact(row.after, ['exists', 'headSha', 'recoverableHeadSha', 'branchRefSha'])
      const out = worktreeCleanupOutcome(row.result, row.identity, row.worktree), { item, receipt } = out
      check(typeof row.after.exists === 'boolean', 'Cleanup existence observation missing')
      if (out.removed) {
        check(row.identity && item?.classification === 'eligible' && same(item.identity, row.identity) && receipt.ownershipId === row.identity.ownershipId && receipt.state === 'removed' && receipt.disposal?.disposed === true && row.after.exists === false, 'Unsafe cleanup removal')
        const e = item.evidence
        check(e?.clean === true && e.recoverable === true && e.liveness === 'inactive' && e.protection?.state === 'unprotected' && sha(e.head) && item.observations?.length >= 2 && new Set(item.observations.map(o => o.invocationId)).size >= 2, 'Cleanup safety evidence missing')
        check(row.after.recoverableHeadSha === e.head && git(['rev-parse', e.head + '^{commit}']) === e.head, 'Removed worktree head is not recoverable')
        check(!row.identity.branch || receipt.disposal.branchDeleted === true || row.after.branchRefSha === e.head, 'Retained branch identity lost')
      } else {
        check(row.after.exists === true && text(out.reason) && (!receipt || receipt.state !== 'removed'), 'Held worktree was removed or outcome unresolved')
        check(!item || item.classification !== 'eligible' || receipt?.state === 'held' || receipt?.state === 'refused', 'Eligible cleanup lacks terminal outcome')
      }
    }
    return value
  }
  const evaluations = () => scenario.arcIds.map(arcId => {
    const value = read('readEvaluationObservation', { root: arm.worktree, arcId }); exact(value, ['summary'])
    check(value.summary?.arcId === arcId, 'Evaluation arc mismatch')
    assertDeliverySummary(value.summary, delivery(arcId))
    return value.summary
  })
  const sentinels = []
  const sentinel = (name, evaluate) => {
    try { const evidence = evaluate(); sentinels.push({ name, status: 'pass', ownerRefs: [arm.worktree], evidence: evidence ?? [], reason: null }) }
    catch (error) { sentinels.push({ name, status: error.evidenceStatus ?? 'fail', ownerRefs: [arm.worktree], evidence: [], reason: error.message }) }
  }
  sentinel('native-run-terminal', () => {
    const receipt = read('readRunReceipt', arm.worktree, { arcId: arm.request.arcId, runId: arm.runId })
    check(arm.request.driverId === condition.parent.driverId && arm.request.model === condition.parent.modelId && arm.request.worktree === arm.worktree && arm.request.baseHead === contract.fixture.baseSha && arm.request.authorityRef?.source?.ref === contract.externalActionAuthority.authorityRef, 'Parent request differs from frozen source/model/authority')
    nativeTerminal(receipt, arm.request); return [receipt.path]
  })
  sentinel('stable-pr-identity', () => { const rows = resumed(); check(rows.every(row => text(row.second.delivery.pullRequest?.providerPullRequestId)), 'Missing stable PR identity'); return rows.map(row => row.second.delivery.deliveryKey) })
  sentinel('branch-strategy', () => {
    const rows = deliveries()
    if (scenario.branchStrategy === 'grouped') check(rows[0].strategy.kind === 'grouped' && rows[0].strategy.order === 0 && text(rows[0].strategy.groupId), 'Grouped delivery owner mismatch')
    else for (const [i, row] of rows.entries()) {
      check(row.strategy.arcId === scenario.arcIds[i] && row.strategy.kind === (scenario.branchStrategy === 'stacked' && i > 0 ? 'stacked' : 'independent'), 'Frozen branch strategy mismatch')
      if (i > 0 && scenario.branchStrategy === 'stacked') check(row.strategy.predecessorDeliveryKey === rows[i - 1].deliveryKey && row.strategy.predecessorTargetKey === rows[i - 1].target.targetKey && row.target.baseRef === rows[i - 1].target.headRef && row.target.currentBaseSha === rows[i - 1].target.currentHeadSha, 'Stack predecessor identity mismatch')
    }
    check(new Set(rows.map(row => row.target.headRef)).size === rows.length && new Set(rows.map(row => row.pullRequest?.providerPullRequestId)).size === rows.length, 'Independent targets share branch or PR')
    return rows.map(row => row.deliveryKey)
  })
  sentinel('repair-classification', () => {
    const rows = lifecycle()
    for (const row of rows) for (const kind of ['causal', 'owned-preexisting', 'unrelated', 'infrastructure', 'flaky', 'indeterminate']) {
      const result = row.cases.find(c => c.criterion === kind).output, expected = kind === 'infrastructure' ? 'infra' : kind, eligible = ['causal', 'owned-preexisting'].includes(kind)
      check(['classified', 'held'].includes(result.status) && ['editable', 'unrelated', 'retryable', 'held', 'mixed'].includes(result.scope) && sha(result.headSha) && sha(result.gateInputKey) && Array.isArray(result.failures) && result.failures.length > 0 && result.failures.every(f => f.kind === expected && f.editEligible === eligible) && Array.isArray(result.editPaths) && (eligible ? result.editPaths.length > 0 : result.editPaths.length === 0), 'Failure classification permits unrelated edits or lacks evidence')
    }
    for (const d of deliveries()) {
      const binding = present(d.correctionBinding, 'correction binding'); bindingValid(binding)
      const changed = git(['diff', '--name-only', '-z', binding.route.sourceHeadSha, d.target.currentHeadSha, '--']).split('\0').filter(Boolean)
      check(changed.every(path => binding.route.scopePaths.includes(path)), 'Actual correction edits unrelated code')
    }
    return []
  })
  sentinel('bounded-review', () => { for (const d of deliveries()) bindingValid(d.correctionBinding); return [] })
  sentinel('history-normalization', () => { normalizations(); return [] })
  sentinel('gc-identity-recoverability', () => { cleanup(); return [] })
  sentinel('exact-head-green', () => { for (const d of deliveries()) { assertExactCurrentGreen(d); assertReachedDeliveryTerminal(d) }; return [] })
  sentinel('terminal-evaluation', () => evaluations().map(row => row.receiptRef))
  sentinel('idempotent-second-resume', () => { resumed(); return [] })
  sentinel('scenario-lifecycle-coverage', () => {
    const rows = lifecycle()
    for (const row of rows) for (const { criterion, output } of row.cases) {
      if (['blocked', 'stalled', 'unobserved', 'exited', 'review-exhausted', 'auth'].includes(criterion)) {
        exact(output, ['halt', 'phase', 'evidence', 'resume']); check(output.halt === criterion && output.resume === RESUME_LINE && Number.isInteger(output.phase) && output.phase > 0 && output.evidence !== null, 'Missing typed halt evidence or resume')
      } else if (['quota', 'timeout'].includes(criterion)) {
        const ci = ExactHeadCiResultShape.parse(output); check(ci.rollup === 'held' && ci.hold?.kind === criterion, 'Missing exact CI hold')
      } else if (criterion.startsWith('validation-')) {
        check(output.status === 'routed' && same(correctionBindingOf(output.routedCheckpoint), output.deliveryBinding), 'Correction output does not bind checkpoint')
        bindingValid(output.deliveryBinding); check(output.deliveryBinding.route.kind === criterion.slice('validation-'.length), 'Wrong correction route')
      } else if (criterion === 'repeated-input') check(output.blocked === true && Array.isArray(output.failures) && output.failures.length > 0 && output.failures.every(f => text(f.failure?.signature)), 'Unchanged failed input retry not blocked')
      else if (criterion === 'exact-head-green') check(same(output, delivery(row.arcId)), 'Lifecycle green differs from current delivery')
      else if (criterion === 'evaluation') check(same(output, evaluations().find(s => s.arcId === row.arcId)), 'Lifecycle evaluation differs from current summary')
      else if (criterion === 'second-resume') check(same(output, resumed().find(r => r.arcId === row.arcId).second), 'Lifecycle resume differs from canonical replay')
      else if (criterion === 'history-normalization') { const expected = normalizations().arcs.find(r => r.arcId === (scenario.branchStrategy === 'grouped' ? ownerIds[0] : row.arcId)); check(same(output, { plan: expected.plan, receipt: expected.receipt }), 'Lifecycle normalization differs from retained owner') }
      else if (criterion === 'worktree-gc') check(same(output, cleanup()), 'Lifecycle cleanup differs from retained owner')
    }
    return rows.map(row => row.arcId)
  })
  const valid = sentinels.every(row => row.status === 'pass')
  return frozen({ armId, status: valid ? 'valid' : 'invalid', absoluteScore: valid ? 1 : null, sentinels })
}
