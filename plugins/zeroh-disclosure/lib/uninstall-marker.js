// SPDX-License-Identifier: AGPL-3.0-only

// The "uninstalled" tombstone (T-38). `uninstall` removes the plugin from
// Claude Code and then ZEROH_HOME; a Claude Code session already running
// keeps the plugin's hooks loaded until the user exits it, and those hooks
// must not set ZeroH up again. The tombstone lives outside ZEROH_HOME (in the
// system's temporary folder, named for this ZEROH_HOME), so it survives the
// home's removal. While it exists every hook does nothing, except the
// SessionStart of a newly started session: a new session only loads the
// plugin when it was installed again, so that SessionStart removes the
// tombstone and ZeroH works as before. Node built-ins only (lib/private-fs.js
// is built-ins only too), so the hook loader can check it before anything
// else loads.
import { createHash } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zerohHome } from './private-fs.js';

export function uninstallMarkerPath(env = process.env) {
  const home = path.resolve(zerohHome(env));
  const id = createHash('sha256').update(home).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `zeroh-disclosure-uninstalled-${id}`);
}

export function markUninstalled(env = process.env, now = Date.now()) {
  writeFileSync(
    uninstallMarkerPath(env),
    `${JSON.stringify({ uninstalled_at: new Date(now).toISOString() })}\n`,
    { mode: 0o600 },
  );
}

export function isUninstalled(env = process.env) {
  try {
    return existsSync(uninstallMarkerPath(env));
  } catch {
    return false;
  }
}

export function clearUninstalled(env = process.env) {
  try {
    rmSync(uninstallMarkerPath(env), { force: true });
  } catch {
    // Removed at the next start.
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
