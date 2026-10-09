// SPDX-License-Identifier: AGPL-3.0-only

// Only Anthropic's default URL may be routed from the environment. Gateways
// belong in settings; doctor distinguishes sources without printing URL secrets.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { installId } from '../../lib/claude-settings.js';
import {
  proxyPaths,
  writeProxyConfig,
} from '../../packages/local-proxy/proxy-state.js';
import { PLUGIN, runHook, stateDirOf, tempProject } from '../helpers.mjs';

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

function recordInstall(project, upstream, { fromSettings = false } = {}) {
  writeProxyConfig(proxyPaths({ ZEROH_HOME: project.home }), {
    controlToken: 'ZEROHFAKE-doctor-control',
    installs: {
      [installId(project.settings)]: {
        settingsPath: project.settings,
        upstream,
        originalBaseUrlPresent: fromSettings,
        ...(fromSettings ? { originalBaseUrlValue: upstream } : {}),
      },
    },
  });
}

function turnLedger(project, sessionId) {
  return JSON.parse(
    readFileSync(
      path.join(stateDirOf(project), 'sessions', sessionId, 'turn-1.json'),
      'utf8',
    ),
  );
}

test('a prompt overridden by project settings names that cause', () => {
  const project = tempProject({ env: false });
  project.settings = path.join(project.home, '.claude', 'settings.json');
  mkdirSync(path.dirname(project.settings), { recursive: true });
  writeFileSync(project.settings, '{}');
  const file = path.join(project.dir, '.claude', 'settings.local.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: GATEWAY } }));
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
  assert.match(notice, /not protected \(ANTHROPIC_BASE_URL overridden\)/u);
  assert.match(notice, /Remove ANTHROPIC_BASE_URL where it is set/u);
  assert.doesNotMatch(notice, /proxy not running|Fix it with/u);
  assert.match(notice, /gateway\.example\.com/u);
  assert.doesNotMatch(notice, /\/v1/u);
});

test('doctor keeps a shell gateway overridden and explains the settings fix', () => {
  const project = tempProject({ env: false });
  const out = doctor(project, { ANTHROPIC_BASE_URL: GATEWAY });
  assert.equal(out.status, 0, out.stderr);
  assert.match(
    out.stdout,
    /ANTHROPIC_BASE_URL overridden: the value is set in the environment Claude Code started in/u,
  );
  assert.match(out.stdout, /what you type is not masked/u);
  assert.match(
    out.stdout,
    /settings\.json env; ZeroH records it as the original upstream and routes through it/u,
  );
  assert.doesNotMatch(out.stdout, /writes its local-proxy entry/u);
  assert.doesNotMatch(out.stdout, /^Next: \/zeroh-disclosure:doctor --fix/mu);
  assert.ok(!out.stdout.includes('/v1'));
});

test('doctor and proxy status name an upstream mismatch from the shared protection model and show both sources', () => {
  const project = tempProject({ env: false });
  recordInstall(project, 'https://installed.zerohfake.invalid');
  const session = 'https://api.anthropic.com/';
  const checked = doctor(project, { ANTHROPIC_BASE_URL: session });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /upstream mismatch/u);
  assert.match(
    checked.stdout,
    /session's ANTHROPIC_BASE_URL comes from the environment Claude Code started in/u,
  );
  assert.match(
    checked.stdout,
    /install's upstream comes from the environment that started the proxy install/u,
  );
  assert.doesNotMatch(
    checked.stdout,
    /installed\.zerohfake\.invalid|session\.zerohfake\.invalid/u,
  );
  assert.doesNotMatch(checked.stdout, /writes its local-proxy entry/u);

  const status = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'commands', 'scripts', 'proxy-status.js')],
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
        ANTHROPIC_BASE_URL: session,
      },
    },
  );
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /upstream mismatch/u);
  assert.doesNotMatch(status.stdout, /next prompt|next Claude Code session/u);
});

test('an upstream mismatch is recorded under its own unchecked reason', () => {
  const project = tempProject({ env: false });
  // A settings original still mismatches a session's default URL. A stale
  // shell-seeded install is now corrected before this prompt is routed.
  recordInstall(project, 'https://installed.zerohfake.invalid', {
    fromSettings: true,
  });
  const sessionId = 'upstream-mismatch';
  const result = runHook(
    'user-prompt-submit',
    {
      session_id: sessionId,
      prompt: 'Contact zerohfake.buyer@example.com',
    },
    {
      project,
      extraEnv: {
        ZEROH_PROXY: '',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.json?.systemMessage ?? '',
    /not protected \(upstream mismatch\)/u,
  );
  const unchecked = turnLedger(project, sessionId).audit.unchecked;
  assert.equal(unchecked['upstream-mismatch'].prompt, 1);
  assert.equal(unchecked['base-url-overridden'], undefined);
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
      `ANTHROPIC_BASE_URL overridden: the value is set in ${file} to gateway.example.com`,
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

test('doctor names host-managed routing without claiming a missing base URL is set', () => {
  const project = tempProject({ env: false });
  const out = doctor(project, {
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
  });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /the Claude Code host manages the provider/u);
  assert.match(out.stdout, /ZeroH cannot put this session through/u);
  assert.doesNotMatch(out.stdout, /the value is set|remove it/u);
});

test('notice and doctor expose only the host of a URL with credentials and query', () => {
  const project = tempProject({ env: false });
  const url =
    'https://private-user:private-password@gateway.example.com/v1?secret=private-query';
  const prompt = runHook(
    'user-prompt-submit',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'credentials-url',
      prompt: PROMPT,
    },
    { project, extraEnv: { ZEROH_PROXY: '', ANTHROPIC_BASE_URL: url } },
  );
  const checked = doctor(project, { ANTHROPIC_BASE_URL: url });
  assert.equal(prompt.code, 0, prompt.stderr);
  assert.equal(checked.status, 0, checked.stderr);
  const notice = prompt.json?.systemMessage ?? '';
  assert.match(notice, /credentials in ANTHROPIC_BASE_URL/u);
  assert.doesNotMatch(notice, /upstream mismatch/u);
  assert.match(notice, /gateway\.example\.com/u);
  assert.doesNotMatch(
    notice,
    /private-user|private-password|private-query|\/v1/u,
  );
  assert.match(checked.stdout, /gateway\.example\.com/u);
  assert.match(checked.stdout, /contains user:password credentials/u);
  assert.match(checked.stdout, /ZeroH refuses that upstream/u);
  assert.doesNotMatch(
    checked.stdout,
    /private-user|private-password|private-query|\/v1/u,
  );
  const unchecked = turnLedger(project, 'credentials-url').audit.unchecked;
  assert.equal(unchecked['base-url-credentials'].prompt, 1);
  assert.equal(unchecked['upstream-mismatch'], undefined);
});
