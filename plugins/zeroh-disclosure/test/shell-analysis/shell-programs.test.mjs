// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { readOptions } from '../../packages/shell-analysis/programs/curl-wget.js';
import { gitCommand } from '../../packages/shell-analysis/programs/git-gh.js';
import { opensslCommand } from '../../packages/shell-analysis/programs/cloud-clis.js';
import * as dnsPrograms from '../../packages/shell-analysis/programs/dns.js';
import * as dockerPrograms from '../../packages/shell-analysis/programs/docker.js';
import { localProgramReach } from '../../packages/shell-analysis/programs/archive-and-fs.js';
import { interpreterSpec } from '../../packages/shell-analysis/programs/shells.js';

const word = (value) => ({ value, dynamic: false, quoted: false });

test('shell programs: curl-wget family reads option operands', () => {
  const parsed = readOptions([word('-H'), word('accept: application/json')], {
    values: '-H',
  });
  assert.equal(parsed.options[0].name, '-H');
  assert.equal(parsed.options[0].value.value, 'accept: application/json');
});

test('shell programs: git-gh family classifies local Git commands', () => {
  assert.equal(gitCommand({ args: [word('status')] }).kind, 'local');
});

test('shell programs: cloud-clis family keeps the current OpenSSL reader', () => {
  assert.equal(
    opensslCommand({
      args: [word('s_client'), word('-connect'), word('example.invalid:443')],
    }).kind,
    'connect',
  );
});

test('shell programs: dns family has no reader in the current registry', () => {
  assert.deepEqual(Object.keys(dnsPrograms), []);
});

test('shell programs: docker family has no reader in the current registry', () => {
  assert.deepEqual(Object.keys(dockerPrograms), []);
});

test('shell programs: archive-and-fs family identifies local archive use', () => {
  assert.deepEqual(localProgramReach({ program: 'tar', args: [] }), {
    runs: null,
    remote: null,
    unc: [],
  });
});

test('shell programs: shells family exposes interpreter specifications', () => {
  assert.ok(interpreterSpec('node'));
  assert.ok(interpreterSpec('python3'));
});
