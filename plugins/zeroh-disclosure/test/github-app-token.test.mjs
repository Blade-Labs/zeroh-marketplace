// SPDX-License-Identifier: AGPL-3.0-only

// GitHub App installation tokens (the Actions GITHUB_TOKEN too) come in the
// stateless format GitHub rolled out from 2026-04-27: `ghs_<app id>_<JWT>`,
// about 520 characters, two dots. gitleaks v8.30.1 does not match it; the
// vendored engine's local rule does (vendor/sensitive-data-detectors,
// test/github-tokens.test.mjs upstream). The PostToolUse hook must mask such a
// token in command output WHOLE: no prefix, segment or signature may reach
// the model. Tokens are fake (ZEROHFAKE) and built from parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHook, tempProject } from './helpers.mjs';

const PREFIX = 'gh' + 's_';
const b64 = (value) => Buffer.from(value).toString('base64url');

function statelessToken() {
  const header = b64('{"alg":"RS256","typ":"JWT","kid":"ZEROHFAKE"}');
  const claims = b64(
    JSON.stringify({ iss: 'ZEROHFAKE', pad: 'ZEROHFAKE'.repeat(30) }),
  );
  const signature = ('ZEROHFAKE-_' + 'Ab9').repeat(12);
  return `${PREFIX}1234567_${header}.${claims}.${signature}`;
}

function postToolUse(p, command, stdout) {
  const result = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { stdout, stderr: '' },
    },
    { project: p },
  );
  assert.equal(result.code, 0, result.stderr);
  return result;
}

function assertNoPart(text, token) {
  assert.ok(!text.includes(token), 'the token is in the output');
  for (const part of token.split('.'))
    assert.ok(!text.includes(part), `a token segment is in the output`);
  assert.ok(!text.includes(PREFIX + '1234567_'), 'the token prefix is shown');
}

test('PostToolUse masks a bare stateless ghs_ token in command output whole', () => {
  const p = tempProject();
  const token = statelessToken();
  assert.ok(token.length > 400, `${token.length}`);
  const result = postToolUse(p, 'gh auth token', `${token}\n`);
  const output = result.json.hookSpecificOutput.updatedToolOutput;
  assert.match(output.stdout, /^\[API_KEY-[0-9a-f]{6}\]\n$/u);
  assertNoPart(result.stdout, token);
});

test('PostToolUse masks a stateless ghs_ token whole in prose, a clone URL and JSON', () => {
  const p = tempProject();
  const token = statelessToken();
  const stdout = [
    `here is the token ${token}.`,
    `git clone https://x-access-token:${token}@github.com/Blade-Labs/example.git`,
    `{"token":"${token}","expires_at":"2026-10-01T00:00:00Z"}`,
  ].join('\n');
  const result = postToolUse(p, 'cat notes.txt', stdout);
  const output = result.json.hookSpecificOutput.updatedToolOutput;
  const lines = output.stdout.split('\n');
  assert.match(lines[0], /^here is the token \[API_KEY-[0-9a-f]{6}\]\.$/u);
  assert.match(
    lines[1],
    /^git clone https:\/\/x-access-token:\[[A-Z_]+-[0-9a-f]{6}\]@github\.com\/Blade-Labs\/example\.git$/u,
  );
  assert.match(
    lines[2],
    /^\{"token":"\[[A-Z_]+-[0-9a-f]{6}\]","expires_at":"2026-10-01T00:00:00Z"\}$/u,
  );
  assertNoPart(result.stdout, token);
});
