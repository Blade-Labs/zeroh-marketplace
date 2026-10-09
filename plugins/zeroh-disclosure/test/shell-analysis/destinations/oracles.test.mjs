// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runDestinationOracles } from './oracles.mjs';
import { TEST_ROOT } from './isolation.mjs';

test(
  'real shells, parser adapters and independent loopback client effects agree',
  {
    skip:
      process.env.ZEROH_DESTINATION_ORACLES !== '1' &&
      'Dedicated destination CI or explicit ZEROH_DESTINATION_ORACLES=1 only',
  },
  async (t) => {
    const defaults =
      process.platform === 'win32'
        ? ['git-bash', 'pwsh', 'powershell-5.1', 'cmd']
        : process.platform === 'darwin'
          ? ['bash-3.2', 'bash', 'zsh', 'pwsh']
          : ['bash', 'zsh'];
    const shells = process.env.ZEROH_DESTINATION_SHELLS?.split(',') || defaults;
    const report = await runDestinationOracles({ shells });
    if (process.env.ZEROH_DESTINATION_ORACLE_OUTPUT) {
      const output = path.resolve(process.env.ZEROH_DESTINATION_ORACLE_OUTPUT);
      assert.equal(
        output.startsWith(path.resolve(TEST_ROOT) + path.sep),
        true,
        'oracle report must remain under the isolated acceptance root',
      );
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    }
    assert.deepEqual(report.failures, []);
    for (const shell of report.shells) {
      assert.equal(shell.available, true, shell.shell);
      assert.equal(shell.corpus.complete, true, shell.shell);
      assert.ok(shell.corpus.count > 0, shell.shell);
      assert.equal(shell.wrongExpectationDetected, true, shell.shell);
      if (shell.shell !== 'cmd')
        assert.equal(shell.restoration.delivered, true, shell.shell);
      t.diagnostic(
        `${shell.shell}: ${shell.corpus.observed} generated argv cases, ${shell.argvCases} direct probes, ${shell.parser.cases} parser probes`,
      );
    }
    assert.equal(report.requests.crossHostRedirect, true);
    assert.equal(report.requests.qDisablesDefault, true);
    assert.equal(report.requests.dns.tsigSecretLocal, true);
    assert.equal(report.requests.wildcard.checked, true);
    assert.ok(report.requests.wildcard.cases >= 7);
    assert.deepEqual(report.requests.historical.failures, []);
    assert.deepEqual(report.requests.programs.failures, []);
    assert.ok(
      report.requests.programs.results.some((row) => row.status === 'passed'),
    );
    for (const shell of report.shells.filter((row) =>
      ['bash', 'zsh'].includes(row.shell),
    )) {
      assert.equal(shell.restoration.hook.allowed, 'allow');
      assert.equal(shell.restoration.hook.denied, 'deny');
      assert.equal(shell.restoration.hook.delivered, true);
      assert.equal(shell.restoration.hook.notice, 'notice');
      assert.equal(shell.restoration.hook.receipt, true);
      assert.equal(shell.restoration.exitStatusWrapper, true);
      assert.equal(shell.restoration.nonzeroReported, true);
    }
  },
);
