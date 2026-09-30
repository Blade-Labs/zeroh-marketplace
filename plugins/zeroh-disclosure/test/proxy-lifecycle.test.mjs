// SPDX-License-Identifier: AGPL-3.0-only

// The default proxy at the edges of its lifecycle (review LC-proxy): `proxy
// off` stays off, a daemon that leaves takes its settings entry with it, an
// update drains open answers, and doctor --fix leaves other profiles alone.
// Everything is isolated; nothing touches the real settings or login items.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { installId, restoreRecordPath } from '../lib/claude-settings.js';
import {
  checkSessionProxy,
  diagnoseProxy,
  ensureDefaultProxy,
  probeProxy,
  proxyOn,
  routeSession,
  sessionProxyState,
  stopDefaultProxy,
} from '../lib/proxy-manager.js';
import {
  endSessionRoute,
  proxyPaths,
  readProxyConfig,
} from '../lib/proxy-state.js';
import { acquireFileLock, releaseFileLock, Vault } from '../lib/vault.js';
import { uninstallMarkerPath } from '../lib/uninstall-marker.js';
import { createServiceManager } from '../lib/service-manager.js';
import {
  fakeProgram,
  fakeUpstream,
  isolatedProxyEnvironment as isolatedEnvironment,
  PLUGIN,
  postJson,
  testDaemons,
} from './helpers.mjs';
import { asUser } from './as-user.mjs';

const CLI = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
const BODY = JSON.stringify({
  messages: [{ role: 'user', content: 'ZEROHFAKE lifecycle request' }],
});

function settingsDoc(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function until(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function hook(name, event, env, root) {
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'hooks', 'run.js'), name],
    {
      input: JSON.stringify({ cwd: root, ...event }),
      encoding: 'utf8',
      env: { ...env, CLAUDE_PROJECT_DIR: root },
      timeout: 30_000,
    },
  );
  const out = result.stdout.trim();
  return {
    code: result.status,
    stderr: result.stderr,
    json: out ? JSON.parse(out.split('\n').pop()) : null,
  };
}

function pluginCopy(root, version) {
  const copy = path.join(root, `plugin-${version}`);
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

test('proxy off stays off in the next prompt and session until proxy on (LP-B2)', async (t) => {
  const isolated = isolatedEnvironment('proxy-off-sticky');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: upstream.url } })}\n`,
  );
  // The retired daemon leaves soon after its last request (hooks run
  // between requests here, so not too soon).
  const env = { ...isolated.env, ZEROH_RETIRED_IDLE_MS: '5000' };
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'off-1',
  });
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );

  const off = spawnSync(process.execPath, [CLI, 'proxy', 'off'], {
    env: asUser(['proxy', 'off'], env),
    encoding: 'utf8',
  });
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /stays off, also in new sessions/u);
  assert.match(off.stdout, /This session keeps working until you exit/u);
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    upstream.url,
  );
  // Retired, not stopped: the session that ran `proxy off` still names it.
  assert.equal((await probeProxy(installed.proxyUrl))?.retired, true);

  // The next prompt of a running session does not put it back.
  const routing = await routeSession({
    env,
    sessionId: 'off-1',
    root: isolated.root,
    pluginRoot: PLUGIN,
    waitMs: 10,
  });
  assert.deepEqual(routing, { routed: false, state: 'not-configured' });
  // The next session neither starts the daemon nor registers a login item.
  const start = hook(
    'session-start',
    { session_id: 'off-2', source: 'startup' },
    env,
    isolated.root,
  );
  assert.equal(start.code, 0, start.stderr);
  assert.match(start.json.systemMessage, /you turned it off/u);
  const prompt = hook(
    'user-prompt-submit',
    { session_id: 'off-2', prompt: 'please list the files' },
    env,
    isolated.root,
  );
  assert.equal(prompt.code, 0, prompt.stderr);
  assert.doesNotMatch(prompt.json?.systemMessage ?? '', /couldn't put/u);
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    upstream.url,
  );
  assert.equal(readProxyConfig(proxyPaths(env)), null);
  assert.equal(createServiceManager({ env }).registeredKind(), null);
  // A session that still names the old proxy keeps working through the
  // retired daemon (Rule 1): its prompt goes on.
  const stale = hook(
    'user-prompt-submit',
    { session_id: 'off-1', prompt: 'hello again' },
    { ...env, ANTHROPIC_BASE_URL: installed.proxyUrl },
    isolated.root,
  );
  assert.equal(stale.code, 0, stale.stderr);
  assert.notEqual(stale.json?.decision, 'block');
  const through = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'off-1',
  });
  assert.equal(through.status, 200);
  // Idle, it leaves by itself.
  assert.ok(await until(async () => !(await probeProxy(installed.proxyUrl))));
  // Once gone, a session that still names it is told plainly, never looped.
  const gone = hook(
    'user-prompt-submit',
    { session_id: 'off-1', prompt: 'hello again' },
    { ...env, ANTHROPIC_BASE_URL: installed.proxyUrl },
    isolated.root,
  );
  assert.equal(gone.code, 2);
  assert.match(gone.stderr, /you turned the local proxy off/u);
  assert.doesNotMatch(gone.stderr, /could not check/u);

  // proxy on: the next session sets it up again.
  const on = spawnSync(process.execPath, [CLI, 'proxy', 'on'], {
    env: asUser(['proxy', 'on'], env),
    encoding: 'utf8',
  });
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /on again/u);
  assert.equal(proxyOn({ env }).wasOff, false);
  const back = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'off-3',
  });
  assert.equal(back.enabled, true);
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    back.proxyUrl,
  );

  // doctor --fix also forgets a `proxy off`.
  await stopDefaultProxy({ env, remember: true });
  assert.ok(existsSync(restoreRecordPath(isolated.settings)));
  await diagnoseProxy({ env, fix: true });
  assert.equal(existsSync(restoreRecordPath(isolated.settings)), false);
});

// Windows has no SIGTERM: process.kill ends a process at once there and none
// of its handlers run, so a daemon stopped that way cannot take its settings
// entry out (on POSIX it does, LP-B4).
const GRACEFUL_SIGTERM = process.platform !== 'win32';

test('a daemon that leaves takes its settings entry with it, and comes back at the same URL (LP-B4)', async (t) => {
  const isolated = isolatedEnvironment('proxy-leaves');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const original = { env: { ANTHROPIC_BASE_URL: upstream.url }, theme: 'dark' };
  writeFileSync(isolated.settings, `${JSON.stringify(original)}\n`);
  const env = isolated.env;
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'leave-1',
  });
  const manager = createServiceManager({ env });
  assert.ok(manager.registeredKind());

  // Shutdown or logout (SIGTERM): the entry goes, the login item stays, and
  // the next prompt of a plugin session writes it back. (Not on Windows,
  // where no test can stop the daemon gracefully; there the daemon from the
  // install serves the part below.)
  if (GRACEFUL_SIGTERM) {
    process.kill(installed.pid, 'SIGTERM');
    assert.ok(await until(async () => !(await probeProxy(installed.proxyUrl))));
    assert.deepEqual(settingsDoc(isolated.settings), original);
    assert.ok(
      manager.registeredKind(),
      'the login item stays for the next login',
    );
    const routed = await routeSession({
      env,
      sessionId: 'leave-1',
      root: isolated.root,
      pluginRoot: PLUGIN,
      waitMs: 10,
    });
    assert.equal(routed.routed, true);
    assert.equal(
      settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
      installed.proxyUrl,
      'the same URL is written back',
    );
  }

  // The plugin was removed and ~/.zeroh deleted: the daemon puts the user's
  // setting back and removes its login item before it exits, so Claude Code
  // never meets a dead port.
  rmSync(env.ZEROH_HOME, { recursive: true, force: true });
  assert.ok(
    await until(
      () =>
        !settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL?.includes('/z/'),
      8_000,
    ),
    'the settings entry was restored',
  );
  assert.deepEqual(settingsDoc(isolated.settings), original);
  assert.ok(await until(() => manager.registeredKind() === null, 4_000));
  assert.ok(await until(async () => !(await probeProxy(installed.proxyUrl))));

  // A new home: the same key and port come back for sessions that name them.
  const again = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'leave-2',
  });
  assert.equal(again.proxyUrl, installed.proxyUrl);
  assert.equal(again.upstream, upstream.url);
});

test('a daemon that leaves keeps the entry a live session goes through; its next prompt restarts it (RB-1)', async (t) => {
  const isolated = isolatedEnvironment('proxy-live-leave');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const original = { env: { ANTHROPIC_BASE_URL: upstream.url } };
  writeFileSync(isolated.settings, `${JSON.stringify(original)}\n`);
  const env = isolated.env;
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'live-1',
  });
  const session = { ...env, ANTHROPIC_BASE_URL: installed.proxyUrl };
  const guard = () =>
    checkSessionProxy({
      env: session,
      sessionId: 'live-1',
      root: isolated.root,
      pluginRoot: PLUGIN,
    });
  const entry = () => settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL;
  const gone = () =>
    until(async () => !(await probeProxy(installed.proxyUrl)), 8_000);
  // Mid-conversation: the daemon has masked this session's traffic.
  const first = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'live-1',
  });
  assert.equal(first.status, 200);

  // SIGTERM (shutdown, `systemctl --user stop`, `killall node`): the entry
  // stays, so the rest of the turn never goes straight to the API.
  process.kill(installed.pid, 'SIGTERM');
  assert.ok(await gone());
  assert.equal(entry(), installed.proxyUrl);
  // The next prompt brings it back on the same URL; still masked.
  const restarted = await guard();
  assert.equal(restarted.block, false, restarted.message);
  const second = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'live-1',
  });
  assert.equal(second.status, 200);
  assert.equal(
    (await sessionProxyState({ env: session, sessionId: 'live-1' })).active,
    true,
  );

  // ~/.zeroh deleted while the session runs: the entry stays too, and the
  // next prompt sets the home up again.
  const before = await probeProxy(installed.proxyUrl);
  rmSync(env.ZEROH_HOME, { recursive: true, force: true });
  assert.ok(await gone());
  assert.equal(entry(), installed.proxyUrl);
  const back = await guard();
  assert.equal(back.block, false, back.message);
  const again = await probeProxy(installed.proxyUrl);
  assert.ok(again && again.pid !== before.pid);

  // A re-registered login item stops the daemon while the manager lock is
  // held (macOS `launchctl bootout`): the entry stays even without a live
  // session, since the lock holder is setting the proxy up.
  endSessionRoute({ env, sessionId: 'live-1' });
  const lock = acquireFileLock(proxyPaths(env).lock);
  try {
    process.kill(again.pid, 'SIGTERM');
    assert.ok(await gone());
  } finally {
    releaseFileLock(lock);
  }
  assert.equal(entry(), installed.proxyUrl);

  // No live session and no lock holder: the entry goes, as before.
  const last = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'live-2',
  });
  process.kill(last.pid, 'SIGTERM');
  assert.ok(await gone());
  if (GRACEFUL_SIGTERM)
    assert.deepEqual(settingsDoc(isolated.settings), original);
});

test('an update restarts the daemon without cutting an answer in progress (LP-F2)', async (t) => {
  const isolated = isolatedEnvironment('proxy-drain');
  // An upstream that streams its answer over two seconds.
  const slow = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      let chunks = 0;
      const timer = setInterval(() => {
        response.write(`data: part ${chunks}\n\n`);
        chunks += 1;
        if (chunks === 10) {
          clearInterval(timer);
          response.end('data: done\n\n');
        }
      }, 200);
    });
  });
  await new Promise((resolve) => slow.listen(0, '127.0.0.1', resolve));
  t.after(() => slow.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${slow.address().port}` } })}\n`,
  );
  const env = isolated.env;
  t.after(async () => stopDefaultProxy({ env }));
  const first = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: pluginCopy(isolated.root, '1.0.0'),
    sessionId: 'drain-1',
  });
  const answer = postJson(`${first.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'drain-1',
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const updated = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: pluginCopy(isolated.root, '1.0.1'),
    sessionId: 'drain-1',
  });
  assert.notEqual(updated.pid, first.pid);
  const done = await answer;
  assert.equal(done.status, 200);
  assert.match(done.text, /data: done/u, 'the answer was not cut');
});

test('doctor --fix in one profile leaves the daemon another profile uses (LP-F3)', async (t) => {
  const isolated = isolatedEnvironment('proxy-doctor-profiles');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const profileB = path.join(isolated.root, 'profile-b', 'settings.json');
  mkdirSync(path.dirname(profileB), { recursive: true });
  writeFileSync(isolated.settings, '{}\n');
  writeFileSync(profileB, '{}\n');
  const envA = { ...isolated.env, ANTHROPIC_BASE_URL: upstream.url };
  const envB = { ...envA, ZEROH_CLAUDE_SETTINGS: profileB };
  t.after(async () => {
    await stopDefaultProxy({ env: envB });
    await stopDefaultProxy({ env: envA });
  });
  const a = await ensureDefaultProxy({
    env: envA,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'doc-a',
  });
  const b = await ensureDefaultProxy({
    env: envB,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'doc-b',
  });
  const fixed = await diagnoseProxy({ env: envA, fix: true });
  assert.equal(fixed.fixed, true);
  assert.equal(fixed.stopped, 0);
  assert.equal(settingsDoc(isolated.settings).env, undefined);
  assert.ok(await probeProxy(b.proxyUrl), 'B keeps its daemon');
  assert.equal(
    (await postJson(`${b.proxyUrl}/v1/messages`, BODY, { sessionId: 'doc-b' }))
      .status,
    200,
  );
  // Only A's routes were removed.
  const routes = readdirSync(proxyPaths(envA).routes).map((name) =>
    JSON.parse(readFileSync(path.join(proxyPaths(envA).routes, name), 'utf8')),
  );
  assert.deepEqual(
    routes.map((route) => route.sessionId),
    ['doc-b'],
  );
  assert.equal(a.pid, b.pid);
});

test('uninstall removes the plugin, the proxy entry, login item, a legacy project .zeroh and ZEROH_HOME, and a running session sets nothing up again (LV-F8, LP-F6, D-15, T-38)', async (t) => {
  const isolated = isolatedEnvironment('uninstall');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const foreign = {
    source: { source: 'github', repo: 'someone/else' },
    autoUpdate: false,
  };
  const original = {
    env: { ANTHROPIC_BASE_URL: upstream.url },
    extraKnownMarketplaces: { foreign },
  };
  writeFileSync(isolated.settings, `${JSON.stringify(original)}\n`);
  // The retired daemon leaves soon after its last request (hooks run
  // between requests here, so not too soon).
  const env = { ...isolated.env, ZEROH_RETIRED_IDLE_MS: '5000' };
  const project = path.join(isolated.root, 'project');
  mkdirSync(project, { recursive: true });
  const secret = 'ZEROHFAKE-uninstall-known-7c3e9a1b5d';
  writeFileSync(path.join(project, '.env'), `UNINSTALL_KEY=${secret}\n`);
  const start = hook(
    'session-start',
    { session_id: 'uninstall-1', source: 'startup' },
    env,
    project,
  );
  assert.equal(start.code, 0, start.stderr);
  const prompt = hook(
    'user-prompt-submit',
    { session_id: 'uninstall-1', prompt: 'please list the files' },
    { ...env, ANTHROPIC_BASE_URL: upstream.url },
    project,
  );
  assert.equal(prompt.code, 0, prompt.stderr);
  const source = { source: 'github', repo: 'Blade-Labs/zeroh-marketplace' };
  const withMarketplace = settingsDoc(isolated.settings);
  withMarketplace.extraKnownMarketplaces.zeroh = { source, autoUpdate: true };
  writeFileSync(isolated.settings, `${JSON.stringify(withMarketplace)}\n`);
  writeFileSync(
    path.join(env.ZEROH_HOME, 'first-run.json'),
    `${JSON.stringify({ installs: { [installId(isolated.settings)]: { autoUpdate: { decision: 'on', marketplace: 'zeroh', source } } } })}\n`,
  );
  const installed = settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL;
  assert.match(installed, /\/z\//u);
  const withSecret = JSON.stringify({
    messages: [{ role: 'user', content: `key ${secret}` }],
  });
  const before = await postJson(`${installed}/v1/messages`, withSecret, {
    sessionId: 'uninstall-1',
  });
  assert.equal(before.status, 200);
  assert.ok(!upstream.seen.at(-1).body.includes(secret), 'masked before');
  // D-15: nothing in the project; the session lives under ZEROH_HOME.
  assert.equal(existsSync(path.join(project, '.zeroh')), false);
  assert.ok(existsSync(path.join(env.ZEROH_HOME, 'projects')));
  assert.ok(existsSync(path.join(env.ZEROH_HOME, 'vault.key')));
  // An empty folder an earlier build left in the project goes too; one that
  // holds anything else is left alone (0.1 receipts: legacy-receipts.test).
  mkdirSync(path.join(project, '.zeroh', 'sessions', 'old'), {
    recursive: true,
  });
  writeFileSync(path.join(project, '.zeroh', '.gitignore'), '*\n');
  const other = path.join(isolated.root, 'other');
  mkdirSync(path.join(other, '.zeroh'), { recursive: true });
  writeFileSync(path.join(other, '.zeroh', 'notes.txt'), 'mine\n');

  // Claude Code's own CLI, faked: it lists the plugin and records what it
  // was asked to do.
  const calls = path.join(isolated.root, 'claude-calls.txt');
  const fakeClaude = path.join(isolated.root, 'fake-claude.mjs');
  writeFileSync(
    fakeClaude,
    [
      '#!/usr/bin/env node',
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');`,
      "if (process.argv[3] === 'list') console.log(JSON.stringify([{ id: 'zeroh-disclosure@zeroh', scope: 'user', enabled: true }, { id: 'other@x', scope: 'user' }]));",
    ].join('\n'),
    { mode: 0o755 },
  );
  const uninstallEnv = { ...env, ZEROH_CLAUDE_BIN: fakeProgram(fakeClaude) };
  const uninstall = (...args) =>
    spawnSync(process.execPath, [CLI, 'uninstall', ...args], {
      env: asUser(['uninstall', ...args], uninstallEnv),
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
  // In a terminal without --yes, or with --dry-run, it says what it removes
  // and removes nothing.
  const receiptsDir = `${path.resolve(env.ZEROH_HOME)}-receipts`;
  for (const args of [[], ['--yes', '--dry-run']]) {
    const asked = uninstall(...args);
    assert.equal(asked.status, 0, asked.stderr);
    assert.match(asked.stdout, /Nothing was removed yet/u);
    assert.match(asked.stdout, /type \/zeroh-disclosure:uninstall/u);
    // The plan says the receipts are kept, and where.
    assert.ok(
      asked.stdout
        .replace(/\s+/gu, ' ')
        .includes(
          `It keeps your receipts: every signed receipt, receipt.html and session receipt bundle, with the public keys that verify them, move to ${receiptsDir}.`,
        ),
      asked.stdout,
    );
  }
  assert.equal(existsSync(receiptsDir), false);
  assert.equal(existsSync(calls), false);
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    installed,
  );
  // A home that is not ZeroH's (a mistaken ZEROH_HOME) is never deleted.
  const mistaken = spawnSync(process.execPath, [CLI, 'uninstall', '--yes'], {
    env: { ...uninstallEnv, ZEROH_HOME: env.HOME },
    cwd: project,
    encoding: 'utf8',
  });
  assert.equal(mistaken.status, 1);
  assert.match(mistaken.stderr, /leaves it alone/u);
  assert.ok(existsSync(env.HOME));

  // T-38: with the session still running, uninstall removes everything,
  // the plugin last, and tells the user to exit the session.
  const removed = uninstall('--yes');
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    'plugin list --json',
    'plugin uninstall zeroh-disclosure@zeroh --scope user',
  ]);
  assert.match(
    removed.stdout,
    /Removed the plugin from Claude Code \(zeroh-disclosure@zeroh, user\)/u,
  );
  assert.match(
    removed.stdout,
    /This session keeps working until you exit, without ZeroH's masking; new sessions start without ZeroH\./u,
  );
  assert.doesNotMatch(removed.stdout, /masks nothing new|stay tokens/u);
  assert.match(
    removed.stdout,
    /To install it again: claude plugin install zeroh-disclosure@zeroh/u,
  );
  assert.deepEqual(settingsDoc(isolated.settings), original);
  assert.equal(existsSync(restoreRecordPath(isolated.settings)), false);
  assert.equal(existsSync(path.join(project, '.zeroh')), false);
  assert.ok(existsSync(path.join(other, '.zeroh', 'notes.txt')));
  // Only the tombstone is left, for the sessions still running.
  assert.deepEqual(readdirSync(env.ZEROH_HOME), ['uninstalled']);
  // The receipts, and only they, are kept outside ZEROH_HOME (owner
  // decision 2026-09-28), value-free, with the public keys.
  assert.match(
    removed.stdout.replace(/\s+/gu, ' '),
    /Kept your receipts: 1 signed receipt\(s\) of 1 session\(s\)/u,
  );
  assert.ok(removed.stdout.includes(receiptsDir), removed.stdout);
  const keptFiles = readdirSync(receiptsDir, { recursive: true })
    .map((name) => path.join(receiptsDir, name))
    .filter((file) => !statSync(file).isDirectory());
  assert.ok(keptFiles.length >= 4, keptFiles.join('\n'));
  for (const file of keptFiles) {
    assert.match(
      path.basename(file),
      /^(?:turn-\d+\.json|receipt\.html|session\.bundle\.json|signing-key\.json|zeroh-receipts\.json|README\.txt)$/u,
      file,
    );
    assert.ok(!readFileSync(file, 'utf8').includes(secret), file);
  }
  assert.equal(createServiceManager({ env }).registeredKind(), null);
  // The running session keeps working: the retired daemon still serves its
  // URL (Rule 1) and writes nothing under ZEROH_HOME.
  assert.equal((await probeProxy(installed))?.retired, true);
  const served = await postJson(`${installed}/v1/messages`, BODY, {
    sessionId: 'uninstall-1',
  });
  assert.equal(served.status, 200);
  // Rule 8: the vault and the hooks are gone, so nothing could put a token
  // back: the retired daemon masks nothing, not even what it masked before.
  const unmasked = await postJson(`${installed}/v1/messages`, withSecret, {
    sessionId: 'uninstall-1',
  });
  assert.equal(unmasked.status, 200);
  assert.ok(upstream.seen.at(-1).body.includes(secret), 'passed unmasked');
  assert.deepEqual(readdirSync(env.ZEROH_HOME), ['uninstalled']);
  // Idle, it leaves by itself, and nothing starts it again.
  assert.ok(await until(async () => !(await probeProxy(installed))));

  // The running session's hooks do nothing more: nothing is set up again.
  for (const [name, event] of [
    ['user-prompt-submit', { prompt: 'please list the files again' }],
    ['stop', {}],
    ['session-start', { source: 'clear' }],
    ['session-end', { reason: 'exit' }],
  ]) {
    const after = hook(
      name,
      { session_id: 'uninstall-1', ...event },
      env,
      project,
    );
    assert.equal(after.code, 0, `${name}: ${after.stderr}`);
    assert.deepEqual(readdirSync(env.ZEROH_HOME), ['uninstalled'], name);
  }
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    upstream.url,
  );
  // Installed again, a new session works as before and clears the tombstone.
  const again = hook(
    'session-start',
    { session_id: 'reinstalled', source: 'startup' },
    env,
    project,
  );
  assert.equal(again.code, 0, again.stderr);
  assert.ok(existsSync(env.ZEROH_HOME));
  assert.equal(existsSync(uninstallMarkerPath(env)), false);
  // The kept receipts are left as they were.
  for (const file of keptFiles) assert.ok(existsSync(file), file);

  // --delete-receipts wipes everything, the receipts kept before included.
  const wiped = uninstall('--yes', '--delete-receipts');
  assert.equal(wiped.status, 0, wiped.stderr);
  assert.match(
    wiped.stdout,
    /Deleted your receipts too \(--delete-receipts\)\./u,
  );
  assert.equal(existsSync(receiptsDir), false);
  assert.deepEqual(readdirSync(env.ZEROH_HOME), ['uninstalled']);
  // The daemon the new session started was retired; idle, it leaves.
  assert.ok(await until(() => testDaemons().length === 0, 20_000));
});

// Rule 1 (owner, 2026-09-28): `proxy off`, doctor --fix and uninstall
// retire the daemon instead of stopping it. The session that ran the command
// still names its URL; a stopped daemon made its next call fail with
// "Connection refused" and ten retries.
test('a retired daemon serves open sessions with what it masked, masks nothing new, exits when idle and never restarts', async (t) => {
  const isolated = isolatedEnvironment('retired');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: upstream.url } })}\n`,
  );
  const env = { ...isolated.env, ZEROH_RETIRED_IDLE_MS: '1500' };
  const root = path.join(isolated.root, 'project');
  mkdirSync(root, { recursive: true });
  const before = 'ZEROHFAKE-retired-before-4f1c9a2b7d';
  const after = 'ZEROHFAKE-retired-after-8e2d6c1a5f';
  writeFileSync(path.join(root, '.env'), `BEFORE_KEY=${before}\n`);
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root,
    pluginRoot: PLUGIN,
    sessionId: 'retired-1',
  });
  const ask = (content) =>
    postJson(
      `${installed.proxyUrl}/v1/messages`,
      JSON.stringify({ messages: [{ role: 'user', content }] }),
      { sessionId: 'retired-1' },
    );
  assert.equal((await ask(`key ${before}`)).status, 200);
  const masked = upstream.seen.at(-1).body;
  assert.ok(!masked.includes(before));
  const token = /\[[A-Z_]+-[0-9a-f]{6}\]/u.exec(masked)?.[0];
  assert.ok(token, masked);

  const off = spawnSync(process.execPath, [CLI, 'proxy', 'off'], {
    env: asUser(['proxy', 'off'], env),
    encoding: 'utf8',
  });
  assert.equal(off.status, 0, off.stderr);
  assert.equal((await probeProxy(installed.proxyUrl))?.retired, true);
  // A value known only after it retired, and the proxy's files gone.
  writeFileSync(
    path.join(root, '.env'),
    `BEFORE_KEY=${before}\nAFTER_KEY=${after}\n`,
  );
  assert.equal(readProxyConfig(proxyPaths(env)), null);
  const log = proxyPaths(env).log;
  const logBefore = existsSync(log) ? readFileSync(log, 'utf8') : '';

  assert.equal((await ask(`key ${before} and ${after}`)).status, 200);
  const retired = upstream.seen.at(-1).body;
  // What the model saw as a token stays that token; nothing new is masked
  // (it could never be restored once ZeroH is gone).
  assert.ok(retired.includes(token), retired);
  assert.ok(!retired.includes(before), retired);
  assert.ok(retired.includes(after), retired);
  // A session it never masked for (no hooks there) still passes through as
  // it did before it retired: nothing could put a token back there.
  const unrouted = await postJson(
    `${installed.proxyUrl}/v1/messages`,
    JSON.stringify({ messages: [{ role: 'user', content: `key ${before}` }] }),
    { sessionId: 'retired-no-hooks' },
  );
  assert.equal(unrouted.status, 200);
  assert.ok(upstream.seen.at(-1).body.includes(before));
  // It wrote nothing under ZEROH_HOME, and no login item came back.
  assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', logBefore);
  assert.equal(readProxyConfig(proxyPaths(env)), null);
  assert.equal(createServiceManager({ env }).registeredKind(), null);

  // Kept alive by requests, it leaves once idle, and stays gone.
  assert.ok(await until(async () => !(await probeProxy(installed.proxyUrl))));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(await probeProxy(installed.proxyUrl), null);
});

// Astra pre-1.0.0 R4: a retired daemon pooled every project's known values
// into one masker and used it for every session, so a value known only in
// project A went to project B's model as A's token, which B's hooks can't
// put back (rule 8). Each session keeps its own project's known values.
test("a retired daemon masks each session with its own project's known values only (Astra R4)", async (t) => {
  const isolated = isolatedEnvironment('retired-per-project');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: upstream.url } })}\n`,
  );
  const env = { ...isolated.env, ZEROH_RETIRED_IDLE_MS: '1500' };
  const a = path.join(isolated.root, 'project-a');
  const b = path.join(isolated.root, 'project-b');
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  const onlyA = 'ZEROHFAKE-retired-only-project-A-7c3e';
  const onlyB = 'ZEROHFAKE-retired-only-project-B-2d9f';
  const vaultA = new Vault(a, { env });
  const tokenA = vaultA.tokenFor('SECRET', onlyA);
  vaultA.save();
  const vaultB = new Vault(b, { env });
  const tokenB = vaultB.tokenFor('SECRET', onlyB);
  vaultB.save();
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: a,
    pluginRoot: PLUGIN,
    sessionId: 'project-a',
  });
  await ensureDefaultProxy({
    env,
    root: b,
    pluginRoot: PLUGIN,
    sessionId: 'project-b',
  });
  await stopDefaultProxy({ env, retire: true, remember: true });
  assert.equal((await probeProxy(installed.proxyUrl))?.retired, true);
  const ask = (sessionId) =>
    postJson(
      `${installed.proxyUrl}/v1/messages`,
      JSON.stringify({
        messages: [{ role: 'user', content: `keys ${onlyA} ${onlyB}` }],
      }),
      { sessionId },
    );

  assert.equal((await ask('project-b')).status, 200);
  const fromB = upstream.seen.at(-1).body;
  assert.ok(!fromB.includes(tokenA), `A's token in B: ${fromB}`);
  assert.ok(fromB.includes(onlyA), fromB);
  assert.ok(fromB.includes(tokenB) && !fromB.includes(onlyB), fromB);
  assert.equal(new Vault(b, { env }).valueOf(tokenB), onlyB);

  assert.equal((await ask('project-a')).status, 200);
  const fromA = upstream.seen.at(-1).body;
  assert.ok(!fromA.includes(tokenB), `B's token in A: ${fromA}`);
  assert.ok(fromA.includes(onlyB), fromA);
  assert.ok(fromA.includes(tokenA) && !fromA.includes(onlyA), fromA);
  assert.ok(await until(async () => !(await probeProxy(installed.proxyUrl))));
});

// Rule 1 (architect review 1.0.0): where the system refused the login item
// the daemon leaves once no plugin session is live, but a session whose
// hooks don't run (the plugin disabled there, or Claude Code started it
// without plugins) captured the same port. The daemon takes its settings
// entries out, then drains like a retired one instead of closing the port.
test('a session-only daemon drains instead of closing a port a session without hooks still uses', async (t) => {
  const isolated = isolatedEnvironment('session-only-drain');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: upstream.url } })}\n`,
  );
  const env = { ...isolated.env, ZEROH_RETIRED_IDLE_MS: '4000' };
  const refusing = {
    isRegistered: () => false,
    register() {
      throw Object.assign(new Error('login items are off'), { code: 'EPERM' });
    },
    unregister: () => ({ removed: false, kind: null }),
  };
  t.after(async () => stopDefaultProxy({ env, serviceManager: refusing }));
  const installed = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'drain-plugin',
    serviceManager: refusing,
    writeSettings: true,
  });
  assert.equal(installed.sessionOnly, true);
  assert.equal(
    settingsDoc(isolated.settings).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );
  // A session without hooks on the same port: passed through, unmasked.
  const hookless = () =>
    postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
      sessionId: 'drain-no-hooks',
    });
  assert.equal((await hookless()).status, 200);

  // The only plugin session ends: the entry comes out within a lifecycle
  // check (5 s after start) ...
  endSessionRoute({ env, sessionId: 'drain-plugin' });
  assert.ok(
    await until(
      () =>
        settingsDoc(isolated.settings).env?.ANTHROPIC_BASE_URL !==
        installed.proxyUrl,
      20_000,
    ),
    'the settings entry was taken out',
  );
  // ... and the session still on the port keeps working (it was refused
  // ten times over before).
  for (let index = 0; index < 3; index += 1) {
    const answer = await hookless();
    assert.equal(answer.status, 200, answer.text);
    assert.equal(upstream.seen.at(-1).body, BODY);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal((await probeProxy(installed.proxyUrl))?.retired, true);
  // A new plugin session never settles for a draining daemon: it takes the
  // port over with a daemon that masks again.
  const next = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'drain-next',
    serviceManager: refusing,
    writeSettings: true,
  });
  const health = await probeProxy(next.proxyUrl);
  assert.ok(health, 'a daemon answers');
  assert.equal(health.retired, undefined);
  assert.equal(next.proxyUrl, installed.proxyUrl);
});

// doctor --fix inside a session retires this home's daemon as well; a
// retired daemon is never reported or killed as an unknown one.
test('doctor --fix retires the daemon and later ignores it', async (t) => {
  const isolated = isolatedEnvironment('retired-doctor');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: upstream.url } })}\n`,
  );
  const env = { ...isolated.env, ZEROH_RETIRED_IDLE_MS: '1500' };
  t.after(async () => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'doctor-1',
  });
  const fixed = await diagnoseProxy({ env, fix: true, retire: true });
  assert.equal(fixed.retired, 1);
  assert.equal(fixed.stopped, 0);
  assert.equal((await probeProxy(installed.proxyUrl))?.retired, true);
  const through = await postJson(`${installed.proxyUrl}/v1/messages`, BODY, {
    sessionId: 'doctor-1',
  });
  assert.equal(through.status, 200);
  const guard = await checkSessionProxy({
    env: { ...env, ANTHROPIC_BASE_URL: installed.proxyUrl },
    sessionId: 'doctor-1',
    root: isolated.root,
  });
  assert.deepEqual(guard, { block: false, state: 'retired' });
  const again = await diagnoseProxy({ env });
  assert.equal(again.findings.includes('unknown-zeroh-daemon'), false);
  assert.ok(await until(async () => !(await probeProxy(installed.proxyUrl))));
});

// The guard in helpers.mjs: after the last test of a file, a proxy daemon
// still running from the file's temporary folders is killed and fails it.
test(
  'the test harness finds a proxy daemon a test left running',
  { skip: process.platform === 'win32' ? 'uses ps' : false },
  async (t) => {
    const isolated = isolatedEnvironment('left-running');
    const script = path.join(isolated.root, 'bin', 'proxy-daemon.mjs');
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, 'setInterval(() => {}, 1000);\n');
    const config = path.join(isolated.root, 'proxy', 'proxy.json');
    const child = spawn(process.execPath, [script, config], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    t.after(() => {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // Stopped below.
      }
    });
    assert.ok(
      await until(() => testDaemons().some((d) => d.pid === child.pid)),
    );
    process.kill(child.pid, 'SIGKILL');
    assert.ok(
      await until(() => !testDaemons().some((d) => d.pid === child.pid)),
    );
  },
);
