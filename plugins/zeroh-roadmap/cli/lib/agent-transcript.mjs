/**
 * agent-transcript — the ONE reader for "who wrote this transcript, and for which phase?"
 * (2384 gate R2).
 *
 * Three consumers had to agree and did not: liveness discovers an executor's transcript to vouch
 * for it, the heartbeat hook stamps that executor's beacon, and the Stop guard picks which arm to
 * enforce. All three were answering identity from the spawn prompt alone — "the head names
 * phase-<N>.phase.ts" — and on this estate that is FALSE for the agent it matters most against:
 * the gate's own reviewers are spawned WITH the phase file path in their prompt, so a code-reviewer
 * or quality-pass transcript matched exactly like the executor's. A reviewer could then vouch for a
 * dead executor (a false ALIVE, the one direction the verdict must never fail in) and stamp a
 * heartbeat onto a beacon nobody could afterwards disarm.
 *
 * The transcript answers it directly: `attributionAgent` is present from the FIRST record and names
 * the agent type. Verified on the live estate 2026-08-18 — the executor's own transcript head says
 * `zeroh-roadmap:phase-executor` while the three other phase-2384-naming transcripts say
 * `zeroh-roadmap:code-reviewer` / `zeroh-roadmap:quality-pass`.
 *
 * Everything here is a bounded HEAD read: the spawn prompt and the first attribution are both in
 * the opening records, and these run against multi-megabyte files that grow while being read.
 */
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'

/** The agent type that executes a phase. Anything else names no phase of its own to defend. */
export const EXECUTOR_AGENT = 'zeroh-roadmap:phase-executor'

export const TRANSCRIPT_HEAD_BYTES = 64 * 1024

/** The first `span` bytes of `path` as text; '' on any error (unreadable is not evidence). */
export function readTranscriptHead(path, span = TRANSCRIPT_HEAD_BYTES) {
  if (!path || !existsSync(path)) return ''
  try {
    const size = statSync(path).size
    const n = Math.min(size, span)
    if (n <= 0) return ''
    const buf = Buffer.alloc(n)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, n, 0)
    } finally {
      closeSync(fd)
    }
    return buf.toString('utf8')
  } catch {
    return ''
  }
}

/** The FIRST attributionAgent in a head, or null when the shape carries none. */
export function agentFromHead(head) {
  return head ? (head.match(/"attributionAgent"\s*:\s*"([^"]+)"/)?.[1] ?? null) : null
}

/** The FIRST `phase-<N>.phase.ts` named in a head, or null. */
export function phaseFromHead(head) {
  const m = head ? head.match(/phase-(\d+)\.phase\.ts/) : null
  return m ? Number(m[1]) : null
}

/**
 * Is this head an EXECUTOR's transcript? Attribution must be PRESENT and must name the executor
 * agent — an unattributed transcript is refused rather than assumed.
 *
 * The asymmetry is deliberate and is the opposite of the Stop guard's: this predicate gates signals
 * that VOUCH FOR LIFE, where the cost of a wrong yes is a false ALIVE (an executor respawned onto
 * live work, or an arm that can never be disarmed). If the harness ever stops writing the field,
 * these signals go quiet — liveness says UNOBSERVED and the heartbeat stops stamping — which is the
 * honest direction. The guard, which DEMANDS work rather than vouching for it, keeps treating an
 * unattributed transcript as before.
 */
export function isExecutorHead(head) {
  return agentFromHead(head) === EXECUTOR_AGENT
}
