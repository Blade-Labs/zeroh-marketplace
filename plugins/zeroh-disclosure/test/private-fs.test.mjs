// SPDX-License-Identifier: AGPL-3.0-only

// One atomic, private write for every file ZeroH keeps (C-F9: the Windows
// rename retry used to exist in one of sixteen copies).
import assert from 'node:assert/strict';
import {
  mkdtempSync,
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
  renameWithRetry,
  writePrivateJson,
} from '../lib/private-fs.js';
import { PLUGIN } from './helpers.mjs';

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
  assert.deepEqual(offenders, [], 'use lib/private-fs.js');
});
