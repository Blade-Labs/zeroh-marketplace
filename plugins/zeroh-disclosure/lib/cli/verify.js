// SPDX-License-Identifier: AGPL-3.0-only

import {
  verifyReceiptArtifact,
  verifyReceiptBundleArtifact,
} from '../../packages/zeroh-disclosure-core/verify-receipt.js';
import { print } from './shared.js';

export async function cmdVerify(args) {
  if (args.bundle) {
    const result = await verifyReceiptBundleArtifact(args.bundle);
    print(result, args.json, [
      `ok: ${result.ok}`,
      ...failedLine(result),
      `bundle_hash: ${result.bundle_hash}`,
      `receipts_count: ${result.receipts_count}`,
      '',
      ...checkLines(result.checks),
    ]);
    if (!result.ok) process.exit(1);
    return;
  }
  const file = args.receipt || args.file || args._[1];
  if (!file)
    throw new Error('verify requires --receipt <path> or --bundle <path>');
  const result = await verifyReceiptArtifact(file);
  print(result, args.json, [
    `ok: ${result.ok}`,
    ...failedLine(result),
    `receipt_id: ${result.receipt_id}`,
    `policy_id: ${result.policy_id}`,
    `engine: ${result.protection_engine_id}`,
    `decision: ${result.decision_action}`,
    `covers: ${coverageLabel(result.coverage)}`,
    `revealed_under_grant: ${formatRevealCounts(result.revealed_under_grant)}`,
    '',
    ...checkLines(result.checks),
  ]);
  if (!result.ok) process.exit(1);
}

// What a receipt's signature covers (packages/zeroh-disclosure-core/turn-summary.js). A function, so
// it is defined before the command runs.
function coverageLabel(coverage) {
  return (
    {
      turn: 'every number the receipt shows (signed turn summary)',
      pending:
        'the typed prompt so far; the turn summary is signed when the turn ends',
      'typed-prompt': 'the typed prompt only (a receipt from before 1.0.0)',
    }[coverage] ?? coverage
  );
}

// Name every failed check up front, so a failure is readable without
// scanning the full list.
function failedLine(result) {
  return result.failed?.length
    ? [`failed checks: ${result.failed.join(', ')}`]
    : [];
}

function checkLines(checks) {
  return checks.map(
    (c) =>
      `${c.ok ? '✓' : c.status === 'unavailable' ? '?' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`,
  );
}

function formatRevealCounts(entries = []) {
  if (!entries.length) return 'none';
  return entries
    .map(
      ({ kind, grant_id: grantId, tool_outputs: outputs }) =>
        `${kind}:${outputs} (${grantId})`,
    )
    .join(', ');
}
