// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installId, writeProxySetting } from '../lib/claude-settings.js';
import { writePrivateJson } from '../lib/private-fs.js';
import { evaluateOrphanCleanup } from '../lib/proxy-manager.js';
import {
  ORPHAN_AFTER_MS,
  proxyPaths,
  readProxyConfig,
  writeProxyConfig,
} from '../lib/proxy-state.js';
import {
  createServiceManager,
  windowsArgument,
  windowsHeadlessCommand,
  windowsTaskDefinition,
} from '../lib/service-manager.js';
import './helpers.mjs';
import { assertWellFormedXml } from './xml-wellformed.mjs';

function isolated(name) {
  const root = mkdtempSync(path.join(os.tmpdir(), `zeroh-service-${name}-`));
  const home = path.join(root, 'home');
  const env = {
    HOME: home,
    USERPROFILE: home,
    ZEROH_HOME: path.join(root, 'zeroh-home'),
    ZEROH_CREDENTIAL_HOME: path.join(root, 'credentials'),
    ZEROH_CLAUDE_SETTINGS: path.join(root, 'claude', 'settings.json'),
    ZEROH_SERVICE_MANAGER_DIR: path.join(root, 'definitions'),
  };
  mkdirSync(home, { recursive: true });
  mkdirSync(path.dirname(env.ZEROH_CLAUDE_SETTINGS), { recursive: true });
  return { root, env, files: proxyPaths(env) };
}

for (const [platform, marker] of [
  ['linux', '[Service]'],
  ['darwin', '<key>RunAtLoad</key>'],
  ['win32', '<LogonTrigger>'],
]) {
  test(`${platform} login item starts the copied runtime without elevation`, () => {
    const fixture = isolated(platform);
    const manager = createServiceManager({
      env: fixture.env,
      platform,
      definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
      executeCommands: false,
      uid: 1000,
    });
    const runtime = path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime');
    const config = fixture.files.config;
    const registration = manager.register({ runtime, config });
    const definition = readFileSync(registration.definition, 'utf8');

    assert.match(
      definition,
      new RegExp(marker.replaceAll('[', '\\[').replaceAll(']', '\\]'), 'u'),
    );
    assert.ok(definition.includes(process.execPath));
    assert.ok(
      definition.includes(path.join(runtime, 'bin', 'proxy-daemon.mjs')),
    );
    assert.ok(definition.includes(config));
    assert.doesNotMatch(definition, /--takeover/u);
    assert.equal(manager.isRegistered(), true);
    if (platform !== 'linux') assertWellFormedXml(definition);

    manager.unregister();
    assert.equal(existsSync(registration.definition), false);
    assert.equal(manager.isRegistered(), false);
  });
}

test('an orphaned daemon restores settings and unregisters after 24 hours', async () => {
  const fixture = isolated('cleanup');
  const proxyUrl = 'http://127.0.0.1:43201/z/ZEROHFAKEproxykey0000000000000';
  const gateway = 'https://gateway.zerohfake.invalid/anthropic';
  const settingsPath = fixture.env.ZEROH_CLAUDE_SETTINGS;
  writeFileSync(
    settingsPath,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway } }, null, 2)}\n`,
  );
  const install = {
    settingsPath,
    key: 'ZEROHFAKEproxykey0000000000000',
    upstream: gateway,
    originalBaseUrlPresent: true,
    originalBaseUrlValue: gateway,
    createdEnv: false,
    proxyUrl: null,
  };
  writeProxySetting(install, proxyUrl);
  writeProxyConfig(fixture.files, {
    version: 3,
    controlToken: 'ZEROHFAKEcontroltoken0000000000',
    port: 43201,
    installs: { [installId(settingsPath)]: install },
  });
  writePrivateJson(path.join(fixture.files.routes, 'missing.json'), {
    version: 3,
    sessionId: 'missing',
    pluginDir: path.join(fixture.root, 'removed-plugin'),
    root: fixture.root,
    at: new Date().toISOString(),
  });
  const unregistered = [];
  const logs = [];
  const serviceManager = {
    unregister(options) {
      unregistered.push(options);
      return { removed: true };
    },
  };
  const started = Date.now();
  const check = (at) =>
    evaluateOrphanCleanup({
      env: fixture.env,
      serviceManager,
      now: () => at,
      log: (line) => logs.push(line),
    });

  const pending = await check(started);
  assert.equal(pending.cleaned, false);
  assert.ok(readProxyConfig(fixture.files).orphanSince);
  assert.equal((await check(started + ORPHAN_AFTER_MS - 1)).cleaned, false);

  const cleaned = await check(started + ORPHAN_AFTER_MS);
  assert.equal(cleaned.cleaned, true);
  assert.deepEqual(unregistered, [{ stop: false }]);
  assert.equal(logs.length, 1);
  assert.equal(existsSync(fixture.files.config), false);
  assert.equal(
    JSON.parse(readFileSync(settingsPath, 'utf8')).env.ANTHROPIC_BASE_URL,
    gateway,
  );
});

test('the Windows logon task is well-formed XML for the current user, with no battery or 72 h limits', () => {
  const xml = windowsTaskDefinition(
    {
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Users\\A & B\\.zeroh\\bin\\proxy-daemon.mjs',
        'C:\\Users\\A & B\\.zeroh\\proxy\\proxy.json',
      ],
    },
    { userId: 'CONTOSO\\alice' },
  );
  assertWellFormedXml(xml);
  assert.doesNotMatch(xml, /<!--/u);
  assert.match(
    xml,
    /<LogonTrigger><Enabled>true<\/Enabled><UserId>CONTOSO\\alice<\/UserId><\/LogonTrigger>/u,
  );
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/u);
  assert.match(
    xml,
    /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/u,
  );
  assert.match(xml, /<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/u);
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/u);
  assert.match(xml, /A &amp; B/u);
  assert.throws(() => assertWellFormedXml('<a><!-- x --y --></a>'));
});

test('Windows task arguments follow Windows quoting and start the proxy headless', () => {
  assert.equal(
    windowsArgument('C:\\Users\\J O\\.zeroh\\bin\\proxy-daemon.mjs'),
    '"C:\\Users\\J O\\.zeroh\\bin\\proxy-daemon.mjs"',
  );
  assert.equal(windowsArgument('C:\\plain\\path.json'), 'C:\\plain\\path.json');
  assert.equal(
    windowsArgument('C:\\dir with space\\'),
    '"C:\\dir with space\\\\"',
  );
  assert.equal(windowsArgument('say "hi"'), '"say \\"hi\\""');
  assert.equal(windowsArgument(''), '""');
  const headless = windowsHeadlessCommand(
    {
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Users\\J O\\.zeroh\\bin\\proxy-daemon.mjs',
        'C:\\Users\\J O\\.zeroh\\proxy\\proxy.json',
      ],
    },
    { SystemRoot: 'C:\\WINDOWS' },
  );
  assert.equal(headless.executable, 'C:\\WINDOWS\\System32\\conhost.exe');
  const xml = windowsTaskDefinition(headless, { userId: 'CONTOSO\\alice' });
  assertWellFormedXml(xml);
  assert.match(
    xml,
    /<Command>C:\\WINDOWS\\System32\\conhost\.exe<\/Command><Arguments>--headless &quot;C:\\Program Files\\nodejs\\node\.exe&quot; &quot;C:\\Users\\J O\\\.zeroh\\bin\\proxy-daemon\.mjs&quot; &quot;C:\\Users\\J O\\\.zeroh\\proxy\\proxy\.json&quot;<\/Arguments>/u,
  );
  assert.doesNotMatch(xml, /\\\\/u, 'no doubled backslashes');
});

test('macOS registration boots out a leftover job, and cleanup boots out before disable', () => {
  const fixture = isolated('launchctl');
  const calls = [];
  const manager = createServiceManager({
    env: fixture.env,
    platform: 'darwin',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: true,
    uid: 501,
    execute(file, args) {
      calls.push([file, ...args].join(' '));
      if (args[0] === 'bootout') throw new Error('not loaded');
    },
  });
  const runtime = path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime');
  const registration = manager.register({
    runtime,
    config: fixture.files.config,
  });
  assert.deepEqual(calls, [
    'launchctl bootout gui/501/com.bladelabs.zeroh-disclosure-proxy',
    'launchctl enable gui/501/com.bladelabs.zeroh-disclosure-proxy',
    `launchctl bootstrap gui/501 ${registration.definition}`,
  ]);
  calls.length = 0;
  manager.unregister({ stop: false });
  assert.deepEqual(calls, [
    'launchctl bootout gui/501/com.bladelabs.zeroh-disclosure-proxy',
    'launchctl disable gui/501/com.bladelabs.zeroh-disclosure-proxy',
  ]);
  assert.equal(existsSync(registration.definition), false);
});

// P-3: a refused login item leaves nothing that looks registered, so the next
// session tries again.
test('a login item the OS refuses throws and leaves no definition behind', () => {
  const fixture = isolated('refused');
  for (const platform of ['darwin', 'win32']) {
    const manager = createServiceManager({
      env: fixture.env,
      platform,
      definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
      executeCommands: true,
      uid: 501,
      execute(file, args) {
        if (args[0] === 'bootout') return;
        throw Object.assign(new Error('Operation not permitted'), {
          code: 'EPERM',
        });
      },
    });
    assert.throws(
      () =>
        manager.register({
          runtime: path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime'),
          config: fixture.files.config,
        }),
      /not permitted/u,
    );
    assert.equal(manager.isRegistered(), false, platform);
  }
});

// T-26: after `launchctl bootout` (or a disabled unit, a deleted task) the
// definition file is still there, yet nothing starts the proxy at login.
test('a login item the OS no longer has loaded counts as unregistered, so the next session registers it again', () => {
  const fixture = isolated('unloaded');
  for (const [platform, check] of [
    ['darwin', 'launchctl print'],
    ['linux', 'systemctl --user is-enabled'],
    // By its full path: Windows looks for a bare name in the current folder.
    ['win32', 'C:\\Windows\\System32\\schtasks.exe /Query'],
  ]) {
    let loaded = true;
    const calls = [];
    const manager = createServiceManager({
      env: fixture.env,
      platform,
      definitionRoot: path.join(fixture.root, `definitions-${platform}`),
      executeCommands: true,
      uid: 501,
      execute(file, args) {
        const call = [file, ...args].join(' ');
        calls.push(call);
        if (call.startsWith(check) && !loaded) {
          throw new Error('not loaded');
        }
      },
    });
    manager.register({
      runtime: path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime'),
      config: fixture.files.config,
    });
    assert.equal(manager.isRegistered(), true, platform);
    loaded = false;
    assert.equal(manager.isRegistered(), false, platform);
    assert.ok(
      calls.some((call) => call.startsWith(check)),
      platform,
    );
  }
});

// A Node upgrade or a moved runtime makes the login item start a program
// that is gone: the definition no longer matches, so it is registered again.
test('a login item whose command changed counts as unregistered', () => {
  const fixture = isolated('changed');
  const manager = createServiceManager({
    env: fixture.env,
    platform: 'linux',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: false,
  });
  const target = {
    runtime: path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime'),
    config: fixture.files.config,
  };
  manager.register(target);
  assert.equal(manager.isRegistered(target), true);
  assert.equal(
    manager.isRegistered({
      ...target,
      runtime: path.join(fixture.root, 'moved'),
    }),
    false,
  );
  writeFileSync(manager.paths.systemd, '[Service]\nExecStart=/old/node x\n');
  assert.equal(manager.isRegistered(target), false);
});

// LP-B3: headless Linux, WSL and containers have no systemd user manager
// and no desktop that reads XDG autostart files, so nothing would start the
// proxy after a reboot: registration is refused (hooks mode), and an XDG
// file left behind does not count.
test('without systemd or a desktop session there is no login item; with a desktop XDG autostart is used', () => {
  const fixture = isolated('headless');
  const target = {
    runtime: path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime'),
    config: fixture.files.config,
  };
  const noSystemd = (file) => {
    if (file === 'systemctl') {
      throw Object.assign(new Error('Failed to connect to bus'), {
        code: 'ENOENT',
      });
    }
  };
  const headless = createServiceManager({
    env: fixture.env,
    platform: 'linux',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: true,
    execute: noSystemd,
    desktop: false,
  });
  assert.throws(
    () => headless.register(target),
    (error) => error.code === 'ENOLOGINITEM',
  );
  assert.equal(headless.registeredKind(), null);
  assert.equal(headless.isRegistered(target), false);

  const withDesktop = createServiceManager({
    env: fixture.env,
    platform: 'linux',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: true,
    execute: noSystemd,
    desktop: true,
  });
  assert.equal(withDesktop.register(target).kind, 'xdg-autostart');
  assert.equal(withDesktop.isRegistered(target), true);
  // The same file seen from an SSH session (no desktop) is not a login item.
  assert.equal(headless.isRegistered(target), false);
});

// LP-B7: the login item names the stable `node` link on PATH, not the
// versioned binary behind it, and a different Node in a later session only
// re-registers it when the recorded one is gone.
test('the login item starts the stable node link, and re-registers only when that Node is gone', async () => {
  const fixture = isolated('node-path');
  const { symlinkSync, rmSync } = await import('node:fs');
  const { stableNodePath } = await import('../lib/service-manager.js');
  const bin = path.join(fixture.root, 'homebrew', 'bin');
  mkdirSync(bin, { recursive: true });
  const link = path.join(bin, 'node');
  symlinkSync(process.execPath, link);
  assert.equal(
    stableNodePath({ env: { PATH: `/nonexistent:${bin}` }, platform: 'linux' }),
    link,
  );
  assert.equal(
    stableNodePath({ env: { PATH: '/nonexistent' }, platform: 'linux' }),
    process.execPath,
  );
  const target = {
    runtime: path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime'),
    config: fixture.files.config,
  };
  for (const platform of ['linux', 'darwin', 'win32']) {
    const options = {
      env: fixture.env,
      platform,
      definitionRoot: path.join(fixture.root, `definitions-${platform}`),
      executeCommands: false,
    };
    const first = createServiceManager({ ...options, nodePath: link });
    first.register(target);
    assert.equal(first.isRegistered(target), true, platform);
    // Another session runs a different Node: the recorded one still exists.
    const other = createServiceManager({
      ...options,
      nodePath: process.execPath,
    });
    assert.equal(other.isRegistered(target), true, platform);
    rmSync(link);
    assert.equal(other.isRegistered(target), false, platform);
    symlinkSync(process.execPath, link);
  }
});
