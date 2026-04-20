---
name: "Do Phase"
description: "Execute a roadmap phase task-by-task with enforced sequential discipline. Reads the .phase.ts file, creates a task for each item, and executes ONE AT A TIME with commit verification between each."
user-invocable: true
metadata:
  keywords: phase, execute, do, start, roadmap, sequential
  aliases: start-phase
---

# Do Phase — Sequential Execution Protocol

## Trigger

User says: `do phase N`, `start phase N`, `/do-phase N`, `/start-phase N`, `do next phase`, or `what's next`

## Arguments

Parse the phase number from user input. If no number provided, check the backlog:

```bash
# Read the ordered backlog to find the next phase
cat roadmap/backlog.ts
```

Read `roadmap/backlog.ts` — the first entry is the next phase to execute. Confirm it with the user:

> **Next up: Phase {N} — {name}.** Start it?

If `roadmap/backlog.ts` doesn't exist or is empty, ask the user for a phase number.

## PRIME RULE: ONE TASK AT A TIME

**This skill exists to PREVENT batch execution.** Each task in the phase file was carefully designed as an independent unit of work. Batching them introduces errors (proven: phase 160-170 migration lost data when batched).

**You MUST:**
1. Execute ONE task
2. Commit that task
3. Verify it works (type-check at minimum)
4. Mark it complete
5. THEN move to the next task

**You MUST NOT:**
- Execute multiple tasks in a single agent call
- Launch parallel agents for phase tasks
- Skip tasks or reorder them
- Combine tasks "for efficiency"
- Mark tasks done before they are committed

## Protocol

### Step 0: Read the phase file

```bash
# Find and read the phase file
cat roadmap/phases/phase-{N}.phase.ts
```

Read the full phase data. Note:
- `status` — must be `'backlog'` or `'in-progress'`. If `'done'`, tell user and stop.
- `executionMode` — `'sequential'` (default) or `'parallel'`. Sequential = this protocol. Parallel = you may batch truly independent tasks (rare).
- `tasks[]` — the ordered list of work. Execute in order.
- `notes` — read for context (architecture decisions, investigation data).

### Step 0.5: Verify phase dependencies

If the phase declares `dependsOn: [X, Y, ...]` (phase-level deps), check that every referenced phase exists and has `status: 'done'`:

```bash
for dep in <each number from dependsOn>; do
  grep -H "status:" "roadmap/phases/phase-${dep}.phase.ts" 2>/dev/null || echo "MISSING: phase-${dep}.phase.ts"
done
```

If any dependency is missing or not `'done'`, STOP and tell the user:

> Phase N declares a dependency on phase X, which is currently {missing | backlog | in-progress | cancelled}. Run `/do-phase X` first, or remove it from `dependsOn` if it's no longer required.

Do NOT proceed until every entry in `dependsOn` resolves to a `done` phase. This prevents executing a phase whose prerequisite work doesn't exist yet — a failure mode the schema already modelled but never enforced.

### Step 1: Set status to in-progress

If status is `'backlog'`, edit the .phase.ts file to set `status: 'in-progress'`. Commit:
```
docs(roadmap): phase N — move to in-progress
```

### Step 2: Create Claude Code tasks

Use `TaskCreate` to create ONE task for each task in the phase file. Use the task title as the subject and the problem as the description. This gives the user live progress visibility.

### Step 3: Execute tasks sequentially

For each task, in order:

1. **TaskUpdate** — set status to `in_progress`
2. **Read the task** — read the `problem`, `steps`, `acceptanceCriteria`, `files`, and `testMode` fields
3. **Execute** — branch on `testMode`:

#### testMode: "tdd" (test-first)

   **(3a)** Launch `test-engineer` agent with ONLY: `task.problem`, `task.acceptanceCriteria`, `task.files`, and the existing type signatures/interfaces from those files (use LSP `hover` or read type exports — NOT function bodies). Do NOT give `task.steps`.
   **(3b)** Run `pnpm test` — tests MUST FAIL (red). If they pass, tests are trivial — reject and have test-engineer rewrite.
   **(3c)** If tests don't compile, provide the compilation error to test-engineer for 1 retry. If still broken, skip TDD and note in transparency report: "TDD skipped — test-engineer could not produce compilable tests."
   **(3d)** Code agent implements `task.steps`.
   **(3e)** Run `pnpm test` — tests MUST PASS (green).
   **(3f)** Commit test + code together.

#### testMode: "e2e" (test-after, blind to source)

   **(3a)** Code agent implements `task.steps`.
   **(3b)** Launch `test-engineer` agent with: `task.problem`, `task.acceptanceCriteria`, page URLs, `data-testid` values from the components. Do NOT give component source code, API route implementation, or state management details.
   **(3c)** test-engineer writes E2E test from user-flow perspective.
   **(3d)** Commit test + code together. E2E tests run at validation gate, not per-task.

#### testMode: "none" (default)

   Implement the changes described in `steps`. Each step has a `file` path — go to that file and make the described change.

4. **Verify** — run `pnpm type-check` at minimum. If the task touches tests, run `pnpm test`. If the task touches UI, run `pnpm build`.
5. **Commit** — commit the changes with message format: `<type>(<scope>): phase N — <task title>`
6. **Update phase file** — set `done: true` and `doneDate: 'YYYY-MM-DD'` on the task
7. **TaskUpdate** — set status to `completed`
8. **Transparency report** — output a structured block AND persist it into the phase file.

   a. Output to the conversation so the user sees it in real time. **Always print `WHAT WAS DONE` and `HOW`. For `COMPROMISES`, `SKIPPED`, `HARDCODED`, `LIMITATIONS` — print the line ONLY when the value is not `"None"`.** A clean task should be a 2-line report; a compromised task surfaces only the sections that actually have something to say. This applies to the chat output only — the persisted `transparencyReport` field (step b) still records all six sections so the audit trail stays complete.

   ```
   ### Transparency Report — Task N.X: <title>

   **WHAT WAS DONE:** <1-2 sentence summary>
   **HOW:** <approach, key decisions>
   [**COMPROMISES:** <trade-offs made and why>]      ← omit line if "None"
   [**SKIPPED:** <acceptance criteria not fully addressed>]  ← omit line if "None"
   [**HARDCODED:** <values that should be configurable>]     ← omit line if "None"
   [**LIMITATIONS:** <known limitations>]            ← omit line if "None"
   ```

   b. Persist the same content as a structured `transparencyReport` field on the task in the phase file. The schema (`TransparencyReportShape`) requires all six sections and rejects noise — use either:
      - The literal string `"None"` when a section genuinely has nothing to report (compromises/skipped/hardcoded/limitations only — `whatWasDone` and `how` must always be real content).
      - At least 10 characters of substantive content.

      Short tokens like `"n/a"`, `"."`, `"tbd"` will fail schema parse. This is intentional — the field exists to force honesty, not placate a type check.

   ```typescript
   // In the phase file, inside the task object:
   transparencyReport: {
     whatWasDone: '...',
     how: '...',
     compromises: 'None',
     skipped: 'None',
     hardcoded: 'None',
     limitations: 'None',
   }
   ```

   c. This edit goes in the same commit that sets `done: true` and `doneDate` on the task — one commit per task transitioning to done.

The agent continues immediately to the next task after persisting the report. No waiting, no asking "should I continue?"

### Step 4: Validation gate

After the last task commits, run the validation gate. Full protocol in **`references/gate-protocol.md`** — read it once per session, then return here.

The gate has three stages:

**Round 0 — Simplify pass** (one-shot, does NOT loop). Launch one `simplifier` agent with `git diff <phase-start-SHA>..HEAD` and the phase file. It removes dead scaffolding, speculative abstractions, redundant error handling, and noise — then commits inline (`refactor(phase-N): simplify — <summary>`). Simplification is judgment, not correctness, so it runs exactly once. Bugs the simplifier notices get flagged and forwarded to Round 1 rather than fixed.

**Rounds 1..N — Correctness loop** (loops until clean, hard-cap 5 rounds). Each round:
1. Mechanical checks (`pnpm biome check . && pnpm type-check && pnpm test && pnpm build && bash scripts/pre-review.sh <first-task-SHA>~1 && pnpm e2e:local`). Any failure → fix + commit + restart Round N.
2. Two parallel `code-reviewer` agents reviewing the phase diff (Round 1) or the previous round's fix diff (Round N>1). Confidence ≥80, severities CRITICAL→LOW in scope, INFO recorded but non-blocking.
3. If both agents return zero actionable findings → gate passes. Otherwise fix, record a `StructuredGateRound` entry, loop.

If Round 5 hasn't converged, STOP and surface remaining findings — agents may be cycling.

**NO EXCEPTIONS** — every phase gets the full gate, including docs-only and test-only phases.

### Step 4b: Phase compromise summary (the ONLY human stop)

Aggregate every task's persisted `transparencyReport` into a phase-level summary (compromises, skipped criteria, hardcoded values, limitations). The user decides: mark done, or address items first.

Record the summary in BOTH the phase file's `compromises` field AND the completion commit body. Skipping the phase-file write loses the signal for `audit-roadmap`.

Full format in `references/gate-protocol.md`.

### Step 5: Complete the phase

The schema enforces gate results when `status: 'done'`. In one edit to the `.phase.ts` file, set: `status: 'done'`, `gate` (from Rounds 1..N results), `gateRounds` (structured entries including Round 0), `metrics`, `compromises` (from Step 4b), `completedDate: 'YYYY-MM-DD'`.

Then: `pnpm type-check` → `pnpm emit:phases` → commit `docs(roadmap): mark phase N complete` (compromise summary in body) → push to develop.

If `scripts/collect-phase-metrics.ts` exists, it fills `gate` and `metrics` automatically:
```bash
npx tsx scripts/collect-phase-metrics.ts N
```

Field-level detail, `StructuredGateRound` shape, and Round 0 schema integration in **`references/gate-protocol.md`**.

## Execution Mode: parallel

If the phase has `executionMode: 'parallel'`, you MAY batch tasks that are truly independent (different files, no shared state). But:
- Still create TaskCreate for each task
- Still commit each task separately
- Still verify between batches
- If any task depends on another's output, execute them sequentially regardless

## What NOT to do

- **Do NOT launch a single agent to "do all tasks"** — this is the exact anti-pattern this skill prevents
- **Do NOT skip the commit between tasks** — each task must be an atomic commit
- **Do NOT reorder tasks** — the phase author ordered them for a reason (dependencies, risk)
- **Do NOT combine small tasks** — "they're trivial" is how errors creep in
- **Do NOT mark a task done before committing** — done means committed and verified
- **Do NOT skip type-check between tasks** — catching errors early is the whole point
