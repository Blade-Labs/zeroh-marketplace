# Project — Roadmap

**Created:** YYYY-MM-DD
**Status:** Active — source of truth for multi-session work

---

## How This Works

- **"Do phase N"** = read `roadmap/phases/phase-N.phase.ts`, execute all tasks, run the Validation Gate below.
- Phase files are TypeScript using `definePhase()` from `lib/roadmap/schema.ts`.
- **Status transitions:** Edit the `status` field (`'backlog'` → `'in-progress'` → `'done'`). Terminal statuses: `'done'`, `'cancelled'`, and `'historical'` (a phase that completed before the current gate-discipline schema — parses loose, accepted as-recorded; the sanctioned alternative to backfilling a legacy phase that can't meet the strict done gate). Terminal phases are not executed and are removed from the backlog.
- **Task tracking:** Each task has a `done: boolean` field. Set `done: true` and add `doneDate` when complete. Commit after each task.
- **Phase sizing:** One phase = one feature a stakeholder could demo. Target ≤5 key files and ≤300 lines of diff.

### Planning Discipline — High-Confidence Tasks Only

**Every task must be planned to the point where you know the exact diff before writing code.**

If you cannot name the specific files, functions, and nature of the change — you haven't planned enough.

---

## Git Strategy

### Branches
- `main` — production. PR from develop only.
- `develop` — dev environment. Direct push. All phase work lands here first.
- `feat/phase-N-slug` — parallel sessions only. Branched from develop.

---

## Post-Phase Validation Gate (MANDATORY)

> Run after every phase completes. Do NOT skip steps. Do NOT mark a phase complete until all steps pass.
> **NO EXCEPTIONS** — not for "test-only", "docs-only", or "low-risk" phases. Every phase gets the full gate.
> **Token budget:** ~150-200k tokens per gate (2 agents x 2 rounds typical). The pre-review script catches mechanical issues before agents run, reducing rounds.

### Step 1: Lint
```bash
pnpm lint
```

### Step 2: Type-Check
```bash
pnpm type-check
```

### Step 3: Tests
```bash
pnpm test
```

### Step 4: Build
```bash
pnpm build
```

### Step 5: Code Review — 2 Parallel Agents

**Prepare the diff:** Find the first task commit SHA. Diff from that commit to HEAD:
```bash
git diff <first-task-SHA>~1..HEAD
```

Launch both **in parallel** with the exact diff command in each prompt:

#### Agent 1: Code Quality & Platform Standards (`code-reviewer`)
#### Agent 2: Regression Risk & Contract Compliance (`code-reviewer`)

### Step 6: Fix ALL Findings
- Fix all agent issues. Commit each fix atomically.
- **Commit convention for gate fixes:** `fix(<scope>): phase N gate RX — <what was fixed>`
  - This enables `git log --grep="phase N gate"` to find all fixes for a phase.
- After fixes, re-run **Step 3 (tests)** to catch regressions from agent-driven fixes.

**Scoped R2+ re-runs (token efficiency):**
- Skip agents that returned **ZERO FINDINGS** in the prior round.
- Re-run surviving agents on the **fix diff only**: `git diff <last-gate-fix-commit>~N..HEAD` — not the full phase diff.
- **Exception:** If fixes touch files the skipped agent also reviewed in R1, re-run both on the fix diff.
- **Loop Steps 3→5→6 until tests pass AND all running agents return ZERO findings in the SAME round.**
- Do NOT declare the gate passed after fixing R1 issues — the fix itself may introduce new issues that only R2 catches.

### Step 7: Record Results, Mark Done & Push
- Run `npx tsx scripts/collect-phase-metrics.ts {N}` to fill `gate` and `metrics` fields.
- Set `status: 'done'` in the `.phase.ts` file.
- Run `pnpm emit:phases` to regenerate `reviews/changelog.json`.
- Commit: `docs(roadmap): mark phase N complete`.
- Push to remote.
