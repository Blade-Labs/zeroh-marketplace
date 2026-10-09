// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { freshEnvironment } from './destinations/isolation.mjs';
import {
  collectDestinationLeg,
  mergeDestinationReports,
  planDestinationLeg,
  requireDestinationShells,
  writeFailedDestinationReport,
} from '../../scripts/destination-ci.mjs';

test('oracle failures write the upload path, name the shell/cases and cannot become evidence', () => {
  const fixture = freshEnvironment('failed-report');
  try {
    const output = path.join(fixture.root, 'report.json');
    const logs = [];
    const report = writeFailedDestinationReport(
      {
        output,
        platform: 'ubuntu',
        node: '22',
        sourceCommit: 'c'.repeat(40),
        ciRunId: '650',
        plan: [{ shell: 'zsh' }],
        error: new Error('destination shell oracle failed'),
        oracle: {
          failures: ['case-rg: protected write absent'],
          diagnostics: [
            {
              oracle: 'historical',
              shell: 'zsh',
              caseIds: ['case-rg'],
              message: 'protected write absent',
              commands: [
                {
                  program: 'zsh',
                  status: 127,
                  stderr: 'zsh: command not found: rg\nsecond line',
                },
              ],
            },
          ],
        },
      },
      (line) => logs.push(line),
    );
    assert.match(logs.join('\n'), /oracle=historical shell=zsh cases=case-rg/);
    assert.match(logs.join('\n'), /command not found: rg\nsecond line/);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'failed');
    assert.equal(report.legs[0].oraclePassed, false);
    assert.throws(() => mergeDestinationReports([report]), /failed partial/);
  } finally {
    fixture.cleanup();
  }
});

test('all six CI legs require their exact execution shells', () => {
  const expected = {
    ubuntu: ['bash', 'zsh'],
    macos: ['bash-3.2', 'bash', 'zsh', 'pwsh'],
    windows: ['git-bash', 'pwsh', 'powershell-5.1', 'cmd'],
  };
  for (const [platform, shells] of Object.entries(expected))
    for (const node of ['22', '26.1.0']) {
      const plan = planDestinationLeg(platform, node);
      assert.deepEqual(
        plan.map((entry) => entry.shell),
        shells,
      );
      for (const missing of shells)
        assert.throws(
          () =>
            requireDestinationShells(plan, (command) => ({
              stdout:
                command === 'pwsh'
                  ? '7.0.0'
                  : command === 'powershell.exe'
                    ? '5.1.1'
                    : 'GNU bash, version 3.2.57',
              status:
                plan.find((entry) => entry.executable === command).shell ===
                missing
                  ? 1
                  : 0,
            })),
          new RegExp(missing),
        );
    }
  assert.throws(() => planDestinationLeg('unknown', '22'));
  assert.throws(() => planDestinationLeg('ubuntu', '24'));
});

test('CI reports cannot label a different operating system as locally exercised', async () => {
  await assert.rejects(
    collectDestinationLeg({
      platform: process.platform === 'win32' ? 'macos' : 'windows',
      node: '22',
      output: 'unused',
    }),
    /platform differs/,
  );
});

test('system bash and PowerShell editions must match their pinned shell legs', () => {
  for (const shell of ['bash-3.2', 'powershell-5.1', 'pwsh']) {
    assert.throws(
      () =>
        requireDestinationShells([{ shell, executable: shell }], () => ({
          status: 0,
          stdout: '9.9.9',
        })),
      /version differs/,
    );
  }
});

test('aggregation rejects unknown failures and conflicting case metadata', () => {
  const base = {
    sourceCommit: 'c'.repeat(40),
    observationProvenance: { reusedRows: 0 },
    corpusHash: 'corpus',
    analyzerHash: 'analyzer',
    cases: [
      {
        id: 'case',
        program: 'curl',
        shell: 'bash',
        spelling: '-d',
        classification: 'correct',
      },
    ],
    legs: [],
  };
  const unknown = {
    ...base,
    cases: [{ ...base.cases[0], classification: 'unknown-result' }],
  };
  assert.throws(
    () =>
      mergeDestinationReports([
        {
          ...base,
          cases: [{ ...base.cases[0], classification: 'parser-disagreement' }],
        },
      ]),
    /outside the 1.0 baseline/,
  );
  assert.throws(() => mergeDestinationReports([base, unknown]), /untriaged/);
  assert.throws(
    () =>
      mergeDestinationReports([
        base,
        { ...base, cases: [{ ...base.cases[0], shell: 'zsh' }] },
      ]),
    /metadata/,
  );
  assert.throws(
    () =>
      mergeDestinationReports([
        { ...base, cases: [base.cases[0], base.cases[0]] },
      ]),
    /duplicate/,
  );
});

test('Windows shell invocations use PowerShell profiles off and cmd /c', () => {
  const calls = [];
  requireDestinationShells(
    planDestinationLeg('windows', '22'),
    (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: command === 'pwsh' ? '7.0.0' : '5.1.1' };
    },
  );
  assert.deepEqual(calls[2].args.slice(0, 3), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
  ]);
  assert.deepEqual(calls[3].args, ['/d', '/s', '/c', 'exit 0']);
});

test('macOS Homebrew bash follows the runner architecture and keeps system bash distinct', () => {
  for (const [architecture, executable] of [
    ['x64', '/usr/local/bin/bash'],
    ['arm64', '/opt/homebrew/bin/bash'],
  ]) {
    const plan = planDestinationLeg('macos', '22', architecture);
    assert.equal(
      plan.find((row) => row.shell === 'bash').executable,
      executable,
    );
    assert.equal(
      plan.find((row) => row.shell === 'bash-3.2').executable,
      '/bin/bash',
    );
  }
});

test('aggregation refuses mismatched corpus, analyzer and case coverage', () => {
  const report = {
    sourceCommit: 'c'.repeat(40),
    observationProvenance: { reusedRows: 0 },
    corpusHash: 'corpus',
    analyzerHash: 'analyzer',
    cases: [{ id: 'case', classification: 'correct' }],
    legs: [
      {
        shell: 'bash',
        commitSha: 'c'.repeat(40),
        ciRunId: '123',
        observationsRegenerated: true,
      },
    ],
  };
  assert.equal(mergeDestinationReports([report, report]).legs.length, 2);
  for (const change of [
    { corpusHash: 'other' },
    { analyzerHash: 'other' },
    { runtimeHash: 'other' },
    { cases: [] },
  ])
    assert.throws(
      () => mergeDestinationReports([report, { ...report, ...change }]),
      /disagree/,
    );
  assert.throws(() => mergeDestinationReports([]), /no destination/);
});

test('aggregation retains accepted baseline observations alongside fixed legs', () => {
  const accepted = JSON.parse(
    readFileSync(
      new URL('./destinations/evidence/differential.json', import.meta.url),
      'utf8',
    ),
  ).cases.find((row) => row.classification === 'false-stop');
  const base = {
    sourceCommit: 'c'.repeat(40),
    observationProvenance: { reusedRows: 0 },
    corpusHash: 'corpus',
    analyzerHash: 'analyzer',
    cases: [{ ...accepted, classification: 'correct', notice: '' }],
    legs: [
      {
        platform: 'ubuntu',
        node: '22',
        commitSha: 'c'.repeat(40),
        ciRunId: '123',
        observationsRegenerated: true,
      },
    ],
  };
  const stopped = {
    ...base,
    cases: [{ ...accepted, notice: 'Observed notice.' }],
    legs: [{ ...base.legs[0], platform: 'macos' }],
  };
  const merged = mergeDestinationReports([base, stopped]);
  assert.equal(merged.cases[0].classification, 'false-stop');
  assert.equal(merged.cases[0].notice, 'Observed notice.');
  assert.equal(merged.cases[0].observationsByLeg.length, 2);
});

test('CI aggregation refuses mismatched commits, missing run IDs and reused observations', () => {
  const report = {
    sourceCommit: 'c'.repeat(40),
    corpusHash: 'corpus',
    analyzerHash: 'analyzer',
    observationProvenance: { reusedRows: 0 },
    cases: [{ id: 'case', classification: 'correct' }],
    legs: [
      {
        commitSha: 'c'.repeat(40),
        ciRunId: '123',
        observationsRegenerated: true,
      },
    ],
  };
  for (const change of [
    { sourceCommit: 'd'.repeat(40) },
    { observationProvenance: { reusedRows: 1 } },
    { legs: [{ ...report.legs[0], ciRunId: '' }] },
    { legs: [{ ...report.legs[0], commitSha: 'd'.repeat(40) }] },
  ])
    assert.throws(() =>
      mergeDestinationReports([report, { ...report, ...change }]),
    );
});

test('aggregation scopes Linux-only pending effects to Ubuntu reports', () => {
  const report = {
    sourceCommit: 'c'.repeat(40),
    observationProvenance: { reusedRows: 0 },
    cases: [{ id: 'case', classification: 'correct' }],
    legs: [
      {
        platform: 'macos',
        node: '22',
        commitSha: 'c'.repeat(40),
        ciRunId: '123',
        observationsRegenerated: true,
      },
    ],
    unresolvedOracles: [
      'programs: requires Linux and cc',
      'resolved: requires namespace',
    ],
  };
  assert.deepEqual(mergeDestinationReports([report]).unresolvedOracles, []);
  report.legs[0].platform = 'windows';
  assert.deepEqual(mergeDestinationReports([report]).unresolvedOracles, []);
  report.legs[0].platform = 'ubuntu';
  assert.deepEqual(
    mergeDestinationReports([report]).unresolvedOracles,
    report.unresolvedOracles,
  );
});

test('merge rejects a timeout before a correct leg can mask it', () => {
  const base = {
    sourceCommit: 'c'.repeat(40),
    observationProvenance: { reusedRows: 0 },
    corpusHash: 'corpus',
    analyzerHash: 'analyzer',
    legs: [],
    cases: [
      {
        id: 'slow',
        program: 'curl',
        shell: 'bash',
        spelling: '-d',
        classification: 'correct',
      },
    ],
  };
  const { classification, ...metadata } = base.cases[0];
  const timeout = {
    ...metadata,
    observationStatus: 'timeout',
    reason: 'hook timeout',
    notice: '',
  };
  assert.throws(
    () =>
      mergeDestinationReports([
        base,
        {
          ...base,
          cases: [timeout],
          timeouts: [{ id: 'slow', attempts: 2, recovered: false }],
        },
      ]),
    /timeout/,
  );
});
