// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referencesAllowed } from '../../packages/shell-analysis/reference-allow.js';
const field = (value) => {
  const original = `curl -u "${value}:" https://example.com`;
  const start = original.indexOf(value);
  return [
    {
      original,
      path: ['command'],
      replacements: [{ start, end: start + value.length + 1 }],
    },
  ];
};
test('a proven reference uses explicit variable-name allow rules', () => {
  assert.equal(
    referencesAllowed(
      field('$STRIPE_KEY'),
      'bash',
      { STRIPE_KEY: ['example.com'] },
      ['example.com'],
    ),
    true,
  );
  assert.equal(
    referencesAllowed(
      field('$STRIPE_KEY'),
      'bash',
      { STRIPE_KEY: ['example.com'] },
      ['other.example.com'],
    ),
    false,
  );
  assert.equal(
    referencesAllowed(field('$STRIPE_KEY'), 'bash', { '*': ['example.com'] }, [
      'example.com',
    ]),
    false,
  );
  assert.equal(
    referencesAllowed(
      field('$STRIPE_KEY'),
      'bash',
      { STRIPE_KEY: ['example.com'] },
      [],
    ),
    false,
  );
  assert.equal(
    referencesAllowed(
      field('${STRIPE_KEY:-ZEROHFAKE-literal9}'),
      'bash',
      { STRIPE_KEY: ['example.com'] },
      ['example.com'],
    ),
    false,
  );
});
