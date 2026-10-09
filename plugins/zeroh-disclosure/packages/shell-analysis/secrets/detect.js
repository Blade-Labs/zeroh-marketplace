// SPDX-License-Identifier: AGPL-3.0-only

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
import { isGatewayToken } from '../../zeroh-disclosure-core/token-pattern.js';
import {
  detectSensitiveData,
  looksLikeCodeValue,
  nameType,
} from '../../zeroh-disclosure-core/detector.js';

export const SECRET_NAME_RE =
  /(?:PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_?KEY|APIKEY|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_SECRET|AUTH_?KEY|CREDENTIALS?|_DSN$|DATABASE_URL|CONNECTION_STRING|_PAT$|WEBHOOK_URL|_KEY$|^KEY$)/i;
export const NON_SECRET_NAME_RE =
  /(?:_PATH|_DIR|_PREFIX|_SUFFIX|_TIMEOUT(?:_MS|_SECONDS)?|_TTL|_SCOPE|_HEADER|_NAME|_ID|_REGION|_ENDPOINT|MAX_\w*TOKENS?|_TOKENS|PUBLIC_?KEY|_ICON_KEY|_KEY_ID|TOKEN_TYPE|_LENGTH|_SIZE|_COUNT|_ENABLED|_MODE|_VERSION|_HOST|_PORT)$/i;
export const PLACEHOLDER_RE =
  /^(?:\$\{?[\w.-]+\}?|<(?:(?:your|example|placeholder)[-_][A-Za-z_]+|string|password|token|secret)>|x{3,}|\*{3,}|changeme|your[-_].*|example|placeholder|todo|null|none|true|false|undefined|redacted|test|dev|\.\.\.)$/i;
export const ANTHROPIC_CREDENTIAL_ENV = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
]);
// Env vars Claude Code or the OS sets that look secret-shaped but are ours to keep.
export const IGNORED_ENV = new Set([
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

export function isSecretName(name) {
  return SECRET_NAME_RE.test(name) && !NON_SECRET_NAME_RE.test(name);
}

export function typeForName(name) {
  const n = name.toUpperCase();
  if (/DATABASE_URL|_DSN$|CONNECTION_STRING/.test(n)) return 'PASSWORD';
  if (/WEBHOOK_URL/.test(n)) return 'SECRET';
  return nameType(n);
}

export function parseDotenv(text) {
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

export function stringLeaves(node, acc = []) {
  if (typeof node === 'string') acc.push(node);
  else if (Array.isArray(node)) node.forEach((v) => stringLeaves(v, acc));
  else if (node && typeof node === 'object')
    Object.values(node).forEach((v) => stringLeaves(v, acc));
  return acc;
}

// Expand one NAME=value into the concrete secret strings to match.
export function secretValues(name, value, root) {
  if (!value || isGatewayToken(value) || PLACEHOLDER_RE.test(value)) return [];
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

export function dotenvFiles(root) {
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

export const CREDENTIAL_FILE_LIMIT = 256 * 1024;

export function inside(root, candidate) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const base = normalize(root);
  const target = normalize(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

export function readCredentialFile(file, allowedRoot) {
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

export function iniValues(text, wanted) {
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

function addGitHubCredentials(files, home, env) {
  const file =
    process.platform === 'win32'
      ? path.join(
          env.APPDATA || path.join(home, 'AppData', 'Roaming'),
          'GitHub CLI',
          'hosts.yml',
        )
      : path.join(home, '.config', 'gh', 'hosts.yml');
  const text = readCredentialFile(file, home);
  if (!text) return;
  for (const match of text.matchAll(
    /^\s*oauth_token\s*:\s*["']?([^\s"'#]+)["']?/gmu,
  )) {
    files.push({
      name: 'GH_OAUTH_TOKEN',
      value: match[1],
      source: 'gh/hosts.yml',
    });
  }
}

function addNpmCredentials(files, root, home) {
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
}

function addNetrcCredentials(files, home) {
  // curl on Windows reads %USERPROFILE%\.netrc and falls back to _netrc
  // (Git for Windows' curl the same); both may hold passwords.
  const names =
    process.platform === 'win32' ? ['.netrc', '_netrc'] : ['.netrc'];
  for (const name of names) {
    const netrc = readCredentialFile(path.join(home, name), home);
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
          source: name,
        });
      }
    }
  }
}

function addGitCredentials(files, home) {
  const text = readCredentialFile(path.join(home, '.git-credentials'), home);
  if (!text) return;
  for (const line of text.split(/\r?\n/u)) {
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

function addDockerCredentials(files, home) {
  const text = readCredentialFile(
    path.join(home, '.docker', 'config.json'),
    home,
  );
  if (!text) return;
  try {
    const parsed = JSON.parse(text);
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

export function credentialFiles({ root, home, env }) {
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
  addGitHubCredentials(files, home, env);
  addNpmCredentials(files, root, home);
  addNetrcCredentials(files, home);
  addGitCredentials(files, home);
  addDockerCredentials(files, home);
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
      const detected = detectSensitiveData(v, {
        channel: 'prose',
        context: 'mixed',
        profile: 'secrets',
      }).find((f) => f.start === 0 && f.end === v.length);
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
      else if (
        detectSensitiveData(value, {
          channel: 'prose',
          context: 'mixed',
          profile: 'secrets',
        }).length
      )
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
