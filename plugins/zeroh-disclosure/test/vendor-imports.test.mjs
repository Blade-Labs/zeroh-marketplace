// SPDX-License-Identifier: AGPL-3.0-only

// The vendored libraries are byte-for-byte the pinned releases, with their
// licences, and nothing at run time comes from outside the plugin.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closure, ENTRY_MODULES } from '../scripts/import-validator.mjs';

const ROOT = path.dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
);

for (const script of [
  'import-validator.mjs',
  'import-libphonenumber.mjs',
  'import-reference-data.mjs',
]) {
  test(`${script} --check: the vendored files match SOURCE.json`, () => {
    const result = spawnSync(
      process.execPath,
      [path.join('scripts', script), '--check'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
  });
}

test('each vendored library keeps its licence and provenance', () => {
  for (const [dir, files] of [
    ['validator', ['LICENSE', 'SOURCE.json', 'package.json']],
    ['libphonenumber-js', ['LICENSE', 'LICENSE.Apache', 'SOURCE.json']],
    ['i18n-iso-countries', ['LICENSE', 'SOURCE.json', 'codes.json']],
    ['saudi-id-validator', ['LICENSE', 'SOURCE.json', 'validateSAID.js']],
  ]) {
    for (const file of files)
      assert.ok(
        existsSync(path.join(ROOT, 'vendor', dir, file)),
        `${dir}/${file}`,
      );
    const source = JSON.parse(
      readFileSync(path.join(ROOT, 'vendor', dir, 'SOURCE.json'), 'utf8'),
    );
    assert.match(source.license, /MIT/u);
    if (dir === 'saudi-id-validator') {
      assert.match(source.version, /^[0-9a-f]{40}$/u);
      continue;
    }
    assert.match(source.url, /^https:\/\/registry\.npmjs\.org\//u);
    assert.match(source.integrity, /^sha512-/u);
  }
});

test('only the validator modules the entries require are vendored', () => {
  const read = (file) => {
    try {
      return readFileSync(path.join(ROOT, 'vendor', 'validator', file), 'utf8');
    } catch {
      return undefined;
    }
  };
  const modules = closure(read);
  for (const entry of ENTRY_MODULES)
    assert.ok(modules.includes(`lib/${entry}.js`));
  const recorded = Object.keys(JSON.parse(read('SOURCE.json')).files).filter(
    (file) => file !== 'LICENSE',
  );
  assert.deepEqual(recorded.sort(), modules);
});

test('the vendored code needs nothing outside the plugin', () => {
  const lpn = readFileSync(
    path.join(ROOT, 'vendor', 'libphonenumber-js', 'libphonenumber-max.cjs'),
    'utf8',
  );
  assert.doesNotMatch(lpn, /\brequire\(/u);
  for (const file of Object.keys(
    JSON.parse(
      readFileSync(
        path.join(ROOT, 'vendor', 'validator', 'SOURCE.json'),
        'utf8',
      ),
    ).files,
  ).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(
      path.join(ROOT, 'vendor', 'validator', file),
      'utf8',
    );
    for (const m of source.matchAll(/require\("([^"]+)"\)/gu))
      assert.match(m[1], /^\.\.?\//u, `${file} requires ${m[1]}`);
  }
});
