# Roadmap migration tools

Tools in this directory help upgrade an existing project's roadmap to the latest
`zeroh-roadmap` plugin version. They live in the plugin — **they are not copied
into target repos by `scaffold-roadmap.sh`** — so they stay disposable and don't
accrete in projects after the upgrade is done.

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

To apply the recommendations, either invoke the `migrate-roadmap` skill
(walks you through remediation interactively) or do it by hand using the
report as a checklist.
