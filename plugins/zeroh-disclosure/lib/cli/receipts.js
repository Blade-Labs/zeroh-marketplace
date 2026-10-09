// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { zerohHome } from '../../packages/zeroh-disclosure-core/vault.js';
import { authorized, print } from './shared.js';

export async function cmdReceipts(args) {
  const { RECEIPT_RETENTION, retentionLine, validRetention } =
    await import('../../packages/zeroh-disclosure-core/receipt-retention.js');
  const action = args._[1];
  if (!action) {
    print(
      { retention: process.env.ZEROH_RECEIPT_RETENTION || '90d' },
      args.json,
      [retentionLine()],
    );
    return;
  }
  const value = validRetention(args._[2]);
  if (action !== 'keep' || !value) {
    throw new Error(
      `receipts keep needs one of ${Object.keys(RECEIPT_RETENTION).join(', ')}`,
    );
  }
  if (!(await authorized())) return;
  const file = path.join(zerohHome(), 'config.env');
  const { readFileSync: read, existsSync: exists } = await import('node:fs');
  const lines = exists(file)
    ? read(file, 'utf8')
        .split(/\r?\n/u)
        .filter(
          (line) =>
            !/^\s*(?:export\s+)?ZEROH_RECEIPT_RETENTION\s*=/u.test(line),
        )
    : [];
  while (lines.length && lines.at(-1) === '') lines.pop();
  lines.push(`ZEROH_RECEIPT_RETENTION=${value}`, '');
  const { writePrivateFile } =
    await import('../../packages/zeroh-disclosure-core/private-fs.js');
  writePrivateFile(file, lines.join('\n'));
  print({ retention: value, file }, args.json, [
    retentionLine({ ZEROH_RECEIPT_RETENTION: value }),
    `Saved in ${file}. A repository's .zeroh.env may only shorten it. Older receipts go at the next Claude Code start.`,
  ]);
}

// What ZeroH does with a case it cannot prove either way (a destination it
// cannot read, a command it cannot parse): `uncertain` shows it, `uncertain
// pass|block` writes ZEROH_UNCERTAIN to the user's own config.env.
