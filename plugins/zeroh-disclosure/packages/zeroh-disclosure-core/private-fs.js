// SPDX-License-Identifier: AGPL-3.0-only

// Private files: every file ZeroH writes is created with mode 0600 in a 0700
// directory, written to a temporary file and renamed into place, so a reader
// never sees half a file and a failed write keeps the previous version.
// Windows antivirus scanners and indexers briefly lock files, so the rename
// is retried there. Node built-ins only.
import { protectWindowsPath } from './windows-acl.js';
import { isMainThread, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  lstatSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const memorySessionDirs = new Set();
export function keepSessionInMemory(directory) {
  memorySessionDirs.add(path.resolve(directory));
}
export function sessionCanPersist(file) {
  const resolved = path.resolve(file);
  return ![...memorySessionDirs].some(
    (dir) => resolved === dir || resolved.startsWith(`${dir}${path.sep}`),
  );
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

// Writing may fail for these reasons without anything being wrong with
// ZeroH itself: a read-only project, home or disk.
const NOT_WRITABLE = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT']);

export function notWritable(error) {
  return (
    NOT_WRITABLE.has(error?.code) ||
    (process.platform === 'win32' &&
      ['ENOTDIR', 'ENOENT', 'ENODEV', 'ENXIO', 'EIO'].includes(error?.code))
  );
}

// The one spelling of a project folder that every key is made from: the
// absolute path with symbolic links resolved (a missing tail is kept as
// written). macOS reports /var and /tmp as /private/var and /private/tmp to
// a process's own working directory, and any project may sit under a linked
// folder; Claude Code, a terminal and the hooks can each spell the same
// folder differently, and all must find the same vault, allow list, grants
// and sessions. Windows short names (RUNNER~1) are left as they are.
export function canonicalProjectPath(root) {
  const absolute = path.resolve(root);
  const tail = [];
  let cursor = absolute;
  for (;;) {
    try {
      return path.join(realpathSync(cursor), ...tail);
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return absolute;
      tail.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// `keepSource` is for moving a file aside (a backup): a failed move leaves
// it where it was instead of removing it.
export function renameWithRetry(
  from,
  to,
  {
    attempts = 20,
    delayMs = 50,
    rename = renameSync,
    keepSource = false,
    beforeRename = null,
  } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    if (beforeRename && beforeRename({ attempt, from, to }) === false) {
      if (!keepSource) removeQuietly(from);
      return false;
    }
    try {
      rename(from, to);
      return true;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error.code) || attempt >= attempts) {
        if (!keepSource) removeQuietly(from);
        throw error;
      }
      sleepSync(delayMs);
    }
  }
}

export function ensurePrivateDir(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export const STORAGE_PROTECTION_NOTICE =
  'ZeroH could not confirm its storage folder permissions on Windows (known limitation); private storage and masking continue as in 1.0.';
function confirmedStatus(fact) {
  return fact?.fullApply === true
    ? 'secured with Windows permissions'
    : 'root secured; children may still carry earlier permissions';
}
export function storageProtectionStatus(env = process.env) {
  if (process.platform !== 'win32') return null;
  const home = path.resolve(zerohHome(env));
  if (!isMainThread && workerData?.storagePreflight)
    return sameHome(workerData.protectedHome, home)
      ? confirmedStatus(workerData.protectedHome)
      : 'not confirmed';
  if (sameHome(protectedHomes.get(home), home))
    return confirmedStatus(protectedHomes.get(home));
  if (validHomeMarker(home))
    return confirmedStatus(readJsonOr(path.join(home, PROTECTED_MARKER)));
  return sameHome(checkedHomes.get(home), home) ||
    sameHome(readJsonOr(path.join(home, '.acl-status.json')), home)
    ? 'not confirmed'
    : 'not yet checked';
}

// --- the ZeroH home ----------------------------------------------------------

// Where ZeroH keeps its key, vaults, proxy state and reports: ZEROH_HOME, else
// ~/.zeroh on macOS and Linux and %LOCALAPPDATA%\ZeroH on Windows (local, not
// roamed with the profile).
export function zerohHome(
  env = process.env,
  homedir = os.homedir,
  platform = process.platform,
) {
  if (env.ZEROH_HOME) return env.ZEROH_HOME;
  if (platform === 'win32') {
    return path.win32.join(
      env.LOCALAPPDATA || path.win32.join(homedir(), 'AppData', 'Local'),
      'ZeroH',
    );
  }
  // A POSIX home, joined as POSIX whatever system asks.
  return path.posix.join(homedir(), '.zeroh');
}

// A path under the user's home written as ~/… in messages (D-15); any other
// path as it is.
export function displayPath(
  file,
  { homedir = os.homedir(), env = process.env } = {},
) {
  const home = path.resolve(env.HOME || homedir);
  const resolved = path.resolve(String(file));
  if (resolved === home) return '~';
  return resolved.startsWith(`${home}${path.sep}`)
    ? `~${path.sep}${resolved.slice(home.length + 1)}`
    : resolved;
}

// A Windows system program by its full path: Windows looks for a bare
// program name in the current folder first.
export function windowsSystemTool(name, env = process.env) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return path.win32.join(root, 'System32', name);
}

export { protectWindowsPath } from './windows-acl.js';

const PROTECTED_MARKER = '.acl-protected';
// The marker's content: a home an earlier build marked (whose own explicit
// entries it left in place) is protected again.
const PROTECTED_MARKER_VERSION = 3;

function readTextOr(file, fallback = null) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}
function validHomeMarker(home) {
  try {
    const fact = JSON.parse(readTextOr(path.join(home, PROTECTED_MARKER)));
    return fact?.version === PROTECTED_MARKER_VERSION && sameHome(fact, home);
  } catch {
    return false;
  }
}
const protectedHomes = new Map();
const checkedHomes = new Map();
function homeIdentity(home) {
  try {
    const realHome = realpathSync(home);
    const stat = lstatSync(realHome);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    return {
      home: realHome,
      dev: stat.dev,
      ino: stat.ino,
      birthtimeMs: stat.birthtimeMs,
    };
  } catch {
    return null;
  }
}
function sameHome(fact, home) {
  const actual = homeIdentity(home);
  return (
    actual &&
    fact &&
    Object.keys(actual).every((key) => actual[key] === fact[key])
  );
}
// Only loader preflight may confirm the home, before either hook worker exists.
// The status record is diagnostic only: it never suppresses a later attempt.
export function prepareWindowsHome({
  env = process.env,
  execute,
  timeout = 1800,
} = {}) {
  if (!isMainThread) return null;
  const home = path.resolve(zerohHome(env, os.homedir, 'win32'));
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const identity = homeIdentity(home);
  if (validHomeMarker(home)) {
    identity.fullApply =
      readJsonOr(path.join(home, PROTECTED_MARKER))?.fullApply === true;
    protectedHomes.set(home, identity);
    return identity;
  }
  checkedHomes.set(home, identity);
  if (
    !protectWindowsPath(home, {
      env,
      platform: 'win32',
      execute,
      timeout,
      onVerified: ({ fullApply }) => {
        identity.fullApply = fullApply;
      },
    }) ||
    !sameHome(identity, home)
  ) {
    try {
      writeFileSync(
        path.join(home, '.acl-status.json'),
        JSON.stringify(identity),
        { mode: 0o600 },
      );
    } catch {
      /* Diagnostic only. */
    }
    return null;
  }
  protectedHomes.set(home, identity);
  removeQuietly(path.join(home, '.acl-status.json'));
  try {
    writeFileSync(
      path.join(home, PROTECTED_MARKER),
      `${JSON.stringify({ version: PROTECTED_MARKER_VERSION, ...identity })}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* The next process re-verifies. */
  }
  return identity;
}

// Writes `data` to `file` atomically with `mode` (0600 unless the caller
// keeps an existing file's mode). With `durable` the data is flushed before
// the rename, so a power loss leaves the old file or the new one, never an
// empty one (the vault and Claude Code's settings; flushing costs time on
// Windows, so ledgers and routes skip it).
export function writePrivateFile(
  file,
  data,
  {
    mode = 0o600,
    durable = false,
    beforeRename = null,
    rename = renameSync,
    renameAttempts = 20,
    renameDelayMs = 50,
  } = {},
) {
  if (!sessionCanPersist(file)) return false;
  ensurePrivateDir(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', mode);
    try {
      writeFileSync(fd, data);
      if (durable) {
        try {
          fsyncSync(fd);
        } catch {
          // Some file systems (network shares) do not flush on request.
        }
      }
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(temporary, mode);
    } catch {
      // Windows does not implement POSIX modes.
    }
  } catch (error) {
    removeQuietly(temporary);
    throw error;
  }
  return renameWithRetry(temporary, file, {
    attempts: renameAttempts,
    delayMs: renameDelayMs,
    rename,
    beforeRename: ({ attempt }) =>
      beforeRename?.({ file, temporary, attempt }) ?? true,
  });
}

export function writePrivateJson(file, value, { pretty = true } = {}) {
  writePrivateFile(
    file,
    `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`,
  );
}

export function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// The parsed file, or `fallback` when it is missing or unreadable.
export function readJsonOr(file, fallback = null) {
  try {
    const value = readJsonFile(file);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

// Appends one line to a private log, keeping at most two files of about
// `limitBytes` (the older one ends in `.1`). Best effort: never throws.
export function appendPrivateLog(file, line, { limitBytes = 256 * 1024 } = {}) {
  try {
    ensurePrivateDir(path.dirname(file));
    try {
      if (statSync(file).size > limitBytes) renameSync(file, `${file}.1`);
    } catch {
      // No log yet.
    }
    appendFileSync(file, `${line}\n`, { mode: 0o600 });
  } catch {
    // Logging never fails the caller.
  }
}

export function removeQuietly(file) {
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
