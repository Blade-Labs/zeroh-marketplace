# Harness-file reconciliation

Shared invariants belong to `greenfield-init/references/standards.md`; this reference contains only the brownfield delta. The target convention is one canonical `AGENTS.md`, with other harness files reduced to pointers plus genuinely tool-specific material. See `roadmap/arc-prompts/POLYSEAT-execution-prompt.md` for the multi-harness rationale.

For every discovered harness file:

1. inventory its unique material, conventions duplicated from `AGENTS.md`, tool-only instructions, includes, and generated regions;
2. identify the canonical destination for unique material without creating a second fact home;
3. show its exact reduce-to-pointer diff before approval;
4. byte-compare every auto-generated marker block before and after;
5. after approval, retain unique tool instructions and replace only duplicated conventions with a pointer to `AGENTS.md`.

Inventory `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, Cursor rules, Codex instructions, Gemini instructions, and OpenCode instructions when present. Preserve includes and file-local precedence. In particular, preserve the full Nx region from `nx configuration start` through `nx configuration end` byte-for-byte.

If no `AGENTS.md` exists, propose it as a missing gap using the greenfield template. If it exists, link it; never rewrite its unique repository guidance. A pointer-only reconciliation is not complete until the before/after inventory proves every unique instruction survived.
