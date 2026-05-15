import { boundaryHash, normalizeBoundary } from './boundary.js';
import { evaluateDisclosurePolicy, policyHash } from './policy.js';
import { canonicalJson, hmacSha256B64u, randomBytes, sha256B64u } from './crypto.js';
import { createReceiptJwtLike, createPresentation } from './sdjwt.js';
import { qcbAiDisclosurePolicyV1 } from './policies/qcb-ai-disclosure.v1.js';
import { regexLocalProtectionEngine } from './protection-engines/regex-local.js';

export async function prepareDisclosure({
  text,
  boundary: boundaryInput = {},
  wallet,
  policy = qcbAiDisclosurePolicyV1,
  policyAlias = policy.aliases?.[0] ?? policy.policy_id,
  previousReceiptHash = null,
  previousTokenHash = null,
  hmacKeyBytes = null,
  intentBinding = null,
  proofStage = 'pre_boundary',
  protectionEngine = regexLocalProtectionEngine,
  protectionEngineManifest = null,
  protectionEngineResolution = null,
  subjectType = 'prompt',
  decisionOverride = null,
  findingsOverride = null,
  sanitizedTextOverride = undefined,
  publicClaimExtras = {},
  selectiveClaimExtras = {},
}) {
  if (!wallet) throw new Error('wallet adapter required');
  if (typeof text !== 'string') throw new Error('text must be a string');
  const localHmacKey = hmacKeyBytes ?? randomBytes(32);
  // intentBinding is hashed inside the boundary (so anchored evidence binds
  // to it) and surfaced in public_claims so verifiers don't have to parse the
  // boundary digest to know the mandate id.
  const boundary = normalizeBoundary({ ...boundaryInput, ...(intentBinding ? { intent_binding: intentBinding } : {}) });
  const engineManifest = protectionEngineManifest ?? (await protectionEngine.manifest({ policy, boundary }));
  const protection_engine_hash = await sha256B64u(canonicalJson(engineManifest));
  const findings = findingsOverride ?? await protectionEngine.analyze({ text, policy, boundary });
  const decision = decisionOverride ?? evaluateDisclosurePolicy({ findings, boundary, policy });
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
  } else if (decision.action === 'mask_and_allow' || decision.action === 'approval_required') {
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
    masked_categories = masked.masked_categories;
  }
  if (decision.action === 'block') sanitized_text = '';
  const sanitized_content_hash = await sha256B64u(sanitized_text);
  const account = await wallet.getAccount();
  const now = new Date().toISOString();
  const receipt_id = `zrh_${Date.now().toString(36)}_${(await sha256B64u(now + sanitized_content_hash)).slice(0, 12)}`;
  // VI wallets provide their own `did` (did:jwk:<thumbprint>) so receipts
  // signed under a mandate carry the same identifier the merchant uses to
  // verify the forward L3 chain — one key, one DID, two directions of proof.
  const iss = account.did ?? `did:hedera:${account.network}:${account.accountId}`;
  const issuerPublic = await wallet.getPublicKey?.();
  const publicClaims = {
    schema: 'zeroh-disclosure-receipt/v2',
    subject_type: subjectType,
    iss,
    sub: `wallet:${account.accountId}`,
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
    detected_categories: [...new Set(findings.map((f) => f.type))],
    masked_categories,
    sanitized_content_hash,
    original_content_commitment,
    previous_receipt_hash: previousReceiptHash,
    previous_token_hash: previousTokenHash,
    raw_content_seen_by_zeroh_saas: false,
    raw_content_sent_to_ai_provider: false,
    sanitized_content_may_be_sent_to_ai_provider: decision.action !== 'block',
    wallet_account_id: account.accountId,
    wallet_network: account.network,
    issuer_public_jwk: issuerPublic?.jwk ?? null,
    ...(intentBinding ? { intent_binding: intentBinding } : {}),
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
  const sdjwt = await createReceiptJwtLike({ wallet, publicClaims, selectiveClaims });
  const receipt_hash = await sha256B64u(sdjwt.compact);
  const token = await buildDisclosureToken({ wallet, receipt_hash, receipt_id, boundary_hash, policy_hash, previousTokenHash });
  return {
    decision,
    findings: findings.map(({ type, source_entity_type, risk, start, end, length, confidence }) => ({
      type, source_entity_type, risk, start, end, length, confidence,
    })),
    sanitized_text,
    replacements,
    masked_categories,
    receipt: {
      receipt_id,
      receipt_hash,
      sdjwt,
      public_claims: publicClaims,
      disclosure_manifest: sdjwt.disclosure_manifest,
      presentations: {
        regulator: createPresentation(sdjwt, ['boundary_details', 'decision_details', 'protection_engine_manifest', 'transformation_manifest']),
        ciso: createPresentation(sdjwt, ['boundary_details', 'decision_details', 'transformation_manifest']),
        user: createPresentation(sdjwt, ['masked_prompt', 'decision_details']),
      },
    },
    token,
    anchor_intent: buildAnchorIntent({
      receipt_hash,
      token_hash: token.token_hash,
      policy_hash,
      policy_alias: policyAlias,
      detector_hash,
      protection_engine_hash,
      boundary_hash,
      proof_stage: proofStage,
      account,
    }),
    local_private: {
      hmacKeyBytes: localHmacKey,
      note: 'Local-only. Do not upload. Contains key needed to recompute value commitments.',
    },
  };
}

async function buildDisclosureToken({ wallet, receipt_hash, receipt_id, boundary_hash, policy_hash, previousTokenHash }) {
  const account = await wallet.getAccount();
  const payload = {
    typ: 'zeroh-disclosure-token/v1',
    receipt_id,
    receipt_hash,
    boundary_hash,
    policy_hash,
    previous_token_hash: previousTokenHash,
    wallet_account_id: account.accountId,
    wallet_network: account.network,
    iat: new Date().toISOString(),
  };
  const payload_hash = await sha256B64u(canonicalJson(payload));
  const signature = await wallet.signMessage(new TextEncoder().encode(payload_hash), {
    purpose: 'zeroh_disclosure_token',
    receipt_id,
  });
  const token_hash = await sha256B64u({ payload_hash, signature: Array.from(signature) });
  return { payload, payload_hash, signature_b64u: await sha256B64u(signature), token_hash };
}

function buildAnchorIntent({ receipt_hash, token_hash, policy_hash, policy_alias, detector_hash, protection_engine_hash, boundary_hash, proof_stage, account }) {
  return {
    type: 'hedera_hcs_topic_message_submit_intent',
    custody: 'customer_wallet_signs_and_submits',
    network: account.network,
    topic_id: process.env.HEDERA_TOPIC_ID || 'SET_TOPIC_ID_IN_PRODUCTION',
    message: {
      schema: 'zeroh-anchor/v2',
      receipt_hash,
      token_hash,
      policy_hash,
      policy_alias,
      detector_hash,
      protection_engine_hash,
      boundary_hash,
      proof_stage,
      raw_content_included: false,
      raw_content_seen_by_zeroh_saas: false,
      wallet_account_id: account.accountId,
      wallet_network: account.network,
      created_at: new Date().toISOString(),
    },
  };
}
