// SPDX-License-Identifier: AGPL-3.0-only

// User-authorised destination rules. The project file is trusted only when its
// HMAC verifies with the private key in the user's ZeroH home.
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, sameSecret } from './crypto.js';
import { writePrivateJson } from './private-fs.js';
import { ensurePrivateDirSync, projectDataDir } from './session.js';
import { createKeyFile, zerohHome } from './vault.js';

export const ALLOW_FILE_NOTICE =
  "ZeroH Disclosure: this project's allow list was changed outside `/zeroh-disclosure:allow`, so it is ignored. Add the rules again with /zeroh-disclosure:allow.";

const VERSION = 1;

// Per project, under ZEROH_HOME (D-15): never in the project folder.
export function allowFilePath(root = process.cwd(), home = zerohHome()) {
  return path.join(
    projectDataDir(path.resolve(root), { ...process.env, ZEROH_HOME: home }),
    'allow.json',
  );
}

export function allowKeyPath(home = zerohHome()) {
  return path.join(path.resolve(home), 'allow.key');
}

function isRules(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([name, hosts]) =>
        name.length > 0 &&
        Array.isArray(hosts) &&
        hosts.every((host) => typeof host === 'string' && host.length > 0),
    )
  );
}

export function signatureFor(rules, key) {
  return createHmac('sha256', key)
    .update(canonicalJson(rules), 'utf8')
    .digest('base64url');
}

export function signaturesMatch(actual, expected) {
  return sameSecret(actual, expected);
}

export function readAllowRules(root = process.cwd(), home = zerohHome()) {
  const file = allowFilePath(root, home);
  if (!existsSync(file))
    return { rules: {}, status: 'missing', ignored: false };
  try {
    const document = JSON.parse(readFileSync(file, 'utf8'));
    const key = readFileSync(allowKeyPath(home));
    if (
      document?.version !== VERSION ||
      !isRules(document.rules) ||
      typeof document.hmac !== 'string' ||
      key.length !== 32
    ) {
      return { rules: {}, status: 'invalid', ignored: true };
    }
    const expected = signatureFor(document.rules, key);
    if (!signaturesMatch(document.hmac, expected)) {
      return { rules: {}, status: 'invalid', ignored: true };
    }
    return { rules: document.rules, status: 'verified', ignored: false };
  } catch {
    return { rules: {}, status: 'invalid', ignored: true };
  }
}

export function loadAllowRules(root = process.cwd(), home = zerohHome()) {
  return readAllowRules(root, home).rules;
}

export function loadOrCreateAllowKey(home) {
  const directory = path.resolve(home);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = allowKeyPath(directory);
  let key = null;
  try {
    key = readFileSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // Created atomically (lib/vault.js createKeyFile): never a short key.
  key ??= createKeyFile(file);
  if (key?.length !== 32)
    throw new Error('ZeroH destination allow key is not 32 bytes');
  return key;
}

export function writeAllowRules(root, rules, { home = zerohHome() } = {}) {
  if (!isRules(rules)) throw new Error('allow rules must map names to hosts');
  const key = loadOrCreateAllowKey(home);
  const file = allowFilePath(root, home);
  ensurePrivateDirSync(path.dirname(file));
  const document = {
    version: VERSION,
    rules,
    hmac: signatureFor(rules, key),
  };
  writePrivateJson(file, document);
  return document;
}

// An MCP destination is written `mcp:<server>`, the server name as it appears
// in the tool name `mcp__<server>__<tool>` (Claude Code keeps only letters,
// digits, `_` and `-`).
export const MCP_DESTINATION_RE = /^mcp:[a-z0-9_-]+$/u;

export function normaliseAllowHost(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw.startsWith('mcp:')) {
    if (!MCP_DESTINATION_RE.test(raw) || raw.includes('__'))
      throw new Error(`invalid MCP server: ${value}`);
    return raw;
  }
  const host = raw.replace(/^\[|\]$/g, '');
  if (
    !host ||
    host.includes('/') ||
    host.includes('@') ||
    /:\d+$/.test(host) ||
    !/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|[0-9a-f:]+)$/.test(host)
  ) {
    throw new Error(`invalid host: ${value}`);
  }
  return host;
}

export function updateAllowRule(rules, name, host, { remove = false } = {}) {
  const key = String(name || '').trim();
  if (!key || /[\r\n]/.test(key))
    throw new Error('allow requires a name, token or type');
  const normalisedHost = normaliseAllowHost(host);
  const next = Object.fromEntries(
    Object.entries(rules || {}).map(([rule, hosts]) => [rule, [...hosts]]),
  );
  const hosts = new Set(next[key] || []);
  if (remove) hosts.delete(normalisedHost);
  else hosts.add(normalisedHost);
  if (hosts.size) next[key] = [...hosts].sort();
  else delete next[key];
  return Object.fromEntries(
    Object.entries(next).sort(([left], [right]) => left.localeCompare(right)),
  );
}
