// SPDX-License-Identifier: AGPL-3.0-only

// The default proxy daemon: one per ZEROH_HOME, shared by every Claude
// session and settings file that points at it (files: packages/local-proxy/proxy-state.js).
//
// - A request must address /z/<key>/… with the access key of one of the
//   installs in proxy.json; that install names the upstream.
// - A request with a body is masked with its session's project vault when a
//   hook registered the session (x-claude-code-session-id). A session that
//   opted out with ZEROH_PROXY=off passes through unmasked.
// - A request without a session header, or of a session no hook registered,
//   passes through unmasked: no ZeroH hook runs for that session (the plugin
//   is disabled there, or Claude Code started it without plugins), so a
//   token in its context could never be put back into its commands, edits or
//   screen (product rule 8; 1.0.0: a git author email written as a token).
//   Claude Code 2.1.283 sends the session id with every request that has a
//   body, subagents, --resume, --continue and --fork-session included; the
//   only exceptions seen are the body-less HEAD /api/hello and, on resume,
//   one startup quota request under a new id.
// - It exits when its port is taken (unless it was started to take the port
//   over from this home's daemon: an update, see takePort), when proxy.json is deleted or replaced
//   (ZEROH_HOME removed, `proxy off`, `doctor --fix`). Once the plugin has
//   been gone for 24 hours it restores settings and drains until idle.
// - Before it leaves for any reason other than handing over to a new daemon
//   (a restart, an update), it takes its own entries out of the settings
//   files it serves, so Claude Code never meets a dead port (LP-B4): the
//   home deleted, a shutdown or logout (SIGTERM). A settings file with a
//   live plugin session keeps its entry (RB-1); that session's next prompt
//   restarts the daemon, and the next SessionStart or prompt writes the
//   others back. Open requests are drained (up to ten minutes), never cut
//   (LP-F2).
// - Retired (`POST /_zeroh/retire`, sent by uninstall, `proxy off` and
//   doctor --fix before they take its settings entries and login item away):
//   a running Claude Code session keeps the proxy URL it started with, so a
//   daemon that just left would kill it (connection refused, ten retries).
//   A retired daemon keeps serving whatever still comes, writes nothing
//   under ZEROH_HOME, never restarts (its login item is gone), and exits once
//   no request has come for RETIRED_IDLE_MS, or when a new daemon of this
//   home wants its port. What it masks (product rule 8, never mask what
//   can't be restored):
//     - after `proxy off` and doctor --fix the vault and the hooks remain, so
//       a session it masked keeps its own project's known values masked,
//       each to the token the model already saw (held in memory per
//       project, knownValueMasker), and nothing new;
//     - after uninstall (`?masker=none`) nothing can put a token back (the
//       vault and the hooks are gone), so everything passes unmasked, as
//       without ZeroH (owner: "rather not mask, not block, but notice");
//     - a session it never masked (no route when it retired) always passes.
// - No login item (session-only, evaluateSessionOnlyExit): once no live
//   plugin session is left, its settings entries come out and it drains the
//   same way, passing everything (the sessions still on its port have no
//   live hooks), instead of closing a port a session may still use (rule 1).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDaemonMode } from '../daemon-mode.js';
import { takeEntryOut } from '../claude-settings.js';
import { sameSecret } from '../../zeroh-disclosure-core/crypto.js';
import {
  appendPrivateLog,
  readJsonOr,
  removeQuietly,
  writePrivateJson,
} from '../../zeroh-disclosure-core/private-fs.js';
import { networkEnvironment, withoutNetworkProxy } from '../network.js';
import { createMaskingProxy, knownValueMasker } from '../proxy.js';
import {
  evaluateOrphanCleanup,
  evaluateSessionOnlyExit,
} from '../proxy-manager.js';
import { createServiceManager } from '../service-manager.js';
import {
  liveRoutedInstalls,
  proxyPathsInHome,
  pruneRoutes,
  pruneMaskingSnapshots,
  readProxyConfig,
  reconcileInstallUpstreams,
  withProxyLock,
  writeProxyConfig,
} from '../proxy-state.js';
import { createDaemonRequests } from './request.js';
import {
  acquireFileLock,
  releaseFileLock,
  Vault,
} from '../../zeroh-disclosure-core/vault.js';

const configPath = path.resolve(process.argv[2] || '');
const paths = proxyPathsInHome(path.dirname(path.dirname(configPath)));

function readConfig() {
  try {
    const next = JSON.parse(readFileSync(configPath, 'utf8'));
    reconcileInstallUpstreams(next, paths);
    return next;
  } catch {
    return null;
  }
}

// Login-item starts bypass the manager. Persist the same upgrade correction
// under its lock before listening, and sanitize later config reloads too.
let config = readProxyConfig(paths);
if (reconcileInstallUpstreams(config, paths)) {
  config = await withProxyLock(paths, () => {
    const next = readProxyConfig(paths);
    if (reconcileInstallUpstreams(next, paths)) writeProxyConfig(paths, next);
    return next;
  });
}
// Nothing to serve: `proxy off` ran, or the home was deleted.
if (!config?.controlToken || !config.port) process.exit(0);
for (const [name, value] of Object.entries(config.environment || {})) {
  process.env[name] = value;
}
// The network proxy and CAs recorded in proxy.json (a daemon started at
// login has none of the shell's variables), applied with explicit agents:
// Node reads its own network variables only at start (LP-B1).
let network = (() => {
  const recorded = networkEnvironment(config.environment || {});
  return Object.keys(recorded).length
    ? recorded
    : networkEnvironment(process.env);
})();

// The recorded network proxy can't be reached (an office or VPN proxy that
// another session recorded, on a network without it): it is dropped here and
// in proxy.json, so Claude Code's retry goes direct instead of meeting a 502
// for good. The next session that names a network proxy records it again
// (its SessionStart restarts the daemon with it). CA files are kept.
function dropNetworkProxy(error) {
  const direct = withoutNetworkProxy(network);
  if (!direct) return;
  network = direct;
  server.useNetwork(direct);
  log(
    `the network proxy could not be reached (${error?.code || 'error'}); connecting directly until a session names one again`,
  );
  if (retired) return;
  let lock = null;
  try {
    lock = acquireFileLock(paths.lock, { waitMs: 1_000 });
    const latest = readProxyConfig(paths);
    const stripped =
      latest &&
      sameSecret(latest.controlToken, config.controlToken) &&
      withoutNetworkProxy(latest.environment);
    if (stripped) {
      latest.environment = stripped;
      writeProxyConfig(paths, latest);
    }
  } catch {
    // This daemon goes direct either way; SessionStart records it again.
  } finally {
    if (lock) releaseFileLock(lock);
  }
}

let build = null;
try {
  build = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../build.json', import.meta.url)),
      'utf8',
    ),
  );
} catch {
  // Run from a checkout: the build is unknown and any start replaces it.
}

// Set by `/_zeroh/retire` and the session-only exit: { sessions, since }.
// `sessions` maps the id of each session it masked for to the masker of
// that session's project; empty when it masks nothing. A retired daemon writes nothing under
// ZEROH_HOME (uninstall is deleting it).
let retired = null;
let daemonMode = null;

function log(message) {
  if (!existsSync(paths.home)) return;
  if (daemonMode && ['retired', 'draining'].includes(daemonMode.mode)) return;
  appendPrivateLog(paths.log, `${new Date().toISOString()} ${message}`);
}

// proxy.json is re-read when it changes. Gone, or replaced by another
// daemon's (a new control token), means this daemon must leave; `lost` says
// which ('removed' or 'replaced').
let loadedAt = 0;
let lost = null;
function currentConfig() {
  let mtime;
  try {
    mtime = statSync(configPath).mtimeMs;
  } catch {
    lost = 'removed';
    return null;
  }
  if (mtime !== loadedAt) {
    const next = readConfig();
    if (!next) {
      lost = 'removed';
      return null;
    }
    if (!sameSecret(next.controlToken, config.controlToken)) {
      lost = 'replaced';
      return null;
    }
    config = next;
    loadedAt = mtime;
    if (
      daemonMode &&
      ['serving', 'serving-session-only'].includes(daemonMode.mode)
    ) {
      const servingMode = config.loginItemRefused
        ? 'serving-session-only'
        : 'serving';
      if (daemonMode.mode !== servingMode) daemonMode.transition(servingMode);
    }
  }
  return config;
}

// A retired daemon keeps the installs it knew: proxy.json is gone, but a
// session still names its access key and upstream.
function servingConfig() {
  if (retired) return config;
  const current = currentConfig();
  if (!current && lost === 'removed') drainRemovedHome();
  return retired ? config : current;
}

// How long a leaving daemon lets open requests (long answers) finish. It
// has released the port at once, so a new daemon is already serving.
const DRAIN_MS = 10 * 60 * 1000;
// How long a leaving daemon keeps an idle kept-alive connection open for a
// request already on its way (see stop).
const STOP_IDLE_GRACE_MS = 1_000;

// A retired daemon exits once no request has come for this long. Long, on
// purpose: a session left open over lunch must still answer (Rule 1: never
// take away what Claude Code can do); a retired daemon costs an idle process
// and nothing restarts it after a reboot. ZEROH_RETIRED_IDLE_MS (tests).
const RETIRED_IDLE_MS = (() => {
  const value = Number(process.env.ZEROH_RETIRED_IDLE_MS);
  return Number.isFinite(value) && value > 0 ? value : 12 * 60 * 60 * 1000;
})();
let lastRequestAt = Date.now();
let retiredIdleTimer = null;
let pendingStopOptions = null;

function startRetiredIdleTimer() {
  if (retiredIdleTimer) return;
  retiredIdleTimer = setInterval(
    () => {
      if (Date.now() - lastRequestAt >= RETIRED_IDLE_MS) {
        clearInterval(retiredIdleTimer);
        retiredIdleTimer = null;
        stop();
      }
    },
    Math.min(60_000, Math.max(250, Math.floor(RETIRED_IDLE_MS / 4))),
  );
  retiredIdleTimer.unref();
}

// For each session this daemon masked for (its routes, live or not), a
// masker of that session's own project's values, read once from its vault
// and kept in memory only. Never one catalog for all: a value known only in
// another project would go out as a token this session's hooks can't put
// back (rule 8; Astra pre-1.0.0 R4).
const rememberedSessionRoots = new Map();
const rememberedVaults = new Map();

function retireMasker({ cached = false } = {}) {
  const sessionRoots = new Map(cached ? rememberedSessionRoots : []);
  try {
    for (const name of readdirSync(paths.routes)) {
      const route = readJsonOr(path.join(paths.routes, name));
      if (route?.root && !route.optOut && route.sessionId)
        sessionRoots.set(String(route.sessionId), route.root);
    }
  } catch {
    // No routes: nothing was masked.
  }
  const byRoot = new Map();
  for (const root of new Set(sessionRoots.values())) {
    let entries = rememberedVaults.get(root) || [];
    try {
      if (!cached) entries = new Vault(root).knownValues();
    } catch {
      // A vault that can't be opened had nothing this daemon could restore.
    }
    byRoot.set(root, knownValueMasker(entries));
  }
  const sessions = new Map(
    [...sessionRoots].map(([id, root]) => [id, byRoot.get(root)]),
  );
  let size = 0;
  for (const masker of byRoot.values()) size += masker.size;
  return { sessions, size };
}

// masking: 'known' (proxy off, doctor --fix) or 'none' (uninstall, and the
// session-only exit). See the header.
function retire({
  masking = 'known',
  reason = 'retired',
  mode = 'retired',
  cached = false,
} = {}) {
  if (retired) return;
  const known = masking === 'known' ? retireMasker({ cached }) : null;
  retired = {
    sessions: known?.sessions ?? new Map(),
    since: Date.now(),
  };
  lastRequestAt = Date.now();
  daemonMode.transition(
    mode,
    known
      ? `${reason}: serving open sessions with ${known.size} known value(s)`
      : `${reason}: serving open sessions, masking nothing`,
  );
}

// The settings files whose live plugin sessions this daemon has masked
// (packages/local-proxy/proxy-state.js liveRoutedInstalls), remembered while the home exists:
// once it is deleted, the routes are gone with it.
let liveInstalls = { all: false, ids: new Set() };
function refreshLiveInstalls() {
  try {
    const next = liveRoutedInstalls(paths);
    if (!existsSync(paths.config) || !existsSync(paths.routes)) return;
    liveInstalls = next;
    if (!retired)
      pruneMaskingSnapshots(paths, rememberedSessionRoots, rememberedVaults);
  } catch {
    // The last answer stands.
  }
}

// Before it leaves (the home deleted, a shutdown, logout or `systemctl
// --user stop`), the daemon takes its entries out of the settings files it
// serves, so a new Claude Code session never meets a dead port (LP-B4) —
// except where a live plugin session goes through it (RB-1): Claude Code
// applies a changed settings file to a running session, so the rest of that
// session's turn would go straight to the API with its whole history. Such
// an entry stays; the session's next prompt restarts the daemon (D-10).
// Only an entry that still names this daemon's URL comes out.
//
// While the home exists this runs under the manager lock. A lock held by
// someone else means a SessionStart or prompt is setting the proxy up (a
// re-registered login item stops this daemon on the way): it owns the
// entries, so nothing is taken out.
function restoreSettings() {
  let homeGone = !existsSync(paths.config);
  let lock = null;
  if (!homeGone) {
    try {
      lock = acquireFileLock(paths.lock, { waitMs: 1_000 });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        return { restored: 0, kept: Object.keys(config.installs || {}).length };
      }
      homeGone = true;
    }
  }
  try {
    const latest = homeGone ? null : readProxyConfig(paths);
    // Replaced by another daemon: it serves these entries now.
    if (latest && !sameSecret(latest.controlToken, config.controlToken)) {
      return { restored: 0, kept: 0 };
    }
    const current = latest || config;
    if (!homeGone) refreshLiveInstalls();
    let restored = 0;
    let kept = 0;
    for (const [id, install] of Object.entries(current.installs || {})) {
      if (liveInstalls.all || liveInstalls.ids.has(id)) {
        kept += 1;
        continue;
      }
      try {
        const url = `http://127.0.0.1:${config.port}/z/${install.key}`;
        if (takeEntryOut(install.settingsPath, install, { match: url }).removed)
          restored += 1;
      } catch {
        // An unreadable settings file is left as it is.
      }
    }
    if (latest && restored) writeProxyConfig(paths, latest);
    return { restored, kept };
  } finally {
    if (lock) releaseFileLock(lock);
  }
}

function applyModeTransition({ to, why }) {
  if (why) log(why);
  if (to === 'retired' || to === 'draining') {
    // The status line must not count a leaving daemon as running.
    removePidFile();
    startRetiredIdleTimer();
    return;
  }
  if (to !== 'stopping') return;
  const { restore = false, unregister = false } = pendingStopOptions || {};
  if (restore) {
    const { restored, kept } = restoreSettings();
    if (restored) log(`restored ${restored} Claude Code settings file(s)`);
    if (kept) {
      log(
        `kept the entry in ${kept} Claude Code settings file(s) with a live session; its next prompt restarts the proxy`,
      );
    }
  }
  if (unregister) {
    // Before the drain: on macOS `launchctl bootout` also ends this daemon
    // (after launchd's exit timeout), and the settings are already restored.
    try {
      createServiceManager({ env: process.env }).unregister({ stop: false });
    } catch {
      // The login item then points at a missing runtime and starts nothing.
    }
  }
  removePidFile();
  // It stops accepting at once (a new daemon may be taking the port over),
  // but unlike http's close() it does not cut its idle kept-alive
  // connections at once: a request already on its way on one is served,
  // not reset. Every answer from now on closes its connection, the idle
  // ones are closed after STOP_IDLE_GRACE_MS, and it exits when the last
  // connection is gone.
  net.Server.prototype.close.call(server, () => process.exit(0));
  setTimeout(() => server.closeIdleConnections?.(), STOP_IDLE_GRACE_MS).unref();
  setTimeout(() => process.exit(0), DRAIN_MS).unref();
}

daemonMode = createDaemonMode({ onTransition: applyModeTransition });

function stop(reason, options = {}) {
  if (daemonMode.mode === 'stopping') return;
  pendingStopOptions = options;
  daemonMode.transition('stopping', reason);
  pendingStopOptions = null;
}

const daemonRequests = createDaemonRequests({
  paths,
  currentConfig,
  servingConfig,
  getConfig: () => config,
  getRetired: () => retired,
  getBuild: () => build,
  getMode: () => daemonMode.mode,
  getNetwork: () => network,
  log,
  retire,
  stop,
  onRequest: () => (lastRequestAt = Date.now()),
  onRouted: (route) => {
    // Remember the first answer before the home (and its route files) can
    // disappear. The periodic refresh still prunes sessions that ended.
    if (route.install) liveInstalls.ids.add(route.install);
    else liveInstalls.all = true;
    rememberedSessionRoots.set(String(route.sessionId), route.root);
  },
});

export const decideRoute = daemonRequests.decideRoute;

const server = createMaskingProxy({
  network,
  onNetworkProxyUnreachable: dropNetworkProxy,
  resolveUpstream: daemonRequests.resolveUpstream,
  route: daemonRequests.route,
  onInactive: log,
  handleRequest: daemonRequests.handleRequest,
  onMaskedVault: (root, vault) =>
    rememberedVaults.set(root, vault.knownValues()),
});

// An update or a new network environment (packages/local-proxy/proxy-manager.js): this
// daemon was started to replace the one on its port. It is loaded and ready
// before it asks that one to let go (POST /_zeroh/shutdown with this home's
// control token), then binds the port within milliseconds, so the sessions
// still sending requests see no gap they would notice; the old daemon
// finishes its open requests. Anything that doesn't answer with this home's
// token (another program, another home's daemon) keeps the port.
const TAKEOVER = process.env.ZEROH_PROXY_TAKEOVER === '1';
delete process.env.ZEROH_PROXY_TAKEOVER;
const TAKEOVER_BIND_MS = 5_000;

function askToHandOver(port) {
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: '/_zeroh/shutdown',
      method: 'POST',
      headers: { 'x-zeroh-control': config.controlToken },
      timeout: 2_000,
      agent: false,
    });
    request.once('response', (response) => {
      response.resume();
      resolve(response.statusCode === 204);
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
    request.end();
  });
}

// One bind attempt that leaves no listener behind when it fails.
function bindOnce(port) {
  return new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off('listening', bound);
      reject(error);
    };
    const bound = () => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', bound);
    server.listen(port, '127.0.0.1');
  });
}

async function takePort(port) {
  try {
    await bindOnce(port);
    return true;
  } catch (error) {
    if (error.code !== 'EADDRINUSE' || !TAKEOVER) throw error;
  }
  if (!(await askToHandOver(port))) return false;
  const deadline = Date.now() + TAKEOVER_BIND_MS;
  while (Date.now() < deadline) {
    try {
      await bindOnce(port);
      return true;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  return false;
}

// A stopping daemon closes each connection after its answer (see stop).
server.on('request', (_request, response) => {
  if (daemonMode.mode === 'stopping') response.shouldKeepAlive = false;
});

try {
  // Another daemon (or program) holds the port. A clean exit, so no login
  // item restarts this one in a loop; SessionStart picks the next move.
  if (!(await takePort(Number(config.port)))) process.exit(0);
} catch (error) {
  if (error.code === 'EADDRINUSE') process.exit(0);
  throw error;
}
loadedAt = statSync(configPath).mtimeMs;
// The status line checks this pid is alive (lib/statusline.js proxyAlive).
const pidFile = path.join(paths.directory, 'daemon.pid');
try {
  writePrivateJson(pidFile, { pid: process.pid, port: Number(config.port) });
} catch {
  // The status line then can't tell a crash apart; nothing else needs it.
}
function removePidFile() {
  try {
    if (readJsonOr(pidFile)?.pid === process.pid) removeQuietly(pidFile);
  } catch {
    // Stopped before it was written.
  }
}
if (config.loginItemRefused) daemonMode.transition('serving-session-only');

function drainRemovedHome() {
  if (retired) return;
  restoreSettings();
  try {
    createServiceManager({ env: process.env }).unregister({
      keepRunning: true,
    });
  } catch {
    // The missing runtime cannot restart; never bootout this daemon.
  }
  retire({
    cached: true,
    mode: 'draining',
    reason:
      'proxy.json was removed; restored settings, draining open sessions with cached masking',
  });
}

// A removed home drains open sessions. Explicit takeover releases the port.
refreshLiveInstalls();
const homeTimer = setInterval(() => {
  if (retired) {
    // A new daemon of this home that wants this port takes over: it
    // forwards a request with an access key it doesn't know (D-10), so an
    // open session keeps working through it.
    const next = readConfig();
    if (
      next &&
      !sameSecret(next.controlToken || '', config.controlToken) &&
      Number(next.port) === Number(config.port)
    ) {
      stop();
    }
    return;
  }
  if (currentConfig()) {
    refreshLiveInstalls();
    return;
  }
  if (lost === 'replaced') {
    // Another daemon took over this home: it serves the same entries.
    stop('proxy.json was replaced by another daemon; exiting');
  } else {
    // ZEROH_HOME was deleted (or `proxy off` finished): the login item
    // would start nothing, so it goes, and so does every entry no live
    // session needs. Captured URLs and cached masking keep open sessions
    // answering until idle without reading or rebuilding the missing home.
    drainRemovedHome();
  }
}, 2_000);
homeTimer.unref();

// Once a minute (not at start: SessionStart holds the lock while it waits
// for this daemon): prune routes and check whether the plugin is gone.
async function lifecycleCheck() {
  if (retired) return;
  try {
    pruneRoutes(paths);
    const result = await evaluateOrphanCleanup({
      env: { ...process.env, ZEROH_HOME: paths.home },
      log,
      drain: () =>
        retire({
          masking: 'none',
          mode: 'draining',
          reason: 'plugin inactive for 24 hours; draining open sessions',
        }),
    });
    if (result.cleaned) {
      return;
    }
    // No login item: this daemon lives while plugin sessions do. Its
    // entries come out, then it drains: a session that still uses its port
    // (one whose hooks don't run, or whose plugin is gone) keeps working
    // until it is idle (rule 1).
    await evaluateSessionOnlyExit({
      env: { ...process.env, ZEROH_HOME: paths.home },
      controlToken: config.controlToken,
      leave: () =>
        retire({
          masking: 'none',
          mode: 'draining',
          reason:
            'no login item and no live plugin session; took the settings entries out, draining',
        }),
    });
  } catch (error) {
    log(`lifecycle check skipped: ${error.message}`);
  }
}
setTimeout(lifecycleCheck, 5_000).unref();
setInterval(lifecycleCheck, 60_000).unref();

// Shutdown, logout, `systemctl --user stop`, `launchctl bootout`: entries
// without a live session come out (see restoreSettings); the next start
// writes them back.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  // A retired daemon's entries are already out.
  process.on(signal, () => stop(`${signal}; exiting`, { restore: !retired }));
}
