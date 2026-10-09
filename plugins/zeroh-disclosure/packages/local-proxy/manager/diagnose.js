// SPDX-License-Identifier: AGPL-3.0-only

// Read-only proxy status and doctor diagnosis/fix operations.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  installId,
  isOurProxyUrl,
  isZeroHProxyUrl,
  readRestoreRecord,
  resolveClaudeSettingsPath,
  settingsBaseUrl,
  usableUpstream,
} from '../claude-settings.js';
import {
  deriveProtectionState,
  ProtectionState,
} from '../../zeroh-disclosure-core/protection-state.js';
import { loopbackPort } from '../loopback.js';
import {
  installFor,
  proxyPaths,
  readProxyConfig,
  removeRoutesOf,
  withProxyLock,
  writeProxyConfig,
  zerohPorts,
} from '../proxy-state.js';
import { createServiceManager } from '../service-manager.js';
import { removeProxyState, restoreClaudeSettings } from './orphans.js';
import {
  portUrl,
  probeProxy,
  retireDaemon,
  shutdownDaemon,
  waitForPortFree,
} from './probe.js';
import { baseUrlOverrideSource, baseUrlRoutingState } from './routes.js';

export async function proxyRuntimeStatus({
  env = process.env,
  serviceManager,
} = {}) {
  const paths = proxyPaths(env);
  const config = readProxyConfig(paths);
  if (!config) return { installed: false, running: false, loginItem: false };
  const health = config.port
    ? await probeProxy(portUrl(config.port), {
        controlToken: config.controlToken,
      })
    : null;
  let loginItem = false;
  try {
    loginItem = (serviceManager || createServiceManager({ env })).isRegistered({
      runtime: paths.runtime,
      config: paths.config,
    });
  } catch {
    loginItem = false;
  }
  return {
    installed: true,
    running: Boolean(health),
    loginItem,
    loginItemRefused: loginItem ? null : config.loginItemRefused || null,
  };
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
// owned daemons are stopped or retired. A daemon whose control token this
// home cannot prove is left running; cleanup must not cut another session.
async function findDaemons(env, paths, settingsPath, current, config) {
  const daemons = [];
  for (const port of candidatePorts(env, paths, settingsPath, current)) {
    const body = await probeProxy(portUrl(port));
    // A retired daemon serves the sessions still open and leaves by itself.
    if (!body || body.retired) continue;
    const ours =
      config &&
      (await probeProxy(portUrl(port), { controlToken: config.controlToken }));
    daemons.push({ port, pid: body.pid, ours: Boolean(ours) });
  }
  return daemons;
}

function proxyLeftovers(paths) {
  try {
    return readdirSync(paths.directory).filter(
      (name) =>
        ![
          'proxy.json',
          'routes',
          'manager.lock',
          'daemon.pid',
          'zeroh-disclosure-proxy.xml',
        ].includes(name) && !/\.lock\.stale-.+/u.test(name),
    );
  } catch {
    return [];
  }
}

function recordedUpstreamSource(install, settingsPath) {
  if (!install?.upstream) return null;
  if (install.originalBaseUrlPresent) {
    return { kind: 'settings', file: settingsPath };
  }
  if (
    usableUpstream(install.upstream) ===
    usableUpstream(DEFAULT_ANTHROPIC_UPSTREAM)
  ) {
    return { kind: 'default' };
  }
  return { kind: 'environment' };
}

async function collectDiagnosis({ env, paths, settingsPath, manager, config }) {
  const install = installFor(config, settingsPath);
  const record = install || readRestoreRecord(settingsPath);
  const current = settingsBaseUrl(settingsPath);
  const daemons = await findDaemons(env, paths, settingsPath, current, config);
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
  if (proxyLeftovers(paths).length) {
    findings.push('files-from-an-earlier-build');
  }
  const routingState = baseUrlRoutingState({ env });
  const protectionState = routingState
    ? deriveProtectionState({ sessionProxy: routingState })
    : null;
  if (protectionState === ProtectionState.OVERRIDDEN) {
    findings.push('base-url-overridden');
  } else if (protectionState === ProtectionState.BASE_URL_CREDENTIALS) {
    findings.push('base-url-credentials');
  } else if (protectionState === ProtectionState.UPSTREAM_MISMATCH) {
    findings.push('upstream-mismatch');
  } else if (
    env.ANTHROPIC_BASE_URL &&
    !isZeroHProxyUrl(env.ANTHROPIC_BASE_URL)
  ) {
    findings.push('base-url-shell');
  }
  const loginItem = manager.isRegistered();
  if (loginItem && !Object.keys(config?.installs || {}).length) {
    findings.push('login-item-without-install');
  }
  const loginItemRefused =
    !loginItem && config?.loginItemRefused ? config.loginItemRefused : null;
  if (loginItemRefused && Object.keys(config?.installs || {}).length) {
    findings.push('login-item-refused');
  }
  return {
    daemons,
    report: {
      settingsPath,
      entry: entry ? (entryLive ? 'live' : 'dead') : 'none',
      daemons: daemons.length,
      loginItem,
      ...(loginItemRefused ? { loginItemRefused } : {}),
      findings,
      ...(protectionState ? { protectionState } : {}),
      baseUrlSource: baseUrlOverrideSource({ env }),
      installUpstreamSource: recordedUpstreamSource(install, settingsPath),
      fixed: false,
    },
  };
}

async function stopDiagnosedDaemons({ daemons, latest, remaining, retire }) {
  let stopped = 0;
  let retired = 0;
  let drainUnavailable = 0;
  for (const daemon of daemons) {
    if (!daemon.ours) {
      drainUnavailable += 1;
      continue;
    }
    if (remaining) continue;
    if (retire && (await retireDaemon(daemon.port, latest?.controlToken))) {
      retired += 1;
      continue;
    }
    let down =
      (await shutdownDaemon(daemon.port, latest?.controlToken)) &&
      (await waitForPortFree(daemon.port, 1_000));
    if (!down && Number.isInteger(daemon.pid) && daemon.pid > 1) {
      try {
        process.kill(daemon.pid, 'SIGTERM');
        down = await waitForPortFree(daemon.port, 1_000);
      } catch {
        down = false;
      }
    }
    if (down) stopped += 1;
  }
  return { retired, stopped, drainUnavailable };
}

async function fixDiagnosis({
  env,
  paths,
  settingsPath,
  manager,
  daemons,
  report,
  retire,
}) {
  const latest = readProxyConfig(paths);
  const restored = restoreClaudeSettings({
    env,
    settingsPath,
    config: latest,
    probedPorts: daemons.map((daemon) => daemon.port),
  });
  if (latest) delete latest.installs[installId(settingsPath)];
  const remaining = Object.keys(latest?.installs || {}).length;
  const stopped = await stopDiagnosedDaemons({
    daemons,
    latest,
    remaining,
    retire,
  });
  let loginItem = null;
  if (remaining) {
    writeProxyConfig(paths, latest);
    removeRoutesOf(paths, installId(settingsPath));
  } else {
    loginItem = manager.unregister({
      keepRunning: stopped.retired > 0 || stopped.drainUnavailable > 0,
    });
    removeProxyState(paths);
  }
  return {
    ...report,
    fixed: true,
    restored: restored.restored,
    stopped: stopped.stopped,
    retired: stopped.retired,
    drainUnavailable: stopped.drainUnavailable,
    loginItemRemoved: Boolean(loginItem?.removed),
  };
}

// Reports the proxy's state and, with `fix`, resets it.
export async function diagnoseProxy({
  env = process.env,
  fix = false,
  serviceManager,
  retire = false,
} = {}) {
  const paths = proxyPaths(env);
  const settingsPath = path.resolve(resolveClaudeSettingsPath({ env }));
  const manager = serviceManager || createServiceManager({ env });
  const config = readProxyConfig(paths);
  const diagnosis = await collectDiagnosis({
    env,
    paths,
    settingsPath,
    manager,
    config,
  });
  if (!fix) return diagnosis.report;
  return withProxyLock(paths, () =>
    fixDiagnosis({
      env,
      paths,
      settingsPath,
      manager,
      daemons: diagnosis.daemons,
      report: diagnosis.report,
      retire,
    }),
  );
}
