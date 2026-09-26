// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeValues,
  kindName,
  STOP_REASONS,
  stopMessage,
} from '../lib/stop-message.js';

const FAKE_STRIPE = 'sk_live_ZEROHFAKEstopmessage00000000';

test('values are named by provider or kind, never shown', () => {
  assert.equal(kindName('API_KEY', FAKE_STRIPE), 'Stripe live secret key');
  assert.equal(kindName('API_KEY', 'ZEROHFAKE-no-prefix'), 'secret');
  assert.equal(kindName('EMAIL', 'a@example.test'), 'email address');
  assert.equal(
    describeValues([
      { type: 'API_KEY', value: FAKE_STRIPE },
      { type: 'API_KEY', value: FAKE_STRIPE },
      { type: 'EMAIL', value: 'a@example.test' },
    ]),
    'a Stripe live secret key and an email address',
  );
  assert.equal(
    describeValues([
      { type: 'EMAIL', value: 'a@example.test' },
      { type: 'EMAIL', value: 'b@example.test' },
    ]),
    'an email address (×2)',
  );
});

test('the stop message is three plain lines at most', () => {
  const values = [{ type: 'API_KEY', value: FAKE_STRIPE }];
  const copied = stopMessage({
    values,
    reason: 'not-ready',
    masked: 'deploy with [API_KEY-0a1b2c]',
    copied: true,
    nextMasked: true,
    platform: 'darwin',
  });
  assert.equal(
    copied,
    [
      "🛡 ZeroH stopped this prompt: it contains a Stripe live secret key, and masking isn't ready yet in this session.",
      'A masked copy is on your clipboard (⌘V, then Enter): deploy with [API_KEY-0a1b2c]',
      'From your next prompt on, typed secrets are masked automatically.',
    ].join('\n'),
  );
  const pasted = stopMessage({
    values,
    reason: 'off',
    masked: 'deploy with [API_KEY-0a1b2c]',
    platform: 'linux',
  });
  assert.equal(
    pasted,
    [
      '🛡 ZeroH stopped this prompt: it contains a Stripe live secret key, and the ZeroH proxy is off.',
      'Paste this instead: deploy with [API_KEY-0a1b2c]',
    ].join('\n'),
  );
  for (const reason of Object.keys(STOP_REASONS)) {
    const text = stopMessage({ values, reason, masked: 'x [API_KEY-0a1b2c]' });
    assert.ok(!text.includes(FAKE_STRIPE), reason);
    assert.ok(text.split('\n').length <= 3, reason);
  }
  const file = stopMessage({
    values,
    files: [{ path: '.env', count: 2 }],
    reason: 'off',
  });
  assert.match(file, /^🛡 ZeroH stopped this prompt: @\.env holds 2 secret/u);
  assert.doesNotMatch(file, /clipboard|Paste this/u);
});
