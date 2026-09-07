# NATIVEGREEN 38.3 architecture decision

Date: 2026-09-07  
Verdict: `PROCEED_WITH_FIX`  
Role execution: authorized native Sol fallback; exact runtime unverified. No Fable consultation is claimed.

## Decision

Codex `thread.started` and `turn.completed` records prove a native thread identity and a completed
transport turn. They do not prove that the requested phase or task satisfied its intent. The Codex
adapter must therefore produce the existing semantic `exited` event with deterministic identity and
structured transport evidence. It must never translate native exit zero or `turn.completed` into
`done` or `phase-complete`. `AgentDriver.awaitEvent` continues to run that event through
`reduceArcTransition`; the phase result and canonical disk state remain the owners of intent success.

Persist the terminal transport result and its reducer-validated `exited` observation in one receipt
revision. Extend the existing `persistRunResult` input with an optional `observation` field; when
present, apply the same request, native-session, prior-state, event-id, and recomputed-reducer checks
owned by `persistRunObservation`, then atomically set `latestObservation`, `terminalResult`, clear the
pending operation, and set `outcome: 'complete'`. The Codex adapter uses this terminal form instead
of first writing a separate observation revision. Existing nonterminal observations continue through
`persistRunObservation`.

This is smaller than recording `exited` and the terminal result separately. Separate revisions expose
a crash boundary where durable semantic exit exists without its terminal evidence and would require
another reconciliation state. Persisting only a terminal result without the semantic observation is
also insufficient: it would bypass the `AgentDriver` reducer contract and lose the durable reason the
run halted. One validated atomic revision preserves both contracts without a recovery framework.

## Ownership and external-action order

A fresh start performs: validate request and exact source bytes; persist revision zero; atomically
claim the existing executor arm using `{ sessionId, executorId, runReceipt }`; launch only after a
recorded or exact-duplicate claim; bind the one parsed `thread.started` identity. A conflicting or
legacy-partial arm returns a typed hold without launching.

A resume is a new external native action. It first reconciles the exact receipt and arm, then persists
`{ kind: 'action', action: 'resume', payload: { nativeSessionId }, expectedRevisionDigest }` before
calling the registry-owned resume argv. Its direct terminal return is correlated by the internally
computed pending-action fingerprint and committed with the atomic terminal observation/result write.
`awaitEvent` consumes the buffered start or resume result and never launches Codex. If a crash leaves
an external outcome without durable matching evidence, reconciliation holds and does not retry start
or resume.

## Bounded scope

- `cli/lib/codex-agent-driver.mjs`: compose `AgentDriver`, receipts, and stable arm ownership; parse
  native JSON identity and terminal evidence; emit only `exited` for transport completion.
- `cli/lib/codex-agent-driver.test.mjs`: pin fresh/resume ownership, pre-action persistence, one
  terminal revision, reducer use, malformed/changing identity refusal, and unsupported messaging.
- `cli/lib/drivers.mjs` and its tests: keep launch/resume argv and parsing capability in the registry.
- `cli/lib/run-receipt.mjs` and focused tests: allow the existing terminal write to validate and store
  one accompanying semantic observation atomically.

No new event vocabulary, state engine, journal, scheduler, retry loop, or schema projection is added.
