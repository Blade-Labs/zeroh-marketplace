# ZeroH Disclosure Receipt Schema v2

`zeroh-disclosure-receipt/v2` is the invariant proof artifact. Surface adapters
such as Claude Code hooks, the CLI, browser extensions, or MCP servers may
produce it, but verifiers validate the same contract.

Required public claims:

- `schema`: `zeroh-disclosure-receipt/v2`
- `subject_type`: `prompt` by default; `tool_action` for signed PreToolUse
  decisions
- `receipt_id`, `receipt_hash`, `iat`
- `policy_id`, `policy_alias`, `policy_hash`
- `boundary_hash`
- `proof_stage`: usually `pre_boundary`; `stop_backfill` is allowed only for
  legacy/backfill turns
- `protection_engine_id`
- `protection_engine_hash`: SHA-256 base64url hash of canonical engine manifest
- `protection_engine_manifest`: the manifest that produced the engine hash
- `protection_engine_resolution`: selected engine, requested engine, fallback
  status, and degradation reason if fallback occurred
- `decision_action`
- `detected_categories`, `masked_categories`
- `sanitized_content_hash`: SHA-256 base64url hash of the text allowed to cross
  the boundary
- `original_content_commitment`: HMAC commitment to raw input using a local
  session key that never leaves the controlled runtime
- `previous_receipt_hash`, `previous_token_hash`
- `raw_content_seen_by_zeroh_saas`, `raw_content_sent_to_ai_provider`,
  `sanitized_content_may_be_sent_to_ai_provider`
- `issuer_public_jwk`: public verification key for the receipt signature

Tool-action receipts add:

- `tool_use_id`, `tool_name`, `tool_tier`
- `tool_input_hash`, `tool_input_commitment`
- `allowed_tool_input_hash`
- `intent_fulfillment_hash`
- `constraint_result_hash`
- `decision_action`: `tool_allow`, `tool_deny`, `tool_rewrite`, or
  `tool_warn`

Hash rules:

- Policy, boundary, and engine hashes use canonical JSON with sorted object
  keys and SHA-256 base64url encoding.
- `sanitized_content_hash` hashes the exact model-safe text returned by the
  disclosure primitive.
- `original_content_commitment` is not a raw hash; it is an HMAC so raw content
  cannot be guessed from public receipts.

Selective disclosures:

- `boundary_details`
- `decision_details`
- `protection_engine_manifest`
- `transformation_manifest`
- `masked_prompt`
- `tool_action_details`, `intent_fulfillment`, `constraint_result` for
  tool-action evidence

Verifier expectations:

- Decode the compact SD-JWT-like receipt.
- Verify the signature against `issuer_public_jwk`.
- Recompute `policy_hash` from the local policy registry.
- Recompute `protection_engine_hash` from `protection_engine_manifest`.
- Recompute `sanitized_content_hash` when the sanitized text is supplied by a
  ledger or proofpack.
- Verify token-chain links when previous receipt/token hashes are present.
- Treat anchoring as additional evidence. HCS verification checks the mirror
  topic message payload against `receipt_hash` and `token_hash`; EVM
  verification checks calldata against `receipt_hash`. An unanchored receipt can
  still be a valid signed proof, but it must report unanchored status
  explicitly.
