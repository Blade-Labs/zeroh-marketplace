// SPDX-License-Identifier: AGPL-3.0-only

// Shared plumbing for hook scripts.
import {
  baseUrlOverridden,
  refreshRoute as refreshSessionRoute,
  sessionNamesInstallProxy,
  sessionProxyState,
  settingsEntryState,
} from './proxy-manager.js';
import { proxyPaths, readProxyConfig, routeSeen } from './proxy-state.js';
import { projectRootFromEnv } from './session.js';

// The hook's event. Under hooks/run.js the loader has already read stdin.
export async function readStdinJson() {
  let raw = globalThis.zerohHook?.input;
  if (raw === undefined) {
    if (process.stdin.isTTY) return null;
    raw = '';
    for await (const chunk of process.stdin) raw += chunk;
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Writes the hook's one answer and tells the loader it was written, so a
// later failure does not add a second (fail-closed) answer.
export function emit(obj) {
  if (globalThis.zerohHook) globalThis.zerohHook.state.emitted = true;
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

// UserPromptSubmit: stops the prompt with `message` and exits. Claude Code
// reads the JSON answer even with exit code 2, shows `reason` as it is and,
// with suppressOriginalPrompt, never repeats the prompt (T-30). Exit code 2
// with the same text on stderr stops the prompt even if the JSON were not
// understood.
export function stopPrompt(message, { systemMessage = null } = {}) {
  emit({
    decision: 'block',
    reason: message,
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      suppressOriginalPrompt: true,
    },
  });
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// UserPromptSubmit: the prompt is fully checked; a failure from here on must
// not stop it.
export function markPromptCleared() {
  if (globalThis.zerohHook) globalThis.zerohHook.state.cleared = true;
}

// The project root that sessions, the vault, allow rules and .zeroh.env all
// key on, by the one rule (projectRootFromEnv), starting from the event's
// working directory.
export function projectDir(event) {
  return projectRootFromEnv(event?.cwd);
}

// Detection profile for tool output and tool input (anything the user did not
// type): secrets plus validated personal data (email, card, IBAN,
// international phone, checksum-validated national IDs). National-format
// phone numbers are only looked for in text the user typed; on code, logs
// and file names digit groups are rarely phone numbers. Values the user typed
// stay masked in tool output through the vault's exact match.
// ZEROH_MASK_PII=off leaves only secrets.
export function piiProfile() {
  return String(process.env.ZEROH_MASK_PII || 'on').toLowerCase() === 'off'
    ? 'secrets'
    : 'tool';
}

// True when THIS session's model traffic is masked by the ZeroH proxy, so a
// typed secret needs no block-and-paste. The daemon itself must prove (with
// this home's control token) that it masks this session; nothing in the
// environment can claim it. See sessionProxyState for the reasons it is not.
// With `requireSeen`, the daemon must also have received a request of this
// session already (LP-B5): see proxyConfirmed.
export async function proxyActive({
  sessionId = null,
  env = process.env,
  requireSeen = false,
} = {}) {
  try {
    const active = (await sessionProxyState({ env, sessionId })).active;
    return active && (!requireSeen || proxyConfirmed({ sessionId, env }));
  } catch {
    return false;
  }
}

// What the banner and /zeroh-disclosure:status say about typed text (see
// lib/banner.js): on, ready (the first prompt puts the session behind the
// proxy), overridden, off, provider or down.
export async function proxyState({ sessionId = null, env = process.env } = {}) {
  let state;
  try {
    state = await sessionProxyState({ env, sessionId });
  } catch {
    return 'down';
  }
  if (state.active) return 'on';
  if (state.reason === 'opted-out') return 'off';
  if (state.reason === 'turned-off') return 'turned-off';
  if (state.reason === 'provider') return 'provider';
  if (state.reason === 'not-configured') {
    if (baseUrlOverridden(env)) return 'overridden';
    if (settingsEntryState(env) === 'removed-by-user') return 'off';
    return readProxyConfig(proxyPaths(env)) ? 'ready' : 'off';
  }
  return 'down';
}

// True when this session's traffic is known to reach the proxy (LP-B5,
// T-29): the daemon has masked a request under its id already, OR the hook's
// own environment names this install's proxy URL (the session started behind
// it, or Claude Code has applied the entry since). Callers hold proxyActive,
// which proves the daemon healthy and masking this session. Only a session
// switched to the proxy mid-prompt (its environment does not name the proxy
// yet) waits for "seen"; its typed secrets are stopped until then.
export function proxyConfirmed({ sessionId = null, env = process.env } = {}) {
  if (!sessionId) return false;
  try {
    if (routeSeen(proxyPaths(env), sessionId)) return true;
  } catch {
    // No route state: fall through to the environment.
  }
  try {
    return sessionNamesInstallProxy(env);
  } catch {
    return false;
  }
}

// Keeps this session's proxy route alive and pointed at its project. Called
// by every hook; advisory, so a failure never blocks the hook.
export function refreshRoute(event) {
  return refreshSessionRoute({
    sessionId: event?.session_id,
    root: projectDir(event),
  });
}
