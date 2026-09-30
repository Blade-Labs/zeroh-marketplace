// SPDX-License-Identifier: AGPL-3.0-only

// The "uninstalled" tombstone (T-38). `uninstall` writes it first, removes
// everything in ZEROH_HOME except this file, and last the plugin from Claude
// Code; a Claude
// Code session already running keeps the plugin's hooks loaded until the user
// exits it, and those hooks must not set ZeroH up again. While it exists
// every hook does nothing, except the SessionStart of a newly started
// session: a new session only loads the plugin when it was installed again,
// so that SessionStart removes the tombstone and ZeroH works as before.
//
// It lives in ZEROH_HOME (private to the user, 0700, and guarded from the
// model like the rest of it), not in the shared temporary folder where any
// local user could create it and silence every hook (lifecycle review
// 2026-09-27). A tombstone that isn't a regular file owned by this user is
// ignored. Node built-ins only (lib/private-fs.js is built-ins only too), so
// the hook loader can check it before anything else loads.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zerohHome } from './private-fs.js';

export const UNINSTALL_MARKER = 'uninstalled';

export function uninstallMarkerPath(env = process.env) {
  return path.join(path.resolve(zerohHome(env)), UNINSTALL_MARKER);
}

// Where builds before rc.2 put it; removed with the new one.
function legacyMarkerPath(env) {
  const home = path.resolve(zerohHome(env));
  const id = createHash('sha256').update(home).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `zeroh-disclosure-uninstalled-${id}`);
}

export function markUninstalled(env = process.env, now = Date.now()) {
  const file = uninstallMarkerPath(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  rmSync(file, { force: true });
  writeFileSync(
    file,
    `${JSON.stringify({ uninstalled_at: new Date(now).toISOString() })}\n`,
    { mode: 0o600, flag: 'wx' },
  );
}

// A regular file owned by this user (on POSIX); anything else is not ours.
export function isUninstalled(env = process.env) {
  try {
    const stat = lstatSync(uninstallMarkerPath(env));
    if (!stat.isFile()) return false;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearUninstalled(env = process.env) {
  for (const file of [uninstallMarkerPath(env), legacyMarkerPath(env)]) {
    try {
      rmSync(file, { force: true });
    } catch {
      // Removed at the next start.
    }
  }
}

// Whether hook `name` should do nothing for this event: after uninstall,
// every hook but a new session's SessionStart (which clears the tombstone).
export function hookStandsDown(name, event, env = process.env) {
  if (!isUninstalled(env)) return false;
  if (name === 'session-start' && (event?.source ?? 'startup') === 'startup') {
    clearUninstalled(env);
    return false;
  }
  return true;
}
