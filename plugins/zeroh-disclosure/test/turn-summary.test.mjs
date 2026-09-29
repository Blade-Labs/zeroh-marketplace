// SPDX-License-Identifier: AGPL-3.0-only

// The signed receipt covers every number the receipt shows (Windows rc.2
// finding 4): the prompt receipt is signed at UserPromptSubmit, the turn's
// summary (tool output and file reads masked, values sent, what passed
// unchecked) at Stop, and verify fails when any shown number changes.
// Receipts written before 1.0.0 still verify, labelled as covering the typed
// prompt only.
import './helpers.mjs';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyDisclosurePolicy,
  buildSessionReceiptBundle,
  ledgerFromDisclosureResult,
} from '../lib/disclosure.js';
import { shownTurnSummary } from '../lib/report.js';
import { formatSlipText, sessionSlip } from '../lib/report-slip.js';
import { canonicalJson, sha256B64u } from '../lib/crypto.js';
import { loadSession } from '../lib/session.js';
import {
  signTurnSummary,
  TURN_SUMMARY_FIELDS,
  TURN_SUMMARY_SCHEMA,
  turnSummary,
} from '../lib/turn-summary.js';
import { createSignedReceipt } from '../lib/selective-disclosure.js';
import {
  verifyReceiptArtifact,
  verifyReceiptBundleArtifact,
} from '../lib/verify-receipt.js';
import { runHook, stateDirOf, tempProject } from './helpers.mjs';

const FIXTURE = new URL('./fixtures/receipt-1.0.0-rc.3/', import.meta.url);

const AUDIT = {
  masked: {
    by_type: { API_KEY: 2, EMAIL: 1 },
    by_channel: {
      'file read': { API_KEY: 2 },
      'command output': { EMAIL: 1 },
    },
    tokens: ['[API_KEY-0a0a0a]', '[EMAIL-0b0b0b]'],
    token_map: [
      {
        token: '[API_KEY-0a0a0a]',
        type: 'API_KEY',
        channel: 'file read',
        source: '.env · line 1 · STRIPE_KEY',
        count: 2,
      },
    ],
  },
  files: { '/tmp/zeroh-fixture/.env': 2 },
  destinations: {
    checked: { 'api.stripe.com': 1 },
    blocked: { 'blocked.example.test': 1 },
  },
  unchecked: {
    'unknown-format': { Read: 1 },
    'dynamic-destination': { Bash: 2 },
  },
  sent_unmasked: { count: 2, by_type: { API_KEY: 1, EMAIL: 1 } },
  misses_reported: 1,
};

async function signedTurn(dir, { phase = 'finalized', audit = AUDIT } = {}) {
  const session = await loadSession({ cwd: dir, sessionId: 'ZEROHFAKE-sum' });
  const result = await applyDisclosurePolicy({
    text: 'Contact zerohfake.person@example.com about the env file.',
    session,
    cwd: dir,
  });
  const ledger = {
    ...ledgerFromDisclosureResult({ turn: 1, phase, result }),
    audit: structuredClone(audit),
    format_disclosure: { passed_unmasked: { image: 1 }, withheld: {} },
  };
  ledger.turn_summary = await signTurnSummary({
    ledger,
    turn: 1,
    signer: session.signingKey,
  });
  const file = path.join(dir, 'turn-1.json');
  writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  return { session, ledger, file };
}

function tempDir(name) {
  return mkdtempSync(path.join(os.tmpdir(), `zeroh-turn-summary-${name}-`));
}

test('a 1.0.0 receipt requires the turn summary, and the summary covers every shown number', async () => {
  const dir = tempDir('roundtrip');
  try {
    const { ledger, file } = await signedTurn(dir);
    assert.equal(
      ledger.receipt.public_claims.turn_summary_extension,
      TURN_SUMMARY_SCHEMA,
    );
    const result = await verifyReceiptArtifact(file);
    assert.equal(result.ok, true, result.failed.join(', '));
    assert.equal(result.coverage, 'turn');
    const summary = turnSummary(ledger);
    assert.deepEqual(summary.masked_by_channel, {
      'typed prompt': summary.masked_by_channel['typed prompt'],
      'file read': { API_KEY: 2 },
      'command output': { EMAIL: 1 },
    });
    assert.deepEqual(summary.passed_unchecked, {
      'unknown-format': 1,
      'dynamic-destination': 2,
    });
    assert.deepEqual(summary.formats_passed_unmasked, { image: 1 });
    assert.equal(summary.values_sent, 2);
    assert.equal(summary.sent_unmasked.count, 2);
    assert.equal(summary.misses_reported, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Architect review 1.0.0: the v1 contract is frozen before it ships. No
// published release signed a summary, so there is no older v1 shape to
// accept; a new field is a v2 schema (docs/receipt-format.md).
test('the v1 summary is frozen: exactly these fields, and a new one means v2', () => {
  assert.ok(Object.isFrozen(TURN_SUMMARY_FIELDS));
  assert.deepEqual(
    [...TURN_SUMMARY_FIELDS].sort(),
    [
      'destinations_blocked',
      'destinations_checked',
      'files',
      'formats_passed_unmasked',
      'formats_withheld',
      'masked_by_channel',
      'masked_by_type',
      'misses_reported',
      'passed_unchecked',
      'prompt',
      'sent_under_grant',
      'sent_unmasked',
      'token_map',
      'tokens',
      'values_masked',
      'values_sent',
      'values_sent_to_ai_provider',
    ],
    'zeroh-turn-summary/v1 is frozen: a new summary field needs zeroh-turn-summary/v2',
  );
  assert.deepEqual(
    Object.keys(turnSummary({})).sort(),
    [...TURN_SUMMARY_FIELDS].sort(),
  );
  // The turn-level claim is named apart from the prompt receipt's.
  assert.equal(
    Object.hasOwn(turnSummary({}), 'raw_content_sent_to_ai_provider'),
    false,
  );
});

test('a v1 summary missing a field, or with one more, fails verification', async () => {
  const dir = tempDir('frozen');
  try {
    const { session, ledger, file } = await signedTurn(dir);
    assert.equal(turnSummary(ledger).values_sent_to_ai_provider, true);
    assert.equal((await verifyReceiptArtifact(file)).ok, true);
    const summary = turnSummary(ledger);
    const { values_sent_to_ai_provider: dropped, ...missing } = summary;
    void dropped;
    for (const variant of [
      missing,
      { ...summary, raw_content_sent_to_ai_provider: true },
    ]) {
      const signed = await createSignedReceipt({
        signer: session.signingKey,
        publicClaims: {
          schema: TURN_SUMMARY_SCHEMA,
          receipt_id: ledger.receipt.receipt_id,
          receipt_hash:
            ledger.receipt.receipt_hash ??
            (await sha256B64u(ledger.receipt.compact ?? '')),
          turn: 1,
          iat: new Date().toISOString(),
          summary: variant,
        },
        selectiveClaims: {},
      });
      writeFileSync(
        file,
        JSON.stringify({
          ...ledger,
          turn_summary: {
            schema: TURN_SUMMARY_SCHEMA,
            compact: signed.compact,
          },
        }),
      );
      const result = await verifyReceiptArtifact(file);
      assert.equal(result.ok, false, Object.keys(variant).join(','));
      assert.match(
        result.checks.find(({ name }) => name === 'turn_summary').detail,
        /fields are not those of zeroh-turn-summary\/v1/u,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changing any number the receipt shows fails verification', async () => {
  const dir = tempDir('tamper');
  try {
    const { ledger, file } = await signedTurn(dir);
    const tampers = {
      'file-read masking count': (l) => {
        l.audit.masked.by_channel['file read'].API_KEY = 1;
      },
      'command output masking removed': (l) => {
        delete l.audit.masked.by_channel['command output'];
      },
      'masked tokens': (l) => {
        l.audit.masked.tokens.pop();
      },
      'token map count': (l) => {
        l.audit.masked.token_map[0].count = 9;
      },
      'unchecked reason count': (l) => {
        l.audit.unchecked['dynamic-destination'].Bash = 1;
      },
      'unchecked reason removed': (l) => {
        delete l.audit.unchecked['unknown-format'];
      },
      'unchecked reason added': (l) => {
        l.audit.unchecked['watchdog-timeout'] = { Bash: 1 };
      },
      'formats passed unchecked': (l) => {
        l.format_disclosure.passed_unmasked = {};
      },
      'typed values sent': (l) => {
        l.audit.sent_unmasked.count = 0;
      },
      'blocked destinations': (l) => {
        l.audit.destinations.blocked = {};
      },
      'file counts': (l) => {
        l.audit.files['/tmp/zeroh-fixture/.env'] = 1;
      },
      'misses reported': (l) => {
        l.audit.misses_reported = 0;
      },
      'typed prompt masking': (l) => {
        l.replacements = [];
      },
      'summary dropped': (l) => {
        delete l.turn_summary;
      },
    };
    for (const [name, change] of Object.entries(tampers)) {
      const copy = structuredClone(ledger);
      change(copy);
      writeFileSync(file, JSON.stringify(copy));
      const result = await verifyReceiptArtifact(file);
      assert.equal(result.ok, false, `${name} must fail verification`);
      assert.ok(result.failed.includes('turn_summary'), name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a summary signed for another receipt or with another key fails', async () => {
  const one = tempDir('one');
  const two = tempDir('two');
  try {
    const first = await signedTurn(one);
    const second = await signedTurn(two);
    // Another session's summary: another key and another receipt.
    const swapped = structuredClone(first.ledger);
    swapped.turn_summary = second.ledger.turn_summary;
    writeFileSync(first.file, JSON.stringify(swapped));
    let result = await verifyReceiptArtifact(first.file);
    assert.equal(result.ok, false);
    assert.match(
      result.checks.find(({ name }) => name === 'turn_summary').detail,
      /signature/u,
    );
    // Same key, summary of another receipt of the same session.
    const session = await loadSession({
      cwd: one,
      sessionId: 'ZEROHFAKE-sum',
    });
    const other = await applyDisclosurePolicy({
      text: 'another prompt',
      session,
      cwd: one,
    });
    const otherLedger = {
      ...ledgerFromDisclosureResult({
        turn: 2,
        phase: 'finalized',
        result: other,
      }),
      audit: structuredClone(AUDIT),
      format_disclosure: { passed_unmasked: { image: 1 }, withheld: {} },
    };
    const rebound = structuredClone(first.ledger);
    rebound.turn_summary = await signTurnSummary({
      ledger: otherLedger,
      turn: 1,
      signer: session.signingKey,
    });
    writeFileSync(first.file, JSON.stringify(rebound));
    result = await verifyReceiptArtifact(first.file);
    assert.equal(result.ok, false);
    assert.match(
      result.checks.find(({ name }) => name === 'turn_summary').detail,
      /another receipt/u,
    );
  } finally {
    rmSync(one, { recursive: true, force: true });
    rmSync(two, { recursive: true, force: true });
  }
});

test('the receipt shows the signed numbers, and says when they no longer match', async () => {
  const dir = tempDir('shown');
  try {
    const { ledger, file } = await signedTurn(dir);
    const tampered = structuredClone(ledger);
    tampered.audit.masked.by_channel['file read'].API_KEY = 40;
    tampered.audit.sent_unmasked.count = 0;
    const { summary, coverage } = shownTurnSummary(tampered);
    assert.equal(coverage, 'turn');
    assert.deepEqual(summary.masked_by_channel['file read'], { API_KEY: 2 });
    assert.equal(summary.values_sent, 2);
    writeFileSync(file, JSON.stringify(tampered));
    const result = await verifyReceiptArtifact(file);
    assert.equal(result.ok, false);
    assert.match(
      result.checks.find(({ name }) => name === 'turn_summary').detail,
      /masked_by_channel/u,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a turn still running is pending, not verified and not failed', async () => {
  const dir = tempDir('pending');
  try {
    const session = await loadSession({
      cwd: dir,
      sessionId: 'ZEROHFAKE-pending',
    });
    const result = await applyDisclosurePolicy({
      text: 'still running',
      session,
      cwd: dir,
    });
    const ledger = ledgerFromDisclosureResult({
      turn: 1,
      phase: 'masked_by_proxy',
      result,
    });
    const file = path.join(dir, 'turn-1.json');
    writeFileSync(file, JSON.stringify(ledger));
    const verification = await verifyReceiptArtifact(file);
    assert.equal(verification.ok, true, verification.failed.join(', '));
    assert.equal(verification.coverage, 'pending');
    const slip = sessionSlip([
      {
        date: '2026-09-28',
        values_sent: 0,
        verified: true,
        coverage: 'pending',
      },
    ]);
    const text = formatSlipText(slip);
    assert.match(text, /turn in progress: signed when it ends/u);
    assert.doesNotMatch(text, /✓ verified/u);
    // Finalised without a summary: required, so it fails.
    writeFileSync(file, JSON.stringify({ ...ledger, phase: 'finalized' }));
    assert.equal((await verifyReceiptArtifact(file)).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a receipt written by 1.0.0-rc.3 still verifies and is labelled as covering the typed prompt only', async () => {
  const dir = tempDir('legacy');
  const home = tempDir('legacy-home');
  const previousHome = process.env.ZEROH_HOME;
  try {
    // Its reveal extension is checked with the local allow key it was
    // written under.
    writeFileSync(
      path.join(home, 'allow.key'),
      Buffer.from(
        readFileSync(new URL('allow.key.b64', FIXTURE), 'utf8').trim(),
        'base64',
      ),
    );
    process.env.ZEROH_HOME = home;
    const file = path.join(dir, 'turn-1.json');
    const ledger = JSON.parse(
      readFileSync(new URL('turn-1.json', FIXTURE), 'utf8'),
    );
    assert.equal(
      ledger.receipt.public_claims.turn_summary_extension,
      undefined,
    );
    writeFileSync(file, JSON.stringify(ledger));
    const result = await verifyReceiptArtifact(file);
    assert.equal(result.ok, true, result.failed.join(', '));
    assert.equal(result.coverage, 'typed-prompt');
    assert.equal(
      result.checks.some(({ name }) => name === 'turn_summary'),
      false,
    );
    const { coverage } = shownTurnSummary(ledger);
    assert.equal(coverage, 'typed-prompt');
    const slip = sessionSlip([
      {
        date: '2026-09-28',
        values_sent: 0,
        verified: true,
        coverage: 'typed-prompt',
      },
    ]);
    assert.match(
      formatSlipText(slip),
      /1 receipt from before 1\.0\.0 signs the\s+typed\s+prompt only/u,
    );
    // Its signed prompt claims are still protected.
    ledger.receipt.public_claims.decision_action = 'block';
    writeFileSync(file, JSON.stringify(ledger));
    assert.equal((await verifyReceiptArtifact(file)).ok, false);
  } finally {
    if (previousHome === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Stop signs the turn summary, and the bundle carries it', () => {
  const project = tempProject();
  const prompt = runHook(
    'user-prompt-submit',
    { prompt: 'Read the env file please.' },
    { project },
  );
  assert.equal(prompt.code, 0, prompt.stderr);
  const envPath = path.join(project.dir, '.env');
  const read = runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: envPath },
      tool_response: {
        type: 'text',
        file: {
          filePath: envPath,
          content: readFileSync(envPath, 'utf8'),
          numLines: 1,
          startLine: 1,
          totalLines: 1,
        },
      },
    },
    { project },
  );
  assert.equal(read.code, 0, read.stderr);
  const stop = runHook('stop', {}, { project });
  assert.equal(stop.code, 0, stop.stderr);
  const sessionDir = path.join(stateDirOf(project), 'sessions', 'test');
  const ledgerPath = path.join(sessionDir, 'turn-1.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.turn_summary.schema, TURN_SUMMARY_SCHEMA);
  const fileRead = ledger.audit.masked.by_channel['file read'];
  assert.ok(fileRead, 'the Read was masked');
  return (async () => {
    // The reveal extension is checked with the project's local allow key.
    const previousHome = process.env.ZEROH_HOME;
    process.env.ZEROH_HOME = project.home;
    try {
      await checkStopReceipt();
    } finally {
      if (previousHome === undefined) delete process.env.ZEROH_HOME;
      else process.env.ZEROH_HOME = previousHome;
    }
  })();
  async function checkStopReceipt() {
    const good = await verifyReceiptArtifact(ledgerPath);
    assert.equal(good.ok, true, good.failed.join(', '));
    assert.equal(good.coverage, 'turn');
    const bundle = await verifyReceiptBundleArtifact(
      path.join(sessionDir, 'session.bundle.json'),
    );
    assert.equal(bundle.ok, true, bundle.failed.join(', '));
    const [type] = Object.keys(fileRead);
    ledger.audit.masked.by_channel['file read'][type] += 1;
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const bad = await verifyReceiptArtifact(ledgerPath);
    assert.equal(bad.ok, false);
    assert.ok(bad.failed.includes('turn_summary'));
    // A bundle whose summary was swapped out fails as well.
    const bundlePath = path.join(sessionDir, 'session.bundle.json');
    const document = JSON.parse(readFileSync(bundlePath, 'utf8'));
    delete document.receipts[0].turn_summary;
    delete document.bundle_hash;
    document.bundle_hash = await sha256B64u(canonicalJson(document));
    mkdirSync(path.join(sessionDir, 'copy'), { recursive: true });
    const copy = path.join(sessionDir, 'copy', 'session.bundle.json');
    writeFileSync(copy, JSON.stringify(document));
    const stripped = await verifyReceiptBundleArtifact(copy);
    assert.equal(stripped.ok, false);
    assert.deepEqual(stripped.failed, ['receipt_1_verifies']);
  }
});

test('the bundle builder keeps each turn summary', async () => {
  const dir = tempDir('bundle');
  try {
    const { session, ledger } = await signedTurn(dir);
    writeFileSync(
      path.join(session.dir, 'turn-1.json'),
      JSON.stringify(ledger),
    );
    const built = await buildSessionReceiptBundle({ session });
    assert.equal(
      built.bundle.receipts[0].turn_summary.compact,
      ledger.turn_summary.compact,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
