// SPDX-License-Identifier: AGPL-3.0-only

// A variable reference the user typed (`-u "<variable>:"`) is masked like any
// value and reaches Claude as a token. Put back, it must do what it did as
// typed (product rule 1): the shell expands the user's variable. It is a
// name, not a value, so it is written inline where the token stands; a real
// value never is. A token after PowerShell's `--%` cannot be late-bound
// (PowerShell passes that text as written): it follows the late-binding
// failure rule instead (pass: runs with the token and a notice; block:
// stopped). Fake values only; `D` is a dollar sign, `U` curl's user option.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runHook, tempProject } from './helpers.mjs';
import { Vault } from '../lib/vault.js';
import { bracedReference } from '../lib/shell-references.js';

const D = '$';
const U = '-' + 'u';
const EXPANDED = 'EXPANDED_FAKE_VALUE';
const BLOCK = { ZEROH_UNCERTAIN: 'block' };
const URL = 'https://api.stripe.com/v1/balance';

function seeded(p, type, value) {
  const vault = new Vault(p.dir, {
    env: { ...process.env, ZEROH_HOME: p.home, HOME: p.home },
  });
  const token = vault.tokenFor(type, value, 'detected');
  vault.save();
  return token;
}

function preToolUse(p, tool, command, extraEnv = {}) {
  const result = runHook(
    'pre-tool-use',
    { tool_use_id: 'ref-inline', tool_name: tool, tool_input: { command } },
    { project: p, extraEnv },
  );
  assert.equal(result.code, 0, result.stderr);
  return result.json ?? {};
}

// [tool, reference as typed, program, command with the token]
const CASES = [
  ['Bash', `${D}STRIPE_KEY:`, (prog, t) => `${prog} -s ${URL} ${U} "${t}"`],
  ['Bash', `${D}{STRIPE_KEY}:`, (prog, t) => `${prog} ${U} ${t} ${URL}`],
  [
    'PowerShell',
    `${D}(${D}env:STRIPE_KEY):`,
    (prog, t) => `${prog} -s ${URL} ${U} "${t}"`,
  ],
  ['PowerShell', `${D}env:STRIPE_KEY`, (prog, t) => `${prog} ${U} ${t} ${URL}`],
];

test('a restored reference is written inline, in its expanding position', () => {
  for (const [tool, value, make] of CASES) {
    const p = tempProject({ env: false });
    const token = seeded(p, 'TOKEN', value);
    const json = preToolUse(p, tool, make('curl', token));
    const command = json.hookSpecificOutput?.updatedInput?.command ?? '';
    // Braced, so the name keeps its end wherever it lands.
    const braced = bracedReference(
      value,
      tool === 'Bash' ? 'bash' : 'powershell',
    );
    assert.ok(braced?.startsWith(`${D}{`) || braced?.startsWith(`${D}(`));
    assert.ok(command.includes(make('curl', braced)), `${tool}: ${command}`);
    assert.ok(!command.includes(token), command);
    assert.ok(!/ZH_TOKEN_/u.test(command), command);
    assert.match(json.systemMessage ?? '', /a variable whose value/u);
  }
});

const pwshOk =
  spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' })
    .status === 0;

test(
  'oracle: the restored command hands the program the variable’s value',
  { skip: process.platform === 'win32' ? 'Unix shells only' : false },
  () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-argv-'));
    writeFileSync(
      path.join(dir, 'argvprint'),
      '#!/bin/sh\nprintf "<%s>\\n" "$@"\n',
      { mode: 0o755 },
    );
    try {
      for (const [tool, value, make] of CASES) {
        if (tool === 'PowerShell' && !pwshOk) continue;
        const p = tempProject({ env: false });
        const token = seeded(p, 'TOKEN', value);
        const json = preToolUse(p, tool, make('argvprint', token));
        const command = json.hookSpecificOutput?.updatedInput?.command;
        assert.ok(command, JSON.stringify(json));
        const env = {
          PATH: `${dir}${path.delimiter}${process.env.PATH}`,
          HOME: p.home,
          STRIPE_KEY: EXPANDED,
        };
        const run =
          tool === 'Bash'
            ? spawnSync('bash', ['-c', command], { env, encoding: 'utf8' })
            : spawnSync('pwsh', ['-NoProfile', '-Command', command], {
                env,
                encoding: 'utf8',
              });
        const expanded = value.endsWith(':') ? `${EXPANDED}:` : EXPANDED;
        assert.ok(
          run.stdout.includes(`<${expanded}>`),
          `${tool} ${value}: ${run.stdout} ${run.stderr}`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('a real value after --% is never written into the command text', () => {
  const secret = 'Zq9s' + 'K2mR7vT4' + 'wX8yB3nC6pL1';
  const p = tempProject({ env: false });
  const token = seeded(p, 'API_KEY', secret);
  const command = `curl.exe --% -H "X-Key: ${token}" https://localhost:9/x`;
  const pass = preToolUse(p, 'PowerShell', command);
  const text = JSON.stringify(pass);
  assert.ok(!text.includes(secret), text);
  assert.ok(!/ZH_API_KEY_/u.test(text), text);
  assert.match(text, /--%/u);
  const block = preToolUse(p, 'PowerShell', command, BLOCK);
  assert.equal(block.hookSpecificOutput?.permissionDecision, 'deny');
  assert.match(
    block.hookSpecificOutput.permissionDecisionReason,
    /could not be safely late-bound \(a token after --%/u,
  );
});
