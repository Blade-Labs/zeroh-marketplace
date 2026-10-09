// SPDX-License-Identifier: AGPL-3.0-only

// Normalize a receipt record once, whether it came from disk or a snapshot.
import { readFile } from 'node:fs/promises';

export async function loadReceiptArtifact(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  return receiptRecordToArtifact(raw, file, '');
}

export function receiptRecordToArtifact(
  record,
  file,
  source = 'bundle record ',
) {
  const receipt = record.receipt ?? record;
  const compact = receipt.compact ?? receipt.signed?.compact ?? record.compact;
  if (!compact) throw new Error(`No compact receipt found in ${source}${file}`);
  return {
    file,
    raw: record,
    receipt,
    compact,
    ['sanitized_text']: record.sanitized_text ?? receipt.sanitized_text ?? null,
    ['legacy_anchor_fields']: legacyAnchorFields(record, receipt),
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
