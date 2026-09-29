// SPDX-License-Identifier: AGPL-3.0-only

// The session's status file for the status line (rc.2): what the hooks
// already know, kept where `zeroh-disclosure statusline` can read it in a few
// milliseconds without asking the proxy or the vault anything:
//
//   <ZEROH_HOME>/projects/<project>/sessions/<id>/status.json
//   {
//     v: 1,
//     updated_at,              ISO time of the last write
//     writer_version,          the plugin version that last wrote it
//     phase,                   'starting' while SessionStart runs, then 'ready'
//     hooks: { <hook>: { ok_at, failed_at } }  a failure is cleared only by
//                              a later success of the same hook
//     proxy,                   'on' | 'ready' | why typing is not masked
//     paused,                  true when the vault could not be opened
//     turn,                    the current turn
//     masked,                  values masked this session (as the receipt counts them)
//     sent,                    real values sent to the model unmasked this session
//     unchecked: { turn, count }  operations let through unprotected on that turn
//   }
//
// Beside it, `hooks.alive` is touched by the hook loader on every hook run
// (the status line compares it with the transcript's time). The schema only
// grows: new fields are added, none is renamed or given a new meaning, and
// `v` stays 1. It holds counts and states only: never a value, a token, a
// path or a host.
// Every write is atomic (lib/private-fs.js) under a short lock, and never
// throws: the status line is advisory and must not slow or break a hook.
import { closeSync, openSync, readFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensurePrivateDir,
  readJsonOr,
  writePrivateJson,
} from './private-fs.js';
import { sessionDir } from './session.js';
import { acquireFileLock, releaseFileLock } from './vault.js';

export const STATUS_FILE = 'status.json';
export const HEARTBEAT_FILE = 'hooks.alive';
const VERSION = 1;
let writerVersion;
function pluginVersion() {
  if (writerVersion === undefined) {
    try {
      writerVersion = JSON.parse(
        readFileSync(
          fileURLToPath(new URL('../package.json', import.meta.url)),
          'utf8',
        ),
      ).version;
    } catch {
      writerVersion = null;
    }
  }
  return writerVersion;
}

export function sessionStatusPath(cwd, sessionId, env = process.env) {
  return path.join(sessionDir(cwd, sessionId, env), STATUS_FILE);
}

// Applies `change(status)` (mutating or returning a new object) to the
// session's status and writes it. Returns true when it wrote.
export function updateSessionStatus(
  { cwd, sessionId, env = process.env, waitMs = 200, now = Date.now() },
  change,
) {
  if (!sessionId) return false;
  let lock = null;
  try {
    const file = sessionStatusPath(cwd, sessionId, env);
    ensurePrivateDir(path.dirname(file), { env });
    lock = acquireFileLock(`${file}.lock`, { waitMs });
    const current = readJsonOr(file);
    const base =
      current && typeof current === 'object' && current.v === VERSION
        ? current
        : { v: VERSION };
    const next = change(base) ?? base;
    next.v = VERSION;
    next.writer_version = pluginVersion();
    next.updated_at = new Date(now).toISOString();
    writePrivateJson(file, next, { pretty: false });
    return true;
  } catch {
    return false;
  } finally {
    if (lock) {
      try {
        releaseFileLock(lock);
      } catch {
        // A lock left behind is reclaimed when it goes stale.
      }
    }
  }
}

// A hook finished its work (or failed): only a success of the same hook
// clears that hook's failure.
export function markHook(status, name, ok, now = Date.now()) {
  const hooks =
    status.hooks && typeof status.hooks === 'object' ? status.hooks : {};
  const entry = { ...(hooks[name] ?? {}) };
  entry[ok ? 'ok_at' : 'failed_at'] = new Date(now).toISOString();
  status.hooks = { ...hooks, [name]: entry };
  return status;
}

// The loader's record of one hook run: the heartbeat, and the hook's health.
// Never throws.
export function recordHookRun({ cwd, sessionId, name, ok, env = process.env }) {
  if (!sessionId) return false;
  try {
    const dir = sessionDir(cwd, sessionId, env);
    ensurePrivateDir(dir, { env });
    const heartbeat = path.join(dir, HEARTBEAT_FILE);
    const now = new Date();
    try {
      utimesSync(heartbeat, now, now);
    } catch {
      closeSync(openSync(heartbeat, 'a', 0o600));
    }
  } catch {
    // The status line then relies on status.json alone.
  }
  return updateSessionStatus({ cwd, sessionId, env }, (status) =>
    markHook(status, name, ok),
  );
}

// The unprotected passes of `turn` (lib/unchecked.js recordUnchecked).
export function addUnchecked(status, turn, count = 1) {
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  if (status.unchecked?.turn === turn) {
    status.unchecked.count = (Number(status.unchecked.count) || 0) + n;
  } else {
    status.unchecked = { turn, count: n };
  }
  return status;
}

// Real values sent to the model unmasked (a typed secret without the proxy).
// `count` is distinct values (a count of 0 adds nothing).
export function addSent(status, count = 1) {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  if (n) status.sent = (Number(status.sent) || 0) + n;
  return status;
}
