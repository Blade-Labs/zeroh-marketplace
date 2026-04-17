---
name: "Migrate Roadmap"
description: "Upgrade an existing project's roadmap to the latest zeroh-roadmap plugin version. Runs a read-only audit, then walks through schema upgrades, missing scripts, and strict-fail phase files with user confirmation at each step. Disposable — the underlying tool lives in the plugin, not in the target repo."
user-invocable: true
metadata:
  keywords: migrate, upgrade, roadmap, audit, compatibility, schema, version
  aliases: upgrade-roadmap, audit-migration
---

# Migrate Roadmap — Plugin Version Upgrade

## Trigger

User says: `migrate roadmap`, `upgrade roadmap`, `audit for migration`, `/migrate-roadmap`, `/upgrade-roadmap`

## What This Is (and Is NOT)

**This IS:** A guided upgrade from an older `zeroh-roadmap` shape to the current one. Runs the read-only audit tool, reads the report, then walks the user through remediation with confirmation at every file change.

**This is NOT:**

- A fresh scaffold — if there's no existing `lib/roadmap/schema.ts`, point the user to `bash ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-roadmap.sh` instead.
- An automatic rewriter. Phase files represent real work; silently rewriting them is unacceptable. Every change lands via Edit with the user seeing the diff.
- Part of the permanent tooling. The underlying `audit.ts` lives under `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/` and is **never copied** into the target repo by `scaffold-roadmap.sh` — migration tools stay disposable.

## Protocol

### Step 1: Run the audit

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts > /tmp/roadmap-migration-audit.md
cat /tmp/roadmap-migration-audit.md
```

The audit writes a structured markdown report covering schema features, missing files, and done phases that would break under the strict `DonePhaseShape`. Read the whole thing before doing anything.

If the report says "NO SCHEMA — fresh scaffold recommended", stop and tell the user:

> No existing roadmap detected. Run `bash ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-roadmap.sh` instead of this migration skill.

### Step 2: Summarize the three remediation buckets

Present the user with a short summary of what needs to happen, organized into three buckets:

1. **Schema** — `lib/roadmap/schema.ts` is N features behind. Either additive (low risk) or structural (requires discriminated union adoption).
2. **Files** — M steady-state artifacts are missing (scripts, backlog, etc.). Each can be copied from `${CLAUDE_PLUGIN_ROOT}`.
3. **Phase files** — K done phases will fail strict parse. Each needs a decision: backfill metrics, fill by hand, or downgrade status.

Ask the user which bucket to start with. Default recommendation: **Schema first**, then **Files**, then **Phase files**. Schema is the blocker — until the schema is updated, the other two don't change behavior.

### Step 3: Bucket 1 — Schema upgrade

Diff the target and canonical schemas:

```bash
diff -u lib/roadmap/schema.ts ${CLAUDE_PLUGIN_ROOT}/templates/schema.ts | head -200
```

Then branch on what the audit detected:

**Case A: Discriminated union + `PassingGateResultShape` already present** (e.g. `mudarabah-agri-tech`):

The remaining additions are all backwards-compatible:
- `TransparencyReportShape` + `PhaseTask.transparencyReport?`
- `GateFindingShape`, `StructuredGateRoundShape`, `GateRoundShape` union
- `PhaseTask.dependsOn: string[]` (defaults to `[]`)
- `Phase.compromises?`

Apply via Edit — show the user the exact blocks being inserted, commit with one clear message: `feat(roadmap): upgrade schema to plugin vX`.

**Case B: No discriminated union** (e.g. `zeroh-disclosure`):

This is the structural case. Adopting the discriminated union will break any done phase that lacks a complete `gate / gateRounds / metrics / completedDate` — section 3 of the audit listed them. Do NOT overwrite the schema until the user has a strategy for those phases (bucket 3). Options:

- **Ship the new schema but keep done phases loose**: add an additional status variant like `status: 'historical'` for phases with no gate data and mark them all that way. (Requires adding `HistoricalPhaseShape` to the union — a plugin-side change, not part of this skill.)
- **Run `collect-phase-metrics` on every affected done phase**: backfills gate + metrics from git history. Deterministic but slow for 100+ phases.
- **Accept the break, reconcile phase-by-phase**: most honest, but highest effort.

Ask the user which strategy, THEN do the schema edit.

### Step 4: Bucket 2 — Missing files

For each missing artifact the audit listed, copy from `${CLAUDE_PLUGIN_ROOT}`. Easiest is re-running the idempotent scaffold:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-roadmap.sh
```

`scaffold-roadmap.sh` skips files that already exist, so this only adds missing ones. It will not overwrite the upgraded `schema.ts` from Step 3.

Confirm with the user before running — they may have deliberately left some scripts out.

### Step 5: Bucket 3 — Strict-fail phase files

The audit listed every done phase with missing `gate` / `gateRounds` / `metrics` / `completedDate`. Three possible fixes per phase:

- **Backfill via script**: `npx tsx scripts/collect-phase-metrics.ts <N>` reads `git log --grep="phase N"` and fills the gate + metrics fields automatically. Best for phases that actually shipped through a full gate.
- **Fill manually**: some historical phases predate the gate discipline — fill in plausible values from commits, PRs, or the phase's own notes. Flag with a summary string like `gateRounds: ['Historical — gate discipline retrofitted ${date}']`.
- **Downgrade status**: if the phase was never really "done" (e.g. migrated from a different system with a different completion concept), change `status: 'done'` → `status: 'cancelled'` (or `'historical'` if the schema supports it).

Do NOT silently pick a strategy. Show the user the list, ask which strategy fits which phase, and apply in batches. The audit's finding list is itself the checklist.

### Step 6: Re-run the audit

After each bucket, re-run:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/migrate/audit.ts
```

Confirm the report shrinks. Final run should show `Verdict: CURRENT`, `_All required files present._`, `_No breaking issues detected in done phases._`.

### Step 7: Commit the upgrade

Series of commits, one per bucket, matching the plugin's commit-hygiene convention:

```
feat(roadmap): upgrade schema to plugin vX
chore(roadmap): scaffold missing scripts (pre-review, collect-metrics, ...)
fix(roadmap): backfill strict-fail done phases (N phases)
```

Then update the plugin version marker in the target repo if the project tracks one (e.g. a comment at the top of `schema.ts` or a `.zeroh-roadmap-version` file).

## What NOT to do

- **Do NOT rewrite phase files without explicit confirmation per phase.** The audit is a checklist; the user owns each decision.
- **Do NOT run the scaffold before the schema upgrade** — the scaffold is idempotent but its templates may be newer than the user's existing files; get the schema clean first so downstream files match.
- **Do NOT skip Step 1** — without running the audit, you're guessing about what changed.
- **Do NOT copy the migrate tool into the target repo.** It intentionally lives under `${CLAUDE_PLUGIN_ROOT}/scripts/migrate/`. If the user asks to make it permanent, push back — this is disposable scaffolding by design.
