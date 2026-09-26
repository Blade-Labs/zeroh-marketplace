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
import { recordRevealedUnderGrant } from '../lib/unmask.js';
import { Vault } from '../lib/vault.js';

const FAKE_VALUE = 'person.ZEROHFAKE@example.com';
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
    formatStopReceiptLine(5, ledger, '/tmp/receipt.html'),
    'ZeroH Disclosure · turn 5 · 2 values masked · receipt: /tmp/receipt.html',
  );
  const replacements = ledger.replacements;
  ledger.replacements = [];
  ledger.audit.masked.token_map = [];
  assert.equal(
    formatStopReceiptLine(5, ledger, '/tmp/receipt.html'),
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
    formatStopReceiptLine(5, ledger, '/tmp/receipt.html'),
    /policy example-policy-v1/,
  );
  assert.match(
    formatStopReceiptLine(5, ledger, '/tmp/receipt.html'),
    /engine example-engine/,
  );
});

test('Stop line names each kind of event and stays quiet otherwise', () => {
  const quiet = {
    phase: 'finalized',
    receipt: { receipt_id: 'zrh_ZEROHFAKE', public_claims: {} },
  };
  assert.deepEqual(stopTurnEvents(quiet), []);
  assert.equal(formatStopReceiptLine(2, quiet, '/tmp/receipt.html'), null);
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
    formatStopReceiptLine(3, busy, '/tmp/receipt.html'),
    'ZeroH Disclosure · turn 3 · prompt stopped, 1 destination blocked, 2 values shown under your unmask grant, 1 file passed unchecked, 1 missed value reported · receipt: /tmp/receipt.html',
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
    assert.match(html, /file read/);
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
    assert.match(html, /\.env · line 1 · STRIPE_KEY/);
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
    assert.match(maskShow.stdout, /node ".*bin\/zeroh-disclosure\.mjs" tokens/);
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
    html: '/tmp/zeroh-fixture/report.html',
  });
  assert.equal(
    text,
    `${FIXTURE_SLIP}\n\nreport.html: /tmp/zeroh-fixture/report.html`,
  );
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
test('the Stop token line lists at most three tokens with their source', () => {
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
    'Claude saw ⟦API_KEY-000001⟧ for STRIPE_KEY · ⟦EMAIL-000002⟧ for team.md · ⟦SECRET-000005⟧ for mcp__vault__read · +2 more · /zeroh-disclosure:mask-show',
  );
  assert.equal(formatStopTokenLine({ phase: 'finalized' }), null);
  assert.equal(
    formatStopTokenLine({ ...ledger, phase: 'blocked_pending_user_resubmit' }),
    null,
  );
});
