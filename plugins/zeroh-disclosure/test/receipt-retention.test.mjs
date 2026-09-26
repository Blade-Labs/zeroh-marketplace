// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  pruneReceipts,
  receiptRetention,
  retentionLine,
  retentionNote,
} from '../lib/receipt-retention.js';
import { buildBanner } from '../lib/banner.js';
import { commitmentKeyPath, projectDataDir } from '../lib/session.js';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-26T12:00:00.000Z');

// A project with one session per age (days), each with a turn record, a
// receipt page and a commitment key, and a vault file beside them.
function fixture(ages) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retention-home-'));
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retention-proj-'));
  const env = { ...process.env, ZEROH_HOME: home };
  const sessions = path.join(projectDataDir(root, env), 'sessions');
  for (const age of ages) {
    const dir = path.join(sessions, `s${age}`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['turn-1.json', 'receipt.html', 'session.bundle.json']) {
      const file = path.join(dir, name);
      writeFileSync(file, '{}');
      const at = new Date(NOW - age * DAY);
      utimesSync(file, at, at);
    }
    const key = commitmentKeyPath(root, `s${age}`, env);
    mkdirSync(path.dirname(key), { recursive: true });
    writeFileSync(key, Buffer.alloc(32));
  }
  const vault = path.join(home, 'vault', 'project.json');
  mkdirSync(path.dirname(vault), { recursive: true });
  writeFileSync(vault, '{"v":2}');
  return { home, root, env, sessions, vault };
}

function kept(sessions) {
  return [0, 20, 60, 200, 400].filter((age) =>
    existsSync(path.join(sessions, `s${age}`)),
  );
}

test('receipts are kept for 90 days by default, and each window prunes what is older', () => {
  assert.equal(receiptRetention({}), '90d');
  assert.equal(receiptRetention({ ZEROH_RECEIPT_RETENTION: 'bogus' }), '90d');
  assert.equal(
    retentionLine({}),
    'Receipts: kept on this computer for 90 days; they contain no values.',
  );
  for (const [setting, expected] of [
    [undefined, [0, 20, 60]],
    ['30d', [0, 20]],
    ['90d', [0, 20, 60]],
    ['1y', [0, 20, 60, 200]],
    ['forever', [0, 20, 60, 200, 400]],
  ]) {
    const f = fixture([0, 20, 60, 200, 400]);
    const env = setting
      ? { ...f.env, ZEROH_RECEIPT_RETENTION: setting }
      : f.env;
    pruneReceipts({ env, roots: [f.root], now: NOW });
    assert.deepEqual(kept(f.sessions), expected, String(setting));
    // A pruned session's commitment key goes with it; the vault stays.
    assert.equal(
      existsSync(commitmentKeyPath(f.root, 's400', f.env)),
      expected.includes(400),
    );
    assert.equal(readFileSync(f.vault, 'utf8'), '{"v":2}');
  }
});

test('pruning never removes the current session and runs at most once a day', () => {
  const f = fixture([0, 200, 400]);
  const first = pruneReceipts({
    env: f.env,
    roots: [f.root],
    currentSessionId: 's400',
    now: NOW,
  });
  assert.equal(first.removed, 1);
  assert.deepEqual(kept(f.sessions), [0, 400]);
  // The same day: skipped, even for a session that is old now.
  const again = pruneReceipts({ env: f.env, roots: [f.root], now: NOW + 1000 });
  assert.equal(again.skipped, true);
  assert.deepEqual(kept(f.sessions), [0, 400]);
  const tomorrow = pruneReceipts({
    env: f.env,
    roots: [f.root],
    now: NOW + DAY + 1000,
  });
  assert.equal(tomorrow.removed, 1);
  assert.deepEqual(kept(f.sessions), [0]);
});

function effectiveRetention({ user = null, repo = null, environment = null }) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retention-cfg-'));
  const project = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retention-repo-'));
  if (user)
    writeFileSync(
      path.join(home, 'config.env'),
      `ZEROH_RECEIPT_RETENTION=${user}\n`,
    );
  if (repo)
    writeFileSync(
      path.join(project, '.zeroh.env'),
      `ZEROH_RECEIPT_RETENTION=${repo}\n`,
    );
  const env = { PATH: process.env.PATH, HOME: home, ZEROH_HOME: home };
  if (environment) env.ZEROH_RECEIPT_RETENTION = environment;
  const result = spawnSync(
    process.execPath,
    [
      path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'),
      'receipts',
      '--json',
      '--cwd',
      project,
    ],
    { env, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).retention;
}

test("a repository's .zeroh.env may only shorten the receipt retention", () => {
  assert.equal(effectiveRetention({ repo: '30d' }), '30d');
  assert.equal(effectiveRetention({ repo: 'forever' }), '90d');
  assert.equal(effectiveRetention({ repo: '1y' }), '90d');
  assert.equal(effectiveRetention({ user: 'forever', repo: '1y' }), '1y');
  assert.equal(effectiveRetention({ user: 'forever' }), 'forever');
  assert.equal(effectiveRetention({ environment: '1y', repo: '30d' }), '30d');
  assert.equal(effectiveRetention({ environment: '30d', repo: '1y' }), '30d');
});

test('`receipts keep` writes the user-level setting and keeps other lines', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retention-cli-'));
  writeFileSync(
    path.join(home, 'config.env'),
    'ZEROH_BANNER=compact\nZEROH_RECEIPT_RETENTION=30d\n',
  );
  const env = { PATH: process.env.PATH, HOME: home, ZEROH_HOME: home };
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'receipts', ...args],
      { env, encoding: 'utf8' },
    );
  const kept = run('keep', 'forever');
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /kept on this computer until you uninstall/u);
  assert.equal(
    readFileSync(path.join(home, 'config.env'), 'utf8'),
    'ZEROH_BANNER=compact\nZEROH_RECEIPT_RETENTION=forever\n',
  );
  const bad = run('keep', '5d');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /forever, 1y, 90d, 30d/u);
});

test('status shows the policy in one line; a report says when its period reaches past it', () => {
  const full = buildBanner({
    mode: 'full',
    proxy: 'on',
    retention: retentionLine({ ZEROH_RECEIPT_RETENTION: '30d' }),
  }).text;
  assert.match(
    full,
    /\nReceipts: kept on this computer for 30 days; they contain no values\.\n/u,
  );
  assert.equal(retentionNote(7 * DAY, {}), null);
  assert.equal(retentionNote(90 * DAY, {}), null);
  assert.match(
    retentionNote(null, {}),
    /^Receipts older than 90 days are removed \(ZEROH_RECEIPT_RETENTION=90d\), so older periods are not in this report\.$/u,
  );
  assert.equal(
    retentionNote(null, { ZEROH_RECEIPT_RETENTION: 'forever' }),
    null,
  );
});
