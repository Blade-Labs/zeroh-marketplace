// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { PLUGIN, tempProject } from '../helpers.mjs';
import { sessionDir } from '../../packages/zeroh-disclosure-core/session.js';
import {
  receiptRecordToArtifact,
  verifyReceiptArtifactObject,
} from '../../packages/zeroh-disclosure-core/verify-receipt.js';

test('full prompt turns distinguish pending ledgers from finalized receipts; local chain survives the sink', async () => {
  const p = tempProject({ env: false });
  const log = path.join(p.dir, 'sink-deliveries.jsonl');
  const env = {
    ...process.env,
    HOME: p.home,
    ZEROH_HOME: p.home,
    ZEROH_CREDENTIAL_HOME: p.home,
    CLAUDE_CONFIG_DIR: path.join(p.home, 'claude'),
    ZEROH_CLAUDE_SETTINGS: p.settings,
    ZEROH_SERVICE_MANAGER_DIR: p.serviceManager,
    ZEROH_PROXY: 'off',
    ZEROH_PUBLISHED_VERSION_CHECK: 'off',
    CLAUDE_PROJECT_DIR: p.dir,
    ZEROH_TEST_SINK_LOG: log,
  };
  const sid = 'ZEROHFAKE-sink-turn';
  const dir = sessionDir(p.dir, sid, env);
  const json = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
  const hook = (name, event) => {
    const r = spawnSync(
      process.execPath,
      [
        path.join(PLUGIN, 'test/fixtures/hook-receipt-sink.mjs'),
        path.join(PLUGIN, 'hooks', `${name}.js`),
      ],
      {
        env,
        encoding: 'utf8',
        timeout: 20000,
        input: JSON.stringify({ cwd: p.dir, session_id: sid, ...event }),
      },
    );
    assert.equal(r.error, undefined, 'production hook executed');
    assert.equal(r.status, 0, 'production hook completed');
  };
  hook('user-prompt-submit', {
    prompt: `password=ZEROHFAKE${randomBytes(6).toString('hex')}!`,
  });
  const first = json('turn-1.json');
  assert.equal(json('state.json').lastReceiptHash, first.receipt.receipt_hash);
  hook('stop', {});
  hook('user-prompt-submit', {
    prompt: `password=ZEROHFAKE${randomBytes(6).toString('hex')}!`,
  });
  const second = json('turn-2.json');
  assert.equal(
    second.receipt.public_claims.previous_receipt_hash,
    first.receipt.receipt_hash,
    'next prompt chains to previous receipt',
  );
  hook('stop', {});
  assert.equal(
    json('state.json').lastReceiptHash,
    second.receipt.receipt_hash,
    'Stop preserves committed chain',
  );
  const deliveries = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.ok(
    deliveries.some((item) => item.name === 'session.bundle.json'),
    'Stop used injected sink',
  );
  assert.equal(
    deliveries.filter(
      (item) =>
        !/^(?:turn-\d+\.json|session\.bundle\.json|receipt\.html|stop-verifications\.json)$/u.test(
          item.name,
        ),
    ).length,
    0,
    'zero non-receipt deliveries',
  );
  assert.ok(deliveries.some((item) => item.kind === 'pending-ledger'));
  assert.ok(deliveries.some((item) => item.kind === 'receipt'));
  for (const item of deliveries) {
    if (item.kind === 'receipt') assert.equal(item.hasLocalPrivate, false);
  }
  for (const turn of [1, 2]) {
    const verified = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(json(`turn-${turn}.json`)),
      { allowKey: readFileSync(path.join(p.home, 'allow.key')) },
    );
    assert.equal(verified.ok, true, verified.failed.join(', '));
  }
});
