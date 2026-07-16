---
name: "Plan Phase"
description: "Create a new roadmap phase. Use when user says: create phase, plan phase, add to roadmap, new phase, add feature, create task. Reads the code first, identifies specific file paths, then writes a .phase.ts file."
user-invocable: true
metadata:
  keywords: plan, phase, create, new, roadmap, backlog, feature, add, task, implement
  aliases: create-phase, new-phase
---

# Plan Phase — High-Confidence Task Design

**Trigger:** `plan phase for X`, `/plan-phase`, `/create-phase`, `/new-phase`. Input can be a bug
report, feature request, review finding, broad goal, or a `roadmap/followups/<arcId>.md item K`
reference (arc-sweep's deferred blueprints — read the item, it IS the plan input).
**Flag:** `--skip-review` skips the Step-7 review pass (a WIP plan you know is unfinished).

## PRIME RULE 1: KNOW THE DIFF BEFORE WRITING THE TASK

Every task is planned to the point where you know the **exact diff** before any code. If you cannot
name the specific files, functions, and nature of the change, you haven't planned enough — go read
the code. "Rework calculations" is a non-plan; "add the missing deduction to
`settlement.ts:calculateTotal` (~line 142)" is a plan.

## PRIME RULE 2: ESCALATE TO ARCHITECT BEFORE GIVING UP

Tokens are not the constraint; hallucinations and shortcuts are. Whenever you would otherwise
(a) write a vague low-confidence task, (b) drop a `[NEEDS CLARIFICATION]` marker, (c) split into
"investigate-first" sub-phases, or (d) STOP and ask the user a planning question — **first** invoke
`zeroh-roadmap:software-architect` (foreground, synchronous, single hop) per its **Decision
Contract** in `agents/software-architect.md`, passing the request, the files you read (brief
findings), where you got stuck, and the convenient-vs-proper paths. It returns `PROCEED_WITH_TASK`
(write the high-confidence task — no marker) or `ESCALATE_TO_USER` (the ONLY verdict that justifies
stopping, or a marker whose text IS the architect's question). Task-authoring only (Steps 2/2b/3);
one ambiguity = one call. **Three+ escalations = the phase is too broad** — STOP, surface, ask to split.

## Protocol

### Step 1 — Reserve the number
`roadmap claim` atomically reserves the next monotonic number across active+archive (the claim is
the lock — sessions never collide). Never hand-compute max+1.

### Step 2 — Investigate the code FIRST (the most important step)
For each area: read the call chain; trace the symbol with Grep (imports, call sites, registry/
string-literal refs); identify the exact functions and lines that change ("~line 142" ok,
"somewhere in the file" not); check downstream consumers; check for an existing utility/pattern to
reuse. **If you can't do this for a piece of work, it isn't a task yet** — make it an investigation task.

### Step 2b — `[NEEDS CLARIFICATION]` markers (only after an ESCALATE_TO_USER verdict)
Precondition: you invoked the architect and got `ESCALATE_TO_USER`. Markers are for genuine
ambiguity source cannot answer (an unexpressed business rule, a two-way product decision, an
environment constraint outside the repo). Embed one in the task's `problem`/`acceptanceCriteria`
naming a SPECIFIC question (never "TBD"). A marked task is NOT executable: the phase may commit on
disk but must NOT be queued until every marker resolves (`do-phase`/`review-phase` refuse a marked
phase). Never guess and leave a silent assumption — the marker is the honest answer.

### Step 3 — Write the phase file

**Pick `kind` first** (drives gate selection): `mockup` (screen/layout/copy/branding/dark-mode) ·
`logic` (algorithm/business-rule/new behavior) · `hardening` (bug fix, persistence/event/
marshal-chain fix, refactor, perf) · `release` (version cut/changelog/infra/deploy). Torn between
`logic` and `hardening` → `hardening` (an extra integration rerun ≪ an unverified persistence fix).
`kind` is independent of `category`.

**Phase granularity — gate cost is per-phase, so don't shard.** Every phase pays a fixed overhead
(gate chain, executor spawn, serialization tail). **Target 5–8 tasks.** Split below ~4 only for a
nameable reason: risk isolation (a prod-touching change landing alone), a hard dependency boundary,
or a distinct `kind`. "Felt like a separate topic" is not one. Past ~10 tasks → do-arc's HEAVY band.

**Author the `assumptions` tripwires.** Every load-bearing claim about the CURRENT territory a task
depends on — a file's behavior, a test's status, a caller count, a seam's existence — becomes an
`{ claim, verify: '<one runnable grep/test/ls>', onFalse: 'ESCALATE' }`. 2–6 typical; **zero is
legitimate for a pure-prose phase — say so.** They are for claims whose FALSITY CHANGES THE PLAN
(the RAGUNIFY 1343.6 miss) — not every `keyFiles` anchor.

**Set `userFacing` + `flag`.** A phase adding user-visible behavior: `userFacing: true` plus `flag`
= `{ id: 'FLAG_ID' }` (runtime kill-switch, default-OFF) or `{ bootWired: true, justification }`
(joins the feature manifest; the justification is where a default-ON choice is ratified). Mode A
checks it; a non-user-facing phase omits both.

**Standalone-phase interview.** An underspecified standalone request → INTERVIEW first (one question
at a time, scope-first, like plan-arc) BEFORE Step 2. It extracts USER INTENT/SCOPE at request time;
Prime Rule 2's architect owns TECHNICAL decisions — two different stops.

**`testScope`** (optional; only when the config sets `testCadence`): scopes the gate's test slots
independently of `kind` — `static`/`scoped` (list `scopedTests`)/
`relevant`/`full`. A declared value may only RAISE the diff-derived floor (a `gateSpecialists` path
floors to `relevant`). Declare it for a known data/docs-shaped phase — never to sneak under the floor.

**`reviewScope`** (optional; the agent-chain ladder — a plan-time judgment: *what review is
high-value here?*): `none` (docs/data) · `light` (small/mechanical: ONE reviewer, no quality pass)
· `full` (new seams, subtle logic, governed). A declared value may LOWER the rung — Mode A ratifies
it (unjustified low = NEEDS WORK) — with one hard floor: a `gateSpecialists` path always runs
`full`. Declaring below `full`? Say in the notes WHY the skipped stages are low-value — Mode A judges that.

**The `step → verify:` grammar (REQUIRED).** Every `steps[].description` ends with
`" → verify: <one command or observable>"` naming how the executor PROVES the step landed — each
step becomes its own checkable claim. Example: `description: "route the model write through
runGovernedToolCall → verify: node --test src/agui.test.ts"` (or `… → verify: dashboard shows $48`).
**Grandfather rule:** the ~1,100 already-committed phase files are exempt forever; the write-hook
lint warns on a phase file NEW to git only, and review-phase Mode A is the actual enforcement — the
lint is the reminder, not the gate.

Author with `definePhase({ phase, name, status:'backlog', category, kind, source, priority,
dependsOn, conflictsWith, keyFiles, stakeholderDemo, tasks:[…] })`; each task `{ id, title, problem,
steps:[{file, description, line?}], acceptanceCriteria, files, done:false }`. `stakeholderDemo` = the
changelog line. `batchMode: true` ONLY for mechanical multi-commit work (rename across >10 files).

### Step 4 — Validate: `roadmap phase validate <N>` (write engine + emit); fix any failure.

### Step 5 — Self-verify (JUDGMENT checklist)
The mechanical members — **paths resolve**, **size lint** (`files ≤10`/`steps ≤6` or `batchMode`),
**no unresolved markers**, **emit/parse** — are enforced by `roadmap phase validate`; run it and
trust it. Apply JUDGMENT to the rest, re-reading the code NOW (not Step-2 memory):
1. **Source confirms** — open each function a task modifies; does `problem` actually exist there? (BLOCKER.)
2. **Blast radius** — grep each changed pattern/symbol repo-wide; every other occurrence is covered
   by a task here or documented out-of-scope. (NEEDS WORK.)
3. **Criteria verifiable** — each names a command or observable; reject "works correctly"/"verified". (NEEDS WORK.)
4. **Data flow** — no task depends on a later task's output or assumes a file an earlier task changes. (BLOCKER.)
5. **Hypotheses refuted** (only `category:'fix'`/`kind:'hardening'`) — `notes` has a `## Hypotheses`
   block: ≥2 ranked causes, a one-line refutation/evidence each, exactly ONE `CONFIRMED` with
   evidence (file:line/test/repro SHA), others `REFUTED`/`NOT TESTED`. (NEEDS WORK.)
6. **`step → verify:`** — every step carries its verify clause (the lint reminds; you own it).
Fix, re-run `roadmap phase validate`. Commit with unresolved markers ONLY if not queued; else clear all.

### Step 6 — Commit `docs(roadmap): phase N — <desc>`; `roadmap claim` frees the reservation.

### Step 7 — Auto-invoke `/review-phase N` (MANDATORY unless `--skip-review`)
Immediately run `/review-phase N` against the committed phase (Mode A, since status `backlog`).
**This pass is EXECUTED, never "reviewed inline"** — Step 5 is lazy self-review; an independent pass
consistently finds hallucinated paths, stale problem statements, and blast-radius gaps the author
missed (standing user ruling). READY → Mode A Step 8 queues the phase in `roadmap/backlog.ts` at the
position reasoned from `priority` + `dependsOn` + `conflictsWith`; report "queued at index K".
NEEDS WORK/BLOCKER → fix each, commit `docs(roadmap): phase N — address review findings`; do NOT
loop; the phase is NOT queued until a clean re-review. `--skip-review` → say so: plan unverified,
not queued.

## Task Design Rules
- **Every task:** real `steps[].file` paths; a concrete `steps[].description` with its `→ verify:`
  clause; 1–4 observable `acceptanceCriteria` (slot command or UI/API observable, never
  "implementation verified"); complete `files[]`. One task = one focused change in one pass;
  "and also…" is two tasks.
- **Ordering:** foundation (schema/utils/types) → consumers → validation-gate task last; deps flow
  downward (N.3 may depend on N.2, never N.4).
- **`testMode`:** `tdd` for pure logic/error-paths/business-rules · `e2e` for browser/user-flow ·
  `none` for build/file/docs/lint/config. **Default `none` when unsure** (TDD costs ~5 min/task).
- **Anti-patterns (all fail Prime Rule 1):** `description:'Implement task N.1'`,
  `acceptanceCriteria:['Task N.1 verified']`, `problem:'This needs to be done'`, `title:'Fix things'`.
- **Special:** an *investigation task* when root cause is unknown; a *gate task* last.

## After creating the phase
Report: phase number + file + task count; ready-or-needs-investigation; key risks / cross-phase
deps; backlog placement ("queued at index K" / "not queued — NEEDS WORK" / "--skip-review"); each
marker with its task id; the review outcome. `plan-phase` never edits `roadmap/backlog.ts` —
queuing is review-phase Mode A Step 8's act.
</content>
