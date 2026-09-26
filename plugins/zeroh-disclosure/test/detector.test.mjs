// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEntropyWarnings, detectSensitiveData } from '../lib/detector.js';
import { PROSE_FIXTURES } from './helpers.mjs';

const found = (text, profile = 'tool') =>
  detectSensitiveData(text, { profile }).map((f) => [
    f.type,
    text.slice(f.start, f.end),
  ]);

test('provider keys and credential shapes are caught', () => {
  const text = [
    'STRIPE_KEY=sk_live_51HxT9eQ2vP8wLk4Q2abc',
    'ANTHROPIC_API_KEY=sk-ant-api03-Xq7Lm2Vt9abcdefghijklmnop',
    'GITHUB_TOKEN=ghp_8Xk2LmQp4RtY7uW1zA3bCdEfGhIjKlMnOp',
    'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    'DATABASE_URL=postgres://app:Xk82!pwQ@db.internal:5432/shop',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.x3FqAbCdEfGh',
    'ADMIN_PASSWORD=hunter2-prod',
  ].join('\n');
  const values = found(text).map(([, v]) => v);
  assert.deepEqual(values, [
    'sk_live_51HxT9eQ2vP8wLk4Q2abc',
    'sk-ant-api03-Xq7Lm2Vt9abcdefghijklmnop',
    'ghp_8Xk2LmQp4RtY7uW1zA3bCdEfGhIjKlMnOp',
    'AKIAIOSFODNN7EXAMPLE',
    'Xk82!pwQ',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.x3FqAbCdEfGh',
    'hunter2-prod',
  ]);
});

test('publishable keys, config names, tokens and hashes are left alone', () => {
  const text = [
    'PUBLIC_STRIPE_KEY=pk_live_51HxT9eQ2vPbXYZ',
    'TENANT_SEED_KEY_PREFIX=zhe-tenant-',
    'MAX_COMPLETION_TOKENS=4096',
    'API_KEY=${STRIPE_KEY}',
    'PASSWORD=<your-password>',
    'already masked [API_KEY-7a3f9e]',
    'tx 0x1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988',
    'at 2026-09-24 12:04:11 took 1234567 ms',
  ].join('\n');
  assert.deepEqual(found(text), []);
});

test('national phone numbers need a default region and a typed prompt; a Qatar ID needs its context word', () => {
  const text =
    'Aisha Al-Kuwari aisha@example.qa +974 5512 3456 card 4532 0151 1283 0366 QID 28463400123 home 4412 7788';
  const precise = [
    ['EMAIL', 'aisha@example.qa'],
    ['PHONE_NUMBER', '+974 5512 3456'],
    ['CARD_NUMBER', '4532 0151 1283 0366'],
    ['QATAR_ID', '28463400123'],
  ];
  const withRegion = (profile, region) =>
    detectSensitiveData(text, { profile, region }).map((f) => [
      f.type,
      text.slice(f.start, f.end),
    ]);
  assert.deepEqual(withRegion('tool', 'QA'), precise);
  assert.deepEqual(withRegion('prompt', null), precise);
  assert.deepEqual(withRegion('prompt', 'QA'), [
    ...precise,
    ['PHONE_NUMBER', '4412 7788'],
  ]);
});

// Names and currency amounts are Premium (context-aware detection); the free
// regex detector has no rule for either, in any profile.
test('no profile detects names or currency amounts', () => {
  const text = [
    'Aisha Al-Kuwari and Jonathan Smith met Mohammed bin Salman Al Thani.',
    'Invoice total QAR 12,500.00, refund $1,299.99, EUR 3.400,50 and 850 USD.',
  ].join('\n');
  for (const profile of ['prompt', 'tool', 'secrets']) {
    assert.deepEqual(found(text, profile), [], profile);
  }
});

test('ordinary prose, dates and order numbers are not personal data', () => {
  for (const text of PROSE_FIXTURES) {
    assert.deepEqual(found(text, 'prompt'), [], text);
  }
});

test('credential findings win overlaps with loose personal-data rules', () => {
  const findings = detectSensitiveData('FLWSECK_TEST-0123456789ab', {
    profile: 'prompt',
  });
  assert.deepEqual(
    findings.map(({ type }) => type),
    ['API_KEY'],
  );
});

test('tool output ignores unseparated timestamp-like card candidates', () => {
  assert.deepEqual(found('created_at_ms=1727251200000', 'tool'), []);
});

test('tool output detects cards in issuer ranges, not every Luhn-valid number', () => {
  const values = found(
    'visa 4111111111111111 amex 3782 822463 10005 generic 1234-5678-9012-3452',
    'tool',
  );
  // validator.isCreditCard: a Luhn-valid number outside every issuer range
  // (1234-…) is not a card.
  assert.deepEqual(values, [
    ['CARD_NUMBER', '4111111111111111'],
    ['CARD_NUMBER', '3782 822463 10005'],
  ]);
});

test('secrets profile ignores personal data', () => {
  assert.deepEqual(
    found(
      'mail aisha@example.qa key ghp_8Xk2LmQp4RtY7uW1zA3bCdEfGhIjKlMnOp',
      'secrets',
    ).map(([t]) => t),
    ['API_KEY'],
  );
});

// DET-1: a random-looking value next to a key-like name is the most certain
// secret there is; it is masked, in every profile.
test('a random-looking value next to a key-like name is masked, not only warned about', () => {
  const value = 'zq9fK2mLx7Rt4Vb8Nc3Hs6Pd1Wy5Ge0AjQ';
  for (const [text, type] of [
    [`AUTH_TOKEN=${value}`, 'TOKEN'],
    [`API_TOKEN=${value}`, 'TOKEN'],
    [`TOKEN=${value}`, 'TOKEN'],
    [`token: ${value}`, 'TOKEN'],
    ['API_SECRET=Ab3dE5fG7hJ9kL2mN4pQ6rS8tV0xYz1C', 'SECRET'],
  ]) {
    for (const profile of ['secrets', 'tool', 'prompt'])
      assert.deepEqual(
        found(text, profile).map(([t]) => t),
        [type],
        `${profile}: ${text}`,
      );
    assert.deepEqual(detectEntropyWarnings(text), [], text);
  }
  // An escaped newline ends the value (`KEY=value\nNEXT=…` in a string).
  assert.deepEqual(
    found('x = "AGENT_API_KEY=repository-key\\nTENANT_ID=base\\n"', 'tool'),
    [],
  );
});

test('the entropy warning is only for a random value with no key-like name', () => {
  const value = 'zq9fK2mLx7Rt4Vb8Nc3Hs6Pd1Wy5Ge0AjQ';
  for (const text of [
    `curl https://hooks.example.com/${value}`,
    `./deploy ${value}`,
  ]) {
    assert.deepEqual(found(text, 'prompt'), [], text);
    const warnings = detectEntropyWarnings(text);
    assert.equal(warnings.length, 1, text);
    assert.equal(warnings[0].name, null);
    assert.equal(text.slice(warnings[0].start, warnings[0].end), value);
    assert.ok(warnings[0].entropy >= 4.3);
  }
  for (const text of [
    'commit 0123456789abcdef0123456789abcdef01234567',
    'uuid 123e4567-e89b-42d3-a456-426614174000',
    'Then Read the README and Getting Started',
  ])
    assert.deepEqual(detectEntropyWarnings(text), [], text);
});

test('catalog and entropy detection leave documented negatives untouched', () => {
  const negatives = [
    '0123456789abcdef0123456789abcdef01234567',
    '123e4567-e89b-42d3-a456-426614174000',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'pk_live_ZEROHFAKE0123456789abcdefghijkl',
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIZEROHFAKE0123456789 public@example',
    'MAX_OUTPUT_TOKENS=32000',
    'SERVICE_URL=https://example.com',
  ];
  for (const value of negatives) {
    assert.deepEqual(found(value, 'secrets'), [], value);
    assert.deepEqual(detectEntropyWarnings(value), [], value);
  }
});
