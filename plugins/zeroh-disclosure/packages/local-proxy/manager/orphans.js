// SPDX-License-Identifier: AGPL-3.0-only

// Proxy removal, orphan cleanup and session-only shutdown.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  installId,
  readRestoreRecord,
  removeRestoreRecord,
  resolveClaudeSettingsPath,
  takeEntryOut,
  writeProxyOffRecord,
} from '../claude-settings.js';
import { sameSecret } from '../../zeroh-disclosure-core/crypto.js';
import {
  hasActivePlugin,
  installFor,
  liveMaskingRoots,
  ORPHAN_AFTER_MS,
  proxyPaths,
  readProxyConfig,
  withProxyLock,
  writeProxyConfig,
  zerohPorts,
} from '../proxy-state.js';
import { createServiceManager } from '../service-manager.js';
import { leaveDaemon, portUrl, retireDaemon } from './probe.js';

export function restoreClaudeSettings({
  env = process.env,
  settingsPath,
  config = readProxyConfig(proxyPaths(env)),
  probedPorts = [],
} = {}) {
  const target = path.resolve(
    settingsPath || resolveClaudeSettingsPath({ env }),
  );
  const record = installFor(config, target) || readRestoreRecord(target);
  const ports = zerohPorts(proxyPaths(env), { settingsPath: target });
  for (const port of probedPorts) ports.add(port);
  let result;
  try {
    result = takeEntryOut(target, record, { match: 'ours', ports });
  } catch (error) {
    return {
      restored: false,
      reason: 'invalid-json',
      settingsPath: target,
      error: error.message,
    };
  }
  removeRestoreRecord(target);
  if (result.removed) return { restored: true, settingsPath: target };
  return {
    restored: false,
    reason: record ? 'user-changed' : 'not-installed',
    settingsPath: target,
  };
}

// Everything under proxy/ except the lock the caller holds, and the runtime.
export function removeProxyState(paths) {
  try {
    for (const name of readdirSync(paths.directory)) {
      if (path.join(paths.directory, name) === paths.lock) continue;
      rmSync(path.join(paths.directory, name), {
        recursive: true,
        force: true,
      });
    }
  } catch {
    // Nothing to remove.
  }
  rmSync(paths.runtime, { recursive: true, force: true });
}

// `proxy off` for one settings file. With `remember` (the command, LP-B2)
// the choice is recorded next to the settings file, so no hook, SessionStart
// or later prompt sets the proxy up again until `proxy on` or `doctor --fix`.
// With `retire` (the command) the daemon is retired rather than stopped, so
// the sessions still open keep working (retireDaemon).
export async function stopDefaultProxy(options = {}) {
  const env = options.env || process.env;
  const paths = proxyPaths(env);
  return withProxyLock(paths, async () => {
    const target = path.resolve(
      options.settingsPath || resolveClaudeSettingsPath({ env }),
    );
    const config = readProxyConfig(paths);
    const restored = restoreClaudeSettings({
      env,
      settingsPath: target,
      config,
    });
    if (options.remember && restored.reason !== 'invalid-json') {
      writeProxyOffRecord(target);
    }
    if (config) delete config.installs[installId(target)];
    const remaining = Object.values(config?.installs || {}).map(
      (install) => install.settingsPath,
    );
    if (remaining.length) {
      writeProxyConfig(paths, config);
      return { ...restored, stopped: false, loginItem: null, remaining };
    }
    const left = await leaveDaemon(config?.port, config?.controlToken, {
      retire: options.retire,
    });
    const loginItem = (
      options.serviceManager || createServiceManager({ env })
    ).unregister({ keepRunning: left.retired });
    removeProxyState(paths);
    return { ...restored, ...left, loginItem, remaining };
  });
}

// `zeroh-disclosure uninstall`: every settings file ZeroH wrote to gets the
// user's own setting back (and loses its restore record), the daemon stops
// (or, with `retire`, keeps serving the sessions still open, masking
// nothing: the caller deletes the vault and hooks next, so no token could
// be put back) and the login item goes. The caller then deletes ZEROH_HOME.
// Under the manager lock, so no SessionStart or prompt sets the proxy up
// again half-way.
export async function removeProxyEverywhere({
  env = process.env,
  serviceManager,
  retire = false,
} = {}) {
  const paths = proxyPaths(env);
  return withProxyLock(paths, () =>
    removeProxyEverywhereLocked({ env, paths, serviceManager, retire }),
  );
}

async function removeProxyEverywhereLocked({
  env,
  paths,
  serviceManager,
  retire,
}) {
  const config = readProxyConfig(paths);
  const files = new Set([
    ...Object.values(config?.installs || {}).map((install) =>
      path.resolve(install.settingsPath),
    ),
    path.resolve(resolveClaudeSettingsPath({ env })),
  ]);
  const restored = [];
  for (const settingsPath of files) {
    const result = restoreClaudeSettings({ env, settingsPath, config });
    if (result.restored) restored.push(settingsPath);
    removeRestoreRecord(settingsPath);
  }
  // Retired masking nothing: ZEROH_HOME (the vault) and the hooks go next.
  const left = await leaveDaemon(config?.port, config?.controlToken, {
    retire,
    masking: false,
  });
  const loginItem = (
    serviceManager || createServiceManager({ env })
  ).unregister({ keepRunning: left.retired });
  return {
    restored,
    ...left,
    loginItemRemoved: Boolean(loginItem?.removed),
  };
}

// `proxy on`: forgets a `proxy off` for this settings file. The next prompt or
// session sets the proxy up again.

// --- a plugin removed without `proxy off` -----------------------------------

// Run by the daemon every minute. Once no hook of an installed plugin has
// refreshed a route for ORPHAN_AFTER_MS, restores every settings file that
// points at the proxy, removes the login item and the proxy's files, and
// drains the daemon so sessions still on its port work until idle.
export async function evaluateOrphanCleanup({
  env = process.env,
  serviceManager = createServiceManager({ env }),
  now = Date.now,
  pathExists = existsSync,
  log = () => {},
  drain = (config) =>
    retireDaemon(config.port, config.controlToken, {
      masking: false,
      mode: 'draining',
    }),
} = {}) {
  const paths = proxyPaths(env);
  return withProxyLock(
    paths,
    async () => {
      const config = readProxyConfig(paths);
      if (!config) return { cleaned: false, active: false };
      if (hasActivePlugin(paths, { now: now(), pathExists })) {
        if (config.orphanSince) {
          delete config.orphanSince;
          writeProxyConfig(paths, config);
        }
        return { cleaned: false, active: true };
      }
      const since = new Date(config.orphanSince).getTime();
      if (!Number.isFinite(since)) {
        config.orphanSince = new Date(now()).toISOString();
        writeProxyConfig(paths, config);
        return { cleaned: false, active: false };
      }
      if (now() - since < ORPHAN_AFTER_MS) {
        return { cleaned: false, active: false };
      }
      if ((await drain(config)) === false) {
        return { cleaned: false, active: false, reason: 'drain-unavailable' };
      }
      const restored = Object.values(config.installs).map((install) =>
        restoreClaudeSettings({
          env,
          settingsPath: install.settingsPath,
          config,
        }),
      );
      removeProxyState(paths);
      log(
        'ZeroH Disclosure: plugin inactive for 24 hours; restored Claude settings, removed the login item, and draining the proxy until sessions go idle.',
      );
      // bootout would kill the sessions still using this port on macOS.
      const loginItem = serviceManager.unregister({ keepRunning: true });
      return { cleaned: true, active: false, restored, loginItem };
    },
    { waitMs: 100 },
  );
}

// --- no login item: the proxy lives while plugin sessions do ----------------

// Run by the daemon every minute. Where the system refused the login item,
// nothing starts the daemon after a reboot, so its settings entries may exist
// only while a plugin session uses them. Once no live plugin session is left
// (every route ended, gone or opted out), the entries that still name this
// daemon come out and `leave` runs under the manager lock, so a SessionStart
// never finds a daemon that is about to go. The next session's SessionStart
// starts a daemon again and its first prompt writes the entry.
export async function evaluateSessionOnlyExit({
  env = process.env,
  controlToken,
  leave = () => {},
  now = Date.now,
  pathExists = existsSync,
} = {}) {
  const paths = proxyPaths(env);
  return withProxyLock(
    paths,
    async () => {
      const config = readProxyConfig(paths);
      if (!config?.loginItemRefused) return { leave: false };
      // Replaced by another daemon: it owns the entries now.
      if (controlToken && !sameSecret(config.controlToken, controlToken)) {
        return { leave: false };
      }
      if (liveMaskingRoots(paths, { now: now(), pathExists }).size) {
        return { leave: false };
      }
      let restored = 0;
      for (const install of Object.values(config.installs || {})) {
        const url = `${portUrl(config.port)}/z/${install.key}`;
        try {
          if (
            takeEntryOut(install.settingsPath, install, { match: url }).removed
          )
            restored += 1;
        } catch {
          // An unreadable settings file is left as it is.
        }
      }
      if (restored) writeProxyConfig(paths, config);
      await leave();
      return { leave: true, restored };
    },
    { waitMs: 100 },
  );
}

// What /zeroh-disclosure:status says about the proxy itself: whether this
// home's daemon answers now, and whether a login item starts it after a
// restart (or why the system refused one). Read-only.
