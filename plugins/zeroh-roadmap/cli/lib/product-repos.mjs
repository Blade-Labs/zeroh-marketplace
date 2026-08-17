/**
 * product-repos — turn a phase's declared absolute keyFiles into the set of repositories that
 * are NOT the arc worktree's own (2375.2, from the 2026-08-17 cross-repo incident: a phase whose
 * bookkeeping lived in one repo and whose product code lived in a sibling repo read as STALLED
 * while its executor was committing normally, because nothing in the CLI looked anywhere but the
 * worktree).
 *
 * A phase's keyFiles are the ONLY on-disk record of where it actually writes, so they are the
 * only honest input to this question.
 *
 * The comparison is git-COMMON-DIR, never toplevel: a linked worktree of the same repository has
 * a different toplevel but shares the common dir, and a phase routinely names files in a sibling
 * checkout of its own consumer repo. Comparing toplevels would call that checkout foreign and
 * vouch for the wrong lane.
 *
 * Best-effort by construction: a relative path, a path under no repository, or a git call that
 * throws all yield nothing rather than an error. Two consumers justify the module (D7): the
 * liveness activity row and the executor-arm preflight.
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { gitToplevel, gitCommonDir } from './gitroot.mjs'

/** Ceiling on derived repositories, so one over-broad keyFiles list can never fan the liveness
 *  row out into a dozen git calls on every poll. */
export const PRODUCT_REPO_CAP = 4

/**
 * The nearest EXISTING directory at or above `p`. A phase legitimately declares files it has not
 * created yet, and git can only answer about a path that exists, so resolution walks up until the
 * filesystem has something to stand on. Returns null only if the walk runs off the top.
 */
function nearestExistingDir(p) {
  let cur = p
  for (;;) {
    if (existsSync(cur)) {
      try {
        return statSync(cur).isDirectory() ? cur : dirname(cur)
      } catch {
        return dirname(cur) // raced away between the check and the stat
      }
    }
    const up = dirname(cur)
    if (up === cur) return null
    cur = up
  }
}

/**
 * The foreign repository roots among `keyFiles`, in declaration order, deduped by toplevel and
 * capped at PRODUCT_REPO_CAP.
 *
 * A worktree whose own common dir cannot be resolved yields NOTHING rather than treating every
 * repository as foreign: this feeds an ALIVE arm of a liveness verdict, and a false ALIVE is the
 * one direction that verdict must never fail in.
 */
export function productRepos(keyFiles, { worktree } = {}) {
  let ourCommon
  try {
    ourCommon = gitCommonDir(worktree)
  } catch {
    return []
  }
  const out = []
  const seen = new Set()
  for (const keyFile of keyFiles ?? []) {
    if (out.length >= PRODUCT_REPO_CAP) break
    if (typeof keyFile !== 'string' || !isAbsolute(keyFile)) continue
    const dir = nearestExistingDir(keyFile)
    if (!dir) continue
    try {
      const top = gitToplevel(dir)
      if (seen.has(top)) continue
      seen.add(top) // memoized whether foreign or ours — the git calls are the expensive part
      if (gitCommonDir(dir) !== ourCommon) out.push(top)
    } catch {
      /* not a repo, or git refused — simply not a product repo */
    }
  }
  return out
}

/**
 * Age in minutes of the freshest EXISTING file among `keyFiles`, or null when none of them exist.
 *
 * Null rather than 0 because the two are opposite diagnoses: "nothing declared has been written
 * yet" must never read as "something was written this instant". Unlike the engine's worktree walk
 * this is a bounded stat over a handful of declared paths, so it costs nothing even against a
 * monorepo, and it is attributable by construction because the paths come from THIS phase.
 */
export function newestKeyFileAgeMin(keyFiles, now = Date.now()) {
  let newest = 0
  for (const keyFile of keyFiles ?? []) {
    if (typeof keyFile !== 'string' || !isAbsolute(keyFile)) continue
    try {
      const m = statSync(keyFile).mtimeMs
      if (m > newest) newest = m
    } catch {
      /* not created yet — not evidence either way */
    }
  }
  return newest > 0 ? (now - newest) / 60000 : null
}
