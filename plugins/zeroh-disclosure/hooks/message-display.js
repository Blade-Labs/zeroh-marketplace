#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// MessageDisplay: show real values on the user's screen. The stored message and
// what the model sees keep the tokens.
//
// Runs once per flush of a streaming message (up to ten a second, three at a
// time in Claude Code 2.1.283), and a flush whose hook fails or runs past
// the loader's deadline is shown as Claude Code sent it: with tokens. So the
// path is kept short: only the token pattern and the carry-over
// (lib/display-carry.js) load up front, and a flush without a token answers
// from there. The detectors (lib/secrets.js) and the proxy plumbing
// (lib/hook-io.js) are never loaded here; they cost more than everything
// else this hook does. The answer goes out before the vault's last-use
// bookkeeping is saved.
import {
  containsToken,
  nameMentionedTokens,
  TOKEN_RE,
} from '../lib/token-pattern.js';
import {
  clearCarry,
  putCarry,
  splitFlush,
  takeCarry,
  traceFlush,
} from '../lib/display-carry.js';

const started = Date.now();

// The event, as lib/hook-io.js readStdinJson reads it (without its imports).
async function readEvent() {
  let raw = globalThis.zerohHook?.input;
  if (raw === undefined) {
    if (process.stdin.isTTY) return null;
    raw = '';
    for await (const chunk of process.stdin) raw += chunk;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// As lib/hook-io.js emit: the loader must know the answer was written.
function answer(displayContent) {
  if (globalThis.zerohHook) globalThis.zerohHook.state.emitted = true;
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent },
    })}\n`,
  );
}

const event = await readEvent();
const delta = event?.delta;
if (typeof delta !== 'string') process.exit(0);

const flush = {
  sessionId: event?.session_id,
  messageId: typeof event?.message_id === 'string' ? event.message_id : null,
  index: event?.index,
  final: event?.final === true,
  delta,
};
// What this flush shows: a fragment the previous flush held back, then this
// delta, minus a fragment held back for the next flush.
const carry = takeCarry(flush);
const { text, held } = splitFlush(carry, delta, { final: flush.final });
putCarry(flush, held);
if (flush.final) clearCarry(flush);

function trace(outcome) {
  traceFlush({
    message: flush.messageId ? flush.messageId.slice(0, 8) : null,
    index: flush.index,
    final: flush.final,
    deltaLength: delta.length,
    lines: delta.split('\n').length - 1,
    endsWithNewline: delta.endsWith('\n'),
    carryIn: carry.length,
    heldBack: held.length,
    tokens: (text.match(TOKEN_RE) || []).length,
    outcome,
    ms: Date.now() - started,
  });
}

// `text` as it is: no answer when it is the delta Claude Code sent, unless
// `always` (the vault could not be read: say so by answering as it is).
function showAsIs(outcome, { always = false } = {}) {
  trace(outcome);
  if (always || text !== delta) answer(text);
  process.exit(0);
}

if (!containsToken(text)) showAsIs('no-token');

const [{ loadConfig }, { saveQuietly, Vault }, { projectRootFromEnv }] =
  await Promise.all([
    import('../lib/config.js'),
    import('../lib/vault.js'),
    import('../lib/session.js'),
  ]);
const root = projectRootFromEnv(event?.cwd);
try {
  await loadConfig({ cwd: root });
} catch {
  // An unreadable .zeroh.env leaves the process environment as it is.
}
if (process.env.ZEROH_DISPLAY_REAL_VALUES === '0') showAsIs('display-off');

let vault;
let shown;
let restored = 0;
try {
  vault = new Vault(root, { sessionId: event?.session_id });
  // A token the model plainly talks about is shown as ⟦token⟧, not restored.
  const named = nameMentionedTokens(text);
  shown = named.text.replace(new RegExp(TOKEN_RE.source, 'g'), (token) => {
    const entry = vault.entryOf(token);
    if (!entry) return token;
    restored += 1;
    return entry.value;
  });
} catch {
  showAsIs('vault-unreadable', { always: true });
}
if (shown === delta) showAsIs('vault-miss');
// Answer first: last-use bookkeeping (which may wait for the vault lock)
// never holds the screen up.
answer(shown);
trace(restored ? 'restored' : shown !== text ? 'named' : 'carry');
saveQuietly(vault, 'ZeroH Disclosure (MessageDisplay)');
