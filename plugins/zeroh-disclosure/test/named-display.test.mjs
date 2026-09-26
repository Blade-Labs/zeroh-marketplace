// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameMentionedTokens, namingReminder } from '../lib/token-pattern.js';
import { FAKE_STRIPE, runHook, tempProject } from './helpers.mjs';

const TOKEN_RE = /\[API_KEY-[0-9a-f]{6}\]/;
const REMINDER_RE =
  /The user's screen replaces every plain \[[A-Z_]+-[0-9a-f]{6}\]/;

test('a token right next to the word token or placeholder is shown as ⟦token⟧', () => {
  for (const [input, expected] of [
    [
      'For STRIPE_KEY, I saw the token [API_KEY-0efedc].',
      'For STRIPE_KEY, I saw the token ⟦API_KEY-0efedc⟧.',
    ],
    [
      'I saw the token `[API_KEY-5d8025]` for STRIPE_KEY.',
      'I saw the token `⟦API_KEY-5d8025⟧` for STRIPE_KEY.',
    ],
    [
      'It is a placeholder [API_KEY-3f9a1c] only.',
      'It is a placeholder ⟦API_KEY-3f9a1c⟧ only.',
    ],
    [
      'Token [API_KEY-3f9a1c] stands in for the key.',
      'Token ⟦API_KEY-3f9a1c⟧ stands in for the key.',
    ],
    [
      '[API_KEY-3f9a1c] is a placeholder ZeroH created',
      '⟦API_KEY-3f9a1c⟧ is a placeholder ZeroH created',
    ],
    [
      '`[API_KEY-3f9a1c]` was just a token.',
      '`⟦API_KEY-3f9a1c⟧` was just a token.',
    ],
    ['[EMAIL-7136a8] is the Token.', '⟦EMAIL-7136a8⟧ is the Token.'],
  ]) {
    assert.deepEqual(nameMentionedTokens(input), {
      text: expected,
      changed: true,
    });
  }
});

test('every other plain token keeps its form so the screen shows the real value', () => {
  for (const input of [
    "You'll see [EMAIL-7136a8] in .env",
    'I saw [API_KEY-3f9a1c] for STRIPE_KEY',
    'I replaced the hardcoded key with [API_KEY-3f9a1c]',
    'ZeroH masked it as [EMAIL-7136a8].',
    'GITHUB_TOKEN [API_KEY-3f9a1c]',
    'export GITHUB_TOKEN=[API_KEY-3f9a1c]',
    'mytoken [API_KEY-3f9a1c]',
    '[API_KEY-3f9a1c] is a tokenizer key',
    'the token [api_key-3f9a1c]',
    '[api_key-3f9a1c] is a placeholder',
    'the token ⟦API_KEY-3f9a1c⟧',
    'curl -u [API_KEY-3f9a1c]: https://api.stripe.com',
    'STRIPE_KEY=[API_KEY-3f9a1c]',
    'Your key [API_KEY-3f9a1c] works.',
    'Refunded [EMAIL-2b8d4c]',
  ]) {
    assert.deepEqual(nameMentionedTokens(input), {
      text: input,
      changed: false,
    });
  }
});

test('the reminder names a real token in its example', () => {
  assert.equal(
    namingReminder('[API_KEY-0efedc]'),
    'The user\'s screen replaces every plain [API_KEY-0efedc] you write with the real value. When you mean the token itself (which token you saw, that a value is masked), write ⟦API_KEY-0efedc⟧, e.g. "I saw ⟦API_KEY-0efedc⟧". When you mean the value (answers, commands, code), write [API_KEY-0efedc].',
  );
});

function readEnv(p) {
  return runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}`, stderr: '' },
    },
    { project: p },
  ).json.hookSpecificOutput;
}

test('the naming reminder goes to the model once per turn that brings tokens', () => {
  const p = tempProject();
  const clean = runHook(
    'user-prompt-submit',
    { prompt: 'Read .env please.' },
    { project: p },
  );
  assert.equal(clean.code, 0, clean.stderr);
  assert.doesNotMatch(JSON.stringify(clean.json ?? {}), REMINDER_RE);

  // The first masked tool output of the turn carries it, later ones do not.
  const first = readEnv(p);
  const token = first.updatedToolOutput.stdout.match(TOKEN_RE)[0];
  assert.ok(
    first.additionalContext.includes(
      `write ⟦${token.slice(1, -1)}⟧, e.g. "I saw ⟦${token.slice(1, -1)}⟧"`,
    ),
  );
  assert.doesNotMatch(readEnv(p).additionalContext, REMINDER_RE);

  // A prompt referencing a typed token gets it with its token map, and the
  // tool output of that turn does not repeat it.
  const stopped = runHook(
    'user-prompt-submit',
    { prompt: `use STRIPE_KEY=${FAKE_STRIPE}` },
    { project: p },
  );
  const typed = stopped.stdout.match(TOKEN_RE)[0];
  const tokenized = runHook(
    'user-prompt-submit',
    { prompt: `use STRIPE_KEY=${typed}` },
    { project: p },
  );
  assert.equal(tokenized.code, 0, tokenized.stderr);
  assert.match(
    tokenized.json.hookSpecificOutput.additionalContext,
    REMINDER_RE,
  );
  assert.doesNotMatch(readEnv(p).additionalContext, REMINDER_RE);

  // The next clean turn: none at the prompt, once again with the tool output.
  const next = runHook(
    'user-prompt-submit',
    { prompt: 'Thanks. Now list the files.' },
    { project: p },
  );
  assert.doesNotMatch(JSON.stringify(next.json ?? {}), REMINDER_RE);
  assert.match(readEnv(p).additionalContext, REMINDER_RE);
});

test('MessageDisplay shows a token the model talks about as ⟦token⟧', () => {
  const p = tempProject();
  const token = readEnv(p).updatedToolOutput.stdout.match(TOKEN_RE)[0];
  const named = `⟦${token.slice(1, -1)}⟧`;
  const display = (delta) =>
    runHook('message-display', { delta }, { project: p }).json
      ?.hookSpecificOutput?.displayContent;
  assert.equal(
    display(`I saw the token ${token} for STRIPE_KEY.`),
    `I saw the token ${named} for STRIPE_KEY.`,
  );
  assert.equal(
    display(`STRIPE_KEY=${token}; the token ${token}.`),
    `STRIPE_KEY=${FAKE_STRIPE}; the token ${named}.`,
  );
  // A token the vault does not hold is still named, never left as is.
  assert.equal(
    display('the token [API_KEY-abcdef]'),
    'the token ⟦API_KEY-abcdef⟧',
  );
  assert.equal(display('Unknown [API_KEY-abcdef]'), undefined);
});
