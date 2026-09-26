// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  wrapBashExitStatus,
  wrapPowerShellExitStatus,
} from '../lib/exit-status.js';
import {
  cleanupStaleRunFiles,
  gitBashPath,
  LOAD_FAILURE_LINE,
  prepareBashLateBinding,
  preparePowerShellLateBinding,
  rewriteBashCommand,
  rewritePowerShellCommand,
  RUN_FILE_MAX_AGE_MS,
  valuesFilePath,
} from '../lib/late-bind.js';

const TOKEN = '[API_KEY-7a3f9e]';
const TOKEN_2 = '[SECRET-123abc]';
const HARD_TOKEN = '[API_KEY-acde12]';
const VALUE = "fake' value $dollar";
const VALUE_2 = "other' secret $cash";
const HARD_VALUE =
  'ZEROHFAKE quote\' double" dollar$ backtick` slash\\ space\nnext';

function vault() {
  const entries = new Map([
    [TOKEN, { type: 'API_KEY', value: VALUE, source: 'known:TEST_KEY' }],
    [TOKEN_2, { type: 'SECRET', value: VALUE_2, source: 'detected' }],
    [
      HARD_TOKEN,
      { type: 'API_KEY', value: HARD_VALUE, source: 'known:HARD_KEY' },
    ],
  ]);
  return { entryOf: (token) => entries.get(token) || null };
}

function temp() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-late-bind-'));
  return { dir, home: path.join(dir, 'zeroh-home') };
}

function prepare(command, options = {}) {
  const t = temp();
  return {
    ...t,
    result: prepareBashLateBinding({
      command,
      vault: vault(),
      sessionId: options.sessionId || 'session',
      toolUseId: options.toolUseId || 'tool',
      home: t.home,
    }),
  };
}

function preparePowerShell(command, options = {}) {
  const t = temp();
  return {
    ...t,
    result: preparePowerShellLateBinding({
      command,
      vault: vault(),
      sessionId: options.sessionId || 'session',
      toolUseId: options.toolUseId || 'tool',
      home: t.home,
    }),
  };
}

function execute(command, output = 'argv') {
  const prepared = prepare(command);
  assert.equal(prepared.result.ok, true);
  const run = spawnSync('bash', ['-c', prepared.result.command], {
    cwd: prepared.dir,
    encoding: 'buffer',
  });
  assert.equal(run.status, 0, run.stderr.toString('utf8'));
  assert.equal(existsSync(prepared.result.file), false);
  return readFileSync(path.join(prepared.dir, output));
}

const localPwsh = path.join(os.homedir(), '.local', 'bin', 'pwsh');
const pwsh = existsSync(localPwsh) ? localPwsh : 'pwsh';
const pwshAvailable =
  spawnSync(pwsh, ['-NoProfile', '-Command', 'exit 0']).status === 0;

function executePowerShell(command, output = 'argv') {
  const prepared = preparePowerShell(command);
  assert.equal(prepared.result.ok, true, prepared.result.reason);
  const run = spawnSync(
    pwsh,
    ['-NoProfile', '-Command', prepared.result.command],
    { cwd: prepared.dir, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(prepared.result.file), false);
  return readFileSync(path.join(prepared.dir, output), 'utf8');
}

test('scanner rewrites every supported shell quoting context', () => {
  assert.equal(
    rewriteBashCommand(`echo ${TOKEN}`, vault()).command,
    'echo "${ZH_API_KEY_7a3f9e}"',
  );
  assert.equal(
    rewriteBashCommand(`echo "${TOKEN}"`, vault()).command,
    'echo "${ZH_API_KEY_7a3f9e}"',
  );
  assert.equal(
    rewriteBashCommand(`echo '${TOKEN}'`, vault()).command,
    `echo ''"\${ZH_API_KEY_7a3f9e}"''`,
  );
  assert.equal(
    rewriteBashCommand(`cat <<EOF\n${TOKEN}\nEOF`, vault()).command,
    'cat <<EOF\n${ZH_API_KEY_7a3f9e}\nEOF',
  );

  const ansi = rewriteBashCommand(`echo $'a${TOKEN}b'`, vault());
  assert.equal(ansi.ok, true);
  assert.equal(ansi.command, `echo $'a'"\${ZH_API_KEY_7a3f9e}"$'b'`);
  const quotedHeredoc = rewriteBashCommand(
    `cat <<'EOF'\n${TOKEN}\nEOF`,
    vault(),
  );
  assert.equal(quotedHeredoc.ok, true);
  assert.equal(quotedHeredoc.command, `cat <<EOF\n\${ZH_API_KEY_7a3f9e}\nEOF`);
});

test('PowerShell scanner applies the context replacement matrix', () => {
  assert.equal(
    rewritePowerShellCommand(`Write-Output ${TOKEN}`, vault()).command,
    'Write-Output ${ZH_API_KEY_7a3f9e}',
  );
  assert.equal(
    rewritePowerShellCommand(`Write-Output "${TOKEN}"`, vault()).command,
    'Write-Output "${ZH_API_KEY_7a3f9e}"',
  );
  assert.equal(
    rewritePowerShellCommand(`$value = 'before ${TOKEN} after'`, vault())
      .command,
    '$value = "before ${ZH_API_KEY_7a3f9e} after"',
  );

  assert.equal(
    rewritePowerShellCommand(`Write-Output '${TOKEN}'`, vault()).command,
    'Write-Output "${ZH_API_KEY_7a3f9e}"',
  );
  assert.equal(
    rewritePowerShellCommand(`Write-Output prefix'${TOKEN}'`, vault()).command,
    'Write-Output prefix"${ZH_API_KEY_7a3f9e}"',
  );
  assert.equal(
    rewritePowerShellCommand(`Write-Output ${TOKEN}suffix`, vault()).command,
    'Write-Output ${ZH_API_KEY_7a3f9e}suffix',
  );

  assert.equal(
    rewritePowerShellCommand(`@"\n${TOKEN}\n"@`, vault()).command,
    `@"\n\${ZH_API_KEY_7a3f9e}\n"@`,
  );
  assert.equal(
    rewritePowerShellCommand(`@'\n${TOKEN}\n'@`, vault()).command,
    `@"\n\${ZH_API_KEY_7a3f9e}\n"@`,
  );
});

test('PowerShell scanner denies unsafe single here-string conversion', () => {
  const result = rewritePowerShellCommand(
    `Write-Output @'\n${TOKEN}\n  "@\n'@`,
    vault(),
  );
  assert.equal(result.ok, false);
  assert.match(
    result.reason,
    /single-quoted here-string.*terminate.*double-quoted here-string/,
  );
});

test('PowerShell scanner handles comments, backtick escapes, and CRLF', () => {
  const command = [
    `# ${TOKEN} stays masked`,
    `Write-Output \`${TOKEN}`,
    `<# ${TOKEN} stays masked #>`,
    `Write-Output "${TOKEN}"`,
  ].join('\r\n');
  const result = rewritePowerShellCommand(command, vault());
  assert.equal(result.ok, true);
  assert.equal(result.bindings.length, 1);
  assert.match(result.command, /# \[API_KEY-7a3f9e\] stays masked\r\n/);
  assert.match(result.command, /Write-Output \$\{ZH_API_KEY_7a3f9e\}\r\n/);
  assert.match(result.command, /<# \[API_KEY-7a3f9e\] stays masked #>/);
  assert.match(result.command, /"\$\{ZH_API_KEY_7a3f9e\}"/);
  assert.ok(result.command.includes('\r\n'));
});

test('Bash scanner preserves CRLF immediately after a token', () => {
  const result = rewriteBashCommand(`printf '%s' ${TOKEN}\r\n`, vault());
  assert.equal(result.ok, true);
  assert.equal(result.command, `printf '%s' "\${ZH_API_KEY_7a3f9e}"\r\n`);
});

test('scanner rewrites tokens inside nested command substitutions', () => {
  const cases = [
    `"$(echo '${TOKEN}')"`,
    `\`echo ${TOKEN}\``,
    `$(printf %s "${TOKEN}")`,
    `$(printf %s "$(printf %s '${TOKEN}')")`,
    `$(printf '%s)' ${TOKEN})`,
  ];
  for (const command of cases) {
    const result = rewriteBashCommand(command, vault());
    assert.equal(result.ok, true, command);
    assert.equal(result.bindings.length, 1, command);
  }
});

test('Bash scanner balances case clauses and ignores shifts in arithmetic expansion', () => {
  const caseResult = rewriteBashCommand(
    `x="$(case "$e" in prod) echo ${TOKEN};; esac)"; echo "$x"`,
    vault(),
  );
  assert.equal(caseResult.ok, true, caseResult.reason);
  assert.equal(caseResult.bindings.length, 1);

  const arithmeticResult = rewriteBashCommand(
    `echo $((1<<4)) ${TOKEN}`,
    vault(),
  );
  assert.equal(arithmeticResult.ok, true, arithmeticResult.reason);
  assert.equal(arithmeticResult.bindings.length, 1);
});

test('former Bash fallbacks execute with the exact hard value', () => {
  const cases = [
    `printf '%s\\0' "$(printf '%s' ${HARD_TOKEN})" > argv`,
    `printf '%s\\0' "$(printf '%s' "$(printf '%s' '${HARD_TOKEN}')")" > argv`,
    `printf '%s\\0' "\`printf '%s' ${HARD_TOKEN}\`" > argv`,
    `printf '%s\\0' "\`printf '%s' \\${HARD_TOKEN}\`" > argv`,
    `printf '%s\\0' $'${HARD_TOKEN}' > argv`,
  ];
  for (const command of cases) {
    assert.deepEqual(execute(command), Buffer.from(`${HARD_VALUE}\0`), command);
  }
});

test('quoted Bash heredocs preserve special bytes, tab stripping, and backslash-newline', () => {
  for (const opener of ["<<'EOF'", '<<"EOF"', '<<\\EOF']) {
    assert.deepEqual(
      execute(`cat ${opener} > argv\n${HARD_TOKEN}\nEOF`),
      Buffer.from(`${HARD_VALUE}\n`),
      opener,
    );
  }
  assert.deepEqual(
    execute(`cat <<-'EOF' > argv\n\t${HARD_TOKEN}\n\tEOF`),
    Buffer.from(`${HARD_VALUE}\n`),
  );
  assert.deepEqual(
    execute(`cat <<'EOF' > argv\nbefore\\\n${HARD_TOKEN}\nEOF`),
    Buffer.from(`before\\\n${HARD_VALUE}\n`),
  );
});

test('Bash scanner denies unprovable syntax without writing a values file', () => {
  for (const command of [
    `printf '%s' '${TOKEN}`,
    `printf '%s' "$(${TOKEN}`,
    `cat <<'EOF'\n${TOKEN}`,
  ]) {
    const prepared = prepare(command);
    assert.equal(prepared.result.ok, false, command);
    assert.match(prepared.result.reason, /unterminated/);
    assert.equal(existsSync(path.join(prepared.home, 'run')), false);
  }
});

test('scanner handles escapes, comments, glued tokens, multiples, and operators', () => {
  const command = [
    `printf '%s' "escaped \\"quote\\" ${TOKEN}"`,
    `printf '%s' KEY=${TOKEN}`,
    `printf '%s' --token=${TOKEN}x`,
    `printf '%s' ${TOKEN} ${TOKEN_2} ${TOKEN}`,
    `printf '%s' ${TOKEN}; true && printf '%s' ${TOKEN} || false &`,
    `# ${TOKEN} remains masked in a comment`,
  ].join('\n');
  const result = rewriteBashCommand(command, vault());
  assert.equal(result.ok, true);
  assert.equal(result.bindings.length, 2);
  assert.match(result.command, /escaped \\"quote\\" \$\{ZH_API_KEY_7a3f9e\}/);
  assert.match(result.command, /KEY="\$\{ZH_API_KEY_7a3f9e\}"/);
  assert.match(result.command, /--token="\$\{ZH_API_KEY_7a3f9e\}"x/);
  assert.match(result.command, /; true && .* \|\| false &/);
  assert.match(result.command, /# \[API_KEY-7a3f9e\] remains masked/);
});

test('rewritten commands deliver exact values in unquoted, double, and single quotes', () => {
  const cases = [
    `printf '%s\\0' ${TOKEN} > argv`,
    `printf '%s\\0' "${TOKEN}" > argv`,
    `printf '%s\\0' '${TOKEN}' > argv`,
  ];
  for (const command of cases) {
    assert.deepEqual(execute(command), Buffer.from(`${VALUE}\0`));
  }
});

test('rewritten commands preserve glued values, multiple tokens, and duplicates', () => {
  assert.deepEqual(
    execute(`KEY=${TOKEN} bash -c 'printf "%s\\0" "$KEY"' > argv`),
    Buffer.from(`${VALUE}\0`),
  );
  assert.deepEqual(
    execute(`printf '%s\\0' --token=${TOKEN}x > argv`),
    Buffer.from(`--token=${VALUE}x\0`),
  );
  assert.deepEqual(
    execute(`printf '%s\\0' ${TOKEN} ${TOKEN_2} ${TOKEN} > argv`),
    Buffer.from(`${VALUE}\0${VALUE_2}\0${VALUE}\0`),
  );
});

test('rewritten unquoted heredoc expands the exact value', () => {
  assert.deepEqual(
    execute(`cat <<EOF > argv\n${TOKEN}\nEOF`),
    Buffer.from(`${VALUE}\n`),
  );
  assert.deepEqual(
    execute(`cat <<-EOF > argv\n\t${TOKEN}\n\tEOF`),
    Buffer.from(`${VALUE}\n`),
  );
});

test('wrapper preserves command-list and trailing background semantics', () => {
  const command = `printf '%s\\0' ${TOKEN} > first; false && printf bad || printf '%s\\0' ${TOKEN_2} > second &`;
  const prepared = prepare(command);
  const run = spawnSync('bash', ['-c', prepared.result.command], {
    cwd: prepared.dir,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    readFileSync(path.join(prepared.dir, 'first')),
    Buffer.from(`${VALUE}\0`),
  );
  assert.deepEqual(
    readFileSync(path.join(prepared.dir, 'second')),
    Buffer.from(`${VALUE_2}\0`),
  );
});

test('values file is private, shell-quoted, and removed after execution', () => {
  const prepared = prepare(`printf '%s\\0' ${TOKEN} > argv`);
  assert.equal(
    statSync(path.dirname(prepared.result.file)).mode & 0o777,
    0o700,
  );
  assert.equal(statSync(prepared.result.file).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(prepared.result.file, 'utf8'),
    `ZH_API_KEY_7a3f9e='fake'\\'' value $dollar'\n`,
  );
  assert.ok(!prepared.result.command.includes(VALUE));
  const run = spawnSync('bash', ['-c', prepared.result.command], {
    cwd: prepared.dir,
  });
  assert.equal(run.status, 0);
  assert.equal(existsSync(prepared.result.file), false);
});

test('PowerShell values file holds base64 lines read through .NET', () => {
  const prepared = preparePowerShell(`Write-Output ${TOKEN}`);
  assert.equal(path.extname(prepared.result.file), '.b64');
  assert.equal(
    readFileSync(prepared.result.file, 'utf8'),
    `ZH_API_KEY_7a3f9e=${Buffer.from(VALUE, 'utf8').toString('base64')}\n`,
  );
  assert.ok(!prepared.result.command.includes(VALUE));
  assert.match(prepared.result.command, /\[IO\.File\]::ReadAllLines\('/);
  assert.match(prepared.result.command, /could not load the restored values/);
  assert.match(
    prepared.result.command,
    /Remove-Item -LiteralPath .* -ErrorAction SilentlyContinue/,
  );
  assert.doesNotMatch(prepared.result.command, /catch \{ exit 1 \}/);
});

test('a Bash values file that cannot be read says so; one that cannot be removed does not stop the command', () => {
  const missing = prepare(`printf '%s' ${TOKEN} > argv`);
  unlinkSync(missing.result.file);
  const failed = spawnSync(
    'bash',
    ['-c', wrapBashExitStatus(missing.result.command)],
    { cwd: missing.dir, encoding: 'utf8' },
  );
  assert.equal(failed.status, 0, failed.stderr);
  assert.ok(failed.stdout.includes(LOAD_FAILURE_LINE), failed.stdout);
  assert.equal(existsSync(path.join(missing.dir, 'argv')), false);

  const readOnly = prepare(`printf '%s' ${TOKEN} > argv`);
  const runDir = path.dirname(readOnly.result.file);
  chmodSync(runDir, 0o500);
  try {
    const run = spawnSync('bash', ['-c', readOnly.result.command], {
      cwd: readOnly.dir,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(readOnly.dir, 'argv'), 'utf8'), VALUE);
  } finally {
    chmodSync(runDir, 0o700);
  }
});

test(
  'a PowerShell values file that cannot be read gives the model a clear message',
  { skip: pwshAvailable ? false : 'pwsh not available on PATH' },
  () => {
    const prepared = preparePowerShell(
      `[IO.File]::WriteAllText('argv', ${TOKEN})`,
    );
    unlinkSync(prepared.result.file);
    const run = spawnSync(
      pwsh,
      [
        '-NoProfile',
        '-Command',
        wrapPowerShellExitStatus(prepared.result.command),
      ],
      { cwd: prepared.dir, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      /ZeroH could not load the restored values, so the command did not run/,
    );
    assert.match(run.stdout, /exit status 1/);
    assert.equal(existsSync(path.join(prepared.dir, 'argv')), false);
  },
);

test(
  'PowerShell restores a non-ASCII value exactly through the wrapper',
  { skip: pwshAvailable ? false : 'pwsh not available on PATH' },
  () => {
    const value = 'zh-fake-ü-’-"-$x-`n-2026-09-25T10:00:00Z';
    const prepared = {
      ...temp(),
    };
    prepared.result = preparePowerShellLateBinding({
      command: `[IO.File]::WriteAllText('argv', "${TOKEN}")`,
      vault: {
        entryOf: (token) => (token === TOKEN ? { value } : null),
      },
      sessionId: 'session',
      toolUseId: 'unicode',
      home: prepared.home,
    });
    assert.equal(prepared.result.ok, true, prepared.result.reason);
    const run = spawnSync(
      pwsh,
      [
        '-NoProfile',
        '-Command',
        wrapPowerShellExitStatus(prepared.result.command),
      ],
      { cwd: prepared.dir, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(prepared.dir, 'argv'), 'utf8'), value);
    assert.equal(existsSync(prepared.result.file), false);
  },
);

test(
  'PowerShell rewritten command delivers the exact value and deletes its file',
  { skip: pwshAvailable ? false : 'pwsh not available on PATH' },
  () => {
    const prepared = preparePowerShell(
      `[IO.File]::WriteAllText('argv', ${TOKEN})`,
    );
    const run = spawnSync(
      pwsh,
      ['-NoProfile', '-Command', prepared.result.command],
      { cwd: prepared.dir, encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(path.join(prepared.dir, 'argv'), 'utf8'), VALUE);
    assert.equal(existsSync(prepared.result.file), false);
  },
);

test(
  'former PowerShell fallbacks execute with hard values',
  { skip: pwshAvailable ? false : 'pwsh not available on PATH' },
  () => {
    const save =
      "function Save([string]$Value) { [IO.File]::WriteAllText('argv', $Value) }; ";
    assert.equal(executePowerShell(`${save}Save '${HARD_TOKEN}'`), HARD_VALUE);
    assert.equal(
      executePowerShell(`${save}$Value = @'\n${HARD_TOKEN}\n'@\nSave $Value`),
      HARD_VALUE,
    );
    assert.equal(
      executePowerShell(`${save}$Value = @"\n${HARD_TOKEN}\n"@\nSave $Value`),
      HARD_VALUE,
    );
    assert.equal(
      executePowerShell(`${save}Save ${HARD_TOKEN}suffix`),
      `${HARD_VALUE}suffix`,
    );
  },
);

test('PowerShell scanner denies typographic quotes and unterminated syntax', () => {
  for (const command of [
    `Write-Output ‘${TOKEN}’`,
    `Write-Output “${TOKEN}”`,
    `Write-Output '${TOKEN}`,
    `$Value = @'\n${TOKEN}`,
  ]) {
    const prepared = preparePowerShell(command);
    assert.equal(prepared.result.ok, false, command);
    assert.match(prepared.result.reason, /typographic|unterminated/);
    assert.equal(existsSync(path.join(prepared.home, 'run')), false);
  }
});

test('Git Bash receives forward slashes for a Windows values path', () => {
  assert.equal(
    gitBashPath('C:\\Users\\Alice\\.zeroh\\run\\session\\tool.sh', 'win32'),
    'C:/Users/Alice/.zeroh/run/session/tool.sh',
  );
  assert.equal(
    gitBashPath('/home/alice/.zeroh/run/tool.sh', 'linux'),
    '/home/alice/.zeroh/run/tool.sh',
  );
});

test('denied syntax does not write a values file', () => {
  const prepared = prepare(`printf '%s' $'${TOKEN}`);
  assert.equal(prepared.result.ok, false);
  assert.equal(
    existsSync(
      valuesFilePath({
        home: prepared.home,
        sessionId: 'session',
        toolUseId: 'tool',
      }),
    ),
    false,
  );
});

test('stale cleanup removes old files and empty session directories only', () => {
  const t = temp();
  const oldFile = valuesFilePath({
    home: t.home,
    sessionId: 'old-session',
    toolUseId: 'old-tool',
  });
  const freshFile = valuesFilePath({
    home: t.home,
    sessionId: 'fresh-session',
    toolUseId: 'fresh-tool',
  });
  mkdirSync(path.dirname(oldFile), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(freshFile), { recursive: true, mode: 0o700 });
  writeFileSync(oldFile, 'old', { mode: 0o600 });
  writeFileSync(freshFile, 'fresh', { mode: 0o600 });
  const now = Date.now();
  const old = new Date(now - RUN_FILE_MAX_AGE_MS - 1);
  utimesSync(oldFile, old, old);

  cleanupStaleRunFiles({ home: t.home, now });
  assert.equal(existsSync(oldFile), false);
  assert.equal(existsSync(path.dirname(oldFile)), false);
  assert.equal(existsSync(freshFile), true);
});

test('cleanup tolerates an already-empty run directory', () => {
  const t = temp();
  const directory = path.join(t.home, 'run', 'empty');
  mkdirSync(directory, { recursive: true });
  chmodSync(directory, 0o700);
  cleanupStaleRunFiles({ home: t.home });
  assert.equal(existsSync(directory), false);
});

// The exit-status wrapper and late binding read a heredoc delimiter the same
// way, as Bash does: inside double quotes a backslash escapes the quote.
test('an escaped quote in a heredoc delimiter is read the same way by both scanners', async () => {
  const { bashSuffixPoint } = await import('../lib/exit-status.js');
  const { readHeredocWord } = await import('../lib/shell-scan.js');
  const command = 'cat <<"EO\\"F"\nbody\nEO"F';
  assert.equal(readHeredocWord(command, 4).delimiter, 'EO"F');
  // The body closes at `EO"F`, so the suffix goes on the opener line.
  assert.deepEqual(bashSuffixPoint(command), {
    at: command.indexOf('\n'),
    background: false,
  });
});
