# Receipt format

ZeroH Disclosure writes one signed receipt for every turn. A receipt proves,
on your own machine, which policy and engine processed the turn, what categories were found and
masked, a hash of exactly the text that was allowed to reach the model, and (from 1.0.0) every
number the receipt shows for the turn. It never contains a
real value. Receipts are written to
`<ZEROH_HOME>/projects/<project>/sessions/<session-id>/turn-<n>.json` (never into the project;
`<project>` is spelled as Claude Code names its `~/.claude/projects` folders), kept for
`ZEROH_RECEIPT_RETENTION` (90 days by default), and checked with
`zeroh-disclosure verify --receipt <file>`.

## The signed receipt

The receipt is a compact JWS signed with ES256 (ECDSA P-256) by a key kept in the session folder
(`signing-key.json` holds the public half). Its header has `typ: zeroh-receipt+jwt`. Detail claims
use salted digests in the style of SD-JWT, so a detail can be shown without revealing the others;
the format is not an IETF SD-JWT. A stored receipt carries `compact`, the encoded `disclosures`,
and their `disclosure_manifest`, plus `receipt_hash`, the SHA-256 of the compact receipt, which the
next receipt links to.

## Public claims

| Claim                                                                          | Meaning                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                                                                       | `zeroh-disclosure-receipt/v2`                                                                                                     |
| `subject_type`                                                                 | What the receipt covers: `prompt`                                                                                                 |
| `receipt_id`, `iat`                                                            | Identifier and time of issue                                                                                                      |
| `iss`, `sub`, `issuer_public_jwk`                                              | The signing key, as a `did:jwk` identifier and its public key                                                                     |
| `signing_key_id`                                                               | The local signing key's id (`local:<n>`)                                                                                          |
| `policy_id`, `policy_alias`, `policy_hash`                                     | The policy applied (`zeroh-disclosure-v1`) and a hash of its rules                                                                |
| `proof_stage`                                                                  | `pre_boundary` when written before the prompt was sent; `stop_backfill` when the turn's receipt was completed at `Stop`           |
| `detector_hash`                                                                | Hash of the detector configuration                                                                                                |
| `protection_engine_id`, `protection_engine_hash`, `protection_engine_manifest` | The engine that ran (`regex-local`, the plugin's own pattern detector) and a hash of its manifest                                 |
| `protection_engine_resolution`                                                 | Requested and selected engine (both `regex-local` in the free plugin)                                                             |
| `boundary_hash`                                                                | Hash of where the content went (Claude Code to the Anthropic API, by default)                                                     |
| `decision_action`                                                              | What was done with the prompt: `block` (stopped), `mask_and_allow` (masked, by the proxy or the policy) or `allow_with_receipt`   |
| `detected_categories`, `masked_categories`                                     | Categories found, and those replaced by tokens                                                                                    |
| `sanitized_content_hash`                                                       | SHA-256 of the exact text allowed to reach the model                                                                              |
| `original_content_commitment`                                                  | An HMAC of the original text under a session key that stays on your machine, so the original cannot be guessed from it            |
| `previous_receipt_hash`, `previous_token_hash`                                 | Links to the previous receipt in the session, forming a chain                                                                     |
| `raw_content_sent_to_ai_provider`                                              | `true` when the typed prompt went as typed with values ZeroH found (proxy not running); else `false`. Always `false` before 1.0.0 |
| `sanitized_content_may_be_sent_to_ai_provider`                                 | `false` when the prompt was stopped                                                                                               |
| `raw_content_seen_by_zeroh_saas`                                               | Always `false`: no Blade Labs service sees your content                                                                           |
| `unmask_receipt_extension`                                                     | Present when the receipt carries the local record of values shown under an unmask grant                                           |
| `turn_summary_extension`                                                       | `zeroh-turn-summary/v2` in 1.1.0 (`v1` in historical 1.0.x receipts): the turn's summary signed at `Stop` is required; see below  |

Hashes use SHA-256 in base64url. Policy, boundary and engine hashes are taken over canonical JSON
with sorted keys.

## Selective disclosures

The receipt can reveal these details individually: `boundary_details`, `decision_details`,
`detector_manifest`, `protection_engine_manifest`, `transformation_manifest` (the type, position and
length of each replacement, never the value) and `masked_prompt`.

## The signed turn summary

The receipt above is signed at `UserPromptSubmit`, before the model answers, so it covers the typed
prompt. Everything else the receipt shows for a turn happens later: tool output and file reads
masked, values sent to Claude, destinations checked and blocked, formats and operations that passed
unchecked, and misses reported. From 1.0.0, `Stop` signs these numbers as the turn's summary with
the same session key and stores it in the turn ledger as `turn_summary` (`schema`
`zeroh-turn-summary/v1`, and `compact`, a JWS whose claims are `receipt_id`, `receipt_hash`,
`turn`, `iat` and `summary`). The current turn is signed again at every `Stop`.

`summary` holds, per turn: `prompt` (`sent`, `stopped` or `sent_unmasked`), `values_masked`,
`values_sent`, `sent_unmasked` (`count` and `by_type`), `sent_under_grant`, `masked_by_type`,
`masked_by_channel` (typed prompt, file read, command output and the other channels), `tokens`,
`token_map`, `files`, `destinations_checked`, `destinations_blocked`, `formats_passed_unmasked`,
`formats_withheld`, `passed_unchecked` (count per reason), `misses_reported` and
`values_sent_to_ai_provider` (a value reached the model in plain text this turn: see "sent" below). The session
receipt, receipt.html, `/zeroh-disclosure:report` and the Stop line's counts are read from this
signed summary, so what is shown is what is signed.

"Sent" (`values_sent`) means one thing everywhere: values that reached the model in plain text,
that is distinct values typed and sent without the proxy (deduped by value) plus values shown under
an unmask grant you approved. It is stated at two scopes, under two names: the prompt receipt's
`raw_content_sent_to_ai_provider` is `true` when the typed prompt sent one, and the signed summary's
`values_sent_to_ai_provider` is `true` when the whole turn did.

The `zeroh-turn-summary/v1` fields are frozen with 1.0.0: a summary verifies only when it carries
exactly the fields listed above. A new field makes a new schema, `zeroh-turn-summary/v2`; `verify`
picks the field list by the summary's `schema`, so v1 summaries keep verifying.

Versions:

- **1.0.0 and later**: the receipt carries `turn_summary_extension`. `verify` requires the summary,
  checks its signature against the receipt's `issuer_public_jwk`, checks that it names this
  receipt's id and hash, and recomputes the summary from the ledger: changing any number the
  receipt shows fails the `turn_summary` check. A turn that `Stop` has not finalised yet is
  reported as pending (`coverage: pending`), not as verified. In a receipt bundle the summary's
  signature and receipt binding are checked.
- **Before 1.0.0**: no `turn_summary_extension`; the receipt verifies as before and is reported
  with `coverage: typed-prompt`. The slip says how many receipts sign the typed prompt only.

## Values shown under an unmask grant

When you approve an unmask grant, tool results that then contain an unmasked value are counted in
the turn's `revealed_under_grant` list with the grant id. This list is authenticated with an HMAC
under your local allow-list key (`revealed_under_grant_hmac`), and the signed receipt requires it
through `unmask_receipt_extension`, so it cannot be dropped or edited without failing verification.

## Operations not protected

With the default `ZEROH_UNCERTAIN=pass`, an operation ZeroH cannot protect goes on as it is. The
user is told in one line on screen, at most once per reason per turn, for example
`ZeroH Disclosure: this command was not protected (dynamic destination); STRIPE_KEY was used
without a destination check.` The line names a value's name or type, never the value. The turn
ledger counts every such operation in `audit.unchecked`: an object keyed by reason, each holding
a count per tool name, for example `{"unknown-format": {"Read": 1}, "watchdog-timeout": {"Bash":
1}}`, and lists the reasons already shown this turn in `audit.unchecked_noticed`. The local proxy
can't show a line itself: it counts its pass under the tool name `proxy` and leaves the reason in
`audit.unchecked_deferred` for the turn's `Stop`, which shows the line then. None of these holds a
value, command, path or host; a tool name that is not a plain name is counted as `other`. The
reasons are:

| Reason                  | Shown as                                     | What went on unprotected                                                                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `dynamic-destination`   | dynamic destination                          | a restored value sent to a destination known only at run time                                           |
| `script-or-interpreter` | script or interpreter                        | a restored value given to a script or interpreter ZeroH cannot follow                                   |
| `unknown-launcher`      | unknown launcher                             | a command started through a launcher ZeroH does not know                                                |
| `unparseable`           | couldn't parse it                            | a command ZeroH could not parse                                                                         |
| `watchdog-timeout`      | timed out                                    | a prompt, tool call or tool output whose check ran out of time                                          |
| `unknown-format`        | unknown format                               | output ZeroH cannot read: an image, a scanned PDF, an image in MCP output                               |
| `proxy-not-running`     | proxy not running                            | model traffic sent while the local masking proxy was not running                                        |
| `raw-secret-in-command` | a known secret written into the command      | the model wrote a known secret into a command: ZeroH missed it earlier                                  |
| `variable-in-command`   | a variable whose value ZeroH cannot see      | a command sent only a variable reference (`-u "$KEY:"`): ZeroH cannot see what it holds or check where  |
| `sensitive-file-masked` | private key or credential file read (masked) | a private key or credential file was read and passed on masked                                          |
| `too-large`             | too large to scan                            | a typed prompt over 256 KB, sent unscanned                                                              |
| `vault-unavailable`     | ZeroH couldn't open its vault                | a prompt, tool output or tool call passed unmasked: ZeroH could not open its vault                      |
| `vault-unsaveable`      | ZeroH couldn't save its vault                | new values passed unmasked because ZeroH could not save its vault; values already on disk stayed masked |

The first such line of a session adds how to tighten: "Type
`/zeroh-disclosure:settings uncertain block` to stop these instead." For `raw-secret-in-command` it says instead to run
`/zeroh-disclosure:report-miss` and rotate the key. Each hint is shown once per session (a marker
file `unchecked-hint-<kind>` in the session folder).

The Stop line says "N operations not protected", and the session receipt, `/zeroh-disclosure:report`
and both HTML pages list them by reason under "not protected". With `ZEROH_UNCERTAIN=block` the
same cases are stopped instead, the same line (worded as "was stopped because it could not be
protected") is the reason given, and nothing is added here.

## Receipts kept at uninstall

Uninstall deletes `ZEROH_HOME` but keeps the receipts (unless `--delete-receipts`). Every
`turn-<n>.json`, each session's `session.bundle.json` and `receipt.html`, and each session's
`signing-key.json` (the public key only) move to `~/ZeroH Receipts` on macOS and Linux,
`%LOCALAPPDATA%\ZeroH Receipts` on Windows, `<ZEROH_HOME>-receipts` when `ZEROH_HOME` is set, or
`ZEROH_RECEIPTS_DIR`, laid out as `projects/<project>/sessions/<session-id>/`. A turn that `Stop`
had not finalised loses its `local_private` part (the key behind its value commitments), and
`receipt.html` is written again without value previews. The folder has a `README.txt` and a
manifest, `zeroh-receipts.json` (`schema` `zeroh-kept-receipts/v1`), listing each kept receipt by
`receipt_id` with its file and `reveal_record`: the unmask record checked with the local allow-list
key before uninstall deleted it (`verified`, `mismatch` or `none`). A `verified` record also has a
`reveal_attestation` (`schema` `zeroh-kept-reveal-record/v1`), signed with the session's receipt
signing key before its private half was deleted: it binds the receipt id and hash to the SHA-256 of
the kept `revealed_under_grant` and its HMAC. `verify` checks it with the receipt's own public key,
so an unmask record changed after uninstall fails `revealed_under_grant_hmac`; a kept receipt with
no attestation reports that check as unavailable, never as passed. Every other check runs as before,
against the receipt's own public key.

## Receipt bundle

At the end of each turn, the `Stop` hook also rewrites `session.bundle.json`: the session's signed
receipts, summary counts and chain evidence in one file, with schema `zeroh-receipt-bundle/v1`.
Check it with `zeroh-disclosure verify --bundle <file>`.

## What the verifier checks

- The compact receipt decodes, its header `typ` is right, and the signature verifies against
  `issuer_public_jwk`.
- Every stored disclosure matches its signed digest.
- `policy_hash` matches the policy in this plugin, and `protection_engine_hash` matches
  `protection_engine_manifest`.
- `sanitized_content_hash` matches the masked text stored in the turn ledger or bundle.
- The chain links to the previous receipt and token hash hold.
- The unmask record, when required, is present and its HMAC verifies.
- The turn summary, when required, is signed by the receipt's key, belongs to this receipt, and
  matches every number in the ledger.

Verification is local and makes no network call. On failure, `verify` prints `ok: false` and the
name of every failed check.

## Self-describing receipts and token-spec version (1.1)

New signed prompt receipts use `schema: zeroh-disclosure-receipt/v2`,
`schema_id: zeroh-disclosure-receipt`, `schema_version: 2`, the session's
`signing_key_id`, and `vct: https://zeroh.io/vct/disclosure-receipt/v2`.
The signed `token_spec_version` is an object with:

- `version: zeroh-disclosure-token-spec/2`;
- `zeroh: { family: zeroh-1.x, pattern_version: 1 }`;
- `gateway: { family: privacy-gateway, pattern_version: 2 }`.

The version describes recognition, not shared minting. ZeroH still mints its
1.x square-bracket placeholders and restores existing transcripts and vaults.
Gateway recognition retains the version 2 shape
`<[A-Z][A-Z0-9_]*_(?:[0-9a-f]{16}|[0-9a-f]{32}|[0-9a-f]{64})>`,
derived from `privacy-gateway-core/src/services/token-derivation.service.ts` and
its caller `privacy-gateway-postgres/src/stores.ts`: an uppercase label
followed by lowercase HMAC-SHA256 hex of exactly 16, 32 or 64 characters.
Recognition additionally requires a known entity or credential type from
`GATEWAY_TOKEN_LABELS` in `sensitive-data-detectors/src/masked-tokens.js`;
an arbitrary uppercase label is not a placeholder. Unknown labels are scanned
separately so their trailing underscore cannot hide concrete personal data.
Recognition is case sensitive. Known values (including encoded variants) are
always masked, even inside a gateway-shaped span. Detector findings wholly
inside a recognized span are ignored; overlapping findings retain fragments
outside it only when they contain a letter or digit. A credential whose
password is wholly masked adds no credential finding. Historical token-spec version 1 remains verifiable as signed. Other angle-bracket text receives ordinary detection. Gateway
placeholders remain unchanged and never count as ZeroH values or ask its vault
for restoration. Phase 58 owns shared vocabulary and gateway adoption.

New turn summaries use `schema: zeroh-turn-summary/v2`,
`schema_id: zeroh-turn-summary`, `schema_version: 2`, and `signing_key_id`; their
signed `summary` adds `token_spec_version` to the frozen v1 count fields. The
summary's schema and metadata must match its prompt receipt. Verifiers dispatch
by schema and continue accepting v1 summaries and historical 1.0 prompt
receipts (which already used a `/v2` label without numeric `schema_version`).
New v2 metadata and every summary field are signed; changing a field fails
verification. A future recognition change needs a new token-spec pattern
version, not a rewrite of evidence already signed.

## Receipt sink and the AF2 core relay contract

Every receipt writer uses the sink in
`packages/zeroh-disclosure-core/receipt-sink.js`. Its synchronous interface is
`write({ kind, path, bytes })`: an existing local destination and the exact serialized
bytes. Writers serialize once. `writeReceiptJson` keeps the existing indented
JSON plus trailing newline; `writeReceiptBytes` passes bytes unchanged.
`withReceiptSink(sink, operation)` injects a sink for one operation and its async
children. The default and only shipped sink, `localFileReceiptSink`, writes
the same files, at the same paths, with the same bytes and private permissions.
The seam includes turn ledgers, bundles, receipt HTML, Stop verification
attestations, unmask ledger updates, exports and kept receipt copies.
Session state and local signing-key persistence stay outside receipt transport.

For a future **core relay** sink in a Dot, the box hands the **unchanged
Disclosure receipt (the signed v2 bytes)** to the AF2 core. The core wraps it
as the evidence of an **Audit runtime-decision record** and signs that record
with the **tenant key**. The box never rewrites a receipt into Audit's schema
and never holds the tenant key. The local signature and receipt hashes remain
verifiable after transport. Relay delivery, retries, intake and Audit wrapping
are later Dots work; no relay sink is built in 1.1.0.

Each sink write carries an artifact `kind`: `receipt` for receipt evidence,
`receipt-html` for the local receipt preview, `report-export` for report
JSON or HTML exports, `pending-ledger` for unfinished turn ledgers and tool
ledgers, and `keep-folder` for uninstall copies, README, manifest and public
keys. Pending ledgers may carry `local_private.hmacKeyBytes` and must remain
local, even when they already include a signed prompt receipt. Only finalized
signed receipts (including bundles and signed verification attestations) are
kind `receipt`. A relay sends only these finalized signed receipt bytes to the
AF2 core; it never sends pending ledgers or keep-folder files. HTML previews and report exports may include personal-data previews
and must remain local. The default local sink writes the same paths and bytes
for every kind; this classification changes no local files. A future relay
must filter by kind and hand the unchanged signed receipt bytes to the core,
which wraps and signs the Audit record with its tenant key. The box never
rewrites the receipt or holds that tenant key.
