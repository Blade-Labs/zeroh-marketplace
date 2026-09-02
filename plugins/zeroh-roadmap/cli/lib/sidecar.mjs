/**
 * sidecar — the .building / .arc-mode / claims lifecycle (ROADCODE-DESIGN §2).
 * arm/disarm/land/pause all use it. THE beacon-stamp discovery rule is pinned here:
 * sidecars live ONLY in the MAIN checkout's roadmap/arcs/.building (resolved via
 * gitroot.mainCheckout), never a worktree's own .building — even when armed from a
 * linked worktree.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { mainCheckout, gitCommonDir } from './gitroot.mjs'
import { roadmapRoot } from './roadmap-root.mjs'

/** A lane already armed by a DIFFERENT worktree — never overwrite it. */
export class LaneHeldError extends Error {
  constructor(arcId, holderWorktree, sidecar) {
    super(`roadmap: arc ${arcId} is already armed by another worktree: ${holderWorktree}`)
    this.name = 'LaneHeldError'
    this.arcId = arcId
    this.holderWorktree = holderWorktree
    this.sidecar = sidecar
  }
}

/** The MAIN-checkout sidecar registry for the repo containing cwd. */
export function buildingDir(cwd) {
  return join(roadmapRoot(mainCheckout(cwd)), 'arcs', '.building')
}

function sidecarPath(cwd, arcId) {
  return join(buildingDir(cwd), `${arcId}.json`)
}

export function listSidecars(cwd) {
  const dir = buildingDir(cwd)
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')))
    } catch {
      /* a corrupt sidecar is skipped, not fatal */
    }
  }
  return out
}

export function readSidecar(cwd, arcId) {
  const p = sidecarPath(cwd, arcId)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** Liveness PROBE (signal 0 — never kills): true iff the pid exists. Shared so the keep-waiting
 *  probe (arc-plane.workflow) checks liveness without a `process.kill` literal of its own (the
 *  workflow's "never kills a process" invariant keeps the kill primitive out of that file). */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e && e.code === 'EPERM' // exists but not ours ⇒ alive
  }
}

/**
 * Write the Step-3b sidecar, stamping { pid, sessionHint, armedAt }. A DIFFERENT
 * recorded worktree ⇒ LaneHeldError (never overwrite a foreign lane). The SAME
 * worktree ⇒ idempotent rewrite, returning { warned:true, livePid } when the
 * recorded pid is still alive (two sessions may be driving one arc).
 */
export function armSidecar(cwd, arcId, opts) {
  const dir = buildingDir(cwd)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, `${arcId}.json`)
  const worktree = resolve(opts.worktree)
  let warned = false
  let livePid
  if (existsSync(p)) {
    let existing = null
    try {
      existing = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      /* unreadable ⇒ treat as absent and re-arm */
    }
    if (existing) {
      const existingWt = resolve(existing.worktree ?? '')
      if (existingWt !== worktree) throw new LaneHeldError(arcId, existing.worktree, existing)
      if (typeof existing.pid === 'number' && pidAlive(existing.pid)) {
        warned = true
        livePid = existing.pid
      }
    }
  }
  const sidecar = {
    arcId,
    worktree,
    branch: opts.branch,
    ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
    mode: opts.mode ?? 'mixed',
    ...(opts.note ? { note: opts.note } : {}),
    ...(opts.paused ? { paused: true } : {}),
    pid: process.pid,
    sessionHint: opts.sessionHint ?? null,
    armedAt: new Date().toISOString(),
  }
  writeFileSync(p, JSON.stringify(sidecar, null, 2) + '\n')
  return { sidecar, warned, livePid }
}

/** Rewrite the sidecar with paused:true, preserving every other field. */
export function pauseSidecar(cwd, arcId) {
  const existing = readSidecar(cwd, arcId)
  if (!existing) throw new Error(`roadmap: no sidecar for arc ${arcId} to pause`)
  const updated = { ...existing, paused: true }
  writeFileSync(sidecarPath(cwd, arcId), JSON.stringify(updated, null, 2) + '\n')
  return updated
}

export function removeSidecar(cwd, arcId) {
  rmSync(sidecarPath(cwd, arcId), { force: true })
}

export function writeArcMode(root) {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, '.arc-mode'), '')
}

export function clearArcMode(root) {
  rmSync(join(root, '.arc-mode'), { force: true })
}

/** Best-effort rm of <common-dir>/zeroh-roadmap-claims/<N>.claim; a missing claim is a no-op. */
export function releaseClaims(cwd, numbers) {
  const claimsDir = join(gitCommonDir(cwd), 'zeroh-roadmap-claims')
  for (const n of numbers) rmSync(join(claimsDir, `${n}.claim`), { force: true })
}
