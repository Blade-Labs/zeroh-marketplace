# Gate Protocol

Detailed protocol for the phase validation gate invoked by `do-phase` Step 4 and the phase completion fields invoked by Step 5.

## Overview

Four stages, run in order:

1. **Architect-critique pass** (one-shot, no looping). `architect-critique` agent hunts shortcuts, hardcodes, TODOs, and pre-existing issues in touched files. Auto-fixes everything within scope; surfaces only true hard-stops.
2. **Round 0 — Simplify pass** (one-shot, no looping). `simplifier` agent removes dead scaffolding, speculative abstractions, and any over-extraction the critique may have introduced. Runs exactly once per phase.
3. **Rounds 1..N — Correctness loop** (loops until clean, hard-cap 5). Mechanical checks + two parallel `code-reviewer` agents. Each round fixes findings and re-runs until zero actionable findings.
4. **Compromise summary** — aggregate every task's persisted `transparencyReport` PLUS the critique's surfaced items and hard-stops. This is the ONLY human stop-point in the gate (inline mode; under arc-mode the `do-arc` orchestrator owns the stop — see SKILL.md Step 4b).

After the gate passes, Step 5 fills the phase file with gate results, metrics, and completion date.

---

## Gate Set by `phase.kind`

The gate set is selected from the phase's `kind` field (introduced in `@zeroh-roadmap-schema v3`):

| `kind` | Stages run |
|---|---|
| `mockup` | Mechanical only: `pnpm biome check . && pnpm type-check`. Skip Architect-Critique, Round 0, and Rounds 1..N. Compromise Summary still runs. |
| `logic` | All four stages (default behaviour). |
| `hardening` | All four stages **plus** the bug-fix closure rule from `review-phase` Mode B Step 2(b): for any persistence/event/marshal-chain task, the integration-suite rerun is the closure criterion. Quote the integration test diff in the compromise summary. Unit-test pass alone is NOT sufficient. |
| `release` | All four stages **plus** `pnpm test:e2e` in Round 1's mechanical checks (in addition to `pnpm e2e:local`). |

If `kind` is missing on a legacy phase, treat as `logic` and emit a one-time warning pointing at `scripts/migrate/audit.ts`.

The `kind` field is required at schema parse time; the legacy fallback only covers phases authored before v3.

---

## Per-Stage Echo Contract

Every gate-agent stage (Architect-Critique, Simplifier, each code-reviewer round) echoes a condensed summary inline in chat after the agent returns. The full agent report stays in the sub-agent transcript — the echo exists so the user has non-zero visibility without scrolling.

Cap each echo at **~10 lines / ~600 chars**. Truncate ruthlessly. If the agent's report is empty, a single line is enough (`[Simplifier] nothing to simplify`). Format examples in `do-phase/SKILL.md` Step 4.

This is in addition to the per-stage bookkeeping (commits, gateRounds entries, etc.) — it does not replace any of it.

---

## Architect-Critique Pass (one-shot)

**Why it runs first:** shortcut-hunting is additive work (fixing hardcodes, adding proper handling, updating same-repo callers for a contract change). Running it before the simplifier means the simplifier gets a chance to trim any over-extraction the critique may have introduced. Running it before the code-reviewer loop means the reviewer validates the final combined result in one pass, not two.

**Why one-shot, not looping:** the critique makes judgment calls about whether a shortcut is worth fixing now vs. escalating. There is no "zero" state to converge on. The code-reviewer loop that runs after acts as the validation gate for the critique's fixes — if the critique introduces a correctness issue, reviewers will catch it.

### Protocol

1. Launch exactly one `architect-critique` agent **synchronously** (no `run_in_background`) with:
   - `git diff <phase-start-SHA>..HEAD` — the full phase diff (raw implementation, no simplifier run yet)
   - The phase file — for scope context and transparency-report compromises

   Block on the return. A background launch ends the parent turn and there is no completion notification until the sub-agent's final `end_turn` — the parent will appear to stop between the sub-agent's last commit and its summary.
2. The agent applies auto-fixes and commits as one: `fix(phase-N): architect critique — <summary>`. If nothing was fixed, it commits nothing.
3. Capture the agent's report. It has three sections:
   - **FIXED (auto)** — applied inline; no further action.
   - **SURFACED** — fixed, but worth flagging (DB migrations, schema changes). Carry forward to the compromise summary.
   - **HARD-STOPS** — tagged `[MULTI-REPO]`, `[SCOPED-OUT]`, `[PRODUCT]`, `[SPECULATIVE]`. Carry forward to the compromise summary for user decision.
4. If the agent reports nothing fixed and no hard-stops, that is a valid outcome. Proceed to Round 0.
5. **Do not re-run the agent.** The code-reviewer loop validates whatever the critique left.

---

## Round 0 — Simplify Pass (one-shot)

**Why it runs after critique, before correctness:** taste corrections invalidate bug findings. If the simplifier deletes a helper that the code-reviewer was about to flag, you avoid wasted rounds. And running the simplifier *after* the architect-critique lets it trim any over-extraction the critique may have introduced (e.g. a config object promoted for one caller).

**Why one-shot, not looping:** simplification is judgment. There is no "zero" state to converge on. Diminishing returns kick in after the first pass, and taste loops encourage over-deletion.

### Protocol

1. Launch exactly one `simplifier` agent **synchronously** (no `run_in_background`) with:
   - `git diff <phase-start-SHA>..HEAD` — the full phase diff, now including the architect-critique's commit
   - The phase file, for context on what the phase was supposed to accomplish
   - Scope reminder: fix taste issues, flag bugs for later rounds, do NOT fix correctness
2. The agent applies its edits inline and commits: `refactor(phase-N): simplify — <summary>`.
3. Capture the simplifier's report — flagged-but-unfixed items get fed to Round 1's code-reviewer agents.
4. If the simplifier reports "nothing to simplify", that is a valid outcome. Proceed to Round 1 with no changes.
5. **Do not re-run the simplifier.** Even if Round 1 introduces new complexity via fixes, trust the first pass.

### Record in gateRounds

Round 0 gets its own entry with `round: 0`:

```typescript
{
  round: 0,
  findings: [],  // simplifier does not return findings; see `simplifyPass` field
  summary: 'Round 0: simplify — −N lines across M files',
  simplifyPass: {
    linesRemoved: N,
    linesAdded: M,
    filesChanged: K,
    fixed: ['lib/foo.ts: removed unused _opts parameter', ...],
    skipped: ['lib/qux.ts:42 — speculative, unclear caller count'],
    bugsNoted: ['lib/zot.ts:88 — null check missing'],
  },
}
```

If `simplifyPass` is not yet in the phase schema, record the summary in the `summary` field and skip the structured `simplifyPass` sub-object. The schema migration is optional — the skill works either way.

---

## Rounds 1..N — Correctness Loop

The loop is automated. Each round fixes findings and re-runs agents without pausing for user input, until one round reports zero actionable findings.

### Round N (start with N=1)

**1. Mechanical checks.** Every step must pass before agents run. If any fails, fix it, commit, and restart Round N from the top.

```bash
pnpm biome check .       # lint
pnpm type-check          # types
pnpm test                # unit + integration
pnpm build               # production build
bash scripts/pre-review.sh <first-task-SHA>~1   # mechanical finding catcher
pnpm e2e:local           # E2E (MANDATORY)
```

**2. Agent reviews.** Launch 2 `code-reviewer` agents in parallel — **two synchronous Agent calls in a single message** (no `run_in_background` on either). "Parallel" here means the runtime fans them out; the parent still blocks until both return. Each receives:
- **Round 1**: full phase diff (`git diff <phase-start-SHA>..HEAD`) plus any unresolved items from Round 0's `skipped` or `bugsNoted` lists.
- **Round N > 1**: only the fix diff from the previous round (scoped per ROADMAP.md:77-81).
- The phase file for context.
- Hard requirement: findings must have `confidence >= 80`. Lower-confidence findings are dropped.
- **Severity range: CRITICAL through LOW are in scope for fixing.** INFO findings are recorded but do not block the gate. Agents must surface every ≥80% confidence issue — the loop triages, the agents don't.

**3. Evaluate round result:**
- **Both agents return 0 actionable findings (CRITICAL/HIGH/MEDIUM/LOW)** → gate passes for this round. Record the round (including any INFO observations) and proceed to the compromise summary.
- **At least one agent returns ≥1 actionable finding** → fix, record, loop. INFO-only findings do not trigger another round but must still be persisted in `gateRounds[].findings` for the audit trail.

**4. Fix findings and record round:**
- Apply fixes. One commit per logical fix group: `fix(<scope>): phase N gate RN — <what was fixed>`.
- Build a `StructuredGateRound` record for this round:
  ```typescript
  {
    round: N,
    findings: [
      { file, line?, severity, confidence, description, fixedInCommit? }
    ],
    summary: 'Round N: X findings fixed',
  }
  ```
  Keep this in working memory — it gets written to the phase file in Step 5.
- Go back to step 1 with Round N+1.

### Hard limit — Round 5

If the loop has not converged after 5 rounds, STOP and surface the remaining findings to the user. Agents may be cycling (finding-then-rewriting-then-finding). Do not silently loop forever.

**NO EXCEPTIONS** — not for "docs-only", "test-only", or "low-risk" phases. Every phase gets the full gate. If the phase file's validation task specifies additional checks, run those too.

---

## Compromise Summary (the only human stop-point — inline mode; under arc the orchestrator owns the stop, see SKILL.md Step 4b)

**Chat-output cap: ~30 lines / ~1500 chars.** The full summary is persisted to the phase file's `compromises` field and the completion commit body. Don't repeat the long form in chat — render a head + tail with a `+N more in roadmap/phases/phase-N.phase.ts` pointer when the summary would overflow. Output-token truncation has historically blocked phase completion mid-summary; the file is the long-form surface, chat is the headline.

Before marking the phase done, aggregate into a phase-level summary:

```
## Phase N Compromise Summary

Tasks: X total | Y clean | Z with compromises

### Compromises (from task transparency reports)
- Task N.1: <one-liner from COMPROMISES section>
- Task N.3: <one-liner>

### Skipped criteria
- Task N.2: <what was skipped>

### Hardcoded values
- Task N.4: <one-liner>

### Surfaced by architect-critique (fixed, but worth knowing)
- DB migration applied: new column `users.verified_at` — ensure staging migration runs before deploy

### Hard-stops from architect-critique (NOT fixed — your call)
- [MULTI-REPO] lib/api/client.ts — signature change breaks callers in zeroh-admin repo
- [SCOPED-OUT] lib/analytics/emitter.ts:34 — pre-existing double-fire, analytics out of scope
- [PRODUCT] checkout flow for expired coupons — needs product decision
- [SPECULATIVE] settlement.calculate() partial-month basis ambiguous
```

### Structured return (arc-mode)

When do-phase runs inside a phase-executor (orchestrated by `do-arc`, phase 858), the free-text summary above is **still** persisted to the phase file's `compromises` string (audit + release-sweep read it) — that does not change. **In addition**, the executor emits the same content as a typed `PhaseExecutionResult` (`PhaseExecutionResultShape` in `templates/schema.ts`, phase 855) as its return value, so the orchestrator can aggregate the arc without re-parsing markdown:
- `compromises` / `skipped` / `hardcoded` ← the matching task transparency-report lines (one array entry per task line).
- `surfaced` ← the architect-critique SURFACED entries.
- `hardStops` ← the tagged HARD-STOPS (`[MULTI-REPO]` / `[SCOPED-OUT]` / `[PRODUCT]` / `[SPECULATIVE]`), each `{ tag, text }`.
- `gateRounds` ← the count of correctness rounds run (Rounds 1..N).
- `status` ← `"escalated"` (with `escalation.question` + `options`) on a hard `ESCALATE_TO_USER` / `[MULTI-REPO]` / `[PRODUCT]` stop, else `"done"`.

The structured result is an addition, not a replacement: the `compromises` string is the durable human-readable audit record; the `PhaseExecutionResult` is the machine-readable channel `do-arc` aggregates. The executor returns it AND persists it to `phase.executionResult` (do-phase arc-mode Step 5), so `arc-sweep` can re-read it via `discoverResults()` if the arc resumes — the return value is the fast path, the persisted field the system of record.

The user reviews the summary and decides (**inline mode only** — under arc-mode the `do-arc` orchestrator owns this stop; see SKILL.md Step 4b):
- **"Mark done"** → proceed to phase completion
- **"Address X first"** → fix the compromise, then re-run the summary
- **"Plan follow-up"** → especially for `[MULTI-REPO]` hard-stops that need a phase in another repo

Sources to aggregate:
1. Every task's persisted `transparencyReport` (compromises, skipped criteria, hardcoded values, limitations).
2. The architect-critique's `SURFACED` section (DB migrations, schema changes — applied, flagged for visibility).
3. The architect-critique's `HARD-STOPS` section (all four tag categories).

Record the summary in both:
1. The phase file's `compromises` field (durable record).
2. The completion commit message body.

Persisting to the phase file means the compromise summary survives outside git and is queryable by `audit-roadmap`. Skipping the phase file write loses that signal.

---

## Phase Completion

The schema enforces gate results when `status: 'done'`. `pnpm type-check` catches missing fields and wrong literal values (e.g. `typeCheck: 'errors'`, `lint: 'errors'`); `definePhase()` additionally catches `unitTests.passed !== total` and empty `gateRounds` at runtime. Fill everything in one edit.

### Required fields (set together)

1. Edit the `.phase.ts` file:
   - `status: 'done'`
   - `gate: { typeCheck: 'clean', lint: 'clean', unitTests: { passed: N, total: N }, ... }` — must reflect passing results from Rounds 1..N.
   - `gateRounds` — the structured `StructuredGateRound` entries from the correctness loop, with Round 0's entry at index 0. At least 1 entry required. Example:
     ```typescript
     gateRounds: [
       {
         round: 0,
         findings: [],
         summary: 'Round 0: simplify — −47 lines across 3 files',
       },
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
   - `compromises: '<summary from compromise-summary step>'` — the aggregated compromise/skipped/hardcoded summary. Omit only if every task reported "None" in all six sections.
   - `completedDate: 'YYYY-MM-DD'`
2. Run `pnpm type-check` — confirms gate enforcement passes.
3. Run `pnpm emit:phases` to regenerate `reviews/changelog.json`.
4. Commit: `docs(roadmap): mark phase N complete` (include compromise summary in commit body).
5. Push to develop.

### Alternative: automated metrics

If `scripts/collect-phase-metrics.ts` exists, it can fill gate + metrics automatically:

```bash
npx tsx scripts/collect-phase-metrics.ts N
```

Then set `status: 'done'` and verify with `pnpm type-check`.
