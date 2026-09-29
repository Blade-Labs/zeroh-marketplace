// SPDX-License-Identifier: AGPL-3.0-only

// ZeroH's home counts only as a whole path segment: a path that merely starts
// with the home's name (`<X>/zeroh-backup` beside `<X>/zeroh`) is not ZeroH's
// state and must not be refused (1.0.1; Astra's 1.0.1 review found the prefix
// match through settings-guard.test.mjs:841).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textReferencesZeroHSettings } from '../lib/settings-guard.js';

const home = '/tmp/zeroh-acceptance/boundary/zeroh';
const refs = (text) =>
  textReferencesZeroHSettings(text, '/tmp/zeroh-acceptance/boundary/project', {
    platform: 'linux',
    home,
  });

test('a sibling folder whose name starts with the home is not ZeroH state', () => {
  for (const text of [
    'rg --pre cat token /tmp/zeroh-acceptance/boundary/zeroh-guard-rg-pre-Ab12/file.txt',
    'ls /tmp/zeroh-acceptance/boundary/zeroh-backup',
    'cat /tmp/zeroh-acceptance/boundary/zeroh2/notes.md',
  ])
    assert.equal(refs(text), false, text);
});

test('the home itself and paths inside it still are', () => {
  for (const text of [
    'cat /tmp/zeroh-acceptance/boundary/zeroh/config.env',
    'ls /tmp/zeroh-acceptance/boundary/zeroh',
    'rm -rf "/tmp/zeroh-acceptance/boundary/zeroh"',
    'echo x > /tmp/zeroh-acceptance/boundary/zeroh/allow.json',
    'tar -C /tmp/zeroh-acceptance/boundary/zeroh -xf a.tar',
  ])
    assert.equal(refs(text), true, text);
});
