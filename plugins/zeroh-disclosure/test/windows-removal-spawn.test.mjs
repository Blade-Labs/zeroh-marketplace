// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import * as fs from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('Windows removal hides the detached child, Claude commands and scheduled tasks', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalSpawn = childProcess.default.spawn;
  const originalSpawnSync = childProcess.default.spawnSync;
  const originalExec = childProcess.default.execFileSync;
  const calls = [];
  Object.defineProperty(process, 'platform', {
    value: 'win32',
    configurable: true,
  });
  childProcess.default.spawn = (file, args, options) => {
    calls.push({ file, args, options });
    return { pid: 424242, unref() {} };
  };
  childProcess.default.spawnSync = (file, args, options) => {
    calls.push({ file, args, options });
    return { status: 0, stdout: '123456789\n' };
  };
  childProcess.default.execFileSync = (file, args, options) => {
    calls.push({ file, args, options });
    if (String(file).endsWith('whoami.exe')) return '"user","S-1-5-21-123"';
    if (args.includes('list')) return '[{"id":"zeroh-disclosure@zeroh"}]';
    return '';
  };
  syncBuiltinESMExports();
  try {
    const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-win-removal-test-'));
    const env = {
      ...process.env,
      USERPROFILE: path.join(base, 'profile'),
      ZEROH_HOME: path.join(base, 'zeroh'),
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'windows-removal',
    };
    const { recordPending, handleManagementPrompt } =
      await import('../lib/user-authority.js');
    const { removePlugin } = await import('../lib/plugin-removal.js');
    const { createServiceManager } = await import('../lib/service-manager.js');
    const { acquireFileLock, releaseFileLock, VAULT_LOCK } =
      await import('../lib/vault.js');
    for (const [name, options] of [
      ['vault', VAULT_LOCK],
      ['proxy', { reclaimDeadOwner: true }],
      [
        'removal',
        { waitMs: 0, staleMs: 24 * 60 * 60 * 1_000, reclaimDeadOwner: true },
      ],
    ]) {
      const file = path.join(base, `${name}.lock`);
      releaseFileLock(acquireFileLock(file, options));
      assert.equal(existsSync(file), false);
    }
    assert.deepEqual(calls, [], 'lock acquisition must not spawn a process');
    recordPending({
      argv: ['uninstall', '--yes'],
      sessionId: 'windows-removal',
      env,
    });
    const result = handleManagementPrompt({
      prompt: '/zeroh-disclosure:uninstall',
      sessionId: 'windows-removal',
      cwd: base,
      env,
    });
    assert.equal(result.applied, true, result.message);
    assert.equal(removePlugin(env).removed.length, 1);
    const manager = createServiceManager({
      env,
      platform: 'win32',
      definitionRoot: path.join(base, 'service'),
      executeCommands: true,
      execute: (file, args, options) => calls.push({ file, args, options }),
    });
    manager.register({
      runtime: path.join(base, 'runtime'),
      config: path.join(base, 'config'),
    });
    manager.unregister();
    for (const call of calls.filter(
      ({ file }) =>
        file === process.execPath ||
        /(?:cmd|schtasks)\.exe$/iu.test(String(file)) ||
        file === 'claude',
    )) {
      assert.equal(
        call.options.windowsHide,
        true,
        `${call.file} must stay hidden`,
      );
    }
    assert.ok(calls.some(({ file }) => file === process.execPath));
    assert.ok(calls.some(({ file }) => /schtasks\.exe$/iu.test(String(file))));
    assert.ok(calls.some(({ file }) => file === 'claude'));
  } finally {
    childProcess.default.spawn = originalSpawn;
    childProcess.default.spawnSync = originalSpawnSync;
    childProcess.default.execFileSync = originalExec;
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

test('a swapped live lock survives stale reclaim and blocks another holder', async () => {
  const { acquireFileLock, releaseFileLock, VAULT_LOCK } =
    await import('../lib/vault.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-lock-swap-test-'));
  const file = path.join(base, 'vault.lock');
  const displaced = path.join(base, 'displaced.lock');
  writeFileSync(file, '999999999\n');
  fs.utimesSync(file, new Date(0), new Date(0));
  const originalRename = fs.default.renameSync;
  let swapped = false;
  fs.default.renameSync = (from, to) => {
    if (from === file && !swapped) {
      swapped = true;
      originalRename(from, displaced);
      writeFileSync(file, `${process.pid}\n`);
    }
    return originalRename(from, to);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        acquireFileLock(file, { ...VAULT_LOCK, deadlineMs: Date.now() + 100 }),
      /Timed out waiting/u,
    );
    assert.equal(swapped, true);
    assert.equal(readFileSync(file, 'utf8'), `${process.pid}\n`);
    assert.equal(fs.statSync(file).nlink, 1);
  } finally {
    fs.default.renameSync = originalRename;
    syncBuiltinESMExports();
  }
  fs.unlinkSync(file);
  releaseFileLock(acquireFileLock(file, VAULT_LOCK));
});

test('retired locks are removed only after the stale mtime', async () => {
  const { acquireFileLock, releaseFileLock, VAULT_LOCK } =
    await import('../lib/vault.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-lock-retired-test-'));
  const file = path.join(base, 'vault.lock');
  const old = `${file}.stale-old`;
  const fresh = `${file}.stale-fresh`;
  writeFileSync(old, 'old');
  writeFileSync(fresh, 'fresh');
  fs.utimesSync(old, new Date(0), new Date(0));
  releaseFileLock(acquireFileLock(file, VAULT_LOCK));
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
});

test('proxy doctor ignores retired locks but reports other leftovers', async () => {
  const { diagnoseProxy } = await import('../lib/proxy-manager.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-proxy-retired-test-'));
  const home = path.join(base, 'home');
  const proxy = path.join(home, 'proxy');
  fs.mkdirSync(proxy, { recursive: true });
  writeFileSync(path.join(proxy, 'manager.lock.stale-old'), 'old');
  const env = {
    ...process.env,
    ZEROH_HOME: home,
    ZEROH_CLAUDE_SETTINGS: path.join(base, 'settings.json'),
  };
  delete env.ANTHROPIC_BASE_URL;
  const serviceManager = { isRegistered: () => false };
  const diagnose = () => diagnoseProxy({ env, serviceManager });
  assert.equal(
    (await diagnose()).findings.includes('files-from-an-earlier-build'),
    false,
  );
  writeFileSync(path.join(proxy, 'leftover.tmp'), 'other');
  assert.equal(
    (await diagnose()).findings.includes('files-from-an-earlier-build'),
    true,
  );
});

test('EEXIST during swapped-lock restore leaves the live lock in place', async () => {
  const { acquireFileLock, VAULT_LOCK } = await import('../lib/vault.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-lock-eexist-test-'));
  const file = path.join(base, 'vault.lock');
  writeFileSync(file, '999999999\n');
  fs.utimesSync(file, new Date(0), new Date(0));
  const originalRename = fs.default.renameSync;
  const originalLink = fs.default.linkSync;
  let swapped = false;
  let blocked = false;
  fs.default.renameSync = (from, to) => {
    if (from === file && !swapped) {
      swapped = true;
      originalRename(from, `${file}.displaced`);
      writeFileSync(file, `${process.pid}\n`);
    }
    return originalRename(from, to);
  };
  fs.default.linkSync = (from, to) => {
    if (to === file) {
      blocked = true;
      writeFileSync(file, `${process.pid}\n`);
      const error = new Error('lock path occupied');
      error.code = 'EEXIST';
      throw error;
    }
    return originalLink(from, to);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        acquireFileLock(file, { ...VAULT_LOCK, deadlineMs: Date.now() + 100 }),
      /Timed out waiting/u,
    );
    assert.equal(swapped, true);
    assert.equal(blocked, true);
    assert.equal(readFileSync(file, 'utf8'), `${process.pid}\n`);
  } finally {
    fs.default.renameSync = originalRename;
    fs.default.linkSync = originalLink;
    syncBuiltinESMExports();
  }
  const retired = fs
    .readdirSync(base)
    .find((name) => name.startsWith('vault.lock.stale-'));
  assert.ok(retired);
  fs.utimesSync(path.join(base, retired), new Date(0), new Date(0));
  assert.throws(
    () => acquireFileLock(file, { ...VAULT_LOCK, deadlineMs: Date.now() + 50 }),
    /Timed out waiting/u,
  );
  assert.equal(existsSync(path.join(base, retired)), false);
});

test('unsupported hard link restores the retired lock and keeps waiting', async () => {
  const { acquireFileLock, VAULT_LOCK } = await import('../lib/vault.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-lock-link-test-'));
  const file = path.join(base, 'vault.lock');
  writeFileSync(file, '999999999\n');
  fs.utimesSync(file, new Date(0), new Date(0));
  const originalRename = fs.default.renameSync;
  const originalLink = fs.default.linkSync;
  let swapped = false;
  let restored = false;
  fs.default.renameSync = (from, to) => {
    if (from === file && !swapped) {
      swapped = true;
      originalRename(from, `${file}.displaced`);
      writeFileSync(file, `${process.pid}\n`);
    } else if (from.startsWith(`${file}.stale-`) && to === file) {
      restored = true;
    }
    return originalRename(from, to);
  };
  fs.default.linkSync = (from, to) => {
    if (to === file) {
      const error = new Error('hard links unavailable');
      error.code = 'ENOTSUP';
      throw error;
    }
    return originalLink(from, to);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        acquireFileLock(file, { ...VAULT_LOCK, deadlineMs: Date.now() + 100 }),
      /Timed out waiting/u,
    );
    assert.equal(restored, true);
    assert.equal(readFileSync(file, 'utf8'), `${process.pid}\n`);
  } finally {
    fs.default.renameSync = originalRename;
    fs.default.linkSync = originalLink;
    syncBuiltinESMExports();
  }
});

test('failed restore reports a busy lock', async () => {
  const { acquireFileLock, VAULT_LOCK } = await import('../lib/vault.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-lock-restore-test-'));
  const file = path.join(base, 'vault.lock');
  writeFileSync(file, '999999999\n');
  fs.utimesSync(file, new Date(0), new Date(0));
  const originalRename = fs.default.renameSync;
  const originalLink = fs.default.linkSync;
  let swapped = false;
  fs.default.renameSync = (from, to) => {
    if (from === file && !swapped) {
      swapped = true;
      originalRename(from, `${file}.displaced`);
      writeFileSync(file, `${process.pid}\n`);
    } else if (from.startsWith(`${file}.stale-`) && to === file) {
      const error = new Error('rename unavailable');
      error.code = 'EACCES';
      throw error;
    }
    return originalRename(from, to);
  };
  fs.default.linkSync = () => {
    const error = new Error('hard links unavailable');
    error.code = 'ENOTSUP';
    throw error;
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () =>
        acquireFileLock(file, { ...VAULT_LOCK, deadlineMs: Date.now() + 100 }),
      /Timed out waiting for ZeroH vault lock/u,
    );
    assert.equal(swapped, true);
    assert.equal(existsSync(file), false);
    assert.equal(
      fs.readdirSync(base).some((name) => name.startsWith('vault.lock.stale-')),
      true,
    );
  } finally {
    fs.default.renameSync = originalRename;
    fs.default.linkSync = originalLink;
    syncBuiltinESMExports();
  }
});
