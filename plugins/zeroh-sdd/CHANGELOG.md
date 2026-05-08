# Changelog

## 1.0.0

Clean runtime upgrade.

- Replaced v0.x Bash-heavy hook implementation with `bin/zeroh-sdd.mjs`.
- Added `check`, `doctor`, `stage`, `jit`, `hook`, and `self-test` CLI commands.
- Added active-stage state, proof receipts, doctor validation, JIT check routing, AP envelopes, shape discovery, and shape-gate evaluation.
- Added low-friction vibecoding defaults: env-configurable enforcement, async-rewake JIT checks, shape/file watchers, config-change protection, and safe permission-denial retry.
- Replaced Speckit-prefixed skills with the v1 SDD skill surface.
- Updated Claude hook wiring to route Setup, SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, TaskCompleted, Stop, compact, config-change, cwd/file-change, and permission-denial events through the runtime.
- Removed old compatibility scripts, templates, hook overrides, and multi-agent shim files.
