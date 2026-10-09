// SPDX-License-Identifier: AGPL-3.0-only

// Wording against behaviour (architect review 1.0.0, product rule 5): every
// protection state rendered on every surface that shows it (the SessionStart
// banner in each mode, its warning lines, /zeroh-disclosure:status and the
// status line), in both `uncertain` modes, and no surface may claim
// protection that isn't there. `/zeroh-disclosure:status` used to say a
// secret in the next prompt "is stopped, not sent" in the default pass mode,
// where it is sent with a notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildBanner,
  proxyStatusLines,
  warningLines,
} from '../../lib/banner.js';
import {
  encodeProjectPath,
  renderStatusline,
  STATUS_FILE,
  statuslineData,
  statuslineMain,
  statuslineModel,
} from '../../lib/statusline.js';
import { proxyState } from '../../lib/hook-io.js';
import {
  installId,
  originalOf,
  writeProxyOffRecord,
  writeProxySetting,
} from '../../lib/claude-settings.js';
import {
  proxyPaths,
  writeProxyConfig,
} from '../../packages/local-proxy/proxy-state.js';
import {
  FAKE_STRIPE,
  PLUGIN,
  runHook,
  stateDirOf,
  stopProxyOf,
  tempProject,
  withProxy,
} from '../helpers.mjs';

// The states lib/hook-io.js proxyState reports. The matrix below creates each
// one, runs UserPromptSubmit and uses that result as the behaviour oracle for
// every rendered consumer.
const STATES = [
  'on',
  'ready',
  'overridden',
  'upstream-mismatch',
  'credentials',
  'off',
  'turned-off',
  'provider',
  'down',
];
const MODES = ['pass', 'block'];

// What the status line reads: the proxy word UserPromptSubmit writes to
// status.json for each state.
const STATUS_PROXY = {
  on: 'on',
  ready: 'ready',
  overridden: 'overridden',
  'upstream-mismatch': 'upstream-mismatch',
  credentials: 'credentials',
  off: 'off',
  'turned-off': 'off',
  provider: 'provider',
  down: 'unreachable',
};

const CLAIMS_TYPING_MASKED =
  /secrets are masked|masks what you type|the proxy masks them/u;
const SAYS_STOPPED = /\bstopped\b/u;
// "sent, with a notice", "is sent with a \"not protected\" line".
const SAYS_SENT_WITH_NOTICE = /\bsent,? with (?:a|the)\b/u;

const RUNTIMES = [
  { installed: true, running: true, loginItem: true },
  { installed: true, running: false, loginItem: false },
  {
    installed: true,
    running: true,
    loginItem: false,
    loginItemRefused: { code: 'EPERM', detail: 'login items are off' },
  },
];

function bannerTexts(state, mode, paused = false) {
  const warnings = warningLines({
    proxy: state,
    uncertain: mode,
    contextFindings: [{ displayPath: 'CLAUDE.md', count: 1 }],
  });
  return ['full', 'big', 'mini', 'compact'].map(
    (bannerMode) =>
      buildBanner({
        mode: bannerMode,
        proxy: state,
        uncertain: mode,
        paused,
        warnings,
      }).text,
  );
}

function statusTexts(state, mode) {
  return RUNTIMES.map((runtime) =>
    proxyStatusLines({ proxy: state, runtime, uncertain: mode }).join('\n'),
  );
}

function statuslineOf(state, { paused = false } = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-surfaces-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'zeroh');
  mkdirSync(root, { recursive: true });
  const dir = path.join(
    home,
    'projects',
    encodeProjectPath(root),
    'sessions',
    's1',
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, STATUS_FILE),
    JSON.stringify({
      v: 1,
      phase: 'ready',
      hooks: { 'session-start': { ok_at: new Date().toISOString() } },
      proxy: STATUS_PROXY[state],
      turn: 1,
      masked: 0,
      sent: 0,
      ...(paused ? { paused: true } : {}),
    }),
  );
  return statuslineModel({
    input: {
      session_id: 's1',
      workspace: { project_dir: root, current_dir: root },
    },
    env: {
      PATH: process.env.PATH,
      HOME: path.join(base, 'home'),
      ZEROH_HOME: home,
      ZEROH_CLAUDE_SETTINGS: path.join(base, 'claude', 'settings.json'),
    },
  });
}

function statuslineSurfaces(state) {
  const model = statuslineOf(state);
  return {
    text: renderStatusline(model, { env: { NO_COLOR: '1' } }),
    json: statuslineData(model),
  };
}

function hookEnvironment(project, extraEnv) {
  return {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    CLAUDE_PROJECT_DIR: project.dir,
    ...extraEnv,
  };
}

async function closedLoopbackPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function hookScenario(state) {
  const project = tempProject({ env: false });
  let extraEnv = { ZEROH_PROXY: 'off' };
  let stop = async () => {};

  if (state === 'on') {
    const proxy = await withProxy(project);
    extraEnv = proxy.extraEnv;
    stop = proxy.stop;
  } else if (state === 'ready') {
    extraEnv = { ZEROH_PROXY: '', ZEROH_BANNER: 'off' };
    const started = runHook(
      'session-start',
      { source: 'startup' },
      { project, extraEnv },
    );
    assert.equal(started.code, 0, started.stderr);
    stop = () => stopProxyOf(project);
  } else if (state === 'overridden') {
    extraEnv = {
      ZEROH_PROXY: '',
      ANTHROPIC_BASE_URL: 'https://upstream.example.invalid',
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    };
  } else if (state === 'upstream-mismatch') {
    const proxy = await withProxy(project);
    extraEnv = {
      ...proxy.extraEnv,
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    };
    stop = proxy.stop;
  } else if (state === 'credentials') {
    extraEnv = {
      ZEROH_PROXY: '',
      ANTHROPIC_BASE_URL:
        'https://fake:ZEROHFAKE-credentials@upstream.example.invalid',
    };
  } else if (state === 'turned-off') {
    writeProxyOffRecord(project.settings);
    extraEnv = { ZEROH_PROXY: '' };
  } else if (state === 'provider') {
    extraEnv = { ZEROH_PROXY: '', CLAUDE_CODE_USE_BEDROCK: '1' };
  } else if (state === 'down') {
    const port = await closedLoopbackPort();
    const proxyUrl = `http://127.0.0.1:${port}/z/ZEROHFAKEdeadproxykey`;
    mkdirSync(path.dirname(project.settings), { recursive: true });
    writeFileSync(project.settings, '{"permissions":{"allow":["Read"]}}\n');
    const install = {
      settingsPath: path.resolve(project.settings),
      key: 'ZEROHFAKEdeadproxykey',
      upstream: 'https://api.anthropic.com',
      ...originalOf(JSON.parse(readFileSync(project.settings, 'utf8'))),
      proxyUrl: null,
    };
    writeProxySetting(install, proxyUrl);
    writeProxyConfig(proxyPaths(hookEnvironment(project, {})), {
      version: 3,
      controlToken: 'ZEROHFAKEdeadproxycontrol',
      port,
      installs: { [installId(project.settings)]: install },
    });
    extraEnv = {
      ZEROH_PROXY: '',
      ZEROH_PROXY_PORT: '-1',
      ANTHROPIC_BASE_URL: proxyUrl,
    };
  }

  return { project, extraEnv, stop };
}

function hookDisposition(project, result) {
  if (result.code === 2) return 'stopped';
  const turn = path.join(
    stateDirOf(project),
    'sessions',
    'test',
    'turn-1.json',
  );
  if (!existsSync(turn)) return 'sent';
  const ledger = JSON.parse(readFileSync(turn, 'utf8'));
  return ledger.phase === 'masked_by_proxy' ? 'masked' : 'sent';
}

test('real prompt-hook outcomes match every rendered protection state and mode', async () => {
  for (const state of STATES) {
    for (const mode of MODES) {
      const scenario = await hookScenario(state);
      try {
        const env = hookEnvironment(scenario.project, scenario.extraEnv);
        assert.equal(
          await proxyState({
            env,
            sessionId: 'test',
            root: scenario.project.dir,
          }),
          state,
          `${state}/${mode}: fixture state`,
        );
        const result = runHook(
          'user-prompt-submit',
          { prompt: `deploy with ${FAKE_STRIPE}` },
          {
            project: scenario.project,
            extraEnv: {
              ...scenario.extraEnv,
              ZEROH_UNCERTAIN: mode,
            },
          },
        );
        assert.ok([0, 2].includes(result.code), result.stderr);
        const disposition = hookDisposition(scenario.project, result);
        const texts = [
          ...bannerTexts(state, mode),
          ...statusTexts(state, mode),
        ];

        for (const text of texts) {
          if (disposition === 'sent') {
            assert.doesNotMatch(
              text,
              SAYS_STOPPED,
              `${state}/${mode}: ${text}`,
            );
          } else if (disposition === 'stopped') {
            assert.doesNotMatch(
              text,
              SAYS_SENT_WITH_NOTICE,
              `${state}/${mode}: ${text}`,
            );
          }
          if (disposition !== 'masked' && CLAIMS_TYPING_MASKED.test(text)) {
            assert.match(
              text,
              /(?:first|next) prompt/u,
              `${state}/${mode}: ${text}`,
            );
          }
        }

        const statusline = statuslineSurfaces(state);
        assert.equal(
          statuslineOf(state).level === 'protected',
          disposition === 'masked',
          `${state}/${mode}: status line text`,
        );
        assert.equal(
          statusline.json.state === 'protected',
          disposition === 'masked',
          `${state}/${mode}: status line JSON`,
        );
      } finally {
        await scenario.stop();
      }
    }
  }
});

test('files-only output is masked by the real hook even in block mode', () => {
  const project = tempProject();
  const email = ['zerohfake.output', 'example.invalid'].join('@');
  const result = runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: path.join(project.dir, 'customer.txt') },
      tool_response: { type: 'text', content: `customer=${email}` },
    },
    { project, extraEnv: { ZEROH_UNCERTAIN: 'block', ZEROH_PROXY: 'off' } },
  );
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.stringify(
    result.json?.hookSpecificOutput?.updatedToolOutput ?? '',
  );
  assert.ok(!output.includes(email));
  assert.match(output, /EMAIL/u);
});

test('credential-bearing base URL stays credentials across real status consumers and prompt hooks', async (t) => {
  const project = tempProject({ env: false });
  const credentialsUrl = 'https://fake:ZEROHFAKE@example.invalid';
  const extraEnv = {
    ZEROH_PROXY: '',
    ANTHROPIC_BASE_URL: credentialsUrl,
    ZEROH_BANNER: 'off',
  };
  const started = runHook(
    'session-start',
    { source: 'startup' },
    { project, extraEnv },
  );
  assert.equal(started.code, 0, started.stderr);
  t.after(() => stopProxyOf(project));

  const prompt = `contact ${['zerohfake.person', 'example.invalid'].join('@')}`;
  for (let turn = 1; turn <= 2; turn += 1) {
    const result = runHook(
      'user-prompt-submit',
      { prompt, session_id: 'test' },
      { project, extraEnv },
    );
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.stringify(result.json ?? {});
    assert.match(output, /credentials in ANTHROPIC_BASE_URL/u, `turn ${turn}`);
    assert.match(output, /Remove credentials from ANTHROPIC_BASE_URL/u);
  }

  const env = {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    CLAUDE_PROJECT_DIR: project.dir,
    CLAUDE_CODE_SESSION_ID: 'test',
    ...extraEnv,
  };
  const status = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'commands', 'scripts', 'status.js')],
    { cwd: project.dir, env, encoding: 'utf8' },
  );
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /credentials in ANTHROPIC_BASE_URL/u);
  assert.match(status.stdout, /Remove them from the URL/u);
  assert.doesNotMatch(status.stdout, /Your next prompt (?:puts|starts)/u);

  const draw = async (argv) => {
    let output = '';
    const model = await statuslineMain(
      [...argv, '--session', 'test', '--cwd', project.dir],
      {
        stdin: null,
        stdout: { write: (chunk) => (output += chunk) },
        env,
      },
    );
    return { model, output };
  };
  const text = await draw(['segment']);
  assert.equal(text.model.state, 'base-url-credentials');
  assert.match(text.output, /credentials in ANTHROPIC_BASE_URL/u);
  assert.match(text.output, /zeroh-disclosure:doctor/u);
  const json = await draw(['--json']);
  const jsonState = JSON.parse(json.output);
  assert.equal(jsonState.state, 'partial');
  assert.equal(jsonState.reason, 'credentials in ANTHROPIC_BASE_URL');
  assert.equal(jsonState.fix, '/zeroh-disclosure:doctor');
});

test('/zeroh-disclosure:status names the next prompt by mode', () => {
  const runtime = { installed: true, running: true, loginItem: true };
  const pass = proxyStatusLines({ proxy: 'ready', runtime, uncertain: 'pass' });
  assert.match(
    pass[0],
    /Your next prompt puts it there \(a secret in that prompt is sent, with a "not protected" line\)\./u,
  );
  const block = proxyStatusLines({
    proxy: 'ready',
    runtime,
    uncertain: 'block',
  });
  assert.match(
    block[0],
    /Your next prompt puts it there \(a secret in that prompt is stopped, not sent\)\./u,
  );
});

test('only a session behind a running proxy is "protected" on the status line', () => {
  for (const state of STATES) {
    const model = statuslineOf(state);
    assert.equal(model.level === 'protected', state === 'on', state);
  }
  assert.notEqual(statuslineOf('on', { paused: true }).level, 'protected');
});

test('a vault that cannot be opened is never shown as protected', () => {
  for (const state of STATES) {
    for (const mode of MODES) {
      for (const text of bannerTexts(state, mode, true)) {
        assert.doesNotMatch(text, /✓ Protected/u, `${state}/${mode}`);
      }
    }
  }
});

// The session-only proxy (no login item) masks typing (86b8dcf0): the old
// `no-login-item` state said it could not, and nothing reaches it any more.
test('there is no "no login item, typing can\'t be masked" state left', () => {
  for (const dir of ['lib', 'hooks', 'commands', 'bin']) {
    for (const name of readdirSync(path.join(PLUGIN, dir), {
      recursive: true,
    })) {
      if (!/\.(?:m?js)$/u.test(name)) continue;
      const source = readFileSync(path.join(PLUGIN, dir, name), 'utf8');
      assert.doesNotMatch(source, /'no-login-item'/u, `${dir}/${name}`);
    }
  }
  const refused = { code: 'EPERM', detail: 'login items are off' };
  for (const line of warningLines({
    proxy: 'on',
    loginItemRefused: refused,
  })) {
    assert.doesNotMatch(line, /can't be masked/u);
  }
});
