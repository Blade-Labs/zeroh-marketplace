// SPDX-License-Identifier: AGPL-3.0-only

// Removing the plugin itself from Claude Code (T-38), through Claude Code's
// own documented CLI (`claude plugin list --json`, `claude plugin uninstall`);
// ZeroH never edits Claude Code's plugin files. When the `claude` CLI isn't
// available, the caller prints the exact command instead.
import { execFileSync } from 'node:child_process';

const PLUGIN_RE = /^zeroh-disclosure(?:@[A-Za-z0-9_.-]+)?$/u;

// The `claude` program: ZEROH_CLAUDE_BIN only for tests, else `claude`.
function claudeBin(env) {
  return env.ZEROH_CLAUDE_BIN || 'claude';
}

function run(env, args) {
  return execFileSync(claudeBin(env), args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    shell: process.platform === 'win32',
  });
}

// Every installed copy of this plugin: [{ id, scope }] from the JSON listing,
// whatever its exact shape (an array, or objects keyed by id).
export function installedPluginIds(env = process.env) {
  const listing = JSON.parse(run(env, ['plugin', 'list', '--json']));
  const found = new Map();
  const visit = (value, key = null) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const id = [value.id, value.name, value.plugin, key].find(
      (candidate) => typeof candidate === 'string' && PLUGIN_RE.test(candidate),
    );
    if (id) {
      const scope = typeof value.scope === 'string' ? value.scope : 'user';
      found.set(`${id}\0${scope}`, { id, scope });
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (child && typeof child === 'object') visit(child, childKey);
    }
  };
  visit(listing);
  return [...found.values()];
}

// Uninstalls every copy; returns { removed, failed, unavailable }.
export function removePlugin(env = process.env) {
  let ids;
  try {
    ids = installedPluginIds(env);
  } catch (error) {
    return { removed: [], failed: [], unavailable: error.code || 'error' };
  }
  const removed = [];
  const failed = [];
  for (const { id, scope } of ids) {
    try {
      run(env, ['plugin', 'uninstall', id, '--scope', scope]);
      removed.push({ id, scope });
    } catch (error) {
      failed.push({ id, scope, error: error.code || error.status || 'error' });
    }
  }
  return { removed, failed, unavailable: null };
}

export function uninstallCommandFor({ id, scope }) {
  return `claude plugin uninstall ${id}${scope && scope !== 'user' ? ` --scope ${scope}` : ''}`;
}
