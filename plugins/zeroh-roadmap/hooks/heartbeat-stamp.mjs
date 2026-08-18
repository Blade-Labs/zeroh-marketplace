#!/usr/bin/env node
/**
 * heartbeat-stamp — the THROTTLED, matcher-less PostToolUse heartbeat (2384.5).
 *
 * Executor beacons are emitted only at task and gate-stage boundaries, so ONE long task is
 * beacon-silent for hours and indistinguishable, by liveness's primary signal, from a dead
 * executor. That is what the 2026-08-18 incident looked like: 2h18m of beacon silence from an
 * executor that was fully alive, driving a live estate — and a browser-driving task produces no
 * Bash calls for the existing commit-stamp hook to ride, which is why this hook has NO matcher.
 *
 * Fire path, in cost order: resolve the cwd's git toplevel (one spawn, the guard's idiom), find
 * THIS session's armed phases (the same session-match the Stop guard uses), and append a
 * `heartbeat` beacon ONLY when the phase's last event is older than HEARTBEAT_MIN_MIN. The
 * throttle IS the design: the steady-state cost is one beacon-line read per tool call, and a
 * phase gets at most one heartbeat per window however heavy the tool traffic.
 *
 * `heartbeat` is a WORK event: liveness reads a fresh one exactly like any fresh beacon (no new
 * branch), and executor-arm's DISARM_ALLOWED is an allow-list, so a heartbeating executor
 * correctly REFUSES disarm. For the same reason a TERMINAL last event is never heartbeaten —
 * resurrecting a finished executor would strand an arm nobody can clear.
 *
 * Never blocks, never throws, always exits 0: a hook error must not brick a tool call.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendExecutorEvent, readBeaconLine } from '../cli/lib/beacon.mjs'

/** Quiet minutes before a heartbeat is due. Ten is well inside liveness's ALIVE_MAX_MIN (20), so a
 *  heartbeating executor never falls out of ALIVE between stamps. */
export const HEARTBEAT_MIN_MIN = 10

/** A beacon event meaning the executor handed something back. Never heartbeaten. */
const TERMINAL_EVENTS = new Set(['phase-complete', 'result-returned'])

function gitToplevelSafe(cwd) {
  try {
    // stderr is DISCARDED, not inherited: this runs on every tool call, and git's "fatal: not a
    // git repository" on a non-repo cwd would otherwise print into the user's session each time.
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      timeout: 10_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * The worktrees whose `.building` may hold this session's arms: the cwd's own toplevel first, plus
 * — when that toplevel is the MAIN checkout — every linked worktree.
 *
 * The linked-worktree arm is not an edge case: phase execution runs in a worktree while the
 * SESSION's cwd stays the main checkout, so the toplevel alone can never see the arm that matters.
 * The enumeration reads `.git/worktrees/<name>/gitdir` directly rather than shelling out to
 * `git worktree list`, because this runs on EVERY tool call and a second git spawn per call is a
 * real cost on a shared box; a linked worktree's own `.git` is a FILE, so that branch stops at
 * itself and costs nothing at all.
 */
export function armDirs(toplevel) {
  if (!toplevel) return []
  const dirs = [toplevel]
  const dotGit = join(toplevel, '.git')
  try {
    if (!statSync(dotGit).isDirectory()) return dirs // a linked worktree — its own arms are here
  } catch {
    return dirs
  }
  let names = []
  try {
    names = readdirSync(join(dotGit, 'worktrees'))
  } catch {
    return dirs // no linked worktrees
  }
  for (const name of names) {
    try {
      const gitdir = readFileSync(join(dotGit, 'worktrees', name, 'gitdir'), 'utf8').trim()
      if (gitdir) dirs.push(dirname(gitdir))
    } catch {
      /* raced or unreadable — simply not a candidate */
    }
  }
  return dirs
}

/** The session id an arm file is bound to, or null (bare/legacy bodies are UNBOUND, never a match:
 *  a session-blind arm is what induced a foreign subagent to fabricate executor JSON in 2026-07). */
function armSession(path) {
  try {
    const raw = readFileSync(path, 'utf8').trim()
    if (raw.startsWith('{')) return JSON.parse(raw).sessionId ?? null
    return raw.length > 0 ? raw : null
  } catch {
    return null
  }
}

/**
 * [{ worktree, phase }] due for a heartbeat right now: an arm bound to THIS session whose phase
 * beacon exists, is not terminal, and has been quiet for at least `minMin`.
 *
 * A MISSING beacon is deliberately not due: that is the pre-beacon window, which belongs to
 * `executor-start`, and a beacon whose first line was a heartbeat would misreport the diagnosis
 * liveness's pre-beacon grace exists to give.
 */
export function heartbeatsDue(worktrees, sessionId, { now = Date.now(), minMin = HEARTBEAT_MIN_MIN } = {}) {
  if (!sessionId) return []
  const due = []
  for (const worktree of worktrees ?? []) {
    const buildingDir = join(worktree, '.building')
    let entries = []
    try {
      entries = readdirSync(buildingDir)
    } catch {
      continue
    }
    for (const f of entries) {
      const m = f.match(/^(\d+)-executor\.armed$/)
      if (!m) continue
      if (armSession(join(buildingDir, f)) !== sessionId) continue
      const beacon = readBeaconLine(join(buildingDir, `${m[1]}-executor.jsonl`))
      if (!beacon || !Number.isFinite(beacon.ts)) continue
      if (TERMINAL_EVENTS.has(beacon.event)) continue
      if ((now - beacon.ts) / 60000 >= minMin) due.push({ worktree, phase: Number(m[1]) })
    }
  }
  return due
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function main() {
  const raw = readStdin()
  if (!raw.trim()) return 0
  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return 0
  }
  if (!payload.session_id) return 0
  const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd()
  const toplevel = gitToplevelSafe(cwd) ?? cwd
  for (const { worktree, phase } of heartbeatsDue(armDirs(toplevel), payload.session_id)) {
    try {
      appendExecutorEvent(worktree, phase, 'heartbeat')
    } catch {
      /* best-effort: a beacon failure must never surface on a tool call */
    }
  }
  return 0
}

/** fail-soft.mjs calls this when it imports the hook (the wrapper's `default` shape). */
export default main

// Direct invocation (`node hooks/heartbeat-stamp.mjs`) self-runs; ANY uncaught error → exit 0, so
// a hook can never brick a tool call. Guarded on argv[1] rather than running unconditionally at
// import time, because the decision helpers above are imported by their own unit suite — a
// self-run on import would exit that test process before a single case reported.
const entry = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) : null
  } catch {
    return process.argv[1] ?? null
  }
})()
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main())
  } catch {
    process.exit(0)
  }
}
