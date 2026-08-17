/**
 * executor-arm — the CLI-owned .building/<N>-executor.armed lifecycle (1737.2).
 * The arm file is the executor-result-guard's session-bound channel (b): content is
 * JSON { sessionId, armedAt } — the exact shape detectArm parses. An unbound arm is
 * the 2026-07-17 cross-session fabrication hazard, so armExecutor REFUSES to write
 * without a session id, and staleArms treats any non-JSON/bare body as stale by
 * definition (the pre-session-binding format is inert under the guard and pure noise).
 *
 * Staleness = the arm outlived its executor: the phase is terminal (status done/
 * historical), OR the beacon's last event is phase-complete (read through beacon.mjs's
 * readBeaconLine so legacy terminal aliases count), OR the body is UNBOUND. Unbound is
 * judged by the GUARD's own contract (detectArm): JSON {sessionId} and a raw non-empty
 * string are BOTH bound formats (the raw string is the pre-1737 prose format the guard
 * honors — sweeping it on a live phase would disarm a running executor, the 1703
 * near-miss); truly unbound = empty body, unreadable, JSON without a sessionId, or a
 * purely-numeric body (the pre-D9 phase-number fossil, e.g. a file containing `1713`).
 *
 * EXCLUSIVITY CONTRACT (2026-08-17 scar). The arm used to bind a SESSION, but one session spawns
 * many executors: two were spawned onto the same phase by the same session, so the session id
 * matched and a disarm-then-rearm looked entirely legitimate. Both then shared one working tree and
 * one branch. The unit of exclusivity is therefore the EXECUTOR, guarded at two doors:
 *   - disarmExecutor REFUSES while the phase beacon's last event is anything but phase-complete or
 *     result-returned. This is the load-bearing one: disarm is the door the orchestrator actually
 *     walked through. result-returned is stamped by the executor-result-guard hook only when an
 *     executor ended with a valid typed PhaseExecutionResult, so the allow-set is exactly "this
 *     executor handed something back".
 *   - armExecutor REFUSES over an existing arm naming a different executorId — the belt for the
 *     no-disarm path.
 * AGE is deliberately not a rule input anywhere: 93 minutes of beacon silence is what a healthy
 * cross-repo executor looked like, so age is reported as evidence for a human and nothing more.
 * NO beacon at all means no evidence, and no evidence is not proof, so that disarm proceeds.
 * staleArms and its definition of stale are CONSUMED by this guard, never changed: the sweep
 * passes force because staleArms has already made the judgement.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { readBeaconLine } from './beacon.mjs'
import { scanPhaseFile } from './phasescan.mjs'

function armPath(worktree, phase) {
  return join(worktree, '.building', `${phase}-executor.armed`)
}

/** The beacon events that mean "this executor handed something back", and so the only ones under
 *  which an arm may be cleared silently. Closed on purpose: anything else is work in flight. */
const DISARM_ALLOWED = new Set(['phase-complete', 'result-returned'])

/** The executorId recorded in an existing arm, or null for a missing / legacy / non-JSON body. */
function armedExecutorId(worktree, phase) {
  try {
    const raw = readFileSync(armPath(worktree, phase), 'utf8').trim()
    if (!raw.startsWith('{')) return null // the raw prose format predates executor ids
    const id = JSON.parse(raw).executorId
    return typeof id === 'string' && id.length > 0 ? id : null
  } catch {
    return null // absent or unreadable — nothing to defend
  }
}

/**
 * Write the session-bound arm file; missing/empty sessionId THROWS (never an unbound arm).
 *
 * Refuses when an existing arm names a DIFFERENT executorId than the incoming one, unless
 * `force`. An incoming arm with no executorId cannot prove it is the incumbent, so it refuses
 * too; an EXISTING arm carrying no executorId never refuses, so nothing already on disk breaks.
 */
export function armExecutor(worktree, phase, sessionId, opts = {}) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('executor-arm: sessionId is required — an unbound arm file is never written (the 2026-07-17 fabrication hazard)')
  }
  const { executorId, force = false } = opts
  const incumbent = armedExecutorId(worktree, phase)
  if (!force && incumbent && incumbent !== executorId) {
    throw new Error(
      `executor-arm: phase ${phase} is already armed to executor '${incumbent}'`
        + `${executorId ? `, not '${executorId}'` : " and the incoming arm names no executor id ('--executor-id')"}`
        + ' — a second executor on one phase shares its working tree and branch with the first (2026-08-17).'
        + ' Pass force only after establishing that the incumbent executor is genuinely gone.',
    )
  }
  const p = armPath(worktree, phase)
  mkdirSync(dirname(p), { recursive: true })
  const body = { sessionId, ...(executorId ? { executorId } : {}), armedAt: new Date().toISOString() }
  writeFileSync(p, JSON.stringify(body) + '\n')
  return p
}

/**
 * Remove the arm file. A missing file is a silent no-op.
 *
 * REFUSES while the phase beacon's last event is a work event: clearing a live arm is what let a
 * second executor be spawned onto a phase the first still owned. A missing beacon still disarms —
 * no evidence is not proof. `force` is the deliberate override, and the sweep passes it because
 * staleArms has already applied its own definition of stale.
 */
export function disarmExecutor(worktree, phase, opts = {}) {
  const p = armPath(worktree, phase)
  if (!opts.force && existsSync(p)) {
    const beacon = readBeaconLine(join(worktree, '.building', `${phase}-executor.jsonl`))
    if (beacon && !DISARM_ALLOWED.has(beacon.event)) {
      const ageMin = (Date.now() - beacon.ts) / 60000
      throw new Error(
        `executor-disarm: phase ${phase} is armed and its executor never returned a result — the beacon's last event is`
          + ` '${beacon.event}' (${ageMin.toFixed(1)}min ago), not phase-complete or result-returned.`
          + ' Age is evidence, not permission: on 2026-08-17 a 93min-quiet beacon belonged to a healthy cross-repo'
          + ' executor, and disarming it put two executors on one branch. Read the beacon, then pass force if the'
          + ' executor is genuinely gone.',
      )
    }
  }
  rmSync(p, { force: true })
}

/** True iff the phase file at phasesDir reads terminal (regex tier — status: precedes notes). */
function phaseTerminal(phasesDir, phase) {
  const f = join(phasesDir, `phase-${phase}.phase.ts`)
  if (!existsSync(f)) return false
  const status = scanPhaseFile(f)?.status ?? null
  return status === 'done' || status === 'historical'
}

/**
 * Scan <worktree>/.building/*-executor.armed → the stale set, each entry
 * { file, phase, reason }. A live arm (JSON-bound, non-terminal phase, no terminal
 * beacon) is never returned.
 */
export function staleArms(worktree, phasesDir) {
  const dir = join(worktree, '.building')
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out = []
  for (const f of entries) {
    const m = f.match(/^(\d+)-executor\.armed$/)
    if (!m) continue
    const phase = Number(m[1])
    const file = join(dir, f)

    let bound = false
    try {
      const raw = readFileSync(file, 'utf8').trim()
      if (raw.startsWith('{')) bound = typeof JSON.parse(raw).sessionId === 'string'
      else bound = raw.length > 0 && !/^\d+$/.test(raw) // raw session id = the old BOUND prose format (guard detectArm honors it)
    } catch {
      /* unreadable = unbound */
    }
    if (!bound) {
      out.push({ file, phase, reason: 'unbound arm (empty / phase-number fossil / JSON without sessionId) — stale by definition' })
      continue
    }
    if (phaseTerminal(phasesDir, phase)) {
      out.push({ file, phase, reason: `phase ${phase} is terminal (status done/historical) — the arm outlived its executor` })
      continue
    }
    const beacon = readBeaconLine(join(dir, `${phase}-executor.jsonl`))
    if (beacon?.event === 'phase-complete') {
      out.push({ file, phase, reason: `beacon terminal (phase-complete) — the arm outlived its executor` })
    }
  }
  return out
}
