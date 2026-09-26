# Receipt format

ZeroH Disclosure writes one signed receipt for every turn. A receipt proves,
on your own machine, which policy and engine processed the turn, what categories were found and
masked, and a hash of exactly the text that was allowed to reach the model. It never contains a
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

| Claim                                                                          | Meaning                                                                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                                                                       | `zeroh-disclosure-receipt/v2`                                                                                                   |
| `subject_type`                                                                 | What the receipt covers: `prompt`                                                                                               |
| `receipt_id`, `iat`                                                            | Identifier and time of issue                                                                                                    |
| `iss`, `sub`, `issuer_public_jwk`                                              | The signing key, as a `did:jwk` identifier and its public key                                                                   |
| `signing_key_id`                                                               | The local signing key's id (`local:<n>`)                                                                                        |
| `policy_id`, `policy_alias`, `policy_hash`                                     | The policy applied (`zeroh-disclosure-v1`) and a hash of its rules                                                              |
| `proof_stage`                                                                  | `pre_boundary` when written before the prompt was sent; `stop_backfill` when the turn's receipt was completed at `Stop`         |
| `detector_hash`                                                                | Hash of the detector configuration                                                                                              |
| `protection_engine_id`, `protection_engine_hash`, `protection_engine_manifest` | The engine that ran (`regex-local`, the plugin's own pattern detector) and a hash of its manifest                               |
| `protection_engine_resolution`                                                 | Requested and selected engine (both `regex-local` in the free plugin)                                                           |
| `boundary_hash`                                                                | Hash of where the content went (Claude Code to the Anthropic API, by default)                                                   |
| `decision_action`                                                              | What was done with the prompt: `block` (stopped), `mask_and_allow` (masked, by the proxy or the policy) or `allow_with_receipt` |
| `detected_categories`, `masked_categories`                                     | Categories found, and those replaced by tokens                                                                                  |
| `sanitized_content_hash`                                                       | SHA-256 of the exact text allowed to reach the model                                                                            |
| `original_content_commitment`                                                  | An HMAC of the original text under a session key that stays on your machine, so the original cannot be guessed from it          |
| `previous_receipt_hash`, `previous_token_hash`                                 | Links to the previous receipt in the session, forming a chain                                                                   |
| `raw_content_sent_to_ai_provider`                                              | Always `false`: the provider receives only the masked text                                                                      |
| `sanitized_content_may_be_sent_to_ai_provider`                                 | `false` when the prompt was stopped                                                                                             |
| `raw_content_seen_by_zeroh_saas`                                               | Always `false`: no Blade Labs service sees your content                                                                         |
| `unmask_receipt_extension`                                                     | Present when the receipt carries the local record of values shown under an unmask grant                                         |

Hashes use SHA-256 in base64url. Policy, boundary and engine hashes are taken over canonical JSON
with sorted keys.

## Selective disclosures

The receipt can reveal these details individually: `boundary_details`, `decision_details`,
`detector_manifest`, `protection_engine_manifest`, `transformation_manifest` (the type, position and
length of each replacement, never the value) and `masked_prompt`.

## Values shown under an unmask grant

When you approve an unmask grant, tool results that then contain an unmasked value are counted in
the turn's `revealed_under_grant` list with the grant id. This list is authenticated with an HMAC
under your local allow-list key (`revealed_under_grant_hmac`), and the signed receipt requires it
through `unmask_receipt_extension`, so it cannot be dropped or edited without failing verification.

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

Verification is local and makes no network call. On failure, `verify` prints `ok: false` and the
name of every failed check.
