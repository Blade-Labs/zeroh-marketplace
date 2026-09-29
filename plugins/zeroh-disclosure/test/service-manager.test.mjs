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
  encodeWindowsTask,
  readDefinitionText,
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
    const definition = readDefinitionText(registration.definition);

    assert.match(
      definition,
      new RegExp(marker.replaceAll('[', '\\[').replaceAll(']', '\\]'), 'u'),
    );
    // A systemd unit escapes each backslash (a Windows host's paths).
    const written = (value) =>
      platform === 'linux' ? value.replaceAll('\\', '\\\\') : value;
    assert.ok(definition.includes(written(process.execPath)));
    assert.ok(
      definition.includes(
        written(path.join(runtime, 'bin', 'proxy-daemon.mjs')),
      ),
    );
    assert.ok(definition.includes(written(config)));
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

// Windows 11 re-test (1.0.0-rc.2): schtasks /Create /XML refused the UTF-8
// file ("The task XML is malformed ... unable to switch the encoding"); the
// same definition saved as UTF-16 with a byte order mark registered.
test('the Windows logon task file is UTF-16LE with a byte order mark and declares UTF-16', () => {
  const fixture = isolated('utf16');
  const calls = [];
  const manager = createServiceManager({
    env: { ...fixture.env, SystemRoot: 'C:\\WINDOWS', USERNAME: 'jörg' },
    platform: 'win32',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: true,
    execute(file, args) {
      calls.push([path.basename(file.replaceAll('\\', '/')), ...args]);
    },
  });
  const runtime = path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime');
  const target = { runtime, config: fixture.files.config };
  const registration = manager.register(target);
  const bytes = readFileSync(registration.definition);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe], 'UTF-16LE BOM');
  const text = bytes.subarray(2).toString('utf16le');
  assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-16"?>'));
  assert.equal(bytes.length, 2 + Buffer.byteLength(text, 'utf16le'));
  assert.match(text, /<UserId>jörg<\/UserId>/u);
  assertWellFormedXml(text);
  assert.equal(readDefinitionText(registration.definition), text);
  assert.deepEqual(calls[0].slice(0, 5), [
    'schtasks.exe',
    '/Create',
    '/TN',
    'ZeroH Disclosure Proxy',
    '/XML',
  ]);
  assert.equal(calls[0][5], registration.definition);
  assert.equal(manager.isRegistered(target), true);
  assert.deepEqual(
    [...encodeWindowsTask('<a/>')],
    [0xff, 0xfe, 0x3c, 0, 0x61, 0, 0x2f, 0, 0x3e, 0],
  );
});

test('a UTF-8 task file an earlier release wrote is registered again', () => {
  const fixture = isolated('utf8-task');
  const manager = createServiceManager({
    env: fixture.env,
    platform: 'win32',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: false,
  });
  const runtime = path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime');
  const target = { runtime, config: fixture.files.config };
  const registration = manager.register(target);
  const text = readDefinitionText(registration.definition).replace(
    'encoding="UTF-16"',
    'encoding="UTF-8"',
  );
  writeFileSync(registration.definition, text, 'utf8');
  assert.equal(manager.isRegistered(target), false);
});

test('a refused login item carries the tool’s first error line', () => {
  const fixture = isolated('refused-detail');
  const manager = createServiceManager({
    env: fixture.env,
    platform: 'win32',
    definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: true,
    execute() {
      const error = new Error('Command failed');
      error.status = 1;
      error.stderr = Buffer.from(
        'ERROR: The task XML is malformed.\r\n(1,40)::ERROR: unable to switch the encoding\r\n',
      );
      throw error;
    },
  });
  const runtime = path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime');
  assert.throws(
    () => manager.register({ runtime, config: fixture.files.config }),
    (error) => error.detail === 'ERROR: The task XML is malformed.',
  );
  assert.equal(existsSync(manager.paths.task), false);
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

// Uninstall, `proxy off` and doctor --fix retire the daemon: its login item
// goes, but the daemon keeps serving the sessions still open, so nothing may
// stop it on the way (no bootout, no `systemctl --now`, no task kill).
test('unregister with keepRunning removes the login item without stopping the daemon', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const fixture = isolated(`keep-${platform}`);
    const calls = [];
    const manager = createServiceManager({
      env: fixture.env,
      platform,
      definitionRoot: fixture.env.ZEROH_SERVICE_MANAGER_DIR,
      executeCommands: true,
      uid: 501,
      desktop: false,
      execute(file, args) {
        calls.push([path.basename(file), ...args].join(' '));
      },
    });
    const registration = manager.register({
      runtime: path.join(fixture.env.ZEROH_HOME, 'bin', 'runtime'),
      config: fixture.files.config,
    });
    calls.length = 0;
    const result = manager.unregister({ keepRunning: true });
    assert.equal(result.removed, true, platform);
    assert.equal(existsSync(registration.definition), false, platform);
    for (const call of calls) {
      assert.doesNotMatch(call, /bootout|--now|\/End|taskkill|stop/u, call);
    }
    if (platform === 'darwin') {
      assert.deepEqual(calls, [
        'launchctl disable gui/501/com.bladelabs.zeroh-disclosure-proxy',
      ]);
    }
    if (platform === 'linux') {
      assert.deepEqual(calls, [
        'systemctl --user disable zeroh-disclosure-proxy.service',
        'systemctl --user daemon-reload',
      ]);
    }
    if (platform === 'win32') {
      assert.equal(calls.length, 1);
      assert.match(calls[0], /schtasks\.exe \/Delete/u);
    }
  }
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
  // PATH as this system writes it (`;` and node.exe on Windows).
  const link = path.join(
    bin,
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  symlinkSync(process.execPath, link);
  const missing = path.join(fixture.root, 'nonexistent');
  assert.equal(
    stableNodePath({
      env: { PATH: [missing, bin].join(path.delimiter) },
      platform: process.platform,
    }),
    link,
  );
  assert.equal(
    stableNodePath({ env: { PATH: missing }, platform: process.platform }),
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
