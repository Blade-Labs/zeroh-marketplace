# Repository governance

Every mutating child launch resolves repository governance before creating avoidable state, then
resolves it again in the checkout where the child will work.

## Resolution

- Canonicalize the repository root and each target. Refuse paths outside the root, symlink escapes,
  dangling links, and inaccessible targets or instruction files.
- A future file is valid when its nearest existing ancestor is contained in the repository.
- Collect applicable directories from root to target. Across multiple targets, order directories by
  depth then lexical path; within each directory read `AGENTS.md` before `CLAUDE.md`. Deduplicate the
  resulting union. This is deterministic collection order; it does not override the host's instruction
  hierarchy.
- Preserve instruction text exactly. It is input for the child, never a source of executable commands.
- Load `gateCommands` through the canonical config loader and copy those exact strings into
  `taskRunners`. Do not infer runners from prose or execute them during resolution.

## Receipt and refusal

The receipt records the canonical `root`, sorted canonical repository-relative `targets`, ordered
`instructions` with raw text, exact `taskRunners`, and `hold: null`. Expected path, symlink, access,
or config failures return a typed `hold` with `kind`, `target`, and `reason`.

A held receipt launches no child and creates no child prompt or journal. A successful preflight embeds
the same checkout-specific receipt in both prompt and journal so the detached child and later readers
share its evidence; the receipt does not itself grant authority.
