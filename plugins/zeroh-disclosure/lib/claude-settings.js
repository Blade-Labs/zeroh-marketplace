// SPDX-License-Identifier: AGPL-3.0-only

// Claude Code settings for the default proxy: where the settings file is, the
// one entry ZeroH writes into it (env.ANTHROPIC_BASE_URL), and the restore
// record kept next to it.
//
// The restore record lets `proxy off`, `doctor --fix` and SessionStart put the
// user's own setting back even after ZEROH_HOME was deleted. It holds the
// original ANTHROPIC_BASE_URL (which is also the proxy's upstream), whether
// ZeroH created the `env` object, and the URL ZeroH wrote. It never holds a
// copy of the settings file or any other of its values.
//
// After `proxy off` the same file records only that the user turned the
// proxy off for this settings file ({ off: true }), next to the settings so
// it survives a deleted ZEROH_HOME; `proxy on` and `doctor --fix` remove it.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLoopbackHost, loopbackPort } from './loopback.js';
import {
  readJsonOr,
  removeQuietly,
  writePrivateFile,
  writePrivateJson,
} from './private-fs.js';

export const DEFAULT_ANTHROPIC_UPSTREAM = 'https://api.anthropic.com';
// Settings written by ZeroH address the proxy as http://127.0.0.1:<port>/z/<key>.
export const PROXY_PATH_PREFIX = '/z/';
const PROXY_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/u;

function pathImplementation(platform) {
  return platform === 'win32' ? path.win32 : path;
}

export function resolveClaudeSettingsPath({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir,
} = {}) {
  const pathImpl = pathImplementation(platform);
  if (env.ZEROH_CLAUDE_SETTINGS) {
    return pathImpl.resolve(env.ZEROH_CLAUDE_SETTINGS);
  }
  if (env.CLAUDE_CONFIG_DIR) {
    return pathImpl.join(
      pathImpl.resolve(env.CLAUDE_CONFIG_DIR),
      'settings.json',
    );
  }
  const home =
    platform === 'win32' ? env.USERPROFILE || homedir() : env.HOME || homedir();
  return pathImpl.join(pathImpl.resolve(home), '.claude', 'settings.json');
}

export function installId(settingsPath) {
  return createHash('sha256')
    .update(path.resolve(settingsPath))
    .digest('hex')
    .slice(0, 16);
}

// The access key of a base URL ZeroH writes (loopback, plain HTTP, path
// /z/<key>), else null.
export function proxyKeyOf(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
      return null;
    }
    if (!parsed.pathname.startsWith(PROXY_PATH_PREFIX)) return null;
    const key = parsed.pathname
      .replace(/\/$/u, '')
      .slice(PROXY_PATH_PREFIX.length);
    return PROXY_KEY_RE.test(key) ? key : null;
  } catch {
    return null;
  }
}

export function isZeroHProxyUrl(value) {
  return proxyKeyOf(value) !== null;
}

// True for a URL that addresses a ZeroH proxy: one ZeroH wrote, the one this
// record names, or a loopback URL on a port a ZeroH record names.
export function isOurProxyUrl(
  value,
  { record = null, ports = new Set() } = {},
) {
  if (typeof value !== 'string' || !value) return false;
  if (isZeroHProxyUrl(value)) return true;
  if (record?.proxyUrl && value === record.proxyUrl) return true;
  const port = loopbackPort(value);
  return Boolean(port) && ports.has(port);
}

// A base URL the proxy may forward to: HTTP(S) and never a ZeroH proxy (the
// proxy would forward to itself), else null.
export function usableUpstream(value, ports = new Set()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (isOurProxyUrl(parsed.href, { ports })) return null;
  return parsed.href.replace(/\/$/u, '');
}

export function newProxyKey() {
  return randomBytes(24).toString('base64url');
}

// --- the settings file ------------------------------------------------------

function parseSettings(raw, settingsPath) {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('the document root is not an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Claude Code settings at ${settingsPath} are not valid JSON: ${error.message}`,
    );
  }
}

// The parsed settings document ({} for a missing or empty file). Throws for
// invalid JSON or a non-object `env`: ZeroH never rewrites such a file.
export function readSettings(settingsPath) {
  const exists = existsSync(settingsPath);
  const document = exists
    ? parseSettings(readFileSync(settingsPath, 'utf8'), settingsPath)
    : {};
  if (
    Object.hasOwn(document, 'env') &&
    (!document.env ||
      Array.isArray(document.env) ||
      typeof document.env !== 'object')
  ) {
    throw new Error(
      `Claude Code settings at ${settingsPath} have a non-object env entry`,
    );
  }
  return { exists, document };
}

export function settingsBaseUrl(settingsPath) {
  try {
    return readSettings(settingsPath).document.env?.ANTHROPIC_BASE_URL;
  } catch {
    return undefined;
  }
}

// Settings files may be symlinks into a dotfiles repository. Write the link's
// target so the link survives, and keep the file's own mode.
export function writeSettingsFile(settingsPath, data) {
  let target = settingsPath;
  try {
    target = realpathSync(settingsPath);
  } catch {
    // A new settings file is created where it was named.
  }
  let mode = 0o600;
  try {
    mode = statSync(target).mode & 0o777;
  } catch {
    // New file: private by default.
  }
  writePrivateFile(target, data, { mode, durable: true });
}

function writeSettingsDocument(settingsPath, document) {
  writeSettingsFile(settingsPath, `${JSON.stringify(document, null, 2)}\n`);
}

// What the user had before ZeroH wrote its entry.
export function originalOf(document) {
  return {
    originalBaseUrlPresent: Object.hasOwn(
      document.env || {},
      'ANTHROPIC_BASE_URL',
    ),
    originalBaseUrlValue: document.env?.ANTHROPIC_BASE_URL,
    createdEnv: !Object.hasOwn(document, 'env'),
  };
}

// Points the settings file at the proxy. Returns true when it wrote. A user
// who removed or replaced the entry after ZeroH wrote it keeps their choice;
// an entry for a ZeroH proxy (another port or key) is replaced.
export function writeProxySetting(install, proxyUrl) {
  const { document } = readSettings(install.settingsPath);
  const current = document.env?.ANTHROPIC_BASE_URL;
  if (current === proxyUrl) {
    install.proxyUrl = proxyUrl;
    return false;
  }
  if (install.proxyUrl && !isZeroHProxyUrl(current)) return false;
  document.env = { ...(document.env || {}), ANTHROPIC_BASE_URL: proxyUrl };
  writeSettingsDocument(install.settingsPath, document);
  install.proxyUrl = proxyUrl;
  return true;
}

// The one rule for taking ZeroH's entry out of a settings file: a daemon
// leaving, a dead entry, a machine without login items, `proxy off`, doctor,
// uninstall and the 24-hour cleanup all use it. `match` says which value
// counts as ZeroH's:
//   a URL    only that exact value (a daemon's own entry, or the dead one a
//            prompt found), so an entry a newer daemon wrote stays;
//   'zeroh'  any URL ZeroH writes (http://127.0.0.1:<port>/z/<key>);
//   'ours'   also the URL `record` names, and a loopback URL on a port a
//            ZeroH record names (`ports`).
// The user's original goes back when it was recorded and is not itself a
// ZeroH URL, otherwise the key is removed (and an `env` ZeroH created and left
// empty with it). Only that key changes. When the entry came out, `record`
// forgets the URL it wrote, so a later prompt writes it again instead of
// counting it as removed by the user (the caller saves a proxy.json record).
export function takeEntryOut(
  settingsPath,
  record,
  { match, ports = new Set() },
) {
  const isOurs =
    match === 'zeroh'
      ? isZeroHProxyUrl
      : match === 'ours'
        ? (value) => isOurProxyUrl(value, { record, ports })
        : (value) => value === match;
  const { exists, document } = readSettings(settingsPath);
  const value = document.env?.ANTHROPIC_BASE_URL;
  if (!exists || value === undefined || !isOurs(value)) {
    return { removed: false };
  }
  const original = record?.originalBaseUrlPresent
    ? usableUpstream(record.originalBaseUrlValue, ports) &&
      record.originalBaseUrlValue
    : null;
  if (original && original !== value) {
    document.env.ANTHROPIC_BASE_URL = original;
  } else {
    delete document.env.ANTHROPIC_BASE_URL;
    if (record?.createdEnv && Object.keys(document.env).length === 0) {
      delete document.env;
    }
  }
  writeSettingsDocument(settingsPath, document);
  if (record && Object.hasOwn(record, 'proxyUrl')) record.proxyUrl = null;
  return { removed: true, removedUrl: value };
}

// --- the restore record -----------------------------------------------------

export function restoreRecordPath(settingsPath) {
  const resolved = path.resolve(settingsPath);
  return path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.zeroh-restore.json`,
  );
}

export function readRestoreRecord(settingsPath) {
  const record = readJsonOr(restoreRecordPath(settingsPath));
  return record && typeof record === 'object' ? record : null;
}

export function writeRestoreRecord(install) {
  writePrivateJson(restoreRecordPath(install.settingsPath), {
    version: 3,
    settingsPath: install.settingsPath,
    originalBaseUrlPresent: Boolean(install.originalBaseUrlPresent),
    originalBaseUrlValue: install.originalBaseUrlValue,
    createdEnv: Boolean(install.createdEnv),
    proxyUrl: install.proxyUrl || null,
    installedAt: install.installedAt,
  });
}

export function removeRestoreRecord(settingsPath) {
  removeQuietly(restoreRecordPath(settingsPath));
}

// `proxy off`: the user's choice, kept until `proxy on` or `doctor --fix`.
export function writeProxyOffRecord(settingsPath) {
  writePrivateJson(restoreRecordPath(settingsPath), {
    version: 3,
    settingsPath: path.resolve(settingsPath),
    off: true,
    offAt: new Date().toISOString(),
  });
}

export function proxyTurnedOff(settingsPath) {
  return readRestoreRecord(settingsPath)?.off === true;
}
