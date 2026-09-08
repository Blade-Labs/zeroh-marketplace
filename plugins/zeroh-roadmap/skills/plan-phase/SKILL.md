---
name: "Plan Phase"
description: "Create a new roadmap phase. Use when user says: create phase, plan phase, add to roadmap, new phase, add feature, create task. Scopes the intended change and public contracts, checks current evidence, then writes a reviewable .phase.ts plan. Small fully specified work uses a short path. Not this skill: planning a multi-phase arc (plan-arc, which loops plan-phase per member) or queueing/auditing an existing phase (review-phase owns the queue)."
user-invocable: true
metadata:
  keywords: plan, phase, create, new, roadmap, backlog, feature, add, task, implement
  aliases: create-phase, new-phase
---

# Plan Phase: Author a Known Diff

Write `<root>/…`, never a bare `roadmap/…`: the roadmap root is DISCOVERED. Rule: `skills/using-zeroh-roadmap/SKILL.md` (mechanics: its `references/layout.md`).

**Trigger:** `plan phase for X`, `/plan-phase`, `/create-phase`, `/new-phase`. Input: a bug report,
feature request, review finding, broad goal, or a `<root>/followups/<arcId>.md item K` reference
(arc-sweep's deferred blueprint: read the item, it IS the plan input).
**Flag:** `--skip-review` skips Step 7 for a WIP plan you know is unfinished; the report must then
say "plan unverified, not queued".
**Not this skill:** a whole arc is `plan-arc` (it runs the design-first gate, then loops plan-phase
per member); queueing, auditing, or re-reviewing an existing phase is `review-phase` (queueing is
its Mode A Step 8 act, never this skill's).

## Small, fully specified work

When the brief fixes the outcome and stack, one phase can carry the work, and no unresolved
architecture, authority or high-risk migration decision remains, use this short path. Record
that scope in notes. One task is valid; do not expand it to meet a task-count target.

1. Reuse supplied decisions. Ask only genuinely user-owned scope/preferences; an unresolved
   load-bearing technical choice exits this short path and follows Prime Rule 2. Read
   relevant source/configuration and applicable repository instructions once. Reuse that evidence
   while the inspected inputs are unchanged; refresh affected evidence after a change.
2. Run the bounded duplicate probe. Reuse a supplied reserved number; otherwise claim once.
   Author the existing phase shape using
   `references/phase-file-contract.md`: outcome, affected/new files, steps, acceptance, test strategy,
   and load-bearing assumptions. Fix public contracts; leave routine internal implementation choices
   to the executor. New files are planned additions, not missing existing anchors.
3. Apply `references/verify-rehearsal.md` and the closure checklist to applicable claims;
   report other members as not applicable, and required but unrun members as unrun.
   Do not implement the product in scratch merely to make future checks pass. Validate once,
   revalidating after a relevant edit; commit and run the same independent review in Step 7.

This changes planning effort, not required schema fields, review independence, gate floors or
intent acceptance. Use the existing phase/arc routing; this short path adds no delivery mechanism.
Continue into the detailed steps only for an unresolved requirement, not to replay these acts.

## PRIME RULE 1: KNOW THE CHANGE BEFORE WRITING THE TASK

Every task names its outcome, affected files and public contracts before code. If you cannot
name the specific files, functions, and nature of the change, you have not planned enough: go read
the code. "Rework masking" is a non-plan; "add the missing fail-closed category arm to
`maskPrompt` in `src/masking.ts`" is a plan. Work that cannot reach this precision becomes an
explicit *investigation task*, never a vague one.

## PRIME RULE 2: ESCALATE TO ARCHITECT BEFORE GIVING UP

Respect the owner’s time and token budget. For a load-bearing technical ambiguity, whenever you would otherwise
(a) write a vague low-confidence task, (b) drop a `[NEEDS CLARIFICATION]` marker, (c) split into
"investigate-first" sub-phases, or (d) STOP and ask the user a planning question, **first** invoke
`zeroh-roadmap:software-architect` (foreground, synchronous, single hop) per its **Decision
Contract** in `agents/software-architect.md`, passing the request, the files you read (brief
findings), where you got stuck, and the convenient-vs-proper paths. It returns `PROCEED_WITH_TASK`
(write the high-confidence task, no marker) or `ESCALATE_TO_USER` (the ONLY verdict that justifies
stopping, or a marker whose text IS the architect's question). Task-authoring only (Steps 2/3);
one ambiguity = one call. **Three or more escalations = the phase is too broad**: STOP, surface
it, propose a split. EVALCORE escalated the same unmade decision twice
mid-execution — a nameable unmade decision is this skill's failure: make it or escalate NOW.

## PRIME RULE 3: PLANNING NEVER MUTATES THE SHARED TREE BEYOND ITS OWN ARTIFACT

The planning act edits exactly its roadmap artifact: the new phase file (or, when Step 0 routes
there, an existing `<root>/phases/` file). It NEVER edits `<root>/backlog.ts` (honor-system;
queueing is review-phase's act), never applies the diff-to-be to the shared checkout, never
`git reset`/`git stash`/`git clean` sibling state, never `git add -A`. Probe experiments that need
a mutated file run against scratch copies in the session scratchpad or a throwaway
`git worktree add <scratchdir> HEAD` removed afterward (protocol in
`references/verify-rehearsal.md`). Commit explicit paths only: `git commit <path>`.

## Step 0: Interview + duplicate probe

A STANDALONE request gets an INTERVIEW by default, before any code investigation: one question
at a time, scope first, exactly as plan-arc interviews (user intent and scope at request time;
Prime Rule 2's architect owns TECHNICAL decisions during authoring: two different stops).
Skip ONLY by recording `interview: skipped — <why>` in the phase file's `notes`; an arc-member
phase cites the parent arc's interview instead of re-interviewing.
Genuinely user-owned forks are asked as AskUserQuestion options, never open-ended.
**Duplicate probe, every request, before claiming:** run
`grep -rln -F '<central symbol or topic>' <root>/phases <root>/backlog.ts` (fixed strings,
bounded paths) and skim `roadmap status`. A member phase of an arc ALSO runs
`grep -F 'rejectedAlternatives'` on the parent `.arc.ts` and reads the hits before authoring —
never re-propose a listed option. Existing coverage found: do NOT author a duplicate and
do NOT queue anything; hand the queue/priority ruling to the user with options. If the tracked
artifact IS the right home, improve IT instead of planning anew: re-run its `assumptions[].verify`
against the current tree, re-check every anchor, hunt contradictions between carried-forward notes
and task text (a wrong-seam note is a real executability defect), true stale counts, commit `plan(roadmap): phase N — <desc>` (the plan-edit
grammar review-phase also commits under), and re-run `roadmap phase validate <N>`.

## Step 1: Reserve the number

Reuse the reserved number supplied by plan-arc. Otherwise `roadmap claim` atomically reserves the next monotonic number across active+archive (wx-noclobber
lock — cli/commands/claim.mjs owns the mechanics). Never hand-compute max+1. The committed phase file supersedes the claim; there is no
manual release step.

## Step 2: Investigate the code FIRST (the most important step)

For each area: read the call chain; trace the symbol with Grep (imports, call sites,
registry/string-literal refs); identify the exact functions that change (named symbol, not
"somewhere in the file"); check downstream consumers; check for an existing utility or pattern to
reuse. Copy-paste symbol names from the file, never retype them (a FLUENTFRONT tripwire went
false-negative on a case-variant symbol). If you cannot do this for a piece of work, it is not a
task yet: make it an investigation task.

## Step 3: Write the phase file

Full field shapes, marker syntax, task design rules, testMode/standards citations, and
anti-patterns: `references/phase-file-contract.md`. The authoring decisions, in order:

**Pick `kind` first** (it drives gate selection — a deliberate act, never a default):
`mockup` (screen/layout/copy/branding/dark-mode) · `logic` (algorithm/business-rule/new behavior) ·
`hardening` (bug fix, persistence/event/marshal-chain fix, refactor, perf) · `release` (version
cut/changelog/infra/deploy). Torn between `logic` and `hardening`: choose `hardening` (an extra
integration rerun costs far less than an unverified persistence fix). `kind` is independent of `category`.

**Phase granularity for larger work: target 5-8 tasks** (gate cost is per-phase: gate chain, executor spawn,
serialization tail, so don't shard). Split below ~4 only for a nameable reason (risk isolation, a hard
dependency boundary, a distinct `kind`) — "felt like a separate topic" is not one. Past ~10
tasks you are in do-arc's HEAVY band. One task = one focused change; "and also..." is two tasks.
Order foundation → consumers → validation last; N.3 may depend on N.2, never N.4.
A `userFacing: true` phase slices vertically — no task batches a whole layer; each consumer-bound
task carries its change through to an observable its `→ verify:` names (detail:
`references/phase-file-contract.md` §Ordering).

**Cite the recorded timing reference class, never clock-feel.** Read
`<root>/arc-evals/timing-stats.json` and annotate the docblock with the cohort (task-count band ×
surface, where surface = any `keyFiles` path matching `web/`, `office/` or `spa/`, the table's own
heuristic; name it as one). Always the class AND its N:
`timing: band 4-6 × surface:false, N=8, median 60.8 min, p80 83.3 min`. No matching cohort,
`samples: 0`, or no stats file: write the literal `timing: no reference data for <band>×<surface>`.
Never an invented range or a classless number.

**Author the `assumptions` tripwires.** Every load-bearing claim about the current territory
whose FALSITY WOULD CHANGE THE PLAN (the RAGUNIFY 1343.6 miss) becomes
`{ claim, verify: '<one runnable command>', onFalse: 'ESCALATE' }`. 2-6 typical (beyond ~6 you are
re-testing the tree instead of the load-bearing claims); **zero is legitimate for a pure-prose phase — say so
in the notes**. Not every `keyFiles` anchor is an assumption.

**Run cheap current-state probes and encode the observed result.** Run load-bearing
assumption and source checks now. Product test suites, builds and future-behavior checks belong
to execution; name their expected outcomes without claiming they ran. Reuse unchanged evidence. When a task enumerates per-item verdicts
(per-slot sweeps, per-connector states), the vocabulary MUST be able to express every outcome its
probe can yield; include the honest escape member (`observed: <result>`) — a closed
enum dead-ends the executor.

**Check verify meaning before writing it; run product red/green during execution** (the single most repeated authoring
defect: SEODESKFIX shipped four backward verifies across three phases; UCAUDIT, 8 of 20 member
phases carried one that could not fail). Current assumptions, future/retained behavior,
cheap polarity checks and observables:
`references/verify-rehearsal.md`. Enforcement: `roadmap phase validate` carries a WARN-level
polarity+grammar lint (new-to-git phase files only); review-phase Mode A is the gate.

**Steps are contracts, not essays.** A description states the DECISION — names, signatures, the
non-obvious constraint — plus its anchor; rationale lives in the designRef/execution prompt, cited
never restated (`roadmap phase validate` WARNs past 700 chars, new-to-git files). A task consuming
a sibling's output declares the optional `interfaces: {consumes, produces}` field — exact symbol
names; shape + example: `references/phase-file-contract.md`.

**The `step → verify:` grammar (REQUIRED).** Every `steps[].description` ends with
`" → verify: <one command or observable>"` naming how the executor PROVES the step landed. Example:
`"route the model write through runGovernedToolCall → verify: node --import tsx --test src/office/agui.test.ts"`
Grandfather rule: phase files already committed to git are
exempt (the lint checks for a HEAD blob); it warns on files NEW to git only.

**Declare `userFacing` IN THE FILE.** User-visible behavior: `userFacing: true` plus a `flag` in
one of the two shapes in `references/phase-file-contract.md`; cite the consumer CLAUDE.md "Flag-first
delivery" rule, never restate it — a paraphrase once shipped a polarity drift. Not user-facing: `userFacing: false` plus one
notes line saying why no flag applies. Either way the claim lives in the artifact the executor and
reviewer read, never only in the chat report. `roadmap phase validate` reds `userFacing: true`
with no `flag` (rule `userFacing-without-flag`).

**`testScope` / `reviewScope`** (optional; shapes and ladder in
`references/phase-file-contract.md`): a declared `testScope` may only RAISE the diff-derived floor;
a declared `reviewScope` below `full` requires a one-line note WHY the skipped stages are low-value
(Mode A ratifies or reds it); a `gateSpecialists` path always gets `full` review and the
`relevant`-tests floor. Never declare either to sneak under the floor the diff warrants.

**Release-coupled steps and removals.** A step whose completion rides a release act (a tag
re-vendor into the sibling repo, a prod app-setting arm, a catalog publish) gets a task appending
a `hold[]` entry to `release/activation.json` — the file the release lane reads (the consumer
CLAUDE.md `hold[]` rule; never prose, never a guard left to red the next tag). A removal task sweeps what DESCRIBES the removed behavior, not only what implements it:
de-stale test titles naming it (keep the assertions that remain the regression pin), and true
every doc and backlog anchor that names it.

**`[NEEDS CLARIFICATION]` markers** (only after an `ESCALATE_TO_USER` verdict; enforced:
`do-phase`/`review-phase` refuse a marked phase). Embed a SPECIFIC named question in the task's
`problem`/`acceptanceCriteria`, never "TBD". A marked phase may commit on disk but must never be
queued until every marker resolves. Never guess and leave a silent assumption: the marker is the
honest answer.

## Step 4: Validate

`roadmap phase validate <N>` (write engine + emit): Zod parse via the tsx bridge, structural
checks (duplicate top-level keys, `userFacing-without-flag`, duplicate phase number,
claim-before-start), and the WARN polarity+grammar lint on new-to-git files. Fix every failure;
failures are never waived. What validate does NOT check: task size. `files ≤10` / `steps ≤6`
unless that TASK sets `batchMode: true` is this skill's own plan-time refusal (the size lint's owners per the
`PhaseTaskShape` docblock; review-phase re-checks, `roadmap audit` check 11 reds escapes at HIGH).

## Step 5: Self-verify (judgment checklist against current evidence)

The judgment members live in `references/closure-checklist.md`; run them against the CURRENT tree,
using the inspected inputs (refresh changed inputs), in the checklist's listed order (BLOCKER-yield members lead) so a time-boxed
pass still catches the worst defects; report any unrun member as unrun, never silently skip.
Three members exist because real arcs shipped without them (FLUENTFRONT, BRAINVIEW, EVALCORE;
provenance in the checklist). Fix everything found, re-run `roadmap phase validate <N>`.

## Step 6: Commit

`docs(roadmap): phase N — <desc>` (the consumer's roadmap commit grammar, em-dash included),
staging the phase file path explicitly. Commit with unresolved markers ONLY if the phase is not
being queued; otherwise clear them all first.

## Step 7: Auto-invoke `/review-phase N` (MANDATORY unless `--skip-review`; honor-system)

Review the committed phase using review-phase Mode A (status `backlog`), dispatched as follows.
After authoring, dispatch a fresh review-phase reviewer using the host's role resolver; the author
cannot substitute an inline self-review. On Codex use `roadmap codex review N`, then
`roadmap codex status N --review` for the result. The supervisor applies reported repairs and
owns Step 8 queueing only after READY. A standalone user-requested review still follows review-phase.
**This pass is EXECUTED, never "reviewed inline"** (standing user ruling: every authored phase
gets an explicit review pass); make its evidence git-visible: fix each finding and commit the
repairs SEPARATELY as `docs(roadmap): phase N — address review findings`, so anyone can
corroborate the pass from history. READY → Mode A Step 8 queues the phase in `<root>/backlog.ts`
at the position reasoned from `priority` + `dependsOn` + `conflictsWith`; report "queued at index
K". NEEDS WORK/BLOCKER → fix, commit, do NOT loop; the phase is NOT queued until a clean
re-review. A duplicate collision surfacing here (Step 0's probe re-run against the moved tree) is
never resolved by queueing anyway: report it, hand the ruling to the user.

## Report

State exactly: phase number + file + task count; ready-or-needs-investigation; key risks and
cross-phase deps; probes run at plan time with observed results; backlog placement ("queued at
index K" / "not queued — NEEDS WORK" / "--skip-review: plan unverified, not queued" / "collision:
ruling handed to user"); each `[NEEDS CLARIFICATION]` marker with its task id; any checklist
member left unrun; the review outcome.
