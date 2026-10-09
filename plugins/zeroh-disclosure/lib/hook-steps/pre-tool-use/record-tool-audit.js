// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

import { writeReceiptJson } from '../../../packages/zeroh-disclosure-core/receipt-sink.js';

function sanitize(value) {
  return String(value)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80);
}

export async function recordToolAudit({
  session,
  toolUseId,
  toolName,
  action,
  policy = null,
  perField = [],
}) {
  await writeReceiptJson(
    path.join(session.dir, `tool-${sanitize(toolUseId)}.json`),
    {
      tool_use_id: toolUseId,
      tool_name: toolName,
      created_at: new Date().toISOString(),
      action,
      policy,
      fields: perField.map((field) => ({
        path: field.path,
        mode: field.mode,
        url_field: field.urlField,
        findings: field.findings.map(
          ({ type, risk, start, end, length, confidence }) => ({
            type,
            risk,
            start,
            end,
            length,
            confidence,
          }),
        ),
        replacements: field.replacements,
      })),
    },
    'pending-ledger',
  );
}
