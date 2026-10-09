// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAKE_STRIPE, PLUGIN, runHook, tempProject } from '../helpers.mjs';
import { analyzeShell } from '../../packages/shell-analysis/scan.js';
import { shellDestinations } from '../../packages/shell-analysis/shell-destinations.js';

const gateway = `<API_KEY_${'a'.repeat(16)}>`;

test('R1: missing vendor or receipt sink still denies in block mode', () => {
  const p = tempProject({ env: false });
  for (const omitted of [
    'vendor',
    'packages/zeroh-disclosure-core/receipt-sink.js',
  ]) {
    // HEAD predates the sink; compare its vendor failure with the same test.
    if (!existsSync(path.join(PLUGIN, omitted))) continue;
    const copy = mkdtempSync(path.join(os.tmpdir(), 'zeroh-no-vendor-'));
    try {
      cpSync(PLUGIN, copy, { recursive: true });
      rmSync(path.join(copy, omitted), { recursive: true, force: true });
      const options = {
        project: p,
        pluginDir: copy,
        extraEnv: { ZEROH_UNCERTAIN: 'block' },
      };
      const prompt = runHook(
        'user-prompt-submit',
        { prompt: 'hello' },
        options,
      );
      assert.equal(prompt.code, 2, omitted);
      const pre = runHook(
        'pre-tool-use',
        { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
        options,
      );
      assert.equal(
        pre.json?.hookSpecificOutput?.permissionDecision,
        'deny',
        omitted,
      );
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }
});

test('R2: unquoted gateway shapes cannot hide settings redirections', () => {
  const p = tempProject({ env: false });
  for (const command of [
    `echo x ${gateway}~/.claude/settings.json`,
    `cat ${gateway} .claude/settings.local.json`,
  ]) {
    const parsed = analyzeShell(command, 'bash');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.commands[0].redirects.length, 2);
    const result = runHook(
      'pre-tool-use',
      { tool_name: 'Bash', tool_input: { command } },
      { project: p },
    );
    assert.equal(result.json?.hookSpecificOutput?.permissionDecision, 'deny');
  }
  const command = `echo x ${gateway}result.txt`;
  assert.equal(
    analyzeShell(command, 'bash').commands[0].redirects[1].target.value,
    'result.txt',
  );
  assert.ok(
    JSON.stringify(
      shellDestinations(
        `curl ${gateway}result.txt https://example.com`,
        'bash',
      ),
    ).includes('example.com'),
  );
});

test('R2: quoted gateway arguments stay single byte-identical literals', () => {
  for (const shell of ['bash', 'powershell']) {
    for (const quote of ["'", '"']) {
      const parsed = analyzeShell(`echo ${quote}${gateway}${quote}`, shell);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.commands[0].redirects.length, 0);
      assert.equal(parsed.commands[0].words[1].value, gateway);
      assert.equal(parsed.commands[0].words.length, 2);
    }
  }
  for (const shell of ['powershell', 'cmd']) {
    const parsed = analyzeShell(`echo ${gateway} result.txt`, shell);
    assert.ok(
      !parsed.ok || parsed.commands.some((c) => c.redirects.length > 0),
    );
  }
});

function restored(p, ids) {
  const output = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat fake.txt' },
      tool_response: { stdout: FAKE_STRIPE, stderr: '' },
    },
    { project: p },
  );
  const token = output.json?.hookSpecificOutput?.updatedToolOutput?.stdout;
  assert.match(token, /^\[API_KEY-[0-9a-f]{6}\]$/u);
  const pre = runHook(
    'pre-tool-use',
    {
      ...ids,
      tool_name: 'Bash',
      tool_input: {
        command: `curl -s https://api.stripe.com/v1/balance -u "${token}:"`,
      },
    },
    { project: p },
  );
  assert.notEqual(
    pre.json?.hookSpecificOutput?.permissionDecision,
    'deny',
    'masked credentials retain provider destination',
  );
  assert.ok(
    pre.json?.hookSpecificOutput?.updatedInput?.command,
    'PreToolUse restores masked username without treating colon as a value',
  );
  return path.join(p.home, 'run', ids.session_id, `${ids.tool_use_id}.sh`);
}

test('R3: token username and empty password restore at PreToolUse', () => {
  const p = tempProject({ env: false });
  const file = restored(p, { session_id: 'ZEROHFAKE-r3', tool_use_id: 'curl' });
  assert.ok(readFileSync(file).length > 0);
});

for (const event of ['PostToolUseFailure', 'PermissionDenied']) {
  test(`R4: ${event} cleans a restored values file and keeps its sibling`, () => {
    const p = tempProject({ env: false });
    const ids = { session_id: 'ZEROHFAKE-r4', tool_use_id: 'refused' };
    const file = restored(p, ids);
    const sibling = restored(p, { ...ids, tool_use_id: 'pending' });
    const result = runHook(
      'tool-not-run',
      {
        ...ids,
        hook_event_name: event,
        tool_name: 'Bash',
        tool_input: { command: 'x' },
      },
      { project: p },
    );
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.throws(() => readFileSync(file), { code: 'ENOENT' });
    assert.ok(readFileSync(sibling).length > 0);
  });
}
