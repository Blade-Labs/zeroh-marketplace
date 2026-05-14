// VI claim shapes — JSDoc typedefs ported from
// https://github.com/agent-intent/verifiable-intent/blob/master/spec/credential-format.md.
// Pinned commit in lib/vi/README.md. JS-friendly: not enforced at runtime,
// but documents the wire format and feeds editor tooling.

/**
 * @typedef {object} JWK
 * @property {string} kty
 * @property {string} crv
 * @property {string} x
 * @property {string} y
 * @property {string=} kid
 */

/**
 * L1 — Issuer credential (issuer → user). 1-year nominal lifetime.
 * The L1 payload always-visible claims:
 * @typedef {object} L1Payload
 * @property {string} iss               Issuer URL (root of trust via JWKS at iss/.well-known/jwks.json)
 * @property {string} sub               User identifier (stable across L1s — see VI privacy notes)
 * @property {number} iat               Issued-at (seconds)
 * @property {number} exp               Expiry (seconds)
 * @property {string} vct               Credential type, e.g. "https://credentials.mastercard.com/card"
 * @property {{ jwk: JWK }} cnf         Binds user public key
 * @property {string} pan_last_four
 * @property {string} scheme            "mastercard" | "visa" | ...
 * @property {string} _sd_alg           Disclosure hash algorithm (always "sha-256")
 * @property {string[]} _sd             Hashes of selectively-disclosable claims (e.g. email)
 */

/**
 * L2 — User mandate (user → agent). 15min (Immediate) or up to 30d (Autonomous).
 * @typedef {object} L2Payload
 * @property {string} iss               User identifier (signs with key bound in L1.cnf.jwk)
 * @property {string} aud               Intended audience (e.g. "commerce")
 * @property {string} nonce             Replay-prevention nonce
 * @property {number} iat
 * @property {number} exp
 * @property {string} sd_hash           B64U(SHA-256(L1 serialization)) — binds L1
 * @property {"immediate" | "autonomous"} mode
 * @property {DelegatePayload=} delegate_payload   Autonomous-mode constraints + agent cnf
 */

/**
 * L2 delegate_payload (autonomous mode): the body of what the user authorized.
 * Mirrors VI's split into checkout and payment mandates.
 * @typedef {object} DelegatePayload
 * @property {CheckoutMandate=} checkout_mandate
 * @property {PaymentMandate=}  payment_mandate
 */

/**
 * @typedef {object} CheckoutMandate
 * @property {string} vct                          "mandate.checkout.open.1"
 * @property {{ jwk: JWK, kid?: string }=} cnf     Binds agent public key (autonomous only)
 * @property {Constraint[]} constraints
 */

/**
 * @typedef {object} PaymentMandate
 * @property {string} vct                          "mandate.payment.open.1"
 * @property {{ jwk: JWK, kid?: string }=} cnf
 * @property {{ scheme: string, pan_last_four: string }} payment_instrument
 * @property {object=} risk_data
 * @property {Constraint[]} constraints
 */

/**
 * VI constraint registry — one type per `type` value, 1:1 with VI's Python `_REGISTRY`.
 * @typedef {AllowedMerchants | LineItems | AllowedPayees | AmountRange
 *   | Budget | Recurrence | AgentRecurrence | Reference} Constraint
 *
 * @typedef {{ type: "mandate.checkout.allowed_merchants", allowed: { id?: string, name?: string, website?: string }[] }} AllowedMerchants
 * @typedef {{ type: "mandate.checkout.line_items", items: { id: string, acceptable_items: string[], quantity: number }[], match_mode?: "subset" | "exact" }} LineItems
 * @typedef {{ type: "mandate.payment.allowed_payees", allowed: { id?: string, name?: string, website?: string }[] }} AllowedPayees
 * @typedef {{ type: "mandate.payment.amount_range", currency: string, min: number, max: number }} AmountRange
 * @typedef {{ type: "mandate.payment.budget", currency: string, min?: number, max: number }} Budget
 * @typedef {{ type: "mandate.payment.recurrence", frequency: string, start_date?: string, end_date?: string, number?: number }} Recurrence
 * @typedef {{ type: "mandate.payment.agent_recurrence", frequency: string, start_date?: string, end_date?: string, max_occurrences?: number }} AgentRecurrence
 * @typedef {{ type: "mandate.payment.reference", conditional_transaction_id: string }} Reference
 */

/**
 * Fulfillment — what a commerce tool call ACTUALLY proposes to do. The plugin
 * requires this as the `_intent_fulfillment` field on the tool input, then
 * checks it against the active mandate's constraints.
 * @typedef {object} IntentFulfillment
 * @property {number=} amount                      Minor units (e.g. cents)
 * @property {string=} currency                    ISO 4217
 * @property {{ id?: string, name?: string, website?: string }=} merchant
 * @property {{ id?: string, name?: string, website?: string }=} payee
 * @property {{ id: string, quantity: number }[]=} line_items
 * @property {string=} reference                   conditional_transaction_id (binds checkout↔payment)
 */

/**
 * intent_binding — what lands inside ZeroH receipts when a VI mandate is active.
 * Compact, includes only hashes + non-PII summary so the receipt stays auditable
 * without re-distributing the mandate itself.
 * @typedef {object} IntentBinding
 * @property {string} l1_hash                       B64U(SHA-256(L1 serialized))
 * @property {string} l2_hash                       B64U(SHA-256(L2 serialized))
 * @property {string} l2_nonce
 * @property {string} mandate_aud
 * @property {string} agent_jwk_kid                 RFC 7638 JWK thumbprint
 * @property {string} scope_summary                 Human-readable summary, ≤120 chars
 * @property {number} expiry                        Unix seconds (L2 exp)
 */

export {};
