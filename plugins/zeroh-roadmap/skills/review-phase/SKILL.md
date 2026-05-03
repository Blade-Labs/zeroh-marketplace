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

User says: `review phase N`, `/review-phase N`, `verify phase N`, `audit phase N`

## Arguments

- **Phase number** (required): parse from user input
- **Additional prompt** (optional): extra checks the user wants, appended after the standard protocol. Example: `/review-phase 145 also check that all currency fields use _cents suffix`

## What This Is (and Is NOT)

**This IS:** Verification that CLAIMED work actually happened correctly. Did the task say "add X to line 42"? Is X actually at line 42? Did the task say "fix the bug"? Is the bug actually fixed?

**This is NOT:** Code review (which finds NEW bugs the phase didn't claim to address). Code review is `/code-review`. This skill verifies the phase's own claims.

## Protocol

### Step 0: Read the phase file

```bash
cat roadmap/phases/phase-{N}.phase.ts
```

Determine the phase mode:
- **`status: 'done'`** → Post-execution audit (verify completed work)
- **`status: 'in-progress'`** → Mid-flight check (verify completed tasks, flag remaining)
- **`status: 'backlog'`** → Plan quality review (verify tasks are specific, files exist, no gaps)

---

### Mode A: Plan Quality Review (backlog phases)

For phases not yet executed. Review as a **senior software architect** — don't trust the plan, verify it against the actual code.

**PRIME RULE: CONFIRM EVERYTHING AGAINST SOURCE CODE.**

Do NOT just read the task description and check if it "sounds right." Open the files. Read the functions. Verify the claims. The plan was written by an agent that may have hallucinated file paths, function names, or line numbers.

Note: plan-phase runs this same 5-point checklist as self-verification before committing. Review-phase re-runs it because (a) the codebase may have changed since planning, and (b) self-verification can be lazy — an independent pass catches what the author missed.

**For each task, run the 5-point verification checklist:**

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
- `findReferences` on any symbol being renamed, moved, or changed
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

- Fail = BLOCKER. Oversized task without batchMode, or batchMode with non-commit-shaped steps.

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

#### Mode A — Step 7: Backlog placement

After the 6-check pass, decide whether and where this phase belongs in `roadmap/backlog.ts`. This step **only runs when the phase verdict is READY** (no BLOCKER, no NEEDS WORK, no unresolved `[NEEDS CLARIFICATION]` markers). NEEDS WORK / BLOCKER phases do NOT enter the backlog — fix the findings first, re-review, then queue.

**Read the current backlog:**

```bash
cat roadmap/backlog.ts
```

**Reason about position using these rules, in order:**

1. **Dependency floor** — the phase must appear AFTER every phase listed in its `dependsOn`. Locate each dep in the backlog (or confirm it's already `status: 'done'`); the lowest acceptable index is `max(depIndex) + 1`. If any dep is missing from both the backlog and done phases, that's a BLOCKER finding — re-issue verdict.
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
   - Use LSP `findReferences` on changed symbols — are all consumers updated?
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
Tasks reviewed: X
  PASS/READY: Y
  CONCERN/NEEDS WORK: Z
  FAIL/BLOCKER: W

### Findings

(all concerns and failures listed with task reference)

### Verdict: CLEAN | HAS CONCERNS | BLOCKED

CLEAN = all tasks pass, no issues found
HAS CONCERNS = minor issues that should be addressed but aren't blockers
BLOCKED = critical issues that must be fixed before the phase can be considered complete
```

---

### Step 4: Additional checks (if user provided extra prompt)

If the user appended additional instructions (e.g., "also check that all currency fields use _cents suffix"), run those checks AFTER the standard protocol and include findings in the summary under a separate "Additional Checks" section.

---

## Cross-repo phases

If the phase file references files in another repo (e.g., zeroh2), read those files directly using their full paths. The review protocol is the same — verify claimed changes exist and are correct.

## What NOT to do

- **Do NOT fix issues** — this skill reports findings, it does not make changes. If fixes are needed, the user runs `/do-phase` or fixes manually.
- **Do NOT run tests** — this skill reads code and verifies claims. The validation gate runs tests.
- **Do NOT review code outside the phase scope** — only check what the phase claimed to do, plus blast radius of those changes.
- **Do NOT weaken findings** — if something is wrong, say so. "Probably fine" is not a verdict.
