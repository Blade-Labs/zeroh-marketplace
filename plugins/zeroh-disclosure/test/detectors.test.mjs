// SPDX-License-Identifier: AGPL-3.0-only

// The detection engine is vendor/sensitive-data-detectors, a synced copy of
// @bladelabs/sensitive-data-detectors (its own tests live with the package in
// the Blade Labs monorepo). These tests cover the copy's integrity and what
// the plugin adds on top in lib/detector.js.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  detectionCatalog,
  detectorManifest,
  detectSensitiveData,
  PERSONAL_DATA_KINDS,
  phoneRegion,
} from '../lib/detector.js';
import { zerohDisclosurePolicyV1 } from '../lib/policies/zeroh-disclosure.v1.js';
import { PLUGIN, withPhoneRegion } from './helpers.mjs';

const COPY = path.join(PLUGIN, 'vendor', 'sensitive-data-detectors');

function walk(dir, relative = '') {
  const out = [];
  for (const name of readdirSync(path.join(dir, relative)).sort()) {
    const child = relative ? `${relative}/${name}` : name;
    if (statSync(path.join(dir, child)).isDirectory())
      out.push(...walk(dir, child));
    else out.push(child);
  }
  return out;
}

test('the synced copy matches the package (skipped outside the monorepo)', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'scripts', 'sync-detectors.mjs'), '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('the copy holds exactly the files SOURCE.json pins, unchanged', () => {
  const source = JSON.parse(
    readFileSync(path.join(COPY, 'SOURCE.json'), 'utf8'),
  );
  assert.equal(source.package, '@bladelabs/sensitive-data-detectors');
  assert.equal(source.license, 'MIT');
  assert.match(source.commit, /^[0-9a-f]{40}$/u);
  const pinned = Object.keys(source.files);
  assert.deepEqual(
    walk(COPY).filter((file) => !['README.md', 'SOURCE.json'].includes(file)),
    [...pinned].sort(),
  );
  for (const file of pinned)
    assert.equal(
      createHash('sha256')
        .update(readFileSync(path.join(COPY, file)))
        .digest('hex'),
      source.files[file],
      file,
    );
  assert.match(
    readFileSync(path.join(COPY, 'LICENSE'), 'utf8'),
    /^MIT License/u,
  );
  const readme = readFileSync(path.join(COPY, 'README.md'), 'utf8');
  assert.match(readme, /Do not edit here/u);
  assert.ok(readme.includes(source.version) && readme.includes(source.commit));
});

for (const script of [
  'import-validator.mjs',
  'import-libphonenumber.mjs',
  'import-reference-data.mjs',
  'import-gitleaks.mjs',
  'import-tlds.mjs',
]) {
  test(`copy: ${script} --check (vendored files and generated rules match their pins)`, () => {
    const result = spawnSync(
      process.execPath,
      [path.join('scripts', script), '--check'],
      { cwd: COPY, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  });
}

test('ZEROH_PHONE_REGION sets the phone region before the locale', () => {
  assert.equal(phoneRegion({ ZEROH_PHONE_REGION: 'gb' }), 'GB');
  assert.equal(
    phoneRegion({ ZEROH_PHONE_REGION: 'none', LANG: 'en_US.UTF-8' }),
    null,
  );
  assert.equal(phoneRegion({ LANG: 'de_DE.UTF-8' }), 'DE');
  assert.equal(phoneRegion({}), null);
  const national = 'call 020 7946 0958 today';
  const phones = () =>
    detectSensitiveData(national).filter((f) => f.type === 'PHONE_NUMBER');
  assert.equal(withPhoneRegion('GB', phones).length, 1);
  assert.equal(withPhoneRegion('none', phones).length, 0);
});

test('ZeroH tokens are never detected again', () => {
  const token = '[EMAIL-3f9a1c]';
  const text = `write to ${token} and password=Zq8Lr2Vt9Kp4 ${token}`;
  for (const finding of detectSensitiveData(text)) {
    const value = text.slice(finding.start, finding.end);
    assert.ok(!value.includes('[EMAIL-'), value);
  }
});

test('the policy masks, and the catalog lists, every personal-data kind', () => {
  const types = PERSONAL_DATA_KINDS.map(({ type }) => type);
  assert.equal(types.length, 33);
  const mask = zerohDisclosurePolicyV1.rules.find(
    (rule) => rule.id === 'ZEROH-MASK-PERSONAL-DATA',
  ).mask_categories;
  for (const type of types) assert.ok(mask.includes(type), type);
  const catalog = detectionCatalog();
  assert.deepEqual(catalog.personal_data, [...types].sort());
  assert.match(catalog.also[0], /\.env files and credential files/u);
  assert.equal(detectorManifest().id, 'zeroh-disclosure-detector-v4');
});
