// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { wrapBashExitStatus } from '../lib/exit-status.js';
import {
  claudeCodeBraceQuoteRefusal,
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from '../lib/late-bind.js';

import { claudeCodeRefuses } from './claude-code-check.mjs';

const TOKEN = '[API_KEY-7a3f9e]';
const PLAIN = 'sk_test_ZEROHFAKE4eC39HqLyjWDarjtT1zdp7dc';
const HOSTILE = 'ZEROHFAKE q\' d" $HOME `id` \\ sp ${x} $(id) {a,b} %s';

const vaultOf = (value) => ({
  entryOf: (token) =>
    token === TOKEN ? { type: 'API_KEY', value, source: 'known:CHECK' } : null,
});

// Every quoting context the rewriter handles, and the fallback the model
// used in the Windows report.
const CORPUS = [
  `curl -sS https://api.stripe.com/v1/charges -u ${TOKEN}:`,
  `curl -sS https://api.stripe.com/v1/charges -u "${TOKEN}:"`,
  `curl -sS -H 'Authorization: Bearer ${TOKEN}' https://api.stripe.com/v1/charges`,
  `curl -sS -H "Authorization: Bearer ${TOKEN}" https://api.stripe.com/v1/charges`,
  `printf '%s' $'${TOKEN}' > argv`,
  `KEY=${TOKEN} node use-key.mjs`,
  `export STRIPE_KEY="${TOKEN}"; node use-key.mjs`,
  `echo "$(printf '%s' ${TOKEN})"`,
  'echo `printf %s ' + TOKEN + '`',
  `cat <<EOF > out\nkey=${TOKEN}\nEOF`,
  `cat <<'EOF' > out\nkey=${TOKEN}\nEOF`,
  `echo \${KEY:-${TOKEN}}`,
  `{ echo ${TOKEN}; } > out`,
  `if true; then echo ${TOKEN}; fi`,
  `for x in ${TOKEN}; do echo "$x"; done`,
  `jq -n --arg k ${TOKEN} '{key: $k}'`,
  `node -e 'console.log(process.argv[1])' ${TOKEN} # sends it`,
];

function homeDir() {
  return path.join(
    mkdtempSync(path.join(os.tmpdir(), 'zeroh-cc-check-')),
    'zeroh-home',
  );
}

test('the replicated check refuses the 1.0.0 wrapper and our copy agrees with it', () => {
  // The rc.2 / 1.0.0 form: the command inside `{ ... }` after the load.
  const old = `if . '/h/run/s/t.sh'; then rm -f '/h/run/s/t.sh' 2>/dev/null; true; else echo '[x]'; false; fi && {\ncurl -u "\${ZH_API_KEY_7a3f9e}:" https://api.stripe.com\n}`;
  assert.equal(claudeCodeRefuses(old), true);
  for (const sample of [
    old,
    'echo "{a}"',
    "awk '{print $1}' f",
    'echo ${A} "b"',
    '{ echo "x"; }',
    'echo ${A:-"b"}',
    '# { "comment"\necho ok',
    'echo \\{ "x" }',
    'echo `{ "a" }`',
    ...CORPUS,
  ]) {
    assert.equal(
      claudeCodeBraceQuoteRefusal(sample),
      claudeCodeRefuses(sample),
      sample,
    );
  }
});

for (const [label, value] of [
  ['a plain key', PLAIN],
  ['a value with every shell metacharacter', HOSTILE],
]) {
  test(`every Bash late-binding wrapper passes Claude Code 2.1.283's brace check (${label})`, () => {
    for (const command of CORPUS) {
      const original = claudeCodeRefuses(command);
      const result = prepareBashLateBinding({
        command,
        vault: vaultOf(value),
        sessionId: 's',
        toolUseId: 't',
        home: homeDir(),
      });
      if (!result.ok) {
        // Only a value that cannot go bare inside the user's own { ... }
        // is given up on, and then no values file is left behind.
        assert.match(result.reason, /Claude Code's shell check/, command);
        assert.equal(value, HOSTILE, command);
        continue;
      }
      assert.ok(!result.command.includes(value), command);
      if (!original) {
        assert.equal(claudeCodeRefuses(result.command), false, command);
        assert.equal(
          claudeCodeRefuses(
            wrapBashExitStatus(result.command, { original: command }),
          ),
          false,
          command,
        );
      }
    }
  });
}

test("a token inside the user's own { ... } is put back bare when the value allows it, and refused otherwise without a values file", () => {
  const home = homeDir();
  const plain = prepareBashLateBinding({
    command: `{ echo ${TOKEN}; } > out`,
    vault: vaultOf(PLAIN),
    sessionId: 's',
    toolUseId: 'plain',
    home,
  });
  assert.equal(plain.ok, true);
  assert.match(plain.command, /\{ echo \$\{ZH_API_KEY_7a3f9e\}; \} > out/);
  const hostile = prepareBashLateBinding({
    command: `{ echo ${TOKEN}; } > out`,
    vault: vaultOf('two words'),
    sessionId: 's',
    toolUseId: 'hostile',
    home,
  });
  assert.equal(hostile.ok, false);
  assert.equal(existsSync(path.join(home, 'run', 's', 'hostile.sh')), false);
});

test('the new Bash wrapper runs the command with the value and removes the file', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-cc-run-'));
  const home = path.join(dir, 'zeroh-home');
  for (const command of [
    `printf '%s' ${TOKEN} > argv`,
    `{ printf '%s' ${TOKEN}; } > argv`,
    `printf '%s' \${UNSET:-${TOKEN}} > argv`,
  ]) {
    const result = prepareBashLateBinding({
      command,
      vault: vaultOf(PLAIN),
      sessionId: 's',
      toolUseId: 'run',
      home,
    });
    assert.equal(result.ok, true, command);
    const run = spawnSync(
      'bash',
      [
        '-c',
        `${wrapBashExitStatus(result.command, { original: command })}; cat argv`,
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(run.stdout, PLAIN, command);
    assert.equal(existsSync(result.file), false, command);
  }
});

// Claude Code 2.1.283's PowerShell tool runs its own AST checks (function qt
// and the Get-SecurityPatterns script): "Command invokes .NET methods" for any
// InvokeMemberExpressionAst or MemberExpressionAst, "Command contains
// subexpressions $()" for SubExpressionAst, ArrayExpressionAst and
// ParenExpressionAst, "Command contains expandable strings with embedded
// expressions", script blocks, and "Command uses .NET type [...] outside the
// ConstrainedLanguage allowlist" for type literals. These ask rather than
// refuse; the loader the late-binding wrapper adds must trip none of them.
test('the PowerShell loader uses no construct Claude Code 2.1.283 asks about', () => {
  const result = preparePowerShellLateBinding({
    command: `Write-Output '${TOKEN}'`,
    vault: vaultOf(PLAIN),
    sessionId: 's',
    toolUseId: 'ps',
    home: homeDir(),
  });
  assert.equal(result.ok, true);
  const loader = result.command.split('\n').slice(0, -1).join('\n');
  assert.doesNotMatch(loader, /::|\.[A-Za-z]+\(|\$\(|@\(|\[[A-Za-z.]+\]|"/);
  assert.doesNotMatch(loader, /\{\s*\$_|ForEach-Object|%\s*\{/);
  assert.equal(
    result.command.split('\n').at(-1),
    'Write-Output ${ZH_API_KEY_7a3f9e}',
  );
});
