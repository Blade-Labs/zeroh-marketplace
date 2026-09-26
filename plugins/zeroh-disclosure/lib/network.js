// SPDX-License-Identifier: AGPL-3.0-only

// The daemon's way to its upstream through the user's network: a corporate
// HTTP(S) proxy (HTTPS_PROXY, HTTP_PROXY, NO_PROXY) and extra trusted CAs
// (NODE_EXTRA_CA_CERTS, SSL_CERT_FILE). Node reads these only at start, and a
// daemon started at login has none of the shell's variables, so SessionStart
// records them in proxy.json (0600) and the daemon applies them itself with
// explicit agents, on every Node version the plugin supports (20+). Node
// built-ins only.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { isLoopbackHost } from './loopback.js';

export const NETWORK_VARIABLES = Object.freeze([
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
]);

// The variables that name a network proxy (the rest name trusted CAs).
const PROXY_VARIABLES = new Set([
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
]);

// `network` without its network proxy, or null when it names none.
export function withoutNetworkProxy(network) {
  const names = Object.keys(network || {});
  if (!names.some((name) => PROXY_VARIABLES.has(name))) return null;
  return Object.fromEntries(
    names
      .filter((name) => !PROXY_VARIABLES.has(name))
      .map((name) => [name, network[name]]),
  );
}

// Whether a failed upstream request means the network proxy itself can't be
// reached (it refused or timed out the connection, or its name does not
// resolve): the office or VPN proxy recorded by another session, on a
// network where it does not exist. A proxy that answers (even with an error
// for the upstream) is reachable.
const PROXY_UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);
export function networkProxyUnreachable(target, network, error) {
  return (
    Boolean(proxyFor(target, network)) &&
    PROXY_UNREACHABLE_CODES.has(error?.code)
  );
}

// The network variables set (non-empty) in `env`.
export function networkEnvironment(env = process.env) {
  const out = {};
  for (const name of NETWORK_VARIABLES) {
    if (typeof env[name] === 'string' && env[name].trim())
      out[name] = env[name];
  }
  return out;
}

// A value-free fingerprint of a network environment, keyed with the daemon's
// control token: the health endpoint is open to every local user, and a
// plain hash of a proxy URL with a password could be guessed offline.
export function networkFingerprint(network, controlToken) {
  const sorted = Object.fromEntries(
    Object.entries(network || {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHmac('sha256', String(controlToken || ''))
    .update(JSON.stringify(sorted))
    .digest('hex')
    .slice(0, 16);
}

function first(network, ...names) {
  for (const name of names) if (network[name]) return network[name];
  return null;
}

// NO_PROXY: comma or space separated hosts, `*`, `.suffix` or `suffix`
// (matching the host and its subdomains), optionally with `:port`.
export function bypassesProxy(target, network) {
  if (isLoopbackHost(target.hostname)) return true;
  const list = first(network, 'NO_PROXY', 'no_proxy');
  if (!list) return false;
  const host = target.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  return list
    .split(/[\s,]+/u)
    .filter(Boolean)
    .some((raw) => {
      const entry = raw.toLowerCase();
      if (entry === '*') return true;
      const [name, entryPort] = entry.startsWith('[')
        ? [entry.slice(1, entry.indexOf(']')), entry.split(']:')[1]]
        : entry.split(':');
      if (entryPort && entryPort !== port) return false;
      const suffix = name.replace(/^\*?\./u, '');
      return host === suffix || host.endsWith(`.${suffix}`);
    });
}

// The proxy URL to reach `target` through, or null for a direct connection.
export function proxyFor(target, network) {
  if (bypassesProxy(target, network)) return null;
  const value =
    target.protocol === 'https:'
      ? first(network, 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy')
      : first(network, 'HTTP_PROXY', 'http_proxy');
  if (!value) return null;
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

// Node's own roots, the OS store where this Node can read it, and the extra
// CA files. Null when no extra file is set (Node's defaults apply).
export function trustedCertificates(network) {
  const extra = [];
  for (const name of ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
    if (!network[name]) continue;
    try {
      extra.push(readFileSync(network[name], 'utf8'));
    } catch {
      // A missing file is reported as a TLS error when it matters.
    }
  }
  if (!extra.length) return null;
  let system = [];
  try {
    system = tls.getCACertificates?.('system') ?? [];
  } catch {
    // Older Node: its bundled roots only.
  }
  return [...tls.rootCertificates, ...system, ...extra];
}

function proxyAuthorization(proxy) {
  if (!proxy.username) return {};
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return {
    'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}`,
  };
}

export class ProxyConnectError extends Error {
  constructor(status) {
    super(`your network proxy answered ${status} to the tunnel request`);
    this.code = 'ZEROH_PROXY_CONNECT';
    this.status = status;
  }
}

// An HTTPS agent that tunnels through an HTTP(S) proxy with CONNECT.
class TunnelAgent extends https.Agent {
  constructor(proxy, { connectTimeoutMs, ...options }) {
    super({ keepAlive: true, ...options });
    this.proxy = proxy;
    this.connectTimeoutMs = connectTimeoutMs;
  }

  createConnection(options, callback) {
    const proxy = this.proxy;
    const client = proxy.protocol === 'https:' ? https : http;
    const authority = `${options.host}:${options.port}`;
    const connect = client.request({
      host: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: authority,
      headers: { host: authority, ...proxyAuthorization(proxy) },
      agent: false,
      ...(this.options.ca ? { ca: this.options.ca } : {}),
    });
    connect.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        callback(new ProxyConnectError(response.statusCode));
        return;
      }
      const secure = tls.connect({
        ...options,
        socket,
        servername: options.servername || options.host,
      });
      callback(null, secure);
    });
    connect.once('error', (error) => callback(error));
    if (this.connectTimeoutMs) {
      connect.setTimeout(this.connectTimeoutMs, () => {
        const error = new Error('connect timeout');
        error.code = 'ETIMEDOUT';
        connect.destroy(error);
      });
    }
    connect.end();
  }
}

// One way to the upstream for a network environment: request(target,
// options, onResponse) behaves like http(s).request with the right agent.
export function createUpstreamClient(
  network = {},
  { connectTimeoutMs = 10_000 } = {},
) {
  const ca = trustedCertificates(network);
  const agents = new Map();
  const agentFor = (target, proxy) => {
    const key = `${target.protocol}|${proxy?.href || ''}`;
    if (!agents.has(key)) {
      agents.set(
        key,
        target.protocol === 'https:'
          ? proxy
            ? new TunnelAgent(proxy, {
                connectTimeoutMs,
                ...(ca ? { ca } : {}),
              })
            : new https.Agent({ keepAlive: true, ...(ca ? { ca } : {}) })
          : new http.Agent({ keepAlive: true }),
      );
    }
    return agents.get(key);
  };
  return {
    request(target, options, onResponse) {
      const proxy = proxyFor(target, network);
      if (target.protocol === 'http:' && proxy) {
        // Plain HTTP through a proxy: absolute-form to the proxy.
        return (proxy.protocol === 'https:' ? https : http).request(
          {
            host: proxy.hostname,
            port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
            method: options.method,
            path: target.href,
            headers: { ...options.headers, ...proxyAuthorization(proxy) },
            agent: agentFor(proxy, null),
          },
          onResponse,
        );
      }
      const client = target.protocol === 'http:' ? http : https;
      return client.request(
        target,
        { ...options, agent: agentFor(target, proxy) },
        onResponse,
      );
    },
    destroy() {
      for (const agent of agents.values()) agent.destroy();
    },
  };
}

// Whether an upstream failure is the network's (Claude Code's own bounded
// retry applies, as it would without ZeroH) or one that retrying cannot fix:
// certificates, a proxy that refuses or wants a password.
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'ECONNABORTED',
  'UND_ERR_SOCKET',
]);

export function transientNetworkError(error) {
  if (error?.code === 'ZEROH_PROXY_CONNECT') {
    return error.status >= 500 && error.status !== 501;
  }
  return (
    TRANSIENT_CODES.has(error?.code) ||
    /socket hang up/iu.test(String(error?.message))
  );
}
