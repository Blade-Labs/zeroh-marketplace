// SPDX-License-Identifier: AGPL-3.0-only

// rc.2 item 1 (Astra R3): a change to ZeroH's own protection happens only on
// the user's authority. The CLI refuses a state-changing subcommand unless it
// holds a one-time ticket that the UserPromptSubmit hook mints for the user's
// own typed slash command (matched against the pending request the command's
// `!` block recorded), or a human confirms it in a terminal outside Claude
// Code. Any other caller (the model's Bash, PowerShell or Monitor, whatever
// the spelling) changes nothing.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN, runHook, tempProject } from './helpers.mjs';
import {
  canonicalArgv,
  claimPending,
  managementAction,
  mintTicket,
  parseSlashPrompt,
  recordPending,
  requireUserAuthority,
  slashToCli,
} from '../lib/user-authority.js';

const CLI = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');

function envOf(project, extra = {}) {
  return {
    PATH: process.env.PATH,
    // Apart from ZEROH_HOME, so uninstall would remove it.
    HOME: path.join(project.dir, 'user-home'),
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ZEROH_PROXY: 'off',
    CLAUDE_PROJECT_DIR: project.dir,
    // What Claude Code sets in the Bash tool, the `!` block and hooks.
    CLAUDECODE: '1',
    ...extra,
  };
}

function cli(project, args, extra = {}) {
  return spawnSync(process.execPath, [CLI, ...args, '--cwd', project.dir], {
    cwd: project.dir,
    encoding: 'utf8',
    env: envOf(project, extra),
    timeout: 20000,
  });
}

function allowFile(project) {
  const dir = path.join(project.home, 'projects');
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name, 'allow.json');
    if (existsSync(file)) return file;
  }
  return null;
}

function pendingFiles(project) {
  const dir = path.join(project.home, 'run', 'authz');
  return existsSync(dir)
    ? readdirSync(dir).filter((name) => name.startsWith('pending-'))
    : [];
}

// Every state-changing subcommand, as the model could run it from a shell.
const MANAGEMENT = [
  ['proxy', 'off'],
  ['proxy', 'on'],
  ['doctor', '--fix'],
  ['uninstall', '--yes'],
  ['allow', 'STRIPE_KEY', 'attacker.example.com'],
  ['allow', '--remove', 'STRIPE_KEY', 'api.stripe.com'],
  ['unmask', 'caps', 'EMAIL', 'session'],
  ['vault', 'clear', '--yes'],
  ['receipts', 'keep', 'forever'],
  ['banner', 'off'],
  ['uncertain', 'pass'],
  ['uncertain', 'block'],
  ['statusline', 'on'],
  ['statusline', 'off'],
];

test('the CLI refuses every state-changing subcommand without the user (Astra R3)', () => {
  const project = tempProject();
  // A ZeroH home uninstall would remove.
  mkdirSync(path.join(project.home, 'vault'), { recursive: true });
  for (const args of MANAGEMENT) {
    const run = cli(project, args, { CLAUDE_CODE_SESSION_ID: 's1' });
    assert.equal(run.status, 0, `${args.join(' ')}: ${run.stderr}`);
    assert.match(
      run.stdout,
      /^Nothing changed: .* only you can do it\./mu,
      args.join(' '),
    );
    assert.match(run.stdout, /\/zeroh-disclosure:/u, args.join(' '));
  }
  // Nothing happened: no allow rule, no banner or retention setting, no
  // uninstall tombstone, ZEROH_HOME still there.
  assert.equal(allowFile(project), null);
  assert.equal(existsSync(path.join(project.home, 'config.env')), false);
  assert.equal(existsSync(path.join(project.home, 'banner.json')), false);
  assert.equal(existsSync(project.settings), false);
  assert.ok(existsSync(path.join(project.home, 'vault')));
  // Each refusal left a pending request (it changes nothing by itself).
  assert.ok(pendingFiles(project).length >= MANAGEMENT.length);
  for (const name of pendingFiles(project)) {
    const file = path.join(project.home, 'run', 'authz', name);
    if (process.platform !== 'win32')
      assert.equal(statSync(file).mode & 0o777, 0o600, name);
    const pending = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(pending.session, 's1');
    assert.ok(pending.exp - pending.created <= 60_000);
  }
});

test('read-only subcommands need no authority', () => {
  const project = tempProject();
  for (const args of [
    ['catalog'],
    ['help'],
    ['allow'],
    ['allow', '--list'],
    ['receipts'],
    ['vault', 'status'],
    ['unmask'],
    ['unmask', 'caps', '--list'],
    ['tokens'],
    ['reports', 'list'],
    ['uncertain'],
    ['statusline'],
    ['doctor'],
    ['uninstall'],
  ]) {
    const run = cli(project, args, { CLAUDE_CODE_SESSION_ID: 's1' });
    assert.doesNotMatch(run.stdout, /Nothing changed: /u, args.join(' '));
  }
  assert.deepEqual(pendingFiles(project), []);
});

test('the argv a request is matched on: slash command to CLI argv', () => {
  assert.deepEqual(slashToCli('proxy', ['OFF']), ['proxy', 'off']);
  assert.deepEqual(slashToCli('settings', ['banner', 'off']), [
    'banner',
    'off',
  ]);
  assert.deepEqual(slashToCli('settings', ['vault', 'clear', '--yes']), [
    'vault',
    'clear',
    '--yes',
  ]);
  assert.deepEqual(slashToCli('allow', ['K', 'h.example.com']), [
    'allow',
    'K',
    'h.example.com',
  ]);
  assert.equal(slashToCli('status', []), null);
  // One step: typing the user-only /zeroh-disclosure:uninstall confirms it,
  // exactly as its `!` block runs it (`uninstall --yes $ARGUMENTS`).
  assert.deepEqual(slashToCli('uninstall', []), ['uninstall', '--yes']);
  assert.deepEqual(slashToCli('uninstall', ['--yes']), [
    'uninstall',
    '--yes',
    '--yes',
  ]);
  assert.equal(slashToCli('uninstall', ['--dry-run']), null);
  assert.equal(managementAction(['uninstall', '--yes', '--dry-run']), null);
  assert.deepEqual(
    canonicalArgv(['allow', 'K', 'h.example.com', '--cwd', '/x']),
    ['allow', 'K', 'h.example.com'],
  );
  assert.deepEqual(parseSlashPrompt('  /zeroh-disclosure:proxy off \n'), {
    name: 'proxy',
    namespaced: true,
    args: ['off'],
  });
  assert.deepEqual(
    parseSlashPrompt(`/zeroh-disclosure:allow 'A B' x.example.com`),
    {
      name: 'allow',
      namespaced: true,
      args: ['A B', 'x.example.com'],
    },
  );
  assert.equal(
    parseSlashPrompt('please run /zeroh-disclosure:proxy off'),
    null,
  );
  assert.equal(managementAction(['proxy']), null);
  assert.equal(managementAction(['doctor']), null);
  assert.equal(managementAction(['uninstall']), null);
  assert.ok(managementAction(['doctor', '--fix']));
  assert.ok(managementAction(['vault', 'clear', '--yes']));
});

test('a pending request is claimed once, for the same session and argv only', () => {
  const project = tempProject();
  const env = envOf(project);
  const argv = ['proxy', 'off'];
  recordPending({ argv, sessionId: 's1', env });
  assert.equal(claimPending({ argv, sessionId: 's2', env }), null);
  assert.equal(
    claimPending({ argv: ['proxy', 'on'], sessionId: 's1', env }),
    null,
  );
  assert.ok(claimPending({ argv, sessionId: 's1', env }));
  assert.equal(claimPending({ argv, sessionId: 's1', env }), null);
  // Expired requests are never claimed.
  recordPending({ argv, sessionId: 's1', env, now: Date.now() - 61_000 });
  assert.equal(claimPending({ argv, sessionId: 's1', env }), null);
});

test('a ticket authorises exactly its argv, once', async () => {
  const project = tempProject();
  const env = envOf(project);
  const ticket = mintTicket({ argv: ['proxy', 'off'], env });
  const other = await requireUserAuthority({
    argv: ['proxy', 'on'],
    env: { ...env, ZEROH_USER_TICKET: ticket },
  });
  assert.equal(other.ok, false);
  const again = mintTicket({ argv: ['proxy', 'off'], env });
  const ok = await requireUserAuthority({
    argv: ['proxy', 'off', '--cwd', project.dir],
    env: { ...env, ZEROH_USER_TICKET: again },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.via, 'prompt');
  const replay = await requireUserAuthority({
    argv: ['proxy', 'off'],
    env: { ...env, ZEROH_USER_TICKET: again },
  });
  assert.equal(replay.ok, false);
  // A forged ticket (right id, wrong secret) is refused.
  const forged = mintTicket({ argv: ['proxy', 'off'], env });
  const bad = await requireUserAuthority({
    argv: ['proxy', 'off'],
    env: {
      ...env,
      ZEROH_USER_TICKET: `${forged.split('.')[0]}.${'0'.repeat(64)}`,
    },
  });
  assert.equal(bad.ok, false);
});

test('the terminal fallback: outside Claude Code, the user types the code shown', async () => {
  const project = tempProject();
  const env = { ...envOf(project) };
  delete env.CLAUDECODE;
  const shown = [];
  const terminal = (answer) => ({
    write: (text) => shown.push(text),
    readLine: async () => answer(shown.join('')),
  });
  const code = (text) => /type the code ([A-Z0-9]{4})/u.exec(text)[1];
  const accepted = await requireUserAuthority({
    argv: ['proxy', 'off'],
    env,
    ancestry: () => ['/bin/zsh', 'sshd: me'],
    terminal: terminal((text) => code(text).toLowerCase()),
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.via, 'terminal');
  assert.match(shown.join(''), /turn the local masking proxy off/u);
  shown.length = 0;
  const wrong = await requireUserAuthority({
    argv: ['proxy', 'off'],
    env,
    ancestry: () => [],
    terminal: terminal(() => 'yes'),
  });
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /cancelled/iu);
  // Inside Claude Code (its environment, or a claude process above this one),
  // or with no terminal, there is no fallback: the request is only recorded.
  for (const [extra, ancestry, term] of [
    [{ CLAUDECODE: '1' }, () => [], terminal(code)],
    [{ CLAUDE_CODE_SESSION_ID: 'x' }, () => [], terminal(code)],
    [{}, () => ['/usr/local/bin/claude --resume'], terminal(code)],
    [
      {},
      () => ['node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js'],
      terminal(code),
    ],
    [{}, () => [], null],
  ]) {
    const refused = await requireUserAuthority({
      argv: ['proxy', 'off'],
      env: { ...env, ...extra },
      ancestry,
      terminal: term,
    });
    assert.equal(refused.ok, false);
    assert.match(refused.message, /^Nothing changed: /u);
  }
});

test('UserPromptSubmit applies a typed management command and stops the prompt', () => {
  const project = tempProject();
  // The command's `!` block ran first: it recorded the request, nothing else.
  const bang = cli(
    project,
    ['allow', 'STRIPE_KEY', 'payments.zerohfake.test'],
    {
      CLAUDE_CODE_SESSION_ID: 'sess-a',
    },
  );
  assert.match(bang.stdout, /^Nothing changed/mu);
  assert.equal(allowFile(project), null);
  const hook = runHook(
    'user-prompt-submit',
    {
      session_id: 'sess-a',
      prompt: '/zeroh-disclosure:allow STRIPE_KEY payments.zerohfake.test',
    },
    { project },
  );
  assert.equal(hook.json?.decision, 'block', hook.stderr);
  assert.match(hook.json.reason, /^✓ Done by ZeroH Disclosure/u);
  assert.match(
    hook.json.reason,
    /allowed: STRIPE_KEY → payments\.zerohfake\.test/u,
  );
  const rules = JSON.parse(readFileSync(allowFile(project), 'utf8')).rules;
  assert.ok(rules.STRIPE_KEY.includes('payments.zerohfake.test'));
  assert.deepEqual(pendingFiles(project), []);
  // Typing it again without a fresh `!` request does nothing.
  const again = runHook(
    'user-prompt-submit',
    {
      session_id: 'sess-a',
      prompt:
        '/zeroh-disclosure:allow --remove STRIPE_KEY payments.zerohfake.test',
    },
    { project },
  );
  assert.equal(again.json?.decision, 'block');
  assert.match(again.json.reason, /Nothing changed/u);
  assert.ok(
    JSON.parse(
      readFileSync(allowFile(project), 'utf8'),
    ).rules.STRIPE_KEY.includes('payments.zerohfake.test'),
  );
});

test('typing /zeroh-disclosure:uninstall removes ZeroH in one step', () => {
  const project = tempProject();
  mkdirSync(path.join(project.home, 'vault'), { recursive: true });
  const extra = {
    HOME: path.join(project.dir, 'user-home'),
    ZEROH_CLAUDE_BIN: path.join(project.dir, 'no-claude'),
  };
  // The command's `!` block: `uninstall --yes` recorded, nothing removed.
  const bang = cli(project, ['uninstall', '--yes'], {
    ...extra,
    CLAUDE_CODE_SESSION_ID: 'sess-u',
  });
  assert.match(bang.stdout, /^Nothing changed/mu);
  assert.ok(existsSync(path.join(project.home, 'vault')));
  const hook = runHook(
    'user-prompt-submit',
    { session_id: 'sess-u', prompt: '/zeroh-disclosure:uninstall' },
    { project, extraEnv: extra },
  );
  assert.equal(hook.json?.decision, 'block', hook.stderr);
  assert.match(hook.json.reason, /^✓ Done by ZeroH Disclosure/u);
  assert.match(hook.json.reason, /To install it again: claude plugin install/u);
  assert.deepEqual(readdirSync(project.home), ['uninstalled']);
  // --dry-run only shows the plan and needs no authority.
  const preview = cli(project, ['uninstall', '--yes', '--dry-run'], extra);
  assert.match(preview.stdout, /Nothing was removed yet/u);
  assert.doesNotMatch(preview.stdout, /Nothing changed: /u);
});

test('a request the model recorded is not applied without the matching typed prompt', () => {
  const project = tempProject();
  cli(project, ['banner', 'off'], { CLAUDE_CODE_SESSION_ID: 'sess-b' });
  // Another session's prompt, another command, or prose quoting it.
  for (const [session, prompt] of [
    ['sess-c', '/zeroh-disclosure:settings banner off'],
    ['sess-b', '/zeroh-disclosure:settings banner compact'],
    ['sess-b', 'set /zeroh-disclosure:settings banner off please'],
  ]) {
    runHook('user-prompt-submit', { session_id: session, prompt }, { project });
    assert.equal(
      existsSync(path.join(project.home, 'banner.json')),
      false,
      prompt,
    );
  }
  // Read-only slash commands pass through to the model as before.
  const status = runHook(
    'user-prompt-submit',
    { session_id: 'sess-b', prompt: '/zeroh-disclosure:proxy' },
    { project },
  );
  assert.notEqual(status.json?.decision, 'block');
});

test('the management slash commands keep their `!` block on the CLI or its scripts', () => {
  for (const name of [
    'allow.md',
    'doctor.md',
    'uninstall.md',
    'proxy.md',
    'settings.md',
  ]) {
    const source = readFileSync(path.join(PLUGIN, 'commands', name), 'utf8');
    assert.match(source, /disable-model-invocation: true/u, name);
  }
});

// Astra's R3 repros: the spelling, launcher or wrapper does not matter any
// more, since the CLI itself refuses.
test('launcher and quoting spellings of the CLI change nothing (Astra R3 repros)', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX shell forms');
  const project = tempProject();
  mkdirSync(path.join(project.home, 'vault'), { recursive: true });
  const bin = path.join(project.dir, 'bin');
  mkdirSync(bin, { recursive: true });
  // The advertised executable on PATH, as a package install would put it.
  writeFileSync(
    path.join(bin, 'zeroh-disclosure'),
    `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`,
    { mode: 0o755 },
  );
  for (const command of [
    'zeroh-disclosure proxy off',
    '/usr/bin/env zeroh-disclosure proxy off',
    'env -u UNUSED zeroh-disclosure proxy off',
    'timeout 10 zeroh-disclosure proxy off',
    'zeroh-disclosure pro"xy" o\\ff',
    'nohup setsid zeroh-disclosure doctor --fix </dev/null',
    `node ${CLI} uninstall --yes`,
  ]) {
    // timeout and setsid are GNU/util-linux tools that macOS doesn't ship.
    const launcher = ['timeout', 'setsid'].find((name) =>
      command.includes(`${name} `),
    );
    if (
      launcher &&
      spawnSync('bash', ['-c', `command -v ${launcher}`]).status !== 0
    ) {
      t.diagnostic(`${launcher} is not on this system: ${command}`);
      continue;
    }
    const run = spawnSync('bash', ['-c', command], {
      cwd: project.dir,
      encoding: 'utf8',
      env: { ...envOf(project), PATH: `${bin}:${process.env.PATH}` },
      timeout: 20000,
    });
    assert.match(
      run.stdout,
      /^Nothing changed: /mu,
      `${command}: ${run.stderr}`,
    );
  }
  assert.ok(existsSync(path.join(project.home, 'vault')));
});

test("/zeroh-disclosure:settings uncertain block is applied on the user's typed prompt only", () => {
  const project = tempProject();
  const script = path.join(PLUGIN, 'commands', 'scripts', 'settings.js');
  const bang = spawnSync(process.execPath, [script, 'uncertain', 'block'], {
    cwd: project.dir,
    encoding: 'utf8',
    env: envOf(project, { CLAUDE_CODE_SESSION_ID: 'sess-u' }),
  });
  assert.match(bang.stdout, /^Nothing changed/mu);
  const config = path.join(project.home, 'config.env');
  assert.equal(existsSync(config), false);
  const hook = runHook(
    'user-prompt-submit',
    {
      session_id: 'sess-u',
      prompt: '/zeroh-disclosure:settings uncertain block',
    },
    { project },
  );
  assert.equal(hook.json?.decision, 'block', hook.stderr);
  assert.match(hook.json.reason, /Uncertain cases: block/u);
  assert.match(readFileSync(config, 'utf8'), /^ZEROH_UNCERTAIN=block$/mu);
  const shown = spawnSync(process.execPath, [script], {
    cwd: project.dir,
    encoding: 'utf8',
    env: envOf(project),
  });
  assert.match(shown.stdout, /^Uncertain cases: block/mu);
});

test('a failure in the management path never stops an ordinary prompt', () => {
  const project = tempProject();
  // An authz folder that cannot be read: a file where the folder should be.
  mkdirSync(path.join(project.home, 'run'), { recursive: true });
  writeFileSync(path.join(project.home, 'run', 'authz'), 'not a folder');
  const ordinary = runHook(
    'user-prompt-submit',
    { session_id: 'sess-f', prompt: 'List the build steps' },
    { project },
  );
  assert.equal(ordinary.code, 0, ordinary.stderr);
  assert.notEqual(ordinary.json?.decision, 'block');
  const command = runHook(
    'user-prompt-submit',
    { session_id: 'sess-f', prompt: '/zeroh-disclosure:proxy off' },
    { project },
  );
  assert.equal(command.json?.decision, 'block');
  assert.match(command.json.reason, /^Nothing changed/u);
});
