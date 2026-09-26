// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from '../lib/late-bind.js';

const TOKEN = '[API_KEY-7a3f9e]';
const SAFE_VALUE = 'ZEROHFAKEsafe123';
const HOSTILE_VALUE = 'ZEROHFAKE q\' d" $HOME `id` \\ sp ${x} $(id) %s';
const BASH_FAKE_HOME = '/home/zeroh-differential';

const vaultOf = (value) => ({
  entryOf: (token) =>
    token === TOKEN
      ? { type: 'API_KEY', value, source: 'known:DIFFERENTIAL' }
      : null,
});

function runnable(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function findPowerShell() {
  if (runnable('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']))
    return 'pwsh';

  const names = process.platform === 'win32' ? ['pwsh.exe', 'pwsh'] : ['pwsh'];
  for (const name of names) {
    const candidate = path.join(os.homedir(), '.local', 'bin', name);
    if (
      existsSync(candidate) &&
      runnable(candidate, [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'exit 0',
      ])
    ) {
      return candidate;
    }
  }
  return null;
}

const pwsh = findPowerShell();

function normalized(value) {
  return String(value || '').replaceAll('\r\n', '\n');
}

function run(shell, command) {
  const executable = shell === 'bash' ? 'bash' : pwsh;
  const args =
    shell === 'bash'
      ? ['-c', command]
      : ['-NoProfile', '-NonInteractive', '-Command', command];
  const options = {
    encoding: 'utf8',
    env:
      shell === 'bash'
        ? { ...process.env, HOME: BASH_FAKE_HOME, e: 'prod' }
        : process.env,
  };
  const result = spawnSync(executable, args, options);
  assert.equal(result.error, undefined, result.error?.message);
  return `${normalized(result.stdout)}|ERR|${
    normalized(result.stderr).trim().split('\n')[0]
  }|${result.status}`;
}

const differentialExceptions = new Set([
  // Accepted: the rewrite passes the value, while literal substitution forms an undefined variable name.
  `pwsh\0Write-Output "$x${TOKEN}"`,
]);

const expectedDenials = new Map([
  [`pwsh\0Write-Output "$(')' + '${TOKEN}')"`, /quoted \) inside \$\(\)/],
  [
    `pwsh\0Write-Output @'\n${TOKEN}\n  "@\n'@`,
    /single-quoted here-string.*terminate.*double-quoted here-string/,
  ],
]);

let sequence = 0;

function checkCase(shell, command, hostileExpectation) {
  sequence += 1;
  const prepare =
    shell === 'bash' ? prepareBashLateBinding : preparePowerShellLateBinding;
  const temporaryHome = mkdtempSync(
    path.join(os.tmpdir(), 'zeroh-late-bind-differential-'),
  );
  const key = `${shell}\0${command}`;

  try {
    const safe = prepare({
      command,
      vault: vaultOf(SAFE_VALUE),
      sessionId: 'differential',
      toolUseId: `safe-${sequence}`,
      home: temporaryHome,
    });
    if (!safe.ok) {
      const expectedReason = expectedDenials.get(key);
      assert.ok(
        expectedReason,
        `unexpected denial for ${JSON.stringify(command)}`,
      );
      assert.match(safe.reason, expectedReason);
      return key;
    }

    assert.equal(safe.command.includes(SAFE_VALUE), false, 'safe value leaked');
    if (!differentialExceptions.has(key)) {
      assert.equal(
        run(shell, safe.command),
        run(shell, command.split(TOKEN).join(SAFE_VALUE)),
        command,
      );
    }

    if (hostileExpectation) {
      const hostile = prepare({
        command,
        vault: vaultOf(HOSTILE_VALUE),
        sessionId: 'differential',
        toolUseId: `hostile-${sequence}`,
        home: temporaryHome,
      });
      assert.equal(hostile.ok, true, hostile.reason);
      assert.equal(
        hostile.command.includes(HOSTILE_VALUE),
        false,
        'hostile value leaked',
      );
      assert.equal(
        run(shell, hostile.command).split('|ERR|')[0],
        hostileExpectation(HOSTILE_VALUE),
        command,
      );
    }
    return null;
  } finally {
    rmSync(temporaryHome, { recursive: true, force: true });
  }
}

const line = (value) => `${value}\n`;

const bashCases = [
  [`echo ${TOKEN}`, line],
  [`echo "a ${TOKEN} b"`, (value) => `a ${value} b\n`],
  [`echo 'a ${TOKEN} b'`, (value) => `a ${value} b\n`],
  [`printf '%s\\n' $'x\\t${TOKEN}'`, (value) => `x\t${value}\n`],
  [`echo "$(printf %s ${TOKEN})"`, line],
  [`echo "$(printf %s '${TOKEN}')"`, line],
  [`echo \`printf %s ${TOKEN}\``],
  [`echo "$(echo "x ${TOKEN} y")"`, (value) => `x ${value} y\n`],
  [`echo $(echo 'q ${TOKEN} q')`],
  [
    `cat <<'EOF'\nline $HOME \`x\` \\\\ ${TOKEN}\nEOF`,
    (value) => `line $HOME \`x\` \\\\ ${value}\n`,
  ],
  [`cat <<"EOF"\n$HOME ${TOKEN}\nEOF`, (value) => `$HOME ${value}\n`],
  [`cat <<\\EOF\n$HOME ${TOKEN}\nEOF`, (value) => `$HOME ${value}\n`],
  [`cat <<-'EOF'\n\tA ${TOKEN} $x\n\tEOF`, (value) => `A ${value} $x\n`],
  [`cat <<EOF\n$HOME ${TOKEN}\nEOF`, (value) => `${BASH_FAKE_HOME} ${value}\n`],
  [
    `cat <<'EOF'\ntrail \\\ncont ${TOKEN}\nEOF`,
    (value) => `trail \\\ncont ${value}\n`,
  ],
  [`echo "$(cat <<'EOF'\n${TOKEN} $x\nEOF\n)"`, (value) => `${value} $x\n`],
  [`x=${TOKEN}; echo "$x"`, line],
  [`echo a#${TOKEN}`],
  [`echo "\${var:-${TOKEN}}"`, line],
  [`echo \${var:-${TOKEN}}`],
  [`case ${TOKEN} in *) echo hit;; esac`],
  [`[[ ${TOKEN} == ${TOKEN} ]] && echo eq`],
  [`echo 'it'"'"'s ${TOKEN}'`, (value) => `it's ${value}\n`],
  [`printf '%s\\n' "a"'${TOKEN}'"b"`, (value) => `a${value}b\n`],
  [`echo \\${TOKEN}`],
  [`arr=(${TOKEN} x); echo "\${arr[0]}"`, line],
  [`echo "$(echo ")" ${TOKEN})"`],
  [`echo $(echo \\) ${TOKEN})`],
  [`echo \`echo \\\`echo ${TOKEN}\\\`\``],
  [`cat <<'EOF' | tr a-z A-Z\nhello ${TOKEN}\nEOF`],
  [`echo ${TOKEN} > /dev/null; echo done`],
  [`echo ${TOKEN} # ${TOKEN}`],
  [`cat <<'A'; cat <<B\n${TOKEN} $HOME\nA\n${TOKEN} $HOME\nB`],
  [`echo "\\"${TOKEN}\\""`, (value) => `"${value}"\n`],
  [`echo $'it\\'s ${TOKEN}'`, (value) => `it's ${value}\n`],
  [`echo "$( (echo ${TOKEN}) )"`, line],
  [`f() { echo "${TOKEN}"; }; f`, line],
  [`echo {a,b}${TOKEN}`],
  [`echo ${TOKEN}{a,b}`],
  [`echo ~${TOKEN}`],
  [`for i in ${TOKEN}; do echo "$i"; done`, line],
  [`echo "$(( 1 + 2 )) ${TOKEN}"`],
  [`echo "$(echo $(echo ${TOKEN}))"`],
  [`echo \${#T} ${TOKEN}`],
  [`echo "$(printf '%s' "$(printf '%s' "$(printf '%s' '${TOKEN}')")")"`, line],
  [
    `echo "$(printf '('; printf '%s' "$(printf '%s' '${TOKEN}')"; printf ')')"`,
    (value) => `(${value})\n`,
  ],
  [`echo "$(printf '%s' "$(cat <<'EOF'\n${TOKEN}\nEOF\n)")"`, line],
  [`x="$(case "$e" in prod) echo ${TOKEN};; esac)"; echo "$x"`, line],
  [`echo $((1<<4)) ${TOKEN}`, (value) => `16 ${value}\n`],
];

const powershellCases = [
  [`Write-Output ${TOKEN}`, line],
  [`Write-Output "a ${TOKEN} b"`, (value) => `a ${value} b\n`],
  [`Write-Output 'a ${TOKEN} b'`, (value) => `a ${value} b\n`],
  [`Write-Output 'it''s ${TOKEN}'`, (value) => `it's ${value}\n`],
  [`Write-Output @'\n${TOKEN} $x \`n\n'@`, (value) => `${value} $x \`n\n`],
  [`$x='X'; Write-Output @"\n${TOKEN} $x\n"@`, (value) => `${value} X\n`],
  [`Write-Output '${TOKEN}abc'`, (value) => `${value}abc\n`],
  [`Write-Output "${TOKEN}abc"`, (value) => `${value}abc\n`],
  [`$x = '${TOKEN}'; Write-Output $x`, line],
  [`Write-Output ('pre' + '${TOKEN}')`, (value) => `pre${value}\n`],
  [`& { param($a) Write-Output $a } '${TOKEN}'`, line],
  [`Write-Output "$(Write-Output '${TOKEN}')"`, line],
  [`Write-Output 'a"b ${TOKEN} \`c $d'`, (value) => `a"b ${value} \`c $d\n`],
  [`# c ${TOKEN}\nWrite-Output x`],
  [`Write-Output "\`"${TOKEN}\`""`, (value) => `"${value}"\n`],
  [`Write-Output ${TOKEN}:x`],
  [`Write-Output a${TOKEN}`],
  [`Write-Output "$x${TOKEN}"`],
  [`Write-Output "$( 'a' + '${TOKEN}' )"`, (value) => `a${value}\n`],
  [`Write-Output "$(Write-Output "${TOKEN}")"`, line],
  [`Write-Output @"\n$('${TOKEN}')\n"@`, line],
  [
    `Write-Output "x $(if ($true) { '${TOKEN}' }) y"`,
    (value) => `x ${value} y\n`,
  ],
  [
    `Write-Output "$(Write-Output "in $('${TOKEN}')")"`,
    (value) => `in ${value}\n`,
  ],
  [`Write-Output "$('it''s ${TOKEN}')"`, (value) => `it's ${value}\n`],
  [`Write-Output "$( @'\n${TOKEN}\n'@ )"`, line],
  [`Write-Output "$(')' + '${TOKEN}')"`, (value) => `)${value}\n`],
  [`Write-Output @'\n${TOKEN}\n  "@\n'@`],
  [`<# ${TOKEN} #> Write-Output y`],
  [`Write-Output ([string]'${TOKEN}').Length`],
  [`Write-Output '${TOKEN}'.ToUpper()`],
  [`Write-Output "$(Write-Output "$(Write-Output '${TOKEN}')")"`, line],
  [
    `Write-Output "$(@('[', ('x' + '${TOKEN}'), ']') -join '')"`,
    (value) => `[x${value}]\n`,
  ],
  [
    `Write-Output "$(if ($true) { @('x', "$(Write-Output '${TOKEN}')") -join '' })"`,
    (value) => `x${value}\n`,
  ],
];

test('Bash late binding matches literal substitution across adversarial cases', () => {
  assert.equal(runnable('bash', ['-c', 'exit 0']), true, 'bash is not on PATH');
  const denials = bashCases
    .map(([command, expectation]) => checkCase('bash', command, expectation))
    .filter(Boolean);
  assert.deepEqual(denials, []);
});

test(
  'PowerShell late binding matches literal substitution across adversarial cases',
  { skip: pwsh ? false : 'pwsh was not found on PATH or at ~/.local/bin/pwsh' },
  () => {
    const denials = powershellCases
      .map(([command, expectation]) => checkCase('pwsh', command, expectation))
      .filter(Boolean);
    assert.deepEqual(denials, [...expectedDenials.keys()]);
  },
);
