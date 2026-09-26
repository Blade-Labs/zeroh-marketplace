// SPDX-License-Identifier: AGPL-3.0-only

// Verifies receipts and receipt bundles: signature, disclosures, policy and
// engine hashes, the session chain and the unmask record.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256B64u } from './crypto.js';
import {
  decodeCompactReceipt,
  RECEIPT_TYP,
  revealDisclosures,
  verifyCompactReceiptSignature,
} from './selective-disclosure.js';
import { RECEIPT_BUNDLE_SCHEMA } from './receipt-bundle.js';
import { policyById, policyHash } from './policy.js';
import { boundaryHash } from './boundary.js';
import { allowKeyPath, signatureFor, signaturesMatch } from './allow-rules.js';
import { REVEAL_EXTENSION_MARKER } from './unmask.js';

export async function loadReceiptArtifact(file) {
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const receipt = raw.receipt ?? raw;
  const compact = receipt.compact ?? receipt.signed?.compact ?? raw.compact;
  if (!compact) throw new Error(`No compact receipt found in ${file}`);
  return {
    file,
    raw,
    receipt,
    compact,
    sanitized_text: raw.sanitized_text ?? receipt.sanitized_text ?? null,
    legacy_anchor_fields: legacyAnchorFields(raw, receipt),
    token: raw.token ?? receipt.token ?? null,
  };
}

export async function verifyReceiptArtifact(file) {
  const artifact = await loadReceiptArtifact(file);
  return verifyReceiptArtifactObject(artifact, { verifySessionChain: true });
}

export async function verifyReceiptArtifactObject(
  artifact,
  { verifySessionChain = false } = {},
) {
  const decoded = decodeCompactReceipt(artifact.compact);
  const claims = decoded.payload;
  const storedClaims = artifact.receipt.public_claims ?? null;
  const checks = [];

  const sig = await verifyCompactReceiptSignature(
    artifact.compact,
    claims.issuer_public_jwk,
  );
  checks.push(check('signature', sig.ok, sig.reason));
  checks.push(
    check(
      'receipt_type',
      decoded.header?.typ === RECEIPT_TYP,
      `expected ${RECEIPT_TYP}, got ${decoded.header?.typ || 'missing'}`,
    ),
  );

  checks.push(
    check(
      'schema_v2',
      claims.schema === 'zeroh-disclosure-receipt/v2',
      `got ${claims.schema || 'missing'}`,
    ),
  );
  checks.push(
    check(
      'public_claims_match_compact',
      storedClaimsMatchCompact(storedClaims, claims),
      'stored public_claims differ from compact signed payload',
    ),
  );

  const computedReceiptHash = await sha256B64u(artifact.compact);
  const recordedReceiptHash =
    artifact.receipt.receipt_hash ?? computedReceiptHash;
  checks.push(
    check(
      'receipt_hash',
      recordedReceiptHash === computedReceiptHash,
      `expected ${computedReceiptHash}, got ${recordedReceiptHash}`,
    ),
  );

  if (artifact.receipt.disclosures?.length) {
    const revealed = await revealDisclosures(
      artifact.compact,
      artifact.receipt.disclosures,
    );
    checks.push(
      check(
        'disclosures_match_receipt',
        revealed.ok,
        `stored disclosure ${revealed.digest} is not signed by the receipt`,
      ),
    );
  }

  const revealExtensionCheck = await verifyRevealExtension(
    artifact.receipt,
    claims.unmask_receipt_extension === REVEAL_EXTENSION_MARKER,
  );
  if (revealExtensionCheck) checks.push(revealExtensionCheck);

  try {
    const policy = policyById(claims.policy_id);
    const expected = await policyHash(policy);
    checks.push(
      check(
        'policy_hash',
        expected === claims.policy_hash,
        `expected ${expected}, got ${claims.policy_hash}`,
      ),
    );
  } catch (e) {
    checks.push(check('policy_hash', false, e.message));
  }

  if (claims.protection_engine_manifest) {
    const expected = await sha256B64u(
      canonicalJson(claims.protection_engine_manifest),
    );
    checks.push(
      check(
        'protection_engine_hash',
        expected === claims.protection_engine_hash,
        `expected ${expected}, got ${claims.protection_engine_hash}`,
      ),
    );
    if (claims.detector_hash) {
      checks.push(
        check(
          'detector_hash_alias',
          claims.detector_hash === claims.protection_engine_hash,
          'detector_hash should alias protection_engine_hash',
        ),
      );
    }
  } else {
    checks.push(check('protection_engine_manifest', false, 'missing manifest'));
  }

  const boundaryDetails = await revealClaim(artifact, 'boundary_details');
  if (boundaryDetails != null) {
    const expected = await boundaryHash(boundaryDetails);
    checks.push(
      check(
        'boundary_hash',
        expected === claims.boundary_hash,
        `expected ${expected}, got ${claims.boundary_hash}`,
      ),
    );
  }

  const sanitizedText =
    artifact.sanitized_text ?? (await revealClaim(artifact, 'masked_prompt'));
  if (sanitizedText != null) {
    const expected = await sha256B64u(sanitizedText);
    checks.push(
      check(
        'sanitized_content_hash',
        expected === claims.sanitized_content_hash,
        `expected ${expected}, got ${claims.sanitized_content_hash}`,
      ),
    );
  } else {
    checks.push(check('sanitized_content_hash', true));
  }

  checks.push(
    check(
      'raw_not_sent_to_ai_provider',
      claims.raw_content_sent_to_ai_provider === false,
      `got ${claims.raw_content_sent_to_ai_provider}`,
    ),
  );
  checks.push(
    check(
      'raw_not_seen_by_zeroh_saas',
      claims.raw_content_seen_by_zeroh_saas === false,
      `got ${claims.raw_content_seen_by_zeroh_saas}`,
    ),
  );

  if (verifySessionChain) {
    const chainChecks = await verifySessionChainLinks(artifact, claims);
    checks.push(...chainChecks);
  }

  if (artifact.legacy_anchor_fields?.length) {
    checks.push({
      name: 'legacy_anchor_fields_ignored',
      ok: true,
      detail: `ignored legacy fields: ${artifact.legacy_anchor_fields.join(', ')}`,
    });
  }

  const ok = checks.every((c) => c.ok);
  return {
    ok,
    failed: failedCheckNames(checks),
    file: artifact.file ? path.resolve(artifact.file) : null,
    receipt_id: claims.receipt_id,
    receipt_hash: computedReceiptHash,
    policy_id: claims.policy_id,
    protection_engine_id: claims.protection_engine_id,
    decision_action: claims.decision_action,
    revealed_under_grant: artifact.receipt.revealed_under_grant ?? [],
    checks,
  };
}

async function verifyRevealExtension(receipt, required) {
  const entries = receipt.revealed_under_grant;
  const hmac = receipt.revealed_under_grant_hmac;
  if (entries === undefined && hmac === undefined) {
    return required
      ? check(
          'revealed_under_grant_hmac',
          false,
          'signed receipt requires its local reveal extension',
        )
      : null;
  }
  if (!Array.isArray(entries) || typeof hmac !== 'string') {
    return check(
      'revealed_under_grant_hmac',
      false,
      'receipt reveal extension is incomplete',
    );
  }
  try {
    const key = await fs.readFile(allowKeyPath());
    const expected = signatureFor(
      {
        version: 1,
        receipt_id: receipt.receipt_id,
        revealed_under_grant: entries,
      },
      key,
    );
    return check(
      'revealed_under_grant_hmac',
      signaturesMatch(hmac, expected),
      'receipt reveal extension failed local HMAC verification',
    );
  } catch (error) {
    return check(
      'revealed_under_grant_hmac',
      false,
      `could not verify local receipt reveal extension: ${error.message}`,
    );
  }
}

export async function verifyReceiptBundleArtifact(file) {
  const bundle = JSON.parse(await fs.readFile(file, 'utf8'));
  const checks = [];
  checks.push(
    check(
      'schema',
      bundle.schema === RECEIPT_BUNDLE_SCHEMA,
      `got ${bundle.schema || 'missing'}`,
    ),
  );
  const recordedHash = bundle.bundle_hash;
  const unsigned = { ...bundle };
  delete unsigned.bundle_hash;
  const expectedHash = await sha256B64u(canonicalJson(unsigned));
  checks.push(
    check(
      'bundle_hash',
      recordedHash === expectedHash,
      `expected ${expectedHash}, got ${recordedHash}`,
    ),
  );

  const receiptRecords = Array.isArray(bundle.receipts) ? bundle.receipts : [];
  checks.push(
    check(
      'receipts_present',
      receiptRecords.length > 0,
      'bundle has no verifiable receipts array',
    ),
  );
  checks.push(
    check(
      'receipts_count',
      bundle.summary?.receipts_count === receiptRecords.length,
      `expected ${receiptRecords.length}, got ${bundle.summary?.receipts_count}`,
    ),
  );

  const receipts = [];
  for (let i = 0; i < receiptRecords.length; i++) {
    const record = receiptRecords[i];
    const result = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(record, `${file}#receipt-${i + 1}`),
      { verifySessionChain: false },
    );
    receipts.push(result);
    checks.push(
      check(`receipt_${i + 1}_verifies`, result.ok, firstFailedCheck(result)),
    );
  }

  checks.push(...verifyBundleChain(receiptRecords));
  const ok = checks.every((c) => c.ok);
  return {
    ok,
    failed: failedCheckNames(checks),
    file: path.resolve(file),
    bundle_hash: expectedHash,
    receipts_count: receiptRecords.length,
    checks,
    receipts: receipts.map((r) => ({
      ok: r.ok,
      receipt_id: r.receipt_id,
      receipt_hash: r.receipt_hash,
      policy_id: r.policy_id,
      protection_engine_id: r.protection_engine_id,
    })),
  };
}

function check(name, ok, detail = null) {
  return { name, ok: !!ok, detail: ok ? null : detail };
}

function failedCheckNames(checks) {
  return checks.filter((c) => !c.ok).map((c) => c.name);
}

function storedClaimsMatchCompact(storedClaims, compactClaims) {
  if (!storedClaims) return true;
  for (const [key, value] of Object.entries(storedClaims)) {
    if (canonicalJson(value) !== canonicalJson(compactClaims[key]))
      return false;
  }
  return true;
}

async function revealClaim(artifact, name) {
  const disclosures = artifact.receipt.disclosures ?? [];
  if (!disclosures.length) return null;
  const revealed = await revealDisclosures(artifact.compact, disclosures);
  if (!revealed.ok) return null;
  return revealed.revealed.find((r) => r.name === name)?.value ?? null;
}

async function verifySessionChainLinks(artifact, claims) {
  const checks = [];
  const info = turnFileInfo(artifact.file);
  if (!info) return checks;
  if (info.turn === 1) {
    checks.push(
      check(
        'token_chain_root_receipt',
        claims.previous_receipt_hash == null,
        `got ${claims.previous_receipt_hash}`,
      ),
    );
    checks.push(
      check(
        'token_chain_root_token',
        claims.previous_token_hash == null,
        `got ${claims.previous_token_hash}`,
      ),
    );
    return checks;
  }
  const previous = await loadReceiptArtifact(info.previousPath).catch(
    () => null,
  );
  if (!previous) {
    const hasPrevious =
      claims.previous_receipt_hash || claims.previous_token_hash;
    if (hasPrevious)
      checks.push(
        check(
          'token_chain_previous_available',
          false,
          `missing ${info.previousPath}`,
        ),
      );
    return checks;
  }
  const previousReceiptHash =
    previous.receipt.receipt_hash ?? (await sha256B64u(previous.compact));
  const previousTokenHash = previous.token?.token_hash ?? null;
  checks.push(
    check(
      'token_chain_previous_receipt',
      claims.previous_receipt_hash === previousReceiptHash,
      `expected ${previousReceiptHash}, got ${claims.previous_receipt_hash}`,
    ),
  );
  checks.push(
    check(
      'token_chain_previous_token',
      claims.previous_token_hash === previousTokenHash,
      `expected ${previousTokenHash}, got ${claims.previous_token_hash}`,
    ),
  );
  return checks;
}

function verifyBundleChain(records) {
  const checks = [];
  for (let i = 1; i < records.length; i++) {
    const previous = records[i - 1];
    const current = records[i];
    const currentClaims = current.receipt?.public_claims ?? {};
    const previousReceiptHash = previous.receipt?.receipt_hash ?? null;
    const previousTokenHash = previous.token?.token_hash ?? null;
    checks.push(
      check(
        `chain_${i}_previous_receipt`,
        currentClaims.previous_receipt_hash === previousReceiptHash,
        `expected ${previousReceiptHash}, got ${currentClaims.previous_receipt_hash}`,
      ),
    );
    checks.push(
      check(
        `chain_${i}_previous_token`,
        currentClaims.previous_token_hash === previousTokenHash,
        `expected ${previousTokenHash}, got ${currentClaims.previous_token_hash}`,
      ),
    );
  }
  return checks;
}

export function receiptRecordToArtifact(record, file) {
  const receipt = record.receipt ?? record;
  const compact = receipt.compact ?? receipt.signed?.compact ?? record.compact;
  if (!compact)
    throw new Error(`No compact receipt found in bundle record ${file}`);
  return {
    file,
    raw: record,
    receipt,
    compact,
    sanitized_text: record.sanitized_text ?? receipt.sanitized_text ?? null,
    legacy_anchor_fields: legacyAnchorFields(record, receipt),
    token: record.token ?? receipt.token ?? null,
  };
}

function legacyAnchorFields(record, receipt) {
  const fields = [];
  if (record?.anchor !== undefined || receipt?.anchor !== undefined)
    fields.push('anchor');
  if (
    record?.anchor_intent !== undefined ||
    receipt?.anchor_intent !== undefined
  )
    fields.push('anchor_intent');
  return fields;
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

export function firstFailedCheck(result) {
  const failed = result.checks.find((c) => !c.ok);
  return failed ? `${failed.name}: ${failed.detail || 'failed'}` : null;
}
