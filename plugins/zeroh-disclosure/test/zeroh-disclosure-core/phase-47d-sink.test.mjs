// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tempProject, runHook, FAKE_STRIPE } from '../helpers.mjs';
import {
  loadSession,
  bumpTurn,
  writeTurn,
} from '../../packages/zeroh-disclosure-core/session.js';
import {
  withReceiptSink,
  localFileReceiptSink,
} from '../../packages/zeroh-disclosure-core/receipt-sink.js';
import { recordToolAudit } from '../../lib/hook-steps/pre-tool-use/record-tool-audit.js';
import { recordFormatOutcome } from '../../lib/format-audit.js';
import { recordMaskedOutput } from '../../packages/zeroh-disclosure-core/report/collect.js';
import {
  keepReceipts,
  KEPT_MANIFEST,
} from '../../packages/zeroh-disclosure-core/receipt-keep.js';

function capturing(items) {
  return {
    write(item) {
      items.push(item);
      const result = localFileReceiptSink.write(item);
      assert.ok(item.bytes.equals(readFileSync(item.path)));
      return result;
    },
  };
}

test('each pending-ledger writer keeps private ledger bytes out of receipt delivery', async () => {
  const p = tempProject({ env: false });
  const previous = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = p.home;
  try {
    const session = await loadSession({
      cwd: p.dir,
      sessionId: 'ZEROHFAKE-sink-kinds',
    });
    await bumpTurn(session);
    const pending = {
      turn: 1,
      phase: 'pending',
      local_private: { hmacKeyBytes: [1, 2, 3] },
      receipt: { compact: 'ZEROHFAKE-signed' },
    };
    const items = [];
    await withReceiptSink(capturing(items), async () => {
      await writeTurn({ dir: session.dir, turn: 1, payload: pending });
      await recordFormatOutcome({
        cwd: p.dir,
        sessionId: 'ZEROHFAKE-sink-kinds',
        withheld: { pdf: 1 },
      });
      await recordToolAudit({
        session,
        toolUseId: 'ZEROHFAKE-tool',
        toolName: 'Bash',
        action: 'allow',
      });
      await recordMaskedOutput({
        cwd: p.dir,
        sessionId: 'ZEROHFAKE-sink-kinds',
        channel: 'tool_output',
        replacements: [{ type: 'PASSWORD' }],
      });
    });
    assert.equal(items.length, 4, 'all four writers ran');
    assert.ok(items.every((item) => item.kind === 'pending-ledger'));
    assert.equal(
      items.filter(
        (item) =>
          item.kind === 'receipt' && item.bytes.includes('local_private'),
      ).length,
      0,
    );
    const finalized = { turn: 1, phase: 'finalized', receipt: pending.receipt };
    await withReceiptSink(capturing(items), () =>
      writeTurn({ dir: session.dir, turn: 1, payload: finalized }),
    );
    assert.equal(items.at(-1).kind, 'receipt');
  } finally {
    process.env.ZEROH_HOME = previous;
  }
});

test('uninstall metadata, public keys and copies use keep-folder kind', async () => {
  const p = tempProject({ env: false });
  const options = { project: p };
  runHook(
    'user-prompt-submit',
    { session_id: 'ZEROHFAKE-keep-kinds', prompt: `Use ${FAKE_STRIPE}` },
    options,
  );
  runHook('stop', { session_id: 'ZEROHFAKE-keep-kinds' }, options);
  const items = [];
  await withReceiptSink(capturing(items), () =>
    keepReceipts({
      env: { ...process.env, ZEROH_HOME: p.home },
      dir: path.join(p.dir, 'kept'),
    }),
  );
  assert.ok(items.some((item) => path.basename(item.path) === KEPT_MANIFEST));
  assert.ok(
    items.some((item) => path.basename(item.path) === 'signing-key.json'),
  );
  assert.ok(items.some((item) => path.basename(item.path) === 'README.txt'));
  assert.ok(items.every((item) => item.kind === 'keep-folder'));
  for (const item of items)
    assert.ok(item.bytes.equals(readFileSync(item.path)));
});
