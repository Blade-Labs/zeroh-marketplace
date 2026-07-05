---
name: "Audit Roadmap"
description: "Read-only structural audit across the roadmap (12 checks). Never reads source code. Does NOT fix — reports findings only."
user-invocable: true
metadata:
  keywords: audit, roadmap, consistency, check, phases, drift, health
  aliases: roadmap-audit, check-roadmap
---

# Audit Roadmap — Cross-Phase Structural Audit

## Trigger

User says: `audit roadmap`, `audit the roadmap`, `/audit-roadmap`, `/roadmap-audit`, `check roadmap consistency`, `roadmap health check`

## What This Is (and Is NOT)

**This IS:** A read-only consistency check across all `roadmap/phases/*.phase.ts` files, `roadmap/archive/**/*.phase.ts` files, and `roadmap/backlog.ts`. Finds structural drift between phases — dangling refs, incomplete done phases, stuck in-progress phases, unresolved clarification markers, duplicate phase numbers across active+archive, and archive integrity violations.

**This is NOT:**

- **`code-review`** (which looks for bugs in code)
- **`review-phase`** (which verifies the claims of ONE phase)
- **`full-code-review`** (which audits application code)

`audit-roadmap` is the cross-cutting structural auditor. It finds problems that span phases, not problems within a single phase. Compared to `review-phase`: `review-phase` goes **deep into one phase** (reads source code, verifies bug claims, does blast-radius grep). `audit-roadmap` goes **shallow across all phases** (reads only phase files + git log, never opens source).

**Status vocabulary.** Phases are one of: `backlog`, `in-progress` (active); `done`, `cancelled`, `historical` (terminal). `historical` is a phase that completed BEFORE the current gate-discipline schema — it parses loose (gate/category/kind accepted as-recorded, never required or falsified) and is the sanctioned alternative to backfilling a legacy done phase that can't meet strict `DonePhaseShape`. Treat `historical` as terminal everywhere `done` is terminal (not executable, not queued in the backlog), but EXEMPT it from the strict done-only checks (Check 5 task-completeness, gate completeness) — its looseness is the whole point. Historical phases are unversioned, so they stay in active `roadmap/phases/` (they cannot be archived under the version layout).

## Protocol

### Step 1: Enumerate the roadmap

```bash
ls roadmap/phases/*.phase.ts 2>/dev/null | sort
# Use `find` instead of `**` — bash defaults to globstar OFF, so the glob
# wouldn't recurse. The archive layout is roadmap/archive/<version>/*.phase.ts.
find roadmap/archive -maxdepth 2 -name '*.phase.ts' 2>/dev/null | sort
cat roadmap/backlog.ts
```

Build three in-memory maps:

- `phases: Map<number, { phase: Phase, location: 'active' | 'archive', archiveVersion?: string }>` — every phase keyed by phase number. `location` distinguishes `roadmap/phases/` (active) from `roadmap/archive/<version>/` (archive); `archiveVersion` is the dir name (e.g. `"0.7.0"`) when archived.
- `tasks: Map<string, { phase: number, task: PhaseTask }>` — every task keyed by `id` (e.g. `"171.1"`). Includes tasks from archived phases.
- `backlog: BacklogEntry[]` — the ordered execution queue.

**Archive is part of the namespace.** Phase numbers are monotonic across active+archive — `phase-467` in `phases/` and `phase-467` in `archive/0.7.0/` is a hard conflict (Check 8). Archived phases remain valid `dependsOn` targets (they're done, hence valid prerequisites).

### Step 2: Run all 12 consistency checks

Run every check before reporting. Do **not** short-circuit on the first failure — the value of this skill is surfacing everything in one pass.

#### Check 1: Dangling phase-level `dependsOn`

For every phase with a non-empty `dependsOn: number[]`, verify each referenced phase number has a matching `.phase.ts` file.

- **CRITICAL** — `Phase N depends on phase X, which does not exist.`

#### Check 2: Dependency cycles

Build a directed graph from every phase's `dependsOn`. Run cycle detection (DFS with a recursion stack is sufficient).

- **CRITICAL** — `Cycle detected: phase N → phase M → phase N.` Report every distinct cycle.

#### Check 3: Backlog refers to missing phases

For every entry in `backlog.ts`, verify the phase number has a matching `.phase.ts` file.

- **HIGH** — `Backlog queues phase N, but phase-N.phase.ts does not exist.`

#### Check 4: Unresolved `[NEEDS CLARIFICATION]` markers

```bash
grep -nH '\[NEEDS CLARIFICATION' roadmap/phases/*.phase.ts
```

For each match, record the file, line, and the exact marker text (including the question).

- **MEDIUM** — `Phase N, task N.X has an unresolved marker: [NEEDS CLARIFICATION: <question>]. Phase cannot be executed.`
- If the same phase is also in `backlog.ts`, escalate that marker's finding to **CRITICAL** (it's queued for execution but not answerable).

#### Check 5: Done phases with incomplete tasks

For every phase with `status: 'done'`, verify every task's `done: true`.

- **HIGH** — `Phase N is marked done, but task N.X has done: false. Either completion was premature, or the task was retroactively added post-completion.`

Note: the `types` slot does not catch this because the schema allows `done: false` tasks on a done phase — the enforcement is only on gate/metrics/completedDate. This check fills that gap.

#### Check 6: Task-level `dependsOn` referencing bad IDs

For every task with a non-empty `dependsOn: string[]`:

1. Every referenced ID must exist in **the same phase** (task deps don't cross phases — cross-phase deps live on the phase).
2. Every referenced ID must appear **earlier** in the phase's `tasks` array.

- **HIGH** — `Phase N task N.X depends on N.Y, which does not exist in this phase.`
- **HIGH** — `Phase N task N.X depends on N.Y, which appears later in the task list (forward reference — will fail at execution).`
- **MEDIUM** — `Phase N task N.X has dependsOn: [<value>] that looks like a phase number, not a task ID (expected "N.M" format). Cross-phase deps belong on the phase, not the task.`

#### Check 7: Stale `in-progress` phases

For every phase with `status: 'in-progress'`:

```bash
git log -n 1 --format=%ct --grep="phase N"
```

If the most recent commit mentioning the phase is older than 30 days, flag.

- **LOW** — `Phase N has been in-progress since <ISO date> (>30 days since last related commit). Either resume, or set status: 'cancelled'.`

#### Check 8: Duplicate phase numbers across files (including archive)

```bash
{ sed -nE 's/^  phase: ([0-9]+),.*/\1/p' roadmap/phases/*.phase.ts 2>/dev/null
  find roadmap/archive -maxdepth 2 -name '*.phase.ts' -exec sed -nE 's/^  phase: ([0-9]+),.*/\1/p' {} \; 2>/dev/null
} | sort | uniq -d
```

A duplicate spanning `phases/` and `archive/<version>/` is a CRITICAL violation: an active phase cannot share a number with an archived one. The numeric space is one namespace.

For each duplicate, list all file paths that claim that phase number.

- **CRITICAL** — `Phase number X appears in multiple files: <paths>. emit.ts will refuse to build the registry until this is resolved.`

#### Check 9: Missing `kind` field (schema v3)

```bash
for f in roadmap/phases/*.phase.ts; do
  grep -q '^\s*kind:' "$f" || echo "$f"
done
```

For every phase file that does not declare `kind`, list it. These phases predate `@zeroh-roadmap-schema v3` and need backfill before `do-phase` can select the correct gate set.

Suggested backfill (the migration script implements the same rules — run `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts` to get per-phase suggestions):
- `category: 'fix'` or `category: 'refactor'` → `hardening`
- `category: 'infra'` + `stakeholderDemo` mentions "release", "version", "ship", "cut", "hotfix" → `release`
- `category: 'feature'` + UI-only `stakeholderDemo` (mentions "screen", "page", "design", "dashboard", "branding", "layout", "copy", "dark-mode", "landing", "wizard") → `mockup`
- otherwise → `logic`

The executable form lives in `scripts/migrate/audit.ts:suggestKind`. Keep these rules in sync — if you edit one, edit the other.

- **HIGH** — `Phase N at <path> is missing the kind field. Backfill with: <suggested kind>. Run scripts/migrate/audit.ts to backfill all at once.`

#### Check 10: Stale done entries in backlog

For every entry in `backlog.ts`, look up the corresponding phase file's `status`. Any entry whose phase is `status: 'done'`, `'cancelled'`, or `'historical'` is stale — all three are terminal, so the entry should have been removed during completion. Stale entries pollute "do next phase" resolution and indicate a grooming gap.

- **MEDIUM** — `Backlog index K queues phase N, but phase-N.phase.ts is status: 'done'. Remove the backlog entry. (do-phase Step 5 should have done this — flag any pattern of stale entries as a process bug.)`
- **LOW** — `Backlog index K queues phase N, but phase-N.phase.ts is status: 'cancelled'. Remove the backlog entry.`
- **LOW** — `Backlog index K queues phase N, but phase-N.phase.ts is status: 'historical'. Historical phases are terminal — remove the backlog entry.`
- **HIGH** — `Backlog index K queues phase N, but phase N is archived at roadmap/archive/<version>/. Archived phases are terminal — remove from backlog.`

#### Check 11: Oversized tasks without `batchMode` (schema v4)

For every task in every phase file, verify the size lint that plan-phase / review-phase enforce at authoring time:

- `task.files.length` ≤ 10 OR `task.batchMode === true`
- `task.steps.length` ≤ 6 OR `task.batchMode === true`

Tasks predating schema v4 won't have `batchMode` set; the field defaults to `false`, so any oversized legacy task surfaces here. Tasks added under v4 should already have been gated by plan-phase / review-phase, so a finding here on a v4-era task usually means the lint was bypassed.

- **HIGH** — `Phase N task N.X has files.length=K (>10) without batchMode. Either split into smaller tasks, or set batchMode: true if the work is genuinely mechanical (rename across files, parallel template authoring).`
- **HIGH** — `Phase N task N.X has steps.length=K (>6) without batchMode. Same resolution.`

Done tasks (`done: true`) are exempt — they already executed; the finding is informational only and does not need a fix.

#### Check 12: Archive integrity (schema v6 — when `roadmap/archive/` exists)

For every file in `roadmap/archive/<version>/*.phase.ts`, verify the four archive invariants:

1. **status is `'done'`.** Archive is only for completed phases — nothing else should be there.
2. **`version` field matches the containing directory.** A phase at `roadmap/archive/0.7.0/phase-N.phase.ts` must have `version: '0.7.0'`. Drift here means release-sweep moved the file without updating the field (bug) or someone hand-moved it.
3. **Every non-`"None"` transparency-report entry has a matching `debtResolutions` entry with a CLOSING status.** For each task `T` and each field `F ∈ {compromises, hardcoded, skipped, limitations}` where `T.transparencyReport[F] !== "None"`, there must exist `debtResolutions[i].ref === "${T.id}.${F}"`. This is the invariant `release-sweep --archive` is supposed to enforce; this check catches archives produced by other means (manual `git mv`, scripted bulk-archive). **A matching entry does NOT close the debt if its status is still OPEN (the 1371 follow-up contract):** on an ARCHIVED phase, a `status: 'planned'` entry whose `via: 'phase-<N>'` phase is not `done`, or any `status: 'operator-pending'` entry, is a **HIGH** finding — archive should not have closed over an unexecuted follow-up or an undone deploy action.
4. **`debtResolutions` refs all resolve to real transparency-report entries.** For each `debtResolutions[i]`, parse the `ref` and verify the referenced task + field exists and has a non-`"None"` value. Drift here means the transparency report was edited post-hoc and the resolution log no longer points anywhere.

- **CRITICAL** — `Phase N archived at roadmap/archive/<version>/ has status: '<other>' (expected 'done').`
- **CRITICAL** — `Phase N at roadmap/archive/<version>/ has version: '<other>' — directory says <version>. Hand-edit or restore via git.`
- **HIGH** — `Phase N at roadmap/archive/<version>/ has unresolved debt — task N.X transparencyReport.<field> is non-"None" with no matching debtResolutions entry. Archive should not have been allowed.`
- **MEDIUM** — `Phase N at roadmap/archive/<version>/ has dangling debtResolution — ref "N.X.<field>" does not match any non-"None" transparency-report entry.`

If `roadmap/archive/` does not exist (project hasn't archived anything yet), skip Check 12 silently — not a finding.

### Step 3: Report

Output one structured report grouped by severity. Every finding names the phase, the check number, the issue, and the fix direction.

```markdown
# Roadmap Analysis — <ISO date>

## Summary

- Total phases: X ({Y done}, {Z in-progress}, {W backlog}, {V cancelled}, {H historical})
- Findings: A CRITICAL, B HIGH, C MEDIUM, D LOW

## CRITICAL (A)

- **[Phase 17, Check 1]** Depends on phase 9 which does not exist.
  Fix: remove 9 from `dependsOn`, or create `phase-9.phase.ts`.
- **[Phase 12 ↔ Phase 15, Check 2]** Cycle: 12 → 15 → 12.
  Fix: decide which direction is real; remove the reverse dep.

## HIGH (B)

- **[Phase 8, Check 5]** Marked done, but task 8.3 has `done: false`.
  Fix: verify task 8.3's work actually shipped. If yes, set done: true with doneDate. If no, the phase wasn't actually complete.

## MEDIUM (C)

- **[Phase 14, Check 4]** Task 14.2 has `[NEEDS CLARIFICATION: should retries use exponential backoff or fixed interval?]`.
  Fix: answer the question, remove the marker, update the task.

## LOW (D)

- **[Phase 6, Check 7]** `in-progress` since 2026-02-14 (62 days since last commit).
  Fix: resume work or mark `status: 'cancelled'`.

## Verdict: BROKEN | HAS ISSUES | CLEAN
```

**Verdict rules:**

- **CLEAN** — zero findings.
- **HAS ISSUES** — only MEDIUM/LOW findings.
- **BROKEN** — one or more CRITICAL or HIGH.

If the verdict is BROKEN, end the report with:

> **Do not run `/do-phase` or cut a release until the CRITICAL/HIGH findings are resolved.**

## What NOT to do

- **Do NOT fix anything** — this skill reports findings. The user runs `/plan-phase` or edits phase files manually to resolve them.
- **Do NOT short-circuit** — run all 12 checks even if earlier ones fail. One pass, one report.
- **Do NOT infer intent** — if phase 5 says `dependsOn: [3]` and phase 3 doesn't exist, report it literally. Don't guess "maybe they meant phase 4".
- **Do NOT block on missing git history** — Check 7 falls back to "unknown age" if `git log` returns nothing for the phase. Report it as LOW with a note.
