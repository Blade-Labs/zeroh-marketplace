// SPDX-License-Identifier: AGPL-3.0-only

// Known secrets, scrubbing, restoring and destination checks. Node built-ins only.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectSensitiveData,
  looksLikeCodeValue,
  nameType,
} from './detector.js';
import { isLoopbackHost } from './loopback.js';
import { NAMED_TOKEN_RE, TOKEN_RE } from './token-pattern.js';
export { loadAllowRules } from './allow-rules.js';

const SECRET_NAME_RE =
  /(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_?KEY|APIKEY|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_SECRET|AUTH_?KEY|CREDENTIALS?|_DSN$|DATABASE_URL|CONNECTION_STRING|_PAT$|WEBHOOK_URL|_KEY$|^KEY$)/i;
const NON_SECRET_NAME_RE =
  /(?:_PATH|_DIR|_PREFIX|_SUFFIX|_TIMEOUT(?:_MS|_SECONDS)?|_TTL|_SCOPE|_HEADER|_NAME|_ID|_REGION|_ENDPOINT|MAX_\w*TOKENS?|_TOKENS|PUBLIC_?KEY|_ICON_KEY|_KEY_ID|TOKEN_TYPE|_LENGTH|_SIZE|_COUNT|_ENABLED|_MODE|_VERSION|_HOST|_PORT)$/i;
const PLACEHOLDER_RE =
  /^(?:\$\{?[\w.-]+\}?|<[^>]*>|x{3,}|\*{3,}|changeme|your[-_].*|example|placeholder|todo|null|none|true|false|undefined|redacted|test|dev|\.\.\.)$/i;
const ANTHROPIC_CREDENTIAL_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
]);
// Env vars Claude Code or the OS sets that look secret-shaped but are ours to keep.
const IGNORED_ENV = new Set([
  'ANTHROPIC_BASE_URL',
  ...ANTHROPIC_CREDENTIAL_ENV,
  'ZEROH_HOME',
  'CLAUDE_CODE_ENTRYPOINT',
  'GPG_AGENT_INFO',
]);

export function isAnthropicCredentialEnvName(name) {
  return ANTHROPIC_CREDENTIAL_ENV.has(String(name).toUpperCase());
}

function isSecretName(name) {
  return SECRET_NAME_RE.test(name) && !NON_SECRET_NAME_RE.test(name);
}

function typeForName(name) {
  const n = name.toUpperCase();
  if (/DATABASE_URL|_DSN$|CONNECTION_STRING/.test(n)) return 'PASSWORD';
  if (/WEBHOOK_URL/.test(n)) return 'SECRET';
  return nameType(n);
}

function parseDotenv(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/,
    );
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out.push([m[1], value]);
  }
  return out;
}

function stringLeaves(node, acc = []) {
  if (typeof node === 'string') acc.push(node);
  else if (Array.isArray(node)) node.forEach((v) => stringLeaves(v, acc));
  else if (node && typeof node === 'object')
    Object.values(node).forEach((v) => stringLeaves(v, acc));
  return acc;
}

// Expand one NAME=value into the concrete secret strings to match.
function secretValues(name, value, root) {
  if (!value || PLACEHOLDER_RE.test(value)) return [];
  if (/_FILE$/i.test(name)) {
    const p = path.resolve(root, value);
    try {
      if (existsSync(p) && statSync(p).size <= 64 * 1024) {
        const content = readFileSync(p, 'utf8').trim();
        return content.length >= 8 ? [content] : [];
      }
    } catch {
      /* unreadable pointer: nothing to match */
    }
    return [];
  }
  if (/^[[{]/.test(value)) {
    try {
      return stringLeaves(JSON.parse(value)).filter(
        (s) => s.length >= 8 && !PLACEHOLDER_RE.test(s),
      );
    } catch {
      /* not JSON: treat as a plain value */
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      const secrets = [];
      if (u.password) secrets.push(decodeURIComponent(u.password));
      for (const [k, v] of u.searchParams)
        if (isSecretName(k) && v.length >= 8) secrets.push(v);
      if (/WEBHOOK_URL/i.test(name)) secrets.push(value);
      return secrets.filter((s) => s.length >= 4);
    } catch {
      return [];
    }
  }
  const min = /PASSWORD|PASSWD|PASSPHRASE/i.test(name) ? 6 : 8;
  return value.length >= min ? [value] : [];
}

function dotenvFiles(root) {
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  return names
    .filter(
      (n) =>
        /^\.env(?:\.[\w.-]+)?$/.test(n) &&
        !/\.(?:example|sample|template|dist|defaults)$/.test(n),
    )
    .map((n) => path.join(root, n));
}

const CREDENTIAL_FILE_LIMIT = 256 * 1024;

function inside(root, candidate) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const base = normalize(root);
  const target = normalize(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function readCredentialFile(file, allowedRoot) {
  try {
    const direct = lstatSync(file);
    if (!direct.isFile() || direct.size > CREDENTIAL_FILE_LIMIT) return null;
    const resolved = realpathSync(file);
    if (!inside(allowedRoot, resolved)) return null;
    const resolvedStat = statSync(resolved);
    if (!resolvedStat.isFile() || resolvedStat.size > CREDENTIAL_FILE_LIMIT)
      return null;
    return readFileSync(resolved, 'utf8');
  } catch {
    return null;
  }
}

function iniValues(text, wanted) {
  const values = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const match = line.match(/^([^=:#]+)\s*[=:]\s*(.*?)\s*$/u);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    if (wanted.has(key)) values.push([key, match[2]]);
  }
  return values;
}

function credentialFiles({ root, home, env }) {
  const files = [];
  const addIni = (relative, names, prefix) => {
    const file = path.join(home, relative);
    const text = readCredentialFile(file, home);
    if (!text) return;
    for (const [name, value] of iniValues(text, new Set(names))) {
      files.push({
        name: `${prefix}_${name}`.toUpperCase().replace(/[^A-Z0-9]+/gu, '_'),
        value,
        source: relative.replace(/\\/gu, '/'),
      });
    }
  };

  addIni(
    path.join('.aws', 'credentials'),
    ['aws_access_key_id', 'aws_secret_access_key', 'aws_session_token'],
    'AWS',
  );
  addIni('.pypirc', ['password'], 'PYPIRC');

  const ghFile =
    process.platform === 'win32'
      ? path.join(
          env.APPDATA || path.join(home, 'AppData', 'Roaming'),
          'GitHub CLI',
          'hosts.yml',
        )
      : path.join(home, '.config', 'gh', 'hosts.yml');
  const ghText = readCredentialFile(ghFile, home);
  if (ghText) {
    for (const match of ghText.matchAll(
      /^\s*oauth_token\s*:\s*["']?([^\s"'#]+)["']?/gmu,
    )) {
      files.push({
        name: 'GH_OAUTH_TOKEN',
        value: match[1],
        source: 'gh/hosts.yml',
      });
    }
  }

  const npmFiles = [
    [path.join(home, '.npmrc'), home, '~/.npmrc'],
    [path.join(root, '.npmrc'), root, '.npmrc'],
  ];
  for (const [file, allowedRoot, source] of npmFiles) {
    const text = readCredentialFile(file, allowedRoot);
    if (!text) continue;
    for (const raw of text.split(/\r?\n/u)) {
      const match = raw.match(
        /(?:^|:)_(authToken|auth)\s*=\s*["']?([^\s"'#]+)["']?/iu,
      );
      if (match) {
        files.push({
          name:
            match[1].toLowerCase() === 'auth' ? 'NPM_AUTH' : 'NPM_AUTH_TOKEN',
          value: match[2],
          source,
        });
      }
    }
  }

  const netrcName = process.platform === 'win32' ? '_netrc' : '.netrc';
  const netrc = readCredentialFile(path.join(home, netrcName), home);
  if (netrc) {
    const tokens =
      netrc.replace(/#.*$/gmu, '').match(/"[^"]*"|'[^']*'|\S+/gu) ?? [];
    let machine = 'default';
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index].replace(/^["']|["']$/gu, '');
      if (token === 'machine' && tokens[index + 1]) {
        machine = tokens[++index].replace(/^["']|["']$/gu, '');
      } else if (token === 'password' && tokens[index + 1]) {
        files.push({
          name: `NETRC_${machine}_PASSWORD`
            .toUpperCase()
            .replace(/[^A-Z0-9]+/gu, '_'),
          value: tokens[++index].replace(/^["']|["']$/gu, ''),
          source: netrcName,
        });
      }
    }
  }

  const gitCredentials = readCredentialFile(
    path.join(home, '.git-credentials'),
    home,
  );
  if (gitCredentials) {
    for (const line of gitCredentials.split(/\r?\n/u)) {
      try {
        const credential = new URL(line.trim());
        if (!credential.password) continue;
        files.push({
          name: `GIT_${credential.hostname}_PASSWORD`
            .toUpperCase()
            .replace(/[^A-Z0-9]+/gu, '_'),
          value: decodeURIComponent(credential.password),
          source: '.git-credentials',
        });
      } catch {
        // Ignore malformed credential lines.
      }
    }
  }

  const docker = readCredentialFile(
    path.join(home, '.docker', 'config.json'),
    home,
  );
  if (docker) {
    try {
      const parsed = JSON.parse(docker);
      for (const [host, auth] of Object.entries(parsed.auths ?? {})) {
        if (typeof auth?.auth !== 'string') continue;
        const decoded = Buffer.from(auth.auth, 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        if (colon === -1 || !decoded.slice(colon + 1)) continue;
        files.push({
          name: `DOCKER_${host}_PASSWORD`
            .toUpperCase()
            .replace(/[^A-Z0-9]+/gu, '_'),
          value: decoded.slice(colon + 1),
          source: '.docker/config.json',
        });
      }
    } catch {
      // Ignore malformed Docker configuration.
    }
  }
  return files;
}

// Every secret this project and this process know about, with its source name.
export function loadKnownSecrets(
  root = process.cwd(),
  env = process.env,
  { home = env.ZEROH_CREDENTIAL_HOME || os.homedir() } = {},
) {
  const found = new Map();
  const add = (name, value, source) => {
    for (const v of secretValues(name, value, root)) {
      if (found.has(v)) continue;
      // A value the detector recognises keeps the detector's type, so the same
      // key gets the same token whether it arrives from .env or from output.
      const detected = detectSensitiveData(v, { profile: 'secrets' }).find(
        (f) => f.start === 0 && f.end === v.length,
      );
      found.set(v, {
        name,
        value: v,
        type: detected?.type ?? typeForName(name),
        source,
      });
    }
  };
  for (const file of dotenvFiles(root)) {
    let pairs = [];
    try {
      pairs = parseDotenv(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [name, value] of pairs) {
      if (isSecretName(name)) add(name, value, path.basename(file));
      else if (detectSensitiveData(value, { profile: 'secrets' }).length)
        add(name, value, path.basename(file));
    }
  }
  for (const credential of credentialFiles({ root, home, env })) {
    add(credential.name, credential.value, credential.source);
  }
  for (const name of Object.keys(env)) {
    if (isAnthropicCredentialEnvName(name) || name.startsWith('ZEROH_'))
      continue;
    const value = env[name];
    if (isSecretName(name)) add(name, value, 'env');
  }
  return [...found.values()];
}

// Encoded forms a command could print. Each maps to its own token so a restore
// puts back exactly the form that was masked.
function variants(secret) {
  const out = [];
  const b64 = Buffer.from(secret.value, 'utf8').toString('base64');
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hex = Buffer.from(secret.value, 'utf8').toString('hex');
  const url = encodeURIComponent(secret.value);
  if (b64.length >= 12)
    out.push({ value: b64, type: `${secret.type}_ENCODED` });
  if (b64url !== b64 && b64url.length >= 12)
    out.push({ value: b64url, type: `${secret.type}_ENCODED` });
  if (hex.length >= 16) out.push({ value: hex, type: `${secret.type}_HEX` });
  if (url !== secret.value) out.push({ value: url, type: secret.type });
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- exact values ------------------------------------------------------------
//
// Every live vault value is matched exactly in new text, whatever its source
// (known, detected from context, typed, reported), together with its encoded
// forms. A value masked once because of its surroundings (`db_password = …`,
// a Bearer header) stays masked when it comes back bare: printed by a
// late-bound command, written into a file and read again, or pasted.

const EXACT_KEY = 4; // bucket key length; also the shortest value matched
const MIN_VAULT_EXACT = 6; // vault-only values shorter than this are too common
const MAX_VARIANT_SOURCE = 4096; // no encodings of whole files
// 0.x masked tool output with the loose typed-prompt rules, so a vault can hold
// digit runs as detected PHONE_NUMBER, QATAR_ID or ACCOUNT_NUMBER entries. Tool
// output is never detected with those rules now; exact-matching the leftovers
// would bring that mangling back. Vaults written before 1.0 also hold PERSON
// entries from the removed capitalised-words rule ("Getting Started"), under
// any channel source; a PERSON value is matched exactly only when the user
// reported it.
const LOOSE_TYPES = new Set(['QATAR_ID', 'ACCOUNT_NUMBER']);

function baseType(type) {
  return String(type).replace(/_(?:ENCODED|HEX)$/u, '');
}

function exactFromVault(entry) {
  const value = entry.value;
  if (typeof value !== 'string' || value.length < MIN_VAULT_EXACT) return false;
  const source = entry.source ?? 'detected';
  if (entry.type === 'PERSON' && !source.startsWith('reported:')) return false;
  if (source === 'detected') {
    if (LOOSE_TYPES.has(entry.type)) return false;
    // A key-name finding from before 1.0 that was code (`API_KEY`,
    // `CSSToken`, `process.env.X!`): matching it would mask identifiers.
    if (looksLikeCodeValue(value)) return false;
    if (entry.type === 'PHONE_NUMBER' && !value.trim().startsWith('+'))
      return false;
  }
  return true;
}

// A value found by its surroundings (not a `.env` or credential-file value,
// nor an encoded form) matches only as a whole word: `hunter2abc` in
// `pw=hunter2abc`, not inside `hunter2abcdef` or `MY_hunter2abc`.
const WORD_CHAR = /[A-Za-z0-9_$]/u;

function atWordBoundaries(text, start, end) {
  const first = text[start];
  const last = text[end - 1];
  if (WORD_CHAR.test(first) && start > 0 && WORD_CHAR.test(text[start - 1]))
    return false;
  if (WORD_CHAR.test(last) && end < text.length && WORD_CHAR.test(text[end]))
    return false;
  return true;
}

function boundedCandidate(candidate) {
  return (
    !String(candidate.source ?? '').startsWith('known:') &&
    !/_(?:ENCODED|HEX)$/u.test(candidate.type)
  );
}

class ExactMatcher {
  constructor() {
    this.buckets = new Map();
    this.values = new Set();
  }

  add(input) {
    const { value } = input;
    if (typeof value !== 'string' || value.length < EXACT_KEY) return;
    if (this.values.has(value)) return;
    this.values.add(value);
    const candidate = { ...input, bounded: boundedCandidate(input) };
    const key = value.slice(0, EXACT_KEY);
    const bucket = this.buckets.get(key);
    if (!bucket) {
      this.buckets.set(key, [candidate]);
      return;
    }
    // Longest first, so the longest value at a position wins.
    let index = bucket.findIndex((c) => c.value.length < value.length);
    if (index < 0) index = bucket.length;
    bucket.splice(index, 0, candidate);
  }

  addWithVariants(candidate) {
    this.add(candidate);
    if (
      candidate.value.length > MAX_VARIANT_SOURCE ||
      /_(?:ENCODED|HEX)$/u.test(candidate.type)
    ) {
      return;
    }
    for (const variant of variants(candidate))
      this.add({ ...variant, source: candidate.source });
  }

  // Leftmost-longest, non-overlapping matches outside `blocked` spans.
  find(text, blocked = []) {
    const hits = [];
    if (!this.buckets.size || text.length < EXACT_KEY) return hits;
    let b = 0;
    for (let i = 0; i + EXACT_KEY <= text.length; i += 1) {
      while (b < blocked.length && blocked[b][1] <= i) b += 1;
      if (b < blocked.length && blocked[b][0] <= i) {
        i = blocked[b][1] - 1;
        continue;
      }
      const bucket = this.buckets.get(text.slice(i, i + EXACT_KEY));
      if (!bucket) continue;
      for (const candidate of bucket) {
        const end = i + candidate.value.length;
        if (!text.startsWith(candidate.value, i)) continue;
        if (b < blocked.length && blocked[b][0] < end) continue;
        if (candidate.bounded && !atWordBoundaries(text, i, end)) continue;
        hits.push({ start: i, end, candidate });
        i = end - 1;
        break;
      }
    }
    return hits;
  }
}

// One matcher per vault and `known` list, built once and extended as the vault
// grows, so a process scrubbing many strings (the proxy, a notebook) pays for
// the vault once.
const matchers = new WeakMap();

function exactMatcher(vault, known) {
  const entries = vault?.entries instanceof Map ? vault.entries : null;
  let cached = vault ? matchers.get(vault) : null;
  if (!cached || cached.known !== known || cached.entries !== entries) {
    const matcher = new ExactMatcher();
    for (const s of known)
      matcher.addWithVariants({
        value: s.value,
        type: s.type,
        source: `known:${s.name}`,
      });
    cached = { matcher, known, entries, seen: new Set() };
    if (vault) matchers.set(vault, cached);
  }
  if (entries && cached.seen.size !== entries.size) {
    for (const [token, entry] of entries) {
      if (cached.seen.has(token)) continue;
      cached.seen.add(token);
      if (!exactFromVault(entry)) continue;
      cached.matcher.addWithVariants({
        value: entry.value,
        type: entry.type,
        source: entry.source ?? 'detected',
      });
    }
  } else if (!entries && vault?.knownValues) {
    for (const entry of vault.knownValues()) {
      if (!exactFromVault(entry)) continue;
      cached.matcher.addWithVariants({
        value: entry.value,
        type: entry.type,
        source: entry.source ?? 'detected',
      });
    }
  }
  return cached.matcher;
}

function spansOf(text, re) {
  const spans = [];
  for (const m of text.matchAll(new RegExp(re.source, 'g')))
    spans.push([m.index, m.index + m[0].length]);
  return spans;
}

// A private-use character absent from `text`, used to stand in for named-form
// markers during detection.
function fillerFor(text) {
  for (let code = 0xe000; code <= 0xf8ff; code += 1) {
    const ch = String.fromCharCode(code);
    if (!text.includes(ch)) return ch;
  }
  return null;
}

// The longest part of a finding that does not cover filler characters.
function trimFinding(finding, text, filler) {
  const raw = text.slice(finding.start, finding.end);
  if (!raw.includes(filler)) return finding;
  let best = null;
  let offset = 0;
  for (const piece of raw.split(filler)) {
    if (piece && (!best || piece.length > best.length))
      best = { start: finding.start + offset, length: piece.length };
    offset += piece.length + 1;
  }
  if (!best) return null;
  return {
    ...finding,
    start: best.start,
    end: best.start + best.length,
    length: best.length,
  };
}

// Known and live vault values (or their encodings) that occur in `text`, one
// per distinct value, without changing the vault.
export function exactValueHits(text, { vault, known = [] } = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const distinct = new Map();
  for (const { candidate } of exactMatcher(vault, known).find(
    text,
    spansOf(text, TOKEN_RE),
  )) {
    if (!distinct.has(candidate.value))
      distinct.set(candidate.value, candidate);
  }
  return [...distinct.values()];
}

// Replace known secrets and live vault values (and their encodings) first,
// then detector findings. `findingSource` is the vault source recorded for new
// detector findings ('prompt' for text the user typed).
export function scrub(
  text,
  {
    vault,
    known = [],
    profile = 'tool',
    unmaskedTypes = [],
    findingSource = 'detected',
  } = {},
) {
  if (typeof text !== 'string' || text.length === 0)
    return { text, replacements: [], revealed: [] };
  const replacements = [];
  const revealed = [];
  const unmasked = new Set(unmaskedTypes);

  // Named-form markers (⟦TYPE-xxxxxx⟧) are kept as written. Detection runs on
  // the whole text with each marker replaced by filler of the same length, so a
  // marker never separates a value from the key name before it.
  const markers = [...text.matchAll(NAMED_TOKEN_RE)].map((m) => m[0]);
  const filler = markers.length ? fillerFor(text) : null;
  let out = filler
    ? text.replace(NAMED_TOKEN_RE, (m) => filler.repeat(m.length))
    : text;

  const blocked = [
    ...spansOf(out, TOKEN_RE),
    ...(filler ? spansOf(out, new RegExp(`${escapeRe(filler)}+`)) : []),
  ].sort((a, b) => a[0] - b[0]);
  const hits = exactMatcher(vault, known).find(out, blocked);
  if (hits.length) {
    const byToken = new Map();
    let rebuilt = '';
    let cursor = 0;
    for (const { start, end, candidate: c } of hits) {
      rebuilt += out.slice(cursor, start);
      cursor = end;
      if (unmasked.has(baseType(c.type))) {
        rebuilt += out.slice(start, end);
        revealed.push({ type: c.type, count: 1 });
        continue;
      }
      const token = vault.tokenFor(c.type, c.value, c.source);
      rebuilt += token;
      const seen = byToken.get(token);
      if (seen) seen.count += 1;
      else {
        const replacement = { token, type: c.type, source: c.source, count: 1 };
        byToken.set(token, replacement);
        replacements.push(replacement);
      }
    }
    out = rebuilt + out.slice(cursor);
  }

  const findings = detectSensitiveData(out, { profile })
    .map((f) => (filler ? trimFinding(f, out, filler) : f))
    .filter(Boolean);
  if (findings.length) {
    let rebuilt = '';
    let cursor = 0;
    for (const f of findings) {
      if (f.start < cursor) continue;
      const raw = out.slice(f.start, f.end);
      if (unmasked.has(f.type)) {
        rebuilt += out.slice(cursor, f.end);
        cursor = f.end;
        revealed.push({ type: f.type, count: 1 });
        continue;
      }
      const token = vault.tokenFor(f.type, raw, findingSource);
      rebuilt += out.slice(cursor, f.start) + token;
      cursor = f.end;
      replacements.push({
        token,
        type: f.type,
        source: findingSource,
        count: 1,
      });
    }
    out = rebuilt + out.slice(cursor);
  }

  if (filler) {
    let next = 0;
    out = out.replace(new RegExp(`${escapeRe(filler)}+`, 'g'), (run) => {
      let restored = '';
      while (restored.length < run.length && next < markers.length)
        restored += markers[next++];
      return restored;
    });
  }
  return { text: out, replacements, revealed };
}

// Walk any JSON value and scrub every string, keeping the shape.
export function scrubDeep(value, opts, acc = [], revealedAcc = []) {
  if (typeof value === 'string') {
    const r = scrub(value, opts);
    acc.push(...r.replacements);
    revealedAcc.push(...r.revealed);
    return r.text;
  }
  if (Array.isArray(value))
    return value.map((v) => scrubDeep(v, opts, acc, revealedAcc));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = scrubDeep(v, opts, acc, revealedAcc);
    return out;
  }
  return value;
}

export function restore(text, vault, skip = null) {
  if (typeof text !== 'string') return { text, restored: [] };
  const restored = [];
  const out = text.replace(new RegExp(TOKEN_RE.source, 'g'), (token) => {
    if (skip?.has(token)) return token;
    const entry = vault.entryOf(token);
    if (!entry) return token;
    restored.push({ token, type: entry.type, source: entry.source });
    return entry.value;
  });
  return { text: out, restored };
}

// Tokens in any string of a JSON value that this vault once held and has since
// expired (value-free tombstones). Tokens the vault never held are not listed.
export function expiredTokens(value, vault, acc = new Set()) {
  if (typeof value === 'string') {
    for (const [token] of value.matchAll(new RegExp(TOKEN_RE.source, 'g'))) {
      if (vault.tombstoneOf?.(token)) acc.add(token);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) expiredTokens(item, vault, acc);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) expiredTokens(item, vault, acc);
  }
  return [...acc];
}

// `skip` holds tokens to leave as they are (tokens PreToolUse itself just put
// into the input for raw values the model wrote).
export function restoreDeep(value, vault, acc = [], skip = null) {
  if (typeof value === 'string') {
    const r = restore(value, vault, skip);
    acc.push(...r.restored);
    return r.text;
  }
  if (Array.isArray(value))
    return value.map((v) => restoreDeep(v, vault, acc, skip));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = restoreDeep(v, vault, acc, skip);
    return out;
  }
  return value;
}

// ---- destinations ------------------------------------------------------------

// Built-in destinations by the value's provider prefix. User-signed project
// rules extend them, keyed by variable name, token or type.
const PROVIDER_HOSTS = [
  [
    /^(?:sk|rk)_(?:live|test)_|^whsec_/,
    ['api.stripe.com', 'files.stripe.com', 'connect.stripe.com'],
    'Stripe',
  ],
  [/^sk-ant-/, ['api.anthropic.com'], 'Anthropic'],
  [/^sk-(?:proj|svcacct|admin)-/, ['api.openai.com'], 'OpenAI'],
  [/^sk-or-v1-/, ['openrouter.ai'], 'OpenRouter'],
  [
    /^gh[pousr]_|^github_pat_/,
    [
      'api.github.com',
      'github.com',
      'uploads.github.com',
      '*.githubusercontent.com',
    ],
    'GitHub',
  ],
  [/^glpat-/, ['gitlab.com'], 'GitLab'],
  [/^(?:AKIA|ASIA)/, ['*.amazonaws.com'], 'AWS'],
  [/^AIza/, ['*.googleapis.com'], 'Google'],
  [/^xox[abposr]-|^xapp-/, ['slack.com', '*.slack.com'], 'Slack'],
  [/^hf_/, ['huggingface.co', '*.huggingface.co'], 'Hugging Face'],
  [/^npm_/, ['registry.npmjs.org'], 'npm'],
  [/^zhk_/, ['*.zeroh.io'], 'ZeroH'],
];

// The built-in destinations of a value, by its provider prefix: the provider's
// name and hosts, or null when no provider is recognised.
export function builtInDestinations(value) {
  for (const [re, hosts, provider] of PROVIDER_HOSTS) {
    if (re.test(String(value ?? ''))) return { provider, hosts: [...hosts] };
  }
  return null;
}
const ROOT_ZONE_TLDS = new Set(
  JSON.parse(
    readFileSync(
      new URL('./rules/tlds.generated.json', import.meta.url),
      'utf8',
    ),
  ).tlds,
);

function addHost(hosts, candidate) {
  const host = String(candidate)
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  // This machine is never a destination (the one loopback rule).
  if (!host || isLoopbackHost(host)) return;
  hosts.add(host);
}

function validIpv4(value) {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every(
      (part) =>
        /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255,
    )
  );
}

function validIpv6(value) {
  if (!value.includes(':')) return false;
  try {
    return new URL(`http://[${value}]`).hostname.length > 0;
  } catch {
    return false;
  }
}

function hasRootZoneTld(host) {
  return ROOT_ZONE_TLDS.has(host.slice(host.lastIndexOf('.') + 1));
}

// Source, script and data file extensions that are also delegated TLDs. A bare
// `name.ext` with one of these is a file (`python app.py`, `./deploy.sh`,
// `README.md`, `main.tf`, `x.zip`), unless the text makes it a host: a scheme
// URL, `user@`, or the host argument of a network command.
const FILE_EXTENSION_TLDS = new Set([
  'ac', // configure.ac
  'am', // Makefile.am
  'as', // ActionScript
  'bz',
  'cc', // C++
  'cr', // Crystal
  'gs', // Apps Script
  'in', // Makefile.in, requirements.in
  'mk', // make
  'ml', // OCaml
  'md', // Markdown
  'mo', // gettext
  'mov',
  'nu', // Nushell
  'pl', // Perl
  'pm', // Perl module
  'ps', // PostScript
  'pub', // id_ed25519.pub
  'py', // Python
  're', // ReasonML
  'rs', // Rust
  'sc', // Scala script
  'sh', // shell
  'so', // shared object
  'st',
  'sv', // SystemVerilog
  'tf', // Terraform
  'work', // go.work
  'zip',
]);
// Common receivers of a member access (`user.name`, `app.run`, `self.email`):
// code, never a host.
const CODE_RECEIVERS = new Set([
  'app',
  'config',
  'console',
  'ctx',
  'document',
  'event',
  'exports',
  'module',
  'obj',
  'os',
  'process',
  'props',
  'req',
  'res',
  'self',
  'settings',
  'state',
  'sys',
  'this',
  'user',
  'window',
]);
// Commands whose bare operands are hosts.
const NETWORK_COMMAND_RE =
  /(?:^|[\s"'(`])(?:curl|wget|ssh|mosh|nc|ncat|netcat|telnet|ping|ping6|dig|nslookup|host|ftp|sftp|http|https|xh|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(?=\s)/i;
// Command options whose operand is a local file (`curl -o out.zip`).
const FILE_OPTION_RE =
  /(?:^|\s)(?:-[oOTKE]|--output|--upload-file|--config|--cacert|--cert|--key|--data-binary|-d|--data|-F|--form|--input-file)[\s=]*["']?[^\s"']*$/;

function commandSegmentBefore(text, index) {
  const before = text.slice(Math.max(0, index - 400), index);
  const parts = before.split(/[;|&\n]|\\n/u);
  return parts[parts.length - 1];
}

// True when a dotted word is a file or code, not a destination.
function fileOrCodeWord(text, start, end, host) {
  const prev = text[start - 1];
  if ((prev === '/' && text[start - 2] !== '/') || prev === '\\') return true;
  if (prev === '@' || prev === '<' || prev === '>') return true;
  if (text[end] === '(') return true;
  const labels = host.split('.');
  if (labels.length === 2 && CODE_RECEIVERS.has(labels[0])) return true;
  const tld = labels[labels.length - 1];
  if (!FILE_EXTENSION_TLDS.has(tld)) return false;
  const segment = commandSegmentBefore(text, start);
  if (NETWORK_COMMAND_RE.test(segment) && !FILE_OPTION_RE.test(segment))
    return false;
  return true;
}

export function hostsIn(text) {
  text = String(text);
  const hosts = new Set();
  for (const m of text.matchAll(
    /\b(?:https?|wss?|ftp):\/\/(?:[^\s@/'"]*@)?([A-Za-z0-9.-]+|\[[0-9a-f:.]+\])/gi,
  )) {
    addHost(hosts, m[1]);
  }
  const domain =
    /(?<![A-Za-z0-9._%+-])(?:[A-Za-z0-9._%+-]+@)?((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[Xx][Nn]--[A-Za-z0-9](?:[A-Za-z0-9-]{0,57}[A-Za-z0-9])?|[A-Za-z]{2,63}))(?::\d{1,5})?(?![A-Za-z0-9-])/g;
  for (const match of text.matchAll(domain)) {
    const host = match[1].toLowerCase();
    const offset = match[0].lastIndexOf(match[1]);
    const start = match.index + offset;
    const end = start + match[1].length;
    const userAt = match[0].includes('@');
    const explicit = userAt || /:\d{1,5}$/u.test(match[0]);
    const startsWithDot = text[start - 1] === '.';
    if (startsWithDot) continue;
    if (!userAt && fileOrCodeWord(text, start, end, host)) continue;
    if (explicit || hasRootZoneTld(host)) addHost(hosts, host);
  }
  for (const match of text.matchAll(
    /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g,
  )) {
    if (validIpv4(match[1])) addHost(hosts, match[1]);
  }
  for (const match of text.matchAll(
    /\[([0-9a-f:.]*:[0-9a-f:.]+)\](?::\d{1,5})?/gi,
  )) {
    if (validIpv6(match[1])) addHost(hosts, match[1]);
  }
  for (const match of text.matchAll(
    /(?<![\w[])([0-9a-f]{0,4}:[0-9a-f:]{2,})(?![\w\]])/gi,
  )) {
    const candidate = match[1].replace(/:\d{1,5}$/, (port) =>
      match[1].includes('::') ? port : '',
    );
    if (validIpv6(candidate)) addHost(hosts, candidate);
  }
  return [...hosts];
}

// The part of a tool input that can name a destination. Paths of the file a
// local tool reads or writes are not destinations.
const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path']);
export function destinationText(toolName, input) {
  const local = [
    'Read',
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
    'Grep',
    'Glob',
  ].includes(toolName);
  return JSON.stringify(input, (key, value) =>
    local && PATH_FIELDS.has(key) ? undefined : value,
  );
}

function hostMatches(host, pattern) {
  if (pattern.startsWith('*.'))
    return host === pattern.slice(2) || host.endsWith(pattern.slice(1));
  return host === pattern;
}

// The rule keys that apply to a vault entry, most specific first.
function ruleKeys({ token, entry }) {
  const name = entry.source?.startsWith('known:')
    ? entry.source.slice(6)
    : null;
  return [name, token, entry.type, '*'];
}

export function allowedHosts({ token, entry }, rules) {
  const hosts = new Set();
  for (const key of ruleKeys({ token, entry })) {
    if (key && Array.isArray(rules[key]))
      rules[key]
        .map((h) => String(h).toLowerCase())
        .filter((h) => !h.startsWith('mcp:'))
        .forEach((h) => hosts.add(h));
  }
  for (const [re, list] of PROVIDER_HOSTS)
    if (re.test(entry.value)) list.forEach((h) => hosts.add(h));
  return [...hosts];
}

// The MCP server of a tool named `mcp__<server>__<tool>`, lower-cased, or null.
export function mcpServerOf(toolName) {
  const match = /^mcp__([A-Za-z0-9_-]+?)__/u.exec(String(toolName ?? ''));
  return match ? match[1].toLowerCase() : null;
}

// True when the user signed a rule `<NAME|TOKEN|TYPE|*> mcp:<server>` for this
// value. Nothing else lets a real value into an MCP tool: hosts or loopback
// URLs the input happens to mention say nothing about where the server sends it.
export function mcpServerAllowed({ token, entry }, rules, server) {
  if (!server || !entry) return false;
  const wanted = `mcp:${server}`;
  return ruleKeys({ token, entry }).some(
    (key) =>
      key &&
      Array.isArray(rules[key]) &&
      rules[key].some((h) => String(h).toLowerCase() === wanted),
  );
}

// A restored secret may only travel to hosts allowed for it. With no host in
// the text there is nothing to check (a local script, a file edit).
export function checkDestinations(restored, text, vault, rules) {
  const hosts = hostsIn(text);
  if (!hosts.length) return { ok: true, violations: [] };
  const violations = [];
  const seen = new Set();
  for (const r of restored) {
    if (seen.has(r.token)) continue;
    seen.add(r.token);
    const entry = vault.entryOf(r.token);
    if (!entry) continue;
    const allowed = allowedHosts({ token: r.token, entry }, rules);
    for (const host of hosts) {
      if (!allowed.some((p) => hostMatches(host, p))) {
        const name = entry.source?.startsWith('known:')
          ? entry.source.slice(6)
          : null;
        violations.push({
          token: r.token,
          name,
          host,
          allowed,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ---- sensitive files -----------------------------------------------------------

const KEY_FILE_RE =
  /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)(?!\.pub)|[^/]+\.(?:p12|pfx|jks|keystore|kdbx|ppk|tfstate|tfstate\.backup)|allow\.key|vault\.key|\.git-credentials|\.netrc|\.pgpass|kubeconfig|\.kube\/config|\.aws\/credentials|\.docker\/config\.json)$/i;

export function isSensitivePath(p, root = process.cwd()) {
  const s = String(p);
  const portable = s.replace(/\\/g, '/');
  if (KEY_FILE_RE.test(portable)) return true;
  if (/\.(?:pem|key)$/i.test(s)) {
    try {
      const abs = path.resolve(root, s);
      const head = readFileSync(abs, 'utf8').slice(0, 8192);
      return /PRIVATE KEY/.test(head);
    } catch {
      return /(?:^|\/)(?:private|priv|server|client)[^/]*\.(?:pem|key)$/i.test(
        portable,
      );
    }
  }
  return false;
}

const READERS =
  /\b(?:cat|less|more|head|tail|bat|strings|xxd|od|hexdump|base64|openssl|cp|scp|rsync|curl|wget|nc|tee|awk|sed|grep|rg)\b/;
const ENCODERS =
  /\|\s*(?:base64|xxd|od|hexdump|openssl|gzip|bzip2|xz|zstd|rev|tr|gpg)\b|\b(?:base64|xxd|od|hexdump)\s+[^|;&]*\.env/;

export function bashSensitiveReason(command, root = process.cwd()) {
  const cmd = String(command);
  if (READERS.test(cmd)) {
    for (const word of cmd.split(/[\s'"=<>|;&()]+/)) {
      if (word && isSensitivePath(word, root))
        return `reads ${word}, a private key or credential store`;
    }
  }
  if (/\.env\b/.test(cmd) && ENCODERS.test(cmd))
    return 'pipes a secrets file into an encoder, which would slip past masking';
  return null;
}

const POWERSHELL_FILE_COMMANDS =
  /\b(?:Get-Content|gc|cat|type|Copy-Item|Set-Content|Out-File|Add-Content|Remove-Item)\b/i;

export function powershellSensitiveReason(command, root = process.cwd()) {
  const cmd = String(command);
  if (!POWERSHELL_FILE_COMMANDS.test(cmd)) return null;
  for (const word of cmd.split(/[\s'"=<>|;&(){}]+/)) {
    if (word && isSensitivePath(word, root))
      return `touches ${word}, a private key or credential store`;
  }
  return null;
}

export { isSecretName };
