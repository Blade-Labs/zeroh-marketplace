import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { gitToplevel } from './gitroot.mjs'
import { roadmapRoot, consumerSchemaPath } from './roadmap-root.mjs'
import { bridgeEval } from './tsx-bridge.mjs'
import { loadConfig, integrationRefOf } from './config.mjs'
import { latestReport, checkPhaseConsistency, correctnessDecision, GateRunReportShape } from './gate-report.mjs'
import { classifySubject, composeLandedMessage } from './curate.mjs'
import { isCuratedTreeReplacement, phaseTaskSuffix } from './gitscan.mjs'

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
  try {
    if (!input || Object.keys(input).some(key => !['arcId', 'base', 'head'].includes(key)) || typeof input.arcId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(input.arcId)) fail('input', 'normalization accepts only arcId and exact base/head commits')
    const root = realpathSync(gitToplevel(cwd)), { arcId, base, head } = input
    exactCommit(root, base); exactCommit(root, head); stableHead(root, head)
    try { git(root, ['merge-base', '--is-ancestor', base, head]) } catch { fail('base', 'normalization base is not an ancestor of HEAD') }
    const observed = observation(root, input, deps.inspectDelivery)
    const rows = git(root, ['log', '--reverse', '--format=%H%x00%P%x00%T%x00%s', base + '..' + head]).split('\n').filter(Boolean).map(line => {
      const [sha, parents, tree, subject] = line.split('\0')
      if (parents.split(' ').length !== 1) fail('merge', 'normalization refuses merge commit ' + sha)
      return { sha, tree, subject }
    })
    if (!rows.length) fail('empty', 'normalization range has no outcome commits')
    const refs = publicationRefs(root, loadConfig(root), observed), owned = new Set(rows.map(row => row.sha))
    for (const ref of refs) if (git(root, ['rev-list', ref.head, '^' + base]).split('\n').some(sha => owned.has(sha))) fail('published', 'normalization range is already on ' + ref.ref)
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
    stableHead(root, head)
    const plan = { version: 1, arcId, base, expectedHead: head, expectedTree: git(root, ['show', '-s', '--format=%T', head]), phases: ids, groups, delivery: observed, publicationRefs: refs }
    plan.planDigest = hash(encoded(plan))
    return plan
  } catch (error) {
    if (error instanceof HistoryNormalizationError) throw error
    throw new HistoryNormalizationError('unproven', 'normalization preflight failed: ' + error.message, { cause: error })
  }
}
