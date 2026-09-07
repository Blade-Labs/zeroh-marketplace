import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, parse, resolve } from 'node:path'
import { isDeepStrictEqual as same } from 'node:util'
import { roadmapRoot, consumerSchemaPath } from './roadmap-root.mjs'
import { bridgeEval, bridgeParseShape } from './tsx-bridge.mjs'
import { withFileLock } from './file-lock.mjs'

export const deliveryKeyOf = target => JSON.stringify([target.providerId, target.repositoryId, target.targetKey])
const clone = structuredClone
const baseKeys = ['type', 'deliveryKey', 'targetKey', 'expectedRevision', 'at']
const eventKeys = {
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
    case 'advance-base': return state.target.currentBaseSha === event.toBaseSha
    default: return false
  }
}
function exactChecks(state, terminal) {
  const c = state.checks, p = state.pullRequest, t = state.target, required = state.requested.requiredChecks
  const states = terminal.status === 'merged' ? ['open', 'merged'] : ['open']
  if (!p || p.providerId !== t.providerId || p.repositoryId !== t.repositoryId || p.targetKey !== t.targetKey || p.draft || !states.includes(p.state) || p.baseRef !== t.baseRef || p.headRef !== t.headRef || p.baseSha !== t.currentBaseSha || p.headSha !== t.currentHeadSha || terminal.headSha !== t.currentHeadSha) throw new Error('green terminal requires exact current pull request head')
  if (!c || c.providerId !== t.providerId || c.repositoryId !== t.repositoryId || c.providerPullRequestId !== p.providerPullRequestId || c.headSha !== t.currentHeadSha || required.length === 0 || new Set(required).size !== required.length || !same(c.requiredChecks, required) || c.observedChecks.length !== required.length || required.some(n => c.observedChecks.filter(x => x.name === n && x.status === 'green').length !== 1)) throw new Error('green terminal requires exact nonempty all-green check evidence')
  if (terminal.status === 'open-green' && terminal.checksObservedAt !== c.observedAt) throw new Error('green terminal names stale check evidence')
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
      next.checks = clone(event.checks)
      if (['open-green', 'queued'].includes(next.terminal.status)) {
        try { validateTerminal(next, next.terminal) } catch { next.terminal = { status: 'awaiting-ci', headSha: next.target.currentHeadSha, reason: 'check observation invalidated prior green' } }
      }
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
function deliveryPaths(cwd, arcId, create) {
  assertSafeArcId(arcId)
  const directory = join(roadmapRoot(cwd), '.deliveries')
  inspectAncestors(directory)
  if (create) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    inspectAncestors(directory)
    if (realpathSync(directory) !== resolve(directory)) throw new Error('delivery directory is noncanonical')
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
    if (next.revision !== 0 || next.actions.length || next.pullRequest || next.checks || next.terminal.status !== 'preparing' || next.createdAt !== next.updatedAt) throw new Error('first delivery revision must be zero and preparing without observed outcomes')
    return
  }
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
  const current = loadArcDelivery(cwd, arcId), next = reduceDelivery(current, parsedEvent.parsed)
  if (next.arcId !== arcId) throw new Error('delivery transition arc identity differs from requested path')
  if (next === current) return current
  return persist(cwd, parsedEvent.parsed.expectedRevision, next, { allowBindings: true })
}
