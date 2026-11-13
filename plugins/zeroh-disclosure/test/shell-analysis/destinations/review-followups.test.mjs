// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateCorpus } from './corpus.mjs';
import {
  destinationFingerprints,
  evidenceHash,
  readDestinationEvidence,
  REQUIRED_LEGS,
  REQUIRED_NODES,
  validateDestinationRelease,
  validateDestinationSource,
} from './gate.mjs';
import * as benchmark from '../parsers/benchmark.mjs';
import { freshEnvironment } from './isolation.mjs';
import { oracleCoverageFixture } from './oracle-coverage-fixture.mjs';
import {
  collectDestinationLeg,
  mergeDestinationReports,
} from '../../../scripts/destination-ci.mjs';

import { monorepoOnly } from '../../monorepo.mjs';

const PLUGIN = fileURLToPath(new URL('../../../', import.meta.url));
const DESTINATIONS = 'test/shell-analysis/destinations';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function passingEvidence(source = PLUGIN) {
  const evidence = readDestinationEvidence(path.join(source, DESTINATIONS));
  Object.assign(evidence.differential, destinationFingerprints(source));
  evidence.differential.runtimeHash ??= 'f'.repeat(64);
  evidence.differential.sourceCommit = spawnSync(
    'git',
    ['-C', source, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).stdout.trim();
  evidence.sourceCommit = evidence.differential.sourceCommit;
  evidence.differential.oracleRequirementsChecked = true;
  evidence.differential.unresolvedOracles = [];
  evidence.differential.oracles = oracleCoverageFixture();
  evidence.differential.observationProvenance = {
    reusedRows: 0,
    regeneratedRows: evidence.differential.cases.length,
  };
  evidence.differential.legs = Object.entries(REQUIRED_LEGS).flatMap(
    ([platform, shells]) =>
      REQUIRED_NODES.flatMap((node) =>
        shells.map((shell) => ({
          platform,
          node,
          shell,
          status: 'passed',
          oraclePassed: true,
          commitSha: evidence.differential.sourceCommit,
          ciRunId: '123',
          observationsRegenerated: true,
          ...destinationFingerprints(source),
        })),
      ),
  );
  return evidence;
}

function copiedSource(fixture) {
  const source = path.join(fixture.root, 'source');
  for (const directory of [
    'packages',
    'hooks',
    'lib',
    'vendor',
    'test/shell-analysis/parsers',
    DESTINATIONS,
    'scripts',
  ])
    cpSync(path.join(PLUGIN, directory), path.join(source, directory), {
      recursive: true,
    });
  for (const file of ['package.json', 'CHANGELOG.md'])
    cpSync(path.join(PLUGIN, file), path.join(source, file));
  return source;
}

function git(source, env, args) {
  const result = spawnSync('git', ['-C', source, ...args], {
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, 'fixture Git operation failed');
  return result.stdout.trim();
}

function commit(source, env, message) {
  git(source, env, ['add', '.']);
  git(source, env, [
    '-c',
    'user.name=ZEROHFAKE',
    '-c',
    'user.email=ZEROHFAKE',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    message,
  ]);
  return git(source, env, ['rev-parse', 'HEAD']);
}

test('CI evidence at C passes after its evidence-only commit C+1; runtime change is stale', () => {
  const fixture = freshEnvironment('evidence-ancestry');
  try {
    const source = copiedSource(fixture);
    git(source, fixture.env, ['init', '--quiet']);
    const ciCommit = commit(source, fixture.env, 'synthetic CI source');
    const evidence = passingEvidence(source);
    assert.deepEqual(validateDestinationSource(source, evidence), []);
    writeFileSync(
      path.join(source, DESTINATIONS, 'evidence/differential.json'),
      JSON.stringify(evidence.differential),
    );
    assert.notEqual(
      commit(source, fixture.env, 'synthetic evidence merge'),
      ciCommit,
    );
    assert.deepEqual(validateDestinationSource(source, evidence), []);
    const runtime = path.join(source, 'lib/hook-io.js');
    writeFileSync(
      runtime,
      `${readFileSync(runtime, 'utf8')}\n// synthetic runtime change\n`,
    );
    commit(source, fixture.env, 'synthetic runtime edit');
    assert.ok(
      validateDestinationSource(source, evidence).includes(
        'stale destination runtimeHash',
      ),
    );
    git(source, fixture.env, ['checkout', '--quiet', '--orphan', 'unrelated']);
    commit(source, fixture.env, 'synthetic unrelated release');
    assert.ok(
      validateDestinationSource(source, evidence).some((error) =>
        error.includes('ancestor'),
      ),
    );
    evidence.differential.sourceCommit = '0'.repeat(40);
    for (const leg of evidence.differential.legs)
      leg.commitSha = evidence.differential.sourceCommit;
    assert.ok(
      validateDestinationSource(source, evidence).some((error) =>
        error.includes('ancestor'),
      ),
    );
  } finally {
    fixture.cleanup();
  }
});

const invalidRunIds = ['123.4', 'x', ' 123', '123\n', '', '-123', 123];

test(
  'collection refuses non-numeric CI run ids before probing any shells',
  { skip: monorepoOnly('release source Git history') },
  async () => {
    const fixture = freshEnvironment('invalid-run-id');
    const originalPath = process.env.PATH;
    try {
      // Give legacy collection Git but no shells, so a decimal accepted by its
      // old regex fails quickly at the shell probe instead of running oracles.
      const bin = path.join(fixture.root, 'git-only');
      mkdirSync(bin);
      // Native Windows publication tests must not require symlink privileges.
      if (process.platform !== 'win32') {
        const gitPath = spawnSync(
          process.platform === 'win32' ? 'where' : 'which',
          ['git'],
          { encoding: 'utf8' },
        )
          .stdout.trim()
          .split('\n')[0];
        symlinkSync(
          gitPath,
          path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git'),
        );
        process.env.PATH = bin;
      }
      for (const ciRunId of invalidRunIds)
        await assert.rejects(
          collectDestinationLeg({
            platform: { linux: 'ubuntu', darwin: 'macos', win32: 'windows' }[
              process.platform
            ],
            node: process.versions.node.startsWith('22.')
              ? '22'
              : process.versions.node,
            output: path.join(fixture.root, 'unused'),
            ciRunId,
          }),
          /run id/,
        );
    } finally {
      process.env.PATH = originalPath;
      fixture.cleanup();
    }
  },
);

test(
  'merge refuses non-numeric CI run ids',
  { skip: monorepoOnly('release source Git history') },
  () => {
    const evidence = passingEvidence();
    assert.doesNotThrow(() => mergeDestinationReports([evidence.differential]));
    for (const ciRunId of invalidRunIds) {
      const report = structuredClone(evidence.differential);
      for (const leg of report.legs) leg.ciRunId = ciRunId;
      assert.throws(() => mergeDestinationReports([report]), /provenance/);
    }
  },
);

test(
  'gate refuses non-numeric CI run ids',
  { skip: monorepoOnly('release source Git history') },
  () => {
    const evidence = passingEvidence();
    assert.deepEqual(validateDestinationRelease(evidence), []);
    for (const ciRunId of invalidRunIds) {
      const report = structuredClone(evidence.differential);
      for (const leg of report.legs) leg.ciRunId = ciRunId;
      assert.ok(
        validateDestinationRelease({ ...evidence, differential: report }).some(
          (error) => error.includes('required destination leg'),
        ),
      );
    }
  },
);

test('all 136 baseline rows pin SHA-256 of their exact current command text', () => {
  const baseline = readDestinationEvidence(
    path.join(PLUGIN, DESTINATIONS),
  ).baseline;
  const corpus = new Map(generateCorpus().map((row) => [row.id, row]));
  assert.equal(baseline.entries.length, 136);
  for (const row of baseline.entries)
    assert.equal(row.commandHash, sha256(corpus.get(row.id).command));
});

test(
  'selected Ubuntu CI coverage enforces baseline and deferrals on ordinary PRs',
  { skip: monorepoOnly('release source Git history') },
  () => {
    const evidence = passingEvidence();
    const requiredMatrix = [{ platform: 'ubuntu', node: '26.1.0' }];
    evidence.differential.legs = evidence.differential.legs.filter(
      (leg) => leg.platform === 'ubuntu' && leg.node === '26.1.0',
    );
    evidence.differential.oracles = evidence.differential.oracles.filter(
      (leg) => leg.platform === 'ubuntu' && leg.node === '26.1.0',
    );
    assert.deepEqual(
      validateDestinationSource(PLUGIN, evidence, { requiredMatrix }),
      [],
    );
    assert.ok(validateDestinationSource(PLUGIN, evidence).length);
    const row = evidence.differential.cases.find(
      (entry) => entry.classification === 'correct',
    );
    for (const classification of ['false-stop', 'missed-protection']) {
      row.classification = classification;
      assert.ok(
        validateDestinationSource(PLUGIN, evidence, { requiredMatrix }).some(
          (error) => error.includes(row.id),
        ),
      );
    }
  },
);

test(
  'partial coverage keeps a cross-platform deferral when Ubuntu is fixed',
  { skip: monorepoOnly('release source Git history') },
  () => {
    const evidence = passingEvidence();
    const ubuntu = structuredClone(evidence.differential);
    const other = structuredClone(evidence.differential);
    const requiredMatrix = [{ platform: 'ubuntu', node: '26.1.0' }];
    ubuntu.legs = ubuntu.legs.filter(
      (leg) => leg.platform === 'ubuntu' && leg.node === '26.1.0',
    );
    ubuntu.oracles = ubuntu.oracles.filter(
      (leg) => leg.platform === 'ubuntu' && leg.node === '26.1.0',
    );
    other.legs = other.legs.filter(
      (leg) => leg.platform !== 'ubuntu' || leg.node !== '26.1.0',
    );
    other.oracles = other.oracles.filter(
      (leg) => leg.platform !== 'ubuntu' || leg.node !== '26.1.0',
    );
    const row = ubuntu.cases.find(
      (entry) => entry.classification === 'false-stop',
    );
    row.classification = 'correct';
    const full = {
      ...evidence,
      differential: mergeDestinationReports([ubuntu, other]),
    };
    assert.deepEqual(validateDestinationRelease(full), []);
    const partial = { ...evidence, differential: ubuntu };
    assert.deepEqual(
      validateDestinationRelease(partial, { requiredMatrix }),
      [],
    );
    const deferral = partial.deferrals.find((entry) => entry.id === row.id);
    deferral.nextReleaseTask = '';
    assert.ok(
      validateDestinationRelease(partial, { requiredMatrix }).some(
        (error) => error.includes(row.id) && error.includes('nextReleaseTask'),
      ),
    );
    deferral.nextReleaseTask = '44.9';
    row.classification = 'receipt-gap';
    assert.ok(
      validateDestinationRelease(partial, { requiredMatrix }).some((error) =>
        error.includes(row.id),
      ),
    );
    row.classification = 'correct';
    const fixed = full.differential.cases.find((entry) => entry.id === row.id);
    fixed.classification = 'correct';
    delete fixed.observationsByLeg;
    assert.ok(
      validateDestinationRelease(full).includes(
        `deferral ${row.id} has no unresolved observed case`,
      ),
    );
  },
);

test('merge CLI gates selected PR and full push evidence before writing output', () => {
  const fixture = freshEnvironment('selected-ci-gate');
  try {
    const source = copiedSource(fixture);
    git(source, fixture.env, ['init', '--quiet']);
    commit(source, fixture.env, 'synthetic selected CI source');
    const evidence = passingEvidence(source);
    const reports = Object.keys(REQUIRED_LEGS).flatMap((platform) =>
      REQUIRED_NODES.map((node) => {
        const report = structuredClone(evidence.differential);
        report.legs = report.legs.filter(
          (leg) => leg.platform === platform && leg.node === node,
        );
        report.oracles = report.oracles.filter(
          (leg) => leg.platform === platform && leg.node === node,
        );
        return {
          report,
          file: path.join(fixture.root, `${platform}-${node}.json`),
        };
      }),
    );
    const output = path.join(fixture.root, 'merged.json');
    function run(selected, coverage) {
      for (const { file, report } of selected)
        writeFileSync(file, JSON.stringify(report));
      return spawnSync(
        process.execPath,
        [
          path.join(source, 'scripts/destination-ci.mjs'),
          '--mode',
          'merge',
          '--coverage',
          coverage,
          '--inputs',
          selected.map(({ file }) => file).join(','),
          '--output',
          output,
        ],
        { env: fixture.env, encoding: 'utf8' },
      );
    }
    const pr = reports.filter(
      ({ report }) =>
        report.legs[0].platform === 'ubuntu' &&
        report.legs[0].node === '26.1.0',
    );
    assert.equal(run(pr, 'ubuntu').status, 0);
    assert.notEqual(run(pr, 'full').status, 0);
    const baselineRow = reports[0].report.cases.find(
      (row) => row.classification === 'false-stop',
    );
    // One fixed leg is compatible with an accepted defect on another leg.
    reports[2].report.cases.find(
      (row) => row.id === baselineRow.id,
    ).classification = 'correct';
    assert.equal(run(reports, 'full').status, 0);
    for (const [selected, coverage] of [
      [pr, 'ubuntu'],
      [reports, 'full'],
    ]) {
      const row = selected[0].report.cases.find(
        (entry) => entry.classification === 'correct',
      );
      const original = readFileSync(output, 'utf8');
      for (const classification of ['false-stop', 'missed-protection']) {
        row.classification = classification;
        const result = run(selected, coverage);
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes(row.id));
        assert.equal(readFileSync(output, 'utf8'), original);
      }
      row.classification = 'correct';
    }
    reports[2].report.cases.find(
      (row) => row.id === baselineRow.id,
    ).classification = 'receipt-gap';
    assert.notEqual(run(reports, 'full').status, 0);
  } finally {
    fixture.cleanup();
  }
});

test(
  'every leg is validated before an accepted baseline classification can mask a new defect',
  { skip: monorepoOnly('release source Git history') },
  () => {
    const evidence = passingEvidence();
    const ubuntu = structuredClone(evidence.differential);
    const macos = structuredClone(evidence.differential);
    ubuntu.legs = ubuntu.legs.filter((leg) => leg.platform === 'ubuntu');
    macos.legs = macos.legs.filter((leg) => leg.platform === 'macos');
    const row = ubuntu.cases.find(
      (entry) => entry.classification === 'false-stop',
    );
    const other = macos.cases.find((entry) => entry.id === row.id);
    for (const classification of [
      'receipt-gap',
      'missed-protection',
      'notice-gap',
    ]) {
      other.classification = classification;
      assert.throws(
        () => mergeDestinationReports([ubuntu, macos]),
        new RegExp(row.id),
      );
      const merged = structuredClone(evidence.differential);
      const aggregate = merged.cases.find((entry) => entry.id === row.id);
      aggregate.observationsByLeg = [
        { ...row, legs: ['ubuntu/26.1.0'] },
        { ...other, legs: ['macos/26.1.0'] },
      ];
      assert.ok(
        validateDestinationRelease({ ...evidence, differential: merged }).some(
          (error) => error.includes(row.id),
        ),
      );
    }
  },
);

test(
  'a baseline id cannot authorize different command text even with fresh fingerprints',
  { skip: monorepoOnly('release source Git history') },
  () => {
    const evidence = passingEvidence();
    const corpus = new Map(generateCorpus().map((row) => [row.id, row]));
    for (const row of evidence.baseline.entries)
      row.commandHash = sha256(corpus.get(row.id).command);
    assert.deepEqual(validateDestinationRelease(evidence), []);
    evidence.baseline.entries[0].commandHash = sha256(
      `${corpus.get(evidence.baseline.entries[0].id).command} `,
    );
    assert.ok(
      validateDestinationRelease(evidence).some((error) =>
        error.includes('command hash'),
      ),
    );
  },
);

test('changing a baseline command in the corpus refuses even with fresh fingerprints', async () => {
  const fixture = freshEnvironment('baseline-command-edit');
  try {
    const source = copiedSource(fixture);
    git(source, fixture.env, ['init', '--quiet']);
    commit(source, fixture.env, 'synthetic baseline source');
    const evidence = passingEvidence(source);
    const corpus = path.join(source, DESTINATIONS, 'corpus.mjs');
    const id = evidence.baseline.entries[0].id;
    const text = readFileSync(corpus, 'utf8');
    assert.equal(text.split('  return rows;').length, 2);
    writeFileSync(
      corpus,
      text.replace(
        '  return rows;',
        `  rows.find(row => row.id === '${id}').command += ' ';\n  return rows;`,
      ),
    );
    const gate = await import(
      pathToFileURL(path.join(source, DESTINATIONS, 'gate.mjs')).href
    );
    Object.assign(evidence.differential, gate.destinationFingerprints(source));
    for (const leg of evidence.differential.legs)
      Object.assign(leg, gate.destinationFingerprints(source));
    const errors = gate.validateDestinationSource(source, evidence);
    assert.ok(errors.some((error) => error.includes('command hash')));
    assert.ok(!errors.some((error) => error.includes('stale destination')));
  } finally {
    fixture.cleanup();
  }
});

test('changing HISTORY_HASH to the current history without an update record refuses', async () => {
  const fixture = freshEnvironment('history-anchor');
  try {
    const source = copiedSource(fixture);
    git(source, fixture.env, ['init', '--quiet']);
    commit(source, fixture.env, 'synthetic history source');
    const gate = path.join(source, DESTINATIONS, 'gate.mjs');
    const text = readFileSync(gate, 'utf8');
    const original = await import(pathToFileURL(gate).href);
    const history = readDestinationEvidence(path.join(source, DESTINATIONS));
    const newAnchor = original.evidenceHash(history.previousDeferrals);
    writeFileSync(
      gate,
      text.replace(
        /export const HISTORY_HASH =\s*'[a-f0-9]{64}';/u,
        `export const HISTORY_HASH = '${newAnchor}';`,
      ),
    );
    const modified = await import(`${pathToFileURL(gate).href}?changed-anchor`);
    const evidence = passingEvidence(source);
    evidence.historyUpdates = [];
    assert.ok(
      modified
        .validateDestinationSource(source, evidence)
        .some((error) => error.includes('history')),
    );
  } finally {
    fixture.cleanup();
  }
});

test(
  'accepted design text retains its line and immediately records the dated amendment',
  { skip: monorepoOnly('internal/destination-policy-2026-10-03.md') },
  () => {
    const text = readFileSync(
      path.join(PLUGIN, 'internal/destination-policy-2026-10-03.md'),
      'utf8',
    );
    assert.match(
      text,
      /- 43\.4 release gate unchanged\.\n  Note, 2026-10-05:.*owner ruling.*ruling 1/u,
    );
  },
);

test('benchmark hooks run interleaved ABAB with twenty cold samples in each leg', () => {
  assert.equal(typeof benchmark.interleaveHookSamples, 'function');
  const calls = [];
  const result = benchmark.interleaveHookSamples((withAdapter, sample) => {
    calls.push([withAdapter, sample]);
    return sample + (withAdapter ? 100 : 0);
  });
  assert.deepEqual(
    calls,
    Array.from({ length: 20 }, (_, sample) => [
      [false, sample],
      [true, sample],
    ]).flat(),
  );
  assert.deepEqual(
    result.baselineSamples,
    Array.from({ length: 20 }, (_, i) => i),
  );
  assert.deepEqual(
    result.hookSamples,
    Array.from({ length: 20 }, (_, i) => i + 100),
  );
  assert.throws(
    () =>
      benchmark.interleaveHookSamples(() => {
        throw new Error('failed cold sample');
      }),
    /failed cold sample/,
  );
});

test('the URL-only and guard-fix patches keep exactly the 1.0 baseline; 1.1.3 requires the new analyzer', () => {
  const fixtureEvidence = () => {
    const evidence = passingEvidence();
    // Release validation uses synthetic evidence; a public staged tree has no Git history.
    const sourceCommit = 'c'.repeat(40);
    evidence.sourceCommit = sourceCommit;
    evidence.differential.sourceCommit = sourceCommit;
    for (const leg of evidence.differential.legs) leg.commitSha = sourceCommit;
    return evidence;
  };
  for (const releaseVersion of ['1.1.0', '1.1.1', '1.1.2']) {
    const evidence = fixtureEvidence();
    evidence.releaseVersion = releaseVersion;
    assert.deepEqual(validateDestinationRelease(evidence), []);
    evidence.differential.cases.push({
      id: 'ZEROHFAKE-new-defect',
      classification: 'missed-protection',
      shell: 'bash',
    });
    assert.ok(
      validateDestinationRelease(evidence).some((error) =>
        error.includes('outside the 1.0 baseline'),
      ),
    );
  }
  const engine = fixtureEvidence();
  engine.releaseVersion = '1.1.3';
  const errors = validateDestinationRelease(engine);
  assert.ok(errors.some((error) => error.includes('false stop outside')));
  assert.ok(errors.some((error) => error.includes('lacks passing evidence')));
});

test('every current destination target is backed by the dated V112 owner amendment', () => {
  const evidence = readDestinationEvidence(path.join(PLUGIN, DESTINATIONS));
  for (const current of evidence.deferrals) {
    assert.equal(current.nextRelease, '1.1.3');
    const previous = evidence.previousDeferrals.find(
      (entry) => entry.id === current.id,
    );
    const v112 = evidence.updates.find(
      (update) =>
        update.id === current.id &&
        update.explicit === true &&
        update.date === '2026-11-10' &&
        update.rulingReference.startsWith('owner ruling 2026-11-09') &&
        update.beforeHash === evidenceHash(previous) &&
        update.afterHash === evidenceHash(current),
    );
    assert.ok(v112, current.id);
    // The V112 amendment supersedes, and keeps, the dated V111 owner amendment.
    assert.ok(
      evidence.updates.some(
        (update) =>
          update.id === current.id &&
          update.explicit === true &&
          update.date === '2026-10-09' &&
          update.rulingReference.startsWith('owner ruling 2026-10-09') &&
          update.beforeHash === evidenceHash(previous) &&
          update.afterHash === v112.supersedesAfterHash,
      ),
      current.id,
    );
  }
});
