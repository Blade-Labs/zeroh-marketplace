// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PLUGIN, tempProject } from '../helpers.mjs';

// The same three protection probes can exercise a detached HEAD checkout.
const root = process.env.ZEROH_REVIEW_BASELINE_ROOT
  ? path.join(
      process.env.ZEROH_REVIEW_BASELINE_ROOT,
      'apps/zeroh-marketplace/plugins/zeroh-disclosure',
    )
  : PLUGIN;
const load = (file) => import(pathToFileURL(path.join(root, file)));
const { scrub, exactValueHits } = await load(
  'packages/shell-analysis/secrets/rewrite.js',
);
const { knownValueMasker } = await load(
  'packages/zeroh-disclosure-core/restorable.js',
);
const { detectSensitiveData, detectEntropyWarnings } = await load(
  'packages/zeroh-disclosure-core/detector.js',
);
const { Vault } = await load('packages/zeroh-disclosure-core/vault.js');
const fake = () => `ZEROHFAKE${randomBytes(3).toString('hex')}!x`;
const gateway = () => `<API_KEY_${randomBytes(8).toString('hex')}>`;
const vaultFor = () => {
  const p = tempProject({ env: false });
  return new Vault(p.dir, { env: { ...process.env, ZEROH_HOME: p.home } });
};
function masked(text, raw, options = {}) {
  const result = scrub(text, {
    vault: vaultFor(),
    profile: 'prompt',
    ...options,
  });
  assert.ok(result.replacements.length > 0, 'a protection replacement exists');
  assert.ok(!result.text.includes(raw), 'fake value absent from provider text');
  return result;
}

test('HEAD probe: known hex wrapped in a gateway-shaped span stays masked', () => {
  const raw = fake();
  const hex = Buffer.from(raw).toString('hex');
  const text = `<K_${hex}>`;
  const known = [{ name: 'SECRET', type: 'SECRET', value: raw }];
  masked(text, hex, { known });
  assert.ok(
    exactValueHits(text, { known }).length > 0,
    'known variant located',
  );
  const fallback = knownValueMasker([
    {
      token: `[SECRET-${randomBytes(3).toString('hex')}]`,
      type: 'SECRET_HEX',
      value: hex,
    },
  ]);
  assert.ok(
    !fallback.replaceText(text).includes(hex),
    'persisted exact value masked',
  );
});

for (const [name, make] of [
  ['password adjacency', (raw, token) => `password=${raw}${token}`],
  [
    'URL password adjacency',
    (raw, token) => `https://user:${raw}${token}@example.com`,
  ],
]) {
  test(`HEAD probe: ${name} stays masked`, () => {
    const raw = fake();
    const token = gateway();
    const text = make(raw, token);
    const findings = detectSensitiveData(text, { region: null });
    assert.ok(
      findings.some(
        (f) =>
          f.start <= text.indexOf(raw) &&
          f.end >= text.indexOf(raw) + raw.length,
      ),
      'raw value has detector coverage',
    );
    const result = masked(text, raw);
    if (!process.env.ZEROH_REVIEW_BASELINE_ROOT)
      assert.ok(
        result.text.includes(token),
        'adjacent gateway token unchanged',
      );
  });
}

test('known raw, hex and base64 values override gateway spans and adjacency', () => {
  const raw = fake();
  const variants = [
    raw,
    Buffer.from(raw).toString('hex'),
    Buffer.from(raw).toString('base64'),
  ];
  for (const value of variants) {
    const known = [{ name: 'SECRET', type: 'SECRET', value: raw }];
    masked(`<K_${value}>`, value, { known });
    const token = gateway();
    assert.ok(
      masked(`${value}${token}`, value, { known }).text.includes(token),
      'unrelated gateway unchanged',
    );
  }
  const hex = randomBytes(32).toString('hex');
  const vault = vaultFor();
  vault.tokenFor('SECRET', hex, 'known:SECRET');
  const result = scrub(`<LABEL_${hex}>`, { vault });
  assert.ok(result.replacements.length > 0, '64-hex vault value masked');
  assert.ok(!result.text.includes(hex), '64-hex value absent');
  assert.ok(
    !knownValueMasker(vault.knownValues())
      .replaceText(`<LABEL_${hex}>`)
      .includes(hex),
    'fallback masks 64-hex known value',
  );
});

test('a detected vault hex value cannot hide behind a gateway label boundary', () => {
  const value = randomBytes(32).toString('hex');
  const vault = vaultFor();
  vault.tokenFor('SECRET', value, 'detected');
  assert.ok(
    exactValueHits(`<LABEL_${value}>`, { vault }).length > 0,
    'vault exact hit located',
  );
  const result = scrub(`<LABEL_${value}>`, { vault });
  assert.ok(
    result.replacements.length > 0,
    'detected vault exact value masked',
  );
  assert.ok(
    !result.text.includes(value),
    'label boundary cannot hide vault value',
  );
});

test('known values in gateway labels also override recognition', () => {
  const value = `ZEROHFAKE${randomBytes(4).toString('hex').toUpperCase()}`;
  const token = `<${value}_${randomBytes(8).toString('hex')}>`;
  const known = [{ name: 'SECRET', type: 'SECRET', value }];
  masked(token, value, { known });
  const vault = vaultFor();
  vault.tokenFor('SECRET', value, 'known:SECRET');
  const result = scrub(token, { vault });
  assert.ok(result.replacements.length > 0, 'known vault label masked');
  assert.ok(!result.text.includes(value), 'label cannot hide a known value');
  assert.ok(
    !knownValueMasker(vault.knownValues()).replaceText(token).includes(value),
    'persisted label masked',
  );
});

test('detector clips all outside fragments of a partially ignored finding', () => {
  const left = fake();
  const right = fake();
  const token = gateway();
  const text = `password=${left}${token}${right}`;
  const findings = detectSensitiveData(text, { region: null });
  const spans = findings.map((f) => text.slice(f.start, f.end));
  assert.ok(spans.includes(left), 'left fragment retained');
  assert.ok(spans.includes(right), 'right fragment retained');
  assert.ok(
    findings.every(
      (f) =>
        f.end <= text.indexOf(token) ||
        f.start >= text.indexOf(token) + token.length,
    ),
    'no finding consumes gateway bytes',
  );
  const result = masked(text, left);
  assert.ok(!result.text.includes(right), 'right fragment also masked');
  assert.ok(result.text.includes(token), 'gateway unchanged between fragments');
});

test('plugin entropy warnings skip random gateway suffixes', () => {
  for (const length of [16, 32, 64])
    for (let i = 0; i < 12; i++) {
      const token = `<EMAIL_ADDRESS_${randomBytes(length / 2).toString('hex')}>`;
      assert.equal(
        detectEntropyWarnings(`please email ${token} today`).length,
        0,
        'gateway creates no entropy warning',
      );
    }
});
