// SPDX-License-Identifier: AGPL-3.0-only

// Local masking proxy. Claude Code (ANTHROPIC_BASE_URL) sends every request
// here; user and tool-result text is masked with the session's project vault
// before it is forwarded. Provider-signed and cacheable metadata stays
// unchanged. Responses pass through unchanged: real values come back only
// through the hooks, which check destinations. Node built-ins only.
import { createHash } from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import { isLoopbackHost } from './loopback.js';
import {
  createUpstreamClient,
  networkProxyUnreachable,
  transientNetworkError,
} from './network.js';
import { isVaultError, saveQuietly, Vault, vaultProblem } from './vault.js';
import { loadKnownSecrets, scrubDeep } from './secrets.js';
import { isSecretType, tokenType } from './data-kinds.js';
import { activeGrants } from './unmask.js';
import { providerLabel, TOKEN_RE } from './detector.js';
import { DOCTOR_FIX, PROXY_OFF } from './fix-command.js';

// Text larger than this is refused rather than forwarded unscrubbed.
const MAX_SCRUB_STRING = 16 * 1024 * 1024;
const MAX_BODY_BYTES = 256 * 1024 * 1024;
const NOTE_LIST_LIMIT = 5;
const NOTE_MEMORY_LIMIT = 2000;
const REMINDER_RE = /^\s*<system-reminder>/;

function decode(buf, encoding) {
  switch ((encoding || 'identity').toLowerCase()) {
    case 'identity':
      return buf;
    case 'gzip':
      return zlib.gunzipSync(buf);
    case 'deflate':
      return zlib.inflateSync(buf);
    case 'br':
      return zlib.brotliDecompressSync(buf);
    case 'zstd':
      if (zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buf);
      throw new Error('zstd request bodies need Node 22.15 or later');
    default:
      throw new Error(`unsupported content-encoding ${encoding}`);
  }
}

const TEXT_BLOCK_TYPES = new Set(['text', 'input_text', 'output_text']);
// Structural fields: identifiers and media types, never free text.
const STRUCTURAL_KEYS = new Set([
  'type',
  'id',
  'tool_use_id',
  'media_type',
  'signature',
  'cache_control',
  'role',
  'name',
  'call_id',
  'encrypted_content',
  'encrypted_index',
]);

function isThinking(value) {
  return value?.type === 'thinking' || value?.type === 'redacted_thinking';
}

// Every text field of a request is masked; nothing is forwarded raw:
// - user text and typed strings use the caller's (prompt) profile;
// - tool results, documents, the system prompt and assistant turns (model
//   output, often holding command output or restored tool input) use the tool
//   profile;
// - base64 media is binary and passes as it is, except text/* documents,
//   which are decoded, masked and encoded again;
// - thinking blocks are provider-signed and pass unchanged.
// A string too large to inspect makes the whole request fail instead.
export function scrubBody(json, opts, acc = []) {
  // Typed text gets the caller's profile (the full prompt rules by default).
  // Tool results and the system prompt hold code, logs and CLAUDE.md, so they
  // use the tool profile, whose looser person-name rules would misfire there.
  // Typed values are recorded with source 'prompt' so the vault keeps matching
  // them exactly wherever they come back.
  const typedOpts = { ...opts, findingSource: opts.findingSource ?? 'prompt' };
  const toolOpts = {
    ...opts,
    profile: opts.toolProfile ?? 'tool',
    findingSource: 'detected',
  };
  const scrubWith = (value, o) => {
    if (value.length > MAX_SCRUB_STRING) {
      throw new Error('a text field is too large to inspect');
    }
    return scrubDeep(value, o, acc);
  };
  const scrubString = (value) => scrubWith(value, typedOpts);
  const scrubToolString = (value) => scrubWith(value, toolOpts);

  const scrubSource = (source, scrubText) => {
    if (!source || typeof source !== 'object') return source;
    if (source.type === 'base64') {
      if (
        typeof source.data === 'string' &&
        /^text\//iu.test(String(source.media_type || ''))
      ) {
        const text = Buffer.from(source.data, 'base64').toString('utf8');
        return {
          ...source,
          data: Buffer.from(scrubText(text), 'utf8').toString('base64'),
        };
      }
      return source;
    }
    if (source.type === 'text' && typeof source.data === 'string') {
      return { ...source, data: scrubText(source.data) };
    }
    if (source.type === 'content') {
      return { ...source, content: scrubGeneric(source.content, scrubText) };
    }
    if (source.type === 'url' || source.type === 'file') return source;
    return scrubGeneric(source, scrubText);
  };

  // Deep masking of every free-text string, keeping structural fields,
  // binary sources and signed thinking unchanged.
  function scrubGeneric(value, scrubText) {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) {
      return value.map((entry) => scrubGeneric(entry, scrubText));
    }
    if (!value || typeof value !== 'object') return value;
    if (isThinking(value)) return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (STRUCTURAL_KEYS.has(key)) out[key] = child;
      else if (key === 'source') out[key] = scrubSource(child, scrubText);
      else out[key] = scrubGeneric(child, scrubText);
    }
    return out;
  }

  const scrubToolResult = (value) => scrubGeneric(value, scrubToolString);

  const scrubUserContent = (content) => {
    if (typeof content === 'string') return scrubString(content);
    if (!Array.isArray(content)) return scrubGeneric(content, scrubString);
    return content.map((block) => {
      if (!block || typeof block !== 'object') return block;
      if (isThinking(block)) return block;
      if (block.type === 'tool_result') {
        return { ...block, content: scrubToolResult(block.content) };
      }
      if (typeof block.text === 'string' && TEXT_BLOCK_TYPES.has(block.type)) {
        return { ...block, text: scrubString(block.text) };
      }
      // Documents, search results and any other block: tool rules, since
      // their text comes from files and services, not from the user.
      return scrubGeneric(block, scrubToolString);
    });
  };

  const scrubAssistantContent = (content) =>
    scrubGeneric(content, scrubToolString);

  const scrubSystem = (system) => scrubGeneric(system, scrubToolString);

  const scrubMessage = (message) => {
    if (!message || typeof message !== 'object') return message;
    if (message.role === 'user') {
      return { ...message, content: scrubUserContent(message.content) };
    }
    if (message.role === 'tool') {
      return { ...message, content: scrubToolResult(message.content) };
    }
    if (message.role === 'assistant') {
      return { ...message, content: scrubAssistantContent(message.content) };
    }
    if (
      message.type === 'tool_result' ||
      message.type === 'function_call_output'
    ) {
      return scrubToolResult(message);
    }
    return message;
  };

  const out = { ...json };
  if (Object.hasOwn(json, 'system')) out.system = scrubSystem(json.system);
  if (Object.hasOwn(json, 'instructions')) {
    out.instructions = scrubSystem(json.instructions);
  }
  if (Array.isArray(json.messages)) {
    out.messages = json.messages.map(scrubMessage);
    addTypedNotes(json.messages, out.messages, opts);
  }
  if (Array.isArray(json.input)) {
    out.input = json.input.map(scrubMessage);
    addTypedNotes(json.input, out.input, opts);
  } else if (typeof json.input === 'string')
    out.input = scrubString(json.input);
  return out;
}

// The text blocks of a user message that the user typed: the whole string, or
// every text block except the <system-reminder> blocks Claude Code adds.
function typedTexts(message) {
  if (!message || typeof message !== 'object' || message.role !== 'user') {
    return [];
  }
  if (typeof message.content === 'string') return [message.content];
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter(
      (block) =>
        block &&
        typeof block === 'object' &&
        ['text', 'input_text'].includes(block.type) &&
        typeof block.text === 'string' &&
        !REMINDER_RE.test(block.text),
    )
    .map((block) => block.text);
}

function tokensIn(text) {
  return String(text).match(TOKEN_RE) || [];
}

function withArticle(label) {
  return /^(?:[aeiou]|npm\b)/iu.test(label) ? `an ${label}` : `a ${label}`;
}

// One note for the tokens that replaced values the user typed in one message.
// It names each token and its kind; provider names come only from the fixed
// prefix catalog and rule names in lib/detector.js, never from the value.
export function typedMaskNote(tokens, { labelFor = () => null } = {}) {
  const unique = [...new Set(tokens)];
  if (!unique.length) return null;
  const listed = unique.slice(0, NOTE_LIST_LIMIT).map((token) => {
    const label = labelFor(token);
    return `${token} is ${label ? withArticle(label) : `a value of type ${tokenType(token)}`}`;
  });
  const more = unique.length - listed.length;
  const first = unique[0];
  const count = `${unique.length} ${unique.length === 1 ? 'value' : 'values'}`;
  return `(ZeroH Disclosure masked ${count} the user typed: ${listed.join('; ')}${more > 0 ? `; and ${more} more` : ''}. The user's screen shows the real value wherever you write ${first}; to name the token itself, write ⟦${first.slice(1, -1)}⟧.)`;
}

function labelFromVault(vault) {
  return (token) => {
    if (!isSecretType(tokenType(token))) return null;
    try {
      return providerLabel(vault?.valueOf?.(token));
    } catch {
      return null;
    }
  };
}

function appendNote(message, note) {
  if (typeof message.content === 'string') {
    return message.content.endsWith(note)
      ? message
      : { ...message, content: `${message.content}\n\n${note}` };
  }
  let last = -1;
  message.content.forEach((block, index) => {
    if (typedTexts({ role: 'user', content: [block] }).length) last = index;
  });
  if (last < 0 || message.content[last].text.endsWith(note)) return message;
  const content = [...message.content];
  content[last] = {
    ...content[last],
    text: `${content[last].text}\n\n${note}`,
  };
  return { ...message, content };
}

// Adds one note to the latest message the user typed when the proxy masked
// values in it. The note is a pure function of the masked message, and a
// message noted once keeps its note whenever the same history is sent again,
// so retries and later turns stay byte-identical for prompt caching.
function addTypedNotes(originals, scrubbed, opts) {
  let latest = -1;
  for (let index = originals.length - 1; index >= 0; index -= 1) {
    if (typedTexts(originals[index]).length) {
      latest = index;
      break;
    }
  }
  if (latest < 0) return;
  const memory = opts.typedNoteMemory ?? null;
  const labelFor = labelFromVault(opts.vault);
  for (let index = 0; index <= latest; index += 1) {
    const texts = typedTexts(scrubbed[index]);
    if (!texts.length) continue;
    const before = new Set(typedTexts(originals[index]).flatMap(tokensIn));
    const masked = texts.flatMap(tokensIn).filter((t) => !before.has(t));
    if (!masked.length) continue;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(texts))
      .digest('hex');
    if (index !== latest && !memory?.has(fingerprint)) continue;
    const note = typedMaskNote(masked, { labelFor });
    scrubbed[index] = appendNote(scrubbed[index], note);
    if (index === latest && memory && !memory.has(fingerprint)) {
      memory.add(fingerprint);
      if (memory.size > NOTE_MEMORY_LIMIT) {
        memory.delete(memory.values().next().value);
      }
    }
  }
}

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
  noRoute: `ZeroH Disclosure: a Claude Code session that ZeroH Disclosure does not run in (the plugin is disabled in that project, or removed) still uses the local proxy through your Claude Code settings; its requests pass through without masking. Run ${PROXY_OFF()} to stop using the proxy.`,
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
//   project's vault ({ roots } with each in turn); { action: 'pass',
//   notice?, quiet? } forwards unchanged.
// - handleRequest(req, res): the owner's own endpoints; true when handled.
export function createMaskingProxy({
  resolveUpstream,
  route,
  handleRequest = null,
  onInactive = (message) => process.stderr.write(`${message}\n`),
  connectTimeoutMs = UPSTREAM_CONNECT_TIMEOUT_MS,
  // The user's network proxy and extra CAs (lib/network.js).
  network = {},
  // Called when the network proxy itself can't be reached; the owner may
  // switch networks with server.useNetwork().
  onNetworkProxyUnreachable = null,
}) {
  let currentNetwork = network;
  let upstreamClient = createUpstreamClient(network, { connectTimeoutMs });
  let inactiveNoticeSent = false;
  // Typed messages that received a mask note, by masked-text fingerprint; it
  // holds token text hashes only, never values.
  const typedNoteMemory = new Set();

  function resolveRequest(req) {
    const target = parseProxyTarget(req.url);
    // Only an upstream its owner names (the daemon always names one).
    const resolved = resolveUpstream(target.key);
    if (!resolved) {
      throw new ProxyRequestError(
        403,
        'permission_error',
        MESSAGES.upstreamOnly,
      );
    }
    const up = new URL(resolved);
    // A record never names the proxy itself (checked when it is written);
    // this is the request-time backstop.
    const port = server.address()?.port;
    if (port && isProxyLoop(up.href, { port })) {
      throw new ProxyRequestError(400, 'invalid_request_error', MESSAGES.loop);
    }
    return { up, target: upstreamTarget(up.href, target) };
  }

  // Masks with each project's vault in turn: one for a registered session;
  // every live project for a request no session claims (LP-B5).
  function maskBodyWith(req, body, roots) {
    let out = body;
    let encoding = req.headers['content-encoding'];
    for (const root of roots) {
      out = maskBody(req, out, root, encoding).body;
      encoding = 'identity';
    }
    return { body: out, masked: true };
  }

  function maskBody(
    req,
    body,
    requestRoot,
    encoding = req.headers['content-encoding'],
  ) {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('json')) {
      throw new ProxyRequestError(
        415,
        'invalid_request_error',
        MESSAGES.jsonOnly,
      );
    }
    const json = JSON.parse(decode(body, encoding).toString('utf8'));
    const vault = new Vault(requestRoot);
    // Unmask grants belong to one Claude session: the one in the header.
    const sessionId = String(req.headers['x-claude-code-session-id'] || '');
    const grants = sessionId ? activeGrants(requestRoot, { sessionId }) : [];
    const acc = [];
    const out = scrubBody(
      json,
      {
        vault,
        known: loadKnownSecrets(requestRoot),
        profile: 'prompt',
        unmaskedTypes: grants.map(({ kind }) => kind),
        typedNoteMemory,
      },
      acc,
    );
    // Masking already happened; a lock timeout or write failure is logged,
    // never turned into a failed request. Only a token conflict (a token
    // another writer holds for a different value) refuses it.
    saveQuietly(vault, 'ZeroH proxy');
    return { body: Buffer.from(JSON.stringify(out), 'utf8'), masked: true };
  }

  function forward(
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
      headers['content-length'] = String(body.length);
    }
    let connectTimer = null;
    const upReq = upstreamClient.request(
      target,
      { method: req.method, headers },
      (upRes) => {
        clearTimeout(connectTimer);
        if (firstInactive) {
          res.setHeader('x-zeroh-disclosure', 'passthrough-plugin-inactive');
        }
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
        // An upstream reset mid-stream must end the client's response too.
        upRes.on('aborted', () => res.destroy());
        upRes.on('error', () => res.destroy());
      },
    );
    // The client went away (Esc): stop the upstream generation as well.
    res.on('close', () => {
      if (!res.writableFinished) upReq.destroy();
    });
    // Only the connection is timed: a long generation is not an error.
    upReq.on('socket', (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(() => {
        const error = new Error('connect timeout');
        error.code = 'ETIMEDOUT';
        upReq.destroy(error);
      }, connectTimeoutMs);
      connectTimer.unref?.();
      socket.once(
        target.protocol === 'https:' ? 'secureConnect' : 'connect',
        () => clearTimeout(connectTimer),
      );
    });
    upReq.on('error', (e) => {
      clearTimeout(connectTimer);
      // A kept-alive connection that went stale (sleep, a network change)
      // fails before any answer: send the buffered body once more.
      if (
        !retried &&
        upReq.reusedSocket &&
        !res.headersSent &&
        ['ECONNRESET', 'EPIPE'].includes(e?.code)
      ) {
        forward(req, res, { up, target }, body, masked, firstInactive, true);
        return;
      }
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (networkProxyUnreachable(target, currentNetwork, e)) {
        onNetworkProxyUnreachable?.(e);
      }
      const failure = upstreamFailure(up.href, e);
      sendError(res, failure.status, failure.type, failure.message, {
        retry: failure.retry,
      });
    });
    upReq.end(body);
  }

  function handle(req, res) {
    if (handleRequest?.(req, res)) return;
    let resolved;
    try {
      resolved = resolveRequest(req);
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
        if (tooLarge) {
          sendError(res, 413, 'request_too_large', MESSAGES.tooLarge);
          return;
        }
        let body = Buffer.concat(chunks);
        const decision = route(req, { hasBody: body.length > 0 }) || {
          action: 'pass',
        };
        let masked = false;
        let firstInactive = false;
        if (decision.action === 'mask') {
          if (body.length) {
            try {
              ({ body, masked } = maskBodyWith(
                req,
                body,
                decision.roots ?? [decision.root],
              ));
            } catch (e) {
              // Never forward a body we could not inspect.
              sendError(
                res,
                e.status && e.status < 500 ? e.status : 400,
                e.type || 'invalid_request_error',
                isVaultError(e)
                  ? MESSAGES.vault(vaultProblem(e))
                  : MESSAGES.notInspected(e.message),
              );
              return;
            }
          }
        } else if (!decision.quiet && !inactiveNoticeSent) {
          inactiveNoticeSent = true;
          firstInactive = true;
          onInactive?.(decision.notice || MESSAGES.noRoute);
        }
        forward(req, res, resolved, body, masked, firstInactive);
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

  const server = http.createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      // One malformed request never takes the proxy down.
      try {
        sendError(res, 400, 'invalid_request_error', error.message);
      } catch {
        res.destroy();
      }
    }
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });
  // WebSocket upgrades carry frames we do not inspect: refuse them so clients
  // fall back to HTTP, which we do.
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('close', () => upstreamClient.destroy());
  // New requests go out through `next`; open ones finish on the old agents.
  server.useNetwork = (next) => {
    const previous = upstreamClient;
    currentNetwork = next;
    upstreamClient = createUpstreamClient(next, { connectTimeoutMs });
    setTimeout(() => previous.destroy(), 60_000).unref?.();
  };
  return server;
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
