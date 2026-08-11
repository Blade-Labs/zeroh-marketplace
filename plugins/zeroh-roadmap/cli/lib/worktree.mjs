/**
 * worktree — the session worktree lane (phase 2146): each session claims ONE persistent
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

function writeSlots(root, rows) {
  mkdirSync(join(root, '.building'), { recursive: true })
  writeFileSync(registryPath(root), JSON.stringify(rows, null, 2) + '\n')
}

/**
 * Claim the lowest free slot for this pid. Idempotent per pid (a re-claim returns the
 * SAME slot); dead claimers' rows are dropped so their slots free up. Returns
 * { slot, dir } — dir is `${root}-wt-${slot}`, not created here.
 */
export function claimSlot(root, { pid = process.pid } = {}) {
  const rows = readSlots(root).filter((r) => alive(r.pid))
  const mine = rows.find((r) => r.pid === pid)
  if (mine) {
    writeSlots(root, rows)
    return { slot: mine.slot, dir: `${root}-wt-${mine.slot}` }
  }
  const taken = new Set(rows.map((r) => r.slot))
  let k = 1
  while (taken.has(k)) k += 1
  rows.push({ slot: k, pid, claimedAt: new Date().toISOString() })
  writeSlots(root, rows)
  return { slot: k, dir: `${root}-wt-${k}` }
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
