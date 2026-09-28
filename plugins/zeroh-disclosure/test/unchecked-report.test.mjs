// SPDX-License-Identifier: AGPL-3.0-only

// What passed without a check (the default uncertain mode, pass) is counted
// on the turn by PostToolUse for formats ZeroH cannot read, and shown by the
// session receipt, /zeroh-disclosure:report and the HTML pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PLUGIN, runHook, stateDirOf, tempProject } from './helpers.mjs';
import { renderReceiptHtml, renderReportHtml } from '../lib/report-html.js';
import { formatLocalReport } from '../lib/report-slip.js';
import { uncheckedRows } from '../lib/report.js';

const SHAPES = JSON.parse(
  readFileSync(
    new URL('./fixtures/read-response-shapes-2.1.281.json', import.meta.url),
    'utf8',
  ),
);

function withTurn() {
  const project = tempProject();
  const prompt = runHook(
    'user-prompt-submit',
    { prompt: 'Inspect the requested fixture.' },
    { project },
  );
  assert.equal(prompt.code, 0, prompt.stderr);
  return project;
}

function ledger(project) {
  return JSON.parse(
    readFileSync(
      path.join(stateDirOf(project), 'sessions', 'test', 'turn-1.json'),
      'utf8',
    ),
  );
}

function script(project, name, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'commands', 'scripts', name), ...args],
    {
      cwd: project.dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: project.home,
        ZEROH_HOME: project.home,
        CLAUDE_SESSION_ID: 'test',
        CLAUDE_PROJECT_DIR: project.dir,
      },
    },
  );
}

test('PostToolUse counts images and MCP image blocks as unknown-format, and text as nothing', () => {
  const project = withTurn();
  const image = runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: path.join(project.dir, 'shot.png') },
      tool_response: structuredClone(SHAPES[1].tool_response),
    },
    { project },
  );
  assert.equal(image.code, 0, image.stderr);
  const mcp = runHook(
    'post-tool-use',
    {
      tool_name: 'mcp__browser__screenshot',
      tool_input: {},
      tool_response: [
        { type: 'text', text: 'Page captured.' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
      ],
    },
    { project },
  );
  assert.equal(mcp.code, 0, mcp.stderr);
  const text = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { stdout: 'a\nb', stderr: '' },
    },
    { project },
  );
  assert.equal(text.code, 0, text.stderr);
  assert.deepEqual(ledger(project).audit.unchecked, {
    'unknown-format': { Read: 1, mcp__browser__screenshot: 1 },
  });

  // The session receipt (/zeroh-disclosure:mask-receipt) lists them by reason.
  const receipt = script(project, 'receipt.js');
  assert.equal(receipt.status, 0, receipt.stderr);
  assert.match(receipt.stdout, /^not protected \(uncertain=pass\):$/mu);
  assert.match(receipt.stdout, /^ {2}unreadable format \(image, scan\) ×2$/mu);
});

test('/zeroh-disclosure:report and the HTML pages show passed-unchecked counts per reason', () => {
  const rows = uncheckedRows({
    'dynamic-destination': 3,
    'watchdog-timeout': 1,
  });
  assert.deepEqual(
    rows.map(({ reason, count }) => [reason, count]),
    [
      ['dynamic-destination', 3],
      ['watchdog-timeout', 1],
    ],
  );
  const report = {
    schema: 'zeroh-disclosure-local-report/v1',
    kind: 'local_summary',
    generated_at: '2026-09-27T12:00:00.000Z',
    period: { label: 'all', start: null, end: '2026-09-27T12:00:00.000Z' },
    project: { scope: 'project', roots: ['/tmp/zeroh-fixture'] },
    notice: 'Local summary.',
    premium: 'Premium.',
    totals: {
      values_masked: 0,
      values_sent: 0,
      prompts_stopped: 0,
      receipts_found: 1,
      receipts_verified: 1,
      sessions: 1,
      turns: 1,
      files_passed_unchecked: 0,
      passed_unchecked: 4,
    },
    latest_receipt_id: '-',
    latest_receipt_signing: null,
    latest_receipt_html: null,
    masked_by_type: [],
    masked_by_channel: [],
    per_day: [],
    top_files: [],
    destinations_blocked: [],
    formats_passed_unmasked: [],
    passed_unchecked: rows,
  };
  const text = formatLocalReport(report);
  assert.match(text, /^not protected \(uncertain=pass\):$/mu);
  assert.match(text, /^ {2}destination set at run time ×3$/mu);
  assert.match(text, /^ {2}check took too long ×1$/mu);
  const html = renderReportHtml(report);
  assert.match(html, /id="passed-without-check"/u);
  assert.match(html, /check took too long ×1/u);
  // A report with nothing passed unchecked has no such section.
  assert.doesNotMatch(
    renderReportHtml({ ...report, passed_unchecked: [] }),
    /passed-without-check/u,
  );
  const receipt = renderReceiptHtml({
    summaries: [
      {
        turn: 1,
        date: '2026-09-27',
        values_masked: 0,
        values_sent: 0,
        masked_by_type: {},
        masked_by_channel: {},
        token_map: [],
        destinations_checked: {},
        destinations_blocked: {},
        formats_passed_unmasked: {},
        passed_unchecked: { unparseable: 2 },
        receipt_id: '-',
        policy_id: '-',
        engine_id: '-',
        verified: true,
        signature_ok: true,
      },
    ],
    tokenMap: [],
  });
  assert.match(receipt, /command ZeroH could not parse ×2/u);
});

test('the /zeroh-disclosure:report script prints the counts from real turns', () => {
  const project = withTurn();
  runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: path.join(project.dir, 'shot.png') },
      tool_response: structuredClone(SHAPES[1].tool_response),
    },
    { project },
  );
  const stop = runHook('stop', {}, { project });
  assert.equal(stop.code, 0, stop.stderr);
  const report = script(project, 'report.js', ['all']);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^ {2}unreadable format \(image, scan\) ×1$/mu);
});
