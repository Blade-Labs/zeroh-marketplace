// SPDX-License-Identifier: AGPL-3.0-only

// Upstream validation, request forwarding and HTTP proxy lifecycle.
import http from 'node:http';
import { isLoopbackHost } from './loopback.js';
import {
  createUpstreamClient,
  networkProxyUnreachable,
  transientNetworkError,
} from './network.js';
import { isVaultError, vaultProblem } from '../zeroh-disclosure-core/vault.js';
import { DOCTOR_FIX, PROXY_OFF } from '../zeroh-disclosure-core/fix-command.js';
import { createBodyMasker, recordUnrestorable } from './scrub.js';

const MAX_BODY_BYTES = 256 * 1024 * 1024;

export function isProxyLoop(upstream, { host = '127.0.0.1', port } = {}) {
  if (!port) return false;
  const target = new URL(upstream);
  const targetPort = Number(
    target.port || (target.protocol === 'https:' ? 443 : 80),
  );
  return (
    targetPort === Number(port) &&
    ((isLoopbackHost(target.hostname) && isLoopbackHost(host)) ||
      target.hostname === host)
  );
}

// Anthropic Messages and Claude Code's service calls.
const ALLOWED_PATHS = ['/v1/', '/api/'];
const PROXY_KEY_PATH_RE = /^\/z\/([A-Za-z0-9_-]{16,128})(\/.*)?$/u;

// How long the proxy waits for a TCP/TLS connection to its upstream before
// answering with a clear error instead of leaving Claude Code waiting.
export const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

// Every message the proxy and its lifecycle show the user, in one place.
const RECOVERY_HINT = `Run ${DOCTOR_FIX()} and start a new Claude Code session. To stop using the proxy, run ${PROXY_OFF()}.`;
export const MESSAGES = Object.freeze({
  recoveryHint: RECOVERY_HINT,
  originFormOnly: 'ZeroH proxy accepts only origin-form request paths',
  apiPathsOnly: 'ZeroH proxy forwards only API paths',
  upstreamOnly: 'ZeroH proxy forwards only to its upstream',
  loop: `ZeroH Disclosure: the local proxy's upstream points back at the proxy itself, so nothing was sent. ${RECOVERY_HINT}`,
  // A network failure: Claude Code retries it (bounded), as without ZeroH.
  unreachable: (host, reason) =>
    `ZeroH Disclosure: the local proxy can't reach ${host} right now (${reason}); Claude Code retries. If it keeps happening, check your network connection.`,
  // A failure retrying cannot fix: certificates, a proxy that refuses.
  upstreamRefused: (host, reason, hint) =>
    `ZeroH Disclosure: the local proxy can't reach ${host} (${reason}), so nothing was sent. ${hint}`,
  tooLarge: 'ZeroH proxy: request body too large to inspect',
  jsonOnly: 'ZeroH proxy forwards only JSON request bodies',
  notInspected: (reason) =>
    `ZeroH proxy could not inspect the request, so nothing was sent: ${reason}`,
  vault: ({ reason, fix }) =>
    `ZeroH Disclosure: the local proxy can't open this project's vault (${reason}), so nothing was sent. ${fix}`,
  failed: (reason) =>
    `ZeroH proxy: ${reason}. Nothing was sent. ${RECOVERY_HINT}`,
  optedOut:
    'ZeroH Disclosure: a session started with ZEROH_PROXY=off; its requests pass through without masking.',
  noRoute: `ZeroH Disclosure: a Claude Code session that ZeroH Disclosure does not run in (the plugin is disabled in that project or removed, or Claude Code started the session without plugins) still uses the local proxy through your Claude Code settings; its requests pass through without masking. Run ${PROXY_OFF()} to stop using the proxy.`,
  down: "ZeroH's local proxy isn't running, so what you type can't be masked in this session. Restart Claude Code to continue without it; until then typed secrets are stopped, not sent.",
});

class ProxyRequestError extends Error {
  constructor(status, type, message) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

function sendError(res, status, type, message, { retry = false } = {}) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  // Claude Code retries 408, 409, 429 and 5xx (ten attempts). An error the
  // proxy itself produces never gets better by retrying, so it is a 4xx and
  // says so; the message tells the user what to do (D-10). A network failure
  // on the way to the upstream is a 502 Claude Code may retry, as it would
  // retry the same failure without ZeroH (LP-F1).
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-should-retry': retry ? 'true' : 'false',
  });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}

function upstreamHost(upstream) {
  try {
    return new URL(upstream).host;
  } catch {
    return 'the upstream';
  }
}

function refusedHint(error) {
  if (error?.code === 'ZEROH_PROXY_CONNECT') {
    return error.status === 407
      ? 'Your network proxy asks for a password: put it in HTTPS_PROXY (http://user:password@host:port) and start a new Claude Code session.'
      : 'Your network proxy refused the connection; ask your IT team to allow it, or set NO_PROXY for this host.';
  }
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/u.test(String(error?.code))) {
    return "If your network inspects HTTPS, point NODE_EXTRA_CA_CERTS at its CA certificate file and start a new Claude Code session; ZeroH's proxy picks it up.";
  }
  return RECOVERY_HINT;
}

// The answer for a failed upstream connection: retryable for a network
// failure, final (with the fix) for everything else.
export function upstreamFailure(upstream, error) {
  const host = upstreamHost(upstream);
  const reason = error?.code || error?.message || 'connection failed';
  if (transientNetworkError(error)) {
    return {
      status: 502,
      type: 'api_error',
      retry: true,
      message: MESSAGES.unreachable(host, reason),
    };
  }
  return {
    status: 400,
    type: 'invalid_request_error',
    retry: false,
    message: MESSAGES.upstreamRefused(host, reason, refusedHint(error)),
  };
}

// Parses an origin-form request target /z/<key>/<API path>. Absolute-form
// (`http://host/…`), scheme-relative (`//host/…`) and backslash tricks are
// refused; the access key is removed; the rest must be an API path.
export function parseProxyTarget(rawUrl) {
  const raw = String(rawUrl ?? '');
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    throw new ProxyRequestError(
      400,
      'invalid_request_error',
      MESSAGES.originFormOnly,
    );
  }
  const parsed = new URL(raw, 'http://zeroh-proxy.invalid');
  if (parsed.host !== 'zeroh-proxy.invalid') {
    throw new ProxyRequestError(
      400,
      'invalid_request_error',
      MESSAGES.originFormOnly,
    );
  }
  // The key is optional here: the owner decides what a request without one
  // gets (the daemon forwards it to a known upstream).
  const keyed = PROXY_KEY_PATH_RE.exec(parsed.pathname);
  const pathname = keyed ? keyed[2] || '/' : parsed.pathname;
  if (!ALLOWED_PATHS.some((prefix) => pathname.startsWith(prefix))) {
    throw new ProxyRequestError(404, 'not_found_error', MESSAGES.apiPathsOnly);
  }
  return { key: keyed?.[1] ?? null, pathname, search: parsed.search };
}

export function upstreamTarget(upstream, { pathname, search }) {
  const up = new URL(upstream);
  const target = new URL(up.origin);
  target.pathname = `${up.pathname.replace(/\/$/u, '')}${pathname}`;
  target.search = search || '';
  if (target.host !== up.host || target.protocol !== up.protocol) {
    throw new ProxyRequestError(
      400,
      'invalid_request_error',
      MESSAGES.upstreamOnly,
    );
  }
  return target;
}

// The masking HTTP server.
// - resolveUpstream(key): the upstream URL for an access key; none refuses.
// - route(req, { hasBody }): { action: 'mask', root } masks with that
//   project's vault ({ roots }: each in turn; the daemon names one root);
//   { action: 'known',
//   masker } replaces only the values a retired daemon holds in memory
//   (knownValueMasker); { action: 'pass', notice?, quiet? } forwards
//   unchanged.

function resolveRequest(state, req) {
  const target = parseProxyTarget(req.url);
  const resolved = state.resolveUpstream(target.key);
  if (!resolved) {
    throw new ProxyRequestError(403, 'permission_error', MESSAGES.upstreamOnly);
  }
  const up = new URL(resolved);
  const port = state.server.address()?.port;
  if (port && isProxyLoop(up.href, { port })) {
    throw new ProxyRequestError(400, 'invalid_request_error', MESSAGES.loop);
  }
  return { up, target: upstreamTarget(up.href, target) };
}

function forwardRequest(
  state,
  req,
  res,
  { up, target },
  body,
  masked,
  firstInactive,
  retried = false,
) {
  const headers = { ...req.headers, host: up.host };
  if (masked) {
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    headers['content-length'] = String(body.length);
  }
  let connectTimer = null;
  const upReq = state.upstreamClient.request(
    target,
    { method: req.method, headers },
    (upRes) => {
      clearTimeout(connectTimer);
      if (firstInactive) {
        res.setHeader('x-zeroh-disclosure', 'passthrough-plugin-inactive');
      }
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
      upRes.on('aborted', () => res.destroy());
      upRes.on('error', () => res.destroy());
    },
  );
  res.on('close', () => {
    if (!res.writableFinished) upReq.destroy();
  });
  upReq.on('socket', (socket) => {
    if (!socket.connecting) return;
    connectTimer = setTimeout(() => {
      const error = new Error('connect timeout');
      error.code = 'ETIMEDOUT';
      upReq.destroy(error);
    }, state.connectTimeoutMs);
    connectTimer.unref?.();
    socket.once(
      target.protocol === 'https:' ? 'secureConnect' : 'connect',
      () => clearTimeout(connectTimer),
    );
  });
  upReq.on('error', (error) => {
    clearTimeout(connectTimer);
    if (
      !retried &&
      upReq.reusedSocket &&
      !res.headersSent &&
      ['ECONNRESET', 'EPIPE'].includes(error?.code)
    ) {
      forwardRequest(
        state,
        req,
        res,
        { up, target },
        body,
        masked,
        firstInactive,
        true,
      );
      return;
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (networkProxyUnreachable(target, state.currentNetwork, error)) {
      state.onNetworkProxyUnreachable?.(error);
    }
    const failure = upstreamFailure(up.href, error);
    sendError(res, failure.status, failure.type, failure.message, {
      retry: failure.retry,
    });
  });
  upReq.end(body);
}

function maskDecisionBody(state, req, decision, body) {
  if (decision.action === 'known') {
    if (!body.length) return { body, masked: false, unrestorable: [] };
    const result = state.bodyMasker.maskKnown(req, body, decision.masker);
    return { ...result, unrestorable: [] };
  }
  if (decision.action === 'mask') {
    if (!body.length) return { body, masked: false, unrestorable: [] };
    // Keep legacy multi-root support until callers are proven absent.
    return state.bodyMasker.maskBodyWith(
      req,
      body,
      decision.roots ?? [decision.root],
    );
  }
  return { body, masked: false, unrestorable: [] };
}

function passNotice(state, decision) {
  if (decision.quiet || state.inactiveNoticeSent) return false;
  state.inactiveNoticeSent = true;
  state.onInactive?.(decision.notice || MESSAGES.noRoute);
  return true;
}

function finishRequest(state, req, res, resolved, chunks, tooLarge) {
  if (tooLarge) {
    sendError(res, 413, 'request_too_large', MESSAGES.tooLarge);
    return;
  }
  let body = Buffer.concat(chunks);
  const decision = state.route(req, { hasBody: body.length > 0 }) || {
    action: 'pass',
  };
  let masked = false;
  let unrestorable = [];
  try {
    ({ body, masked, unrestorable } = maskDecisionBody(
      state,
      req,
      decision,
      body,
    ));
  } catch (error) {
    sendError(
      res,
      error.status && error.status < 500 ? error.status : 400,
      error.type || 'invalid_request_error',
      decision.action === 'mask' && isVaultError(error)
        ? MESSAGES.vault(vaultProblem(error))
        : MESSAGES.notInspected(error.message),
    );
    return;
  }
  const firstInactive =
    decision.action === 'known' || decision.action === 'mask'
      ? false
      : passNotice(state, decision);
  if (!unrestorable.length) {
    forwardRequest(state, req, res, resolved, body, masked, firstInactive);
    return;
  }
  const sessionId = String(req.headers['x-claude-code-session-id'] || '');
  Promise.resolve()
    .then(() => state.onUnrestorable({ roots: unrestorable, sessionId }))
    .catch(() => {})
    .then(() =>
      forwardRequest(state, req, res, resolved, body, masked, firstInactive),
    );
}

function handleProxyRequest(state, req, res) {
  if (state.handleRequest?.(req, res)) return;
  let resolved;
  try {
    resolved = resolveRequest(state, req);
  } catch (error) {
    req.resume();
    sendError(
      res,
      error.status || 400,
      error.type || 'invalid_request_error',
      error.message,
    );
    return;
  }
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      return;
    }
    chunks.push(chunk);
  });
  req.on('error', () => res.destroy());
  req.on('end', () => {
    try {
      finishRequest(state, req, res, resolved, chunks, tooLarge);
    } catch (error) {
      sendError(
        res,
        400,
        'invalid_request_error',
        MESSAGES.failed(error.message),
      );
    }
  });
}

function attachServerEvents(state) {
  const { server } = state;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('close', () => state.upstreamClient.destroy());
  server.useNetwork = (next) => {
    const previous = state.upstreamClient;
    state.currentNetwork = next;
    state.upstreamClient = createUpstreamClient(next, {
      connectTimeoutMs: state.connectTimeoutMs,
    });
    setTimeout(() => previous.destroy(), 60_000).unref?.();
  };
}

// The masking HTTP server.
export function createMaskingProxy({
  resolveUpstream,
  route,
  handleRequest = null,
  onInactive = (message) => process.stderr.write(`${message}\n`),
  connectTimeoutMs = UPSTREAM_CONNECT_TIMEOUT_MS,
  network = {},
  onNetworkProxyUnreachable = null,
  onUnrestorable = recordUnrestorable,
  onMaskedVault,
}) {
  const state = {
    resolveUpstream,
    route,
    handleRequest,
    onInactive,
    connectTimeoutMs,
    onNetworkProxyUnreachable,
    onUnrestorable,
    currentNetwork: network,
    upstreamClient: createUpstreamClient(network, { connectTimeoutMs }),
    inactiveNoticeSent: false,
    bodyMasker: createBodyMasker({ onMaskedVault }),
    server: null,
  };
  state.server = http.createServer((req, res) => {
    try {
      handleProxyRequest(state, req, res);
    } catch (error) {
      try {
        sendError(res, 400, 'invalid_request_error', error.message);
      } catch {
        res.destroy();
      }
    }
  });
  attachServerEvents(state);
  return state.server;
}

export function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}
