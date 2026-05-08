# Changelog

## 1.0.2

- Refocused hook-state around execution-spec scope attribution: edited file, active stage, proof command, and repo background.
- Labeled AP findings as current-edit or pre-existing so branch-baseline noise is not blamed on the active slice.
- Updated execution-spec, implement, and AP taxonomy skills to keep blocking truth owned by the current proof gate.

## 1.0.1

- Made proof-receipt hook guidance use the concrete `node ".../bin/zeroh-sdd.mjs"` runtime path instead of assuming `zeroh-sdd` is on Bash `PATH` in Windows Claude sessions.
- Added self-test coverage for runnable proof receipt reminder commands.

## 1.0.0

Clean runtime upgrade.

- Replaced v0.x Bash-heavy hook implementation with `bin/zeroh-sdd.mjs`.
- Added `check`, `doctor`, `stage`, `jit`, `hook`, and `self-test` CLI commands.
- Added active-stage state, proof receipts, doctor validation, JIT check routing, AP envelopes, shape discovery, and shape-gate evaluation.
- Added low-friction vibecoding defaults: env-configurable enforcement, async-rewake JIT checks, shape/file watchers, config-change protection, and safe permission-denial retry.
- Replaced Speckit-prefixed skills with the v1 SDD skill surface.
- Updated Claude hook wiring to route Setup, SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, TaskCompleted, Stop, compact, config-change, cwd/file-change, and permission-denial events through the runtime.
- Removed old compatibility scripts, templates, hook overrides, and multi-agent shim files.
