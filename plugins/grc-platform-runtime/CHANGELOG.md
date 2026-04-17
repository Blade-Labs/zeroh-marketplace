# Changelog

## 1.0.0 — 2026-04-17

- Initial release. Adapted from `docs/research/claude-neon-implementation-pack.md`.
- Three subagents: `platform-engineer`, `fuseki-operator`, `ci-guardian`.
- Four skills: `new-slice`, `fuseki-bootstrap`, `test-gates`, `plugin-release`.
- Hook script `fuseki_guard.py` (PreToolUse blocker) rewritten as `fuseki_admin_warner.py` (PostToolUse JIT-injection). Matches AGENTS.md §6 teaching-not-blocking invariant.
- `hooks.json` matcher updated: PreToolUse Bash → PostToolUse Bash.
- Plugin userConfig preserved (fuseki_query_endpoint / fuseki_update_endpoint / fuseki_dataset_name) — keyword list extends to include `tdb2`.
- Plugin manifest: author → Blade Labs, license Apache-2.0, description updated to cite Apache Jena Fuseki + TDB2 (per ADR-013).
