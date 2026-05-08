# zeroh-sdd v1 Runtime Architecture

`zeroh-sdd` v1 is a command-hook runtime. Skills produce execution specs, `active-stage.json` becomes the control plane, live hooks enforce the active stage, and the runtime records proof receipts.

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

The user-facing product is the lane, not the checklist: Claude can move quickly, but once it commits to a proof slice it cannot edit outside the declared surfaces, advance the stage early, or finish the task without a receipt.

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

Soft steering is emitted as `hookSpecificOutput.additionalContext` with an HTML-commented JSON envelope and `_fix.prompt` for current-edit repairs. Findings are attributed as `edited-file`, `active-stage`, `proof-command`, or `repo-background` so baseline branch health does not get blamed on the current edit.

Deterministic JIT checks run with `asyncRewake` by default: clean checks stay silent, failed checks wake Claude with compact repair context.

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

The runtime reads these as advanced `CLAUDE_PLUGIN_OPTION_*` environment variables. The manifest does not expose `userConfig` until the local Claude validator accepts it for this marketplace.

## Runtime Ownership

All behavior lives in `bin/zeroh-sdd.mjs`. `bin/zeroh-sdd` is only a cross-shell launcher for humans or shells that need it.

`hooks/hooks.json` should stay declarative and should call the runtime directly with `node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-sdd.mjs" hook <event>`. Do not reintroduce per-hook Bash implementations.

Some runtime handlers exist before they are wired in `hooks/hooks.json`. User-facing docs must label those as runtime-supported but not live in the current validated Claude build.
