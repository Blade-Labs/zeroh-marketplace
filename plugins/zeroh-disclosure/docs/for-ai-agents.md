# For AI agents working on ZeroH Disclosure

Read [product-principles.md](product-principles.md) before changing the plugin, and
follow it:

- ZeroH adds protection; it never takes away what Claude Code can do.
- Mask what we can, pass what we can't, and always say when something wasn't protected.
- By default, only two things may stop: a secret heading to a host known not to be allowed, and
  the model changing ZeroH's own protection. Any other new denial must apply only in
  `uncertain block` mode.
- Never mask what we can't restore: a token must have a vault entry ZeroH can put back. When the
  vault can't be opened, pass the value unmasked with a "not protected" line; never emit a token
  from a throwaway or in-memory vault.
- A new denial reason must be added to `test/deny-inventory.test.mjs` with a justification.
- A user-visible change updates [features.json](features.json) (then
  `node scripts/features.mjs --write` for [features.md](features.md)), and the CHANGELOG section's
  `Features:` line names the IDs it adds or changes. The release pipeline refuses a stale list.

Tests use fake values only (`ZEROHFAKE`, `example.com`) and isolated homes: set `HOME`,
`ZEROH_HOME`, `ZEROH_CREDENTIAL_HOME`, `ZEROH_CLAUDE_SETTINGS` and `ZEROH_SERVICE_MANAGER_DIR` to
temporary directories. See [development.md](development.md).
