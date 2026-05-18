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

## PRIME RULE 1: NO COMPROMISES — DONE PROPERLY THE FIRST TIME

**This skill's purpose is to ship phases done, not phases shipped.** Every task is executed at senior-software-architect rigor. The goal is correctness, not convenience.

The implicit goal for every `/do-phase N` invocation — equivalent to the user typing `/goal finish phase N fully and properly, as a senior software architect, no compromises, no hardcodes, no shortcuts` — is **already set by virtue of running this skill**. Treat it that way.

**Before writing any code for a task, ask:**
- Is this the senior-architect-correct implementation, or the convenient one?
- Am I about to hardcode a value because it's faster than designing the abstraction?
- Am I about to silence ambiguity (e.g. "first match wins") instead of surfacing it as an explicit error?
- Am I about to defer a real problem to a follow-up that probably won't get planned?
- Am I about to write a twin-JSX block instead of driving both from one array?

**If the answer to any is "yes" — do the correct thing instead.** Magic numbers get named constants with rationale. Duplicate-name ambiguity throws. Per-currency JSX gets a `CURRENCIES` array. The proper solution is almost always one extra minute of thinking and one less line of code.

The `transparencyReport.compromises` field is an **audit trail for the rare case** where a compromise was genuinely forced by something outside this phase's scope (missing upstream data, a third-party API quirk you can't fix here). It is NOT a release valve for "I didn't want to solve this properly." A clean phase has every `compromises` field set to `"None"`.

**Escalate via the senior architect, not via the user.**

This plugin runs long-running autonomous work. Tokens are not the constraint — hallucinations and shortcuts are. So whenever you would otherwise (a) write a non-`"None"` value into `compromises`, (b) hardcode a value, (c) silence ambiguity, (d) defer a real problem with a TODO, or (e) STOP-and-ask the user — **first** launch the `zeroh-roadmap:software-architect` agent inline (foreground, synchronous, NOT background) with this exact contract:

```
Phase N task N.X — architectural-decision request

Context:
  - Task acceptance criteria: <paste from task.acceptanceCriteria>
  - Files in scope: <paste from task.files>
  - Phase notes relevant to this decision: <quote any directly-applicable lines from phase.notes>

Situation:
  I was about to <describe the compromise / shortcut / hardcode / would-stop reason>.
  The convenient path: <one line>
  The proper path I can see: <one line, or "I can't see a proper path">

Verify on the way:
  - Does the file/function I'm about to edit actually exist and behave as I'm assuming? Read it.
  - Is there an existing utility/pattern I'm about to duplicate? Grep for it.
  - Is the ambiguity I'm about to silence resolvable from existing code or schema? Read it.

Return one of:
  VERDICT: PROCEED_WITH_FIX
    Correct approach: <specific files, functions, lines, exact change>
    Why: <1-2 lines>

  VERDICT: ESCALATE_TO_USER
    Specific question: <one well-posed question with the two or three valid options the user must choose between>
    Why this genuinely needs user input: <1-2 lines explaining why no amount of code-reading can resolve it>
```

**Then apply the architect's verdict literally:**
- `PROCEED_WITH_FIX` → implement the correct approach. `compromises` stays `"None"`. No user interruption.
- `ESCALATE_TO_USER` → stop, post the architect's specific question to the user, wait for the answer. Only this verdict justifies stopping a do-phase run.

**Rules for this escalation:**
- The architect runs **inline / synchronous**. Do NOT pass `run_in_background: true`. The decision blocks the current task.
- The architect may itself read files and grep — encourage it (token budget is not the constraint).
- The architect must NOT invoke another architect (no recursion). If `software-architect` can't decide, it returns `ESCALATE_TO_USER`.
- This escalation is **exempt** from the auto-spawn discipline rule in Step 4 — it is an explicitly-allowed sub-agent call during task execution, alongside `test-engineer` for `testMode: "tdd"|"e2e"`.
- Do not batch escalations. One compromise = one architect call. Aggregating ("here are five things I might compromise on, what do you think?") loses the per-decision rigor.
- If the same kind of compromise comes up three times in the same phase, that is signal that the **phase plan was wrong** — STOP, escalate to user with the pattern, and ask whether to re-plan rather than re-architect each instance.

## PRIME RULE 2: ONE TASK AT A TIME

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
2. **Read the task** — read the `problem`, `steps`, `acceptanceCriteria`, `files`, `testMode`, and `batchMode` fields

**If `batchMode: true`, run the Batch Protocol below instead of steps 3–8.** Batch tasks have a different commit shape (one commit per step) and a different transparency report contract (aggregated across commits). The standard flow below assumes `batchMode: false`.

3. **Execute** — branch on `testMode` (`batchMode: false` only):

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

### Batch Protocol (`batchMode: true` tasks)

Replaces steps 3–8 above. Use ONLY for tasks with `batchMode: true` — set deliberately at plan time for genuinely mechanical multi-commit work (rename `Foo` → `Bar` across 22 files, author N parallel shapes from a template). The plan-phase / review-phase size lint forbids `batchMode: true` for non-mechanical work.

1. **TaskCreate one subtask per `steps[]` entry.** Subject: `Phase N task N.X (k/M) — <step.description>`. activeForm follows the same template. The user sees per-unit progress in the parent transcript.
2. **Implement and commit each subtask serially.** For each step:
   a. TaskUpdate status to `in_progress`.
   b. Apply the step's edits to the named file.
   c. Run `pnpm type-check`. Failure → fix it in this same step's commit; do not roll back, do not skip ahead.
   d. Commit with message: `<type>(<scope>): phase N task N.X (k/M) — <step.description first ~60 chars>`.
   e. TaskUpdate status to `completed`.
3. **No sub-agent forks.** `batchMode: true` is permission to make many commits inline, NOT permission to spawn sub-agents. Forking abandons the per-step commit discipline and produces an opaque mega-deliverable. The auto-spawn discipline rule (Step 4 prelude) applies in full force here.
4. **Aggregated transparency report after the last step.** One report covering the entire batch task:
   - `whatWasDone`: bullet list, one line per step, summarizing per-unit deltas (`step k/M: <file> — <one-line>`).
   - `how`: 1–2 sentences describing the overall approach (e.g. "applied template `lib/shape-template.ts` to each of 22 catalog entries, derived test from existing `lib/__tests__/shape-template.test.ts`").
   - `compromises` / `skipped` / `hardcoded` / `limitations`: aggregate across all steps. Same `"None"`-or-≥10-chars rule as standard flow.
5. **Update phase file** in its own commit AFTER the last step lands. Set `done: true`, `doneDate`, and persist the aggregated `transparencyReport`. Commit message: `docs(roadmap): phase N task N.X — mark batch done`. Always one commit, never folded into a step's commit — predictability matters more than commit count.
6. **TaskUpdate** the original phase-task (created in the do-phase setup before per-task iteration) to `completed`. The per-step subtasks are already individually completed in step 2e.
7. **Chat output cap**: per-step commit messages stream through naturally. The end-of-task aggregated transparency report follows the standard ~30-line / ~1500-char cap from Step 4b — long step lists go into the persisted `whatWasDone` field, the chat shows a head + tail with `+N more in roadmap/phases/phase-N.phase.ts`.

If a step fails twice in a row (type-check still red after one fix attempt), STOP. Do not power through the batch. Surface the failing step and the actual error to the user — the batch's mechanical assumption is broken.

### Step 4: Validation gate

After the last task commits, run the validation gate. Full protocol in **`references/gate-protocol.md`** — read it once per session, then return here.

**Launch every gate agent synchronously.** Do NOT pass `run_in_background: true` on any `architect-critique`, `simplifier`, or `code-reviewer` Agent call. Background agents end the parent turn and rely on a completion notification that does not fire until the sub-agent's final `end_turn` — creating a silent dead-zone where the parent looks stopped. The gate is a critical-path sequence; there is no useful parent work to do in parallel, so block on each stage.

Before entering the gate, finish (or kill) any long-running background bash you started — e.g. a manual `pnpm tauri build`. Do not launch one "to run in parallel with the gate." The gate's mechanical checks already run `pnpm build` inside Round N.

**Auto-spawn discipline.** During Steps 1–4 do NOT spawn `Explore`, `general-purpose`, or arbitrary `Task` sub-agents. The architect-critique → simplifier → code-reviewer chain is the only auto-spawned set. Investigation, gap analysis, and review are done inline by default — fork only when the phase doc explicitly requests a sub-agent (e.g. `agentDispatch: true` on an investigation task) or the user asks for one. The user has overridden silent forks before; respect that.

**This includes "this task feels too big to do inline" reactions.** A task that feels oversized at runtime means one of two things: (a) it's actually fine and you're hesitating — push through; or (b) the plan was wrong. In case (b), STOP and surface a split proposal to the user. Do NOT reach for `Agent(...)` to run the task in a sub-agent — that path produces opaque mega-deliverables, abandons commit-per-unit discipline, and fails the user's prior feedback that fork-for-big-tasks "doesn't produce good results." If the planner intended this to be multi-commit, they would have set `batchMode: true` and you would already be in the Batch Protocol above.

**Gate set is selected by `phase.kind`:**

| `kind` | Gate set |
|---|---|
| `mockup` | Mechanical only: `pnpm biome check . && pnpm type-check`. **Skip** architect-critique, simplifier, code-reviewer loop. Step 4b summary still runs (cap applies). |
| `logic` | Full gate: architect-critique → Round 0 simplify → Rounds 1..N correctness loop. |
| `hardening` | Full gate **plus** the bug-fix closure rule from `review-phase` Mode B Step 2(b) — for any persistence/event/marshal-chain task, integration-suite rerun is the closure criterion, not unit-test pass. |
| `release` | Full gate **plus** `pnpm test:e2e` in Round 1's mechanical checks (in addition to the existing `pnpm e2e:local`). |

If `kind` is missing on a legacy phase, treat as `logic` and warn the user once: *"Phase N has no `kind` field — defaulted to `logic`. Backfill with `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts`."*

The gate has four stages (skipped wholesale for `kind: 'mockup'`):

**Architect-critique pass** (one-shot, does NOT loop). Launch one `architect-critique` agent with `git diff <phase-start-SHA>..HEAD` and the phase file. It auto-fixes shortcuts, hardcodes, TODOs, and pre-existing issues in files the phase touched, then commits (`fix(phase-N): architect critique — <summary>`). Hard-stops (multi-repo breaking changes, scoped-out systems, product decisions, speculative fixes) are NOT fixed — they surface in the critique's report and feed the compromise summary (Step 4b).

**Per-stage echo contract** (applies to architect-critique, simplifier, and EACH code-reviewer round). The agent's full report stays in the sub-agent transcript — but echo a condensed summary inline in chat so the user can see what happened without scrolling. Cap each echo at ~10 lines / ~600 chars. Format:

```
[Architect-critique] FIXED 4: lib/foo.ts hardcoded URL → config; lib/bar.ts removed TODO; api/baz.ts null check; …
                      SURFACED 1: DB migration users.verified_at — confirm staging before deploy
                      HARD-STOPS 1: [MULTI-REPO] api/client.ts contract change — plan phase in zeroh-admin
[Simplifier]         −62 / +4 lines across 7 files. Top fixes: removed _opts param in lib/foo.ts; deleted unused helper in lib/qux.ts. Bugs noted (forwarded to Round 1): lib/zot.ts:88 missing null check.
[Reviewer R1]        2 findings. CRITICAL 0, HIGH 1, MED 1, LOW 0. Fixed: lib/zot.ts:88 null check; lib/foo.ts:42 off-by-one.
```

Truncate ruthlessly — if the agent reports nothing of interest, a single line is enough (`[Simplifier] nothing to simplify`). The point is non-zero visibility, not full disclosure.

**Round 0 — Simplify pass** (one-shot, does NOT loop). Launch one `simplifier` agent with the updated `git diff <phase-start-SHA>..HEAD` (now including the critique's fixes) and the phase file. It removes dead scaffolding, speculative abstractions, redundant error handling, and any over-extraction the critique may have added — then commits inline (`refactor(phase-N): simplify — <summary>`). Simplification is judgment, not correctness, so it runs exactly once. Bugs the simplifier notices get flagged and forwarded to Round 1 rather than fixed.

**Rounds 1..N — Correctness loop** (loops until clean, hard-cap 5 rounds). Each round:
1. Mechanical checks (`pnpm biome check . && pnpm type-check && pnpm test && pnpm build && bash scripts/pre-review.sh <first-task-SHA>~1 && pnpm e2e:local`). Any failure → fix + commit + restart Round N.
2. Two parallel `code-reviewer` agents reviewing the phase diff (Round 1) or the previous round's fix diff (Round N>1). Confidence ≥80, severities CRITICAL→LOW in scope, INFO recorded but non-blocking.
3. If both agents return zero actionable findings → gate passes. Otherwise fix, record a `StructuredGateRound` entry, loop.

If Round 5 hasn't converged, STOP and surface remaining findings — agents may be cycling.

**NO EXCEPTIONS** — every phase gets the full gate, including docs-only and test-only phases.

### Step 4b: Phase compromise summary (the ONLY human stop)

Aggregate into a phase-level summary:
1. Every task's persisted `transparencyReport` (compromises, skipped criteria, hardcoded values, limitations).
2. The architect-critique's `SURFACED` entries (e.g. DB migrations — applied, but worth knowing before deploy).
3. The architect-critique's `HARD-STOPS` by tag: `[MULTI-REPO]`, `[SCOPED-OUT]`, `[PRODUCT]`, `[SPECULATIVE]`.

The user decides: mark done, address items first, or plan follow-up phases (especially for `[MULTI-REPO]` entries).

**Chat-output cap: ~30 lines / ~1500 chars.** The full summary is already persisted to the phase file's `compromises` field and the completion commit body — don't repeat the long form inline. If the summary would overflow, render a head + tail with a `+N more in roadmap/phases/phase-N.phase.ts` pointer. The cap exists because output-token truncation has historically blocked phase completion mid-summary; treat the file as the long-form surface and chat as the headline.

Record the summary in BOTH the phase file's `compromises` field AND the completion commit body. Skipping the phase-file write loses the signal for `audit-roadmap`.

Full format in `references/gate-protocol.md`.

### Step 5: Complete the phase

The schema enforces gate results when `status: 'done'`. In one edit to the `.phase.ts` file, set: `status: 'done'`, `gate` (from Rounds 1..N results), `gateRounds` (structured entries including Round 0), `metrics`, `compromises` (from Step 4b), `completedDate: 'YYYY-MM-DD'`.

**Groom the backlog in the same commit.** If `roadmap/backlog.ts` contains an entry for this phase, remove it. Done phases do not belong in the execution queue — leaving them there pollutes `do-phase`'s next-up resolution and forces `audit-roadmap` to flag the staleness later. The removal is a one-line edit to `backlog.ts`. If the phase was never queued (e.g. it ran via explicit `/do-phase N`), no edit is needed.

Then: `pnpm type-check` → `pnpm emit:phases` (regenerates `reviews/changelog.json`) → commit `docs(roadmap): mark phase N complete` (compromise summary in body) → push to develop.

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
