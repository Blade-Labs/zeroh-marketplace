// SPDX-License-Identifier: AGPL-3.0-only

// The default proxy's lifecycle: install, settings restore, routing between
// sessions and projects, profiles, restarts, updates and login items. Every
// path is isolated (ZEROH_HOME, ZEROH_CLAUDE_SETTINGS,
// ZEROH_SERVICE_MANAGER_DIR); nothing touches the machine's real Claude
// settings, login items or proxy.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  installId,
  originalOf,
  resolveClaudeSettingsPath,
  restoreRecordPath,
  writeProxySetting,
  writeRestoreRecord,
  writeSettingsFile,
} from '../lib/claude-settings.js';
import {
  renameWithRetry,
  readJsonFile,
  writePrivateJson,
} from '../lib/private-fs.js';
import {
  checkSessionProxy,
  diagnoseProxy,
  ensureDefaultProxy,
  evaluateSessionOnlyExit,
  prepareInstall,
  proxyRuntimeStatus,
  probeProxy,
  repairDeadProxySetting,
  restoreClaudeSettings,
  routeSession,
  sessionProxyState,
  stopDefaultProxy,
} from '../lib/proxy-manager.js';
import {
  endSessionRoute,
  proxyPaths,
  pruneRoutes,
  readProxyConfig,
  refreshSessionRoute,
  routeFileName,
  routeSeen,
  writeProxyConfig,
} from '../lib/proxy-state.js';
import {
  createServiceManager,
  readDefinitionText,
} from '../lib/service-manager.js';
import { projectKey } from '../lib/vault.js';
import {
  fakeUpstream,
  isolatedProxyEnvironment as isolatedEnvironment,
  PLUGIN,
  postJson,
} from './helpers.mjs';

function ensureInChild({ env, root, sessionId }) {
  const managerUrl = pathToFileURL(
    path.join(PLUGIN, 'lib', 'proxy-manager.js'),
  ).href;
  const script = [
    `import { ensureDefaultProxy } from ${JSON.stringify(managerUrl)};`,
    'const result = await ensureDefaultProxy({',
    '  env: process.env,',
    '  root: process.env.ZEROHFAKE_ROOT,',
    `  pluginRoot: ${JSON.stringify(PLUGIN)},`,
    '  sessionId: process.env.ZEROHFAKE_SESSION,',
    '});',
    'process.stdout.write(JSON.stringify(result));',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', script],
      {
        env: { ...env, ZEROHFAKE_ROOT: root, ZEROHFAKE_SESSION: sessionId },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`parallel proxy start failed: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

async function waitUntilDown(url) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!(await probeProxy(url))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('proxy did not stop');
}

function pluginCopy(root, { version = '1.0.0', name = 'plugin-copy' } = {}) {
  const copy = path.join(root, name);
  cpSync(path.join(PLUGIN, 'lib'), path.join(copy, 'lib'), { recursive: true });
  cpSync(path.join(PLUGIN, 'bin'), path.join(copy, 'bin'), { recursive: true });
  cpSync(path.join(PLUGIN, 'vendor'), path.join(copy, 'vendor'), {
    recursive: true,
  });
  mkdirSync(path.join(copy, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(copy, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'zeroh-disclosure', version }),
  );
  return copy;
}

function settingsDoc(isolated, file = isolated.settings) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const CLEAN_BODY = JSON.stringify({
  messages: [{ role: 'user', content: 'ZEROHFAKE clean request' }],
});

test('default install chains to the prior upstream, survives a reboot without the plugin, and proxy off changes only the key', async (t) => {
  const isolated = isolatedEnvironment('proxy-install');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  const original = {
    permissions: { allow: ['Read'] },
    env: { ZEROHFAKE_KEEP: 'ZEROHFAKE-settings-secret' },
  };
  writeFileSync(isolated.settings, `${JSON.stringify(original, null, 2)}\n`);
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const pluginRoot = pluginCopy(isolated.root);

  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot,
  });
  assert.equal(installed.enabled, true);
  assert.equal(installed.installed, true);
  assert.equal(installed.upstream, upstream.url);
  assert.match(
    installed.proxyUrl,
    /^http:\/\/127\.0\.0\.1:\d+\/z\/[\w-]{32}$/u,
  );
  assert.equal(
    settingsDoc(isolated).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );
  const paths = proxyPaths(isolated.env);
  const config = readProxyConfig(paths);
  const install = config.installs[installId(isolated.settings)];
  assert.equal(install.originalBaseUrlPresent, false);
  assert.equal(install.upstream, upstream.url);
  // P-6: no copy of the settings file or its other values is kept anywhere.
  for (const file of [paths.config, restoreRecordPath(isolated.settings)]) {
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /ZEROHFAKE_KEEP|settings-secret/u,
    );
  }
  assert.equal(
    readJsonFile(restoreRecordPath(isolated.settings)).proxyUrl,
    installed.proxyUrl,
  );
  assert.equal(
    existsSync(path.join(paths.runtime, 'bin', 'proxy-daemon.mjs')),
    true,
  );
  // State: proxy.json, the routes and the daemon's pid; nothing else.
  assert.deepEqual(readdirSync(paths.directory).sort(), [
    'daemon.pid',
    'proxy.json',
    'routes',
  ]);
  const manager = createServiceManager({ env: isolated.env });
  assert.equal(
    manager.registeredKind(),
    process.platform === 'darwin'
      ? 'launch-agent'
      : process.platform === 'win32'
        ? 'scheduled-task'
        : 'systemd',
  );
  // The Windows task file is UTF-16LE (readDefinitionText decodes each kind).
  const definition = readdirSync(isolated.env.ZEROH_SERVICE_MANAGER_DIR)
    .map((name) =>
      readDefinitionText(
        path.join(isolated.env.ZEROH_SERVICE_MANAGER_DIR, name),
      ),
    )
    .join('\n');
  assert.ok(definition.includes(paths.config));
  assert.doesNotMatch(definition, /--takeover/u);

  // The plugin is removed without `proxy off`, and the machine reboots. At
  // shutdown the daemon takes its entry out (LP-B4), so nothing names a
  // dead port while it is down; the login item starts it from its runtime
  // copy.
  process.kill(installed.pid, 'SIGTERM');
  await waitUntilDown(installed.proxyUrl);
  // Windows ends the daemon at once, so none of its handlers runs.
  if (process.platform !== 'win32')
    assert.deepEqual(settingsDoc(isolated), original);
  rmSync(pluginRoot, { recursive: true, force: true });
  const rebooted = spawn(
    process.execPath,
    [path.join(paths.runtime, 'bin', 'proxy-daemon.mjs'), paths.config],
    { env: isolated.env, detached: true, stdio: 'ignore' },
  );
  rebooted.unref();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await probeProxy(installed.proxyUrl)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(await probeProxy(installed.proxyUrl));
  // No hook runs for the new session: its requests pass through (D-8).
  const passed = await postJson(
    `${installed.proxyUrl}/v1/messages`,
    CLEAN_BODY,
    { sessionId: 'ZEROHFAKE-new-session' },
  );
  assert.equal(passed.status, 200);
  assert.equal(upstream.seen.length, 1);

  const stopped = await stopDefaultProxy({ env: isolated.env });
  assert.equal(stopped.stopped, true);
  assert.deepEqual(settingsDoc(isolated), original);
  assert.equal(manager.isRegistered(), false);
  assert.equal(existsSync(restoreRecordPath(isolated.settings)), false);
  assert.equal(existsSync(paths.config), false);
  await waitUntilDown(installed.proxyUrl);
});

function installSetting(isolated, original, proxyUrl) {
  writeFileSync(isolated.settings, original);
  const install = {
    settingsPath: path.resolve(isolated.settings),
    key: 'ZEROHFAKEproxykey0000000000000',
    upstream: 'https://api.anthropic.com',
    ...originalOf(JSON.parse(original)),
    proxyUrl: null,
    installedAt: new Date().toISOString(),
  };
  writeProxySetting(install, proxyUrl);
  writeRestoreRecord(install);
  writeProxyConfig(proxyPaths(isolated.env), {
    version: 3,
    controlToken: 'ZEROHFAKEcontroltoken0000000000',
    port: 0,
    installs: { [installId(isolated.settings)]: install },
  });
  return install;
}

test('proxy off preserves settings changed after install', () => {
  const isolated = isolatedEnvironment('restore-preserves-change');
  const proxyUrl = 'http://127.0.0.1:43101/z/ZEROHFAKEproxykey0000000000000';
  installSetting(
    isolated,
    '{"permissions":{"allow":["Read"]},"env":{"ZEROHFAKE_KEEP":"yes"}}\n',
    proxyUrl,
  );
  const changed = settingsDoc(isolated);
  changed.permissions.allow.push('Write');
  writeFileSync(isolated.settings, `${JSON.stringify(changed, null, 2)}\n`);

  const result = restoreClaudeSettings({ env: isolated.env });
  assert.equal(result.restored, true);
  const restored = settingsDoc(isolated);
  assert.deepEqual(restored.permissions.allow, ['Read', 'Write']);
  assert.deepEqual(restored.env, { ZEROHFAKE_KEEP: 'yes' });
});

test('proxy off leaves a user-replaced base URL untouched', () => {
  const isolated = isolatedEnvironment('restore-user-url');
  const proxyUrl = 'http://127.0.0.1:43102/z/ZEROHFAKEproxykey0000000000000';
  installSetting(isolated, '{}\n', proxyUrl);
  const userUrl = 'https://user.zerohfake.invalid/gateway';
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: userUrl } }, null, 2)}\n`,
  );

  const result = restoreClaudeSettings({ env: isolated.env });
  assert.equal(result.restored, false);
  assert.equal(result.reason, 'user-changed');
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, userUrl);
});

test('proxy off removes an originally absent key and its created empty env', () => {
  const isolated = isolatedEnvironment('restore-absent-url');
  const proxyUrl = 'http://127.0.0.1:43103/z/ZEROHFAKEproxykey0000000000000';
  installSetting(isolated, '{"permissions":{"allow":[]}}\n', proxyUrl);
  const changed = settingsDoc(isolated);
  changed.permissions.allow.push('Read');
  writeFileSync(isolated.settings, `${JSON.stringify(changed, null, 2)}\n`);

  restoreClaudeSettings({ env: isolated.env });
  const restored = settingsDoc(isolated);
  assert.deepEqual(restored.permissions.allow, ['Read']);
  assert.equal(Object.hasOwn(restored, 'env'), false);
});

test('proxy off restores a previous gateway URL while preserving other edits', () => {
  const isolated = isolatedEnvironment('restore-prior-gateway');
  const proxyUrl = 'http://127.0.0.1:43104/z/ZEROHFAKEproxykey0000000000000';
  const gateway = 'https://gateway.zerohfake.invalid/anthropic';
  installSetting(
    isolated,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway } }, null, 2)}\n`,
    proxyUrl,
  );
  const changed = settingsDoc(isolated);
  changed.enabledPlugins = { 'example@marketplace': true };
  writeFileSync(isolated.settings, `${JSON.stringify(changed, null, 2)}\n`);

  restoreClaudeSettings({ env: isolated.env });
  const restored = settingsDoc(isolated);
  assert.equal(restored.env.ANTHROPIC_BASE_URL, gateway);
  assert.deepEqual(restored.enabledPlugins, { 'example@marketplace': true });
});

test('the settings value wins over the environment when recording the upstream', async () => {
  const isolated = isolatedEnvironment('settings-upstream');
  const settingsUpstream = 'https://settings.zerohfake.invalid/gateway';
  isolated.env.ANTHROPIC_BASE_URL =
    'https://environment.zerohfake.invalid/gateway';
  writeFileSync(
    isolated.settings,
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: settingsUpstream } }),
  );
  const install = await prepareInstall({
    env: isolated.env,
    paths: proxyPaths(isolated.env),
    settingsPath: isolated.settings,
  });
  assert.equal(install.upstream, settingsUpstream);
  assert.equal(install.originalBaseUrlPresent, true);
});

test('a ZeroH URL left from a lost home is never recorded as the upstream', async () => {
  const isolated = isolatedEnvironment('lost-home-upstream');
  const stale = 'http://127.0.0.1:9/z/ZEROHFAKEstaleproxykey000000000';
  writeFileSync(
    isolated.settings,
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: stale } }),
  );
  isolated.env.ANTHROPIC_BASE_URL = stale;
  const install = await prepareInstall({
    env: isolated.env,
    paths: proxyPaths(isolated.env),
    settingsPath: isolated.settings,
  });
  assert.equal(install.upstream, 'https://api.anthropic.com');
  assert.equal(install.originalBaseUrlPresent, false);
});

test('ZEROH_PROXY=off does not create or change Claude settings', async () => {
  const isolated = isolatedEnvironment('proxy-opt-out');
  isolated.env.ZEROH_PROXY = 'off';
  assert.equal(existsSync(isolated.settings), false);
  const result = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  assert.equal(result.optedOut, true);
  assert.equal(existsSync(isolated.settings), false);
  assert.equal(existsSync(proxyPaths(isolated.env).config), false);
});

test('concurrent projects share one proxy without changing each other routing', async (t) => {
  const isolated = isolatedEnvironment('proxy-project-routing');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  const firstRoot = path.join(isolated.root, 'project-a');
  const secondRoot = path.join(isolated.root, 'project-b');
  mkdirSync(firstRoot, { recursive: true });
  mkdirSync(secondRoot, { recursive: true });
  const firstSecret = 'ProjectA_ZEROHFAKE_known_value_12345';
  const secondSecret = 'ProjectB_ZEROHFAKE_known_value_67890';
  writeFileSync(path.join(firstRoot, '.env'), `FIRST_KEY=${firstSecret}\n`);
  writeFileSync(path.join(secondRoot, '.env'), `SECOND_KEY=${secondSecret}\n`);
  t.after(async () => stopDefaultProxy({ env: isolated.env }));

  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: firstRoot,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-session-a',
  });
  const second = await ensureDefaultProxy({
    env: isolated.env,
    root: secondRoot,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-session-b',
  });
  assert.equal(second.pid, first.pid);
  assert.equal(second.proxyUrl, first.proxyUrl);

  await postJson(
    `${first.proxyUrl}/v1/messages`,
    JSON.stringify({ messages: [{ role: 'user', content: firstSecret }] }),
    { sessionId: 'ZEROHFAKE-session-a' },
  );
  await postJson(
    `${first.proxyUrl}/v1/messages`,
    JSON.stringify({ messages: [{ role: 'user', content: secondSecret }] }),
    { sessionId: 'ZEROHFAKE-session-b' },
  );
  assert.equal(upstream.seen.length, 2);
  assert.ok(!upstream.seen[0].body.includes(firstSecret));
  assert.ok(!upstream.seen[1].body.includes(secondSecret));
  assert.match(upstream.seen[0].body, /\[API_KEY-[0-9a-f]{6}\]/u);
  assert.match(upstream.seen[1].body, /\[API_KEY-[0-9a-f]{6}\]/u);
  for (const root of [firstRoot, secondRoot]) {
    assert.equal(
      existsSync(
        path.join(isolated.env.ZEROH_HOME, 'vault', `${projectKey(root)}.json`),
      ),
      true,
    );
  }
});

test('simultaneous SessionStart processes serialize one proxy startup', async (t) => {
  const isolated = isolatedEnvironment('proxy-simultaneous-start');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  const firstRoot = path.join(isolated.root, 'simultaneous-a');
  const secondRoot = path.join(isolated.root, 'simultaneous-b');
  mkdirSync(firstRoot, { recursive: true });
  mkdirSync(secondRoot, { recursive: true });
  t.after(async () => stopDefaultProxy({ env: isolated.env }));

  const [first, second] = await Promise.all([
    ensureInChild({
      env: isolated.env,
      root: firstRoot,
      sessionId: 'ZEROHFAKE-simultaneous-a',
    }),
    ensureInChild({
      env: isolated.env,
      root: secondRoot,
      sessionId: 'ZEROHFAKE-simultaneous-b',
    }),
  ]);
  assert.equal(first.pid, second.pid);
  assert.equal(first.proxyUrl, second.proxyUrl);
  assert.ok(await probeProxy(first.proxyUrl));
});

test('ZEROH_PROXY=off passes through only the session that set it', async (t) => {
  const isolated = isolatedEnvironment('proxy-installed-opt-out');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  const root = path.join(isolated.root, 'project');
  mkdirSync(root, { recursive: true });
  const secret = 'sk_live_ZEROHFAKEoptout00000000000';
  writeFileSync(path.join(root, '.env'), `SERVICE_KEY=${secret}\n`);
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-masked-session',
  });
  process.kill(installed.pid, 'SIGTERM');
  await waitUntilDown(installed.proxyUrl);
  const optedOut = await ensureDefaultProxy({
    env: { ...isolated.env, ZEROH_PROXY: 'off' },
    root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-opt-out-session',
  });
  assert.equal(optedOut.optedOut, true);
  assert.equal(optedOut.restarted, true);
  assert.equal(optedOut.proxyUrl, installed.proxyUrl);
  const body = JSON.stringify({
    messages: [{ role: 'user', content: secret }],
  });
  const passed = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-opt-out-session',
  });
  assert.equal(
    passed.headers['x-zeroh-disclosure'],
    'passthrough-plugin-inactive',
  );
  assert.ok(upstream.seen[0].body.includes(secret));
  await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-masked-session',
  });
  assert.ok(!upstream.seen[1].body.includes(secret));
  assert.match(upstream.seen[1].body, /\[API_KEY-[0-9a-f]{6}\]/u);
});

test('the next SessionStart restarts a proxy killed mid-session', async (t) => {
  const isolated = isolatedEnvironment('proxy-restart');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  process.kill(first.pid, 'SIGTERM');
  await waitUntilDown(first.proxyUrl);
  const second = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  assert.equal(second.restarted, true);
  assert.notEqual(second.pid, first.pid);
  assert.equal(second.proxyUrl, first.proxyUrl);
  assert.ok(await probeProxy(second.proxyUrl));
});

test('Windows settings resolution uses the documented precedence', () => {
  assert.equal(
    resolveClaudeSettingsPath({
      platform: 'win32',
      env: {
        ZEROH_CLAUDE_SETTINGS: 'D:\\tests\\settings.local.json',
        CLAUDE_CONFIG_DIR: 'C:\\ignored',
        USERPROFILE: 'C:\\Users\\Alice',
      },
      homedir: () => 'C:\\Users\\Fallback',
    }),
    'D:\\tests\\settings.local.json',
  );
  assert.equal(
    resolveClaudeSettingsPath({
      platform: 'win32',
      env: { CLAUDE_CONFIG_DIR: 'D:\\Claude', USERPROFILE: 'C:\\Users\\Alice' },
    }),
    'D:\\Claude\\settings.json',
  );
  assert.equal(
    resolveClaudeSettingsPath({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\Alice' },
    }),
    'C:\\Users\\Alice\\.claude\\settings.json',
  );
});

async function rawRequest(port, text) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.end(text));
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => (data += chunk));
    socket.on('close', () => resolve(data));
    socket.on('error', () => resolve(data));
  });
}

test('the daemon masks registered sessions and passes requests no ZeroH hook registered through unmasked', async (t) => {
  const isolated = isolatedEnvironment('proxy-routing');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  const projectA = path.join(isolated.root, 'project-a');
  mkdirSync(projectA, { recursive: true });
  const secretA = 'ProjectA_ZEROHFAKE_known_value_424242';
  writeFileSync(path.join(projectA, '.env'), `FIRST_KEY=${secretA}\n`);
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: projectA,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-session-a',
  });
  const body = JSON.stringify({
    messages: [{ role: 'user', content: secretA }],
  });
  const origin = new URL(installed.proxyUrl).origin;
  const port = Number(new URL(installed.proxyUrl).port);

  // A request of a session no hook registered, or one without a session
  // header, passes through unmasked even while session A's plugin is live:
  // no ZeroH hook runs for it, so a token in its context could never be put
  // back into its commands (product rule 8; 1.0.0: a git author email
  // committed as a token by a session ZeroH did not run in).
  const unknown = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-unregistered',
  });
  assert.equal(unknown.status, 200);
  assert.equal(
    unknown.headers['x-zeroh-disclosure'],
    'passthrough-plugin-inactive',
  );
  assert.equal(upstream.seen[0].body, body);
  const headerlessLive = await postJson(
    `${installed.proxyUrl}/v1/messages`,
    body,
  );
  assert.equal(headerlessLive.status, 200);
  assert.equal(upstream.seen[1].body, body);
  assert.equal(
    routeSeen(proxyPaths(isolated.env), 'ZEROHFAKE-session-unregistered'),
    false,
  );

  // Once A has ended, the same holds (D-12): Claude Code without the plugin
  // keeps working.
  endSessionRoute({ env: isolated.env, sessionId: 'ZEROHFAKE-session-a' });
  const afterEnd = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-unregistered',
  });
  assert.equal(afterEnd.status, 200);
  assert.equal(upstream.seen[2].body, body);

  // A route no hook refreshed within the window no longer masks either.
  const routeFile = path.join(
    proxyPaths(isolated.env).routes,
    routeFileName('ZEROHFAKE-session-a'),
  );
  writePrivateJson(routeFile, {
    ...readJsonFile(routeFile),
    at: '2026-01-01T00:00:00.000Z',
  });
  const stale = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-a',
  });
  assert.equal(stale.status, 200);
  assert.equal(upstream.seen[3].body, body);

  // A body with no session header passes through too when no plugin
  // session is live (T-27): Claude Code without the plugin keeps working.
  const headerless = await postJson(`${installed.proxyUrl}/v1/messages`, body);
  assert.equal(headerless.status, 200);
  assert.equal(upstream.seen[4].body, body);

  // Without the access key or with an unknown one (an entry from a lost
  // home or an earlier build): never refused (D-10), forwarded to the one
  // upstream the installs name, and reported once. Outside the API paths:
  // not found.
  const keyless = await postJson(`${origin}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-unregistered',
  });
  assert.equal(keyless.status, 200);
  const wrongKey = await postJson(
    `${origin}/z/ZEROHFAKEwrongkey000000000000000/v1/messages`,
    body,
    { sessionId: 'ZEROHFAKE-session-unregistered' },
  );
  assert.equal(wrongKey.status, 200);
  assert.equal(upstream.seen.length, 7);
  const reports = readdirSync(path.join(isolated.env.ZEROH_HOME, 'reports'));
  assert.deepEqual(
    reports
      .map(
        (name) =>
          readJsonFile(path.join(isolated.env.ZEROH_HOME, 'reports', name))
            .event,
      )
      .sort(),
    ['unknown-access-key'],
  );
  const offPath = await postJson(`${installed.proxyUrl}/other`, body);
  assert.equal(offPath.status, 404);

  // Absolute-form and scheme-relative targets never reach another host and
  // never crash the daemon.
  const absolute = await rawRequest(
    port,
    'GET http://127.0.0.1:9/v1/messages HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
  );
  assert.match(absolute, /^HTTP\/1\.1 400/u);
  const schemeRelative = await rawRequest(
    port,
    'GET //evil.zerohfake.invalid/v1/messages HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
  );
  assert.match(schemeRelative, /^HTTP\/1\.1 400/u);
  const garbage = await rawRequest(port, 'NOT HTTP AT ALL\r\n\r\n');
  assert.match(garbage, /400/u);
  assert.ok(await probeProxy(installed.proxyUrl));
  assert.equal(upstream.seen.length, 7);

  // After a hook refreshes the route, the same request is masked.
  refreshSessionRoute({
    env: isolated.env,
    sessionId: 'ZEROHFAKE-session-a',
    root: projectA,
    pluginDir: PLUGIN,
    now: Date.now() + 60_000,
  });
  const paths = proxyPaths(isolated.env);
  assert.equal(routeSeen(paths, 'ZEROHFAKE-session-a'), false);
  const masked = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-a',
  });
  assert.equal(masked.status, 200);
  // The daemon records that this session's traffic goes through it; a hook
  // refreshing the route keeps the record.
  assert.equal(routeSeen(paths, 'ZEROHFAKE-session-a'), true);
  refreshSessionRoute({
    env: isolated.env,
    sessionId: 'ZEROHFAKE-session-a',
    root: projectA,
    pluginDir: PLUGIN,
    now: Date.now() + 120_000,
  });
  assert.equal(routeSeen(paths, 'ZEROHFAKE-session-a'), true);
  assert.equal(routeSeen(paths, 'ZEROHFAKE-session-unregistered'), false);
  assert.ok(!upstream.seen[7].body.includes(secretA));
});

test('hooks learn whether THIS session is masked from the daemon itself', async (t) => {
  const isolated = isolatedEnvironment('proxy-session-status');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-status-session',
  });
  const sessionEnv = {
    ...isolated.env,
    ANTHROPIC_BASE_URL: installed.proxyUrl,
  };
  assert.deepEqual(
    await sessionProxyState({
      env: sessionEnv,
      sessionId: 'ZEROHFAKE-status-session',
    }),
    { active: true, reason: 'mask' },
  );
  assert.deepEqual(
    await sessionProxyState({
      env: sessionEnv,
      sessionId: 'ZEROHFAKE-other-session',
    }),
    { active: false, reason: 'pass' },
  );
  for (const provider of [
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ]) {
    assert.deepEqual(
      await sessionProxyState({
        env: { ...sessionEnv, [provider]: '1' },
        sessionId: 'ZEROHFAKE-status-session',
      }),
      { active: false, reason: 'provider' },
    );
  }
  assert.equal(
    (
      await sessionProxyState({
        env: { ...sessionEnv, ZEROH_PROXY: 'off' },
        sessionId: 'ZEROHFAKE-status-session',
      })
    ).active,
    false,
  );
  // P-5: nothing in the environment can claim the proxy masks this session.
  for (const value of ['1', 'on', 'true']) {
    assert.equal(
      (
        await sessionProxyState({
          env: { ...isolated.env, ZEROH_PROXY: value },
          sessionId: 'ZEROHFAKE-status-session',
        })
      ).active,
      false,
    );
  }
  // A listener that cannot prove it holds this home's control token.
  const impostor = await fakeUpstream({
    body: JSON.stringify({
      ok: true,
      version: 1,
      session: 'mask',
      key: 'known',
      proof: 'x',
    }),
  });
  t.after(() => impostor.close());
  const impostorUrl = `${impostor.url}/z/${new URL(installed.proxyUrl).pathname.slice(3)}`;
  assert.deepEqual(
    await sessionProxyState({
      env: { ...isolated.env, ANTHROPIC_BASE_URL: impostorUrl },
      sessionId: 'ZEROHFAKE-status-session',
    }),
    { active: false, reason: 'unreachable' },
  );
});

test('routes are refreshed by hooks and pruned after the window', () => {
  const isolated = isolatedEnvironment('proxy-routes');
  const paths = proxyPaths(isolated.env);
  const route = {
    env: isolated.env,
    sessionId: 'ZEROHFAKE-route',
    root: isolated.root,
    pluginDir: PLUGIN,
  };
  assert.equal(
    refreshSessionRoute(route),
    false,
    'no route is written before a proxy exists',
  );
  writeProxyConfig(paths, {
    version: 3,
    controlToken: 'ZEROHFAKE',
    installs: {},
  });
  assert.equal(refreshSessionRoute(route), true);
  const file = path.join(paths.routes, routeFileName('ZEROHFAKE-route'));
  const first = readJsonFile(file);
  assert.equal(first.root, path.resolve(isolated.root));
  assert.equal(first.optOut, false);
  refreshSessionRoute({ ...route, optOut: true });
  assert.equal(readJsonFile(file).optOut, true);
  writePrivateJson(path.join(paths.routes, 'old.json'), {
    sessionId: 'old',
    at: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(pruneRoutes(paths, 60_000), 1);
  assert.equal(existsSync(path.join(paths.routes, 'old.json')), false);
  assert.equal(existsSync(file), true);
});

test('two Claude profiles share one daemon, each with its own entry', async (t) => {
  const isolated = isolatedEnvironment('proxy-profiles');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  const profileA = isolated.settings;
  const profileB = path.join(isolated.root, 'profile-b', 'settings.json');
  mkdirSync(path.dirname(profileB), { recursive: true });
  writeFileSync(profileA, '{}\n');
  writeFileSync(profileB, '{"theme":"dark"}\n');
  const envB = { ...isolated.env, ZEROH_CLAUDE_SETTINGS: profileB };
  t.after(async () => {
    await stopDefaultProxy({ env: envB });
    await stopDefaultProxy({ env: isolated.env });
  });
  const a = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-profile-a',
  });
  const b = await ensureDefaultProxy({
    env: envB,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-profile-b',
  });
  assert.equal(a.pid, b.pid);
  assert.equal(new URL(a.proxyUrl).port, new URL(b.proxyUrl).port);
  assert.notEqual(a.proxyUrl, b.proxyUrl);
  assert.equal(
    settingsDoc(isolated, profileB).env.ANTHROPIC_BASE_URL,
    b.proxyUrl,
  );
  // A's next start leaves B alone, and B still works.
  const again = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-profile-a',
  });
  assert.equal(again.pid, a.pid);
  const response = await postJson(
    `${b.proxyUrl}/v1/messages`,
    JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    { sessionId: 'ZEROHFAKE-profile-b' },
  );
  assert.equal(response.status, 200);
  // proxy off for B restores B only; A keeps the running daemon.
  const offB = await stopDefaultProxy({ env: envB });
  assert.equal(offB.restored, true);
  assert.deepEqual(offB.remaining, [path.resolve(profileA)]);
  assert.deepEqual(settingsDoc(isolated, profileB), { theme: 'dark' });
  assert.ok(await probeProxy(a.proxyUrl));
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, a.proxyUrl);
});

test('a failing SessionStart never uninstalls or moves the shared proxy', async (t) => {
  const isolated = isolatedEnvironment('proxy-sessionstart-error');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-healthy',
  });
  const broken = path.join(isolated.root, 'broken', 'settings.json');
  mkdirSync(path.dirname(broken), { recursive: true });
  writeFileSync(broken, '{ not json');
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'hooks', 'run.js'), 'session-start'],
    {
      input: JSON.stringify({
        session_id: 'ZEROHFAKE-broken',
        cwd: isolated.root,
        source: 'startup',
      }),
      encoding: 'utf8',
      env: {
        ...isolated.env,
        ZEROH_CLAUDE_SETTINGS: broken,
        ZEROH_BANNER: 'off',
        CLAUDE_PROJECT_DIR: isolated.root,
      },
      timeout: 20_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /could not start/u);
  const health = await probeProxy(installed.proxyUrl);
  assert.equal(health?.pid, installed.pid);
  assert.equal(
    settingsDoc(isolated).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );
  assert.equal(
    createServiceManager({ env: isolated.env }).isRegistered(),
    true,
  );
  assert.equal(readFileSync(broken, 'utf8'), '{ not json');
});

test('proxy off and the next install recover the original upstream after ZEROH_HOME is lost', async (t) => {
  const isolated = isolatedEnvironment('proxy-home-lost');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const gateway = upstream.url;
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway } }, null, 2)}\n`,
  );
  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-home-lost',
  });
  process.kill(first.pid, 'SIGTERM');
  await waitUntilDown(first.proxyUrl);
  rmSync(isolated.env.ZEROH_HOME, { recursive: true, force: true });

  // A new ZEROH_HOME: the upstream is the user's gateway, never the dead
  // proxy, and the entry (key and port) is kept for sessions that use it.
  const envNew = {
    ...isolated.env,
    ZEROH_HOME: path.join(isolated.root, 'zeroh-home-new'),
    ANTHROPIC_BASE_URL: first.proxyUrl,
  };
  const second = await ensureDefaultProxy({
    env: envNew,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-home-lost',
  });
  assert.equal(second.upstream, gateway);
  assert.equal(second.proxyUrl, first.proxyUrl);
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, first.proxyUrl);
  process.kill(second.pid, 'SIGTERM');
  await waitUntilDown(second.proxyUrl);
  rmSync(envNew.ZEROH_HOME, { recursive: true, force: true });

  // The daemon put the gateway back when it was stopped (LP-B4; Windows
  // ends it at once, so there only proxy off can); proxy off with no
  // ZEROH_HOME at all still restores it and clears the restore record.
  if (process.platform !== 'win32')
    assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, gateway);
  await stopDefaultProxy({ env: envNew });
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, gateway);
  assert.equal(existsSync(restoreRecordPath(isolated.settings)), false);
});

test('SessionStart repair removes only a dead ZeroH entry', async () => {
  const isolated = isolatedEnvironment('proxy-repair');
  const gateway = 'https://gateway.zerohfake.invalid/anthropic';
  const dead = 'http://127.0.0.1:9/z/ZEROHFAKEdeadproxykey000000000000';
  installSetting(
    isolated,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway }, theme: 'dark' }, null, 2)}\n`,
    dead,
  );
  const repaired = await repairDeadProxySetting({ env: isolated.env });
  assert.equal(repaired.repaired, true);
  const settings = settingsDoc(isolated);
  assert.equal(settings.env.ANTHROPIC_BASE_URL, gateway);
  assert.equal(settings.theme, 'dark');
  const install = readProxyConfig(proxyPaths(isolated.env)).installs[
    installId(isolated.settings)
  ];
  assert.equal(
    install.proxyUrl,
    null,
    'the next healthy start writes it again',
  );
  assert.equal(
    (await repairDeadProxySetting({ env: isolated.env })).repaired,
    false,
  );
});

test('SessionStart lock wait and a never-answering daemon share the loader deadline', async (t) => {
  const isolated = isolatedEnvironment('proxy-start-deadline');
  const gateway = 'https://gateway.zerohfake.invalid/anthropic';
  const dead = 'http://127.0.0.1:9/z/ZEROHFAKEdeadproxykey000000000000';
  installSetting(
    isolated,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway }, theme: 'dark' })}\n`,
    dead,
  );
  const pidFile = path.join(isolated.root, 'never-answering-daemon.pid');
  const preload = path.join(isolated.root, 'never-answering-daemon.mjs');
  writeFileSync(
    preload,
    [
      "import { writeFileSync } from 'node:fs';",
      "if (process.argv[1]?.endsWith('proxy-daemon.mjs')) {",
      `  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      '  setInterval(() => {}, 1000);',
      '  await new Promise(() => {});',
      '}',
    ].join('\n'),
  );
  t.after(() => {
    if (existsSync(pidFile)) {
      try {
        process.kill(Number(readFileSync(pidFile, 'utf8')));
      } catch {}
    }
  });
  const lock = path.join(isolated.env.ZEROH_HOME, 'proxy', 'manager.lock');
  mkdirSync(path.dirname(lock), { recursive: true });
  const holder = spawn(
    process.execPath,
    [
      '-e',
      `const fs=require('node:fs'); fs.writeFileSync(process.argv[1], process.pid+'\\n'); setTimeout(()=>{fs.rmSync(process.argv[1],{force:true})},2500);`,
      lock,
    ],
    { stdio: 'ignore' },
  );
  t.after(() => holder.kill());
  for (let attempt = 0; !existsSync(lock) && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(existsSync(lock));
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'hooks', 'run.js'), 'session-start'],
    {
      input: JSON.stringify({
        session_id: 'ZEROHFAKE-deadline',
        cwd: isolated.root,
        source: 'startup',
      }),
      encoding: 'utf8',
      env: {
        ...isolated.env,
        ZEROH_CLAUDE_SETTINGS: isolated.settings,
        CLAUDE_PROJECT_DIR: isolated.root,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      },
      timeout: 15_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 13_000, result.stdout);
  assert.match(result.stdout, /could not start/u);
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, gateway);
  assert.equal(settingsDoc(isolated).theme, 'dark');
});

test('SessionStart reclaims a proxy lock left by a killed owner', async () => {
  const isolated = isolatedEnvironment('proxy-dead-owner');
  const lock = path.join(isolated.env.ZEROH_HOME, 'proxy', 'manager.lock');
  mkdirSync(path.dirname(lock), { recursive: true });
  const owner = spawn(
    process.execPath,
    [
      '-e',
      `const fs=require('node:fs'); fs.writeFileSync(process.argv[1], process.pid+'\\n'); setInterval(()=>{},1000);`,
      lock,
    ],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; !existsSync(lock) && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(existsSync(lock));
  const exited = new Promise((resolve) => owner.once('exit', resolve));
  owner.kill('SIGKILL');
  await exited;
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'hooks', 'run.js'), 'session-start'],
    {
      input: JSON.stringify({
        session_id: 'dead-owner',
        cwd: isolated.root,
        source: 'startup',
      }),
      encoding: 'utf8',
      env: { ...isolated.env, ZEROH_PROXY: 'off', ZEROH_BANNER: 'off' },
      timeout: 15_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Date.now() - started < 5_000, result.stdout);
  assert.equal(existsSync(lock), false);
});

test('a registered login item with a slow replacement reports daemon startup failure', async (t) => {
  const isolated = isolatedEnvironment('registered-slow-daemon');
  writeFileSync(isolated.settings, '{}\n');
  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'registered-slow-first',
    registerLoginItem: false,
  });
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  let registered = false;
  const manager = {
    isRegistered: () => registered,
    register() {
      registered = true;
      process.kill(first.pid, 'SIGKILL');
    },
  };
  await assert.rejects(
    ensureDefaultProxy({
      env: isolated.env,
      root: isolated.root,
      pluginRoot: PLUGIN,
      sessionId: 'registered-slow-second',
      serviceManager: manager,
      deadlineMs: Date.now() + 1_500,
      spawnProcess: () => ({ once() {}, unref() {} }),
    }),
    /could not start|deadline|proxy/u,
  );
  assert.equal(registered, true);
  assert.equal(
    readProxyConfig(proxyPaths(isolated.env)).loginItemRefused,
    undefined,
  );
});

test('settings writes follow symlinks, keep the file mode and retry a locked rename', (t) => {
  const isolated = isolatedEnvironment('proxy-symlink');
  const target = path.join(isolated.root, 'dotfiles', 'settings.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, '{}\n', { mode: 0o644 });
  rmSync(isolated.settings, { force: true });
  symlinkSync(target, isolated.settings);
  writeSettingsFile(isolated.settings, '{"env":{}}\n');
  assert.equal(lstatSync(isolated.settings).isSymbolicLink(), true);
  assert.equal(readFileSync(target, 'utf8'), '{"env":{}}\n');
  if (process.platform !== 'win32') {
    assert.equal(statSync(target).mode & 0o777, 0o644);
  }
  let attempts = 0;
  renameWithRetry('a', 'b', {
    delayMs: 1,
    rename() {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      }
    },
  });
  assert.equal(attempts, 3);
  t.diagnostic('rename retried twice');
});

// P-2: masking fixes in an update reach proxy-masked prompts at once.
test('a plugin update restarts the daemon with the new code; an older copy never downgrades it', async (t) => {
  const isolated = isolatedEnvironment('proxy-update');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const older = pluginCopy(isolated.root, { version: '1.0.0', name: 'v100' });
  const newer = pluginCopy(isolated.root, { version: '1.0.1', name: 'v101' });
  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: older,
    sessionId: 'ZEROHFAKE-update',
  });
  assert.equal((await probeProxy(first.proxyUrl)).build.version, '1.0.0');
  const same = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: older,
    sessionId: 'ZEROHFAKE-update',
  });
  assert.equal(same.restarted, false);
  assert.equal(same.pid, first.pid);

  const updated = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: newer,
    sessionId: 'ZEROHFAKE-update',
  });
  assert.equal(updated.upgraded, true);
  assert.equal(updated.restarted, true);
  assert.notEqual(updated.pid, first.pid);
  assert.equal(updated.proxyUrl, first.proxyUrl);
  assert.equal((await probeProxy(updated.proxyUrl)).build.version, '1.0.1');
  const runtime = proxyPaths(isolated.env).runtime;
  assert.equal(readJsonFile(path.join(runtime, 'build.json')).version, '1.0.1');

  const back = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: older,
    sessionId: 'ZEROHFAKE-update',
  });
  assert.equal(back.restarted, false);
  assert.equal(back.pid, updated.pid);
  assert.equal(readJsonFile(path.join(runtime, 'build.json')).version, '1.0.1');
});

// Dogfood, 2026-09-30: a session that loaded 1.0.1 upgraded the shared
// daemon, and model requests other sessions sent meanwhile failed with
// ECONNREFUSED (a subagent died). The new daemon now loads first and takes
// the port over from the old one at once; the old one finishes its open
// requests and serves what arrives on its open connections. A client's
// quick retry of a connection error (Claude Code retries them) covers the
// few milliseconds the port changes hands; before 1.0.2 the port stayed
// closed while the new daemon loaded, longer than those retries.
test('a plugin update hands the port over: requests of running sessions are served throughout', async (t) => {
  const isolated = isolatedEnvironment('proxy-handover');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const older = pluginCopy(isolated.root, { version: '1.0.0', name: 'h100' });
  const newer = pluginCopy(isolated.root, { version: '1.0.1', name: 'h101' });
  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: older,
    sessionId: 'ZEROHFAKE-handover',
  });
  const send = async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await postJson(`${first.proxyUrl}/v1/messages`, CLEAN_BODY, {
          sessionId: 'ZEROHFAKE-handover',
          headers: { connection: 'close' },
        });
      } catch (error) {
        if (
          !['ECONNREFUSED', 'ECONNRESET'].includes(error.code) ||
          attempt >= 2
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  };
  let upgrading = true;
  const results = [];
  const traffic = (async () => {
    while (upgrading) {
      results.push(
        await send().then(
          (response) => response.status,
          (error) => error.code || error.message,
        ),
      );
    }
  })();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const updated = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: newer,
    sessionId: 'ZEROHFAKE-handover',
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  upgrading = false;
  await traffic;
  assert.equal(updated.upgraded, true);
  assert.notEqual(updated.pid, first.pid);
  assert.equal(updated.proxyUrl, first.proxyUrl);
  assert.equal((await probeProxy(updated.proxyUrl)).build.version, '1.0.1');
  assert.ok(results.length > 10, `only ${results.length} request(s) sent`);
  assert.deepEqual(
    results.filter((status) => status !== 200),
    [],
    `${results.length} request(s) during the upgrade`,
  );
});

// Windows re-test (rc.2): with no login item, typed secrets went out
// unmasked. A machine that refuses login items now still gets the proxy for
// its sessions: the entry is written, typing is masked, and the daemon takes
// the entry out and leaves once no plugin session is live (T-27: a later
// session never meets a dead port). The refusal, its reason and the fix are
// recorded for the banner, status and doctor.
test('a refused login item still gives the session a running proxy, and says why with the fix', async (t) => {
  const isolated = isolatedEnvironment('proxy-login-item-refused');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const refusing = {
    isRegistered: () => false,
    register() {
      throw Object.assign(new Error('Command failed: schtasks.exe'), {
        code: 'EPERM',
        detail: 'ERROR: The task XML is malformed.',
      });
    },
    unregister: () => ({ removed: false, kind: null }),
  };
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-refused',
    serviceManager: refusing,
    writeSettings: false,
  });
  assert.equal(installed.enabled, true);
  assert.equal(installed.loginItem, false);
  assert.equal(installed.sessionOnly, true);
  assert.equal(installed.loginItemRefused.code, 'EPERM');
  assert.equal(
    installed.loginItemRefused.detail,
    'ERROR: The task XML is malformed.',
  );
  assert.match(installed.warning, /could not register the login item/u);
  assert.match(installed.warning, /The task XML is malformed/u);
  assert.match(installed.warning, /what you type is still masked/u);
  assert.match(installed.warning, /To fix: /u);
  assert.ok(await probeProxy(installed.proxyUrl), 'the daemon runs');
  // The first prompt puts the session behind the proxy.
  const sessionEnv = { ...isolated.env };
  delete sessionEnv.ANTHROPIC_BASE_URL;
  const routing = await routeSession({
    env: sessionEnv,
    sessionId: 'ZEROHFAKE-refused',
    root: isolated.root,
    pluginRoot: PLUGIN,
    serviceManager: refusing,
    waitMs: 10,
  });
  assert.deepEqual(routing, { routed: true, state: 'routed' });
  assert.equal(
    settingsDoc(isolated).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );
  const again = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-refused-2',
    serviceManager: refusing,
  });
  assert.equal(again.enabled, true);
  assert.equal(again.warning, null, 'the notice is said once');
  assert.equal(again.loginItemRefused.code, 'EPERM', 'the record stays');
  const reports = readdirSync(path.join(isolated.env.ZEROH_HOME, 'reports'));
  assert.equal(reports.length, 1);
  assert.equal(
    readJsonFile(path.join(isolated.env.ZEROH_HOME, 'reports', reports[0]))
      .event,
    'login-item-failed',
  );
  const runtime = await proxyRuntimeStatus({
    env: isolated.env,
    serviceManager: refusing,
  });
  assert.equal(runtime.running, true);
  assert.equal(runtime.loginItem, false);
  assert.equal(runtime.loginItemRefused.code, 'EPERM');
  const doctor = await diagnoseProxy({
    env: isolated.env,
    serviceManager: refusing,
  });
  assert.ok(doctor.findings.includes('login-item-refused'));

  // Sessions still live: the daemon stays and so does the entry.
  let left = 0;
  const leave = () => {
    left += 1;
  };
  const config = readProxyConfig(proxyPaths(isolated.env));
  assert.deepEqual(
    await evaluateSessionOnlyExit({
      env: isolated.env,
      controlToken: config.controlToken,
      leave,
    }),
    { leave: false },
  );
  // Every session ended: the entry comes out and the daemon leaves.
  for (const id of ['ZEROHFAKE-refused', 'ZEROHFAKE-refused-2']) {
    endSessionRoute({ env: isolated.env, sessionId: id });
  }
  const result = await evaluateSessionOnlyExit({
    env: isolated.env,
    controlToken: config.controlToken,
    leave,
  });
  assert.deepEqual(result, { leave: true, restored: 1 });
  assert.equal(left, 1);
  assert.equal(settingsDoc(isolated).env?.ANTHROPIC_BASE_URL, undefined);

  // Once the login item registers, the record goes and the daemon is kept.
  const accepting = {
    isRegistered: () => true,
    register() {},
    unregister: () => ({ removed: true, kind: 'systemd' }),
  };
  const fixed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-refused-3',
    serviceManager: accepting,
  });
  assert.equal(fixed.loginItem, true);
  assert.equal(fixed.loginItemRefused, null);
  assert.equal(
    readProxyConfig(proxyPaths(isolated.env)).loginItemRefused,
    undefined,
  );
  endSessionRoute({ env: isolated.env, sessionId: 'ZEROHFAKE-refused-3' });
  assert.deepEqual(
    await evaluateSessionOnlyExit({
      env: isolated.env,
      controlToken: config.controlToken,
      leave,
    }),
    { leave: false },
  );
});

// T-19: a running session is put behind the proxy by its first prompt.
test('routeSession writes the entry for a session that does not use the proxy yet, and never for one it cannot reach', async (t) => {
  const isolated = isolatedEnvironment('proxy-route-session');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const gateway = upstream.url;
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway } }, null, 2)}\n`,
  );
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  // The session's environment comes from the same settings file.
  const sessionEnv = { ...isolated.env, ANTHROPIC_BASE_URL: gateway };
  const options = {
    env: sessionEnv,
    sessionId: 'ZEROHFAKE-route',
    root: isolated.root,
    pluginRoot: PLUGIN,
    waitMs: 50,
  };
  // SessionStart starts the proxy and its login item, but writes nothing.
  await ensureDefaultProxy({ ...options, writeSettings: false });
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, gateway);
  const routed = await routeSession(options);
  assert.deepEqual(routed, { routed: true, state: 'routed' });
  const entry = settingsDoc(isolated).env.ANTHROPIC_BASE_URL;
  assert.match(entry, /^http:\/\/127\.0\.0\.1:\d+\/z\//u);
  assert.equal(
    readProxyConfig(proxyPaths(isolated.env)).installs[
      installId(isolated.settings)
    ].upstream,
    gateway,
  );
  // Long after the write, a session that still does not use it cannot be
  // routed this way: typed secrets are stopped instead.
  const later = await routeSession({
    ...options,
    now: () => Date.now() + 60_000,
  });
  assert.deepEqual(later, { routed: false, state: 'not-applied' });
  // Already behind a ZeroH URL: the prompt guard's case.
  assert.equal(
    (
      await routeSession({
        ...options,
        env: { ...isolated.env, ANTHROPIC_BASE_URL: entry },
      })
    ).state,
    'configured',
  );
  // The shell sets ANTHROPIC_BASE_URL: Claude Code ignores the settings
  // entry, so nothing is written and nothing is assumed.
  const other = isolatedEnvironment('proxy-route-overridden');
  writeFileSync(other.settings, '{}\n');
  assert.deepEqual(
    await routeSession({
      ...options,
      env: {
        ...other.env,
        ANTHROPIC_BASE_URL: 'https://shell.zerohfake.invalid',
      },
    }),
    { routed: false, state: 'overridden' },
  );
  assert.deepEqual(settingsDoc(other), {});
  assert.deepEqual(
    await routeSession({
      ...options,
      env: { ...sessionEnv, ZEROH_PROXY: 'off' },
    }),
    { routed: false, state: 'not-configured' },
  );
});

// D-10: a settings entry with a key the daemon does not know (a lost home,
// an earlier build) keeps Claude Code working, counts as the proxy being up,
// and the next SessionStart repairs the entry.
test('an entry with an unknown access key still works, and SessionStart repairs it', async (t) => {
  const isolated = isolatedEnvironment('proxy-unknown-key');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-unknown-key',
  });
  const stale = `${new URL(installed.proxyUrl).origin}/z/ZEROHFAKEstalekey000000000000000`;
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: stale } }, null, 2)}\n`,
  );
  const sessionEnv = { ...isolated.env, ANTHROPIC_BASE_URL: stale };
  const guard = await checkSessionProxy({
    env: sessionEnv,
    sessionId: 'ZEROHFAKE-unknown-key',
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  assert.deepEqual(guard, { block: false, state: 'up' });
  assert.equal(
    (
      await sessionProxyState({
        env: sessionEnv,
        sessionId: 'ZEROHFAKE-unknown-key',
      })
    ).active,
    true,
  );
  const secret = 'sk_live_ZEROHFAKEunknownkey000000000';
  writeFileSync(path.join(isolated.root, '.env'), `KEY=${secret}\n`);
  const response = await postJson(
    `${stale}/v1/messages`,
    JSON.stringify({ messages: [{ role: 'user', content: secret }] }),
    { sessionId: 'ZEROHFAKE-unknown-key' },
  );
  assert.equal(response.status, 200);
  assert.ok(!upstream.seen.at(-1).body.includes(secret), 'still masked');
  await ensureDefaultProxy({
    env: sessionEnv,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-unknown-key',
    writeSettings: false,
  });
  assert.equal(
    settingsDoc(isolated).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );
});

// Update gate (2026-09-28): rc.2 compared 1.0.0-rc.2 and 1.0.0 as equal, so
// an rc session left open could copy its runtime back over the release's.
// A release candidate now sorts below its release.
test('a release candidate never replaces the release daemon', async () => {
  const { compareVersions, newerBuild } =
    await import('../lib/proxy-manager.js');
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.2'), 1);
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1);
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  const rc = { version: '1.0.0-rc.2', hash: 'aaaa' };
  const release = { version: '1.0.0', hash: 'bbbb' };
  assert.equal(newerBuild(rc, release), false);
  assert.equal(newerBuild(release, rc), true);
  // The same version with other code (an edited checkout) still replaces it.
  assert.equal(newerBuild({ ...release, hash: 'cccc' }, release), true);
  assert.equal(newerBuild(release, release), false);
});
