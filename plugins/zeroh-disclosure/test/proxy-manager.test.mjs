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
  ensureDefaultProxy,
  prepareInstall,
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
import { createServiceManager } from '../lib/service-manager.js';
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
  // State: proxy.json and the routes; nothing else.
  assert.deepEqual(readdirSync(paths.directory).sort(), [
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
  const definition = readdirSync(isolated.env.ZEROH_SERVICE_MANAGER_DIR)
    .map((name) =>
      readFileSync(
        path.join(isolated.env.ZEROH_SERVICE_MANAGER_DIR, name),
        'utf8',
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

test('the daemon masks registered sessions, masks unclaimed requests while a plugin session is live, and passes them through otherwise', async (t) => {
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

  // While session A's plugin is live, a request of a session no hook
  // registered, or one without a session header, may be A's own traffic
  // under another id: it is masked with A's vault, never sent as it is
  // (LP-B5).
  const unknown = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-unregistered',
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.headers['x-zeroh-disclosure'], undefined);
  assert.ok(!upstream.seen[0].body.includes(secretA));
  const headerlessLive = await postJson(
    `${installed.proxyUrl}/v1/messages`,
    body,
  );
  assert.equal(headerlessLive.status, 200);
  assert.ok(!upstream.seen[1].body.includes(secretA));
  assert.equal(
    routeSeen(proxyPaths(isolated.env), 'ZEROHFAKE-session-unregistered'),
    false,
  );

  // Once A has ended, no plugin session is live: a session no hook
  // registered (ZeroH disabled in its project) passes through unchanged
  // (D-12).
  endSessionRoute({ env: isolated.env, sessionId: 'ZEROHFAKE-session-a' });
  const afterEnd = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ZEROHFAKE-session-unregistered',
  });
  assert.equal(afterEnd.status, 200);
  assert.equal(
    afterEnd.headers['x-zeroh-disclosure'],
    'passthrough-plugin-inactive',
  );
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

  // The daemon put the gateway back when it was stopped (LP-B4); proxy off
  // with no ZEROH_HOME at all still clears the restore record.
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

// P-3 and T-27: a machine that refuses login items gets a plain warning and
// no settings entry, because nothing would keep the proxy running after a
// reboot and every Claude Code session (with the plugin or without) would
// meet a dead port. Typed secrets are stopped instead.
test('a login item the OS refuses is a warning, and no settings entry is written', async (t) => {
  const isolated = isolatedEnvironment('proxy-login-item-refused');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  writeFileSync(isolated.settings, '{}\n');
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const refusing = {
    isRegistered: () => false,
    register() {
      throw Object.assign(new Error('Operation not permitted'), {
        code: 'EPERM',
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
  });
  assert.equal(installed.enabled, false);
  assert.equal(installed.wroteSettings, false);
  assert.match(installed.warning, /login item/u);
  assert.match(installed.warning, /typed secrets are stopped/u);
  assert.deepEqual(settingsDoc(isolated), {});
  // The first prompt cannot put the session behind the proxy either.
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
  // Told once, at SessionStart (LP-B3): the prompt adds no second notice.
  assert.deepEqual(routing, { routed: false, state: 'no-login-item' });
  assert.deepEqual(settingsDoc(isolated), {});
  const again = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-refused-2',
    serviceManager: refusing,
  });
  assert.equal(again.enabled, false);
  assert.equal(again.warning, null, 'the warning is said once');
  const reports = readdirSync(path.join(isolated.env.ZEROH_HOME, 'reports'));
  assert.equal(reports.length, 1);
  assert.equal(
    readJsonFile(path.join(isolated.env.ZEROH_HOME, 'reports', reports[0]))
      .event,
    'login-item-failed',
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
