// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectorUpdates } from '../../packages/zeroh-disclosure-core/detector-updates.js';
const catalog = {
  generatedFrom: { version: 'v8.30.1' },
  rules: [
    { id: 'curl-auth-user', regex: 'before' },
    { id: 'other', regex: 'before' },
  ],
};
const overlay = {
  rules: [{ id: 'curl-auth-user' }],
  gaps: [{ fillsGapOf: 'github-app-token' }],
};
const release = {
  version: 'v8.31.0',
  source: 'https://example.com/releases/fixture',
};
test('fixture release and provider announcement report an overlay update task', () => {
  const reports = detectorUpdates({
    currentCatalog: catalog,
    nextCatalog: { rules: [{ id: 'curl-auth-user', regex: 'after' }] },
    overlay,
    release,
    announcements: [
      {
        kind: 'token-format',
        id: 'fixture-format',
        provider: 'fixture',
        source: 'https://example.com/announcement',
      },
    ],
  });
  assert.equal(reports[0].kind, 'token-format');
  assert.deepEqual(reports[1].changedRules, ['curl-auth-user']);
  assert.equal(reports[1].needsUpdateTask, true);
});
test('unrelated release, missing comparison, and same version have distinct outcomes', () => {
  const check = (nextCatalog, version = release.version) =>
    detectorUpdates({
      currentCatalog: catalog,
      nextCatalog,
      overlay,
      release: { ...release, version },
    });
  assert.equal(
    check({
      ...catalog,
      rules: [catalog.rules[0], { id: 'other', regex: 'after' }],
    })[0].needsUpdateTask,
    false,
  );
  assert.equal(check(undefined)[0].comparisonPending, true);
  assert.deepEqual(check(catalog, 'v8.30.1'), []);
});

test('a global allowlist change also requires an overlay review task', () => {
  const reports = detectorUpdates({
    currentCatalog: catalog,
    nextCatalog: { ...catalog, globalAllowlist: { stopwords: ['fixture'] } },
    overlay,
    release,
  });
  assert.deepEqual(reports[0].changedRules, ['global-allowlist']);
  assert.equal(reports[0].needsUpdateTask, true);
});
