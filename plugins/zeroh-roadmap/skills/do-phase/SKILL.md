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

   a. Output to the conversation so the user sees it in real time:
   ```
   ### Transparency Report — Task N.X: <title>

   **WHAT WAS DONE:** <1-2 sentence summary>
   **HOW:** <approach, key decisions>
   **COMPROMISES:** <trade-offs made and why, or "None">
   **SKIPPED:** <acceptance criteria not fully addressed, or "None">
   **HARDCODED:** <values that should be configurable, or "None">
   **LIMITATIONS:** <known limitations, or "None">
   ```

   b. Persist the same content as a structured `transparencyReport` field on the task in the phase file. The schema (`TransparencyReportShape`) requires all six sections — use the literal string `"None"` for any section with nothing to report.

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

### Step 4: Validation gate loop (automated — keep looping until clean)

After the last task is complete, run the validation gate. **The loop is automated**: each round fixes findings and re-runs the agents without pausing for user input, until one round reports ZERO findings from all agents.

This replaces the old protocol's instruction to "loop Steps 3→6→7 until clean" with explicit automation — the human no longer drives successive rounds.

**Round N (start with N=1):**

1. **Mechanical checks** — every step must pass before agents run. If any fails, fix it, commit, and restart Round N from the top.

   ```bash
   pnpm biome check .       # lint
   pnpm type-check          # types
   pnpm test                # unit + integration
   pnpm build               # production build
   bash scripts/pre-review.sh <first-task-SHA>~1   # mechanical finding catcher
   pnpm e2e:local           # E2E (MANDATORY)
   ```

2. **Agent reviews** — launch 2 `code-reviewer` agents in parallel. Each receives:
   - **Round 1**: full phase diff (`git diff <phase-start-SHA>..HEAD`)
   - **Round N>1**: only the fix diff from the previous round (scoped per ROADMAP.md:77-81)
   - The phase file for context
   - Hard requirement: findings must have `confidence >= 80`. Lower-confidence findings are dropped.

3. **Evaluate round result:**
   - **Both agents return 0 findings** → gate PASSES for this round. Record the round and proceed to Step 4b.
   - **At least one agent returns ≥1 finding** → fix, record, loop.

4. **Fix findings + record round:**
   - Apply fixes. One commit per logical fix group: `fix(<scope>): phase N gate RN — <what was fixed>`.
   - Build a `StructuredGateRound` record for this round:
     ```typescript
     { round: N, findings: [{ file, line?, severity, confidence, description, fixedInCommit? }], summary: 'Round N: X findings fixed' }
     ```
     Keep this in working memory — it gets written to the phase file in Step 5.
   - Go back to step 1 with Round N+1.

**Hard limit — Round 5**: if the loop has not converged after 5 rounds, STOP and surface the remaining findings to the user. Agents may be cycling (finding-then-rewriting-then-finding). Do not silently loop forever.

**NO EXCEPTIONS** — not for "docs-only", "test-only", or "low-risk" phases. Every phase gets the full gate. If the phase file's validation task specifies additional checks, run those too.

### Step 4b: Phase Compromise Summary (ONLY REAL STOP)

Before marking the phase done, aggregate every task's persisted `transparencyReport` into a phase-level summary:

```
## Phase N Compromise Summary

Tasks: X total | Y clean | Z with compromises

### Compromises
- Task N.1: <one-liner from COMPROMISES section>
- Task N.3: <one-liner>

### Skipped criteria
- Task N.2: <what was skipped>

### Hardcoded values
- Task N.4: <one-liner>
```

**This is the ONLY real STOP in the phase.** The user reviews the summary and decides:
- "Mark done" → proceed to Step 5
- "Address X first" → fix the compromise, then re-run summary

Record the summary in **both**:
1. The phase file's `compromises` field (Edit the .phase.ts file — this is the durable record).
2. The completion commit message body (Step 5).

Persisting to the phase file means the compromise summary survives outside git and is queryable by later skills (e.g. `audit-roadmap`). Skipping the phase file write loses that signal.

### Step 5: Complete the phase

The schema enforces gate results when `status: 'done'`. `pnpm type-check` catches missing fields and wrong literal values (e.g. `typeCheck: 'errors'`, `lint: 'errors'`); `definePhase()` additionally catches `unitTests.passed !== total` and empty `gateRounds` at runtime. Fill everything in one edit:

1. Edit the .phase.ts file — set ALL of these together:
   - `status: 'done'`
   - `gate: { typeCheck: 'clean', lint: 'clean', unitTests: { passed: N, total: N }, ... }` — must reflect passing results from Step 4
   - `gateRounds` — use the structured `StructuredGateRound` shape built in Step 4. At least 1 entry required. Example:
     ```typescript
     gateRounds: [
       {
         round: 1,
         findings: [
           { file: 'lib/services/foo.ts', line: 42, severity: 'HIGH', confidence: 85,
             description: 'Missing null check when payload.user is undefined',
             fixedInCommit: 'a1b2c3d' },
         ],
         summary: 'Round 1: 1 finding fixed',
       },
       { round: 2, findings: [], summary: 'Round 2: 0 findings — gate clean' },
     ],
     ```
     Legacy free-form strings are still accepted by the schema for compatibility with pre-extension phases, but new phases should use the structured form so `audit-roadmap` can query findings.
   - `metrics: { commits, linesAdded, linesRemoved, filesChanged, testsAtStart, testsAtEnd, testsAdded }`
   - `compromises: '<summary from Step 4b>'` — the aggregated compromise/skipped/hardcoded summary. Omit only if every task reported "None" in all six sections.
   - `completedDate: 'YYYY-MM-DD'`
2. Run `pnpm type-check` — confirms gate enforcement passes
3. Run `pnpm emit:phases` to update the registry
4. Commit: `docs(roadmap): mark phase N complete` (include compromise summary in commit body)
5. Push to develop

Alternatively, if `scripts/collect-phase-metrics.ts` exists, it can fill gate + metrics automatically:
```bash
npx tsx scripts/collect-phase-metrics.ts N
```
Then set `status: 'done'` and verify with `pnpm type-check`.

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
