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
