// SPDX-License-Identifier: AGPL-3.0-only

// Builds one signed receipt: the public claims (policy, engine, boundary and
// value commitments) and the selective disclosures that back them.
import { boundaryHash, normalizeBoundary } from './boundary.js';
import {
  evaluateDisclosurePolicy,
  POLICY,
  POLICY_ALIAS,
  policyHash,
} from './policy.js';
import {
  canonicalJson,
  hmacSha256B64u,
  jwkThumbprint,
  randomBytes,
  sha256B64u,
} from './crypto.js';
import { createSignedReceipt } from './selective-disclosure.js';
import { regexLocalProtectionEngine } from './protection-engines/regex-local.js';

export async function prepareDisclosure({
  text,
  boundary: boundaryInput = {},
  signer,
  policy = POLICY,
  policyAlias = POLICY_ALIAS,
  previousReceiptHash = null,
  previousTokenHash = null,
  hmacKeyBytes = null,
  proofStage = 'pre_boundary',
  protectionEngine = regexLocalProtectionEngine,
  protectionEngineManifest = null,
  protectionEngineResolution = null,
  subjectType = 'prompt',
  decisionOverride = null,
  enforce = null,
  findingsOverride = null,
  sanitizedTextOverride = undefined,
  sanitizeResidual = null,
  publicClaimExtras = {},
  selectiveClaimExtras = {},
}) {
  if (!signer) throw new Error('signing key required');
  if (typeof text !== 'string') throw new Error('text must be a string');
  const localHmacKey = hmacKeyBytes ?? randomBytes(32);
  const boundary = normalizeBoundary(boundaryInput);
  const engineManifest =
    protectionEngineManifest ??
    (await protectionEngine.manifest({ policy, boundary }));
  const protection_engine_hash = await sha256B64u(
    canonicalJson(engineManifest),
  );
  const findings =
    findingsOverride ??
    (await protectionEngine.analyze({ text, policy, boundary }));
  // `enforce` lets the caller record what it actually does with the text
  // (stop it, or let the proxy mask it) instead of the policy's suggestion,
  // so the signed decision matches the hook.
  const policyDecision =
    decisionOverride ?? evaluateDisclosurePolicy({ findings, policy });
  const decision = enforce ? enforce(policyDecision, findings) : policyDecision;
  const detector_hash = protection_engine_hash;
  const policy_hash = await policyHash(policy);
  const boundary_hash = await boundaryHash(boundary);
  const original_content_commitment = await hmacSha256B64u(localHmacKey, {
    purpose: 'original_content',
    text,
  });
  let sanitized_text = text,
    replacements = [],
    masked_categories = [];
  if (sanitizedTextOverride !== undefined) {
    sanitized_text = sanitizedTextOverride;
  } else if (
    decision.action === 'mask_and_allow' ||
    (decision.enforced === 'stopped' && decision.mask_categories?.length)
  ) {
    // A stopped prompt keeps the masked copy the user is offered to send
    // instead; nothing in it was sent, so no category counts as masked.
    const masked = await protectionEngine.transform({
      text,
      findings,
      hmacKeyBytes: localHmacKey,
      categoriesToMask: decision.mask_categories,
      policy,
      boundary,
    });
    sanitized_text = masked.sanitized_text;
    replacements = masked.replacements;
    masked_categories =
      decision.action === 'mask_and_allow' ? masked.masked_categories : [];
  }
  if (decision.action === 'block' && decision.enforced !== 'stopped')
    sanitized_text = '';
  // The masked text is stored in the local ledger and inside the signed
  // receipt. Values the engine left in place (a project's known secrets, or
  // categories the policy does not mask) are tokenized here so neither holds
  // them in plain text.
  if (sanitizeResidual && sanitized_text)
    sanitized_text = await sanitizeResidual(sanitized_text);
  const sanitized_content_hash = await sha256B64u(sanitized_text);
  const now = new Date().toISOString();
  const receipt_id = `zrh_${Date.now().toString(36)}_${(await sha256B64u(now + sanitized_content_hash)).slice(0, 12)}`;
  const issuerPublic = await signer.getPublicKey();
  if (!issuerPublic?.jwk) throw new Error('signing key public JWK required');
  const iss = `did:jwk:${await jwkThumbprint(issuerPublic.jwk)}`;
  const publicClaims = {
    schema: 'zeroh-disclosure-receipt/v2',
    subject_type: subjectType,
    iss,
    sub: iss,
    vct: 'https://zeroh.io/vct/disclosure-receipt/v1',
    receipt_id,
    iat: now,
    policy_id: policy.policy_id,
    policy_alias: policyAlias,
    policy_hash,
    proof_stage: proofStage,
    detector_hash,
    protection_engine_id: engineManifest.id ?? protectionEngine.id,
    protection_engine_hash,
    protection_engine_manifest: engineManifest,
    protection_engine_resolution: protectionEngineResolution ?? {
      requested_engine_id: protectionEngine.id,
      selected_engine_id: protectionEngine.id,
      status: 'selected',
      fallback: false,
      fallback_mode: 'n/a',
      reason: null,
    },
    boundary_hash,
    decision_action: decision.action,
    detected_categories: [
      ...new Set([
        ...findings.map((f) => f.type),
        ...(decision.extra_categories ?? []),
      ]),
    ],
    masked_categories,
    sanitized_content_hash,
    original_content_commitment,
    previous_receipt_hash: previousReceiptHash,
    previous_token_hash: previousTokenHash,
    raw_content_seen_by_zeroh_saas: false,
    raw_content_sent_to_ai_provider: false,
    sanitized_content_may_be_sent_to_ai_provider: decision.action !== 'block',
    signing_key_id: signer.keyId,
    issuer_public_jwk: issuerPublic.jwk,
    ...publicClaimExtras,
  };
  const selectiveClaims = {
    boundary_details: boundary,
    detector_manifest: engineManifest,
    protection_engine_manifest: engineManifest,
    decision_details: decision,
    transformation_manifest: replacements.map((r) => ({
      entity_type: r.entity_type,
      source_entity_type: r.source_entity_type ?? null,
      risk: r.risk,
      start: r.start,
      end: r.end,
      original_length: r.original_length,
      replacement: r.replacement,
      value_commitment: r.value_commitment,
    })),
    masked_prompt: sanitized_text,
    ...selectiveClaimExtras,
  };
  const signed = await createSignedReceipt({
    signer,
    publicClaims,
    selectiveClaims,
  });
  const receipt_hash = await sha256B64u(signed.compact);
  const token = await buildDisclosureToken({
    signer,
    receipt_hash,
    receipt_id,
    boundary_hash,
    policy_hash,
    previousTokenHash,
  });
  return {
    decision,
    findings: findings.map(
      ({ type, source_entity_type, risk, start, end, length, confidence }) => ({
        type,
        source_entity_type,
        risk,
        start,
        end,
        length,
        confidence,
      }),
    ),
    sanitized_text,
    replacements,
    masked_categories,
    receipt: {
      receipt_id,
      receipt_hash,
      signed,
      public_claims: publicClaims,
      disclosure_manifest: signed.disclosure_manifest,
    },
    token,
    local_private: {
      hmacKeyBytes: localHmacKey,
      note: 'Local-only. Do not upload. Contains key needed to recompute value commitments.',
    },
  };
}

async function buildDisclosureToken({
  signer,
  receipt_hash,
  receipt_id,
  boundary_hash,
  policy_hash,
  previousTokenHash,
}) {
  const payload = {
    typ: 'zeroh-disclosure-token/v1',
    receipt_id,
    receipt_hash,
    boundary_hash,
    policy_hash,
    previous_token_hash: previousTokenHash,
    signing_key_id: signer.keyId,
    iat: new Date().toISOString(),
  };
  const payload_hash = await sha256B64u(canonicalJson(payload));
  const signature = await signer.sign(new TextEncoder().encode(payload_hash));
  const token_hash = await sha256B64u({
    payload_hash,
    signature: Array.from(signature),
  });
  return {
    payload,
    payload_hash,
    signature_b64u: await sha256B64u(signature),
    token_hash,
  };
}
