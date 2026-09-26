// SPDX-License-Identifier: AGPL-3.0-only

// Private files: every file ZeroH writes is created with mode 0600 in a 0700
// directory, written to a temporary file and renamed into place, so a reader
// never sees half a file and a failed write keeps the previous version.
// Windows antivirus scanners and indexers briefly lock files, so the rename
// is retried there. Node built-ins only.
import { execFileSync } from 'node:child_process';
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
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

// Writing may fail for these reasons without anything being wrong with
// ZeroH itself: a read-only project, home or disk.
const NOT_WRITABLE = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT']);

export function notWritable(error) {
  return NOT_WRITABLE.has(error?.code);
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// `keepSource` is for moving a file aside (a backup): a failed move leaves
// it where it was instead of removing it.
export function renameWithRetry(
  from,
  to,
  { attempts = 20, delayMs = 50, rename = renameSync, keepSource = false } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error.code) || attempt >= attempts) {
        if (!keepSource) removeQuietly(from);
        throw error;
      }
      sleepSync(delayMs);
    }
  }
}

export function ensurePrivateDir(
  directory,
  { env = process.env, platform = process.platform, execute } = {},
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  protectZerohHome(directory, { env, platform, execute });
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
  return path.join(homedir(), '.zeroh');
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

// Windows ignores POSIX modes. The ZeroH home gets an ACL for the signed-in
// user and SYSTEM only, without inherited entries, which everything in it
// inherits, so a custom ZEROH_HOME on a shared drive is not readable by other
// accounts. Returns whether it was applied.
export function protectWindowsPath(
  target,
  {
    env = process.env,
    platform = process.platform,
    execute = execFileSync,
  } = {},
) {
  if (platform !== 'win32') return false;
  try {
    const csv = String(
      execute(
        windowsSystemTool('whoami.exe', env),
        ['/user', '/fo', 'csv', '/nh'],
        { encoding: 'utf8', windowsHide: true, env },
      ),
    );
    const sid = /"(S-1-[0-9-]+)"/u.exec(csv)?.[1];
    if (!sid) return false;
    execute(
      windowsSystemTool('icacls.exe', env),
      [
        target,
        '/inheritance:r',
        '/grant:r',
        `*${sid}:(OI)(CI)F`,
        '/grant:r',
        '*S-1-5-18:(OI)(CI)F',
      ],
      { stdio: 'ignore', windowsHide: true, env },
    );
    return true;
  } catch {
    return false;
  }
}

// On Windows, the first private write into the ZeroH home (by any part of
// ZeroH: the proxy, the vault, the registry of projects) protects the whole
// home before it holds anything, whoever created the folder; a marker file
// records it, so it is done once, and tried again by the next process when
// it failed. Everything under the home inherits the ACL.
const PROTECTED_MARKER = '.acl-protected';
const protectedHomes = new Set();
export function protectZerohHome(
  directory,
  { env = process.env, platform = process.platform, execute } = {},
) {
  if (platform !== 'win32') return false;
  const home = path.resolve(zerohHome(env, os.homedir, platform));
  const relative = path.relative(home, path.resolve(directory));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  if (protectedHomes.has(home)) return true;
  protectedHomes.add(home);
  const marker = path.join(home, PROTECTED_MARKER);
  if (existsSync(marker)) return true;
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (
    !protectWindowsPath(home, {
      env,
      platform,
      ...(execute ? { execute } : {}),
    })
  ) {
    return false;
  }
  try {
    writeFileSync(marker, '', { mode: 0o600 });
  } catch {
    // Applied again by the next process.
  }
  return true;
}

// Writes `data` to `file` atomically with `mode` (0600 unless the caller
// keeps an existing file's mode). With `durable` the data is flushed before
// the rename, so a power loss leaves the old file or the new one, never an
// empty one (the vault and Claude Code's settings; flushing costs time on
// Windows, so ledgers and routes skip it).
export function writePrivateFile(
  file,
  data,
  { mode = 0o600, durable = false } = {},
) {
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
  renameWithRetry(temporary, file);
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
