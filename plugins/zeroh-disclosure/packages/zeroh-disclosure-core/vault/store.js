// SPDX-License-Identifier: AGPL-3.0-only

// Encrypted vault persistence, key management and cross-process locking.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  canonicalProjectPath,
  ensurePrivateDir,
  notWritable,
  renameWithRetry,
  writePrivateFile,
  zerohHome,
} from '../private-fs.js';
import { DOCTOR, DOCTOR_FIX } from '../fix-command.js';

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
// The vault lock is held for milliseconds. Waiting stays well below the
// shortest hook deadline (MessageDisplay: its 5 s timeout minus the loader's
// 2 s, hooks/fail-closed.js), so a held lock is reported by the hook itself,
// not by the watchdog; a lock left by a killed hook is reclaimed as soon as
// its owner is gone or after ten seconds.
export const VAULT_LOCK = {
  waitMs: 2_000,
  staleMs: 10_000,
  reclaimDeadOwner: true,
};

export const VAULT_VERSION = 2;

export function vaultError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// True for the failures that mean "this project's vault cannot be used".
export function isVaultError(error) {
  return /^ZEROH_VAULT_(?:UNREADABLE|KEY_INVALID|KEY_MISSING|VERSION|IO)$/u.test(
    String(error?.code || ''),
  );
}

// What the user reads about a vault failure, and the one fix.
export function vaultProblem(error) {
  if (error?.code === 'ZEROH_VAULT_VERSION') {
    return {
      reason: 'it was written by a newer version of ZeroH Disclosure',
      fix: 'Update the ZeroH Disclosure plugin (the newer vault is left untouched).',
    };
  }
  if (error?.code === 'ZEROH_VAULT_IO' || !isVaultError(error)) {
    return {
      reason: `it could not be read (${error?.cause?.code || error?.code || 'error'})`,
      fix: `Check that the vault file is not locked or unreadable for your account, or run ${DOCTOR()} to see which file it is.`,
    };
  }
  const reason =
    {
      ZEROH_VAULT_KEY_MISSING: 'its key file is missing',
      ZEROH_VAULT_KEY_INVALID: 'its key file is damaged',
    }[error.code] || 'the vault file is damaged';
  return {
    reason,
    fix: `Run ${DOCTOR_FIX()}: it resets the vault that cannot be read and starts a new one (tokens from earlier sessions then stay tokens).`,
  };
}

export function vaultDirectory(env) {
  return path.join(zerohHome(env), 'vault');
}

// Project vaults on disk (backups of unreadable ones are not counted).
export function vaultFiles(env) {
  try {
    return readdirSync(vaultDirectory(env)).filter((name) =>
      /^[0-9a-f]{16}\.json$/u.test(name),
    );
  } catch {
    return [];
  }
}

export function readKeyFile(keyPath) {
  try {
    return readFileSync(keyPath);
  } catch (error) {
    if (
      error.code === 'ENOENT' ||
      (process.platform === 'win32' &&
        ['ENOTDIR', 'ENODEV', 'ENXIO'].includes(error.code))
    )
      return null;
    throw error;
  }
}

// Creates the key atomically: 32 bytes are written and flushed to a private
// temporary file, which is then linked into place. A crash or a full disk
// leaves at most a stray temporary file, never a short key; a concurrent
// creator that wins the link is used by everyone.
export function createKeyFile(keyPath, env = process.env) {
  const temporary = `${keyPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const bytes = randomBytes(32);
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporary, keyPath);
    } catch (error) {
      if (error.code === 'EEXIST') return readKeyFile(keyPath);
      // A file system without hard links (FAT, some network drives).
      if (!['EPERM', 'ENOTSUP', 'ENOSYS', 'EXDEV'].includes(error.code)) {
        throw error;
      }
      try {
        writeFileSync(keyPath, bytes, { mode: 0o600, flag: 'wx' });
      } catch (writeError) {
        if (writeError.code === 'EEXIST') return readKeyFile(keyPath);
        throw writeError;
      }
    }
    return bytes;
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // Already gone.
    }
  }
}

// A home that can't be written has no key yet: this process masks with a
// key of its own, and nothing it tokenizes can be saved (the vault save fails
// and the hooks say so).
const unsavedKeys = new Map();

export function loadKey(env = process.env) {
  const home = zerohHome(env);
  const keyPath = path.join(home, 'vault.key');
  let key = readKeyFile(keyPath);
  if (key?.length === 32) return key;
  try {
    ensurePrivateDir(home, { env });
    return createOrRepairKey(keyPath, key, env);
  } catch (error) {
    if (!notWritable(error) || key !== null) throw error;
    const resolved = path.resolve(home);
    if (!unsavedKeys.has(resolved)) unsavedKeys.set(resolved, randomBytes(32));
    return unsavedKeys.get(resolved);
  }
}

function createOrRepairKey(keyPath, key, env) {
  if (vaultFiles(env).length) {
    // Another process may have made the key since this one looked, and
    // saved a vault with it (parallel first use; ensurePrivateDir's ACL takes
    // a moment on Windows). A vault is saved only after its key is in place,
    // so the key read after seeing the vault is the one it used.
    const current = readKeyFile(keyPath);
    if (current?.length === 32) return current;
    key = current;
    // A new key would make every existing vault unreadable for good.
    throw key === null
      ? vaultError(
          'ZEROH_VAULT_KEY_MISSING',
          `ZeroH vault key ${keyPath} is missing`,
        )
      : vaultError(
          'ZEROH_VAULT_KEY_INVALID',
          `ZeroH vault key ${keyPath} is not 32 bytes`,
        );
  }
  if (key === null) {
    key = createKeyFile(keyPath, env);
    if (key?.length === 32) return key;
  }
  // A short key (an interrupted first write) with nothing encrypted under
  // it yet: replace it, once, under a lock.
  const lock = acquireFileLock(`${keyPath}.lock`, VAULT_LOCK);
  try {
    key = readKeyFile(keyPath);
    if (key?.length === 32) return key;
    if (key !== null) unlinkSync(keyPath);
    key = createKeyFile(keyPath, env);
  } finally {
    releaseFileLock(lock);
  }
  if (key?.length !== 32) {
    throw vaultError(
      'ZEROH_VAULT_KEY_INVALID',
      `ZeroH vault key ${keyPath} is not 32 bytes`,
    );
  }
  return key;
}

// The per-install key for token names (packages/zeroh-disclosure-core/tokens.js), derived from the vault
// key so it lives and dies with it. Tokens are HMACs under this key, so a token
// reveals nothing a guesser could check offline.
export const tokenKeys = new Map();
export function tokenHashKey(env = process.env) {
  const home = path.resolve(zerohHome(env));
  let key = tokenKeys.get(home);
  if (!key) {
    key = createHmac('sha256', loadKey(env))
      .update('zeroh-disclosure token names v1')
      .digest();
    tokenKeys.set(home, key);
  }
  return key;
}

export function projectKey(projectRoot) {
  return createHash('sha256')
    .update(canonicalProjectPath(projectRoot))
    .digest('hex')
    .slice(0, 16);
}

export function conflictError(message) {
  const error = new Error(message);
  error.code = 'ZEROH_VAULT_CONFLICT';
  return error;
}

// Save from a hot path (tool hooks, display, proxy). Bookkeeping must never
// block masking or restore, so a lock timeout or I/O failure is reported on
// stderr and swallowed. A token conflict still throws.
export function saveQuietly(vault, label = 'ZeroH Disclosure') {
  try {
    vault.save();
    return true;
  } catch (error) {
    if (error.code === 'ZEROH_VAULT_CONFLICT') throw error;
    try {
      process.stderr.write(
        `${label}: could not update the vault (${error.message}).\n`,
      );
    } catch {
      /* stderr is best effort */
    }
    return false;
  }
}

export function isReportedSource(source) {
  return typeof source === 'string' && source.startsWith('reported:');
}

// Timestamps in the future (clock set back) read as now; invalid ones too.
export function entryTime(value, nowMs) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= nowMs ? ms : nowMs;
}

export function normalizeEntry(entry, nowMs) {
  let out = entry;
  for (const field of ['last_used', 'first_seen']) {
    if (field === 'first_seen' && entry.first_seen === undefined) continue;
    const ms = Date.parse(entry[field]);
    if (Number.isFinite(ms) && ms <= nowMs) continue;
    if (out === entry) out = { ...entry };
    out[field] = new Date(nowMs).toISOString();
  }
  return { entry: out, changed: out !== entry };
}

// Apply use metadata to an entry already on disk. Returns `existing` when
// nothing changes.
export function mergeTouch(existing, touch) {
  const existingMs = Date.parse(existing.last_used);
  const touchMs = Date.parse(touch.last_used);
  const lastUsed =
    Number.isFinite(touchMs) && touchMs > existingMs
      ? touch.last_used
      : existing.last_used;
  const lastSession = touch.last_session ?? existing.last_session;
  if (
    lastUsed === existing.last_used &&
    lastSession === existing.last_session
  ) {
    return existing;
  }
  return {
    ...existing,
    last_used: lastUsed,
    ...(lastSession ? { last_session: lastSession } : {}),
  };
}

export function newEpoch() {
  return randomBytes(8).toString('hex');
}

export function emptyState() {
  return {
    entries: new Map(),
    tombstones: new Map(),
    meta: { epoch: null, retention: null },
  };
}

// A vault file's text. A file that is briefly locked (an antivirus scanner,
// an indexer) is read again; one that still can't be read is an I/O failure
// (ZEROH_VAULT_IO), never "unreadable": nothing is wrong with its contents,
// so doctor --fix never resets it.
const IO_RETRY_CODES = new Set(['EBUSY', 'EAGAIN', 'EPERM', 'EACCES']);
function readVaultText(file) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw error;
      if (IO_RETRY_CODES.has(error.code) && attempt < 5) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
        continue;
      }
      const failure = vaultError(
        'ZEROH_VAULT_IO',
        `ZeroH vault ${file} could not be read (${error.code || 'error'})`,
      );
      failure.cause = error;
      throw failure;
    }
  }
}

// Reads a vault file. Only versions 1 (no `v`, or `v: 1`) and 2 are
// understood: a newer file is refused before it is decrypted, and never
// written over, so an older copy running next to a newer one cannot drop what
// it does not know (tombstones, above all).
export function readState(file, key) {
  const text = readVaultText(file);
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw vaultError(
      'ZEROH_VAULT_UNREADABLE',
      `ZeroH vault ${file} is not readable (invalid JSON)`,
    );
  }
  const version = raw?.v ?? 1;
  if (version !== 1 && version !== VAULT_VERSION) {
    throw vaultError(
      'ZEROH_VAULT_VERSION',
      `ZeroH vault ${file} was written by a newer ZeroH Disclosure (format ${JSON.stringify(version)}); update the plugin`,
    );
  }
  let plain;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(raw.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
    plain = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(raw.data, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    );
    if (!plain || typeof plain !== 'object') throw new Error('not an object');
  } catch {
    throw vaultError(
      'ZEROH_VAULT_UNREADABLE',
      `ZeroH vault ${file} does not decrypt with this machine's key`,
    );
  }
  if (version === 1) {
    return { ...emptyState(), entries: new Map(Object.entries(plain)) };
  }
  return {
    entries: new Map(Object.entries(plain.entries || {})),
    tombstones: new Map(Object.entries(plain.tombstones || {})),
    meta: {
      epoch: plain.meta?.epoch ?? null,
      retention: plain.meta?.retention ?? null,
    },
  };
}

export function writeState(
  file,
  projectRoot,
  { entries, tombstones, epoch, retention },
  key,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = {
    entries: Object.fromEntries(entries),
    tombstones: Object.fromEntries(tombstones),
    meta: { epoch, retention },
  };
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const body = JSON.stringify({
    v: VAULT_VERSION,
    project: projectRoot,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
  writePrivateFile(file, body, { durable: true });
}

export function fileLockOwnerText(pid = process.pid) {
  return `${pid}\n`;
}

// A lock whose owning process no longer exists on this machine (a hook killed
// at its timeout) can be taken over at once.
function lockOwnerGone(file) {
  let pid;
  try {
    const owner = readFileSync(file, 'utf8').trim();
    // Removal locks contain a nonce, which can begin with digits. Only a
    // complete numeric owner is a PID eligible for dead-owner reclamation.
    if (!/^[0-9]+$/u.test(owner)) return false;
    pid = Number(owner);
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

// Whether `file` is there, a file being deleted included (Windows answers
// EPERM for one).
function lockFilePresent(file) {
  try {
    statSync(file);
    return true;
  } catch (error) {
    return error.code !== 'ENOENT';
  }
}

export function acquireFileLock(
  file,
  {
    waitMs = LOCK_WAIT_MS,
    deadlineMs = Date.now() + waitMs,
    staleMs = LOCK_STALE_MS,
    reclaimDeadOwner = false,
  } = {},
) {
  const deadline = deadlineMs;
  const ownerText = fileLockOwnerText();
  let nextOwnerCheck = 0;
  // Best effort: tidying retired lock files must never stop a lock (Windows
  // antivirus can hold one briefly and fail the unlink with EPERM).
  try {
    for (const name of readdirSync(path.dirname(file))) {
      if (!name.startsWith(`${path.basename(file)}.stale-`)) continue;
      const retired = path.join(path.dirname(file), name);
      try {
        if (Date.now() - statSync(retired).mtimeMs > staleMs)
          unlinkSync(retired);
      } catch {
        // left for the next acquisition
      }
    }
  } catch {
    // no directory yet, or not readable: nothing to tidy
  }
  for (;;) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      writeFileSync(fd, ownerText);
      return { fd, file };
    } catch (error) {
      // Windows refuses to create a file another process is still deleting
      // (the previous holder's release) with EPERM, not EEXIST: busy too,
      // until the deadline. Delete-pending files can already be invisible to
      // stat while creation still fails. Give that case the same bounded
      // wait; a genuinely unwritable folder still throws EPERM at the end.
      if (
        error.code === 'EPERM' &&
        process.platform === 'win32' &&
        Date.now() < deadline
      ) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      if (error.code !== 'EEXIST') throw error;
      try {
        const now = Date.now();
        const judged = statSync(file);
        const stale = now - judged.mtimeMs > staleMs;
        const checkOwner = reclaimDeadOwner && now >= nextOwnerCheck;
        if (checkOwner) nextOwnerCheck = now + 1_000;
        if (stale || (checkOwner && lockOwnerGone(file))) {
          const retired = `${file}.stale-${process.pid}-${randomBytes(8).toString('hex')}`;
          renameWithRetry(file, retired, { attempts: 1, keepSource: true });
          const moved = statSync(retired);
          if (moved.ino !== judged.ino || moved.mtimeMs !== judged.mtimeMs) {
            try {
              linkSync(retired, file);
              unlinkSync(retired);
            } catch (restoreError) {
              if (restoreError.code !== 'EEXIST' && !lockFilePresent(file)) {
                try {
                  renameWithRetry(retired, file, {
                    attempts: 1,
                    keepSource: true,
                  });
                } catch {
                  throw new Error(
                    `Timed out waiting for ZeroH vault lock ${file}`,
                  );
                }
              }
            }
            continue;
          }
          unlinkSync(retired);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        // EEXIST from open does not guarantee metadata stays readable: the
        // previous holder can release the lock before stat, while Windows
        // still holds a delete-pending or scanner handle. Treat this as busy
        // under the same deadline as creation, rather than dropping a caller's
        // best-effort ledger increment. Never retire an unjudged lock.
        if (
          process.platform === 'win32' &&
          ['EPERM', 'EACCES', 'EBUSY'].includes(statError.code) &&
          Date.now() < deadline
        ) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for ZeroH vault lock ${file}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

export function releaseFileLock({ fd, file }) {
  try {
    closeSync(fd);
  } finally {
    try {
      unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
