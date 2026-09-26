// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { detectSensitiveData } from '../lib/detector.js';
import {
  generateCatalog,
  parseGitleaksToml,
  samplesForCatalog,
  translateRe2,
  unnamedGroups,
} from '../scripts/import-gitleaks.mjs';

const ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

test('the TOML subset reader keeps rule fields and nested allowlists', () => {
  const rules = parseGitleaksToml(`
[[rules]]
id = "sample"
description = "Sample rule"
regex = '''(?i)key-([a-z0-9]{8})'''
secretGroup = 1
entropy = 3.5
keywords = ["key-", "sample"]
[[rules.allowlists]]
regexTarget = "secret"
regexes = ['''^example''']
stopwords = ["placeholder"]
`);
  assert.deepEqual(rules, [
    {
      id: 'sample',
      description: 'Sample rule',
      regex: '(?i)key-([a-z0-9]{8})',
      secretGroup: 1,
      entropy: 3.5,
      keywords: ['key-', 'sample'],
      allowlists: [
        {
          regexTarget: 'secret',
          regexes: ['^example'],
          stopwords: ['placeholder'],
        },
      ],
    },
  ]);
});

test('RE2 inline flags are faithfully rewritten and unsupported syntax is skipped', () => {
  const translated = translateRe2('prefix-(?i)[a-z]{3}(?-i:END)');
  const regex = new RegExp(translated.regex, translated.flags);
  assert.equal(regex.test('prefix-aBcEND'), true);
  regex.lastIndex = 0;
  assert.equal(regex.test('PREFIX-aBcEND'), false);
  regex.lastIndex = 0;
  assert.equal(regex.test('prefix-aBcend'), false);
  const scoped = translateRe2('a((?i)b)c');
  assert.equal(new RegExp(scoped.regex).test('aBc'), true);
  assert.equal(new RegExp(scoped.regex).test('aBC'), false);
  assert.throws(() => translateRe2('value\\Ctail'), /unsupported RE2/);
});

test('the committed catalog is current', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/import-gitleaks.mjs', '--check'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

// Rules the sampler cannot satisfy (multi-line context, a fixed checksum
// alphabet or a length it cannot reach), with a hand-written fake sample and
// the secret gitleaks would report.
const HAND_SAMPLES = {
  'curl-auth-header': [
    'curl -H "Authorization: Bearer ZeroHFake9x7Qk2Lm4Np" https://api.example.com/v1',
    'ZeroHFake9x7Qk2Lm4Np',
  ],
  'curl-auth-user': [
    'curl -u deploy:ZeroHFake7Qk2Lm https://api.example.com/v1',
    'deploy:ZeroHFake7Qk2Lm',
  ],
  'freemius-secret-key': [
    "'secret_key' => 'sk_ZeroHFake0123456789abcdefghij',",
    'sk_ZeroHFake0123456789abcdefghij',
  ],
  'gcp-api-key': [
    'key = "AIzaZeroHFake0123456789abcdefghijKLMNOP"',
    'AIzaZeroHFake0123456789abcdefghijKLMNOP',
  ],
  'jwt-base64': [
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnpkV0lpT2lJeE1qTTBOVFkzT0Rrd0luMA==',
    'ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnpkV0lpT2lJeE1qTTBOVFkzT0Rrd0luMA==',
  ],
  'kubernetes-secret-yaml': [
    'apiVersion: v1\nkind: Secret\nmetadata:\n  name: db\ndata:\n  password: WmVyb0hGYWtlUGFzc3dvcmQ5OQ==\n',
    'WmVyb0hGYWtlUGFzc3dvcmQ5OQ==',
  ],
  'nuget-config-password': [
    '<add key="ClearTextPassword" value="ZeroHFake7Qk2Lm" />',
    'ZeroHFake7Qk2Lm',
  ],
  'okta-access-token': [
    'OKTA_TOKEN=00ZeroHFake0123456789abcdefghijklmnopqrstu',
    '00ZeroHFake0123456789abcdefghijklmnopqrstu',
  ],
  'openshift-user-token': [
    'oc login --token=sha256~ZeroHFake0123456789abcdefghijklmnopqrstuvwx',
    'sha256~ZeroHFake0123456789abcdefghijklmnopqrstuvwx',
  ],
  'vault-batch-token': [
    `VAULT_TOKEN=hvb.${'ZeroHFake0123456789abcdefghij'.repeat(6)}`,
    `hvb.${'ZeroHFake0123456789abcdefghij'.repeat(6)}`,
  ],
  'github-fine-grained-pat': [
    `github_pat_${'ZeroHFake01'.repeat(7)}abcde`,
    `github_pat_${'ZeroHFake01'.repeat(7)}abcde`,
  ],
  'gitlab-pat': ['glpat-ZeroHFake0123456789ab', 'glpat-ZeroHFake0123456789ab'],
};

// True when the detector masks exactly `secret` in `sample`: the value
// gitleaks reports, not the key name in front of it.
function masksExactly(sample, secret) {
  return detectSensitiveData(sample, { profile: 'secrets' }).some(
    (finding) => sample.slice(finding.start, finding.end) === secret,
  );
}

test('every imported rule masks exactly its secret in a fake sample', (t) => {
  const catalog = generateCatalog(
    readFileSync(
      path.join(ROOT, 'vendor/gitleaks/gitleaks-v8.30.1.toml'),
      'utf8',
    ),
  );
  const { samples, uncovered } = samplesForCatalog(catalog, masksExactly);
  const grouped = catalog.rules.filter(
    (rule) =>
      rule.secretGroup === undefined && unnamedGroups(rule.regex).length > 0,
  );
  t.diagnostic(
    `imported=${catalog.counts.imported} grouped-without-secretGroup=${grouped.length} generated=${samples.length} hand=${uncovered.length}`,
  );
  assert.ok(samples.length >= 200, `only ${samples.length} rules sampled`);
  for (const { id } of uncovered) {
    assert.ok(HAND_SAMPLES[id], `${id} has no sample`);
    const [sample, secret] = HAND_SAMPLES[id];
    assert.ok(masksExactly(sample, secret), `${id} hand sample`);
  }
  for (const sample of samples) {
    assert.ok(masksExactly(sample.sample, sample.secret), sample.id);
  }
});

test('an imported rule with capture groups masks the value, not the key name', () => {
  const text = 'algolia_key: "0123456789abcdef0123456789abcdef"\n';
  const found = detectSensitiveData(text, { profile: 'secrets' });
  assert.deepEqual(
    found.map((f) => text.slice(f.start, f.end)),
    ['0123456789abcdef0123456789abcdef'],
  );
  const code = [
    'this.partitionKey = partitionKey;',
    'export declare const PASSWORD_TOO_WEAK = "password_too_weak";',
    'xmlCharKey: opts.xmlCharKey ',
  ].join('\n');
  assert.deepEqual(detectSensitiveData(code, { profile: 'tool' }), []);
});
