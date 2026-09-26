// SPDX-License-Identifier: AGPL-3.0-only

// Receipt bundles: a session's signed receipts in one verifiable file.
import { sha256B64u, canonicalJson } from './crypto.js';

// A receipt bundle collects a session's signed receipts into one file that
// `zeroh-disclosure verify --bundle` checks as a whole, including the chain
// that links each receipt to the one before it.
export const RECEIPT_BUNDLE_SCHEMA = 'zeroh-receipt-bundle/v1';

export async function buildReceiptBundle(receipts, { session = null } = {}) {
  const records = receipts.map(toBundleRecord);
  const rows = records.map((r) => r.receipt.public_claims);
  const bundle = {
    schema: RECEIPT_BUNDLE_SCHEMA,
    session,
    generated_at: new Date().toISOString(),
    summary: {
      receipts_count: rows.length,
      decision_counts: count(rows.map((r) => r.decision_action)),
      detected_categories: count(
        rows.flatMap((r) => r.detected_categories ?? []),
      ),
      masked_categories: count(rows.flatMap((r) => r.masked_categories ?? [])),
      boundary_hashes: [
        ...new Set(rows.map((r) => r.boundary_hash).filter(Boolean)),
      ],
      raw_content_seen_by_zeroh_saas: false,
    },
    receipts: records,
    evidence_rows: rows.map((r) => ({
      receipt_id: r.receipt_id,
      receipt_hash:
        records.find(
          (record) => record.receipt.public_claims.receipt_id === r.receipt_id,
        )?.receipt.receipt_hash ?? null,
      schema: r.schema,
      policy_id: r.policy_id,
      policy_alias: r.policy_alias,
      policy_hash: r.policy_hash,
      detector_hash: r.detector_hash,
      protection_engine_id: r.protection_engine_id,
      protection_engine_hash: r.protection_engine_hash,
      protection_engine_resolution: r.protection_engine_resolution,
      proof_stage: r.proof_stage,
      boundary_hash: r.boundary_hash,
      decision_action: r.decision_action,
      detected_categories: r.detected_categories,
      masked_categories: r.masked_categories,
      sanitized_content_hash: r.sanitized_content_hash,
      original_content_commitment: r.original_content_commitment,
      previous_receipt_hash: r.previous_receipt_hash,
      previous_token_hash: r.previous_token_hash,
      raw_content_seen_by_zeroh_saas: r.raw_content_seen_by_zeroh_saas,
      raw_content_sent_to_ai_provider: r.raw_content_sent_to_ai_provider,
      signing_key_id: r.signing_key_id,
    })),
  };
  return {
    ...bundle,
    bundle_hash: await sha256B64u(canonicalJson(bundle)),
  };
}

function toBundleRecord(input, index) {
  const publicClaims =
    input.receipt?.public_claims ?? input.public_claims ?? input;
  const receipt = input.receipt
    ? {
        receipt_id: input.receipt.receipt_id ?? publicClaims.receipt_id,
        receipt_hash: input.receipt.receipt_hash ?? null,
        public_claims: publicClaims,
        compact: input.receipt.compact ?? input.receipt.signed?.compact ?? null,
        disclosures: input.receipt.disclosures ?? [],
        disclosure_manifest: input.receipt.disclosure_manifest ?? [],
        ...(input.receipt.revealed_under_grant
          ? {
              revealed_under_grant: input.receipt.revealed_under_grant,
              revealed_under_grant_hmac:
                input.receipt.revealed_under_grant_hmac ?? null,
            }
          : {}),
      }
    : {
        receipt_id: publicClaims.receipt_id,
        receipt_hash: input.receipt_hash ?? null,
        public_claims: publicClaims,
        compact: input.compact ?? null,
        disclosures: input.disclosures ?? [],
        disclosure_manifest: input.disclosure_manifest ?? [],
      };
  return {
    turn: input.turn ?? index + 1,
    created_at: input.created_at ?? null,
    sanitized_text: input.sanitized_text ?? null,
    receipt,
    token: input.token ?? null,
  };
}

function count(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
