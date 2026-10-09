# Detection channels and context

The shared `detectSensitiveData` API accepts a `channel` (`shell`, `config`,
`code`, `prose`) and `context` (a language string, or `{language, shell,
interpolation, mixed}`). A channel alone never proves interpolation. JSON,
ordinary YAML, TOML and INI keep dollar and percent text as literal values.
Compose and other consumers need an explicit interpolation contract. Unknown,
absent, incompatible and mixed contexts keep conservative detection.

Read and mentioned-file callers pass the file language. Mixed tool output and
proxy content retain conservative detection. Shell tool policy deliberately
retains reference findings as evidence: its existing shell parser proves pure
references before applying destination rules. A name-specific allow rule can
allow a pure variable reference only to known allowed destinations; defaults,
literals and unknown destinations keep the existing policy.

Vault entries record `matchScope: bare | in-context` when registered. Existing
entries without the field use the tested legacy predicate. Scope never widens
merely because the same value is encountered again.

The gitleaks global secret regexes and stopwords are imported from the pinned
TOML; path exemptions are omitted. Interpreter-sensitive entries require known
context. `GITLEAKS_OVERLAY.json` records every overridden upstream id and source.
The stateless GitHub App rule identifies `fillsGapOf`, and its retirement test
fails when that upstream rule covers the format. Curl stopwords inspect the
password only, after parsing the separator outside expansions.

## Phase 54.7 integration

Import `detectorUpdates` from
`packages/zeroh-disclosure-core/detector-updates.js`. Pass `currentCatalog`,
`nextCatalog`, `overlay`, `release: {version, source}`, and announcements shaped
as `{kind: 'token-format', id, provider, source}`. The function returns reports;
a changed overlay-referenced rule sets `needsUpdateTask`. Missing catalogue
comparison sets `comparisonPending`. The phase 54.7 watcher owns fetching,
deduplication, scheduling and opening the update task. `compat/watch.mjs` is
unchanged here.

## Upstream reports

The three reports were not filed: the task's hard isolation rule prohibits
reading the real GitHub credentials, and only fake credentials were available.
The pinned upstream replay and local tests provide reproducible evidence for:

- `curl-auth-user` omits a variable username with an empty password.
- Its variable-password allowlist ignores single quotes and accepts a prefix
  of a literal dollar password.
- The global boolean allowlist needs `^(?:true|false|null)$` grouping.

All fixture values are artificial. No external issue, message or release was
published by this work.
