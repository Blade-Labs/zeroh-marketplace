// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { parentPort } from 'node:worker_threads';
import {
  execFileSync,
  spawnSync,
} from '../../packages/zeroh-disclosure-core/child-process.js';
import {
  ensurePrivateDir,
  protectWindowsPath,
  writePrivateFile,
} from '../../packages/zeroh-disclosure-core/private-fs.js';
import path from 'node:path';

assert.equal(
  execFileSync('ZEROHFAKE-ok', [], { encoding: 'utf8' }),
  'ZEROHFAKE-output',
);
assert.ok(Buffer.isBuffer(execFileSync('ZEROHFAKE-ok', [])));
const failed = spawnSync('ZEROHFAKE-fail', [], { encoding: 'utf8' });
assert.equal(failed.status, 7);
assert.equal(failed.stderr, 'ZEROHFAKE-stderr');
assert.throws(() => execFileSync('ZEROHFAKE-fail', []), { status: 7 });
assert.equal(spawnSync('ZEROHFAKE-missing', []).error.code, 'ENOENT');
assert.equal(
  spawnSync('ZEROHFAKE-hang', [], { timeout: 10 }).error.code,
  'ETIMEDOUT',
);
assert.equal(
  spawnSync('ZEROHFAKE-ok', [], { maxBuffer: 1 }).error.code,
  'ENOBUFS',
);
writePrivateFile(
  path.join(process.env.ZEROH_HOME, 'vault', 'fake'),
  'ZEROHFAKE',
);
writePrivateFile(
  path.join(process.env.ZEROH_HOME, 'receipts', 'fake'),
  'ZEROHFAKE',
);
const external = path.join(process.env.TMPDIR, 'ZEROHFAKE-removal');
ensurePrivateDir(external);
assert.equal(protectWindowsPath(external), false);
parentPort.postMessage('ok');
