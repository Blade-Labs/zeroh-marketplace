// SPDX-License-Identifier: AGPL-3.0-only

// One atomic, private write for every file ZeroH keeps (C-F9: the Windows
// rename retry used to exist in one of sixteen copies).
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readJsonOr,
  protectWindowsPath,
  renameWithRetry,
  writePrivateJson,
} from '../../packages/zeroh-disclosure-core/private-fs.js';
import { PLUGIN } from '../helpers.mjs';

test('WIN11 a timed-out machine-name query still restores and verifies numeric user permissions', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-machine-query-'));
  let applied = false;
  let queries = 0;
  assert.equal(
    protectWindowsPath(home, {
      platform: 'win32',
      env: { COMPUTERNAME: 'ZEROHFAKEBOX' },
      execute(file, args) {
        if (file.endsWith('whoami.exe'))
          return '"ZEROHFAKEBOX\\admin","S-1-5-21-123-456-789-500"';
        if (file.endsWith('powershell.exe')) {
          queries++;
          throw Object.assign(new Error('ZEROHFAKE timeout'), {
            code: 'ETIMEDOUT',
          });
        }
        if (args.includes('/restore')) applied = true;
        if (args.includes('/save'))
          writeFileSync(
            args[2],
            `${path.basename(home)}\r\n${applied ? 'D:P(A;OICI;FA;;;S-1-5-21-123-456-789-500)(A;OICI;FA;;;SY)' : 'D:AI(A;OICI;FA;;;WD)'}\r\n`,
            'utf16le',
          );
        return '';
      },
    }),
    true,
  );
  assert.equal(queries, 1);
  assert.equal(applied, true);
});

test('writePrivateJson writes a 0600 file in a 0700 folder and leaves no temporary file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-private-fs-'));
  const file = path.join(root, 'a', 'b', 'state.json');
  writePrivateJson(file, { ok: true });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ok: true });
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  }
  writePrivateJson(file, { ok: 2 }, { pretty: false });
  assert.equal(readFileSync(file, 'utf8'), '{"ok":2}\n');
  assert.deepEqual(readdirSync(path.dirname(file)), ['state.json']);
  writeFileSync(path.join(root, 'broken.json'), '{');
  assert.equal(readJsonOr(path.join(root, 'broken.json'), 'x'), 'x');
  assert.equal(readJsonOr(path.join(root, 'missing.json')), null);
});

test('a rename that stays locked fails after its retries and removes the temporary file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-private-fs-'));
  const temporary = path.join(root, 'x.tmp');
  writeFileSync(temporary, '{}');
  let attempts = 0;
  assert.throws(
    () =>
      renameWithRetry(temporary, path.join(root, 'x.json'), {
        attempts: 3,
        delayMs: 1,
        rename() {
          attempts += 1;
          throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        },
      }),
    /locked/u,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(readdirSync(root), []);
});

test('no module renames files into place by itself', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.m?js$/u.test(entry.name) && entry.name !== 'private-fs.js') {
        if (
          /\brename(?:Sync)?\(|fs\.rename\(/u.test(readFileSync(file, 'utf8'))
        ) {
          offenders.push(path.relative(PLUGIN, file));
        }
      }
    }
  };
  for (const dir of ['lib', 'hooks', 'bin', 'mcp', 'commands']) {
    walk(path.join(PLUGIN, dir));
  }
  assert.deepEqual(
    offenders,
    [],
    'use packages/zeroh-disclosure-core/private-fs.js',
  );
});

test('Windows bounded protection uses a verified icacls restore descriptor', async () => {
  const target = path.join(os.tmpdir(), "ZEROHFAKE folder's [literal] name");
  mkdirSync(target, { recursive: true });
  const run = async (asyncMode) => {
    const calls = [];
    let applied = false;
    const execute = (file, args, options) => {
      const record = { file, args, options };
      calls.push(record);
      if (file.endsWith('whoami.exe'))
        return '"ZEROHFAKE","S-1-12-1-111-222-333-444"';
      if (args.includes('/restore')) {
        const bytes = readFileSync(args[args.indexOf('/restore') + 1]);
        assert.equal(bytes.readUInt16LE(0), 0xfeff);
        assert.equal(
          bytes.toString('utf16le'),
          `\uFEFF${path.basename(target)}\r\nD:P(A;OICI;FA;;;S-1-12-1-111-222-333-444)(A;OICI;FA;;;SY)\r\n`,
        );
        assert.equal(args[0], path.dirname(target));
        assert.equal(options.timeout > 0 && options.timeout <= 500, true);
        assert.equal(options.detached, undefined);
        applied = true;
      } else if (args.includes('/save')) {
        writeFileSync(
          args[args.indexOf('/save') + 1],
          `\uFEFF${path.basename(target)}\r\n${applied ? 'D:P(A;OICI;FA;;;S-1-12-1-111-222-333-444)(A;OICI;FA;;;SY)' : 'D:AI(A;OICI;FA;;;WD)'}\r\n`,
          'utf16le',
        );
      }
      return '';
    };
    const ok = asyncMode
      ? await protectWindowsPath(target, {
          platform: 'win32',
          env: {},
          execute,
        })
      : protectWindowsPath(target, { platform: 'win32', env: {}, execute });
    assert.equal(ok, true);
    assert.equal(calls.length, 4);
    assert.ok(calls.every((call) => !/powershell/iu.test(call.file)));
    assert.ok(calls.every((call) => !call.args.includes('/reset')));
    return calls.map((call) => [
      path.win32.basename(call.file),
      call.args.includes('/save')
        ? 'save'
        : call.args.includes('/restore')
          ? 'restore'
          : 'identity',
    ]);
  };
  assert.deepEqual(await run(false), await run(true));
});

test('WIN10 failed preflight allows private directories and never write a v3 marker', async () => {
  const { ensurePrivateDir, prepareWindowsHome } =
    await import('../../packages/zeroh-disclosure-core/private-fs.js');
  const { mkdirSync, renameSync } = await import('node:fs');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-failure-cache-'));
  const home = path.join(base, 'home');
  const env = { ZEROH_HOME: home };
  let attempts = 0;
  const execute = () => {
    attempts += 1;
    throw new Error('ZEROHFAKE refused');
  };
  assert.equal(prepareWindowsHome({ env, execute }), null);
  for (let index = 0; index < 10; index += 1)
    ensurePrivateDir(path.join(home, String(index)));
  assert.equal(attempts, 1);
  assert.ok(!readdirSync(home).includes('.acl-failed'));
  assert.ok(!readdirSync(home).includes('.acl-applying'));
  renameSync(home, path.join(base, 'old'));
  mkdirSync(home);
  assert.equal(await prepareWindowsHome({ env, execute }), null);
  assert.equal(attempts, 2);
  assert.ok(!readdirSync(home).includes('.acl-protected'));
});

test('WIN7 v3 markers require exact protected SID/SYSTEM OICI full-control read-back', async () => {
  const { prepareWindowsHome } =
    await import('../../packages/zeroh-disclosure-core/private-fs.js');
  const good = 'D:P(A;OICI;FA;;;S-1-5-21-123)(A;OICI;FA;;;SY)';
  const records = [
    good,
    good.replace('D:P', 'D:AI'),
    good.replace('FA', 'FR'),
    good.replace('OICI', 'OI'),
    good.replace('SY', 'BA'),
    good + '(A;OICI;FA;;;WD)',
    good.replace('A;', 'D;'),
  ];
  for (const [index, record] of records.entries()) {
    const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-readback-'));
    writeFileSync(path.join(home, '.acl-protected'), '2\n');
    let saves = 0;
    const execute = (file, args) => {
      if (file.endsWith('whoami.exe')) return '"ZEROHFAKE","S-1-5-21-123"';
      if (args.includes('/save')) {
        saves += 1;
        writeFileSync(
          args[args.indexOf('/save') + 1],
          `${path.basename(home)}\r\n${saves === 1 ? 'D:AI(A;OICI;FA;;;WD)' : record}\r\n`,
          'utf16le',
        );
      }
      if (args.includes('/restore'))
        assert.ok(
          !readFileSync(
            args[args.indexOf('/restore') + 1],
            'utf16le',
          ).startsWith('\uFEFF'),
        );
      return '';
    };
    const fact = await prepareWindowsHome({
      env: { ZEROH_HOME: home },
      execute,
    });
    assert.equal(Boolean(fact), index === 0, record);
    assert.equal(
      readFileSync(path.join(home, '.acl-protected'), 'utf8').startsWith('{'),
      index === 0,
    );
  }
});

test('WIN10 restore timeout kills a real child and always removes its descriptor directory', async () => {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-killed-apply-'));
  const completion = path.join(home, 'ZEROHFAKE-completed');
  let input;
  let timeout;
  let killedSignal;
  const started = performance.now();
  const ok = protectWindowsPath(home, {
    env: {},
    platform: 'win32',
    timeout: 750,
    execute(file, args, options) {
      assert.equal(options.cwd, 'C:\\Windows\\System32');
      assert.ok(options.timeout > 0 && options.timeout <= 500);
      if (file.endsWith('whoami.exe')) return '"ZEROHFAKE","S-1-5-21-123"';
      if (args.includes('/save')) {
        writeFileSync(
          args[2],
          `${path.basename(home)}\r\nD:AI(A;OICI;FA;;;WD)\r\n`,
          'utf16le',
        );
        return '';
      }
      input = path.dirname(args[2]);
      timeout = options.timeout;
      assert.equal(options.stdio, 'ignore');
      assert.equal(options.windowsHide, true);
      try {
        return execFileSync(
          process.execPath,
          [
            '-e',
            'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "ZEROHFAKE"), 1200)',
            completion,
          ],
          { stdio: 'ignore', timeout: options.timeout, windowsHide: true },
        );
      } catch (error) {
        killedSignal = error.signal;
        throw error;
      }
    },
  });
  assert.equal(ok, false);
  assert.equal(killedSignal, 'SIGTERM');
  assert.ok(timeout <= 500);
  assert.ok(performance.now() - started < 1500);
  assert.equal(existsSync(input), false);
  assert.equal(existsSync(completion), false);
});

test('WIN10 an unsuccessful check never creates cross-process backoff; success needs read-back', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-next-check-'));
  const env = { ZEROH_HOME: home };
  let applied = false;
  let restored = 0;
  const execute = (file, args) => {
    if (file.endsWith('whoami.exe')) return '"ZEROHFAKE","S-1-5-21-123"';
    if (args.includes('/save'))
      writeFileSync(
        args[2],
        `${path.basename(home)}\r\n${applied ? 'D:P(A;OICI;FA;;;S-1-5-21-123)(A;OICI;FA;;;SY)' : 'D:AI(A;OICI;FA;;;WD)'}\r\n`,
        'utf16le',
      );
    if (args.includes('/restore')) {
      restored++;
      if (!applied) throw new Error('ZEROHFAKE refused');
    }
    return '';
  };
  const { prepareWindowsHome } =
    await import('../../packages/zeroh-disclosure-core/private-fs.js');
  assert.equal(prepareWindowsHome({ env, execute }), null);
  const next =
    await import('../../packages/zeroh-disclosure-core/private-fs.js?ZEROHFAKE-next-check');
  assert.equal(next.prepareWindowsHome({ env, execute }), null);
  assert.equal(restored, 2);
  applied = true;
  assert.ok(next.prepareWindowsHome({ env, execute }));
  assert.equal(restored, 2);
  assert.equal(
    JSON.parse(readFileSync(path.join(home, '.acl-protected'))).version,
    3,
  );
});
