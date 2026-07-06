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
- A followups reference: "roadmap/followups/<arcId>.md item 3" — arc-sweep's deferred
  blueprints live there (NOT in backlog labels); read the item, it IS the plan input

**Flags:**
- `--skip-review` — skip the automatic `/review-phase N` pass after commit. Default: review runs. Use only for fast iteration on a WIP plan you know is unfinished.

## PRIME RULE 1: KNOW THE DIFF BEFORE WRITING THE TASK

**Every task must be planned to the point where you know the exact diff before writing code.**

If you cannot name the specific files, functions, and nature of the change — you haven't planned enough. Go read the code first.

| Bad (vague, low-confidence) | Good (specific, high-confidence) |
|---|---|
| "Rework calculations" | "Add missing deduction to `lib/services/settlement.ts:calculateTotal` (line ~142)" |
| "Fix the dashboard" | "Replace `sumAmounts('TYPE_A')` with `sumAmounts('TYPE_A', 'TYPE_B')` in `components/dashboard.tsx:SummaryCard`" |
| "Update business rules" | "Add `NEW_EVENT` to the trigger list in `lib/rules/escalation.ts:shouldEscalate`" |

## PRIME RULE 2: ESCALATE TO ARCHITECT BEFORE GIVING UP

Tokens are not the constraint; hallucinations and shortcuts are. Whenever you would otherwise (a) write a vague low-confidence task because the diff is unclear, (b) drop a `[NEEDS CLARIFICATION]` marker, (c) split work into "investigate first" sub-phases because the decomposition isn't obvious, or (d) STOP and ask the user a planning question — **first** invoke `zeroh-roadmap:software-architect` (foreground, synchronous, single hop) per its **Decision Contract** in `agents/software-architect.md`.

Pass the agent: the user's one-line request, files you've already investigated (with brief findings), where you got stuck, plus the convenient path you were about to take vs the proper path you can see. The agent returns `PROCEED_WITH_TASK` or `ESCALATE_TO_USER`.

**Apply the verdict literally:**
- `PROCEED_WITH_TASK` → write the high-confidence task with the named files / functions / lines. No marker, no vague phrasing.
- `ESCALATE_TO_USER` → only verdict that justifies stopping plan-phase or writing a `[NEEDS CLARIFICATION]` marker. The marker's text becomes the architect's specific question.

**Escalation rules:**
- **Fires at Step 2 / 2b / 3 only** — task authoring. Not Step 1 (mechanical number computation) or Step 4+ (commit / review handoff).
- One ambiguity = one architect call. No batching.
- Three+ escalations in one phase = the **phase is too broad**. STOP, surface the pattern, ask the user whether to narrow scope or split.

## Protocol

### Step 1: Reserve the next phase number (atomic)

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/claim-phase-number.sh"
```

The script scans BOTH `roadmap/phases/` and `roadmap/archive/` (one monotonic namespace),
counts outstanding claims, and atomically creates `<N>.claim` in the git COMMON dir
(`$(git rev-parse --git-common-dir)/zeroh-roadmap-claims` — shared across ALL worktrees of
the repo) with noclobber — **creation IS the lock**, so two concurrent sessions (even in
different worktrees) can never claim the same number (the loser gets EEXIST and the script
retries at N+1). It prints the claimed N.
If the consumer scaffolded the script locally (`scripts/claim-phase-number.sh`), that copy
works identically. No gitignore is needed — the claim lives under `.git`, so it is never
tracked (the legacy `roadmap/phases/.claims/` is still scanned read-only during transition).

Phase numbers are monotonic — never reuse historical gaps, including numbers that now live
under `roadmap/archive/`. Never hand-compute max+1; that unlocked read-compute-write is
exactly the collision this script exists to kill.

### Step 2: Investigate the code BEFORE writing any task

This is the most important step. For each area of work:

1. **Read the relevant source files** — not just the entry point, but the call chain
2. **Trace references with Grep** — grep for the symbol name (imports, call sites, string-literal/registry references) to understand the dependency graph
3. **Identify the exact functions and lines that change** — "line ~142" is acceptable, "somewhere in the file" is not
4. **Check downstream consumers** — will this change break anything?
5. **Check for existing solutions** — does a utility already exist? Is there a pattern to follow?

**If you can't do steps 1-5 for a piece of work, it's not ready to be a task.** Split the investigation into its own task first.

### Step 2b: When the answer isn't in the code — `[NEEDS CLARIFICATION]` markers

**Precondition:** before writing a marker, you must have invoked the architect per **Prime Rule 2** and received `VERDICT: ESCALATE_TO_USER`. Markers written without that escalation are forbidden — most of the time the architect resolves the question by reading more code than the planner did, and no marker should ever have been written.

Some questions genuinely cannot be resolved by reading source, no matter how hard you look. Examples:

- A business rule the codebase doesn't yet express (e.g. "what's the max retry count?")
- A product decision that could go two valid ways (e.g. "should partial-month settlement pro-rate by days or treat the partial period as full?")
- An environment constraint that isn't in the repo (e.g. "which Stripe webhook endpoint does staging point at?")

For these, embed a marker directly in the task's `problem` or `acceptanceCriteria` string:

```typescript
{
  problem: 'Settlement modal shows the wrong amount for partial months. '
    + '[NEEDS CLARIFICATION: should partial months pro-rate by days, or '
    + 'treat the partial period as a full period?]',
  // ...
}
```

**Rules:**

- A marker must name a **specific question**, not just "TBD" or "figure this out".
- A marker means the task is **not yet executable**. The phase may be committed on disk, but it must NOT be queued in `roadmap/backlog.ts` until every marker is resolved.
- Do NOT guess and leave a silent assumption. The marker is the honest answer; a silent wrong guess is the failure mode markers prevent.
- `do-phase` and `review-phase` will both refuse to proceed on a phase containing unresolved markers.

Markers are for **genuine ambiguity** that the code cannot answer. If a function's behavior is unclear, read the function — don't drop a marker as a shortcut out of investigation.

### Step 3: Write the phase file

**Pick the `kind` first.** It drives gate selection in `do-phase`. Use this table:

| If the phase's primary work is… | `kind` |
|---|---|
| New screen, layout, copy, design refresh, mockup, branding, dark-mode tweak | `mockup` |
| Algorithm, business rule, calculation, new logic, new feature with behaviour | `logic` |
| Bug fix, persistence/event/marshal-chain fix, refactor, perf | `hardening` |
| Version cut, changelog, infra, deploy plumbing | `release` |

When in doubt between `logic` and `hardening`, pick `hardening` — the cost of one extra integration rerun is far less than shipping an unverified persistence fix.

`kind` is independent of `category`: a `category: 'fix'` phase is almost always `kind: 'hardening'`, but a `category: 'feature'` phase can be `mockup`, `logic`, or `hardening` depending on what it actually changes.

**Author the `assumptions` tripwires.** Every load-bearing claim about the CURRENT state of the territory that a task depends on — a file's behavior, a test's status, a caller count, a seam's existence — becomes an `assumptions[]` entry `{ claim, verify: '<one runnable command — grep/test/ls>', onFalse: 'ESCALATE' }`. 2-6 per phase is typical; **zero is legitimate for a pure-prose phase — say so explicitly.** `assumptions` are for claims whose FALSITY CHANGES THE PLAN (the RAGUNIFY 1343.6 miss: the plan asserted a test would pass unmodified, the territory disagreed, and the deviation reached only a commit message) — NOT for every `keyFiles` anchor (those keep their "verify at execution" comments; the two are complementary). Worked example: `assumptions: [{ claim: 'agui routes model writes through runGovernedToolCall', verify: 'grep -n runGovernedToolCall src/agui.ts', onFalse: 'ESCALATE' }, { claim: 'no test pins the current mask output', verify: 'grep -rl maskPrompt src', onFalse: 'ESCALATE' }]`.

**Set `userFacing` + `flag` at plan time.** For every phase adding user-visible behavior, set `userFacing: true` and fill `flag` — either `{ id: 'FLAG_ID' }` (a runtime kill-switch, default-OFF discipline) or `{ bootWired: true, justification: '<why it cannot hot-flip>' }` (which then joins the feature manifest; the justification is where a default-ON choice is ratified or rejected — the ATELIER deviation). review-phase Mode A checks it; the 1367 validator enforces presence ≥ the enforcement floor. A non-user-facing phase omits both.

**Standalone-phase interview.** When a standalone phase request is underspecified, INTERVIEW the user first (same one-question-at-a-time, scope-first shape as plan-arc's interview) BEFORE Step 2 investigation. This extracts USER INTENT/SCOPE at request time; PRIME RULE 2's architect route owns TECHNICAL decisions DURING planning — state the split, never a second competing stop-and-ask.

**Then consider `testScope` (optional — only meaningful when the consumer CLAUDE.md has a
`## Test cadence` block).** It scopes the gate's `unit`/`integration` slots independently of
`kind`: `static` (docs/data/generated-only diff) · `scoped` (enumerable tests — list them in
`scopedTests`) · `relevant` (+ suites exercising the touched modules) · `full`. Omit it and
the gate derives the scope from the diff; a declared value can only RAISE the derived floor
(`## Gate specialists` paths always force `full`), so declare it when you know the phase is
data/docs-shaped and want that recorded up front — never to sneak under the floor.

**And assess `reviewScope` (optional — the gate's agent-chain ladder, gate-protocol.md).**
This is a genuine plan-time judgment, not bookkeeping: *what review is actually high-value
for this diff?* `none` (docs/data — no review agents) · `light` (small, mechanical, or
well-trodden code: ONE reviewer, no architect-critique/simplifier) · `full` (the whole
chain — new seams, subtle logic, anything governed). Unlike `testScope` a declared value may
LOWER the derived rung, because review-phase Mode A independently ratifies it (an unjustified
low rung = NEEDS WORK) — with one hard floor the gate enforces regardless: a diff touching a
`## Gate specialists` path always runs `full`. When you declare below `full`, say in the
phase notes WHY the skipped stages are low-value here — that one line is what the Mode A
reviewer judges.

Create `roadmap/phases/phase-{N}.phase.ts` using `definePhase()`:

```typescript
import { definePhase } from '@/lib/roadmap/schema'

export default definePhase({
  phase: N,
  name: 'Verb-phrase describing the outcome',
  status: 'backlog',
  category: 'feature',  // feature | fix | refactor | test | docs | infra
  kind: 'logic',         // mockup | logic | hardening | release — drives gate selection (see picker below)
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
      // batchMode: true,  // Set to bypass the size lint when files.length > 10 OR steps.length > 6. Use ONLY for mechanical multi-commit work (rename across N files, parallel template authoring) — see Self-check #9.
      done: false,
    },
  ],
})
```

### Step 4: Validate the phase file

Run the `types` slot, then the `emit` slot (both resolved from the consumer's `## Gate commands`
CLAUDE.md block — see do-phase `references/gate-protocol.md`; a missing binding fails loud). The
`types` slot validates the phase compiles; the `emit` slot validates phase discovery and
regenerates the changelog.

If type-check fails, the task data is structurally invalid — fix it before committing.

### Step 5: Self-verify (9-check list)

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
- Grep the repo for any symbol being renamed, moved, or changed (imports AND string-literal references)
- If there are other occurrences, they must be covered by a task in this phase (or documented as out of scope with justification).
- Fail = NEEDS WORK. Incomplete fix — will ship a partial change.

**4. Criteria are verifiable**
Each acceptance criterion must name a specific command to run (the consumer's `unit` / `types` slot command, e.g. `npm test`) or an observable output to check ("page renders X", "API returns 200 with field Y").
- Reject: "works correctly", "implementation verified", "task complete", "properly handles"
- Fail = NEEDS WORK. Unverifiable criterion — do-phase can't confirm the task worked.

**5. Task order respects data flow**
Walk the task list top to bottom. No task may depend on output from a later task. No task may assume a file is unchanged if an earlier task modifies it.
- Check: does task N.3 import/use something task N.4 creates? Does task N.2 modify a file that task N.1 reads in a specific state?
- Any task with explicit `dependsOn: ["N.X"]` — verify N.X exists in this phase and appears earlier in the task list.
- Fail = BLOCKER. Will fail at execution.

**6. No unresolved clarification markers**
```bash
grep -n '\[NEEDS CLARIFICATION' roadmap/phases/phase-{N}.phase.ts
```
Every marker must either be resolved (replaced with the decision) OR the phase is explicitly flagged as non-executable — it is committed but not queued.
- Fail = NEEDS WORK. Phase is planned but not yet decidable. `do-phase` will refuse it.

**7. Task descriptions are concrete (placeholder lint)**
For every task, verify:
- Each `steps[].description` is ≥ 10 chars AND references at least one path or symbol (file path, function name, type name, or specific identifier — not just prose).
- Each `acceptanceCriteria` entry does NOT match `/(implementation|task)\s+(is\s+)?(verified|complete)/i`. Reject "works correctly", "properly handles", "task N.1 implementation verified", "implemented" alone.
- Each `problem` field is ≥ 1 sentence and names what is broken/missing/wrong — not "this needs to be done".

This check exists because the previous review cycle shipped phases with placeholder task descriptions that required full rewrites. If any task fails, the plan is not done — rewrite it.
- Fail = BLOCKER.

**8. Hypotheses refuted (only if `category: 'fix'` OR `kind: 'hardening'`)**
The phase's `notes` field must contain a `## Hypotheses` block with:
- ≥ 2 candidate root causes ranked by prior probability.
- A one-line refutation strategy or evidence pointer per candidate (file:line, test command, log signature).
- Exactly one candidate marked `CONFIRMED` with evidence (file:line, test output, or commit SHA where the bug reproduced).

The other candidates must be marked `REFUTED — <reason>` or `NOT TESTED — <why deferred>`. This catches the "wrong root cause hypothesis" pattern (RunEvent fan-out, Mongo polling) before tasks are written against the wrong target.
- Fail = NEEDS WORK. Re-investigate before authoring tasks.

Skip this check entirely for `kind: 'mockup'`, `kind: 'release'`, or `category` ∈ `{feature, refactor, test, docs, infra}` (unless the phase is explicitly diagnostic — then upgrade to `hardening`).

**9. Task size lint (`batchMode` gate)**
For every task, verify:
- `files.length` ≤ 10 OR `batchMode: true`
- `steps.length` ≤ 6 OR `batchMode: true`

A task that exceeds either limit without `batchMode: true` is a planning error — the unit of intent is no longer "one focused change committable in one pass."

Two valid resolutions, in order of preference:
1. **Split the task** into 2+ smaller tasks. This is the default. Most oversized tasks are actually "and also..." in disguise — separate them.
2. **Set `batchMode: true`** ONLY when the work is genuinely mechanical and the unit of intent is one task even if the unit of commit is many. Examples that justify batchMode: rename `Foo` → `Bar` across 22 files; author 22 shapes from a single template; backfill an enum value in every consumer. Examples that do NOT: "build feature X with all its components" (that's many decisions, not one).

If you set `batchMode: true`, also ensure each `steps[]` entry maps to a clean commit unit — `do-phase` will TaskCreate one subtask per step and commit per step. If your steps don't slice cleanly, re-author them before committing the plan.

- Fail = BLOCKER. Oversized task without batchMode will not pass do-phase auto-spawn discipline.

**If any check fails:** fix the phase file and re-run the failing checks. Commit is acceptable with unresolved markers (check 6) only if the phase is NOT added to the backlog. All other 8 checks MUST pass before commit.

### Step 6: Commit and push

```
docs(roadmap): phase N — <short description>
```

Delete the number reservation in the same breath: `rm -f "$(git rev-parse --git-common-dir)/zeroh-roadmap-claims/<N>.claim"`
(a plain `rm`, NOT a git delete — the claim lives under `.git` and was never tracked; the
committed `phase-N.phase.ts` now holds the number, so the claim file has done its job).

### Step 7: Auto-invoke `/review-phase N`

Unless the user passed `--skip-review`, immediately run `/review-phase N` against the freshly committed phase. The review runs in plan-quality mode (Mode A) because the phase has `status: 'backlog'`.

Why this is mandatory by default: Step 5's self-verification is lazy — an independent pass consistently finds hallucinated paths, stale problem statements, and blast-radius gaps the author missed.

Handling findings:
- **READY (no findings)** — review-phase Mode A Step 8 will queue the phase in `roadmap/backlog.ts` at the position dictated by `priority` + `dependsOn` + `conflictsWith`. Report "Review clean — queued at index K" to the user and stop.
- **NEEDS WORK / BLOCKER findings** — fix each one, then commit `docs(roadmap): phase N — address review findings`. Do NOT re-run review in a loop; one pass is enough. If the user wants another pass, they'll ask. The phase is NOT queued until a clean re-review.

Skip this step entirely if `--skip-review` was passed. Mention in the user-facing summary that review was skipped so the user knows (a) the plan is unverified and (b) the phase is NOT queued — the user must run `/review-phase N` later to validate and queue, or hand-edit `roadmap/backlog.ts`.

## Task Design Rules

### Every task must have:
- `steps[].file` — a REAL file path that exists (or will be created). Never `'roadmap/phases/'` as a placeholder.
- `steps[].description` — what specifically changes in that file
- `acceptanceCriteria` — 1-4 observable outcomes. Not "implementation verified" but "the `integration` slot passes" or "dashboard shows $48 not $4800"
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
| "the `build` slot passes", "file exists" | `"none"` | Build/file checks |
| "docs updated", "config changed" | `"none"` | Not testable by agent |
| "lint passes", "type-check clean" | `"none"` | Validation gate covers this |

**Default to `"none"` when unsure.** TDD adds ~5 min per task (test-engineer agent + red→green cycle). Only use it when the acceptance criteria describe specific function behavior.

### Anti-patterns

Placeholder tasks fail Prime Rule 1. Watch for: `steps: [{ description: 'Implement task N.1' }]`, `acceptanceCriteria: ['Task N.1 implementation verified']`, `problem: 'This needs to be done'`, `title: 'Fix things'`. If you wrote any of these, you haven't planned enough — read the code and rewrite.

## Special Task Types

**Investigation task** — use when root cause isn't yet known. `problem` describes the discrepancy, `steps` enumerate files to read, `acceptanceCriteria` is "root cause identified at file:line + follow-up tasks N.2..N.X written."

**Validation gate task** — always last. `problem`: "All changes must pass the full validation gate." `steps`: one entry pointing at `package.json` running lint/type-check/test/build. `acceptanceCriteria`: "All gate checks pass."

## After Creating the Phase

Report to the user:
1. Phase number + file path + task count.
2. Ready-to-execute (`/do-phase N`) or needs more investigation?
3. Key risks / cross-phase dependencies.
4. **Backlog placement** — index queued by `review-phase`, or "not queued — review found NEEDS WORK / BLOCKER", or "not queued — `--skip-review`".
5. **`[NEEDS CLARIFICATION]` markers** — list each with task ID. Phase is committed but NOT executable until resolved; review-phase will not queue.
6. **Review outcome** — "Review clean" or one-line fix summary. If `--skip-review`, say so — plan unverified, not queued.

`plan-phase` does NOT edit `roadmap/backlog.ts`. Queuing is delegated to `review-phase` Mode A Step 8, which queues only when the verdict is READY at a position reasoned from `priority` + `dependsOn` + `conflictsWith`.
