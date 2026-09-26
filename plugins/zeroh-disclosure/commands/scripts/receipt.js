#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:mask-receipt: the session's receipt slip.
import { formatReceiptSummary, receiptSummary } from '../../lib/report.js';
import { commandRoot } from './_helpers.js';

try {
  const summary = await receiptSummary({ projectRoot: commandRoot() });
  console.log(formatReceiptSummary(summary));
} catch (error) {
  if (/no .*receipt|no ZeroH Disclosure sessions/.test(error.message)) {
    console.log(
      'No finalized receipt yet. Receipts are written when a turn ends (Stop hook).',
    );
  } else {
    throw error;
  }
}
