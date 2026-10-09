// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { monorepoOnly } from '../monorepo.mjs';
import { PLUGIN, tempProject } from '../helpers.mjs';

test('WIN11 successful fixture removals never query processes, even for 5400 fixtures', async () => {
  const { removeProbeFixture } =
    await import('../tools/windows-crash-cleanup.mjs');
  let queries = 0;
  let removals = 0;
  const failures = [];
  for (let index = 0; index < 5400; index++)
    await removeProbeFixture('/ZEROHFAKE-fixture', failures, {
      processes() {
        queries++;
        return [];
      },
      remove() {
        removals++;
      },
    });
  assert.equal(queries, 0);
  assert.equal(removals, 5400);
  assert.deepEqual(failures, []);
});

test('WIN11 an unknown process query never causes a live-child wait', async () => {
  const { removeProbeFixture } =
    await import('../tools/windows-crash-cleanup.mjs');
  let queries = 0;
  let removals = 0;
  const failures = [];
  await removeProbeFixture('/ZEROHFAKE-fixture', failures, {
    processes() {
      queries++;
      return [{ kind: 'unknown', error: 'ETIMEDOUT' }];
    },
    remove() {
      if (++removals === 1)
        throw Object.assign(new Error('ZEROHFAKE locked'), { code: 'EPERM' });
    },
    waitMs: 5000,
  });
  assert.equal(queries, 1);
  assert.equal(removals, 2);
  assert.deepEqual(failures, []);
});

test('WIN7 crash probe preserves cold baseline, reuses the warm home and runs standalone controls', () => {
  const project = tempProject();
  const root = path.join(project.dir, 'probe');
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'test/tools/windows-crash-probe.mjs')],
    {
      env: {
        ...process.env,
        RUNNER_TEMP: project.dir,
        ZEROH_CRASH_PROBE_ROOT: root,
        ZEROH_CRASH_PROBE_ITERATIONS: '2',
        ZEROH_CRASH_PROBE_VARIANTS: 'baseline,warm-home,spawn-while-worker',
      },
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(
    readFileSync(path.join(root, 'evidence/summary.json')),
  );
  assert.deepEqual(
    summary.variants.map((row) => row.name),
    ['baseline', 'warm-home', 'spawn-while-worker'],
  );
  const records = readFileSync(
    path.join(root, 'evidence/invocations.jsonl'),
    'utf8',
  )
    .trim()
    .split('\n')
    .map(JSON.parse);
  for (const [variant, homes] of [
    ['baseline', 4],
    ['warm-home', 1],
    ['spawn-while-worker', 4],
  ]) {
    const calls = records.filter((row) => row.variant === variant);
    assert.equal(calls.length, 4);
    assert.equal(new Set(calls.map((row) => row.home)).size, homes);
    assert.ok(
      calls.every((row) => row.correct && !row.nativeCrash),
      JSON.stringify(calls),
    );
    assert.ok(calls.every((row) => row.traces.length === 0));
  }
  const control = readFileSync(
    path.join(PLUGIN, 'test/tools/windows-spawn-while-worker.mjs'),
    'utf8',
  );
  assert.doesNotMatch(control, /from ['"]\.\.?\//u);
  assert.match(
    readFileSync(path.join(root, 'evidence/summary.md'), 'utf8'),
    /zero does not refute a rare race/u,
  );
});

test('WIN11 cleanup query and retry time is bounded across 5400 locked fixtures', async () => {
  const { removeProbeFixture } =
    await import('../tools/windows-crash-cleanup.mjs');
  const budget = { remainingMs: 60_000 };
  let elapsed = 0,
    queries = 0;
  const failures = [];
  for (let index = 0; index < 5400; index++)
    await removeProbeFixture('/ZEROHFAKE-fixture', failures, {
      budget,
      now: () => elapsed,
      waitMs: 0,
      processes() {
        queries++;
        elapsed += 1000;
        return [{ kind: 'unknown' }];
      },
      remove(directory, options) {
        if (options.maxRetries) elapsed += 1500;
        throw Object.assign(new Error('ZEROHFAKE locked'), { code: 'EPERM' });
      },
    });
  assert.ok(elapsed <= 60_000, `${elapsed} ms of cleanup overhead`);
  assert.ok(queries < 60);
  assert.equal(failures.length, 5400);
  assert.ok(failures.every((row) => !row.childAlive && !row.icaclsAlive));
});

test('WIN10 cleanup failures record the locked path and live children, after a bounded join', async (t) => {
  const { removeProbeFixture } =
    await import('../tools/windows-crash-cleanup.mjs');
  const project = tempProject();
  const failures = [];
  let reads = 0;
  let removes = 0;
  await removeProbeFixture(project.home, failures, {
    processes() {
      reads++;
      return [{ pid: 123, kind: 'icacls' }];
    },
    remove() {
      removes++;
      throw Object.assign(new Error('ZEROHFAKE locked'), {
        code: 'EPERM',
        path: path.join(project.home, 'locked'),
      });
    },
    waitMs: 1,
  });
  assert.ok(reads >= 1);
  assert.equal(
    removes,
    2,
    'a failed removal is retried after checking the child',
  );
  assert.deepEqual(failures, [
    {
      directory: path.basename(project.home),
      code: 'EPERM',
      path: path.join(project.home, 'locked'),
      icaclsAlive: true,
      childAlive: true,
      processes: [{ pid: 123, kind: 'icacls' }],
    },
  ]);
  const driver = readFileSync(
    path.join(PLUGIN, 'test/tools/windows-crash-probe.mjs'),
    'utf8',
  );
  assert.match(
    driver,
    /process\.exitCode = summary\.cleanupFailures\.length \? 1 : 0/u,
  );
  assert.ok(
    driver.lastIndexOf('writeSummary();') < driver.indexOf('process.exitCode'),
  );
  await t.test(
    'CI publishes cleanup diagnostic evidence before failing',
    { skip: monorepoOnly('.github/workflows/zeroh-disclosure.yml') },
    () => {
      const workflow = readFileSync(
        path.join(PLUGIN, '../../../../.github/workflows/zeroh-disclosure.yml'),
        'utf8',
      );
      assert.ok(
        workflow.indexOf('Fail after publishing diagnostic evidence') >
          workflow.indexOf('actions/upload-artifact@'),
      );
      assert.match(workflow, /if \(\$summary\.cleanupFailures\.Count -gt 0\)/u);
    },
  );
});
