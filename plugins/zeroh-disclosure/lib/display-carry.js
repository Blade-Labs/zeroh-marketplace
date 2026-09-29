// SPDX-License-Identifier: AGPL-3.0-only

// MessageDisplay carry-over: a token cut in two by the flush boundary.
//
// Claude Code runs MessageDisplay once per flush of a streaming message and
// shows each hook's `displayContent` in place of that flush's `delta`, in
// flush order (2.1.283: the queue appends every answer to the message's
// output, so an answer may be shorter or longer than its delta). Its
// contract: a delta is whole lines, except the final flush (`final: true`,
// exactly one per message), which may end mid-line. A token never holds a
// newline, so with that contract no token is ever cut. This module is the
// safety net for a Claude Code that flushes mid-line: a non-final delta that
// ends in a partial `[TYPE-xxx` is shown without that fragment, the fragment
// is kept in a private file keyed by session and message, and the next flush
// shows it in front of its own delta. The final flush always shows
// everything and removes the message's files. Nothing is lost or shown twice
// as long as the next flush's hook runs (if it fails, Claude Code shows its
// original delta and the fragment is gone from the screen, never from the
// stored message).
//
// ⟦TYPE-xxxxxx⟧ tokens are never restored, so they are never held back.
//
// Hooks for one message run concurrently (up to three flushes in flight), so
// a flush that may continue a token waits briefly for its predecessor's
// carry file. It only waits when the message has a carry folder at all (a
// predecessor ended mid-line) and its own delta starts like the rest of a
// token, so a Claude Code that keeps the contract never waits.
import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  appendPrivateLog,
  ensurePrivateDir,
  writePrivateFile,
  zerohHome,
} from './private-fs.js';

// The longest token: `[` + a type name + `-` + 6 hex digits + `]`. Type names
// are short (PHONE_NUMBER, CARD_NUMBER); 40 leaves room.
const MAX_TYPE = 40;
export const MAX_FRAGMENT = 1 + MAX_TYPE + 1 + 6;

// A trailing piece of text that a later flush could complete into a plain
// token: `[`, `[EM`, `[EMAIL-`, `[EMAIL-1a2b3c` (only the `]` missing).
const TAIL_RE = new RegExp(
  String.raw`\[[A-Z_]{0,${MAX_TYPE}}(?:-[0-9a-f]{0,6})?$`,
);
// The start of a delta that could finish such a fragment: the rest of a
// token up to its `]`, or a delta that is nothing but token characters (a
// fragment growing over several flushes).
const HEAD_RE = new RegExp(
  String.raw`^(?:[A-Z_]{0,${MAX_TYPE}}-[0-9a-f]{6}|[0-9a-f]{0,6})\]|^[A-Z_0-9a-f-]{1,${MAX_FRAGMENT}}$`,
);

const CARRY_WAIT_MS = 250;
const CARRY_POLL_MS = 10;
const STALE_MS = 60 * 60 * 1000;

// The fragment `text` ends with that must be held back, or ''. Only a
// non-final flush whose text ends mid-line holds anything back.
export function heldFragment(text, { final = false } = {}) {
  if (final || !text || text.endsWith('\n')) return '';
  const match = TAIL_RE.exec(text);
  return match ? match[0] : '';
}

// Whether `delta` starts like the rest of a token cut by the previous flush.
export function mayContinueToken(delta) {
  return typeof delta === 'string' && delta !== '' && HEAD_RE.test(delta);
}

// Splits what this flush should show: `carry` (the previous flush's held
// fragment) in front of `delta`, minus the fragment held back for the next.
// Returns { text, held }, where text + held === carry + delta.
export function splitFlush(carry, delta, { final = false } = {}) {
  const whole = `${carry || ''}${delta}`;
  const held = heldFragment(whole, { final });
  return { text: whole.slice(0, whole.length - held.length), held };
}

// The folder holding one message's carry files.
export function carryDir(sessionId, messageId, env = process.env) {
  const key = createHash('sha256')
    .update(`${sessionId ?? ''}\0${messageId}`)
    .digest('hex')
    .slice(0, 32);
  return path.join(zerohHome(env), 'display', key);
}

function carryFile(dir, index) {
  return path.join(dir, `${index}.carry`);
}

function readCarry(dir, index) {
  try {
    return readFileSync(carryFile(dir, index), 'utf8');
  } catch {
    return null;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The fragment the previous flush (index - 1) held back, '' when none. Waits
// up to CARRY_WAIT_MS for it only when this delta could continue a token and
// the message already has a carry folder.
export function takeCarry(
  { sessionId, messageId, index, delta },
  { env = process.env, waitMs = CARRY_WAIT_MS } = {},
) {
  if (!messageId || !Number.isInteger(index) || index < 1) return '';
  const dir = carryDir(sessionId, messageId, env);
  if (!existsSync(dir)) return '';
  let carry = readCarry(dir, index - 1);
  if (carry !== null || !mayContinueToken(delta)) return carry ?? '';
  const deadline = Date.now() + waitMs;
  while (carry === null && Date.now() < deadline) {
    sleep(CARRY_POLL_MS);
    carry = readCarry(dir, index - 1);
  }
  return carry ?? '';
}

// Records what this flush held back. A flush that ended mid-line records
// even an empty fragment, so its successor need not wait for it.
export function putCarry(
  { sessionId, messageId, index, final, delta },
  held,
  { env = process.env } = {},
) {
  if (!messageId || !Number.isInteger(index) || final) return;
  if (typeof delta !== 'string' || delta === '' || delta.endsWith('\n')) {
    if (!held) return;
  }
  const dir = carryDir(sessionId, messageId, env);
  try {
    if (!existsSync(dir)) {
      pruneStale(path.dirname(dir));
      ensurePrivateDir(dir, { env });
    }
    writePrivateFile(carryFile(dir, index), held);
  } catch {
    // Best effort: the fragment was already left out of this flush; a
    // missing carry file shows the next flush as Claude Code sent it.
  }
}

// The final flush removes the message's carry folder.
export function clearCarry(
  { sessionId, messageId },
  { env = process.env } = {},
) {
  if (!messageId) return;
  try {
    rmSync(carryDir(sessionId, messageId, env), {
      recursive: true,
      force: true,
    });
  } catch {
    // Best effort; pruneStale removes it later.
  }
}

// Carry folders of messages whose final flush never ran (an interrupted
// reply) are removed after an hour.
function pruneStale(root) {
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      if (now - statSync(dir).mtimeMs > STALE_MS) {
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Another hook removed it.
    }
  }
}

// ZEROH_DISPLAY_TRACE=1 appends one value-free line per flush to
// <ZEROH_HOME>/display-trace.log: how Claude Code chunked the message and
// what the hook did. It never holds text, only lengths and flags.
export function traceFlush(record, env = process.env) {
  if (env.ZEROH_DISPLAY_TRACE !== '1') return;
  appendPrivateLog(
    path.join(zerohHome(env), 'display-trace.log'),
    JSON.stringify({ at: new Date().toISOString(), ...record }),
  );
}
