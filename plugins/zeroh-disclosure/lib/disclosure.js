import path from 'node:path';
import { loadConfig } from './config.js';
import { prepareDisclosure } from './receipt.js';
import { buildProofPack } from './proofpack.js';
import { anchorIntentToHederaMessage } from './anchor.js';
import { isAnchorEnabled, submitToHcs } from './hedera-anchor.js';
import { isEvmAnchorEnabled, submitEvmAnchor } from './evm-anchor.js';
import { hmacKeyBytes, listTurns, readJson, writeJson, writeProofPack } from './session.js';
import { resolveActivePolicy } from './policy-registry.js';
import { resolveProtectionEngine, getProtectionEngine } from './protection-engines/index.js';

export async function applyDisclosurePolicy({
  text,
  session,
  cwd = process.cwd(),
  policyAlias = null,
  engineId = null,
  policyMode = null,
  boundary = {},
  previousReceiptHash = session?.state?.lastReceiptHash ?? null,
  previousTokenHash = session?.state?.lastTokenHash ?? null,
  intentBinding = null,
  proofStage = 'pre_boundary',
  anchor = true,
} = {}) {
  if (!session) throw new Error('session is required');
  await loadConfig({ cwd });
  const { policy, alias } = await resolveActivePolicy({ cwd, sessionState: session.state, explicit: policyAlias });
  const engineContext = await resolveProtectionEngine({ policy, requestedEngineId: engineId, boundary, mode: policyMode });
  const result = await prepareDisclosure({
    text,
    boundary,
    wallet: session.wallet,
    policy,
    policyAlias: alias,
    previousReceiptHash,
    previousTokenHash,
    hmacKeyBytes: hmacKeyBytes(session.state),
    intentBinding,
    proofStage,
    protectionEngine: engineContext.engine,
    protectionEngineManifest: engineContext.manifest,
    protectionEngineResolution: engineContext.resolution,
  });
  let anchorResult = { anchored: false, type: 'none', reason: anchor ? 'no anchor configured' : 'anchor skipped by caller' };
  if (anchor) anchorResult = await submitAnchor(result);
  return {
    ...result,
    policy,
    policy_alias: alias,
    protection_engine: {
      id: engineContext.engine.id,
      manifest: engineContext.manifest,
      hash: engineContext.hash,
      resolution: engineContext.resolution,
    },
    anchor: anchorResult,
  };
}

export async function submitAnchor(result) {
  let anchor = { anchored: false, type: 'none', reason: 'no anchor configured' };
  let hcsAttempt = null;
  if (isAnchorEnabled()) {
    try {
      const hcs = await submitToHcs(anchorIntentToHederaMessage(result.anchor_intent));
      hcsAttempt = { ...hcs, type: 'hcs' };
      if (hcs.anchored) anchor = hcsAttempt;
    } catch (e) {
      hcsAttempt = {
        anchored: false,
        type: 'hcs',
        error: String(e?.message ?? e),
        stage: e?.zeroh_hcs_stage ?? 'unknown',
        duration_ms: e?.duration_ms ?? null,
        timeout_config: e?.timeout_config ?? null,
      };
    }
  }
  if (!anchor.anchored && isEvmAnchorEnabled()) {
    const evm = await submitEvmAnchor(result.receipt.receipt_hash);
    if (evm.anchored) {
      anchor = hcsAttempt ? { ...evm, hcs_attempt: hcsAttempt } : evm;
    } else if (hcsAttempt) {
      anchor = { anchored: false, type: 'none', hcs_attempt: hcsAttempt, evm_attempt: evm };
    } else {
      anchor = evm;
    }
  } else if (hcsAttempt && !anchor.anchored) {
    anchor = hcsAttempt;
  }
  return anchor;
}

export function ledgerFromDisclosureResult({ turn, phase, result, originalText = null, referencedTokens = [] }) {
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
    anchor_intent: result.anchor_intent,
    anchor: result.anchor,
    local_private: originalText == null ? undefined : {
      original_text: originalText,
      note: 'Local-only. Receipt commits to a hash; raw text is dropped at Stop finalization.',
    },
  };
}

export function serializeReceipt(result) {
  return {
    receipt_id: result.receipt.receipt_id,
    receipt_hash: result.receipt.receipt_hash,
    public_claims: result.receipt.public_claims,
    compact_sdjwt: result.receipt.sdjwt.compact,
    disclosure_manifest: result.receipt.disclosure_manifest,
    presentations: result.receipt.presentations,
  };
}

export async function markDisclosureResultCommitted({ session, result }) {
  session.state.lastReceiptHash = result.receipt.receipt_hash;
  session.state.lastTokenHash = result.token.token_hash;
  session.state.updated_at = new Date().toISOString();
  await writeJson(session.statePath, session.state);
}

export async function buildSessionProofPack({ session, audience = 'regulator' }) {
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
  const pack = await buildProofPack(receipts, { audience, period: `session:${session.state.sid || 'default'}` });
  const proofpackPath = await writeProofPack({ dir: session.dir, turn: lastTurn, proofpack: pack });
  return { path: proofpackPath, proofpack: pack, receipts_count: receipts.length, last_turn: lastTurn };
}

export async function protectionEngineStatus({ policy, boundary = {} }) {
  const ids = ['regex-local', 'presidio-http'];
  const rows = [];
  for (const id of ids) {
    const engine = getProtectionEngine(id);
    const health = await engine.health({ policy, boundary });
    rows.push({ id, ...health });
  }
  return rows;
}
