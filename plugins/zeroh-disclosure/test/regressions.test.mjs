// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(path.join(TEST_ROOT, 'regressions.json'), 'utf8'),
);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function declaredTestNames() {
  const names = new Set();
  const declaration =
    /\b(?:test|it)(?:\.(?:skip|todo|only))?\s*\(\s*((['"])(?:\\.|(?!\2)[^\\])*\2)/gu;
  for (const file of filesUnder(TEST_ROOT)) {
    if (!file.endsWith('.test.mjs') || file === import.meta.filename) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(declaration)) {
      names.add(
        vm.runInNewContext(match[1], Object.create(null), { timeout: 50 }),
      );
    }
  }
  return names;
}

test('the regression manifest names existing unit tests and live scenarios', () => {
  const unitTests = declaredTestNames();
  const liveDirectory = path.resolve(
    TEST_ROOT,
    '../../../acceptance/zeroh-disclosure/scenarios',
  );
  const marketplaceProject = path.resolve(TEST_ROOT, '../../../project.json');
  const inMarketplaceWorkspace = existsSync(marketplaceProject);
  if (inMarketplaceWorkspace) {
    assert.ok(
      existsSync(liveDirectory),
      `repository live-scenario directory is missing: ${liveDirectory}`,
    );
  }
  const liveScenarios = inMarketplaceWorkspace
    ? new Set(
        readdirSync(liveDirectory)
          .filter((name) => name.endsWith('.mjs'))
          .map((name) => name.slice(0, -4)),
      )
    : null;

  for (const [finding, mapping] of Object.entries(manifest.findings)) {
    assert.ok(mapping.unitTests.length, `${finding} must name a unit test`);
    for (const name of mapping.unitTests) {
      assert.ok(
        unitTests.has(name),
        `${finding} names missing unit test: ${name}`,
      );
    }
    if (inMarketplaceWorkspace) {
      for (const id of mapping.liveScenarios) {
        assert.ok(
          liveScenarios.has(id),
          `${finding} names missing live scenario: ${id}`,
        );
      }
    }
  }
});
