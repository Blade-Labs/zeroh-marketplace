// SPDX-License-Identifier: AGPL-3.0-only

// docs/features.json and docs/features.md: in sync, every feature tied to
// code or a test, and the CHANGELOG's Features line naming only real IDs.
import '../helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectionCatalog } from '../../packages/zeroh-disclosure-core/detector.js';
import {
  changedClaudeCodeIds,
  checkFeatures,
  loadFeatures,
  NEXT_PLATFORMS,
  parityTable,
  parseFeaturesLine,
  PLUGIN_ROOT,
  renderFeaturesTable,
  validateFeatures,
} from '../../scripts/features.mjs';

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
        /^(?:lib|hooks|bin|mcp|scripts|packages)\//u.test(file),
      ),
      `${feature.id} names no code path`,
    );
  }
  for (const id of [
    'mask.prompt',
    'mask.tool-output',
    'mask.file-read',
    'restore.bash',
    'restore.powershell',
    'stop.disallowed-host',
    'guard.file-tools',
    'guard.shell',
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
  // Of the imported rules, the ones that name no provider.
  const generic = new Set([
    'generic-api-key',
    'private-key',
    'jwt',
    'jwt-base64',
    'curl-auth-header',
    'curl-auth-user',
    'kubernetes-secret-yaml',
  ]);
  const rules = createRequire(import.meta.url)(
    '../../vendor/sensitive-data-detectors/src/rules/gitleaks.generated.json',
  );
  const list = Array.isArray(rules) ? rules : rules.rules;
  assert.equal(list.length, catalog.provider_formats);
  const genericCount = list.filter(({ id }) => generic.has(id)).length;
  assert.equal(genericCount, generic.size, 'every generic rule is still there');
  assert.match(
    keys.description,
    new RegExp(
      `: ${list.length - genericCount} for a named provider's keys and ${genericCount} generic ones`,
      'u',
    ),
  );
});

test('every feature has an area, and the next platforms cover the core features', () => {
  const core = data.features.filter((feature) => feature.core);
  assert.ok(core.length >= 4, 'the core features are marked');
  for (const feature of core) {
    for (const platform of NEXT_PLATFORMS) {
      assert.ok(feature.platforms[platform], `${feature.id}: ${platform}`);
    }
  }
  const markdown = renderFeaturesTable(data);
  assert.match(markdown, /^## Masking$/mu);
  assert.match(markdown, /^## Next platforms$/mu);
  const next = markdown.slice(markdown.indexOf('## Next platforms'));
  assert.equal(
    next.split('\n').filter((line) => line.startsWith('| `')).length,
    core.length,
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
  const [first] = original.features;
  const errors = validateFeatures(
    {
      ...original,
      features: [
        {
          ...first,
          area: 'nowhere',
          platforms: {
            ...first.platforms,
            codex: { status: 'planned', note: '', sources: 'not a list' },
          },
        },
      ],
    },
    { root },
  ).join('\n');
  assert.match(errors, /needs an area/u);
  assert.match(errors, /codex sources must be a list of strings/u);
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

test('1.1 owns its changes and the released 1.0.5 notes stay exact', () => {
  const changelog = readFileSync(
    path.join(PLUGIN_ROOT, 'CHANGELOG.md'),
    'utf8',
  );
  const section = (release) => {
    const start = changelog.indexOf(`## ${release}`);
    assert.ok(start >= 0, `CHANGELOG has a ${release} section`);
    const body = changelog.slice(start);
    const next = body.indexOf('\n## ', 1);
    return (next < 0 ? body : body.slice(0, next)).trim();
  };
  assert.equal(
    section('1.0.5'),
    [
      '## 1.0.5',
      '',
      'Features: ~statusline, ~uninstall.clean (see [docs/features.md](docs/features.md))',
      '',
      '- **Long-running sessions now ask for a restart when they predate ZeroH.** A session started before ZeroH was installed or updated could say `🔴 hooks never ran` and send you to doctor even though nothing was broken. It now says `🟡 started before ZeroH` and asks you to restart Claude Code so the session can be protected.',
      "- **Uninstall keeps a marketplace entry it can't prove ZeroH created.** On installs upgraded from 1.0.2 or 1.0.3, the first-run record does not say whether ZeroH created the `zeroh` marketplace entry or added auto-update to yours. Uninstall now removes only `autoUpdate` from such an entry; 1.0.4 deleted the whole entry, including one you had added yourself.",
      '- **A cancelled or refused uninstall no longer says "local cleanup failed".** Nothing was attempted, so no cleanup outcome is printed.',
    ].join('\n'),
  );
  const current = section('1.1.0');
  for (const title of [
    'Status messages share protection-state wording and fixes.',
    'Routing follows the saved settings.',
    'Concurrent Claude Code saves are preserved',
    'Not-protected prompt notices name every kind sent.',
    'interrupted removal has retry or',
  ]) {
    assert.ok(current.includes(title), title);
  }
  assert.match(current, /does not currently report a closed vault as Paused/u);
  assert.match(current, /organised into smaller packages and component tests/u);
  assert.match(
    current,
    /dies before local cleanup begins[^.]*protection resumes[^.]*retry notice/iu,
  );
  assert.match(
    current,
    /after local\s+cleanup has begun[^.]*removal incomplete[^.]*finishes the removal/iu,
  );
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
      'opencode-v2': { status: 'planned', note: '' },
      copilot: { status: 'unknown', note: '' },
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
    '| Feature | Claude Code | Codex | OpenCode 1.x | OpenCode 2 |\n| --- | --- | --- | --- | --- |\n| `a` | shipped | unknown | planned | planned |',
  );
});
