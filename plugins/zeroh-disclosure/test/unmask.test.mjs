// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  activeGrants,
  capFor,
  claimUnmaskMcpSession,
  consumeUnmaskMcpSession,
  createGrant,
  durationOptionsForCap,
  durationResultText,
  endGrants,
  grantsFilePath,
  readCaps,
  readGrantStore,
  revokeGrants,
  unmaskDialog,
  writeCap,
} from '../lib/unmask.js';

const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const UNMASK_URL = pathToFileURL(
  new URL('../lib/unmask.js', import.meta.url).pathname,
).href;

function fixture() {
  return {
    root: mkdtempSync(path.join(os.tmpdir(), 'zeroh-unmask-project-')),
    home: mkdtempSync(path.join(os.tmpdir(), 'zeroh-unmask-home-')),
  };
}

function runGrantChild({ root, home }, action, value) {
  const source = [
    `import { createGrant, revokeGrants } from ${JSON.stringify(UNMASK_URL)};`,
    "if (process.argv[1] === 'create') createGrant({ root: process.argv[2], kind: 'EMAIL', reason: process.argv[3], duration: '15m' });",
    'else revokeGrants(process.argv[2], process.argv[3]);',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', source, action, root, value],
      {
        env: { ...process.env, ZEROH_HOME: home },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`grant child exited ${code}: ${stderr}`));
    });
  });
}

test('signed caps filter durations and ignore a hand edit', () => {
  const { home } = fixture();
  // T-32: by default every duration is offered.
  assert.equal(capFor('EMAIL', home), 'session');
  assert.deepEqual(
    durationOptionsForCap(capFor('EMAIL', home)).map(({ label }) => label),
    ['15 minutes', '1 hour', 'Until the session ends'],
  );
  assert.deepEqual(
    durationOptionsForCap('1h').map(({ label }) => label),
    ['15 minutes', '1 hour'],
  );
  writeCap('EMAIL', '15m', { home });
  assert.equal(capFor('EMAIL', home), '15m');
  assert.deepEqual(
    durationOptionsForCap(capFor('EMAIL', home)).map(({ label }) => label),
    ['15 minutes'],
  );
  assert.throws(() => writeCap('API_KEY', '15m', { home }), /fixed at 0/u);

  const file = path.join(home, 'unmask.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.caps.EMAIL = '1h';
  writeFileSync(file, JSON.stringify(document));
  const loaded = readCaps(home);
  assert.equal(loaded.ignored, true);
  assert.equal(loaded.caps.EMAIL, 'session');
});

// T-32: three durations unless the cap removes some, and then the dialog
// says so.
test('the unmask dialog offers every allowed duration and names a limiting cap', () => {
  const open = unmaskDialog('EMAIL', ' match rows ', 'session');
  assert.deepEqual(
    open.options.map(({ label }) => label),
    ['15 minutes', '1 hour', 'Until the session ends'],
  );
  assert.equal(
    open.message,
    'Claude asks to see real EMAIL values.\nWhy: match rows',
  );
  const capped = unmaskDialog('EMAIL', 'match rows', '15m');
  assert.deepEqual(
    capped.options.map(({ label }) => label),
    ['15 minutes'],
  );
  assert.match(capped.message, /limited by your cap for EMAIL/u);
  assert.deepEqual(unmaskDialog('EMAIL', 'x', '0').options, []);
});

// T-33: the model may end grants (never create or extend them); the grant
// text says how to end one early.
test('end_unmask ends grants of one kind or all, and the grant text says how', () => {
  const { root, home } = fixture();
  const now = Date.parse('2026-09-25T10:00:00.000Z');
  const email = createGrant({
    root,
    home,
    kind: 'EMAIL',
    reason: 'Inspect a fake row',
    duration: '15m',
    now,
  });
  createGrant({
    root,
    home,
    kind: 'PHONE_NUMBER',
    reason: 'Inspect a fake row',
    duration: '1h',
    now,
  });
  assert.match(
    durationResultText(email, '15 minutes'),
    /^EMAIL unmasked for 15 minutes, until [^·]+ · to end it early, tell Claude or run \/zeroh-disclosure:unmask revoke$/u,
  );
  assert.deepEqual(endGrants(root, 'IBAN', { home }), []);
  const ended = endGrants(root, 'email', { home, now: now + 60_000 });
  assert.deepEqual(
    ended.map(({ kind }) => kind),
    ['EMAIL'],
  );
  assert.deepEqual(
    activeGrants(root, { home, now: now + 60_000 }).map(({ kind }) => kind),
    ['PHONE_NUMBER'],
  );
  endGrants(root, 'all', { home, now: now + 60_000 });
  const store = readGrantStore(root, home);
  assert.deepEqual(store.grants, []);
  assert.deepEqual(
    store.receipts.map(({ action, kind }) => `${action}:${kind}`),
    [
      'grant:EMAIL',
      'grant:PHONE_NUMBER',
      'revoke:EMAIL',
      'revoke:PHONE_NUMBER',
    ],
  );
});

test('signed grants expire, stay in their session, revoke, and ignore hand edits', () => {
  const { root, home } = fixture();
  const now = Date.parse('2026-09-25T10:00:00.000Z');
  const timed = createGrant({
    root,
    home,
    kind: 'EMAIL',
    reason: 'Inspect a fake customer row',
    duration: '15m',
    now,
  });
  assert.deepEqual(
    activeGrants(root, { home, sessionId: 'one', now: now + 14 * 60_000 }).map(
      ({ id }) => id,
    ),
    [timed.id],
  );
  assert.equal(
    activeGrants(root, { home, sessionId: 'one', now: now + 15 * 60_000 })
      .length,
    0,
  );

  const session = createGrant({
    root,
    home,
    kind: 'PHONE_NUMBER',
    reason: 'Check a fake phone',
    duration: 'session',
    sessionId: 'session-one',
    now,
  });
  assert.equal(
    activeGrants(root, { home, sessionId: 'session-one', now }).some(
      ({ id }) => id === session.id,
    ),
    true,
  );
  assert.equal(
    activeGrants(root, { home, sessionId: 'session-two', now }).some(
      ({ id }) => id === session.id,
    ),
    false,
  );

  assert.deepEqual(revokeGrants(root, session.id, { home, now }), [session]);
  const afterRevoke = readGrantStore(root, home);
  assert.equal(
    afterRevoke.grants.some(({ id }) => id === session.id),
    false,
  );
  assert.equal(
    afterRevoke.receipts.some(
      (entry) => entry.action === 'revoke' && entry.grant_id === session.id,
    ),
    true,
  );

  const file = grantsFilePath(root, home);
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.store.grants[0].reason = 'hand edited';
  writeFileSync(file, JSON.stringify(document));
  const tampered = readGrantStore(root, home);
  assert.equal(tampered.ignored, true);
  assert.deepEqual(tampered.grants, []);
});

test('parallel grant and revoke updates preserve every signed receipt', async () => {
  const project = fixture();
  const reasons = Array.from(
    { length: 8 },
    (_, index) => `Inspect fake email row ${index}`,
  );
  await Promise.all(
    reasons.map((reason) => runGrantChild(project, 'create', reason)),
  );
  const created = readGrantStore(project.root, project.home);
  assert.equal(created.grants.length, reasons.length);
  assert.equal(created.receipts.length, reasons.length);
  await Promise.all(
    created.grants.map(({ id }) => runGrantChild(project, 'revoke', id)),
  );
  const revoked = readGrantStore(project.root, project.home);
  assert.equal(revoked.grants.length, 0);
  assert.equal(revoked.receipts.length, reasons.length * 2);
});

test('the MCP session handoff is short-lived and project-scoped', () => {
  const { root, home } = fixture();
  const now = Date.parse('2026-09-25T10:00:00.000Z');
  assert.equal(
    claimUnmaskMcpSession(root, 'mcp-session-one', { home, now }),
    true,
  );
  assert.equal(
    claimUnmaskMcpSession(root, 'mcp-session-two', { home, now }),
    false,
  );
  assert.equal(
    claimUnmaskMcpSession(root, 'mcp-session-one', { home, now }),
    false,
  );
  assert.equal(consumeUnmaskMcpSession(root, { home, now }), 'mcp-session-one');
  assert.equal(consumeUnmaskMcpSession(root, { home, now }), null);
});

test('the CLI sets caps, lists grants, prints status, and revokes', () => {
  const { root, home } = fixture();
  const run = (...args) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, ZEROH_HOME: home },
      encoding: 'utf8',
    });
  const cap = run('unmask', 'caps', 'EMAIL', '15m');
  assert.equal(cap.status, 0, cap.stderr);
  assert.match(cap.stdout, /EMAIL unmask cap: 15m/u);
  assert.match(run('unmask', 'caps', '--list').stdout, /EMAIL: 15m/u);

  const grant = createGrant({
    root,
    home,
    kind: 'EMAIL',
    reason: 'Match customers across two exports',
    duration: '15m',
  });
  assert.match(run('unmask').stdout, new RegExp(grant.id));
  assert.match(run('statusline').stdout, /EMAIL unmasked/u);
  const revoke = run('unmask', 'revoke', grant.id);
  assert.equal(revoke.status, 0, revoke.stderr);
  assert.match(revoke.stdout, /Revoked 1 unmask grant/u);
  assert.deepEqual(readGrantStore(root, home).grants, []);
});

test('the CLI turns "unmask KIND why" into a request and explains how to ask', () => {
  const { root, home } = fixture();
  const run = (...args) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: home, ZEROH_HOME: home },
      encoding: 'utf8',
    });
  const empty = run('unmask');
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /No active unmask grants\./u);
  assert.match(
    empty.stdout,
    /To ask Claude to unmask a kind: \/zeroh-disclosure:unmask EMAIL <why>/u,
  );
  assert.doesNotMatch(empty.stdout, /again with a reason/u);

  const request = run('unmask', 'email', 'match', 'customers');
  assert.equal(request.status, 0, request.stderr);
  assert.match(
    request.stdout,
    /^Unmask request: kind EMAIL, reason "match customers"\./mu,
  );
  assert.deepEqual(
    readGrantStore(root, home).grants,
    [],
    'no grant without the dialog',
  );

  const noReason = run('unmask', 'EMAIL');
  assert.match(noReason.stdout, /\/zeroh-disclosure:unmask EMAIL <why>/u);
  assert.doesNotMatch(noReason.stdout, /^Unmask request:/mu);

  const key = run('unmask', 'API_KEY', 'debug');
  assert.equal(key.status, 0, key.stderr);
  assert.match(key.stdout, /Keys are never unmasked/u);
  assert.doesNotMatch(key.stdout, /^Unmask request:/mu);

  const unknown = run('unmask', 'SHOE_SIZE', 'why');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown unmask kind SHOE_SIZE/u);
});

test('the unmask command may call the plugin request_unmask tool it names', () => {
  const plugin = path.dirname(path.dirname(CLI));
  const source = readFileSync(
    path.join(plugin, 'commands', 'unmask.md'),
    'utf8',
  );
  const mcp = JSON.parse(readFileSync(path.join(plugin, '.mcp.json'), 'utf8'));
  const manifest = JSON.parse(
    readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  const [server] = Object.keys(mcp.mcpServers);
  const tool = `mcp__plugin_${manifest.name}_${server}__request_unmask`;
  const allowed = source.match(/^allowed-tools: (.+)$/mu)[1].split(/,\s*/u);
  assert.ok(allowed.includes(tool), tool);
  assert.ok(
    allowed.includes(
      'Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask *)',
    ),
  );
  assert.ok(
    allowed.includes(
      'PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs" unmask *)',
    ),
  );
  assert.equal(allowed.includes('Bash'), false, 'no unrestricted Bash');
  assert.equal(
    allowed.includes('PowerShell'),
    false,
    'no unrestricted PowerShell',
  );
  assert.match(
    source,
    /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/zeroh-disclosure\.mjs" unmask \$ARGUMENTS`$/mu,
  );
  assert.match(
    source,
    /starts with `Unmask request:`, call the `request_unmask` tool/u,
  );
});
