# `lib/vi/` — Verifiable Intent integration

Composes the [Verifiable Intent](https://verifiableintent.dev) (VI) spec with
the disclosure receipt pipeline so an agent's commerce actions can be
verified by both the merchant (forward, via the VI chain) and the user
(backward, via the anchored disclosure receipts the plugin produces).

VI is forward authorization: *"the user signed an L2 mandate binding the
agent's key, with these constraints"*. The disclosure plugin enforces those
constraints at the moment of every action and produces signed proof of
enforcement. Both halves use the same agent key (`cnf.jwk`) so verifiers
follow a single root of trust.

## What lives here

| File | Purpose |
|---|---|
| `models.js` | JSDoc typedefs for L1/L2 payloads, 8 constraint shapes, intent_binding |
| `parse.js`  | Compact SD-JWT decode (header, payload, disclosures) via `@sd-jwt/sd-jwt-vc` |
| `verify.js` | Chain verification: L1 against issuer JWKS, L2 against L1.cnf.jwk |
| `ingest.js` | Loads an L2 mandate at SessionStart from env or `<project>/.zeroh.intent` |
| `constraints/` | One file per VI constraint type (`amount_range`, `allowed_merchants`, …) |
| `index.js`  | Re-exports |

## Fixtures

Tests use synthetic L1/L2 chains under `test/fixtures/vi/`. They're not
checked-in copies from the Python reference impl — they're minted in pure JS
by `scripts/vi-fixture-gen.mjs` and follow the VI spec shape. The keys are
disposable test keys; do not use them for anything else.

To regenerate:

```bash
cd plugins/zeroh-disclosure
node scripts/vi-fixture-gen.mjs
```

This rewrites:

```
test/fixtures/vi/
├── issuer-key.json   issuer-jwks.json
├── user-key.json     user-jwks.json
├── agent-key.json    agent-jwks.json
├── l1.sdjwt          (issuer → user, vct = …/card, cnf.jwk binds user)
└── l2.sdjwt          (user → agent, aud=commerce, sd_hash binds L1,
                       8 constraint examples in delegate_payload)
```

## Pinned VI spec reference

The L1/L2/L3 claim shapes mirror the VI spec at commit
[`agent-intent/verifiable-intent@master`](https://github.com/agent-intent/verifiable-intent),
specifically `spec/credential-format.md` and `spec/constraints.md`. When the
upstream spec changes, regenerate fixtures and re-port any new constraint
type into `constraints/`.

## Commerce tool contract

A commerce-tiered tool call (matched by name, see `lib/tool-policies.js`)
must declare a `_intent_fulfillment` object on its `tool_input`:

```jsonc
{
  "amount": 800,                // minor units (cents)
  "currency": "USD",
  "merchant": { "id": "merchant-001" },
  "payee":    { "id": "payee-001" },
  "line_items": [{ "id": "sku-coffee", "quantity": 1 }],
  "reference": "binding-001"     // matches mandate.payment.reference
}
```

Without `_intent_fulfillment`, the PreToolUse hook denies the call with
`must declare _intent_fulfillment`. With it, the active L2 mandate's
constraints are evaluated against this object — out-of-scope amounts,
unknown merchants, etc. → deny with the violating constraint named.

## Security notes

- The L2 SD-JWT plus the agent's private key together are a bearer-grade
  credential. The plugin writes them with mode `0600` and refuses to ingest
  world-readable files on POSIX.
- Key reuse: when a mandate is active and `ZEROH_VI_AGENT_KEY_FILE` is set,
  the L2-bound agent key signs both L3 (forward) and the disclosure receipt
  (backward). The receipt's `kid` rotates on every new mandate.
- v1 verifies against a **local** issuer JWKS (`ZEROH_VI_ISSUER_JWKS_FILE`).
  Live JWKS resolution against a real issuer URL is deferred to v2.
