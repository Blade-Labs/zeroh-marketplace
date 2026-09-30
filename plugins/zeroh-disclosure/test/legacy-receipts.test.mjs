// SPDX-License-Identifier: AGPL-3.0-only

// Receipts ZeroH Disclosure 0.1.1 wrote inside a project
// (<project>/.zeroh/sessions/<sid>/, its lib/session.js) survive doctor
// --fix and uninstall (PR #516 review, 1.0.2): doctor never touches them;
// uninstall copies their public part to the kept-receipts folder, never a
// private key or a typed value, and leaves a folder that still holds one.
// Uninstall also removes the plugin last, after every module it needs is
// loaded: here the fake `claude plugin uninstall` deletes the plugin folder
// the CLI runs from, as Claude Code may.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { registerProjectRoot } from '../lib/report.js';
import { asUser } from './as-user.mjs';
import { fakeProgram, isolatedProxyEnvironment, PLUGIN } from './helpers.mjs';

const SECRET = 'sk_live_ZEROHFAKElegacy0000000000';
const PRIVATE_D = 'ZEROHFAKE-wallet-private-d';
const HMAC_KEY = 'ZEROHFAKE-session-hmac-key';

// A session folder as 0.1.1 left it. `finalised`: Stop ran, so the turn
// holds no typed text; the private files are left out with `publicOnly`.
function legacySession(dir, { finalised = false, publicOnly = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const put = (name, value) =>
    writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
  put('wallet.json', {
    accountId: '0.0.1234',
    network: 'testnet',
    publicJwk: { kty: 'EC', crv: 'P-256', x: 'ZEROHFAKEx', y: 'ZEROHFAKEy' },
  });
  put('turn-1.json', {
    turn: 1,
    phase: 'finalized',
    sanitized_text: 'key [API_KEY_1]',
    receipt: {
      receipt_id: `rcpt-${path.basename(dir)}`,
      receipt_hash: 'ZEROHFAKEhash',
      compact_sdjwt: 'ZEROHFAKE.compact',
    },
    ...(finalised ? {} : { local_private: { original_text: `key ${SECRET}` } }),
  });
  put('turn-1.proofpack.json', { schema: 'proofpack', turn: 1 });
  put('event-1.json', { schema: 'evidence', sequence: 1 });
  if (publicOnly) return;
  put('state.json', { sid: path.basename(dir), hmacKeyB64u: HMAC_KEY });
  put('wallet.key.json', { kty: 'EC', crv: 'P-256', d: PRIVATE_D });
  put('tool-toolu_1.json', { local_private: { original: SECRET } });
}

function snapshot(dir) {
  return readdirSync(dir, { recursive: true })
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).isFile())
    .sort()
    .map((file) => [file, readFileSync(file, 'utf8')]);
}

async function setup(name) {
  const isolated = isolatedProxyEnvironment(name);
  const env = { ...isolated.env, ZEROH_PROXY: 'off' };
  // Two projects ZeroH knows, each with a 0.1.1 folder: one as a session
  // left it (keys, typed values), one with only public files.
  const withKeys = path.join(isolated.root, 'with-keys');
  const publicOnly = path.join(isolated.root, 'public-only');
  const empty = path.join(isolated.root, 'empty');
  for (const root of [withKeys, publicOnly, empty]) {
    mkdirSync(root, { recursive: true });
    await registerProjectRoot({ cwd: root, env });
  }
  const keysFolder = path.join(withKeys, '.zeroh');
  const publicFolder = path.join(publicOnly, '.zeroh');
  const emptyFolder = path.join(empty, '.zeroh');
  legacySession(path.join(keysFolder, 'sessions', 'sess-a'));
  writeFileSync(path.join(keysFolder, '.gitignore'), '*\n');
  legacySession(path.join(publicFolder, 'sessions', 'sess-b'), {
    finalised: true,
    publicOnly: true,
  });
  mkdirSync(path.join(emptyFolder, 'sessions', 'old'), { recursive: true });
  writeFileSync(path.join(emptyFolder, '.gitignore'), '*\n');
  const before = [...snapshot(keysFolder), ...snapshot(publicFolder)];

  // The CLI runs from its own plugin folder, which `claude plugin
  // uninstall` deletes; the fake records what ZEROH_HOME held then.
  const plugin = path.join(isolated.root, 'plugin');
  for (const name of ['lib', 'bin', 'vendor', '.claude-plugin']) {
    cpSync(path.join(PLUGIN, name), path.join(plugin, name), {
      recursive: true,
    });
  }
  const cli = path.join(plugin, 'bin', 'zeroh-disclosure.mjs');
  const calls = path.join(isolated.root, 'claude-calls.txt');
  const fakeClaude = path.join(isolated.root, 'fake-claude.mjs');
  writeFileSync(
    fakeClaude,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync, existsSync, readdirSync, rmSync } from 'node:fs';",
      `const home = ${JSON.stringify(env.ZEROH_HOME)};`,
      "const args = process.argv.slice(2).join(' ');",
      "if (process.argv[3] === 'list') { appendFileSync(" +
        JSON.stringify(calls) +
        ", args + '\\n'); console.log(JSON.stringify([{ id: 'zeroh-disclosure@zeroh', scope: 'user' }])); }",
      "if (process.argv[3] === 'uninstall') {",
      `  appendFileSync(${JSON.stringify(calls)}, args + ' | home: ' + (existsSync(home) ? readdirSync(home).join(',') : '-') + '\\n');`,
      `  rmSync(${JSON.stringify(plugin)}, { recursive: true, force: true });`,
      '}',
    ].join('\n'),
    { mode: 0o755 },
  );
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, [cli, ...args], {
      env: asUser(args, { ...env, ...extra }),
      cwd: withKeys,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });

  return {
    before,
    calls,
    emptyFolder,
    env,
    fakeClaude,
    keysFolder,
    plugin,
    publicFolder,
    receiptsDir: `${path.resolve(env.ZEROH_HOME)}-receipts`,
    run,
  };
}

test('doctor --fix never deletes receipts ZeroH Disclosure 0.1 kept in a project', async () => {
  const { before, emptyFolder, keysFolder, publicFolder, run } =
    await setup('legacy-doctor');
  // Only the empty folder goes; receipts and keys stay as they were, and
  // it says so.
  const doctor = run(['doctor', '--fix']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.deepEqual(
    [...snapshot(keysFolder), ...snapshot(publicFolder)],
    before,
  );
  assert.equal(existsSync(emptyFolder), false);
  const doctorText = doctor.stdout.replace(/\s+/gu, ' ');
  assert.ok(doctorText.includes(`Left ${keysFolder}`), doctor.stdout);
  assert.ok(doctorText.includes(`Left ${publicFolder}`), doctor.stdout);
  assert.match(doctorText, /doctor never touches receipts/u);
});

test('uninstall keeps the public part of 0.1 receipts in a project and leaves a folder with keys or typed values', async () => {
  const { before, fakeClaude, keysFolder, publicFolder, receiptsDir, run } =
    await setup('legacy-uninstall');
  const logDir = path.join(path.dirname(keysFolder), 'removal-log');
  mkdirSync(logDir);
  const removed = run(['uninstall', '--yes'], {
    ZEROH_REMOVAL_LOG_DIR: logDir,
    ZEROH_CLAUDE_BIN: fakeProgram(fakeClaude),
  });
  assert.equal(existsSync(logDir), true);
  assert.equal(
    removed.stdout.trimEnd().split('\n').at(-1),
    `Remaining steps: delete ${keysFolder} with rm -rf "${keysFolder}"`,
  );
  assert.equal(removed.status, 0, removed.stderr);
  const text = removed.stdout.replace(/\s+/gu, ' ');
  // The folder with keys and typed values stays, untouched, and the user
  // is told where it is and how to delete it.
  assert.deepEqual(
    snapshot(keysFolder),
    before.slice(0, snapshot(keysFolder).length),
  );
  assert.ok(
    text.includes(`Left ${keysFolder}`) &&
      text.includes(`rm -rf "${keysFolder}"`),
    removed.stdout,
  );
  // The public-only folder is kept elsewhere in full, so it goes.
  assert.equal(existsSync(publicFolder), false);
  assert.match(
    text,
    /Kept 4 receipt\(s\) and ProofPack\(s\) of ZeroH Disclosure 0\.1/u,
  );
  const kept = snapshot(path.join(receiptsDir, 'legacy'));
  const names = kept.map(([file]) => path.basename(file)).sort();
  assert.deepEqual(names, [
    'event-1.json',
    'event-1.json',
    'turn-1.json',
    'turn-1.json',
    'turn-1.proofpack.json',
    'turn-1.proofpack.json',
    'wallet.json',
    'wallet.json',
  ]);
  for (const [file, content] of kept) {
    for (const value of [SECRET, PRIVATE_D, HMAC_KEY, 'local_private']) {
      assert.ok(!content.includes(value), `${file} holds ${value}`);
    }
  }
  const manifest = JSON.parse(
    readFileSync(path.join(receiptsDir, 'zeroh-receipts.json'), 'utf8'),
  );
  assert.deepEqual(Object.keys(manifest.legacy_receipts).sort(), [
    'rcpt-sess-a',
    'rcpt-sess-b',
  ]);
});

test("uninstall does ZeroH's own cleanup first and removes the plugin, whose folder it runs from, last", async () => {
  const { calls, fakeClaude, plugin, receiptsDir, run } =
    await setup('legacy-order');
  const removed = run(['uninstall', '--yes'], {
    ZEROH_CLAUDE_BIN: fakeProgram(fakeClaude),
  });
  assert.equal(removed.status, 0, removed.stderr);
  // When Claude Code removed the plugin, only the tombstone was left.
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    'plugin list --json',
    'plugin uninstall zeroh-disclosure@zeroh --scope user | home: uninstalled',
  ]);
  assert.equal(existsSync(plugin), false);
  const text = removed.stdout.replace(/\s+/gu, ' ');
  assert.match(
    text,
    /Removed the plugin from Claude Code \(zeroh-disclosure@zeroh, user\)/u,
  );
  assert.ok(existsSync(path.join(receiptsDir, 'zeroh-receipts.json')));
  assert.match(text, /To install it again: claude plugin install/u);
});

test('uninstall --delete-receipts leaves the folders of ZeroH Disclosure 0.1 in place and says how to delete them', async () => {
  const { before, fakeClaude, keysFolder, publicFolder, receiptsDir, run } =
    await setup('legacy-delete');
  const removed = run(['uninstall', '--yes', '--delete-receipts'], {
    ZEROH_CLAUDE_BIN: fakeProgram(fakeClaude),
  });
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(
    [...snapshot(keysFolder), ...snapshot(publicFolder)],
    before,
  );
  assert.equal(existsSync(path.join(receiptsDir, 'legacy')), false);
  const text = removed.stdout.replace(/\s+/gu, ' ');
  for (const folder of [keysFolder, publicFolder]) {
    assert.ok(
      text.includes(`Left ${folder}`) && text.includes(`rm -rf "${folder}"`),
      removed.stdout,
    );
  }
});
