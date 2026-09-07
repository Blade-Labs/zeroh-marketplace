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

/**
 * The CLOSED phase-executor event vocabulary (1737.1) — the ONE terminal name is
 * 'phase-complete'. Writers refuse anything outside this set; the three pre-1737
 * terminal variants observed in live sidecars (phase-done / executor-complete /
 * executor-done) are READ-side aliases only (normalized below), never writable.
 */
export const EXECUTOR_EVENTS = new Set([
  'executor-start',
  'task-start',
  'commit',
  'gate-stage-start',
  'gate-stage-end',
  'background-run',
  'escalated',
  'resume',
  'result-returned',
  // The throttled PostToolUse heartbeat (2384.5): beacons are otherwise emitted only at task and
  // gate-stage boundaries, so ONE long task is beacon-silent for hours and indistinguishable, by
  // the primary signal, from a dead executor. A WORK event by meaning — it says "still running",
  // never "finished" — which is why it stays OUT of executor-arm's DISARM_ALLOWED allow-list: a
  // heartbeating executor must refuse disarm.
  'heartbeat',
  'phase-complete',
])

/** Legacy terminal names → the one canonical terminal (read-side normalization only). */
const LEGACY_TERMINAL_ALIASES = new Map([
  ['phase-done', 'phase-complete'],
  ['executor-complete', 'phase-complete'],
  ['executor-done', 'phase-complete'],
])

/** <mainRoot>/arcs/.building/<arcId>-executor.jsonl */
export function beaconPath(arcId, { mainRoot }) {
  return join(mainRoot, 'arcs', '.building', `${arcId}-executor.jsonl`)
}

/**
 * The last parseable JSONL record of one beacon file → { ts, ageMin, event, log } | null.
 * An I/O or parse error degrades to null (the commit-age fallback's job), never crashes
 * the board. THE one line parser: status (lastEvent) and watch/liveness (1657) both read
 * beacons through this, so the JSONL shape is decoded in exactly one place.
 */
export function readBeaconLine(path) {
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
    const event = LEGACY_TERMINAL_ALIASES.get(last.event) ?? last.event
    const identity = Object.fromEntries(['runId', 'executorId', 'nativeSessionId', 'actionFingerprint', 'requestFingerprint', 'runReceiptDigest'].filter((field) => Object.hasOwn(last, field)).map((field) => [field, last[field]]))
    return { ts, ageMin: (Date.now() - ts) / 60000, event, log: last.log ?? null, pid: last.pid ?? null, ...identity }
  } catch {
    return null
  }
}
const readLast = readBeaconLine

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

/**
 * THE typed phase-executor writer (1737.1): append one heartbeat line to
 * <worktree>/.building/<phase>-executor.jsonl. Closed set — an event outside
 * EXECUTOR_EVENTS throws before anything is written; `phase` always serializes as a
 * JSON number regardless of input type. Returns the beacon path.
 */
export function appendExecutorEvent(worktree, phase, event, extra = {}) {
  if (!EXECUTOR_EVENTS.has(event)) {
    throw new Error(
      `beacon: unknown executor event '${event}' — the closed vocabulary is: ${[...EXECUTOR_EVENTS].join(', ')}`,
    )
  }
  const phaseNum = Number(phase)
  if (!Number.isFinite(phaseNum)) throw new Error(`beacon: phase must be numeric, got '${phase}'`)
  const p = join(worktree, '.building', `${phaseNum}-executor.jsonl`)
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), phase: phaseNum, event, ...extra }) + '\n')
  return p
}


/** Find durable proof that the result tail for one exact checkpoint completed.
 * The whole JSONL file is parsed fail-closed; a corrupt or phase-mismatched
 * record cannot be skipped to reach an older, apparently convenient proof. */
export function readResultTailCompletion(worktree, phase, { checkpointDigest, resultDigest }) {
  const phaseNum = Number(phase)
  const p = join(worktree, '.building', `${phaseNum}-executor.jsonl`)
  if (!existsSync(p)) return null
  let records
  try {
    records = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return null
  }
  for (const record of records.toReversed()) {
    const bindsResult = record.checkpointDigest === checkpointDigest || record.resultDigest === resultDigest
    if (bindsResult && record.phase !== phaseNum) return null
    if (record.event === 'phase-complete'
      && record.resultTailComplete === true
      && record.phase === phaseNum
      && record.checkpointDigest === checkpointDigest
      && record.resultDigest === resultDigest) return record
  }
  return null
}
