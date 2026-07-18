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
 * readBeaconLine so legacy terminal aliases count), OR the body is bare/legacy.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { readBeaconLine } from './beacon.mjs'
import { scanPhaseFile } from './phasescan.mjs'

function armPath(worktree, phase) {
  return join(worktree, '.building', `${phase}-executor.armed`)
}

/** Write the session-bound arm file; missing/empty sessionId THROWS (never an unbound arm). */
export function armExecutor(worktree, phase, sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('executor-arm: sessionId is required — an unbound arm file is never written (the 2026-07-17 fabrication hazard)')
  }
  const p = armPath(worktree, phase)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ sessionId, armedAt: new Date().toISOString() }) + '\n')
  return p
}

/** Force-remove the arm file; a missing file is a no-op. */
export function disarmExecutor(worktree, phase) {
  rmSync(armPath(worktree, phase), { force: true })
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
    } catch {
      /* unreadable = unbound */
    }
    if (!bound) {
      out.push({ file, phase, reason: 'bare/legacy arm format (pre-session-binding) — unbound is stale by definition' })
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
