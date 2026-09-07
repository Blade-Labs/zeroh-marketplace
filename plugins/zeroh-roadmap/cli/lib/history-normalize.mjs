import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { readFileSync, realpathSync, readdirSync, lstatSync } from 'node:fs'
import { gitToplevel } from './gitroot.mjs'
import { roadmapRoot, consumerSchemaPath } from './roadmap-root.mjs'
import { bridgeEval } from './tsx-bridge.mjs'
import { loadConfig, integrationRefOf } from './config.mjs'
import { latestReport, checkPhaseConsistency, correctnessDecision, GateRunReportShape } from './gate-report.mjs'
import { classifySubject, composeLandedMessage, ensureCurationRescue, prepareCuration, commitPreparedCuration } from './curate.mjs'
import { isCuratedTreeReplacement, phaseTaskSuffix, curationAncestry, derivePhaseStartSha } from './gitscan.mjs'

import { isDeepStrictEqual } from 'node:util'
import { publishImmutableFile } from './sidecar.mjs'
import { ensureReceiptDirectory, inspectReceiptAncestors } from './run-receipt.mjs'

export class HistoryNormalizationError extends Error {
  constructor(kind, message, options) { super(message, options); this.name = 'HistoryNormalizationError'; this.kind = kind }
}
const fail = (kind, message) => { throw new HistoryNormalizationError(kind, message) }
const git = (root, args) => execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const encoded = value => JSON.stringify(value) + '\n'
const exactCommit = (root, value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value) || git(root, ['rev-parse', '--verify', value + '^{commit}']) !== value) fail('input', 'normalization requires exact commit IDs')
  return value
}
function stableHead(root, head) {
  if (git(root, ['rev-parse', 'HEAD']) !== head) fail('head-changed', 'normalization HEAD differs from the requested commit')
  if (git(root, ['diff', '--name-only', 'HEAD', '--'])) fail('dirty', 'normalization refuses staged or unstaged tracked changes')
}

function recordFiles(root, head) {
  const directory = roadmapRoot(root), schema = consumerSchemaPath(root)
  const paths = [schema, join(dirname(schema), 'registry.ts')]
  for (const [dir, suffix] of [[join(directory, 'phases'), '.phase.ts'], [join(directory, 'arcs'), '.arc.ts']]) {
    inspectReceiptAncestors(dir)
    paths.push(...readdirSync(dir).filter(name => name.endsWith(suffix)).map(name => join(dir, name)))
  }
  return paths.map(path => {
    const rel = relative(root, path)
    if (!rel || rel.startsWith('../') || resolve(root, rel) !== path) fail('records-unproven', 'normalization records must belong to the current worktree')
    inspectReceiptAncestors(dirname(path))
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) fail('records-unproven', 'normalization record must be a regular nonsymlink file: ' + rel)
    let entry
    try { entry = git(root, ['ls-tree', head, '--', rel]) } catch { fail('records-unproven', 'untracked normalization record: ' + rel) }
    const match = /^(100644|100755) blob ([a-f0-9]+)\t/.exec(entry)
    if (!match) fail('records-unproven', 'untracked normalization record: ' + rel)
    return { path: rel, blob: match[2] }
  }).sort((a, b) => a.path.localeCompare(b.path))
}

const READ_RECORDS = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const input = JSON.parse(readFileSync(0, 'utf8'));
(async () => {
  const imported = await import(pathToFileURL(input.registry).href);
  const registry = imported.discoverPhases ? imported : imported.default;
  const sm = await import(pathToFileURL(input.schema).href);
  const schema = sm.PhaseShape ? sm : sm.default;
  const phaseRows = await registry.discoverPhases(input.phases);
  const arcRows = await registry.discoverArcs(input.arcs);
  const errors = [...(phaseRows.errors ?? []), ...(arcRows.errors ?? [])];
  if (errors.length) throw new Error('record discovery failed: ' + JSON.stringify(errors));
  const arcs = arcRows.arcs.map(a => schema.ArcShape.parse(a)).filter(a => String(a.id) === input.arcId);
  if (arcs.length !== 1) throw new Error('normalization needs exactly one typed arc');
  const phases = phaseRows.phases.map(p => schema.PhaseShape.parse(p));
  process.stdout.write('NORMALIZATION_RECORDS:' + JSON.stringify({arc:arcs[0],phases}));
})().catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1 });
`
function records(root, arcId) {
  const directory = roadmapRoot(root), schema = consumerSchemaPath(root)
  const result = bridgeEval(root, READ_RECORDS, { input: encoded({ registry: join(dirname(schema), 'registry.ts'), schema, phases: join(directory, 'phases'), arcs: join(directory, 'arcs'), arcId }) })
  const marker = 'NORMALIZATION_RECORDS:'
  if (!result.ok || !result.stdout.includes(marker)) fail('records', 'cannot load typed normalization records: ' + (result.stderr ?? result.kind ?? 'missing result'))
  return JSON.parse(result.stdout.slice(result.stdout.indexOf(marker) + marker.length))
}
function observation(root, input, inspectDelivery) {
  if (typeof inspectDelivery !== 'function') fail('delivery-unproven', 'normalization requires a current delivery observation')
  const value = inspectDelivery({ root, ...input })
  if (!value || typeof value !== 'object' || value.then || value.head !== input.head || !Array.isArray(value.publicationRefs) || value.publicationRefs.some(ref => typeof ref !== 'string')) fail('delivery-unproven', 'delivery observation is unavailable or not bound to the requested HEAD')
  if (value.green === true) fail('green', 'a green PR cannot be rewritten for normalization')
  if (value.publication === 'published' || value.pullRequest != null) fail('published', 'normalization is restricted to unpublished history')
  if (value.publication !== 'unpublished' || value.pullRequest !== null || value.green !== false) fail('delivery-unproven', 'delivery observation does not establish unpublished history')
  return { head: value.head, publication: value.publication, pullRequest: null, green: false, publicationRefs: [...new Set(value.publicationRefs)].sort() }
}
function publicationRefs(root, config, observed) {
  const exists = ref => {
    try { git(root, ['show-ref', '--verify', '--quiet', ref]); return true }
    catch (error) { if (error.status === 1) return false; throw error }
  }
  const validate = ref => {
    if (!ref.startsWith('refs/') || /[\0\r\n]/.test(ref)) fail('publication-unproven', 'publication must name an exact Git ref')
    try { git(root, ['check-ref-format', ref]) } catch { fail('publication-unproven', 'publication ref is malformed: ' + ref) }
  }
  const refs = new Set()
  const configured = integrationRefOf(config)
  if (typeof configured !== 'string' || !configured || configured.startsWith('-')) fail('publication-unproven', 'configured integration ref is malformed')
  const choices = configured.startsWith('refs/') ? [configured] : ['refs/heads/' + configured, 'refs/remotes/' + configured]
  for (const ref of choices) validate(ref)
  const found = choices.filter(exists)
  if (found.length > 1) fail('publication-unproven', 'configured integration ref is ambiguous')
  for (const ref of found) refs.add(ref)
  const local = choices.find(ref => ref.startsWith('refs/heads/'))
  if (local) {
    const counterpart = 'refs/remotes/origin/' + local.slice('refs/heads/'.length)
    validate(counterpart); if (exists(counterpart)) refs.add(counterpart)
  }
  for (const ref of observed.publicationRefs) {
    validate(ref)
    if (!exists(ref)) fail('publication-unproven', 'provider publication ref is unavailable: ' + ref)
    refs.add(ref)
  }
  return [...refs].sort().map(ref => ({ ref, head: exactCommit(root, git(root, ['rev-parse', '--verify', ref + '^{commit}'])) }))
}
function gateBinding(root, phase, substantive) {
  const latest = latestReport(root, phase.phase)
  if (!latest) fail('gate-unproven', 'missing gate evidence for phase ' + phase.phase)
  const bytes = readFileSync(latest.path), report = GateRunReportShape.parse(JSON.parse(bytes.toString('utf8')))
  const check = checkPhaseConsistency(phase, report)
  const round = report.agents.filter(row => row.round >= 1).at(-1)
  if (!check.ok || !correctnessDecision(report.agents).terminal || !round || /self[\s_-]?review|phase-executor/i.test(round.agent)) fail('gate-unproven', 'phase ' + phase.phase + ' lacks consistent independent terminal gate evidence: ' + check.problems.join('; '))
  const reviewed = exactCommit(root, round.sha)
  if (reviewed !== substantive.sha && !isCuratedTreeReplacement(root, reviewed, substantive.sha)) fail('gate-stale', 'phase ' + phase.phase + ' has substantive changes after its terminal review')
  return { path: relative(root, latest.path), digest: hash(bytes), baseSha: report.baseSha, reviewedHead: reviewed }
}

/** Plan only: Git objects, refs, runtime files and the consumer tree stay untouched. */
export function planHistoryNormalization(cwd, input, deps = {}) {
  return deriveNormalization(cwd, input, deps)
}

function deriveNormalization(cwd, input, deps, currentHead = input?.head, historicalRefs = null) {
  try {
    if (!input || Object.keys(input).some(key => !['arcId', 'base', 'head'].includes(key)) || typeof input.arcId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(input.arcId)) fail('input', 'normalization accepts only arcId and exact base/head commits')
    const root = realpathSync(gitToplevel(cwd)), { arcId, base, head } = input
    exactCommit(root, base); exactCommit(root, head); stableHead(root, currentHead)
    try { git(root, ['merge-base', '--is-ancestor', base, head]) } catch { fail('base', 'normalization base is not an ancestor of HEAD') }
    const observed = observation(root, input, deps.inspectDelivery)
    const rows = git(root, ['log', '--reverse', '--format=%H%x00%P%x00%T%x00%s', base + '..' + head]).split('\n').filter(Boolean).map(line => {
      const [sha, parents, tree, subject] = line.split('\0')
      if (parents.split(' ').length !== 1) fail('merge', 'normalization refuses merge commit ' + sha)
      return { sha, tree, subject }
    })
    if (!rows.length) fail('empty', 'normalization range has no outcome commits')
    const refs = historicalRefs ?? publicationRefs(root, loadConfig(root), observed), owned = new Set(rows.map(row => row.sha))
    for (const ref of refs) if (git(root, ['rev-list', ref.head, '^' + base]).split('\n').some(sha => owned.has(sha))) fail('published', 'normalization range is already on ' + ref.ref)
    const sources = recordFiles(root, head)
    const loaded = records(root, arcId)
    const ids = loaded.arc.planes.flatMap(plane => plane.phases)
    if (!ids.length || new Set(ids).size !== ids.length) fail('records', 'arc phases are empty or duplicated')
    const phases = ids.map(id => {
      const matches = loaded.phases.filter(phase => phase.phase === id)
      if (matches.length !== 1 || String(matches[0].arcId) !== arcId || matches[0].status !== 'done' || matches[0].tasks.some(task => !task.done)) fail('records', 'arc member ' + id + ' is absent, ambiguous or incomplete')
      return matches[0]
    })
    const groups = phases.map(phase => ({ phase: phase.phase, commits: [] })), foreign = []
    const taskIds = new Set(phases.flatMap(phase => phase.tasks.map(task => task.id)))
    let previous = 0
    for (const row of rows) {
      const suffix = phaseTaskSuffix(row.subject)
      if (suffix && ids.includes(Number(suffix.split('.')[0])) && !taskIds.has(suffix)) { foreign.push(row.sha); continue }
      const matches = phases.flatMap((phase, index) => {
        const kind = classifySubject(row.subject, phase.phase, phase.tasks.map(task => task.id))
        return kind ? [{ index, kind }] : []
      })
      if (matches.length !== 1) { foreign.push(row.sha); continue }
      const { index, kind } = matches[0]
      if (index < previous) fail('ordering', 'phase commit blocks are not monotonic at ' + row.sha)
      previous = index
      groups[index].commits.push({ sha: row.sha, subject: row.subject, kind })
    }
    if (foreign.length) fail('ownership', 'foreign or ambiguous normalization commits: ' + foreign.join(', '))
    for (const [index, group] of groups.entries()) {
      const last = group.commits.at(-1), substantive = group.commits.filter(row => row.kind === 'task' || row.kind === 'gate-fix').at(-1)
      if (!last || !substantive) fail('ownership', 'phase ' + group.phase + ' has no substantive outcome commit')
      group.sourceBoundary = { sha: last.sha, tree: rows.find(row => row.sha === last.sha).tree }
      group.parent = index ? { phase: groups[index - 1].phase } : { base }
      group.message = composeLandedMessage(phases[index], group)
      group.gate = gateBinding(root, phases[index], substantive)
    }
    stableHead(root, currentHead)
    const plan = { version: 1, arcId, base, expectedHead: head, expectedTree: git(root, ['show', '-s', '--format=%T', head]), phases: ids, groups, recordFiles: sources, delivery: observed, publicationRefs: refs }
    plan.planDigest = hash(encoded(plan))
    return plan
  } catch (error) {
    if (error instanceof HistoryNormalizationError) throw error
    throw new HistoryNormalizationError('unproven', 'normalization preflight failed: ' + error.message, { cause: error })
  }
}

const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && isDeepStrictEqual(Object.keys(value).sort(), names.split(' ').sort())
const oid = value => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)
const digestValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const repoPath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git')
function validatePlan(root, plan) {
  if (!plan || !isDeepStrictEqual(Object.keys(plan).sort(), ['version', 'arcId', 'base', 'expectedHead', 'expectedTree', 'phases', 'groups', 'recordFiles', 'delivery', 'publicationRefs', 'planDigest'].sort())) fail('plan', 'normalization plan fields are invalid')
  if (typeof plan.arcId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(plan.arcId) || !oid(plan.expectedTree)
    || !Array.isArray(plan.phases) || plan.phases.some(id => !Number.isSafeInteger(id) || id < 0) || new Set(plan.phases).size !== plan.phases.length
    || !keys(plan.delivery, 'head publication pullRequest green publicationRefs') || plan.delivery.head !== plan.expectedHead
    || plan.delivery.publication !== 'unpublished' || plan.delivery.pullRequest !== null || plan.delivery.green !== false
    || !Array.isArray(plan.delivery.publicationRefs) || plan.delivery.publicationRefs.some(ref => typeof ref !== 'string')
    || !Array.isArray(plan.publicationRefs) || plan.publicationRefs.some(row => !keys(row, 'ref head') || typeof row.ref !== 'string' || !row.ref.startsWith('refs/') || !oid(row.head))
    || !Array.isArray(plan.recordFiles) || !plan.recordFiles.length) fail('plan', 'normalization plan values are invalid')
  if (!isDeepStrictEqual(plan.delivery.publicationRefs, [...new Set(plan.delivery.publicationRefs)].sort())
    || !isDeepStrictEqual(plan.publicationRefs.map(row => row.ref), [...new Set(plan.publicationRefs.map(row => row.ref))].sort())) fail('plan', 'publication refs are not canonical')
  for (const ref of [...plan.delivery.publicationRefs, ...plan.publicationRefs.map(row => row.ref)]) git(root, ['check-ref-format', ref])
  let previousPath = null
  for (const row of plan.recordFiles) {
    if (!keys(row, 'path blob') || !repoPath(row.path) || !oid(row.blob) || previousPath !== null && previousPath.localeCompare(row.path) >= 0) fail('plan', 'normalization source manifest is invalid')
    const entry = git(root, ['ls-tree', plan.expectedHead, '--', row.path])
    if (!new RegExp('^100(?:644|755) blob ' + row.blob + '\\t').test(entry)) fail('plan', 'normalization source manifest differs from Git')
    previousPath = row.path
  }
  const phaseDirs = [...new Set(plan.recordFiles.filter(row => row.path.endsWith('.phase.ts')).map(row => dirname(row.path)))]
  const schemas = plan.recordFiles.filter(row => row.path.endsWith('/schema.ts'))
  if (phaseDirs.length !== 1 || !phaseDirs[0].endsWith('/phases') || schemas.length !== 1) fail('plan', 'normalization source estate is ambiguous')
  const sourceRoot = dirname(phaseDirs[0]), schemaPath = schemas[0].path
  const originalFiles = git(root, ['ls-tree', '-r', '--name-only', plan.expectedHead, '--', sourceRoot, dirname(schemaPath)]).split('\n')
  const expectedFiles = originalFiles.filter(path => path === schemaPath || path === dirname(schemaPath) + '/registry.ts'
    || dirname(path) === phaseDirs[0] && path.endsWith('.phase.ts') || dirname(path) === sourceRoot + '/arcs' && path.endsWith('.arc.ts')).sort((a, b) => a.localeCompare(b))
  if (!isDeepStrictEqual(plan.recordFiles.map(row => row.path), expectedFiles)) fail('plan', 'normalization source estate differs from original Git tree')
  for (const row of plan.publicationRefs) exactCommit(root, row.head)
  const { planDigest, ...body } = plan
  if (plan.version !== 1 || !/^[a-f0-9]{64}$/.test(planDigest) || hash(encoded(body)) !== planDigest) fail('plan', 'normalization plan digest differs from its bytes')
  exactCommit(root, plan.base); exactCommit(root, plan.expectedHead)
  if (git(root, ['rev-parse', plan.expectedHead + '^{tree}']) !== plan.expectedTree) fail('plan', 'normalization original tree differs')
  if (!Array.isArray(plan.groups) || !plan.groups.length || !isDeepStrictEqual(plan.phases, plan.groups.map(group => group.phase))) fail('plan', 'normalization groups differ from phases')
  try { git(root, ['merge-base', '--is-ancestor', plan.base, plan.expectedHead]) } catch { fail('plan', 'normalization base is not an ancestor') }
  if (git(root, ['rev-list', '--min-parents=2', plan.base + '..' + plan.expectedHead])) fail('plan', 'normalization range contains a merge')
  const range = git(root, ['log', '--reverse', '--format=%H%x00%s', plan.base + '..' + plan.expectedHead]).split('\n')
  const flattened = []
  for (const [index, group] of plan.groups.entries()) {
    if (!keys(group, 'phase commits sourceBoundary parent message gate') || !keys(group.message, 'subject body') || typeof group.message.subject !== 'string' || typeof group.message.body !== 'string'
      || !keys(group.gate, 'path digest baseSha reviewedHead') || !repoPath(group.gate.path) || !digestValue(group.gate.digest) || !oid(group.gate.baseSha) || !oid(group.gate.reviewedHead)
      || !Array.isArray(group.commits)) fail('plan', 'normalization group values are invalid')
    for (const row of group.commits) {
      if (!keys(row, 'sha subject kind') || !oid(row.sha) || typeof row.subject !== 'string' || !['task', 'gate-fix', 'scratch', 'state'].includes(row.kind)) fail('plan', 'normalization commit record is invalid')
      const suffix = phaseTaskSuffix(row.subject)
      if (classifySubject(row.subject, group.phase, suffix ? [suffix] : []) !== row.kind) fail('plan', 'normalization commit ownership differs')
      flattened.push(row.sha + '\0' + row.subject)
    }
    if (!group.commits?.length || !isDeepStrictEqual(group.parent, index ? { phase: plan.groups[index - 1].phase } : { base: plan.base })) fail('plan', 'normalization parent or group differs')
    const substantive = group.commits.filter(row => row.kind === 'task' || row.kind === 'gate-fix').at(-1)
    if (!substantive) fail('plan', 'normalization group lacks substantive work')
    exactCommit(root, group.gate.baseSha); exactCommit(root, group.gate.reviewedHead)
    if (group.gate.reviewedHead !== substantive.sha && !isCuratedTreeReplacement(root, group.gate.reviewedHead, substantive.sha)) fail('plan', 'normalization review binding differs')
    const last = group.commits.at(-1)
    exactCommit(root, last.sha)
    if (!isDeepStrictEqual(group.sourceBoundary, { sha: last.sha, tree: git(root, ['rev-parse', last.sha + '^{tree}']) })) fail('plan', 'normalization boundary tree differs')
  }
  if (!isDeepStrictEqual(flattened, range)) fail('plan', 'normalization recorded history differs from Git')
}
function receiptFile(root, digest) {
  const dir = join(root, '.building', 'history-normalizations')
  inspectReceiptAncestors(dir)
  return join(dir, digest + '.receipt.json')
}
function readReceipt(path) {
  let stat
  try { stat = lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('receipt', 'normalization receipt must be a regular nonsymlink file')
  const bytes = readFileSync(path, 'utf8')
  let value
  try { value = JSON.parse(bytes) } catch { fail('receipt', 'normalization receipt is incomplete or malformed') }
  if (encoded(value) !== bytes) fail('receipt', 'normalization receipt is not canonical')
  return value
}
function receiptValue(plan, prepared) {
  return { version: 1, planDigest: plan.planDigest, arcId: plan.arcId, base: plan.base,
    oldHead: prepared.oldHead, newHead: prepared.newHead, tree: prepared.tree,
    rescueRef: prepared.rescueRef, outcomes: prepared.outcomes }
}
function verifyChain(root, plan, receipt) {
  if (!Array.isArray(receipt.outcomes) || receipt.outcomes.length !== plan.groups.length) fail('receipt', 'normalization outcome count differs')
  let parent = plan.base
  for (const [index, row] of receipt.outcomes.entries()) {
    const group = plan.groups[index]
    if (!isDeepStrictEqual(Object.keys(row).sort(), ['phase', 'sourceCommit', 'sourceTree', 'normalizedCommit'].sort()) || row.phase !== group.phase || row.sourceCommit !== group.sourceBoundary.sha || row.sourceTree !== group.sourceBoundary.tree) fail('receipt', 'normalization outcome mapping differs')
    exactCommit(root, row.normalizedCommit)
    const [tree, parents, author, email, date, committer, committerEmail, committerDate] = git(root, ['show', '-s', '--format=%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', row.normalizedCommit]).split('\0')
    const identity = git(root, ['show', '-s', '--format=%an%x00%ae%x00%aI', row.sourceCommit])
    if (tree !== row.sourceTree || parents !== parent || [author, email, date].join('\0') !== identity || [committer, committerEmail, committerDate].join('\0') !== identity || git(root, ['show', '-s', '--format=%B', row.normalizedCommit]) !== `${group.message.subject}\n\n${group.message.body}`.trim()) fail('receipt', 'normalization commit contents differ')
    parent = row.normalizedCommit
  }
  const expected = receiptValue(plan, { oldHead: plan.expectedHead, newHead: parent, tree: plan.expectedTree, rescueRef: `refs/curate-rescue/${plan.expectedHead.slice(0, 12)}`, outcomes: receipt.outcomes })
  if (!isDeepStrictEqual(receipt, expected) || git(root, ['rev-parse', parent + '^{tree}']) !== plan.expectedTree) fail('receipt', 'normalization receipt identity or final tree differs')
}
function liveDelivery(root, plan, head, deps, recovery = false) {
  const observed = observation(root, { arcId: plan.arcId, base: plan.base, head }, deps.inspectDelivery)
  const refs = publicationRefs(root, loadConfig(root), observed)
  if (!recovery && !isDeepStrictEqual(refs, plan.publicationRefs)) fail('publication-unproven', 'publication refs changed after planning')
  if (recovery) {
    const commits = new Set([...git(root, ['rev-list', plan.base + '..' + plan.expectedHead]).split('\n'), ...git(root, ['rev-list', plan.base + '..' + head]).split('\n')])
    for (const ref of refs) if (git(root, ['rev-list', ref.head, '^' + plan.base]).split('\n').some(sha => commits.has(sha))) fail('published', 'normalization history is already published on ' + ref.ref)
  }
  return observed
}

/** Apply one exact plan through the shared curation owner. Git determines crash recovery. */
export function applyHistoryNormalization(cwd, plan, deps = {}) {
  try {
    const root = realpathSync(gitToplevel(cwd))
    validatePlan(root, plan)
    const path = receiptFile(root, plan.planDigest)
    const incumbent = readReceipt(path)
    const current = git(root, ['rev-parse', 'HEAD'])
    const result = (receipt, status) => ({ status, planDigest: receipt.planDigest, oldHead: receipt.oldHead,
      newHead: receipt.newHead, rescueRef: receipt.rescueRef, receiptPath: path, outcomes: receipt.outcomes })
    if (incumbent) {
      verifyChain(root, plan, incumbent)
      ensureCurationRescue(root, plan.expectedHead, { create: false })
      if (!curationAncestry(root, incumbent.newHead, current)) fail('head-changed', 'completed normalization is not reachable from HEAD')
      return result(incumbent, 'already-applied')
    }
    stableHead(root, current)
    if (git(root, ['rev-parse', current + '^{tree}']) !== plan.expectedTree) fail('head-changed', 'unreceipted normalization has a different current tree')
    // Re-derive original ownership from unchanged tracked sources. Live delivery is
    // separately observed at the actual current HEAD, including post-CAS recovery.
    if (current !== plan.expectedHead) ensureCurationRescue(root, plan.expectedHead, { create: false })
    const rederived = deriveNormalization(root, { arcId: plan.arcId, base: plan.base, head: plan.expectedHead }, { inspectDelivery: () => plan.delivery }, current, current === plan.expectedHead ? null : plan.publicationRefs)
    if (!isDeepStrictEqual(rederived, plan)) fail('plan-stale', 'normalization inputs changed since planning')
    liveDelivery(root, plan, current, deps, current !== plan.expectedHead)
    const rescueRef = ensureCurationRescue(root, plan.expectedHead, { create: current === plan.expectedHead })
    deps.afterRescue?.({ oldHead: plan.expectedHead, tree: plan.expectedTree, rescueRef })
    const prepared = prepareCuration(root, plan, { afterCommit: deps.afterCommit })
    const receipt = receiptValue(plan, prepared)
    verifyChain(root, plan, receipt)
    deps.afterPrepare?.(prepared)
    if (current !== plan.expectedHead && current !== prepared.newHead) fail('head-changed', 'HEAD is not an exact normalization recovery prefix')
    if (current === plan.expectedHead) {
      deps.beforeCas?.(prepared)
      stableHead(root, current)
      const fresh = deriveNormalization(root, { arcId: plan.arcId, base: plan.base, head: current }, deps)
      if (!isDeepStrictEqual(fresh, plan)) fail('plan-stale', 'normalization inputs changed before CAS')
      commitPreparedCuration(root, prepared)
      deps.afterCas?.(prepared)
    } else {
      stableHead(root, prepared.newHead)
      liveDelivery(root, plan, prepared.newHead, deps, true)
    }
    // Publication failure keeps the deterministic new HEAD and original rescue.
    // A retry recognizes this exact prefix, without rewriting it again.
    ensureReceiptDirectory(dirname(path))
    deps.beforeReceipt?.(prepared)
    stableHead(root, prepared.newHead)
    if (!publishImmutableFile(path, encoded(receipt)) && !isDeepStrictEqual(readReceipt(path), receipt)) fail('receipt', 'normalization receipt conflicts with an incumbent')
    const out = result(receipt, 'applied')
    deps.afterReceipt?.(out)
    return out
  } catch (error) {
    if (error instanceof HistoryNormalizationError) throw error
    const wrapped = new HistoryNormalizationError('apply-refused', 'normalization apply refused: ' + error.message, { cause: error })
    if (plan?.expectedHead) wrapped.rescueRef = `refs/curate-rescue/${plan.expectedHead.slice(0, 12)}`
    throw wrapped
  }
}

function storedNormalizations(root, arcId) {
  const directory = dirname(receiptFile(root, '0'.repeat(64)))
  let names
  try { names = readdirSync(directory) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  const rows = []
  for (const name of names) {
    if (/^\..+\.tmp$/.test(name)) continue
    if (!/^[a-f0-9]{64}\.(plan|receipt)\.json$/.test(name)) fail('recovery', 'unrecognized normalization artifact: ' + name)
    if (name.endsWith('.receipt.json') && !names.includes(name.replace('.receipt.json', '.plan.json'))) fail('recovery', 'normalization receipt has no original plan')
    if (!name.endsWith('.plan.json')) continue
    const plan = readReceipt(join(directory, name))
    if (plan?.planDigest !== name.slice(0, 64)) fail('recovery', 'normalization plan filename differs from its digest')
    if (plan.kind === 'published-corrections') validateCorrectionPlan(root, plan)
    else validatePlan(root, plan)
    const receipt = readReceipt(receiptFile(root, plan.planDigest))
    if (receipt) {
      if (plan.kind === 'published-corrections') verifyCorrectionReceipt(root, plan, receipt)
      else verifyChain(root, plan, receipt)
    }
    if (plan.arcId === arcId) rows.push({ plan, receipt })
  }
  for (const row of rows) if (row.plan.kind === 'published-corrections') {
    const predecessors = rows.filter(other => other.receipt && hash(encoded(other.receipt)) === row.plan.priorReceiptDigest && other.receipt.newHead === row.plan.base)
    if (predecessors.length !== 1) fail('recovery', 'published correction has no unique completed predecessor')
  }
  return rows
}
function currentPreparedReceipt(root, plan, head) {
  const commits = git(root, ['rev-list', '--reverse', plan.base + '..' + head]).split('\n')
  if (commits.length !== plan.groups.length) fail('head-changed', 'incomplete normalization has no exact prepared chain')
  const value = receiptValue(plan, { oldHead: plan.expectedHead, newHead: head, tree: plan.expectedTree,
    rescueRef: `refs/curate-rescue/${plan.expectedHead.slice(0, 12)}`,
    outcomes: plan.groups.map((group, index) => ({ phase: group.phase, sourceCommit: group.sourceBoundary.sha, sourceTree: group.sourceBoundary.tree, normalizedCommit: commits[index] })) })
  verifyChain(root, plan, value)
  ensureCurationRescue(root, plan.expectedHead, { create: false })
  return value
}
function persistNormalizationPlan(root, plan) {
  const path = receiptFile(root, plan.planDigest).replace('.receipt.json', '.plan.json')
  ensureReceiptDirectory(dirname(path))
  if (!publishImmutableFile(path, encoded(plan)) && !isDeepStrictEqual(readReceipt(path), plan)) fail('recovery', 'normalization plan conflicts with an incumbent')
  return path
}
function completionResult(root, plan, receipt) {
  ensureCurationRescue(root, plan.expectedHead, { create: false })
  return { status: 'already-applied', planDigest: plan.planDigest, oldHead: receipt.oldHead, newHead: receipt.newHead,
    rescueRef: receipt.rescueRef, receiptPath: receiptFile(root, plan.planDigest), outcomes: receipt.outcomes }
}

/** Provider-neutral publication door. No CLI switch can supply publication authority. */
export function normalizeArc(cwd, arcId, options = {}, deps = {}) {
  try {
    if (typeof arcId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(arcId) || !options || Object.keys(options).some(key => key !== 'apply') || options.apply !== undefined && typeof options.apply !== 'boolean') fail('input', 'normalize accepts only arcId and an apply boolean')
    const root = realpathSync(gitToplevel(cwd)), head = git(root, ['rev-parse', 'HEAD'])
    const stored = storedNormalizations(root, arcId)
    const incomplete = stored.filter(row => !row.receipt)
    if (incomplete.length > 1) fail('recovery', 'multiple incomplete normalization plans require reconciliation')
    if (incomplete.length) {
      const { plan } = incomplete[0]
      if (plan.kind === 'published-corrections') {
        const previous = stored.find(row => row.receipt && hash(encoded(row.receipt)) === plan.priorReceiptDigest)
        return applyCorrectionPlan(root, plan, previous, options, deps)
      }
      if (head !== plan.expectedHead) currentPreparedReceipt(root, plan, head)
      if (!options.apply) return { status: 'planned', planDigest: plan.planDigest, plan, recovery: true }
      return applyHistoryNormalization(root, plan, deps)
    }
    const candidates = stored.filter(row => row.receipt && curationAncestry(root, row.receipt.newHead, head))
    const maximal = candidates.filter(row => !candidates.some(other => other !== row && curationAncestry(root, row.receipt.newHead, other.receipt.newHead)))
    if (candidates.length && maximal.length !== 1) fail('recovery', 'normalization history has no unique completed predecessor')
    if (stored.length && !maximal.length) fail('head-changed', 'stored normalization does not belong to the current history')
    if (maximal.length) {
      const previous = maximal[0]
      if (head === previous.receipt.newHead) {
        if (previous.plan.kind === 'published-corrections') {
          if (!options.apply) return { status: 'published-rewrite-planned', planDigest: previous.plan.planDigest, newHead: head, recovery: true }
          return finishCorrectionPush(root, previous.plan, previous.receipt, deps)
        }
        return completionResult(root, previous.plan, previous.receipt)
      }
      if (typeof deps.inspectDelivery !== 'function') fail('delivery-unproven', 'normalization requires a current delivery observation')
      const observed = deps.inspectDelivery({ root, arcId, base: previous.plan.base, head })
      if (observed?.publication === 'published' || observed?.pullRequest != null || observed?.green === true) return normalizePublishedCorrections(root, arcId, previous, observed, options, deps)
      observation(root, { arcId, base: previous.plan.base, head }, () => observed)
      fail('head-changed', 'an unpublished descendant requires fresh normalization before publication')
    }
    recordFiles(root, head)
    const loaded = records(root, arcId), ids = loaded.arc.planes.flatMap(plane => plane.phases)
    if (!ids.length || new Set(ids).size !== ids.length) fail('records', 'arc phase order is empty or duplicated')
    const base = exactCommit(root, derivePhaseStartSha(root, ids[0]))
    if (typeof loaded.arc.baseRef !== 'string' || !loaded.arc.baseRef || loaded.arc.baseRef.startsWith('-')) fail('base', 'arc base ref is absent or malformed')
    const configuredBase = exactCommit(root, git(root, ['rev-parse', '--verify', loaded.arc.baseRef + '^{commit}']))
    try { git(root, ['merge-base', '--is-ancestor', configuredBase, base]) } catch { fail('base', 'arc base is not an ancestor of the execution boundary') }
    const plan = planHistoryNormalization(root, { arcId, base, head }, deps)
    if (!options.apply) return { status: 'planned', planDigest: plan.planDigest, plan }
    persistNormalizationPlan(root, plan)
    return applyHistoryNormalization(root, plan, deps)
  } catch (error) {
    if (error instanceof HistoryNormalizationError) throw error
    throw new HistoryNormalizationError('normalization-refused', 'arc normalization refused: ' + error.message, { cause: error })
  }
}

function publishedObservation(root, observed, head, originalHead = head) {
  if (!observed || observed.then || observed.head !== head || observed.publication !== 'published'
    || !keys(observed.pullRequest, 'head ref') || !oid(observed.pullRequest.head) || typeof observed.pullRequest.ref !== 'string'
    || !observed.pullRequest.ref.startsWith('refs/') || !Array.isArray(observed.publicationRefs) || !observed.publicationRefs.includes(observed.pullRequest.ref)) fail('delivery-unproven', 'published correction needs an exact local and PR head observation')
  const { ref, head: publishedHead } = observed.pullRequest
  git(root, ['check-ref-format', ref]); exactCommit(root, publishedHead)
  if (git(root, ['rev-parse', '--verify', ref]) !== publishedHead) fail('lease', 'provider ref differs from the observed PR head')
  if (observed.green === true || observed.checks?.state === 'green') fail('green', 'green history is never rewritten for cosmetics')
  if (observed.green !== false || !keys(observed.checks, 'head state') || observed.checks.head !== publishedHead || observed.checks.state !== 'red'
    || !keys(observed.correction, 'classification pushRequired') || !['causal', 'owned-preexisting'].includes(observed.correction.classification) || observed.correction.pushRequired !== true) fail('correction-unproven', 'published compaction requires owned red CI and an already-necessary repair push')
  if (originalHead === publishedHead) fail('correction-unproven', 'published compaction requires a pending local repair')
  try { git(root, ['merge-base', '--is-ancestor', publishedHead, originalHead]) } catch { fail('lease', 'local repair does not descend from the observed red PR head') }
  return { localHead: originalHead, ref, publishedHead, checksHead: publishedHead, classification: observed.correction.classification }
}
function correctionMessage(arcId, corrections) {
  return { subject: `fix(roadmap): ${arcId} — consolidate reviewed CI corrections`, body: corrections.map(row => `phase ${row.phase}: ${row.sha} ${row.subject}`).join('\n') }
}
function correctionSpec(plan) {
  return { base: plan.base, expectedHead: plan.expectedHead, expectedTree: plan.expectedTree,
    groups: [{ phase: null, kind: 'correction-tail', commits: plan.corrections, message: plan.group.message }] }
}
function correctionReceipt(plan, prepared) {
  return { ...receiptValue(plan, prepared), kind: 'published-corrections', priorReceiptDigest: plan.priorReceiptDigest,
    publishedRef: plan.delivery.ref, expectedOld: plan.delivery.publishedHead }
}
function validateCorrectionPlan(root, plan) {
  if (!keys(plan, 'version kind arcId priorReceiptDigest base expectedHead expectedTree corrections phaseGates group delivery planDigest')
    || plan.version !== 1 || plan.kind !== 'published-corrections' || typeof plan.arcId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(plan.arcId)
    || !digestValue(plan.priorReceiptDigest) || !digestValue(plan.planDigest) || !oid(plan.expectedTree)
    || !Array.isArray(plan.corrections) || !Array.isArray(plan.phaseGates) || !keys(plan.group, 'sourceBoundary message')
    || !keys(plan.delivery, 'localHead ref publishedHead checksHead classification')) fail('plan', 'published correction plan is malformed')
  const { planDigest, ...body } = plan
  if (hash(encoded(body)) !== planDigest) fail('plan', 'published correction plan digest differs')
  exactCommit(root, plan.base); exactCommit(root, plan.expectedHead); exactCommit(root, plan.delivery.publishedHead)
  if (plan.delivery.localHead !== plan.expectedHead || plan.delivery.checksHead !== plan.delivery.publishedHead || typeof plan.delivery.ref !== 'string' || !plan.delivery.ref.startsWith('refs/') || !['causal', 'owned-preexisting'].includes(plan.delivery.classification)) fail('plan', 'published correction delivery binding differs')
  git(root, ['check-ref-format', plan.delivery.ref])
  try {
    git(root, ['merge-base', '--is-ancestor', plan.base, plan.expectedHead])
    git(root, ['merge-base', '--is-ancestor', plan.delivery.publishedHead, plan.expectedHead])
  } catch { fail('plan', 'published correction ancestry differs') }
  if (plan.delivery.publishedHead === plan.expectedHead || git(root, ['rev-list', '--min-parents=2', plan.base + '..' + plan.expectedHead])) fail('plan', 'published correction range is not a pending linear repair')
  const actual = git(root, ['log', '--reverse', '--format=%H%x00%T%x00%s', plan.base + '..' + plan.expectedHead]).split('\n')
  let useful = 0, priorTree = git(root, ['rev-parse', plan.base + '^{tree}'])
  const substantive = new Map()
  const rows = plan.corrections.map(row => {
    if (!keys(row, 'sha tree subject phase kind') || !oid(row.sha) || !oid(row.tree) || !Number.isSafeInteger(row.phase) || typeof row.subject !== 'string') fail('plan', 'published correction row is malformed')
    const suffix = phaseTaskSuffix(row.subject)
    if (!['task', 'gate-fix', 'state', 'scratch'].includes(row.kind) || classifySubject(row.subject, row.phase, suffix ? [suffix] : []) !== row.kind) fail('ownership', 'published correction attribution differs')
    if (['task', 'gate-fix'].includes(row.kind)) {
      if (row.tree === priorTree) fail('correction-unproven', 'bookkeeping-only correction cannot count toward compaction')
      useful++; substantive.set(row.phase, row.sha)
    }
    priorTree = row.tree
    return [row.sha, row.tree, row.subject].join('\0')
  })
  if (useful < 3 || !isDeepStrictEqual(rows, actual) || priorTree !== plan.expectedTree
    || !isDeepStrictEqual(plan.group, { sourceBoundary: { sha: plan.expectedHead, tree: plan.expectedTree }, message: correctionMessage(plan.arcId, plan.corrections) })) fail('plan', 'published correction range, count or message differs')
  if (!isDeepStrictEqual(plan.phaseGates.map(row => row.phase), [...substantive.keys()].sort((a, b) => a - b))) fail('plan', 'published correction phase gate set differs')
  for (const row of plan.phaseGates) {
    if (!keys(row, 'phase path digest baseSha reviewedHead') || !repoPath(row.path) || !digestValue(row.digest)) fail('plan', 'published correction gate binding is malformed')
    exactCommit(root, row.baseSha); exactCommit(root, row.reviewedHead)
    if (row.reviewedHead !== substantive.get(row.phase) && !isCuratedTreeReplacement(root, row.reviewedHead, substantive.get(row.phase))) fail('gate-stale', 'published correction review is stale')
  }
}
function verifyCorrectionReceipt(root, plan, receipt) {
  const preview = prepareCuration(root, correctionSpec(plan), { writeObjects: false })
  const expected = correctionReceipt(plan, preview)
  if (!isDeepStrictEqual(expected, receipt) || git(root, ['rev-parse', receipt.newHead + '^{tree}']) !== plan.expectedTree) fail('receipt', 'published correction receipt differs from deterministic Git contents')
  ensureCurationRescue(root, plan.expectedHead, { create: false })
}
function planCorrectionTail(root, arcId, previous, observed) {
  const head = git(root, ['rev-parse', 'HEAD']); stableHead(root, head)
  const delivery = publishedObservation(root, observed, head)
  recordFiles(root, head)
  const loaded = records(root, arcId), ids = loaded.arc.planes.flatMap(plane => plane.phases)
  const phases = loaded.phases.filter(phase => ids.includes(phase.phase))
  if (phases.length !== ids.length || phases.some(phase => phase.arcId !== arcId || phase.status !== 'done' || phase.tasks.some(task => !task.done))) fail('records', 'published corrections require complete typed arc members')
  const base = previous.receipt.newHead
  try { git(root, ['merge-base', '--is-ancestor', base, head]) } catch { fail('base', 'corrections must directly descend from their normalized predecessor') }
  const log = git(root, ['log', '--reverse', '--format=%H%x00%P%x00%T%x00%s', base + '..' + head]).split('\n').filter(Boolean)
  let priorTree = git(root, ['rev-parse', base + '^{tree}']), useful = 0
  const lastWork = new Map()
  const corrections = log.map(line => {
    const [sha, parents, tree, subject] = line.split('\0')
    if (parents.split(' ').length !== 1) fail('merge', 'published correction range contains a merge')
    const matches = phases.flatMap(phase => {
      const kind = classifySubject(subject, phase.phase, phase.tasks.map(task => task.id))
      return kind ? [{ phase: phase.phase, kind }] : []
    })
    if (matches.length !== 1) fail('ownership', 'published correction is foreign or ambiguous: ' + sha)
    const row = { sha, tree, subject, ...matches[0] }
    if (['task', 'gate-fix'].includes(row.kind)) {
      if (tree === priorTree) fail('correction-unproven', 'correction does not change the tree')
      useful++; lastWork.set(row.phase, row)
    }
    priorTree = tree
    return row
  })
  if (!useful) fail('correction-unproven', 'published history contains no useful corrections')
  const phaseGates = [...lastWork].sort(([a], [b]) => a - b).map(([phase, row]) => ({ phase, ...gateBinding(root, phases.find(item => item.phase === phase), row) }))
  if (useful < 3) return { status: 'retained-corrections', correctionCount: useful, newHead: head }
  const plan = { version: 1, kind: 'published-corrections', arcId, priorReceiptDigest: hash(encoded(previous.receipt)), base,
    expectedHead: head, expectedTree: priorTree, corrections, phaseGates,
    group: { sourceBoundary: { sha: head, tree: priorTree }, message: correctionMessage(arcId, corrections) }, delivery }
  plan.planDigest = hash(encoded(plan))
  validateCorrectionPlan(root, plan)
  return plan
}
function finishCorrectionPush(root, plan, receipt, deps) {
  const head = git(root, ['rev-parse', 'HEAD'])
  if (head !== receipt.newHead) fail('head-changed', 'correction publication requires its exact normalized HEAD')
  if (typeof deps.inspectDelivery !== 'function') fail('delivery-unproven', 'correction publication requires a current provider observation')
  const observed = deps.inspectDelivery({ root, arcId: plan.arcId, base: plan.base, head })
  if (observed?.head !== head || observed?.publication !== 'published' || observed?.pullRequest?.ref !== plan.delivery.ref) fail('delivery-unproven', 'correction replay observation differs from its exact head/ref')
  const actual = git(root, ['rev-parse', '--verify', plan.delivery.ref])
  if (observed.pullRequest.head !== actual) fail('lease', 'provider observation differs from actual publication ref')
  if (actual === receipt.newHead) return { status: 'already-applied', planDigest: plan.planDigest, newHead: receipt.newHead, rescueRef: receipt.rescueRef, alreadyPublished: true }
  if (actual !== plan.delivery.publishedHead) fail('lease', 'correction publication lease changed')
  publishedObservation(root, observed, head, plan.expectedHead)
  return replaceCorrectionHead(root, plan, receipt, deps)
}
function replaceCorrectionHead(root, plan, receipt, deps) {
  if (typeof deps.replacePublishedHead !== 'function') fail('delivery-unproven', 'published correction replacement capability is unavailable')
  const out = deps.replacePublishedHead({ ref: plan.delivery.ref, expectedOld: plan.delivery.publishedHead, newHead: receipt.newHead, arcId: plan.arcId, planDigest: plan.planDigest })
  if (!keys(out, 'ref head') || out.ref !== plan.delivery.ref || out.head !== receipt.newHead || git(root, ['rev-parse', '--verify', out.ref]) !== receipt.newHead) fail('lease', 'provider did not attest the exact leased replacement')
  return { status: 'published-rewrite-applied', planDigest: plan.planDigest, newHead: receipt.newHead, rescueRef: receipt.rescueRef }
}
function applyCorrectionPlan(root, plan, previous, options, deps) {
  validateCorrectionPlan(root, plan)
  const preview = prepareCuration(root, correctionSpec(plan), { writeObjects: false })
  if (!options.apply) return { status: 'published-rewrite-planned', planDigest: plan.planDigest, plan, ref: plan.delivery.ref,
    expectedOld: plan.delivery.publishedHead, oldHead: plan.expectedHead, newHead: preview.newHead, correctionCount: plan.corrections.filter(row => ['task', 'gate-fix'].includes(row.kind)).length }
  if (typeof deps.replacePublishedHead !== 'function' || typeof deps.inspectDelivery !== 'function') fail('delivery-unproven', 'published normalization requires current observation and exact-lease replacement capabilities')
  const path = receiptFile(root, plan.planDigest), existing = readReceipt(path)
  if (existing) { verifyCorrectionReceipt(root, plan, existing); return finishCorrectionPush(root, plan, existing, deps) }
  const head = git(root, ['rev-parse', 'HEAD'])
  if (head !== plan.expectedHead && head !== preview.newHead) fail('head-changed', 'published correction is not at an exact recovery prefix')
  stableHead(root, head)
  if (head === plan.expectedHead) {
    const fresh = planCorrectionTail(root, plan.arcId, previous, deps.inspectDelivery({ root, arcId: plan.arcId, base: plan.base, head }))
    if (!isDeepStrictEqual(fresh, plan)) fail('plan-stale', 'published correction inputs changed before apply')
  } else {
    ensureCurationRescue(root, plan.expectedHead, { create: false })
    for (const row of plan.phaseGates) if (hash(readFileSync(join(root, row.path))) !== row.digest) fail('gate-stale', 'published correction gate bytes changed during recovery')
  }
  persistNormalizationPlan(root, plan)
  const rescueRef = ensureCurationRescue(root, plan.expectedHead, { create: head === plan.expectedHead })
  deps.afterRescue?.({ oldHead: plan.expectedHead, rescueRef })
  const prepared = prepareCuration(root, correctionSpec(plan), { afterCommit: deps.afterCommit })
  if (!isDeepStrictEqual(prepared, preview)) fail('tree', 'correction preparation differs from the read-only preview')
  deps.afterPrepare?.(prepared)
  if (head === plan.expectedHead) {
    deps.beforeCas?.(prepared)
    stableHead(root, head)
    const fresh = planCorrectionTail(root, plan.arcId, previous, deps.inspectDelivery({ root, arcId: plan.arcId, base: plan.base, head }))
    if (!isDeepStrictEqual(fresh, plan)) fail('plan-stale', 'published correction changed before CAS')
    commitPreparedCuration(root, prepared)
    deps.afterCas?.(prepared)
  }
  const receipt = correctionReceipt(plan, prepared)
  deps.beforeReceipt?.(prepared); stableHead(root, prepared.newHead)
  if (!publishImmutableFile(path, encoded(receipt)) && !isDeepStrictEqual(readReceipt(path), receipt)) fail('receipt', 'published correction receipt conflicts')
  deps.afterReceipt?.(receipt)
  return finishCorrectionPush(root, plan, receipt, deps)
}
function normalizePublishedCorrections(root, arcId, previous, observed, options, deps) {
  const plan = planCorrectionTail(root, arcId, previous, observed)
  if (plan.status === 'retained-corrections') return plan
  return applyCorrectionPlan(root, plan, previous, options, deps)
}
