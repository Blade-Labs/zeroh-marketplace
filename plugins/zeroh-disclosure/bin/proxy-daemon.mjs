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
//   passes through unmasked: no ZeroH hook runs for that session (the plugin
//   is disabled there, or Claude Code started it without plugins), so a
//   token in its context could never be put back into its commands, edits or
//   screen (product rule 8; 1.0.0: a git author email written as a token).
//   Claude Code 2.1.283 sends the session id with every request that has a
//   body, subagents, --resume, --continue and --fork-session included; the
//   only exceptions seen are the body-less HEAD /api/hello and, on resume,
//   one startup quota request under a new id.
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  takeEntryOut,
} from '../lib/claude-settings.js';
import { sameSecret } from '../lib/crypto.js';
import {
  appendPrivateLog,
  readJsonOr,
  removeQuietly,
  writePrivateJson,
} from '../lib/private-fs.js';
import {
  networkEnvironment,
  networkFingerprint,
  withoutNetworkProxy,
} from '../lib/network.js';
import {
  createMaskingProxy,
  knownValueMasker,
  listen,
  MESSAGES,
} from '../lib/proxy.js';
import {
  evaluateOrphanCleanup,
  evaluateSessionOnlyExit,
} from '../lib/proxy-manager.js';
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
import { acquireFileLock, releaseFileLock, Vault } from '../lib/vault.js';

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
      fileURLToPath(new URL('../build.json', import.meta.url)),
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

function log(message) {
  if (retired) return;
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

// A retired daemon keeps the installs it knew: proxy.json is gone, but a
// session still names its access key and upstream.
function servingConfig() {
  return retired ? config : currentConfig();
}

function installForKey(key) {
  if (!key) return null;
  const installs = Object.values(servingConfig()?.installs || {});
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
      Object.values(servingConfig()?.installs || {})
        .map((candidate) => candidate.upstream)
        .filter(Boolean),
    ),
  ];
  if (!unknownKeyReported && !retired) {
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
  for (const [id, install] of Object.entries(servingConfig()?.installs || {})) {
    if (sameSecret(install.key, key)) return id;
  }
  return null;
}

let unroutedReported = false;
export function decideRoute(sessionId, { hasBody, key = null }) {
  // Nothing to mask: liveness probes and GETs carry no conversation text.
  if (!hasBody) return { action: 'pass', quiet: true };
  if (retired) {
    // Only a session it masked for keeps its known values masked; any other
    // passes as before it retired (rule 8).
    const masker = retired.sessions.get(String(sessionId));
    return masker
      ? { action: 'known', masker }
      : { action: 'pass', quiet: true };
  }
  const route = sessionId ? readRoute(paths, sessionId) : null;
  if (route) {
    return route.optOut
      ? { action: 'pass', notice: MESSAGES.optedOut }
      : { action: 'mask', root: route.root, route };
  }
  // No session header, or a session no hook registered: ZeroH's hooks do
  // not run for it (the plugin is disabled there, or Claude Code started it
  // without plugins, as for some child and agent sessions), so nothing would
  // put a token back into its commands, edits or screen. It passes through
  // unmasked, as without ZeroH (product rule 8: never mask what can't be
  // restored). Claude Code sends the session id with every request that has
  // a body, so a plugin session's own traffic always has a route.
  if (!unroutedReported) {
    // Logged once per daemon, value-free.
    unroutedReported = true;
    const live = liveMaskingRoots(paths, { install: installIdForKey(key) });
    log(
      `a request with ${sessionId ? 'a session id no ZeroH hook registered' : 'no session header'} passed unmasked (${live.size} project(s) had a live plugin session): nothing could restore tokens in it`,
    );
  }
  return { action: 'pass', notice: MESSAGES.noRoute, unrouted: true };
}

// What the daemon does with THIS session's own traffic: 'mask' only for a
// session a hook registered.
function sessionState(sessionId) {
  if (retired) return 'pass';
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
    active: retired
      ? false
      : sessionId
        ? session === 'mask'
        : anyLiveRoute(paths),
    ...(retired ? { retired: true } : {}),
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

// A retired daemon exits once no request has come for this long. Long, on
// purpose: a session left open over lunch must still answer (Rule 1: never
// take away what Claude Code can do); a retired daemon costs an idle process
// and nothing restarts it after a reboot. ZEROH_RETIRED_IDLE_MS (tests).
const RETIRED_IDLE_MS = (() => {
  const value = Number(process.env.ZEROH_RETIRED_IDLE_MS);
  return Number.isFinite(value) && value > 0 ? value : 12 * 60 * 60 * 1000;
})();
let lastRequestAt = Date.now();

// For each session this daemon masked for (its routes, live or not), a
// masker of that session's own project's values, read once from its vault
// and kept in memory only. Never one catalog for all: a value known only in
// another project would go out as a token this session's hooks can't put
// back (rule 8; Astra pre-1.0.0 R4).
function retireMasker() {
  const sessionRoots = new Map();
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
    let entries = [];
    try {
      entries = new Vault(root).knownValues();
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
function retire({ masking = 'known', reason = 'retired' } = {}) {
  if (retired) return;
  const known = masking === 'known' ? retireMasker() : null;
  log(
    known
      ? `${reason}: serving open sessions with ${known.size} known value(s)`
      : `${reason}: serving open sessions, masking nothing`,
  );
  retired = {
    sessions: known?.sessions ?? new Map(),
    since: Date.now(),
  };
  lastRequestAt = Date.now();
  // Its pid file goes: the status line must not count it as running.
  removePidFile();
  const idle = setInterval(
    () => {
      if (Date.now() - lastRequestAt >= RETIRED_IDLE_MS) {
        clearInterval(idle);
        stop();
      }
    },
    Math.min(60_000, Math.max(250, Math.floor(RETIRED_IDLE_MS / 4))),
  );
  idle.unref();
}

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
  removePidFile();
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
    lastRequestAt = Date.now();
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
    if (pathname === '/_zeroh/retire' && request.method === 'POST') {
      const allowed = sameSecret(
        request.headers['x-zeroh-control'] || '',
        config.controlToken,
      );
      // The vaults are read before the answer: the caller deletes them next.
      // Uninstall asks for no masking: nothing can restore a token after it.
      const none = /(?:^|&)masker=none(?:&|$)/u.test(raw.split('?')[1] ?? '');
      if (allowed) retire({ masking: none ? 'none' : 'known' });
      response.writeHead(allowed ? 204 : 403);
      response.end();
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

// Leaves within seconds once its home is deleted or taken over.
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
  if (retired) return;
  try {
    pruneRoutes(paths);
    const result = await evaluateOrphanCleanup({
      env: { ...process.env, ZEROH_HOME: paths.home },
      log,
    });
    if (result.cleaned) {
      stop();
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
