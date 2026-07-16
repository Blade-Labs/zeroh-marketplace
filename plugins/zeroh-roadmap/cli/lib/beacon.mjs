/**
 * beacon — the ONE executor-heartbeat JSONL reader/writer (ROADCODE-DESIGN §2:
 * watch, hooks, and status share one parser). Ported from arc-status.mjs:139-159
 * beaconOf (including the fail-to-null-on-IO/parse degradation) and generalized to
 * the executor-liveness dual-dir rule.
 *
 * The main beacon dir is <mainRoot>/arcs/.building; a worktree's own beacon lives
 * at <worktree>/.building. Thresholds are exported as named constants; unification
 * with executor-liveness.mjs is deferred to 1657 (watch) per pre-made decision 5.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export const ALIVE_MAX_MIN = 20
export const GATE_QUIET_MAX_MIN = 45
export const WORK_EVENTS = new Set(['gate-stage-start', 'task-start', 'background-run'])

/** <mainRoot>/arcs/.building/<arcId>-executor.jsonl */
export function beaconPath(arcId, { mainRoot }) {
  return join(mainRoot, 'arcs', '.building', `${arcId}-executor.jsonl`)
}

// The last parseable event from one JSONL file, else null — an I/O or parse error
// degrades to null (the commit-age fallback's job), never crashes the whole board.
function readLast(path) {
  if (!existsSync(path)) return null
  let lines
  try {
    lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return null
  }
  if (lines.length === 0) return null
  try {
    const last = JSON.parse(lines[lines.length - 1])
    const ts = Date.parse(last.ts)
    return { ts, ageMin: (Date.now() - ts) / 60000, event: last.event }
  } catch {
    return null
  }
}

/**
 * The freshest last-event for an arc. `worktree` OPTIONAL: given ⇒ scan BOTH the
 * main .building dir AND <worktree>/.building, preferring the most recent ts (the
 * 1657 watch consumer). OMITTED ⇒ main dir ONLY (the legacy beaconOf contract
 * status calls it by, so the parity lock holds). Returns { ageMin, event } or null.
 */
export function lastEvent(arcId, { mainRoot, worktree } = {}) {
  const candidates = [beaconPath(arcId, { mainRoot })]
  if (worktree) candidates.push(join(worktree, '.building', `${arcId}-executor.jsonl`))
  let best = null
  for (const p of candidates) {
    const r = readLast(p)
    if (r && (best === null || r.ts > best.ts)) best = r
  }
  return best ? { ageMin: best.ageMin, event: best.event } : null
}

/** Append { ts, event, ...extra } as one JSONL line to the main beacon; returns the path. */
export function appendEvent(arcId, event, { mainRoot, ...extra } = {}) {
  const p = beaconPath(arcId, { mainRoot })
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), event, ...extra }) + '\n')
  return p
}
