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
  TOP_LEVEL_DOMAINS,
} from './detector.js';
import { isLoopbackHost } from './loopback.js';
import { shellDestinations } from './shell-destinations.js';
import {
  containsToken,
  NAMED_TOKEN_RE,
  TOKEN_PATTERN,
  TOKEN_RE,
} from './token-pattern.js';

const TOKEN_SPLIT_RE = new RegExp(`(${TOKEN_PATTERN})`, 'u');
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

// Variables Claude Code sets for itself.
export function isClaudeCodeOwnEnvName(name) {
  return /^CLAUDE_CODE_/u.test(String(name).toUpperCase());
}

// Known values that are the user's: what the allow list and counts show.
export function usersKnownSecrets(known) {
  return known.filter((entry) => !entry.own);
}

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
    // Both sides resolved: a home that is itself reached through a link
    // (macOS /var is /private/var, a linked home folder) still holds its own
    // credential files; a link that leaves it is still refused.
    if (!inside(realpathSync(allowedRoot), resolved)) return null;
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

  // curl on Windows reads %USERPROFILE%\.netrc and falls back to _netrc
  // (Git for Windows' curl the same); both may hold passwords.
  const netrcNames =
    process.platform === 'win32' ? ['.netrc', '_netrc'] : ['.netrc'];
  for (const netrcName of netrcNames) {
    const netrc = readCredentialFile(path.join(home, netrcName), home);
    if (!netrc) continue;
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
  // Claude Code's own variables (CLAUDE_CODE_MESSAGING_TOKEN, …) are masked
  // like any secret, but they are not the user's to send anywhere: `own`
  // keeps them out of the allow list and the known-secrets count (Mac /try
  // review M2).
  for (const entry of found.values())
    if (entry.source === 'env' && isClaudeCodeOwnEnvName(entry.name))
      entry.own = true;
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

// One ordinary prose word: ASCII letters, all lowercase or with one leading
// capital, at most 24 of them, and one sentence mark after it
// (`password=<word>?`). A hyphen, an apostrophe, a digit, an inner symbol
// or a capital inside makes it a typed password, not a word
// (`orchard-river-copper-lantern!`, `WqRtYuIoPaSdFgHj`): those keep bare
// matching (Astra detector-exceptions review, finding 5).
const PLAIN_WORD = /^[A-Za-z][a-z]+[?!.,]?$/u;
const PLAIN_WORD_MAX = 24;
const plainWord = (value) =>
  value.length <= PLAIN_WORD_MAX + 1 &&
  PLAIN_WORD.test(value) &&
  value.replace(/[?!.,]$/u, '').length <= PLAIN_WORD_MAX;

function exactFromVault(entry) {
  const value = entry.value;
  if (typeof value !== 'string' || value.length < MIN_VAULT_EXACT) return false;
  const source = entry.source ?? 'detected';
  if (entry.type === 'PERSON' && !source.startsWith('reported:')) return false;
  // A single plain word found by its surroundings, typed (`password=<word>`
  // in a prompt) or in a file or output, is masked where its key names it:
  // the detector finds it there again and the vault gives it the same token.
  // It is never exact-matched bare, which would mask that word in all later
  // code and prose. Vault entries written before 1.0.0 stop matching bare
  // too. A known (`.env`, credential file) or reported word still matches
  // everywhere.
  if ((source === 'prompt' || source === 'detected') && plainWord(value))
    return false;
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
    // Values already counted as shown (scrubDeep shares one across strings).
    revealedSeen = new Set(),
  } = {},
) {
  if (typeof text !== 'string' || text.length === 0)
    return { text, replacements: [], revealed: [] };
  const replacements = [];
  const revealed = [];
  const unmasked = new Set(unmaskedTypes);
  // A value shown under an unmask grant counts once however often it
  // appears, and once when both the vault and the detector find it (H5).
  const reveal = (type, value) => {
    const key = `${baseType(type)}\u0000${value}`;
    if (revealedSeen.has(key)) return;
    revealedSeen.add(key);
    revealed.push({ type, count: 1 });
  };

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
        reveal(c.type, out.slice(start, end));
        continue;
      }
      const token = vault.tokenFor(c.type, c.value, c.source);
      // A read-only view of the values on disk (lib/restorable.js) has no
      // token for a new value: it passes as it is (rule 8).
      if (!token) {
        rebuilt += out.slice(start, end);
        continue;
      }
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
        reveal(f.type, raw);
        continue;
      }
      const token = vault.tokenFor(f.type, raw, findingSource);
      if (!token) {
        rebuilt += out.slice(cursor, f.end);
        cursor = f.end;
        continue;
      }
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
  if (!opts?.revealedSeen) opts = { ...opts, revealedSeen: new Set() };
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
const ROOT_ZONE_TLDS = new Set(TOP_LEVEL_DOMAINS);

function addHost(hosts, candidate) {
  // A name with a token in it (`[API_KEY-3f9a1c].evil.example`, read from
  // the command the model wrote) keeps the token as written.
  const host = containsToken(candidate)
    ? String(candidate)
        .split(TOKEN_SPLIT_RE)
        .map((piece, i) => (i % 2 ? piece : piece.toLowerCase()))
        .join('')
        .replace(/\.$/, '')
    : String(candidate)
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

// Source, script and data file extensions that are also delegated TLDs:
// `app.py:12`, `main.tf:3` is a file and a line, not a host and a port.
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

// True when `name.ext:N` is a file and a line (`grep -n x app.py:12`,
// `src/main.rs:40`), not a host and a port.
function fileAndLine(text, start, host) {
  const prev = text[start - 1];
  if ((prev === '/' && text[start - 2] !== '/') || prev === '\\') return true;
  return FILE_EXTENSION_TLDS.has(host.slice(host.lastIndexOf('.') + 1));
}

// The commands inside `text`: the `command` fields of a tool input in JSON,
// or the text itself.
function commandsIn(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const input = JSON.parse(trimmed);
      return typeof input?.command === 'string' ? [input.command] : [];
    } catch {
      // Not JSON: read it as a command.
    }
  }
  return [text];
}

// The destination operands of the network commands in `command` (Bash, or
// PowerShell when Bash cannot read it), loopback excluded.
export function networkHostsIn(command, { shell = null } = {}) {
  const hosts = new Set();
  let found = shellDestinations(command, { shell: shell || 'bash' });
  if (!found.ok && !shell) {
    const powershell = shellDestinations(command, { shell: 'powershell' });
    if (powershell.ok) found = powershell;
  }
  for (const host of found.destinations) addHost(hosts, host);
  return [...hosts];
}

// Where a text names a destination host. Outside a network command's
// operands (read by networkHostsIn with the shared tokenizer), a host counts
// only where its spelling makes it one: a URL (`https://host/…`,
// `//host/…`), `user@host`, `host:port`, `[v6]:port`. A bare dotted word
// anywhere else (`--query sku.name`, `--set image.tag=…`, `gcloud config set
// compute.zone …`, `app.kubernetes.io/name`, a JSON key, code) is a field,
// a setting, a file or a name, not a destination, even when its last label
// is a real TLD (`.name`, `.zone`, `.io`). A bare address (`--source-
// address-prefixes 198.51.100.0/24`) is data the same way. The program that
// reads such a word is either one ZeroH knows (its operands are read) or an
// uncertain destination the caller reports (product principle 5).
//
// `values`: email addresses ZeroH put back into `text`. An address passed as
// data (`git -c user.email=…`, a form field) names no destination; its
// domain counts only as the operand of a network command (`ssh user@host`),
// which networkHostsIn reads.
export function hostsIn(text, { values = [] } = {}) {
  text = String(text);
  const restoredAddresses = new Set(
    [...values].map((value) => String(value).toLowerCase()),
  );
  const hosts = new Set();
  for (const command of commandsIn(text))
    for (const host of networkHostsIn(command)) hosts.add(host);
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
    const userAt = match[0].includes('@');
    const port = /:\d{1,5}$/u.test(match[0]);
    // `//host/…`: a URL without its scheme.
    const schemeless =
      !userAt &&
      text.slice(start - 2, start) === '//' &&
      !/[A-Za-z0-9+.-]:$/u.test(text.slice(0, start - 2)) &&
      text[start - 3] !== '/' &&
      hasRootZoneTld(host);
    if (!userAt && !port && !schemeless) continue;
    if (text[start - 1] === '.') continue;
    if (
      userAt &&
      restoredAddresses.has(match[0].replace(/:\d{1,5}$/u, '').toLowerCase())
    )
      continue;
    if (port && !userAt && fileAndLine(text, start, host)) continue;
    addHost(hosts, host);
  }
  for (const match of text.matchAll(
    /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/g,
  )) {
    const end = match.index + match[1].length;
    const spelled =
      text[match.index - 1] === '@' || /^:\d{1,5}(?!\d)/u.test(text.slice(end));
    if (spelled && validIpv4(match[1])) addHost(hosts, match[1]);
  }
  for (const match of text.matchAll(
    /(@)?\[([0-9a-f:.]*:[0-9a-f:.]+)\](:\d{1,5})?/gi,
  )) {
    if ((match[1] || match[3]) && validIpv6(match[2])) addHost(hosts, match[2]);
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

// Wildcard DNS services that answer a name with the address written in it
// (their documented forms, exact suffix): `203.0.113.7.sslip.io`,
// `203-0-113-7.sslip.io`, `pm.203.0.113.7.sslip.io`, `pm-203-0-113-7.sslip.io`,
// IPv6 as `2001-db8--1.sslip.io`; the same on nip.io.
const ADDRESS_NAME_SUFFIXES = ['sslip.io', 'nip.io'];
// Anything these services could read as an address: a dotted or dashed run
// of four or more numbers (IPv4), a label of eight hex digits (nip.io's hex
// form) or a dashed IPv6 (a `--`, or three hex groups joined by dashes).
const ADDRESS_LIKE_V4 = /(?<![0-9])\d{1,3}(?:[.-]\d{1,3}){3,}(?![0-9])/gu;
const ADDRESS_LIKE_OTHER =
  /(?:^|[.-])[0-9a-f]{8}(?:$|[.-])|--|[0-9a-f]{1,4}-[0-9a-f]{1,4}-[0-9a-f]{1,4}/u;
const PREFIX_LABELS =
  /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/u;

// True when `value` is an IP address and `host` names exactly that server:
// the address itself (`203.0.113.7`, `[2001:db8::1]`, with any port) or its
// name on an address-mapping service above. The address is then where the
// call goes, not data sent elsewhere (the mirror of an email address used
// as data): the same value as data to that host (`-d ip=<IP>
// https://pm.<IP>.sslip.io/`) goes to the server at that address, which
// already has it. A mapping name counts only when the protected address is
// the ONLY address-like sequence in it, so the service cannot select
// another one (`198.51.100.9.x.<IP>.sslip.io` resolves to 198.51.100.9);
// any other name that merely contains the address
// (`203.0.113.7.evil.example`) is resolved by whoever owns that name.
function addressNamesHost(value, host) {
  const address = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/gu, '');
  const v4 = validIpv4(address);
  if (!v4 && !validIpv6(address)) return false;
  if (host === address) return true;
  const suffix = ADDRESS_NAME_SUFFIXES.find((s) => host.endsWith(`.${s}`));
  if (!suffix) return false;
  const name = host.slice(0, -suffix.length - 1);
  const forms = v4
    ? [address, address.replace(/\./gu, '-')]
    : [address.replace(/:/gu, '-')];
  const form = forms.find(
    (f) =>
      name === f ||
      name.endsWith(`.${f}`) ||
      (v4 && f.includes('-') && name.endsWith(`-${f}`)),
  );
  if (!form) return false;
  const prefix = name.slice(0, name.length - form.length).replace(/[.-]$/u, '');
  if (prefix && !PREFIX_LABELS.test(prefix)) return false;
  // The protected address is the only address-like sequence in the name.
  if (v4) {
    const runs = name.match(ADDRESS_LIKE_V4) ?? [];
    if (runs.length !== 1 || runs[0] !== form) return false;
    return !ADDRESS_LIKE_OTHER.test(prefix);
  }
  return !/\d/u.test(prefix) && !ADDRESS_LIKE_OTHER.test(prefix);
}

// `host` with every restored value in it, in any case, replaced by its token.
export function maskedHost(host, restored, vault) {
  let out = String(host);
  for (const token of new Set(restored.map((r) => r.token))) {
    const value = String(vault.valueOf(token) ?? '');
    if (value.length < 4) continue;
    const pattern = value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    out = out.replace(new RegExp(pattern, 'giu'), token);
  }
  return out;
}

// A restored secret may only travel to hosts allowed for it. With no host in
// the text there is nothing to check here (a local script, a file edit);
// what could not be read is the caller's (shellDestinations' uncertain).
// `hosts` replaces the hosts found in `text` (the PreToolUse hook passes the
// ones it read from the command with the shell it runs in).
export function checkDestinations(
  restored,
  text,
  vault,
  rules,
  { hosts: given = null } = {},
) {
  const hosts = given ?? hostsIn(text);
  if (!hosts.length) return { ok: true, violations: [] };
  const violations = [];
  const seen = new Set();
  const reported = new Set();
  for (const r of restored) {
    if (seen.has(r.token)) continue;
    seen.add(r.token);
    const entry = vault.entryOf(r.token);
    if (!entry) continue;
    const allowed = allowedHosts({ token: r.token, entry }, rules);
    for (const host of hosts) {
      // A name with tokens in it is judged with their values in place.
      const named = containsToken(host)
        ? host.replace(TOKEN_RE, (token) => vault.valueOf(token) ?? token)
        : host;
      if (addressNamesHost(entry.value, named.toLowerCase())) continue;
      if (
        !allowed.some(
          (p) => hostMatches(host, p) || hostMatches(named.toLowerCase(), p),
        )
      ) {
        const name = entry.source?.startsWith('known:')
          ? entry.source.slice(6)
          : null;
        // A value inside a host name is shown as its token (the deny
        // reason reaches the model; host names are lower case, so the
        // value would not be recognised there).
        const shown = maskedHost(host, restored, vault);
        if (reported.has(`${r.token} ${shown}`)) continue;
        reported.add(`${r.token} ${shown}`);
        violations.push({
          token: r.token,
          name,
          host: shown,
          allowed,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ---- sensitive files -----------------------------------------------------------

const KEY_FILE_RE =
  /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)(?!\.pub)|[^/]+\.(?:p12|pfx|jks|keystore|kdbx|ppk|tfstate|tfstate\.backup)|allow\.key|vault\.key|\.git-credentials|[._]netrc|\.pgpass|kubeconfig|\.kube\/config|\.aws\/credentials|\.docker\/config\.json)$/i;

// ZeroH's own keys: reading one would undo the masking itself, so these stay
// closed in every mode. (Everything else under ZEROH_HOME, session signing
// keys included, is closed by the settings guard.)
const ZEROH_KEY_FILE_RE = /(?:^|[\\/])(?:allow|vault)\.key$/iu;

export function isZeroHSecretPath(p) {
  return ZEROH_KEY_FILE_RE.test(String(p ?? ''));
}

// True when a shell command names one of ZeroH's own keys.
export function commandNamesZeroHSecret(command) {
  return String(command)
    .split(/[\s'"=<>|;&()]+/u)
    .some((word) => word && isZeroHSecretPath(word));
}

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
