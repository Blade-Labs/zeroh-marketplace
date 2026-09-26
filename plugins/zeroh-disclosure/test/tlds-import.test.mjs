// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseTlds } from '../scripts/import-tlds.mjs';

const ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

test('the IANA list parser retains its provenance and punycode TLDs', () => {
  assert.deepEqual(
    parseTlds(`# Version 2026092500, Last Updated Fri Sep 25 07:07:01 2026 UTC
APP
XN--P1AI
`),
    {
      source: 'IANA Root Zone Database',
      url: 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt',
      version: '2026092500',
      lastUpdated: 'Fri Sep 25 07:07:01 2026 UTC',
      tlds: ['app', 'xn--p1ai'],
    },
  );
});

test('the committed IANA TLD catalog is current', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/import-tlds.mjs', '--check'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
