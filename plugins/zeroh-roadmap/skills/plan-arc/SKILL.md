---
name: "Plan Arc"
description: "Plan a whole arc (a named, contiguous block of phases shipped as one unit): author the Arc entity, resolve the design-first gate WITH the user (reuse / new design / inherited ratified prototype / recorded skip), plan every member phase against that design, review each independently, queue one arc tier. Triggers: 'plan arc', '/plan-arc', 'create arc', 'new arc'. Not this skill: one standalone phase (plan-phase) or executing an existing arc (do-arc)."
user-invocable: true
metadata:
  keywords: plan arc, create arc, new arc, arc
  aliases: new-arc
---

# Plan Arc - Arc Planning Protocol

Write `<root>/…`, never a bare `roadmap/…`: the roadmap root is DISCOVERED. Rule: `skills/using-zeroh-roadmap/SKILL.md` (mechanics: its `references/layout.md`).

Turn "plan arc X" into a queued, executor-ready arc: the `Arc` entity, the design-first
gate with the user, decisions complete, every phase planned against the confirmed design,
every promise mapped to a task, review fanned out, validated, queued as one arc tier,
handed off with `/do-arc <id>`.

## Trigger

User says: `plan arc`, `/plan-arc`, `create arc`, `new arc`.
**Not this skill:** one standalone phase -> `plan-phase`; building / sweeping / validating
an existing arc -> `do-arc` / `arc-sweep` / `validate-arc`. An arc is a named block of phases
shipped as one unit. Work one phase can carry routes to `plan-phase`, except when the
requested PR delivery needs the existing arc identity.

## Single-phase delivery

For plan-phase's small, fully specified scope with authorized PR delivery, retain one ordinary
arc and one phase. Use `../plan-phase/references/small-project.md`; no new mode, receipt or
scheduler is required. Reuse the supplied decisions, record the existing interview/design ruling,
and keep the user's outcome in the arc criteria. Unresolved design decisions still use Step 1b.
Use a compact promise-to-task mapping in the arc and a short execution prompt that points to it;
do not restate the brief in each artifact. Plan the member through plan-phase's short path with
`--skip-review` because Step 3 owns its independent review. The supervisor owns Lane A's cheap
mechanical checks; one independent reviewer owns Lane B's judgment. Queue only after READY.
Existing do-arc execution, sweep, independent intent validation, delivery and resume still apply.
Read detailed sections below only for an unresolved contract; do not replay completed checks.

## Arguments

- **`<id>`** (optional): the Arc id; if omitted, propose one and confirm with the user.

## Evidence discipline (binds every step)

Plan facts read COMMITTED state at a named ref (normally the arc's `baseRef`): never
build on uncommitted sibling dirt, and call work committed only after
`git log` / `git status --porcelain` on that exact path. Every
count and every "the validator accepted it" claim is pasted command output, never memory.
A littered sandbox: preserve it on a branch, `roadmap worktree reset --base <ref>`, replan.

## Step 1: Author the Arc entity

Write `<root>/arcs/<id>.arc.ts` with `defineArc` BEFORE any phase is planned (template:
arc-integrity.md §0; zod `.parse()` + `crossValidate` enforce the shape and planes/phases
drift). Decide WITH the user: `planes`, `singleSeams`, `honestyRails`,
`acceptanceCriteria`, `baseRef`; fill `planes[].phases` in Step 2a.

**Interview first (before criteria or the gate).** One question at a time, prioritizing
answers that change architecture or scope; record each as a ONE-LINE dated ruling in the
arc's **LOCKED DECISIONS** comment block (user intent here; the Step-1b architect owns
TECHNICAL decisions). A ruling that REJECTS an option ALSO appends a `rejectedAlternatives`
entry to the arc; the comment line cites the entry, never restates the why (one home per fact). Narrative rationale - research digests, coverage/pricing findings -
lives ONLY in the execution prompt (Step 4); the arc header comment, phase `source`
fields, and designRef summaries CITE it, never restate it. Skip ONLY by recording
`interview: skipped - <why>` (design pre-ratified / mechanical).

**A user ruling is law.** When the user waives an artifact or makes a scope call ("no
acceptance criteria", "skip the interview"), record the ruling verbatim in the `.arc.ts`
and COMPLY - never author the waived artifact; at most one recorded line names the
consequence. Overriding a legal call "for quality" is the violation, not a favor.

**Size the phase count** per plan-phase "Phase granularity" (gate + executor cost is
per-phase; consolidate 2-3-task phases before reserving; size against
`<root>/arc-evals/timing-stats.json` medians).

**Elicit `acceptanceCriteria` - never invent, never dilute.** Author them WITH the user
in user-outcome terms, before the build (grading against planner-invented criteria is
circular). **The user's outcome language is BINDING:** quote the stated signal verbatim into a
criterion (+ its Step 2c row); a cheaper proxy (deferred, reworded weaker, or fired only
incidentally) is an escalation the user must approve, never a silent substitution. Each criterion names the `job` (the JTBD), `signal`, `bar`, `surfaces`, and
the cheapest `tier` that honestly judges it; one or two sharp beat ten vague.
**Judge-state rule (arc-integrity.md §1):** every `signal` names the STATE it is judged
under - realistic density (name the number), a second visit, post-churn - never cold-only.

## Step 1b: Design-first gate (classify -> architecture + UX reuse-or-design -> confirm)

Run before Step 1c; contracts: `references/design-gate.md`.

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
prints resolved bindings); **absent key -> surface it and STOP the gate** (remedy: using-zeroh-roadmap/references/layout.md §Missing homes) (honor-system
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
   (`-dark`, `-v2`, siblings). More than one -> list every sibling and put the
   canonical-naming question to the user before any is evolved.
2. Spawn the `ux-designer` agent (an advisor, like the architect): it designs inside the consumer's
   UX canon, picks the form from design-gate.md §3 (**design-locked prototype = the
   DEFAULT for a net-new/regrouped surface**), meets `references/ux-craft.md` (pass its
   absolute path + the quality exemplar when `designHomes` names one).
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
**designRefs** · **DEFERRED - named owner + escalation point**. A load-bearing choice (two reasonable
executors would build it differently) in no bucket -> back to the interview (EVALCORE
escalated one unmade decision twice in a task).

## Step 2a: Reserve the phase-number block FIRST

Reserve ONCE, up front: `roadmap claim --count <N>` (N = member phases across
`arc.planes`; the CLI owns the lock; numbers need uniqueness, NOT contiguity). Write the claimed
numbers into `arc.planes[].phases` (plane order) and re-save the `.arc.ts` so
`crossValidate` passes. Pass each explicit number into the Step 2b loop - a
per-iteration recompute collides across sessions.

## Step 2b: Plan each member phase (plan-phase --skip-review)

Loop `plan-phase` over the reserved numbers in dependency / plane order:
- Pass the explicit phase number; pass **`--skip-review`** (reviews batch in Step 3). Set
  each phase's **`arcId`** and **`plannedBy: { model: <your own model id> }`**.
- **Copy vocabulary, never coin it:** every enum-valued field (phase status, task status,
  gate results) takes a value from the `z.enum` unions in `<root>/lib/schema.ts` or from
  a schema-valid queued phase at HEAD; a guessed word fails `roadmap phase validate`
  and ships an unexecutable queue.
- **Plan AGAINST the confirmed design.** Each task cites the designRef `ref` + `summary`
  it implements; a phase that would deviate must **reopen Step 1b**, never diverge.
- **`source` cites, never narrates:** <=2 lines - arc + plane + the designRef pointer;
  rationale stays in the execution prompt.
- **Anchor by symbol, never by line:** existing paths/symbols resolve at the inspected ref.
  Planned additions name their creating task and public contract, not an existing HEAD symbol.
  A `file.ts:123` anchor is stale by execution time.
- **Escalate, never guess:** a choice outside the three buckets stops the loop.

## Step 2c: Promise ledger - every arc promise names its fulfilling task

Before review, build the coverage table (template + row sources: arc-integrity.md §3):
one row per `acceptanceCriteria[].id`, per `designRefs[].ref`, per honesty rail, per
single seam, per build-implying LOCKED DECISION, **and per item/outcome the user's
request states, quoted verbatim** -> the `phase.task` that fulfills it. An item unfulfillable
as written is REFRAMED to its nearest real mechanism (named file/command/store), the
mapping recorded in its row - never dropped or silently swapped. Write the ledger as a comment block in the `.arc.ts`. An UNMAPPED row is a promise no
phase keeps: add the task or delete the promise WITH the user (the FLUENTFRONT
empty-set failure, arc-integrity.md §3).

## Step 3: Fan out plan-quality review (two lanes per phase, parallel, read-mostly)

Review all member phases in parallel - one agent per phase, each given the reviewer
packet from arc-integrity.md §4, each returning one READY / NEEDS WORK / BLOCKER verdict:
- **Lane A - spec compliance (mechanical; full checklist §4):** ledger-row coverage;
  existing files/symbols resolve at the inspected ref; planned additions name their creating task
  and contract. Apply plan-phase/references/verify-rehearsal.md: current assumptions and cheap
  polarity probes now, product red/green in execution. A missing planned test is not passing
  evidence, nor a requirement to implement it during planning. Reuse current validator results.
- **Lane B - plan quality (judgment):** `review-phase` Mode A with **`--no-queue`**,
  model per `modelPolicy.judgeModel` in `roadmap.config.json`. **Band-scoped:** Lane B
  defaults ON and is SKIPPED only when a phase is kind:mockup, docs-only (every keyFiles
  path *.md/*.html), or all-tasks-batchMode, AND no keyFiles path matches a
  `gateSpecialists` path (roadmap.config.json - the hard floor), AND the phase is not the
  arc's keystone (last phase of the last plane). A skipped Lane B is recorded per phase in
  the closing report as "Lane B: band-skipped (<reason>)" - a recorded decision, never a
  refusal condition.

**Edit confinement (honor-system, checked after the fact):** each reviewer edits ONLY its
own `<root>/phases/phase-<N>.phase.ts` - never `<root>/backlog.ts`, never a sibling.
After the fan-out run `git status --porcelain <root>/backlog.ts <root>/phases/`; revert
any out-of-scope touch and redo that phase's review serially.

## Step 4: Validate with the consumer's own tooling, then queue serially

**First act:** run `roadmap phase validate <N|file>` on every member phase file AND the
`.arc.ts`; paste each verbatim result into the closing report (arc-integrity.md §5) - an
unpasted "the validator accepted it" is fabricated evidence. Any exit 2 -> fix, re-review
that phase, re-validate; never queue around it.

**Author the execution prompt** (pre-queue): `<root>/arc-prompts/<id>-execution-prompt.md`
- the arc's bar, honesty rails, design refs, research basis; the ONE home of arc
rationale and the file do-arc reads before driving.

After ALL reviews return, you ALONE write `<root>/backlog.ts` - serially, one pass -
placing READY phases as a single arc tier, respecting the dependency floor + priority
(review-phase Mode A Step 8). **Label the tier with the arc + its EXACT claimed
numbers**; use an `N-M` range only when every number in the span belongs to THIS arc -
claims are unique, not contiguous, and a spanning label annexes other arcs' phases. Do
NOT queue a NEEDS WORK / BLOCKER phase - surface its findings; the user fixes and
re-reviews first. **Lane B could not run** on an ELIGIBLE phase (judge model unreachable,
fan-out impossible, budget exhausted; a band-skip is not this) -> REFUSE to queue: close with "planned, NOT queued - review pending"
plus the reason; self-review never substitutes for the independent lane. **Done is an
artifact pair:** the queued tier (or the recorded refusal) plus the closing report, in
which every "done" claim carries the command that would have failed it. Then hand off:
`/do-arc <id>`.
