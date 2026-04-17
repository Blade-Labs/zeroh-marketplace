# Changelog

## 1.0.0 — 2026-04-17

- Initial release. Adapted from `docs/research/claude-neon-implementation-pack.md`.
- Three subagents: `legal-source-engineer`, `deontic-modeler`, `lkif-refiner` (frontmatter preserved from pack).
- Four skills: `akn-intake`, `normalize-legal-statement`, `lrml-lkif-pass`, `routing-bindings`.
- Single hook `legal_integrity_hint.py` shipped unchanged — already JIT-injection (PostToolUse Edit/Write) per AGENTS.md §6 invariant. No rewrite needed.
- Plugin manifest updated: author → Blade Labs, license Apache-2.0, repository Blade-Labs/grc-zod-poc.
