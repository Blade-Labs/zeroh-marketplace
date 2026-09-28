# Developing ZeroH Disclosure

How to run the tests, try a change in Claude Code, and update the detection engine.

## Contents

- [Ground rules](#ground-rules)
- [Run the tests](#run-the-tests)
- [Try a change in Claude Code](#try-a-change-in-claude-code)
- [Update the detection rules and libraries](#update-the-detection-rules-and-libraries)
- [Re-record Read response shapes](#re-record-read-response-shapes)
- [Where things live](#where-things-live)

## Ground rules

- The hooks, the proxy and the CLI use Node.js built-ins, plus the detection engine vendored
  under `vendor/sensitive-data-detectors/` (with validator.js, libphonenumber-js,
  i18n-iso-countries and Saudi-ID-Validator inside it). A plugin install copies this folder without
  `node_modules`, so do not add runtime dependencies: vendor a pinned release instead, with its
  licence, `SOURCE.json` and an import script, and list it in `NOTICE`.
- Do not hand-write personal-data detection. The engine only proposes candidates and keeps code
  readable; a vendored library decides. Detection changes go to the engine's package, not here
  (see [Update the detection rules and libraries](#update-the-detection-rules-and-libraries)).
- Use fake values only: a `ZEROHFAKE` marker in every secret-shaped value, `example.com` or
  `.invalid` hosts, and addresses such as `alice@example.com`. Never put a real key in a test,
  fixture, issue or pull request, even a revoked one.
- Node.js 20 or later.

## Run the tests

From this folder:

```bash
npm test
```

This runs `node --test test/*.test.mjs`: detectors, hook payloads, the settings guard, late binding,
the proxy, PDF extraction, format response shapes, receipts and reports. The tests need no network
access and no Claude login.

The tests never touch your real home directory. `ZEROH_CREDENTIAL_HOME` and
`ZEROH_SERVICE_MANAGER_DIR` exist for them: they redirect credential discovery and login items. When `ZEROH_HOME`, `ZEROH_CREDENTIAL_HOME`,
`ZEROH_CLAUDE_SETTINGS` and `ZEROH_SERVICE_MANAGER_DIR` are not all set, `test/helpers.mjs` moves
`HOME` and every ZeroH path into a fresh temporary directory, which is removed when the test file
exits. If you set them yourself, each one must be under the system temporary directory; a guard
refuses to run against the real home. The helpers also clear `CLAUDE_PROJECT_DIR` and Claude Code's
session variables, so the suite behaves the same when it runs inside a Claude Code session.

Run one file with `node --test test/late-bind.test.mjs`.

## Try a change in Claude Code

Load the plugin from a folder instead of the marketplace:

```bash
claude --plugin-dir /path/to/zeroh-disclosure
```

The plugin protects its own files: while it is loaded, the model cannot edit the plugin directory
it runs from. So do not ask Claude to change the plugin in the same folder that `--plugin-dir`
loads. Either:

- copy the plugin to a scratch folder and load the copy in a separate test project:

  ```bash
  cp -R plugins/zeroh-disclosure /tmp/zeroh-disclosure-try
  cd /path/to/test-project && claude --plugin-dir /tmp/zeroh-disclosure-try
  ```

- or work on the source in a session without ZeroH loaded and rely on `npm test`.

Restart Claude Code after each change: hooks, commands and the MCP server are loaded when a
session starts. The first session also installs the local proxy; when you are done, run
`/zeroh-disclosure:proxy off` in that session, or
`node /tmp/zeroh-disclosure-try/bin/zeroh-disclosure.mjs proxy off` from a terminal.

## Update the detection rules and libraries

The detection engine (secrets, personal data, the gitleaks provider rules, the IANA top-level
domains and the vendored validator.js, libphonenumber-js, i18n-iso-countries and
Saudi-ID-Validator) is not maintained here. It is `@bladelabs/sensitive-data-detectors`
(`packages/sensitive-data-detectors` in the Blade Labs monorepo, MIT), and
`vendor/sensitive-data-detectors/` is a synced copy of it. **Do not edit the copy.**

1. Change the package and follow its README (Updating the vendored code): its import scripts
   fetch, pin and check each upstream, and its tests cover detection.
2. Commit the package change, then copy it here from the monorepo root and check:

   ```bash
   pnpm nx run zeroh-marketplace:sync-detectors
   node scripts/sync-detectors.mjs --check
   npm test
   ```

   The zeroh-marketplace test target runs the same `--check`: it fails when the copy and the
   package differ, and skips outside the monorepo (the public tree ships the copy as it is).
   `vendor/sensitive-data-detectors/SOURCE.json` records the package version, the monorepo commit
   and each file's SHA-256; `test/detectors.test.mjs` checks the copy against it and runs the
   copy's own `import-*.mjs --check` scripts.

3. Update `NOTICE`, the CHANGELOG and [What ZeroH Disclosure detects](detection.md) when a version,
   a count or a kind changed, and rerun the
   [false-positive measurement](detection.md#false-positives-measured) if the update changes what
   is found.

What the plugin adds on top of the engine lives in `lib/detector.js`: its own tokens are never
detected again, `ZEROH_PHONE_REGION` sets the phone region, and the catalog lists the exact-match
values from `.env` and credential files (`lib/secrets.js`).

## Re-record Read response shapes

`test/fixtures/read-response-shapes-2.1.281.json` records the shape of Claude Code's `Read`
response for a PDF, an image and a notebook. `format-hooks.test.mjs` uses those outer shapes and
fills in controlled fake fixtures from `test/fixtures/format-fixtures.mjs`.

When Claude Code changes one of these responses:

1. Record the `PostToolUse` input from a local session for a small text PDF, a PNG and a notebook
   that contain only `ZEROHFAKE` values and `alice@example.com`.
2. Remove session ids, user paths, credentials, timestamps and unrelated hook records.
3. Truncate large base64 fields but keep the field and response structure, as the current fixture
   does.
4. Save it as `read-response-shapes-<claude-version>.json`. Keep the old file while both shapes
   need coverage.
5. Point `format-hooks.test.mjs` at the new fixture and run `npm test`.
6. Check the user notices and the model-facing shape in a real session with the new Claude Code
   version.

## Where things live

| Area                   | Files                                                                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hooks                  | `hooks/hooks.json`, the fail-closed loader `hooks/run.js` (with `hooks/fail-closed.js`) and one script per event in `hooks/`                                                                                                                                                           |
| Detection              | `vendor/sensitive-data-detectors/` (the engine, a synced copy), `lib/detector.js` (the plugin's additions), `lib/secrets.js` (known values, scrubbing, destinations), `lib/context-scan.js`, `scripts/sync-detectors.mjs`                                                              |
| Vault and tokens       | `lib/vault.js`, `lib/tokens.js`, `lib/mask.js`, `lib/crypto.js`                                                                                                                                                                                                                        |
| Restore and guards     | `lib/late-bind.js`, `lib/exit-status.js`, `lib/allow-rules.js`, `lib/settings-guard.js`, `lib/tool-policies.js`                                                                                                                                                                        |
| Formats                | `lib/pdf-text.js`, `lib/format-audit.js`                                                                                                                                                                                                                                               |
| Receipts and reports   | `lib/disclosure.js`, `lib/receipt.js`, `lib/selective-disclosure.js`, `lib/signing-key.js`, `lib/receipt-bundle.js`, `lib/verify-receipt.js`, `lib/report.js`, `lib/report-slip.js`, `lib/report-html.js`, `lib/report-counts.js`, `lib/policy.js`, `lib/policies/`, `lib/boundary.js` |
| Protection engine      | `lib/protection-engines/regex-local.js`, the pattern detector as the receipt's engine                                                                                                                                                                                                  |
| Proxy                  | `lib/proxy.js`, `lib/proxy-manager.js`, `lib/proxy-cleanup.js`, `lib/service-manager.js`, `lib/claude-settings.js`, `bin/proxy-daemon.mjs`                                                                                                                                             |
| Unmask and report-miss | `lib/unmask.js`, `lib/report-miss.js`, `mcp/server.mjs`                                                                                                                                                                                                                                |
| Session and plumbing   | `lib/session.js`, `lib/config.js`, `lib/hook-io.js`, `lib/clipboard.js`, `lib/stop-message.js`, `lib/banner.js`                                                                                                                                                                        |
| Commands and CLI       | `commands/*.md`, `commands/scripts/`, `bin/zeroh-disclosure.mjs`, `skills/about/SKILL.md`                                                                                                                                                                                              |

[Architecture](architecture.md) explains how these fit together.
