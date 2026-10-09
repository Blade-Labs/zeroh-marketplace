// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildCopy, run } from '../../scripts/sync-detectors.mjs';
test('local dirty snapshot opt-in keeps default rejection and byte-for-byte drift detection', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-sync-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'packages/sensitive-data-detectors');
  const plugin = path.join(
    root,
    'apps/zeroh-marketplace/plugins/zeroh-disclosure',
  );
  for (const sub of ['src', 'scripts', 'vendor'])
    mkdirSync(path.join(dir, sub), { recursive: true });
  writeFileSync(
    path.join(dir, 'src/index.js'),
    'export const fixture = true;\n',
  );
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', license: 'MIT' }),
  );
  for (const file of ['README.md', 'LICENSE', 'NOTICE'])
    writeFileSync(path.join(dir, file), 'fixture\n');
  const target = path.join(plugin, 'vendor/sensitive-data-detectors');
  for (const [file, data] of buildCopy(
    { dir },
    { commit: 'fixture-uncommitted' },
  )) {
    const output = path.join(target, file);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, data);
  }
  assert.equal(run(['--check'], { plugin, env: {} }), 1);
  assert.equal(run(['--check', '--allow-uncommitted'], { plugin, env: {} }), 0);
  assert.equal(
    run(['--check'], {
      plugin,
      env: { ZEROH_DETECTOR_SYNC_ALLOW_UNCOMMITTED: '1' },
    }),
    0,
  );
  writeFileSync(path.join(target, 'src/index.js'), 'different\n');
  assert.equal(run(['--check', '--allow-uncommitted'], { plugin, env: {} }), 1);
});
