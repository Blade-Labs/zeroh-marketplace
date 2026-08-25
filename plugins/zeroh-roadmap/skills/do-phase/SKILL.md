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

**Worktree lane first** (a STANDALONE phase, when the consumer's `roadmap.config.json` sets
`executionIsolation: "worktree"`): run `roadmap worktree up`, cd into the printed dir, `roadmap
worktree reset` to put the scratch head on the integration tip, and execute the WHOLE phase
there — the primary checkout never sees task commits. Under `"primary"` (or absent) everything
below runs where it always did. **Arc-mode phases never claim a slot**: they commit in the arc's
own worktree on the arc branch, which `roadmap arc land` integrates.

Read the phase (`status` must be `backlog`/`in-progress`; terminal = stop). If it declares
`assumptions[]`, run each `verify` **before any code**: any failure ⇒ STOP and escalate with the
raw output (arc-mode: `status: "escalated"`) — escalating IS success. Then `roadmap phase start
<N>` (atomic flip + move-commit + beacon; idempotent) before task 1 — never a hand edit of the
status field.

## The per-task loop (one task = one commit)

For each task in order:
1. **Implement `steps`.** testMode semantics:
   `skills/using-zeroh-roadmap/references/test-worthiness.md`. An external dep/asset is verified
   against its planned license per
   `skills/using-zeroh-roadmap/references/external-assets-licensing.md` BEFORE it is
   installed/vendored. `testMode: "tdd"` — `test-engineer` FIRST with only
   problem/acceptanceCriteria/files/type-signatures (NOT `steps`); new tests scoped (RED),
   implement, scoped (GREEN), commit test+code. `"e2e"` — implement, then `test-engineer` writes
   the flow test blind to source; commit together (e2e runs at the gate). `"none"` — the steps.
   A `"none"` task authors NO new test file; a guard that seems missing is a PRIME RULE 1
   architect call (which lane owns it), never a test minted on the spot. Under `tdd`/`e2e` the
   test file IS part of the task's diff; if the plan omitted it from `files[]`, note the
   addition in `limitations`.
2. **Verify** — the `types` slot via `roadmap gate run <N> --slots types`; scope touched tests via
   the scoped slot (never a hand-built filter); a run that executed ZERO tests still exits green,
   so confirm a nonzero executed-test count before trusting a pass. A UI change runs `build`. **Any run expected
   under ~10 min is FOREGROUND in the turn — no exceptions, never a Monitor-park** (the
   long-run protocol covers genuinely long runs).
   A NEW guard (a check that reds when a claim about the TREE goes false) is mutation-proven per
   `references/guard-mutation-proof.md` before its commit, three results quoted; unproven = undone.
3. **Commit** — `<type>(<scope>): phase N — <task title>`. First, when the consumer binds a
   formatter (the `lint-diff` binding's `--write` twin, e.g. biome), run it on the task's
   touched files. A doc-touching task follows
   `skills/using-zeroh-roadmap/references/documentation-rules.md`; a decision without a
   critical trigger or user flag records itself in the `transparencyReport`, never a doc.
4. **Persist** `transparencyReport` + `done: true` + `doneDate`, same commit.
5. **Continue immediately** — the task boundary is a commit boundary, never a turn boundary.

**Batch tasks (`batchMode: true`, mechanical only):** one commit per `steps[]` entry (`… phase N
task N.X (k/M) — <step>`), the `types` slot each, NO forks; one aggregated `transparencyReport`
in a final commit. A step red twice running → STOP.

## Transparency contract (per task)

**Durable-lesson moment** — an error you recovered, a user correction, a surprising
re-derivation: flush it at once, `roadmap eval lesson "<text>" --writer <your model id> [--phase
N]`. EVENT-triggered, never on an interval.

Persist all six fields — `whatWasDone`, `how` (real content), and
`compromises`/`skipped`/`hardcoded`/`limitations` (the literal `"None"`, or ≥10 chars of substance
— `"n/a"`/`"tbd"` fail parse). Echo the four debt lines ONLY when not `"None"`.
A non-`"None"` `compromises` or `skipped` also requires `decisionRef` (the architect verdict or
user-ratification ref that authorized it): validate-roadmap-file v2 REDS the phase without it.

## Commit grammar (BINDING — the CLI parses these subjects)

`docs(roadmap): phase N — <desc>` · task commits carry `phase N` + the task id · `fix(scope):
phase N gate RX` · `docs(roadmap): mark phase N complete`. The CLI parses these (base-SHA
derivation, unverified-done detection, the beacon-stamp hook) — the `—` boundary stops 136
matching 1369.

**The LANDED subject** (what `phase curate` composes, and the style every commit that survives
curation should already aim at): `type(scope): phase N — <imperative summary>` ≤72 chars — the
change to the tree, never the story of making it (no round numbers, no task bookkeeping in the
subject; that detail lives in the body and the gate report).

## The gate (after the last task)

`roadmap gate plan <N>` prints the resolved cell (slots, scopes, floors, agent chain) for the
`kind`: mockup = lint+types; logic = Round 0 quality pass → Rounds 1..N correctness loop (cap 5);
hardening adds the closure integration rerun; release adds the e2e slot. Run `roadmap gate run
<N>` for the mechanical half, then the agent chain the plan names. **Record EACH agent round
into the gate report** as it finishes: `roadmap gate run <N> --record-round
'{"round":R,"agent":"code-reviewer","verdict":"clean","model":"<your model id>","summary":"…"}'` (round 0 = the
quality pass, rounds ≥1 = each correctness loop; `model` is the reviewer-attribution the
evals slice by — stamp it). `--verify-complete` (below) REFUSES a done
flip whose latest report carries no recorded agent round. A docs-only diff skips the quality
pass. Under arc-mode the gate runs only phase-relevant SCOPED
tests — the full suite defers to the arc end.

**Design-parity stage** (a task cites a `ux` designRef AND the diff touches a rendered surface): a
confirmed design is a CONTRACT. Apply `skills/validate-arc/references/parity-rubric.md` with FRESH
eyes (a spawned vision judge, never the implementer) — render via `live-ui`, screenshot every state
AND drive every interaction (hover/focus/transition), compare on its six axes. Fix material
deviations and re-compare; an out-of-scope residual → `compromises` naming the designRef; record a
`gateRounds` entry (`design-parity`).

**Echo contract:** after each gate-agent stage echo a ~10-line summary to chat (`[Quality pass]
nothing to fix` if empty).

**Sub-agent rule:** gate agents run synchronously; only the architect and `test-engineer` may
absorb phase work — never another phase-executor, `Explore`, or a fork for a "too-big" task.

## Curate the landed history

After the gate goes green, before Complete + return (that order is BINDING): run `roadmap phase curate <N>` (a DRY RUN —
read the plan: range, classification, groups, composed messages), then re-run with `--apply` to
land the phase as 1-3 logical commits (`--groups "1-3,4-6"` splits by task-id ranges when the
phase is genuinely composite). The command records the curation evidence — squashed SHAs and
every scratch/revert RED-proof pair — into the gate report BEFORE the squash. A
**foreign-commit refusal** (a sibling session's commit
interleaves the range) is recorded in the phase's `limitations` and left alone — history staying
granular is the honest fallback, NEVER a forced rewrite of someone else's work.

## Complete + return

Set in ONE edit: `status: 'done'`, `gate`, `gateRounds` (Round 0 at index 0, ≥1 entry),
`metrics`, `compromises`, `completedDate`, `executionResult` (with `driver: { model: <your
model id>, lane: 'session' | 'codex' }`) — in BOTH modes; `driver` lets the eval scorecard
attribute the outcome, absent scores as unrecorded. Then `roadmap gate run <N>
--verify-complete` (phase ↔ gate-report consistency — a done phase can no longer be narrated).

**Arc-mode** (iff `roadmap/.arc-mode` exists — read via `roadmap status` — OR this session IS a
phase-executor): commit the phase and **return the PhaseExecutionResult you persisted**
(`status` done/escalated/failed; map the roll-up). SKIP grooming, the emit slot, and the push —
the workflow serializes those.

**Standalone** (no arc-mode): after the completion commit, groom `roadmap/backlog.ts` (remove this
phase's entry + any single-phase narrative naming only it), run the `emit` slot, then push per the
consumer's `mergePolicy` (workflow serialization covers arc-mode only). **Worktree lane:** `roadmap
phase land <N>` REPLACES the bare push — it lands the curated commits on the integration branch
(guarded fast-forward, bounded retry) and pushes when the ref is push-authorized; grooming/emit
still happen, in the worktree, before the land so they ride the curated commits.

## Codex delegation lane (`roadmap codex run <N…>`)

When the session delegates implementation to Codex, use the CLI lane — never hand-roll the launch.
Poll `roadmap codex status <N>` (typed: running/complete/blocked/dead-no-report/closed). A whole
arc delegates as one run: `roadmap codex run --arc <ID>` (members in planes order). **Division of labor:** Codex runs each phase FULLY — tasks, per-task commits +
transparencyReports, the gate to green (an honestly-labeled codex-self-review gateRound, the
done-flip, `--verify-complete`). The session owns the back half only: AUDIT the commits and gate
claims against the plan (spot-check verifies; a false green is a bounce), then land it. Codex
never merges/pushes in ANY checkout, and never touches THIS repo's primary checkout (a cross-repo
phase's product commits in the OTHER repo's checkout are the plan's own instruction, not a
violation); for an arc, sweep/validate/land judgment stays with the session.

**Integration routing (after CODEX-RUN-COMPLETE):** run `roadmap phase land <N>` INSIDE the codex
worktree — it rebases onto the integration ref, guarded-ffs, pushes when authorized, then disposes
the worktree, its merged `codex/<N>` branch and the journal (renamed `.closed.json`, never
deleted). Disposal REFUSES — on stderr, land still green — on a dirty tree, commits no other ref
carries, or a live lane. Groom the backlog after. **Cross-repo phases ride the lane normally** —
the lane prompt carries the cross-repo instruction (product commits in the other checkout on its
checked-out branch, roadmap-state commits in the worktree); integration also pushes that branch.
