// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { cmdDoctor, doctorFixedLines } from '../../lib/cli/doctor.js';
import {
  checkPublishedVersion,
  comparePluginVersions,
  PUBLISHED_PLUGIN_MANIFEST,
} from '../../lib/cli/published-version.js';
import { tempProject } from '../helpers.mjs';

function fixtureFetch(version) {
  return async () => ({
    ok: true,
    json: async () => ({ name: 'zeroh-disclosure', version }),
  });
}

async function renderedDoctor(fetchImpl, { json = false } = {}) {
  const project = tempProject({ env: false });
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    await cmdDoctor({ json }, project.dir, {
      checkVersion: () => checkPublishedVersion({ fetchImpl, env: {} }),
    });
  } finally {
    console.log = log;
  }
  return json ? JSON.parse(lines.join('\n')) : lines.join('\n');
}

test('doctor reports a newer fixture marketplace version and the update commands', async () => {
  const output = await renderedDoctor(fixtureFetch('1.2.0'));
  assert.match(
    output,
    /Updates: newer version available \(1\.2\.0; installed 1\.1\.0\)/u,
  );
  assert.match(
    output,
    /claude plugin marketplace update zeroh, then claude plugin update zeroh-disclosure@zeroh/u,
  );
});

test('doctor reports an equal published fixture without suggesting an update', async () => {
  const output = await renderedDoctor(fixtureFetch('1.1.0'));
  assert.match(output, /Updates: no newer published version/u);
  assert.doesNotMatch(output, /Updates: newer version available/u);
});

test('offline doctor says the published version could not be checked', async () => {
  const output = await renderedDoctor(async () => {
    throw new Error('fixture offline');
  });
  assert.match(
    output,
    /Updates: could not check the published version \(offline or marketplace unavailable\)/u,
  );
});

test('doctor JSON records the published-version result', async () => {
  const output = await renderedDoctor(fixtureFetch('1.2.0'), { json: true });
  assert.deepEqual(output.publishedVersion, {
    state: 'newer',
    installed: '1.1.0',
    published: '1.2.0',
  });
});

test('marketplace check sends only a fixed anonymous public GET', async () => {
  let calls = 0;
  const result = await checkPublishedVersion({
    env: {},
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, PUBLISHED_PLUGIN_MANIFEST);
      assert.equal(new URL(url).search, '');
      assert.deepEqual(Object.keys(options).sort(), [
        'credentials',
        'headers',
        'method',
        'redirect',
        'signal',
      ]);
      assert.equal(options.method, 'GET');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { accept: 'application/json' });
      assert.ok(options.signal instanceof AbortSignal);
      return {
        ok: true,
        json: async () => ({ name: 'zeroh-disclosure', version: '1.2.0' }),
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.state, 'newer');
});

test('invalid manifests and HTTP failures are unchecked', async () => {
  for (const response of [
    { ok: false },
    {
      ok: true,
      json: async () => ({ name: 'other-plugin', version: '1.2.0' }),
    },
    {
      ok: true,
      json: async () => ({
        name: 'zeroh-disclosure',
        version: 'not a version',
      }),
    },
  ]) {
    const result = await checkPublishedVersion({
      env: {},
      fetchImpl: async () => response,
    });
    assert.equal(result.state, 'unchecked');
    assert.equal(result.published, undefined);
  }
});

test('version comparison handles numeric components, prereleases and metadata', () => {
  for (const [left, right, expected] of [
    ['1.10.0', '1.2.0', 1],
    ['1.0.0', '1.1.0', -1],
    ['1.1.0', '1.1.0-rc.2', 1],
    ['1.1.0-rc.10', '1.1.0-rc.2', 1],
    ['1.1.0-rc', '1.1.0-rc.1', -1],
    ['1.1.0+build.2', '1.1.0+build.1', 0],
    ['1.1.0-rc.01', '1.1.0', null],
    ['01.1.0', '1.1.0', null],
  ])
    assert.equal(comparePluginVersions(left, right), expected);
});

test('doctor explains an unowned daemon left running when safe drain is unavailable', () => {
  const lines = doctorFixedLines({
    fix: true,
    proxy: { drainUnavailable: 1, findings: [] },
    vaults: { fixed: [] },
    legacy: { removed: [] },
  });
  assert.deepEqual(lines, [
    'Left 1 unowned local proxy daemon(s) running: ZeroH could not safely drain them. Sessions using them keep working.',
  ]);
});
