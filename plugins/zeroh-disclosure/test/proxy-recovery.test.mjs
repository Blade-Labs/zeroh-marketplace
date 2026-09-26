// SPDX-License-Identifier: AGPL-3.0-only

// D-10 and the one obvious recovery: a dead proxy is restarted within the
// prompt's budget or the prompt is stopped fast; a deleted ZEROH_HOME never
// leaves a daemon behind; `doctor --fix` resets everything it can find; local
// diagnostic reports hold no values. Every path is isolated (ZEROH_HOME,
// ZEROH_CLAUDE_SETTINGS, ZEROH_SERVICE_MANAGER_DIR); nothing touches the
// machine's real Claude settings, login items or proxy.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
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
import { writePrivateJson } from '../lib/private-fs.js';
import {
  checkSessionProxy,
  diagnoseProxy,
  ensureDefaultProxy,
  probeProxy,
  stopDefaultProxy,
} from '../lib/proxy-manager.js';
import {
  formatProxyReport,
  writeProxyDiagnostic,
} from '../lib/proxy-report.js';
import { proxyPaths } from '../lib/proxy-state.js';
import { createServiceManager } from '../lib/service-manager.js';
import {
  fakeUpstream,
  isolatedProxyEnvironment as isolatedEnvironment,
  PLUGIN,
} from './helpers.mjs';

function settingsDoc(isolated) {
  return JSON.parse(readFileSync(isolated.settings, 'utf8'));
}

async function until(check, { timeoutMs = 5_000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a dead proxy is restarted within the budget, else the prompt is stopped fast and the next session is safe', async (t) => {
  const isolated = isolatedEnvironment('proxy-dead');
  const gateway = await fakeUpstream();
  t.after(() => gateway.close());
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ env: { ANTHROPIC_BASE_URL: gateway.url } }, null, 2)}\n`,
  );
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-dead',
  });
  const sessionEnv = {
    ...isolated.env,
    ANTHROPIC_BASE_URL: installed.proxyUrl,
  };
  const check = () =>
    checkSessionProxy({
      env: sessionEnv,
      sessionId: 'ZEROHFAKE-dead',
      root: isolated.root,
      pluginRoot: PLUGIN,
    });

  // Killed once: restarted on the same URL, the prompt goes on.
  process.kill(installed.pid, 'SIGTERM');
  await until(async () => !(await probeProxy(installed.proxyUrl)));
  const restarted = await check();
  assert.equal(restarted.block, false);
  assert.equal(restarted.state, 'restarted');
  assert.ok(await probeProxy(installed.proxyUrl));

  // Killed again and another program takes its port: the restart moves the
  // proxy to a new port, and Claude Code applies the new settings entry to
  // this running session (T-19), so the prompt goes on (LP-F5, no "restart").
  const again = await probeProxy(installed.proxyUrl);
  process.kill(again.pid, 'SIGTERM');
  await until(async () => !(await probeProxy(installed.proxyUrl)));
  const squatter = http.createServer((request, response) => {
    response.writeHead(404);
    response.end();
  });
  const squatted = Number(new URL(installed.proxyUrl).port);
  squatter.listen(squatted, '127.0.0.1');
  await once(squatter, 'listening');
  t.after(() => squatter.close());
  const moved = await check();
  assert.equal(moved.block, false);
  assert.equal(moved.state, 'moved');
  const next = settingsDoc(isolated).env.ANTHROPIC_BASE_URL;
  assert.notEqual(next, installed.proxyUrl);
  assert.equal((await probeProxy(next))?.ok, true);

  // Killed once more, and no new start is possible (ZEROH_PROXY_PORT pins
  // the taken port): the prompt is stopped fast with a plain message.
  process.kill((await probeProxy(next)).pid, 'SIGTERM');
  await until(async () => !(await probeProxy(next)));
  const pinned = { ...sessionEnv, ZEROH_PROXY_PORT: String(squatted) };
  const started = Date.now();
  const down = await checkSessionProxy({
    env: pinned,
    sessionId: 'ZEROHFAKE-dead',
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  assert.ok(Date.now() - started < 6_000, `took ${Date.now() - started} ms`);
  assert.equal(down.block, true);
  assert.match(down.message, /isn't running/u);
  assert.match(down.message, /Restart Claude Code/u);
  assert.match(down.message, /typed secrets are stopped, not sent/u);
  assert.ok(down.report && existsSync(down.report));
  if (process.platform !== 'win32') {
    assert.equal(statSync(down.report).mode & 0o777, 0o600);
  }
  // The next session connects directly: no entry names a dead port.
  assert.equal(
    settingsDoc(isolated).env?.ANTHROPIC_BASE_URL ?? gateway.url,
    gateway.url,
  );

  // Told once: later prompts get the reminder without another restart try.
  const remindedAt = Date.now();
  const reminder = await checkSessionProxy({
    env: pinned,
    sessionId: 'ZEROHFAKE-dead',
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  assert.ok(Date.now() - remindedAt < 1_500);
  assert.equal(reminder.block, true);
  assert.match(reminder.message, /Restart Claude Code/u);

  // The prompt hook stops the prompt (exit 2) with the message.
  const hook = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'hooks', 'run.js'), 'user-prompt-submit'],
    {
      input: JSON.stringify({
        session_id: 'ZEROHFAKE-dead',
        cwd: isolated.root,
        prompt: 'hello',
      }),
      encoding: 'utf8',
      env: { ...pinned, CLAUDE_PROJECT_DIR: isolated.root },
      timeout: 20_000,
    },
  );
  assert.equal(hook.status, 2, hook.stderr);
  assert.match(hook.stderr, /Restart Claude Code/u);
});

// P-1: `rm -rf ~/.zeroh` while the proxy runs.
test('a daemon whose ZEROH_HOME is deleted leaves at once, and the next start keeps the same URL', async (t) => {
  const isolated = isolatedEnvironment('proxy-home-deleted');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(isolated.settings, '{}\n');
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const first = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-home-deleted',
  });
  rmSync(isolated.env.ZEROH_HOME, { recursive: true, force: true });
  assert.ok(
    await until(() => !alive(first.pid), { timeoutMs: 6_000 }),
    'the daemon did not exit',
  );

  // A running session's next prompt restarts it on the URL it already uses.
  const sessionEnv = { ...isolated.env, ANTHROPIC_BASE_URL: first.proxyUrl };
  const started = Date.now();
  const guard = await checkSessionProxy({
    env: sessionEnv,
    sessionId: 'ZEROHFAKE-home-deleted',
    root: isolated.root,
    pluginRoot: PLUGIN,
  });
  assert.equal(guard.block, false);
  assert.equal(guard.state, 'restarted');
  assert.ok(Date.now() - started < 3_500, `took ${Date.now() - started} ms`);
  assert.equal(settingsDoc(isolated).env.ANTHROPIC_BASE_URL, first.proxyUrl);
  const health = await probeProxy(first.proxyUrl);
  assert.notEqual(health.pid, first.pid);
});

// A process that answers the ZeroH health protocol with its pid but holds no
// token this home knows: a daemon from a deleted home or an earlier build.
async function strayDaemon(t) {
  const script = [
    "import http from 'node:http';",
    'const server = http.createServer((q, s) => {',
    "  s.writeHead(q.url.endsWith('/_zeroh/health') ? 200 : 404, { 'content-type': 'application/json' });",
    '  s.end(JSON.stringify({ ok: true, version: 1, pid: process.pid }));',
    '});',
    "server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\\n`));",
  ].join('\n');
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  t.after(() => {
    if (alive(child.pid)) child.kill('SIGKILL');
  });
  const [line] = await once(child.stdout, 'data');
  return { pid: child.pid, port: Number(String(line).trim()) };
}

test('doctor --fix resets: the settings entry goes, every ZeroH proxy it finds stops, nothing is left', async (t) => {
  const isolated = isolatedEnvironment('doctor-fix');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(isolated.settings, '{"theme":"dark"}\n');
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-doctor',
  });
  // A stray daemon and a file an earlier build left in the proxy directory.
  const stray = await strayDaemon(t);
  const paths = proxyPaths(isolated.env);
  writePrivateJson(path.join(paths.directory, 'state.json'), {
    port: stray.port,
  });

  const found = await diagnoseProxy({ env: isolated.env });
  assert.equal(found.entry, 'live');
  assert.equal(found.daemons, 2);
  assert.ok(found.findings.includes('unknown-zeroh-daemon'), found.findings);
  assert.ok(found.findings.includes('files-from-an-earlier-build'));
  // Nothing changed without --fix.
  assert.equal(
    settingsDoc(isolated).env.ANTHROPIC_BASE_URL,
    installed.proxyUrl,
  );
  assert.ok(alive(stray.pid));

  const fixed = await diagnoseProxy({ env: isolated.env, fix: true });
  assert.equal(fixed.fixed, true);
  assert.equal(fixed.restored, true);
  assert.equal(fixed.stopped, 2);
  assert.equal(fixed.loginItemRemoved, true);
  assert.deepEqual(settingsDoc(isolated), { theme: 'dark' });
  assert.ok(await until(() => !alive(installed.pid)));
  assert.ok(await until(() => !alive(stray.pid)));
  assert.deepEqual(
    readdirSync(paths.directory).filter((name) => name !== 'manager.lock'),
    [],
  );
  assert.equal(
    createServiceManager({ env: isolated.env }).isRegistered(),
    false,
  );
  const clean = await diagnoseProxy({ env: isolated.env });
  assert.deepEqual(clean.findings, []);
  assert.equal(clean.entry, 'none');
});

test('doctor --fix removes an entry for a ZeroH proxy it can only find by probing', async (t) => {
  const isolated = isolatedEnvironment('doctor-probe');
  const stray = await strayDaemon(t);
  // What an early build wrote: a bare loopback URL, no /z/<key>, no records.
  writeFileSync(
    isolated.settings,
    `${JSON.stringify({ theme: 'dark', env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${stray.port}` } }, null, 2)}\n`,
  );
  const fixed = await diagnoseProxy({ env: isolated.env, fix: true });
  assert.equal(fixed.restored, true);
  assert.equal(fixed.stopped, 1);
  assert.deepEqual(settingsDoc(isolated), { theme: 'dark', env: {} });
  assert.ok(await until(() => !alive(stray.pid)));
});

test('proxy reports hold no values, keys, paths or user names, and list with their kind', () => {
  const isolated = isolatedEnvironment('report-privacy');
  const env = {
    ...isolated.env,
    HOME: '/home/ZEROHFAKEuser',
    SHELL: '/bin/zsh',
    ANTHROPIC_API_KEY: 'sk-ant-ZEROHFAKEsecret000000000000',
    ANTHROPIC_BASE_URL: 'https://ZEROHFAKEgateway.example.com/anthropic',
    CLAUDE_CODE_VERSION: '2.1.282',
  };
  const file = writeProxyDiagnostic({
    env,
    event: 'proxy-fallback',
    failure: 'proxy-unreachable',
    steps: [
      { step: 'health-check', ok: false, ms: 3 },
      { step: 'restart', ok: false, code: 'ZEROHFAKE /home/x', ms: 3000 },
    ],
    install: {
      settingsPath:
        '/home/ZEROHFAKEuser/ZEROHFAKEproject/.claude/settings.local.json',
      originalBaseUrlPresent: true,
      originalBaseUrlValue: 'https://ZEROHFAKEgateway.example.com/anthropic',
      upstream: 'https://ZEROHFAKEgateway.example.com/anthropic',
      proxyUrl: 'http://127.0.0.1:4000/z/ZEROHFAKEproxykey00000000000',
      key: 'ZEROHFAKEproxykey00000000000',
      installedAt: '2026-09-25T08:00:00.000Z',
    },
    baseUrl: env.ANTHROPIC_BASE_URL,
  });
  assert.ok(file);
  assert.match(path.basename(file), /^proxy-\d{8}T\d{9}Z-[0-9a-f]{6}\.json$/u);
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
  const raw = readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /ZEROHFAKE/u);
  assert.doesNotMatch(raw, /\/home\//u);
  const report = JSON.parse(raw);
  assert.equal(report.kind, 'proxy');
  assert.equal(
    report.install.settings_file,
    '<project>/.claude/settings.local.json',
  );
  assert.equal(report.base_url, 'custom-https');
  assert.equal(report.claude_code_version, '2.1.282');
  assert.equal(report.shell, 'zsh');
  assert.doesNotMatch(formatProxyReport(report), /ZEROHFAKE|\/home\//u);

  // The CLI: doctor --report is paste-safe; reports list names the kind.
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  const doctor = spawnSync(process.execPath, [cli, 'doctor', '--report'], {
    env,
    cwd: isolated.root,
    encoding: 'utf8',
  });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /proxy-fallback/u);
  assert.match(doctor.stdout, /hello@bladelabs\.io/u);
  assert.doesNotMatch(doctor.stdout, /ZEROHFAKE|\/home\//u);
  const list = spawnSync(process.execPath, [cli, 'reports', 'list'], {
    env,
    cwd: isolated.root,
    encoding: 'utf8',
  });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /proxy-\S+ {2}\S+ {2}proxy {2}proxy-fallback/u);
  assert.equal(
    readdirSync(path.join(isolated.env.ZEROH_HOME, 'reports')).length,
    1,
  );
  // A report path that is not a regular file is never read.
  const id = path.basename(file, '.json');
  rmSync(file);
  mkdirSync(file);
  const show = spawnSync(process.execPath, [cli, 'reports', 'show', id], {
    env,
    cwd: isolated.root,
    encoding: 'utf8',
  });
  assert.notEqual(show.status, 0);
  assert.match(show.stderr, /not found/u);
});

// T-18: doctor says what it checked, what it fixed and what to do next, in
// plain words: no engines, no policy ids, no proxy URL or key.
test('doctor says what it checked, what it fixed and what to do next', async (t) => {
  const isolated = isolatedEnvironment('doctor-output');
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  writeFileSync(isolated.settings, '{}\n');
  isolated.env.ANTHROPIC_BASE_URL = upstream.url;
  t.after(async () => stopDefaultProxy({ env: isolated.env }));
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), ...args],
      { env: isolated.env, cwd: isolated.root, encoding: 'utf8' },
    );

  const clean = cli('doctor');
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /^Checked: your Claude Code settings/mu);
  assert.match(clean.stdout, /^Nothing to fix\.$/mu);
  assert.doesNotMatch(clean.stdout, /Next:/u);

  const installed = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-doctor-output',
  });
  const key = new URL(installed.proxyUrl).pathname.slice(3);
  writePrivateJson(
    path.join(proxyPaths(isolated.env).directory, 'install.json'),
    {},
  );
  const found = cli('doctor');
  assert.equal(found.status, 0, found.stderr);
  assert.match(
    found.stdout,
    /^Found:\n {2}- The proxy folder holds files from an earlier build\.$/mu,
  );
  assert.match(found.stdout, /^Next: \/zeroh-disclosure:doctor --fix resets/mu);
  const fixed = cli('doctor', '--fix');
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /^Fixed:$/mu);
  assert.match(
    fixed.stdout,
    /Took the ZeroH entry out of your Claude Code settings/u,
  );
  assert.match(fixed.stdout, /Stopped 1 ZeroH proxy process/u);
  assert.match(fixed.stdout, /^Next: Start Claude Code again/mu);
  assert.match(fixed.stdout, /Removed files left by earlier builds/u);
  for (const output of [clean.stdout, found.stdout, fixed.stdout]) {
    assert.doesNotMatch(
      output,
      /presidio|engine|policy|zeroh-disclosure-v1|\/z\//iu,
    );
    assert.ok(!output.includes(key));
  }
  const again = cli('doctor', '--fix');
  assert.match(
    again.stdout,
    /Nothing to fix: the local proxy was not set up\./u,
  );
});
