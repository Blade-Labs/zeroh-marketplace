// SPDX-License-Identifier: AGPL-3.0-only

import {
  formatReceiptSummary,
  receiptSummary,
} from '../../packages/zeroh-disclosure-core/report.js';
import { renderReceiptHtml } from '../../packages/zeroh-disclosure-core/report-html.js';
import { buildSessionTokenMap } from '../../packages/zeroh-disclosure-core/report/render.js';
import { readStyle } from '../statusline.js';

const FORMATS = new Set(['text', 'json', 'html']);

export async function cmdReceipt(args, cwd) {
  const turn = args.turn == null ? null : Number(args.turn);
  if (turn != null && (!Number.isInteger(turn) || turn < 1)) {
    throw new Error('--turn must be a positive integer');
  }
  const summary = await receiptSummary({
    projectRoot: cwd,
    sessionId: args.session || null,
    turn,
  });
  const style = readStyle();
  const format = args.format || style.receiptFormat;
  if (!FORMATS.has(format))
    throw new Error('--format must be text, json, or html');
  if (format === 'json') console.log(JSON.stringify(summary, null, 2));
  else if (format === 'html') {
    console.log(
      renderReceiptHtml({
        summaries: summary.summaries,
        tokenMap: buildSessionTokenMap(summary.summaries),
      }),
    );
  } else {
    console.log(formatReceiptSummary(summary, { verbosity: style.verbosity }));
  }
}
