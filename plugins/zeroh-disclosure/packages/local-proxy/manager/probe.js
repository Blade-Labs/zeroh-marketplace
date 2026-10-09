// SPDX-License-Identifier: AGPL-3.0-only

// Proxy health probes and daemon transport primitives.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {
  proxyKeyOf,
  proxyTurnedOff,
  resolveClaudeSettingsPath,
} from '../claude-settings.js';
import { sameSecret } from '../../zeroh-disclosure-core/crypto.js';
import { healthProof } from '../proxy-state.js';
import { MESSAGES } from '../proxy.js';

export const START_TIMEOUT_MS = 20_000;
// A prompt waits at most this long for a proxy restart (D-10).
export const PROMPT_RESTART_BUDGET_MS = 3_000;
const HEALTH_TIMEOUT_MS = 800;
// A daemon whose home was deleted or replaced leaves its port within this.
export const PORT_RELEASE_WAIT_MS = 2_500;
// A running Claude Code session re-reads a settings file that changes and
// applies its `env` (a 1 s stability wait plus 500 ms polling, measured on
// 2.1.283); a prompt that routes its session waits this long first.
export const SETTINGS_APPLY_WAIT_MS = 2_000;

export const PROXY_DOWN_MESSAGE = MESSAGES.down;

export function delay(milliseconds) {
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

export function portUrl(port) {
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

export async function shutdownDaemon(port, controlToken) {
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

// Retires the daemon (packages/local-proxy/daemon.js): it keeps serving the Claude
// Code sessions that still name its URL and exits by itself once idle. With
// `masking` (proxy off, doctor --fix: the vault and hooks remain) it keeps
// masking the values it masked before, and nothing new; without it
// (uninstall: nothing could put a token back) it masks nothing (rule 8).
// False when it isn't there or is a build without retirement (the caller
// then stops it as before).
export async function retireDaemon(
  port,
  controlToken,
  { masking = true, mode = 'retired' } = {},
) {
  if (!port || !controlToken) return false;
  try {
    const response = await request({
      url: `${portUrl(port)}/_zeroh/retire?${new URLSearchParams({ ...(masking ? {} : { masker: 'none' }), ...(mode === 'draining' ? { mode } : {}) })}`,
      method: 'POST',
      headers: { 'x-zeroh-control': controlToken },
      // It reads its vaults before it answers.
      timeoutMs: 5_000,
    });
    return response.statusCode === 204;
  } catch {
    return false;
  }
}

// Retire (sessions still open keep working) or stop the daemon; `retire`
// is what the user's commands ask for. Returns { stopped, retired }.
export async function leaveDaemon(
  port,
  controlToken,
  { retire = false, masking = true } = {},
) {
  if (retire && (await retireDaemon(port, controlToken, { masking }))) {
    return { stopped: false, retired: true };
  }
  return { stopped: await shutdownDaemon(port, controlToken), retired: false };
}

export function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

export async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portInUse(port))) return true;
    await delay(50);
  }
  return !(await portInUse(port));
}

export function freePort() {
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

// Vendored code the packages load at run time: the detection engine with its
// upstream libraries, copied with their licences next to the daemon's code.
