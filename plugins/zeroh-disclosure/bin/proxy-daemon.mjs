#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The default proxy daemon: one per ZEROH_HOME, shared by every Claude
// session and settings file that points at it (files: lib/proxy-state.js).
//
// - A request must address /z/<key>/… with the access key of one of the
//   installs in proxy.json; that install names the upstream.
// - A request with a body is masked with its session's project vault when a
//   hook registered the session (x-claude-code-session-id). A session that
//   opted out with ZEROH_PROXY=off passes through unmasked.
// - A request without a session header, or of a session no hook registered,
//   is masked while any plugin session of the same settings file is live
//   (with that project's vault; with several live projects, with each of
//   their vaults in turn), and passes through only when none is (D-12: the
//   plugin is
//   disabled or removed everywhere, and Claude Code must keep working).
//   Claude Code 2.1.283 sends the session id with every request that has a
//   body, subagents, --resume, --continue and --fork-session included; the
//   only exceptions seen are the body-less HEAD /api/hello and, on resume,
//   one startup quota request under a new id (LP-B5).
// - It exits when its port is taken, when proxy.json is deleted or replaced
//   (ZEROH_HOME removed, `proxy off`, `doctor --fix`), and once the plugin
//   has been gone for 24 hours (after restoring the settings files).
// - Before it leaves for any reason other than handing over to a new daemon
//   (a restart, an update), it takes its own entries out of the settings
//   files it serves, so Claude Code never meets a dead port (LP-B4): the
//   home deleted, a shutdown or logout (SIGTERM). A settings file with a
//   live plugin session keeps its entry (RB-1); that session's next prompt
//   restarts the daemon, and the next SessionStart or prompt writes the
//   others back. Open requests are drained (up to ten minutes), never cut
//   (LP-F2).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  takeEntryOut,
} from '../lib/claude-settings.js';
import { sameSecret } from '../lib/crypto.js';
import { appendPrivateLog } from '../lib/private-fs.js';
import {
  networkEnvironment,
  networkFingerprint,
  withoutNetworkProxy,
} from '../lib/network.js';
import { createMaskingProxy, listen, MESSAGES } from '../lib/proxy.js';
import { evaluateOrphanCleanup } from '../lib/proxy-manager.js';
import { writeProxyDiagnostic } from '../lib/proxy-report.js';
import { createServiceManager } from '../lib/service-manager.js';
import {
  anyLiveRoute,
  healthProof,
  liveMaskingRoots,
  liveRoutedInstalls,
  markRouteSeen,
  proxyPathsInHome,
  pruneRoutes,
  readProxyConfig,
  readRoute,
  writeProxyConfig,
} from '../lib/proxy-state.js';
import { acquireFileLock, releaseFileLock } from '../lib/vault.js';

const configPath = path.resolve(process.argv[2] || '');
const paths = proxyPathsInHome(path.dirname(path.dirname(configPath)));

function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

let config = readConfig();
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
      fileURLToPath(new URL('../build.json', import.meta.url)),
      'utf8',
    ),
  );
} catch {
  // Run from a checkout: the build is unknown and any start replaces it.
}

function log(message) {
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
  }
  return config;
}

function installForKey(key) {
  if (!key) return null;
  const installs = Object.values(currentConfig()?.installs || {});
  return installs.find((candidate) => sameSecret(candidate.key, key)) || null;
}

// A request whose access key no install knows (an entry left by a lost home
// or an earlier build, or none at all) is never refused: that would stop
// Claude Code (D-10). It goes to the one upstream the installs agree on, else
// to api.anthropic.com: never to any other host. Reported once per daemon.
let unknownKeyReported = false;
function upstreamForKey(key) {
  const install = installForKey(key);
  if (install?.upstream) return install.upstream;
  const upstreams = [
    ...new Set(
      Object.values(currentConfig()?.installs || {})
        .map((candidate) => candidate.upstream)
        .filter(Boolean),
    ),
  ];
  if (!unknownKeyReported) {
    unknownKeyReported = true;
    log('a request with an unknown access key was forwarded');
    writeProxyDiagnostic({
      event: 'unknown-access-key',
      failure: key ? 'unknown-key' : 'no-key',
      steps: [{ step: 'forward', ok: true, found: upstreams.length }],
      proxy: { port: Number(config.port), daemonAnswers: true },
    });
  }
  return upstreams.length === 1 ? upstreams[0] : DEFAULT_ANTHROPIC_UPSTREAM;
}

function sessionHeader(request) {
  return String(request?.headers?.['x-claude-code-session-id'] || '');
}

function accessKey(request) {
  return /^\/z\/([A-Za-z0-9_-]{16,128})(?:\/|$)/u.exec(
    String(request?.url || ''),
  )?.[1];
}

// The install (settings file) an access key belongs to, or null.
function installIdForKey(key) {
  if (!key) return null;
  for (const [id, install] of Object.entries(currentConfig()?.installs || {})) {
    if (sameSecret(install.key, key)) return id;
  }
  return null;
}

let unroutedReported = false;
export function decideRoute(sessionId, { hasBody, key = null }) {
  // Nothing to mask: liveness probes and GETs carry no conversation text.
  if (!hasBody) return { action: 'pass', quiet: true };
  const route = sessionId ? readRoute(paths, sessionId) : null;
  if (route) {
    return route.optOut
      ? { action: 'pass', notice: MESSAGES.optedOut }
      : { action: 'mask', root: route.root, route };
  }
  // No session header, or a session no hook registered. While a plugin
  // session of this settings file is live, the request may be one of its
  // own sent under another id: masked, never forwarded as it is (LP-B5).
  // With no live plugin session it passes through unchanged: never refused,
  // Claude Code must keep working (D-10, D-12, T-27).
  const roots = liveMaskingRoots(paths, { install: installIdForKey(key) });
  if (!roots.size) return { action: 'pass', notice: MESSAGES.noRoute };
  if (!unroutedReported) {
    // Logged once per daemon, value-free (a request under a session id the
    // hooks have not registered yet is normal at start-up; a steady stream
    // would mean Claude Code changed how it names sessions).
    unroutedReported = true;
    log(
      `a request with ${sessionId ? 'an unknown session id' : 'no session header'} was masked while ${roots.size} project(s) had a live plugin session`,
    );
  }
  return { action: 'mask', roots: [...roots].sort(), unrouted: true };
}

// What the daemon does with THIS session's own traffic: 'mask' only for a
// session a hook registered (never for one masked as unrouted).
function sessionState(sessionId) {
  const route = readRoute(paths, sessionId);
  return route && !route.optOut ? 'mask' : 'pass';
}

function healthResponse(request, key) {
  const sessionId = sessionHeader(request);
  const session = sessionId ? sessionState(sessionId) : null;
  const body = {
    ok: true,
    version: 1,
    pid: process.pid,
    build,
    network: networkFingerprint(network, config.controlToken),
    active: sessionId ? session === 'mask' : anyLiveRoute(paths),
    ...(session ? { session } : {}),
    ...(key !== null ? { key: installForKey(key) ? 'known' : 'unknown' } : {}),
  };
  const nonce = String(request.headers['x-zeroh-nonce'] || '');
  if (nonce) {
    body.proof = healthProof(config.controlToken, {
      nonce,
      sessionId,
      session: body.session,
    });
  }
  return body;
}

const HEALTH_RE = /^(?:\/z\/([A-Za-z0-9_-]{16,128}))?\/_zeroh\/health$/u;

// How long a leaving daemon lets open requests (long answers) finish. It
// has released the port at once, so a new daemon is already serving.
const DRAIN_MS = 10 * 60 * 1000;

// The settings files whose live plugin sessions this daemon has masked
// (lib/proxy-state.js liveRoutedInstalls), remembered while the home exists:
// once it is deleted, the routes are gone with it.
let liveInstalls = { all: false, ids: new Set() };
function refreshLiveInstalls() {
  try {
    liveInstalls = liveRoutedInstalls(paths);
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

let stopping = false;
function stop(reason, { restore = false, unregister = false } = {}) {
  if (stopping) return;
  stopping = true;
  if (reason) log(reason);
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
  // Open requests finish; idle connections close.
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(0), DRAIN_MS).unref();
}

const server = createMaskingProxy({
  network,
  onNetworkProxyUnreachable: dropNetworkProxy,
  resolveUpstream: upstreamForKey,
  route: (request, { hasBody }) => {
    const decision = decideRoute(sessionHeader(request), {
      hasBody,
      key: accessKey(request),
    });
    if (decision.route) markRouteSeen(paths, decision.route);
    return decision;
  },
  onInactive: log,
  handleRequest(request, response) {
    const raw = String(request.url || '/');
    if (!raw.startsWith('/') || raw.startsWith('//')) return false;
    const pathname = raw.split('?')[0];
    const health = HEALTH_RE.exec(pathname);
    if (health && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(healthResponse(request, health[1] ?? null)));
      return true;
    }
    if (pathname === '/_zeroh/shutdown' && request.method === 'POST') {
      const allowed = sameSecret(
        request.headers['x-zeroh-control'] || '',
        config.controlToken,
      );
      response.writeHead(allowed ? 204 : 403);
      response.end();
      if (allowed) setImmediate(() => stop('shutdown requested'));
      return true;
    }
    return false;
  },
});

try {
  await listen(server, Number(config.port), '127.0.0.1');
} catch (error) {
  // Another daemon (or program) holds the port. A clean exit, so no login
  // item restarts this one in a loop; SessionStart picks the next move.
  if (error.code === 'EADDRINUSE') process.exit(0);
  throw error;
}
loadedAt = statSync(configPath).mtimeMs;

// Leaves within seconds once its home is deleted or taken over.
refreshLiveInstalls();
const homeTimer = setInterval(() => {
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
    // session needs. A live session's next prompt sets the home up again.
    stop('proxy.json was removed; restoring settings and exiting', {
      restore: true,
      unregister: true,
    });
  }
}, 2_000);
homeTimer.unref();

// Once a minute (not at start: SessionStart holds the lock while it waits
// for this daemon): prune routes and check whether the plugin is gone.
async function lifecycleCheck() {
  try {
    pruneRoutes(paths);
    const result = await evaluateOrphanCleanup({
      env: { ...process.env, ZEROH_HOME: paths.home },
      log,
    });
    if (result.cleaned) stop();
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
  process.on(signal, () => stop(`${signal}; exiting`, { restore: true }));
}
