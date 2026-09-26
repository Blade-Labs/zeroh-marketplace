// SPDX-License-Identifier: AGPL-3.0-only

// Applies the disclosure policy to one text (a prompt, or a turn at Stop):
// detect, mask, sign the receipt and turn the result into a turn ledger.
import path from 'node:path';
import { loadConfig } from './config.js';
import { prepareDisclosure } from './receipt.js';
import { buildReceiptBundle } from './receipt-bundle.js';
import {
  hmacKeyBytes,
  listTurns,
  readJson,
  writeJson,
  writeReceiptBundle,
} from './session.js';

export async function applyDisclosurePolicy({
  text,
  session,
  cwd = process.cwd(),
  boundary = {},
  previousReceiptHash = session?.state?.lastReceiptHash ?? null,
  previousTokenHash = session?.state?.lastTokenHash ?? null,
  proofStage = 'pre_boundary',
  subjectType = 'prompt',
  decisionOverride = null,
  enforce = null,
  findingsOverride = null,
  sanitizedTextOverride = undefined,
  sanitizeResidual = null,
  publicClaimExtras = {},
  selectiveClaimExtras = {},
} = {}) {
  if (!session) throw new Error('session is required');
  await loadConfig({ cwd });
  // The plugin's one policy and its local pattern engine (receipt.js).
  return prepareDisclosure({
    text,
    boundary,
    signer: session.signingKey,
    previousReceiptHash,
    previousTokenHash,
    hmacKeyBytes: hmacKeyBytes(session),
    proofStage,
    subjectType,
    decisionOverride,
    enforce,
    findingsOverride,
    sanitizedTextOverride,
    sanitizeResidual,
    publicClaimExtras,
    selectiveClaimExtras,
  });
}

export function ledgerFromDisclosureResult({
  turn,
  phase,
  result,
  referencedTokens = [],
}) {
  const publicClaims = result.receipt.public_claims;
  return {
    turn,
    phase,
    created_at: new Date().toISOString(),
    proof_stage: publicClaims.proof_stage,
    policy_id: publicClaims.policy_id,
    policy_alias: publicClaims.policy_alias,
    protection_engine_id: publicClaims.protection_engine_id,
    protection_engine_resolution: publicClaims.protection_engine_resolution,
    findings: result.findings,
    sanitized_text: result.sanitized_text,
    replacements: result.replacements ?? [],
    masked_categories: publicClaims.masked_categories,
    referenced_tokens: referencedTokens,
    receipt: serializeReceipt(result),
    token: result.token,
  };
}

export function serializeReceipt(result) {
  const receipt = result.receipt;
  return {
    receipt_id: receipt.receipt_id,
    receipt_hash: receipt.receipt_hash,
    public_claims: receipt.public_claims,
    compact: receipt.signed.compact,
    disclosures: receipt.signed.disclosures,
    disclosure_manifest: receipt.disclosure_manifest,
    // The local unmask extension, when the hook initialised one. The signed
    // claims say it is required, so dropping it would fail verification.
    ...(receipt.revealed_under_grant !== undefined ||
    receipt.revealed_under_grant_hmac !== undefined
      ? {
          revealed_under_grant: receipt.revealed_under_grant,
          revealed_under_grant_hmac: receipt.revealed_under_grant_hmac,
        }
      : {}),
  };
}

export async function markDisclosureResultCommitted({ session, result }) {
  session.state.lastReceiptHash = result.receipt.receipt_hash;
  session.state.lastTokenHash = result.token.token_hash;
  session.state.updated_at = new Date().toISOString();
  await writeJson(session.statePath, session.state);
}

export async function buildSessionReceiptBundle({ session }) {
  const turns = await listTurns({ dir: session.dir });
  const receipts = [];
  let lastTurn = null;
  for (const t of turns) {
    const ledger = await readJson(path.join(session.dir, `turn-${t}.json`));
    if (ledger?.receipt?.public_claims) {
      receipts.push(ledger);
      lastTurn = t;
    }
  }
  if (receipts.length === 0) return null;
  const bundle = await buildReceiptBundle(receipts, {
    session: session.state.sid || 'default',
  });
  const bundlePath = await writeReceiptBundle({ dir: session.dir, bundle });
  return {
    path: bundlePath,
    bundle,
    receipts_count: receipts.length,
    last_turn: lastTurn,
  };
}
