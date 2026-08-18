/**
 * spawn-phase — the hook-side answer to "which phase is the agent making this call executing?"
 * (2384 gate R1, narrowed by R2).
 *
 * Both executor hooks need it and must agree: the Stop guard uses it to demand a typed result from
 * the executor whose phase is armed, and the heartbeat uses it to stamp only that executor's
 * beacon. Session id cannot carry the question — an arm records the ORCHESTRATING session's id and
 * every subagent of that session reports the same one, which is why the guard stopped trusting
 * session-matching alone.
 *
 * Two channels, in order:
 *   (a) ROADMAP_EXECUTOR_PHASE in the environment — the workflow lane sets it explicitly on the
 *       executor spawn, so it is one phase by construction and needs no parsing.
 *   (b) the agent's OWN transcript head: the phase file its spawn prompt names, AND (for the
 *       vouching consumer) the `attributionAgent` that says it is the executor. The phase needle
 *       alone is NOT identity — the gate's reviewers are spawned with the phase file path in their
 *       prompt too, and one of them stamping a heartbeat would manufacture a false ALIVE.
 *
 * Neither resolving means "not an executor's call", and that is SILENCE — never a fallback to
 * whichever arm a readdir happened to yield first. The AGENT transcript is read and the SESSION
 * transcript deliberately is not: under a subagent event `transcript_path` is the main session's
 * log, so reading it would attribute the orchestrator's phase to every agent in the session.
 */
import { readTranscriptHead, phaseFromHead, isExecutorHead } from '../cli/lib/agent-transcript.mjs'

/**
 * The phase named in `path`'s spawn prompt, whoever wrote it. Used where the caller has ALREADY
 * established that it is dealing with an executor (the Stop guard applies its own agent-type
 * exemption downstream) and only needs to know WHICH phase.
 */
export function ownPhaseFromTranscript(path) {
  return phaseFromHead(readTranscriptHead(path))
}

/**
 * The phase this payload's agent is EXECUTING, or null when the caller is not an executor — the
 * main session, a reviewer, an architect. Used by signals that vouch for life, so the agent type
 * must be proven, not assumed.
 */
export function actingPhase(payload = {}, env = process.env) {
  const envN = env.ROADMAP_EXECUTOR_PHASE
  if (envN && /^\d+$/.test(envN)) return Number(envN)
  const head = readTranscriptHead(payload.agent_transcript_path)
  return isExecutorHead(head) ? phaseFromHead(head) : null
}
