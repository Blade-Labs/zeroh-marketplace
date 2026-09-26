// SPDX-License-Identifier: AGPL-3.0-only

// The default proxy's files, shared by SessionStart, the hooks, the daemon,
// `proxy off` and doctor. Under <ZEROH_HOME>:
//
//   proxy/proxy.json         the daemon's port and control token, the plugin
//                            directory, the path variables it runs with, and
//                            one install per Claude settings file: its access
//                            key, upstream and the user's original setting.
//                            Written under proxy/manager.lock.
//   proxy/routes/<sid>.json  one per Claude session, refreshed by every hook:
//                            the project root, the settings file it belongs
//                            to (install), the opt-out, whether the daemon
//                            has seen its traffic, whether it ended, and the
//                            notice that its proxy is down.
//   proxy/manager.lock       serialises the writers of proxy.json.
//   bin/zeroh-disclosure-proxy/  the copy of lib/ the daemon runs from, so a
//                            plugin update or removal never pulls code from
//                            under it; build.json names its version.
//   logs/proxy.log           the daemon's own notices, capped in size.
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  installId,
  readRestoreRecord,
  resolveClaudeSettingsPath,
} from './claude-settings.js';
import { loopbackPort } from './loopback.js';
import {
  ensurePrivateDir,
  readJsonFile,
  readJsonOr,
  writePrivateJson,
} from './private-fs.js';
import { acquireFileLock, releaseFileLock, zerohHome } from './vault.js';

// A route no hook refreshed for this long no longer masks its session.
export const ROUTE_MAX_AGE_MS = 36 * 60 * 60 * 1000;
// With no route from an installed plugin for this long, the daemon restores
// every settings file and removes itself (the plugin was removed).
export const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000;
// Hooks rewrite an unchanged route at most this often.
const ROUTE_REFRESH_INTERVAL_MS = 30_000;

export function proxyPathsInHome(home) {
  const directory = path.join(home, 'proxy');
  return {
    home,
    directory,
    config: path.join(directory, 'proxy.json'),
    routes: path.join(directory, 'routes'),
    lock: path.join(directory, 'manager.lock'),
    runtime: path.join(home, 'bin', 'zeroh-disclosure-proxy'),
    log: path.join(home, 'logs', 'proxy.log'),
  };
}

export function proxyPaths(env = process.env) {
  return proxyPathsInHome(path.resolve(zerohHome(env)));
}

export function readProxyConfig(paths) {
  const config = readJsonOr(paths.config);
  if (!config || typeof config !== 'object' || !config.controlToken) {
    return null;
  }
  config.installs ||= {};
  return config;
}

export function writeProxyConfig(paths, config) {
  writePrivateJson(paths.config, config);
}

export async function withProxyLock(paths, work, { waitMs } = {}) {
  ensurePrivateDir(paths.directory);
  const lock = acquireFileLock(paths.lock, waitMs ? { waitMs } : {});
  try {
    return await work();
  } finally {
    releaseFileLock(lock);
  }
}

export function installFor(config, settingsPath) {
  return config?.installs?.[installId(settingsPath)] ?? null;
}

// The daemon answers a health request carrying a nonce with this HMAC under
// its control token, so a hook can tell this home's daemon from any other
// program on the port.
export function healthProof(controlToken, { nonce, sessionId, session }) {
  return createHmac('sha256', String(controlToken))
    .update(`${nonce}\n${sessionId || ''}\n${session || ''}`)
    .digest('hex');
}

// Loopback ports ZeroH records name in this home: proxy.json, the restore
// record next to the settings file, and any JSON file an earlier build left
// in the proxy directory. A loopback base URL on one of them is never a
// user's own upstream.
export function zerohPorts(paths, { settingsPath = null } = {}) {
  const ports = new Set();
  const add = (value) => {
    if (Number.isInteger(value) && value > 0 && value < 65536) ports.add(value);
    else if (typeof value === 'string') {
      const port = loopbackPort(value);
      if (port) ports.add(port);
    }
  };
  const collect = (record) => {
    if (!record || typeof record !== 'object') return;
    for (const name of ['port', 'url', 'proxyUrl', 'previousProxyUrl']) {
      add(record[name]);
    }
    for (const install of Object.values(record.installs || {})) {
      add(install?.proxyUrl);
    }
  };
  try {
    for (const name of readdirSync(paths.directory)) {
      if (name.endsWith('.json')) {
        collect(readJsonOr(path.join(paths.directory, name)));
      }
    }
  } catch {
    // No proxy directory yet.
  }
  if (settingsPath) collect(readRestoreRecord(settingsPath));
  return ports;
}

// --- routes -----------------------------------------------------------------

export function routeFileName(sessionId) {
  return `${createHash('sha256')
    .update(String(sessionId || 'default'))
    .digest('hex')
    .slice(0, 32)}.json`;
}

function routePath(paths, sessionId) {
  return path.join(paths.routes, routeFileName(sessionId));
}

function routeAge(route, now) {
  const at = new Date(route?.at).getTime();
  return Number.isFinite(at) ? now - at : Infinity;
}

// This session's route, when a hook refreshed it within `maxAgeMs`.
export function readRoute(
  paths,
  sessionId,
  { now = Date.now(), maxAgeMs = ROUTE_MAX_AGE_MS } = {},
) {
  if (!sessionId) return null;
  const route = readJsonOr(routePath(paths, sessionId));
  if (!route || route.sessionId !== String(sessionId)) return null;
  return routeAge(route, now) <= maxAgeMs ? route : null;
}

export function writeRoute(
  paths,
  {
    sessionId,
    root,
    pluginDir,
    install = null,
    optOut = false,
    down = null,
    seen = null,
    ended = null,
  },
) {
  writePrivateJson(routePath(paths, sessionId), {
    version: 3,
    sessionId: String(sessionId),
    pluginDir: path.resolve(pluginDir),
    root: path.resolve(root),
    ...(install ? { install } : {}),
    optOut: Boolean(optOut),
    at: new Date().toISOString(),
    ...(down ? { down } : {}),
    ...(seen ? { seen } : {}),
    ...(ended ? { ended } : {}),
  });
}

// SessionEnd: the session is over, so its route no longer makes the daemon
// mask requests of other sessions (see liveMaskingRoots). The route and its
// `seen` stay for a resumed session; its next hook clears `ended`.
export function endSessionRoute({ env = process.env, sessionId } = {}) {
  if (!sessionId) return false;
  const paths = proxyPaths(env);
  const current = readJsonOr(routePath(paths, sessionId));
  if (current?.sessionId !== String(sessionId)) return false;
  writeRoute(paths, { ...current, ended: new Date().toISOString() });
  return true;
}

// The daemon records the first request it masked for a session: from then on
// the session's traffic is known to go through the proxy.
export function markRouteSeen(paths, route) {
  if (!route?.sessionId || route.seen) return;
  try {
    writeRoute(paths, { ...route, seen: new Date().toISOString() });
  } catch {
    // Recorded on the next request instead.
  }
}

// Whether the daemon has masked a request of this session yet.
export function routeSeen(paths, sessionId) {
  return Boolean(readRoute(paths, sessionId)?.seen);
}

// Called by every hook: tells the daemon this session is alive, which project
// vault its traffic belongs to, and whether it opted out with ZEROH_PROXY=off.
// Writes nothing before a proxy exists.
export function refreshSessionRoute({
  env = process.env,
  sessionId,
  root,
  pluginDir,
  optOut = false,
  now = Date.now(),
}) {
  if (!sessionId || !root || !pluginDir) return false;
  const paths = proxyPaths(env);
  if (!existsSync(paths.config)) return false;
  const install = installId(resolveClaudeSettingsPath({ env }));
  const current = readJsonOr(routePath(paths, sessionId));
  if (
    current?.sessionId === String(sessionId) &&
    current.root === path.resolve(root) &&
    current.pluginDir === path.resolve(pluginDir) &&
    current.install === install &&
    !current.ended &&
    Boolean(current.optOut) === Boolean(optOut) &&
    routeAge(current, now) < ROUTE_REFRESH_INTERVAL_MS
  ) {
    return true;
  }
  writeRoute(paths, {
    sessionId,
    root,
    pluginDir,
    install,
    optOut,
    down: current?.sessionId === String(sessionId) ? current.down : null,
    seen: current?.sessionId === String(sessionId) ? current.seen : null,
  });
  return true;
}

// The notice that this session's proxy is down (D-10), kept on its route.
export function sessionDownNotice(paths, sessionId) {
  const route = readJsonOr(routePath(paths, sessionId));
  return route?.sessionId === String(sessionId) ? route.down || null : null;
}

export function markSessionDown(paths, sessionId, down, fallback) {
  const route = readJsonOr(routePath(paths, sessionId));
  writeRoute(paths, {
    ...fallback,
    ...(route?.sessionId === String(sessionId) ? route : {}),
    sessionId,
    down,
  });
}

function eachRoute(paths, visit) {
  let names = [];
  try {
    names = readdirSync(paths.routes);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(paths.routes, name);
    let route = null;
    try {
      route = readJsonFile(file);
    } catch {
      // Unreadable: stale unless it is being written now.
    }
    visit(file, route);
  }
}

// Drops routes past `maxAgeMs`. Returns how many it removed.
export function pruneRoutes(
  paths,
  maxAgeMs = ROUTE_MAX_AGE_MS,
  now = Date.now(),
) {
  let removed = 0;
  eachRoute(paths, (file, route) => {
    if (route && routeAge(route, now) <= maxAgeMs) return;
    try {
      if (!route && now - statSync(file).mtimeMs <= 5_000) return;
      unlinkSync(file);
      removed += 1;
    } catch {
      // Another process removed it.
    }
  });
  return removed;
}

// Whether any session with a masking route is alive.
export function anyLiveRoute(paths, now = Date.now()) {
  let live = false;
  eachRoute(paths, (_file, route) => {
    if (route && !route.optOut && routeAge(route, now) <= ROUTE_MAX_AGE_MS) {
      live = true;
    }
  });
  return live;
}

// A plugin session that is live and expects masking: refreshed within the
// route window, not ended, not opted out, and its plugin still installed.
function liveRoute(route, now, pathExists) {
  return Boolean(
    route &&
    !route.optOut &&
    !route.ended &&
    routeAge(route, now) <= ROUTE_MAX_AGE_MS &&
    route.pluginDir &&
    pathExists(route.pluginDir),
  );
}

// The project roots of the live plugin sessions of one settings file
// (`install`; null: any). A request the daemon cannot tie to its own session
// is masked while this is not empty (LP-B5).
export function liveMaskingRoots(
  paths,
  { install = null, now = Date.now(), pathExists = existsSync } = {},
) {
  const roots = new Set();
  eachRoute(paths, (_file, route) => {
    if (
      liveRoute(route, now, pathExists) &&
      (!install || !route.install || route.install === install)
    ) {
      roots.add(route.root);
    }
  });
  return roots;
}

// The settings files (installs) of live plugin sessions whose traffic the
// daemon has masked (`seen`). A leaving daemon keeps their entries (RB-1):
// taking one out would send the rest of that session's turn, history and
// all, straight to the API. `all`: a live route that names no settings file.
export function liveRoutedInstalls(
  paths,
  { now = Date.now(), pathExists = existsSync } = {},
) {
  const live = { all: false, ids: new Set() };
  eachRoute(paths, (_file, route) => {
    if (!route?.seen || !liveRoute(route, now, pathExists)) return;
    if (route.install) live.ids.add(route.install);
    else live.all = true;
  });
  return live;
}

// Removes the routes of one settings file (doctor --fix while other
// profiles keep using the daemon).
export function removeRoutesOf(paths, install) {
  eachRoute(paths, (file, route) => {
    if (route?.install === install) {
      try {
        unlinkSync(file);
      } catch {
        // Already gone.
      }
    }
  });
}

// Whether a hook of an installed plugin refreshed a route recently.
export function hasActivePlugin(
  paths,
  { now = Date.now(), pathExists = existsSync } = {},
) {
  let active = false;
  eachRoute(paths, (_file, route) => {
    if (
      route?.pluginDir &&
      routeAge(route, now) <= ROUTE_MAX_AGE_MS &&
      pathExists(route.pluginDir)
    ) {
      active = true;
    }
  });
  return active;
}
