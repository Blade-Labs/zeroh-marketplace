# zeroh-sdd Tooling Dogfood Learnings

Status: non-execution artifact  
Date: 2026-05-08  
Plugin under test: `zeroh-sdd@zeroh-marketplace` `1.0.6`  
Entry point dogfooded: `zeroh-sdd:sdd-planning`

This artifact captures the first learning pass after adding `sdd-planning` as the canonical front door. It is not an execution spec. The next implementation step should be a small `execution-spec` gate selected from the upgrade candidates below.

## Dogfood Run

Disposable repo:

```text
C:\Users\sami\AppData\Local\Temp\zeroh-sdd-tooling-dogfood-211bfec8d09c42938e5a2f219eb3cdef
```

Prompt:

```text
Use zeroh-sdd sdd-planning. Do not edit any file except src/index.ts. Use Write to replace src/index.ts with: export const broken: number = "not a number"; Then reply exactly: dogfood-write-done
```

Observed plugin behavior:

- Claude loaded `zeroh-sdd@1.0.6`.
- Debug log showed `Loaded 13 skills from plugin zeroh-sdd default directory`.
- Debug log showed `Skill prompt: showing "zeroh-sdd:sdd-planning"`.
- Active stage context injected at `SessionStart` and `UserPromptSubmit`.
- Write inside `exact:src/index.ts` was allowed.
- `post-tool-write-jit` ran the selected deterministic check:
  - `pnpm --silent --filter @dogfood/tooling exec tsc --noEmit`
- Async JIT woke Claude with `# JIT execution-spec check failed`.
- `Stop` blocked while the active stage was open.
- Proof command completion triggered receipt discipline.
- A failed receipt row was written and the active stage was cleared.

Key result: the plugin loop works, but the dogfood exposed runtime/tooling ergonomics that should become the next upgrade.

## Bugs Surfaced

### B1 - Windows command resolution breaks `pnpm` JIT checks

In PowerShell, `pnpm` exists:

```text
C:\Users\sami\AppData\Roaming\npm\pnpm
C:\Users\sami\AppData\Roaming\npm\pnpm.cmd
```

But the hook-selected check failed with:

```text
spawnSync pnpm ENOENT
```

Root cause candidate: `runCheck()` uses `spawnSync(command, args, { shell: false })`. On Windows, bare package-manager commands can resolve differently across PowerShell, Git Bash, `.cmd`, and Node `spawnSync`. The runtime already detects `pnpm` with `where`, but it does not resolve the executable path or prefer `.cmd`.

Upgrade:

- Add a Windows-aware command resolver for `pnpm`, `npm`, `npx`, `biome`, `vitest`, and `tsc`.
- Prefer `.cmd` on Windows when `where` returns multiple entries.
- Record `TOOL_MISSING` as infrastructure context, not as an AP against the edited file.
- Add a self-test that simulates `where pnpm` returning both extensionless and `.cmd` paths.

### B2 - Proof reminder implies `--status passed` even after failed proof output

After the proof command failed, `PostToolUse Bash` still injected a receipt template with:

```bash
stage finish --status passed
```

This is too optimistic for vibecoding. The hook does not have reliable command exit semantics in the current implementation, so the reminder should not bias Claude toward a passed receipt.

Upgrade:

- Change proof reminder copy to show both passed and failed forms.
- Prefer neutral language: "If the proof passed..." and "If the proof failed...".
- If `PostToolUseFailure` sees a command matching the active proof command, inject the failed receipt form directly.

### B3 - `stage finish --help` fails and becomes noisy branch-health context

Claude tried:

```bash
node ".../bin/zeroh-sdd.mjs" stage finish --help
```

The CLI treated this as a real `finish` command and failed because `--proof-result` was missing. `PostToolUseFailure` then recorded it as `repo-background`.

Upgrade:

- Add `--help` support for every subcommand.
- Treat help/introspection failures as `tooling-help` or suppress them entirely.
- Include exact receipt examples in `sdd-planning` and `implement` so Claude does not probe help mid-stage.

### B4 - Failed receipts currently clear the active stage

The failed receipt row was written:

```text
| Step 1 | failed | src/index.ts | ... tsc not found in env ... | ... | Replan: install pnpm and tsc dependencies ... |
```

The active stage was then cleared. That may be acceptable when a failed receipt deliberately closes a gate and hands off to replan, but it is risky if Claude uses failed receipts as an escape hatch.

Upgrade decision needed:

- Option A: keep current behavior, but require `--next-adjustment` and make the next `execution-spec` explicit.
- Option B: keep stage open on `failed`, clear only on `passed` or `blocked --abandon`.
- Recommended: Option A for vibecoding flow, plus a `stage finish` message that says "failed gate closed; start a new execution-spec before editing again."

## Platform Harness Patterns To Borrow

Source repo inspected:

```text
C:\Users\sami\Documents\Codex\2026-05-08\tell-me-about-sdi-complier-shapes\ZeroH-GRC-Platform
```

Reusable patterns:

- `tests/gates/support/gate-fixture.ts`: gate tests write structured metadata into `task.meta` before assertion.
- `tests/gates/support/evidence-reporter.ts`: Vitest reporter writes deterministic JSON evidence with digest.
- `tests/gates/vitest.config.ts`: fast gate suite produces `emitted/reports/gate-scan.json`.
- `tests/fitness/vitest.config.ts`: heavier fitness suite has separate cadence and evidence output.
- `tests/governance/*`: meta-governance reads gate/fitness evidence and checks completeness/integrity.
- `platform/bin/evidence-summary.ts`: turns evidence JSON into developer/LLM-actionable summaries and distinguishes new vs pre-existing failures.
- `platform/scripts/pre-merge/ring0-scanners.ts`: cheap static scanners catch missing dependency classes before expensive type/build/test gates.
- Shape ground-truth pattern: `GROUND-TRUTH -> safeParse -> assert`, for example workspace status responses parsed through `WorkspaceStatusResponseShape`.

This is the right architecture for `zeroh-sdd` hooks:

```text
cheap edited-file scanner
  -> deterministic command runner
  -> structured evidence JSON
  -> compact hook context
  -> receipt / replan
```

Do not make every hook a whole-repo judge. Use Platform's three-tier cadence:

- Ring 0: cheap static edited-file checks, synchronous or very fast async.
- Ring 1: selected deterministic proof checks, asyncRewake on failure.
- Ring 2: broader fitness/eval runs, explicit proof command or manual/CI only.

## Tooling Candidates

### Biome

Use for fast syntax/format/lint/import sorting on edited files. Biome's CLI says `biome check` runs formatter, linter, and import sorting, and `--write` applies safe fixes. It also supports machine-friendly reporters including JSON, GitHub, JUnit, checkstyle, RDJSON, and SARIF.

Recommended hook use:

```text
biome check --write --no-errors-on-unmatched <edited-file>
biome check --reporter=json --no-errors-on-unmatched <edited-file>
```

Policy:

- Auto-write only inside `active-stage.allowedPaths`.
- Do not run `biome --write .` from hooks.
- If Biome is not installed, emit one compact `TOOL_MISSING` finding and continue.

### TypeScript

Use for type proof. TypeScript's `--noEmit` disables writing emitted files, which is ideal for hook checks.

Recommended hook use:

```text
pnpm --filter <package> exec tsc --noEmit
```

Improvements over current runtime:

- Resolve package manager executables correctly on Windows.
- Prefer package script if present: `typecheck`, `type-check`, then `tsc --noEmit`.
- Consider `tsc -b --dry` or package graph checks only for explicit proof commands, not per-edit hooks.

### Vitest

Use for related tests, shape gates, and governance evidence. Vitest supports `vitest related --run <source-file>` for static-import-related tests and `--changed` for tests affected by uncommitted changes.

Recommended hook use:

```text
vitest related --run <edited-source-file>
vitest run <edited-test-file>
vitest run --changed
```

Policy:

- For edited test files, run the test file directly.
- For edited source files, prefer `vitest related --run` when Vitest is installed and config exists.
- Keep broader `test:gates`, `test:fitness`, and coverage as proof commands or CI, not default per-edit hooks.

### Governance-as-Vitest Adapter

Platform's strongest reusable mechanism is not just "run Vitest"; it is structured gate evidence:

```text
gate fixture -> task.meta -> reporter -> evidence JSON -> summary -> hook context
```

Upgrade idea:

- Add `zeroh-sdd gate` support for tiny local gate suites.
- Recognize emitted evidence files such as `emitted/reports/gate-scan.json`.
- Convert evidence failures into AP envelopes with `_fix.prompt`.
- Preserve baseline/new failure attribution using the Platform `known-failures.baseline.json` pattern.

### Promptfoo / Model Evals

Platform uses promptfoo and `evals/` for shape-driven extraction experiments. This is valuable but too heavy for PostToolUse hooks.

Policy:

- `promptfoo` and eval harnesses belong in explicit proof gates, CI, or manual long-running checks.
- `sdd-planning` should mention them when the current change touches prompts, shape extraction, or LLM behavior.

### LSP

Claude plugin reference supports `.lsp.json`, and LSP servers give diagnostics, hover, definitions, references, and code actions. Biome also exposes `lsp-proxy`.

Policy:

- Do not replace SDD with LSP.
- Add LSP only after the runtime has stable tool profiles.
- Best first LSP use: TypeScript and Biome diagnostics as passive editor/agent context; not hard enforcement.

## `sdd-planning` Skill Upgrade Areas

Add a "Plugin-Native Tooling Classifier" section:

| Surface | Preferred quiet feedback | Proof gate escalation |
| --- | --- | --- |
| TS source | Biome edited-file check, package `tsc --noEmit`, Vitest related | package test, app build |
| TS test | Biome edited-file check, run edited test | full package test |
| shape/schema | shape registry refresh, parse-boundary detector | ground-truth `safeParse` gate |
| prompt/eval | no default hook; require explicit proof | promptfoo/eval harness |
| docs/plan | `sdd check` / `doctor` | active-stage receipt |
| package manifest | dependency scanner, install-state check | lockfile/install proof |

Add a "Tool Availability First" rule:

- Before selecting `pnpm`, `biome`, `vitest`, or `tsc` as a proof command, verify the command is actually runnable in Claude's hook shell.
- If unavailable, make the first MC "install/configure toolchain" instead of letting JIT fail later.

Add a "Evidence Harness" rule:

- Prefer checks that emit structured JSON or can be wrapped into structured evidence.
- Do not make Claude infer from raw terminal prose when a reporter/evidence file can produce `{gateId, verdict, owner, rationale, remediation}`.

Add a "Quiet By Default" rule:

- Synchronous hooks may auto-fix only inside allowed paths and only with safe fixers.
- Async hooks may wake Claude only on current-gate failures.
- Background branch health belongs in hook-state summary and receipts, not per-edit noise.

## Recommended Next Execution Gates

## Gate 1 Receipt - Command Runner And Receipt Discipline

Status: implemented locally  
Date: 2026-05-08

Changes installed:

- Added Windows-aware command resolution that searches local `node_modules/.bin` before PATH and prefers `.cmd` shims for package-manager and JS tool commands.
- Changed deterministic JIT failures caused by missing or unrunnable tooling to `TOOL_MISSING` / `TOOL_UNRUNNABLE` with `proof-command / replan` attribution.
- Updated proof reminders to show both passed and failed receipt forms instead of assuming `--status passed`.
- Added safe CLI help for top-level commands and `stage set|finish|status|clear`.
- Kept the Biome/Vitest/tool-profile router deferred to Gate 2.

Receipt implication:

```text
failed proof gate + --next-adjustment
  -> receipt closes the active stage
  -> next edit must come from a fresh execution-spec
```

### Gate 1 - Windows Command Runner And Proof Reminder

Surfaces:

- `bin/zeroh-sdd.mjs`
- `skills/sdd-planning/SKILL.md`
- `skills/implement/SKILL.md`
- runtime self-tests

Acceptance:

- Windows resolves `pnpm.cmd`, `npm.cmd`, `npx.cmd`, and local `node_modules/.bin` commands.
- JIT missing-tool findings are `TOOL_MISSING / proof-command / replan`, not AP blame on edited files.
- Proof reminder shows passed and failed receipt forms.
- `stage finish --help` works.

### Gate 2 - Tool Profile Router

Surfaces:

- `bin/zeroh-sdd.mjs`
- `docs/v1-runtime.md`
- `sdd-planning` skill

Acceptance:

- Runtime discovers available tools per repo: Biome, TypeScript, Vitest, package manager, scripts.
- `jit --file` selects the best small check in this order:
  1. Biome edited-file check when installed/configured.
  2. Edited test direct run.
  3. Source-file related test.
  4. Package typecheck.
  5. Declared proof command only when active stage requires it.
- Clean checks stay silent; failed checks emit compact `_fix.prompt` context.

### Gate 3 - Governance Evidence Adapter

Surfaces:

- `bin/zeroh-sdd.mjs`
- optional test fixtures
- docs

Acceptance:

- Runtime can ingest Platform-style `gate-scan.json` / `fitness-scan.json`.
- It classifies failures as current, proof, or background.
- It emits AP envelopes from structured evidence, not raw log scraping.
- `sdd-planning` knows when to select a governance-as-vitest proof gate.

### Gate 4 - Plugin-Native LSP/Monitor Investigation

Surfaces:

- docs only first

Acceptance:

- Document whether `.lsp.json`, Biome LSP, TypeScript server, and monitors materially improve Claude's live feedback loop.
- No hard enforcement added until command-hook evidence loop is stable.

## Source Notes

- [Claude Hooks docs](https://code.claude.com/docs/en/hooks): `asyncRewake` wakes Claude on exit code 2 and async hooks cannot block already-triggered actions; `if` filters avoid process spawn overhead for unrelated tool calls.
- [Claude Plugin reference](https://code.claude.com/docs/en/plugins-reference): plugins can ship skills, hooks, `bin/`, `.mcp.json`, `.lsp.json`, monitors, and settings; `bin/` executables are added to Bash PATH.
- [Biome CLI docs](https://biomejs.dev/reference/cli/): `biome check` runs formatter/linter/import sorting; `--write` applies safe fixes; JSON/SARIF-style reporters are available.
- [TypeScript `noEmit` docs](https://www.typescriptlang.org/tsconfig/noEmit.html): `--noEmit` disables emitting output files.
- [Vitest CLI docs](https://vitest.dev/guide/cli.html): `vitest related --run` runs tests related to source files; `--changed` runs tests affected by uncommitted or branch changes.
