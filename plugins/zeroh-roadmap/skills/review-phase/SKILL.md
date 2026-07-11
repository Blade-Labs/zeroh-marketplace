---
name: "Review Phase"
description: "Verify that a phase's claimed work actually happened correctly. Checks task completeness, code accuracy, blast radius, and architecture compliance. Works on both done phases (post-execution audit) and backlog phases (plan quality review)."
user-invocable: true
metadata:
  keywords: review, phase, verify, audit, check, validate
  aliases: verify-phase, audit-phase
---

# Review Phase — Verification Protocol

## Trigger

User says: `review phase N`, `/review-phase N`, `verify phase N`, `audit phase N`, `review arc <ID>`

## Arguments

- **Phase number or arc id** (required): parse from user input. An arc id means: review the arc entity + EVERY member phase — the holistic pass (Step H) runs ONCE at arc level, then the per-phase protocol runs for each member.
- **Additional prompt** (optional): extra checks the user wants, appended after the standard protocol. Example: `/review-phase 145 also check that all currency fields use _cents suffix`

## What This Is (and Is NOT)

**This IS:** Two questions, in order. (1) **Fitness** — is this the right feature, the right shape, whole (nothing missing), and lean (nothing that shouldn't be built)? (2) **Verification** — did/will the claimed work actually match reality? Did the task say "add X to line 42"? Is X actually at line 42?

**This is NOT:** Code review (which finds NEW bugs the phase didn't claim to address — that's `/code-review`), and NOT a re-run of the design gate (plan-arc Step 1b already explored alternatives with the user — ratified decisions are checked for drift and new information, never relitigated).

## Protocol

### Step 0: Read the phase file

```bash
cat roadmap/phases/phase-{N}.phase.ts
```

Determine the phase mode:
- **`status: 'done'`** → Post-execution audit (verify completed work)
- **`status: 'in-progress'`** → Mid-flight check (verify completed tasks, flag remaining)
- **`status: 'backlog'`** → Plan quality review (verify tasks are specific, files exist, no gaps)
- **`status: 'historical'`** or **`'cancelled'`** → terminal, not reviewable here. Historical phases predate gate discipline (loose by design); say so and stop rather than auditing them against the strict done bar.

---

### Mode A: Plan Quality Review (backlog phases)

For phases not yet executed. Review as a **senior software architect** — don't trust the plan, verify it against the actual code.

**Model policy (the HOME statement — stated ONCE, here; the other seams reference it).** A spawner running Mode A *via an agent* reads the consumer's `^## Model policy$` block: when it names `judge-model: <model>`, pass `model: <that model>` to the spawned reviewer; an **ABSENT block = the agent's frontmatter default** (the fail-safe rail). This covers the JUDGE seams ONLY — Mode A plan reviewers, arc-sweep's whole-arc software-architect, and validate-arc's intent-validator panel. `phase-executor` / `software-developer` / `test-engineer` spawns are NOT covered. The judge seams may name the SAME model that executes — a judge's independence comes from its fresh, read-only context and evidence-or-downgrade discipline, never from being a different/stronger model; when builder and judge share a model, keep panels small and spend the review budget on the seams with real catch history. Mode A invoked STANDALONE by the user runs INLINE — no agent spawn, no model choice; the reviewer SPAWN site is plan-arc Step 3.

**PRIME RULE: CONFIRM EVERYTHING AGAINST SOURCE CODE.**

Do NOT just read the task description and check if it "sounds right." Open the files. Read the functions. Verify the claims. The plan was written by an agent that may have hallucinated file paths, function names, or line numbers.

Note: plan-phase runs a superset of these checks (its Step-5 9-check list) as self-verification before committing. Review-phase re-runs the 7 checks below because (a) the codebase may have changed since planning, and (b) self-verification can be lazy — an independent pass catches what the author missed.

#### Mode A — Step H: Holistic feature review (issued FIRST in the report, finalized after the per-task pass)

Before grading the tasks, judge the FEATURE. A plan can be mechanically flawless and still be the
wrong thing, half a thing, or too much thing. Four questions, each answered with evidence (source,
memory, roadmap, live state) — never vibes:

**H1. Right problem, still true, worth doing now?** Does the problem the phase/arc claims still
exist — or did landed work, a shipped arc, or a live-state change supersede it since planning?
(The "stale OPERATOR-PENDING actually live" class.) Is it worth its slot relative to the queue,
or is it a nice-to-have wearing a HIGH priority?

**H2. Right shape?** Check the plan against the CONFIRMED designRefs + the arc's locked decisions
— drift since confirmation is a finding; relitigating a ratified decision is not. Then the
substrate questions: does it EXTEND an existing seam or quietly fork one (`singleSeams` honesty)?
Is it at the right altitude (a substrate capability vs. a one-off vertical — and if vertical, is
the generalization recorded as a named follow-up per the rule of three)? Is there a simpler
mechanism that does the same job (over-engineering)?

**H3. Anything missing that makes it whole?** The loop-completeness scan: fail-closed arms on
every new decision point, audit/receipt disclosure for every governed effect, the kill-switch
(flag) and its OFF-path proof, the wired test per new surface, canon/docs, and the adjacent gap
that would leave the shipped feature half-useful (a control with no visibility, a grant with no
revoke, one surface where the JTBD names two).

**H4. Anything to remove?** Scope that doesn't pay: a task duplicating shipped capability
(verify in source — if confirmed, that's a check-2-class repair: the problem doesn't exist),
speculative abstraction with one consumer, gold-plating beyond the acceptance bar.

**Disposition** rides the Step 7b split: a missing-but-mechanical piece (an absent fail-closed
arm, a missing test task) may be ADDED to the plan as an auto-repair when it preserves intent;
RESHAPE / CUT / new-scope recommendations are report-only for the user. Output:

```
## Holistic review — <feature/arc>
  H1 Right problem: YES / SUPERSEDED / QUESTION — <evidence>
  H2 Right shape:   YES / CONCERN — <seam, altitude, drift-from-design findings>
  H3 Missing:       none / <list — each ADDED (auto-repair) | FOLLOW-UP (named) | ASK-USER>
  H4 Remove:        none / <list — each CONFIRMED-DEAD (check-2 repair) | RECOMMEND-CUT (user)>
  Verdict: SOUND | RESHAPE (what + why) | QUESTION (the ruling needed)
```

For an ARC review, run Step H once against the arc entity (planes, singleSeams, honestyRails,
acceptanceCriteria vs. the JTBD) and let the per-phase passes inherit it; do not repeat it per
phase. Mode B does NOT run Step H — post-build intent judgment belongs to validate-arc.

**For each task, run the 7-check verification list:**

**1. Paths resolve**
Open every `steps[].file` and `files[]` path. Each must exist (or be explicitly created by an earlier task in the same phase).
- Fail = BLOCKER. Hallucinated path.

**2. Source confirms**
Read the actual function or code each task claims to modify. Does the problem described in `problem` actually exist there?
- If the task says "function X doesn't handle Y", open function X and confirm.
- If the problem doesn't exist (code changed since planning, or was never true), the task is wrong.
- Fail = BLOCKER. Plan describes a problem that doesn't exist.

**3. Blast radius**
For each pattern a task changes, check whether the same pattern exists elsewhere:
- `grep` for the string/pattern across the codebase
- Grep the repo for any symbol being renamed, moved, or changed (imports AND string-literal references)
- If there are uncovered instances, flag as NEEDS WORK with the file paths.
- This is the most common planning failure — fixing one occurrence and missing five others.
- Fail = NEEDS WORK. Incomplete fix.

**4. Criteria are verifiable**
Each acceptance criterion must name a specific command to run or an observable output to check.
- Reject: "works correctly", "implementation verified", "task complete", "properly handles"
- Fail = NEEDS WORK. Unverifiable criterion.

**5. Task order respects data flow**
Walk the task list top to bottom. No task may depend on output from a later task. No task may assume a file is unchanged if an earlier task modifies it.
- Any task with explicit `dependsOn: ["N.X"]` — verify N.X exists in this phase and appears **earlier** in the `tasks` array. A dep pointing to a later task is a BLOCKER (cycle or misorder). A dep pointing to a non-existent task ID is a BLOCKER (hallucinated ID).
- Cross-phase deps live on the Phase object (`phase.dependsOn`), not on tasks. A task's `dependsOn` referencing a phase number (not an N.X task ID) is malformed.
- Fail = BLOCKER. Will fail at execution.

**6. No unresolved `[NEEDS CLARIFICATION]` markers**
```bash
grep -n '\[NEEDS CLARIFICATION' roadmap/phases/phase-{N}.phase.ts
```
Every marker means the planner explicitly flagged a question that must be answered before the phase is executable.
- If any marker exists, the phase is NEEDS WORK regardless of all other checks. List each marker in the findings with its task ID and the specific question.
- Fail = NEEDS WORK. Phase cannot be queued or executed until every marker is resolved.

**7. Task size lint (`batchMode` gate)**
For every task, verify:
- `files.length` ≤ 10 OR `batchMode: true`
- `steps.length` ≤ 6 OR `batchMode: true`

If a task exceeds either limit without `batchMode: true`, the planner left a unit-of-intent problem on the table. `do-phase` will refuse to fork an agent for it, and inline execution will produce a single mega-commit with no granular recovery. Reject: either split the task into 2+ smaller tasks, or set `batchMode: true` if the work is genuinely mechanical (rename across N files, parallel template authoring).

Confirm the planner's batchMode decision is honest: a task with `batchMode: true` whose `steps[]` entries don't slice into clean commit units is a bad batch — the planner used the flag to silence the lint instead of doing the slicing work. If the steps look like prose ("Implement everything for shape X" with 8 sub-bullets) rather than commit-shaped units, flag as NEEDS WORK.

Confirm `userFacing` + `flag`: a phase adding user-visible behavior must carry `userFacing: true` and a `flag` (a FlagId `{ id }`, or a justified `{ bootWired, justification }`). A missing flag on a user-facing phase is NEEDS WORK — the 1345-class gap; the 1367 validator also enforces it at write time ≥ the enforcement floor.

- Fail = BLOCKER. Oversized task without batchMode, or batchMode with non-commit-shaped steps.

**Test-scope sanity (bonus check — only when `phase.testScope` is declared):**
Verify the declared scope is plausible against `keyFiles` + every task's `files[]`: any
path in the consumer's `## Gate specialists` block, or any runtime `src/` change with
cross-module consumers, is incompatible with `static`/`scoped`. The gate would refuse at
execution (floor rule), but catching it at review time saves the do-phase round-trip.
Also check `scopedTests` globs resolve to real files when `testScope: 'scoped'`.
- Fail = NEEDS WORK. Under-scoped test declaration.

**Review-scope ratification (bonus check — only when `phase.reviewScope` is declared below
`full`):** this review IS the ratification the gate trusts (gate-protocol "Review-scope
ladder" — a declared value may LOWER the derived rung precisely because Mode A judges it).
Verify: (a) no `keyFiles`/task `files[]` path is in the consumer's `## Gate specialists`
block (the gate would refuse at execution — catch it here); (b) the rung fits the diff's
nature — `none` only for docs/data/assets, `light` only for small or mechanical changes with
no new governed surface / contract / ledger event kind / subtle logic; (c) the planner
stated WHY the skipped stages are low-value for this phase. An unjustified or ill-fitting
low rung = NEEDS WORK — never wave it through, the whole ladder's safety rests on this check.
- Fail = NEEDS WORK. Under-scoped review declaration.

**Output per task:**
```
Task N.1: <title>
  Verdict: READY | NEEDS WORK | BLOCKER
  Source confirmed: Yes/No — <what you checked>
  Blast radius: Clean / <file paths where same pattern exists uncovered>
  Issues: (if any)
    - [BLOCKER] steps[0].file 'lib/foo.ts' does not exist
    - [CONFIRMED] task claims function X is missing input Y — line 142 only processes subset
    - [NEEDS WORK] same pattern in settlement-preview.ts:89 — NOT covered by any task
```

#### Mode A — Step 7b: Apply plan repairs (auto-fix, then re-verify)

The point of a plan review is a phase that is **fixed and queued**, not a findings list the user
must relay back. After the 7-check pass, APPLY every finding that is a repair to the PLAN itself
— directly in the `.phase.ts` file — then re-run the affected checks on the edited plan.

**Auto-repair (the default) — findings whose fix is knowable from the code you already read:**
- a wrong/imprecise file or line anchor (point the task at the file/symbol you verified)
- blast-radius gaps (add the uncovered file paths to the owning task's `steps[]`/`files[]`)
- an unverifiable acceptance criterion (reword to name the command/observable you identified)
- a malformed/misordered task `dependsOn`, a stale name, a missing `batchMode` split that is
  purely mechanical
- an ambiguous either/or left in a task ("shim OR delete") when the code you read makes one arm
  clearly correct — pick it, record the decision in the task text

**Report-only (never auto-fix) — findings that change the phase's INTENT or need an owner:**
- the task's `problem` does not exist in source (check 2) — the plan may be wrong at concept level
- a missing dependency PHASE or a scope change (new work, not a repair of described work)
- anything contradicting a user-LOCKED decision in the arc/phase, or requiring a product choice
- unresolved `[NEEDS CLARIFICATION]` markers — those are the planner's questions to the USER

Each auto-repair is listed in the findings output with `[FIXED]` in place of the bare verdict tag,
naming what changed. Commit the plan edits (explicit paths only) as
`plan(roadmap): phase N review fixes — <short summary>`, running the consumer's emit/cross-validate
step (e.g. the `emit` Gate-commands slot) first if phase files feed generated views. The phase
verdict is issued on the POST-fix plan.

#### Mode A — Step 8: Backlog placement

After the 7-check pass and Step 7b repairs, decide whether and where this phase belongs in `roadmap/backlog.ts`. This step runs when the **post-fix** verdict is READY (no remaining BLOCKER, no remaining NEEDS WORK, no unresolved `[NEEDS CLARIFICATION]` markers) — auto-repaired findings do not block queueing. Phases with REPORT-ONLY findings still open do NOT enter the backlog — surface them to the user, re-review, then queue.

**Read the current backlog:**

```bash
cat roadmap/backlog.ts
```

**Reason about position using these rules, in order:**

1. **Dependency floor** — the phase must appear AFTER every phase listed in its `dependsOn`. Locate each dep in the backlog (or confirm it's already terminal-complete — `status: 'done'` or `'historical'`); the lowest acceptable index is `max(depIndex) + 1`. If any dep is missing from both the backlog and the completed (done/historical) phases, that's a BLOCKER finding — re-issue verdict.
2. **Conflict spacing** — if the phase has `conflictsWith: [X, ...]`, do not place it adjacent to X. Insert at least one phase between, or surface as a NEEDS WORK if no valid slot exists.
3. **Priority sort within the eligible range** — among positions allowed by rules 1–2, place by `priority`: `BLOCKER` slots above all `HIGH/MEDIUM/LOW`; `HIGH` above `MEDIUM/LOW`; `MEDIUM` above `LOW`. Within the same priority, append at the end of that priority's run (FIFO — phases of equal priority execute in plan order).
4. **Already in backlog?** If the phase is already listed, validate its position against rules 1–3. If the position is wrong, propose a move; do not silently re-order.

**Apply the placement:**

- If the phase is not in the backlog, edit `roadmap/backlog.ts` and insert the entry at the chosen index. Format: `{ phase: N, name: '<phase.name>' }`.
- If already present at the right position, no edit.
- If present at a wrong position, output the proposal AND apply the move in the same edit.

Commit the backlog change as part of the review's findings-fix commit (or as `docs(roadmap): queue phase N`) — same commit policy as any other review-driven edit.

**Output:**

```
Backlog placement
  Verdict: QUEUED at index K | ALREADY QUEUED at index K (correct) | MOVED from K1 to K2 | NOT QUEUED — verdict was NEEDS WORK
  Reasoning: priority=HIGH; depends on phase 12 (already done) and phase 17 (queued at idx 3); conflicts with phase 21 (queued at idx 4 — placed at idx 5 instead of 4 to avoid adjacency)
```

**Opt-out**: if the user passed `--no-queue` to `/review-phase`, run rules 1–3 to validate but do NOT edit `backlog.ts`. Just output the proposed position.

---

### Mode B: Post-Execution Audit (done/in-progress phases)

For phases already executed. Verify the CLAIMED work actually happened — and that it was done COMPLETELY.

**Step 1: Identify the phase commits**

```bash
git log --oneline --grep="phase {N}" | head -20
```

Read the diff for each commit to understand what actually changed.

**Step 2: For each completed task, check:**

a. **Claimed changes exist** — every `steps[].file` was actually modified. Read the file and verify the described change is present. Don't trust the commit message — read the code.

b. **Bug actually fixed (not just patched)** — if the task claimed to fix a bug, verify the fix is correct. Read the function, trace the logic, confirm the root cause is addressed — not just papered over with a null check or try/catch.

   **For phases with `kind: 'hardening'` AND any persistence / event-emission / marshal-chain task**, unit-test pass is NOT the closure criterion — the integration-suite rerun is. The reviewer MUST find evidence that the integration suite was rerun after the fix and that the runtime symptom resolved. Acceptable evidence: integration test output diff (events captured before vs. after, persisted records before vs. after, the previously-failing assertion now passing), referenced in the phase file's `compromises` field or the completion commit body.

   If the integration suite was not rerun, OR the rerun still shows the symptom, this is a **FAIL** — the fix is unverified regardless of unit-test status. This catches the "structurally correct fix that didn't close the runtime bug" pattern (e.g. unit tests green but 4 events still missing on integration replay).

c. **Pattern caught everywhere (the "elsewhere?" check)** — the most important check. If the fix changed a pattern in one file:
   - Grep for the OLD pattern across the entire codebase — does it still exist somewhere?
   - Grep for changed symbols across the repo (imports AND string-literal references) — are all consumers updated?
   - Renamed a field? Check: catalog, disclosure matrix, E2E tests, seed data, dashboard components, API routes, business rules
   - Fixed a calculation? Check: are there other calculations with the same bug pattern?
   - Changed an error message? Check: are there similar error messages that need the same fix?
   - **If you find uncovered instances, this is a FAIL — the fix is incomplete.**

d. **Line numbers are accurate** — if the task said "add X at line ~142", check that X is near line 142 (not on line 500 or missing entirely).

e. **Architecture compliance:**
   - Business logic in `lib/business-rules/` or `lib/services/` — not in components, routes, or cron
   - No side effects in pure functions (no DB imports, no fetch calls)
   - SSOT maintained — the change didn't create a parallel definition
   - Error handling uses canonical error utility — no swallowed catches, no generic messages
   - Financial calculations use integer cents — no floating point

f. **Acceptance criteria met** — for each criterion, verify it's actually satisfied. Run the command if possible.

g. **Test coverage** — if the task touched business logic, is there a corresponding test? Check `lib/__tests__/` for relevant test files.

**Output per task:**
```
Task N.1: <title>
  Verdict: PASS | CONCERN | FAIL
  Bug confirmed fixed: Yes/No — <what you verified>
  Pattern elsewhere: No / Yes — <file paths where same pattern still exists>
  Findings: (if any)
    - CONCERN: renamed 'amount' to 'amount_cents' in events.ts but disclosure-matrix.ts still references 'amount'
    - FAIL: task claimed to add VETERINARY_INCIDENT to escalation triggers but it's not in the array
    - FAIL: same incorrect calculation exists in settlement-preview.ts:89 — not touched by this phase
```

---

### Step 3: Phase-level verdict

After reviewing all tasks, output a summary:

```
## Phase {N} Review: <phase name>

Mode: Plan Quality / Post-Execution Audit

(Mode A only) ## Holistic review — the Step H block, first

Tasks reviewed: X
  PASS/READY: Y
  FIXED (Step 7b auto-repair): F
  CONCERN/NEEDS WORK: Z
  FAIL/BLOCKER: W

### Findings

(all concerns and failures listed with task reference; auto-repaired findings tagged [FIXED] with what changed)

### Verdict: CLEAN | HAS CONCERNS | BLOCKED

CLEAN = all tasks pass (auto-repaired findings count as pass), Step H verdict SOUND
HAS CONCERNS = minor issues that should be addressed but aren't blockers, or Step H says RESHAPE/QUESTION
BLOCKED = critical issues that must be fixed before the phase can be considered complete
```

---

### Step 4: Additional checks (if user provided extra prompt)

If the user appended additional instructions (e.g., "also check that all currency fields use _cents suffix"), run those checks AFTER the standard protocol and include findings in the summary under a separate "Additional Checks" section.

---

## Cross-repo phases

If the phase file references files in another repo (e.g., zeroh2), read those files directly using their full paths. The review protocol is the same — verify claimed changes exist and are correct.

## What NOT to do

- **Mode A fixes the PLAN, never the CODE** — Step 7b auto-repairs the `.phase.ts` (anchors, blast radius, criteria wording) and queues, but this skill never edits source files; source changes belong to `/do-phase`. Mode B (post-execution) stays report-only — findings there mean shipped work is wrong, and the fix goes through a phase, not a review edit.
- **Do NOT run tests** — this skill reads code and verifies claims. The validation gate runs tests.
- **Do NOT review code outside the phase scope** — only check what the phase claimed to do, plus blast radius of those changes.
- **Do NOT weaken findings** — if something is wrong, say so. "Probably fine" is not a verdict.
