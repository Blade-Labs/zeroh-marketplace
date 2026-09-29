// SPDX-License-Identifier: AGPL-3.0-only

// Whether a value ZeroH found reached the model in plain text (1.0.0;
// before, the receipt said false even for a prompt sent as typed without the
// proxy). The prompt receipt states it for the typed prompt
// (`raw_content_sent_to_ai_provider`); the turn summary signed at Stop states
// it for the turn (`values_sent_to_ai_provider`, a different name so the two
// scopes can't be confused), values shown under an unmask grant included,
// and verify recomputes it.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { FAKE_STRIPE, runHook, stateDirOf, tempProject } from './helpers.mjs';
import { signedTurnSummary, turnSummary } from '../lib/turn-summary.js';
import { verifyReceiptArtifact } from '../lib/verify-receipt.js';

async function turnAfter(prompt, sessionId) {
  const project = tempProject();
  const res = runHook(
    'user-prompt-submit',
    { session_id: sessionId, prompt },
    { project },
  );
  assert.equal(res.code, 0, res.stderr);
  assert.equal(runHook('stop', { session_id: sessionId }, { project }).code, 0);
  const file = path.join(
    stateDirOf(project),
    'sessions',
    sessionId,
    'turn-1.json',
  );
  return { project, file, ledger: JSON.parse(readFileSync(file, 'utf8')) };
}

async function verifyAs(project, file) {
  const previous = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = project.home;
  try {
    return await verifyReceiptArtifact(file);
  } finally {
    if (previous === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = previous;
  }
}

test('a prompt sent as typed without the proxy says raw content was sent, in the receipt and the signed summary', async () => {
  const { project, file, ledger } = await turnAfter(
    `Charge it with ${FAKE_STRIPE}`,
    'raw-sent',
  );
  assert.equal(turnSummary(ledger).prompt, 'sent_unmasked');
  assert.equal(
    ledger.receipt.public_claims.raw_content_sent_to_ai_provider,
    true,
  );
  assert.equal(
    signedTurnSummary(ledger).summary.values_sent_to_ai_provider,
    true,
  );
  const result = await verifyAs(project, file);
  assert.equal(result.ok, true, result.failed?.join(', '));
  // The summary is recomputed from the ledger: a ledger edited to hide the
  // values sent no longer verifies.
  ledger.audit.sent_unmasked = { count: 0, by_type: {} };
  ledger.phase = 'allowed_no_findings';
  writeFileSync(file, JSON.stringify(ledger));
  assert.equal((await verifyAs(project, file)).ok, false);
});

test('a prompt with nothing found says no raw content was sent', async () => {
  const { project, file, ledger } = await turnAfter(
    'Rename the helper and run the tests.',
    'raw-clean',
  );
  assert.equal(
    ledger.receipt.public_claims.raw_content_sent_to_ai_provider,
    false,
  );
  assert.equal(
    signedTurnSummary(ledger).summary.values_sent_to_ai_provider,
    false,
  );
  assert.equal((await verifyAs(project, file)).ok, true);
});

test('a value shown under an unmask grant makes the turn say raw content was sent', () => {
  const ledger = {
    phase: 'finalized',
    replacements: [],
    receipt: {
      public_claims: { decision_action: 'allow_with_receipt' },
      revealed_under_grant: [{ grant_id: 'g1', kind: 'EMAIL', values: 1 }],
    },
  };
  assert.equal(turnSummary(ledger).values_sent_to_ai_provider, true);
  ledger.receipt.revealed_under_grant = [];
  assert.equal(turnSummary(ledger).values_sent_to_ai_provider, false);
});
