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
- A new denial reason must be added to `test/host/deny-inventory.test.mjs` with a justification.
- Presentation is the exception to rule 3. Use `zeroh-disclosure style <key> <value>` for status
  line fields, labels, wording, colour, position, output formats and verbosity, and `style banner
<big|compact|mini|off>` for the banner. `style show` reports the validated result. Direct edits
  of `presentation.json` remain allowed for compatibility, but do not edit other ZeroH state.
- Never turn the status line on or off: that writes Claude Code's `statusLine` setting and remains
  user-only, although a terminal user is not asked for a confirmation code. Protection changes
  remain user-only and confirmed. See the canonical [settings classification](architecture.md#model-versus-user-settings).
- A user-visible change updates [features.json](features.json) (then
  `node scripts/features.mjs --write` for [features.md](features.md)), and the CHANGELOG section's
  `Features:` line names the IDs it adds or changes. The release pipeline refuses a stale list.

Tests use fake values only (`ZEROHFAKE`, `example.com`) and isolated homes: set `HOME`,
`ZEROH_HOME`, `ZEROH_CREDENTIAL_HOME`, `ZEROH_CLAUDE_SETTINGS` and `ZEROH_SERVICE_MANAGER_DIR` to
temporary directories. See [development.md](development.md).
