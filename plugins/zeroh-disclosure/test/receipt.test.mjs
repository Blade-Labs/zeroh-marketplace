// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyDisclosurePolicy,
  ledgerFromDisclosureResult,
} from '../lib/disclosure.js';
import { loadSession } from '../lib/session.js';
import {
  receiptRecordToArtifact,
  verifyReceiptArtifactObject,
} from '../lib/verify-receipt.js';
import { loadOrCreateAllowKey, signatureFor } from '../lib/allow-rules.js';
import {
  initializeRevealReceiptExtension,
  REVEAL_EXTENSION_MARKER,
} from '../lib/unmask.js';
import { POLICY, policyById } from '../lib/policy.js';
import {
  decodeCompactReceipt,
  decodeDisclosure,
} from '../lib/selective-disclosure.js';
import {
  FAKE_STRIPE,
  runHook,
  tempProject,
  withProxy,
  stateDirOf,
} from './helpers.mjs';

test('new receipts use did:jwk identities and omit legacy anchor fields', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-receipt-'));
  try {
    const session = await loadSession({ cwd, sessionId: 'ZEROHFAKE-session' });
    const result = await applyDisclosurePolicy({
      text: 'ZEROHFAKE receipt input',
      session,
      cwd,
    });
    const ledger = ledgerFromDisclosureResult({
      turn: 1,
      phase: 'finalized',
      result,
    });
    assert.match(result.receipt.public_claims.iss, /^did:jwk:/);
    assert.equal(
      result.receipt.public_claims.sub,
      result.receipt.public_claims.iss,
    );
    assert.equal('anchor' in result, false);
    assert.equal('anchor_intent' in result, false);
    assert.equal('anchor' in ledger, false);
    assert.equal('anchor_intent' in ledger, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('legacy anchor fields are ignored without network access', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-legacy-receipt-'));
  const originalFetch = globalThis.fetch;
  try {
    const session = await loadSession({ cwd, sessionId: 'ZEROHFAKE-legacy' });
    const result = await applyDisclosurePolicy({
      text: 'ZEROHFAKE legacy receipt input',
      session,
      cwd,
    });
    const ledger = {
      ...ledgerFromDisclosureResult({
        turn: 1,
        phase: 'finalized',
        result,
      }),
      anchor: { anchored: true, type: 'legacy' },
      anchor_intent: { type: 'legacy' },
    };
    globalThis.fetch = () => {
      throw new Error('verification must not access the network');
    };
    const verification = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(ledger, 'ZEROHFAKE-legacy-receipt.json'),
    );
    assert.equal(verification.ok, true);
    assert.equal('anchor' in verification, false);
    assert.deepEqual(
      verification.checks.find(
        (entry) => entry.name === 'legacy_anchor_fields_ignored',
      ),
      {
        name: 'legacy_anchor_fields_ignored',
        ok: true,
        detail: 'ignored legacy fields: anchor, anchor_intent',
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('receipt verification checks the local revealed-under-grant extension', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-reveal-receipt-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-reveal-home-'));
  const originalHome = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = home;
  try {
    const session = await loadSession({ cwd, sessionId: 'ZEROHFAKE-reveal' });
    const result = await applyDisclosurePolicy({
      text: 'ZEROHFAKE reveal receipt input',
      session,
      cwd,
      publicClaimExtras: {
        unmask_receipt_extension: REVEAL_EXTENSION_MARKER,
      },
    });
    const ledger = ledgerFromDisclosureResult({
      turn: 1,
      phase: 'finalized',
      result,
    });
    initializeRevealReceiptExtension(ledger.receipt, { home });
    ledger.receipt.revealed_under_grant = [
      {
        grant_id: 'ug_ZEROHFAKE',
        kind: 'EMAIL',
        tool_outputs: 1,
        values: 1,
        last_revealed_at: '2026-09-25T10:00:00.000Z',
      },
    ];
    ledger.receipt.revealed_under_grant_hmac = signatureFor(
      {
        version: 1,
        receipt_id: ledger.receipt.receipt_id,
        revealed_under_grant: ledger.receipt.revealed_under_grant,
      },
      loadOrCreateAllowKey(home),
    );
    const artifact = receiptRecordToArtifact(
      ledger,
      path.join(cwd, 'turn-1.json'),
    );
    assert.equal(
      (await verifyReceiptArtifactObject(artifact)).checks.find(
        ({ name }) => name === 'revealed_under_grant_hmac',
      ).ok,
      true,
    );
    ledger.receipt.revealed_under_grant[0].values = 2;
    const tampered = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(ledger, path.join(cwd, 'turn-1.json')),
    );
    assert.equal(tampered.ok, false);
    assert.equal(
      tampered.checks.find(({ name }) => name === 'revealed_under_grant_hmac')
        .ok,
      false,
    );
    delete ledger.receipt.revealed_under_grant;
    delete ledger.receipt.revealed_under_grant_hmac;
    const stripped = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(ledger, path.join(cwd, 'turn-1.json')),
    );
    assert.equal(stripped.ok, false);
    assert.match(
      stripped.checks.find(({ name }) => name === 'revealed_under_grant_hmac')
        .detail,
      /requires its local reveal extension/u,
    );
    assert.equal(readFileSync(path.join(home, 'allow.key')).length, 32);
  } finally {
    if (originalHome === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = originalHome;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('the default policy masks personal data under its own neutral rule', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-policy-default-'));
  try {
    assert.equal(POLICY.policy_id, 'zeroh-disclosure-v1');

    const session = await loadSession({ cwd, sessionId: 'ZEROHFAKE-policy' });
    const result = await applyDisclosurePolicy({
      text: 'Contact person.ZEROHFAKE@example.com',
      session,
      cwd,
    });
    const claims = result.receipt.public_claims;
    assert.equal(claims.policy_id, 'zeroh-disclosure-v1');
    assert.equal(claims.decision_action, 'mask_and_allow');
    assert.deepEqual(result.decision.matched_rules, [
      'ZEROH-MASK-PERSONAL-DATA',
    ]);
    assert.deepEqual(result.decision.mask_categories, ['EMAIL']);
    assert.deepEqual(claims.masked_categories, ['EMAIL']);

    const ledger = ledgerFromDisclosureResult({
      turn: 1,
      phase: 'finalized',
      result,
    });
    const decoded = [
      JSON.stringify(ledger),
      ...ledger.receipt.disclosures.map((encoded) =>
        JSON.stringify(decodeDisclosure(encoded)),
      ),
    ].join('\n');
    // Words, not the random base64 of signatures, salts and hashes (which
    // spelled "qcb" by chance often enough to make this test flaky).
    assert.doesNotMatch(
      decoded.replace(/[A-Za-z0-9_-]{16,}/gu, ''),
      /qcb|qatar central|non-qatar|cross.border|approval|regulator|jurisdiction|wallet|sd-jwt|sdjwt|presentations/iu,
    );
    const verification = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(ledger, 'ZEROHFAKE-default.json'),
    );
    assert.equal(verification.ok, true, verification.failed.join(', '));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('receipts are signed by a local ES256 key and name it without claiming SD-JWT', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-signing-key-'));
  try {
    const session = await loadSession({ cwd, sessionId: 'ZEROHFAKE-signer' });
    const result = await applyDisclosurePolicy({
      text: 'ZEROHFAKE signer input',
      session,
      cwd,
    });
    const ledger = ledgerFromDisclosureResult({
      turn: 1,
      phase: 'finalized',
      result,
    });
    const { header } = decodeCompactReceipt(ledger.receipt.compact);
    assert.equal(header.typ, 'zeroh-receipt+jwt');
    assert.equal(header.alg, 'ES256');
    assert.equal('compact_sdjwt' in ledger.receipt, false);
    assert.equal('presentations' in ledger.receipt, false);
    const claims = ledger.receipt.public_claims;
    assert.equal(claims.signing_key_id, session.signingKey.keyId);
    assert.match(claims.signing_key_id, /^local:\d+$/u);
    assert.equal('wallet_account_id' in claims, false);
    assert.equal('wallet_network' in claims, false);
    assert.equal(ledger.token.payload.signing_key_id, claims.signing_key_id);
    const dir = session.dir;
    assert.ok(existsSync(path.join(dir, 'signing-key.json')));
    assert.ok(existsSync(path.join(dir, 'signing-key.private.json')));
    assert.equal(existsSync(path.join(dir, 'wallet.json')), false);
    const verification = await verifyReceiptArtifactObject(
      receiptRecordToArtifact(ledger, 'ZEROHFAKE-signer.json'),
    );
    assert.equal(verification.ok, true, verification.failed.join(', '));
    assert.equal(
      verification.checks.find(({ name }) => name === 'receipt_type').ok,
      true,
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('only the shipped policy resolves', () => {
  for (const name of ['qcb', 'blade', 'agent']) {
    assert.throws(() => policyById(name), /Unknown ZeroH policy/u);
  }
});

// ---- the signed decision matches what the hook did (fake values only) -------

function turnReceipt(project, session) {
  const ledger = JSON.parse(
    readFileSync(
      path.join(stateDirOf(project), 'sessions', session, 'turn-1.json'),
      'utf8',
    ),
  );
  return { ledger, claims: ledger.receipt.public_claims };
}

test('a prompt stopped for a password is signed as blocked with what was found', () => {
  const p = tempProject({ env: false });
  const typed = 'password: Hunter2abcZ9';
  const r = runHook(
    'user-prompt-submit',
    { session_id: 'rc-stop', prompt: typed },
    { project: p },
  );
  assert.equal(r.code, 2, r.stderr);
  const { ledger, claims } = turnReceipt(p, 'rc-stop');
  assert.equal(ledger.phase, 'blocked_pending_user_resubmit');
  assert.equal(claims.decision_action, 'block');
  assert.deepEqual(claims.detected_categories, ['PASSWORD']);
  assert.deepEqual(claims.masked_categories, []);
  assert.equal(claims.sanitized_content_may_be_sent_to_ai_provider, false);
  assert.ok(!JSON.stringify(ledger).includes('Hunter2abcZ9'));
});

test('a prompt masked by the proxy is signed as masked, not blocked', async (t) => {
  const p = tempProject({ env: false });
  const proxy = await withProxy(p, { sessionId: 'rc-proxy' });
  t.after(proxy.stop);
  const typed = `use ${FAKE_STRIPE} for the test`;
  const r = runHook(
    'user-prompt-submit',
    { session_id: 'rc-proxy', prompt: typed },
    proxy,
  );
  assert.equal(r.code, 0, r.stderr);
  const { ledger, claims } = turnReceipt(p, 'rc-proxy');
  assert.equal(ledger.phase, 'masked_by_proxy');
  assert.equal(claims.decision_action, 'mask_and_allow');
  assert.deepEqual(claims.detected_categories, ['API_KEY']);
  assert.deepEqual(claims.masked_categories, ['API_KEY']);
  assert.equal(claims.sanitized_content_may_be_sent_to_ai_provider, true);
  assert.ok(!JSON.stringify(ledger).includes(FAKE_STRIPE));
});

test('the policy blocks passwords, tokens and secrets, not only API keys', async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-receipt-block-'));
  try {
    const session = await loadSession({ cwd, sessionId: 'ZEROHFAKE-block' });
    for (const text of [
      'password: Hunter2abcZ9',
      'Authorization: Bearer zerohfakebearer0123456789',
    ]) {
      const result = await applyDisclosurePolicy({ text, session, cwd });
      assert.equal(result.receipt.public_claims.decision_action, 'block', text);
      assert.equal(result.sanitized_text, '', text);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
