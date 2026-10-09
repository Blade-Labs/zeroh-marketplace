// SPDX-License-Identifier: AGPL-3.0-only

import { ROOT_RESOLVER_SOURCE } from '../../lib/statusline-launcher.js';
import {
  commandNamesClaudeControl,
  controlOptions,
} from '../../packages/shell-analysis/guard/claude-control.js';
import { commitOwnedRemoval } from '../../lib/cli/uninstall-execute.js';
import { uninstallFailureNotice } from '../../packages/zeroh-disclosure-core/uninstall-handoff.js';
import { PLUGIN, runHook } from '../helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  sessionPredatesInstall,
  statuslineModel,
  readStyle,
  styleFilePath,
} from '../../lib/statusline.js';
import {
  readRecord,
  recordPluginRoot,
  removeEverywhere,
  segmentCommand,
  STATUSLINE_COMMAND,
  turnStatuslineOn,
  turnStatuslineOff,
} from '../../lib/statusline-settings.js';
import { encodeProjectPath } from '../../packages/zeroh-disclosure-core/session.js';
import { ProtectionState } from '../../packages/zeroh-disclosure-core/protection-state.js';
import {
  removeFirstRunMarketplace,
  applyFirstRunDefaults,
} from '../../lib/first-run.js';
import { writeStyle, styleKey } from '../../lib/style.js';
import { BANNER_MODES } from '../../lib/banner.js';
import {
  deniesZeroHSettings,
  isZeroHSettingsPath,
} from '../../packages/shell-analysis/settings-guard.js';
import { protectedShellDecision } from '../../packages/shell-analysis/guard/plain-safe-reads.js';

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === 'string' ? value : JSON.stringify(value),
  );
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zeroh-review-49r-'));
  const env = {
    ...process.env,
    HOME: path.join(base, 'home'),
    ZEROH_HOME: path.join(base, 'zeroh'),
    CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
    ZEROH_CLAUDE_SETTINGS: path.join(base, 'claude', 'settings.json'),
  };
  const root = path.join(base, 'project');
  fs.mkdirSync(root);
  const sessionId = 'resumed';
  const dir = path.join(
    env.ZEROH_HOME,
    'projects',
    encodeProjectPath(root),
    'sessions',
    sessionId,
  );
  const installed = Date.parse('2026-10-02T10:00:00Z');
  write(env.ZEROH_CLAUDE_SETTINGS, {
    enabledPlugins: { 'zeroh-disclosure@zeroh': true },
  });
  write(path.join(env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: {
      'zeroh-disclosure@zeroh': [
        {
          scope: 'user',
          installPath: PLUGIN,
          installedAt: new Date(installed).toISOString(),
        },
      ],
    },
  });
  write(
    path.join(env.CLAUDE_CONFIG_DIR, 'plugins', 'known_marketplaces.json'),
    { zeroh: { source: { source: 'github', repo: 'fixture/repository' } } },
  );
  return {
    base,
    env,
    root,
    dir,
    installed,
    sessionId,
    home: env.ZEROH_HOME,
    settingsPath: env.ZEROH_CLAUDE_SETTINGS,
  };
}

test('49r compaction yields to a missed prompt even without a newer heartbeat', () => {
  const f = fixture();
  write(path.join(f.dir, 'status.json'), {
    v: 1,
    phase: 'ready',
    proxy: 'off',
  });
  const heartbeat = path.join(f.dir, 'hooks.alive');
  write(heartbeat, '');
  fs.utimesSync(heartbeat, new Date(f.installed), new Date(f.installed));
  const transcript = path.join(f.base, 'transcript.jsonl');
  write(
    transcript,
    [
      {
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: new Date(f.installed + 60_000).toISOString(),
      },
      {
        type: 'user',
        message: { content: 'continue' },
        timestamp: new Date(f.installed + 120_000).toISOString(),
      },
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  fs.utimesSync(
    transcript,
    new Date(f.installed + 120_000),
    new Date(f.installed + 120_000),
  );
  assert.equal(
    statuslineModel({
      env: f.env,
      input: {
        session_id: f.sessionId,
        workspace: { project_dir: f.root },
        transcript_path: transcript,
      },
    }).state,
    ProtectionState.HOOKS_STOPPED,
  );
});

test('49r transcript head reads are bounded to 256 KB', () => {
  const f = fixture();
  const transcript = path.join(f.base, 'large.jsonl');
  write(
    transcript,
    JSON.stringify({
      timestamp: new Date(f.installed - 60_000).toISOString(),
    }) + '\n',
  );
  fs.truncateSync(transcript, 50 * 1024 * 1024);
  const originalRead = fs.readFileSync;
  const originalReadSync = fs.readSync;
  let bytes = 0;
  fs.readFileSync = (file, ...args) => {
    assert.notEqual(file, transcript, 'must not read the whole transcript');
    return originalRead(file, ...args);
  };
  fs.readSync = (fd, buffer, offset, length, position) => {
    bytes += length;
    return originalReadSync(fd, buffer, offset, length, position);
  };
  syncBuiltinESMExports();
  try {
    assert.equal(
      sessionPredatesInstall({
        root: f.root,
        env: f.env,
        transcriptPath: transcript,
      }),
      true,
    );
    assert.ok(bytes > 0 && bytes <= 256 * 1024, `bounded head bytes: ${bytes}`);
  } finally {
    fs.readFileSync = originalRead;
    fs.readSync = originalReadSync;
    syncBuiltinESMExports();
  }
});

test('49r resumed sessions use their own SessionStart on all shared status paths', () => {
  const f = fixture();
  const transcript = path.join(f.base, 'old.jsonl');
  write(
    transcript,
    JSON.stringify({
      timestamp: new Date(f.installed - 86_400_000).toISOString(),
    }) + '\n',
  );
  f.env.CLAUDE_TRANSCRIPT_PATH = transcript;
  write(path.join(f.dir, 'status.json'), {
    v: 1,
    phase: 'ready',
    proxy: 'off',
    hooks: {
      'session-start': { ok_at: new Date(f.installed + 60_000).toISOString() },
    },
  });
  const input = {
    session_id: f.sessionId,
    workspace: { project_dir: f.root },
    transcript_path: transcript,
    cost: { total_duration_ms: 86_400_000 },
  };
  assert.notEqual(
    statuslineModel({ env: f.env, input, now: f.installed + 120_000 }).state,
    ProtectionState.STARTED_BEFORE_ZEROH,
  );
  assert.equal(
    sessionPredatesInstall({
      root: f.root,
      sessionId: f.sessionId,
      env: f.env,
    }),
    false,
  );
  fs.rmSync(path.join(f.dir, 'status.json'));
  assert.equal(
    sessionPredatesInstall({
      root: f.root,
      sessionId: f.sessionId,
      env: f.env,
    }),
    true,
  );
});

for (const action of ['observe', 'off', 'uninstall']) {
  test(`49r obsolete restore data is cleared on ${action}`, () => {
    const f = fixture();
    turnStatuslineOn(f);
    assert.equal(Object.keys(readRecord(f.home).restore).length, 1);
    write(f.settingsPath, { model: 'user-choice' });
    if (action === 'observe') recordPluginRoot(f.home, PLUGIN, f.env);
    if (action === 'off') turnStatuslineOff(f);
    if (action === 'uninstall') removeEverywhere({ home: f.home });
    const raw = JSON.parse(
      fs.readFileSync(path.join(f.home, 'statusline.json'), 'utf8'),
    );
    assert.deepEqual(raw.restore, {});
    assert.equal(
      JSON.parse(fs.readFileSync(f.settingsPath)).model,
      'user-choice',
    );
  });
}

test('49r restore stores an after digest instead of a second settings copy', () => {
  const f = fixture();
  turnStatuslineOn(f);
  const snapshot = readRecord(f.home).restore[path.resolve(f.settingsPath)];
  assert.equal(snapshot.after, undefined);
  assert.equal(typeof snapshot.afterHash, 'string');
  assert.equal(turnStatuslineOff(f).result, 'off');
});

test('49r first-run keeps beforeCompare after a marketplace write', () => {
  const f = fixture();
  const pluginRoot = path.join(
    f.env.CLAUDE_CONFIG_DIR,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    '1.1.0',
  );
  let calls = 0;
  applyFirstRunDefaults({
    ...f,
    pluginRoot,
    settingsWriteOptions: {
      beforeCompare() {
        calls += 1;
        if (calls !== 2) return;
        const document = JSON.parse(fs.readFileSync(f.settingsPath));
        document.theme = 'concurrent';
        write(f.settingsPath, document);
      },
    },
  });
  assert.ok(calls >= 2, 'both writes must retain the guard');
  assert.equal(JSON.parse(fs.readFileSync(f.settingsPath)).theme, 'concurrent');
});

test('49r presentation exception excludes only the CLI path from protected names', () => {
  const f = fixture();
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  const options = {
    env: f.env,
    home: f.home,
    settingsPath: f.settingsPath,
    mode: 'block',
    presentationCliPath: cli,
  };
  const command = `node "${cli}" style separator "prefixmanaged-settings.jsonsuffix"`;
  const opts = controlOptions(f.root, options);
  assert.equal(
    commandNamesClaudeControl(
      `node "${cli}" style emoji false`,
      f.root,
      opts,
      cli,
    ),
    false,
  );
  assert.equal(commandNamesClaudeControl(command, f.root, opts, cli), true);
  assert.equal(
    protectedShellDecision('Bash', { command }, f.root, options).deny,
    true,
  );
  assert.equal(
    deniesZeroHSettings('Bash', { command }, f.root, {
      ...options,
      styleKey,
      bannerModes: BANNER_MODES,
    }),
    true,
  );
  assert.equal(
    deniesZeroHSettings(
      'Bash',
      { command: `node "${cli}" style emoji false` },
      f.root,
      { ...options, styleKey, bannerModes: BANNER_MODES },
    ),
    false,
  );
});

test('49r presentation migrates the old file and writes only the new name', () => {
  const f = fixture();
  const old = path.join(f.home, 'statusline-style.json');
  write(old, { version: 1, emoji: false, receiptFormat: 'html' });
  assert.equal(readStyle(f.env).emoji, false);
  assert.equal(styleFilePath(f.env), path.join(f.home, 'presentation.json'));
  assert.equal(fs.existsSync(old), false);
  writeStyle('reportFormat', 'json', f.env);
  assert.equal(readStyle(f.env).receiptFormat, 'html');
  assert.equal(readStyle(f.env).reportFormat, 'json');
  assert.equal(fs.existsSync(old), false);
});

test('49r the new presentation file has the same plain-file guard exception', () => {
  const f = fixture();
  for (const name of ['statusline-style.json', 'presentation.json']) {
    assert.equal(
      isZeroHSettingsPath(path.join(f.home, name), f.root, { home: f.home }),
      false,
      name,
    );
  }
});

test('49r missing segment and own entry give their respective removal remedy', () => {
  const f = fixture();
  fs.rmSync(path.join(f.env.CLAUDE_CONFIG_DIR, 'plugins'), { recursive: true });
  recordPluginRoot(f.home, PLUGIN, f.env);
  const segment = spawnSync(
    'bash',
    ['-c', segmentCommand(f.home, process.platform, f.env)],
    {
      env: f.env,
      encoding: 'utf8',
    },
  );
  assert.equal(segment.status, 0, segment.stderr);
  assert.match(
    segment.stdout,
    /not installed · remove ZeroH from your status line script/u,
  );
  const own = spawnSync('bash', ['-c', STATUSLINE_COMMAND], {
    env: f.env,
    encoding: 'utf8',
  });
  assert.match(own.stdout, /not installed · remove it with \/statusline/u);
});

test('49r SessionEnd deletes its cached user output and SessionStart prunes old cache', () => {
  const f = fixture();
  const p = {
    dir: f.root,
    home: f.home,
    settings: f.settingsPath,
    serviceManager: f.env.ZEROH_SERVICE_MANAGER_DIR,
  };
  const cache = path.join(p.home, 'statusline-cache');
  const sessionId = 'cache-end';
  // Create cache through the public status line, using a fixture script only.
  const command = 'printf fixture-line';
  const args = [
    '-c',
    `${STATUSLINE_COMMAND} wrap ${Buffer.from(command).toString('base64url')}`,
  ];
  const result = spawnSync('bash', args, {
    env: f.env,
    input: JSON.stringify({ session_id: sessionId }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const files = fs.readdirSync(cache);
  assert.equal(files.length, 1);
  assert.equal(
    runHook('session-end', { session_id: sessionId }, { project: p }).code,
    0,
  );
  assert.deepEqual(fs.readdirSync(cache), []);
  write(path.join(cache, 'stale.json'), {
    v: 1,
    output: 'old fixture',
    at: '2020-01-01T00:00:00Z',
  });
  fs.utimesSync(
    path.join(cache, 'stale.json'),
    new Date('2020-01-01'),
    new Date('2020-01-01'),
  );
  assert.equal(
    runHook('session-start', { session_id: 'new-cache' }, { project: p }).code,
    0,
  );
  assert.equal(fs.existsSync(path.join(cache, 'stale.json')), false);
});

for (const choice of ['off', 'replaced']) {
  test(`49r ${choice} persists across successive prompts`, () => {
    const f = fixture();
    write(f.settingsPath, { statusLine: { command: 'printf mine' } });
    applyFirstRunDefaults(f);
    if (choice === 'off') turnStatuslineOff(f);
    else
      write(f.settingsPath, { statusLine: { command: 'printf replacement' } });
    for (let prompt = 0; prompt < 4; prompt += 1) applyFirstRunDefaults(f);
    assert.equal(
      readRecord(f.home).choices[path.resolve(f.settingsPath)].choice,
      choice,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(f.settingsPath)).statusLine.command,
      choice === 'off' ? 'printf mine' : 'printf replacement',
    );
  });
}

test('49r compact SessionStart recovery makes a missed main-thread tool result red', () => {
  const f = fixture();
  write(path.join(f.dir, 'status.json'), {
    v: 1,
    phase: 'ready',
    proxy: 'on',
    hooks: {
      'session-start': { ok_at: new Date(f.installed + 61_000).toISOString() },
    },
  });
  const heartbeat = path.join(f.dir, 'hooks.alive');
  write(heartbeat, '');
  fs.utimesSync(
    heartbeat,
    new Date(f.installed + 61_000),
    new Date(f.installed + 61_000),
  );
  const transcript = path.join(f.base, 'transcript.jsonl');
  write(
    transcript,
    [
      {
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: new Date(f.installed + 60_000).toISOString(),
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'fixture-tool', content: 'ok' },
          ],
        },
        timestamp: new Date(f.installed + 120_000).toISOString(),
      },
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  fs.utimesSync(
    transcript,
    new Date(f.installed + 120_000),
    new Date(f.installed + 120_000),
  );
  assert.equal(
    statuslineModel({
      env: f.env,
      input: {
        session_id: f.sessionId,
        workspace: { project_dir: f.root },
        transcript_path: transcript,
      },
    }).state,
    ProtectionState.HOOKS_STOPPED,
  );
});

test('49r timeout preserves captured stdout through the installed resolver on a fresh cache', () => {
  const f = fixture();
  // The resolver runs the user's command in the native shell (cmd on Windows).
  const command =
    process.platform === 'win32'
      ? 'node -e "process.stdout.write(\'my current line\');setTimeout(()=>{},6000)"'
      : "printf 'my current line'; sleep 6";
  const encoded = Buffer.from(command).toString('base64url');
  const result = spawnSync(
    'bash',
    ['-c', `${STATUSLINE_COMMAND} wrap ${encoded}`],
    {
      env: f.env,
      encoding: 'utf8',
      input: JSON.stringify({
        session_id: f.sessionId,
        workspace: { project_dir: f.root },
      }),
      timeout: 8_000,
    },
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^my current line\n/u);
});

test('49r first root observation never supplies missing installation evidence', () => {
  const f = fixture();
  write(
    path.join(f.env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'),
    {
      plugins: {
        'zeroh-disclosure@zeroh': [{ scope: 'user', installPath: PLUGIN }],
      },
    },
  );
  recordPluginRoot(f.home, PLUGIN, f.env);
  const input = {
    session_id: f.sessionId,
    workspace: { project_dir: f.root },
    cost: { total_duration_ms: 60_000 },
  };
  assert.equal(
    statuslineModel({ env: f.env, input }).state,
    ProtectionState.HOOKS_NEVER_RAN,
  );
});

test('49r uninstall restores exact bytes across marketplace and wrapping writes', () => {
  const f = fixture();
  const pluginRoot = path.join(
    f.env.CLAUDE_CONFIG_DIR,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    '1.1.0',
  );
  write(
    path.join(f.env.CLAUDE_CONFIG_DIR, 'plugins', 'known_marketplaces.json'),
    { zeroh: { source: { source: 'github', repo: 'fixture/repository' } } },
  );
  const original =
    '{"enabledPlugins":{"zeroh-disclosure@zeroh":true},"statusLine":{"command":"printf mine"}}';
  write(f.settingsPath, original);
  applyFirstRunDefaults({ ...f, pluginRoot });
  assert.ok(JSON.parse(fs.readFileSync(f.settingsPath)).extraKnownMarketplaces);
  removeFirstRunMarketplace(f);
  removeEverywhere({ home: f.home });
  assert.equal(fs.readFileSync(f.settingsPath, 'utf8'), original);
});

test('49r lost removal ownership uses the cleanup failure wording table', () => {
  const expected = uninstallFailureNotice({ cleanup_started_at: true });
  assert.throws(() => commitOwnedRemoval(() => false), { message: expected });
  assert.doesNotThrow(() => commitOwnedRemoval(() => true));
});

test('49r presentation prefers the new file and never overwrites it with legacy data', () => {
  const f = fixture();
  const old = path.join(f.home, 'statusline-style.json');
  const current = path.join(f.home, 'presentation.json');
  write(old, { version: 1, emoji: false });
  write(current, { version: 1, emoji: true });
  assert.equal(readStyle(f.env).emoji, true);
  assert.equal(JSON.parse(fs.readFileSync(current)).emoji, true);
});

test('49r external settings saves between first-run writes are preserved on uninstall', () => {
  const f = fixture();
  const pluginRoot = path.join(
    f.env.CLAUDE_CONFIG_DIR,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    '1.1.0',
  );
  write(f.settingsPath, '{"statusLine":{"command":"printf mine"}}');
  let calls = 0;
  applyFirstRunDefaults({
    ...f,
    pluginRoot,
    settingsWriteOptions: {
      beforeCompare() {
        calls += 1;
        if (calls !== 2) return;
        const document = JSON.parse(fs.readFileSync(f.settingsPath));
        document.theme = 'concurrent';
        write(f.settingsPath, document);
      },
    },
  });
  removeFirstRunMarketplace(f);
  removeEverywhere({ home: f.home });
  const restored = JSON.parse(fs.readFileSync(f.settingsPath));
  assert.equal(restored.theme, 'concurrent');
  assert.equal(restored.extraKnownMarketplaces, undefined);
});

test('49r off preserves marketplace auto-update added in the same first run', () => {
  const f = fixture();
  const pluginRoot = path.join(
    f.env.CLAUDE_CONFIG_DIR,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    '1.1.0',
  );
  applyFirstRunDefaults({ ...f, pluginRoot });
  turnStatuslineOff(f);
  const restored = JSON.parse(fs.readFileSync(f.settingsPath));
  assert.equal(restored.statusLine, undefined);
  assert.equal(restored.extraKnownMarketplaces.zeroh.autoUpdate, true);
});

test('49r unreadable replacement settings discard obsolete backup bytes', () => {
  const f = fixture();
  turnStatuslineOn(f);
  fs.rmSync(f.settingsPath);
  fs.mkdirSync(f.settingsPath);
  recordPluginRoot(f.home, PLUGIN, f.env);
  assert.deepEqual(readRecord(f.home).restore, {});
});

test('49r launcher and inline resolver embed the same trust function', () => {
  const f = fixture();
  recordPluginRoot(f.home, PLUGIN, f.env);
  const launcher = fs.readFileSync(
    path.join(f.home, 'bin', 'zeroh-statusline.mjs'),
    'utf8',
  );
  assert.ok(launcher.includes(ROOT_RESOLVER_SOURCE));
  assert.ok(STATUSLINE_COMMAND.includes(ROOT_RESOLVER_SOURCE));
});

test('49r a settings save after the marketplace write can remove that owned key', () => {
  const f = fixture();
  const pluginRoot = path.join(
    f.env.CLAUDE_CONFIG_DIR,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    '1.1.0',
  );
  let calls = 0;
  applyFirstRunDefaults({
    ...f,
    pluginRoot,
    settingsWriteOptions: {
      beforeCompare() {
        calls += 1;
        if (calls !== 2) return;
        const document = JSON.parse(fs.readFileSync(f.settingsPath));
        delete document.extraKnownMarketplaces;
        document.theme = 'concurrent';
        write(f.settingsPath, document);
      },
    },
  });
  const document = JSON.parse(fs.readFileSync(f.settingsPath));
  assert.equal(document.extraKnownMarketplaces, undefined);
  assert.equal(document.theme, 'concurrent');
});

test('49r timeout also preserves stdout when the plugin has been removed', () => {
  const f = fixture();
  fs.rmSync(path.join(f.env.CLAUDE_CONFIG_DIR, 'plugins'), { recursive: true });
  // The resolver runs the wrapped command through cmd on Windows.
  // A Node child prints immediately and stays alive past the 4 s deadline.
  const command = `node -e "process.stdout.write('my current line');setTimeout(()=>process.stdout.write('ZEROHFAKE natural completion'),6000)"`;
  const encoded = Buffer.from(command).toString('base64url');
  const started = performance.now();
  const result = spawnSync(
    'bash',
    ['-c', `${STATUSLINE_COMMAND} wrap ${encoded}`],
    { env: f.env, encoding: 'utf8', input: '{}', timeout: 8_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(performance.now() - started >= 3900, 'the timeout was exercised');
  assert.equal(
    result.error,
    undefined,
    'the resolver exited inside the outer timeout',
  );
  assert.doesNotMatch(
    result.stdout,
    /ZEROHFAKE natural completion/u,
    'the child was stopped before it finished',
  );
  assert.match(result.stdout, /^my current line\n/u);
  assert.match(result.stdout, /not installed/u);
});
