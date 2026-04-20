# Gate Protocol

Detailed protocol for the phase validation gate invoked by `do-phase` Step 4 and the phase completion fields invoked by Step 5.

## Overview

Three stages, run in order:

1. **Round 0 — Simplify pass** (one-shot, no looping). `simplifier` agent removes dead scaffolding and speculative abstractions. Runs exactly once per phase.
2. **Rounds 1..N — Correctness loop** (loops until clean, hard-cap 5). Mechanical checks + two parallel `code-reviewer` agents. Each round fixes findings and re-runs until zero actionable findings.
3. **Compromise summary** — aggregate every task's persisted `transparencyReport`. This is the ONLY human stop-point in the gate.

After the gate passes, Step 5 fills the phase file with gate results, metrics, and completion date.

---

## Round 0 — Simplify Pass (one-shot)

**Why it runs first:** taste corrections invalidate bug findings. If the simplifier deletes a helper that the code-reviewer was about to flag, you avoid wasted rounds. Running simplify after code-review instead would mean either re-running code-review (expensive) or shipping code that could have been reduced.

**Why one-shot, not looping:** simplification is judgment. There is no "zero" state to converge on. Diminishing returns kick in after the first pass, and taste loops encourage over-deletion.

### Protocol

1. Launch exactly one `simplifier` agent with:
   - `git diff <phase-start-SHA>..HEAD` — the full phase diff
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

**2. Agent reviews.** Launch 2 `code-reviewer` agents in parallel. Each receives:
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

## Compromise Summary (the only human stop-point)

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

The user reviews the summary and decides:
- **"Mark done"** → proceed to phase completion
- **"Address X first"** → fix the compromise, then re-run the summary

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
3. Run `pnpm emit:phases` to update the registry.
4. Commit: `docs(roadmap): mark phase N complete` (include compromise summary in commit body).
5. Push to develop.

### Alternative: automated metrics

If `scripts/collect-phase-metrics.ts` exists, it can fill gate + metrics automatically:

```bash
npx tsx scripts/collect-phase-metrics.ts N
```

Then set `status: 'done'` and verify with `pnpm type-check`.
