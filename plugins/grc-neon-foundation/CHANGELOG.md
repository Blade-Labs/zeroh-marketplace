# Changelog

## 1.0.0 — 2026-04-17

- Initial release. Adapted from `docs/research/claude-neon-implementation-pack.md` per the agentic-infra-refinement-via-marketplace plan.
- Three subagents shipped: `neon-methodologist`, `bundle-architect`, `cwa-auditor` (frontmatter preserved from the pack).
- Four skills shipped: `orsd-review`, `cwa-guardrails`, `adr-draft`, `bundle-diff`.
- Hook script `block_destructive_bash.py` rewritten as `warn_destructive_bash.py` — PostToolUse JIT-injection replacing PreToolUse block. Preserves AGENTS.md §6 teaching-not-blocking invariant.
- `hooks.json` matcher updated accordingly (PreToolUse Bash → PostToolUse Bash for the rewritten warner).
- `session_context.py` + `scan_forbidden_patterns.py` retained unchanged (already JIT-injection).
- Plugin manifest updated: author → Blade Labs, added license (Apache-2.0) + repository URL.
