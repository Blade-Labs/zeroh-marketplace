// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileDetectionOptions } from '../../packages/zeroh-disclosure-core/detection-context.js';
import { detectSensitiveData } from '../../packages/zeroh-disclosure-core/detector.js';
test('file callers retain JSON literals and detect plain config passwords', () => {
  for (const file of [
    '.env',
    '.env.local',
    'config.yaml',
    'config.ini',
    'config.properties',
    'config.toml',
  ])
    assert.ok(
      detectSensitiveData('DB_PASSWORD=orchardlantern', {
        profile: 'secrets',
        ...fileDetectionOptions(file),
      }).length,
      file,
    );
  assert.ok(
    detectSensitiveData(
      '{"password":"$DB_PASSWORD"}',
      fileDetectionOptions('config.json'),
    ).length,
  );
  assert.deepEqual(
    detectSensitiveData(
      'DB_PASSWORD=${OTHER_KEY}',
      fileDetectionOptions('compose.yaml'),
    ),
    [],
  );
  assert.ok(
    detectSensitiveData(
      'DB_PASSWORD="${OTHER_KEY}"',
      fileDetectionOptions('unknown.log'),
    ).length,
  );
});
