# Changelog

## 1.0.0 — 2026-04-17

- Initial release. Adapted from `docs/research/claude-neon-implementation-pack.md`.
- Three subagents: `dmn-architect`, `bpmn-architect`, `cmmn-architect`.
- Four skills: `dmn-bindings`, `bpmn-bindings`, `cmmn-bindings`, `artifact-cross-check`.
- No hooks — OMG binding work has no destructive-op surface; all CWA concerns covered by repo-scoped hooks + the other plugins' hooks.
- Plugin manifest: author → Blade Labs, license Apache-2.0, description updated to cite DMN 1.5 formal pin per external-review §10 item 11.
