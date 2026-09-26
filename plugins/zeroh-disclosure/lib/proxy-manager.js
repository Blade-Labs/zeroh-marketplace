// SPDX-License-Identifier: AGPL-3.0-only

// Lifecycle of the default local masking proxy: one daemon per ZEROH_HOME,
// one settings entry (with its own access key) per Claude settings file, and
// one route per Claude session that every hook refreshes (files: see
// lib/proxy-state.js).
//
// - SessionStart: ensureDefaultProxy starts the daemon (a new one when the
//   plugin's code changed), registers the login item and writes the entry.
// - Every prompt: sessionProxyState says whether THIS session is masked;
//   checkSessionProxy restarts a dead daemon within a short budget, and
//   otherwise takes the dead entry out and stops the prompt (D-10).
// - `proxy off` restores the settings file and stops what is left; `doctor
//   --fix` does the same for any ZeroH proxy it can find.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  installId,
  isOurProxyUrl,
  isZeroHProxyUrl,
  newProxyKey,
  originalOf,
  proxyKeyOf,
  proxyTurnedOff,
  readRestoreRecord,
  readSettings,
  removeRestoreRecord,
  resolveClaudeSettingsPath,
  writeProxyOffRecord,
  settingsBaseUrl,
  takeEntryOut,
  usableUpstream,
  writeProxySetting,
  writeRestoreRecord,
} from './claude-settings.js';
import { sameSecret } from './crypto.js';
import { loopbackPort } from './loopback.js';
import { networkEnvironment, networkFingerprint } from './network.js';
import {
  ensurePrivateDir,
  readJsonOr,
  writePrivateJson,
} from './private-fs.js';
import { MESSAGES } from './proxy.js';
import { writeProxyDiagnostic } from './proxy-report.js';
import {
  hasActivePlugin,
  healthProof,
  installFor,
  markSessionDown,
  ORPHAN_AFTER_MS,
  proxyPaths,
  pruneRoutes,
  readProxyConfig,
  readRoute,
  refreshSessionRoute,
  removeRoutesOf,
  sessionDownNotice,
  withProxyLock,
  writeProxyConfig,
  writeRoute,
  zerohPorts,
} from './proxy-state.js';
import { isAnthropicCredentialEnvName } from './secrets.js';
import { createServiceManager } from './service-manager.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const START_TIMEOUT_MS = 8_000;
// A prompt waits at most this long for a proxy restart (D-10).
export const PROMPT_RESTART_BUDGET_MS = 3_000;
const HEALTH_TIMEOUT_MS = 800;
// A daemon whose home was deleted or replaced leaves its port within this.
const PORT_RELEASE_WAIT_MS = 2_500;
// A running Claude Code session re-reads a settings file that changes and
// applies its `env` (a 1 s stability wait plus 500 ms polling, measured on
// 2.1.283); a prompt that routes its session waits this long first.
export const SETTINGS_APPLY_WAIT_MS = 2_000;

export const PROXY_DOWN_MESSAGE = MESSAGES.down;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function proxyOptedOut(env = process.env) {
  return String(env.ZEROH_PROXY || '').toLowerCase() === 'off';
}

// The user ran `proxy off` for this settings file (LP-B2): hooks, SessionStart
// and the guard leave the proxy off until `proxy on` or `doctor --fix`.
export function proxyTurnedOffByUser(env = process.env) {
  try {
    return proxyTurnedOff(resolveClaudeSettingsPath({ env }));
  } catch {
    return false;
  }
}

// Off for this session: ZEROH_PROXY=off, or `proxy off`.
export function proxyDisabled(env = process.env) {
  return proxyOptedOut(env) || proxyTurnedOffByUser(env);
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  );
}

// Claude Code talks to Bedrock, Vertex or Foundry directly when these are
// set, whatever ANTHROPIC_BASE_URL says, so the proxy sees none of it.
export function providerBypassesProxy(env = process.env) {
  return [
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ].some((name) => truthy(env[name]));
}

function portUrl(port) {
  return `http://127.0.0.1:${port}`;
}

function request({
  url,
  method = 'GET',
  headers = {},
  timeoutMs = HEALTH_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      new URL(url),
      { method, headers, agent: false },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () =>
          resolve({ statusCode: response.statusCode, body }),
        );
      },
    );
    outgoing.setTimeout(timeoutMs, () =>
      outgoing.destroy(new Error('proxy health check timed out')),
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

// The one health probe. Without a control token it says whether something
// speaks the ZeroH health protocol at `url`. With the token the listener must
// also prove, with an HMAC over a fresh nonce, that it is this home's daemon
// (`verified: true`); for a URL with an access key the daemon says whether
// the key is one of its installs, and for a session how it routes it.
export async function probeProxy(
  url,
  { controlToken = null, sessionId = null } = {},
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const key = proxyKeyOf(url);
  const nonce = controlToken ? randomBytes(16).toString('hex') : null;
  try {
    const response = await request({
      url: `${parsed.origin}${key ? `/z/${key}` : ''}/_zeroh/health`,
      headers: {
        ...(nonce ? { 'x-zeroh-nonce': nonce } : {}),
        ...(sessionId ? { 'x-claude-code-session-id': sessionId } : {}),
      },
    });
    if (response.statusCode !== 200) return null;
    const body = JSON.parse(response.body);
    if (!body?.ok || body.version !== 1) return null;
    if (!controlToken) return body;
    const expected = healthProof(controlToken, {
      nonce,
      sessionId,
      session: body.session,
    });
    return typeof body.proof === 'string' && sameSecret(body.proof, expected)
      ? { ...body, verified: true }
      : null;
  } catch {
    return null;
  }
}

async function shutdownDaemon(port, controlToken) {
  if (!port || !controlToken) return false;
  try {
    const response = await request({
      url: `${portUrl(port)}/_zeroh/shutdown`,
      method: 'POST',
      headers: { 'x-zeroh-control': controlToken },
    });
    return response.statusCode === 204;
  } catch {
    return false;
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return true;
    await delay(50);
  }
  return !(await portInUse(port));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// --- the daemon's code ------------------------------------------------------

// Vendored libraries lib/ loads at run time (lib/pii), copied with their
// licences next to the daemon's lib/.
const RUNTIME_VENDOR = [
  'validator',
  'libphonenumber-js',
  'i18n-iso-countries',
  'saudi-id-validator',
];

function runtimeSources(pluginRoot) {
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(pluginRoot, relative), {
      withFileTypes: true,
    })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk('lib');
  for (const name of RUNTIME_VENDOR) walk(path.join('vendor', name));
  files.push(path.join('bin', 'proxy-daemon.mjs'));
  // The CLI travels with the daemon, so a fix the proxy names (T-37) runs
  // from a path that survives the plugin's removal.
  files.push(path.join('bin', 'zeroh-disclosure.mjs'));
  return files.sort();
}

// The plugin's version and a hash of the code the daemon runs, so an update
// (or an edited checkout) restarts it.
export function pluginBuild(pluginRoot = PLUGIN_ROOT) {
  let version = null;
  try {
    version = JSON.parse(
      readFileSync(
        path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    ).version;
  } catch {
    // An unpacked copy without the manifest still gets a hash.
  }
  const hash = createHash('sha256').update(`${version}\0`);
  for (const file of runtimeSources(pluginRoot)) {
    hash.update(`${file.split(path.sep).join('/')}\0`);
    hash.update(readFileSync(path.join(pluginRoot, file)));
    hash.update('\0');
  }
  return { version, hash: hash.digest('hex').slice(0, 16) };
}

function versionParts(version) {
  return String(version || '0')
    .split(/[.+-]/u)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

// Whether `candidate` should replace `running`: different code, and never an
// older version (two installed copies must not take turns downgrading it).
export function newerBuild(candidate, running) {
  if (!running?.hash) return true;
  if (running.hash === candidate.hash) return false;
  const [a, b] = [
    versionParts(candidate.version),
    versionParts(running.version),
  ];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return true;
}

// Copies lib/, the vendored libraries it loads and the daemon into
// ZEROH_HOME/bin when its build is older.
function refreshRuntime(runtime, pluginRoot, build) {
  const current = readJsonOr(path.join(runtime, 'build.json'));
  if (!newerBuild(build, current)) return false;
  ensurePrivateDir(runtime);
  rmSync(path.join(runtime, 'lib'), { recursive: true, force: true });
  cpSync(path.join(pluginRoot, 'lib'), path.join(runtime, 'lib'), {
    recursive: true,
  });
  rmSync(path.join(runtime, 'vendor'), { recursive: true, force: true });
  for (const name of RUNTIME_VENDOR) {
    cpSync(
      path.join(pluginRoot, 'vendor', name),
      path.join(runtime, 'vendor', name),
      { recursive: true },
    );
  }
  ensurePrivateDir(path.join(runtime, 'bin'));
  for (const name of ['proxy-daemon.mjs', 'zeroh-disclosure.mjs']) {
    cpSync(path.join(pluginRoot, 'bin', name), path.join(runtime, 'bin', name));
  }
  writePrivateJson(path.join(runtime, 'package.json'), {
    private: true,
    type: 'module',
  });
  writePrivateJson(path.join(runtime, 'build.json'), build);
  return true;
}

// The daemon gets the caller's environment without Anthropic credentials.
function daemonEnvironment(env) {
  const safe = {};
  for (const name of Object.keys(env)) {
    if (!isAnthropicCredentialEnvName(name)) safe[name] = env[name];
  }
  return safe;
}

// What proxy.json keeps for a start at login: the paths ZeroH needs, the
// phone region settings (lib/pii/phone.js: a login item has no shell locale),
// and the network environment (lib/network.js) the daemon uses to reach its
// upstream.
// proxy.json is private (0600, and ZEROH_HOME's ACL on Windows), so a network
// proxy URL with a password may be kept there.
function daemonPathEnvironment(env, network) {
  return {
    ...Object.fromEntries(
      [
        'HOME',
        'USERPROFILE',
        'LOCALAPPDATA',
        'ZEROH_HOME',
        'ZEROH_CREDENTIAL_HOME',
        'CLAUDE_CONFIG_DIR',
        'ZEROH_CLAUDE_SETTINGS',
        'ZEROH_SERVICE_MANAGER_DIR',
        'ZEROH_PHONE_REGION',
        'LC_ALL',
        'LC_TELEPHONE',
        'LANG',
      ]
        .filter((name) => env[name])
        .map((name) => [name, env[name]]),
    ),
    ...network,
  };
}

// The network environment the daemon should use: the caller's when it sets
// any network variable, else the one recorded earlier. A session started
// without the shell's variables (an app launched from the Dock) never drops
// a corporate proxy another session recorded; the daemon drops it once it
// can't be reached (another network), and the next session that names one
// records it again.
function daemonNetwork(env, config) {
  const own = networkEnvironment(env);
  return Object.keys(own).length
    ? own
    : networkEnvironment(config?.environment || {});
}

function fixedPort(env) {
  if (!env.ZEROH_PROXY_PORT) return 0;
  const port = Number(env.ZEROH_PROXY_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ZEROH_PROXY_PORT must be a valid TCP port');
  }
  return port;
}

// Starts the daemon on the recorded port. A daemon exits at once when its
// port is taken: one from a deleted or replaced home leaves it within
// seconds, anything else keeps it, and then the daemon moves to a free port
// (the settings entry follows).
async function startDaemon({
  env,
  paths,
  config,
  preferredPort,
  spawnProcess,
  deadline,
}) {
  const fixed = fixedPort(env);
  let port = fixed || config.port || preferredPort || (await freePort());
  let waited = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    config.port = port;
    writeProxyConfig(paths, config);
    let exited = null;
    const child = spawnProcess(
      process.execPath,
      [path.join(paths.runtime, 'bin', 'proxy-daemon.mjs'), paths.config],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: daemonEnvironment(env),
      },
    );
    child.once?.('exit', (code) => (exited = code ?? 1));
    child.unref?.();
    while (Date.now() < deadline && exited === null) {
      const health = await probeProxy(portUrl(port), {
        controlToken: config.controlToken,
      });
      if (health) return health;
      await delay(50);
    }
    if (exited === null) {
      throw new Error('local proxy did not become healthy before the timeout');
    }
    if (!(await portInUse(port))) {
      throw new Error(`local proxy exited while starting (code ${exited})`);
    }
    if (fixed) {
      throw new Error(
        `port ${port} (ZEROH_PROXY_PORT) is used by another program`,
      );
    }
    const holder = await probeProxy(portUrl(port));
    if (
      !waited &&
      holder?.build &&
      (await waitForPortFree(
        port,
        Math.min(PORT_RELEASE_WAIT_MS, deadline - Date.now()),
      ))
    ) {
      waited = true;
      continue;
    }
    port = await freePort();
  }
  throw new Error('local proxy could not find a free port');
}

// --- installs ---------------------------------------------------------------

// Whether a settings value is a ZeroH proxy entry: see isOurProxyUrl, plus a
// loopback URL that answers the ZeroH health protocol.
async function isZeroHEntry(value, { record, ports }) {
  if (isOurProxyUrl(value, { record, ports })) return true;
  return Boolean(loopbackPort(value) && (await probeProxy(value)));
}

// A new install for one settings file. When the file already names a ZeroH
// proxy (ZEROH_HOME was deleted, or it is a leftover), the user's original
// comes from the restore record, never from that entry, and the access key
// in the entry is kept so running sessions keep working.
export async function prepareInstall({ env, paths, settingsPath }) {
  const { document } = readSettings(settingsPath);
  const current = document.env?.ANTHROPIC_BASE_URL;
  const restore = readRestoreRecord(settingsPath);
  const ports = zerohPorts(paths, { settingsPath });
  const ours =
    current !== undefined &&
    (await isZeroHEntry(current, { record: restore, ports }));
  let original = originalOf(document);
  if (ours) {
    const recorded =
      restore?.originalBaseUrlPresent &&
      usableUpstream(restore.originalBaseUrlValue, ports);
    original = {
      originalBaseUrlPresent: Boolean(recorded),
      originalBaseUrlValue: recorded ? restore.originalBaseUrlValue : undefined,
      createdEnv: Boolean(restore?.createdEnv),
    };
  }
  const keep = ours && restore?.proxyUrl === current && proxyKeyOf(current);
  // The entry was taken out by a daemon that left (its home was deleted):
  // the same key and port come back, so a session that still names the old
  // URL finds the proxy there again.
  const previous =
    !ours && !restore?.off && proxyKeyOf(restore?.proxyUrl)
      ? restore.proxyUrl
      : null;
  return {
    settingsPath: path.resolve(settingsPath),
    key: keep || proxyKeyOf(previous) || newProxyKey(),
    ...(previous ? { lastPort: loopbackPort(previous) } : {}),
    upstream:
      (original.originalBaseUrlPresent &&
        usableUpstream(original.originalBaseUrlValue, ports)) ||
      usableUpstream(env.ANTHROPIC_BASE_URL, ports) ||
      DEFAULT_ANTHROPIC_UPSTREAM,
    ...original,
    proxyUrl: keep ? current : null,
    installedAt: new Date().toISOString(),
  };
}

export async function ensureDefaultProxy(options = {}) {
  const env = options.env || process.env;
  const paths = proxyPaths(env);
  return withProxyLock(
    paths,
    () => ensureDefaultProxyLocked({ ...options, env, paths }),
    { waitMs: options.lockWaitMs },
  );
}

async function ensureDefaultProxyLocked({
  env,
  paths,
  root = process.cwd(),
  pluginRoot = PLUGIN_ROOT,
  settingsPath,
  sessionId = 'default',
  serviceManager,
  spawnProcess = spawn,
  startTimeoutMs = START_TIMEOUT_MS,
  // SessionStart only starts the daemon: a settings write there lands before
  // Claude Code watches the file, so the first prompt writes the entry.
  writeSettings = true,
  // Prompts only check the login item; SessionStart (re)registers it.
  registerLoginItem = true,
}) {
  const deadline = Date.now() + startTimeoutMs;
  const optedOut = proxyDisabled(env);
  const target = path.resolve(
    settingsPath || resolveClaudeSettingsPath({ env }),
  );
  let config = readProxyConfig(paths);
  let install = installFor(config, target);
  if (optedOut && !install) {
    return {
      enabled: false,
      optedOut: true,
      turnedOff: proxyTurnedOffByUser(env),
      wroteSettings: false,
    };
  }
  const created = !install;
  if (created)
    install = await prepareInstall({ env, paths, settingsPath: target });
  config ||= {
    version: 3,
    controlToken: randomBytes(24).toString('base64url'),
    port: 0,
    installs: {},
  };
  config.installs[installId(target)] = install;
  config.pluginDir = path.resolve(pluginRoot);
  const network = daemonNetwork(env, config);
  config.environment = daemonPathEnvironment(env, network);
  writeProxyConfig(paths, config);
  const routeId = String(sessionId || 'default');
  writeRoute(paths, {
    sessionId: routeId,
    root,
    pluginDir: pluginRoot,
    install: installId(target),
    optOut: optedOut,
    // A resumed session keeps what the daemon already saw of it.
    seen: readRoute(paths, routeId, { maxAgeMs: Infinity })?.seen ?? null,
  });
  pruneRoutes(paths);

  const build = pluginBuild(pluginRoot);
  let health = config.port
    ? await probeProxy(portUrl(config.port), {
        controlToken: config.controlToken,
      })
    : null;
  let upgraded = false;
  const networkChanged =
    health &&
    health.network !== networkFingerprint(network, config.controlToken);
  if (health && (newerBuild(build, health.build) || networkChanged)) {
    // New code, or a new network environment (a corporate proxy or CA the
    // daemon does not use yet, LP-B1): the old daemon hands over its port,
    // finishes its open requests and leaves.
    await shutdownDaemon(config.port, config.controlToken);
    await waitForPortFree(config.port, PORT_RELEASE_WAIT_MS);
    health = null;
    upgraded = true;
  }
  refreshRuntime(paths.runtime, pluginRoot, build);
  let restarted = false;
  if (!health) {
    health = await startDaemon({
      env,
      paths,
      config,
      preferredPort: loopbackPort(install.proxyUrl) || install.lastPort,
      spawnProcess,
      deadline,
    });
    restarted = true;
  }

  // The settings entry sends every Claude Code session to the proxy, with
  // the plugin or without it, so it may exist only while something keeps
  // the daemon running after a reboot: the login item. A machine that
  // refuses login items (a managed Mac, background items switched off, a
  // locked-down Windows) gets no entry, and typed secrets are stopped
  // instead of masked (T-27: a session must never meet a dead port).
  let warning = null;
  let loginItem = false;
  if (!optedOut) {
    const manager = serviceManager || createServiceManager({ env });
    const target = { runtime: paths.runtime, config: paths.config };
    loginItem = manager.isRegistered(target);
    if (!loginItem && registerLoginItem) {
      try {
        manager.register(target);
        loginItem = true;
        delete config.loginItemRefused;
        // Registering can replace a daemon the login item had started.
        health =
          (await probeProxy(portUrl(config.port), {
            controlToken: config.controlToken,
          })) ||
          (await startDaemon({
            env,
            paths,
            config,
            preferredPort: config.port,
            spawnProcess,
            deadline: Math.max(deadline, Date.now() + START_TIMEOUT_MS),
          }));
      } catch (error) {
        // Said once (LP-B3); the banner keeps saying only what is masked.
        if (!config.loginItemRefused) {
          warning =
            error.code === 'ENOLOGINITEM'
              ? "this system has nothing that starts programs at login (no systemd user session and no desktop session), so ZeroH's local proxy can't be kept running and what you type can't be masked; typed secrets are stopped instead. Files and command output are still masked."
              : `your system did not let ZeroH register the login item that keeps its local proxy running after a restart (${error.code || 'refused'}), so what you type can't be masked; typed secrets are stopped instead. Files and command output are still masked.`;
          writeProxyDiagnostic({
            env,
            event: 'login-item-failed',
            failure: 'register',
            steps: [
              { step: 'register', ok: false, code: error.code || 'error' },
            ],
            install,
          });
        }
        config.loginItemRefused = new Date().toISOString();
      }
    }
  }
  const proxyUrl = `${portUrl(config.port)}/z/${install.key}`;
  let wroteSettings = false;
  if (!optedOut && !loginItem) {
    // Take out an entry an earlier start wrote.
    takeEntryOut(target, install, { match: 'zeroh' });
    install.proxyUrl = null;
  } else if (
    !optedOut &&
    (writeSettings || isZeroHProxyUrl(settingsBaseUrl(target)))
  ) {
    // SessionStart does not add the entry (the first prompt does), but it
    // repairs one that names another port or an unknown key.
    wroteSettings = writeProxySetting(install, proxyUrl);
    writeRestoreRecord(install);
  }
  writeProxyConfig(paths, config);
  return {
    enabled: !optedOut && loginItem,
    optedOut,
    installed: created,
    restarted,
    upgraded,
    wroteSettings,
    settingsPath: target,
    proxyUrl,
    upstream: install.upstream,
    pid: health.pid,
    warning,
  };
}

// --- restore, proxy off -----------------------------------------------------

// Takes ZeroH's entry out of one settings file and forgets its restore
// record. Only ANTHROPIC_BASE_URL changes; a value the user set after ZeroH
// wrote its entry is left alone.
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
function removeProxyState(paths) {
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
    const stopped = await shutdownDaemon(config?.port, config?.controlToken);
    const loginItem = (
      options.serviceManager || createServiceManager({ env })
    ).unregister();
    removeProxyState(paths);
    return { ...restored, stopped, loginItem, remaining };
  });
}

// `zeroh-disclosure uninstall`: every settings file ZeroH wrote to gets the
// user's own setting back (and loses its restore record), the daemon stops
// and the login item goes. The caller then deletes ZEROH_HOME.
// Under the manager lock, so no SessionStart or prompt sets the proxy up
// again half-way.
export async function removeProxyEverywhere({
  env = process.env,
  serviceManager,
} = {}) {
  const paths = proxyPaths(env);
  return withProxyLock(paths, () =>
    removeProxyEverywhereLocked({ env, paths, serviceManager }),
  );
}

async function removeProxyEverywhereLocked({ env, paths, serviceManager }) {
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
  const stopped = await shutdownDaemon(config?.port, config?.controlToken);
  const loginItem = (
    serviceManager || createServiceManager({ env })
  ).unregister();
  return { restored, stopped, loginItemRemoved: Boolean(loginItem?.removed) };
}

// `proxy on`: forgets a `proxy off` for this settings file. The next prompt or
// session sets the proxy up again.
export function proxyOn({ env = process.env } = {}) {
  const settingsPath = path.resolve(resolveClaudeSettingsPath({ env }));
  const wasOff = proxyTurnedOff(settingsPath);
  if (wasOff) removeRestoreRecord(settingsPath);
  return { wasOff, settingsPath };
}

// --- the session's view -----------------------------------------------------

// Whether THIS session's model traffic is masked by the default proxy: not a
// Bedrock/Vertex/Foundry session, not opted out, ANTHROPIC_BASE_URL is a
// ZeroH proxy URL with a key the daemon knows, and the daemon, proven by the
// control token, masks this session. `reason` says why not.
export async function sessionProxyState({
  env = process.env,
  sessionId = null,
} = {}) {
  if (proxyOptedOut(env)) return { active: false, reason: 'opted-out' };
  if (proxyTurnedOffByUser(env)) return { active: false, reason: 'turned-off' };
  if (providerBypassesProxy(env)) return { active: false, reason: 'provider' };
  const base = env.ANTHROPIC_BASE_URL;
  if (!isZeroHProxyUrl(base)) {
    return { active: false, reason: 'not-configured' };
  }
  const config = readProxyConfig(proxyPaths(env));
  if (!config) return { active: false, reason: 'not-installed' };
  const health = await probeProxy(base, {
    controlToken: config.controlToken,
    sessionId,
  });
  if (!health) return { active: false, reason: 'unreachable' };
  return {
    active: health.session === 'mask',
    reason: health.session || 'unknown',
  };
}

// True when this process's own environment names THIS install's proxy URL for
// the active settings file (T-29): Claude Code then sends the session's
// requests to that proxy, so a session that started behind it is protected
// from its first prompt. The caller has already proven the daemon healthy
// and masking this session (sessionProxyState); a request the daemon cannot
// attribute is masked too while a plugin session is live (bin/proxy-daemon.mjs
// decideRoute). A session switched mid-prompt does not name the proxy yet.
export function sessionNamesInstallProxy(env = process.env) {
  const base = env.ANTHROPIC_BASE_URL;
  if (!isZeroHProxyUrl(base)) return false;
  const install = installFor(
    readProxyConfig(proxyPaths(env)),
    resolveClaudeSettingsPath({ env }),
  );
  const trim = (url) => String(url).replace(/\/+$/u, '');
  return Boolean(install?.proxyUrl) && trim(install.proxyUrl) === trim(base);
}

// What the settings file says about the proxy, for a session that does not
// go through it: 'none', 'entry' (applies from the next session) or
// 'removed-by-user' (installed, and the user took the entry out).
export function settingsEntryState(env = process.env) {
  const settingsPath = resolveClaudeSettingsPath({ env });
  const install = installFor(readProxyConfig(proxyPaths(env)), settingsPath);
  if (isZeroHProxyUrl(settingsBaseUrl(settingsPath))) return 'entry';
  return install?.proxyUrl ? 'removed-by-user' : 'none';
}

// True when something other than this settings file sets the session's
// ANTHROPIC_BASE_URL (the user's shell, or a settings file that takes
// precedence): Claude Code then ignores ZeroH's entry, so the proxy cannot
// mask what this session sends.
export function baseUrlOverridden(env = process.env) {
  const base = env.ANTHROPIC_BASE_URL;
  if (!base || isZeroHProxyUrl(base)) return false;
  const settingsPath = resolveClaudeSettingsPath({ env });
  const current = settingsBaseUrl(settingsPath);
  if (current === base) return false;
  // The session started with the user's value from this file, before
  // ZeroH's entry replaced it.
  const record =
    installFor(readProxyConfig(proxyPaths(env)), settingsPath) ||
    readRestoreRecord(settingsPath);
  return !(
    isZeroHProxyUrl(current) &&
    record?.originalBaseUrlPresent &&
    record.originalBaseUrlValue === base
  );
}

// Puts THIS running session behind the proxy (T-19). Claude Code applies a
// changed settings file to a running session, so the first prompt of a
// session that does not use the proxy yet writes the entry and waits until
// Claude Code has picked it up; the prompt's own request then goes through
// the proxy. A secret in that very first prompt is still stopped, not masked:
// until the daemon has seen the session, the prompt might go out directly
// (LP-B5). Returns { routed, state }:
//   routed         the entry was just written (or by a session moments ago)
//   configured     the session already uses a ZeroH URL (the guard's case)
//   not-configured ZEROH_PROXY=off, or Bedrock, Vertex or Foundry
//   overridden     another source sets ANTHROPIC_BASE_URL
//   no-login-item  nothing keeps the proxy running (told at SessionStart)
//   not-written    the proxy did not start, or the user removed the entry
//   not-applied    the entry is there but this session never switched
export async function routeSession({
  env = process.env,
  sessionId = null,
  root = process.cwd(),
  pluginRoot = PLUGIN_ROOT,
  waitMs = SETTINGS_APPLY_WAIT_MS,
  now = Date.now,
  serviceManager,
} = {}) {
  if (proxyOptedOut(env) || providerBypassesProxy(env)) {
    return { routed: false, state: 'not-configured' };
  }
  // The guard checks a session that names a proxy (also after `proxy off`).
  if (isZeroHProxyUrl(env.ANTHROPIC_BASE_URL)) {
    return { routed: false, state: 'configured' };
  }
  if (proxyTurnedOffByUser(env)) {
    return { routed: false, state: 'not-configured' };
  }
  if (baseUrlOverridden(env)) return { routed: false, state: 'overridden' };
  let result;
  try {
    result = await ensureDefaultProxy({
      env,
      root,
      pluginRoot,
      sessionId,
      startTimeoutMs: PROMPT_RESTART_BUDGET_MS,
      lockWaitMs: 1_000,
      serviceManager,
      registerLoginItem: false,
    });
  } catch {
    return { routed: false, state: 'not-written' };
  }
  const target = resolveClaudeSettingsPath({ env });
  // No login item: the user was told at SessionStart, once (LP-B3).
  if (!result.enabled && !result.optedOut) {
    return { routed: false, state: 'no-login-item' };
  }
  if (!result.enabled || settingsBaseUrl(target) !== result.proxyUrl) {
    return { routed: false, state: 'not-written' };
  }
  let age = 0;
  if (!result.wroteSettings) {
    try {
      age = now() - statSync(target).mtimeMs;
    } catch {
      age = Infinity;
    }
    // Written long ago, yet this session does not use it.
    if (age > waitMs * 2) return { routed: false, state: 'not-applied' };
  }
  await delay(Math.max(0, waitMs - age));
  return { routed: true, state: 'routed' };
}

// Keeps this session's route alive; advisory, so a failure never blocks.
export function refreshRoute({ env = process.env, sessionId, root } = {}) {
  try {
    return refreshSessionRoute({
      env,
      sessionId,
      root,
      pluginDir: PLUGIN_ROOT,
      optOut: proxyDisabled(env),
    });
  } catch {
    return false;
  }
}

// --- D-10: never block Claude Code ------------------------------------------

// After a failed restart: when this settings file points at a ZeroH proxy
// that does not answer as this home's daemon, take the entry out so the next
// session reaches the user's original upstream. The next healthy SessionStart
// writes it again. Never stops a daemon or touches other settings files.
export async function repairDeadProxySetting({
  env = process.env,
  settingsPath,
} = {}) {
  const paths = proxyPaths(env);
  const target = path.resolve(
    settingsPath || resolveClaudeSettingsPath({ env }),
  );
  const current = settingsBaseUrl(target);
  if (!isZeroHProxyUrl(current)) return { repaired: false };
  return withProxyLock(
    paths,
    async () => {
      const config = readProxyConfig(paths);
      const health = await probeProxy(current, {
        controlToken: config?.controlToken,
      });
      if (config && health) {
        return { repaired: false, healthy: true };
      }
      const install = installFor(config, target);
      const result = takeEntryOut(
        target,
        install || readRestoreRecord(target),
        { match: current },
      );
      if (install && result.removed) writeProxyConfig(paths, config);
      return { repaired: result.removed, settingsPath: target };
    },
    { waitMs: 1_000 },
  );
}

function elapsed(since) {
  return Date.now() - since;
}

async function recoverSessionProxy({
  env,
  sessionId,
  root,
  pluginRoot,
  budgetMs,
}) {
  const base = env.ANTHROPIC_BASE_URL;
  const steps = [];
  let started = Date.now();
  try {
    await ensureDefaultProxy({
      env,
      root,
      pluginRoot,
      sessionId,
      startTimeoutMs: budgetMs,
      lockWaitMs: Math.min(budgetMs, 1_000),
    });
    steps.push({ step: 'restart', ok: true, ms: elapsed(started) });
  } catch (error) {
    steps.push({
      step: 'restart',
      ok: false,
      code: error?.code || 'start-failed',
      ms: elapsed(started),
    });
  }
  started = Date.now();
  const config = readProxyConfig(proxyPaths(env));
  const back = config
    ? await probeProxy(base, { controlToken: config.controlToken })
    : null;
  steps.push({
    step: 'health-recheck',
    ok: Boolean(back),
    ms: elapsed(started),
  });
  if (back) return { state: 'restarted', steps };
  // Restarted on another port (the old one is taken): the settings entry
  // names the new URL, and Claude Code applies it to this running session.
  const current = settingsBaseUrl(resolveClaudeSettingsPath({ env }));
  if (
    config &&
    current !== base &&
    isZeroHProxyUrl(current) &&
    (await probeProxy(current, { controlToken: config.controlToken }))
  ) {
    await delay(SETTINGS_APPLY_WAIT_MS);
    steps.push({ step: 'moved', ok: true, ms: elapsed(started) });
    return { state: 'moved', steps };
  }

  started = Date.now();
  let repair = null;
  try {
    repair = await repairDeadProxySetting({ env });
  } catch (error) {
    repair = { repaired: false, code: error?.code || 'repair-failed' };
  }
  steps.push({
    step: 'settings-repair',
    ok: Boolean(repair?.repaired || repair?.healthy),
    code: repair?.healthy ? 'next-session-healthy' : repair?.code,
    ms: elapsed(started),
  });
  const report = writeProxyDiagnostic({
    env,
    event: 'proxy-fallback',
    failure: 'proxy-unreachable',
    steps,
    install: installFor(config, resolveClaudeSettingsPath({ env })),
    baseUrl: base,
    proxy: { port: loopbackPort(base), daemonAnswers: false },
  });
  try {
    markSessionDown(
      proxyPaths(env),
      sessionId || 'default',
      { at: new Date().toISOString(), report },
      { root, pluginDir: pluginRoot },
    );
  } catch {
    // The notice is repeated rather than lost.
  }
  return { state: 'down', steps, report, repaired: Boolean(repair?.repaired) };
}

// The prompt-time guard (D-10). When this session's ANTHROPIC_BASE_URL is a
// ZeroH proxy that does not answer, Claude Code would retry the closed port
// ten times; instead the guard restarts the proxy within a short budget, and
// if this session's URL still does not answer it repairs the settings file,
// writes a local diagnostic report and stops the prompt with a plain restart
// message. Typed text is never sent unmasked on any of these paths.
export async function checkSessionProxy({
  env = process.env,
  sessionId = null,
  root = process.cwd(),
  pluginRoot = PLUGIN_ROOT,
  budgetMs = PROMPT_RESTART_BUDGET_MS,
} = {}) {
  if (proxyOptedOut(env) || providerBypassesProxy(env)) {
    return { block: false, state: 'not-configured' };
  }
  const base = env.ANTHROPIC_BASE_URL;
  if (!isZeroHProxyUrl(base)) return { block: false, state: 'not-configured' };
  const config = readProxyConfig(proxyPaths(env));
  const health = config
    ? await probeProxy(base, { controlToken: config.controlToken })
    : null;
  if (health) return { block: false, state: 'up' };
  if (proxyTurnedOffByUser(env)) {
    // `proxy off` ran while this session still points at the proxy: never
    // start it again, and never let Claude Code retry a closed port.
    return {
      block: true,
      state: 'turned-off',
      message:
        'ZeroH Disclosure: you turned the local proxy off, but this Claude Code session still points at it, so your prompt was not sent. Start a new Claude Code session to continue without it, or run `/zeroh-disclosure:proxy on` to turn it back on.',
    };
  }
  const earlier = sessionDownNotice(proxyPaths(env), sessionId || 'default');
  if (earlier) {
    // Told once already: no second restart attempt, just the reminder.
    return {
      block: true,
      state: 'down',
      report: earlier.report || null,
      message: `ZeroH Disclosure: ${PROXY_DOWN_MESSAGE} Your prompt was not sent.`,
    };
  }
  const recovery = await recoverSessionProxy({
    env,
    sessionId,
    root,
    pluginRoot,
    budgetMs,
  });
  if (recovery.state !== 'down') return { block: false, state: recovery.state };
  return {
    block: true,
    state: 'down',
    report: recovery.report,
    message: `ZeroH Disclosure: ${PROXY_DOWN_MESSAGE} Your prompt was not sent.${
      recovery.repaired
        ? ' The proxy entry was removed from your Claude Code settings, so the next session connects directly.'
        : ''
    }${recovery.report ? ` Diagnostic report (stays on this machine): ${recovery.report}` : ''}`,
  };
}

// --- a plugin removed without `proxy off` -----------------------------------

// Run by the daemon every minute. Once no hook of an installed plugin has
// refreshed a route for ORPHAN_AFTER_MS, restores every settings file that
// points at the proxy, removes the login item and the proxy's files, and
// tells the daemon to exit.
export async function evaluateOrphanCleanup({
  env = process.env,
  serviceManager = createServiceManager({ env }),
  now = Date.now,
  pathExists = existsSync,
  log = () => {},
} = {}) {
  const paths = proxyPaths(env);
  return withProxyLock(
    paths,
    () => {
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
      const restored = Object.values(config.installs).map((install) =>
        restoreClaudeSettings({
          env,
          settingsPath: install.settingsPath,
          config,
        }),
      );
      removeProxyState(paths);
      log(
        'ZeroH Disclosure: plugin inactive for 24 hours; restored Claude settings, removed the login item, and stopped the proxy.',
      );
      // Last: on macOS `launchctl bootout` also ends this daemon.
      const loginItem = serviceManager.unregister({ stop: false });
      return { cleaned: true, active: false, restored, loginItem };
    },
    { waitMs: 100 },
  );
}

// --- doctor -----------------------------------------------------------------

// Every loopback port that may hold a ZeroH daemon for this settings file.
function candidatePorts(env, paths, settingsPath, current) {
  const ports = zerohPorts(paths, { settingsPath });
  const fromSettings = loopbackPort(current);
  if (fromSettings) ports.add(fromSettings);
  if (env.ZEROH_PROXY_PORT && Number(env.ZEROH_PROXY_PORT) > 0) {
    ports.add(Number(env.ZEROH_PROXY_PORT));
  }
  return [...ports];
}

// Reports the proxy's state and, with `fix`, resets it: the settings file
// goes back to having no ZeroH entry (the user's original is put back), and
// every ZeroH daemon it finds is stopped, including one whose home was
// deleted. The next Claude Code session installs the proxy again.
export async function diagnoseProxy({
  env = process.env,
  fix = false,
  serviceManager,
} = {}) {
  const paths = proxyPaths(env);
  const settingsPath = path.resolve(resolveClaudeSettingsPath({ env }));
  const manager = serviceManager || createServiceManager({ env });
  const config = readProxyConfig(paths);
  const record =
    installFor(config, settingsPath) || readRestoreRecord(settingsPath);
  const current = settingsBaseUrl(settingsPath);
  const daemons = [];
  for (const port of candidatePorts(env, paths, settingsPath, current)) {
    const body = await probeProxy(portUrl(port));
    if (!body) continue;
    const ours =
      config &&
      (await probeProxy(portUrl(port), { controlToken: config.controlToken }));
    daemons.push({ port, pid: body.pid, ours: Boolean(ours) });
  }
  const ports = zerohPorts(paths, { settingsPath });
  for (const daemon of daemons) ports.add(daemon.port);
  const entry = isOurProxyUrl(current, { record, ports });
  const entryLive =
    entry &&
    config &&
    (await probeProxy(current, { controlToken: config.controlToken }))?.key ===
      'known';

  const findings = [];
  if (entry && !entryLive) findings.push('settings-entry-dead');
  for (const daemon of daemons) {
    if (!daemon.ours) findings.push('unknown-zeroh-daemon');
  }
  const leftovers = (() => {
    try {
      return readdirSync(paths.directory).filter(
        (name) =>
          ![
            'proxy.json',
            'routes',
            'manager.lock',
            'zeroh-disclosure-proxy.xml',
          ].includes(name),
      );
    } catch {
      return [];
    }
  })();
  if (leftovers.length) findings.push('files-from-an-earlier-build');
  if (manager.isRegistered() && !Object.keys(config?.installs || {}).length) {
    findings.push('login-item-without-install');
  }
  const report = {
    settingsPath,
    entry: entry ? (entryLive ? 'live' : 'dead') : 'none',
    daemons: daemons.length,
    loginItem: manager.isRegistered(),
    findings,
    fixed: false,
  };
  if (!fix) return report;

  return withProxyLock(paths, async () => {
    const latest = readProxyConfig(paths);
    const restored = restoreClaudeSettings({
      env,
      settingsPath,
      config: latest,
      probedPorts: daemons.map((daemon) => daemon.port),
    });
    if (latest) delete latest.installs[installId(settingsPath)];
    const remaining = Object.keys(latest?.installs || {}).length;
    let stopped = 0;
    for (const daemon of daemons) {
      // This home's daemon still serves other Claude profiles (LP-F3).
      if (daemon.ours && remaining) continue;
      let down =
        (await shutdownDaemon(daemon.port, latest?.controlToken)) &&
        (await waitForPortFree(daemon.port, 1_000));
      if (!down && Number.isInteger(daemon.pid) && daemon.pid > 1) {
        // A ZeroH daemon this home has no token for (its home was deleted,
        // or an earlier build): it named its own process id.
        try {
          process.kill(daemon.pid, 'SIGTERM');
          down = await waitForPortFree(daemon.port, 1_000);
        } catch {
          down = false;
        }
      }
      if (down) stopped += 1;
    }
    let loginItem = null;
    if (remaining) {
      writeProxyConfig(paths, latest);
      removeRoutesOf(paths, installId(settingsPath));
    } else {
      loginItem = manager.unregister();
      removeProxyState(paths);
    }
    return {
      ...report,
      fixed: true,
      restored: restored.restored,
      stopped,
      loginItemRemoved: Boolean(loginItem?.removed),
    };
  });
}
