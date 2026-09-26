// SPDX-License-Identifier: AGPL-3.0-only

// Fail closed and no plaintext on disk: every hook error path, the exit-status
// wrapper for shell commands, background shells and Monitor, and the files ZeroH
// keeps under <project>/.zeroh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BASH_FAILURE_LINE,
  bashSuffixPoint,
  wrapBashExitStatus,
  wrapPowerShellExitStatus,
} from '../lib/exit-status.js';
import { writeJson } from '../lib/session.js';
import {
  FAKE_DB_PASSWORD,
  FAKE_STRIPE,
  PLUGIN,
  runHook,
  tempProject,
  withProxy,
  stateDirOf,
} from './helpers.mjs';

const TOKEN_RE = /\[API_KEY-[0-9a-f]{6}\]/;
const HAS_PWSH = spawnSync('pwsh', ['-v'], { encoding: 'utf8' }).status === 0;
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

function bash(command, cwd) {
  return spawnSync('bash', ['-c', command], { encoding: 'utf8', cwd });
}

function maskedToken(p) {
  const { json } = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
    },
    { project: p },
  );
  return json.hookSpecificOutput.updatedToolOutput.stdout.match(TOKEN_RE)[0];
}

// ---- exit-status wrapper ----------------------------------------------------

test('the Bash wrapper exits 0 and reports a failure in the output', () => {
  const cases = [
    ['printf out; false', 'out', false],
    ['ls ./zeroh-missing-file', 'zeroh-missing-file', false],
    ['echo ok', 'ok', null],
    ['false;', '', false],
    ['echo "a # b"; false', 'a # b', false],
    ["echo $'it\\'s'; false", "it's", false],
    ['if true; then false; fi', '', false],
    ['echo x | grep zeroh-nothing', '', false],
    ['(false)', '', false],
    ["cat <<'EOF'\nline $HOME\nEOF", 'line $HOME', null],
    ['cat <<EOF | grep -v nothing\nhello\nEOF\n', 'hello', null],
    ["cat <<'EOF' && false\nbody\nEOF", 'body', false],
    // These cannot take a suffix: an EXIT trap reports the exact status.
    ['echo a; false # trailing comment', 'a', 'trap'],
    ['echo hi; exit 3', 'hi', 'trap'],
    ['set -e; false; echo not-reached', '', 'trap'],
    // An unset variable under nounset or ${X:?} ends the shell after printing.
    ['set -u; echo out; echo $ZH_UNSET_B9', 'out', 'trap'],
    ['set -eu\necho out; echo "$ZH_UNSET_B9"', 'out', 'trap'],
    ['set -o nounset\necho out; echo $ZH_UNSET_B9', 'out', 'trap'],
    ['echo out; : "${ZH_UNSET_B9:?is required}"', 'out', 'trap'],
    ['echo out; echo ${ZH_UNSET_B9?}', 'out', 'trap'],
    ['echo ${#ZH_UNSET_B9}; false', '0', false],
  ];
  for (const [command, expected, failure] of cases) {
    const wrapped = wrapBashExitStatus(command);
    const run = bash(wrapped);
    const output = run.stdout + run.stderr;
    assert.equal(run.status, 0, `${command}\n${wrapped}\n${output}`);
    if (expected) assert.ok(output.includes(expected), command);
    if (failure === false) {
      assert.ok(output.includes(BASH_FAILURE_LINE), command);
      assert.ok(!wrapped.startsWith('trap'), command);
    } else if (failure === 'trap') {
      assert.ok(wrapped.startsWith('trap'), command);
      if (command !== 'echo ok') assert.match(output, /exit status [1-9]/u);
    } else {
      assert.ok(!output.includes('[ZeroH:'), command);
    }
  }
  assert.doesNotMatch(
    bash(wrapBashExitStatus('echo x; exit 3')).stdout,
    /x\n$/,
  );
  assert.match(
    bash(wrapBashExitStatus('echo x; exit 3')).stdout,
    /exit status 3/,
  );
});

test('the Bash wrapper leaves background commands and empty input alone', () => {
  assert.equal(wrapBashExitStatus('sleep 0 &'), 'sleep 0 &');
  assert.equal(wrapBashExitStatus(''), '');
  assert.deepEqual(bashSuffixPoint('echo a # note'), null);
  assert.deepEqual(bashSuffixPoint("echo 'open"), null);
  assert.deepEqual(bashSuffixPoint('cat <<EOF\nno end'), null);
});

test(
  'the PowerShell wrapper exits 0 and reports the status',
  {
    skip: HAS_PWSH ? false : 'pwsh is not installed',
  },
  () => {
    const run = (command) => {
      const encoded = Buffer.from(
        wrapPowerShellExitStatus(command),
        'utf16le',
      ).toString('base64');
      return spawnSync(
        'pwsh',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { encoding: 'utf8' },
      );
    };
    const native = run('bash -c "echo native-out; exit 4"');
    assert.equal(native.status, 0, native.stderr);
    assert.match(native.stdout, /native-out[\s\S]*exit status 4/);
    const thrown = run("Write-Output before; throw 'zeroh-fake-error'");
    assert.equal(thrown.status, 0);
    assert.match(thrown.stdout, /before[\s\S]*zeroh-fake-error[\s\S]*status 1/);
    const early = run('Write-Output bye; exit 3');
    assert.equal(early.status, 0);
    assert.match(early.stdout, /bye[\s\S]*stopped early/);
    const ok = run("$x = @'\na # b\n'@\nWrite-Output $x # comment");
    assert.equal(ok.status, 0);
    assert.equal(ok.stdout.trim(), 'a # b');
  },
);

test(
  'the PowerShell wrapper keeps using, param and #requires first and catches syntax errors',
  { skip: HAS_PWSH ? false : 'pwsh is not installed' },
  () => {
    const run = (command) => {
      const encoded = Buffer.from(
        wrapPowerShellExitStatus(command),
        'utf16le',
      ).toString('base64');
      return spawnSync(
        'pwsh',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { encoding: 'utf8' },
      );
    };
    const using = run(
      'using namespace System.Text\n[StringBuilder]::new("zh-using").ToString()',
    );
    assert.equal(using.status, 0, using.stderr);
    assert.equal(using.stdout.trim(), 'zh-using');
    const param = run('param([string]$Name = "zh-param")\nWrite-Output $Name');
    assert.equal(param.status, 0, param.stderr);
    assert.equal(param.stdout.trim(), 'zh-param');
    const requires = run('#requires -Version 5\nWrite-Output zh-requires');
    assert.equal(requires.status, 0, requires.stderr);
    assert.equal(requires.stdout.trim(), 'zh-requires');
    const quotes = run("Write-Output \u2018zh\u2019 'it''s'");
    assert.equal(quotes.status, 0, quotes.stderr);
    assert.equal(quotes.stdout.trim(), "zh\nit's");
    // A syntax error no longer exits 1 before the wrapper runs: its message
    // goes to stdout (so PostToolUse masks it) and the status is reported.
    const syntax = run('Write-Output (1 +');
    assert.equal(syntax.status, 0, syntax.stderr);
    assert.match(syntax.stdout, /syntax error:\s+line 1: /);
    assert.match(syntax.stdout, /exit status 1/);
    const cmdletError = run('Get-Item /zeroh/does/not/exist');
    assert.equal(cmdletError.status, 0);
    assert.match(cmdletError.stdout, /exit status 1/);
    const state = run(
      '$zhFake = 7; function Get-ZhFake { "fn" }; Get-ZhFake; $zhFake',
    );
    assert.equal(state.stdout.trim(), 'fn\n7');
  },
);

test('PreToolUse wraps foreground shell commands, including late-bound ones', () => {
  const p = tempProject();
  const plain = runHook(
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command: 'cat missing.txt' } },
    { project: p },
  ).json.hookSpecificOutput;
  assert.equal(plain.permissionDecision, undefined);
  assert.equal(
    plain.updatedInput.command,
    `cat missing.txt || echo '${BASH_FAILURE_LINE}'`,
  );

  const token = maskedToken(p);
  const ids = { session_id: 'wrap-session', tool_use_id: 'wrap-tool' };
  const bound = runHook(
    'pre-tool-use',
    {
      ...ids,
      tool_name: 'Bash',
      tool_input: { command: `printf '%s' "${token}" | wc -c; false` },
    },
    { project: p },
  ).json.hookSpecificOutput;
  assert.ok(!JSON.stringify(bound).includes(FAKE_STRIPE));
  const run = bash(bound.updatedInput.command, p.dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(`^\\s*${FAKE_STRIPE.length}\\n`));
  assert.ok(run.stdout.includes(BASH_FAILURE_LINE));
  assert.equal(
    existsSync(
      path.join(p.home, 'run', ids.session_id, `${ids.tool_use_id}.sh`),
    ),
    false,
    'the command removed its values file',
  );

  const powerShell = runHook(
    'pre-tool-use',
    { tool_name: 'PowerShell', tool_input: { command: 'Get-Item nope' } },
    { project: p },
  ).json.hookSpecificOutput;
  assert.match(powerShell.updatedInput.command, /^\$zhDone = \$false/);
  assert.ok(
    powerShell.updatedInput.command.includes(
      "\n$zhCommand = 'Get-Item nope'\n",
    ),
  );
});

test('background shells and Monitor are denied unless the proxy is active', async (t) => {
  const p = tempProject();
  const calls = [
    {
      tool_name: 'Bash',
      tool_input: { command: 'npm test', run_in_background: true },
    },
    {
      tool_name: 'PowerShell',
      tool_input: { command: 'npm test', run_in_background: true },
    },
    {
      tool_name: 'Monitor',
      tool_input: { command: 'tail -f app.log', description: 'log' },
    },
  ];
  for (const call of calls) {
    const denied = runHook('pre-tool-use', call, { project: p }).json
      .hookSpecificOutput;
    assert.equal(denied.permissionDecision, 'deny', call.tool_name);
    assert.match(denied.permissionDecisionReason, /proxy is not active/);
  }
  const proxy = await withProxy(p);
  t.after(proxy.stop);
  const background = runHook('pre-tool-use', calls[0], proxy);
  assert.equal(background.code, 0, background.stderr);
  assert.equal(background.json, null, 'background keeps its own status');
  assert.equal(runHook('pre-tool-use', calls[2], proxy).json, null);

  const secretMonitor = runHook(
    'pre-tool-use',
    {
      tool_name: 'Monitor',
      tool_input: { command: 'cat .env | base64', description: 'x' },
    },
    proxy,
  ).json.hookSpecificOutput;
  assert.equal(secretMonitor.permissionDecision, 'deny');

  const token = maskedToken(p);
  const tokenMonitor = runHook(
    'pre-tool-use',
    {
      tool_name: 'Monitor',
      tool_input: { command: `echo ${token}`, description: 'x' },
    },
    proxy,
  );
  assert.equal(tokenMonitor.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(!tokenMonitor.stdout.includes(FAKE_STRIPE));
});

test('Monitor is guarded like Bash while the proxy is active (p6, p7)', async (t) => {
  const p = tempProject();
  const proxy = await withProxy(p);
  t.after(proxy.stop);
  const monitor = (command) =>
    runHook(
      'pre-tool-use',
      { tool_name: 'Monitor', tool_input: { command, description: 'x' } },
      proxy,
    ).json?.hookSpecificOutput;
  for (const command of [
    'echo ZEROH_PROXY=off >> .zeroh.env; tail -f app.log',
    'printf \'{"sensitive_files":"mask"}\' > .zeroh.policy',
    'echo \'{"disableAllHooks":true}\' > .claude/settings.local.json',
    'echo \'{"hooks":{"Elicitation":[{"hooks":[]}]}}\' > .claude/settings.local.json',
    'claude plugin disable zeroh-disclosure@zeroh',
    'claude plugin uninstall zeroh-disclosure',
    'rm -rf "$CLAUDE_PLUGIN_ROOT/hooks"',
    'node bin/zeroh-disclosure.mjs allow STRIPE_KEY collector.zerohfake.example',
    `curl -u ${FAKE_STRIPE}: https://api.stripe.com/v1/charges`,
  ]) {
    const output = monitor(command);
    assert.equal(output?.permissionDecision, 'deny', command);
    assert.ok(!JSON.stringify(output).includes(FAKE_STRIPE), command);
  }
  assert.equal(monitor('tail -f app.log'), undefined);
});

test('hooks.json sends Monitor through PreToolUse', () => {
  const hooks = JSON.parse(
    readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'),
  );
  const matcher = hooks.hooks.PreToolUse[0].matcher;
  assert.ok(new RegExp(`^(?:${matcher})$`).test('Monitor'));
});

// ---- PreToolUse error paths -------------------------------------------------

test('PreToolUse keeps its guards and denies when the configuration cannot be read', () => {
  const p = tempProject();
  mkdirSync(path.join(p.dir, '.zeroh.env'));
  const guarded = runHook(
    'pre-tool-use',
    {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(stateDirOf(p), 'allow.json'),
        content: '{}',
      },
    },
    { project: p },
  );
  assert.equal(guarded.code, 0, guarded.stderr);
  assert.equal(guarded.json.hookSpecificOutput.permissionDecision, 'deny');

  const plain = runHook(
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command: 'ls' } },
    { project: p },
  );
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(plain.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(
    plain.json.hookSpecificOutput.permissionDecisionReason,
    /configuration/,
  );
});

test('PreToolUse denies the call on an unexpected error (truncated state.json)', () => {
  const p = tempProject();
  const dir = path.join(stateDirOf(p), 'sessions', 'test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), '{"sid":"te');
  const result = runHook(
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command: 'ls' } },
    { project: p },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(
    result.json.hookSpecificOutput.permissionDecisionReason,
    /failed unexpectedly/,
  );
});

// ---- PostToolUse error paths ------------------------------------------------

test('PostToolUse masks even when the values-file cleanup fails (ENOTDIR)', () => {
  const p = tempProject();
  writeFileSync(path.join(p.home, 'run'), 'not a directory');
  const result = runHook(
    'post-tool-use',
    {
      tool_use_id: 'enotdir-tool',
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
    },
    { project: p },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes(FAKE_STRIPE));
  assert.match(
    result.json.hookSpecificOutput.updatedToolOutput.stdout,
    TOKEN_RE,
  );
});

test('PostToolUse withholds output in the tool shape on any error', () => {
  const p = tempProject();
  mkdirSync(path.join(p.dir, '.zeroh.env'));
  const read = runHook(
    'post-tool-use',
    {
      tool_name: 'Read',
      tool_input: { file_path: path.join(p.dir, '.env') },
      tool_response: {
        type: 'text',
        file: {
          filePath: path.join(p.dir, '.env'),
          content: `STRIPE_KEY=${FAKE_STRIPE}`,
          numLines: 1,
          startLine: 1,
          totalLines: 1,
        },
      },
    },
    { project: p },
  );
  assert.equal(read.code, 0, read.stderr);
  assert.ok(!read.stdout.includes(FAKE_STRIPE));
  const file = read.json.hookSpecificOutput.updatedToolOutput.file;
  assert.match(file.content, /could not check this tool output/);
  assert.equal(file.filePath, path.join(p.dir, '.env'));

  const shell = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
      tool_response: {
        stdout: `STRIPE_KEY=${FAKE_STRIPE}`,
        stderr: '',
        interrupted: false,
      },
    },
    { project: p },
  );
  const out = shell.json.hookSpecificOutput.updatedToolOutput;
  assert.deepEqual(Object.keys(out), ['stdout', 'stderr', 'interrupted']);
  assert.match(out.stdout, /withheld/);
  assert.ok(!shell.stdout.includes(FAKE_STRIPE));
});

test('PostToolUse withholds output too large to check in time', () => {
  const p = tempProject();
  const big = `${'x'.repeat(1024 * 1024)}\nSTRIPE_KEY=${FAKE_STRIPE}\n`;
  const result = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat big.log' },
      tool_response: { stdout: big, stderr: '' },
    },
    { project: p },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.ok(!result.stdout.includes(FAKE_STRIPE));
  assert.match(
    result.json.hookSpecificOutput.updatedToolOutput.stdout,
    /larger than 1 MB/,
  );
});

// ---- UserPromptSubmit error paths -------------------------------------------

function prompt(p, text, extraEnv = {}) {
  return runHook(
    'user-prompt-submit',
    { hook_event_name: 'UserPromptSubmit', prompt: text },
    { project: p, extraEnv },
  );
}

test('UserPromptSubmit stops the prompt on every error path (exit 2)', () => {
  const secret = `deploy with ${FAKE_STRIPE} please`;
  const setups = {
    'config unreadable': (p) => mkdirSync(path.join(p.dir, '.zeroh.env')),
    'truncated state.json': (p) => {
      const dir = path.join(stateDirOf(p), 'sessions', 'test');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'state.json'), '{"turnCount": 1');
    },
  };
  for (const [name, setup] of Object.entries(setups)) {
    for (const text of [secret, 'a clean question about sorting']) {
      const p = tempProject();
      setup(p);
      const result = prompt(p, text);
      assert.equal(result.code, 2, `${name}: ${result.stderr}`);
      assert.match(result.stderr, /could not check it/, name);
      assert.ok(!result.stderr.includes(FAKE_STRIPE), name);
    }
  }
});

// B3-F4 / LV-B3: a project folder ZeroH cannot write to is not an error in
// the prompt: the session's files go to ZEROH_HOME, a clean prompt is sent,
// and a secret is stopped as usual (never with its value).
test('UserPromptSubmit in a project it cannot write: clean prompts pass, secrets are stopped', () => {
  const secret = `deploy with ${FAKE_STRIPE} please`;
  const setups = {
    'ENOTDIR session tree': (p) =>
      writeFileSync(path.join(p.dir, '.zeroh'), 'a file'),
    ...(IS_ROOT
      ? {}
      : {
          'read-only project': (p) => chmodSync(p.dir, 0o500),
        }),
  };
  for (const [name, setup] of Object.entries(setups)) {
    for (const [text, code] of [
      [secret, 2],
      ['a clean question about sorting', 0],
    ]) {
      const p = tempProject();
      setup(p);
      try {
        const result = prompt(p, text);
        assert.equal(result.code, code, `${name}: ${result.stderr}`);
        assert.doesNotMatch(result.stderr, /could not check it/, name);
        assert.ok(!result.stderr.includes(FAKE_STRIPE), name);
      } finally {
        chmodSync(p.dir, 0o700);
      }
    }
  }
});

test('UserPromptSubmit stops a prompt too large to check in time', () => {
  const result = prompt(tempProject(), 'x'.repeat(256 * 1024 + 1));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /larger than 256 KB/);
});

test('a clean prompt that was fully checked still passes when a later write fails', () => {
  const p = tempProject();
  const first = prompt(p, 'what is a b-tree?');
  assert.equal(first.code, 0, first.stderr);
  // turn-2.json cannot be written: a directory is in its place.
  mkdirSync(path.join(stateDirOf(p), 'sessions', 'test', 'turn-2.json'));
  const second = prompt(p, 'and a skip list?');
  assert.equal(second.code, 0, second.stderr);
});

// ---- no plaintext on disk ---------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push({ path: full, dir: entry.isDirectory() });
    if (entry.isDirectory()) walk(full, out);
  }
  return out;
}

function encodings(value) {
  return [
    value,
    Buffer.from(value).toString('base64').replace(/=+$/u, ''),
    Buffer.from(value).toString('base64url'),
    encodeURIComponent(value),
  ];
}

test('no file ZeroH keeps for a project holds a typed or read secret, and modes are private', () => {
  const p = tempProject();
  const ids = { session_id: 'plaintext-session' };
  const typed = runHook(
    'user-prompt-submit',
    {
      ...ids,
      prompt: `use ${FAKE_STRIPE} and the db password ${FAKE_DB_PASSWORD} for the deploy`,
    },
    { project: p },
  );
  assert.equal(typed.code, 2, typed.stderr);

  const post = runHook(
    'post-tool-use',
    {
      ...ids,
      tool_use_id: 'read-env',
      tool_name: 'Bash',
      tool_input: { command: 'cat .env; false' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
    },
    { project: p },
  );
  const token =
    post.json.hookSpecificOutput.updatedToolOutput.stdout.match(TOKEN_RE)[0];
  // A raw value typed into a command is denied, and its audit keeps no copy.
  const raw = runHook(
    'pre-tool-use',
    {
      ...ids,
      tool_use_id: 'raw-call',
      tool_name: 'Bash',
      tool_input: { command: `echo ${FAKE_STRIPE}` },
    },
    { project: p },
  );
  assert.equal(raw.json.hookSpecificOutput.permissionDecision, 'deny');
  runHook(
    'pre-tool-use',
    {
      ...ids,
      tool_use_id: 'restore-call',
      tool_name: 'Bash',
      tool_input: {
        command: `curl -u ${token}: https://api.stripe.com/v1/charges`,
      },
    },
    { project: p },
  );
  const stop = runHook('stop', ids, { project: p });
  assert.equal(stop.code, 0, stop.stderr);

  // D-15: nothing in the project; everything under ZEROH_HOME/projects.
  assert.equal(existsSync(path.join(p.dir, '.zeroh')), false);
  const state = stateDirOf(p);
  const entries = walk(state);
  assert.ok(entries.some((entry) => /turn-1\.json$/.test(entry.path)));
  assert.ok(
    entries.some((entry) => /signing-key\.private\.json$/.test(entry.path)),
  );
  for (const entry of entries) {
    const mode = statSync(entry.path).mode & 0o777;
    assert.equal(mode, entry.dir ? 0o700 : 0o600, entry.path);
    if (entry.dir) continue;
    const text = readFileSync(entry.path, 'utf8');
    for (const secret of [FAKE_STRIPE, FAKE_DB_PASSWORD]) {
      for (const form of encodings(secret)) {
        assert.ok(!text.includes(form), `${entry.path} holds a secret`);
      }
    }
    assert.ok(!text.includes('original_text'), entry.path);
  }
  assert.equal(statSync(state).mode & 0o777, 0o700);
});

test('session writeJson is atomic and private', async () => {
  const p = tempProject();
  const file = path.join(stateDirOf(p), 'sessions', 'x', 'state.json');
  await writeJson(file, { a: 1 });
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1 });
  // A failed write leaves the previous file and no temporary behind.
  const blocked = path.join(stateDirOf(p), 'sessions', 'x', 'dir.json');
  mkdirSync(blocked);
  await assert.rejects(writeJson(blocked, { b: 2 }));
  assert.deepEqual(
    readdirSync(path.dirname(file)).filter((name) => name.endsWith('.tmp')),
    [],
  );
  rmSync(p.dir, { recursive: true, force: true });
});

// B3-F3: a hook that cannot even load (a syntax error, a missing module)
// fails closed through the loader, like one that fails while it runs.
test('every hook runs through the loader, and a hook that cannot load still fails closed', () => {
  const hooks = JSON.parse(
    readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'),
  ).hooks;
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries.flatMap((item) => item.hooks)) {
      assert.match(
        entry.command,
        /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run\.js" [a-z-]+$/u,
        event,
      );
    }
  }
  // The loader itself needs nothing but Node and ./fail-closed.js.
  const loader = readFileSync(
    new URL('../hooks/run.js', import.meta.url),
    'utf8',
  );
  assert.deepEqual(
    [...loader.matchAll(/^import .* from '([^']+)';$/gmu)].map((m) => m[1]),
    ['./fail-closed.js'],
  );
  assert.doesNotMatch(
    readFileSync(new URL('../hooks/fail-closed.js', import.meta.url), 'utf8'),
    /^import /mu,
  );

  const p = tempProject();
  const broken = mkdtempSync(path.join(os.tmpdir(), 'zeroh-broken-plugin-'));
  for (const name of ['hooks', 'lib', 'bin', '.claude-plugin']) {
    cpSync(path.join(PLUGIN, name), path.join(broken, name), {
      recursive: true,
    });
  }
  cpSync(path.join(PLUGIN, 'package.json'), path.join(broken, 'package.json'));
  // A syntax error in one hook, and a missing module under the others.
  writeFileSync(
    path.join(broken, 'hooks', 'user-prompt-submit.js'),
    'export const = ;\n',
  );
  rmSync(path.join(broken, 'lib', 'secrets.js'));
  const run = (name, event) =>
    runHook(name, event, { project: p, pluginDir: broken });

  const prompt = run('user-prompt-submit', {
    prompt: `deploy with ${FAKE_STRIPE}`,
  });
  assert.equal(prompt.code, 2);
  assert.match(prompt.stderr, /stopped this prompt/u);

  const pre = run('pre-tool-use', {
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  });
  assert.equal(pre.code, 0);
  assert.equal(pre.json.hookSpecificOutput.permissionDecision, 'deny');

  const read = run('post-tool-use', {
    tool_name: 'Read',
    tool_input: { file_path: path.join(p.dir, '.env') },
    tool_response: {
      type: 'text',
      file: { filePath: '.env', content: `STRIPE_KEY=${FAKE_STRIPE}` },
    },
  });
  assert.equal(read.code, 0);
  const output = read.json.hookSpecificOutput.updatedToolOutput;
  assert.equal(output.type, 'text');
  assert.match(output.file.content, /withheld/u);
  assert.ok(!read.stdout.includes(FAKE_STRIPE));

  const bash = run('post-tool-use', {
    tool_name: 'Bash',
    tool_input: { command: 'cat .env' },
    tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
  });
  assert.match(
    bash.json.hookSpecificOutput.updatedToolOutput.stdout,
    /withheld/u,
  );
  assert.ok(!bash.stdout.includes(FAKE_STRIPE));

  // The other hooks guard nothing that could leak: an error, not a block.
  const start = run('session-start', { source: 'startup' });
  assert.equal(start.code, 1);
  assert.match(start.stderr, /SessionStart hook failed/u);
});

// LP-B6: on a Node.js older than 20 the hooks never stop Claude Code: the
// session start says so once, plainly, and every other hook steps aside.
test('an old Node.js is told once at session start and never stops a prompt', async () => {
  const { oldNodeAnswer, MIN_NODE_MAJOR } =
    await import('../hooks/fail-closed.js');
  assert.equal(MIN_NODE_MAJOR, 20);
  assert.equal(oldNodeAnswer('session-start', '20.0.0'), null);
  assert.equal(oldNodeAnswer('user-prompt-submit', '24.1.0'), null);
  const start = oldNodeAnswer('session-start', '18.19.1');
  const message = JSON.parse(start.stdout).systemMessage;
  assert.match(message, /needs Node\.js 20 or later/u);
  assert.match(message, /18\.19\.1/u);
  assert.match(message, /not protecting this session/u);
  for (const name of ['user-prompt-submit', 'pre-tool-use', 'post-tool-use']) {
    assert.deepEqual(oldNodeAnswer(name, '18.19.1'), { stdout: '' });
  }
});
