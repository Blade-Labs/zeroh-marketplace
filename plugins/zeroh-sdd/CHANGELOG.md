# Changelog

## 1.0.9

- Fixed project-root env-var leak in internal CLI spawns. The self-test's `async-jit-self-test` now passes under Claude Code PostToolUse JIT checks where `CLAUDE_PROJECT_DIR` is set in the host process; spawned children pin `ZEROH_SDD_PROJECT_DIR` to the intended repo root and strip lower-priority project / plugin-data env overrides so `projectRoot()` and `pluginDataDir()` resolve to the spawn's cwd-aligned root.

## 1.0.8

- Added Codex plugin packaging and repo-local Codex marketplace metadata while keeping one shared `zeroh-sdd` runtime and skill tree.
- Added adapter-aware hook entrypoints, portable `ZEROH_SDD_*` environment support, and Codex `apply_patch` path extraction tests.
- Reframed docs and skills toward an LLM-agent SDD runtime with Claude Code as the first hard-hook adapter and Codex as the first portability adapter.
- Added `npm run codex:hook-discovery` to prove whether the installed Codex build executes command hooks before enabling Codex hard enforcement.

## 1.0.7

- Added Windows-aware command resolution for hook/JIT checks, including local `node_modules/.bin` lookup and `.cmd` shim handling for JS tooling.
- Classified missing or unrunnable proof tooling as `TOOL_MISSING` / `TOOL_UNRUNNABLE` with proof-command replan context instead of edited-file blame.
- Made proof receipt guidance neutral with passed and failed forms, added safe CLI help, and documented failed-gate replan discipline.

## 1.0.6

- Added `sdd-planning` as the canonical planning front door for non-trivial vibecoding work.
- Repositioned `staged-doc-drafting` and `epic-planning` as supporting methods that converge into `execution-spec`.
- Updated UX docs and skill-content checks so every actionable planning path ends in one enforceable proof gate or a clear non-execution artifact.

## 1.0.5

- Added `staged-doc-drafting` as the long-form Stage 0-4 drafting layer and `epic-planning` as the macro phases/stories/proofs layer.
- Added optional `sdd.tracker` bridge validation so one execution spec can link back to an epic tracker row.
- Preserved tracker metadata in active stage state and receipt rows while keeping Claude native todos as live progress only.

## 1.0.4

- Made the documentation UX self-test work from both the marketplace source tree and Claude's installed plugin cache.

## 1.0.3

- Reworked the README around the vibecoder journey: execution-spec, active stage, proof, receipt, next slice.
- Corrected hook documentation so live-hook claims match `hooks/hooks.json`, with runtime-only handlers labeled separately.
- Added documentation drift self-tests for hook launcher examples, live hook claims, and setup/update guidance.

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
- Updated Claude hook wiring to route Setup, SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, TaskCompleted, Stop, PreCompact, ConfigChange, and SessionEnd through the runtime.
- Kept additional runtime handlers covered by self-tests for Claude builds that support broader hook events.
- Removed old compatibility scripts, templates, hook overrides, and multi-agent shim files.
