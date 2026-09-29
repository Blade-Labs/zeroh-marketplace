// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyDisclosurePolicy,
  ledgerFromDisclosureResult,
  markDisclosureResultCommitted,
} from '../lib/disclosure.js';
import {
  buildLocalReport,
  dateRangeLabel,
  formatLocalReport,
  formatSessionTokenMap,
  formatStopReceiptLine,
  formatStopTokenLine,
  stopTurnEvents,
  previewValue,
  RECEIPT_WIDTH,
  registerProjectRoot,
  registeredProjectRoots,
  renderReportHtml,
  sessionTokenMap,
  writeSessionReceiptHtml,
} from '../lib/report.js';
import { bumpTurn, loadSession, writeTurn } from '../lib/session.js';
import { signTurnSummary } from '../lib/turn-summary.js';
import { recordRevealedUnderGrant } from '../lib/unmask.js';
import { Vault } from '../lib/vault.js';

const FAKE_VALUE = 'person.ZEROHFAKE@example.com';
// Absolute paths as this system spells them (a drive on Windows): the lines
// show the resolved path.
const RECEIPT = path.resolve('/tmp/receipt.html');
const REPORT_HTML = path.resolve('/tmp/zeroh-fixture/report.html');
const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const SHOW = fileURLToPath(
  new URL('../commands/scripts/show.js', import.meta.url),
);

test('value previews reveal only the approved shape for each type', () => {
  assert.equal(
    previewValue('API_KEY', 'sk_live_ZEROHFAKE0000'),
    'sk_live…0000',
  );
  assert.equal(
    previewValue('EMAIL', 'person.ZEROHFAKE@example.com'),
    'p…@example.com',
  );
  assert.equal(
    previewValue('PHONE_NUMBER', '+97455551267'),
    'PHONE_NUMBER …67',
  );
  // Kinds only an engine or an older vault produced still preview by type.
  assert.equal(
    previewValue('US_BANK_NUMBER', '123456789012'),
    'US_BANK_NUMBER …12',
  );
  assert.equal(previewValue('API_KEY', '12345678'), '•••');
  assert.equal(previewValue('EMAIL', 'a@b.test'), '•••');
});

test('secret previews show only a prefix below 20 characters', () => {
  // 8 or fewer: nothing. 9 to 19: first 4 only. 20 or more: first 7 and last 4.
  assert.equal(previewValue('API_KEY', 'ZFAKE008'), '•••');
  assert.equal(previewValue('API_KEY', 'ZFAKE0009'), 'ZFAK…');
  assert.equal(previewValue('API_KEY', 'ZFAKE00000000000019'), 'ZFAK…');
  assert.equal(previewValue('API_KEY', 'ZFAKE000000000000020'), 'ZFAKE00…0020');
  for (const length of [9, 19]) {
    const value = 'Z'.repeat(length - 4) + 'TAIL';
    assert.doesNotMatch(previewValue('PASSWORD', value), /TAIL/);
  }
});

test('Stop line is human and hides default implementation names', () => {
  const ledger = {
    findings: [{ type: 'EMAIL' }, { type: 'PHONE_NUMBER' }],
    replacements: [
      { entity_type: 'EMAIL', replacement: '[EMAIL-a1b2c3]' },
      { entity_type: 'PHONE_NUMBER', replacement: '[PHONE_NUMBER-d4e5f6]' },
    ],
    receipt: {
      receipt_id: 'zrh_ZEROHFAKE',
      public_claims: {
        policy_id: 'zeroh-disclosure-v1',
        protection_engine_id: 'regex-local',
        raw_content_sent_to_ai_provider: false,
      },
    },
    audit: {
      masked: {
        token_map: [
          {
            token: '[EMAIL-a1b2c3]',
            type: 'EMAIL',
            channel: 'typed prompt',
            source: 'typed prompt',
            count: 1,
          },
          {
            token: '[PHONE_NUMBER-d4e5f6]',
            type: 'PHONE_NUMBER',
            channel: 'file read',
            source: 'customers.csv · line 2',
            count: 1,
          },
        ],
      },
    },
  };
  assert.equal(
    formatStopReceiptLine(5, ledger, RECEIPT),
    `ZeroH Disclosure · turn 5 · 2 values masked · receipt: ${RECEIPT}`,
  );
  const replacements = ledger.replacements;
  ledger.replacements = [];
  ledger.audit.masked.token_map = [];
  assert.equal(
    formatStopReceiptLine(5, ledger, RECEIPT),
    null,
    'a quiet turn prints nothing',
  );
  ledger.replacements = replacements;
  ledger.audit.masked.token_map = [];
  ledger.audit.masked.token_map.push({
    token: '[EMAIL-a1b2c3]',
    type: 'EMAIL',
    channel: 'typed prompt',
    source: 'typed prompt',
    count: 1,
  });
  ledger.receipt.public_claims.policy_id = 'example-policy-v1';
  ledger.receipt.public_claims.protection_engine_id = 'example-engine';
  assert.match(
    formatStopReceiptLine(5, ledger, RECEIPT),
    /policy example-policy-v1/,
  );
  assert.match(
    formatStopReceiptLine(5, ledger, RECEIPT),
    /engine example-engine/,
  );
});

test('Stop line names each kind of event and stays quiet otherwise', () => {
  const quiet = {
    phase: 'finalized',
    receipt: { receipt_id: 'zrh_ZEROHFAKE', public_claims: {} },
  };
  assert.deepEqual(stopTurnEvents(quiet), []);
  assert.equal(formatStopReceiptLine(2, quiet, RECEIPT), null);
  const busy = {
    phase: 'blocked_pending_user_resubmit',
    replacements: [{ entity_type: 'API_KEY', replacement: '[API_KEY-a1b2c3]' }],
    receipt: {
      receipt_id: 'zrh_ZEROHFAKE',
      public_claims: {},
      revealed_under_grant: [{ values: 2 }],
    },
    audit: {
      destinations: { blocked: { 'evil.example': 1 } },
      misses_reported: 1,
    },
    format_disclosure: { passed_unmasked: { image: 1 } },
  };
  assert.equal(
    formatStopReceiptLine(3, busy, RECEIPT),
    `ZeroH Disclosure · turn 3 · prompt stopped, 1 destination blocked, 2 values shown under your unmask, 1 file passed unchecked, 1 missed value reported · receipt: ${RECEIPT}`,
  );
  assert.deepEqual(
    stopTurnEvents({ ...busy, phase: 'finalized' }, { blocked: false })[0],
    '1 value masked',
  );
});

test('session receipt HTML expands verified turns without rendering fixture values', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-receipt-html-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-receipt-vault-'));
  const env = { ...process.env, ZEROH_HOME: home };
  const fakeKey = 'sk_live_ZEROHFAKE1111222233330000';
  try {
    const vault = new Vault(root, { env });
    const token = vault.tokenFor('API_KEY', fakeKey, 'known:STRIPE_KEY');
    vault.save();
    const { session, ledger } = await createTurn({
      root,
      env,
      sessionId: 'html-session',
      date: '2026-09-24T10:00:00.000Z',
      audit: {
        masked: {
          by_type: { API_KEY: 1 },
          by_channel: { 'file read': { API_KEY: 1 } },
          tokens: [token],
          token_map: [
            {
              token,
              type: 'API_KEY',
              channel: 'file read',
              source: '.env · line 1 · STRIPE_KEY',
              count: 2,
            },
          ],
        },
        files: { [path.join(root, '.env')]: 1 },
        destinations: {
          checked: { 'api.example.test': 1 },
          blocked: { 'blocked.example.test': 1 },
        },
      },
      formatDisclosure: { passed_unmasked: { image: 1 }, withheld: {} },
    });
    assert.ok(ledger.replacements.length > 0);
    const output = await writeSessionReceiptHtml({ session, env });
    const html = readFileSync(output.path, 'utf8');
    assert.match(html, /<details open>/);
    assert.match(html, /files read/);
    assert.match(html, /blocked\.example\.test/);
    assert.match(html, /Signature<\/dt><dd>Verified/);
    assert.match(html, /class="slip"/);
    assert.match(html, /RECEIPT · SESSION/);
    assert.match(html, /2026-09-24 · 1 turn</);
    assert.match(html, /values sent to Claude/);
    assert.match(html, /signed on this laptop · ECDSA P-256/);
    assert.match(html, /✓ verified 1 of 1/);
    assert.match(html, /passed unchecked: 1 file \(see below\)/);
    assert.match(html, /id="unchecked"/);
    assert.match(html, /@media print/);
    assert.match(html, /print-color-adjust:exact/);
    assertNoForbiddenNames(html);
    assert.match(html, /What the model saw this session/);
    assert.match(html, /in \.env, line 1 \(STRIPE_KEY\)/);
    assert.match(html, /sk_live…0000/);
    assert.match(html, /Turn 1/);
    assert.doesNotMatch(html, new RegExp(escapeRegExp(FAKE_VALUE)));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(fakeKey)));

    const map = await sessionTokenMap({
      projectRoot: root,
      sessionId: 'html-session',
      env,
    });
    assert.equal(map.rows[0].first_seen_turn, 1);
    assert.equal(map.rows[0].count, 2);
    const terminal = formatSessionTokenMap(map.rows, { previews: true });
    assert.match(terminal, /sk_live…0000/);
    // The default (model-visible) table has no value column at all.
    const modelVisible = formatSessionTokenMap(map.rows);
    assert.doesNotMatch(modelVisible, /sk_live…|Your value/);
    assert.match(
      modelVisible,
      /\[API_KEY-[0-9a-f]{6}\] \| API_KEY \| .* \| turn 1 \| 2/,
    );
    assert.doesNotMatch(terminal, new RegExp(escapeRegExp(fakeKey)));

    const tokensCli = spawnSync(
      process.execPath,
      [CLI, 'tokens', '--session', 'html-session'],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.equal(tokensCli.status, 0, tokensCli.stderr);
    assert.match(tokensCli.stdout, /what the model saw this session/i);
    assert.match(tokensCli.stdout, /sk_live…0000/);
    assert.doesNotMatch(tokensCli.stdout, new RegExp(escapeRegExp(fakeKey)));

    const maskShow = spawnSync(process.execPath, [SHOW], {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, CLAUDE_SESSION_ID: 'html-session' },
    });
    assert.equal(maskShow.status, 0, maskShow.stderr);
    assert.match(maskShow.stdout, /what the model saw this session/i);
    // /mask-show output is loaded into the model's context: no previews.
    assert.doesNotMatch(maskShow.stdout, /sk_live…|Your value/);
    assert.match(
      maskShow.stdout,
      /node ".*bin[\\/]zeroh-disclosure\.mjs" tokens/,
    );
    assert.doesNotMatch(maskShow.stdout, new RegExp(escapeRegExp(fakeKey)));

    const report = await buildLocalReport({
      projectRoots: [root],
      since: 'all',
    });
    assert.doesNotMatch(
      JSON.stringify(report),
      new RegExp(escapeRegExp(fakeKey)),
    );

    const cli = spawnSync(
      process.execPath,
      [CLI, 'receipt', '--session', 'html-session'],
      { cwd: root, encoding: 'utf8', env },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^RECEIPT · SESSION$/m);
    assert.match(cli.stdout, /✓ verified 1 of 1/);
    assert.match(cli.stdout, /^receipt\.html: .*receipt\.html$/m);
    assertSlipWidth(cli.stdout.split('\n\n')[0]);
    assertNoForbiddenNames(cli.stdout);
    assert.doesNotMatch(cli.stdout, new RegExp(escapeRegExp(FAKE_VALUE)));
    assert.doesNotMatch(cli.stdout, new RegExp(escapeRegExp(fakeKey)));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('local report aggregates fixture sessions, filters periods, and contains no values', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-report-'));
  try {
    await createTurn({
      root,
      sessionId: 'recent',
      date: '2026-09-24T10:00:00.000Z',
      audit: {
        masked: {
          by_type: { API_KEY: 2 },
          by_channel: {
            'command output': { API_KEY: 1 },
            'MCP result': { API_KEY: 1 },
          },
          tokens: ['[API_KEY-abcdef]'],
        },
        files: { [path.join(root, '.env')]: 2 },
        destinations: {
          checked: { 'blocked.example.test': 1 },
          blocked: { 'blocked.example.test': 1 },
        },
      },
      formatDisclosure: { passed_unmasked: { image: 1 }, withheld: {} },
      phase: 'blocked_pending_user_resubmit',
    });
    await createTurn({
      root,
      sessionId: 'old',
      date: '2026-07-01T10:00:00.000Z',
      audit: {
        masked: {
          by_type: { EMAIL: 4 },
          by_channel: { web: { EMAIL: 4 } },
          tokens: ['[EMAIL-123abc]'],
        },
      },
    });

    const now = new Date('2026-09-25T12:00:00.000Z');
    const recent = await buildLocalReport({
      projectRoots: [root],
      since: '7d',
      now,
    });
    assert.equal(recent.totals.receipts_found, 1);
    assert.equal(recent.totals.receipts_verified, 1);
    assert.equal(recent.totals.prompts_stopped, 1);
    assert.equal(
      valueFor(recent.masked_by_channel, 'channel', 'command output'),
      1,
    );
    assert.equal(
      valueFor(recent.masked_by_channel, 'channel', 'MCP result'),
      1,
    );
    assert.equal(
      valueFor(recent.destinations_blocked, 'host', 'blocked.example.test'),
      1,
    );
    assert.equal(
      valueFor(recent.formats_passed_unmasked, 'format', 'image'),
      1,
    );

    const all = await buildLocalReport({
      projectRoots: [root],
      since: 'all',
      now,
    });
    assert.equal(all.totals.receipts_found, 2);
    assert.equal(all.totals.receipts_verified, 2);
    assert.equal(valueFor(all.masked_by_channel, 'channel', 'web'), 4);

    const json = JSON.stringify(recent);
    const html = renderReportHtml(recent);
    assert.doesNotMatch(json, new RegExp(escapeRegExp(FAKE_VALUE)));
    assert.doesNotMatch(html, new RegExp(escapeRegExp(FAKE_VALUE)));
    assert.match(html, /@media print/);
    assert.match(html, /<svg/);
    assert.match(json, /local summary/i);
    assert.match(
      json,
      /ProofPack reports for auditors are planned for Premium \(waitlist\)\./,
    );
    assert.match(html, /class="slip"/);
    assert.match(html, /print-color-adjust:exact/);
    assertNoForbiddenNames(html);

    const jsonPath = path.join(root, 'local-summary.json');
    const htmlPath = path.join(root, 'local-summary.html');
    const cli = spawnSync(
      process.execPath,
      [CLI, 'report', '--since', 'all', '--json', jsonPath, '--html', htmlPath],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^RECEIPT · ALL TIME$/m);
    assert.match(cli.stdout, /^all time · 2 sessions · 2 turns$/m);
    assert.match(cli.stdout, /^report\.html: /m);
    assertNoForbiddenNames(cli.stdout);
    for (const output of [
      cli.stdout,
      readFileSync(jsonPath, 'utf8'),
      readFileSync(htmlPath, 'utf8'),
    ]) {
      assert.doesNotMatch(output, new RegExp(escapeRegExp(FAKE_VALUE)));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SessionStart project registry stores roots only and preserves concurrent projects', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-project-home-'));
  const first = mkdtempSync(path.join(os.tmpdir(), 'zeroh-project-first-'));
  const second = mkdtempSync(path.join(os.tmpdir(), 'zeroh-project-second-'));
  const env = { ZEROH_HOME: home };
  try {
    await Promise.all([
      registerProjectRoot({ cwd: first, env }),
      registerProjectRoot({ cwd: second, env }),
    ]);
    assert.deepEqual(
      await registeredProjectRoots({ env }),
      [first, second].sort(),
    );
    const registry = readFileSync(path.join(home, 'projects.json'), 'utf8');
    assert.match(registry, /zeroh-project-registry\/v1/);
    assert.doesNotMatch(registry, new RegExp(escapeRegExp(FAKE_VALUE)));
    assert.doesNotMatch(registry, /contents|files/u);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

async function createTurn({
  root,
  sessionId,
  date,
  audit = {},
  formatDisclosure = null,
  phase = 'finalized',
  extra = {},
  env = process.env,
}) {
  const session = await loadSession({ cwd: root, sessionId, env });
  const turn = await bumpTurn(session);
  const result = await applyDisclosurePolicy({
    text: `Contact ${FAKE_VALUE}`,
    session,
    cwd: root,
  });
  const ledger = {
    ...ledgerFromDisclosureResult({ turn, phase, result }),
    created_at: date,
    finalized_at: date,
    audit,
    ...(formatDisclosure ? { format_disclosure: formatDisclosure } : {}),
    ...extra,
  };
  // What Stop does: sign the turn summary the receipt requires.
  ledger.turn_summary = await signTurnSummary({
    ledger,
    turn,
    signer: session.signingKey,
  });
  await writeTurn({ dir: session.dir, turn, payload: ledger });
  await markDisclosureResultCommitted({ session, result });
  return { session, ledger };
}

const FIXTURE_REPORT = {
  schema: 'zeroh-disclosure-local-report/v1',
  kind: 'local_summary',
  generated_at: '2026-09-18T12:00:00.000Z',
  period: {
    label: '7d',
    start: '2026-09-11T12:00:00.000Z',
    end: '2026-09-18T12:00:00.000Z',
  },
  project: { scope: 'project', roots: ['/tmp/zeroh-fixture'] },
  notice: 'This is a local summary of evidence stored on this machine.',
  premium: 'ProofPack reports for auditors are planned for Premium (waitlist).',
  totals: {
    values_masked: 847,
    values_sent: 0,
    prompts_stopped: 0,
    receipts_found: 23,
    receipts_verified: 23,
    sessions: 5,
    turns: 23,
    files_passed_unchecked: 0,
  },
  latest_receipt_id: 'zrh_mfqq0z_5Kd2',
  latest_receipt_signing: 'ECDSA P-256',
  latest_receipt_html: null,
  masked_by_type: [
    { type: 'EMAIL', count: 414 },
    { type: 'PHONE_NUMBER', count: 414 },
    { type: 'IBAN', count: 10 },
    { type: 'API_KEY', count: 7 },
    { type: 'PRIVATE_KEY', count: 2 },
  ],
  masked_by_channel: [{ channel: 'file read', count: 847 }],
  per_day: [
    {
      date: '2026-09-17',
      masked: 847,
      sent: 0,
      prompts_stopped: 0,
      receipts: 23,
    },
  ],
  top_files: [],
  destinations_blocked: [],
  formats_passed_unmasked: [],
};

const FIXTURE_SLIP = [
  'RECEIPT · SEP 11–18',
  'ZeroH Disclosure · Receipt',
  'Sep 11–18 · 5 sessions · 23 turns',
  '- - - - - - - - - - - - - - - - - - - - - -',
  'API_KEY                                   ×7',
  'PRIVATE_KEY                               ×2',
  'EMAIL                                   ×414',
  'PHONE_NUMBER                            ×414',
  'IBAN                                     ×10',
  '────────────────────────────────────────────',
  'withheld                                 847',
  'values sent to Claude                      0',
  '- - - - - - - - - - - - - - - - - - - - - -',
  'receipt zrh_mfqq0z_5Kd2',
  'signed on this laptop · ECDSA P-256',
  '✓ verified 23 of 23',
  '/zeroh-disclosure:mask-show',
].join('\n');

test('period slip matches the till-slip snapshot and fits 44 columns', () => {
  const text = formatLocalReport(FIXTURE_REPORT, {
    html: REPORT_HTML,
  });
  assert.equal(text, `${FIXTURE_SLIP}\n\nreport.html: ${REPORT_HTML}`);
  assertSlipWidth(FIXTURE_SLIP);
  assertNoForbiddenNames(text);
});

test('the weekly slip is labelled by the dates it covers, across months and years', () => {
  assert.equal(
    dateRangeLabel('2026-09-28T12:00:00.000Z', '2026-10-05T12:00:00.000Z'),
    'Sep 28–Oct 5',
  );
  assert.equal(
    dateRangeLabel('2026-12-29T12:00:00.000Z', '2027-01-05T12:00:00.000Z'),
    'Dec 29, 2026–Jan 5, 2027',
  );
  const text = formatLocalReport(
    { ...FIXTURE_REPORT, period: { label: '7d', start: null, end: null } },
    {},
  );
  assert.match(text, /^RECEIPT · LAST 7 DAYS$/m);
});

test('slip is honest about grants, unchecked files, and empty periods', () => {
  const granted = formatLocalReport({
    ...FIXTURE_REPORT,
    totals: { ...FIXTURE_REPORT.totals, values_sent: 3 },
  });
  assert.match(granted, /^values sent to Claude {22}3$/m);
  assert.match(granted, /^shown under grants you approved: 3$/m);
  assert.match(granted, /^withheld {33}847$/m);
  const grantedHtml = renderReportHtml({
    ...FIXTURE_REPORT,
    totals: { ...FIXTURE_REPORT.totals, values_sent: 3 },
  });
  assert.match(grantedHtml, /class="slip-row slip-sent"/);
  assert.doesNotMatch(grantedHtml, /class="slip-row slip-sent-zero"/);
  assert.match(grantedHtml, /shown under grants you approved: 3/);

  const zeroHtml = renderReportHtml(FIXTURE_REPORT);
  assert.match(zeroHtml, /class="slip-row slip-sent-zero"/);
  assert.doesNotMatch(zeroHtml, /shown under grants/);
  assert.doesNotMatch(zeroHtml, /passed unchecked: /);

  const unchecked = {
    ...FIXTURE_REPORT,
    totals: { ...FIXTURE_REPORT.totals, files_passed_unchecked: 2 },
    formats_passed_unmasked: [
      { format: 'image', count: 2, notice: 'Images passed unmasked.' },
    ],
  };
  const uncheckedText = formatLocalReport(unchecked);
  assert.match(uncheckedText, /^passed unchecked: 2 files \(see below\)$/m);
  assert.match(uncheckedText, /^values sent to Claude {22}0$/m);
  assert.match(uncheckedText, /^ {2}image ×2\./m);
  for (const line of uncheckedText.split('\n')) {
    if (!line.startsWith('receipt.html') && !line.startsWith('report.html'))
      assert.ok([...line].length <= RECEIPT_WIDTH, line);
  }
  assert.match(
    renderReportHtml(unchecked),
    /<a href="#unchecked">passed unchecked: 2 files \(see below\)<\/a>/,
  );
});

test('empty period still renders a slip with nothing withheld', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-report-empty-'));
  try {
    const report = await buildLocalReport({
      projectRoots: [root],
      since: '30d',
      now: new Date('2026-09-25T12:00:00.000Z'),
    });
    const text = formatLocalReport(report);
    assert.match(text, /^RECEIPT · LAST 30 DAYS$/m);
    assert.match(text, /^last 30 days · 0 sessions · 0 turns$/m);
    assert.match(text, /^no sensitive values$/m);
    assert.match(text, /^withheld {35}0$/m);
    assert.match(text, /^values sent to Claude {22}0$/m);
    assert.match(text, /^no signed receipts yet$/m);
    assertSlipWidth(text.split('\n\n')[0]);
    const html = renderReportHtml(report);
    assert.match(html, /no sensitive values/);
    assert.match(html, /class="slip"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('values revealed under an unmask grant count as sent; unchecked formats never do', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-report-grant-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-report-grant-home-'));
  try {
    await createTurn({
      root,
      sessionId: 'granted',
      date: '2026-09-24T10:00:00.000Z',
      audit: {
        masked: {
          by_type: { API_KEY: 3 },
          by_channel: { 'file read': { API_KEY: 3 } },
        },
      },
      formatDisclosure: {
        passed_unmasked: { 'pdf passed, text layer sparse or absent': 2 },
        withheld: {},
      },
    });
    // An unmask-grant record: two EMAIL values shown under an approved grant.
    const entries = recordRevealedUnderGrant({
      root,
      home,
      sessionId: 'granted',
      grants: [{ id: 'ug_ZEROHFAKE', kind: 'EMAIL' }],
      revealed: [
        { type: 'EMAIL', count: 1 },
        { type: 'EMAIL', count: 1 },
      ],
    });
    assert.equal(entries[0].values, 2);
    // Stop signs the turn's summary after the reveal was recorded.
    const first = await loadSession({ cwd: root, sessionId: 'granted' });
    const firstPath = path.join(first.dir, 'turn-1.json');
    const firstLedger = JSON.parse(readFileSync(firstPath, 'utf8'));
    firstLedger.turn_summary = await signTurnSummary({
      ledger: firstLedger,
      turn: 1,
      signer: first.signingKey,
    });
    await writeTurn({ dir: first.dir, turn: 1, payload: firstLedger });
    await createTurn({
      root,
      sessionId: 'granted',
      date: '2026-09-24T11:00:00.000Z',
      formatDisclosure: { passed_unmasked: { image: 1 }, withheld: {} },
    });
    const report = await buildLocalReport({
      projectRoots: [root],
      since: 'all',
      now: new Date('2026-09-25T12:00:00.000Z'),
    });
    assert.equal(report.totals.values_sent, 2);
    assert.equal(report.totals.files_passed_unchecked, 3);
    assert.equal(report.totals.sessions, 1);
    assert.equal(report.totals.turns, 2);
    const text = formatLocalReport(report);
    assert.match(text, /^shown under grants you approved: 2$/m);
    assert.match(text, /^passed unchecked: 3 files \(see below\)$/m);
    // withheld is the sum of the per-type rows shown on the slip.
    const withheld = report.masked_by_type.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    assert.equal(withheld, report.totals.values_masked);
    assert.match(text, new RegExp(`^withheld +${withheld}$`, 'm'));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

function assertSlipWidth(text) {
  for (const line of text.split('\n')) {
    assert.ok([...line].length <= RECEIPT_WIDTH, `too wide: ${line}`);
  }
}

function assertNoForbiddenNames(text) {
  assert.doesNotMatch(text, /SD-JWT|ES256/);
  for (const match of text.matchAll(/[^.\n]*ProofPack[^.\n]*/g)) {
    assert.equal(
      match[0].trim(),
      'ProofPack reports for auditors are planned for Premium (waitlist)',
    );
  }
}

function valueFor(rows, key, value) {
  return rows.find((entry) => entry[key] === value)?.count ?? 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// T-20: the second Stop line names what the model saw, never a value.
test('the Stop token line shows three examples, then the rest by kind and source', () => {
  const entry = (token, channel, source, extra = {}) => ({
    token,
    type: token.slice(1, token.lastIndexOf('-')),
    channel,
    source,
    count: 1,
    ...extra,
  });
  const ledger = {
    phase: 'finalized',
    replacements: [{ replacement: '[EMAIL-000004]', entity_type: 'EMAIL' }],
    audit: {
      masked: {
        token_map: [
          entry('[API_KEY-000001]', 'file read', '.env · line 1 · STRIPE_KEY'),
          entry('[EMAIL-000002]', 'file read', 'docs/team.md · line 4'),
          entry('[TOKEN-000003]', 'command output', 'cat secrets', {
            name: 'GITHUB_TOKEN',
          }),
          entry('[SECRET-000005]', 'MCP result', 'mcp__vault__read'),
        ],
      },
    },
  };
  assert.equal(
    formatStopTokenLine(ledger),
    'Claude saw ⟦API_KEY-000001⟧ for STRIPE_KEY · ⟦SECRET-000005⟧ in mcp__vault__read output · ⟦TOKEN-000003⟧ for GITHUB_TOKEN · and 2 more: 1 email address in team.md, 1 email address in your message (receipt ↗ / /zeroh-disclosure:mask-show)',
  );
  assert.equal(formatStopTokenLine({ phase: 'finalized' }), null);
  assert.equal(
    formatStopTokenLine({ ...ledger, phase: 'blocked_pending_user_resubmit' }),
    null,
  );
});

// 1.0.1: the Stop line in plain words. Fake values only.
function stopLedger(entries) {
  return {
    phase: 'finalized',
    audit: { masked: { token_map: entries.map((e) => ({ count: 1, ...e })) } },
  };
}
const FAKE_KEY = `sk_test_${'51Fake'.padEnd(24, 'x')}c4Q2`;
function stopValues(n, { keys = 0 } = {}) {
  const entries = [];
  const values = new Map();
  for (let i = 0; i < n; i += 1) {
    const key = i < keys;
    const token = key
      ? `[API_KEY-${String(i).padStart(6, '0')}]`
      : `[EMAIL-${String(i).padStart(6, '0')}]`;
    values.set(token, key ? FAKE_KEY : `user${i}@acme.example`);
    entries.push(
      key
        ? {
            token,
            type: 'API_KEY',
            channel: 'file read',
            source: '.env · line 2',
          }
        : {
            token,
            type: 'EMAIL',
            channel: 'command output',
            source: 'cat signup-errors.log',
          },
    );
  }
  return {
    ledger: stopLedger(entries),
    valueOf: (token) => values.get(token) ?? null,
  };
}

test('the Stop line: 1, 3, 12 and 50 values, previews only, one line', () => {
  const one = stopValues(1);
  assert.equal(
    formatStopTokenLine(one.ledger, { valueOf: one.valueOf }),
    'Claude saw ⟦EMAIL-000000⟧, not u…@acme.example',
  );
  const three = stopValues(3, { keys: 1 });
  assert.equal(
    formatStopTokenLine(three.ledger, { valueOf: three.valueOf }),
    `Claude saw ⟦API_KEY-000000⟧ in .env (…c4Q2) · ⟦EMAIL-000001⟧, not u…@acme.example · ⟦EMAIL-000002⟧, not u…@acme.example`,
  );
  const twelve = stopValues(12, { keys: 2 });
  assert.equal(
    formatStopTokenLine(twelve.ledger, { valueOf: twelve.valueOf }),
    'Claude saw ⟦API_KEY-000000⟧ in .env (…c4Q2) · ⟦EMAIL-000002⟧, not u…@acme.example · ⟦API_KEY-000001⟧ in .env (…c4Q2) · and 9 more: 9 email addresses in signup-errors.log (receipt ↗ / /zeroh-disclosure:mask-show)',
  );
  const fifty = stopValues(50, { keys: 5 });
  const line = formatStopTokenLine(fifty.ledger, { valueOf: fifty.valueOf });
  assert.match(
    line,
    / · and 47 more: 44 email addresses in signup-errors\.log, 3 Stripe test secret keys in \.env \(receipt ↗ \/ \/zeroh-disclosure:mask-show\)$/u,
  );
  for (const { ledger, valueOf } of [one, three, twelve, fifty]) {
    const text = formatStopTokenLine(ledger, { valueOf });
    assert.ok(!text.includes(FAKE_KEY), 'no full key');
    assert.doesNotMatch(text, /user\d+@/u, 'no full email address');
    assert.doesNotMatch(text, /\n/u, 'one line');
    assert.doesNotMatch(text, /for typed|command output ·/u);
  }
  // Without the vault's values: where each example came from.
  assert.equal(
    formatStopTokenLine(twelve.ledger),
    'Claude saw ⟦API_KEY-000000⟧ in .env · ⟦EMAIL-000002⟧ in signup-errors.log · ⟦API_KEY-000001⟧ in .env · and 9 more: 9 email addresses in signup-errors.log (receipt ↗ / /zeroh-disclosure:mask-show)',
  );
});

test('the Stop line never shows the start of a typed password or key (B2)', () => {
  const password = 'HuntERZEROHF4ke!';
  const shortKey = 'sk_ZEROHFAKEshort01';
  const longKey = `ghp_${'ZEROHFAKE'.padEnd(32, 'q')}W9z1`;
  const connection = `postgres://app:ZEROHFAKEpw@db.example:5432/app`;
  const values = new Map([
    ['[PASSWORD-000003]', password],
    ['[API_KEY-000004]', shortKey],
    ['[TOKEN-000005]', longKey],
    ['[CONNECTION_STRING-000006]', connection],
  ]);
  const ledger = stopLedger(
    [...values.keys()].map((token) => ({
      token,
      type: token.slice(1).split('-')[0],
      channel: 'typed prompt',
      source: 'typed prompt',
    })),
  );
  const line = formatStopTokenLine(ledger, {
    valueOf: (token) => values.get(token) ?? null,
  });
  for (const value of [password, shortKey, longKey, connection]) {
    for (const size of [3, 4, 7])
      assert.ok(
        !line.includes(value.slice(0, size)),
        `no ${size}-character prefix of ${value.slice(0, 2)}… in: ${line}`,
      );
  }
  assert.match(line, /⟦PASSWORD-000003⟧ in your message(?! \()/u);
  assert.match(line, /⟦API_KEY-000004⟧ in your message(?! \()/u);
  assert.match(line, /⟦TOKEN-000005⟧ in your message \(…W9z1\)/u);
  assert.match(line, /1 connection string in your message/u);
});

test('the Stop line groups mixed sources in plain words', () => {
  const entries = [
    ['[EMAIL-00000a]', 'EMAIL', 'typed prompt', 'typed prompt'],
    ['[EMAIL-00000b]', 'EMAIL', 'typed prompt', 'typed prompt'],
    ['[EMAIL-00000c]', 'EMAIL', 'file read', 'docs/team.md · line 4'],
    ['[EMAIL-00000d]', 'EMAIL', 'file read', 'docs/team.md · line 5'],
    ['[PHONE_NUMBER-00000e]', 'PHONE_NUMBER', 'MCP result', 'mcp__crm__lookup'],
    [
      '[IP_ADDRESS-00000f]',
      'IP_ADDRESS',
      'command output',
      'kubectl get pods -o wide',
    ],
    [
      '[IP_ADDRESS-000010]',
      'IP_ADDRESS',
      'command output',
      'kubectl get pods -o wide',
    ],
    [
      '[PASSWORD-000011]',
      'PASSWORD',
      'file read',
      '.env · line 3 · DB_PASSWORD',
    ],
  ].map(([token, type, channel, source]) => ({ token, type, channel, source }));
  assert.equal(
    formatStopTokenLine(stopLedger(entries)),
    'Claude saw ⟦PASSWORD-000011⟧ for DB_PASSWORD · ⟦EMAIL-00000a⟧ in your message · ⟦IP_ADDRESS-00000f⟧ in command output · and 5 more: 2 email addresses in team.md, 1 email address in your message, 1 IP address in command output, 1 other (receipt ↗ / /zeroh-disclosure:mask-show)',
  );
});

test('one table of plain-English sources for the Stop line, mask-show and receipt.html', async () => {
  const { observationFrom, sourcePlace, channelWords } =
    await import('../lib/report-counts.js');
  const cases = [
    [
      { channel: 'typed prompt', source: 'typed prompt' },
      'in your message',
      'in your message',
    ],
    [
      { channel: 'file read', source: 'docs/team.md · line 4' },
      'in team.md',
      'in docs/team.md, line 4',
    ],
    [
      { channel: 'file read', source: '.env · line 1 · STRIPE_KEY' },
      'for STRIPE_KEY',
      'in .env, line 1 (STRIPE_KEY)',
    ],
    [
      { channel: 'command output', source: 'head -n 5 signup-errors.log' },
      'in signup-errors.log',
      'in command output: head -n 5 signup-errors.log',
    ],
    [
      { channel: 'command output', source: 'grep -n @ users.csv' },
      'in users.csv',
      'in command output: grep -n @ users.csv',
    ],
    [
      { channel: 'command output', source: 'cat a.log | grep x' },
      'in command output',
      'in command output: cat a.log | grep x',
    ],
    [
      { channel: 'MCP result', source: 'mcp__vault__read' },
      'in mcp__vault__read output',
      'in mcp__vault__read output',
    ],
    [
      { channel: 'command output', source: 'env', name: 'GITHUB_TOKEN' },
      'for GITHUB_TOKEN',
      'in command output: env, for GITHUB_TOKEN',
    ],
  ];
  for (const [entry, place, full] of cases) {
    assert.equal(sourcePlace(entry), place, JSON.stringify(entry));
    assert.equal(observationFrom(entry), full, JSON.stringify(entry));
  }
  assert.equal(channelWords('typed prompt'), 'your messages');
  assert.equal(channelWords('file read'), 'files read');
});
