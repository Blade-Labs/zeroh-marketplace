/**
 * spawn-phase — the ONE answer to "which phase is the agent making this call?" (2384 gate R1).
 *
 * Both executor hooks need it and must agree: the Stop guard uses it to demand a typed result from
 * the executor whose phase is armed, and the heartbeat uses it to stamp only that executor's
 * beacon. Session id cannot answer the question — an arm carries the ORCHESTRATING session's id and
 * every subagent of that session carries the same one, which is exactly why the guard stopped
 * trusting session-matching alone.
 *
 * Two channels, in order:
 *   (a) ROADMAP_EXECUTOR_PHASE in the environment — the workflow lane sets it explicitly on the
 *       executor spawn, so it is one phase by construction and needs no parsing.
 *   (b) the FIRST `phase-<N>.phase.ts` in the head of the agent's OWN transcript: both spawn lanes
 *       put the phase file PATH in the prompt, and the prompt is the transcript's first record.
 *
 * Neither resolving means "not an executor's call", and that is SILENCE — never a fallback to
 * whichever arm a readdir happened to yield first. The agent transcript is used and the SESSION
 * transcript deliberately is not: under a subagent event `transcript_path` is the main session's
 * log, so reading it would attribute the orchestrator's phase to every agent in the session.
 */
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'

/** The spawn prompt is the first record; a bounded head is the whole question. */
const HEAD_BYTES = 64 * 1024

/** The first `phase-<N>.phase.ts` named in `path`'s head, or null (unreadable included). */
export function ownPhaseFromTranscript(path) {
  if (!path || !existsSync(path)) return null
  try {
    const size = statSync(path).size
    const span = Math.min(size, HEAD_BYTES)
    if (span <= 0) return null
    const buf = Buffer.alloc(span)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buf, 0, span, 0)
    } finally {
      closeSync(fd)
    }
    const m = buf.toString('utf8').match(/phase-(\d+)\.phase\.ts/)
    return m ? Number(m[1]) : null
  } catch {
    return null // unreadable is no-phase, which is silence — the fail-open direction
  }
}

/**
 * The phase the agent behind this hook payload is executing, or null when the caller is not an
 * executor (the main session, a reviewer, an architect — none of them name a phase file).
 */
export function actingPhase(payload = {}, env = process.env) {
  const envN = env.ROADMAP_EXECUTOR_PHASE
  if (envN && /^\d+$/.test(envN)) return Number(envN)
  return ownPhaseFromTranscript(payload.agent_transcript_path)
}
