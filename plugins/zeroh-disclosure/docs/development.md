# Developing ZeroH Disclosure

How to run the tests, try a change in Claude Code, and update the generated rule catalogs.

## Contents

- [Ground rules](#ground-rules)
- [Run the tests](#run-the-tests)
- [Try a change in Claude Code](#try-a-change-in-claude-code)
- [Update the provider rules](#update-the-provider-rules)
- [Update the top-level domain list](#update-the-top-level-domain-list)
- [Update the personal-data libraries](#update-the-personal-data-libraries)
- [Re-record Read response shapes](#re-record-read-response-shapes)
- [Where things live](#where-things-live)

## Ground rules

- The hooks, the proxy and the CLI use Node.js built-ins, plus the libraries vendored under
  `vendor/` (validator.js, libphonenumber-js, i18n-iso-countries, Saudi-ID-Validator). A plugin install copies this folder without
  `node_modules`, so do not add runtime dependencies: vendor a pinned release instead, with its
  licence, `SOURCE.json` and an import script, and list it in `NOTICE`.
- Do not hand-write personal-data detection. `lib/pii/` only proposes candidates and keeps code
  readable; a vendored library decides.
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

## Update the provider rules

`lib/rules/gitleaks.generated.json` is generated from the pinned gitleaks rule file in
`vendor/gitleaks/`. The current catalog imports 221 of 222 source rules and records the one it
could not translate, with the reason. Its provenance is embedded in the JSON.

To move to a new gitleaks release:

1. Put the new upstream TOML and the unchanged upstream licence in `vendor/gitleaks/`.
2. Update the source path and `SOURCE_METADATA` in `scripts/import-gitleaks.mjs`.
3. Update `lib/rules/NOTICE` and `NOTICE` with the version and commit.
4. Generate the catalog and check it:

   ```bash
   node scripts/import-gitleaks.mjs
   node scripts/import-gitleaks.mjs --check
   npm test
   ```

The generator translates the supported RE2 syntax to JavaScript regular expressions, keeps the
applicable allow lists, records skipped rules and why, and writes deterministic JSON. `--check`
compares parsed JSON, so formatting does not count as drift.

Review every skipped rule. A change in the count is something to inspect, not a number to update.

## Update the top-level domain list

The destination check uses the IANA list of top-level domains to tell hosts from file names.
`lib/rules/tlds.generated.json` is generated from `vendor/iana/tlds-alpha-by-domain.txt`:

1. Replace the vendored file with the current
   [IANA list](https://data.iana.org/TLD/tlds-alpha-by-domain.txt), unchanged.
2. Regenerate and check:

   ```bash
   node scripts/import-tlds.mjs
   node scripts/import-tlds.mjs --check
   npm test
   ```

3. Update the version in `lib/rules/NOTICE` and `NOTICE`.

The same list also checks the top-level domain of email addresses (`lib/pii/index.js`).

## Update the personal-data libraries

`vendor/validator` holds the validator.js modules `lib/pii` calls (`isEmail`, `isCreditCard`,
`isIBAN`, `isIdentityCard`, `isTaxID`, `isIP`, `isPassportNumber`, `isBtcAddress`,
`isEthereumAddress`) and every module they require, unchanged from the npm
package's CommonJS build. `vendor/libphonenumber-js` holds that package's prebuilt
`bundle/libphonenumber-max.js`, unchanged, as `libphonenumber-max.cjs`. Each folder has the
licences and a `SOURCE.json` with the tarball URL, its npm integrity and the SHA-256 of every file.

1. Set the new version, tarball URL and integrity (`npm view <package>@<version> dist`) in
   `RELEASE` in `scripts/import-validator.mjs` or `scripts/import-libphonenumber.mjs`.
2. Download, verify and replace the vendored files, then check:

   ```bash
   node scripts/import-validator.mjs --fetch
   node scripts/import-libphonenumber.mjs --fetch
   node scripts/import-validator.mjs --check
   node scripts/import-libphonenumber.mjs --check
   npm test
   ```

   The ISO 3166 codes (`vendor/i18n-iso-countries`) and the Saudi ID check
   (`vendor/saudi-id-validator`) are pinned the same way in
   `scripts/import-reference-data.mjs` (`--fetch`, `--check`).

3. Update the versions in `NOTICE` and the CHANGELOG. `test/pii.test.mjs` carries test cases from
   both projects' suites; rerun the
   [false-positive measurement](detection.md#false-positives-measured) if the update changes what
   is found.

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
| Detection              | `lib/detector.js` (patterns), `lib/secrets.js` (known values, scrubbing, destinations), `lib/context-scan.js`, `lib/rules/` (generated data)                                                                                                                                           |
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
