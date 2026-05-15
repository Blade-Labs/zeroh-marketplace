import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256B64u } from './crypto.js';
import { decodeCompactReceipt, verifyCompactReceiptSignature, verifyPresentationDigests } from './sdjwt.js';
import { resolvePolicy } from './policy-registry.js';
import { policyHash } from './policy.js';
import { boundaryHash } from './boundary.js';
import { verifyAnchorEvidence } from './anchor-verify.js';

export async function loadReceiptArtifact(file) {
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const receipt = raw.receipt ?? raw;
  const compact = receipt.compact_sdjwt ?? receipt.sdjwt?.compact ?? raw.compact_sdjwt;
  if (!compact) throw new Error(`No compact receipt found in ${file}`);
  return {
    file,
    raw,
    receipt,
    compact,
    sanitized_text: raw.sanitized_text ?? receipt.sanitized_text ?? null,
    anchor: raw.anchor ?? receipt.anchor ?? null,
    token: raw.token ?? receipt.token ?? null,
  };
}

export async function verifyReceiptArtifact(file) {
  const artifact = await loadReceiptArtifact(file);
  return verifyReceiptArtifactObject(artifact, { verifySessionChain: true });
}

export async function verifyReceiptArtifactObject(artifact, { verifySessionChain = false } = {}) {
  const decoded = decodeCompactReceipt(artifact.compact);
  const claims = decoded.payload;
  const storedClaims = artifact.receipt.public_claims ?? null;
  const checks = [];

  const sig = await verifyCompactReceiptSignature(artifact.compact, claims.issuer_public_jwk);
  checks.push(check('signature', sig.ok, sig.reason));

  checks.push(check('schema_v2', claims.schema === 'zeroh-disclosure-receipt/v2', `got ${claims.schema || 'missing'}`));
  checks.push(check('public_claims_match_compact', storedClaimsMatchCompact(storedClaims, claims), 'stored public_claims differ from compact signed payload'));

  const computedReceiptHash = await sha256B64u(artifact.compact);
  const recordedReceiptHash = artifact.receipt.receipt_hash ?? computedReceiptHash;
  checks.push(check('receipt_hash', recordedReceiptHash === computedReceiptHash, `expected ${computedReceiptHash}, got ${recordedReceiptHash}`));

  try {
    const { policy } = resolvePolicy(claims.policy_id);
    const expected = await policyHash(policy);
    checks.push(check('policy_hash', expected === claims.policy_hash, `expected ${expected}, got ${claims.policy_hash}`));
  } catch (e) {
    checks.push(check('policy_hash', false, e.message));
  }

  if (claims.protection_engine_manifest) {
    const expected = await sha256B64u(canonicalJson(claims.protection_engine_manifest));
    checks.push(check('protection_engine_hash', expected === claims.protection_engine_hash, `expected ${expected}, got ${claims.protection_engine_hash}`));
    if (claims.detector_hash) {
      checks.push(check('detector_hash_alias', claims.detector_hash === claims.protection_engine_hash, 'detector_hash should alias protection_engine_hash'));
    }
  } else {
    checks.push(check('protection_engine_manifest', false, 'missing manifest'));
  }

  const boundaryDetails = await revealClaim(artifact, 'boundary_details');
  if (boundaryDetails != null) {
    const expected = await boundaryHash(boundaryDetails);
    checks.push(check('boundary_hash', expected === claims.boundary_hash, `expected ${expected}, got ${claims.boundary_hash}`));
  }

  const sanitizedText = artifact.sanitized_text ?? await revealClaim(artifact, 'masked_prompt');
  if (sanitizedText != null) {
    const expected = await sha256B64u(sanitizedText);
    checks.push(check('sanitized_content_hash', expected === claims.sanitized_content_hash, `expected ${expected}, got ${claims.sanitized_content_hash}`));
  } else {
    checks.push(check('sanitized_content_hash', true));
  }

  checks.push(check('raw_not_sent_to_ai_provider', claims.raw_content_sent_to_ai_provider === false, `got ${claims.raw_content_sent_to_ai_provider}`));
  checks.push(check('raw_not_seen_by_zeroh_saas', claims.raw_content_seen_by_zeroh_saas === false, `got ${claims.raw_content_seen_by_zeroh_saas}`));

  if (verifySessionChain) {
    const chainChecks = await verifySessionChainLinks(artifact, claims);
    checks.push(...chainChecks);
  }

  const anchorStatus = await verifyAnchorEvidence(artifact.anchor, {
    receiptHash: computedReceiptHash,
    tokenHash: artifact.token?.token_hash ?? null,
  });
  checks.push(check('anchor_evidence', anchorStatus.ok, anchorStatus.detail));

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    file: artifact.file ? path.resolve(artifact.file) : null,
    receipt_id: claims.receipt_id,
    receipt_hash: computedReceiptHash,
    policy_id: claims.policy_id,
    protection_engine_id: claims.protection_engine_id,
    decision_action: claims.decision_action,
    anchor: anchorStatus,
    checks,
  };
}

export async function verifyProofPackArtifact(file) {
  const pack = JSON.parse(await fs.readFile(file, 'utf8'));
  const checks = [];
  checks.push(check('schema', pack.schema === 'zeroh-proofpack/v1', `got ${pack.schema || 'missing'}`));
  const recordedHash = pack.proofpack_hash;
  const unsigned = { ...pack };
  delete unsigned.proofpack_hash;
  const expectedHash = await sha256B64u(canonicalJson(unsigned));
  checks.push(check('proofpack_hash', recordedHash === expectedHash, `expected ${expectedHash}, got ${recordedHash}`));

  const receiptRecords = Array.isArray(pack.receipts) ? pack.receipts : [];
  checks.push(check('receipts_present', receiptRecords.length > 0, 'proofpack has no verifiable receipts array'));
  checks.push(check('receipts_count', pack.summary?.receipts_count === receiptRecords.length, `expected ${receiptRecords.length}, got ${pack.summary?.receipts_count}`));

  const receipts = [];
  for (let i = 0; i < receiptRecords.length; i++) {
    const record = receiptRecords[i];
    const result = await verifyReceiptArtifactObject(receiptRecordToArtifact(record, `${file}#receipt-${i + 1}`), { verifySessionChain: false });
    receipts.push(result);
    checks.push(check(`receipt_${i + 1}_verifies`, result.ok, firstFailedCheck(result)));
  }

  checks.push(...verifyProofPackChain(receiptRecords));
  const ok = checks.every((c) => c.ok);
  return {
    ok,
    file: path.resolve(file),
    proofpack_hash: expectedHash,
    receipts_count: receiptRecords.length,
    checks,
    receipts: receipts.map((r) => ({
      ok: r.ok,
      receipt_id: r.receipt_id,
      receipt_hash: r.receipt_hash,
      policy_id: r.policy_id,
      protection_engine_id: r.protection_engine_id,
      anchor: r.anchor,
    })),
  };
}

function check(name, ok, detail = null) {
  return { name, ok: !!ok, detail: ok ? null : detail };
}

function storedClaimsMatchCompact(storedClaims, compactClaims) {
  if (!storedClaims) return true;
  for (const [key, value] of Object.entries(storedClaims)) {
    if (canonicalJson(value) !== canonicalJson(compactClaims[key])) return false;
  }
  return true;
}

async function revealClaim(artifact, name) {
  const presentations = artifact.receipt.presentations ?? {};
  for (const presentation of Object.values(presentations).filter(Boolean)) {
    const verified = await verifyPresentationDigests(presentation);
    if (!verified.ok) continue;
    const found = verified.revealed.find((r) => r.name === name);
    if (found) return found.value;
  }
  return null;
}

async function verifySessionChainLinks(artifact, claims) {
  const checks = [];
  const info = turnFileInfo(artifact.file);
  if (!info) return checks;
  if (info.turn === 1) {
    checks.push(check('token_chain_root_receipt', claims.previous_receipt_hash == null, `got ${claims.previous_receipt_hash}`));
    checks.push(check('token_chain_root_token', claims.previous_token_hash == null, `got ${claims.previous_token_hash}`));
    return checks;
  }
  const previous = await loadReceiptArtifact(info.previousPath).catch(() => null);
  if (!previous) {
    const hasPrevious = claims.previous_receipt_hash || claims.previous_token_hash;
    if (hasPrevious) checks.push(check('token_chain_previous_available', false, `missing ${info.previousPath}`));
    return checks;
  }
  const previousReceiptHash = previous.receipt.receipt_hash ?? await sha256B64u(previous.compact);
  const previousTokenHash = previous.token?.token_hash ?? null;
  checks.push(check('token_chain_previous_receipt', claims.previous_receipt_hash === previousReceiptHash, `expected ${previousReceiptHash}, got ${claims.previous_receipt_hash}`));
  checks.push(check('token_chain_previous_token', claims.previous_token_hash === previousTokenHash, `expected ${previousTokenHash}, got ${claims.previous_token_hash}`));
  return checks;
}

function verifyProofPackChain(records) {
  const checks = [];
  for (let i = 1; i < records.length; i++) {
    const previous = records[i - 1];
    const current = records[i];
    const currentClaims = current.receipt?.public_claims ?? {};
    const previousReceiptHash = previous.receipt?.receipt_hash ?? null;
    const previousTokenHash = previous.token?.token_hash ?? null;
    checks.push(check(`chain_${i}_previous_receipt`, currentClaims.previous_receipt_hash === previousReceiptHash, `expected ${previousReceiptHash}, got ${currentClaims.previous_receipt_hash}`));
    checks.push(check(`chain_${i}_previous_token`, currentClaims.previous_token_hash === previousTokenHash, `expected ${previousTokenHash}, got ${currentClaims.previous_token_hash}`));
  }
  return checks;
}

function receiptRecordToArtifact(record, file) {
  const receipt = record.receipt ?? record;
  const compact = receipt.compact_sdjwt ?? receipt.sdjwt?.compact ?? record.compact_sdjwt;
  if (!compact) throw new Error(`No compact receipt found in proofpack record ${file}`);
  return {
    file,
    raw: record,
    receipt,
    compact,
    sanitized_text: record.sanitized_text ?? receipt.sanitized_text ?? null,
    anchor: record.anchor ?? receipt.anchor ?? null,
    token: record.token ?? receipt.token ?? null,
  };
}

function turnFileInfo(file) {
  if (!file) return null;
  const name = path.basename(file);
  const match = name.match(/^turn-(\d+)\.json$/);
  if (!match) return null;
  const turn = Number(match[1]);
  return {
    turn,
    previousPath: path.join(path.dirname(file), `turn-${turn - 1}.json`),
  };
}

function firstFailedCheck(result) {
  const failed = result.checks.find((c) => !c.ok);
  return failed ? `${failed.name}: ${failed.detail || 'failed'}` : null;
}
