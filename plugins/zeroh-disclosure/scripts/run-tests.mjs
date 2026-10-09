// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function tests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return tests(target);
    return entry.name.endsWith('.test.mjs') ? [target] : [];
  });
}

const files = tests(path.join(root, 'test')).sort();
const inventory = path.join(root, 'test', 'regressions.test.mjs');
// The literal-only manifest inventory has a 50 ms VM watchdog. Run that one
// file outside CLI/process contention; the remaining suite keeps normal concurrency.
const groups = files.includes(inventory)
  ? [[inventory], files.filter((file) => file !== inventory)]
  : [files];
for (const selected of groups.filter(
  (group) => group.length || !files.length,
)) {
  const result = spawnSync(process.execPath, ['--test', ...selected], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal || result.status !== 0) {
    process.exitCode = result.signal ? 1 : (result.status ?? 1);
    break;
  }
}
