# Changelog

## 1.0.0 — 2026-04-17

- Initial release. Adapted from `docs/research/claude-neon-implementation-pack.md`.
- Three subagents: `ontology-architect`, `mapping-curator`, `shacl-sparql-engineer`.
- Four skills: `ontology-reuse-plan`, `oscal-set-mapping`, `sssom-pairwise`, `shacl-sparql-check`.
- Hook script `block_dangerous_sparql.py` (PreToolUse blocker) rewritten as `warn_destructive_sparql.py` (PostToolUse JIT-injection). Matches AGENTS.md §6 teaching-not-blocking invariant.
- `ontology_hint.py` (PostToolUse Edit/Write) retained unchanged — already JIT-injection.
- `hooks.json` matcher updated: PreToolUse Bash → PostToolUse Bash for the rewritten SPARQL warner.
- Plugin manifest: author → Blade Labs, license Apache-2.0, repository Blade-Labs/grc-zod-poc.
