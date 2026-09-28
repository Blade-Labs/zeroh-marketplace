// SPDX-License-Identifier: AGPL-3.0-only

// ZEROH_UNCERTAIN: what ZeroH does with a case it cannot prove either way.
// 'pass' (default) never stops ordinary work; 'block' denies the uncertain
// case. A repository's .zeroh.env may only tighten it to 'block'.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN } from './helpers.mjs';
import { uncertainMode } from '../lib/config.js';

test('uncertainMode is pass unless the setting says block, and never throws', () => {
  assert.equal(uncertainMode({}), 'pass');
  assert.equal(uncertainMode({ ZEROH_UNCERTAIN: 'block' }), 'block');
  assert.equal(uncertainMode({ ZEROH_UNCERTAIN: ' BLOCK ' }), 'block');
  assert.equal(uncertainMode({ ZEROH_UNCERTAIN: 'pass' }), 'pass');
  assert.equal(uncertainMode({ ZEROH_UNCERTAIN: 'deny' }), 'pass');
  assert.equal(uncertainMode(null), 'pass');
  assert.equal(uncertainMode(undefined), 'pass');
  const hostile = {
    get ZEROH_UNCERTAIN() {
      throw new Error('boom');
    },
  };
  assert.equal(uncertainMode(hostile), 'pass');
  assert.equal(
    uncertainMode({ ZEROH_UNCERTAIN: { toString: () => 'block' } }),
    'block',
  );
});

// The mode loadConfig leaves in the environment, from the given sources.
function loaded({ environment, user, repo }) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-uncertain-'));
  const project = mkdtempSync(path.join(os.tmpdir(), 'zeroh-uncertain-p-'));
  if (user)
    writeFileSync(path.join(home, 'config.env'), `ZEROH_UNCERTAIN=${user}\n`);
  if (repo)
    writeFileSync(
      path.join(project, '.zeroh.env'),
      `ZEROH_UNCERTAIN=${repo}\n`,
    );
  const env = { PATH: process.env.PATH, HOME: home, ZEROH_HOME: home };
  if (environment) env.ZEROH_UNCERTAIN = environment;
  const run = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const c = await import(${JSON.stringify(path.join(PLUGIN, 'lib', 'config.js'))});
       const r = await c.loadConfig({ cwd: ${JSON.stringify(project)} });
       console.log(JSON.stringify({ mode: c.uncertainMode(), ignored: r.ignored }));`,
    ],
    { env, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('a repository may only tighten ZEROH_UNCERTAIN to block', () => {
  assert.equal(loaded({}).mode, 'pass');
  assert.equal(loaded({ user: 'block' }).mode, 'block');
  assert.equal(loaded({ environment: 'block' }).mode, 'block');
  // The repository's block wins over the user's pass.
  assert.equal(loaded({ repo: 'block' }).mode, 'block');
  assert.equal(loaded({ user: 'pass', repo: 'block' }).mode, 'block');
  assert.equal(loaded({ environment: 'pass', repo: 'block' }).mode, 'block');
  // Its pass never loosens the user's block, and is reported as ignored.
  const loosen = loaded({ user: 'block', repo: 'pass' });
  assert.equal(loosen.mode, 'block');
  assert.deepEqual(loosen.ignored, ['ZEROH_UNCERTAIN']);
  assert.equal(loaded({ environment: 'block', repo: 'pass' }).mode, 'block');
});
