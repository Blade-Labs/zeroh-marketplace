// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { allowKeyPath } from '../../packages/zeroh-disclosure-core/allow-rules.js';
import {
  loadSession,
  readJson,
  writeJson,
} from '../../packages/zeroh-disclosure-core/session.js';
import {
  verifyStopReceipts,
  verifyStopSnapshot,
} from '../../packages/zeroh-disclosure-core/stop-verifications.js';
import { runHook, stateDirOf, tempProject } from '../helpers.mjs';

async function fixture() {
  const project = tempProject({ env: false });
  const session = await loadSession({ cwd: project.dir, sessionId: 'cache' });
  const entries = [1, 2].map((turn) => ({
    turn,
    file: path.join(session.dir, `turn-${turn}.json`),
    ledger: {
      turn,
      receipt: { public_claims: { policy_id: 'fixture-policy' } },
    },
  }));
  let calls = 0;
  const verify = async () => {
    calls++;
    return {
      ok: true,
      failed: [],
      coverage: 'fixture',
      checks: [{ name: 'signature', ok: true }],
    };
  };
  const options = {
    session,
    entries,
    verify,
    digestPolicy: () => 'fixture-policy-one',
  };
  return {
    ...options,
    options,
    calls: () => calls,
    file: path.join(session.dir, 'stop-verifications.json'),
  };
}

test('unchanged historical verification is reused; a changed predecessor invalidates its successor', async () => {
  const f = await fixture();
  await verifyStopReceipts(f.options);
  assert.equal(f.calls(), 2);
  await verifyStopReceipts(f.options);
  assert.equal(f.calls(), 2, 'unchanged turns are not verified again');
  f.entries[0].ledger.receipt.public_claims.previous_receipt_hash =
    'changed-fixture';
  await verifyStopReceipts(f.options);
  assert.equal(
    f.calls(),
    4,
    'both changed ledger and dependent chain link are verified again',
  );
});

test('a cache forged without the session signing key is ignored', async () => {
  const f = await fixture();
  await verifyStopReceipts(f.options);
  const cache = await readJson(f.file);
  const parts = cache.compact.split('.');
  const claims = JSON.parse(
    Buffer.from(parts[1], 'base64url').toString('utf8'),
  );
  claims.records[1].verification.ok = false;
  parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  await writeJson(f.file, { compact: parts.join('.') });
  const results = await verifyStopReceipts(f.options);
  assert.equal(f.calls(), 4);
  assert.equal(results.get(1).ok, true);
});

test('policy changes and local reveal-key changes invalidate historical results', async () => {
  const f = await fixture();
  await verifyStopReceipts(f.options);
  await verifyStopReceipts({
    ...f.options,
    digestPolicy: () => 'fixture-policy-two',
  });
  assert.equal(f.calls(), 4);
  writeFileSync(allowKeyPath(), 'fixture-reveal-key-one');
  await verifyStopReceipts({
    ...f.options,
    digestPolicy: () => 'fixture-policy-two',
  });
  assert.equal(f.calls(), 6);
  writeFileSync(allowKeyPath(), 'fixture-reveal-key-two');
  await verifyStopReceipts({
    ...f.options,
    digestPolicy: () => 'fixture-policy-two',
  });
  assert.equal(f.calls(), 8);
});

test('a deleted predecessor invalidates the surviving turn chain', async () => {
  const f = await fixture();
  await verifyStopReceipts(f.options);
  await verifyStopReceipts({ ...f.options, entries: f.entries.slice(1) });
  assert.equal(f.calls(), 3);
});

test('verifier implementation changes invalidate cached results', async () => {
  const f = await fixture();
  await verifyStopReceipts({
    ...f.options,
    implementation: 'fixture-implementation-one',
  });
  await verifyStopReceipts({
    ...f.options,
    implementation: 'fixture-implementation-two',
  });
  assert.equal(f.calls(), 4);
});

test('transient verifier failures are retried on the next Stop', async () => {
  const f = await fixture();
  const failed = await verifyStopReceipts({
    ...f.options,
    verify: async () => {
      throw new Error('fixture read failure');
    },
  });
  assert.equal(failed.get(1).ok, false);
  await verifyStopReceipts(f.options);
  assert.equal(f.calls(), 2);
});

test('real Stop catches a changed historical receipt rather than trusting its signed cache', () => {
  const project = tempProject({ env: false });
  const sessionId = 'real-cache-tamper';
  for (let turn = 1; turn <= 2; turn++) {
    assert.equal(
      runHook(
        'user-prompt-submit',
        { session_id: sessionId, prompt: 'Summarize the README.' },
        { project },
      ).code,
      0,
    );
    assert.equal(
      runHook('stop', { session_id: sessionId }, { project }).code,
      0,
    );
  }
  const dir = path.join(stateDirOf(project), 'sessions', sessionId);
  const file = path.join(dir, 'turn-1.json');
  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  ledger.sanitized_text = 'Changed fixture text after receipt signing.';
  writeFileSync(file, JSON.stringify(ledger));
  assert.equal(
    runHook(
      'user-prompt-submit',
      { session_id: sessionId, prompt: 'Summarize the README.' },
      { project },
    ).code,
    0,
  );
  assert.equal(runHook('stop', { session_id: sessionId }, { project }).code, 0);
  assert.match(
    readFileSync(path.join(dir, 'receipt.html'), 'utf8'),
    /Full verification<\/dt><dd>Failed/u,
  );
});

test('a file changed during verification cannot lend its verdict to another snapshot', async () => {
  const project = tempProject({ env: false });
  const sessionId = 'cache-snapshot-race';
  assert.equal(
    runHook(
      'user-prompt-submit',
      { session_id: sessionId, prompt: 'Summarize the README.' },
      { project },
    ).code,
    0,
  );
  assert.equal(runHook('stop', { session_id: sessionId }, { project }).code, 0);
  const savedHome = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = project.home;
  try {
    const session = await loadSession({ cwd: project.dir, sessionId });
    const file = path.join(session.dir, 'turn-1.json');
    const original = await readJson(file);
    const invalid = { ...original, sanitized_text: 'Changed fixture text.' };
    await writeJson(file, invalid);
    rmSync(path.join(session.dir, 'stop-verifications.json'));
    const entries = [{ turn: 1, file, ledger: invalid }];
    const results = await verifyStopReceipts({
      session,
      entries,
      verify: async (target, snapshot) => {
        // Reopening disk would now verify the valid original, though the
        // fingerprint and displayed ledger contain the invalid snapshot.
        await writeJson(target, original);
        return verifyStopSnapshot(target, snapshot);
      },
    });
    assert.equal(
      results.get(1).ok,
      false,
      'the invalid fingerprinted snapshot fails',
    );
    const fresh = await verifyStopReceipts({
      session,
      entries: [{ turn: 1, file, ledger: original }],
    });
    assert.equal(
      fresh.get(1).ok,
      true,
      'the valid disk record is verified on the next read',
    );
  } finally {
    process.env.ZEROH_HOME = savedHome;
  }
});

test('adding, editing and deleting an ancestor kept manifest invalidates the actual verdict', async () => {
  const project = tempProject({ env: false });
  const sessionId = 'kept-cache-context';
  assert.equal(
    runHook(
      'user-prompt-submit',
      { session_id: sessionId, prompt: 'Summarize the README.' },
      { project },
    ).code,
    0,
  );
  assert.equal(runHook('stop', { session_id: sessionId }, { project }).code, 0);
  const savedHome = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = project.home;
  try {
    const session = await loadSession({ cwd: project.dir, sessionId });
    const file = path.join(session.dir, 'turn-1.json');
    const ledger = await readJson(file);
    const entries = [{ turn: 1, file, ledger }];
    assert.equal(
      (await verifyStopReceipts({ session, entries })).get(1).ok,
      true,
    );
    const manifestFile = path.join(
      path.dirname(session.dir),
      'zeroh-receipts.json',
    );
    const manifest = {
      schema: 'zeroh-kept-receipts/v1',
      kept_at: 'fixture-one',
      receipts: { [ledger.receipt.receipt_id]: { reveal_record: 'failed' } },
    };
    await writeJson(manifestFile, manifest);
    assert.equal(
      (await verifyStopReceipts({ session, entries })).get(1).ok,
      false,
    );
    // A purported verified entry without a valid attestation must not lend
    // the receipt the earlier verdict, either.
    manifest.kept_at = 'fixture-two';
    manifest.receipts[ledger.receipt.receipt_id].reveal_record = 'verified';
    await writeJson(manifestFile, manifest);
    assert.equal(
      (await verifyStopReceipts({ session, entries })).get(1).ok,
      false,
    );
    rmSync(manifestFile);
    assert.equal(
      (await verifyStopReceipts({ session, entries })).get(1).ok,
      true,
    );
  } finally {
    process.env.ZEROH_HOME = savedHome;
  }
});
