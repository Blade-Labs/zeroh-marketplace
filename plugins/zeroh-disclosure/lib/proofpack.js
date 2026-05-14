import { sha256B64u, canonicalJson } from './crypto.js';

export async function buildProofPack(receipts, { audience = 'regulator', period = 'demo' } = {}) {
  const rows = receipts.map((r) => r.receipt?.public_claims ?? r.public_claims ?? r);
  const pack = {
    schema: 'zeroh-proofpack/v1',
    audience,
    period,
    generated_at: new Date().toISOString(),
    summary: {
      receipts_count: rows.length,
      decision_counts: count(rows.map((r) => r.decision_action)),
      detected_categories: count(rows.flatMap((r) => r.detected_categories ?? [])),
      masked_categories: count(rows.flatMap((r) => r.masked_categories ?? [])),
      boundary_hashes: [...new Set(rows.map((r) => r.boundary_hash).filter(Boolean))],
      raw_content_seen_by_zeroh_saas: false,
    },
    evidence_rows: rows.map((r) => ({
      receipt_id: r.receipt_id,
      policy_id: r.policy_id,
      policy_hash: r.policy_hash,
      detector_hash: r.detector_hash,
      boundary_hash: r.boundary_hash,
      decision_action: r.decision_action,
      detected_categories: r.detected_categories,
      masked_categories: r.masked_categories,
      sanitized_content_hash: r.sanitized_content_hash,
      original_content_commitment: r.original_content_commitment,
      raw_content_seen_by_zeroh_saas: r.raw_content_seen_by_zeroh_saas,
      wallet_account_id: r.wallet_account_id,
      wallet_network: r.wallet_network,
    })),
  };
  return { ...pack, proofpack_hash: await sha256B64u(canonicalJson(pack)) };
}

function count(values) {
  const out = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
