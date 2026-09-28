// SPDX-License-Identifier: AGPL-3.0-only

// docs/features.json and docs/features.md: in sync, every feature tied to
// code or a test, and the CHANGELOG's Features line naming only real IDs.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectionCatalog } from '../lib/detector.js';
import {
  changedClaudeCodeIds,
  checkFeatures,
  loadFeatures,
  parityTable,
  parseFeaturesLine,
  PLUGIN_ROOT,
  validateFeatures,
} from '../scripts/features.mjs';

const data = loadFeatures();
const version = JSON.parse(
  readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8'),
).version;

test('features.json and the table in features.md are in sync, for this version', () => {
  assert.deepEqual(checkFeatures({ version }), []);
});

test('every feature is shipped in Claude Code and names code or a test', () => {
  for (const feature of data.features) {
    assert.equal(
      feature.platforms['claude-code'].status,
      'shipped',
      feature.id,
    );
    assert.ok(
      feature.evidence.some((file) =>
        /^(?:lib|hooks|bin|mcp|scripts)\//u.test(file),
      ),
      `${feature.id} names no code path`,
    );
  }
  for (const id of [
    'mask.prompt',
    'mask.tool-output',
    'mask.file-read',
    'restore.allowed-host',
    'stop.disallowed-host',
    'unmask.dialog',
    'receipt.signed',
    'statusline',
    'report-miss',
    'mgmt.user-authority',
    'pass.uncertain-notice',
    'settings.uncertain-block',
    'detect.keys-gitleaks',
    'detect.pii-33',
  ]) {
    assert.ok(
      data.features.some((feature) => feature.id === id),
      `${id} is missing`,
    );
  }
});

test('the detection counts in the feature list are the catalog counts', () => {
  const catalog = detectionCatalog();
  assert.equal(catalog.personal_data_kinds.length, 33, 'detect.pii-33');
  const keys = data.features.find(({ id }) => id === 'detect.keys-gitleaks');
  assert.match(
    keys.description,
    new RegExp(`^${catalog.provider_formats} `, 'u'),
  );
  assert.match(
    keys.description,
    new RegExp(catalog.source.replace('.', '\\.'), 'u'),
  );
});

test('a stale or broken feature list is refused', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-features-'));
  cpSync(PLUGIN_ROOT, root, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });
  const json = path.join(root, 'docs', 'features.json');
  const original = JSON.parse(readFileSync(json, 'utf8'));
  const write = (value) =>
    writeFileSync(json, `${JSON.stringify(value, null, 2)}\n`);

  assert.match(
    checkFeatures({ root, version: '9.9.9' }).join('\n'),
    /is for .*, not 9\.9\.9/u,
  );
  write({
    ...original,
    features: [
      { ...original.features[0], evidence: ['lib/gone.js'] },
      ...original.features.slice(1),
    ],
  });
  assert.match(
    checkFeatures({ root }).join('\n'),
    /lib\/gone\.js does not exist/u,
  );
  write({
    ...original,
    features: [
      {
        ...original.features[0],
        description: `${original.features[0].description} Changed.`,
      },
      ...original.features.slice(1),
    ],
  });
  assert.match(
    checkFeatures({ root }).join('\n'),
    /features\.md is out of date/u,
  );
  assert.match(
    validateFeatures(
      {
        ...original,
        features: [
          {
            ...original.features[0],
            platforms: {
              ...original.features[0].platforms,
              codex: { status: 'not possible', note: '' },
            },
          },
        ],
      },
      { root },
    ).join('\n'),
    /"not possible" without a reason/u,
  );
});

test("this release's CHANGELOG section lists real feature IDs", () => {
  const changelog = readFileSync(
    path.join(PLUGIN_ROOT, 'CHANGELOG.md'),
    'utf8',
  );
  const start = changelog.indexOf(`## ${version}`);
  assert.ok(start >= 0, `CHANGELOG has a ${version} section`);
  const rest = changelog.slice(start + 3);
  const section = rest.slice(
    0,
    rest.search(/^## /mu) >= 0 ? rest.search(/^## /mu) : undefined,
  );
  const entries = parseFeaturesLine(section);
  assert.ok(entries?.length, 'the section has a Features: line');
  const ids = new Set(data.features.map(({ id }) => id));
  for (const { kind, id } of entries) {
    if (kind !== 'removed')
      assert.ok(ids.has(id), `${id} is not in features.json`);
  }
});

test('the Features line, the Claude Code changes and the parity table', () => {
  assert.deepEqual(
    parseFeaturesLine(
      'x\nFeatures: +statusline, ~pass.uncertain-notice, -old.one\n',
    ),
    [
      { kind: 'added', id: 'statusline' },
      { kind: 'changed', id: 'pass.uncertain-notice' },
      { kind: 'removed', id: 'old.one' },
    ],
  );
  assert.equal(parseFeaturesLine('no line here'), null);
  const feature = (id, status) => ({
    id,
    platforms: {
      'claude-code': { status, note: '' },
      codex: { status: 'unknown', note: '' },
      opencode: { status: 'planned', note: '' },
    },
  });
  assert.deepEqual(
    changedClaudeCodeIds(
      {
        features: [
          feature('a', 'shipped'),
          feature('b', 'planned'),
          feature('gone', 'shipped'),
        ],
      },
      {
        features: [
          feature('a', 'shipped'),
          feature('b', 'shipped'),
          feature('new', 'shipped'),
        ],
      },
    ).sort(),
    ['b', 'gone', 'new'],
  );
  assert.equal(
    parityTable({ features: [feature('a', 'shipped')] }, ['a']),
    '| Feature | Claude Code | Codex | OpenCode |\n| --- | --- | --- | --- |\n| `a` | shipped | unknown | planned |',
  );
});
