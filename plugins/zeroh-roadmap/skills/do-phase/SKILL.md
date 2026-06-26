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

## PRIME RULE 1: NO COMPROMISES — ESCALATE TO ARCHITECT, NOT TO USER

Every task ships at senior-architect rigor. Goal is correctness, not convenience. Magic numbers → named constants. Duplicate-name ambiguity → throw. Twin JSX blocks → one array. Tokens are not the constraint; hallucinations and shortcuts are.

**Comment discipline.** Code comments earn their keep by explaining **non-obvious WHY** — a hidden invariant, a workaround for a specific bug, behavior that would surprise a reader. Comments must NOT:
- Reference phases (`// added in phase 374.1`, `// phase 184.5 metadata`) — phase numbers rot when the phase archives, and provenance already lives in git blame + the phase file.
- Explain WHEN or WHO (`// added 2026-05-18`, `// from the dual-write migration`) — git log owns that.
- Explain WHAT (`// builds the form-tag dictionary at startup`) — well-named identifiers already say what.
- Live at the re-export site when the real explanation belongs on the function declaration.

If a comment is non-obvious-WHY, put it on the function/type where the invariant lives, not at every call site. If you're tempted to write phase-numbered section dividers (`// ── Event metadata (phase 184.5) ──`), strip the parenthetical — `// ── Event metadata ──` is the keeper.

**Whenever you would otherwise:** (a) write a non-`"None"` value into `transparencyReport.compromises`/`hardcoded`/`skipped`, (b) hardcode a value, (c) silence ambiguity, (d) defer a real problem with a TODO, or (e) STOP and ask the user a question — **first** invoke `zeroh-roadmap:software-architect` (foreground, synchronous, single hop) per its **Decision Contract** in `agents/software-architect.md`.

Pass the agent: the task's `acceptanceCriteria` + `files` + relevant `phase.notes`, plus a one-line description of the convenient path you were about to take and the proper path you can see (or "can't see one"). The agent returns `PROCEED_WITH_FIX` or `ESCALATE_TO_USER`.

**Apply the verdict literally:**
- `PROCEED_WITH_FIX` → implement the named approach. `compromises` stays `"None"`. No user interruption.
- `ESCALATE_TO_USER` → post the architect's specific question to the user, wait. This is the only verdict that justifies stopping a do-phase run.
  - User picks proper-solution option → implement it; no debt logged.
  - User accepts the compromise → record in the appropriate `transparencyReport` field per schema's field-meaning rules (`TransparencyReportShape` doc). do-phase does NOT write to `phase.debtResolutions` — that's release-sweep's job.
  - **Arc-mode:** there is no reachable user inside a phase-executor. `ESCALATE_TO_USER` does NOT prompt — it bounces up as the executor's `PhaseExecutionResult` with `status: "escalated"` (carrying the architect's question + options) for the `do-arc` orchestrator to surface. See Step 4b.

**Escalation rules** (full Decision Contract lives in `agents/software-architect.md`):
- One compromise = one architect call. No batching.
- If three+ escalations land in the same phase, the **plan was too broad** — STOP, surface the pattern to the user, ask whether to re-plan.
- This escalation is exempt from the Step 4 auto-spawn ban — same exemption as `test-engineer` for `testMode: "tdd"|"e2e"`.

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
- `status` — must be `'backlog'` or `'in-progress'`. If `'done'`, `'cancelled'`, or `'historical'` (all terminal), tell the user and stop.
- `executionMode` — `'sequential'` (default) or `'parallel'`. Sequential = this protocol. Parallel = you may batch truly independent tasks (rare).
- `tasks[]` — the ordered list of work. Execute in order.
- `notes` — read for context (architecture decisions, investigation data).

### Step 0.5: Verify phase dependencies

If the phase declares `dependsOn: [X, Y, ...]` (phase-level deps), check that every referenced phase exists and is terminal-complete — `status: 'done'` OR `status: 'historical'` (a historical phase is a completed legacy prerequisite, exactly like an archived done phase):

```bash
for dep in <each number from dependsOn>; do
  grep -H "status:" "roadmap/phases/phase-${dep}.phase.ts" 2>/dev/null || echo "MISSING: phase-${dep}.phase.ts"
done
```

If any dependency is missing or is neither `'done'` nor `'historical'`, STOP and tell the user:

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
3. **No sub-agent forks for the steps.** `batchMode: true` is permission to make many commits inline, NOT permission to spawn sub-agents to absorb the steps. Forking the steps abandons the per-step commit discipline and produces an opaque mega-deliverable. The auto-spawn discipline rule (Step 4 prelude) applies in full force here — including its arc-mode scoping: it bans forks that absorb phase work, not the do-phase runner itself being a phase-executor sub-agent.
4. **Aggregated transparency report after the last step.** One report covering the entire batch task:
   - `whatWasDone`: bullet list, one line per step, summarizing per-unit deltas (`step k/M: <file> — <one-line>`).
   - `how`: 1–2 sentences describing the overall approach (e.g. "applied template `lib/shape-template.ts` to each of 22 catalog entries, derived test from existing `lib/__tests__/shape-template.test.ts`").
   - `compromises` / `skipped` / `hardcoded` / `limitations`: aggregate across all steps. Same `"None"`-or-≥10-chars rule as standard flow.
5. **Update phase file** in its own commit AFTER the last step lands. Set `done: true`, `doneDate`, and persist the aggregated `transparencyReport`. Commit message: `docs(roadmap): phase N task N.X — mark batch done`. Always one commit, never folded into a step's commit — predictability matters more than commit count.
6. **TaskUpdate** the original phase-task (created in the do-phase setup before per-task iteration) to `completed`. The per-step subtasks are already individually completed in step 2e.
7. **Chat output cap**: per-step commit messages stream through naturally. The end-of-task aggregated transparency report follows the standard ~30-line / ~1500-char cap from Step 4b — long step lists go into the persisted `whatWasDone` field, the chat shows a head + tail with `+N more in roadmap/phases/phase-N.phase.ts`.

If a step fails twice in a row (type-check still red after one fix attempt), STOP. Do not power through the batch. Surface the failing step and the actual error to the user — the batch's mechanical assumption is broken.

### Step 4: Validation gate

After the last task commits, run the validation gate per **`references/gate-protocol.md`** — load it once per session for stage detail, echo contract, and `StructuredGateRound` shape.

**Gate set is selected by `phase.kind`:**

| `kind` | Gate set |
|---|---|
| `mockup` | Mechanical only: `pnpm biome check . && pnpm type-check`. **Skip** architect-critique → simplifier → code-reviewer chain. Step 4b summary still runs. |
| `logic` | Full gate: architect-critique → Round 0 simplify → Rounds 1..N correctness loop (hard-cap 5). |
| `hardening` | Full gate **plus** the integration-suite-rerun closure rule for persistence/event/marshal-chain tasks (see `review-phase` Mode B Step 2(b)). |
| `release` | Full gate **plus** `pnpm test:e2e` in Round 1's mechanical checks. |

Missing `kind` on a legacy phase → default to `logic`, warn once. **No exceptions** — every phase gets its kind's gate, docs and tests included.

**Two refinements (see `references/gate-protocol.md`):** (1) **Test cadence** — under **arc-mode** the gate runs only the tests *relevant* to the phase diff (plus lint/type/build); the full unit+integration+e2e suite is deferred to the arc end (`do-arc` Step 8, once, after the sweep + validate-arc, gating the merge). Inline single-phase runs keep the full suite at the gate. (2) **Simplifier skips a pure-docs/prose diff** — Round 0 has no code to act on when the diff is entirely Markdown/docs; it records a skipped `round: 0` entry (same spirit as `mockup` skipping the chain). A mixed diff with any executable code still runs it.

**Sub-agent rules:** launch all gate agents synchronously (no `run_in_background`). Auto-spawn discipline applies during Steps 1–4 — the architect-critique → simplifier → code-reviewer chain is the only auto-spawned set during the gate; the architect-gate from Prime Rule 1 and `test-engineer` from `testMode` are the only sub-agent calls that may **absorb phase work** during task execution. No `Explore` / `general-purpose` / arbitrary `Task` forks. A task that "feels too big" is either fine (push through) or wrongly planned (STOP, surface split proposal) — never launch a sub-agent to absorb it.

This ban scopes the actor **while executing a phase's tasks and gate** — it does NOT forbid do-phase from *being* a sub-agent. Under arc-mode (the `do-arc` orchestrator, phase 858) the do-phase runner is itself a **phase-executor** sub-agent: one executor = one whole phase. What stays forbidden, in arc-mode exactly as inline: a phase-executor spawning another phase-executor (no recursion past a single phase), `Explore` / `general-purpose` forks, or any fork that offloads a "too-big" task.

### Step 4b: Phase compromise summary (the ONLY human stop — inline mode)

Aggregate into a phase-level summary:
1. Every task's persisted `transparencyReport` (compromises, skipped criteria, hardcoded values, limitations).
2. The architect-critique's `SURFACED` entries (e.g. DB migrations — applied, but worth knowing before deploy).
3. The architect-critique's `HARD-STOPS` by tag: `[MULTI-REPO]`, `[SCOPED-OUT]`, `[PRODUCT]`, `[SPECULATIVE]`.

**Inline mode (do-phase driven by the main session — the default):** this is the ONLY human stop, unchanged. The user decides: mark done, address items first, or plan follow-up phases (especially for `[MULTI-REPO]` entries).

**Arc-mode (do-phase running inside a phase-executor — phase 858's `do-arc`):** do NOT stop and ask — there is no reachable user. Emit the same aggregate as a typed `PhaseExecutionResult` (the shape from phase 855, `templates/schema.ts`) as the executor's final message:
- `status: "escalated"` on a hard `ESCALATE_TO_USER` verdict or a `[MULTI-REPO]` / `[PRODUCT]` hard-stop — carry the architect's `question` + `options` in `escalation`. Do NOT guess past the escalation.
- otherwise `status: "done"` with the compromise roll-up mapped into `compromises` / `skipped` / `hardcoded` / `surfaced` / `hardStops` / `gateRounds`.

The human stop relocates to the orchestrator (`do-arc`), which surfaces escalations and the arc-wide roll-up before merge. The phase-file `compromises` string is still written either way (Step 5) — the structured result is an addition, not a replacement.

**Chat-output cap: ~30 lines / ~1500 chars.** The full summary is already persisted to the phase file's `compromises` field and the completion commit body — don't repeat the long form inline. If the summary would overflow, render a head + tail with a `+N more in roadmap/phases/phase-N.phase.ts` pointer. The cap exists because output-token truncation has historically blocked phase completion mid-summary; treat the file as the long-form surface and chat as the headline.

Record the summary in BOTH the phase file's `compromises` field AND the completion commit body. Skipping the phase-file write loses the signal for `audit-roadmap`.

Full format in `references/gate-protocol.md`.

### Step 5: Complete the phase

The schema enforces gate results when `status: 'done'`. In one edit to the `.phase.ts` file, set: `status: 'done'`, `gate` (from Rounds 1..N results), `gateRounds` (structured entries including Round 0), `metrics`, `compromises` (from Step 4b), `completedDate: 'YYYY-MM-DD'`.

**Groom the backlog in the same commit.** If `roadmap/backlog.ts` contains an entry for this phase, remove it. Done phases do not belong in the execution queue — leaving them there pollutes `do-phase`'s next-up resolution and forces `audit-roadmap` to flag the staleness later. The removal is a one-line edit to `backlog.ts`. If the phase was never queued (e.g. it ran via explicit `/do-phase N`), no edit is needed.

**Also strip narrative referencing this phase.** If `backlog.ts` has track-narrative comments that explicitly name the phase being removed (`// Track 1 — phase 467 shipped 2026-…`, `// 467 + 472 complete; remaining: 359`, etc.), remove those comments too in the same edit. The backlog is queue-only per its header — narrative about completed work belongs in the commit history, the phase file's `compromises` field, and `reviews/changelog.json`, not in backlog comments. Operator-curated comments NOT naming this phase (track-priority headers, in-flight notes for other phases) stay.

Then: `pnpm type-check` → `pnpm emit:phases` (regenerates `reviews/changelog.json`) → commit `docs(roadmap): mark phase N complete` (compromise summary in body) → push to develop.

**Arc-mode override.** When do-phase runs inside a phase-executor (signalled explicitly by `do-arc`), the executor still sets the phase-file fields (`status`, `gate`, `gateRounds`, `metrics`, `compromises`, `completedDate`) **plus `executionResult`** — the typed Step-4b roll-up it is about to return — and commits the phase, but it SKIPS the backlog grooming above and the `pnpm emit:phases` regen. Persisting `executionResult` is what makes the roll-up durable: `do-arc`/`arc-sweep` read the in-context array as an optimization but can re-read it via `discoverResults()`, so a resumed or context-compacted arc is not lossy. Both `roadmap/backlog.ts` and `reviews/changelog.json` are shared-mutable; the `do-arc` orchestrator grooms the backlog and runs `emit:phases` **serially** after each phase-executor returns, so concurrent phase completions never race those files. Inline (non-arc) runs do the grooming + emit themselves exactly as described above, and leave `executionResult` unset — unchanged.

If `scripts/collect-phase-metrics.ts` exists, it fills `gate` and `metrics` automatically:
```bash
npx tsx scripts/collect-phase-metrics.ts N
```

Field-level detail, `StructuredGateRound` shape, and Round 0 schema integration in **`references/gate-protocol.md`**.

## Execution Mode: parallel

If the phase has `executionMode: 'parallel'`, you MAY batch tasks that are truly independent (different files, no shared state). One TaskCreate per task, one commit per task, type-check between batches. Any cross-task dependency forces sequential — no exceptions.
