// SPDX-License-Identifier: AGPL-3.0-only

// 1.0.1 (Mac /try review M1, M2): `/zeroh-disclosure:allow` targets a typed
// value by its token, in either form, never stores a raw value, and lists
// typed values; Claude Code's own CLAUDE_CODE_* variables are masked but
// not offered as values to allow.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadAllowRules } from '../lib/allow-rules.js';
import { loadKnownSecrets } from '../lib/secrets.js';
import { Vault } from '../lib/vault.js';
import { FAKE_STRIPE, PLUGIN, stateDirOf, tempProject } from './helpers.mjs';
import { asUser } from './as-user.mjs';

const CLI = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');

function envOf(project, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ...extra,
  };
}

function allow(project, args, extra = {}) {
  return spawnSync(process.execPath, [CLI, 'allow', ...args], {
    cwd: project.dir,
    encoding: 'utf8',
    env: asUser(['allow', ...args], envOf(project, extra)),
  });
}

// A key the user typed: the proxy recorded it in the vault as `prompt`.
function typedKey(project) {
  const vault = new Vault(project.dir, { env: envOf(project) });
  vault.load();
  const token = vault.tokenFor('STRIPE_SECRET_KEY', FAKE_STRIPE, 'prompt');
  vault.save();
  return token;
}

test('allow takes a typed value by its token, plain or ⟦named⟧, and removes it the same way', () => {
  const project = tempProject({ env: false });
  const token = typedKey(project);
  const named = `⟦${token.slice(1, -1)}⟧`;
  const added = allow(project, [named, 'staging.pay-internal.dev']);
  assert.equal(added.status, 0, added.stderr);
  assert.match(
    added.stdout,
    new RegExp(
      `^allowed: ${token.replace(/[[\]]/gu, '\\$&')} → staging\\.pay-internal\\.dev\\nAsk Claude to try again\\.\\n$`,
      'u',
    ),
  );
  assert.deepEqual(loadAllowRules(project.dir, project.home), {
    [token]: ['staging.pay-internal.dev'],
  });
  const removed = allow(project, [
    '--remove',
    named,
    'staging.pay-internal.dev',
  ]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(loadAllowRules(project.dir, project.home), {});
});

test('a raw value is stored as its token, and an unknown raw secret is refused', () => {
  const project = tempProject({ env: false });
  const token = typedKey(project);
  const added = allow(project, [FAKE_STRIPE, 'staging.pay-internal.dev']);
  assert.equal(added.status, 0, added.stderr);
  assert.doesNotMatch(added.stdout, new RegExp(FAKE_STRIPE, 'u'));
  assert.deepEqual(loadAllowRules(project.dir, project.home), {
    [token]: ['staging.pay-internal.dev'],
  });
  const file = path.join(stateDirOf(project), 'allow.json');
  assert.doesNotMatch(readFileSync(file, 'utf8'), new RegExp(FAKE_STRIPE, 'u'));

  const other = tempProject({ env: false });
  const refused = allow(other, [FAKE_STRIPE, 'staging.pay-internal.dev']);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /looks like a secret value/u);
  assert.doesNotMatch(refused.stderr, new RegExp(FAKE_STRIPE, 'u'));
  assert.deepEqual(loadAllowRules(other.dir, other.home), {});
});

test('the list shows typed values by token, with their built-in hosts and rules', () => {
  const project = tempProject({ env: false });
  const token = typedKey(project);
  const named = `⟦${token.slice(1, -1)}⟧`;
  allow(project, [token, 'staging.pay-internal.dev']);
  const listed = allow(project, []).stdout;
  assert.match(
    listed,
    new RegExp(
      `  typed key ${named.replace(/[[\]]/gu, '\\$&')} → api\\.stripe\\.com[^\\n]*\\(built-in: Stripe\\) \\+ staging\\.pay-internal\\.dev \\(your rule\\)`,
      'u',
    ),
  );
  assert.doesNotMatch(listed, new RegExp(FAKE_STRIPE, 'u'));
  assert.doesNotMatch(listed, /Other rules/u);
});

test("Claude Code's own CLAUDE_CODE_* variables are masked, not listed as values to allow", () => {
  const project = tempProject({ env: false });
  writeFileSync(path.join(project.dir, '.env'), `STRIPE_KEY=${FAKE_STRIPE}\n`);
  const env = envOf(project, {
    CLAUDE_CODE_MESSAGING_TOKEN: 'cc-msg-7f3a9b2c4d5e6f708192a3b4c5d6e7f8',
  });
  const known = loadKnownSecrets(project.dir, env, { home: project.home });
  const own = known.find(
    (entry) => entry.name === 'CLAUDE_CODE_MESSAGING_TOKEN',
  );
  assert.ok(own, 'still a known value, so it is masked');
  assert.equal(own.own, true);
  const listed = execFileSync(process.execPath, [CLI, 'allow'], {
    cwd: project.dir,
    encoding: 'utf8',
    env: asUser(['allow'], env),
  });
  assert.doesNotMatch(listed, /CLAUDE_CODE_MESSAGING_TOKEN/u);
  assert.match(listed, /STRIPE_KEY → /u);
});
