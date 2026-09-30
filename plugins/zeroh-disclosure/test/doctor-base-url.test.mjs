// SPDX-License-Identifier: AGPL-3.0-only

// 1.0.4: an ANTHROPIC_BASE_URL set outside ZeroH (a Windows environment
// variable, the shell, a project settings file) keeps Claude Code off the
// local proxy. The prompt's notice names that cause instead of "proxy not
// running", and doctor says where it is set and that --fix can't change it
// (Windows tester, 2026-09-30: the notice sent them to doctor, which found
// nothing about it).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PLUGIN, runHook, tempProject } from './helpers.mjs';

const GATEWAY = 'https://gateway.example.com/v1';
const PROMPT = 'Summarize this customer: daniel.carter@example.com';

function doctor(project, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'doctor'],
    {
      cwd: project.dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: project.home,
        ZEROH_HOME: project.home,
        ZEROH_CREDENTIAL_HOME: project.home,
        ZEROH_CLAUDE_SETTINGS: project.settings,
        ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
        CLAUDE_PROJECT_DIR: project.dir,
        ...extraEnv,
      },
      timeout: 20000,
    },
  );
}

test('a prompt sent past an outside ANTHROPIC_BASE_URL names that cause', () => {
  const project = tempProject({ env: false });
  const { code, json } = runHook(
    'user-prompt-submit',
    { hook_event_name: 'UserPromptSubmit', prompt: PROMPT },
    {
      project,
      extraEnv: { ZEROH_PROXY: '', ANTHROPIC_BASE_URL: GATEWAY },
    },
  );
  assert.equal(code, 0);
  const notice = json?.systemMessage ?? '';
  assert.match(
    notice,
    /not protected \(ANTHROPIC_BASE_URL is set outside ZeroH\)/u,
  );
  assert.match(notice, /Remove ANTHROPIC_BASE_URL where it is set/u);
  assert.doesNotMatch(notice, /proxy not running|Fix it with/u);
  assert.match(notice, /gateway\.example\.com/u);
  assert.doesNotMatch(notice, /\/v1/u);
});

test('doctor names an ANTHROPIC_BASE_URL from the environment and does not offer --fix for it', () => {
  const project = tempProject({ env: false });
  const out = doctor(project, { ANTHROPIC_BASE_URL: GATEWAY });
  assert.equal(out.status, 0, out.stderr);
  assert.match(
    out.stdout,
    /^ {2}- ANTHROPIC_BASE_URL is set in the environment Claude Code started in .* to gateway\.example\.com, so Claude Code sends there instead of through the local proxy/mu,
  );
  assert.match(out.stdout, /doctor --fix can't change this/u);
  assert.doesNotMatch(out.stdout, /^Next: \/zeroh-disclosure:doctor --fix/mu);
  assert.ok(!out.stdout.includes('/v1'));
});

test('doctor names the project settings file that sets ANTHROPIC_BASE_URL', () => {
  const project = tempProject({ env: false });
  const file = path.join(project.dir, '.claude', 'settings.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: GATEWAY } }));
  const out = doctor(project, { ANTHROPIC_BASE_URL: GATEWAY });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(
    out.stdout.includes(
      `ANTHROPIC_BASE_URL is set in ${file} to gateway.example.com`,
    ),
    out.stdout,
  );
});

test('doctor stays clear without an outside ANTHROPIC_BASE_URL', () => {
  const project = tempProject({ env: false });
  const out = doctor(project);
  assert.equal(out.status, 0, out.stderr);
  assert.doesNotMatch(out.stdout, /ANTHROPIC_BASE_URL is set/u);
});

test('notice and doctor expose only the host of a URL with credentials and query', () => {
  const project = tempProject({ env: false });
  const url =
    'https://private-user:private-password@gateway.example.com/v1?secret=private-query';
  const prompt = runHook(
    'user-prompt-submit',
    { hook_event_name: 'UserPromptSubmit', prompt: PROMPT },
    { project, extraEnv: { ZEROH_PROXY: '', ANTHROPIC_BASE_URL: url } },
  );
  const checked = doctor(project, { ANTHROPIC_BASE_URL: url });
  assert.equal(prompt.code, 0, prompt.stderr);
  assert.equal(checked.status, 0, checked.stderr);
  const notice = prompt.json?.systemMessage ?? '';
  assert.match(notice, /gateway\.example\.com/u);
  assert.doesNotMatch(
    notice,
    /private-user|private-password|private-query|\/v1/u,
  );
  assert.match(checked.stdout, /gateway\.example\.com/u);
  assert.doesNotMatch(
    checked.stdout,
    /private-user|private-password|private-query|\/v1/u,
  );
});
