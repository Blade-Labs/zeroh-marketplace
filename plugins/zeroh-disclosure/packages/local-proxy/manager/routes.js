// SPDX-License-Identifier: AGPL-3.0-only

// Per-session proxy routing and prompt-time recovery.
import { statSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ANTHROPIC_UPSTREAM,
  isZeroHProxyUrl,
  higherPrecedenceSettingsPaths,
  proxyTurnedOff,
  readRestoreRecord,
  removeRestoreRecord,
  resolveClaudeSettingsPath,
  settingsBaseUrl,
  takeEntryOut,
  usableUpstream,
} from '../claude-settings.js';
import { loopbackPort } from '../loopback.js';
import { writeProxyDiagnostic } from '../proxy-report.js';
import {
  installFor,
  markSessionDown,
  proxyPaths,
  readProxyConfig,
  reconcileInstallUpstreams,
  refreshSessionRoute,
  sessionDownNotice,
  withProxyLock,
  writeProxyConfig,
} from '../proxy-state.js';
import { ensureDefaultProxy, PLUGIN_ROOT } from './install.js';
import {
  PROMPT_RESTART_BUDGET_MS,
  PROXY_DOWN_MESSAGE,
  SETTINGS_APPLY_WAIT_MS,
  delay,
  probeProxy,
  providerBypassesProxy,
  proxyDisabled,
  proxyOptedOut,
  proxyTurnedOffByUser,
} from './probe.js';

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
// attribute passes through unmasked (packages/local-proxy/daemon.js decideRoute). A
// session switched mid-prompt does not name the proxy yet.
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

// Higher-precedence settings and host-managed providers cannot be rerouted
// by changing this settings file. Environment URLs are classified separately.
export function baseUrlOverridden(
  env = process.env,
  { cwd = process.cwd(), platform = process.platform } = {},
) {
  const base = env.ANTHROPIC_BASE_URL;
  if (env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) return true;
  if (!base || isZeroHProxyUrl(base)) return false;
  const pathImpl = platform === 'win32' ? path.win32 : path;
  const target = pathImpl.resolve(resolveClaudeSettingsPath({ env, platform }));
  return higherPrecedenceSettingsPaths({ cwd, env, platform }).some(
    (candidate) =>
      pathImpl.resolve(candidate) !== target &&
      settingsBaseUrl(candidate) === base,
  );
}

// Where the ANTHROPIC_BASE_URL that keeps Claude Code off the proxy comes
// from, for doctor: the Claude Code settings file that sets it (managed, then
// the project's), else null for the environment Claude Code started in.
// Returns { host, file }; never the value itself, which may hold a key.
export function baseUrlOverrideSource({
  env = process.env,
  cwd = process.cwd(),
  platform = process.platform,
} = {}) {
  const base = env.ANTHROPIC_BASE_URL;
  let host = null;
  try {
    host = new URL(String(base)).host || null;
  } catch {
    // Not a URL: named without its host.
  }
  const pathImpl = platform === 'win32' ? path.win32 : path;
  const target = pathImpl.resolve(resolveClaudeSettingsPath({ env, platform }));
  const file =
    higherPrecedenceSettingsPaths({ cwd, env, platform }).find(
      (candidate) =>
        pathImpl.resolve(candidate) !== target &&
        base &&
        settingsBaseUrl(candidate) === base,
    ) ?? null;
  return {
    host,
    file,
    providerManaged: Boolean(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST),
  };
}

export function baseUrlRoutingState({
  env = process.env,
  cwd = process.cwd(),
} = {}) {
  if (baseUrlOverridden(env, { cwd })) return 'overridden';
  const value = env.ANTHROPIC_BASE_URL;
  if (!value || isZeroHProxyUrl(value)) return null;
  const sessionUpstream = usableUpstream(value);
  if (!sessionUpstream) {
    try {
      const parsed = new URL(value);
      if (parsed.username || parsed.password) return 'credentials';
    } catch {
      // An invalid URL is a mismatch, but it does not contain URL credentials.
    }
    return 'upstream-mismatch';
  }
  const settingsPath = resolveClaudeSettingsPath({ env });
  const installed = installFor(readProxyConfig(proxyPaths(env)), settingsPath);
  const original = installed || readRestoreRecord(settingsPath);
  const settingsUpstream =
    usableUpstream(settingsBaseUrl(settingsPath)) ||
    (original?.originalBaseUrlPresent &&
      usableUpstream(original.originalBaseUrlValue));
  // A user-settings entry affects every session of this file. Only the
  // default Anthropic URL is safe to promote from the environment. A gateway
  // is routable only when it comes from the settings original, never merely
  // because an earlier session seeded the install with the same URL.
  const defaultUrl = new URL(value).href === `${DEFAULT_ANTHROPIC_UPSTREAM}/`;
  if (!defaultUrl && settingsUpstream !== sessionUpstream) return 'overridden';
  const installUpstream =
    usableUpstream(installed?.upstream) ||
    settingsUpstream ||
    DEFAULT_ANTHROPIC_UPSTREAM;
  if (installUpstream !== sessionUpstream) {
    return 'upstream-mismatch';
  }
  return null;
}

// Puts THIS running session behind the proxy (T-19). Claude Code applies a
// changed settings file to a running session, so the first prompt of a
// session that does not use the proxy yet writes the entry and waits until
// Claude Code has picked it up; the prompt's own request then goes through
// the proxy. A secret in that very first prompt is still treated as not
// masked (sent with a "not protected" line; stopped with `uncertain
// block`): until the daemon has seen the session, the prompt might go out
// directly. Without a login item the proxy runs for the session all the
// same (session-only). Returns { routed, state }:
//   routed         the entry was just written (or by a session moments ago)
//   configured     the session already uses a ZeroH URL (the guard's case)
//   not-configured ZEROH_PROXY=off, or Bedrock, Vertex or Foundry
//   overridden     another source sets ANTHROPIC_BASE_URL
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
  // Reconcile upgrades even when this session already names the proxy or
  // will keep its own shell override. ensureDefaultProxy writes the corrected
  // config and probes the daemon, which reloads it before we route anything.
  const paths = proxyPaths(env);
  if (reconcileInstallUpstreams(readProxyConfig(paths), paths)) {
    try {
      await ensureDefaultProxy({
        env,
        root,
        pluginRoot,
        sessionId,
        startTimeoutMs: PROMPT_RESTART_BUDGET_MS,
        lockWaitMs: 1_000,
        serviceManager,
        registerLoginItem: false,
        writeSettings: false,
      });
    } catch {
      return { routed: false, state: 'not-written' };
    }
  }
  // The guard checks a session that names a proxy (also after `proxy off`).
  if (isZeroHProxyUrl(env.ANTHROPIC_BASE_URL)) {
    return { routed: false, state: 'configured' };
  }
  if (proxyTurnedOffByUser(env)) {
    return { routed: false, state: 'not-configured' };
  }
  const baseUrlState = baseUrlRoutingState({ env, cwd: root });
  if (baseUrlState) return { routed: false, state: baseUrlState };
  const target = resolveClaudeSettingsPath({ env });
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
  // Retired by `proxy off`, uninstall or doctor --fix: it still serves this
  // session until the session ends, so the prompt goes on.
  if ((await probeProxy(base))?.retired) {
    return { block: false, state: 'retired' };
  }
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
