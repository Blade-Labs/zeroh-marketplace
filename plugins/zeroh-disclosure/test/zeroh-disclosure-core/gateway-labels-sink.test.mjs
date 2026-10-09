// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { scrubBody } from '../../packages/local-proxy/scrub.js';
import { Vault } from '../../packages/zeroh-disclosure-core/vault.js';
import {
  applyDisclosurePolicy,
  ledgerFromDisclosureResult,
} from '../../packages/zeroh-disclosure-core/disclosure.js';
import {
  loadSession,
  writeTurn,
} from '../../packages/zeroh-disclosure-core/session.js';
import { signTurnSummary } from '../../packages/zeroh-disclosure-core/turn-summary.js';
import {
  receiptRecordToArtifact,
  verifyReceiptArtifactObject,
} from '../../packages/zeroh-disclosure-core/verify-receipt.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tempProject } from '../helpers.mjs';

const values = [
  'DE89370400440532013000',
  'ZEROHFAKE.PERSON@EXAMPLE.COM',
  '4111111111111111',
  'AKIAZEROHFAKEABCD234',
];
for (const length of [16, 32, 64]) {
  const text = values
    .map((value) => `<${value}_${'a'.repeat(length)}>`)
    .join(' ');
  test(`B1: unlearned values in gateway labels never reach provider bodies (${length})`, () => {
    const p = tempProject({ env: false });
    const vault = new Vault(p.dir, {
      env: { ...process.env, ZEROH_HOME: p.home },
    });
    const body = scrubBody(
      { messages: [{ role: 'user', content: text }] },
      { vault, root: p.dir, known: [] },
    );
    for (const value of values)
      assert.ok(!JSON.stringify(body).includes(value), value);
  });
  test(`B1: gateway label values are absent from ledgers and signed disclosures (${length})`, async () => {
    const p = tempProject({ env: false });
    const session = await loadSession({
      cwd: p.dir,
      sessionId: 'gateway-labels',
      env: { ...process.env, ZEROH_HOME: p.home },
    });
    const result = await applyDisclosurePolicy({
      text,
      session,
      cwd: p.dir,
      enforce: (decision) => ({
        ...decision,
        action: 'mask_and_allow',
        blocked: false,
      }),
    });
    const ledger = ledgerFromDisclosureResult({
      turn: 1,
      phase: 'finalized',
      result,
    });
    ledger.turn_summary = await signTurnSummary({
      ledger,
      turn: 1,
      signer: session.signingKey,
    });
    await writeTurn({ dir: session.dir, turn: 1, payload: ledger });
    const saved = readFileSync(path.join(session.dir, 'turn-1.json'), 'utf8');
    for (const value of values) {
      assert.ok(!saved.includes(value), value);
      const encoded = Buffer.from(
        JSON.stringify(['masked_prompt', value]),
      ).toString('base64url');
      assert.ok(
        !saved.includes(encoded),
        'encoded raw masked_prompt is absent',
      );
    }
    const disclosures = ledger.receipt.compact
      .split('~')
      .slice(1)
      .filter(Boolean)
      .map((encoded) =>
        JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
      );
    for (const disclosure of disclosures)
      for (const value of values)
        assert.ok(!JSON.stringify(disclosure).includes(value));
    const verified = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(ledger),
    );
    assert.equal(verified.ok, true, verified.failed?.join(', '));
  });
}
