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
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { timeout: 60_000, encoding: 'utf8' }).trim()

/** A typed worktree-lane failure. */
export class WorktreeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorktreeError'
  }
}

const registryPath = (root) => join(root, '.building', 'worktree-slots.json')

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
function readSlots(root) {
  const p = registryPath(root)
  if (!existsSync(p)) return []
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  let rows
  if (Array.isArray(raw)) rows = raw
  else if (raw && Array.isArray(raw.slots)) rows = raw.slots
  else if (raw && typeof raw === 'object')
    rows = Object.entries(raw).map(([slot, v]) => (typeof v === 'object' ? { slot, ...v } : { slot, pid: v }))
  else
    throw new WorktreeError(
      `worktree registry ${p} is unreadable — expected an array of {slot, pid} rows, a {slots: […]} wrapper, or a slot-keyed map`,
    )
  return rows.map((r) => ({ ...r, slot: Number(r.slot), pid: Number(r.pid) }))
}

/** The registry rows as recorded (dead claimers included — pruning is claimSlot's job),
 *  each annotated with live-ness. THE reader for `worktree status`: a second tolerant
 *  parser forked elsewhere is exactly the double-booking hazard the loud parse guards. */
export function listSlots(root) {
  return readSlots(root).map((r) => ({ ...r, dir: `${root}-wt-${r.slot}`, live: rowLive(r) }))
}

function writeSlots(root, rows) {
  mkdirSync(join(root, '.building'), { recursive: true })
  // Write-temp-then-rename: a reader never sees a torn registry.
  const tmp = `${registryPath(root)}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n')
  renameSync(tmp, registryPath(root))
}

/** A directory-based mutex around the claim's read-modify-write: mkdir is atomic, so two
 *  simultaneous claims serialize instead of both reading the same registry and writing
 *  conflicting rows (a lost update hands two sessions one slot). Stale locks (a crashed
 *  claimer) break after LOCK_STALE_MS. */
const LOCK_STALE_MS = 10_000
function withRegistryLock(root, fn) {
  mkdirSync(join(root, '.building'), { recursive: true })
  const lock = `${registryPath(root)}.lock`
  const deadline = Date.now() + LOCK_STALE_MS
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch {
      let stale = false
      try {
        stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
      } catch {
        continue // the holder released between our attempt and the stat — retry at once
      }
      if (stale) {
        rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) throw new WorktreeError(`worktree registry lock ${lock} held past ${LOCK_STALE_MS}ms — a claimer is stuck or the lock is orphaned`)
      execFileSync('sleep', ['0.05'])
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
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

/** The path of the worktree that has baseRef CHECKED OUT, or null. */
function checkoutOf(worktreeDir, baseRef) {
  const rows = git(worktreeDir, ['worktree', 'list', '--porcelain']).split('\n\n')
  for (const row of rows) {
    if (row.includes(`branch refs/heads/${baseRef}`)) {
      const m = /^worktree (.+)$/m.exec(row)
      if (m) return m[1]
    }
  }
  return null
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
  { branch = null, integrationRef = 'develop', allowUntracked = [], untrackedTolerant = false, pgid = null } = {},
) {
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
    // METADATA is still ours to clear, and clearing it is the whole remaining job.
    quiet(repoRoot, ['worktree', 'prune'])
    return { disposed: true, alreadyDisposed: true, reason: null, detail: null, branchDeleted: false }
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
    return refuse('failed', `cannot resolve HEAD in ${dir}, so its commits cannot be shown to be carried elsewhere — ${head.out}`)
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
      return refuse('failed', `cannot prove ${dir}'s commits are carried elsewhere — ${orphan.out}`)
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
  if (!removed.ok && !quiet(repoRoot, ['worktree', 'remove', '--force', dir]).ok) {
    return refuse('failed', `git worktree remove ${dir} failed — ${removed.out}`)
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
