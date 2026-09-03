---
name: "Do Phase"
description: "Execute a roadmap phase task-by-task with enforced sequential discipline: one task = one commit + a transparencyReport, then the kind-selected gate."
user-invocable: true
metadata:
  keywords: phase, execute, do, start, roadmap, sequential
  aliases: start-phase
---

# Do Phase — Sequential Execution Protocol

**Trigger:** `do phase N`, `/do-phase N`, `do next phase` (→ `roadmap status`). Invoke the CLI as
`roadmap <cmd>` (fallback `node ${CLAUDE_PLUGIN_ROOT}/bin/roadmap.mjs <cmd>`).

## PRIME RULE 1 — no compromises; escalate to the ARCHITECT, not the user

Senior-architect rigor per task: magic numbers → constants, ambiguity → throw, no TODO deferrals.

**Before you would** (a) write a non-`"None"` `compromises`/`hardcoded`/`skipped`, (b) hardcode
a value, (c) silence ambiguity, (d) defer with a TODO, or (e) STOP to ask the user — FIRST invoke
`zeroh-roadmap:software-architect` (foreground, single hop) per its **Decision Contract**
(`agents/software-architect.md`), passing the task's `acceptanceCriteria` + `files` + `notes`,
the convenient path, and the proper path you see:
- `PROCEED_WITH_FIX` → implement it; `compromises` stays `"None"`.
- `ESCALATE_TO_USER` → the ONLY verdict that justifies stopping. Inline: post it, wait.
  **Arc-mode: no reachable user — return `status: "escalated"` with the question + options.**

One compromise = one architect call, no batching. Three+ in a phase = the plan is too broad → STOP.

## PRIME RULE 2 — one task at a time

Batching loses work. **Never** batch tasks, launch parallel agents for tasks,
reorder/skip them, or mark a task done before it is committed.

## Step 0 — read the phase; run the tripwires

Read the phase (`status` must be `backlog`/`in-progress`; terminal = stop). If it declares
`assumptions[]`, run each `verify` **before any code**: any failure ⇒ STOP and escalate with the
raw output (arc-mode: `status: "escalated"`) — escalating IS success. Set a `backlog` phase to
`in-progress` and commit before task 1.

## The per-task loop (one task = one commit)

For each task in order:
1. **Implement `steps`.** `testMode: "tdd"` — `test-engineer` FIRST with only
   problem/acceptanceCriteria/files/type-signatures (NOT `steps`); new tests scoped (RED),
   implement, scoped (GREEN), commit test+code. `"e2e"` — implement, then `test-engineer` writes
   the flow test blind to source; commit together (e2e runs at the gate). `"none"` — the steps.
2. **Verify** — the `types` slot via `roadmap gate run <N> --slots types`; scope touched tests via
   the scoped slot (never a hand-built filter); a UI change runs `build`.
3. **Commit** — `<type>(<scope>): phase N — <task title>`.
4. **Persist** `transparencyReport` + `done: true` + `doneDate`, same commit.
5. **Continue immediately** — the task boundary is a commit boundary, never a turn boundary.

**Batch tasks (`batchMode: true`, mechanical only):** one commit per `steps[]` entry (`… phase N
task N.X (k/M) — <step>`), the `types` slot each, NO forks; one aggregated `transparencyReport`
in a final commit. A step red twice running → STOP.

## Transparency contract (per task)

**Durable-lesson moment** — an error you recovered, a user correction, or a surprising
re-derivation is flushed immediately with `roadmap eval lesson "<text>" --writer <model> --phase N`.

Persist all six fields — `whatWasDone`, `how` (real content), and
`compromises`/`skipped`/`hardcoded`/`limitations` (the literal `"None"`, or ≥10 chars of substance
— `"n/a"`/`"tbd"` fail parse). Echo the four debt lines ONLY when not `"None"`.
A non-`"None"` `compromises` or `skipped` also requires `decisionRef` naming the ratifying verdict.

## Commit grammar (BINDING — the CLI parses these subjects)

`docs(roadmap): phase N — <desc>` · task commits carry `phase N` + the task id · `fix(scope):
phase N gate RX` · `docs(roadmap): mark phase N complete`. The CLI parses these (base-SHA
derivation, unverified-done detection, the beacon-stamp hook) — the `—` boundary stops 136
matching 1369.

## The gate (after the last task)

Test-worthiness and documentation details live in `references/test-worthiness.md` and
`references/documentation-rules.md`. The correctness rounds are performed by the resolved
`code-reviewer`; every round records its model and typed findings.

`roadmap gate plan <N>` prints the resolved cell (slots, scopes, floors, agent chain) for the
`kind`: mockup = lint+types; logic = Round 0 quality pass → Rounds 1..N correctness loop (cap 5);
hardening adds the closure integration rerun; release adds the e2e slot. Run `roadmap gate run
<N>` for the mechanical half, then the agent chain the plan names. A docs-only diff skips the
quality pass. Under arc-mode the gate runs only phase-relevant SCOPED tests — the full suite
defers to the arc end.

Record every review with `roadmap gate run <N> --record-round '<typed JSON>'`. A new tree guard
follows `references/guard-mutation-proof.md`.

**Design-parity stage** (a task cites a `ux` designRef AND the diff touches a rendered surface): a
confirmed design is a CONTRACT. Apply the canonical `skills/validate-arc/references/parity-rubric.md`
with FRESH eyes (a spawned vision judge, never the implementer) — render via `live-ui`, screenshot
every state AND drive every interaction (hover/focus/transition), compare on its six axes. Fix
material deviations and re-compare; an out-of-scope residual → `compromises` naming the designRef;
record a `gateRounds` entry (`agent: 'design-parity'`).

**Echo contract:** after each gate-agent stage echo a ~10-line summary to chat (`[Quality pass]
nothing to fix` if empty); the full report stays in the transcript.

**Sub-agent rule:** gate agents run synchronously; only the architect and `test-engineer` may
absorb phase work — never another phase-executor, `Explore`, or a fork for a "too-big" task.

## Curate the landed history

After the gate is green and before completion, run `roadmap phase curate <N>` as a dry run, inspect
its range and groups, then apply it. A foreign-commit refusal is recorded as a limitation; never
rewrite another session's commit.

## Complete + return

Set in ONE edit: `status: 'done'`, `gate`, `gateRounds` (Round 0 at index 0, ≥1 entry),
`metrics`, `compromises`, `completedDate`. Then `roadmap gate run <N> --verify-complete` (phase ↔
gate-report consistency — a done phase can no longer be narrated).

**Arc-mode** (iff `roadmap/.arc-mode` exists — read via `roadmap status` — OR this session IS a
phase-executor): also persist `executionResult`, commit the phase, and **return that
PhaseExecutionResult** (`status` done/escalated/failed; map the roll-up). SKIP grooming, the emit
slot, and the push — the do-arc workflow serializes those.

**Standalone** (no arc-mode): after the completion commit, groom `roadmap/backlog.ts` (remove this
phase's entry + any single-phase narrative naming only it), run the `emit` slot, then push per the
consumer's `mergePolicy` (workflow serialization covers arc-mode only).

## Codex delegation lane

Launch delegated work through `roadmap codex run`, never a hand-built command. A delegated phase
still performs every task and gate; a `codex-self-review` round must be labeled honestly and does
not replace the independent recorded correctness round. Codex never lands, merges, pushes, edits
the primary checkout, or grooms the backlog; the supervising session audits and integrates.
