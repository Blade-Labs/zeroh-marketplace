/**
 * worktree — the session worktree lane: each session claims ONE persistent
 * worktree with ONE reusable scratch head (`wt/<k>`), resets it to the integration tip at
 * phase start, and lands curated commits back on the integration branch. No per-phase
 * branches, nothing accumulates.
 *
 * Slot identity: the lowest free slot `<root>-wt-<k>`, recorded in a sidecar registry at
 * <root>/.building/worktree-slots.json with the claimer pid. Liveness is process kill(0)
 * (the codex-journal pattern): a dead claimer's slot is reclaimable, a live one is never
 * stolen. Claiming is a REGISTRY act only — git happens in ensureWorktree.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, realpathSync, rmSync, constants, openSync, closeSync, fstatSync, lstatSync, fsyncSync, unlinkSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { LANES, journalDeclineReason, journalBindingDigestOf, journalBytesDigestOf } from './codex-journal.mjs'
import { mainCheckout, gitCommonDir } from './gitroot.mjs'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { timeout: 60_000, encoding: 'utf8' }).trim()

/** Every registered worktree, in git's porcelain order. */
export function listWorktrees(root) {
  return git(root, ['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .flatMap((block) => {
      const dir = /^worktree (.+)$/m.exec(block)?.[1]
      if (!dir) return []
      return [{ dir, branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null }]
    })
}

/** A typed worktree-lane failure. */
export class WorktreeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorktreeError'
  }
}

const registryPath = (root) => join(root, '.building', 'worktree-slots.json')
function registryDirectory(root, { create = false } = {}) {
  const dir = join(root, '.building')
  if (create) mkdirSync(dir, { recursive: true })
  try {
    if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== resolve(dir)) throw new WorktreeError('registry directory must be canonical and not a symlink')
  } catch (error) { if (!create && error.code === 'ENOENT') return null; throw error }
  return dir
}
function inspectRegistryFile(root) {
  try {
    if (!lstatSync(registryPath(root)).isFile()) throw new WorktreeError('registry must be a regular file, not a symlink')
    return true
  } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}


const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Process-GROUP liveness without pgrep, which self-matches its own probe argv. A lane journal
 *  records the group its detached driver leads; both the disposal rail here and `codex status`
 *  ask this same question of it. */
export const groupAlive = (pgid) => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/** A session-owned claim outlives any single CLI spawn; this TTL is its only calendar
 *  reaper, refreshed on every re-claim (each phase start). A week, not a day: an arc
 *  paused over a weekend must not lose its slot, and reclamation ADDITIONALLY refuses a
 *  worktree carrying uncommitted work (see reclaimable). */
const SESSION_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The claimer identity. The CLI process is EPHEMERAL — its pid dies seconds after
 *  `worktree up` returns, so pid alone would let every later session reclaim slot 1 and
 *  double-book the worktree (the exact shared-dirt hazard the lane removes). The
 *  harness exports CLAUDE_CODE_SESSION_ID — the stable identity across all of a
 *  session's spawns; a bare pid identity is the honest fallback outside a session. */
export function ownerIdentity() {
  return process.env.CLAUDE_CODE_SESSION_ID ?? process.env.CLAUDE_SESSION_ID ?? `pid:${process.pid}`
}

/** A claim row is live while its recorded pid runs; a pid-identity row dies with its
 *  pid, and a session-identity row survives dead pids until its TTL lapses. */
const rowLive = (row) => {
  if (alive(row.pid)) return true
  if (String(row.owner ?? '').startsWith('pid:')) return false
  const claimed = Date.parse(row.claimedAt ?? '')
  return Number.isFinite(claimed) && Date.now() - claimed < SESSION_CLAIM_TTL_MS
}

/** An expired row's slot is reclaimable only when taking it cannot eat work: a missing
 *  worktree always is; an existing one must be CLEAN and carry NO unlanded commits —
 *  commits reachable from the scratch head but from no other branch are a session's
 *  committed-but-unlanded phase, and the reclaimer's reset would orphan them. */
const reclaimable = (root, row) => {
  const dir = `${root}-wt-${row.slot}`
  if (!existsSync(dir)) return true
  try {
    if (git(dir, ['status', '--porcelain', '-uall']) !== '') return false
    // The exclude glob is SHORT-form on purpose: --branches expands short names, and a
    // refs/heads/-prefixed pattern silently matches nothing (measured — the guard then
    // reads every wt branch as landed and reclaims a worktree carrying unlanded work).
    const unlanded = git(dir, ['rev-list', '--count', 'HEAD', '--not', '--exclude=wt/*', '--branches'])
    return Number(unlanded) === 0
  } catch {
    return false
  }
}

/** Tolerant registry read: an array, a {slots:[…]} wrapper, or a slot-keyed map all
 *  parse; anything else fails LOUD naming the accepted shapes — a silently-empty read
 *  would hand two sessions the same slot. */
function readRegistry(root) {
  const p = registryPath(root)
  if (!registryDirectory(root) || !inspectRegistryFile(root)) return { version: 2, slots: [], identities: [] }
  let fd, raw
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW)
    if (!fstatSync(fd).isFile()) throw new WorktreeError('registry must be a regular file')
    raw = JSON.parse(readFileSync(fd, 'utf8'))
  } finally { if (fd !== undefined) closeSync(fd) }
  if (raw?.version === 2) {
    if (!(identityKeys(raw, 'version slots identities') || identityKeys(raw, 'version slots identities cleanup')) || !Array.isArray(raw.slots) || !Array.isArray(raw.identities)) throw new WorktreeError('malformed ownership registry')
    if (raw.cleanup !== undefined && (!raw.cleanup || typeof raw.cleanup !== 'object' || Array.isArray(raw.cleanup))) throw new WorktreeError('malformed cleanup map')
    for (const identity of raw.identities) {
      const reason = worktreeIdentityDeclineReason(identity)
      if (reason) throw new WorktreeError('malformed registry identity: ' + reason)
    }
    for (const key of ['ownershipId', 'worktree', 'gitAdminDir']) if (new Set(raw.identities.map(row => row[key])).size !== raw.identities.length) throw new WorktreeError('ambiguous registry identity: ' + key)
    return { version: 2, slots: raw.slots.map(r => ({ ...r, slot: Number(r.slot), pid: Number(r.pid) })), identities: raw.identities, ...(raw.cleanup === undefined ? {} : { cleanup: raw.cleanup }) }
  }
  if (raw && !Array.isArray(raw) && Object.hasOwn(raw, 'version')) throw new WorktreeError('unsupported worktree registry version')
  let rows
  if (Array.isArray(raw)) rows = raw
  else if (raw && Array.isArray(raw.slots)) rows = raw.slots
  else if (raw && typeof raw === 'object')
    rows = Object.entries(raw).map(([slot, v]) => (typeof v === 'object' ? { slot, ...v } : { slot, pid: v }))
  else
    throw new WorktreeError(
      `worktree registry ${p} is unreadable — expected an array of {slot, pid} rows, a {slots: […]} wrapper, or a slot-keyed map`,
    )
  return { version: 2, slots: rows.map((r) => ({ ...r, slot: Number(r.slot), pid: Number(r.pid) })), identities: [] }
}
const readSlots = root => readRegistry(root).slots

/** The registry rows as recorded (dead claimers included — pruning is claimSlot's job),
 *  each annotated with live-ness. THE reader for `worktree status`: a second tolerant
 *  parser forked elsewhere is exactly the double-booking hazard the loud parse guards. */
export function listSlots(root) {
  return readSlots(root).map((r) => ({ ...r, dir: `${root}-wt-${r.slot}`, live: rowLive(r) }))
}

function writeRegistry(root, value) {
  const dir = registryDirectory(root, { create: true })
  inspectRegistryFile(root)
  const tmp = `${registryPath(root)}.${randomUUID()}.tmp`
  let fd
  try {
    fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fsyncSync(fd); closeSync(fd); fd = undefined
    registryDirectory(root); inspectRegistryFile(root)
    renameSync(tmp, registryPath(root))
    const dirFd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(tmp) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

function writeSlots(root, rows) {
  writeRegistry(root, { ...readRegistry(root), slots: rows })
}

/** Kernel-held mutex shared by slot and ownership writers. Closing the descriptor or
 * process death releases it; never delete a lock based on age or PID. */
function withRegistryLock(root, fn) {
  registryDirectory(root, { create: true })
  const lock = `${registryPath(root)}.lock`
  let fd
  try {
    fd = openSync(lock, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)
    if (!fstatSync(fd).isFile()) throw new WorktreeError('registry lock must be a regular file')
    const deadline = Date.now() + 10_000
    for (;;) {
      try {
        // FD3 shares the parent's open-file description, retaining the lock after
        // this short helper exits until the parent's descriptor closes.
        execFileSync('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] })
        break
      } catch (error) {
        if (error.status !== 1) throw new WorktreeError('kernel registry lock unavailable: ' + error.message)
        if (Date.now() >= deadline) throw new WorktreeError('worktree registry lock busy after 10000ms')
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
      }
    }
    return fn()
  } finally { if (fd !== undefined) closeSync(fd) }
}

const identityKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), fields.split(' ').sort())
const absoluteCanonical = value => typeof value === 'string' && value.startsWith('/') && resolve(value) === value && !value.includes('\0')

/** Structural parsing is shared with journals; filesystem agreement is a separate join. */
export function worktreeIdentityDeclineReason(value) {
  if (!identityKeys(value, 'version ownershipId repository gitCommonDir worktree gitAdminDir branch laneOwner') || value.version !== 1
    || typeof value.ownershipId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.ownershipId)) return 'malformed worktree identity fields or UUID'
  if (['repository', 'gitCommonDir', 'worktree', 'gitAdminDir'].some(key => !absoluteCanonical(value[key]))) return 'identity paths must be absolute and canonical'
  if (value.branch !== null && (typeof value.branch !== 'string' || !value.branch.startsWith('refs/heads/') || /[\0\r\n]/.test(value.branch))) return 'identity branch must be an exact branch ref or detached null'
  if (!identityKeys(value.laneOwner, 'kind id') || value.laneOwner.kind !== 'roadmap-codex'
    || typeof value.laneOwner.id !== 'string' || !/^(run|plan|review):[0-9]+(?:-[0-9]+)*$/.test(value.laneOwner.id)) return 'identity lane owner is malformed'
  return null
}

/** Derive from live Git, without adopting or writing a worktree. */
export function createWorktreeIdentity(root, worktree, { ownershipId = randomUUID(), laneOwner, expectedBranch } = {}) {
  const repository = realpathSync(mainCheckout(root)), common = realpathSync(gitCommonDir(root))
  const path = resolve(worktree), actual = realpathSync(path)
  if (actual !== path || actual === repository) throw new WorktreeError('ownership requires a canonical linked worktree, not the primary checkout or a symlink')
  if (realpathSync(gitCommonDir(actual)) !== common || !listWorktrees(root).some(row => resolve(row.dir) === actual)) throw new WorktreeError('worktree is not registered in this repository')
  const gitAdminDir = realpathSync(git(actual, ['rev-parse', '--absolute-git-dir']))
  if (gitAdminDir === common) throw new WorktreeError('ownership requires a linked worktree Git admin directory')
  let branch = null
  try { branch = git(actual, ['symbolic-ref', '-q', 'HEAD']) } catch (error) { if (error.status !== 1) throw error }
  if (expectedBranch !== undefined && branch !== expectedBranch) throw new WorktreeError('worktree branch differs from allocation')
  const identity = { version: 1, ownershipId, repository, gitCommonDir: common, worktree: actual, gitAdminDir, branch, laneOwner }
  const reason = worktreeIdentityDeclineReason(identity)
  if (reason) throw new WorktreeError(reason)
  return identity
}
function validateLiveIdentity(root, identity) {
  const reason = worktreeIdentityDeclineReason(identity)
  if (reason) throw new WorktreeError(reason)
  const actual = createWorktreeIdentity(root, identity.worktree, { ownershipId: identity.ownershipId, laneOwner: identity.laneOwner, expectedBranch: identity.branch })
  if (!isDeepStrictEqual(actual, identity)) throw new WorktreeError('worktree identity differs from live Git')
}
export function registerWorktreeIdentity(root, identity) {
  validateLiveIdentity(root, identity)
  return withRegistryLock(root, () => {
    const registry = readRegistry(root)
    const conflicts = registry.identities.filter(row => row.ownershipId === identity.ownershipId || row.worktree === identity.worktree || row.gitAdminDir === identity.gitAdminDir)
    if (conflicts.length) {
      if (conflicts.length === 1 && isDeepStrictEqual(conflicts[0], identity)) return { status: 'existing', identity: structuredClone(identity) }
      throw new WorktreeError('conflicting worktree ownership identity')
    }
    if (registry.cleanup?.[identity.ownershipId]) throw new WorktreeError('ownership UUID has retained cleanup evidence')
    registry.identities.push(structuredClone(identity)); writeRegistry(root, registry)
    return { status: 'registered', identity: structuredClone(identity) }
  })
}
export function removeWorktreeIdentity(root, identity) {
  const reason = worktreeIdentityDeclineReason(identity)
  if (reason) throw new WorktreeError(reason)
  return withRegistryLock(root, () => {
    const registry = readRegistry(root), index = registry.identities.findIndex(row => row.ownershipId === identity.ownershipId)
    if (index < 0) return false
    if (!isDeepStrictEqual(registry.identities[index], identity)) throw new WorktreeError('ownership removal refused a changed record')
    registry.identities.splice(index, 1)
    const cleanup = registry.cleanup?.[identity.ownershipId]
    if (cleanup && cleanup.observations.length === 0 && cleanup.receipt === null) delete registry.cleanup[identity.ownershipId]
    writeRegistry(root, registry); return true
  })
}
/** A registry lookup is not ownership; callers still need the independent journal join. */
export function registeredWorktreeIdentity(root, worktree, laneOwner) {
  const actual = realpathSync(worktree), matches = readRegistry(root).identities.filter(row => row.worktree === actual)
  if (!matches.length) return null
  if (matches.length !== 1 || !isDeepStrictEqual(matches[0].laneOwner, laneOwner)) throw new WorktreeError('registered worktree belongs to a different lane')
  validateLiveIdentity(root, matches[0]); return structuredClone(matches[0])
}
export function resolveWorktreeOwnership(root, journal) {
  try {
    if (!journal || typeof journal !== 'object') return { state: 'unowned', reason: 'journal is absent or malformed' }
    const identity = journal.worktreeIdentity, reason = worktreeIdentityDeclineReason(identity)
    if (reason) return { state: 'unowned', reason }
    if (typeof journal.worktree !== 'string' || resolve(journal.worktree) !== identity.worktree || !isDeepStrictEqual(journal.laneOwner, identity.laneOwner)) return { state: 'unowned', reason: 'journal and identity bindings differ' }
    if (journal.lane !== identity.laneOwner.id.split(':')[0] || !Array.isArray(journal.phases) || journal.phases.map(String).join('-') !== identity.laneOwner.id.split(':')[1]) return { state: 'unowned', reason: 'journal lane scope differs from identity' }
    const registry = readRegistry(root), matches = registry.identities.filter(row => row.ownershipId === identity.ownershipId)
    if (matches.length !== 1 || !isDeepStrictEqual(matches[0], identity)) return { state: 'unowned', reason: 'registry and journal identities differ or one is absent' }
    validateLiveIdentity(root, identity)
    return { state: 'owned', identity: structuredClone(identity) }
  } catch (error) { return { state: 'unowned', reason: error.message } }
}

/**
 * Claim the lowest free slot for this OWNER (the session identity — stable across the
 * session's many short-lived CLI spawns). Idempotent per owner: a re-claim returns the
 * SAME slot with its claimedAt refreshed (the TTL heartbeat). Dead claims — a pid
 * identity whose pid exited, a session identity past its TTL — are dropped so their
 * slots free up. Returns { slot, dir }; dir is `${root}-wt-${slot}`, not created here.
 */
export function claimSlot(root, { owner = ownerIdentity(), pid = process.pid } = {}) {
  return withRegistryLock(root, () => {
    const all = readSlots(root)
    // Dead rows are dropped only when their slot is safely reclaimable; a dead-but-dirty
    // worktree keeps its row so nobody resets a tree that still carries live state.
    const rows = all.filter((r) => rowLive(r) || !reclaimable(root, r))
    const mine = rows.find((r) => r.owner === owner)
    if (mine) {
      mine.claimedAt = new Date().toISOString()
      writeSlots(root, rows)
      return { slot: mine.slot, dir: `${root}-wt-${mine.slot}` }
    }
    const taken = new Set(rows.map((r) => r.slot))
    let k = 1
    while (taken.has(k)) k += 1
    rows.push({ slot: k, owner, pid, claimedAt: new Date().toISOString() })
    writeSlots(root, rows)
    return { slot: k, dir: `${root}-wt-${k}` }
  })
}

/**
 * Ensure the slot's worktree exists on scratch head wt/<slot> at baseRef. First creation
 * runs installDeps(dir) exactly once (an injectable seam — the CLI supplies the real
 * installer); an existing worktree is returned UNTOUCHED — the scratch head only moves
 * via resetForPhase/landPhase, never as a side effect of entering.
 */
export function ensureWorktree(root, slot, { baseRef = 'HEAD', installDeps } = {}) {
  const dir = `${root}-wt-${slot}`
  if (existsSync(dir)) return { dir, created: false }
  const base = git(root, ['rev-parse', `${baseRef}^{commit}`])
  git(root, ['worktree', 'add', '-B', `wt/${slot}`, dir, base])
  if (installDeps) installDeps(dir)
  return { dir, created: true }
}

/** The land lost its race more times than the budget allows — the base kept advancing. */
export class WorktreeRaceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorktreeRaceError'
  }
}

/** A rebase conflict: a sibling landed overlapping files. Never auto-resolved. */
export class WorktreeConflictError extends Error {
  constructor(message, conflicts) {
    super(message)
    this.name = 'WorktreeConflictError'
    this.conflicts = conflicts
  }
}

/**
 * Land the worktree's curated commits on the integration branch: rebase the scratch
 * head onto baseRef's CURRENT tip, then advance the base via the compare-and-swap
 * update-ref form — a lost race is DETECTED (the expected-old guard refuses), never
 * clobbered, and the loser re-reads the tip, rebases again and retries up to `retries`
 * times before throwing typed. A genuine file conflict aborts the rebase (worktree
 * restored, no mid-rebase state) and throws its own typed error naming the paths —
 * resolution belongs to the executor, never to this function.
 *
 * `retries` counts retries: total swap attempts = retries + 1. `onRetry(n)` fires per
 * retry actually taken; `beforeSwap(attempt)` is the injectable seam between rebase and
 * swap (tests race the base there deterministically). Returns { tip, landed }.
 */
export function landPhase(worktreeDir, baseRef, { retries = 3, onRetry, beforeSwap } = {}) {
  const ref = `refs/heads/${baseRef}`
  let attempt = 0
  for (;;) {
    const tip = git(worktreeDir, ['rev-parse', ref])
    try {
      git(worktreeDir, ['rebase', tip])
    } catch (e) {
      try {
        git(worktreeDir, ['rebase', '--abort'])
      } catch {
        // no rebase in progress (the failure predates it) — nothing to abort
      }
      const text = `${e.stdout ?? ''}\n${e.stderr ?? ''}`
      const conflicts = [...text.matchAll(/Merge conflict in (.+)/g)].map((m) => m[1].trim())
      throw new WorktreeConflictError(
        `land: rebasing onto ${baseRef} hit a merge CONFLICT in ${conflicts.join(', ') || 'unknown files'} — a sibling landed overlapping work; resolve in the worktree, never auto-merge`,
        conflicts,
      )
    }
    const newTip = git(worktreeDir, ['rev-parse', 'HEAD'])
    const landed = Number(git(worktreeDir, ['rev-list', '--count', `${tip}..${newTip}`]))
    if (beforeSwap) beforeSwap(attempt)
    try {
      advanceBase(worktreeDir, baseRef, newTip, tip)
      return { tip: newTip, landed }
    } catch (e) {
      if (!e.raceLoss) throw e
      attempt += 1
      if (attempt > retries) {
        throw new WorktreeRaceError(
          `land: ${baseRef} kept advancing under the swap — retry budget (${retries}) exhausted; pull, re-curate if needed, and land again`,
        )
      }
      if (onRetry) onRetry(attempt)
    }
  }
}

/** The path of the worktree that has baseRef CHECKED OUT, or null. EXACT ref equality: the
 *  substring form this replaced let `main-primary` answer for `main`, and advanceBase would then
 *  fast-forward the wrong checkout. Exported for that pin alone. */
export function checkoutOf(worktreeDir, baseRef) {
  return listWorktrees(worktreeDir).find(({ branch }) => branch === baseRef)?.dir ?? null
}

/**
 * Advance the base branch to newTip, expecting it at expectedTip — coherently.
 *
 * A bare update-ref on a branch CHECKED OUT elsewhere (the azure primary keeps develop
 * checked out) silently desyncs that checkout's index: `git status` there shows every
 * landed file as a staged deletion, and a sibling's ordinary commit then deletes the
 * landed work from the branch. git's porcelain refuses exactly this; the plumbing does
 * not. So: when a checkout holds baseRef, the advance happens IN that checkout via
 * `merge --ff-only` (index and worktree move with the ref; refuses rather than clobbers
 * local changes); only an unchecked-out base takes the plumbing CAS. A lost race throws
 * with `raceLoss = true`; any other git failure carries its real stderr.
 */
function advanceBase(worktreeDir, baseRef, newTip, expectedTip) {
  const ref = `refs/heads/${baseRef}`
  const home = checkoutOf(worktreeDir, baseRef)
  if (git(worktreeDir, ['rev-parse', ref]) !== expectedTip) {
    const lost = new WorktreeError(`land: ${baseRef} advanced before the swap`)
    lost.raceLoss = true
    throw lost
  }
  try {
    if (home) git(home, ['merge', '--ff-only', newTip])
    else git(worktreeDir, ['update-ref', ref, newTip, expectedTip])
  } catch (e) {
    const text = `${e.stderr ?? ''}${e.stdout ?? ''}`
    if (/but expected|not possible to fast-forward|Not possible to fast-forward/i.test(text)) {
      const lost = new WorktreeError(`land: ${baseRef} advanced under the swap`)
      lost.raceLoss = true
      throw lost
    }
    throw new WorktreeError(`land: advancing ${baseRef} failed — ${text.trim() || e.message}`)
  }
}

/**
 * Reset the scratch head to the integration tip for a new phase. A dirty worktree
 * REFUSES — uncommitted work is a session's live state, and a reset that eats it is the
 * exact hazard the lane exists to remove.
 */
export function resetForPhase(worktreeDir, baseRef) {
  const dirty = git(worktreeDir, ['status', '--porcelain', '-uall'])
  if (dirty !== '') {
    throw new WorktreeError(
      `worktree ${worktreeDir} is DIRTY — refusing to reset for a new phase; commit, stash or clean first:\n${dirty}`,
    )
  }
  git(worktreeDir, ['reset', '--hard', `${baseRef}^{commit}`])
}

/** Same path, whatever symlinks /tmp and the shared host put in the way. */
export function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b)
  } catch {
    return resolve(a) === resolve(b)
  }
}

/**
 * Is `dir` one of this repo's session-lane SLOTS?
 *
 * The namespace is `<root>-wt-<k>` and ensureWorktree is its only builder, so the shape IS the
 * membership test — `listSlots` derives the same string from the same two parts and could not
 * answer differently. It lives here rather than beside a caller because BOTH landing verbs have
 * to ask it: `codex run --worktree <root>-wt-3` (reusing a provisioned slot to skip the npm ci)
 * journals a slot, and disposing one takes its node_modules with it while the slot registry keeps
 * a live claim on a deleted path. Slot retirement is deliberately nobody's job here.
 */
export function isSlotDir(root, dir) {
  const k = /-wt-(\d+)$/.exec(dir)?.[1]
  return Boolean(k) && samePath(`${root}-wt-${k}`, dir)
}

/**
 * The ONE lane inventory: every lane worktree this repo carries, with its lifecycle class and the
 * exact command that closes it.
 *
 * Three readers want this same answer — `roadmap audit` check 15, the `roadmap status` stray line,
 * and any operator who would otherwise run `git worktree list` by hand — and a second
 * worktree-enumeration parser is the forked seam this export exists to prevent. Stray lane
 * trees accumulate silently across consumers — dead, unarchived journals over gigabytes of
 * checkout — precisely because no command names them.
 *
 * INVENTORY AND LIVENESS ONLY, by design. Whether a tree is SAFE to remove — dirt, unpushed
 * commits — is disposeWorktree's question, asked once at a done-moment; asking it per lane on
 * every `roadmap status` would be expensive and would race a lane still writing into its tree.
 *
 * Classes, one per row: `live` (the matched journal's pgid is a running process GROUP) ·
 * `stale-run`/`stale-plan`/`stale-review` (its group is gone; the suffix is the journal's own
 * lane, because the three lanes have three different done-moments) · `closed` (the match is an
 * ARCHIVED journal, so the done-moment already ran and only the tree was left behind) · `legacy`
 * (no journal names the dir) · `unknown` (a journal that could cover it will not read — including
 * one truncated BEFORE its worktree field, which names no tree and so downgrades every otherwise-
 * `legacy` lane rather than let one read as journal-less: one corrupt file widens `unknown` past
 * the lane it really covers, which is the conservative direction on purpose).
 * `unknown` is never folded into `legacy` — the codex-journal doctrine: an absent record means
 * nothing ran, an unreadable one means the launcher's record is there and unreadable, and
 * treating those alike reports "manual inspection" over a journal sitting right on disk.
 *
 * Matching is by RESOLVED worktree path on BOTH sides (the refuseIfLive precedent): a journal may
 * record `--worktree ../lane` as given, and a raw string compare would leave that lane reading as
 * journal-less — a phantom `legacy` row for its own absolute twin. Relative entries resolve
 * against `root`, which is what the CLI's cwd was when the launcher wrote them.
 *
 * NEVER throws on a journal. A single truncated file in .building/ would otherwise take down both
 * `status` and `audit`. The worktree ENUMERATION is deliberately not caught: a repo that cannot
 * list its own worktrees is broken, and reporting an empty inventory for it would be the silent
 * all-clear this whole seam exists to stop.
 *
 * @param {string} anyRoot any checkout of the repo — the survey resolves the MAIN one itself.
 * @returns {Array<{ dir: string, branch: string|null,
 *   class: 'live'|'stale-run'|'stale-plan'|'stale-review'|'closed'|'legacy'|'unknown',
 *   journalPath: string|null, remedy: string }>} one row per lane worktree — never the primary,
 *   never a session slot (isSlotDir: disposing one takes its node_modules with it while the slot
 *   registry keeps a live claim on a deleted path).
 */
export function surveyLanes(anyRoot) {
  // ONE answer to "which checkout", resolved HERE rather than trusted from a caller. Both
  // consumers hand this a LINKED worktree in their default invocation: `roadmap audit` defaults
  // its repo to cwd, `roadmap status` derives it from `rev-parse --show-toplevel`, and both return
  // the linked tree when the command runs inside one — which is exactly where /do-phase (a session
  // slot) and `roadmap phase land` (the codex lane) run. Surveyed from there, the PRIMARY checkout
  // becomes a `legacy` stray whose remedy tells the operator to delete the main checkout and the
  // integration branch; sibling slots escape isSlotDir, which anchors on the passed root, so
  // `<root>-wt-2` never matches root `<root>-wt-1`; and journals are read from a .building that
  // holds none, so every real lane classifies `legacy` and loses its done-moment. A wrong remedy is
  // worse than no remedy, and this seam owns the question, so it answers it once for both callers.
  let root
  try {
    root = mainCheckout(anyRoot)
  } catch {
    // A non-repo or bare tree has no worktrees to survey; the enumeration below reports that
    // honestly by failing loud, which is the contract. Never a guessed path.
    root = anyRoot
  }
  const building = join(root, '.building')
  const resolved = (p) => {
    const abs = resolve(root, String(p ?? ''))
    try {
      return realpathSync(abs)
    } catch {
      return abs
    }
  }

  // ── the journal index, built once: resolved worktree path → the record that names it ──
  const byDir = new Map()
  const unreadable = []
  for (const f of existsSync(building) ? readdirSync(building) : []) {
    const lane = Object.keys(LANES).find((l) => LANES[l].journalRe.test(f) || LANES[l].closedRe.test(f))
    if (!lane) continue
    const path = join(building, f)
    let text = ''
    let value
    try {
      text = readFileSync(path, 'utf8')
      value = JSON.parse(text)
    } catch {
      unreadable.push({ path, text })
      continue
    }
    // Falsiness is not the test: `[]` and `"text"` are truthy and would reach the classifier as a
    // journal with `pgid undefined` — i.e. as a DEAD run, a lifecycle invented out of a bad file.
    // A journal that PARSES but names no worktree is unreadable in the sense that matters here: it
    // cannot be attributed, so folding it into "no journal" would report `legacy` — "nothing ran" —
    // over a launcher record sitting right on disk, the exact fold the doctrine above forbids.
    if (journalDeclineReason(value) || !value.worktree) {
      unreadable.push({ path, text })
      continue
    }
    const closed = LANES[lane].closedRe.test(f)
    const key = resolved(value.worktree)
    const prior = byDir.get(key)
    // A LIVE journal outranks an archived one for the same tree: a relaunch after a close is the
    // newer truth, and reporting `closed` there would tell an operator the lane is finished.
    if (closed && prior) continue
    if (!closed && prior?.closed === false) {
      // TWO live journals naming one tree — a dir reused across lanes (`codex run <N> --worktree
      // <a former plan lane>`). Recency decides, never readdir order: the loser's class would send
      // the operator to another lane's done-moment, which can only refuse. A journal with no
      // parseable startedAt loses to one that has it, and ties keep the incumbent.
      const mine = Date.parse(value.startedAt ?? '')
      const theirs = Date.parse(prior.journal.startedAt ?? '')
      if (!(Number.isFinite(mine) && (!Number.isFinite(theirs) || mine > theirs))) continue
    }
    byDir.set(key, { path, journal: value, lane, closed })
  }

  const lanes = listWorktrees(root).filter(({ dir }) => !samePath(dir, root) && !isSlotDir(root, dir))
  // An unreadable journal naming NO surveyed tree could still be any of theirs, so it downgrades
  // every unmatched lane to `unknown` rather than letting one read as `legacy` — a truncated
  // journal cut BEFORE its worktree field is exactly the file that cannot name itself.
  const blind = unreadable.filter((u) => !lanes.some((l) => u.text.includes(basename(l.dir))))

  return lanes.map(({ dir, branch }) => {
    const hit = byDir.get(resolved(dir))
    const ids = (hit?.journal?.phases ?? []).map(String)
    const idList = ids.join(' ')
    const flag = hit ? LANES[hit.lane].flag : null
    const laneFlag = flag ? ` ${flag}` : ''
    const live = Boolean(hit && !hit.closed && hit.journal.pgid && groupAlive(hit.journal.pgid))
    // The journal-less classification, computed BEFORE the prunable arm below: a vanished directory
    // changes what can be DONE about a lane, never what is KNOWN about it, and folding an
    // unreadable journal into `legacy` there would report "nothing ran" over a record on disk —
    // exactly the fold this module's doctrine forbids.
    const named = hit ? null : unreadable.find((u) => u.text.includes(basename(dir))) ?? null
    const blindClass = hit ? null : named || blind.length > 0 ? 'unknown' : 'legacy'
    // A PRUNABLE entry: git still lists the worktree, the directory is gone (a swept /tmp, a hand
    // rm). Every command below that addresses `dir` exits 128 there, so the remedy would be a
    // paste that only errors — the class this survey exists to replace. What is actually left is
    // the REGISTRATION, and one prune clears it; the branch then stands alone, and if the lane
    // never landed, its commits are the only copy, so the row says to look before deleting it.
    // Asked AFTER liveness, because a lane whose group still runs is never handed a prune.
    if (!live && !existsSync(dir)) {
      const prune = `git -C ${root} worktree prune`
      return {
        dir,
        branch,
        class: hit ? (hit.closed ? 'closed' : `stale-${hit.lane}`) : blindClass,
        journalPath: hit?.path ?? named?.path ?? null,
        remedy: branch
          ? `(1) ${prune} — the directory is already gone; only its registration remains; (2) its branch ${branch} then stands alone: git -C ${root} log --oneline ${branch}, and delete it with git -C ${root} branch -D ${branch} only once you are sure it is carried elsewhere`
          : `${prune} — the directory is already gone and the lane was detached; only its registration remains`,
      }
    }
    const removeCmd = `git -C ${root} worktree remove --force ${dir}`
      + (branch ? ` && git -C ${root} branch -D ${branch}` : '')
      + ` && git -C ${root} worktree prune`
    if (!hit) {
      if (blindClass === 'legacy') {
        return {
          dir,
          branch,
          class: 'legacy',
          journalPath: null,
          // No journal means no phase ids: the DIRECTORY is the only handle an operator has. TWO
          // numbered steps, not one command with the second half hidden behind a `#` — audit
          // renders this verbatim, and a shell-commented remedy pastes as a no-op.
          remedy: `(1) git -C ${dir} log --oneline -5 — inspect what it holds; (2) only if it is spent: ${removeCmd}`,
        }
      }
      return {
        dir,
        branch,
        class: 'unknown',
        journalPath: named?.path ?? null,
        remedy: named
          ? `(1) cat ${named.path} — a journal that will not parse; (2) fix or delete it if that run is gone, then re-run: roadmap audit`
          : `(1) ls ${building} — a journal there will not parse and names no tree; (2) fix or delete it, then re-run: roadmap audit`,
      }
    }
    if (hit.closed) {
      // Its work landed and its journal is archived; the tree is the only thing left, and no sweep
      // verb is allowed to come back for it (the operator ruling), so the remedy IS the hand-run.
      return { dir, branch, class: 'closed', journalPath: hit.path, remedy: removeCmd }
    }
    if (live) {
      // A lane in flight is never actionable: handing an operator a removal or a landing verb for
      // a run still writing into that tree is the data loss the rail exists to prevent. Observe it.
      return {
        dir,
        branch,
        class: 'live',
        journalPath: hit.path,
        remedy: idList ? `roadmap codex status ${idList}${laneFlag}` : `tail -f ${hit.journal.log ?? hit.path}`,
      }
    }
    return {
      dir,
      branch,
      class: `stale-${hit.lane}`,
      journalPath: hit.path,
      // Each lane's OWN done-moment, named verbatim: the run lane LANDS (a remedy that merely
      // removed the tree would throw the phase away), while the plan and review lanes make no
      // commits the integration branch wants — their close is consuming the hand-off on a status
      // read, so `phase land` there would only refuse.
      //
      // ONE land per lane, even for an arc lane covering several ids: landPhase moves the whole
      // scratch head (the phase number never scopes the commits) and then disposes the worktree,
      // so a chained second land would run from a deleted cwd — a remedy that cannot finish.
      //
      // And the consume-close both read-only lanes are sent to is gated on the COMPLETE verdict,
      // while `stale-` says only that the process group is gone. A lane that died without writing
      // its sentinel would get a command that prints its journal and changes nothing, reported
      // MEDIUM forever — so the remedy names the hand-finish for that case in the same breath.
      remedy: hit.lane === 'run'
        ? `cd ${dir} && roadmap phase land ${ids[0] ?? '<N>'}`
          + (ids.length > 1 ? `  (one land moves the whole lane head, covering ${idList})` : '')
        : `roadmap codex status ${idList || '<N>'}${laneFlag} — if the lane reported COMPLETE that read closes it; if it died without a sentinel there is no harvest proof, `
          + `so READ it first (git -C ${dir} log --oneline -5${branch ? `, git -C ${root} log --oneline ${branch}` : ''}) and only then: ${removeCmd}`,
    }
  })
}

/** A 'failed' refusal is usually a broken REF, and refs are shared across every worktree of the
 *  repo — so one dangling entry refuses every lane in the consumer at once, and landing is a
 *  one-shot done-moment with no sweep verb allowed to come back for them. The remedy has to
 *  travel with the refusal or the worktrees quietly accumulate. */
const RECOVERY =
  '\n  Refs are shared repo-wide, so this refuses EVERY lane until it is fixed: find the bad ref '
  + '(`git for-each-ref --format="%(refname) %(objectname)" | while read r o; do git cat-file -e "$o" 2>/dev/null || echo "$r"; done`), '
  + 'delete it, and land again. To dispose this one worktree by hand: `git worktree remove <dir>` from the primary checkout.'

/**
 * Delete a lane branch iff it is fully merged into `integrationRef`, reporting honestly.
 *
 * The already-gone arm's half of the branch question. Merged-ness is measured against
 * integrationRef rather than HEAD for the same reason the normal path measures it there (a parked
 * primary would refuse to delete a branch fully merged into develop), and a merged branch that
 * will NOT delete — a held ref lock, another worktree still holding it — is NAMED rather than
 * swallowed into a bare `false`, because the caller prints "disposed the lane" over this.
 *
 * It sits beside disposeWorktree rather than inside it because the normal path's copy of this
 * decision is byte-frozen by task 14.1's acceptance criteria (it must ask `merged` BEFORE the
 * removal, where this arm has no removal to order against) — so this is the second CALLER of one
 * rule, deliberately not a refactor of the first.
 *
 * @param {(root: string, args: string[]) => {ok: boolean, out: string}} quiet  the caller's
 *        repoRoot-anchored git runner (stderr piped — a refusal that did not happen is not output).
 * @returns {{ branchDeleted: boolean, detail: string|null }}
 */
function deleteIfMerged(quiet, repoRoot, dir, branch, integrationRef) {
  if (!branch) return { branchDeleted: false, detail: null }
  if (!quiet(repoRoot, ['merge-base', '--is-ancestor', branch, integrationRef]).ok) {
    return { branchDeleted: false, detail: null }
  }
  const del = quiet(repoRoot, ['branch', '-D', branch])
  return {
    branchDeleted: del.ok,
    detail: del.ok ? null : `${dir} was already gone, but its merged branch ${branch} could NOT be deleted — ${del.out}`,
  }
}

/**
 * The disposal rail: ONE home for "this worktree has reached its done-moment, take it away".
 *
 * Refusal-first by construction. Removing a worktree can destroy exactly two things — the
 * uncommitted tree, and commits no surviving ref reaches — so those are the two checks, plus
 * a liveness check because a lane still running is not done at all. Each refusal KEEPS the
 * worktree and NAMES its reason; refusal is never an error, because the caller's own act
 * (a land, a status read) already succeeded and disposal reports honestly beside it.
 *
 * ANCHORING (the landing.mjs METERTENANT rule): every git act that must outlive the removal —
 * the remove itself, the branch delete, the prune — runs with BOTH `-C repoRoot` and an
 * explicit spawn cwd of repoRoot. Callers routinely dispose the worktree they are standing
 * in (`roadmap phase land` runs inside the codex worktree), and a spawn inheriting a deleted
 * cwd fails ENOENT before git ever parses argv. Only the pre-removal INSPECTION addresses
 * `dir`, because `dir` is the tree being judged.
 *
 * `unpushed` asks whether anything OTHER than this lane carries the lane's commits — a remote,
 * another branch, a tag. The lane's own branch does not count: it is the handle being closed
 * on, and a branch left behind on a box whose /tmp gets swept is not a backup. So a lane that
 * was pushed disposes (tree gone, branch kept when it is not merged), and one committed
 * nowhere else refuses, naming the subjects.
 *
 * Merged-ness is a SEPARATE question, measured against `integrationRef` rather than against
 * the primary's HEAD (`git branch -d` measures against HEAD, so a parked primary would refuse
 * to delete a branch that is fully merged into develop), and it decides only the branch delete.
 *
 * @param {string} repoRoot   the PRIMARY checkout; the anchor for every act.
 * @param {string} dir        the worktree directory to dispose.
 * @param {object} [opts]
 * @param {string|null} [opts.branch]          lane branch, deleted ONLY when fully merged into
 *                                             integrationRef. null = a --detach lane.
 * @param {string} [opts.integrationRef]       the merged-into ref for that delete.
 * @param {string[]} [opts.allowUntracked]     basenames of lane artifacts that never block —
 *                                             the run lane's CODEX-REPORT.md is never committed
 *                                             by contract, so without this every codex-lane
 *                                             disposal would refuse on its own hand-off file.
 * @param {boolean} [opts.untrackedTolerant]   read-only lane mode: ALL untracked files pass;
 *                                             a MODIFIED TRACKED file still refuses.
 * @param {number|null} [opts.pgid]            a lane journal's process group; a live one refuses.
 * @returns {{ disposed: boolean, alreadyDisposed: boolean, reason: 'dirty'|'unpushed'|'live'|'failed'|null,
 *             detail: string|null, branchDeleted: boolean }}
 */
export function disposeWorktree(
  repoRoot,
  dir,
  { branch = null, integrationRef = 'develop', allowUntracked = [], untrackedTolerant = false, pgid = null, ownedCleanup = null } = {},
) {
  if (ownedCleanup) {
    const { item, plan, receipt, deps } = ownedCleanup
    return withRegistryLock(repoRoot, () => {
      const held = reason => ({ disposed: false, alreadyDisposed: false, reason, detail: reason, branchDeleted: false })
      try {
        validateCleanupPlan(repoRoot, plan, readRegistry(repoRoot).cleanup?.[item.identity.ownershipId]?.operation)
        if (dir !== item.worktree || !plan.items.some(candidate => isDeepStrictEqual(candidate, item))) return held('ownership-uncertain')
        const { row } = currentCleanup(repoRoot, item, plan)
        if (row.receipt?.state !== 'removing' || !isDeepStrictEqual(row.receipt, receipt)) return held('evidence-changed')
        const missing = !existsSync(dir)
        const fresh = cleanupLocalEvidence(repoRoot, item.identity, plan.policy, deps, { missing, expectedHead: item.evidence.head })
        if (fresh.classification !== 'eligible') return held(fresh.classification)
        const expected = Object.fromEntries(Object.entries(item.evidence).filter(([key]) => !['protection', 'evidenceDigest'].includes(key)))
        if (!isDeepStrictEqual(fresh.evidence, expected) || fresh.journalPath !== item.journalPath) return held('evidence-changed')
        if (!missing || listWorktrees(repoRoot).some(row => resolve(row.dir) === dir)) {
          const removed = cleanupGit(repoRoot, repoRoot, ['worktree', 'remove', dir], deps)
          if (!removed.ok) return held('dirty')
        }
        let branchDeleted = false, detail = null
        if (plan.policy.deleteIntegratedBranches && item.identity.branch) {
          const current = cleanupGit(repoRoot, repoRoot, ['rev-parse', '--verify', '--end-of-options', item.identity.branch], deps)
          if (current.ok) {
            const removed = cleanupGit(repoRoot, repoRoot, ['update-ref', '-d', item.identity.branch, item.evidence.head], deps)
            branchDeleted = removed.ok
            if (!removed.ok) detail = 'integrated branch changed or its deletion was refused'
          }
        }
        // No forced removal and no repository-wide prune in the owned path.
        return { disposed: true, alreadyDisposed: missing, reason: null, detail, branchDeleted }
      } catch (error) { return held('evidence-unavailable') }
    })
  }
  // UNTRIMMED on purpose: `git status --porcelain` puts the staged/unstaged codes in columns
  // 1-2, so a trim eats the leading space of the FIRST line and a slice(3) parse then names a
  // file that does not exist (`rc/seed.txt` for `src/seed.txt`). Scalars trim at their own site.
  const quiet = (root, args) => {
    try {
      // stderr PIPED, not inherited: execFileSync leaks a failing git's stderr to the parent by
      // default, so the plain `worktree remove` probe below printed a real-looking
      // `fatal: … contains modified or untracked files` on every SUCCESSFUL codex-lane disposal
      // (measured end-to-end). A refusal that did not happen is not a debugging
      // interface — the text belongs in the returned `out`, which every caller already reads.
      return { ok: true, out: execFileSync('git', ['-C', root, ...args], { cwd: repoRoot, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    } catch (e) {
      return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message }
    }
  }
  const refuse = (reason, detail) => ({ disposed: false, alreadyDisposed: false, reason, detail, branchDeleted: false })

  if (!existsSync(dir)) {
    // The prune ride-along: /tmp died, or a sibling already removed the tree — the REPO
    // METADATA is still ours to clear. It runs FIRST because a branch is still "checked out"
    // by the stale worktree entry until the prune drops it, and `branch -D` refuses on that.
    quiet(repoRoot, ['worktree', 'prune'])
    // The tree beating us here is not amnesty for the REF. The two things disposal can destroy
    // both live in the tree, so a missing tree removes every reason to refuse — while the merged
    // branch is exactly as strandable as on the normal path, and no sweep verb comes back for it
    // (the leak this arm used to leave: `arc land` over a hand-removed lane archived the journal
    // and kept codex/<ids> forever). Same question, same answer as below: merged into
    // integrationRef → delete and report; unmerged → it stays, because the branch is then the
    // only named handle on that work.
    return { disposed: true, alreadyDisposed: true, reason: null, ...deleteIfMerged(quiet, repoRoot, dir, branch, integrationRef) }
  }

  // Liveness first: a running lane's tree is in flux, so every later read would race it.
  if (pgid && groupAlive(pgid)) {
    return refuse('live', `a lane process group (pgid ${pgid}) is still running in ${dir} — in-flight work is never disposed`)
  }

  const status = quiet(dir, ['status', '--porcelain', '-uall'])
  if (!status.ok) return refuse('dirty', `cannot read the worktree state of ${dir} — ${status.out}`)
  const allowed = new Set(allowUntracked)
  const blocking = []
  for (const line of status.out.split('\n').filter(Boolean)) {
    const code = line.slice(0, 2)
    const path = line.slice(3).trim().replace(/^"|"$/g, '')
    if (code !== '??') {
      blocking.push(`${code.trim()} ${path} (modified TRACKED file)`)
      continue
    }
    // The audit protocol's own exception: .building/ is lane bookkeeping, never work.
    if (path === '.building/' || path.startsWith('.building/')) continue
    if (allowed.has(path) || allowed.has(path.split('/').pop())) continue
    if (untrackedTolerant) continue
    blocking.push(`?? ${path} (untracked, not a named lane artifact)`)
  }
  if (blocking.length > 0) {
    return refuse('dirty', `${dir} still carries uncommitted work — refusing to remove it:\n  ${blocking.join('\n  ')}`)
  }

  // Asked BEFORE the removal, because after it the branch is still there but the worktree that
  // gave the question its context is not. Anchored on integrationRef, never on HEAD.
  const merged = branch ? quiet(repoRoot, ['merge-base', '--is-ancestor', branch, integrationRef]).ok : false

  // FAIL CLOSED. A reachability question git could not ANSWER is not the answer "nothing is
  // orphaned": one dangling ref under refs/remotes (a partial fetch, a pruned remote whose ref
  // file survived) makes `rev-list --remotes` exit 128, and a rail that read that as a pass would
  // remove a worktree on the strength of an answer it never got — for a detached lane, leaving
  // its commits in the reflog alone.
  const head = quiet(dir, ['rev-parse', 'HEAD'])
  if (!head.ok) {
    return refuse('failed', `cannot resolve HEAD in ${dir}, so its commits cannot be shown to be carried elsewhere — ${head.out}${RECOVERY}`)
  }
  {
    const headSha = head.out.trim()
    // The lane's OWN branch is never a survivor: it is the handle this disposal is closing on,
    // so the question is whether anything ELSE — a remote, another branch, a tag — carries the
    // work. Pushed-but-unmerged therefore disposes (the branch stays, the tree goes); committed
    // nowhere else refuses. SHORT form, and it binds to the NEXT ref-set only (--branches):
    // a refs/heads/-prefixed pattern silently matches NOTHING here — the same trap
    // reclaimable() above documents, and it would read every orphaning disposal as safe.
    const excl = branch ? ['--exclude', branch] : []
    const survivors = ['--not', ...excl, '--branches', '--remotes', '--tags']
    const orphan = quiet(dir, ['rev-list', '--count', headSha, ...survivors])
    if (!orphan.ok) {
      return refuse('failed', `cannot prove ${dir}'s commits are carried elsewhere — ${orphan.out}${RECOVERY}`)
    }
    if (Number(orphan.out.trim()) > 0) {
      const subjects = quiet(dir, ['log', '--format=%h %s', '-n', '10', headSha, ...survivors])
      const named = (subjects.ok ? subjects.out : headSha).trim().split('\n').join('\n  ')
      return refuse(
        'unpushed',
        `${dir} holds ${orphan.out.trim()} commit(s) that no remote and no other branch carries — removing it `
          + `would leave ${branch ?? 'this detached head'} as their only copy; push (or land) them first:\n  ${named}`,
      )
    }
  }

  // --force is the FALLBACK, never the first move: the plain remove refuses on any untracked
  // file, including the named lane artifacts the dirt check above deliberately allowed, so the
  // force only ever runs on a tree this function has already proven carries nothing but them.
  const removed = quiet(repoRoot, ['worktree', 'remove', dir])
  if (!removed.ok) {
    // The FORCE result is what gets reported. The probe above fails on any untracked file, so on
    // a codex lane its message is always "contains modified or untracked files" whatever actually
    // went wrong — reporting it would hand every real failure the same red herring.
    const forced = quiet(repoRoot, ['worktree', 'remove', '--force', dir])
    if (!forced.ok) {
      return refuse(
        'failed',
        `git worktree remove ${dir} failed — ${forced.out}\n  The land will not come back for this worktree (landing is a one-shot done-moment, `
          + `and no sweep verb exists): fix the cause above, then finish by hand with \`git worktree remove --force ${dir}\` `
          + `run from ${repoRoot}, followed by \`git worktree prune\`.`,
      )
    }
  }

  // A merged branch that will NOT delete (checked out in another worktree, a ref lock) is a leak
  // the caller would otherwise print "disposed the lane" over. The removal already succeeded, so
  // this is not a refusal — it is the detail the pass path carries so the land report can say it.
  let branchDeleted = false
  let detail = null
  if (branch && merged) {
    const del = quiet(repoRoot, ['branch', '-D', branch])
    branchDeleted = del.ok
    if (!del.ok) detail = `${dir} was removed, but its merged branch ${branch} could NOT be deleted — ${del.out}`
  }
  quiet(repoRoot, ['worktree', 'prune'])
  return { disposed: true, alreadyDisposed: false, reason: null, detail, branchDeleted }
}

// Owned cleanup metadata lives beside the existing slots and identities. It is a
// bounded current disposition, not an event journal or a second ownership store.
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const DIGEST = /^sha256:[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const digest = journalBindingDigestOf
const freezeCleanup = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeCleanup); Object.freeze(value) }
  return value
}
const CLEANUP_CLASSES = ['eligible', 'ownership-uncertain', 'live', 'dirty', 'unique', 'not-integrated', 'protected', 'protection-unavailable', 'evidence-unavailable', 'observation-required', 'observation-interval']
function validateCleanupMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new WorktreeError('malformed cleanup map')
  for (const [id, row] of Object.entries(map)) {
    if (!UUID.test(id) || !identityKeys(row, 'version identityDigest observations operation receipt') || row.version !== 1 || !DIGEST.test(row.identityDigest) || !Array.isArray(row.observations)) throw new WorktreeError('malformed cleanup record')
    const seen = new Set()
    for (const observation of row.observations) {
      if (!identityKeys(observation, 'version invocationId observedAt evidenceDigest identityDigest journalDigest head') || observation.version !== 1 || !UUID.test(observation.invocationId)
        || !instant(observation.observedAt) || !DIGEST.test(observation.evidenceDigest) || observation.identityDigest !== row.identityDigest || !DIGEST.test(observation.journalDigest) || !COMMIT.test(observation.head) || seen.has(observation.invocationId)) throw new WorktreeError('malformed cleanup observation')
      seen.add(observation.invocationId)
    }
    if (row.receipt !== null) {
      const r = row.receipt
      if (!identityKeys(r, 'version planDigest operationDigest ownershipId identityDigest state reason plannedAt removingAt completedAt disposal') || r.version !== 1 || r.ownershipId !== id || r.identityDigest !== row.identityDigest || !DIGEST.test(r.planDigest) || !DIGEST.test(r.operationDigest)
        || !['planned', 'removing', 'removed', 'held'].includes(r.state) || !instant(r.plannedAt) || r.removingAt !== null && !instant(r.removingAt) || r.completedAt !== null && !instant(r.completedAt)
        || r.reason !== null && typeof r.reason !== 'string' || r.state === 'planned' && (r.removingAt !== null || r.completedAt !== null || r.disposal !== null)
        || r.state === 'removing' && (r.removingAt === null || r.completedAt !== null || r.disposal !== null)
        || ['removed', 'held'].includes(r.state) && r.completedAt === null || r.state === 'removed' && (r.removingAt === null || !r.disposal?.disposed)) throw new WorktreeError('malformed cleanup receipt')
    }
  }
}
function cleanupGit(root, cwd, args, deps = {}) {
  if (deps.git) return deps.git(cwd, args)
  try { return { ok: true, status: 0, out: execFileSync('git', ['-C', cwd, ...args], { cwd: root, timeout: 60_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (error) { return { ok: false, status: error.status ?? null, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || error.message } }
}
function cleanupJournal(root, worktree) {
  if (!registryDirectory(root)) throw new WorktreeError('journal owner directory is absent')
  const matches = []
  for (const name of readdirSync(join(root, '.building'))) {
    if (!Object.values(LANES).some(lane => lane.journalRe.test(name) || lane.closedRe.test(name))) continue
    const path = join(root, '.building', name)
    if (!lstatSync(path).isFile()) throw new WorktreeError('non-regular lane journal')
    let fd, bytes, journal
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); bytes = readFileSync(fd); journal = JSON.parse(bytes) }
    catch { throw new WorktreeError('unreadable lane journal') }
    finally { if (fd !== undefined) closeSync(fd) }
    if (typeof journal?.worktree !== 'string' || resolve(root, journal.worktree) !== worktree) continue
    if (journalDeclineReason(journal) || journal.ownerRoot !== root) throw new WorktreeError('journal owner binding differs')
    matches.push({ path, journal, journalDigest: journalBytesDigestOf(bytes), closed: Object.values(LANES).some(lane => lane.closedRe.test(name)) })
  }
  const open = matches.filter(row => !row.closed), selected = open.length ? open : matches
  if (selected.length !== 1) throw new WorktreeError('absent or ambiguous lane journal')
  return selected[0]
}
function cleanupLiveness(pgid, deps = {}) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1) return 'unknown'
  if (deps.isAlive) { const answer = deps.isAlive(pgid); return answer === true ? 'live' : answer === false ? 'inactive' : 'unknown' }
  try { process.kill(-pgid, 0); return 'live' }
  catch (error) { return error.code === 'ESRCH' ? 'inactive' : 'unknown' }
}

/** Configured refs cannot be weakened by a provider; unknown provider state holds. */
export async function probeWorktreeProtection(request, deps = {}) {
  const unavailable = reason => ({ state: 'unavailable', evidence: [], reason })
  for (const ref of request.configuredRefs ?? []) {
    const target = cleanupGit(request.repository, request.repository, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], deps)
    if (!target.ok) return unavailable('configured ref cannot be resolved')
    const reachable = cleanupGit(request.repository, request.repository, ['merge-base', '--is-ancestor', request.head, target.out.trim()], deps)
    if (!reachable.ok && reachable.status !== 1) return unavailable('configured ref ancestry is unavailable')
    if (reachable.ok) return { state: 'protected', evidence: [{ kind: 'configured-ref', id: ref, head: target.out.trim() }], reason: 'configured ref protects lane history' }
  }
  if (!deps.probeProtection) return unavailable('provider protection is unavailable')
  try {
    const result = await deps.probeProtection(freezeCleanup(structuredClone(request)))
    if (!identityKeys(result, 'state evidence reason') || !['protected', 'unprotected', 'unavailable'].includes(result.state) || !Array.isArray(result.evidence) || result.reason !== null && typeof result.reason !== 'string'
      || result.evidence.some(row => !row || !['configured-ref', 'provider-pr'].includes(row.kind) || typeof row.id !== 'string' || row.head !== undefined && !COMMIT.test(row.head))) return unavailable('provider protection response is malformed')
    return structuredClone(result)
  } catch { return unavailable('provider protection is unavailable') }
}
function cleanupLocalEvidence(root, identity, policy, deps = {}, { missing = false, expectedHead } = {}) {
  const hold = classification => ({ classification, reason: classification })
  let joined
  try {
    if (!identity || identity.repository !== realpathSync(mainCheckout(root)) || identity.worktree === root || identity.worktree === identity.repository || isSlotDir(identity.repository, identity.worktree) || isSlotDir(root, identity.worktree)) return hold('ownership-uncertain')
    const registry = readRegistry(root), matches = registry.identities.filter(row => row.ownershipId === identity.ownershipId)
    if (matches.length !== 1 || !isDeepStrictEqual(matches[0], identity)) return hold('ownership-uncertain')
    joined = cleanupJournal(root, identity.worktree)
    if (!isDeepStrictEqual(joined.journal.worktreeIdentity, identity)) return hold('ownership-uncertain')
    if (!missing && resolveWorktreeOwnership(root, joined.journal).state !== 'owned') return hold('ownership-uncertain')
  } catch { return hold('ownership-uncertain') }
  const live = cleanupLiveness(joined.journal.pgid, deps)
  if (live !== 'inactive') return hold(live === 'live' ? 'live' : 'evidence-unavailable')
  const run = args => cleanupGit(root, missing ? root : identity.worktree, args, deps)
  const head = missing ? { ok: COMMIT.test(expectedHead), out: expectedHead } : run(['rev-parse', '--verify', 'HEAD^{commit}'])
  if (!head.ok || !COMMIT.test(head.out.trim())) return hold('evidence-unavailable')
  if (!missing) {
    const status = run(['status', '--porcelain', '-uall'])
    if (!status.ok) return hold('evidence-unavailable')
    if (status.out.trim()) return hold('dirty')
  }
  const branch = identity.branch
  const survivors = ['--not', ...(branch ? ['--exclude', branch.slice('refs/heads/'.length)] : []), '--branches', '--remotes', '--tags']
  const count = run(['rev-list', '--count', head.out.trim(), ...survivors])
  if (!count.ok || !/^\d+$/.test(count.out.trim())) return hold('evidence-unavailable')
  if (Number(count.out.trim()) !== 0) return hold('unique')
  const integration = cleanupGit(root, root, ['rev-parse', '--verify', '--end-of-options', `${policy.integrationRef}^{commit}`], deps)
  if (!integration.ok) return hold('evidence-unavailable')
  const ancestry = cleanupGit(root, root, ['merge-base', '--is-ancestor', head.out.trim(), integration.out.trim()], deps)
  if (!ancestry.ok) return hold(ancestry.status === 1 ? 'not-integrated' : 'evidence-unavailable')
  return { classification: 'eligible', reason: null, journalPath: joined.path, journalDigest: joined.journalDigest,
    evidence: { identityDigest: digest(identity), journalDigest: joined.journalDigest, head: head.out.trim(), branch,
      integrationRef: policy.integrationRef, integrationTip: integration.out.trim(), liveness: 'inactive', clean: true, recoverable: true }, journal: joined.journal }
}
async function cleanupEvidence(root, identity, policy, deps, options) {
  const local = cleanupLocalEvidence(root, identity, policy, deps, options)
  if (local.classification !== 'eligible') return local
  const protection = await probeWorktreeProtection({ repository: identity.repository, identity, journal: local.journal,
    head: local.evidence.head, branch: identity.branch, configuredRefs: policy.configuredProtectionRefs }, deps)
  if (protection.state !== 'unprotected') return { ...local, classification: protection.state === 'protected' ? 'protected' : 'protection-unavailable', reason: protection.state === 'protected' ? 'protected' : 'protection-unavailable' }
  const evidence = { ...local.evidence, protection }
  return { ...local, evidence: { ...evidence, evidenceDigest: digest(evidence) } }
}
function validateCleanupPolicy(policy) {
  if (!identityKeys(policy, 'inactiveObservations inactiveIntervalMs integrationRef configuredProtectionRefs deleteIntegratedBranches') || !Number.isSafeInteger(policy.inactiveObservations) || policy.inactiveObservations < 2
    || !Number.isSafeInteger(policy.inactiveIntervalMs) || policy.inactiveIntervalMs <= 0 || typeof policy.integrationRef !== 'string' || !policy.integrationRef || policy.integrationRef.startsWith('-')
    || !Array.isArray(policy.configuredProtectionRefs) || policy.configuredProtectionRefs.some(ref => typeof ref !== 'string' || !ref.startsWith('refs/')) || typeof policy.deleteIntegratedBranches !== 'boolean') throw new WorktreeError('invalid worktree cleanup policy')
}

/** Planning persists only inactivity observations, never removal authorization. */
export async function planWorktreeCleanup(root, options = {}, deps = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['invocationId', 'observedAt', 'inactiveObservations', 'inactiveIntervalMs', 'integrationRef', 'configuredProtectionRefs', 'deleteIntegratedBranches', 'ownershipIds'].includes(key))) throw new WorktreeError('unknown cleanup option')
  root = realpathSync(root)
  const invocationId = options.invocationId ?? randomUUID(), observedAt = options.observedAt ?? new Date(deps.now ? deps.now() : Date.now()).toISOString()
  if (!UUID.test(invocationId) || !instant(observedAt)) throw new WorktreeError('invalid cleanup invocation identity or timestamp')
  const policy = { inactiveObservations: options.inactiveObservations ?? 2, inactiveIntervalMs: options.inactiveIntervalMs,
    integrationRef: options.integrationRef ?? 'develop', configuredProtectionRefs: options.configuredProtectionRefs ?? [], deleteIntegratedBranches: options.deleteIntegratedBranches ?? false }
  validateCleanupPolicy(policy)
  const registry = readRegistry(root), repository = realpathSync(mainCheckout(root))
  const selected = options.ownershipIds
  validateCleanupSelection(selected, registry.identities.map(row => row.ownershipId))
  const dirs = [...new Set([...listWorktrees(root).map(row => resolve(row.dir)), ...registry.identities.map(row => row.worktree)])].filter(dir => dir !== root && dir !== repository && (selected === undefined || registry.identities.some(row => row.worktree === dir && selected.includes(row.ownershipId)))).sort()
  const items = []
  for (const worktree of dirs) {
    const identity = registry.identities.find(row => row.worktree === worktree) ?? null
    const found = await cleanupEvidence(root, identity, policy, deps)
    const item = { worktree, identity, journalPath: found.journalPath ?? null, journalDigest: found.journalDigest ?? null, evidence: found.evidence ?? null,
      observations: [], classification: found.classification, reason: found.reason }
    if (identity) try { withRegistryLock(root, () => {
      const current = readRegistry(root)
      if (!current.identities.some(row => isDeepStrictEqual(row, identity))) { item.classification = item.reason = 'ownership-uncertain'; return }
      current.cleanup ??= {}
      const old = current.cleanup[identity.ownershipId]
      if (old !== undefined) validateCleanupMap({ [identity.ownershipId]: old })
      if (old && old.identityDigest !== digest(identity)) throw new WorktreeError('cleanup identity binding changed')
      if (old?.receipt && ['planned', 'removing', 'removed'].includes(old.receipt.state)) { item.classification = item.reason = 'ownership-uncertain'; return }
      const row = old ?? { version: 1, identityDigest: digest(identity), observations: [], operation: null, receipt: null }
      if (found.classification === 'eligible') {
        const boundary = cleanupLocalEvidence(root, identity, policy, deps)
        const expected = Object.fromEntries(Object.entries(found.evidence).filter(([key]) => !['protection', 'evidenceDigest'].includes(key)))
        if (boundary.classification !== 'eligible' || !isDeepStrictEqual(boundary.evidence, expected) || boundary.journalPath !== found.journalPath) {
          row.observations = []; current.cleanup[identity.ownershipId] = row; writeRegistry(root, current)
          item.classification = item.reason = boundary.classification === 'eligible' ? 'evidence-unavailable' : boundary.classification
          return
        }
      }

      if (found.classification !== 'eligible') row.observations = []
      else {
        const observation = { version: 1, invocationId, observedAt, evidenceDigest: found.evidence.evidenceDigest, identityDigest: digest(identity), journalDigest: found.journalDigest, head: found.evidence.head }
        if (row.observations.some(prior => prior.evidenceDigest !== observation.evidenceDigest)) row.observations = []
        const previous = row.observations.at(-1)
        if (!row.observations.some(prior => prior.invocationId === invocationId) && (!previous || Date.parse(observedAt) - Date.parse(previous.observedAt) >= policy.inactiveIntervalMs)) row.observations = [...row.observations, observation].slice(-policy.inactiveObservations)
        item.observations = structuredClone(row.observations)
        if (row.observations.length < policy.inactiveObservations) item.classification = item.reason = previous && Date.parse(observedAt) - Date.parse(previous.observedAt) < policy.inactiveIntervalMs ? 'observation-interval' : 'observation-required'
      }
      current.cleanup[identity.ownershipId] = row; writeRegistry(root, current)
    }) } catch { item.classification = item.reason = 'evidence-unavailable'; item.observations = [] }
    items.push(item)
  }
  const plan = { version: 1, ownerRoot: root, repository, invocationId, observedAt, policy, items }
  return freezeCleanup({ ...plan, planDigest: digest(plan) })
}

function validateCleanupPlan(root, plan, operation = null) {
  if (!identityKeys(plan, 'version ownerRoot repository invocationId observedAt policy items planDigest') || plan.version !== 1 || plan.ownerRoot !== root || plan.repository !== realpathSync(mainCheckout(root))
    || !UUID.test(plan.invocationId) || !instant(plan.observedAt) || !Array.isArray(plan.items)) throw new WorktreeError('malformed or foreign cleanup plan')
  const { planDigest, ...body } = plan
  if (!DIGEST.test(planDigest) || digest(body) !== planDigest) {
    if (!operation) throw new WorktreeError('cleanup plan digest differs')
    validateCleanupOperation(root, operation)
    if (planDigest !== operation.planDigest || plan.items.length !== 1 || !isDeepStrictEqual(plan.items[0], operation.item) || !isDeepStrictEqual(plan.policy, operation.policy)) throw new WorktreeError('recovered operation scope differs')
  }
  validateCleanupPolicy(plan.policy)
  const seen = new Set()
  for (const item of plan.items) {
    if (!identityKeys(item, 'worktree identity journalPath journalDigest evidence observations classification reason') || !absoluteCanonical(item.worktree) || seen.has(item.worktree)
      || !CLEANUP_CLASSES.includes(item.classification) || !Array.isArray(item.observations) || item.identity !== null && worktreeIdentityDeclineReason(item.identity)) throw new WorktreeError('malformed cleanup item')
    seen.add(item.worktree)
    if (item.classification !== 'eligible') continue
    if (!item.identity || item.identity.worktree !== item.worktree || !item.evidence || item.observations.length !== plan.policy.inactiveObservations) throw new WorktreeError('eligible cleanup item lacks evidence')
    const { evidenceDigest, ...evidence } = item.evidence
    if (digest(evidence) !== evidenceDigest || evidence.identityDigest !== digest(item.identity) || evidence.journalDigest !== item.journalDigest || !COMMIT.test(evidence.head) || evidence.protection?.state !== 'unprotected') throw new WorktreeError('cleanup evidence binding differs')
    validateCleanupMap({ [item.identity.ownershipId]: { version: 1, identityDigest: digest(item.identity), observations: item.observations, operation: null, receipt: null } })
    for (let i = 0; i < item.observations.length; i++) {
      const row = item.observations[i]
      if (row.evidenceDigest !== evidenceDigest || row.head !== evidence.head || row.journalDigest !== item.journalDigest
        || i && Date.parse(row.observedAt) - Date.parse(item.observations[i - 1].observedAt) < plan.policy.inactiveIntervalMs) throw new WorktreeError('inactivity observations do not qualify')
    }
  }
}
function operationFor(root, item, plan) {
  const operation = { version: 1, planDigest: plan.planDigest, ownerRoot: root, repository: plan.repository, policy: plan.policy, item }
  return { ...operation, operationDigest: digest(operation) }
}
function validateCleanupOperation(root, operation) {
  if (!identityKeys(operation, 'version planDigest ownerRoot repository policy item operationDigest') || operation.version !== 1 || operation.ownerRoot !== root || operation.repository !== realpathSync(mainCheckout(root)) || !DIGEST.test(operation.planDigest)) throw new WorktreeError('malformed or foreign cleanup operation')
  const { operationDigest, ...body } = operation
  if (operation.item?.classification !== 'eligible') throw new WorktreeError('stored cleanup operation is not eligible')
  if (!DIGEST.test(operationDigest) || digest(body) !== operationDigest) throw new WorktreeError('cleanup operation digest differs')
  const last = operation.item?.observations?.at(-1)
  const scope = { version: 1, ownerRoot: root, repository: operation.repository, invocationId: last?.invocationId, observedAt: last?.observedAt, policy: operation.policy, items: [operation.item] }
  validateCleanupPlan(root, { ...scope, planDigest: digest(scope) })
}
function currentCleanup(root, item, plan) {
  const registry = readRegistry(root), row = registry.cleanup?.[item.identity.ownershipId]
  validateCleanupMap({ [item.identity.ownershipId]: row })
  if (!row || row.identityDigest !== digest(item.identity)) throw new WorktreeError('cleanup record is absent or changed')
  if (row.operation !== null) {
    validateCleanupOperation(root, row.operation)
    if (row.receipt?.operationDigest !== row.operation.operationDigest || row.receipt?.planDigest !== row.operation.planDigest) throw new WorktreeError('cleanup receipt and operation disagree')
    if (row.receipt?.state !== 'held' && (row.operation.planDigest !== plan.planDigest || !isDeepStrictEqual(row.operation.item, item) || !isDeepStrictEqual(row.operation.policy, plan.policy))) throw new WorktreeError('cleanup operation differs')
  } else if (row.receipt !== null) throw new WorktreeError('cleanup receipt lacks its operation')
  if (!isDeepStrictEqual(row.observations, item.observations)) throw new WorktreeError('cleanup observations changed')
  if (row.receipt && row.receipt.planDigest !== plan.planDigest && row.receipt.state !== 'held') throw new WorktreeError('another cleanup disposition owns this identity')
  return { registry, row }
}
function updateCleanupReceipt(root, item, plan, expected, patch, { removeIdentity = false } = {}) {
  return withRegistryLock(root, () => {
    const { registry, row } = currentCleanup(root, item, plan)
    if (!isDeepStrictEqual(row.receipt, expected)) throw new WorktreeError('cleanup receipt changed concurrently')
    const receipt = { ...expected, ...patch }
    if (removeIdentity) {
      const index = registry.identities.findIndex(identity => identity.ownershipId === item.identity.ownershipId)
      if (index < 0 || !isDeepStrictEqual(registry.identities[index], item.identity)) throw new WorktreeError('cleanup identity changed before completion')
      registry.identities.splice(index, 1)
    }
    row.receipt = receipt; validateCleanupMap({ [item.identity.ownershipId]: row }); writeRegistry(root, registry)
    return structuredClone(receipt)
  })
}

/** Revalidate each item independently; only the existing disposer can remove it. */
export async function applyWorktreeCleanup(root, plan, deps = {}) {
  root = realpathSync(root); validateCleanupPlan(root, plan)
  return applyCleanupPlan(root, plan, deps)
}
async function applyCleanupPlan(root, plan, deps = {}) {
  const results = [], hooks = deps.hooks ?? {}
  const stamp = () => new Date(deps.now ? deps.now() : Date.now()).toISOString()
  for (const item of plan.items) {
    if (item.classification !== 'eligible') continue
    let receipt
    try {
      receipt = withRegistryLock(root, () => {
        const { registry, row } = currentCleanup(root, item, plan)
        if (row.receipt?.planDigest === plan.planDigest) return structuredClone(row.receipt)
        const local = cleanupLocalEvidence(root, item.identity, plan.policy, deps)
        const exact = local.classification === 'eligible' && local.journalDigest === item.journalDigest && isDeepStrictEqual(local.evidence, Object.fromEntries(Object.entries(item.evidence).filter(([key]) => !['protection', 'evidenceDigest'].includes(key))))
        const operation = operationFor(root, item, plan)
        const value = { version: 1, planDigest: plan.planDigest, operationDigest: operation.operationDigest, ownershipId: item.identity.ownershipId, identityDigest: digest(item.identity),
          state: exact ? 'planned' : 'held', reason: exact ? null : local.classification === 'eligible' ? 'evidence-changed' : local.classification,
          plannedAt: stamp(), removingAt: null, completedAt: exact ? null : stamp(), disposal: null }
        row.operation = operation; row.receipt = value; validateCleanupMap({ [item.identity.ownershipId]: row }); writeRegistry(root, registry); return structuredClone(value)
      })
    } catch (error) {
      results.push({ ownershipId: item.identity.ownershipId, state: 'refused', reason: 'evidence-changed', receipt: null })
      continue
    }
    if (['removed', 'held'].includes(receipt.state)) { results.push(receipt); continue }
    if (receipt.state === 'planned') await hooks.afterPlanned?.(freezeCleanup(structuredClone(item)))
    await deps.beforeBoundary?.(freezeCleanup(structuredClone(item)))
    const missing = !existsSync(item.worktree)
    let fresh = missing && receipt.state !== 'removing' ? { classification: 'ownership-uncertain' }
      : await cleanupEvidence(root, item.identity, plan.policy, deps, { missing, expectedHead: item.evidence.head })
    if (fresh.classification !== 'eligible' || !isDeepStrictEqual(fresh.evidence, item.evidence) || fresh.journalPath !== item.journalPath) {
      receipt = updateCleanupReceipt(root, item, plan, receipt, { state: 'held', reason: fresh.classification === 'eligible' ? 'evidence-changed' : fresh.classification, completedAt: stamp() })
      results.push(receipt); continue
    }
    if (receipt.state === 'planned') receipt = updateCleanupReceipt(root, item, plan, receipt, { state: 'removing', removingAt: stamp() })
    await hooks.afterRemoving?.(freezeCleanup(structuredClone(item)))
    await hooks.beforeDisposal?.(freezeCleanup(structuredClone(item)))
    // Hooks and an asynchronous provider can yield; recheck protection after them.
    fresh = await cleanupEvidence(root, item.identity, plan.policy, deps, { missing: !existsSync(item.worktree), expectedHead: item.evidence.head })
    if (fresh.classification !== 'eligible' || !isDeepStrictEqual(fresh.evidence, item.evidence)) {
      receipt = updateCleanupReceipt(root, item, plan, receipt, { state: 'held', reason: fresh.classification === 'eligible' ? 'evidence-changed' : fresh.classification, completedAt: stamp() })
      results.push(receipt); continue
    }
    let disposal = (deps.dispose ?? disposeWorktree)(root, item.worktree, { branch: item.identity.branch?.slice('refs/heads/'.length) ?? null,
      integrationRef: plan.policy.integrationRef, pgid: fresh.journal.pgid, ownedCleanup: { item, plan, receipt, deps } })
    await hooks.afterDisposal?.(freezeCleanup(structuredClone({ item, disposal })))
    if (disposal.disposed && existsSync(item.worktree)) disposal = { disposed: false, alreadyDisposed: false, reason: 'evidence-changed', detail: 'worktree is present after disposal', branchDeleted: false }
    receipt = updateCleanupReceipt(root, item, plan, receipt, { state: disposal.disposed ? 'removed' : 'held', reason: disposal.disposed ? null : disposal.reason, completedAt: stamp(), disposal }, { removeIdentity: disposal.disposed })
    await hooks.afterReceipt?.(freezeCleanup(structuredClone(receipt)))
    results.push(receipt)
  }
  return freezeCleanup({ version: 1, planDigest: plan.planDigest, items: results })
}

/** Fresh-process recovery reads only bounded operations already authorized in this registry. */
export async function resumeWorktreeCleanup(root, { ownershipIds } = {}, deps = {}) {
  root = realpathSync(root)
  if (ownershipIds !== undefined && (!Array.isArray(ownershipIds) || ownershipIds.some(id => !UUID.test(id)))) throw new WorktreeError('invalid cleanup recovery selection')
  const registry = readRegistry(root), items = []
  for (const [ownershipId, row] of Object.entries(registry.cleanup ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (ownershipIds && !ownershipIds.includes(ownershipId)) continue
    let operation
    try {
      validateCleanupMap({ [ownershipId]: row })
      if (!row.receipt || !['planned', 'removing'].includes(row.receipt.state)) continue
      operation = row.operation; validateCleanupOperation(root, operation)
      if (operation.item.identity.ownershipId !== ownershipId || operation.operationDigest !== row.receipt.operationDigest || operation.planDigest !== row.receipt.planDigest) throw new WorktreeError('recovery operation binding differs')
    } catch {
      items.push({ ownershipId, state: 'refused', reason: 'evidence-changed', receipt: null }); continue
    }
    const last = operation.item.observations.at(-1)
    const scope = { version: 1, ownerRoot: root, repository: operation.repository, invocationId: last.invocationId, observedAt: last.observedAt, policy: operation.policy, items: [operation.item], planDigest: operation.planDigest }
    const result = await applyCleanupPlan(root, scope, deps)
    items.push(...result.items)
  }
  return freezeCleanup({ version: 1, planDigest: null, items })
}

function validateCleanupSelection(ids, known) {
  if (ids === undefined) return
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !UUID.test(id) || !known.includes(id))) throw new WorktreeError('cleanup ownership selection contains unknown, duplicate or malformed IDs')
}

/** One terminal/operator invocation: recover selected operations, observe once, apply once. */
export async function runWorktreeCleanup(root, { apply = false, ownershipIds, invocationId = randomUUID(), observedAt, policy } = {}, deps = {}) {
  root = realpathSync(root)
  if (!policy || typeof policy.enabled !== 'boolean' || typeof apply !== 'boolean') throw new WorktreeError('cleanup policy and explicit apply mode are required')
  if (apply && !policy.enabled) throw new WorktreeError('worktreeGc.enabled must be true before cleanup apply')
  const { enabled, ...configured } = policy
  const scanPolicy = { inactiveObservations: configured.inactiveObservations, inactiveIntervalMs: configured.inactiveIntervalMs,
    deleteIntegratedBranches: configured.deleteIntegratedBranches, integrationRef: configured.integrationRef ?? 'develop', configuredProtectionRefs: configured.configuredProtectionRefs ?? [] }
  validateCleanupPolicy(scanPolicy)
  const initial = readRegistry(root)
  validateCleanupSelection(ownershipIds, [...initial.identities.map(row => row.ownershipId), ...Object.keys(initial.cleanup ?? {})])
  const resumed = apply ? await resumeWorktreeCleanup(root, { ownershipIds }, deps) : { version: 1, planDigest: null, items: [] }
  const registered = readRegistry(root).identities.map(row => row.ownershipId)
  const remaining = ownershipIds?.filter(id => registered.includes(id))
  const plan = await planWorktreeCleanup(root, { ...scanPolicy, ownershipIds: remaining, invocationId, ...(observedAt === undefined ? {} : { observedAt }) }, deps)
  const applied = apply ? await applyWorktreeCleanup(root, plan, deps) : null
  return freezeCleanup({ version: 1, invocationId, resumed, plan, applied })
}
