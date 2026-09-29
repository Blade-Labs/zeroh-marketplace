# sensitive-data-detectors (synced copy)

**Do not edit here.** This folder is a copy of the @bladelabs/sensitive-data-detectors package from the Blade
Labs monorepo (`packages/sensitive-data-detectors`). Changes go to the package there; the plugin's
`scripts/sync-detectors.mjs` then copies them here, and the plugin's tests fail
when this copy and the package differ.

It is the detection engine ZeroH Disclosure runs: the rules that find API keys,
tokens, passwords, private keys and 33 kinds of personal data in text, on your
machine, with no network calls. The plugin adds its own parts on top (known
values from `.env` and credential files, placeholder tokens, the vault,
masking and the hooks) in `lib/`.

- **License:** this folder is MIT-licensed ([LICENSE](LICENSE)), while the rest
  of ZeroH Disclosure is AGPL-3.0-only. The vendored upstream code under
  [vendor/](vendor) keeps its own licences.
- **Version:** @bladelabs/sensitive-data-detectors 0.1.0, from monorepo commit
  `b88fea42d4c7338bc41ea52b670d3dcfc8dac268`. [SOURCE.json](SOURCE.json) records the SHA-256 of
  every file in this copy.
- **Upstream credits** ([NOTICE](NOTICE)): gitleaks (MIT), validator.js (MIT),
  libphonenumber-js (MIT, with Google libphonenumber metadata under
  Apache-2.0), i18n-iso-countries (MIT), Saudi-ID-Validator (MIT), the IANA
  top-level domain list, Microsoft Presidio (MIT) and the rules reused from
  Blade Labs' ai-ui-chat detector.

[PACKAGE-README.md](PACKAGE-README.md) is the package's own README: the API,
every detected kind and how the vendored code is updated. `scripts/` holds
the package's import scripts; `node scripts/import-validator.mjs --check`
(and the others) verify the vendored files here against their pins.
