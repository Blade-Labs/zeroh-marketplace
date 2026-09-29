// SPDX-License-Identifier: AGPL-3.0-only

// Uninstall keeps the receipts (owner decision 2026-09-28, lib/receipt-keep.js):
// every signed receipt, receipt.html and session bundle, with the public keys
// that verify them, move to one folder outside ZEROH_HOME, and none of it
// holds a value, a private key or the key behind the value commitments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  FAKE_DB_PASSWORD,
  FAKE_STRIPE,
  FAKE_WEBHOOK,
  runHook,
  stateDirOf,
  tempProject,
} from './helpers.mjs';
import {
  KEPT_MANIFEST,
  keepReceipts,
  keptReceiptsDir,
} from '../lib/receipt-keep.js';
import {
  verifyReceiptArtifact,
  verifyReceiptBundleArtifact,
} from '../lib/verify-receipt.js';
import { writeSessionReceiptHtml } from '../lib/report.js';
import { previewValue } from '../lib/report-slip.js';

const FAKES = [FAKE_STRIPE, FAKE_WEBHOOK, FAKE_DB_PASSWORD];
const KEPT_NAMES =
  /^(?:turn-\d+\.json|receipt\.html|session\.bundle\.json|signing-key\.json)$/u;

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).isFile());
}

function hook(p, name, event) {
  const result = runHook(
    name,
    { session_id: 'kept-1', ...event },
    { project: p },
  );
  assert.equal(result.code, 0, result.stderr);
  return result;
}

// A session with a typed secret sent as typed (no proxy), tool output that
// was masked, a finished turn and one Stop has not finalised yet.
function sessionWithSecrets() {
  const p = tempProject();
  hook(p, 'session-start', { source: 'startup' });
  hook(p, 'user-prompt-submit', { prompt: `Charge it with ${FAKE_STRIPE}` });
  hook(p, 'post-tool-use', {
    tool_name: 'Bash',
    tool_use_id: 'kept-read',
    tool_input: { command: 'cat .env' },
    tool_response: {
      stdout: `STRIPE_WEBHOOK_SECRET=${FAKE_WEBHOOK}\nDB=${FAKE_DB_PASSWORD}\n`,
      stderr: '',
    },
  });
  hook(p, 'stop', {});
  hook(p, 'user-prompt-submit', { prompt: 'And list the files.' });
  return p;
}

async function withHome(home, fn) {
  const previous = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = home;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = previous;
  }
}

test('where uninstall keeps the receipts, per system', () => {
  const home = () => '/home/u';
  assert.equal(keptReceiptsDir({}, 'linux', home), '/home/u/ZeroH Receipts');
  assert.equal(keptReceiptsDir({}, 'darwin', home), '/home/u/ZeroH Receipts');
  assert.equal(
    keptReceiptsDir({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32'),
    'C:\\Users\\u\\AppData\\Local\\ZeroH Receipts',
  );
  assert.equal(
    keptReceiptsDir({ ZEROH_HOME: '/tmp/x/zeroh' }, 'linux', home),
    path.resolve('/tmp/x/zeroh-receipts'),
  );
  assert.equal(
    keptReceiptsDir(
      { ZEROH_HOME: '/tmp/x/zeroh', ZEROH_RECEIPTS_DIR: '/tmp/r' },
      'linux',
      home,
    ),
    path.resolve('/tmp/r'),
  );
});

test('the kept receipts hold no value and no private key, and still verify with ZEROH_HOME gone', async () => {
  const p = sessionWithSecrets();
  const sessionDir = path.join(stateDirOf(p), 'sessions', 'kept-1');
  // A ledger that carries the key behind its value commitments (as a turn
  // written by an earlier build may): never kept.
  const second = path.join(sessionDir, 'turn-2.json');
  const ledger = JSON.parse(readFileSync(second, 'utf8'));
  assert.notEqual(ledger.phase, 'finalized');
  ledger.local_private = { hmacKeyBytes: 'ZEROHFAKE-local-commitment-key' };
  writeFileSync(second, JSON.stringify(ledger));
  const dir = `${p.home}-receipts`;
  const kept = await withHome(p.home, () =>
    keepReceipts({
      home: p.home,
      dir,
      renderHtml: (session) =>
        writeSessionReceiptHtml({ session: { dir: session }, previews: false }),
    }),
  );
  assert.equal(kept.receipts, 2);
  assert.equal(kept.sessions, 1);
  rmSync(p.home, { recursive: true, force: true });

  const files = filesUnder(dir);
  for (const file of files) {
    const name = path.basename(file);
    assert.ok(
      KEPT_NAMES.test(name) || name === KEPT_MANIFEST || name === 'README.txt',
      `unexpected kept file ${file}`,
    );
    const text = readFileSync(file, 'utf8');
    for (const value of FAKES) {
      assert.ok(!text.includes(value), `${file} holds a value`);
    }
    assert.doesNotMatch(text, /local_private|hmacKeyBytes/u, file);
    if (name === 'signing-key.json') {
      const key = JSON.parse(text);
      assert.equal(key.publicJwk.d, undefined, 'no private key');
    }
    if (name === 'receipt.html') {
      for (const [type, value] of [
        ['API_KEY', FAKE_STRIPE],
        ['SECRET', FAKE_WEBHOOK],
        ['PASSWORD', FAKE_DB_PASSWORD],
      ]) {
        const preview = previewValue(type, value);
        if (preview !== '•••') assert.ok(!text.includes(preview), preview);
      }
    }
  }
  const keptSession = path.join(dir, path.relative(p.home, sessionDir));
  for (const name of [
    'turn-1.json',
    'turn-2.json',
    'receipt.html',
    'session.bundle.json',
    'signing-key.json',
  ]) {
    assert.ok(files.includes(path.join(keptSession, name)), name);
  }
  assert.ok(files.includes(path.join(dir, 'README.txt')));
  assert.match(
    readFileSync(path.join(dir, 'README.txt'), 'utf8'),
    /remove this folder/u,
  );

  // With ZEROH_HOME (and its allow-list key) gone, they still verify.
  await withHome(p.home, async () => {
    const first = await verifyReceiptArtifact(
      path.join(keptSession, 'turn-1.json'),
    );
    assert.equal(first.ok, true, first.failed.join(', '));
    assert.equal(first.coverage, 'turn');
    const pending = await verifyReceiptArtifact(
      path.join(keptSession, 'turn-2.json'),
    );
    assert.equal(pending.ok, true, pending.failed.join(', '));
    assert.equal(pending.coverage, 'pending');
    const bundle = await verifyReceiptBundleArtifact(
      path.join(keptSession, 'session.bundle.json'),
    );
    assert.equal(bundle.ok, true, bundle.failed.join(', '));
  });
});

test('a second uninstall adds to the kept receipts; nothing to keep creates nothing', async () => {
  const empty = tempProject();
  const none = await keepReceipts({
    home: empty.home,
    dir: `${empty.home}-receipts`,
  });
  assert.equal(none.dir, null);
  assert.throws(() => statSync(`${empty.home}-receipts`));

  const one = sessionWithSecrets();
  const dir = `${one.home}-shared-receipts`;
  await keepReceipts({ home: one.home, dir });
  const two = sessionWithSecrets();
  const again = await keepReceipts({ home: two.home, dir });
  assert.equal(again.receipts, 2);
  const manifest = JSON.parse(
    readFileSync(path.join(dir, KEPT_MANIFEST), 'utf8'),
  );
  assert.equal(Object.keys(manifest.receipts).length, 4);
});

// Astra pre-1.0.0 R6: a kept receipt's unmask record was accepted on the
// manifest's word alone ("verified at uninstall"), so an edit made after
// uninstall (999 values "shown under a grant") still verified. The record
// kept is now bound to what was checked by an attestation signed with the
// receipt's own key before its private half goes; without one the check is
// unavailable, never passed.
const FORGED = [{ grant_id: 'ZEROHFAKE-forged', kind: 'EMAIL', values: 999 }];

function revealCheckOf(result) {
  return result.checks.find(({ name }) => name === 'revealed_under_grant_hmac');
}

test('a kept receipt: its unmask record edited after uninstall no longer verifies (Astra R6)', async () => {
  const p = sessionWithSecrets();
  const sessionDir = path.join(stateDirOf(p), 'sessions', 'kept-1');
  const dir = `${p.home}-receipts`;
  await withHome(p.home, () => keepReceipts({ home: p.home, dir }));
  rmSync(p.home, { recursive: true, force: true });
  const file = path.join(dir, path.relative(p.home, sessionDir), 'turn-1.json');
  const original = readFileSync(file, 'utf8');
  await withHome(p.home, async () => {
    const kept = await verifyReceiptArtifact(file);
    assert.equal(kept.ok, true, kept.failed.join(', '));
    assert.equal(revealCheckOf(kept).ok, true);

    const edited = JSON.parse(original);
    edited.receipt.revealed_under_grant = FORGED;
    writeFileSync(file, JSON.stringify(edited));
    const tampered = await verifyReceiptArtifact(file);
    assert.equal(tampered.ok, false);
    assert.ok(
      tampered.failed.includes('revealed_under_grant_hmac'),
      tampered.failed.join(', '),
    );

    // The attestation taken away: the check can't be made, and says so.
    const manifestFile = path.join(dir, KEPT_MANIFEST);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const record = manifest.receipts[edited.receipt.receipt_id];
    assert.ok(record.reveal_attestation, 'signed at uninstall');
    delete record.reveal_attestation;
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const stripped = await verifyReceiptArtifact(file);
    assert.equal(stripped.ok, false);
    assert.equal(revealCheckOf(stripped).ok, false);
    assert.equal(revealCheckOf(stripped).status, 'unavailable');
  });
});

test('a kept 1.0.0-rc.3 receipt without a signed unmask attestation: the check is unavailable, and an edit never verifies (Astra R6)', async () => {
  const fixture = new URL('./fixtures/receipt-1.0.0-rc.3/', import.meta.url);
  const p = tempProject();
  const sessionDir = path.join(
    p.home,
    'projects',
    'ZEROHFAKE',
    'sessions',
    'ZEROHFAKE',
  );
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    path.join(sessionDir, 'turn-1.json'),
    readFileSync(new URL('turn-1.json', fixture), 'utf8'),
  );
  writeFileSync(
    path.join(p.home, 'allow.key'),
    Buffer.from(
      readFileSync(new URL('allow.key.b64', fixture), 'utf8').trim(),
      'base64',
    ),
  );
  const dir = `${p.home}-receipts`;
  const kept = await withHome(p.home, () =>
    keepReceipts({ home: p.home, dir }),
  );
  assert.equal(kept.receipts, 1);
  const manifest = JSON.parse(
    readFileSync(path.join(dir, KEPT_MANIFEST), 'utf8'),
  );
  assert.deepEqual(
    Object.values(manifest.receipts).map((r) => r.reveal_record),
    ['verified'],
  );
  rmSync(p.home, { recursive: true, force: true });
  const file = path.join(dir, path.relative(p.home, sessionDir), 'turn-1.json');
  await withHome(p.home, async () => {
    const plain = await verifyReceiptArtifact(file);
    assert.equal(revealCheckOf(plain).status, 'unavailable');
    assert.equal(plain.ok, false);
    const edited = JSON.parse(readFileSync(file, 'utf8'));
    edited.receipt.revealed_under_grant = FORGED;
    writeFileSync(file, JSON.stringify(edited));
    const tampered = await verifyReceiptArtifact(file);
    assert.equal(tampered.ok, false);
    assert.equal(revealCheckOf(tampered).ok, false);
  });
});
