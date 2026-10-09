// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyCase,
  hookWithInput,
  observeCase,
  recordedReasons,
  runDifferential,
} from './differential.mjs';
import { generateCorpus } from './corpus.mjs';
import {
  REQUIRED_LEGS,
  REQUIRED_NODES,
  evidenceHash,
  validateDestinationRelease,
} from './gate.mjs';
import { freshEnvironment } from './isolation.mjs';

const PLUGIN = fileURLToPath(new URL('../../../', import.meta.url));

test('bounded differential workers preserve serial bytes with independent row homes', async () => {
  const rows = generateCorpus()
    .filter((row) => row.shell === 'bash')
    .slice(0, 8);
  const serial = await runDifferential({ rows, concurrency: 1 });
  const parallel = await runDifferential({ rows, concurrency: 4 });
  assert.equal(JSON.stringify(parallel), JSON.stringify(serial));
  assert.ok(serial.cases.every((row) => row.classification !== 'untriaged'));
  for (const concurrency of [0, 5, 1.5])
    await assert.rejects(
      runDifferential({ rows: [], concurrency }),
      /concurrency/,
    );
});

function evidence(cases) {
  const observations = cases.map((entry) => ({
    shell: 'bash',
    observedVia: 'real-pre-tool-use',
    ...entry,
  }));
  if (!observations.some((entry) => entry.shell === 'cmd'))
    observations.push({
      id: 'fixture-cmd',
      shell: 'cmd',
      observedVia: 'real-pre-tool-use',
      classification: 'correct',
    });
  return {
    releaseVersion: '1.1.1',
    sourceCommit: 'c'.repeat(40),
    differential: {
      schemaVersion: 1,
      sourceCommit: 'c'.repeat(40),
      runtimeHash: 'e'.repeat(64),
      corpusHash: 'a'.repeat(64),
      analyzerHash: 'b'.repeat(64),
      cases: observations,
      legs: Object.entries(REQUIRED_LEGS).flatMap(([platform, shells]) =>
        REQUIRED_NODES.flatMap((node) =>
          shells.map((shell) => ({
            platform,
            node,
            shell,
            status: 'passed',
            commitSha: 'c'.repeat(40),
            ciRunId: '12345',
            observationsRegenerated: true,
            corpusHash: 'a'.repeat(64),
            analyzerHash: 'b'.repeat(64),
            runtimeHash: 'e'.repeat(64),
            oraclePassed: true,
            parserGatePassed: shell !== 'cmd',
            parserEvidence: {
              platform: { ubuntu: 'linux', macos: 'darwin', windows: 'win32' }[
                platform
              ],
              shell,
              node: node === '22' ? '22.14.0' : node,
              sampleCount: 20,
              corpusCount: 60,
              corpusSha256:
                'ad0f8ceaa5d31a86e093308bd5256a6d44a746309c4483fc58468c4fcaa2bb28',
              rawSamples: {
                parser: Array(20).fill(10),
                wholeHook: Array(20).fill(10),
                noAdapterHook: Array(20).fill(10),
              },
              measures: {
                parser: { count: 20, p50Ms: 10, p95Ms: 10 },
                wholeHook: { count: 20, p50Ms: 10, p95Ms: 10 },
                noAdapterHook: { count: 20, p50Ms: 10, p95Ms: 10 },
              },
            },
            fallbackPassed: shell === 'cmd',
            fallbackEvidence:
              shell === 'cmd'
                ? {
                    platform: {
                      ubuntu: 'linux',
                      macos: 'darwin',
                      windows: 'win32',
                    }[platform],
                    node: node === '22' ? '22.14.0' : node,
                    shell,
                    correctnessPassed: true,
                    noticePassed: true,
                    caseIds: observations
                      .filter((entry) => entry.shell === 'cmd')
                      .map((entry) => entry.id),
                  }
                : undefined,
          })),
        ),
      ),
    },
    blocking: [],
    deferrals: [],
    previousDeferrals: [],
    updates: [],
  };
}

test('differential distinguishes false stops, misses, absent notices and absent receipts', () => {
  const row = { expected: { outcome: 'allow' } };
  assert.equal(
    classifyCase(row, { outcome: 'deny' }).classification,
    'false-stop',
  );
  assert.equal(
    classifyCase({ expected: { outcome: 'deny' } }, { outcome: 'allow' })
      .classification,
    'missed-protection',
  );
  assert.equal(
    classifyCase({ expected: { outcome: 'notice' } }, { outcome: 'allow' })
      .classification,
    'notice-gap',
  );
  assert.equal(
    classifyCase(row, {
      outcome: 'notice',
      notice: 'not protected',
      receipt: false,
    }).classification,
    'receipt-gap',
  );
  assert.equal(
    classifyCase(row, {
      outcome: 'notice',
      notice: 'not protected',
      receipt: true,
    }).classification,
    'correct',
  );
});

test('a notice and receipt cannot authorize a mandatory protection mutation', () => {
  const result = classifyCase(
    { expected: { outcome: 'deny', effect: 'protection' } },
    { outcome: 'notice', notice: 'Ran unchecked', receipt: true },
  );
  assert.equal(result.classification, 'missed-protection');
  assert.match(result.reason, /mandatory protection mutation/u);
  assert.ok(
    validateDestinationRelease(evidence([{ id: 'protection', ...result }]))
      .length,
  );
});

test('a new escape or false stop injected into copied policy is rejected after real hooks', async () => {
  const row = generateCorpus().find(
    (entry) => entry.id === '43-bash-curl-0-single',
  );
  assert.ok(row);
  const fixture = freshEnvironment('policy-mutation');
  try {
    const mutate = (name, statement) => {
      const copy = path.join(fixture.root, name);
      mkdirSync(copy);
      // Runtime files only: the mutation never changes the production analyzer.
      for (const directory of ['packages', 'lib', 'hooks', 'vendor'])
        cpSync(path.join(PLUGIN, directory), path.join(copy, directory), {
          recursive: true,
        });
      cpSync(
        path.join(PLUGIN, 'package.json'),
        path.join(copy, 'package.json'),
      );
      const policy = path.join(
        copy,
        'packages/shell-analysis/secrets/decide.js',
      );
      const source = readFileSync(policy, 'utf8');
      const anchor = '  const hosts = given ?? hostsIn(text);';
      assert.equal(
        source.split(anchor).length,
        2,
        'mutation insertion point changed',
      );
      writeFileSync(
        policy,
        source.replace(anchor, `  ${statement}\n${anchor}`),
      );
      return copy;
    };
    const escapeSource = mutate(
      'escape',
      'return { ok: true, violations: [] };',
    );
    const escape = await observeCase(row, { pluginSource: escapeSource });
    assert.equal(escape.observedVia, 'real-pre-tool-use');
    assert.equal(escape.outcome, 'allow');
    assert.equal(escape.classification, 'missed-protection');
    assert.ok(
      validateDestinationRelease(evidence([escape])).some((error) =>
        error.includes('untriaged'),
      ),
    );
    const stopSource = mutate(
      'false-stop',
      "return { ok: false, violations: restored.map((entry) => ({ token: entry.token, name: 'DESTINATION', host: 'api.example.com', allowed: [] })) };",
    );
    const allowed = {
      ...row,
      id: `${row.id}-mutation-allowed`,
      allowedHosts: [...row.expected.hosts],
      expected: { ...row.expected, outcome: 'allow' },
    };
    const stop = await observeCase(allowed, { pluginSource: stopSource });
    assert.equal(stop.observedVia, 'real-pre-tool-use');
    assert.equal(stop.outcome, 'deny');
    assert.equal(stop.classification, 'false-stop');
    assert.ok(
      validateDestinationRelease(evidence([stop])).some((error) =>
        error.includes('false stop'),
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

test('missing required shells and a declared unproven fallback fail the release', () => {
  const report = evidence([{ id: 'case', classification: 'correct' }]);
  report.differential.legs[0].parserGatePassed = false;
  assert.ok(validateDestinationRelease(report).length);
  report.differential.legs[0].fallbackPassed = true;
  assert.ok(validateDestinationRelease(report).length);
  report.differential.legs[0].fallbackEvidence = {
    platform: 'linux',
    node: '22.14.0',
    shell: 'bash',
    correctnessPassed: true,
    noticePassed: true,
    caseIds: ['case'],
  };
  assert.deepEqual(validateDestinationRelease(report), []);
  report.differential.legs[0].fallbackEvidence.platform = 'darwin';
  assert.ok(validateDestinationRelease(report).length);
  report.differential.legs[0].fallbackEvidence.platform = 'linux';
  report.differential.cases[0].observationsByLeg = [
    {
      legs: ['ubuntu/22'],
      classification: 'missed-protection',
      observedVia: 'real-pre-tool-use',
    },
  ];
  assert.ok(validateDestinationRelease(report).length);
  delete report.differential.cases[0].observationsByLeg;
  report.differential.legs.pop();
  assert.ok(validateDestinationRelease(report).length);
});

test('missing deferral-history fields cannot erase previous release dispositions', () => {
  for (const field of ['previousDeferrals', 'updates']) {
    const report = evidence([{ id: 'case', classification: 'correct' }]);
    delete report[field];
    assert.ok(
      validateDestinationRelease(report).includes(
        'destination triage lists are malformed',
      ),
    );
  }
});

test('one eight-second hook outlier invalidates evidence despite a passing p95', () => {
  const report = evidence([{ id: 'case', classification: 'correct' }]);
  assert.deepEqual(validateDestinationRelease(report), []);
  report.differential.legs[0].parserEvidence.rawSamples.wholeHook[19] = 8000;
  assert.ok(
    validateDestinationRelease(report).some((error) =>
      error.includes('ubuntu/22/bash'),
    ),
  );
  report.differential.legs[0].parserEvidence.rawSamples.wholeHook[19] = 10;
  report.differential.legs[0].parserEvidence.rawSamples.parser[19] = 8000;
  assert.ok(
    validateDestinationRelease(report).some((error) =>
      error.includes('ubuntu/22/bash'),
    ),
  );
});

test('parser evidence cannot be reused for another platform, shell or Node leg', () => {
  for (const changed of [
    { platform: 'darwin' },
    { shell: 'zsh' },
    { node: '26.1.0' },
  ]) {
    const report = evidence([{ id: 'case', classification: 'correct' }]);
    assert.deepEqual(validateDestinationRelease(report), []);
    Object.assign(report.differential.legs[0].parserEvidence, changed);
    assert.ok(
      validateDestinationRelease(report).some((error) =>
        error.includes('ubuntu/22/bash'),
      ),
    );
  }
  const report = evidence([{ id: 'case', classification: 'correct' }]);
  const exactNodeLeg = report.differential.legs.find(
    (leg) => leg.node === '26.1.0' && leg.shell === 'bash',
  );
  exactNodeLeg.parserEvidence.node = '26.1.1';
  assert.ok(
    validateDestinationRelease(report).some((error) =>
      error.includes('ubuntu/26.1.0/bash'),
    ),
  );
});

test('named deferral must preserve the actual notice and cannot disappear unresolved', () => {
  const entry = {
    id: 'case',
    program: 'curl',
    spelling: 'redirect',
    shell: 'bash',
    classification: 'missed-protection',
    reason: 'unresolved redirects',
    notice: 'not protected',
    releaseNote: 'release notes row',
    nextReleaseTask: '44.5',
  };
  const report = evidence([{ ...entry }]);
  report.deferrals = [entry];
  assert.deepEqual(validateDestinationRelease(report), []);
  report.previousDeferrals = [{ ...entry, reason: 'previous reason' }];
  assert.ok(
    validateDestinationRelease(report).some((error) =>
      error.includes('explicit update'),
    ),
  );
  report.updates = [
    {
      id: entry.id,
      explicit: true,
      date: '2026-10-05',
      reason: 'owner changed disposition',
      beforeHash: evidenceHash(report.previousDeferrals[0]),
      afterHash: evidenceHash(entry),
    },
  ];
  assert.deepEqual(validateDestinationRelease(report), []);
  report.deferrals = [];
  assert.ok(validateDestinationRelease(report).length);
});

test('real 1.0 PreToolUse observes a disallowed restored value without running the command', async () => {
  const row = generateCorpus().find(
    (entry) => entry.id === '43-bash-curl-0-single',
  );
  assert.ok(row);
  const observed = await observeCase(row);
  assert.equal(observed.observedVia, 'real-pre-tool-use');
  assert.equal(observed.outcome, 'deny');
  assert.equal(observed.classification, 'correct');
});

test('receipt evidence counts the actual tool and ignores unrelated previous notices', () => {
  const fixture = freshEnvironment('receipt-delta');
  try {
    const ledger = path.join(fixture.env.ZEROH_HOME, 'turn-1.json');
    writeFileSync(
      ledger,
      JSON.stringify({
        audit: {
          unchecked: {
            'proxy-not-running': { UserPromptSubmit: 1 },
            unparseable: { Bash: 2 },
          },
        },
      }),
    );
    const before = recordedReasons(fixture.env.ZEROH_HOME, 'Bash');
    assert.deepEqual(
      [...before.values()],
      [{ reason: 'unparseable', count: 2 }],
    );
    assert.equal(recordedReasons(fixture.env.ZEROH_HOME, 'PowerShell').size, 0);
    writeFileSync(
      ledger,
      JSON.stringify({
        audit: {
          unchecked: {
            'proxy-not-running': { UserPromptSubmit: 2 },
            unparseable: { Bash: 2 },
            'dynamic-destination': { Bash: 1 },
          },
        },
      }),
    );
    const added = [...recordedReasons(fixture.env.ZEROH_HOME, 'Bash')]
      .filter(([key, entry]) => entry.count > (before.get(key)?.count ?? 0))
      .map(([, entry]) => entry.reason);
    assert.deepEqual(added, ['dynamic-destination']);
  } finally {
    fixture.cleanup();
  }
});

test('cmd corpus is observed through the actual cmd /c launcher in the Bash tool', async () => {
  const row = generateCorpus().find(
    (entry) => entry.id === '43-cmd-curl-0-double',
  );
  assert.ok(row);
  const observed = await observeCase(row);
  assert.equal(observed.observedVia, 'real-pre-tool-use');
  assert.equal(observed.execution, 'cmd /d /s /c via Bash tool');
});

test('only missed protection outside the owner baseline is a deferrable kind', () => {
  for (const classification of [
    'false-stop',
    'notice-gap',
    'receipt-gap',
    'parser-disagreement',
  ]) {
    const entry = {
      id: 'new',
      program: 'curl',
      spelling: '-d',
      shell: 'bash',
      classification,
      reason: 'fixture',
      notice: 'Unchecked fixture',
      releaseNote: 'fixture note',
      nextReleaseTask: '44.9',
    };
    const report = evidence([entry]);
    report.deferrals = [entry];
    assert.ok(
      validateDestinationRelease(report).some((error) =>
        error.includes('not deferrable'),
      ),
    );
  }
});

test('timed-out rows retry exactly once after every parallel worker drains', async () => {
  const rows = Array.from({ length: 8 }, (_, id) => ({ id: String(id) }));
  const attempts = new Map();
  let active = 0;
  const report = await runDifferential({
    rows,
    concurrency: 4,
    observe: async (row) => {
      const attempt = (attempts.get(row.id) ?? 0) + 1;
      attempts.set(row.id, attempt);
      if (attempt === 2) {
        assert.equal(active, 0, 'retry overlapped a worker');
        assert.ok(
          rows.every((row) => attempts.has(row.id)),
          'pool not drained',
        );
      }
      active++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (['1', '3'].includes(row.id) && (attempt === 1 || row.id === '3'))
        return {
          id: row.id,
          observationStatus: 'timeout',
          reason: 'hook timeout',
          notice: '',
        };
      return { id: row.id, classification: 'correct' };
    },
  });
  assert.equal(attempts.get('1'), 2);
  assert.equal(attempts.get('3'), 2);
  assert.ok(
    rows
      .filter((row) => !['1', '3'].includes(row.id))
      .every((row) => attempts.get(row.id) === 1),
  );
  assert.deepEqual(report.counts, { correct: 7, timeout: 1 });
  assert.equal(report.cases[3].classification, undefined);
  assert.deepEqual(report.timeouts, [
    { id: '1', attempts: 2, recovered: true },
    { id: '3', attempts: 2, recovered: false },
  ]);
  const errors = validateDestinationRelease(evidence([report.cases[3]]));
  assert.ok(errors.includes('destination hook timeout after serial retry: 3'));
  assert.ok(
    !errors.some((error) => error.includes('untriaged destination case 3')),
  );
});

test('a real hook killed by the watchdog reports ETIMEDOUT and never classifies the row', async () => {
  const fixture = freshEnvironment('hook-timeout');
  try {
    mkdirSync(path.join(fixture.root, 'hooks'));
    writeFileSync(
      path.join(fixture.root, 'hooks/run.js'),
      'setInterval(() => {}, 1000);',
    );
    await assert.rejects(
      hookWithInput(
        fixture.env,
        fixture.root,
        {},
        'pre-tool-use',
        fixture.root,
        100,
      ),
      { code: 'ETIMEDOUT' },
    );
    const row = generateCorpus()[0];
    const observed = await observeCase(row, {
      runHook: async () => {
        const error = new Error('fixture timeout');
        error.code = 'ETIMEDOUT';
        throw error;
      },
    });
    assert.equal(observed.observationStatus, 'timeout');
    assert.equal(observed.classification, undefined);
  } finally {
    fixture.cleanup();
  }
});
