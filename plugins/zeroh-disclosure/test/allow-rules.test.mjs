// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  ALLOW_FILE_NOTICE,
  loadAllowRules,
  normaliseAllowHost,
  readAllowRules,
} from '../lib/allow-rules.js';
import {
  destinationSummary,
  formatDestinationSummary,
} from '../lib/allow-list.js';
import {
  FAKE_STRIPE,
  PLUGIN,
  runHook,
  tempProject,
  stateDirOf,
} from './helpers.mjs';

function runAllow(project, ...args) {
  return execFileSync(
    process.execPath,
    [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'allow', ...args],
    {
      cwd: project.dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: project.home,
        ZEROH_HOME: project.home,
      },
    },
  );
}

test('CLI writes, lists and removes HMAC-verified allow rules', () => {
  const project = tempProject();
  runAllow(project, 'STRIPE_KEY', 'payments-gateway.example');
  runAllow(project, 'API_KEY', 'api.internal.example');

  assert.deepEqual(loadAllowRules(project.dir, project.home), {
    API_KEY: ['api.internal.example'],
    STRIPE_KEY: ['payments-gateway.example'],
  });
  assert.deepEqual(JSON.parse(runAllow(project, '--list', '--json')).rules, {
    API_KEY: ['api.internal.example'],
    STRIPE_KEY: ['payments-gateway.example'],
  });

  runAllow(project, '--remove', 'STRIPE_KEY', 'payments-gateway.example');
  assert.deepEqual(loadAllowRules(project.dir, project.home), {
    API_KEY: ['api.internal.example'],
  });
  assert.equal(
    statSync(path.join(project.home, 'allow.key')).mode & 0o777,
    0o600,
  );
  assert.equal(readFileSync(path.join(project.home, 'allow.key')).length, 32);
});

test('a byte-edited allow file is ignored and SessionStart warns the user', () => {
  const project = tempProject();
  runAllow(project, 'STRIPE_KEY', 'payments-gateway.example');
  const file = path.join(stateDirOf(project), 'allow.json');
  const edited = readFileSync(file, 'utf8').replace(
    'payments-gateway.example',
    'attacker-gateway.example',
  );
  writeFileSync(file, edited);

  const loaded = readAllowRules(project.dir, project.home);
  assert.equal(loaded.ignored, true);
  assert.deepEqual(loaded.rules, {});

  const start = runHook('session-start', { source: 'startup' }, { project });
  assert.equal(start.code, 0, start.stderr);
  assert.ok(start.json.systemMessage.includes(ALLOW_FILE_NOTICE));
  assert.match(start.json.systemMessage, /███████ ███████ ██████/u);
});

test('MCP server rules use mcp:<server> and are signed like host rules', () => {
  assert.equal(
    normaliseAllowHost('mcp:Claude_AI_Google_Drive'),
    'mcp:claude_ai_google_drive',
  );
  assert.equal(normaliseAllowHost(' mcp:stripe '), 'mcp:stripe');
  for (const bad of ['mcp:', 'mcp:a b', 'mcp:a__b', 'mcp:x/y', 'mcp:x.y'])
    assert.throws(() => normaliseAllowHost(bad), /invalid MCP server/, bad);

  const project = tempProject();
  assert.match(runAllow(project, 'STRIPE_KEY', 'mcp:stripe'), /mcp:stripe/);
  assert.deepEqual(loadAllowRules(project.dir, project.home), {
    STRIPE_KEY: ['mcp:stripe'],
  });
  // A hand edit that adds a server fails the signature; all rules are ignored.
  const file = path.join(stateDirOf(project), 'allow.json');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  document.rules.STRIPE_KEY.push('mcp:collector');
  writeFileSync(file, JSON.stringify(document));
  assert.deepEqual(loadAllowRules(project.dir, project.home), {});
});

// DEST-1: `allow --list` says, per known value, where it may go and why.
test('allow --list shows where each known value may go, never the value', () => {
  const project = tempProject();
  const internal = 'zzfake-internal-token-0000000000000000';
  const github = 'ghp_ZEROHFAKE000000000000000000000000000';
  writeFileSync(
    path.join(project.dir, '.env'),
    `STRIPE_KEY=${FAKE_STRIPE}\nINTERNAL_API_TOKEN=${internal}\nGITHUB_TOKEN=${github}\n`,
  );
  runAllow(project, 'GITHUB_TOKEN', 'staging.example.dev');
  runAllow(project, 'OLD_KEY', 'legacy.example.dev');
  const listed = runAllow(project);
  assert.equal(runAllow(project, '--list'), listed);
  for (const value of [FAKE_STRIPE, internal, github]) {
    assert.ok(!listed.includes(value));
  }
  const lines = listed.split('\n');
  assert.ok(
    lines.includes(
      '  STRIPE_KEY → api.stripe.com, files.stripe.com, connect.stripe.com (built-in: Stripe)',
    ),
    listed,
  );
  assert.ok(
    lines.includes(
      '  INTERNAL_API_TOKEN → nowhere yet · allow with /zeroh-disclosure:allow INTERNAL_API_TOKEN <host>',
    ),
    listed,
  );
  assert.ok(
    lines.includes(
      '  GITHUB_TOKEN → api.github.com, github.com, uploads.github.com, *.githubusercontent.com (built-in: GitHub) + staging.example.dev (your rule)',
    ),
    listed,
  );
  assert.ok(
    lines.includes('  OLD_KEY → legacy.example.dev (your rule)'),
    listed,
  );
});

test('destinationSummary merges built-in hosts, name, type and * rules', () => {
  const summary = destinationSummary(
    [
      { name: 'STRIPE_KEY', value: 'sk_test_ZEROHFAKE', type: 'API_KEY' },
      { name: 'DB_PASSWORD', value: 'hunter2-zerohfake', type: 'PASSWORD' },
    ],
    {
      STRIPE_KEY: ['api.stripe.com', 'staging.example.dev'],
      PASSWORD: ['db.example.dev'],
      '*': ['ci.example.dev'],
      '[API_KEY-abc123]': ['once.example.dev'],
    },
  );
  assert.deepEqual(summary.values, [
    {
      name: 'DB_PASSWORD',
      builtIn: null,
      rules: [
        {
          host: 'db.example.dev',
          rule: 'PASSWORD',
          why: 'your rule for PASSWORD',
        },
        { host: 'ci.example.dev', rule: '*', why: 'your rule for every value' },
      ],
    },
    {
      name: 'STRIPE_KEY',
      builtIn: {
        provider: 'Stripe',
        hosts: ['api.stripe.com', 'files.stripe.com', 'connect.stripe.com'],
      },
      rules: [
        { host: 'staging.example.dev', rule: 'STRIPE_KEY', why: 'your rule' },
        { host: 'ci.example.dev', rule: '*', why: 'your rule for every value' },
      ],
    },
  ]);
  assert.deepEqual(summary.otherRules, [
    { rule: '[API_KEY-abc123]', hosts: ['once.example.dev'] },
  ]);
  const text = formatDestinationSummary(summary).join('\n');
  assert.ok(!text.includes('sk_test_ZEROHFAKE'));
  assert.ok(!text.includes('hunter2'));
  assert.match(
    formatDestinationSummary({ values: [], otherRules: [] }).join('\n'),
    /No known values/u,
  );
});
