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
  openSync,
  closeSync,
  fsyncSync,
  linkSync,
  unlinkSync,
  lstatSync,
  realpathSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
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
    ...(opts.modelPolicy ? { modelPolicy: opts.modelPolicy } : {}),
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


/** Immutable result-consumption claims live beside the existing arc sidecars. */
function resultClaimPath(cwd, { arcId, phase, checkpointDigest }) {
  const dir = join(buildingDir(cwd), 'result-claims', encodeURIComponent(arcId))
  return { dir, path: join(dir, String(phase) + '-' + encodeURIComponent(checkpointDigest) + '.json') }
}

const validClaimKey = (key) =>
  key && typeof key.arcId === 'string' && key.arcId.trim().length > 0
  && key.arcId !== '.' && key.arcId !== '..' && !/[\\/]/.test(key.arcId)
  && Number.isInteger(key.phase) && key.phase > 0
  && typeof key.checkpointDigest === 'string' && key.checkpointDigest.trim().length > 0

function safeClaimDir(cwd, targetDir, { create }) {
  const basePath = buildingDir(cwd)
  if (!existsSync(basePath)) {
    if (!create) return null
    mkdirSync(basePath, { recursive: true })
  }
  const base = realpathSync(basePath)
  const claimsRoot = join(basePath, 'result-claims')
  if (existsSync(claimsRoot)) {
    if (lstatSync(claimsRoot).isSymbolicLink()) throw new Error('roadmap: unsafe result claim directory symlink')
  } else if (create) mkdirSync(claimsRoot, { recursive: true })
  else return null
  if (existsSync(targetDir)) {
    if (lstatSync(targetDir).isSymbolicLink()) throw new Error('roadmap: unsafe arc claim directory symlink')
  } else if (create) mkdirSync(targetDir, { recursive: true })
  else return null
  const actual = realpathSync(targetDir)
  if (!actual.startsWith(base + '/')) throw new Error('roadmap: result claim directory escapes sidecar home')
  return actual
}

function validClaimInput(input) {
  const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0
  if (!validClaimKey(input)) return false
  if (!nonBlank(input.checkpointDigest) || !nonBlank(input.resultDigest) || !nonBlank(input.eventId)) return false
  if (!input.owner || !Number.isInteger(input.owner.pid) || input.owner.pid < 1 || !nonBlank(input.owner.sessionId)) return false
  const authority = input.authorityRef
  if (authority?.status === 'known') {
    return nonBlank(authority.envelopeDigest)
      && ['codex-journal', 'managed-host-receipt'].includes(authority.source?.kind)
      && nonBlank(authority.source?.ref)
  }
  return authority?.status === 'unknown'
    && ['read-only-projection', 'legacy-unrecorded', 'source-unreadable'].includes(authority.reason)
    && (authority.sourceRef === null || nonBlank(authority.sourceRef))
}

function validPublishedClaim(claim) {
  return validClaimInput(claim) && typeof claim.claimedAt === 'string' && !Number.isNaN(Date.parse(claim.claimedAt))
}

export function readResultClaim(cwd, key) {
  if (!validClaimKey(key)) throw new Error('roadmap: malformed result-consumption claim key')
  const target = resultClaimPath(cwd, key)
  if (!safeClaimDir(cwd, target.dir, { create: false })) return null
  let stat
  try {
    stat = lstatSync(target.path)
  } catch (e) {
    if (e?.code === 'ENOENT') return null
    throw e
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`roadmap: unsafe result-consumption claim ${target.path}`)
  try {
    const claim = JSON.parse(readFileSync(target.path, 'utf8'))
    if (!validPublishedClaim(claim)
      || claim.arcId !== key.arcId
      || claim.phase !== key.phase
      || claim.checkpointDigest !== key.checkpointDigest) {
      throw new Error('claim content does not match its canonical identity')
    }
    return claim
  } catch (e) {
    throw new Error(`roadmap: malformed result-consumption claim ${target.path}: ${e.message}`)
  }
}


/** Read every immutable result claim for one arc through the same validated boundary. */
export function listResultClaims(cwd, arcId) {
  const key = { arcId, phase: 1, checkpointDigest: 'discovery' }
  if (!validClaimKey(key)) throw new Error('roadmap: malformed result-consumption arc key')
  const target = resultClaimPath(cwd, key)
  if (!safeClaimDir(cwd, target.dir, { create: false })) return []
  const claims = []
  for (const name of readdirSync(target.dir).filter((entry) => entry.endsWith('.json'))) {
    const path = join(target.dir, name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`roadmap: unsafe result-consumption claim ${path}`)
    let identity
    try {
      identity = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      throw new Error(`roadmap: malformed result-consumption claim ${path}: ${e.message}`)
    }
    const canonical = resultClaimPath(cwd, identity)
    if (identity.arcId !== arcId || canonical.path !== path) {
      throw new Error(`roadmap: result claim identity does not match canonical filename ${name}`)
    }
    claims.push(readResultClaim(cwd, identity))
  }
  return claims
}

/**
 * Atomically publish the one immutable consumption claim for a phase checkpoint.
 * linkSync is the compare-and-swap: exactly one contender can create the target.
 */
export function claimResultConsumption(cwd, input) {
  if (!validClaimInput(input)) throw new Error('roadmap: malformed result-consumption claim input')
  const target = resultClaimPath(cwd, input)
  safeClaimDir(cwd, target.dir, { create: true })
  const claim = {
    arcId: input.arcId,
    phase: input.phase,
    eventId: input.eventId,
    resultDigest: input.resultDigest,
    checkpointDigest: input.checkpointDigest,
    owner: { pid: input.owner.pid, sessionId: input.owner.sessionId },
    authorityRef: input.authorityRef,
    claimedAt: new Date().toISOString(),
  }
  const tmp = join(target.dir, `.${input.phase}-${process.pid}-${randomUUID()}.tmp`)
  let fd
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(claim, null, 2) + '\n')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    try {
      linkSync(tmp, target.path)
      const dirFd = openSync(target.dir, 'r')
      try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
      return { status: 'claimed', claim }
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e
      const existing = readResultClaim(cwd, input)
      return {
        status: existing.resultDigest === input.resultDigest ? 'duplicate' : 'conflict',
        claim: existing,
      }
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(tmp) } catch (e) { if (e?.code !== 'ENOENT') throw e }
  }
}
