// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { restoreRecordPath } from '../lib/claude-settings.js';
import { PLUGIN, runHook, tempProject } from './helpers.mjs';

const READ_ONLY_COMMANDS = [
  'mask-receipt.md',
  'mask-show.md',
  'mask-config.md',
  'report.md',
  'status.md',
];

// One name per function; the removed duplicates and B2B commands stay gone.
const COMMANDS = [
  'allow.md',
  'doctor.md',
  'mask-config.md',
  'mask-receipt.md',
  'mask-show.md',
  'proxy.md',
  'report-miss.md',
  'report.md',
  'settings.md',
  'status.md',
  'uninstall.md',
  'unmask.md',
];

test('the plugin ships one command per function', () => {
  const shipped = readdirSync(path.join(PLUGIN, 'commands'))
    .filter((name) => name.endsWith('.md'))
    .sort();
  assert.deepEqual(shipped, COMMANDS);
});

test('no command grants unrestricted Bash or PowerShell', () => {
  for (const name of COMMANDS) {
    const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
    const line = source.match(/^allowed-tools: (.*)$/m)?.[1] ?? '';
    const grants = line.match(/\b(?:Bash|PowerShell)\b(?:\([^)]*\))?/gu) ?? [];
    for (const grant of grants) {
      assert.match(
        grant,
        /^(?:Bash|PowerShell)\(node "\$\{CLAUDE_PLUGIN_ROOT\}\//u,
        name,
      );
    }
  }
});

// Claude Code runs `!` blocks through Git Bash when it is present and through
// the PowerShell tool on Windows without Git Bash, so every shell grant exists
// in both forms with the same narrow pattern.
test('every shell grant is allowed for both Bash and PowerShell', () => {
  for (const name of COMMANDS) {
    const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
    const line = source.match(/^allowed-tools: (.*)$/m)?.[1] ?? '';
    const patterns = (shell) =>
      [...line.matchAll(new RegExp(`\\b${shell}\\(([^)]*)\\)`, 'gu'))]
        .map((match) => match[1])
        .sort();
    assert.deepEqual(patterns('PowerShell'), patterns('Bash'), name);
  }
});

test('read-only slash commands use `!` preprocessing without model-run instructions', () => {
  for (const name of READ_ONLY_COMMANDS) {
    const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
    assert.match(source, /^allowed-tools: Bash\(node "/m, name);
    assert.match(source, /^!`node /m, name);
    const body = source.split('---').slice(2).join('---');
    assert.doesNotMatch(body, /Run this exact command/i, name);
    assert.doesNotMatch(body, /```bash/i, name);
  }
});

test('proxy status, off and on are preprocessed, never model-run (F-4)', () => {
  const source = readFileSync(
    path.join(PLUGIN, 'commands', 'proxy.md'),
    'utf8',
  );
  assert.match(
    source,
    /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/commands\/scripts\/proxy-status\.js" \$ARGUMENTS`$/m,
  );
  // ZeroH's own guard denies a model's Bash call that names the plugin, so
  // the model must never be asked to run `proxy off` or `on`.
  const body = source.split('---').slice(2).join('---');
  assert.doesNotMatch(body, /\brun `node/u);
  assert.doesNotMatch(source, /bin\/zeroh-disclosure\.mjs/u);
  assert.doesNotMatch(source, /allowed-tools: \['Bash'\]/);
});

test('/zeroh-disclosure:proxy off and on run the command line (F-4)', () => {
  const p = tempProject({ env: false });
  const env = {
    PATH: process.env.PATH,
    HOME: p.home,
    ZEROH_HOME: p.home,
    ZEROH_CREDENTIAL_HOME: p.home,
    ZEROH_CLAUDE_SETTINGS: p.settings,
    ZEROH_SERVICE_MANAGER_DIR: p.serviceManager,
    CLAUDE_PROJECT_DIR: p.dir,
  };
  const script = path.join(PLUGIN, 'commands', 'scripts', 'proxy-status.js');
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: p.dir,
      encoding: 'utf8',
      env,
    });
  const off = run('off');
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /stays off, also in new sessions/u);
  assert.equal(
    JSON.parse(readFileSync(restoreRecordPath(p.settings), 'utf8')).off,
    true,
  );
  const on = run('on');
  assert.equal(on.status, 0, on.stderr);
  assert.match(on.stdout, /on again/u);
  assert.equal(existsSync(restoreRecordPath(p.settings)), false);
  const status = run();
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^Local masking proxy:/mu);
});

test('command scripts use the project root and CLAUDE_CODE_SESSION_ID from a subdirectory', () => {
  const p = tempProject();
  const started = runHook(
    'user-prompt-submit',
    { session_id: 'command-session', prompt: 'List the build steps' },
    { project: p },
  );
  assert.equal(started.code, 0, started.stderr);
  const subdirectory = path.join(p.dir, 'src');
  mkdirSync(subdirectory, { recursive: true });
  const run = (sessionId) =>
    spawnSync(
      process.execPath,
      [path.join(PLUGIN, 'commands', 'scripts', 'show.js')],
      {
        cwd: subdirectory,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: p.home,
          ZEROH_HOME: p.home,
          CLAUDE_PROJECT_DIR: p.dir,
          CLAUDE_CODE_SESSION_ID: sessionId,
        },
      },
    );
  const found = run('command-session');
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /what the model saw this session/);
  const missing = run('another-session');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /session not found: another-session/);
});

// T-37: every user action is a slash command run by `!` preprocessing (the
// user's own action), under a narrow grant naming its one CLI command or
// script; none tells the user to run a bare `zeroh-disclosure`.
test('user actions are slash commands with narrow grants', () => {
  const cli = 'node "${CLAUDE_PLUGIN_ROOT}/bin/zeroh-disclosure.mjs"';
  for (const [name, command] of [
    ['doctor.md', 'doctor'],
    ['allow.md', 'allow'],
    ['uninstall.md', 'uninstall'],
  ]) {
    const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
    assert.ok(source.includes(`!\`${cli} ${command} $ARGUMENTS\``), name);
    const line = source.match(/^allowed-tools: (.*)$/m)[1];
    assert.equal(
      line,
      [
        `Bash(${cli} ${command})`,
        `PowerShell(${cli} ${command})`,
        `Bash(${cli} ${command} *)`,
        `PowerShell(${cli} ${command} *)`,
      ].join(', '),
      name,
    );
  }
  for (const name of COMMANDS) {
    const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
    assert.doesNotMatch(
      source,
      /(?:^|[\s`(])zeroh-disclosure (?:doctor|proxy|allow|vault|uninstall)/mu,
      name,
    );
  }
});

test('settings passes only banner, receipts and vault to the CLI', () => {
  const p = tempProject();
  const script = path.join(PLUGIN, 'commands', 'scripts', 'settings.js');
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: p.dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: p.home,
        ZEROH_HOME: p.home,
        CLAUDE_PROJECT_DIR: p.dir,
      },
    });
  assert.match(run().stdout, /^Banner: default/mu);
  assert.match(run().stdout, /Receipts: kept on this computer for 90 days/u);
  assert.match(
    run('uninstall', '--yes').stdout,
    /Unknown setting "uninstall"/u,
  );
  assert.match(run('banner', 'compact').stdout, /compact/u);
  assert.match(run().stdout, /^Banner: compact/mu);
  assert.match(
    run('receipts', 'keep', '1y').stdout,
    /kept on this computer for 1 year/u,
  );
  assert.match(
    run('vault', 'clear').stdout,
    /add --yes to confirm \(\/zeroh-disclosure:settings vault clear --yes\)/u,
  );
});

test('uninstall from a slash command shows what it removes and removes nothing without --yes', () => {
  const p = tempProject();
  mkdirSync(p.home, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs'), 'uninstall'],
    {
      cwd: p.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: p.dir,
        ZEROH_HOME: p.home,
        ZEROH_CLAUDE_BIN: '/nonexistent/claude',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /the plugin from Claude Code \(claude plugin uninstall\)/u,
  );
  assert.match(
    result.stdout,
    /Nothing was removed yet\. To remove all of it, run \/zeroh-disclosure:uninstall --yes/u,
  );
  assert.ok(
    result.stdout.includes(
      `node "${path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs')}" uninstall --yes`,
    ),
  );
  assert.ok(existsSync(p.home));
});

// UO-1: commands that widen where a value may go or change how ZeroH
// protects the user are for the user only. Claude Code refuses a Skill call
// of a command with `disable-model-invocation: true`.
const USER_ONLY_FILES = [
  'allow.md',
  'doctor.md',
  'proxy.md',
  'settings.md',
  'uninstall.md',
];

function frontmatter(name) {
  const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
  return /^---\n([\s\S]*?)\n---\n/u.exec(source)[1];
}

test('user-only commands cannot be invoked by the model (UO-1)', () => {
  for (const name of COMMANDS) {
    const disabled = /^disable-model-invocation: true$/mu.test(
      frontmatter(name),
    );
    assert.equal(disabled, USER_ONLY_FILES.includes(name), name);
  }
});
