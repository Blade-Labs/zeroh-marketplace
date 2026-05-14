#!/usr/bin/env node
import { header, latestSession, latestTurn } from './_helpers.js';

const s = await latestSession();
const t = await latestTurn(s.dir);
if (!t || !t.ledger.receipt) {
  console.log('No finalized receipt yet. Receipts are written when a turn ends (Stop hook).');
  process.exit(0);
}
const r = t.ledger.receipt;
console.log(header(`Receipt ${r.receipt_id}`));
console.log(`receipt_hash:           ${r.receipt_hash}`);
console.log(`policy_id:              ${r.public_claims.policy_id}`);
console.log(`policy_hash:            ${r.public_claims.policy_hash}`);
console.log(`detector_hash:          ${r.public_claims.detector_hash}`);
console.log(`boundary_hash:          ${r.public_claims.boundary_hash}`);
console.log(`decision_action:        ${r.public_claims.decision_action}`);
console.log(`detected_categories:    ${(r.public_claims.detected_categories || []).join(', ') || '-'}`);
console.log(`masked_categories:      ${(r.public_claims.masked_categories || []).join(', ') || '-'}`);
console.log(`sanitized_content_hash: ${r.public_claims.sanitized_content_hash}`);
console.log(`iss:                    ${r.public_claims.iss}`);
console.log(`sub:                    ${r.public_claims.sub}`);
console.log(`\nSD-JWT compact:\n${r.compact_sdjwt}`);
console.log('\nPresentations available: regulator, ciso, user (use /mask-proofpack for the full export).');
