// SPDX-License-Identifier: AGPL-3.0-only

// A late-binding values file of a command that never ran is removed promptly:
// by PostToolUseFailure / PermissionDenied, at the turn's end and the next
// prompt, and at SessionEnd, never left for the next session's sweep (the
// Windows rc.2 report: the key stayed on disk after Claude Code refused the
// rewritten command).
import { FAKE_STRIPE, runHook, tempProject } from './helpers.mjs';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cleanupSessionRunFiles, TURN_END_GRACE_MS } from '../lib/late-bind.js';

const hooks = JSON.parse(
  readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'),
).hooks;

// The token the model sees for the project's STRIPE_KEY.
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
  return json.hookSpecificOutput.updatedToolOutput.stdout.match(
    /\[API_KEY-[0-9a-f]{6}\]/u,
  )[0];
}

// A restored Bash command whose values file PreToolUse wrote.
function restoredCommand(p, ids) {
  const token = maskedToken(p);
  const out = runHook(
    'pre-tool-use',
    {
      ...ids,
      tool_name: 'Bash',
      tool_input: {
        command: `curl -sS https://api.stripe.com/v1/charges -u "${token}:"`,
      },
    },
    { project: p },
  ).json.hookSpecificOutput;
  assert.match(out.updatedInput.command, /^if \. '/);
  const file = path.join(
    p.home,
    'run',
    ids.session_id,
    `${ids.tool_use_id}.sh`,
  );
  assert.equal(existsSync(file), true);
  return file;
}

function age(file, ms) {
  const at = new Date(Date.now() - ms);
  utimesSync(file, at, at);
}

test('hooks.json sends PostToolUseFailure and PermissionDenied for shell tools to tool-not-run', () => {
  for (const event of ['PostToolUseFailure', 'PermissionDenied']) {
    const [entry] = hooks[event];
    const matcher = new RegExp(`^(?:${entry.matcher})$`);
    assert.ok(matcher.test('Bash') && matcher.test('PowerShell'), event);
    assert.equal(
      entry.hooks[0].command,
      'node "${CLAUDE_PLUGIN_ROOT}/hooks/run.js" tool-not-run',
    );
  }
});

for (const event of ['PostToolUseFailure', 'PermissionDenied']) {
  test(`${event} removes the values file of the command at once, quietly`, () => {
    const p = tempProject();
    const ids = { session_id: `s-${event}`, tool_use_id: 'refused' };
    const file = restoredCommand(p, ids);
    const other = restoredCommand(p, { ...ids, tool_use_id: 'still-pending' });
    const result = runHook(
      'tool-not-run',
      {
        ...ids,
        hook_event_name: event,
        tool_name: 'Bash',
        tool_input: { command: 'x' },
        ...(event === 'PermissionDenied'
          ? { reason: 'denied by the classifier' }
          : { error: 'interrupted', is_interrupt: true }),
      },
      { project: p },
    );
    assert.equal(result.status ?? 0, 0);
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(other), true, 'only its own tool use');
  });
}

test("Stop and the next prompt remove the session's values files older than the grace, SessionEnd all of them", () => {
  const p = tempProject();
  const ids = { session_id: 'turns', tool_use_id: 'old' };
  const old = restoredCommand(p, ids);
  const fresh = restoredCommand(p, { ...ids, tool_use_id: 'fresh' });
  const elsewhere = restoredCommand(p, {
    session_id: 'other-session',
    tool_use_id: 'x',
  });
  age(old, TURN_END_GRACE_MS + 5_000);
  age(elsewhere, TURN_END_GRACE_MS + 5_000);
  runHook('stop', { session_id: 'turns' }, { project: p });
  assert.equal(existsSync(old), false, 'refused earlier in the turn');
  assert.equal(existsSync(fresh), true, 'may still be waiting for a person');
  assert.equal(existsSync(elsewhere), true, 'another live session');

  age(fresh, TURN_END_GRACE_MS + 5_000);
  runHook(
    'user-prompt-submit',
    { session_id: 'turns', prompt: 'hello' },
    { project: p },
  );
  assert.equal(existsSync(fresh), false);

  runHook('session-end', { session_id: 'other-session' }, { project: p });
  assert.equal(existsSync(elsewhere), false);
});

test('cleanupSessionRunFiles keeps younger files, removes all at 0, and ignores a missing session', () => {
  const p = tempProject();
  const ids = { session_id: 'direct', tool_use_id: 'a' };
  const a = restoredCommand(p, ids);
  const b = restoredCommand(p, { ...ids, tool_use_id: 'b' });
  age(a, TURN_END_GRACE_MS);
  assert.equal(
    cleanupSessionRunFiles({ sessionId: 'direct', home: p.home }),
    1,
  );
  assert.equal(existsSync(a), false);
  assert.equal(existsSync(b), true);
  assert.equal(
    cleanupSessionRunFiles({ sessionId: 'direct', home: p.home, minAgeMs: 0 }),
    1,
  );
  assert.equal(existsSync(path.dirname(b)), false);
  assert.equal(cleanupSessionRunFiles({ sessionId: 'none', home: p.home }), 0);
  assert.equal(cleanupSessionRunFiles({ home: p.home }), 0);
});
