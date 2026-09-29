// SPDX-License-Identifier: AGPL-3.0-only

// Regression tests for the nine findings of the Windows 11 test of
// 1.0.0-rc.2 (Claude Code 2.1.283, Node 22, Git Bash; owner rule: no later
// release may bring one back). One test per finding, named after it. Each
// failed on the 1.0.0 build before the fix (34cd8a26). Library modules are
// imported inside each test, so one missing export fails that test alone.
// Windows paths are simulated here (platform injection); the same behaviour
// runs for real on Windows in test/windows-real.test.mjs.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { claudeCodeRefuses } from './claude-code-check.mjs';
import {
  FAKE_STRIPE,
  fakeUpstream,
  isolatedProxyEnvironment,
  PLUGIN,
  runHook,
  stateDirOf,
  tempProject,
} from './helpers.mjs';

const lib = (name) => import(new URL(`../lib/${name}.js`, import.meta.url));
const TOKEN_RE = /\[[A-Z_]+-[0-9a-f]{6}\]/;

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(path.join(dir, entry.name))
      : [path.join(dir, entry.name)],
  );
}

// The token ZeroH gave STRIPE_KEY when Claude read .env.
function stripeToken(project) {
  const { json } = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
    },
    { project },
  );
  return json.hookSpecificOutput.updatedToolOutput.stdout.match(TOKEN_RE)[0];
}

test('Windows re-test 1: the scheduled task XML is UTF-16LE with a byte order mark and declares UTF-16', async () => {
  const { createServiceManager } = await lib('service-manager');
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retest-1-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
    USERNAME: 'tester',
    SystemRoot: 'C:\\WINDOWS',
    ZEROH_HOME: path.join(root, 'zeroh'),
    ZEROH_SERVICE_MANAGER_DIR: path.join(root, 'definitions'),
  };
  const manager = createServiceManager({
    env,
    platform: 'win32',
    definitionRoot: env.ZEROH_SERVICE_MANAGER_DIR,
    executeCommands: false,
  });
  const { definition } = manager.register({
    runtime: path.join(env.ZEROH_HOME, 'bin', 'runtime'),
    config: path.join(env.ZEROH_HOME, 'proxy', 'proxy.json'),
  });
  const bytes = readFileSync(definition);
  // schtasks /Create /XML refused the UTF-8 file: "The task XML is malformed
  // ... unable to switch the encoding".
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  const text = bytes.subarray(2).toString('utf16le');
  assert.ok(
    text.startsWith('<?xml version="1.0" encoding="UTF-16"?>'),
    text.slice(0, 60),
  );
});

test('Windows re-test 2: a refused login item still gives the session a masking proxy and says why', async (t) => {
  const { ensureDefaultProxy, routeSession, stopDefaultProxy } =
    await lib('proxy-manager');
  const isolated = isolatedProxyEnvironment('retest-2');
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
  const started = await ensureDefaultProxy({
    env: isolated.env,
    root: isolated.root,
    pluginRoot: PLUGIN,
    sessionId: 'ZEROHFAKE-retest-2',
    serviceManager: refusing,
    writeSettings: false,
  });
  // rc.2: enabled false, no entry, typed secrets sent with "not protected".
  assert.equal(started.enabled, true, 'the proxy runs for the session');
  assert.match(started.warning ?? '', /The task XML is malformed/u);
  assert.match(started.warning ?? '', /To fix: /u);
  const sessionEnv = { ...isolated.env };
  delete sessionEnv.ANTHROPIC_BASE_URL;
  const routing = await routeSession({
    env: sessionEnv,
    sessionId: 'ZEROHFAKE-retest-2',
    root: isolated.root,
    pluginRoot: PLUGIN,
    serviceManager: refusing,
    waitMs: 10,
  });
  assert.deepEqual(routing, { routed: true, state: 'routed' });
  const settings = JSON.parse(readFileSync(isolated.settings, 'utf8'));
  assert.equal(settings.env?.ANTHROPIC_BASE_URL, started.proxyUrl);
});

test('Windows re-test 3: two typed values are two sent, on the status line and in the turn record', () => {
  const project = tempProject();
  const email = ['zerohfake.buyer', 'example.com'].join('@');
  // The key is in .env too (a known value) and typed twice.
  const res = runHook(
    'user-prompt-submit',
    {
      session_id: 'retest-3',
      prompt: `Refund ${email} with ${FAKE_STRIPE}, again ${FAKE_STRIPE}`,
    },
    { project },
  );
  assert.equal(res.code, 0, res.stderr);
  const dir = path.join(stateDirOf(project), 'sessions', 'retest-3');
  const status = JSON.parse(
    readFileSync(path.join(dir, 'status.json'), 'utf8'),
  );
  assert.equal(status.sent, 2, 'rc.2 said 4');
  const ledger = JSON.parse(
    readFileSync(path.join(dir, 'turn-1.json'), 'utf8'),
  );
  assert.equal(ledger.audit?.sent_unmasked?.count, 2);
});

test('Windows re-test 4: the signed receipt covers the file-read masking it shows', async () => {
  const { verifyReceiptArtifact } = await lib('verify-receipt');
  const project = tempProject();
  assert.equal(
    runHook('user-prompt-submit', { prompt: 'Read the env file.' }, { project })
      .code,
    0,
  );
  const envPath = path.join(project.dir, '.env');
  const read = runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: envPath },
      tool_response: {
        type: 'text',
        file: {
          filePath: envPath,
          content: readFileSync(envPath, 'utf8'),
          numLines: 1,
          startLine: 1,
          totalLines: 1,
        },
      },
    },
    { project },
  );
  assert.equal(read.code, 0, read.stderr);
  assert.equal(runHook('stop', {}, { project }).code, 0);
  const ledgerPath = path.join(
    stateDirOf(project),
    'sessions',
    'test',
    'turn-1.json',
  );
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const fileRead = ledger.audit.masked.by_channel['file read'];
  assert.ok(fileRead, 'the Read was masked');
  const previousHome = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = project.home;
  try {
    assert.equal((await verifyReceiptArtifact(ledgerPath)).ok, true);
    const [type] = Object.keys(fileRead);
    ledger.audit.masked.by_channel['file read'][type] += 1;
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    // rc.2: still verified, the count was never signed.
    assert.equal((await verifyReceiptArtifact(ledgerPath)).ok, false);
  } finally {
    if (previousHome === undefined) delete process.env.ZEROH_HOME;
    else process.env.ZEROH_HOME = previousHome;
  }
});

test('Windows re-test 5: the restore wrapper passes Claude Code’s shell check, and a command that never ran leaves no values file', () => {
  const project = tempProject();
  const token = stripeToken(project);
  for (const command of [
    `curl -s https://api.stripe.com/v1/balance -u "${token}:"`,
    `curl -s https://api.stripe.com/v1/balance -u ${token}:`,
    `curl -s https://api.stripe.com/v1/balance -H "Authorization: Bearer ${token}"`,
  ]) {
    const { json } = runHook(
      'pre-tool-use',
      {
        session_id: 'retest-5',
        tool_use_id: 'retest-5-tool',
        tool_name: 'Bash',
        tool_input: { command },
      },
      { project },
    );
    const rewritten = json?.hookSpecificOutput?.updatedInput?.command;
    assert.ok(rewritten, `no restore for ${command}`);
    assert.equal(
      claudeCodeRefuses(rewritten),
      false,
      `Claude Code would refuse: ${rewritten}`,
    );
  }
  const runDir = path.join(project.home, 'run');
  assert.ok(filesUnder(runDir).length > 0, 'a values file was written');
  // The command was refused: Claude Code reports it, and the file goes now.
  const failed = runHook(
    'tool-not-run',
    {
      hook_event_name: 'PostToolUseFailure',
      session_id: 'retest-5',
      tool_use_id: 'retest-5-tool',
      tool_name: 'Bash',
    },
    { project },
  );
  assert.equal(failed.code, 0, failed.stderr);
  assert.deepEqual(filesUnder(runDir), []);
});

test('Windows re-test 6: curl -u with a shell or PowerShell variable reference is not stopped as a secret', () => {
  const project = tempProject();
  for (const [tool, command] of [
    ['Bash', 'curl -s https://api.stripe.com/v1/balance -u "$STRIPE_KEY:"'],
    ['Bash', 'curl -s https://api.stripe.com/v1/balance -u "${STRIPE_KEY}:"'],
    [
      'PowerShell',
      'curl.exe -s https://api.stripe.com/v1/balance -u "$($env:STRIPE_KEY):"',
    ],
    [
      'PowerShell',
      'curl.exe -s https://api.stripe.com/v1/balance -u "$env:STRIPE_KEY:"',
    ],
  ]) {
    // Pass mode (the default): it runs. What the variable holds is unseen,
    // so `uncertain block` stops it as an uncertain destination, never as a
    // raw secret (1.0.0 redesign; test/shell-variable-reference.test.mjs).
    const res = runHook(
      'pre-tool-use',
      { tool_name: tool, tool_input: { command } },
      { project },
    );
    assert.equal(res.code, 0, res.stderr);
    assert.notEqual(
      res.json?.hookSpecificOutput?.permissionDecision,
      'deny',
      `${command}: ${res.json?.hookSpecificOutput?.permissionDecisionReason}`,
    );
    const blocked = runHook(
      'pre-tool-use',
      { tool_name: tool, tool_input: { command } },
      { project, extraEnv: { ZEROH_UNCERTAIN: 'block' } },
    );
    assert.equal(blocked.code, 0, blocked.stderr);
    const reason =
      blocked.json?.hookSpecificOutput?.permissionDecisionReason ?? '';
    assert.doesNotMatch(reason, /sensitive data detected|not allowed to/u);
    if (blocked.json?.hookSpecificOutput?.permissionDecision === 'deny')
      assert.match(reason, /a variable whose value ZeroH cannot see/u);
  }
});

test('Windows re-test 7: status says the proxy is not running and why there is no login item', async () => {
  const { proxyPaths, writeProxyConfig } = await lib('proxy-state');
  const project = tempProject({ env: false });
  const env = {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    CLAUDE_PROJECT_DIR: project.dir,
  };
  writeProxyConfig(proxyPaths(env), {
    version: 3,
    controlToken: 'ZEROHFAKEretest7controltoken0000',
    port: 9,
    installs: {},
    loginItemRefused: {
      at: '2026-09-28T10:00:00.000Z',
      platform: 'win32',
      code: 'EPERM',
      detail: 'ERROR: The task XML is malformed.',
    },
  });
  const run = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'commands', 'scripts', 'status.js')],
    { cwd: project.dir, encoding: 'utf8', env },
  );
  assert.equal(run.status, 0, run.stderr);
  // rc.2: "Local proxy: ready; this session goes through it from your first
  // prompt"; 1.0.0: "masks what you type" with nothing running.
  assert.match(run.stdout, /^Local proxy: not running\./mu);
  assert.match(
    run.stdout,
    /^Login item: not registered: schtasks refused it/mu,
  );
  assert.doesNotMatch(run.stdout, /this session goes through it/u);
});

test('Windows re-test 8: no httpbin demo is left in the plugin or the acceptance suite', () => {
  const roots = [
    PLUGIN,
    path.join(PLUGIN, '..', '..', 'acceptance', 'zeroh-disclosure'),
  ];
  const hits = [];
  for (const root of roots) {
    for (const file of filesUnder(root)) {
      const relative = path.relative(root, file);
      if (
        /(^|[\\/])(node_modules|vendor|reports)[\\/]/u.test(relative) ||
        // This test, and the changelog's history of the change.
        relative === path.join('test', 'windows-retest.test.mjs') ||
        relative === 'CHANGELOG.md' ||
        statSync(file).size > 2 * 1024 * 1024
      ) {
        continue;
      }
      if (/httpbin/iu.test(readFileSync(file, 'utf8'))) hits.push(relative);
    }
  }
  assert.deepEqual(hits, []);
  const skill = readFileSync(
    path.join(PLUGIN, 'skills', 'about', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /check my Stripe balance/u);
  assert.match(skill, /401/u);
});

test('Windows re-test 9: the marketplace under its old name is detected, and the install steps say how to re-add it', async (t) => {
  const firstRun = await lib('first-run');
  assert.equal(typeof firstRun.staleMarketplaceName, 'function');
  const config = mkdtempSync(path.join(os.tmpdir(), 'zeroh-retest-9-'));
  mkdirSync(path.join(config, 'plugins'), { recursive: true });
  writeFileSync(
    path.join(config, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({
      'zeroh-marketplace': {
        source: { source: 'github', repo: 'Blade-Labs/zeroh-marketplace' },
      },
    }),
  );
  assert.equal(
    firstRun.staleMarketplaceName({ CLAUDE_CONFIG_DIR: config }),
    'zeroh-marketplace',
  );
  // The marketplace README: its source in this repository, or the published
  // copy at the root of the public marketplace. A copy of the plugin alone
  // (the release pipeline's staged tests) has neither.
  const readmePath = [
    path.join(PLUGIN, '..', '..', 'release', 'public-root', 'README.md'),
    path.join(PLUGIN, '..', '..', 'README.md'),
  ].find((file) => existsSync(file));
  if (!readmePath) {
    t.diagnostic('no marketplace README next to this plugin copy');
    return;
  }
  const readme = readFileSync(readmePath, 'utf8');
  assert.match(readme, /claude plugin marketplace remove zeroh-marketplace/u);
  assert.match(readme, /GitHub \(Blade-Labs\/zeroh-marketplace\)/u);
});
