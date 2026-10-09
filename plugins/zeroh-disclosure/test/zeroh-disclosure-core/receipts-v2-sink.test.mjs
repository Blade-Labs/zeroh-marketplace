// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rawWriterCalls,
  receiptWriterViolations,
} from '../receipt-writer-gate.mjs';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  applyDisclosurePolicy,
  ledgerFromDisclosureResult,
} from '../../packages/zeroh-disclosure-core/disclosure.js';
import {
  loadSession,
  bumpTurn,
  writeTurn,
  writeReceiptBundle,
  writeJson,
} from '../../packages/zeroh-disclosure-core/session.js';
import {
  localFileReceiptSink,
  withReceiptSink,
  writeReceiptBytes,
} from '../../packages/zeroh-disclosure-core/receipt-sink.js';
import {
  TOKEN_SPEC_VERSION,
  TOKEN_SPEC_V1,
} from '../../packages/zeroh-disclosure-core/token-pattern.js';
import {
  signTurnSummary,
  turnSummary,
  LEGACY_TURN_SUMMARY_FIELDS,
} from '../../packages/zeroh-disclosure-core/turn-summary.js';
import {
  createSignedReceipt,
  decodeCompactReceipt,
} from '../../packages/zeroh-disclosure-core/selective-disclosure.js';
import { sha256B64u } from '../../packages/zeroh-disclosure-core/crypto.js';
import {
  receiptRecordToArtifact,
  verifyReceiptArtifactObject,
} from '../../packages/zeroh-disclosure-core/verify-receipt.js';
import { MIXED_TOKEN_REQUEST } from '../../vendor/sensitive-data-detectors/src/fixtures/two-token-families.js';
import {
  buildLocalReport,
  writeLocalReport,
  writeSessionReceiptHtml,
} from '../../packages/zeroh-disclosure-core/report.js';
import { PLUGIN, tempProject } from '../helpers.mjs';

async function signedLedger(tokenSpec = TOKEN_SPEC_VERSION) {
  const p = tempProject({ env: false });
  const session = await loadSession({
    cwd: p.dir,
    sessionId: 'ZEROHFAKE-phase47',
    env: { ...process.env, ZEROH_HOME: p.home },
  });
  const result = await applyDisclosurePolicy({
    text: MIXED_TOKEN_REQUEST,
    publicClaimExtras: { token_spec_version: tokenSpec },
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
  return { p, session, ledger };
}

test('new receipt and summary self-describe their schema, signer and token spec', async () => {
  const { ledger } = await signedLedger();
  const claims = ledger.receipt.public_claims;
  assert.equal(claims.schema_id, 'zeroh-disclosure-receipt');
  assert.equal(claims.schema_version, 2);
  assert.ok(claims.signing_key_id);
  assert.deepEqual(claims.token_spec_version, TOKEN_SPEC_VERSION);
  const summary = decodeCompactReceipt(ledger.turn_summary.compact).payload;
  assert.equal(summary.schema_id, 'zeroh-turn-summary');
  assert.equal(summary.schema_version, 2);
  assert.equal(summary.signing_key_id, claims.signing_key_id);
  assert.deepEqual(summary.summary.token_spec_version, TOKEN_SPEC_VERSION);
  assert.equal(
    summary.summary.values_masked,
    2,
    'gateway placeholders never count as ZeroH values',
  );
  const verified = await verifyReceiptArtifactObject(
    receiptRecordToArtifact(ledger),
  );
  assert.equal(verified.ok, true, verified.failed.join(', '));
});

test('historical pattern version 1 receipts and summaries still verify', async () => {
  const { ledger } = await signedLedger(TOKEN_SPEC_V1);
  const verified = await verifyReceiptArtifactObject(
    receiptRecordToArtifact(ledger),
  );
  assert.equal(verified.ok, true, verified.failed.join(', '));
  assert.equal(
    ledger.receipt.public_claims.token_spec_version.gateway.pattern_version,
    1,
  );
  assert.equal(TOKEN_SPEC_VERSION.gateway.pattern_version, 2);
});

test('changing any new v2 metadata field fails verification', async () => {
  const { ledger } = await signedLedger();
  for (const [key, value] of [
    ['schema_id', 'ZEROHFAKE-other'],
    ['schema_version', 1],
    ['signing_key_id', 'ZEROHFAKE-other'],
    [
      'token_spec_version',
      {
        ...TOKEN_SPEC_VERSION,
        gateway: { family: 'privacy-gateway', pattern_version: 3 },
      },
    ],
  ]) {
    const changed = structuredClone(ledger);
    changed.receipt.public_claims[key] = value;
    assert.equal(
      (await verifyReceiptArtifactObject(receiptRecordToArtifact(changed))).ok,
      false,
      key,
    );
    const compact = changed.receipt.compact.split('~');
    const jws = compact[0].split('.');
    const claims = JSON.parse(Buffer.from(jws[1], 'base64url'));
    claims[key] = value;
    jws[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    compact[0] = jws.join('.');
    changed.receipt.compact = compact.join('~');
    assert.equal(
      (await verifyReceiptArtifactObject(receiptRecordToArtifact(changed))).ok,
      false,
      `signed ${key}`,
    );
  }
});

test('v1 receipt and frozen v1 turn summary still verify', async () => {
  const { ledger, session } = await signedLedger();
  const claims = {
    ...ledger.receipt.public_claims,
    schema: 'zeroh-disclosure-receipt/v1',
    turn_summary_extension: 'zeroh-turn-summary/v1',
  };
  delete claims.schema_id;
  delete claims.schema_version;
  delete claims.token_spec_version;
  const signed = await createSignedReceipt({
    signer: session.signingKey,
    publicClaims: claims,
    selectiveClaims: {},
  });
  ledger.receipt = {
    ...ledger.receipt,
    public_claims: claims,
    compact: signed.compact,
    receipt_hash: await sha256B64u(signed.compact),
    disclosures: [],
    disclosure_manifest: [],
  };
  delete ledger.token;
  const summary = await createSignedReceipt({
    signer: session.signingKey,
    publicClaims: {
      schema: 'zeroh-turn-summary/v1',
      receipt_id: claims.receipt_id,
      receipt_hash: ledger.receipt.receipt_hash,
      summary: Object.fromEntries(
        LEGACY_TURN_SUMMARY_FIELDS.map((field) => [
          field,
          turnSummary(ledger)[field],
        ]),
      ),
    },
    selectiveClaims: {},
  });
  ledger.turn_summary = {
    schema: 'zeroh-turn-summary/v1',
    compact: summary.compact,
  };
  const verified = await verifyReceiptArtifactObject(
    receiptRecordToArtifact(ledger),
  );
  assert.equal(verified.ok, true, verified.failed.join(', '));
});

test('local and injected sinks receive byte-identical files and unchanged signed evidence', async () => {
  const { ledger, session } = await signedLedger();
  const captured = [];
  const sink = {
    write(item) {
      captured.push(item);
      return localFileReceiptSink.write(item);
    },
  };
  await withReceiptSink(sink, async () => {
    await writeTurn({ dir: session.dir, turn: 1, payload: ledger });
    await writeReceiptBundle({
      dir: session.dir,
      bundle: { schema: 'zeroh-receipt-bundle/v1', receipts: [ledger] },
    });
    await writeJson(path.join(session.dir, 'stop-verifications.json'), {
      compact: 'ZEROHFAKE-signed-evidence',
    });
    writeReceiptBytes(
      path.join(session.dir, 'receipt.html'),
      'ZEROHFAKE receipt HTML',
      'receipt-html',
    );
  });
  assert.equal(captured.length, 4);
  assert.deepEqual(
    captured.map((item) => item.kind),
    ['receipt', 'receipt', 'receipt', 'receipt-html'],
  );
  assert.deepEqual(
    captured.map((item) => path.basename(item.path)),
    [
      'turn-1.json',
      'session.bundle.json',
      'stop-verifications.json',
      'receipt.html',
    ],
  );
  for (const item of captured)
    assert.equal(item.bytes.equals(readFileSync(item.path)), true);
  assert.equal(
    captured[0].bytes.equals(
      Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`),
    ),
    true,
    'existing JSON serialization unchanged',
  );
  const transferred = JSON.parse(captured[0].bytes);
  assert.equal(transferred.receipt.compact, ledger.receipt.compact);
  assert.equal(
    (await verifyReceiptArtifactObject(receiptRecordToArtifact(transferred)))
      .ok,
    true,
  );
  const legacyFile = path.join(session.dir, 'legacy-local.json');
  writeFileSync(legacyFile, `${JSON.stringify(ledger, null, 2)}\n`);
  assert.ok(captured[0].bytes.equals(readFileSync(legacyFile)));
});

test('receipt transport never receives session state or signing keys', async () => {
  const p = tempProject({ env: false });
  const captured = [];
  await withReceiptSink(
    {
      write(item) {
        captured.push(item);
        return localFileReceiptSink.write(item);
      },
    },
    async () => {
      const session = await loadSession({
        cwd: p.dir,
        sessionId: 'ZEROHFAKE-sink-keys',
        env: { ...process.env, ZEROH_HOME: p.home },
      });
      await bumpTurn(session);
      assert.equal(captured.length, 0);
      assert.equal(session.state.turnCount, 1);
      assert.ok(session.signingKey.keyId);
      await writeTurn({ dir: session.dir, turn: 1, payload: { turn: 1 } });
    },
  );
  assert.deepEqual(
    captured.map((item) => path.basename(item.path)),
    ['turn-1.json'],
  );
});

test('every production disk write is a named sink or an approved local-state call', () => {
  function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(dir, entry.name))
        : /\.[cm]?js$/u.test(entry.name)
          ? [path.join(dir, entry.name)]
          : [],
    );
  }
  const inventory = JSON.parse(
    readFileSync(
      path.join(PLUGIN, 'test/fixtures/local-writer-calls.json'),
      'utf8',
    ),
  );
  for (const file of ['lib', 'hooks', 'packages'].flatMap((dir) =>
    walk(path.join(PLUGIN, dir)),
  )) {
    const relative = path.relative(PLUGIN, file).split(path.sep).join('/');
    assert.equal(
      receiptWriterViolations(readFileSync(file, 'utf8'), inventory[relative])
        .length,
      0,
      relative,
    );
  }
});

test('sink gate rejects indirect, aliased and direct receipt writes structurally', () => {
  for (const source of [
    'fs.writeSync(fd, receiptBytes)',
    'fs.renameSync(staged, receiptPath)',
    'fs.cpSync(source, receiptPath)',
    'handle.write(receiptBytes)',
    'const w = fs.writeFileSync; w(receiptPath, bytes)',
    "fs['writeFileSync'](receiptPath, bytes)",
    'const w = fs["writeFileSync"]; w(receiptPath, bytes)',
    'const { writeFileSync: w } = fs; w(receiptPath, bytes)',
    'writeJson(turnPath, ledger)',

    'writeLocalJson(turnPath, ledger)',
    'writePrivateJson(file, { receipt: record })',
    'fs.writeFile(file, JSON.stringify({ compact: signed.compact }))',
    'writeFileSync(path.join(dir, "turn-1.json"), bytes)',
    'copyFileSync(source, path.join(dir, "session.bundle.json"))',
    'import { writePrivateJson as store } from "./private-fs.js"; store(destination, record)',
  ])
    assert.ok(
      receiptWriterViolations(source).length > 0,
      'unsafe call rejected',
    );
  assert.equal(
    receiptWriterViolations('writeReceiptJson(turnPath, ledger)').length,
    0,
  );
  assert.equal(
    receiptWriterViolations('writeReceiptBytes(path, bytes)').length,
    0,
  );
  // An approved local writer cannot gain a second write or change its target.
  const approved = ['writePrivateJson(statePath, state)'];
  assert.equal(
    receiptWriterViolations(
      'writePrivateJson(statePath, state); writePrivateJson(turnPath, ledger)',
      approved,
    ).length,
    1,
  );
  assert.equal(
    receiptWriterViolations('writePrivateJson(turnPath, ledger)', approved)
      .length,
    1,
  );
});

test('finalizing a resumed v1 receipt still signs its frozen v1 summary', async () => {
  const { ledger, session } = await signedLedger();
  ledger.receipt.public_claims.turn_summary_extension = 'zeroh-turn-summary/v1';
  const signed = await signTurnSummary({
    ledger,
    turn: 1,
    signer: session.signingKey,
  });
  assert.equal(signed.schema, 'zeroh-turn-summary/v1');
  assert.deepEqual(
    Object.keys(decodeCompactReceipt(signed.compact).payload.summary).sort(),
    [...LEGACY_TURN_SUMMARY_FIELDS].sort(),
  );
});

test('report collection tags previews and exports while preserving local bytes', async () => {
  const { session, ledger, p } = await signedLedger();
  const captured = [];
  const report = await buildLocalReport({ projectRoots: [], since: '7d' });
  await withReceiptSink(
    {
      write(item) {
        captured.push(item);
        return localFileReceiptSink.write(item);
      },
    },
    async () => {
      await writeTurn({ dir: session.dir, turn: 1, payload: ledger });
      await writeSessionReceiptHtml({
        session,
        env: { ...process.env, ZEROH_HOME: p.home },
      });
      await writeLocalReport({
        report,
        jsonPath: path.join(p.home, 'report.json'),
        htmlPath: path.join(p.home, 'report.html'),
      });
    },
  );
  assert.deepEqual(
    captured.map((item) => item.kind),
    ['receipt', 'receipt-html', 'report-export', 'report-export'],
  );
  for (const item of captured)
    assert.ok(item.bytes.equals(readFileSync(item.path)));
  assert.deepEqual(JSON.parse(captured[2].bytes), report);
  assert.deepEqual(
    captured
      .filter((item) => item.kind === 'receipt')
      .map((item) => path.basename(item.path)),
    ['turn-1.json'],
  );
});

for (const [name, source] of [
  ['writeSync', 'fs.writeSync(fd, receiptBytes)'],
  ['renameSync', 'fs.renameSync(staged, receiptPath)'],
  ['cpSync', 'fs.cpSync(source, receiptPath)'],
  ['file handle write', 'handle.write(receiptBytes)'],
  ['assigned alias', 'const w = fs.writeFileSync; w(receiptPath, bytes)'],
  ['bracket access', "fs['writeFileSync'](receiptPath, bytes)"],
]) {
  test(`receipt sink gate catches ${name} mutation`, () => {
    assert.equal(receiptWriterViolations(source).length, 1);
  });
}

test('a stdout exemption cannot authorize the same write on a file handle', () => {
  const approved = rawWriterCalls('process.stdout.write(receiptBytes)');
  assert.equal(
    receiptWriterViolations('handle.write(receiptBytes)', approved).length,
    1,
  );
});
