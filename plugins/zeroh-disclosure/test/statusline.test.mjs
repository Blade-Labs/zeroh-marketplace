// SPDX-License-Identifier: AGPL-3.0-only

// The status line (rc.2): its states, counts, the unmask countdown, the
// receipt link, colour, speed, the statusLine command and its resolver, the
// first-prompt setup, turning it on and off, the guard, and uninstall.
// Isolated temporary homes for every test (see helpers.mjs).
import { PLUGIN, runHook, tempProject, withProxy } from './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  canonicalProjectPath,
  encodeProjectPath,
  grantTimeLeft,
  managedSettingsPath,
  NEVER_RAN_MS,
  pluginEnabled,
  projectKey,
  projectRootFrom,
  readJson,
  renderStatusline,
  resolveClaudeSettingsPath,
  restoreRecordPath,
  sanitizeSid,
  STATUS_FILE,
  statuslineMain,
  statuslineModel,
  uninstallMarkerPath,
  zerohHome,
} from '../lib/statusline.js';
import * as privateFs from '../lib/private-fs.js';
import * as session from '../lib/session.js';
import * as vault from '../lib/vault.js';
import * as claudeSettings from '../lib/claude-settings.js';
import * as marker from '../lib/uninstall-marker.js';
import * as sessionStatus from '../lib/session-status.js';
import {
  isOurStatusLine,
  isOutdated,
  migrateEntry,
  NOT_INSTALLED,
  PLUGIN_ROOT_FILE,
  readRecord,
  recordPluginRoot,
  removeEverywhere,
  SEGMENT_COMMAND,
  STATUSLINE_COMMAND,
  statuslineEntry,
  turnStatuslineOff,
  turnStatuslineOn,
} from '../lib/statusline-settings.js';
import {
  applyFirstRunDefaults,
  FIRST_RUN_LINES,
  marketplaceOf,
  shadowedStatusline,
} from '../lib/first-run.js';
import { settingsChangeWeakensZeroH } from '../lib/settings-guard.js';
import { managementAction, slashToCli } from '../lib/user-authority.js';
import { asUser } from './as-user.mjs';

const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const NOW = Date.parse('2026-09-27T12:00:00Z');
const ESC = '\u001b';
const BEL = '\u0007';
const OSC8 = `${ESC}]8;;`;
const SHIELD = '🛡️';

// A project, a ZeroH home and a settings file of its own; `status` is
// written as the hooks write it.
function fixture({ status = undefined, sessionId = 's1' } = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-statusline-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'zeroh');
  mkdirSync(root, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: path.join(base, 'home'),
    ZEROH_HOME: home,
    ZEROH_CLAUDE_SETTINGS: path.join(base, 'claude', 'settings.json'),
    TERM: 'xterm-256color',
  };
  const dir = path.join(
    home,
    'projects',
    encodeProjectPath(root),
    'sessions',
    sessionId,
  );
  if (status !== undefined) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, STATUS_FILE),
      typeof status === 'string' ? status : JSON.stringify(status),
    );
  }
  const input = {
    session_id: sessionId,
    workspace: { project_dir: root, current_dir: root },
  };
  return { base, root, home, env, dir, input };
}

const HEALTHY = {
  v: 1,
  phase: 'ready',
  hooks: { 'session-start': { ok_at: '2026-09-27T11:59:00Z' } },
  proxy: 'on',
  turn: 3,
  masked: 4,
  sent: 0,
};

function line(f, { env = {}, now = NOW, input = {} } = {}) {
  const model = statuslineModel({
    input: { ...f.input, ...input },
    env: { ...f.env, ...env },
    now,
  });
  return renderStatusline(model, { env: { ...f.env, ...env }, now });
}

function plain(text) {
  return text
    .replace(/\u001b\]8;;[^\u0007]*\u0007/gu, '')
    .replace(/\u001b\[[0-9;]*m/gu, '');
}

// A pid that no process has (a child that already exited).
function deadPid() {
  const child = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(String(process.pid))'],
    { encoding: 'utf8' },
  );
  return Number(child.stdout);
}

// --- states -------------------------------------------------------------------

test('protected: hooks healthy and the proxy masks typing', () => {
  const f = fixture({ status: HEALTHY });
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟢 protected · 4 masked · 0 sent`,
  );
});

test('ready is not protected yet: the proxy starts with the first prompt', () => {
  const f = fixture({ status: { ...HEALTHY, proxy: 'ready' } });
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟡 proxy starts with your first prompt · 4 masked · 0 sent`,
  );
});

test('switched to the proxy by this prompt: on from the next one', () => {
  const f = fixture({ status: { ...HEALTHY, proxy: 'not-ready' } });
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟡 proxy on from your next prompt · 4 masked · 0 sent`,
  );
});

test('files only: no proxy route, with the doctor hint', () => {
  for (const proxy of ['off', 'down', 'not-applied', 'provider', undefined]) {
    const f = fixture({ status: { ...HEALTHY, proxy } });
    assert.equal(
      plain(line(f)),
      `${SHIELD} ZeroH · 🟡 files only · /zeroh-disclosure:doctor · 4 masked · 0 sent`,
      String(proxy),
    );
  }
});

test('files only after `proxy off` points to `proxy on`, whatever the hooks last saw', () => {
  const f = fixture({ status: HEALTHY });
  const record = restoreRecordPath(f.env.ZEROH_CLAUDE_SETTINGS);
  mkdirSync(path.dirname(record), { recursive: true });
  writeFileSync(record, JSON.stringify({ version: 3, off: true }));
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟡 files only · /zeroh-disclosure:proxy on · 4 masked · 0 sent`,
  );
});

test('a proxy whose daemon is gone is "proxy down"; a live one is fine', () => {
  const f = fixture({ status: HEALTHY });
  mkdirSync(path.join(f.home, 'proxy'), { recursive: true });
  const pidFile = path.join(f.home, 'proxy', 'daemon.pid');
  writeFileSync(pidFile, JSON.stringify({ pid: deadPid() }));
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟡 proxy down · /zeroh-disclosure:doctor · 4 masked · 0 sent`,
  );
  writeFileSync(pidFile, JSON.stringify({ pid: process.pid }));
  assert.match(plain(line(f)), /🟢 protected/u);
});

test('the proxy daemon writes its pid file, and removes it when it stops', async () => {
  const p = tempProject();
  const proxy = await withProxy(p);
  const pidFile = path.join(p.home, 'proxy', 'daemon.pid');
  const pid = JSON.parse(readFileSync(pidFile, 'utf8')).pid;
  assert.ok(Number.isInteger(pid) && pid > 1);
  process.kill(pid, 0);
  await proxy.stop();
  for (let i = 0; i < 50 && existsSync(pidFile); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(existsSync(pidFile), false);
});

test('something passed unchecked this turn turns the state yellow', () => {
  const f = fixture({
    status: { ...HEALTHY, sent: 2, unchecked: { turn: 3, count: 5 } },
  });
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟡 5 not protected this turn · 4 masked · 2 sent`,
  );
  const earlier = fixture({
    status: { ...HEALTHY, unchecked: { turn: 2, count: 5 } },
  });
  assert.match(plain(line(earlier)), /🟢 protected/u);
  const odd = fixture({ status: { ...HEALTHY, masked: 'x', sent: -3 } });
  assert.match(plain(line(odd)), /0 masked · 0 sent/u);
  // Files only keeps its state and adds the count.
  const files = fixture({
    status: { ...HEALTHY, proxy: 'off', unchecked: { turn: 3, count: 1 } },
  });
  assert.match(
    plain(line(files)),
    /🟡 files only .* 0 sent · 1 not protected$/u,
  );
});

test('starting, and hooks that never ran', () => {
  const missing = fixture();
  assert.equal(plain(line(missing)), `${SHIELD} ZeroH · 🟡 starting`);
  assert.equal(
    plain(line(missing, { input: { cost: { total_duration_ms: 5_000 } } })),
    `${SHIELD} ZeroH · 🟡 starting`,
  );
  assert.equal(
    plain(
      line(missing, {
        input: { cost: { total_duration_ms: NEVER_RAN_MS + 1 } },
      }),
    ),
    `${SHIELD} ZeroH · 🔴 hooks never ran · /zeroh-disclosure:doctor`,
  );
  const starting = fixture({ status: { v: 1, phase: 'starting' } });
  assert.equal(plain(line(starting)), `${SHIELD} ZeroH · 🟡 starting`);
});

test('not protecting: each reason, and never a throw', () => {
  const cases = [
    [fixture({ status: '{not json' }), "state can't be read"],
    [fixture({ status: { v: 99 } }), "state can't be read"],
    [fixture({ status: 'null' }), "state can't be read"],
    [
      fixture({ status: { ...HEALTHY, paused: true } }),
      "vault can't be opened",
    ],
  ];
  for (const [f, reason] of cases) {
    assert.equal(
      plain(line(f)),
      `${SHIELD} ZeroH · 🔴 ${reason} · /zeroh-disclosure:doctor`,
    );
  }
  const f = fixture({ status: HEALTHY });
  f.input = { workspace: f.input.workspace };
  assert.equal(plain(line(f)), `${SHIELD} ZeroH · 🔴 no session`);
  // A ZEROH_HOME that is a file: unreadable, not a crash.
  const broken = fixture({ status: HEALTHY });
  const file = path.join(broken.base, 'file');
  writeFileSync(file, 'x');
  assert.match(
    plain(line(broken, { env: { ZEROH_HOME: path.join(file, 'home') } })),
    /🔴/u,
  );
});

test('a failing hook stays red until the same hook succeeds', () => {
  const failed = {
    ...HEALTHY,
    hooks: {
      'post-tool-use': { failed_at: '2026-09-27T11:59:30Z' },
      stop: { ok_at: '2026-09-27T11:59:50Z' },
    },
  };
  assert.equal(
    plain(line(fixture({ status: failed }))),
    `${SHIELD} ZeroH · 🔴 hooks failing · /zeroh-disclosure:doctor`,
  );
  const recovered = {
    ...failed,
    hooks: {
      ...failed.hooks,
      'post-tool-use': {
        failed_at: '2026-09-27T11:59:30Z',
        ok_at: '2026-09-27T11:59:40Z',
      },
    },
  };
  assert.match(plain(line(fixture({ status: recovered }))), /🟢 protected/u);
});

test('hooks that stopped while the transcript moves on turn it red', () => {
  const f = fixture({ status: HEALTHY });
  const heartbeat = path.join(f.dir, 'hooks.alive');
  writeFileSync(heartbeat, '');
  const transcript = path.join(f.base, 'transcript.jsonl');
  writeFileSync(transcript, '{}\n');
  const t0 = new Date('2026-09-27T11:00:00Z').getTime();
  const at = (ms) => new Date(t0 + ms);
  utimesSync(heartbeat, at(0), at(0));
  utimesSync(transcript, at(10_000), at(10_000));
  assert.match(
    plain(line(f, { input: { transcript_path: transcript } })),
    /🟢 protected/u,
  );
  utimesSync(transcript, at(60_000), at(60_000));
  assert.equal(
    plain(line(f, { input: { transcript_path: transcript } })),
    `${SHIELD} ZeroH · 🔴 hooks stopped · /zeroh-disclosure:doctor`,
  );
});

test('disabled: user, project, local and managed settings, and several ids', () => {
  const f = fixture({ status: HEALTHY });
  const write = (file, plugins) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ enabledPlugins: plugins }));
  };
  write(f.env.ZEROH_CLAUDE_SETTINGS, { 'zeroh-disclosure@zeroh': false });
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🔴 plugin disabled · enable it in /plugin`,
  );
  // The project's local settings win over the user's.
  const local = path.join(f.root, '.claude', 'settings.local.json');
  write(local, { 'zeroh-disclosure@zeroh': true });
  assert.match(plain(line(f)), /🟢 protected/u);
  // Managed settings win over everything.
  const managed = path.join(f.base, 'managed-settings.json');
  write(managed, { 'zeroh-disclosure@zeroh': false });
  assert.equal(pluginEnabled(f.root, f.env, managed), false);
  // Another id still on: enabled.
  write(managed, {
    'zeroh-disclosure@zeroh': false,
    'zeroh-disclosure@zeroh-internal': true,
  });
  assert.equal(pluginEnabled(f.root, f.env, managed), true);
  // Every id off: disabled.
  write(local, {
    'zeroh-disclosure@zeroh': false,
    'zeroh-disclosure@zeroh-internal': false,
  });
  write(managed, {});
  assert.equal(pluginEnabled(f.root, f.env, managed), false);
  assert.match(managedSettingsPath('linux'), /^\/etc\/claude-code\//u);
  assert.match(managedSettingsPath('darwin'), /ClaudeCode/u);
  assert.match(managedSettingsPath('win32', {}), /ClaudeCode/u);
});

test('uninstalled: the tombstone in ZEROH_HOME, only when it is our own file', () => {
  const f = fixture({ status: HEALTHY });
  marker.markUninstalled(f.env);
  assert.equal(uninstallMarkerPath(f.env), path.join(f.home, 'uninstalled'));
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🔴 uninstalled · remove it with /statusline`,
  );
  assert.equal(marker.isUninstalled(f.env), true);
  marker.clearUninstalled(f.env);
  assert.equal(marker.isUninstalled(f.env), false);
  // A directory or a link in its place is not a tombstone.
  mkdirSync(marker.uninstallMarkerPath(f.env));
  assert.equal(marker.isUninstalled(f.env), false);
  const g = fixture({ status: HEALTHY });
  mkdirSync(g.home, { recursive: true });
  const planted = path.join(g.base, 'planted');
  writeFileSync(planted, '{}');
  symlinkSync(planted, marker.uninstallMarkerPath(g.env));
  assert.equal(marker.isUninstalled(g.env), false);
  // Nothing in the shared temporary folder counts any more.
  assert.ok(marker.uninstallMarkerPath(g.env).startsWith(g.home));
});

test('unmask countdown: minutes, hours, the session, and nothing when expired', () => {
  assert.equal(grantTimeLeft({ expiresAt: NOW + 12 * 60_000 }, NOW), '12m');
  assert.equal(grantTimeLeft({ expiresAt: NOW + 20_000 }, NOW), '1m');
  assert.equal(grantTimeLeft({ expiresAt: NOW + 65 * 60_000 }, NOW), '1h 5m');
  assert.equal(grantTimeLeft({ expiresAt: NOW + 60 * 60_000 }, NOW), '1h');
  assert.equal(grantTimeLeft({ expiresAt: null }, NOW), 'session');
  const f = fixture({ status: HEALTHY });
  const grants = path.join(f.home, 'grants', `${projectKey(f.root)}.json`);
  mkdirSync(path.dirname(grants), { recursive: true });
  const grant = (kind, expires, sessionId = null) => ({
    kind,
    expires_at: expires === null ? null : new Date(expires).toISOString(),
    session_id: sessionId,
  });
  writeFileSync(
    grants,
    JSON.stringify({
      version: 1,
      store: {
        grants: [
          grant('EMAIL', NOW + 12 * 60_000),
          grant('PHONE', null, 's1'),
          grant('IBAN', null, 'another-session'),
          grant('CREDIT_CARD', NOW - 1000),
        ],
        receipts: [],
      },
      hmac: 'x',
    }),
  );
  assert.equal(
    plain(line(f)),
    `${SHIELD} ZeroH · 🟢 protected · 4 masked · 0 sent · unmask EMAIL 12m · unmask PHONE session`,
  );
});

test("receipt ↗ is an OSC 8 link closed with BEL, hidden in Apple's Terminal", () => {
  const f = fixture({ status: HEALTHY });
  assert.doesNotMatch(line(f), /receipt/u);
  writeFileSync(path.join(f.dir, 'receipt.html'), '<html></html>');
  const url = pathToFileURL(path.join(f.dir, 'receipt.html')).href;
  const text = line(f);
  assert.ok(
    text.endsWith(`${OSC8}${url}${BEL}receipt ↗${OSC8}${BEL}`),
    JSON.stringify(text),
  );
  assert.ok(line(f, { env: { NO_COLOR: '1' } }).includes(OSC8));
  assert.match(plain(text), / · receipt ↗$/u);
  const apple = line(f, { env: { TERM_PROGRAM: 'Apple_Terminal' } });
  assert.doesNotMatch(apple, /receipt|\u001b\]8/u);
});

test('colour follows NO_COLOR and TERM=dumb; the dots stay', () => {
  const f = fixture({ status: HEALTHY });
  assert.ok(line(f).includes(`${ESC}[32mprotected${ESC}[0m`));
  for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }]) {
    const text = line(f, { env });
    assert.doesNotMatch(text, /\u001b\[/u, JSON.stringify(env));
    assert.match(text, /🟢 protected/u);
  }
  assert.ok(line(fixture({ status: 'null' })).includes(`${ESC}[31m`));
  assert.ok(
    line(fixture({ status: { ...HEALTHY, proxy: 'off' } })).includes(
      `${ESC}[33mfiles only${ESC}[0m`,
    ),
  );
});

test('never prints a value, a token or a host from the status file', () => {
  const f = fixture({
    status: {
      ...HEALTHY,
      proxy: '[API_KEY-d5ccf8]',
      hooks: { 'api.stripe.com': { failed_at: 'x' } },
      masked: '[API_KEY-d5ccf8]',
    },
  });
  assert.doesNotMatch(line(f), /API_KEY|stripe/u);
});

test('segment (positional, or --segment) prints only the segment, without a line end', async () => {
  const f = fixture({ status: HEALTHY });
  const run = async (argv) => {
    let out = '';
    await statuslineMain(argv, {
      stdin: null,
      stdout: { write: (chunk) => (out += chunk) },
      env: f.env,
      now: NOW,
    });
    return out;
  };
  const args = ['--session', 's1', '--cwd', f.root];
  const full = await run(args);
  assert.ok(full.endsWith('\n'));
  assert.equal(await run([...args, 'segment']), full.slice(0, -1));
  assert.equal(await run([...args, '--segment']), full.slice(0, -1));
  assert.equal(JSON.parse(await run([...args, '--json'])).state, 'protected');
});

test('a read retries once when the file is busy', () => {
  let calls = 0;
  const busy = () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return '{"ok":true}';
  };
  assert.deepEqual(readJson('/x', busy).value, { ok: true });
  assert.equal(calls, 2);
  let perm = 0;
  const locked = () => {
    perm += 1;
    throw Object.assign(new Error('perm'), { code: 'EPERM' });
  };
  assert.equal(readJson('/x', locked).value, null);
  assert.equal(perm, 2);
});

test('the status line reads and renders within 30 ms, and loads only Node built-ins', async () => {
  const f = fixture({
    status: { ...HEALTHY, unchecked: { turn: 3, count: 1 } },
  });
  writeFileSync(path.join(f.dir, 'receipt.html'), '<html></html>');
  const timings = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = performance.now();
    await statuslineMain([], {
      stdin: {
        isTTY: false,
        async *[Symbol.asyncIterator]() {
          yield JSON.stringify(f.input);
        },
      },
      stdout: { write() {} },
      env: f.env,
    });
    timings.push(performance.now() - started);
  }
  assert.ok(
    Math.min(...timings) < 30,
    `status line took ${timings.map((t) => t.toFixed(1)).join(', ')} ms`,
  );
  const source = readFileSync(
    path.join(PLUGIN, 'lib', 'statusline.js'),
    'utf8',
  );
  const imports = [...source.matchAll(/^import[^;]*?from '([^']+)';/gmu)].map(
    ([, from]) => from,
  );
  assert.ok(imports.length > 0);
  for (const from of imports) assert.match(from, /^node:/u, from);
  assert.doesNotMatch(source, /\bimport\(/u);
});

test('the built-in copies match the modules they copy', () => {
  const env = { ...process.env, ZEROH_HOME: '/tmp/zeroh-copy-check' };
  assert.equal(zerohHome(env), privateFs.zerohHome(env));
  const noHome = { HOME: process.env.HOME, LOCALAPPDATA: 'C:\\Users\\a\\L' };
  assert.equal(zerohHome(noHome), privateFs.zerohHome(noHome));
  assert.equal(
    zerohHome(noHome, 'win32'),
    privateFs.zerohHome(noHome, os.homedir, 'win32'),
  );
  for (const root of ['/tmp/a b/c', `/tmp/${'x'.repeat(260)}`, '/']) {
    assert.equal(encodeProjectPath(root), session.encodeProjectPath(root));
    assert.equal(projectKey(root), vault.projectKey(root));
    assert.equal(
      canonicalProjectPath(root),
      privateFs.canonicalProjectPath(root),
    );
  }
  for (const sid of ['s1', '../../etc', 'a'.repeat(100)]) {
    assert.equal(sanitizeSid(sid), session.sanitizeSid(sid));
  }
  for (const settingsEnv of [
    { ZEROH_CLAUDE_SETTINGS: '/tmp/s.json' },
    { CLAUDE_CONFIG_DIR: '/tmp/cfg' },
    { HOME: '/tmp/h' },
  ]) {
    assert.equal(
      resolveClaudeSettingsPath(settingsEnv),
      claudeSettings.resolveClaudeSettingsPath({ env: settingsEnv }),
    );
  }
  assert.equal(
    restoreRecordPath('/tmp/x/settings.json'),
    claudeSettings.restoreRecordPath('/tmp/x/settings.json'),
  );
  assert.equal(uninstallMarkerPath(env), marker.uninstallMarkerPath(env));
  assert.equal(STATUS_FILE, sessionStatus.STATUS_FILE);
  const f = fixture();
  const sub = path.join(f.root, 'src', 'deep');
  mkdirSync(sub, { recursive: true });
  mkdirSync(path.join(f.home, 'projects', encodeProjectPath(f.root)), {
    recursive: true,
  });
  assert.equal(projectRootFrom(sub, f.env), f.root);
  assert.equal(
    projectRootFrom(sub, f.env),
    session.projectRootFromEnv(sub, { ...f.env, CLAUDE_PROJECT_DIR: '' }),
  );
});

// --- the hooks keep status.json -----------------------------------------------

function statusFile(project, sessionId) {
  return sessionStatus.sessionStatusPath(project.dir, sessionId, {
    ...process.env,
    ZEROH_HOME: project.home,
  });
}

test('the hooks write status.json: SessionStart, a prompt, a pass, Stop', () => {
  const project = tempProject();
  const sessionId = 'status-hooks';
  const start = runHook(
    'session-start',
    { session_id: sessionId, source: 'startup' },
    { project },
  );
  assert.equal(start.code, 0, start.stderr);
  const file = statusFile(project, sessionId);
  const afterStart = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(afterStart.v, 1);
  assert.equal(afterStart.phase, 'ready');
  assert.equal(afterStart.paused, false);
  assert.equal(
    afterStart.writer_version,
    JSON.parse(readFileSync(path.join(PLUGIN, 'package.json'), 'utf8')).version,
  );
  assert.ok(afterStart.hooks['session-start'].ok_at);
  assert.ok(existsSync(path.join(path.dirname(file), 'hooks.alive')));
  assert.notEqual(afterStart.proxy, 'on');

  const prompt = runHook(
    'user-prompt-submit',
    { session_id: sessionId, prompt: 'Summarise the README please' },
    { project },
  );
  assert.equal(prompt.code, 0, prompt.stderr);
  const afterPrompt = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(afterPrompt.turn, 1);
  assert.equal(afterPrompt.proxy, 'off');
  assert.ok(afterPrompt.hooks['user-prompt-submit'].ok_at);

  runHook(
    'post-tool-use',
    {
      session_id: sessionId,
      tool_name: 'Read',
      tool_input: { file_path: path.join(project.dir, '.env') },
      tool_response: {
        type: 'text',
        file: {
          filePath: path.join(project.dir, '.env'),
          content: readFileSync(path.join(project.dir, '.env'), 'utf8'),
        },
      },
    },
    { project },
  );
  const stop = runHook('stop', { session_id: sessionId }, { project });
  assert.equal(stop.code, 0, stop.stderr);
  const afterStop = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(afterStop.masked >= 1, JSON.stringify(afterStop));
  assert.equal(afterStop.sent ?? 0, 0);

  const rendered = spawnSync(process.execPath, [CLI, 'statusline'], {
    input: JSON.stringify({
      session_id: sessionId,
      workspace: { project_dir: project.dir, current_dir: project.dir },
    }),
    env: {
      PATH: process.env.PATH,
      HOME: project.home,
      ZEROH_HOME: project.home,
      ZEROH_CLAUDE_SETTINGS: project.settings,
      NO_COLOR: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(
    rendered.stdout,
    new RegExp(
      `^${SHIELD} ZeroH · 🟡 files only · /zeroh-disclosure:doctor · ${afterStop.masked} masked · 0 sent · .*receipt ↗`,
      'u',
    ),
  );
  assert.ok(!rendered.stdout.includes('sk_live'));
});

test('a hook that crashes is red until that same hook succeeds', () => {
  const project = tempProject();
  const sessionId = 'status-crash';
  runHook('session-start', { session_id: sessionId }, { project });
  const copy = mkdtempSync(path.join(os.tmpdir(), 'zeroh-broken-plugin-'));
  cpSync(PLUGIN, copy, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });
  writeFileSync(
    path.join(copy, 'hooks', 'post-tool-use.js'),
    'throw new Error("boom");\n',
  );
  const bash = {
    session_id: sessionId,
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    tool_response: { stdout: 'a', stderr: '', interrupted: false },
  };
  const crashed = runHook('post-tool-use', bash, { project, pluginDir: copy });
  assert.equal(crashed.code, 0, crashed.stderr);
  const env = {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    NO_COLOR: '1',
  };
  const input = {
    session_id: sessionId,
    workspace: { project_dir: project.dir },
  };
  const now = () => renderStatusline(statuslineModel({ input, env }), { env });
  assert.match(now(), /🔴 hooks failing/u);
  // Another hook's success doesn't clear it.
  runHook(
    'user-prompt-submit',
    { session_id: sessionId, prompt: 'hello there' },
    { project },
  );
  assert.match(now(), /🔴 hooks failing/u);
  // The same hook working again does.
  runHook('post-tool-use', bash, { project });
  assert.match(now(), /🟡 files only/u);
});

// --- the statusLine command and its resolver -------------------------------------

function settingsFixture(initial = undefined) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-statusline-set-'));
  const settingsPath = path.join(base, 'claude', 'settings.json');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (initial !== undefined) {
    writeFileSync(settingsPath, `${JSON.stringify(initial, null, 2)}\n`);
  }
  return { base, settingsPath, home: path.join(base, 'zeroh') };
}

const readSettings = (file) => JSON.parse(readFileSync(file, 'utf8'));

// The command as Claude Code runs it: through a shell, with the event JSON
// on stdin.
function runCommand(command, env, input = {}) {
  return spawnSync('bash', ['-c', command], {
    input: JSON.stringify(input),
    env: { PATH: process.env.PATH, NO_COLOR: '1', ...env },
    encoding: 'utf8',
  });
}

// A home with a Claude config dir and a ZeroH home of its own.
function resolverHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-resolver-'));
  const config = path.join(home, '.claude');
  mkdirSync(path.join(config, 'plugins'), { recursive: true });
  return {
    home,
    config,
    // The default ZeroH home: %LOCALAPPDATA%\ZeroH on Windows (here with
    // no LOCALAPPDATA, under the home), ~/.zeroh elsewhere.
    zeroh:
      process.platform === 'win32'
        ? path.join(home, 'AppData', 'Local', 'ZeroH')
        : path.join(home, '.zeroh'),
    // Node's home is USERPROFILE on Windows, HOME elsewhere.
    env: { HOME: home, USERPROFILE: home },
  };
}

function listInstalled(r, installPath) {
  writeFileSync(
    path.join(r.config, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'zeroh-disclosure@zeroh': [{ scope: 'user', installPath }],
      },
    }),
  );
}

// A plugin copy whose status line prints `marker` (a stand-in for code the
// resolver must not run).
function fakePlugin(dir, text) {
  mkdirSync(path.join(dir, 'lib'), { recursive: true });
  writeFileSync(
    path.join(dir, 'lib', 'statusline.js'),
    `export async function statuslineMain() { process.stdout.write(${JSON.stringify(text)}); }\n`,
  );
  return dir;
}

test('the command with no plugin to run: not installed, and nothing as a segment', () => {
  const r = resolverHome();
  const full = runCommand(STATUSLINE_COMMAND, r.env);
  assert.equal(full.status, 0, full.stderr);
  assert.equal(full.stdout, NOT_INSTALLED);
  assert.equal(full.stderr, '');
  assert.equal(runCommand(SEGMENT_COMMAND, r.env).stdout, '');
});

test('the command runs only a plugin root Claude Code lists or its cache holds', () => {
  const r = resolverHome();
  const input = { session_id: 's1', workspace: { project_dir: r.home } };
  // Listed as installed: runs.
  listInstalled(r, PLUGIN);
  assert.match(
    runCommand(STATUSLINE_COMMAND, r.env, input).stdout,
    /🟡 starting/u,
  );
  // A recorded root that is neither listed nor in the cache is ignored.
  const planted = fakePlugin(path.join(r.home, 'planted'), 'PLANTED');
  recordPluginRoot(r.zeroh, planted, r.env);
  assert.doesNotMatch(
    runCommand(STATUSLINE_COMMAND, r.env, input).stdout,
    /PLANTED/u,
  );
  // ...unless the developer opts in (a --plugin-dir checkout).
  assert.equal(
    runCommand(
      STATUSLINE_COMMAND,
      { ...r.env, ZEROH_STATUSLINE_DEV: '1' },
      input,
    ).stdout,
    'PLANTED',
  );
  // A root in Claude Code's plugin cache is trusted, and preferred.
  const cached = fakePlugin(
    path.join(
      r.config,
      'plugins',
      'cache',
      'zeroh',
      'zeroh-disclosure',
      '9.9.9',
    ),
    'CACHED',
  );
  recordPluginRoot(r.zeroh, cached, r.env);
  assert.equal(runCommand(STATUSLINE_COMMAND, r.env, input).stdout, 'CACHED');
  // CLAUDE_CODE_PLUGIN_CACHE_DIR moves the cache.
  const elsewhere = path.join(r.home, 'cache');
  const moved = fakePlugin(
    path.join(elsewhere, 'zeroh', 'zeroh-disclosure', '9.9.9'),
    'MOVED',
  );
  recordPluginRoot(r.zeroh, moved, r.env);
  assert.doesNotMatch(
    runCommand(STATUSLINE_COMMAND, r.env, input).stdout,
    /MOVED/u,
  );
  assert.equal(
    runCommand(
      STATUSLINE_COMMAND,
      { ...r.env, CLAUDE_CODE_PLUGIN_CACHE_DIR: elsewhere },
      input,
    ).stdout,
    'MOVED',
  );
  // The pointer is kept per Claude config dir.
  const other = path.join(r.home, 'other-config');
  mkdirSync(path.join(other, 'plugins'), { recursive: true });
  assert.equal(
    runCommand(
      STATUSLINE_COMMAND,
      { ...r.env, CLAUDE_CONFIG_DIR: other },
      input,
    ).stdout,
    NOT_INSTALLED,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(r.zeroh, PLUGIN_ROOT_FILE), 'utf8')).v,
    2,
  );
});

test('the command is the same text for every shell Claude Code uses', () => {
  const script = STATUSLINE_COMMAND.slice('node -e "'.length, -1);
  assert.ok(
    STATUSLINE_COMMAND.startsWith('node -e "') &&
      STATUSLINE_COMMAND.endsWith('"'),
  );
  assert.doesNotMatch(script, /[$`"]/u);
  assert.doesNotMatch(
    script.replace(/\\u(?:\{[0-9A-F]+\}|[0-9a-f]{4})/gu, ''),
    /\\/u,
  );
  assert.doesNotMatch(STATUSLINE_COMMAND, /[^\x20-\x7e]/u, 'ASCII only');
  assert.equal(SEGMENT_COMMAND, `${STATUSLINE_COMMAND} segment`);
  const r = resolverHome();
  const shells = [['pwsh', ['-NoProfile', '-Command']]];
  // Windows PowerShell 5.1, where Claude Code falls back without Git Bash.
  if (process.platform === 'win32') {
    shells.push(['powershell', ['-NoProfile', '-Command']]);
  }
  for (const [shell, args] of shells) {
    const run = spawnSync(shell, [...args, STATUSLINE_COMMAND], {
      input: '{}',
      env: {
        PATH: process.env.PATH,
        HOME: r.home,
        USERPROFILE: r.home,
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        // PowerShell finds node.exe through PATHEXT.
        ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
      },
      encoding: 'utf8',
    });
    if (run.error?.code === 'ENOENT') continue;
    assert.equal(run.stdout, NOT_INSTALLED, `${shell}: ${run.stderr}`);
  }
});

test('the README shows the exact statusLine entry and the segment command', () => {
  const readme = readFileSync(path.join(PLUGIN, 'README.md'), 'utf8');
  assert.ok(
    readme.includes(JSON.stringify({ statusLine: statuslineEntry() }, null, 2)),
    'README "Status line" has the entry ZeroH writes',
  );
  assert.ok(readme.includes(SEGMENT_COMMAND));
});

// --- recognising, turning on and off ------------------------------------------------

test("which statusLine entries are ZeroH's, and which are an older form", () => {
  assert.ok(isOurStatusLine(statuslineEntry()));
  assert.ok(!isOutdated(statuslineEntry()));
  assert.ok(
    isOurStatusLine({ type: 'command', command: ` ${STATUSLINE_COMMAND}\n` }),
  );
  const older = [
    {
      type: 'command',
      command: 'node "/home/u/.zeroh/zeroh-statusline.mjs"',
      padding: 0,
    },
    {
      type: 'command',
      command: 'node "/p/zeroh-disclosure/bin/zeroh-disclosure.mjs" statusline',
    },
    { ...statuslineEntry(), refreshInterval: 5 },
  ];
  for (const entry of older) {
    assert.ok(isOurStatusLine(entry), entry.command);
    assert.ok(isOutdated(entry), entry.command);
  }
  for (const theirs of [
    { command: '~/.claude/my-line.sh' },
    { command: SEGMENT_COMMAND },
    { command: `${STATUSLINE_COMMAND} -- --segment` },
    { command: 'node "/home/u/.zeroh/zeroh-statusline.mjs" --segment' },
    null,
    { type: 'command' },
  ]) {
    assert.ok(!isOurStatusLine(theirs), JSON.stringify(theirs));
  }
});

test('on writes the entry and records it; off removes only it and records the choice', () => {
  const s = settingsFixture({ model: 'haiku', env: { A: '1' } });
  assert.equal(turnStatuslineOn({ ...s, pluginRoot: PLUGIN }).result, 'on');
  const written = readSettings(s.settingsPath);
  assert.deepEqual(written.statusLine, statuslineEntry());
  assert.equal(written.model, 'haiku');
  assert.deepEqual(readRecord(s.home).paths, [path.resolve(s.settingsPath)]);
  assert.equal(
    turnStatuslineOn({ ...s, pluginRoot: PLUGIN }).result,
    'already',
  );
  assert.equal(turnStatuslineOff(s).result, 'off');
  assert.deepEqual(readSettings(s.settingsPath), {
    model: 'haiku',
    env: { A: '1' },
  });
  assert.equal(
    readRecord(s.home).choices[path.resolve(s.settingsPath)].choice,
    'off',
  );
  assert.equal(turnStatuslineOff(s).result, 'none');
  assert.equal(
    turnStatuslineOff({ settingsPath: path.join(s.base, 'none.json') }).result,
    'none',
  );
});

test("on never replaces the user's own status line, and off leaves it", () => {
  const theirs = { type: 'command', command: '~/.claude/my-line.sh' };
  const s = settingsFixture({ statusLine: theirs });
  const on = turnStatuslineOn({ ...s, pluginRoot: PLUGIN });
  assert.equal(on.result, 'theirs');
  assert.equal(on.segment, SEGMENT_COMMAND);
  assert.deepEqual(readSettings(s.settingsPath).statusLine, theirs);
  assert.equal(turnStatuslineOff(s).result, 'theirs');
  assert.deepEqual(readSettings(s.settingsPath).statusLine, theirs);
});

test('an older form of the entry is rewritten, and removed from every recorded file', () => {
  const old = {
    type: 'command',
    command: 'node "/h/.zeroh/zeroh-statusline.mjs"',
    padding: 0,
  };
  const a = settingsFixture({ statusLine: old });
  assert.equal(migrateEntry(a.settingsPath, a.home), true);
  assert.deepEqual(readSettings(a.settingsPath).statusLine, statuslineEntry());
  assert.equal(migrateEntry(a.settingsPath, a.home), false);
  const b = path.join(a.base, 'other', 'settings.json');
  mkdirSync(path.dirname(b), { recursive: true });
  writeFileSync(b, '{}');
  turnStatuslineOn({ settingsPath: b, home: a.home });
  const mine = path.join(a.base, 'mine.json');
  writeFileSync(mine, JSON.stringify({ statusLine: { command: 'mine.sh' } }));
  const removed = removeEverywhere({ home: a.home, settingsPaths: [mine] });
  assert.deepEqual(
    removed.sort(),
    [path.resolve(a.settingsPath), path.resolve(b)].sort(),
  );
  assert.equal(readSettings(a.settingsPath).statusLine, undefined);
  assert.equal(readSettings(b).statusLine, undefined);
  assert.equal(readSettings(mine).statusLine.command, 'mine.sh');
});

// --- the first prompt sets it up ------------------------------------------------

test('the first prompt adds the status line once; a removal or an own line is respected', () => {
  const s = settingsFixture({ model: 'haiku' });
  const env = { HOME: s.base };
  const apply = (fx) =>
    applyFirstRunDefaults({ home: fx.home, settingsPath: fx.settingsPath, env })
      .lines;
  assert.deepEqual(apply(s), [FIRST_RUN_LINES.statuslineOn]);
  assert.deepEqual(readSettings(s.settingsPath).statusLine, statuslineEntry());
  assert.deepEqual(apply(s), []);
  // The user deletes it (/statusline, or by hand): never put back.
  writeFileSync(s.settingsPath, JSON.stringify({ model: 'haiku' }));
  apply(s);
  apply(s);
  assert.equal(readSettings(s.settingsPath).statusLine, undefined);
  assert.equal(
    readRecord(s.home).choices[path.resolve(s.settingsPath)].choice,
    'off',
  );
  // Their own status line: told once, left as it is.
  const t = settingsFixture({
    statusLine: { type: 'command', command: 'mine.sh' },
  });
  assert.deepEqual(apply(t), [FIRST_RUN_LINES.statuslineTheirs]);
  assert.deepEqual(apply(t), []);
  assert.equal(readSettings(t.settingsPath).statusLine.command, 'mine.sh');
  // An older form of ZeroH's entry is brought up to date, silently.
  const o = settingsFixture({
    statusLine: {
      type: 'command',
      command: 'node "/h/.zeroh/zeroh-statusline.mjs"',
    },
  });
  assert.deepEqual(apply(o), []);
  assert.deepEqual(readSettings(o.settingsPath).statusLine, statuslineEntry());
});

test('the first prompt turns auto-update on for its marketplace once, never over the user', () => {
  const s = settingsFixture({});
  const config = path.join(s.base, 'claude');
  const env = { HOME: s.base, CLAUDE_CONFIG_DIR: config };
  mkdirSync(path.join(config, 'plugins'), { recursive: true });
  writeFileSync(
    path.join(config, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      zeroh: {
        source: { source: 'github', repo: 'Blade-Labs/zeroh-marketplace' },
      },
    }),
  );
  const pluginRoot = path.join(
    config,
    'plugins',
    'cache',
    'zeroh',
    'zeroh-disclosure',
    '1.0.0',
  );
  assert.equal(marketplaceOf(pluginRoot), 'zeroh');
  assert.equal(marketplaceOf(PLUGIN, env), null);
  // Listed as installed at this path: its id.
  writeFileSync(
    path.join(config, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      plugins: {
        'zeroh-disclosure@zeroh-marketplace': [{ installPath: PLUGIN }],
      },
    }),
  );
  assert.equal(marketplaceOf(PLUGIN, env), 'zeroh-marketplace');
  // Run from its source (a directory marketplace): the marketplace whose
  // folder holds it; a --plugin-dir checkout elsewhere belongs to none.
  const market = path.join(s.base, 'market');
  const known = JSON.parse(
    readFileSync(
      path.join(config, 'plugins', 'known_marketplaces.json'),
      'utf8',
    ),
  );
  writeFileSync(
    path.join(config, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      ...known,
      'zeroh-marketplace': { source: { source: 'directory', path: market } },
    }),
  );
  assert.equal(
    marketplaceOf(path.join(market, 'plugins', 'zeroh-disclosure'), env),
    'zeroh-marketplace',
  );
  assert.equal(marketplaceOf(path.join(s.base, 'checkout'), env), null);
  const apply = (fx) =>
    applyFirstRunDefaults({
      home: fx.home,
      settingsPath: fx.settingsPath,
      env,
      pluginRoot,
    }).lines;
  assert.ok(apply(s).includes(FIRST_RUN_LINES.autoUpdate('zeroh')));
  assert.deepEqual(readSettings(s.settingsPath).extraKnownMarketplaces, {
    zeroh: {
      source: { source: 'github', repo: 'Blade-Labs/zeroh-marketplace' },
      autoUpdate: true,
    },
  });
  // The user turns it off: never turned on again.
  const doc = readSettings(s.settingsPath);
  doc.extraKnownMarketplaces.zeroh.autoUpdate = false;
  writeFileSync(s.settingsPath, JSON.stringify(doc));
  assert.deepEqual(apply(s), []);
  assert.equal(
    readSettings(s.settingsPath).extraKnownMarketplaces.zeroh.autoUpdate,
    false,
  );
  // A user who already chose, on a fresh home: left alone.
  const u = settingsFixture({
    extraKnownMarketplaces: {
      zeroh: { source: { source: 'github', repo: 'x/y' }, autoUpdate: false },
    },
  });
  assert.ok(!apply(u).some((l) => /Auto-update/u.test(l)));
});

test('the first prompt of a session shows the lines above it', () => {
  const project = tempProject({ firstRun: true });
  runHook('session-start', { session_id: 'fr' }, { project });
  const first = runHook(
    'user-prompt-submit',
    { session_id: 'fr', prompt: 'hello there' },
    { project },
  );
  assert.equal(first.code, 0, first.stderr);
  assert.match(
    first.json?.systemMessage ?? '',
    /Status line on · \/zeroh-disclosure:settings statusline off to remove/u,
  );
  assert.deepEqual(
    readSettings(project.settings).statusLine,
    statuslineEntry(),
  );
  const second = runHook(
    'user-prompt-submit',
    { session_id: 'fr', prompt: 'and again' },
    { project },
  );
  assert.doesNotMatch(second.json?.systemMessage ?? '', /Status line/u);
});

test("SessionStart says when a project or managed file shadows ZeroH's status line", () => {
  const s = settingsFixture({ statusLine: statuslineEntry() });
  const root = path.join(s.base, 'repo');
  mkdirSync(path.join(root, '.claude'), { recursive: true });
  assert.equal(
    shadowedStatusline({ root, settingsPath: s.settingsPath }),
    null,
  );
  writeFileSync(
    path.join(root, '.claude', 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'team.sh' } }),
  );
  assert.equal(
    shadowedStatusline({ root, settingsPath: s.settingsPath }),
    FIRST_RUN_LINES.shadowed(path.join('.claude', 'settings.json')),
  );
  const managed = path.join(s.base, 'managed-settings.json');
  writeFileSync(managed, JSON.stringify({ statusLine: { command: 'org.sh' } }));
  assert.equal(
    shadowedStatusline({
      root,
      settingsPath: s.settingsPath,
      managedPath: managed,
    }),
    FIRST_RUN_LINES.shadowed(managed),
  );
});

// --- the user's authority, the guard, uninstall --------------------------------------

test("statusline on|off is the user's: the CLI needs the user, the slash command maps to it", () => {
  assert.match(managementAction(['statusline', 'on']), /status line on/u);
  assert.match(managementAction(['statusline', 'off']), /status line off/u);
  assert.equal(managementAction(['statusline']), null);
  assert.equal(managementAction(['statusline', 'segment']), null);
  assert.deepEqual(slashToCli('settings', ['statusline', 'on']), [
    'statusline',
    'on',
  ]);
  const s = settingsFixture({ model: 'haiku' });
  const env = {
    PATH: process.env.PATH,
    HOME: s.base,
    ZEROH_HOME: s.home,
    ZEROH_CLAUDE_SETTINGS: s.settingsPath,
    CLAUDE_CODE_SESSION_ID: 'model-session',
  };
  mkdirSync(s.home, { recursive: true });
  const cli = (args, childEnv) =>
    spawnSync(process.execPath, [CLI, ...args], {
      cwd: s.base,
      env: childEnv,
      encoding: 'utf8',
    });
  const refused = cli(['statusline', 'on'], env);
  assert.equal(refused.status, 0, refused.stderr);
  assert.deepEqual(readSettings(s.settingsPath), { model: 'haiku' });
  assert.match(
    cli(['statusline', 'on'], asUser(['statusline', 'on'], env)).stdout,
    /Status line on/u,
  );
  assert.equal(
    readSettings(s.settingsPath).statusLine.command,
    STATUSLINE_COMMAND,
  );
  assert.match(
    cli(['statusline', 'off'], asUser(['statusline', 'off'], env)).stdout,
    /Status line off/u,
  );
  assert.deepEqual(readSettings(s.settingsPath), { model: 'haiku' });
  writeFileSync(
    s.settingsPath,
    JSON.stringify({ statusLine: { type: 'command', command: 'mine.sh' } }),
  );
  const theirs = cli(['statusline', 'on'], asUser(['statusline', 'on'], env));
  assert.match(theirs.stdout, /left it as it is/u);
  assert.match(theirs.stdout, / segment\)/u);
  assert.equal(readSettings(s.settingsPath).statusLine.command, 'mine.sh');
});

test('the settings command lists and passes statusline', () => {
  const s = settingsFixture();
  const script = path.join(PLUGIN, 'commands', 'scripts', 'settings.js');
  const env = {
    PATH: process.env.PATH,
    HOME: s.base,
    ZEROH_HOME: s.home,
    ZEROH_CLAUDE_SETTINGS: s.settingsPath,
    CLAUDE_PROJECT_DIR: s.base,
  };
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: s.base,
      env: asUser(args, env),
      encoding: 'utf8',
    });
  assert.match(run().stdout, /^Status line: off/mu);
  assert.match(run('statusline', 'on').stdout, /Status line on/u);
  assert.match(run().stdout, /^Status line: on/mu);
});

test('a model edit that adds, changes or removes any statusLine weakens ZeroH', () => {
  const ours = statuslineEntry();
  const mine = { type: 'command', command: 'mine.sh' };
  for (const [before, after] of [
    [{ statusLine: ours }, {}],
    [{ statusLine: ours }, { statusLine: mine }],
    [{}, { statusLine: mine }],
    [{ statusLine: mine }, { statusLine: { ...mine, padding: 2 } }],
    [{ statusLine: mine }, {}],
  ]) {
    assert.equal(
      settingsChangeWeakensZeroH(before, after),
      true,
      JSON.stringify(after),
    );
  }
  assert.equal(
    settingsChangeWeakensZeroH(
      { statusLine: ours },
      { statusLine: ours, model: 'x' },
    ),
    false,
  );
});

test('a model edit to the env hooks and the status line run in weakens ZeroH', () => {
  for (const key of [
    'PATH',
    'NODE_OPTIONS',
    'HOME',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_CODE_PLUGIN_CACHE_DIR',
    'LD_PRELOAD',
    'ZEROH_STATUSLINE_DEV',
  ]) {
    assert.equal(
      settingsChangeWeakensZeroH({ env: {} }, { env: { [key]: '/tmp/x' } }),
      true,
      key,
    );
  }
  assert.equal(
    settingsChangeWeakensZeroH({ env: {} }, { env: { MY_APP_MODE: 'dev' } }),
    false,
  );
});

test("uninstall removes ZeroH's status line everywhere and leaves only the tombstone", () => {
  const project = tempProject();
  mkdirSync(path.join(project.home, 'vault'), { recursive: true });
  const settingsPath = project.settings;
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ model: 'haiku' }));
  turnStatuslineOn({ settingsPath, home: project.home, pluginRoot: PLUGIN });
  const other = path.join(project.dir, 'other-settings.json');
  writeFileSync(other, '{}');
  turnStatuslineOn({ settingsPath: other, home: project.home });
  const fakeClaude = path.join(os.tmpdir(), `fake-claude-${process.pid}.mjs`);
  writeFileSync(
    fakeClaude,
    "#!/usr/bin/env node\nif (process.argv[3] === 'list') console.log('[]');\n",
    { mode: 0o755 },
  );
  const args = ['uninstall', '--yes'];
  const env = {
    PATH: process.env.PATH,
    HOME: mkdtempSync(path.join(os.tmpdir(), 'zeroh-uninstall-user-')),
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: settingsPath,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ZEROH_CLAUDE_BIN: fakeClaude,
  };
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project.dir,
    env: asUser(args, env),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Removed ZeroH's status line from/u);
  assert.deepEqual(readSettings(settingsPath), { model: 'haiku' });
  assert.deepEqual(readSettings(other), {});
  assert.deepEqual(readdirSync(project.home), ['uninstalled']);
  assert.equal(marker.isUninstalled({ ZEROH_HOME: project.home }), true);
  marker.clearUninstalled({ ZEROH_HOME: project.home });
});
