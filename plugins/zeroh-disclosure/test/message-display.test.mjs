// SPDX-License-Identifier: AGPL-3.0-only

import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runHook, tempProject } from './helpers.mjs';
import { Vault } from '../lib/vault.js';
import {
  carryDir,
  clearCarry,
  heldFragment,
  mayContinueToken,
  putCarry,
  splitFlush,
  takeCarry,
} from '../lib/display-carry.js';

const TOKEN_RE = /\[[A-Z_]+-[0-9a-f]{6}\]/g;
const FAKE_EMAIL = 'zerohfake.person' + '@example.invalid';
const FAKE_PASS = 'ZEROHFAKE-display-pass-7';

function seed(p, entries) {
  const vault = new Vault(p.dir, {
    env: { ...process.env, ZEROH_HOME: p.home },
  });
  const tokens = entries.map(([type, value]) =>
    vault.tokenFor(type, value, 'detected'),
  );
  vault.save();
  return tokens;
}

// Runs one message through the hook, flush by flush, as Claude Code does:
// each flush's displayContent (or its delta, without one) is appended to
// what the screen shows.
function display(p, deltas, { messageId = 'msg-1', extraEnv = {} } = {}) {
  let screen = '';
  const answers = [];
  deltas.forEach((delta, index) => {
    const r = runHook(
      'message-display',
      {
        hook_event_name: 'MessageDisplay',
        turn_id: 'turn-1',
        message_id: messageId,
        index,
        final: index === deltas.length - 1,
        delta,
      },
      { project: p, extraEnv },
    );
    assert.equal(r.code, 0, r.stderr);
    const shown = r.json?.hookSpecificOutput?.displayContent;
    answers.push(shown);
    screen += shown ?? delta;
  });
  return { screen, answers };
}

// The carry-over alone, in this process: what each flush of `deltas` shows.
function carried(deltas, env) {
  const messageId = `m-${Math.random().toString(36).slice(2)}`;
  const shown = [];
  deltas.forEach((delta, index) => {
    const flush = {
      sessionId: 's',
      messageId,
      index,
      final: index === deltas.length - 1,
      delta,
    };
    const carry = takeCarry(flush, { env, waitMs: 0 });
    const { text, held } = splitFlush(carry, delta, { final: flush.final });
    putCarry(flush, held, { env });
    if (flush.final) clearCarry(flush, { env });
    shown.push(text);
  });
  return shown;
}

function tempEnv() {
  return {
    ...process.env,
    ZEROH_HOME: mkdtempSync(path.join(os.tmpdir(), 'zeroh-carry-')),
  };
}

test('a fragment is held back only at a mid-line, non-final end', () => {
  assert.equal(heldFragment('Key [EMAIL-1a'), '[EMAIL-1a');
  assert.equal(heldFragment('Key ['), '[');
  assert.equal(heldFragment('Key [EMAIL-1a2b3c'), '[EMAIL-1a2b3c');
  assert.equal(heldFragment('Key [EMAIL-1a2b3c]'), '');
  assert.equal(heldFragment('Key [EMAIL-1a\n'), '');
  assert.equal(heldFragment('Key [EMAIL-1a', { final: true }), '');
  assert.equal(heldFragment('Key ⟦EMAIL-1a'), '');
  assert.equal(heldFragment('see [docs'), '');
  assert.ok(mayContinueToken(']'));
  assert.ok(mayContinueToken('AIL-1a2b3c] rest\n'));
  assert.ok(mayContinueToken('3c] rest'));
  assert.ok(mayContinueToken('EMAIL-'));
  assert.equal(mayContinueToken('Hello\n'), false);
  assert.equal(mayContinueToken(''), false);
});

test('a token split at every point across two flushes is shown whole once, nothing lost or repeated', () => {
  const env = tempEnv();
  const texts = [
    'Your address is [EMAIL-1a2b3c] and the key [API_KEY-0f0f0f] works.\n',
    '```bash\nexport MAIL="[EMAIL-1a2b3c]"\ncurl -u "[PASSWORD-abcdef]" x\n```\n',
    'I saw ⟦EMAIL-1a2b3c⟧ and [EMAIL-1a2b3c] here',
  ];
  for (const text of texts) {
    const expected = text.match(TOKEN_RE).length;
    for (let i = 0; i <= text.length; i += 1) {
      const shown = carried([text.slice(0, i), text.slice(i)], env);
      assert.equal(shown.join(''), text, `split at ${i}`);
      const whole = shown.reduce(
        (n, piece) => n + (piece.match(TOKEN_RE) || []).length,
        0,
      );
      assert.equal(whole, expected, `split at ${i}: ${JSON.stringify(shown)}`);
    }
  }
  assert.deepEqual(readdirSync(path.join(env.ZEROH_HOME, 'display')), []);
});

test('a token split over three flushes is carried through the middle one', () => {
  const env = tempEnv();
  const text = 'Mail [EMAIL-1a2b3c] now\n';
  for (let i = 0; i <= text.length; i += 1) {
    for (let j = i; j <= text.length; j += 1) {
      const shown = carried(
        [text.slice(0, i), text.slice(i, j), text.slice(j)],
        env,
      );
      assert.equal(shown.join(''), text, `split at ${i}/${j}`);
      assert.equal(
        shown.filter((piece) => piece.includes('[EMAIL-1a2b3c]')).length,
        1,
        `split at ${i}/${j}: ${JSON.stringify(shown)}`,
      );
    }
  }
});

test('whole-line flushes (the Claude Code contract) leave no carry files', () => {
  const env = tempEnv();
  const shown = carried(['a [EMAIL-1a2b3c]\n', 'b\n', 'c'], env);
  assert.deepEqual(shown, ['a [EMAIL-1a2b3c]\n', 'b\n', 'c']);
  assert.equal(existsSync(path.join(env.ZEROH_HOME, 'display')), false);
});

test('a flush that may finish a token waits for the carry its predecessor is still writing', async () => {
  const env = tempEnv();
  const flush = {
    sessionId: 's',
    messageId: 'late',
    index: 1,
    delta: 'AIL-1a2b3c]\n',
  };
  const dir = carryDir('s', 'late', env);
  mkdirSync(dir, { recursive: true });
  const writer = spawn(process.execPath, [
    '-e',
    `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(path.join(dir, '0.carry'))}, '[EM'), 80)`,
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(takeCarry(flush, { env, waitMs: 2000 }), '[EM');
  await new Promise((resolve) => writer.on('exit', resolve));
  // A delta that cannot finish a token never waits.
  const other = { ...flush, messageId: 'other', delta: 'Hello\n' };
  mkdirSync(carryDir('s', 'other', env), { recursive: true });
  const started = Date.now();
  assert.equal(takeCarry(other, { env, waitMs: 2000 }), '');
  assert.ok(Date.now() - started < 1000);
});

test('MessageDisplay restores a token split across two flushes, in prose and in a code fence', () => {
  const p = tempProject({ env: false });
  const [mail, pass] = seed(p, [
    ['EMAIL', FAKE_EMAIL],
    ['PASSWORD', FAKE_PASS],
  ]);
  const prose = `Send it to ${mail} today.\n`;
  const fence = `\`\`\`bash\nexport PASS="${pass}"\n\`\`\`\n`;
  const cut = (text, token, offset) => text.indexOf(token) + offset;
  for (const [text, token, real] of [
    [prose, mail, `Send it to ${FAKE_EMAIL} today.\n`],
    [fence, pass, `\`\`\`bash\nexport PASS="${FAKE_PASS}"\n\`\`\`\n`],
  ]) {
    // Before the bracket, right after it, inside the type, after the dash,
    // inside the digits and just before the closing bracket.
    const dash = token.indexOf('-');
    for (const offset of [0, 1, 3, dash + 1, dash + 4, token.length - 1]) {
      const at = cut(text, token, offset);
      const { screen } = display(p, [text.slice(0, at), text.slice(at)], {
        messageId: `split-${at}`,
      });
      assert.equal(screen, real, `split at ${at}`);
      assert.doesNotMatch(screen, TOKEN_RE);
    }
  }
  assert.deepEqual(readdirSync(path.join(p.home, 'display')), []);
});

test('MessageDisplay shows a held fragment on the final flush, even an empty one', () => {
  const p = tempProject({ env: false });
  const [mail] = seed(p, [['EMAIL', FAKE_EMAIL]]);
  const { screen, answers } = display(p, [
    `Mail ${mail.slice(0, 5)}`,
    `${mail.slice(5)}`,
  ]);
  assert.equal(screen, `Mail ${FAKE_EMAIL}`);
  assert.equal(answers[0], 'Mail ');
  // Not a token after all: the final flush shows the fragment as written.
  const odd = display(p, ['List [EMAIL-', ''], { messageId: 'odd' });
  assert.equal(odd.screen, 'List [EMAIL-');
  const odd2 = display(p, ['List [', 'x] and more\n', 'end'], {
    messageId: 'odd2',
  });
  assert.equal(odd2.screen, 'List [x] and more\nend');
});

test('a split ⟦named⟧ token is shown as written, never restored', () => {
  const p = tempProject({ env: false });
  const [mail] = seed(p, [['EMAIL', FAKE_EMAIL]]);
  const named = `⟦${mail.slice(1, -1)}⟧`;
  const text = `I saw ${named} in the file.\n`;
  for (let at = text.indexOf('⟦'); at <= text.indexOf('⟧') + 1; at += 3) {
    const { screen } = display(p, [text.slice(0, at), text.slice(at)], {
      messageId: `named-${at}`,
    });
    assert.equal(screen, text);
  }
});

test('a token the vault does not hold stays as written; ZEROH_DISPLAY_REAL_VALUES=0 keeps tokens', () => {
  const p = tempProject({ env: false });
  const [mail] = seed(p, [['EMAIL', FAKE_EMAIL]]);
  const unknown = '[EMAIL-000000]';
  const miss = display(p, [
    `Other ${unknown.slice(0, 4)}`,
    `${unknown.slice(4)} end\n`,
  ]);
  assert.equal(miss.screen, `Other ${unknown} end\n`);
  const whole = runHook(
    'message-display',
    { delta: `Other ${unknown}\n` },
    { project: p },
  );
  assert.equal(whole.json, null, 'a miss without a carry changes nothing');
  const off = display(p, [`Mail ${mail.slice(0, 3)}`, `${mail.slice(3)}\n`], {
    messageId: 'off',
    extraEnv: { ZEROH_DISPLAY_REAL_VALUES: '0' },
  });
  assert.equal(off.screen, `Mail ${mail}\n`);
});

test('ZEROH_DISPLAY_TRACE records how a message was chunked, without text', () => {
  const p = tempProject({ env: false });
  const [mail] = seed(p, [['EMAIL', FAKE_EMAIL]]);
  display(p, [`one ${mail}\ntwo\n`, 'three\n', ''], {
    messageId: 'traced',
    extraEnv: { ZEROH_DISPLAY_TRACE: '1' },
  });
  const log = readFileSync(path.join(p.home, 'display-trace.log'), 'utf8');
  const lines = log
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((l) => [l.index, l.final, l.lines, l.endsWithNewline, l.outcome]),
    [
      [0, false, 2, true, 'restored'],
      [1, false, 1, true, 'no-token'],
      [2, true, 0, false, 'no-token'],
    ],
  );
  assert.doesNotMatch(log, /ZEROHFAKE|EMAIL-|one|two|three/);
});
