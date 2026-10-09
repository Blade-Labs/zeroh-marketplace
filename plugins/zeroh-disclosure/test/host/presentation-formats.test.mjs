// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runHook, tempProject } from '../helpers.mjs';

const CLI = fileURLToPath(
  new URL('../../bin/zeroh-disclosure.mjs', import.meta.url),
);

function environment(project) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(project.dir, 'home'),
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: path.join(project.dir, 'credentials'),
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    CLAUDE_PROJECT_DIR: project.dir,
    ZEROH_PROXY: 'off',
  };
}

function cli(project, env, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, '--cwd', project.dir], {
    cwd: project.dir,
    env,
    encoding: 'utf8',
  });
}

function setStyle(project, env, key, value) {
  const result = cli(project, env, 'style', key, value);
  assert.equal(result.status, 0, result.stderr);
}

test('receiptFormat selects receipt stdout and an explicit format overrides it', () => {
  const project = tempProject();
  const env = environment(project);
  runHook(
    'user-prompt-submit',
    { session_id: 'format-receipt', prompt: 'Summarize the local report.' },
    { project, extraEnv: env },
  );
  runHook('stop', { session_id: 'format-receipt' }, { project, extraEnv: env });

  const text = cli(project, env, 'receipt', '--session', 'format-receipt');
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^RECEIPT/u);

  setStyle(project, env, 'receipt-format', 'json');
  const json = cli(project, env, 'receipt', '--session', 'format-receipt');
  assert.equal(json.status, 0, json.stderr);
  assert.equal(
    JSON.parse(json.stdout).slip.title,
    'ZeroH Disclosure · Receipt',
  );

  setStyle(project, env, 'receipt-format', 'html');
  const html = cli(project, env, 'receipt', '--session', 'format-receipt');
  assert.equal(html.status, 0, html.stderr);
  assert.match(html.stdout, /^<!doctype html>/u);

  const overridden = cli(
    project,
    env,
    'receipt',
    '--session',
    'format-receipt',
    '--format',
    'text',
  );
  assert.match(overridden.stdout, /^RECEIPT/u);
});

test('reportFormat selects report stdout while export flags override the default', () => {
  const project = tempProject();
  const env = environment(project);
  setStyle(project, env, 'report-format', 'json');
  const json = cli(project, env, 'report');
  assert.equal(json.status, 0, json.stderr);
  assert.equal(
    JSON.parse(json.stdout).schema,
    'zeroh-disclosure-local-report/v1',
  );

  setStyle(project, env, 'report-format', 'html');
  const html = cli(project, env, 'report');
  assert.equal(html.status, 0, html.stderr);
  assert.match(html.stdout, /^<!doctype html>/u);

  const exportedFile = path.join(project.dir, 'explicit-report.json');
  const exported = cli(project, env, 'report', '--json', exportedFile);
  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stdout, /^RECEIPT/u);
  assert.equal(existsSync(exportedFile), true);
  assert.equal(
    JSON.parse(readFileSync(exportedFile, 'utf8')).schema,
    'zeroh-disclosure-local-report/v1',
  );
});

test('verbosity changes the text detail and an explicit format still wins', () => {
  const project = tempProject();
  const env = environment(project);
  setStyle(project, env, 'report-format', 'text');
  setStyle(project, env, 'verbosity', 'concise');
  const concise = cli(project, env, 'report');
  assert.equal(concise.status, 0, concise.stderr);
  assert.doesNotMatch(concise.stdout, /report\.html:/u);

  setStyle(project, env, 'verbosity', 'detailed');
  const detailed = cli(project, env, 'report');
  assert.equal(detailed.status, 0, detailed.stderr);
  assert.match(detailed.stdout, /Report details:/u);
  assert.notEqual(detailed.stdout, concise.stdout);

  const json = cli(project, env, 'report', '--format', 'json');
  assert.equal(
    JSON.parse(json.stdout).schema,
    'zeroh-disclosure-local-report/v1',
  );
});
