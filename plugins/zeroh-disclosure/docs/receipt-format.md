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

## Operations not protected

With the default `ZEROH_UNCERTAIN=pass`, an operation ZeroH cannot protect goes on as it is. The
user is told in one line on screen, at most once per reason per turn, for example
`ZeroH Disclosure: this command was not protected (dynamic destination); STRIPE_KEY was used
without a destination check.` The line names a value's name or type, never the value. The turn
ledger counts every such operation in `audit.unchecked`: an object keyed by reason, each holding
a count per tool name, for example `{"unknown-format": {"Read": 1}, "watchdog-timeout": {"Bash":
1}}`, and lists the reasons already shown this turn in `audit.unchecked_noticed`. Neither holds a
value, command, path or host; a tool name that is not a plain name is counted as `other`. The
reasons are:

| Reason                  | Shown as                                     | What went on unprotected                                                     |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `dynamic-destination`   | dynamic destination                          | a restored value sent to a destination known only at run time                |
| `script-or-interpreter` | script or interpreter                        | a restored value given to a script or interpreter ZeroH cannot follow        |
| `unknown-launcher`      | unknown launcher                             | a command started through a launcher ZeroH does not know                     |
| `unparseable`           | couldn't parse it                            | a command ZeroH could not parse                                              |
| `watchdog-timeout`      | timed out                                    | a prompt, tool call or tool output whose check ran out of time               |
| `unknown-format`        | unknown format                               | output ZeroH cannot read: an image, a scanned PDF, an image in MCP output    |
| `proxy-not-running`     | proxy not running                            | model traffic sent while the local masking proxy was not running             |
| `raw-secret-in-command` | a known secret written into the command      | the model wrote a known secret into a command: ZeroH missed it earlier       |
| `sensitive-file-masked` | private key or credential file read (masked) | a private key or credential file was read and passed on masked               |
| `too-large`             | too large to scan                            | a typed prompt over 256 KB, sent unscanned                                   |
| `vault-unavailable`     | ZeroH couldn't open its vault                | a prompt sent through the proxy while ZeroH could not open or save its vault |

The first such line of a session adds how to tighten: "To block these instead, run
`/zeroh-disclosure:settings uncertain block`." For `raw-secret-in-command` it says instead to run
`/zeroh-disclosure:report-miss` and rotate the key. Each hint is shown once per session (a marker
file `unchecked-hint-<kind>` in the session folder).

The Stop line says "N operations not protected", and the session receipt, `/zeroh-disclosure:report`
and both HTML pages list them by reason under "not protected". With `ZEROH_UNCERTAIN=block` the
same cases are stopped instead, the same line (worded as "was stopped because it could not be
protected") is the reason given, and nothing is added here.

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
