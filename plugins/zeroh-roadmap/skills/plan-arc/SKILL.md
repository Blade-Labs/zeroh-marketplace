---
name: "Plan Arc"
description: "Plan a whole arc (a named, contiguous block of phases shipped as one unit): author the Arc entity, resolve the design-first gate WITH the user (reuse / new design / inherited ratified prototype / recorded skip), plan every member phase against that design, review each independently, queue one arc tier. Triggers: 'plan arc', '/plan-arc', 'create arc', 'new arc'. Not this skill: one standalone phase (plan-phase) or executing an existing arc (do-arc)."
user-invocable: true
metadata:
  keywords: plan arc, create arc, new arc, arc
  aliases: new-arc
---

# Plan Arc - Arc Planning Protocol

Turn "plan arc X" into a queued, executor-ready arc: write the `Arc` entity, resolve the
design-first gate with the user, sweep decisions complete, plan every phase against the
confirmed design, map each arc promise to a fulfilling task, fan out review, validate
with the consumer's own tooling, queue one arc tier, hand off with `/do-arc <id>`.

## Trigger

User says: `plan arc`, `/plan-arc`, `create arc`, `new arc`.
**Not this skill:** one standalone phase -> `plan-phase`; building / sweeping / validating
an existing arc -> `do-arc` / `arc-sweep` / `validate-arc`. An arc is a named block of
phases shipped as one unit; work one small phase can carry routes to `plan-phase` - say
so and route it, never inflate it into an arc.

## Arguments

- **`<id>`** (optional): the Arc id (`Arc.id`, number or short string, e.g. `B`); if
  omitted, propose one and confirm it with the user.

## Evidence discipline (binds every step)

Plan facts read COMMITTED state at a named ref (normally the arc's `baseRef`): never
build on uncommitted sibling dirt, and call work "committed" vs "uncommitted" only after
`git log --oneline -- <path>` / `git status --porcelain <path>` on that exact path. Every
count and every "the validator accepted it" claim is pasted command output, never memory.
A littered sandbox: preserve it on a branch, `roadmap worktree reset --base <ref>`, replan.

## Step 1: Author the Arc entity

Write `roadmap/arcs/<id>.arc.ts` with `defineArc` BEFORE any phase is planned, so phases
plan against a fixed frame (template verbatim: arc-integrity.md §0). `defineArc`'s zod
`.parse()` enforces the shape at import and `crossValidate` (both in
`lib/roadmap/schema.ts`) rejects planes/phases drift. Decide WITH the user: `planes`, `singleSeams`, `honestyRails`, `acceptanceCriteria`,
`baseRef`; fill `planes[].phases` in Step 2a once numbers are reserved.

**Interview first (before criteria or the gate).** Interview one question at a time,
prioritizing questions whose answers change architecture or scope; record the answers as
the arc's **LOCKED DECISIONS** comment block (convention: `roadmap/arcs/VOICE.arc.ts`) so
they bind every phase (user intent here; the Step-1b architect owns TECHNICAL decisions).
Skip ONLY by recording `interview: skipped - <why>` (design pre-ratified / mechanical).

**A user ruling is law.** When the user waives an artifact or makes a scope call ("no
acceptance criteria", "skip the interview"), record the ruling verbatim in the `.arc.ts`
and COMPLY - never author the waived artifact; at most one recorded line names the
consequence (e.g. `acceptanceCriteria: [] // user ruling: none - validate-arc is a
deliberate no-op`). Overriding a legal call "for quality" is the violation, not a favor.

**Size the phase count** (plan-phase "Phase granularity"): gate + executor cost is
per-phase and v1 arcs run sequentially, so phase count tracks wall-clock and token cost;
target 5-8 tasks/phase, consolidating 2-3-task phases before reserving numbers, sized
against `roadmap/arc-evals/timing-stats.json` medians.

**Elicit `acceptanceCriteria` - never invent, never dilute.** Author them WITH the user
in user-outcome terms, before the build (grading against planner-invented criteria is
circular). **The user's outcome language is BINDING:** quote the request's stated signal
verbatim into a criterion (and its Step 2c ledger row); a plan delivering a cheaper proxy
- the stated signal deferred to a follow-up, reworded weaker, or shown only when
something else happens to fire - is an escalation the user must approve, never a silent
substitution. Each criterion names the `job` (the JTBD), `signal`, `bar`, `surfaces`, and
the cheapest `tier` that honestly judges it; one or two sharp beat ten vague.
**Judge-state rule (arc-integrity.md §1):** every `signal` names the STATE it is judged
under - realistic density (name the number), a second visit, post-churn - never cold-only.

## Step 1b: Design-first gate (classify -> architecture + UX reuse-or-design -> confirm)

Run before Step 1c - the front-gate mirror of `validate-arc`; contracts:
`references/design-gate.md`.

**Gate conduct - the user IS the gate (full contract: design-gate.md §0).** Every PAUSE
is arm-preserving: present EVERY viable option, including ones you recommend against,
each priced with fresh verified evidence (command + pasted output); until the user rules,
evidence-gathering is READ-ONLY - no commit may remove or foreclose an option. User
unreachable (batch run) -> record `UNRATIFIED - user go pending` instead of skipping the
sub-gate; an UNRATIFIED ref blocks Step 4 queueing of every dependent phase.

**(1) Classify** (criteria: design-gate.md §1): **New pattern?** · **UX surface?** If
NEITHER fires, record the skip in the `.arc.ts` (`design gate: skipped - no new pattern /
no surface`) and go to Step 1c. **Inherited design:** an arc implementing an already
user-RATIFIED design-locked prototype cites the ratification + the prototype directory as
its designRef and runs NO fresh UX sub-gate; plan mechanically per design-gate.md §5.

**(2) Architecture sub-gate** - fires on a new pattern/tool/seam. Read the doc home from
the `designHomes` key in the consumer's `roadmap.config.json` (`roadmap config check`
prints resolved bindings); **absent key -> surface it and STOP the gate** (honor-system
stop). Then per design-gate.md §2: spawn the `software-architect` agent to search the doc
home AND the prior-arc record and recommend reuse-or-design with a named "prior art:"
line (`none found` is legal; silence is not a search). The orchestrator owns every write
(§2): record `{ kind: 'architecture', ref, status: 'reused' | 'designed', summary }` onto
`designRefs`; a `designed` pattern extends the doc set via the consumer's doc governance,
carries the generalize-forward verdict, and stamps any superseded designRef in the same
commit. **PAUSE for the user's explicit go.**

**(3) UX sub-gate** - fires on a surface; run after the architecture sub-gate.
1. **Enumerate existing artifacts FIRST** (`references/ux-craft.md` §0): `ls` the
   consumer's preview/design directories for the target surface including variants
   (`-dark`, `-v2`, siblings). More than one exists -> list EVERY sibling by name in the
   ask and put the canonical-naming question to the user explicitly before any is evolved.
2. Spawn the `ux-designer` agent (an advisor, like the architect): it designs inside the
   consumer's UX canon, picks the form from design-gate.md §3's table (**design-locked
   prototype is the DEFAULT for a net-new or regrouped app surface**), and meets
   `references/ux-craft.md`; pass that file's absolute path (its §3b requires it) plus
   the quality-exemplar path when `designHomes` names one.
3. Record `{ kind: 'ux', ref, status: 'reused' | 'designed', summary }` onto `designRefs`;
   **PAUSE for the user's explicit go.** A no-surface arc records the sub-gate skip.
4. **Mint the paired conformance criterion (MANDATORY; templates verbatim in
   design-gate.md §3b):** design-locked prototype -> objective visual-diff acceptance on
   every implementing phase, NEVER a subjective "matches the design" criterion; any other
   confirmed UX design -> the `ux-parity:<slug>` 1:1 criterion.

Treat the confirmed `designRefs` as the spec: Step 2b plans against them, validate-arc
judges the paired criteria, arc-sweep audits per ref.

## Step 1c: Decision-completeness sweep (before any number is claimed)

Walk each planned plane and list every choice a phase author or executor will need -
naming, storage, contract shapes, UI placement, flag posture, ordering (checklist:
arc-integrity.md §2). Sort every row into exactly one bucket: **LOCKED DECISIONS** ·
**designRefs** · **DEFERRED - named owner + escalation point**. A load-bearing choice
(two reasonable executors would build it differently) in no bucket -> back to the
interview; EVALCORE escalated one unmade decision twice inside a single task.

## Step 2a: Reserve the phase-number block FIRST

Reserve ONCE, up front, via the atomic claims store: `roadmap claim --count <N>` (N =
member phases across `arc.planes`) locks the numbers collision-free across worktrees
(creation is the lock; numbers need uniqueness, NOT contiguity). Write the claimed
numbers into `arc.planes[].phases` (plane order) and re-save the `.arc.ts` so
`crossValidate` passes. Pass each explicit number into the Step 2b loop so `plan-phase`
never recomputes one - per-iteration recompute collides across concurrent sessions.

## Step 2b: Plan each member phase (plan-phase --skip-review)

Loop `plan-phase` over the reserved numbers in dependency / plane order:
- Pass the explicit phase number; pass **`--skip-review`** (reviews batch in Step 3). Set
  each phase's **`arcId`** and **`plannedBy: { model: <your own model id> }`**.
- **Copy vocabulary, never coin it:** every enum-valued field (phase status, task status,
  gate results) takes a value from the `z.enum` unions in `lib/roadmap/schema.ts` or from
  a schema-valid queued phase at HEAD; a guessed word ("planned", "pending") fails
  `roadmap phase validate` and ships an unexecutable queue.
- **Plan AGAINST the confirmed design.** Each task cites the designRef `ref` + `summary`
  it implements; a phase that would deviate must **reopen Step 1b**, never diverge.
- **Anchor by symbol, never by line:** cite `steps[].file` paths plus exported symbols an
  exact `grep -F` finds at HEAD - a `file.ts:123` anchor is stale by execution time.
- **Escalate, never guess:** a choice outside the three buckets stops the loop.

## Step 2c: Promise ledger - every arc promise names its fulfilling task

Before review, build the coverage table (template + row sources: arc-integrity.md §3):
one row per `acceptanceCriteria[].id`, per `designRefs[].ref`, per honesty rail, per
single seam, per build-implying LOCKED DECISION, **and per item/outcome the user's
request states, quoted verbatim** -> the `phase.task` that fulfills it. An item
unfulfillable as written is REFRAMED to its nearest real mechanism (name the real file,
command, or store) with the mapping recorded in its row - never dropped, never silently
swapped. Write the ledger as a comment block in the `.arc.ts`. An UNMAPPED row is a
promise no phase keeps: add the task or delete the promise WITH the user - FLUENTFRONT
shipped a set every phase docblock claimed to append to EMPTY (arc-integrity.md §3).

## Step 3: Fan out plan-quality review (two lanes per phase, parallel, read-mostly)

Review all member phases in parallel - one agent per phase, each given the reviewer
packet from arc-integrity.md §4, each returning one READY / NEEDS WORK / BLOCKER verdict:
- **Lane A - spec compliance (mechanical; full checklist §4):** ledger-row coverage;
  every `steps[].file` + cited symbol hits case-sensitive `grep -F` at HEAD; every verify
  EXECUTED in both directions - green as written, red under its falsification probe. No
  achievable red = NEEDS WORK: UCAUDIT queued 8 of 20 phases carrying one.
- **Lane B - plan quality (judgment):** `review-phase` Mode A with **`--no-queue`**,
  model per `modelPolicy.judgeModel` in `roadmap.config.json`.

**Edit confinement (honor-system, checked after the fact):** each reviewer edits ONLY its
own `roadmap/phases/phase-<N>.phase.ts` - never `roadmap/backlog.ts`, never a sibling.
After the fan-out run `git status --porcelain roadmap/backlog.ts roadmap/phases/`; revert
any out-of-scope touch and redo that phase's review serially.

## Step 4: Validate with the consumer's own tooling, then queue serially

**First act:** run `roadmap phase validate <N|file>` on every member phase file AND the
`.arc.ts`; paste each verbatim result (exit code + output line) into the closing report
(contract: arc-integrity.md §5). Claim ONLY what the tool printed - "the validator
accepted it" without a pasted run is fabricated evidence. Any exit 2 -> fix, re-review
that phase, re-validate; never queue around it.

After ALL reviews return, you ALONE write `roadmap/backlog.ts` - serially, one pass -
placing READY phases as a single arc tier, respecting the dependency floor + priority
(review-phase Mode A Step 8). **Label the tier with the arc + its EXACT claimed
numbers**; use an `N-M` range only when every number in the span belongs to THIS arc -
claims are unique, not contiguous, and a spanning label annexes other arcs' phases. Do
NOT queue a NEEDS WORK / BLOCKER phase - surface its findings; the user fixes and
re-reviews first. **Lane B could not run** (judge model unreachable, fan-out impossible,
budget exhausted) -> REFUSE to queue: close with "planned, NOT queued - review pending"
plus the reason; self-review never substitutes for the independent lane. **Done is an
artifact pair:** the queued tier (or the recorded refusal) plus the closing report, in
which every "done" claim carries the command that would have failed it. Then hand off:
`/do-arc <id>`.
