---
name: "Plan Phase"
description: "Create a new roadmap phase. Use when user says: create phase, plan phase, add to roadmap, new phase, add feature, create task. Reads the code first, identifies specific file paths, then writes a .phase.ts file."
user-invocable: true
metadata:
  keywords: plan, phase, create, new, roadmap, backlog, feature, add, task, implement
  aliases: create-phase, new-phase
---

# Plan Phase — High-Confidence Task Design

## Trigger

User says: `plan phase for X`, `create phase for X`, `/plan-phase`, `/create-phase`, or `/new-phase`

## Arguments

Parse the description of what needs to be done. This can be:
- A bug report: "the settlement page shows wrong amounts"
- A feature request: "add BDT support to the purchase form"
- A review finding: "FCR-12: CSP missing globally"
- A broad goal: "improve the onboarding flow"

## PRIME RULE: KNOW THE DIFF BEFORE WRITING THE TASK

**Every task must be planned to the point where you know the exact diff before writing code.**

If you cannot name the specific files, functions, and nature of the change — you haven't planned enough. Go read the code first.

| Bad (vague, low-confidence) | Good (specific, high-confidence) |
|---|---|
| "Rework calculations" | "Add missing deduction to `lib/services/settlement.ts:calculateTotal` (line ~142)" |
| "Fix the dashboard" | "Replace `sumAmounts('TYPE_A')` with `sumAmounts('TYPE_A', 'TYPE_B')` in `components/dashboard.tsx:SummaryCard`" |
| "Update business rules" | "Add `NEW_EVENT` to the trigger list in `lib/rules/escalation.ts:shouldEscalate`" |

## Protocol

### Step 1: Determine the next phase number

```bash
echo $(( $(sed -nE 's/^  phase: ([0-9]+),.*/\1/p' roadmap/phases/*.phase.ts 2>/dev/null | sort -n | tail -1) + 1 ))
```

This returns the next available phase number. Phase numbers are monotonic — never reuse historical gaps.

### Step 2: Investigate the code BEFORE writing any task

This is the most important step. For each area of work:

1. **Read the relevant source files** — not just the entry point, but the call chain
2. **Use LSP** — `findReferences`, `incomingCalls`, `goToDefinition` to understand the dependency graph
3. **Identify the exact functions and lines that change** — "line ~142" is acceptable, "somewhere in the file" is not
4. **Check downstream consumers** — will this change break anything?
5. **Check for existing solutions** — does a utility already exist? Is there a pattern to follow?

**If you can't do steps 1-5 for a piece of work, it's not ready to be a task.** Split the investigation into its own task first.

### Step 3: Write the phase file

Create `roadmap/phases/phase-{N}.phase.ts` using `definePhase()`:

```typescript
import { definePhase } from '@/lib/roadmap/schema'

export default definePhase({
  phase: N,
  name: 'Verb-phrase describing the outcome',
  status: 'backlog',
  category: 'feature',  // feature | fix | refactor | test | docs | infra
  version: undefined,    // Set when assigned to a release
  source: 'Where this came from — review finding, bug report, user request',
  priority: 'MEDIUM',   // BLOCKER | HIGH | MEDIUM | LOW
  dependsOn: [],
  conflictsWith: [],
  keyFiles: ['the/main/files.ts'],
  stakeholderDemo: 'One sentence a non-developer would understand — this becomes the changelog entry.',

  tasks: [
    {
      id: 'N.1',
      title: 'Verb-phrase — at least 10 characters',
      problem: 'Why this task exists — what breaks, what is wrong, what is missing. At least 30 characters.',
      steps: [
        {
          file: 'path/to/actual/file.ts',
          description: 'What to change in this specific file — at least 10 characters',
          line: 42,  // optional but preferred
        },
      ],
      acceptanceCriteria: [
        'Observable outcome you can verify by running a command or checking the UI',
      ],
      files: ['path/to/actual/file.ts'],
      done: false,
    },
  ],
})
```

### Step 4: Validate the phase file

```bash
pnpm type-check    # Validates the phase compiles
pnpm emit:phases   # Discovers the phase in the registry
```

If type-check fails, the task data is structurally invalid — fix it before committing.

### Step 5: Self-verify (5-point checklist)

**Do NOT skip this.** Run every check against the phase you just wrote. Fix issues before committing — a phase that fails self-verification is not ready.

**1. Paths resolve**
Open every `steps[].file` and `files[]` path referenced in every task. Each must be a real file that exists (or is explicitly created by an earlier task in the same phase).
- Fail = BLOCKER. Hallucinated path — the task will fail at execution.

**2. Source confirms**
Read the actual function or code each task claims to modify. Does the problem described in `problem` actually exist in that code?
- Don't trust your memory from Step 2 — re-read the code NOW against what you wrote.
- If a task says "function X doesn't handle Y", open function X and confirm it doesn't handle Y.
- Fail = BLOCKER. The plan describes a problem that doesn't exist.

**3. Blast radius**
For each pattern a task changes, check whether the same pattern exists elsewhere:
- `grep` for the string/pattern across the codebase
- `findReferences` on any symbol being renamed, moved, or changed
- If there are other occurrences, they must be covered by a task in this phase (or documented as out of scope with justification).
- Fail = NEEDS WORK. Incomplete fix — will ship a partial change.

**4. Criteria are verifiable**
Each acceptance criterion must name a specific command to run (`pnpm test`, `pnpm type-check`) or an observable output to check ("page renders X", "API returns 200 with field Y").
- Reject: "works correctly", "implementation verified", "task complete", "properly handles"
- Fail = NEEDS WORK. Unverifiable criterion — do-phase can't confirm the task worked.

**5. Task order respects data flow**
Walk the task list top to bottom. No task may depend on output from a later task. No task may assume a file is unchanged if an earlier task modifies it.
- Check: does task N.3 import/use something task N.4 creates? Does task N.2 modify a file that task N.1 reads in a specific state?
- Fail = BLOCKER. Will fail at execution.

**If any check fails:** fix the phase file and re-run the failing checks. Do NOT commit until all 5 pass.

### Step 6: Commit and push

```
docs(roadmap): phase N — <short description>
```

## Task Design Rules

### Every task must have:
- `steps[].file` — a REAL file path that exists (or will be created). Never `'roadmap/phases/'` as a placeholder.
- `steps[].description` — what specifically changes in that file
- `acceptanceCriteria` — 1-4 observable outcomes. Not "implementation verified" but "pnpm test:integration passes" or "dashboard shows $48 not $4800"
- `files[]` — ALL files the task modifies

### Task sizing:
- One task = one focused change you can commit in one pass
- If a task needs its own sub-planning, it's too big — split it
- If a task says "and also..." it's two tasks
- Maximum 4 acceptance criteria per task — if you need more, split

### Task ordering:
- Put foundation tasks first (schema changes, utilities, types)
- Put consumer tasks after (components that use the new types)
- Put verification tasks last (validation gate, build check)
- Dependencies flow downward — task N.3 may depend on N.2 but never on N.4

### Setting testMode per task:

Every task should declare a `testMode` based on its acceptance criteria:

| Acceptance criteria language | testMode | Why |
|------------------------------|----------|-----|
| "function returns X", "calculates Z correctly" | `"tdd"` | Pure logic, unit testable, fast red→green |
| "throws error when Y", "rejects invalid input" | `"tdd"` | Error paths, unit testable |
| "business rule enforces X" | `"tdd"` | Business rules are pure functions |
| "dashboard shows X", "page renders Y" | `"e2e"` | Needs browser |
| "form submits successfully", "user can navigate to" | `"e2e"` | User flow |
| "pnpm build passes", "file exists" | `"none"` | Build/file checks |
| "docs updated", "config changed" | `"none"` | Not testable by agent |
| "lint passes", "type-check clean" | `"none"` | Validation gate covers this |

**Default to `"none"` when unsure.** TDD adds ~5 min per task (test-engineer agent + red→green cycle). Only use it when the acceptance criteria describe specific function behavior.

### What NOT to write:
- `steps: [{ file: 'roadmap/phases/', description: 'Implement task N.1' }]` — this is a placeholder, not a plan
- `acceptanceCriteria: ['Task N.1 implementation verified']` — this is a tautology, not a criterion
- `problem: 'This needs to be done'` — this is not a problem statement
- `title: 'Fix things'` — this is not a title

## Special Task Types

### Investigation task
When you genuinely don't know what to change yet:
```typescript
{
  id: 'N.1',
  title: 'Investigate settlement calculation discrepancy',
  problem: 'Dashboard shows $4800 but settlement shows $48. Need to trace the data flow.',
  steps: [
    { file: 'lib/services/settlement.ts', description: 'Read calculatePnL and trace where cents/dollars conversion happens' },
    { file: 'app/dashboard/settlement/page.tsx', description: 'Check how settlement data is displayed — readCents vs raw Number()' },
  ],
  acceptanceCriteria: [
    'Root cause identified with file path and line number',
    'Fix tasks N.2-N.X written with specific file paths',
  ],
  files: ['lib/services/settlement.ts', 'app/dashboard/settlement/page.tsx'],
  done: false,
}
```

### Validation gate task (always last)
```typescript
{
  id: 'N.last',
  title: 'Validation gate',
  problem: 'All changes must pass the full validation gate.',
  steps: [
    { file: 'package.json', description: 'Run lint, type-check, test, build' },
  ],
  acceptanceCriteria: ['All gate checks pass'],
  files: ['package.json'],
  done: false,
}
```

## After Creating the Phase

Tell the user:
1. The phase number and file path
2. How many tasks were created
3. Whether it's ready to execute (`/do-phase N`) or needs more investigation
4. Key risk areas or dependencies to be aware of
5. That the phase is **not** in the execution backlog yet — to queue it, edit `roadmap/backlog.ts`

**Do NOT auto-append to `roadmap/backlog.ts`.** New phases enter backlog unqueued. The user deliberately sequences phases during planning sessions — auto-appending would bypass that intentional ordering.
