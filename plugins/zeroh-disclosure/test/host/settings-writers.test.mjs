// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'lib',
);

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(file);
    return file.endsWith('.js') ? [file] : [];
  });
}

test('every lib settings writer goes through the compare-and-swap editor', () => {
  const sources = javascriptFiles(LIB).map((file) => ({
    file,
    source: readFileSync(file, 'utf8'),
  }));
  for (const { file, source } of sources) {
    assert.doesNotMatch(
      source,
      /(?:writeFileSync|writePrivateFile|writePrivateJson|renameSync)\(\s*(?:settingsPath|resolveClaudeSettingsPath\()/u,
      file,
    );
    assert.doesNotMatch(
      source,
      /writeSettingsFile\([^,]+,\s*(?:['"`]|JSON\.stringify)/u,
      file,
    );
  }
  const callers = sources
    .filter(({ source }) => source.includes('writeSettingsFile('))
    .map(({ file }) => path.relative(LIB, file))
    .sort();
  assert.deepEqual(callers, [
    'claude-settings.js',
    'first-run.js',
    'statusline-record.js',
    'statusline-settings.js',
  ]);
});
