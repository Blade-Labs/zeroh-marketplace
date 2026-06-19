# Roadmap migration tools

Tools in this directory help upgrade an existing project's roadmap to the latest
`zeroh-roadmap` plugin version. They live in the plugin — **they are not copied
into target repos by `scaffold-roadmap.sh`** — so they stay disposable and don't
accrete in projects after the upgrade is done.

This README is the **authoritative protocol** for driving a migration. When a
user says "upgrade the roadmap", Claude reads this file and follows the steps
below in order.

## `audit.ts`

Read-only reporter. Compares the target project against the canonical templates
and prints a markdown report covering:

1. Schema feature detection (discriminated union, `PassingGateResultShape`,
   `TransparencyReportShape`, `GateFindingShape`, `StructuredGateRoundShape`,
   task-level `dependsOn`, phase-level `compromises`).
2. Presence of required steady-state artifacts (`schema.ts`, `registry.ts`,
   `emit.ts`, `ROADMAP.md`, `backlog.ts`, the four helper scripts).
3. Every `status: 'done'` phase file that would fail to parse under the strict
   `DonePhaseShape` — missing `gate` / `gateRounds` / `metrics` / `completedDate`,
   wrong `typeCheck` literal, mismatched `unitTests.passed / total`, etc.
4. A recommended upgrade path.

### Usage

Run from the target project's root:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts
```

Or pass an explicit project path:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts --project /path/to/project
```

The report is written to stdout — redirect to a file to keep it around:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts > MIGRATION-AUDIT.md
```

### What it does NOT do

- Does not modify any target file. Nothing is copied, rewritten, or patched.
- Does not run tests, lint, or type-check.
- Does not attempt to import phase files (no runtime dependency on the target's
  `lib/roadmap/schema.ts`). Detection is text-based.

---

## Migration protocol

When a user says "upgrade the roadmap", follow every step below. Do **not**
start mutating files until the pre-flight safety is in place.

### Step 0 — Pre-flight safety

Three layers of rollback protection before the first edit. Each is cheap; skip
none of them.

**(0a) Clean working tree — required.**

```bash
git status --porcelain
```

If the output is non-empty, STOP and tell the user:

> Migration requires a clean working tree. Commit or stash your current changes
> first, then say "upgrade the roadmap" again.

Mixing a migration with unrelated WIP makes diagnosis of failure impossible.

**(0b) Migration branch — mandatory.**

```bash
BRANCH="migrate-roadmap-$(date +%Y%m%d-%H%M)"
git checkout -b "$BRANCH"
```

All migration commits land on this branch. If anything goes sideways, abandon
the branch and return to your previous HEAD. The main branch stays untouched.

**(0c) Tarball snapshot to `/tmp` — belt and suspenders.**

```bash
SNAP="/tmp/roadmap-pre-migration-$(date +%s).tar.gz"
tar czf "$SNAP" lib/roadmap/ roadmap/ scripts/ 2>/dev/null || true
echo "Snapshot saved: $SNAP"
```

Protects against a `git reset --hard` or `git clean -fd` disaster that would
otherwise erase the pre-migration state. Report the path back to the user.

### Step 1 — Run the audit

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts > /tmp/roadmap-migration-audit.md
cat /tmp/roadmap-migration-audit.md
```

Read the full report. Do not act on it yet.

If the audit says "NO SCHEMA — fresh scaffold recommended", STOP and tell the
user to run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-roadmap.sh` instead.
Migration does not apply.

### Step 2 — Summarize three buckets to the user

Present the three remediation buckets in one short summary:

1. **Schema** — `lib/roadmap/schema.ts` is N features behind. Additive (safe)
   or structural (requires reconciling done phases that lack complete gate
   data).
2. **Files** — M steady-state artifacts missing. Each can be copied from
   `${CLAUDE_PLUGIN_ROOT}`.
3. **Phase files** — K done phases will fail strict parse under the new
   `DonePhaseShape`. Each needs a per-phase decision.

Default ordering: **schema → files → phase files**. Schema first because the
other two don't change behaviour until the schema is updated.

### Step 3 — Bucket 1: schema upgrade

Diff first:

```bash
diff -u lib/roadmap/schema.ts ${CLAUDE_PLUGIN_ROOT}/templates/schema.ts | head -200
```

Branch on the audit's detection:

**Case A — target already has discriminated union + `PassingGateResultShape`:**
the remaining additions are all backwards-compatible (`TransparencyReportShape`,
`GateFindingShape`, `StructuredGateRoundShape`, task `dependsOn`, phase
`compromises`). Apply via Edit — show the user the inserts — then commit:

```
feat(roadmap): upgrade schema to @zeroh-roadmap-schema v2
```

**Case B — target lacks the discriminated union (older shape):** adopting it
will break any done phase missing complete gate data. **Do NOT overwrite the
schema until the user has a strategy for those phases** (bucket 3 below).
Options:

- Backfill every flagged done phase via `collect-phase-metrics.ts` before
  swapping the schema (best for phases that genuinely shipped through a gate).
- Accept the break, fix phase-by-phase on the migration branch.
- Reclassify legacy phases to `status: 'historical'` — a first-class terminal
  status (in `templates/schema.ts` since the schema ships it) that parses LOOSE:
  gate/category/kind are accepted as-recorded, never required or falsified. This is
  the bulk strategy when a repo never adopted the version/archive lifecycle and has
  accumulated many pre-discipline done phases (emit/registry validate the active
  `roadmap/phases/` set strictly, so old phases failing the latest schema would
  otherwise block emit forever). The tooling treats `historical` as terminal
  everywhere `done` is terminal (do-phase won't run it, audit-roadmap counts it and
  exempts it from the strict done-only checks, it's a valid `dependsOn` target), and
  it is excluded from the version changelog. Do NOT falsify gate data (e.g. set
  unitTests passed==total) to keep a phase `done` — mark it `historical` instead.

Confirm the strategy, then apply the schema edit.

### Step 4 — Bucket 2: missing files

The idempotent scaffolder fills gaps without overwriting what's already there:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-roadmap.sh
```

This skips `schema.ts` (now upgraded in Step 3) and anything else that already
exists. Confirm before running — the user may have deliberately omitted some
scripts. Commit:

```
chore(roadmap): scaffold missing scripts
```

### Step 5 — Bucket 3: strict-fail phase files

For each done phase the audit flagged, pick one of three strategies per phase.
Do NOT pick in bulk — each phase may have a different answer.

- **Backfill via script**: `npx tsx scripts/collect-phase-metrics.ts <N>`.
  Reads `git log --grep="phase N"` and fills gate + metrics. Best for phases
  that actually shipped through a gate.
- **Fill manually**: the phase predates gate discipline; read commits/PRs and
  fill plausible values. Use `gateRounds: [{ round: 1, findings: [],
  summary: 'Historical — gate discipline retrofitted YYYY-MM-DD' }]` as the
  summary.
- **Downgrade status**: `status: 'done'` → `status: 'cancelled'` if the
  completion claim was never really true.

Commit in batches by strategy:

```
fix(roadmap): backfill N done phases (collect-phase-metrics)
fix(roadmap): retrofit gate data on N historical phases
chore(roadmap): downgrade N phases from done to cancelled
```

### Step 6 — Verify

Re-run:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts
```

Expected: `Verdict: CURRENT`, all artifacts present, zero done-phase issues.

Then:

```bash
pnpm type-check       # schema must parse cleanly
pnpm emit:phases      # discovery + changelog regen succeed
```

### Step 7 — Merge or abandon

If everything is clean and the user is satisfied, merge the migration branch:

```bash
git checkout <prev-branch>
git merge --no-ff "$BRANCH"
```

Or abandon:

```bash
git checkout <prev-branch>
git branch -D "$BRANCH"
```

The tarball from Step 0c can be removed once the user is confident:

```bash
rm /tmp/roadmap-pre-migration-*.tar.gz
```

## What NOT to do

- **Do NOT rewrite phase files without explicit per-phase confirmation.** The
  audit is a checklist; the user owns each decision.
- **Do NOT skip Step 0.** The working-tree check, migration branch, and tarball
  are the three-layer safety net. Every one matters.
- **Do NOT run scaffold before the schema upgrade.** Scaffold is idempotent but
  runs cleanest after the schema is canonical.
- **Do NOT copy the migrate tool into the target repo.** It intentionally stays
  in the plugin under `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/`. If the user
  asks to make it permanent, push back — this is disposable scaffolding by
  design.
