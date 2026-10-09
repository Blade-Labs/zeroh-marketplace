// SPDX-License-Identifier: AGPL-3.0-only

// Proxy runtime installation, daemon startup and settings registration.
import { spawn } from '../../zeroh-disclosure-core/child-process.js';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  installId,
  isOurProxyUrl,
  isZeroHProxyUrl,
  newProxyKey,
  originalOf,
  proxyKeyOf,
  readRestoreRecord,
  readSettings,
  resolveClaudeSettingsPath,
  settingsBaseUrl,
  usableUpstream,
  writeProxySetting,
  writeRestoreRecord,
} from '../claude-settings.js';
import { loopbackPort } from '../loopback.js';
import { networkEnvironment, networkFingerprint } from '../network.js';
import {
  ensurePrivateDir,
  readJsonOr,
  writePrivateJson,
} from '../../zeroh-disclosure-core/private-fs.js';
import { writeProxyDiagnostic } from '../proxy-report.js';
import {
  installFor,
  proxyPaths,
  pruneRoutes,
  readProxyConfig,
  readRoute,
  reconcileInstallUpstreams,
  withProxyLock,
  writeProxyConfig,
  writeRoute,
  zerohPorts,
} from '../proxy-state.js';
import { isAnthropicCredentialEnvName } from '../../shell-analysis/secrets.js';
import {
  createServiceManager,
  loginItemFix,
  loginItemReason,
  loginItemRefusal,
} from '../service-manager.js';
import {
  PORT_RELEASE_WAIT_MS,
  START_TIMEOUT_MS,
  delay,
  freePort,
  portInUse,
  portUrl,
  probeProxy,
  proxyDisabled,
  proxyTurnedOffByUser,
  shutdownDaemon,
  waitForPortFree,
} from './probe.js';

export const PLUGIN_ROOT = path.dirname(
  path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
);

const RUNTIME_VENDOR = ['sensitive-data-detectors'];

function runtimeSources(pluginRoot) {
  const files = [];
  const walk = (relative, include = () => true) => {
    for (const entry of readdirSync(path.join(pluginRoot, relative), {
      withFileTypes: true,
    })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child, include);
      else if (entry.isFile() && include(child)) files.push(child);
    }
  };
  walk('lib');
  walk('packages', (file) => /\.(?:js|mjs)$/u.test(file));
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

// Semantic version order: 1.0.0-rc.2 < 1.0.0 < 1.0.1 (a release candidate
// sorts below its release, so an rc session left open never replaces the
// release's daemon). -1, 0 or 1.
export function compareVersions(left, right) {
  const parse = (version) => {
    const [core, pre = ''] = String(version || '0')
      .split('+')[0]
      .split(/-(.*)/su);
    return {
      core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre: pre ? pre.split('.') : [],
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const x = a.core[index] ?? 0;
    const y = b.core[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (!a.pre.length || !b.pre.length) {
    return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  }
  for (
    let index = 0;
    index < Math.max(a.pre.length, b.pre.length);
    index += 1
  ) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/u.test(x);
    const ny = /^\d+$/u.test(y);
    if (nx && ny && Number(x) !== Number(y))
      return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// Whether `candidate` should replace `running`: different code, and never an
// older version (two installed copies must not take turns downgrading it).
export function newerBuild(candidate, running) {
  if (!running?.hash) return true;
  if (running.hash === candidate.hash) return false;
  const order = compareVersions(candidate.version, running.version);
  // The same version with other code (an edited checkout) replaces it.
  return order >= 0;
}

// Copies the host layer, packages, vendored libraries and launchers into
// ZEROH_HOME/bin when its build is older.
function refreshRuntime(runtime, pluginRoot, build) {
  const current = readJsonOr(path.join(runtime, 'build.json'));
  if (!newerBuild(build, current)) return false;
  ensurePrivateDir(runtime);
  rmSync(path.join(runtime, 'lib'), { recursive: true, force: true });
  cpSync(path.join(pluginRoot, 'lib'), path.join(runtime, 'lib'), {
    recursive: true,
  });
  rmSync(path.join(runtime, 'packages'), { recursive: true, force: true });
  cpSync(path.join(pluginRoot, 'packages'), path.join(runtime, 'packages'), {
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
// phone region settings (packages/zeroh-disclosure-core/detector.js phoneRegion: a login item has no shell locale),
// and the network environment (packages/local-proxy/network.js) the daemon uses to reach its
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
//
// `replacing` (the health of the daemon on that port, which an update or a
// new network environment replaces): the new daemon takes the port over
// from it once it is loaded (packages/local-proxy/daemon.js ZEROH_PROXY_TAKEOVER), so
// the old one serves until the new one listens. When the new one could not
// take it (the old one did not let go in time), the old one is stopped and
// its port waited for, as before 1.0.2.
async function startDaemon({
  env,
  paths,
  config,
  preferredPort,
  spawnProcess,
  deadline,
  replacing = null,
}) {
  const fixed = fixedPort(env);
  const startedAt = Date.now();
  let port = fixed || config.port || preferredPort || (await freePort());
  let waited = false;
  let takeover = Boolean(replacing) && port === config.port;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    config.port = port;
    writeProxyConfig(paths, config);
    let exited = null;
    let startupError = null;
    const child = spawnProcess(
      process.execPath,
      [path.join(paths.runtime, 'bin', 'proxy-daemon.mjs'), paths.config],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        ...(process.platform === 'win32'
          ? { cwd: env.SystemRoot || env.SYSTEMROOT || os.homedir() }
          : {}),
        env: {
          ...daemonEnvironment(env),
          ...(takeover ? { ZEROH_PROXY_TAKEOVER: '1' } : {}),
        },
      },
    );
    child.once?.('exit', (code) => (exited = code ?? 1));
    if (process.platform === 'win32')
      child.once?.('error', (error) => {
        startupError = error;
        exited = 1;
      });
    child.unref?.();
    while (Date.now() < deadline && exited === null) {
      const health = await probeProxy(portUrl(port), {
        controlToken: config.controlToken,
      });
      // The daemon being replaced answers until it has handed over.
      if (health && !(takeover && health.pid === replacing.pid)) return health;
      await delay(50);
    }
    if (startupError) throw startupError;
    if (takeover && exited !== null) {
      // It did not hand over: stopped first, as before 1.0.2.
      takeover = false;
      await shutdownDaemon(port, config.controlToken);
      await waitForPortFree(
        port,
        Math.min(PORT_RELEASE_WAIT_MS, deadline - Date.now()),
      );
      continue;
    }
    if (exited === null) {
      throw new Error(
        `local proxy did not become healthy after ${Date.now() - startedAt} ms`,
      );
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
    // One upstream serves every session of this settings file. A session's
    // environment must never choose it for the other sessions.
    upstream:
      (original.originalBaseUrlPresent &&
        usableUpstream(original.originalBaseUrlValue, ports)) ||
      DEFAULT_ANTHROPIC_UPSTREAM,
    ...original,
    proxyUrl: keep ? current : null,
    installedAt: new Date().toISOString(),
  };
}

export async function ensureDefaultProxy(options = {}) {
  const env = options.env || process.env;
  const paths = proxyPaths(env);
  const deadlineMs =
    options.deadlineMs ??
    Date.now() + (options.startTimeoutMs ?? START_TIMEOUT_MS);
  return withProxyLock(
    paths,
    () => ensureDefaultProxyLocked({ ...options, env, paths, deadlineMs }),
    { waitMs: options.lockWaitMs, deadlineMs: options.deadlineMs },
  );
}

async function prepareProxyInstall({
  env,
  paths,
  root,
  pluginRoot,
  settingsPath,
  sessionId,
}) {
  const optedOut = proxyDisabled(env);
  const target = path.resolve(
    settingsPath || resolveClaudeSettingsPath({ env }),
  );
  let config = readProxyConfig(paths);
  let install = installFor(config, target);
  if (optedOut && !install) {
    return {
      skipped: {
        enabled: false,
        optedOut: true,
        turnedOff: proxyTurnedOffByUser(env),
        wroteSettings: false,
      },
    };
  }
  const created = !install;
  if (created) {
    install = await prepareInstall({ env, paths, settingsPath: target });
  }
  config ||= {
    version: 3,
    controlToken: randomBytes(24).toString('base64url'),
    port: 0,
    installs: {},
  };
  config.installs[installId(target)] = install;
  reconcileInstallUpstreams(config, paths);
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
  return { config, created, install, network, optedOut, target };
}

async function ensureDaemonRunning({
  env,
  paths,
  config,
  install,
  pluginRoot,
  spawnProcess,
  deadline,
  network,
}) {
  const build = pluginBuild(pluginRoot);
  let health = config.port
    ? await probeProxy(portUrl(config.port), {
        controlToken: config.controlToken,
      })
    : null;
  let upgraded = false;
  let replacing = null;
  const networkChanged =
    health &&
    health.network !== networkFingerprint(network, config.controlToken);
  // A daemon draining after the session-only exit masks nothing new: it
  // hands its port to a new one, like an update.
  if (
    health &&
    (health.retired || newerBuild(build, health.build) || networkChanged)
  ) {
    const draining = Boolean(health.retired);
    replacing = health;
    health = null;
    upgraded = !draining;
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
      replacing,
    });
    restarted = true;
  }
  return { health, restarted, upgraded };
}

async function ensureLoginItem({
  env,
  paths,
  config,
  install,
  serviceManager,
  registerLoginItem,
  spawnProcess,
  deadline,
  initialHealth,
}) {
  const manager = serviceManager || createServiceManager({ env });
  const target = { runtime: paths.runtime, config: paths.config };
  let health = initialHealth;
  let warning = null;
  let loginItem = manager.isRegistered(target);
  if (loginItem && config.loginItemRefused) delete config.loginItemRefused;
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
          deadline,
        }));
    } catch (error) {
      // Registration already succeeded; a later probe can exhaust the shared
      // deadline without changing the login item's state.
      if (loginItem) throw error;
      const refusal = loginItemRefusal(error);
      if (!config.loginItemRefused) {
        warning = `ZeroH could not register the login item that starts its local proxy after a restart: ${loginItemReason(refusal)}. The proxy runs for this session only and what you type is still masked; a new session starts it again. To fix: ${loginItemFix(refusal)}.`;
        writeProxyDiagnostic({
          env,
          event: 'login-item-failed',
          failure: 'register',
          steps: [{ step: 'register', ok: false, code: error.code || 'error' }],
          install,
        });
      }
      config.loginItemRefused = refusal;
    }
  }
  return { health, loginItem, warning };
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
  deadlineMs = Date.now() + startTimeoutMs,
  writeSettings = true,
  registerLoginItem = true,
}) {
  const deadline = deadlineMs;
  if (Date.now() >= deadline) {
    throw new Error('ZeroH proxy start deadline expired');
  }
  const state = await prepareProxyInstall({
    env,
    paths,
    root,
    pluginRoot,
    settingsPath,
    sessionId,
  });
  if (state.skipped) return state.skipped;
  const { config, created, install, network, optedOut, target } = state;
  const running = await ensureDaemonRunning({
    env,
    paths,
    config,
    install,
    pluginRoot,
    spawnProcess,
    deadline,
    network,
  });
  let health = running.health;
  let loginItem = false;
  let warning = null;
  if (!optedOut) {
    ({ health, loginItem, warning } = await ensureLoginItem({
      env,
      paths,
      config,
      install,
      serviceManager,
      registerLoginItem,
      spawnProcess,
      deadline,
      initialHealth: health,
    }));
  }
  const proxyUrl = `${portUrl(config.port)}/z/${install.key}`;
  let wroteSettings = false;
  if (
    !optedOut &&
    (writeSettings || isZeroHProxyUrl(settingsBaseUrl(target)))
  ) {
    wroteSettings = writeProxySetting(install, proxyUrl);
    writeRestoreRecord(install);
  }
  writeProxyConfig(paths, config);
  return {
    enabled: !optedOut,
    loginItem: !optedOut && loginItem,
    sessionOnly: !optedOut && !loginItem,
    loginItemRefused: loginItem ? null : config.loginItemRefused || null,
    optedOut,
    installed: created,
    restarted: running.restarted,
    upgraded: running.upgraded,
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
