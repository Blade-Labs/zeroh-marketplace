// SPDX-License-Identifier: AGPL-3.0-only

// Request-body decoding, structured masking and typed-mask notes.
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { isVaultError, Vault } from '../zeroh-disclosure-core/vault.js';
import {
  maskRestorably,
  UNSAVEABLE_REASON,
} from '../zeroh-disclosure-core/restorable.js';
import { recordUnchecked } from '../zeroh-disclosure-core/unchecked.js';
import { loadKnownSecrets, scrubDeep } from '../shell-analysis/secrets.js';
import {
  isSecretType,
  tokenType,
} from '../zeroh-disclosure-core/data-kinds.js';
import { activeGrants } from '../zeroh-disclosure-core/unmask.js';
import { providerLabel, TOKEN_RE } from '../zeroh-disclosure-core/detector.js';

const MAX_SCRUB_STRING = 16 * 1024 * 1024;
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

// Fields of a block that hold a tool's own data (tool_use, server_tool_use,
// mcp_tool_use `input`; Responses API `arguments`): no structural exemption
// applies inside them.
const TOOL_DATA_KEYS = new Set(['input', 'arguments']);

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
function sourceOptions(opts) {
  const typedOpts = {
    channel: 'prose',
    context: 'prose',
    ...opts,
    findingSource: opts.findingSource ?? 'prompt',
  };
  const toolOpts = {
    ...opts,
    channel: 'prose',
    context: 'mixed',
    profile: opts.toolProfile ?? 'tool',
    findingSource: 'detected',
  };
  return { typedOpts, toolOpts };
}

export function scrubBody(json, opts, acc = []) {
  // Typed text gets the caller's profile (the full prompt rules by default).
  // Tool results and the system prompt hold code, logs and CLAUDE.md, so they
  // use the tool profile, whose looser person-name rules would misfire there.
  // Typed values are recorded with source 'prompt' so the vault keeps matching
  // them exactly wherever they come back.
  const { typedOpts, toolOpts } = sourceOptions(opts);
  const scrubWith = (value, o) => {
    if (value.length > MAX_SCRUB_STRING) {
      throw new Error('a text field is too large to inspect');
    }
    // A retired daemon (knownValueMasker) only replaces what it masked
    // before; it detects nothing new.
    if (o.replaceText) return o.replaceText(value);
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
  // binary sources and signed thinking unchanged. Those exemptions hold for
  // the protocol envelope only (blocks, messages, sources). A tool's `input`
  // is the tool's own data, where `name`, `id` or `signature` are ordinary
  // fields that may hold a value restored for that tool: it is masked
  // throughout, with no exempt key (Astra finding 8).
  function scrubGeneric(value, scrubText) {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) {
      return value.map((entry) => scrubGeneric(entry, scrubText));
    }
    if (!value || typeof value !== 'object') return value;
    if (isThinking(value)) return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (TOOL_DATA_KEYS.has(key)) out[key] = scrubData(child, scrubText);
      else if (STRUCTURAL_KEYS.has(key)) out[key] = child;
      else if (key === 'source') out[key] = scrubSource(child, scrubText);
      else out[key] = scrubGeneric(child, scrubText);
    }
    return out;
  }

  function scrubData(value, scrubText) {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) {
      return value.map((entry) => scrubData(entry, scrubText));
    }
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = scrubData(child, scrubText);
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
    // Responses API items without a role: tool results, and the model's own
    // tool calls (whose arguments hold restored values). Reasoning items are
    // provider-encrypted and pass unchanged.
    if (typeof message.type === 'string' && message.type !== 'reasoning') {
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
// prefix catalog and rule names in packages/zeroh-disclosure-core/detector.js, never from the value.
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

// What a retired daemon masks with, and the read-only fallback vault of a
// failed save: packages/zeroh-disclosure-core/restorable.js.

// Per-server request-body masking state. Typed-note memory contains hashes,
// never values, and is shared across retries and later turns on this server.
export function createBodyMasker({ onMaskedVault = () => {} } = {}) {
  const typedNoteMemory = new Set();

  function maskKnown(req, body, masker) {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('json')) return { body, masked: false };
    const json = JSON.parse(
      decode(body, req.headers['content-encoding']).toString('utf8'),
    );
    const out = scrubBody(json, {
      replaceText: masker.replaceText,
      vault: masker.vault,
      typedNoteMemory,
    });
    return { body: Buffer.from(JSON.stringify(out), 'utf8'), masked: true };
  }

  function maskBody(
    req,
    body,
    requestRoot,
    encoding = req.headers['content-encoding'],
  ) {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('json')) {
      const error = new Error('ZeroH proxy forwards only JSON request bodies');
      error.status = 415;
      error.type = 'invalid_request_error';
      throw error;
    }
    const json = JSON.parse(decode(body, encoding).toString('utf8'));
    let vault;
    try {
      vault = new Vault(requestRoot);
    } catch (error) {
      if (!isVaultError(error)) throw error;
      return { body: Buffer.from(JSON.stringify(json), 'utf8'), masked: true };
    }
    const sessionId = String(req.headers['x-claude-code-session-id'] || '');
    const grants = sessionId ? activeGrants(requestRoot, { sessionId }) : [];
    const known = loadKnownSecrets(requestRoot);
    const unmaskedTypes = grants.map(({ kind }) => kind);
    const { result: out, restorable } = maskRestorably(
      vault,
      (maskWith) =>
        scrubBody(json, {
          vault: maskWith,
          known,
          profile: 'prompt',
          unmaskedTypes,
          typedNoteMemory,
        }),
      'ZeroH proxy',
    );
    if (restorable) onMaskedVault(requestRoot, vault);
    return {
      body: Buffer.from(JSON.stringify(out), 'utf8'),
      masked: true,
      unrestorable: !restorable,
    };
  }

  function maskBodyWith(req, body, roots) {
    let out = body;
    let encoding = req.headers['content-encoding'];
    const unrestorable = [];
    for (const root of roots) {
      const masked = maskBody(req, out, root, encoding);
      out = masked.body;
      if (masked.unrestorable) unrestorable.push(root);
      encoding = 'identity';
    }
    return { body: out, masked: true, unrestorable };
  }

  return { maskBodyWith, maskKnown };
}

// The default onUnrestorable: one `vault-unsaveable` pass per project on the
// session's current turn, its line left for the turn's Stop.
export async function recordUnrestorable({ roots, sessionId }) {
  if (!sessionId) return;
  for (const root of roots) {
    await recordUnchecked({
      reason: UNSAVEABLE_REASON,
      tool: 'proxy',
      cwd: root,
      sessionId,
      subject: 'model request',
      deferNotice: true,
    });
  }
}

// What a retired daemon masks with, and the read-only fallback vault of a
// failed save: packages/zeroh-disclosure-core/restorable.js.
export { knownValueMasker } from '../zeroh-disclosure-core/restorable.js';
