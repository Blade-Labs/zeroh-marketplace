# zeroh-sdd v1 Runtime Architecture

`zeroh-sdd` v1 is a command-hook runtime. Skills produce execution specs; hooks enforce the active stage; the runtime records proof receipts.

## Runtime Loop

```text
execution-spec
  -> zeroh-sdd check
  -> zeroh-sdd doctor
  -> zeroh-sdd stage set
  -> Write/Edit/Bash hooks enforce active-stage.json
  -> async JIT checks wake only on failures
  -> proof command
  -> proof reminder
  -> zeroh-sdd stage finish
  -> receipt + doctor
  -> next execution-spec
```

## Hard vs Soft Feedback

Hard gates:

- Write/Edit outside `active-stage.allowedPaths`
- commit, push, merge, or new stage while a stage is unfinished
- Stop or TaskCompleted while a stage is unfinished
- non-policy configuration changes during an active stage
- unmet shape gate only when the active stage declares shape proof

Soft steering:

- AP detectors
- parse-boundary warnings
- hardcoded data warnings
- CWA fallback warnings
- test capitulation warnings
- successful deterministic JIT checks

Soft steering is emitted as `hookSpecificOutput.additionalContext` with an HTML-commented JSON envelope and `_fix.prompt`. Deterministic JIT checks run with `asyncRewake` by default: clean checks stay silent, failed checks wake Claude with compact repair context.

## State

Project state:

- `.specify/workflows/active-stage.json`
- `.specify/workflows/hook-state.json`

Plugin cache:

- `${CLAUDE_PLUGIN_DATA}/shape-registry.json`
- `${CLAUDE_PLUGIN_DATA}/runtime-cache.json`

## Low-Friction Defaults

`zeroh-sdd` is tuned for vibecoding flow:

- `enforcement_mode=balanced`: block only active-stage boundary violations
- `jit_mode=async-rewake`: do not wait on heavier checks unless they fail
- `shape_watch=true`: refresh shape context when watched files change
- `doctor_on_finish=true`: keep receipt closure deterministic

The runtime reads these as `CLAUDE_PLUGIN_OPTION_*` variables. That matches Claude's plugin `userConfig` export format; the manifest remains validator-compatible for the local Claude Code version.

## Runtime Ownership

All behavior lives in `bin/zeroh-sdd.mjs`. `bin/zeroh-sdd` is only a cross-shell launcher that finds Node.js and delegates to the runtime.

`hooks/hooks.json` should stay declarative. Do not reintroduce per-hook Bash implementations.
