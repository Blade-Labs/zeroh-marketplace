// SPDX-License-Identifier: AGPL-3.0-only

// Owner rule (2026-09-27): "ZeroH is adding masking where there was none; we
// can't block Claude Code functionality." With the default `uncertain`
// mode (`pass`), ordinary work runs through the real PreToolUse hook without
// a new denial: scripts that read keys from the environment, dynamic hosts,
// pipes, searches over the plugin folder and reading Claude's settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAKE_STRIPE, PLUGIN, runHook, tempProject } from './helpers.mjs';

const TOKEN_RE = /\[API_KEY-[0-9a-f]{6}\]/;

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

test('ordinary work runs unblocked by default', () => {
  const p = tempProject();
  const token = maskedToken(p);
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-rc2-home-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  writeFileSync(path.join(home, '.claude', 'settings.json'), '{}\n');
  const extraEnv = {
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  };
  const cases = [
    // A script that reads a masked key from its environment.
    ['Bash', `STRIPE_KEY=${token} node scripts/use-key.mjs`],
    ['Bash', `STRIPE_KEY=${token} python3 scripts/refund.py --dry-run`],
    ['PowerShell', `$env:STRIPE_KEY='${token}'; node scripts/use-key.mjs`],
    // A host only known at run time, with and without a restored value.
    ['Bash', `curl -s "https://$HOST/health"`],
    [
      'Bash',
      `curl -s -H "Authorization: Bearer ${token}" "https://$HOST/v1/charges"`,
    ],
    ['Bash', `curl -s $(cat .api-host)/v1/ping`],
    // Pipes.
    ['Bash', 'cat .env | grep -c STRIPE | wc -l'],
    ['Bash', `echo ${token} | node scripts/hash-stdin.mjs`],
    ['Bash', 'git log --oneline | head -5'],
    // Searches over the plugin folder and reading Claude's settings.
    ['Bash', `rg -n "ZEROHFAKE" ${PLUGIN}`],
    ['Bash', `grep -rn hooks ${path.join(PLUGIN, 'hooks')}`],
    ['Bash', `ls -la ${PLUGIN}/hooks`],
    ['Bash', 'cat ~/.claude/settings.json'],
    ['Bash', 'jq .permissions ~/.claude/settings.json'],
    ['PowerShell', 'Get-Content ~/.claude/settings.json'],
    // Credential files are read and masked (A2), a background command runs
    // without the proxy (D-22), a script gets a raw key (D-23).
    ['Bash', 'cat ~/.ssh/config'],
    ['Bash', 'cat .kube/config'],
    ['Bash', 'KUBECONFIG=.kube/config kubectl get pods'],
    ['Bash', 'cat keys/id_rsa'],
    ['Bash', 'npm run dev'],
    ['Bash', `STRIPE_KEY=${FAKE_STRIPE} node scripts/refund.mjs`],
    ['PowerShell', `$env:STRIPE_KEY='${FAKE_STRIPE}'; node scripts/refund.mjs`],
    // Everyday commands.
    ['Bash', 'npm test -- --watch=false'],
    ['Bash', 'git status && git diff --stat'],
    ['Bash', 'case "$1" in a) echo a;; esac'],
  ];
  for (const [tool, command] of cases) {
    const background = command === 'npm run dev';
    const { json, code } = runHook(
      'pre-tool-use',
      {
        tool_use_id: 'ordinary',
        tool_name: tool,
        tool_input: {
          command,
          ...(background ? { run_in_background: true } : {}),
        },
      },
      { project: p, extraEnv },
    );
    assert.equal(code, 0, `${tool}: ${command}`);
    assert.notEqual(
      json?.hookSpecificOutput?.permissionDecision,
      'deny',
      `${tool}: ${command}: ${json?.hookSpecificOutput?.permissionDecisionReason}`,
    );
  }
});
