// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeProjectPath } from '../lib/session.js';

export const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
// Fake values only. Shaped like real ones so the detector sees them.
export const FAKE_STRIPE = 'sk_live_ZEROHFAKE0000000000000000';
export const FAKE_WEBHOOK = 'whsec_ZEROHFAKEwebhook00000000';
export const FAKE_DB_PASSWORD = 'Xk82!pwQzz';

// Typed prose with no secret and no pattern personal data: capitalised words,
// pull request numbers, dates and order numbers. It must pass untouched.
export const PROSE_FIXTURES = [
  'Then Read the README and Getting Started',
  'Please review Pull Request 42 on Main Branch',
  'Ship it on 2026-09-25, 25.09.2026 or 09/25/2026 (September 25, 2026 at 14:30).',
  'Order #20250925001, order 12345678, order number 555-123-4567 and invoice INV-2026-000123.',
  'Build 20260925 on 127.0.0.1 covers the years 2024 2025 2026 and version 1.2.3.4.',
  'Customer 123456 and account 12345678 asked about ticket 30012345678.',
];

// The unkeyed FNV-1a token hash of 0.x, for tests that need tokens a vault
// did not mint with its own key.
export function hash6(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return (h & 0xffffff).toString(16).padStart(6, '0');
}

export function assertIsolatedTestHome(env = process.env) {
  const realHome = os.userInfo().homedir;
  const temporaryRoot = path.resolve(os.tmpdir());
  assert.ok(env.HOME, 'tests must set HOME to an isolated temporary directory');
  assert.notEqual(
    path.resolve(env.HOME),
    path.resolve(realHome),
    `tests must not use the real home directory: ${realHome}`,
  );
  for (const key of [
    'HOME',
    'ZEROH_HOME',
    'ZEROH_CREDENTIAL_HOME',
    'ZEROH_CLAUDE_SETTINGS',
    'ZEROH_SERVICE_MANAGER_DIR',
  ]) {
    assert.ok(env[key], `tests must set ${key}`);
    assert.ok(
      path.resolve(env[key]).startsWith(`${temporaryRoot}${path.sep}`),
      `tests must keep ${key} under ${temporaryRoot}`,
    );
  }
}

const ISOLATION_KEYS = [
  'ZEROH_HOME',
  'ZEROH_CREDENTIAL_HOME',
  'ZEROH_CLAUDE_SETTINGS',
  'ZEROH_SERVICE_MANAGER_DIR',
];

// `npm test` sets nothing, so the suite isolates itself: when any ZeroH home
// is missing, HOME and every missing one move under a fresh temporary
// directory that is removed when the test file exits. A caller that sets them
// all (as CI does) keeps its own. Either way the guard below then refuses to
// run against the real home directory.
export function isolateTestEnvironment(env = process.env) {
  if (ISOLATION_KEYS.every((key) => env[key])) return null;
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-test-'));
  const home = path.join(root, 'home');
  mkdirSync(home, { recursive: true });
  env.HOME = home;
  env.USERPROFILE = home;
  env.ZEROH_HOME ||= path.join(root, 'zeroh');
  env.ZEROH_CREDENTIAL_HOME ||= path.join(root, 'credentials');
  env.ZEROH_CLAUDE_SETTINGS ||= path.join(root, 'claude', 'settings.json');
  env.ZEROH_SERVICE_MANAGER_DIR ||= path.join(root, 'service-manager');
  process.on('exit', () => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best effort: the OS cleans its temporary directory.
    }
  });
  return root;
}

// Tests run hooks and the CLI as child processes. When the suite itself runs
// inside a Claude Code session, that session's project and ids must not leak
// into them: every test names its own project and session.
for (const key of [
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_SESSION_ID',
]) {
  delete process.env[key];
}

// National-format phone numbers depend on a default region, which otherwise
// comes from the locale (LANG). Tests pin it off; a test that needs one sets
// it (withPhoneRegion) or passes `region` to the detector.
process.env.ZEROH_PHONE_REGION = 'none';

export function withPhoneRegion(region, fn) {
  const before = process.env.ZEROH_PHONE_REGION;
  process.env.ZEROH_PHONE_REGION = region;
  try {
    return fn();
  } finally {
    process.env.ZEROH_PHONE_REGION = before;
  }
}

const isolationRoot = isolateTestEnvironment();
assertIsolatedTestHome();

// --- proxy daemons a test started ------------------------------------------

// Every temporary folder this test file makes lives under its own root (the
// temp directory variables point there from here on), so a proxy daemon a
// test started is one whose files are under it. A daemon is detached and
// outlives the test process: on 2026-09-25 a run left four behind.
const TEST_ROOT = mkdtempSync(path.join(os.tmpdir(), 'zeroh-t-'));
for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = TEST_ROOT;
const DAEMON_ROOTS = [TEST_ROOT, isolationRoot].filter(Boolean);

// The proxy daemons running from under `roots` (POSIX `ps`; Windows: none).
export function testDaemons(roots = DAEMON_ROOTS) {
  if (process.platform === 'win32') return [];
  let listing = '';
  try {
    listing = execFileSync('ps', ['-axww', '-o', 'pid=,args='], {
      encoding: 'utf8',
    });
  } catch {
    return [];
  }
  const daemons = [];
  for (const line of listing.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (!match || !match[2].includes('proxy-daemon.mjs')) continue;
    if (!roots.some((root) => match[2].includes(`${root}${path.sep}`))) {
      continue;
    }
    daemons.push({ pid: Number(match[1]), command: match[2] });
  }
  return daemons;
}

// After the last test of the file: every daemon a test started must have
// stopped (a test stops what it starts, with t.after). One that is still
// running a few seconds later is killed, and the file fails.
after(async () => {
  const deadline = Date.now() + 4_000;
  let left = testDaemons();
  while (left.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    left = testDaemons();
  }
  for (const daemon of left) {
    try {
      process.kill(daemon.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  assert.deepEqual(
    left.map((daemon) => daemon.command),
    [],
    'proxy daemons outlived the tests of this file; each test must stop the daemon it starts',
  );
});
process.on('exit', () => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // Best effort: the OS cleans its temporary directory.
  }
});

// An isolated environment for a test that starts the proxy: HOME, ZEROH_HOME,
// credential discovery, the Claude settings file and login items all live
// under one fresh temporary directory; nothing else is inherited but PATH,
// the temp directory and the Windows system variables.
export function isolatedProxyEnvironment(name) {
  const root = mkdtempSync(path.join(os.tmpdir(), `zeroh-${name}-`));
  const home = path.join(root, 'home');
  const settings = path.join(root, 'project', '.claude', 'settings.local.json');
  mkdirSync(path.dirname(settings), { recursive: true });
  mkdirSync(home, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    ZEROH_HOME: path.join(root, 'zeroh-home'),
    ZEROH_CREDENTIAL_HOME: path.join(root, 'credentials'),
    ZEROH_CLAUDE_SETTINGS: settings,
    ZEROH_SERVICE_MANAGER_DIR: path.join(root, 'login-items'),
  };
  for (const name of ['TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { root, settings, env };
}

// A local stand-in for the model API. `seen` records every forwarded request
// (ZeroH health probes of a loopback gateway are not forwarded requests).
export async function fakeUpstream({
  contentType = 'application/json',
  body = '{"ok":true}',
} = {}) {
  const seen = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      if (!request.url.includes('/_zeroh/')) {
        seen.push({
          url: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      }
      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, seen, url, close: () => server.close() };
}

// POSTs `body` (JSON) and resolves with { status, headers, text }.
export function postJson(url, body, { sessionId = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sessionId ? { 'x-claude-code-session-id': sessionId } : {}),
        ...headers,
      },
    });
    request.on('response', (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (text += chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text,
        }),
      );
    });
    request.on('error', reject);
    request.end(body);
  });
}

// A hook run can start the real proxy for a test project. Deleting its
// proxy.json when the test file ends makes that daemon exit by itself.
const projectHomes = [];
process.on('exit', () => {
  for (const home of projectHomes) {
    rmSync(path.join(home, 'proxy', 'proxy.json'), { force: true });
  }
});

export function tempProject({ env = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-proj-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-home-'));
  projectHomes.push(home);
  if (env) {
    writeFileSync(
      path.join(dir, '.env'),
      [
        `STRIPE_KEY=${FAKE_STRIPE}`,
        `STRIPE_WEBHOOK_SECRET="${FAKE_WEBHOOK}"`,
        `DATABASE_URL=postgres://app:${FAKE_DB_PASSWORD}@db.internal:5432/shop`,
        'PORT=3000',
        'TENANT_SEED_KEY_PREFIX=zhe-tenant-',
      ].join('\n') + '\n',
    );
  }
  const settings = path.join(dir, '.claude', 'settings.local.json');
  const serviceManager = path.join(home, 'service-manager');
  process.env.ZEROH_CLAUDE_SETTINGS = settings;
  process.env.ZEROH_CREDENTIAL_HOME = home;
  process.env.ZEROH_SERVICE_MANAGER_DIR = serviceManager;
  return {
    dir,
    home,
    settings,
    serviceManager,
  };
}

// Where the hooks keep `project`'s sessions, receipts and allow list (D-15):
// <ZEROH_HOME>/projects/<encoded project path>, never the project folder.
export function stateDirOf(project, home = project.home) {
  return path.join(home, 'projects', encodeProjectPath(project.dir));
}

// Starts the real proxy daemon for `project` with `sessionId` registered, so
// a hook sees what a proxy-masked session sees. Returns runHook options (the
// session's ANTHROPIC_BASE_URL) and stop(). Its upstream is a closed port:
// hooks never send model traffic.
export async function withProxy(
  project,
  { sessionId = 'test', markSeen = true } = {},
) {
  const { ensureDefaultProxy, stopDefaultProxy } =
    await import('../lib/proxy-manager.js');
  const env = {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  };
  const installed = await ensureDefaultProxy({
    env,
    root: project.dir,
    pluginRoot: PLUGIN,
    sessionId,
  });
  // Claude Code's first request through the proxy: the daemon records that
  // this session goes through it (its upstream is closed; the answer is an
  // error, the record stays).
  if (markSeen) {
    await postJson(`${installed.proxyUrl}/v1/messages`, '{"messages":[]}', {
      sessionId,
    });
  }
  return {
    project,
    extraEnv: { ZEROH_PROXY: '', ANTHROPIC_BASE_URL: installed.proxyUrl },
    stop: () => stopDefaultProxy({ env }),
  };
}

// Stops the proxy a hook of `project` started (for t.after).
export async function stopProxyOf(project) {
  const { stopDefaultProxy } = await import('../lib/proxy-manager.js');
  return stopDefaultProxy({
    env: {
      PATH: process.env.PATH,
      HOME: project.home,
      ZEROH_HOME: project.home,
      ZEROH_CREDENTIAL_HOME: project.home,
      ZEROH_CLAUDE_SETTINGS: project.settings,
      ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    },
  });
}

export function writeAllow(project, rules) {
  for (const [name, hosts] of Object.entries(rules)) {
    for (const host of hosts) {
      execFileSync(
        process.execPath,
        [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'allow', name, host],
        {
          cwd: project.dir,
          env: {
            ...process.env,
            HOME: project.home,
            ZEROH_HOME: project.home,
            ZEROH_CREDENTIAL_HOME: project.home,
            ZEROH_CLAUDE_SETTINGS: project.settings,
            ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
          },
        },
      );
    }
  }
}

// Run a hook the way Claude Code does: JSON on stdin, JSON (or nothing) on stdout.
export function runHook(
  name,
  event,
  { project, extraEnv = {}, pluginDir = PLUGIN } = {},
) {
  const res = spawnSync(
    process.execPath,
    [path.join(pluginDir, 'hooks', 'run.js'), name],
    {
      input: JSON.stringify({ session_id: 'test', cwd: project.dir, ...event }),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: project.home,
        ZEROH_HOME: project.home,
        ZEROH_CREDENTIAL_HOME: project.home,
        ZEROH_CLAUDE_SETTINGS: project.settings,
        ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
        ZEROH_PROXY: 'off',
        CLAUDE_PROJECT_DIR: project.dir,
        ...extraEnv,
      },
      timeout: 20000,
    },
  );
  const out = res.stdout.trim();
  return {
    code: res.status,
    stderr: res.stderr,
    stdout: res.stdout,
    json: out ? JSON.parse(out.split('\n').pop()) : null,
  };
}

// A JSON-RPC client for the plugin's MCP server over stdio. `next(predicate)`
// resolves with the first message it matches, already received or not.
export function mcpClient({ cwd, env, elicitation = true, entrypoint = null }) {
  const child = spawn(
    process.execPath,
    [path.join(PLUGIN, 'mcp', 'server.mjs')],
    {
      cwd,
      env: {
        ...env,
        ...(entrypoint ? { CLAUDE_CODE_ENTRYPOINT: entrypoint } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const messages = [];
  const waiters = [];
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else messages.push(message);
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const next = (predicate) => {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve) => waiters.push({ predicate, resolve }));
  };
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: elicitation ? { elicitation: {} } : {},
    },
  });
  return {
    child,
    send,
    next,
    ready: next((message) => message.id === 1),
    stop() {
      child.kill('SIGTERM');
    },
  };
}

export function callMcpTool(instance, id, name, arguments_) {
  instance.send({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: arguments_ },
  });
  return instance.next((message) => message.id === id);
}
