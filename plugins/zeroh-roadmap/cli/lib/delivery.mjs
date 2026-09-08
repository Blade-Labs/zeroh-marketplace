import {evidenceCoversHead} from './delivery-evaluation.mjs'
import {readCorrectionReview} from './gate-report.mjs'
import { execFileSync } from 'node:child_process'
import { normalizeArc, loadPublishedCorrectionReceipt } from './history-normalize.mjs'
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, parse, resolve } from 'node:path'
import { isDeepStrictEqual as same } from 'node:util'
import { roadmapRoot, consumerSchemaPath } from './roadmap-root.mjs'
import { bridgeEval, bridgeParseShape } from './tsx-bridge.mjs'
import { withFileLock } from './file-lock.mjs'
import { publishImmutableFile } from './sidecar.mjs'

export const isDeliverySha = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
export const deliveryActionKeyOf = (state, kind, requested) => JSON.stringify([state.schemaVersion, state.deliveryKey, kind, requested.baseSha, requested.headSha])
export const deliveryKeyOf = target => JSON.stringify([target.providerId, target.repositoryId, target.targetKey])
const clone = structuredClone
const baseKeys = ['type', 'deliveryKey', 'targetKey', 'expectedRevision', 'at']
const eventKeys = {
  'record-correction-binding': [...baseKeys,'checkpoint','binding'],
  initialize: [...baseKeys, 'state'], 'request-action': [...baseKeys, 'action'],
  'record-action-attempt': [...baseKeys, 'actionKey', 'attempt'], 'observe-pr': [...baseKeys, 'pullRequest'],
  'observe-checks': [...baseKeys, 'checks'], 'set-terminal': [...baseKeys, 'terminal'], hold: [...baseKeys, 'reason'],
  'advance-head': [...baseKeys, 'actionKey', 'fromHeadSha', 'toHeadSha', 'observedBaseSha'],
  'advance-base': [...baseKeys, 'fromBaseSha', 'toBaseSha'],
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !same(Object.keys(value).sort(), [...keys].sort())) throw new Error(`${label} has unknown or missing field`)
}
function sameActionIntent(a, b) {
  const { status: aStatus, attempts: aAttempts, ...left } = a
  const { status: bStatus, attempts: bAttempts, ...right } = b
  return same(left, right)
}
function replay(state, event) {
  switch (event.type) {
    case 'initialize': return same(state, event.state)
    case 'request-action': return event.action.status === 'requested' && event.action.attempts.length === 0 && state.actions.some(a => a.actionKey === event.action.actionKey && sameActionIntent(a, event.action))
    case 'record-action-attempt': return state.actions.some(a => a.actionKey === event.actionKey && a.attempts.some(x => x.attempt === event.attempt.attempt && same(x, event.attempt)))
    case 'observe-pr': return same(state.pullRequest, event.pullRequest)
    case 'observe-checks': return same(state.checks, event.checks)
    case 'set-terminal': return same(state.terminal, event.terminal)
    case 'hold': return state.terminal.status === 'held' && state.terminal.reason === event.reason
    case 'advance-head': return state.target.currentHeadSha === event.toHeadSha && state.target.currentBaseSha === event.observedBaseSha && state.actions.some(a => a.actionKey === event.actionKey && a.kind === 'push' && a.status === 'succeeded' && a.requested.headSha === event.toHeadSha && a.requested.ref === state.target.headRef)
    case 'record-correction-binding': return same(state.correctionBinding,event.binding)&&same(correctionBindingOf(event.checkpoint),event.binding)&&event.binding.route.sourceHeadSha===state.target.currentHeadSha
    case 'advance-base': return state.target.currentBaseSha === event.toBaseSha
    default: return false
  }
}
export function assertExactCurrentPullRequest(state,{allowMerged=false}={}) {
  const p=state.pullRequest,t=state.target
  if(!p||p.providerId!==t.providerId||p.repositoryId!==t.repositoryId||p.targetKey!==t.targetKey||p.draft||!(allowMerged?['open','merged']:['open']).includes(p.state)||p.baseRef!==t.baseRef||p.headRef!==t.headRef||p.baseSha!==t.currentBaseSha||p.headSha!==t.currentHeadSha)throw Error('green terminal requires exact current pull request head')
}
export function assertCheckObservation(state, evidence) {
  const target=state.target, required=state.requested.requiredChecks, prior=state.checks
  if(!evidence||!state.pullRequest||evidence.providerId!==target.providerId||evidence.repositoryId!==target.repositoryId||evidence.providerPullRequestId!==state.pullRequest.providerPullRequestId||evidence.headSha!==target.currentHeadSha||!same(evidence.requiredChecks,required)||!Array.isArray(evidence.observedChecks)||!same(evidence.observedChecks.map(row=>row.name),required))throw Error('check observation identity or configured names differ')
  const at=Date.parse(evidence.observedAt)
  if(!Number.isFinite(at)||evidence.observedChecks.some(row=>row.observedAt!==evidence.observedAt))throw Error('check observation requires one valid timestamp')
  if(prior&&prior.headSha===evidence.headSha&&prior.providerPullRequestId===evidence.providerPullRequestId){
    const previous=Date.parse(prior.observedAt)
    if(at<previous||(at===previous&&!same(prior,evidence)))throw Error('check observation time regressed or conflicts at the same timestamp')
  }
}
function exactChecks(state, terminal) {
  const c = state.checks, p = state.pullRequest, t = state.target, required = state.requested.requiredChecks
  assertExactCurrentPullRequest(state,{allowMerged:terminal.status==='merged'})
  if(terminal.headSha!==t.currentHeadSha)throw Error('green terminal requires exact current pull request head')
  if (!c || c.providerId !== t.providerId || c.repositoryId !== t.repositoryId || c.providerPullRequestId !== p.providerPullRequestId || c.headSha !== t.currentHeadSha || required.length === 0 || new Set(required).size !== required.length || !same(c.requiredChecks, required) || c.observedChecks.length !== required.length || required.some(n => c.observedChecks.filter(x => x.name === n && x.status === 'green').length !== 1)) throw new Error('green terminal requires exact nonempty all-green check evidence')
  if (terminal.status === 'open-green' && terminal.checksObservedAt !== c.observedAt) throw new Error('green terminal names stale check evidence')
}
/** Shared current-head invariant; it certifies observations, never provider authority. */
export function assertExactCurrentGreen(state) {
  exactChecks(state,{status:state.terminal.status==='merged'?'merged':'open-green',headSha:state.target.currentHeadSha,checksObservedAt:state.checks?.observedAt})
}

/** Pure terminal decision. Callers persist events and journal actions through existing seams. */
export function finalizeDelivery(state,{capabilities,at}={}) {
  const held=reason=>({status:'held',reason})
  if(!state||!at||!Number.isFinite(Date.parse(at)))return held('A canonical delivery and observation timestamp are required.')
  const transition=terminal=>({status:'transition',event:{type:'set-terminal',deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,expectedRevision:state.revision,at,terminal}})
  if(['open-green','queued','merged'].includes(state.terminal.status)){try{assertReachedDeliveryTerminal(state);return transition(clone(state.terminal))}catch(error){return {status:'pending',reason:error.message}}}
  try{assertExactCurrentGreen(state)}catch(error){return {status:'pending',reason:error.message}}
  const kind=state.requested.terminal
  if(kind==='open')return transition({status:'open-green',headSha:state.target.currentHeadSha,checksObservedAt:state.checks.observedAt})
  if(!['queue','merge'].includes(kind))return held('Unsupported terminal policy.')
  const supported=capabilities?.supported
  if(capabilities?.providerId!==state.target.providerId||!Array.isArray(supported)||!supported.includes(kind)||state.requested.requiredCapabilities.some(name=>!supported.includes(name)))return held('Provider lacks the required terminal capability.')
  if(!state.requested.allowedPushRefs.includes(state.target.headRef))return held('Terminal action lacks exact allowed-ref authority.')
  const authority=state.requested.authority[kind]
  if(!authority)return held('No recorded terminal authority; configuration and local mergePolicy cannot grant it.')
  const t=state.target,actionKey=deliveryActionKeyOf(state,kind,{baseSha:t.currentBaseSha,headSha:t.currentHeadSha})
  const action={actionKey,kind,targetKey:t.targetKey,requested:{baseSha:t.currentBaseSha,headSha:t.currentHeadSha,ref:t.headRef,authorityId:authority.authorityId},status:'requested',attempts:[]}
  const prior=state.actions.find(row=>row.actionKey===actionKey)
  if(prior&&!sameActionIntent(prior,action))return held('Terminal action conflicts with the recorded policy or target.')
  if(!prior||prior.status!=='succeeded')return {status:'action-required',action:clone(prior??action)}
  const observed=prior.attempts.at(-1)?.observed,id=observed?.providerActionId
  if(observed?.outcome!=='succeeded'||observed.errorKind!==null||typeof id!=='string'||!id)return held('Terminal action has no successful provider observation.')
  if(kind==='merge'&&!isDeliverySha(id))return held('Merged terminal requires the observed merge commit SHA.')
  return transition({status:kind==='queue'?'queued':'merged',headSha:t.currentHeadSha,providerActionId:id,...(kind==='merge'?{mergeSha:id}:{})})
}

function actionAuthority(state, action) {
  if (action.targetKey !== state.target.targetKey) throw new Error('action target mismatch')
  if (action.requested.ref !== state.target.headRef) throw new Error('action ref differs from delivery target')
  if (action.kind === 'push' && !state.requested.allowedPushRefs.includes(action.requested.ref)) throw new Error('push action lacks allowed ref authority')
  if (['queue', 'merge'].includes(action.kind)) {
    const authority = state.requested.authority[action.kind]
    if (state.requested.terminal !== action.kind || !authority || action.requested.authorityId !== authority.authorityId) throw new Error(`${action.kind} action lacks requested policy and recorded authority`)
  }
}
function validateTerminal(state, terminal) {
  if (!['open-green', 'queued', 'merged'].includes(terminal.status)) return
  exactChecks(state, terminal)
  if (terminal.status === 'open-green') {
    if (state.requested.terminal !== 'open') throw new Error('open terminal exceeds requested terminal policy')
    return
  }
  const kind = terminal.status === 'queued' ? 'queue' : 'merge', authority = state.requested.authority[kind]
  if (state.requested.terminal !== kind || !authority || !state.actions.some(a => a.kind === kind && a.status === 'succeeded' && a.requested.authorityId === authority.authorityId && a.requested.headSha === state.target.currentHeadSha && a.requested.baseSha === state.target.currentBaseSha && a.requested.ref === state.target.headRef && a.attempts.at(-1)?.observed?.providerActionId === terminal.providerActionId)) throw new Error(`${kind} terminal lacks matching successful current-head authorized action`)
}

/** Verify a reached terminal without granting or requesting another provider action. */
export function assertReachedDeliveryTerminal(state) {
  if(!['open-green','queued','merged'].includes(state?.terminal?.status))throw Error('Delivery terminal is not reached')
  validateTerminal(state,state.terminal)
}

// Provider calls consume durable intent through the same authority/check guards as the reducer.
export function authorizeProviderAction(state, supplied, expected, { providerId, method, kind, capabilities = null } = {}) {
  const deny = reason => ({ ok: false, reason })
  if (!state || !expected || !supplied) return deny('durable delivery intent is missing')
  if (!same(Object.keys(supplied).sort(), ['actionKey','kind','targetKey','requested','status','attempts'].sort()) || !supplied.requested || !same(Object.keys(supplied.requested).sort(), ['baseSha','headSha','ref','authorityId'].sort())) return deny('caller action has unknown or missing fields')
  const target = state.target, bindings = { revision:state.revision,deliveryKey:state.deliveryKey,...target }
  for (const [field,value] of Object.entries(bindings)) if (expected[field] !== value) return deny(`expected ${field} differs from durable delivery`)
  if (providerId !== target.providerId) return deny('provider differs from durable delivery')
  if (expected.providerPullRequestId !== undefined && expected.providerPullRequestId !== (state.pullRequest?.providerPullRequestId ?? null)) return deny('expected pull request differs from durable delivery')
  const persisted = state.actions.find(action => action.actionKey === supplied.actionKey)
  if (!persisted || persisted.kind !== kind || supplied.kind !== kind) return deny('persisted action is missing or has a different kind')
  if (!sameActionIntent(persisted,supplied)) return deny('caller action differs from durable intent')
  if (!['requested','unknown'].includes(persisted.status)) return deny('persisted action is not pending or reconcilable')
  if (persisted.targetKey !== target.targetKey || persisted.requested.ref !== target.headRef || persisted.requested.baseSha !== target.currentBaseSha) return deny('action target, ref or base differs from delivery')
  if (kind !== 'push' && persisted.requested.headSha !== target.currentHeadSha) return deny('action head differs from delivery')
  try { actionAuthority(state,persisted) } catch (error) { return deny(error.message) }
  if (['queue','merge'].includes(kind)) {
    if (!state.requested.allowedPushRefs.includes(target.headRef)) return deny('terminal ref is outside durable authority')
    try { exactChecks(state,{status:kind==='queue'?'queued':'merged',headSha:target.currentHeadSha}) } catch (error) { return deny(error.message) }
    if (capabilities !== null && !capabilities.supported?.includes(method)) return deny('terminal capability is unsupported')
  }
  if (kind === 'update-pr' && (!state.pullRequest || expected.providerPullRequestId !== state.pullRequest.providerPullRequestId)) return deny('update requires exact persisted PR identity')
  return { ok:true,action:persisted }
}

// Full nested parsing belongs to the canonical schema at the persistence boundary.
export function reduceDelivery(current, event) {
  if (!Object.hasOwn(eventKeys, event?.type)) throw new Error('unknown delivery event type')
  exactKeys(event, eventKeys[event.type], 'delivery event')
  if (current === null) {
    if (event.type !== 'initialize' || event.expectedRevision !== null) throw new Error('delivery initialization requires absent state and null revision')
    const next = clone(event.state)
    if (next.revision !== 0 || next.deliveryKey !== event.deliveryKey || next.target.targetKey !== event.targetKey || next.createdAt !== event.at || next.updatedAt !== event.at) throw new Error('malformed delivery initialization')
    return next
  }
  if (event.deliveryKey !== current.deliveryKey || event.targetKey !== current.target.targetKey) throw new Error('delivery event stable-key mismatch')
  if (event.type === 'request-action') {
    if (event.action.status !== 'requested' || event.action.attempts.length !== 0) throw new Error('requested action cannot contain attempts or an observed status')
    const prior = current.actions.find(a => a.actionKey === event.action.actionKey)
    if (prior && !sameActionIntent(prior, event.action)) throw new Error('actionKey collision or conflicting replay')
  }
  if (event.expectedRevision !== current.revision) {
    if (replay(current, event)) return current
    throw new Error('delivery revision mismatch')
  }
  if (replay(current, event)) return current
  if (current.terminal.status === 'merged') throw new Error('merged delivery cannot accept another event')
  const next = clone(current)
  switch (event.type) {
    case 'initialize': throw new Error('delivery already initialized')
    case 'request-action': {
      if (event.action.status !== 'requested' || event.action.attempts.length !== 0) throw new Error('requested action cannot contain attempts or an observed status')
      actionAuthority(next, event.action)
      next.actions.push(clone(event.action)); break
    }
    case 'record-action-attempt': {
      const action = next.actions.find(a => a.actionKey === event.actionKey)
      if (!action) throw new Error('actionKey not found')
      const prior = action.attempts.find(a => a.attempt === event.attempt.attempt)
      if (prior) {
        if (prior.finishedAt !== null || prior.observed !== null || prior.startedAt !== event.attempt.startedAt || event.attempt.finishedAt === null || event.attempt.observed === null) throw new Error('action attempt collision')
        action.attempts[action.attempts.indexOf(prior)] = clone(event.attempt)
      } else {
        if (event.attempt.attempt !== action.attempts.length + 1 || action.attempts.at(-1)?.finishedAt === null) throw new Error('action attempts must be contiguous and the previous attempt finished')
        action.attempts.push(clone(event.attempt))
      }
      const last = action.attempts.at(-1)
      action.status = !last.finishedAt || !last.observed ? 'unknown' : last.observed.outcome
      break
    }
    case 'observe-pr': {
      const p = event.pullRequest, t = next.target
      if (p.providerId !== t.providerId || p.repositoryId !== t.repositoryId || p.targetKey !== t.targetKey || p.baseRef !== t.baseRef || p.headRef !== t.headRef || p.baseSha !== t.currentBaseSha || p.headSha !== t.currentHeadSha || (next.pullRequest && p.providerPullRequestId !== next.pullRequest.providerPullRequestId)) {
        next.terminal = { status: 'held', headSha: t.currentHeadSha, reason: 'pull request observation does not match delivery target' }; break
      }
      next.pullRequest = clone(p)
      if (['open-green', 'queued'].includes(next.terminal.status)) {
        try { validateTerminal(next, next.terminal) } catch { next.terminal = { status: 'awaiting-ci', headSha: t.currentHeadSha, reason: 'pull request observation invalidated prior green' } }
      }
      break
    }
    case 'observe-checks': {
      assertCheckObservation(current,event.checks)
      next.checks = clone(event.checks)
      if(next.terminal.status==='held')next.terminal={status:'awaiting-ci',headSha:next.target.currentHeadSha,reason:'New check evidence supersedes the previous observation hold.'}
      if (['open-green', 'queued'].includes(next.terminal.status)) {
        try { validateTerminal(next, next.terminal) } catch { next.terminal = { status: 'awaiting-ci', headSha: next.target.currentHeadSha, reason: 'check observation invalidated prior green' } }
      }
      break
    }
    case 'record-correction-binding': {
      next.correctionBinding=assertCorrectionBinding(current,event)
      next.terminal={status:'held',headSha:next.target.currentHeadSha,reason:event.binding.route.residual.length?'Bounded eligible repair; residual failures remain unresolved.':'Bounded correction requires checks, review, sweep and fresh intent validation.'}
      break
    }
    case 'set-terminal': validateTerminal(next, event.terminal); next.terminal = clone(event.terminal); break
    case 'hold': next.terminal = { status: 'held', headSha: next.target.currentHeadSha, reason: event.reason }; break
    case 'advance-head': {
      const action = next.actions.find(a => a.actionKey === event.actionKey)
      if (next.target.currentHeadSha !== event.fromHeadSha || next.target.currentBaseSha !== event.observedBaseSha) throw new Error('head advance has stale current binding')
      if (!action || action.kind !== 'push' || action.status !== 'succeeded' || action.requested.ref !== next.target.headRef || action.requested.headSha !== event.toHeadSha) throw new Error('head advance requires matching succeeded push action')
      actionAuthority(next, action)
      next.target.currentHeadSha = event.toHeadSha; next.checks = null
      next.terminal = { status: 'awaiting-ci', headSha: event.toHeadSha, reason: null }; break
    }
    case 'advance-base': {
      if (next.target.currentBaseSha !== event.fromBaseSha) throw new Error('base advance has stale current binding')
      next.target.currentBaseSha = event.toBaseSha; next.checks = null
      next.terminal = { status: 'awaiting-ci', headSha: next.target.currentHeadSha, reason: null }; break
    }
  }
  next.revision++; next.updatedAt = event.at
  return next
}

const canonicalBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
function assertSafeArcId(arcId) {
  if (typeof arcId !== 'string' || !arcId || arcId !== arcId.trim() || arcId === '.' || arcId === '..' || /[\\/\0]/.test(arcId)) throw new Error('delivery arcId must be a safe nonempty path component')
}
function statIfPresent(path) {
  try { return lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function inspectAncestors(path) {
  const absolute = resolve(path), root = parse(absolute).root
  let cursor = root
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    cursor = join(cursor, part)
    const stat = statIfPresent(cursor)
    if (!stat) continue
    if (stat.isSymbolicLink()) throw new Error(`delivery path crosses symlink: ${cursor}`)
    if (cursor !== absolute && !stat.isDirectory()) throw new Error(`delivery path ancestor is not a directory: ${cursor}`)
  }
}
function ensureDeliveryIgnore(directory) {
  const path = join(directory, '.gitignore')
  let fd
  try {
    if (publishImmutableFile(path, '*\n')) return
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    if (!fstatSync(fd).isFile() || readFileSync(fd, 'utf8') !== '*\n') throw new Error('delivery gitignore must be a regular self-ignore guard')
  } catch (error) { throw new Error(`unsafe delivery gitignore: ${error.message}`) }
  finally { if (fd !== undefined) closeSync(fd) }
}
function deliveryPaths(cwd, arcId, create) {
  assertSafeArcId(arcId)
  const directory = join(roadmapRoot(cwd), '.deliveries')
  inspectAncestors(directory)
  if (create) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    inspectAncestors(directory)
    if (realpathSync(directory) !== resolve(directory)) throw new Error('delivery directory is noncanonical')
    ensureDeliveryIgnore(directory)
  }
  const receipt = join(directory, `${arcId}.json`)
  return { directory, receipt, lock: `${receipt}.lock` }
}
function parseJson(bytes) {
  let value
  try { value = JSON.parse(bytes) } catch (error) { throw new Error(`delivery receipt is corrupt JSON: ${error.message}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('delivery receipt is corrupt: expected a JSON object')
  return value
}
function schemaError(result, label) {
  const detail = result.issues?.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') || result.stderr || result.kind
  return new Error(`${label}: ${detail}`)
}
function bridgePair(cwd, current, next) {
  const script = `
    Promise.all([import('file://' + process.argv[1]), import('node:fs')]).then(([m, fs]) => {
      const shape = m.ArcDeliveryShape ?? m.default?.ArcDeliveryShape
      if (!shape) throw new Error('ArcDeliveryShape missing from consumer schema; re-sync the schema')
      const parsed = JSON.parse(fs.readFileSync(0, 'utf8')).map(value => value === null ? null : shape.parse(value))
      process.stdout.write('PARSED:' + JSON.stringify(parsed))
    }).catch(error => {
      if (Array.isArray(error?.issues)) { process.stderr.write('ZODISSUES:' + JSON.stringify(error.issues)); process.exit(3) }
      process.stderr.write(String(error?.stack || error)); process.exit(4)
    })`
  const result = bridgeEval(cwd, script, { args: [consumerSchemaPath(cwd)], input: JSON.stringify([current, next]) })
  if (!result.ok) throw schemaError(result, 'delivery schema validation failed')
  const marker = result.stdout.indexOf('PARSED:')
  if (marker < 0) throw new Error('delivery schema parser returned no parsed result')
  return JSON.parse(result.stdout.slice(marker + 7))
}
function readRaw(paths) {
  inspectAncestors(paths.receipt)
  const stat = statIfPresent(paths.receipt)
  if (!stat) return null
  if (!stat.isFile()) throw new Error('delivery receipt must be a regular nonsymlink file')
  return parseJson(readFileSync(paths.receipt))
}
export function loadArcDelivery(cwd, arcId) {
  const raw = readRaw(deliveryPaths(cwd, arcId, false))
  if (raw === null) return null
  const parsed = bridgeParseShape(cwd, consumerSchemaPath(cwd), 'ArcDeliveryShape', raw)
  if (!parsed.ok) throw schemaError(parsed.res, 'delivery receipt schema parse failed')
  if (parsed.parsed.arcId !== arcId) throw new Error('delivery receipt has mismatched arc identity')
  return parsed.parsed
}
function assertActionEvolution(previous, next) {
  if (!same({ ...previous, status: null, attempts: null }, { ...next, status: null, attempts: null })) throw new Error('delivery action requested intent is immutable')
  if (next.attempts.length < previous.attempts.length) throw new Error('delivery action attempts cannot disappear')
  for (const [index, old] of previous.attempts.entries()) {
    const updated = next.attempts[index]
    if (same(old, updated)) continue
    if (index !== previous.attempts.length - 1 || old.finishedAt !== null || old.observed !== null || old.attempt !== updated?.attempt || old.startedAt !== updated.startedAt || updated.finishedAt === null || updated.observed === null) throw new Error('delivery action completion cannot be rewritten')
  }
}
function assertEvolution(current, next, allowBindings) {
  if (!next || next.schemaVersion !== 1) throw new Error('delivery schema version is stale')
  if (current === null) {
    if (next.revision !== 0 || next.actions.length || next.correctionBinding || next.pullRequest || next.checks || next.terminal.status !== 'preparing' || next.createdAt !== next.updatedAt) throw new Error('first delivery revision must be zero and preparing without observed outcomes')
    return
  }
  if(!same(current.correctionBinding,next.correctionBinding)){if(!allowBindings)throw Error('Correction binding requires an explicit transition');assertCorrectionEvolution(current.correctionBinding,next.correctionBinding)}
  if(next.checks&&!same(current.checks,next.checks))assertCheckObservation({...next,checks:current.checks},next.checks)
  if (next.revision !== current.revision + 1) throw new Error('delivery revision must advance exactly once')
  if (current.arcId !== next.arcId || current.deliveryKey !== next.deliveryKey) throw new Error('delivery immutable identity drift')
  for (const field of ['targetKey', 'providerId', 'repositoryId', 'baseRef', 'headRef']) {
    if (current.target[field] !== next.target[field]) throw new Error(`delivery immutable target drift: ${field}`)
  }
  if (!same(current.requested, next.requested) || !same(current.strategy, next.strategy) || current.createdAt !== next.createdAt) throw new Error('delivery requested policy or immutable address drift')
  if (!allowBindings && (current.target.currentBaseSha !== next.target.currentBaseSha || current.target.currentHeadSha !== next.target.currentHeadSha)) throw new Error('delivery commit binding drift requires an explicit transition event')
  if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) throw new Error('delivery update time cannot regress')
  if (current.terminal.status === 'merged') throw new Error('merged delivery cannot evolve')
  if (next.actions.length < current.actions.length) throw new Error('delivery actions cannot disappear')
  current.actions.forEach((action, index) => assertActionEvolution(action, next.actions[index]))
  for (const action of next.actions.slice(current.actions.length)) {
    if (action.status !== 'requested' || action.attempts.length) throw new Error('new requested action cannot contain observed results')
    actionAuthority(next, action)
  }
  if (current.pullRequest && (!next.pullRequest || current.pullRequest.providerPullRequestId !== next.pullRequest.providerPullRequestId)) throw new Error('delivery pull request identity cannot disappear or change')
}
function publish(paths, value) {
  const temp = join(paths.directory, `.${randomUUID()}.tmp`)
  let fd
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, canonicalBytes(value)); fsyncSync(fd); closeSync(fd); fd = undefined
    renameSync(temp, paths.receipt)
    const dirfd = openSync(paths.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(dirfd) } finally { closeSync(dirfd) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
function persist(cwd, expectedRevision, candidate, { allowBindings = false } = {}) {
  const paths = deliveryPaths(cwd, candidate?.arcId, true)
  return withFileLock(paths.lock, () => {
    const [current, next] = bridgePair(cwd, readRaw(paths), candidate)
    if (!next || next.arcId !== candidate.arcId || (current !== null && current.arcId !== candidate.arcId)) throw new Error('delivery receipt arc identity mismatch')
    if (current === null && expectedRevision !== null) throw new Error('delivery compare-and-swap expected an existing revision')
    if (current !== null && expectedRevision !== current.revision) {
      if (same(current, next)) return current
      throw new Error('stale delivery revision compare-and-swap')
    }
    if (current !== null && same(current, next)) return current
    assertEvolution(current, next, allowBindings)
    publish(paths, next)
    return next
  }, { label: 'delivery receipt' })
}
export function persistArcDelivery(cwd, expectedRevision, next) { return persist(cwd, expectedRevision, next) }
export function transitionArcDelivery(cwd, arcId, event) {
  assertSafeArcId(arcId)
  const parsedEvent = bridgeParseShape(cwd, consumerSchemaPath(cwd), 'DeliveryEventShape', event)
  if (!parsedEvent.ok) throw schemaError(parsedEvent.res, 'delivery event schema parse failed')
  if(event.type==='record-correction-binding'){
    const path=join(roadmapRoot(cwd),'.gate',`arc-${arcId}`,'validate.json');inspectAncestors(path)
    return withFileLock(`${path}.lock`,()=>{
      if(!same(JSON.parse(readFileSync(path,'utf8')),event.checkpoint))throw Error('Correction checkpoint must be persisted before its delivery binding')
      const current=loadArcDelivery(cwd,arcId),next=reduceDelivery(current,parsedEvent.parsed)
      return next===current?current:persist(cwd,event.expectedRevision,next,{allowBindings:true})
    },{label:'validation correction checkpoint'})
  }
  const current = loadArcDelivery(cwd, arcId), next = reduceDelivery(current, parsedEvent.parsed)
  if (next.arcId !== arcId) throw new Error('delivery transition arc identity differs from requested path')
  if (next === current) return current
  return persist(cwd, parsedEvent.parsed.expectedRevision, next, { allowBindings: true })
}

const publicationExpected = state => ({ revision:state.revision,deliveryKey:state.deliveryKey,...state.target,
  ...(state.pullRequest ? {providerPullRequestId:state.pullRequest.providerPullRequestId} : {}),
})
const publicationResult = (status,delivery,pullRequest=null,reason=null) => ({status,delivery,pullRequest,reason})
export function publishDelivery(request, {
  load=loadArcDelivery,transition=transitionArcDelivery,withLock:publicationLock=withFileLock,
  clock=()=>new Date().toISOString(),checkpoint=()=>{},
}={}) {
  const {root,arcId,provider}=request??{}
  try { assertSafeArcId(arcId) } catch { return publicationResult('refused',null,null,'publication owner is malformed') }
  if (typeof root!=='string'||!root||!provider) return publicationResult('refused',null,null,'publication request is malformed')
  let retained=null
  try {
  const lockPath=join(publicationLock===withFileLock?roadmapRoot(root):root,'.deliveries',`${arcId}.json.publish.lock`)
  return publicationLock(lockPath,()=>{
    const mark=(label,state)=>checkpoint(label,state?{revision:state.revision,deliveryKey:state.deliveryKey}:null)
    let state=load(root,arcId);retained=state
    mark('01-after-load',state)
    if (!state || state.arcId!==arcId) return publicationResult('refused',state,null,'delivery receipt is missing or has another owner')
    if(request.requirePullRequestId&&state.pullRequest?.providerPullRequestId!==request.requirePullRequestId)return publicationResult('held',state,state.pullRequest,'The required original PR identity is missing or changed')
    const candidateHead=request.publishHeadSha??request.expected?.publishHeadSha??state.target.currentHeadSha
    if (!isDeliverySha(candidateHead)) return publicationResult('refused',state,state.pullRequest,'publication head is malformed')
    if(request.expected){
      for(const [field,actual] of Object.entries({revision:state.revision,currentBaseSha:state.target.currentBaseSha,currentHeadSha:state.target.currentHeadSha})) if(request.expected[field]!==actual)return publicationResult('held',state,state.pullRequest,`delivery ${field} changed; reload and resume`)
      if(request.expected.publishHeadSha!==undefined&&request.expected.publishHeadSha!==candidateHead)return publicationResult('held',state,state.pullRequest,'publication head changed; reload and resume')
    }
    mark('02-after-request-binding',state)
    const context={root,cwd:root,ownerArcId:arcId,remote:request.remote??'origin',...(request.presentation==null?{}:{presentation:clone(request.presentation)})}
    const event=(type,extra={})=>({type,deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,expectedRevision:state.revision,at:clock(),...extra})
    const apply=(label,type,extra)=>{
      mark(`before-${label}`,state)
      state=transition(root,arcId,event(type,extra));retained=state
      mark(`after-${label}`,state)
      return state
    }
    const refusal=reason=>publicationResult('held',state,state.pullRequest,reason)
    function assertCorrectionDeadline(){
      const binding=state.correctionBinding
      if(!binding||candidateHead===binding.validationHead)return
      const now=Date.parse(clock()),deadline=Date.parse(binding.bounds?.deadlineAt)
      if(!Number.isFinite(now)||!Number.isFinite(deadline)||now>=deadline)throw Error('Shared correction deadline is exhausted; no new publication mutation is allowed')
    }
    function ensureAction(kind,headSha){
      const requested={baseSha:state.target.currentBaseSha,headSha,ref:state.target.headRef,authorityId:null},actionKey=deliveryActionKeyOf(state,kind,requested)
      let action=state.actions.find(row=>row.actionKey===actionKey)
      if(!action){
        assertCorrectionDeadline()
        action={actionKey,kind,targetKey:state.target.targetKey,requested,status:'requested',attempts:[]}
        apply(`${kind}-request`,'request-action',{action});action=state.actions.find(row=>row.actionKey===actionKey)
      }
      return action
    }
    function mutate(method,kind,headSha){
      let action=ensureAction(kind,headSha)
      if(action.status==='succeeded')return {status:'succeeded',action,pullRequest:state.pullRequest}
      assertCorrectionDeadline()
      const preflightInput={operation:method,context,repositoryId:state.target.repositoryId,target:clone(state.target),pullRequest:state.pullRequest&&clone(state.pullRequest)}
      mark(`before-${method}-preflight`,state)
      let preflight
      try{preflight=provider.preflight(preflightInput)}catch(error){return {status:'held',reason:`provider preflight failed: ${error.message}`}}
      mark(`after-${method}-preflight`,state)
      if(!preflight||preflight.status!=='ready')return {status:preflight?.status==='refused'?'refused':'held',reason:preflight?.remedy??'provider preflight is not ready'}
      if(preflight.providerId!==state.target.providerId||preflight.repositoryId!==state.target.repositoryId||preflight.operation!==method)return {status:'held',reason:'provider preflight identity differs from delivery'}
      action=state.actions.find(row=>row.actionKey===action.actionKey)
      let attempt=action.attempts.at(-1)
      if(!attempt||attempt.finishedAt!==null){
        assertCorrectionDeadline()
        attempt={attempt:action.attempts.length+1,startedAt:clock(),finishedAt:null,observed:null}
        apply(`${method}-attempt-${attempt.attempt}`,'record-action-attempt',{actionKey:action.actionKey,attempt})
        action=state.actions.find(row=>row.actionKey===action.actionKey);attempt=action.attempts.at(-1)
      }
      const providerRequest={action:clone(action),expected:{...publicationExpected(state),...(request.normalizationReceipt?{normalizationReceipt:request.normalizationReceipt}:{})},context}
      mark(`before-${method}-call`,state)
      assertCorrectionDeadline()
      let outcome
      try{outcome=provider[method](providerRequest)}catch(error){return {status:'held',reason:`provider ${method} outcome is unknown: ${error.message}`}}
      mark(`after-${method}-return`,state)
      if(!outcome||!['succeeded','unknown','failed','held','refused'].includes(outcome.status)||outcome.actionKey!==action.actionKey)return {status:'held',reason:`provider ${method} returned an unrecognized outcome`}
      if(['held','refused'].includes(outcome.status))return {status:outcome.status,reason:outcome.remedy??'provider action held'}
      if(outcome.status==='succeeded'&&(typeof outcome.providerActionId!=='string'||!outcome.providerActionId))return {status:'held',reason:'provider success lacks an observed action identity'}
      const completed={...attempt,finishedAt:clock(),observed:{providerActionId:outcome.providerActionId??null,outcome:outcome.status,errorKind:outcome.errorKind??null}}
      apply(`${method}-completion-${attempt.attempt}`,'record-action-attempt',{actionKey:action.actionKey,attempt:completed})
      action=state.actions.find(row=>row.actionKey===action.actionKey)
      return {status:outcome.status,action,pullRequest:outcome.pullRequest??null,reason:outcome.remedy??outcome.errorKind??null}
    }
    const push=mutate('push','push',candidateHead)
    if(push.status!=='succeeded')return publicationResult(push.status==='refused'?'refused':'held',state,state.pullRequest,push.reason??'publication push did not succeed')
    if(state.target.currentHeadSha!==candidateHead)apply('head-advance','advance-head',{actionKey:push.action.actionKey,fromHeadSha:state.target.currentHeadSha,toHeadSha:candidateHead,observedBaseSha:state.target.currentBaseSha})
    else mark('after-head-already-current',state)
    const createRequested={baseSha:state.target.currentBaseSha,headSha:state.target.currentHeadSha,ref:state.target.headRef,authorityId:null}
    const createKey=deliveryActionKeyOf(state,'create-pr',createRequested)
    let ownCreate=state.actions.find(row=>row.actionKey===createKey),observedPr=null
    // An interrupted create is reconciled through the same idempotent provider operation.
    if(ownCreate&&ownCreate.status!=='succeeded'){
      if(state.pullRequest||request.requirePullRequestId)return refusal('A known PR cannot be replaced by replaying another create action')
      const reconciled=mutate('create','create-pr',state.target.currentHeadSha)
      if(reconciled.status!=='succeeded')return publicationResult(reconciled.status==='refused'?'refused':'held',state,state.pullRequest,reconciled.reason??'pull request creation could not be reconciled')
      observedPr=reconciled.pullRequest;ownCreate=reconciled.action
    }
    if(!observedPr){
      const lookupPreflight={operation:'lookup',context,repositoryId:state.target.repositoryId,target:clone(state.target),pullRequest:state.pullRequest&&clone(state.pullRequest)}
      mark('before-lookup-preflight',state)
      let ready
      try{ready=provider.preflight(lookupPreflight)}catch(error){return refusal(`provider lookup preflight failed: ${error.message}`)}
      mark('after-lookup-preflight',state)
      if(!ready||ready.status!=='ready')return publicationResult(ready?.status==='refused'?'refused':'held',state,state.pullRequest,ready?.remedy??'provider lookup is not ready')
      if(ready.providerId!==state.target.providerId||ready.repositoryId!==state.target.repositoryId||ready.operation!=='lookup')return refusal('provider lookup preflight identity differs')
      const lookupRequest={repositoryId:state.target.repositoryId,deliveryKey:state.deliveryKey,targetKey:state.target.targetKey,baseRef:state.target.baseRef,headRef:state.target.headRef,currentBaseSha:state.target.currentBaseSha,currentHeadSha:state.target.currentHeadSha,context}
      mark('before-lookup-call',state)
      try{observedPr=provider.lookup(lookupRequest)}catch(error){return refusal(`provider lookup failed: ${error.message}`)}
      mark('after-lookup-return',state)
      if(observedPr?.status)return publicationResult(observedPr.status==='refused'?'refused':'held',state,state.pullRequest,observedPr.remedy??'provider lookup did not establish a pull request')
    }
    if(observedPr===null){
      if(state.pullRequest||request.requirePullRequestId)return refusal('The original PR is missing from lookup; reconcile it without creating a replacement')
      if(ownCreate?.status==='succeeded')return refusal('a succeeded create action has no matching pull request; reconcile provider state')
      const created=mutate('create','create-pr',state.target.currentHeadSha)
      if(created.status!=='succeeded'||!created.pullRequest)return publicationResult(created.status==='refused'?'refused':'held',state,state.pullRequest,created.reason??'pull request creation did not return a canonical receipt')
      observedPr=created.pullRequest;ownCreate=created.action
    }
    const t=state.target
    if(!observedPr||observedPr.providerId!==t.providerId||observedPr.repositoryId!==t.repositoryId||observedPr.targetKey!==t.targetKey||observedPr.baseRef!==t.baseRef||observedPr.headRef!==t.headRef||observedPr.baseSha!==t.currentBaseSha||observedPr.headSha!==t.currentHeadSha||observedPr.state!=='open'||observedPr.draft)return refusal('provider pull request is closed, draft, or differs from the exact delivery target')
    if(state.pullRequest&&state.pullRequest.providerPullRequestId!==observedPr.providerPullRequestId)return refusal('provider PR identity changed; reconcile before resume')
    const samePrFacts=(a,b)=>a&&b&&same({...a,observedAt:null},{...b,observedAt:null})
    if(!samePrFacts(state.pullRequest,observedPr))apply('pull-request-observation','observe-pr',{pullRequest:observedPr})
    else mark('after-pull-request-already-observed',state)
    // A PR created by this delivery already carries the requested presentation.
    if(!ownCreate&&request.presentation!=null){
      const updated=mutate('update','update-pr',state.target.currentHeadSha)
      if(updated.status!=='succeeded')return publicationResult(updated.status==='refused'?'refused':'held',state,state.pullRequest,updated.reason??'pull request update did not succeed')
      const p=updated.pullRequest
      if(p&&(['providerId','repositoryId','targetKey','baseRef','headRef'].some(key=>p[key]!==t[key])||p.baseSha!==t.currentBaseSha||p.headSha!==t.currentHeadSha||p.state!=='open'||p.draft||p.providerPullRequestId!==state.pullRequest.providerPullRequestId))return refusal('updated PR observation differs from the exact delivery target')
      if(p&&!samePrFacts(state.pullRequest,p))apply('updated-pull-request-observation','observe-pr',{pullRequest:p})
    }
    mark('publication-complete',state)
    return publicationResult('published',state,state.pullRequest,null)
  },{label:'delivery publication'})
  } catch (error) {
    try { retained=load(root,arcId) } catch { /* Preserve the last observed state when the store is unavailable. */ }
    return publicationResult('held',retained,retained?.pullRequest??null,`Publication interrupted; reload and resume: ${error.message}`)
  }
}

// The validation checkpoint owns correction bounds. Delivery retains only its latest binding.
const correctionPath = value => typeof value==='string'&&value.length>0&&!/[\\\x00-\x1f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..')
const isTime = value => typeof value==='string'&&Number.isFinite(Date.parse(value))
function assertCorrectionCheckpoint(checkpoint) {
  const c=checkpoint?.correction,b=c?.bounds
  if(checkpoint?.verdict!=='GAPS'||typeof checkpoint.arcId!=='string'||!isTime(checkpoint.at)||!c||!['awaiting-repair','needs-sweep'].includes(c.state)||!isDeliverySha(c.validationHead)||!isDeliverySha(c.gateInputKey)||!Number.isInteger(c.round)||c.round<0||c.round>2||!Number.isInteger(b?.maxRounds)||b.maxRounds<1||b.maxRounds>2||c.round>b.maxRounds||!isTime(b.deadlineAt)||!Array.isArray(b.allowedPathPrefixes)||!b.allowedPathPrefixes.length||!b.allowedPathPrefixes.every(correctionPath)||!['session','config'].includes(b.authority?.source)||typeof b.authority.reference!=='string'||!b.authority.reference||!Object.hasOwn(c,'route'))throw Error('Unknown or malformed typed correction bounds/usage; retain the existing checkpoint')
  if(c.route!==null&&(!['small-repair','planned-correction'].includes(c.route?.kind)||!isDeliverySha(c.route.sourceHeadSha)||!isDeliverySha(c.route.predecessorHeadSha)||!isTime(c.route.recordedAt)||!Array.isArray(c.route.selected)||!c.route.selected.length||!Array.isArray(c.route.residual)||!Array.isArray(c.route.scopePaths)))throw Error('Malformed correction route')
  exactKeys(b,['maxRounds','deadlineAt','allowedPathPrefixes','authority'],'correction bounds')
  exactKeys(b.authority,['source','reference'],'correction authority')
  if(c.route){
    const r=c.route
    if(c.round===0||r.sourceHeadSha!==c.validationHead||Date.parse(r.recordedAt)>=Date.parse(b.deadlineAt)||!r.scopePaths.length||!r.scopePaths.every(file=>correctionPath(file)&&b.allowedPathPrefixes.some(prefix=>file===prefix||file.startsWith(prefix+'/'))))throw Error('Correction route exceeds its head, round, deadline or scope authority bound')
    if(r.selected.some(f=>!['causal','owned-preexisting'].includes(f.kind)||!isDeliverySha(f.signature)||!Array.isArray(f.paths)||!f.paths.length||f.paths.some(file=>!r.scopePaths.includes(file)))||r.residual.some(f=>f.paths.some(file=>r.scopePaths.includes(file))))throw Error('Correction route contains noneligible or conflicting scope')
    if(r.kind==='small-repair'?!validTrace(r.trace)||r.plannedCorrection!==null:r.trace!==null||!validTrace(r.plannedCorrection)||!r.plannedCorrection.correctionId)throw Error('Correction route lacks the owning trace')
  }
  return c
}
export const correctionBindingOf = checkpoint => {
  const c=assertCorrectionCheckpoint(checkpoint)
  if(!c.route)throw Error('Correction checkpoint has no persisted route')
  return clone({validationHead:c.validationHead,gateInputKey:c.gateInputKey,round:c.round,bounds:c.bounds,route:c.route})
}
function assertCorrectionEvolution(previous,next) {
  if(!next)throw Error('Correction binding cannot disappear')
  if(!previous)return
  if(!same(previous.bounds,next.bounds)||next.round<previous.round||next.round>previous.round+1)throw Error('Correction bounds or usage cannot reset or grow')
  if(next.round===previous.round&&!same(previous,next))throw Error('An existing correction round cannot be rewritten')
}
const correctionFailure = f => ({checkKey:f.checkKey,attemptId:f.attemptId,signature:f.signature??f.diagnostic?.signature??null,kind:f.kind,paths:clone(f.paths)})
const validTrace = trace => trace&&Number.isInteger(trace.phaseId)&&trace.phaseId>0&&Array.isArray(trace.criterionIds)&&trace.criterionIds.length>0&&trace.criterionIds.every(id=>typeof id==='string'&&id.length>0)
export function decideCorrectionRoute({failureDecisions,validationCheckpoint,policy,delivery}) {
  const held=reason=>({status:'held',reason,routedCheckpoint:clone(validationCheckpoint),deliveryBinding:null,editableFailures:[],residualFailures:clone(failureDecisions?.failures??[]),editPaths:[]})
  try {
    const c=assertCorrectionCheckpoint(validationCheckpoint),d=failureDecisions
    if(!delivery||validationCheckpoint.arcId!==delivery.arcId||!isTime(policy?.at)||!isDeliverySha(policy.predecessorHeadSha)||policy.sourceHeadSha!==delivery.target.currentHeadSha||d?.headSha!==policy.sourceHeadSha||c.validationHead!==policy.sourceHeadSha||d.gateInputKey!==c.gateInputKey)throw Error('Correction head/input/checkpoint binding is stale')
    if(c.state!=='awaiting-repair')throw Error('Correction is awaiting sweep or validation, not another repair')
    if(policy.stop||!same(policy.authority,c.bounds.authority))throw Error('Correction authority is absent, changed, or explicitly stopped')
    if(Date.parse(policy.at)>=Date.parse(c.bounds.deadlineAt))throw Error('Shared correction deadline is exhausted')
    if(d.status!=='classified'||!Array.isArray(d.failures)||!Array.isArray(d.editPaths)||!d.retryDecision||d.retryDecision.blocked!==false)throw Error('Failure evidence is held or the existing unchanged-input retry limit is exhausted')
    if(new Set(d.failures.map(f=>f.checkKey)).size!==d.failures.length)throw Error('Conflicting duplicate failures')
    const editableFailures=d.failures.filter(f=>f.editEligible===true&&['causal','owned-preexisting'].includes(f.kind)),residualFailures=d.failures.filter(f=>!editableFailures.includes(f))
    if(!editableFailures.length)throw Error('No independently repairable failure')
    if(editableFailures.some(f=>!isDeliverySha(f.signature??f.diagnostic?.signature)||typeof f.checkKey!=='string'||typeof f.attemptId!=='string'||!Array.isArray(f.paths)||!f.paths.length||!f.paths.every(correctionPath)))throw Error('Eligible failure lacks exact signature, attempt or paths')
    const scopePaths=[...new Set(d.editPaths)].sort()
    if(!scopePaths.length||!scopePaths.every(file=>correctionPath(file)&&c.bounds.allowedPathPrefixes.some(prefix=>file===prefix||file.startsWith(prefix+'/')))||!editableFailures.every(f=>f.paths.every(file=>scopePaths.includes(file)))||residualFailures.some(f=>f.paths?.some(file=>scopePaths.includes(file))))throw Error('Repair scope grows beyond authority or overlaps a noneligible failure')
    const planned=policy.needsPlanning===true
    if(planned?!(validTrace(policy.plannedCorrection)&&typeof policy.plannedCorrection.correctionId==='string'&&policy.plannedCorrection.correctionId):!validTrace(policy.smallRepair))throw Error('One justified planned correction or existing phase/criterion trace is required')
    const route={kind:planned?'planned-correction':'small-repair',sourceHeadSha:policy.sourceHeadSha,predecessorHeadSha:policy.predecessorHeadSha,selected:editableFailures.map(correctionFailure),residual:residualFailures.map(correctionFailure),scopePaths,trace:planned?null:clone(policy.smallRepair),plannedCorrection:planned?clone(policy.plannedCorrection):null,reason:residualFailures.length?'Repair only the eligible subset; residual failures remain unresolved.':'Bounded repair of the observed eligible failures.',recordedAt:policy.at}
    if(delivery.correctionBinding&&(!same(delivery.correctionBinding.bounds,c.bounds)||c.round<delivery.correctionBinding.round))throw Error('Checkpoint bounds or usage differ from the last delivery binding')
    if(c.route){
      if(!same({...c.route,recordedAt:null},{...route,recordedAt:null}))throw Error('Checkpoint already routes different evidence; inspect actual work before another round')
      const binding=correctionBindingOf(validationCheckpoint)
      if(delivery.correctionBinding)assertCorrectionEvolution(delivery.correctionBinding,binding)
      return {status:'routed',routedCheckpoint:clone(validationCheckpoint),deliveryBinding:binding,editableFailures:clone(editableFailures),residualFailures:clone(residualFailures),editPaths:scopePaths}
    }
    if(c.round>=c.bounds.maxRounds)throw Error('Shared correction round limit is exhausted')
    const routedCheckpoint=clone(validationCheckpoint)
    routedCheckpoint.correction={...c,round:c.round+1,route}
    const binding=correctionBindingOf(routedCheckpoint)
    if(delivery.correctionBinding)assertCorrectionEvolution(delivery.correctionBinding,binding)
    return {status:'routed',routedCheckpoint,deliveryBinding:binding,editableFailures:clone(editableFailures),residualFailures:clone(residualFailures),editPaths:scopePaths}
  }catch(error){return held(error.message)}
}
function assertCorrectionBinding(state,event) {
  const binding=correctionBindingOf(event.checkpoint)
  if(event.checkpoint.arcId!==state.arcId||binding.route.sourceHeadSha!==state.target.currentHeadSha||binding.validationHead!==state.target.currentHeadSha||!same(binding,event.binding))throw Error('Correction binding differs from the exact checkpoint route/head')
  assertCorrectionEvolution(state.correctionBinding,binding)
  return binding
}
export function persistCorrectionCheckpoint(cwd,arcId,expected,next,{clock=()=>new Date().toISOString()}={}) {
  assertSafeArcId(arcId)
  const directory=join(roadmapRoot(cwd),'.gate',`arc-${arcId}`),receipt=join(directory,'validate.json')
  inspectAncestors(receipt)
  const parsed=bridgeParseShape(cwd,consumerSchemaPath(cwd),'CorrectionCheckpointShape',next)
  if(!parsed.ok)throw schemaError(parsed.res,'correction checkpoint schema parse failed')
  if(next.arcId!==arcId)throw Error('Correction checkpoint arc mismatch')
  return withFileLock(`${receipt}.lock`,()=>{
    const current=JSON.parse(readFileSync(receipt,'utf8'))
    if(same(current,next))return current
    if(!same(current,expected))throw Error('Correction checkpoint changed; reload before mutation')
    const before=assertCorrectionCheckpoint(current),after=assertCorrectionCheckpoint(next)
    if(!same(before.bounds,after.bounds)||after.round!==before.round+1||before.route!==null||!after.route||before.validationHead!==after.validationHead||before.gateInputKey!==after.gateInputKey)throw Error('Correction checkpoint bounds/usage cannot reset or grow')
    const now=Date.parse(clock()),deadline=Date.parse(after.bounds.deadlineAt)
    if(!Number.isFinite(now)||!Number.isFinite(deadline)||now>=deadline)throw Error('Shared correction deadline is exhausted before checkpoint mutation')
    publish({directory,receipt},next)
    return next
  },{label:'validation correction checkpoint'})
}

/** Publish a reviewed correction through the existing receipt and provider action owner. */
export function publishCorrection(request, deps={}) {
  const load=deps.load??loadArcDelivery,git=deps.git??((root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024}).trim()),normalize=deps.normalize??normalizeArc
  let state=null
  const held=reason=>publicationResult('held',state,state?.pullRequest??null,reason)
  try {
    const {root,arcId,repair}=request
    state=load(root,arcId)
    if(!state||state.arcId!==arcId||!state.pullRequest||!repair||!same(repair.correctionBinding,state.correctionBinding))return held('Repair is not bound to the existing delivery correction and PR')
    const binding=state.correctionBinding,source=binding.route.sourceHeadSha,head=repair.headSha,pr=state.pullRequest,t=state.target
    assertCorrectionCheckpoint({arcId,verdict:'GAPS',at:binding.route.recordedAt,correction:{state:'awaiting-repair',...binding}})
    if(repair.sourceHeadSha!==source||!isDeliverySha(head)||head===source||![source,head].includes(t.currentHeadSha)||pr.state!=='open'||pr.draft||pr.providerId!==t.providerId||pr.repositoryId!==t.repositoryId||pr.targetKey!==t.targetKey||pr.baseRef!==t.baseRef||pr.headRef!==t.headRef||pr.baseSha!==t.currentBaseSha||![source,head].includes(pr.headSha))return held('Correction source/head or original PR identity is stale')
    if(request.expected&&Object.entries({revision:state.revision,currentBaseSha:t.currentBaseSha,currentHeadSha:t.currentHeadSha}).some(([key,value])=>request.expected[key]!==value))return held('Correction caller has a stale delivery revision/head')
    if(['open-green','queued','merged'].includes(state.terminal.status))return held('Successful delivery history cannot be rewritten for cosmetics')
    if(git(root,['rev-parse','HEAD'])!==head||git(root,['status','--porcelain','--untracked-files=no']))return held('Correction requires its exact committed clean Git HEAD')
    const changed=git(root,['diff','--name-only','-z',source,head,'--']).split('\0').filter(Boolean)
    if(!changed.length)return held('Actual correction has no changed paths')
    { // Review authority is mandatory even when every product path is in scope.
      let checkpoint
      try{
        checkpoint=(deps.loadCheckpoint??((root,id)=>{
          const raw=JSON.parse(readFileSync(join(roadmapRoot(root),'.gate',`arc-${id}`,'validate.json'),'utf8')),parsed=bridgeParseShape(root,consumerSchemaPath(root),'CorrectionCheckpointShape',raw)
          if(!parsed.ok)throw Error('Invalid correction checkpoint');return parsed.parsed
        }))(root,arcId)
      }catch{return held('Actual correction edits exceed the selected repair scope without a validated evidence tail')}
      const c=checkpoint?.correction,projection=c&&Object.fromEntries(['validationHead','gateInputKey','round','bounds','route'].map(key=>[key,c[key]])),phase=binding.route.trace?.phaseId??binding.route.plannedCorrection?.phaseId
      const review=(deps.readReview??readCorrectionReview)(root,phase)
      if(checkpoint.arcId!==arcId||checkpoint.verdict!=='PASS'||c?.state!=='validated'||!same(projection,binding)||!isDeliverySha(c.repairHead)||repair.repairHeadSha&&repair.repairHeadSha!==c.repairHead||!review||review.arcId!==arcId||review.round!==binding.round||review.sourceHeadSha!==source||review.repairHead!==c.repairHead)return held('Repair evidence does not bind the current validated correction')
      let judgmentHead=head
      if(request.normalizationReceipt){
        const receipt=(deps.loadNormalizationReceipt??loadPublishedCorrectionReceipt)(root,arcId,request.normalizationReceipt.planDigest)
        if(receipt.newHead!==head||receipt.expectedOld!==source||receipt.publishedRef!==t.headRef||git(root,['rev-parse',`${receipt.oldHead}^{tree}`])!==git(root,['rev-parse',`${head}^{tree}`]))return held('Normalized correction differs from its reviewed tree')
        judgmentHead=receipt.oldHead
      }
      const productPaths=git(root,['diff','--name-only','-z',source,c.repairHead,'--']).split('\0').filter(Boolean)
      if(!productPaths.length||productPaths.some(path=>!binding.route.scopePaths.includes(path))||!evidenceCoversHead(root,c.repairHead,judgmentHead,{arcId}))return held('Actual correction edits exceed the selected repair scope or canonical evidence tail')
    }
    const alreadyPushed=state.actions.some(a=>a.kind==='push'&&a.status==='succeeded'&&a.requested.headSha===head&&a.requested.ref===t.headRef)
    let normalizationReceipt
    if(!alreadyPushed){
      const now=Date.parse((deps.clock??(()=>new Date().toISOString()))())
      if(!Number.isFinite(now)||now>=Date.parse(binding.bounds.deadlineAt))return held('Shared correction deadline is exhausted; no new correction publication is allowed')
      if(!state.checks||state.checks.headSha!==source||!state.checks.observedChecks.some(c=>c.status==='red'))return held('Correction publication requires observed red checks on its source head')
      if(request.normalizationReceipt){
        const digest=request.normalizationReceipt.planDigest,receipt=(deps.loadNormalizationReceipt??loadPublishedCorrectionReceipt)(root,arcId,digest)
        if(receipt.kind!=='published-corrections'||receipt.arcId!==arcId||receipt.planDigest!==digest||receipt.publishedRef!==t.headRef||receipt.expectedOld!==source||receipt.newHead!==head)return held('Verified correction normalization receipt does not bind the exact lease/head/ref')
        normalizationReceipt={planDigest:digest}
      }else{
        if(git(root,['merge-base',source,head])!==source)return held('Non-descendant correction requires its verified history normalization receipt')
        const result=normalize(root,arcId,{apply:false},request.normalizationDeps??{})
        if(result?.status!=='retained-corrections'||![1,2].includes(result.correctionCount)||result.newHead!==head)return held('Correction history needs the existing red-only normalization before publication')
      }
    }
    const result=(deps.publish??publishDelivery)({...request,publishHeadSha:head,requirePullRequestId:pr.providerPullRequestId,normalizationReceipt,expected:{revision:state.revision,currentBaseSha:t.currentBaseSha,currentHeadSha:t.currentHeadSha,publishHeadSha:head}},deps)
    if(result.status==='published'&&result.pullRequest?.providerPullRequestId!==pr.providerPullRequestId)return publicationResult('held',result.delivery,result.pullRequest,'Correction publication did not retain the original PR')
    return result
  }catch(error){return held(error.message)}
}
