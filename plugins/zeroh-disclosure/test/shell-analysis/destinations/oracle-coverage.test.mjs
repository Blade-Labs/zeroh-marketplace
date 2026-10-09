// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { applicableOraclePending, validateOracleCoverage } from './gate.mjs';
import { oracleCoverageFixture } from './oracle-coverage-fixture.mjs';

test('macOS/Windows without Linux effects have no pending oracle requirement', () => {
  const oracles = oracleCoverageFixture();
  for (const report of oracles.filter((r) => r.platform !== 'ubuntu')) {
    report.pending = [
      'programs: requires Linux and cc',
      'resolved: disposable namespace required',
      'sshAuthenticated: disposable Linux account required',
    ];
    assert.deepEqual(
      applicableOraclePending(report.platform, report.pending),
      [],
    );
  }
  assert.deepEqual(validateOracleCoverage({ oracles }), []);
});

test('Ubuntu refuses missing Linux-only effects even with empty pending and passing shell flags', () => {
  for (const name of ['programs', 'resolved', 'sshAuthenticated']) {
    const oracles = oracleCoverageFixture();
    delete oracles[0].requests[name];
    assert.ok(
      validateOracleCoverage({ oracles }).some((e) =>
        e.includes(`ubuntu/22/${name}`),
      ),
    );
  }
  const pending = [
    'programs: requires cc',
    'resolved: disposable namespace required',
  ];
  assert.deepEqual(applicableOraclePending('ubuntu', pending), pending);
});

test('missing legs, missing shells and applicable pending oracles refuse coverage', () => {
  const oracles = oracleCoverageFixture();
  assert.deepEqual(validateOracleCoverage({ oracles }), []);
  oracles.pop();
  assert.ok(
    validateOracleCoverage({ oracles }).some((e) =>
      e.includes('windows/26.1.0'),
    ),
  );
  oracles[2].shells.pop();
  assert.ok(
    validateOracleCoverage({ oracles }).some((e) => e.includes('macos/22')),
  );
  oracles[3].pending.push('mandatory HTTP/TLS fixture');
  assert.ok(
    validateOracleCoverage({ oracles }).some((e) =>
      e.includes('mandatory HTTP/TLS'),
    ),
  );
});
