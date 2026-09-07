/**
 * codex-journal — the ONE home of the codex lane journal mechanics: the LANES table, the
 * journal path grammar, the unreadable-journal contract, the live and closed lookups, and the
 * landed-lane archive stamp. Extracted from cli/commands/codex.mjs (phase 13.1) so that lib
 * modules (landing.mjs) and sibling commands (phase, gate) consume journal truth without
 * pulling the lane launcher's prompt builders and spawn machinery along — the range's one
 * lib→command dependency inversion. Bodies and docblocks moved verbatim, a MOVE not a rewrite;
 * every consumer — the launcher included — imports the names from HERE, so there is one home.
 */
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { withFileLock } from './file-lock.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { publishImmutableFile } from './sidecar.mjs'
import { roadmapRootRel } from './roadmap-root.mjs'
import { resolveGovernance } from './governance.mjs'
import { intersectAuthority } from './drivers.mjs'
import { groupAlive, listWorktrees, worktreeIdentityDeclineReason, resolveWorktreeOwnership } from './worktree.mjs'

/**
 * One entry per mission. Adding a lane is adding an entry here — the launcher, the liveness guard,
 * the journal lookup and `status` all read the table, so a fourth mission never grows a fourth
 * launcher. `flag` is how `status` is pointed at the lane (the run lane is the default, hence null).
 */
export const LANES = {
  run: { prefix: 'codex-', report: 'CODEX-REPORT.md', journalRe: /^codex-[\d-]+(?:\.(?!closed\.)[a-z0-9]+)?\.json$/, closedRe: /^codex-[\d-]+(?:\.[a-z0-9]+)?\.closed\.json$/, flag: null },
  review: { prefix: 'codex-review-', report: 'CODEX-REVIEW.md', journalRe: /^codex-review-[\d-]+\.json$/, closedRe: /^codex-review-[\d-]+\.closed\.json$/, flag: '--review' },
  plan: { prefix: 'codex-plan-', report: 'CODEX-PLAN.md', journalRe: /^codex-plan-[\d-]+\.json$/, closedRe: /^codex-plan-[\d-]+\.closed\.json$/, flag: '--plan' },
}

/** A previous run's hand-off, preserved rather than deleted; the name is a lane's report with
 *  `.prev` before the extension. */
export const prevReportName = (report) => report.replace(/\.md$/, '.prev.md')

/**
 * The run lane's hand-off files. Written into the lane worktree and NEVER committed by contract
 * (the header's hand-off note), which is why the disposal rail takes them as its named untracked
 * exceptions: without them every codex-lane disposal would refuse on the lane's own report.
 */
export const RUN_LANE_ARTIFACTS = [LANES.run.report, prevReportName(LANES.run.report)]

export function journalPath(root, ids, lane = 'run', { label } = {}) {
  return join(root, '.building', `${LANES[lane].prefix}${ids.join('-')}${label ? `.${label}` : ''}.json`)
}

export function writeJournal(root, journal, options = {}) {
  return writeJournalAtomic(root, journal, options)
}

function readCanonicalJournalArtifact(path) {
  if (!lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) throw new Error('review generation refused: noncanonical artifact')
  return readFileSync(path)
}

function reviewGenerationPredecessor(root, path, journal, expected) {
  const bytes = readCanonicalJournalArtifact(path)
  const previous = JSON.parse(bytes)
  const sameScope = ['ownerRoot', 'lane', 'phases', 'laneOwner', 'worktree', 'authorityDigest']
    .every(key => isDeepStrictEqual(previous[key], journal[key]))
  if (!expected || !isDeepStrictEqual(previous, expected) || previous.lane !== 'review' || !sameScope
    || journal.ownerRoot !== realpathSync(root)
    || !nonblank(previous.launchId) || !nonblank(journal.launchId) || previous.launchId === journal.launchId
    || !previous.worktreeIdentity || !journal.worktreeIdentity
    || previous.worktreeIdentity.ownershipId === journal.worktreeIdentity.ownershipId
    || !Number.isFinite(Date.parse(previous.archivedAt)) || !Number.isFinite(Date.parse(previous.finishedAt))
    || previous.driverExit?.code !== 0 || previous.driverExit?.signal != null || previous.driverExit?.error
    || previous.prompt !== path.replace(/\.json$/, '-prompt.txt')
    || !archivedReportPaths(path, previous).includes(previous.archivedReport)
    || dirname(previous.archivedReport) !== dirname(path)
    || previous.completionFingerprint !== completionFingerprintOf(previous)
    || resolveWorktreeOwnership(root, previous).state === 'owned'
    || resolveWorktreeOwnership(root, journal).state !== 'owned') {
    throw new Error('review generation refused: predecessor, scope or new ownership differs')
  }
  const prefix = path.replace(/\.json$/, `.prior.${encodeURIComponent(previous.launchId)}`)
  const priorJournal = readCanonicalJournalArtifact(`${prefix}.json`)
  const priorPrompt = readCanonicalJournalArtifact(`${prefix}.prompt.txt`)
  const priorReport = readCanonicalJournalArtifact(`${prefix}.report.md`)
  if (!bytes.equals(priorJournal)
    || previous.requestDigest !== journalBindingDigestOf({ prompt: priorPrompt.toString('utf8'), carriedDigest: previous.carriedDigest ?? null })
    || previous.reportDigest !== journalBytesDigestOf(priorReport)
    || !priorReport.equals(readCanonicalJournalArtifact(previous.archivedReport))) {
    throw new Error('review generation refused: immutable prior artifacts differ')
  }
  return bytes
}

function withJournalLock(path, fn) {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  if (realpathSync(dir) !== resolve(dir)) throw new Error('journal directory must be canonical')
  const livePath = path.replace(/\.closed\.json$/, '.json')
  return withFileLock(`${livePath}.lock`, fn, { label: 'journal' })
}

export function writeJournalAtomic(root, journal, options = {}) {
  const reason = journalDeclineReason(journal)
  if (reason) throw new Error('journal refused: ' + reason)
  const path = journalPath(root, journal.phases, journal.lane ?? 'run', { label: options.label })
  return withJournalLock(path, () => writeJournalUnlocked(root, journal, options))
}

function writeJournalUnlocked(root, journal, { label, closed = false, replaceGeneration } = {}) {
  const reason = journalDeclineReason(journal)
  if (reason) throw new Error('journal refused: ' + reason)
  if (typeof closed !== 'boolean') throw new Error('journal closed mode must be boolean')
  if (replaceGeneration !== undefined && (journal.lane !== 'review' || replaceGeneration?.lane !== 'review'
    || !isDeepStrictEqual(journal.phases, replaceGeneration.phases))) throw new Error('review generation refused: lane or phase scope differs')
  const livePath = journalPath(root, journal.phases, journal.lane ?? 'run', { label })
  const path = closed ? livePath.replace(/\.json$/, '.closed.json') : livePath
  if (replaceGeneration !== undefined && (closed || label !== undefined)) throw new Error('review generation refused: only an unlabelled live review can be replaced')
  const predecessor = replaceGeneration !== undefined ? reviewGenerationPredecessor(root, path, journal, replaceGeneration) : null
  if (!predecessor && existsSync(path)) {
    const previous = JSON.parse(readFileSync(path, 'utf8'))
    if (previous?.worktreeIdentity !== undefined && !isDeepStrictEqual(previous.worktreeIdentity, journal.worktreeIdentity)) throw new Error('journal worktree identity cannot change or disappear')
  }
  const dir = join(root, '.building')
  mkdirSync(dir, { recursive: true })
  if (realpathSync(dir) !== resolve(dir)) throw new Error('journal directory must be canonical')
  const temp = `${path}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(journal, null, 2) + '\n')
    fsyncSync(fd)
    closeSync(fd); fd = undefined
    if (predecessor && !reviewGenerationPredecessor(root, path, journal, replaceGeneration).equals(predecessor)) throw new Error('review generation refused: live predecessor changed before publication')
    renameSync(temp, path)
    const dirFd = openSync(dir, 'r')
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch {}
  }
  return path
}

const matchesWorktree = (journal, worktree) => !worktree || (journal?.worktree && resolve(journal.worktree) === resolve(worktree))

/** A journal that EXISTS and cannot be read as one — it will not parse, or it parses to
 *  something that is not a journal object. Never folded into "no journal": an absent journal
 *  means an inline session (nothing to reconcile), an unreadable one means the launcher's record
 *  is there and unreadable, and treating those alike disarms the reconcile in silence. */
export class JournalUnreadableError extends Error {
  constructor(failures) {
    super(
      `roadmap codex: ${failures.length} journal file(s) NAMING these phase(s) could not be read as a journal, so no `
        + 'lane journal could be resolved \u2014 this is NOT the same as an inline session with no journal:\n'
        + failures.map(({ path, message }) => `  - ${path}: ${message}`).join('\n')
        + '\nRead the file: a truncated journal is a launch that died mid-write, and a file that parses to anything but '
        + 'an object is not a journal at all \u2014 delete it if that run is gone, and relaunch the lane.',
    )
    this.name = 'JournalUnreadableError'
    this.failures = failures
  }
}

/**
 * Why a PARSED journal is still unreadable, or null when it is fine. ONE definition, because two
 * readers must agree: a journal is an OBJECT, and anything else JSON yields — null, a bare number
 * or string, an array — carries no pgid and no phases while still sitting on disk. Falsiness is
 * not the test: `[]` and `"text"` are truthy and would reach the launch guard as a journal with
 * `pgid undefined`, which reads as a dead run and relaunches over a file nobody could read.
 * Completeness is a different question — an object missing `phases` is the coverage check's
 * business, and journals predating a field are deliberately tolerated elsewhere in this lane.
 */
export function journalDeclineReason(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `parsed to ${JSON.stringify(value)} — a journal must be an object`
  if (value.worktreeIdentity !== undefined) {
    const reason = worktreeIdentityDeclineReason(value.worktreeIdentity)
    if (reason) return reason
    if (!isDeepStrictEqual(value.laneOwner, value.worktreeIdentity.laneOwner) || value.lane !== value.worktreeIdentity.laneOwner.id.split(':')[0]
      || !Array.isArray(value.phases) || value.phases.map(String).join('-') !== value.worktreeIdentity.laneOwner.id.split(':')[1]
      || typeof value.worktree !== 'string' || resolve(value.worktree) !== value.worktreeIdentity.worktree) return 'journal and worktree identity bindings differ'
  }
  return null
}

/**
 * The lane journal covering every id in `ids` → { path, journal }, or null.
 *
 * Two lookups, in order: the exact single-phase name, then a scan for the multi-phase journal
 * an arc run writes. Ids are compared as STRINGS on both sides — a journal's `phases` may hold
 * either, and a strict compare would leave every arc run unreconciled.
 *
 * Shared rather than private because the reconcile at landing (gate --verify-complete) must
 * find the same journal `codex status` does; two lookups would drift.
 *
 * THROWS JournalUnreadableError when nothing matched but a candidate file that COULD have covered
 * these ids was DECLINED — it would not parse, or it parsed to something journalDeclineReason
 * refuses: a null there would report "no journal" over a journal that is sitting right on disk. Candidacy is read off the FILENAME, which launch() builds from the very ids it
 * writes into `phases` — so a corrupt journal belonging to other phases is not this lookup's
 * business, and nothing is skipped in silence: that file still throws for the ids it names.
 * Scoping matters because nothing prunes .building, so one truncated journal would otherwise
 * block the reconcile for every phase in the checkout, including inline ones.
 */
export function findJournal(root, ids, lane = 'run', { worktree } = {}) {
  const wanted = ids.map(String)
  const failures = []
  const read = (p, candidate) => {
    let value
    try {
      value = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      if (candidate) failures.push({ path: p, message: e.message })
      return null
    }
    const declined = journalDeclineReason(value)
    if (declined) {
      if (candidate) failures.push({ path: p, message: declined })
      return null
    }
    return value
  }
  const exact = journalPath(root, ids, lane)
  if (existsSync(exact)) {
    const journal = read(exact, true)
    if (journal && matchesWorktree(journal, worktree)) return { path: exact, journal }
  }
  const dir = join(root, '.building')
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!LANES[lane].journalRe.test(f)) continue
    const path = join(dir, f)
    if (path === exact && failures.some((x) => x.path === exact)) continue
    const named = f.match(/\d+/g) ?? []
    const journal = read(path, wanted.every((n) => named.includes(n)))
    const phases = (journal?.phases ?? []).map(String)
    if (journal && wanted.every((n) => phases.includes(n)) && matchesWorktree(journal, worktree)) return { path, journal }
  }
  if (failures.length > 0) throw new JournalUnreadableError(failures)
  return null
}

/**
 * Archive a landed lane's journal: `codex-<ids>.json` → `codex-<ids>.closed.json`, stamped with
 * who closed it and when, never deleted.
 *
 * ONE home, because two done-verbs land lanes — `phase land` for a single delegated phase, `arc
 * land` for every member of a delegated arc — and a lane that got two different post-disposal
 * answers depending on which verb closed it is a lane nobody can report on. The name leaves both
 * live scans by construction: the journalRe class `[\d-]` has no '.', so no launch guard can
 * mistake a closed lane for a live one, while findClosedJournal still resolves it.
 */
export function archiveJournal(journalPath, journal, closedBy) {
  return withJournalLock(journalPath, () => archiveJournalUnlocked(journalPath, journal, closedBy))
}

function archiveJournalUnlocked(journalPath, journal, closedBy) {
  const closed = journalPath.replace(/\.json$/, '.closed.json')
  if (closed === journalPath || journalPath.endsWith('.closed.json')) throw new Error('journal close refused: expected live journal path')
  const readExact = path => {
    if (!lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) throw new Error('journal close refused: noncanonical file')
    return readFileSync(path)
  }
  const liveBytes = existsSync(journalPath) ? readExact(journalPath) : null
  if (liveBytes && !isDeepStrictEqual(JSON.parse(liveBytes), journal)) throw new Error('journal close refused: live journal differs')
  if (!liveBytes && !existsSync(closed)) throw new Error('journal close refused: live journal missing')
  const verifyClosed = () => {
    const value = JSON.parse(readExact(closed))
    const { closedAt, closedBy: author, ...original } = value
    if (!Number.isFinite(Date.parse(closedAt)) || author !== closedBy || !isDeepStrictEqual(original, journal)) throw new Error('journal close refused: conflicting closed journal')
  }
  if (liveBytes && existsSync(closed)) {
    const previousBytes = readExact(closed)
    const previous = JSON.parse(previousBytes)
    const validLaunch = value => typeof value === 'string' && value.trim().length > 0
    if (validLaunch(previous.launchId) && validLaunch(journal.launchId) && previous.launchId !== journal.launchId) {
      if (!Number.isFinite(Date.parse(previous.closedAt)) || typeof previous.closedBy !== 'string') throw new Error('journal close refused: malformed prior generation')
      const prior = journalPath.replace(/\.json$/, `.prior.${encodeURIComponent(previous.launchId)}.json`)
      publishImmutableFile(prior, previousBytes)
      if (!readExact(prior).equals(previousBytes) || !readExact(closed).equals(previousBytes) || !readExact(journalPath).equals(liveBytes)) throw new Error('journal close refused: prior generation conflict')
      unlinkSync(closed)
      const fd = openSync(dirname(closed), 'r')
      try { fsyncSync(fd) } finally { closeSync(fd) }
    }
  }
  if (existsSync(closed)) verifyClosed()
  else {
    publishImmutableFile(closed, JSON.stringify({ ...journal, closedAt: new Date().toISOString(), closedBy }, null, 2) + '\n')
    verifyClosed()
  }
  if (liveBytes) {
    if (!readExact(journalPath).equals(liveBytes)) throw new Error('journal close refused: live journal changed')
    unlinkSync(journalPath)
    const fd = openSync(dirname(journalPath), 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
  }
  return closed
}

/**
 * The ARCHIVED journal covering every id, or null — the closed twin of findJournal.
 *
 * `phase land` renames a landed run journal `codex-<ids>.json` → `codex-<ids>.closed.json`
 * (stamped, never deleted). That name leaves both live scans on purpose: the journalRe class
 * `[\d-]` has no '.', so no launch guard can ever mistake a closed lane for a live one. The cost
 * is that `status` would report "no journal covers phase(s) N" over a journal sitting right there
 * in .building/ — sending the reader hunting for a run that DID happen and landed. Same two
 * lookups as the live one (the exact name, then a scan), because an arc lands as ONE journal and
 * an exact-name-only probe would miss every member but the first.
 *
 * QUIET by default and LOUD on demand, because the two readers want opposite things from a
 * corrupt file. `codex status` asks about liveness, which a closed lane cannot prove either way,
 * so an unreadable one is simply not an answer there. The gate's attribution reconcile asks
 * whether the launcher's record agrees with the phase file's claim, and its contract is explicit
 * that a journal which EXISTS and will not parse is a PROBLEM, never an absence — older or externally damaged
 * journals may contain partial bytes, and answering null would
 * let landing a delegated phase turn a loud guard quiet. `strict` throws JournalUnreadableError.
 */
export function findClosedJournal(root, ids, lane = 'run', { strict = false, worktree } = {}) {
  const wanted = ids.map(String)
  const failures = []
  const read = (p, candidate) => {
    let value
    try {
      value = JSON.parse(readFileSync(p, 'utf8'))
    } catch (e) {
      if (candidate) failures.push({ path: p, message: e.message })
      return null
    }
    const declined = journalDeclineReason(value)
    if (declined) {
      if (candidate) failures.push({ path: p, message: declined })
      return null
    }
    return value
  }
  const exact = journalPath(root, ids, lane).replace(/\.json$/, '.closed.json')
  if (existsSync(exact)) {
    const journal = read(exact, true)
    if (journal && matchesWorktree(journal, worktree)) return { path: exact, journal }
  }
  const dir = join(root, '.building')
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!LANES[lane].closedRe.test(f)) continue
    const path = join(dir, f)
    if (path === exact) continue
    // Candidacy off the FILENAME, the scoping findJournal uses: a corrupt journal belonging to
    // OTHER phases is not this lookup's business, and nothing is skipped in silence — that file
    // still throws for the ids it names.
    const named = f.match(/\d+/g) ?? []
    const journal = read(path, wanted.every((n) => named.includes(n)))
    const phases = (journal?.phases ?? []).map(String)
    if (journal && wanted.every((n) => phases.includes(n)) && matchesWorktree(journal, worktree)) return { path, journal }
  }
  if (strict && failures.length > 0) throw new JournalUnreadableError(failures)
  return null
}

// -- Exact-head lane classification ---------------------------------------------------

const stableBinding = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableBinding).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableBinding(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Digest structured launch evidence using the same canonical byte grammar as completion binding. */
export function journalBindingDigestOf(value) {
  const bytes = stableBinding(value)
  return bytes === undefined ? null : `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function journalBytesDigestOf(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

/** Fingerprint only the fields that bind one completed lane result. */
export function completionFingerprintOf(journal) {
  const binding = {
    phases: journal?.phases,
    lane: journal?.lane ?? 'run',
    worktree: journal?.worktree,
    ...(journal?.worktreeIdentity !== undefined ? { worktreeIdentity: journal.worktreeIdentity } : {}),
    requestedRef: journal?.requestedRef,
    requestedHead: journal?.requestedHead,
    baseHead: journal?.baseHead,
    workingHead: journal?.workingHead,
    report: journal?.report,
    reportDigest: journal?.reportDigest,
    laneOwner: journal?.laneOwner,
    authorityDigest: journal?.authorityDigest,
    governanceDigest: journal?.governanceDigest,
    requestDigest: journal?.requestDigest,
    ownerRoot: journal?.ownerRoot,
    prompt: journal?.prompt,
    carriedIn: journal?.carriedIn,
    carriedDigest: journal?.carriedDigest,
    launchId: journal?.launchId,
    driverExit: journal?.driverExit,
  }
  return journalBindingDigestOf(binding)
}

const defaultGit = (file, args, opts = {}) => {
  try {
    return { status: 0, stdout: execFileSync(file, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' }
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout?.toString() ?? '', stderr: error.stderr?.toString() ?? error.message }
  }
}

const refusal = (state, evidence = {}) => ({ state, restartable: false, evidence })
const sameJson = (a, b) => stableBinding(a) === stableBinding(b)
const digestFile = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
const SHA256 = /^sha256:[0-9a-f]{64}$/
const GIT_HEAD = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const nonblank = (value) => typeof value === 'string' && value.trim().length > 0
const validOwner = (owner) => owner && typeof owner === 'object' && !Array.isArray(owner)
  && nonblank(owner.kind) && nonblank(owner.id)

function canonicalExisting(path) {
  try { return realpathSync(path) } catch { return null }
}

function commonDir(worktree, exec) {
  const result = gitProbe(exec, worktree, ['rev-parse', '--git-common-dir'])
  if (result.status !== 0 || !result.stdout.trim()) return null
  const raw = result.stdout.trim()
  return canonicalExisting(isAbsolute(raw) ? raw : resolve(worktree, raw))
}

function gitProbe(exec, cwd, args) {
  try { return exec('git', ['-C', cwd, ...args]) } catch (error) {
    return { status: 1, stdout: '', stderr: error.message }
  }
}

function inspectLane(root, ids, expected, { isAlive, exec }, allowArchived = false) {
  let found
  try {
    found = findJournal(root, ids, expected?.lane ?? 'run')
  } catch (error) {
    return refusal('corrupt', { error: error.message })
  }
  if (!found) return refusal('corrupt', { error: 'journal missing' })
  const { journal, path } = found
  const lane = expected?.lane ?? 'run'
  const label = lane === 'run' && /^[a-z0-9]+$/.test(journal.label ?? '') ? journal.label : undefined
  const reportName = label ? `CODEX-REPORT.${label}.md` : LANES[lane]?.report
  const expectedJournalName = LANES[lane] ? basename(journalPath(root, ids, lane, { label })) : null
  const pathReal = canonicalExisting(path)
  let pathIsLink = true
  try { pathIsLink = lstatSync(path).isSymbolicLink() } catch {}
  if (!LANES[lane] || pathIsLink || !pathReal || pathReal !== resolve(path)
    || basename(path) !== expectedJournalName
    || journal.lane !== lane || !sameJson(journal.phases, ids)) {
    return refusal('corrupt', { path, error: 'journal scope or path does not match the requested lane' })
  }
  if (!validOwner(journal.laneOwner) || !validOwner(expected?.laneOwner)
    || !SHA256.test(journal.authorityDigest) || !SHA256.test(expected?.authorityDigest)
    || !SHA256.test(journal.governanceDigest) || !SHA256.test(expected?.governanceDigest)
    || !Number.isSafeInteger(journal.pgid) || journal.pgid <= 0
    || !GIT_HEAD.test(journal.baseHead) || !GIT_HEAD.test(journal.requestedHead)
    || !GIT_HEAD.test(journal.workingHead)
    || !nonblank(journal.requestedRef) || !nonblank(expected?.requestedRef)) {
    return refusal('corrupt', { path, error: 'journal identity metadata is missing or malformed' })
  }
  const rootReal = canonicalExisting(root)
  const worktreeReal = canonicalExisting(journal.worktree)
  const expectedWorktree = canonicalExisting(expected?.worktree)
  const archived = allowArchived && !worktreeReal && !existsSync(journal.worktree ?? '')
    && isAbsolute(journal.worktree ?? '') && nonblank(expected?.worktree)
    && resolve(journal.worktree) === resolve(expected.worktree)
    && Number.isFinite(Date.parse(journal.archivedAt))
    && journal.ownerRoot === rootReal
  let registered
  try { registered = listWorktrees(root).map(({ dir }) => canonicalExisting(dir)).filter(Boolean) } catch (error) {
    return refusal('unowned', { path, error: error.message })
  }
  const rootCommon = rootReal ? commonDir(rootReal, exec) : null
  const worktreeCommon = worktreeReal ? commonDir(worktreeReal, exec) : null
  if (!rootReal || !rootCommon || (!archived && (!worktreeReal || !expectedWorktree || worktreeReal !== expectedWorktree
    || !registered.includes(worktreeReal) || !worktreeCommon || rootCommon !== worktreeCommon))
    || (journal.ownerRoot !== undefined && journal.ownerRoot !== rootReal)) {
    return refusal('unowned', { path, worktree: journal.worktree })
  }
  if (!sameJson(journal.laneOwner, expected.laneOwner)
    || journal.authorityDigest !== expected.authorityDigest
    || (expected.governanceDigest !== undefined && journal.governanceDigest !== expected.governanceDigest)) {
    return refusal('unowned', { path, laneOwner: journal.laneOwner, authorityDigest: journal.authorityDigest })
  }
  try {
    if (isAlive(journal.pgid)) return refusal('live', { path, pgid: journal.pgid })
  } catch (error) {
    return refusal('corrupt', { path, error: error.message })
  }

  return { journal, path, lane, reportName, rootReal, worktreeReal, archived }
}

function laneDirt(context, exec) {
  const { journal, path, reportName, worktreeReal } = context
  const status = gitProbe(exec, worktreeReal, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status.status !== 0) return refusal('dirty', { path, error: status.stderr })
  let artifactRoot
  try { artifactRoot = roadmapRootRel(worktreeReal) } catch (error) {
    return refusal('corrupt', { path, error: error.message })
  }
  const allowed = new Set([reportName, prevReportName(reportName), `${artifactRoot}/.arc-mode`])
  if (journal.carriedIn) {
    const carried = canonicalExisting(resolve(worktreeReal, journal.carriedIn))
    try {
      if (!carried || !carried.startsWith(`${worktreeReal}/`) || !SHA256.test(journal.carriedDigest)
        || digestFile(carried) !== journal.carriedDigest) return refusal('dirty', { path, error: 'carried input changed or is unreadable' })
      allowed.add(journal.carriedIn)
    } catch (error) { return refusal('dirty', { path, error: error.message }) }
  }
  const changes = status.stdout.split('\0').filter(Boolean)
    .filter((line) => !line.startsWith('?? ') || !allowed.has(line.slice(3)))
  if (changes.length) return refusal('dirty', { path, changes })
  if (journal.report !== reportName) return refusal('corrupt', { path, error: 'journal report does not match the requested lane' })
  return null
}

/** Read-only classification of one plan/review/run lane against a newly resolved request. */
export function classifyJournal(root, ids, expected, { isAlive = groupAlive, exec = defaultGit } = {}) {
  const context = inspectLane(root, ids, expected, { isAlive, exec })
  if (context.state) return context
  const { journal, path, rootReal, worktreeReal } = context
  const dirty = laneDirt(context, exec)
  if (dirty) return dirty

  const requested = gitProbe(exec, rootReal, ['rev-parse', '--verify', '--end-of-options', `${expected.requestedRef}^{commit}`])
  if (journal.requestedRef !== expected.requestedRef || requested.status !== 0 || !requested.stdout.trim()
    || expected.requestedHead !== requested.stdout.trim()) {
    return refusal('diverged', { path, requestedRef: expected.requestedRef, requestedHead: requested.stdout.trim() || null })
  }
  const head = gitProbe(exec, worktreeReal, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  if (head.status !== 0 || head.stdout.trim() !== journal.workingHead) {
    return refusal('diverged', { path, workingHead: head.stdout.trim() || null, recordedWorkingHead: journal.workingHead })
  }
  const baseOwned = gitProbe(exec, worktreeReal, ['merge-base', '--is-ancestor', journal.baseHead, journal.workingHead])
  const requestAdvanced = gitProbe(exec, rootReal, ['merge-base', '--is-ancestor', journal.requestedHead, expected.requestedHead])
  if (journal.baseHead !== journal.requestedHead || baseOwned.status !== 0 || requestAdvanced.status !== 0) {
    return refusal('diverged', { path, error: baseOwned.stderr || requestAdvanced.stderr })
  }
  const unique = gitProbe(exec, worktreeReal, ['rev-list', '--count', `${expected.requestedHead}..${journal.workingHead}`])
  if (unique.status !== 0) return refusal('diverged', { path, error: unique.stderr })
  if (Number(unique.stdout.trim()) > 0) return refusal('unique-commit', { path, count: Number(unique.stdout.trim()) })

  const reportLocation = completedReportLocation(rootReal, path, journal, worktreeReal)
  const reportPath = reportLocation.path
  const reportReal = reportPath ? canonicalExisting(reportPath) : null
  const completed = typeof journal.reportDigest === 'string' && typeof journal.completionFingerprint === 'string'
  const partialCompletion = journal.reportDigest !== undefined || journal.completionFingerprint !== undefined
  if (partialCompletion && !completed) return refusal('corrupt', { path, error: 'completion binding is incomplete' })
  if (completed) {
    const expectedFingerprint = completionFingerprintOf(journal)
    let actualReportDigest
    try { actualReportDigest = reportReal ? digestFile(reportReal) : null } catch (error) {
      return refusal('diverged', { path, error: error.message })
    }
    if (!reportReal || reportReal !== resolve(reportPath) || !reportLocation.archived && !reportReal.startsWith(worktreeReal + '/')
      || actualReportDigest !== journal.reportDigest
      || journal.completionFingerprint !== expectedFingerprint
      || !SHA256.test(journal.reportDigest) || !SHA256.test(journal.completionFingerprint)) {
      return refusal('diverged', { path, reportDigest: journal.reportDigest, completionFingerprint: journal.completionFingerprint })
    }
    const changedRequest = SHA256.test(expected.requestDigest) && SHA256.test(journal.requestDigest)
      && expected.requestDigest !== journal.requestDigest
    if (journal.requestedHead !== expected.requestedHead || changedRequest) {
      return {
        state: 'stale-clean', restartable: true,
        requestedHead: expected.requestedHead, workingHead: journal.workingHead,
        evidence: { path, priorRequestedHead: journal.requestedHead, ...(changedRequest ? { reason: 'request-changed' } : {}) },
      }
    }
    if (expected.reportDigest !== journal.reportDigest
      || expected.completionFingerprint !== journal.completionFingerprint) {
      return refusal('diverged', { path, reportDigest: journal.reportDigest, completionFingerprint: journal.completionFingerprint })
    }
    return {
      state: 'reusable', restartable: false,
      requestedHead: expected.requestedHead, workingHead: journal.workingHead,
      evidence: { path, reportDigest: journal.reportDigest, completionFingerprint: journal.completionFingerprint },
    }
  }
  return {
    state: 'stale-clean', restartable: true,
    requestedHead: expected.requestedHead, workingHead: journal.workingHead,
    evidence: { path, priorRequestedHead: journal.requestedHead },
  }
}

function archivedReportPaths(path, journal) {
  return [path.replace(/\.json$/, '-REPORT.md'), path.replace(/\.json$/, `-${journal.launchId}-REPORT.md`)]
}

function completedReportLocation(root, path, journal, worktree) {
  const source = worktree ? resolve(worktree, journal.report ?? '') : null
  if (source && existsSync(source)) return { path: source, archived: false }
  const allowed = archivedReportPaths(path, journal)
  if (Number.isFinite(Date.parse(journal.archivedAt)) && allowed.includes(journal.archivedReport)
    && dirname(journal.archivedReport) === join(root, '.building')) return { path: journal.archivedReport, archived: true }
  return { path: source, archived: false }
}

/** Validate a completed result without granting reset or disposal authority. */
function validateImmutableCompletionBinding(root, ids, lane, expected, { isAlive = groupAlive, exec = defaultGit } = {}, historical = false, requireArchived = false) {
  if (!['plan', 'review'].includes(lane)) return refusal('corrupt', { error: 'completion is only defined for plan/review lanes' })
  const context = inspectLane(root, ids, { ...expected, lane }, { isAlive, exec }, true)
  if (context.state) return context
  if (requireArchived && !context.archived) return refusal('unowned', { path: context.path, error: 'review completion is not archived with its worktree absent' })
  const { journal, path, rootReal, worktreeReal, archived, reportName } = context
  if (journal.report !== reportName || journal.ownerRoot !== rootReal
    || !nonblank(journal.launchId) || !Number.isFinite(Date.parse(journal.finishedAt))
    || journal.driverExit?.code !== 0 || journal.driverExit?.signal != null || journal.driverExit?.error
    || !journal.authority || !journal.governance || journal.governance.hold
    || journalBindingDigestOf(journal.authority) !== journal.authorityDigest
    || journalBindingDigestOf(journal.governance) !== journal.governanceDigest) {
    return refusal('corrupt', { path, error: 'successful native completion bindings are missing or inconsistent' })
  }
  try {
    const authority = intersectAuthority(journal.authority.parent, journal.authority.request)
    if (!sameJson(authority.effective, journal.authority.effective)
      || journal.authority.native?.driver !== 'codex' || !Array.isArray(journal.authority.native?.argv)
      || journal.governance.root !== journal.worktree || !Array.isArray(journal.governance.targets)
      || !Array.isArray(journal.governance.instructions) || !journal.governance.taskRunners) {
      return refusal('corrupt', { path, error: 'authority or governance receipt is malformed' })
    }
  } catch (error) { return refusal('corrupt', { path, error: error.message }) }
  const requested = gitProbe(exec, rootReal, ['rev-parse', '--verify', '--end-of-options',
    `${historical ? journal.requestedHead : expected.requestedRef}^{commit}`])
  if (requested.status !== 0 || requested.stdout.trim() !== expected.requestedHead
    || journal.requestedRef !== expected.requestedRef || journal.requestedHead !== expected.requestedHead) {
    return refusal('diverged', { path, reason: 'request-mismatch' })
  }
  const head = gitProbe(exec, archived ? rootReal : worktreeReal,
    ['rev-parse', '--verify', '--end-of-options', `${archived ? journal.workingHead : 'HEAD'}^{commit}`])
  if (journal.baseHead !== journal.requestedHead
    || head.status !== 0 || head.stdout.trim() !== journal.workingHead) {
    return refusal('diverged', { path, reason: 'head-mismatch' })
  }
  const relation = lane === 'review' ? journal.workingHead === expected.requestedHead
    : gitProbe(exec, rootReal, ['merge-base', '--is-ancestor', expected.requestedHead, journal.workingHead]).status === 0
  if (!relation) return refusal(lane === 'review' ? 'unique-commit' : 'diverged', { path })
  if (!archived) {
    const dirty = laneDirt(context, exec)
    if (dirty) return dirty
  }
  const promptPath = path.replace(/\.json$/, '-prompt.txt')
  const reportLocation = completedReportLocation(rootReal, path, journal, worktreeReal)
  const reportPath = reportLocation.path
  try {
    if (journal.prompt !== promptPath || canonicalExisting(promptPath) !== resolve(promptPath)
      || (archived && !reportLocation.archived)
      || !reportPath
      || canonicalExisting(reportPath) !== resolve(reportPath)) return refusal('unowned', { path, error: 'completion artifact path does not belong to this lane' })
    const carriedDigest = journal.carriedIn
      ? (archived ? journal.carriedDigest : digestFile(resolve(worktreeReal, journal.carriedIn))) : null
    if (journal.carriedIn && (!SHA256.test(carriedDigest) || carriedDigest !== journal.carriedDigest)) {
      return refusal('diverged', { path, error: 'carried input binding changed' })
    }
    const requestDigest = journalBindingDigestOf({ prompt: readFileSync(promptPath, 'utf8'), carriedDigest })
    if (!SHA256.test(journal.requestDigest) || requestDigest !== journal.requestDigest
      || (expected.requestDigest !== undefined && expected.requestDigest !== requestDigest)) {
      return refusal('diverged', { path, error: 'request bytes changed' })
    }
    const report = readFileSync(reportPath)
    const reportDigest = journalBytesDigestOf(report)
    if (report.toString('utf8').match(/CODEX-RUN-(COMPLETE|BLOCKED)/)?.[0] !== 'CODEX-RUN-COMPLETE'
      || !SHA256.test(journal.reportDigest) || reportDigest !== journal.reportDigest
      || !SHA256.test(journal.completionFingerprint)
      || completionFingerprintOf(journal) !== journal.completionFingerprint) return refusal('diverged', { path })
    return {
      state: 'reusable', restartable: false, reportPath,
      requestedHead: journal.requestedHead, workingHead: journal.workingHead,
      evidence: { path, requestedHead: journal.requestedHead, workingHead: journal.workingHead, reportDigest, completionFingerprint: journal.completionFingerprint },
    }
  } catch (error) { return refusal('diverged', { path, error: error.message }) }
}

/** A newly requested result must still match the ref resolved now. */
export function validateLaneCompletion(root, ids, lane, expected, opts) {
  return validateImmutableCompletionBinding(root, ids, lane, expected, opts)
}

/** Prove an archived review's original completion without treating it as fresh for a moved ref. */
export function validateArchivedReviewCompletion(root, ids, expected, opts) {
  let found
  try { found = findJournal(root, ids, 'review') } catch (error) {
    return { valid: false, purpose: 'archived-review', state: 'corrupt', evidence: { error: error.message } }
  }
  if (found && (!Number.isFinite(Date.parse(found.journal.archivedAt)) || existsSync(found.journal.worktree ?? ''))) {
    return {
      valid: false, purpose: 'archived-review', state: 'unowned',
      evidence: { path: found.path, error: 'review completion is not archived with its worktree absent' },
    }
  }
  const checked = validateImmutableCompletionBinding(root, ids, 'review', expected, opts, true, true)
  if (checked.state !== 'reusable') {
    return { valid: false, purpose: 'archived-review', state: checked.state, evidence: checked.evidence }
  }
  return {
    valid: true, purpose: 'archived-review', originalRequestedHead: checked.requestedHead,
    workingHead: checked.workingHead, reportPath: checked.reportPath, evidence: checked.evidence,
  }
}

/** A retained review may preserve its original completion before a newly requested reset. */
export function validateRetainedReviewCompletion(root, ids, expected, opts) {
  const purpose = 'retained-review'
  let found
  try {
    found = findJournal(root, ids, 'review')
    const journal = found?.journal
    if (!journal || !existsSync(journal.worktree ?? '') || !Number.isFinite(Date.parse(journal.archivedAt))
      || !archivedReportPaths(found.path, journal).includes(journal.archivedReport)
      || dirname(journal.archivedReport) !== dirname(found.path)
      || canonicalExisting(journal.archivedReport) !== resolve(journal.archivedReport)
      || journalBytesDigestOf(readFileSync(journal.archivedReport)) !== journal.reportDigest) {
      return { valid: false, purpose, state: 'unowned', evidence: { error: 'retained review needs its exact archived report and standing worktree' } }
    }
  } catch (error) { return { valid: false, purpose, state: 'corrupt', evidence: { error: error.message } } }
  const checked = validateImmutableCompletionBinding(root, ids, 'review', expected, opts, true, false)
  return checked.state === 'reusable'
    ? { valid: true, purpose, originalRequestedHead: checked.requestedHead, workingHead: checked.workingHead, reportPath: checked.reportPath, evidence: checked.evidence }
    : { valid: false, purpose, state: checked.state, evidence: checked.evidence }
}

/** Historical plan evidence can feed only the existing harvest owner, never a new request. */
export function validatePlanArchiveCandidate(root, ids, journal, opts) {
  let governance = journal?.governance
  try {
    if (existsSync(journal?.worktree ?? '')) governance = resolveGovernance(journal.worktree, journal.governance?.targets ?? [])
  } catch (error) {
    return { valid: false, purpose: 'plan-archive', state: 'corrupt', evidence: { error: error.message } }
  }
  const checked = validateImmutableCompletionBinding(root, ids, 'plan', {
    worktree: journal?.worktree, requestedRef: journal?.requestedRef, requestedHead: journal?.requestedHead,
    laneOwner: { kind: 'roadmap-codex', id: `plan:${ids.join('-')}` },
    authorityDigest: journalBindingDigestOf(journal?.authority),
    governanceDigest: journalBindingDigestOf(governance),
  }, opts, true)
  if (checked.state !== 'reusable') return { valid: false, purpose: 'plan-archive', state: checked.state, evidence: checked.evidence }
  return {
    valid: true, purpose: 'plan-archive', originalRequestedHead: checked.requestedHead,
    workingHead: checked.workingHead, reportPath: checked.reportPath, evidence: checked.evidence,
  }
}

/** The terminal report owner archives exact completed output before making a lane clean. */
export function archiveCompletedLaneOutput(root, path, journal, options = {}) {
  try { return withJournalLock(path, () => archiveCompletedLaneOutputUnlocked(root, path, journal, options)) }
  catch (error) { return { journal, archived: journal.archivedReport ?? null, removed: false, reason: `archive held: ${error.message}` } }
}

function archiveCompletedLaneOutputUnlocked(root, path, journal, { destination } = {}) {
  let current = journal
  const hold = reason => ({ journal: current, archived: current.archivedReport ?? null, removed: false, reason })
  try {
    root = realpathSync(root)
    if (resolveWorktreeOwnership(root, journal).state !== 'owned' || journal.ownerRoot !== root) return hold('unowned identity')
    const livePath = journalPath(root, journal.phases, journal.lane, { label: journal.label })
    const closed = path === livePath.replace(/\.json$/, '.closed.json')
    if (path !== livePath && !closed || !lstatSync(path).isFile() || realpathSync(path) !== resolve(path) || !isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), journal)) return hold('journal changed')
    const expected = journal.lane === 'run' && journal.label ? `CODEX-REPORT.${journal.label}.md` : LANES[journal.lane]?.report
    if (!expected || journal.report !== expected || journal.label && !/^[a-z0-9]+$/.test(journal.label)
      || journal.driverExit?.code !== 0 || journal.driverExit.signal != null || !Number.isFinite(Date.parse(journal.finishedAt))
      || journal.completionFingerprint !== completionFingerprintOf(journal) || !/^sha256:[a-f0-9]{64}$/.test(journal.reportDigest ?? '')) return hold('completed report binding is incomplete')
    const source = join(journal.worktreeIdentity.worktree, expected)
    const archived = destination ?? journal.archivedReport ?? path.replace(/\.json$/, `-${journal.launchId}-REPORT.md`)
    const building = join(root, '.building')
    if (dirname(resolve(archived)) !== building || realpathSync(building) !== building || archived === path || archived === source) return hold('archive destination is not canonical')
    const readRegular = file => {
      if (!lstatSync(file).isFile() || realpathSync(file) !== resolve(file)) throw new Error('artifact is not a canonical regular file')
      return readFileSync(file)
    }
    if (!existsSync(source)) {
      if (journal.archivedReport !== archived || journalBytesDigestOf(readRegular(archived)) !== journal.reportDigest) return hold('missing source has no exact archive')
      return { journal, archived, removed: true, reason: null }
    }
    const bytes = readRegular(source)
    if (journalBytesDigestOf(bytes) !== journal.reportDigest) return hold('report digest changed')
    publishImmutableFile(archived, bytes)
    if (!readRegular(archived).equals(bytes)) return hold('archive digest differs')
    const stamped = journal.archivedReport === archived && journal.archivedAt ? journal : { ...journal, archivedReport: archived, archivedAt: new Date().toISOString() }
    if (!isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), journal)) return hold('journal changed before archive stamp')
    writeJournalUnlocked(root, stamped, { label: journal.label, closed })
    current = stamped
    if (!readRegular(source).equals(bytes) || resolveWorktreeOwnership(root, stamped).state !== 'owned') return { journal: stamped, archived, removed: false, reason: 'report or ownership changed before unlink' }
    // Remove only this exact archived output. Carry-in and unknown files are untouched.
    unlinkSync(source)
    const dirFd = openSync(dirname(source), 'r')
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    return { journal: stamped, archived, removed: true, reason: null }
  } catch (error) { return hold(`archive held: ${error.message}`) }
}
