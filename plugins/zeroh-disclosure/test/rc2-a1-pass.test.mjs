// SPDX-License-Identifier: AGPL-3.0-only

// A1 (owner decision, 2026-09-27): without the local proxy a prompt holding
// a secret is sent as typed by default, with one "not protected (proxy not
// running)" line and a fix hint; the signed ledger keeps only a masked copy.
// `uncertain block` keeps the rc.1 stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FAKE_STRIPE, runHook, stateDirOf, tempProject } from './helpers.mjs';

function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

test('a typed secret without the proxy is sent with a notice by default; the ledger copy stays masked', () => {
  const p = tempProject({ env: false });
  const res = runHook(
    'user-prompt-submit',
    { session_id: 'a1-pass', prompt: `Refund order 1182 using ${FAKE_STRIPE}` },
    { project: p },
  );
  assert.equal(res.code, 0, res.stderr);
  const message = res.json?.systemMessage ?? '';
  assert.match(
    message,
    /ZeroH Disclosure: this prompt was not protected \(proxy not running\)/u,
  );
  assert.ok(!message.includes(FAKE_STRIPE));
  assert.ok(!res.stdout.includes(FAKE_STRIPE));
  const dir = path.join(stateDirOf(p), 'sessions', 'a1-pass');
  const ledger = JSON.parse(
    readFileSync(path.join(dir, 'turn-1.json'), 'utf8'),
  );
  assert.equal(ledger.phase, 'sent_unmasked_no_proxy');
  for (const file of filesUnder(stateDirOf(p)))
    assert.ok(
      !readFileSync(file).includes(Buffer.from(FAKE_STRIPE)),
      `no plaintext in ${path.relative(p.home, file)}`,
    );
});

test('a typed secret without the proxy is stopped in block mode', () => {
  const p = tempProject({ env: false });
  const res = runHook(
    'user-prompt-submit',
    { prompt: `Refund order 1182 using ${FAKE_STRIPE}` },
    { project: p, extraEnv: { ZEROH_UNCERTAIN: 'block' } },
  );
  assert.equal(res.code, 2);
  assert.match(res.stderr, /ZeroH stopped this prompt/u);
  assert.ok(!res.stderr.includes(FAKE_STRIPE));
});

// Windows re-test (rc.2), finding 3: two values typed, the status line said
// 4 sent (a detector and a known-value match of the same key both counted).
// "Sent" is distinct values that reached the model in plain text; the status
// line and the turn record agree.
test('a typed key that is also in .env and an email count as two values sent', () => {
  const p = tempProject();
  const email = ['zerohfake.buyer', 'example.com'].join('@');
  const res = runHook(
    'user-prompt-submit',
    {
      session_id: 'a1-count',
      prompt: `Refund ${email} using ${FAKE_STRIPE}, and again ${FAKE_STRIPE}`,
    },
    { project: p },
  );
  assert.equal(res.code, 0, res.stderr);
  const dir = path.join(stateDirOf(p), 'sessions', 'a1-count');
  const ledger = JSON.parse(
    readFileSync(path.join(dir, 'turn-1.json'), 'utf8'),
  );
  assert.equal(ledger.phase, 'sent_unmasked_no_proxy');
  assert.equal(ledger.audit.sent_unmasked.count, 2);
  assert.equal(
    Object.values(ledger.audit.sent_unmasked.by_type).reduce(
      (sum, n) => sum + n,
      0,
    ),
    2,
  );
  const statusFile = filesUnder(stateDirOf(p)).find(
    (file) => path.basename(file) === 'status.json',
  );
  assert.ok(statusFile, 'the session status is written');
  assert.equal(JSON.parse(readFileSync(statusFile, 'utf8')).sent, 2);
});
