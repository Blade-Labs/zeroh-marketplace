// SPDX-License-Identifier: AGPL-3.0-only

// Local token vault, one file per project, encrypted with AES-256-GCM.
// Everything stays on this machine.
//
//   ~/.zeroh/vault.key                 32 random bytes, mode 0600
//   ~/.zeroh/vault/<project-hash>.json { v: 2, iv, tag, data } where data
//     decrypts to { entries, tombstones, meta }:
//     entries     token -> { type, value, source, first_seen, last_used, last_session }
//     tombstones  token -> { type, expired_at } (value-free record of an expired token)
//     meta        { epoch, retention } (epoch changes on `vault clear`; retention is
//                 the policy SessionStart saw through loadConfig)
//
// Version 1 files hold only the entries object and are read transparently.
//
// Retention runs only at lifecycle points (SessionStart, SessionEnd); ordinary
// saves from the proxy and the other hooks never prune. `vault clear` empties
// the vault under a new epoch.
//
// ZEROH_HOME moves the directory (tests, or a per-user location). The default
// is ~/.zeroh on macOS and Linux and %LOCALAPPDATA%\\ZeroH on Windows (not
// roamed with the profile). The key sits next to the data, so the vault
// protects against casual reads and accidental commits, not against someone
// with your user account.
//
// Failures carry a code, so every caller can say what to do:
//   ZEROH_VAULT_UNREADABLE   a vault file that does not decrypt or parse
//   ZEROH_VAULT_KEY_INVALID  a key that is not 32 bytes while vaults exist
//   ZEROH_VAULT_KEY_MISSING  no key while vaults exist (never silently
//                            replaced: a new key would orphan them)
//   ZEROH_VAULT_VERSION      a vault written by a newer ZeroH (never read or
//                            written by this one)
//   ZEROH_VAULT_IO           a vault file that could not be read at all
//                            (permissions, a lock): its contents are fine
// `zeroh-disclosure doctor --fix` resets the first three, for every project
// (resetVaults); the last two are left alone.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
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
  ensurePrivateDir,
  notWritable,
  removeQuietly,
  renameWithRetry,
  writePrivateFile,
  zerohHome,
} from './private-fs.js';
import { buildToken, keyedHash6 } from './tokens.js';
import { DOCTOR, DOCTOR_FIX } from './fix-command.js';

const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10_000;
// The vault lock is held for milliseconds. Waiting stays below the shortest
// hook timeout (MessageDisplay, 5 s), and a lock left by a killed hook is
// reclaimed as soon as its owner is gone or after ten seconds.
const VAULT_LOCK = { waitMs: 3_000, staleMs: 10_000, reclaimDeadOwner: true };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOUCH_INTERVAL_MS = HOUR_MS;
const SESSION_LEFTOVER_MS = DAY_MS;
const TOMBSTONE_MAX_AGE_MS = 90 * DAY_MS;
const RETENTION_MS = new Map([
  ['7d', 7 * DAY_MS],
  ['30d', 30 * DAY_MS],
]);

// The ZeroH home and the Windows ACL live with the private files.
export { protectWindowsPath, zerohHome } from './private-fs.js';

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

function vaultDirectory(env) {
  return path.join(zerohHome(env), 'vault');
}

// Project vaults on disk (backups of unreadable ones are not counted).
function vaultFiles(env) {
  try {
    return readdirSync(vaultDirectory(env)).filter((name) =>
      /^[0-9a-f]{16}\.json$/u.test(name),
    );
  } catch {
    return [];
  }
}

function readKeyFile(keyPath) {
  try {
    return readFileSync(keyPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
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

function loadKey(env = process.env) {
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

// The per-install key for token names (lib/tokens.js), derived from the vault
// key so it lives and dies with it. Tokens are HMACs under this key, so a token
// reveals nothing a guesser could check offline.
const tokenKeys = new Map();
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
    .update(path.resolve(projectRoot))
    .digest('hex')
    .slice(0, 16);
}

export class Vault {
  constructor(
    projectRoot,
    { hash = null, env = process.env, now = Date.now, sessionId = null } = {},
  ) {
    this.projectRoot = path.resolve(projectRoot || process.cwd());
    this.file = path.join(
      zerohHome(env),
      'vault',
      `${projectKey(this.projectRoot)}.json`,
    );
    this.entries = new Map();
    this.byValue = new Map();
    this.tombstones = new Map();
    this.meta = { epoch: null, retention: null };
    this.loadedEpoch = null;
    // Pending changes. Inserts carry values and are the only way a writer may
    // add an entry. Touches carry only use metadata, so a stale writer can
    // refresh an entry that still exists but can never bring one back.
    this.inserted = new Set();
    this.touches = new Map();
    this.sourceUpdates = new Map();
    this.knownSnapshot = null;
    // Null: keyed with this install's token key on first use (lib/tokens.js).
    this.hash = hash;
    this.env = env;
    this.now = now;
    this.sessionId = sessionId || null;
    this.load();
  }

  load() {
    if (!existsSync(this.file)) return;
    const state = readState(this.file, loadKey(this.env));
    const nowMs = this.nowMs();
    for (const [token, entry] of state.entries) {
      state.entries.set(token, normalizeEntry(entry, nowMs).entry);
    }
    this.tombstones = state.tombstones;
    this.meta = state.meta;
    this.loadedEpoch = state.meta.epoch ?? null;
    this.replaceEntries(state.entries);
  }

  replaceEntries(entries) {
    this.entries = new Map(entries);
    this.byValue = new Map();
    for (const [token, entry] of this.entries) {
      if (!this.byValue.has(entry.value)) this.byValue.set(entry.value, token);
    }
  }

  // Tokens that expired are never handed out again, so an old transcript can
  // never restore to a different value.
  // Values already in the vault keep their stored token (tokenFor and register
  // look the value up first), so tokens minted by an older, unkeyed version stay
  // valid; only values seen for the first time get a keyed token.
  nextToken(type, value, start = 0) {
    this.hash ??= keyedHash6(tokenHashKey(this.env));
    for (let attempt = start; ; attempt += 1) {
      const token = buildToken(type, value, attempt, this.hash);
      if (this.tombstones.has(token)) continue;
      const existing = this.entries.get(token);
      if (!existing || existing.value === value) return token;
    }
  }

  hasPendingChanges() {
    return (
      this.inserted.size > 0 ||
      this.touches.size > 0 ||
      this.sourceUpdates.size > 0 ||
      this.knownSnapshot !== null
    );
  }

  // Persist pending changes. Writes only when something changed. Pruning runs
  // only when `lifecycle` is given (SessionStart and SessionEnd):
  //   { event: 'start' | 'end', fresh, sessionId, retention }
  // `retention` (SessionStart only) is stored as the vault's policy; otherwise
  // the stored policy applies, falling back to this process's configuration.
  save({ lifecycle = null } = {}) {
    if (!this.hasPendingChanges() && (!lifecycle || !existsSync(this.file))) {
      return false;
    }
    ensurePrivateDir(path.dirname(this.file), { env: this.env });
    const lock = acquireFileLock(`${this.file}.lock`, VAULT_LOCK);
    try {
      const key = loadKey(this.env);
      const state = existsSync(this.file)
        ? readState(this.file, key)
        : emptyState();
      const nowMs = this.nowMs();
      const merged = state.entries;
      let changed = false;
      for (const [token, entry] of merged) {
        const normalized = normalizeEntry(entry, nowMs);
        if (normalized.changed) {
          merged.set(token, normalized.entry);
          changed = true;
        }
      }
      const sameEpoch = (state.meta.epoch ?? null) === this.loadedEpoch;
      for (const token of this.inserted) {
        const entry = this.entries.get(token);
        if (!entry) continue;
        const existing = merged.get(token);
        if (existing && existing.value !== entry.value) {
          throw conflictError(
            `ZeroH vault token ${token} was claimed by another writer`,
          );
        }
        if (!existing && state.tombstones.has(token)) {
          throw conflictError(
            `ZeroH vault token ${token} expired during this save`,
          );
        }
        const next = existing ? mergeTouch(existing, entry) : entry;
        if (next !== existing) {
          merged.set(token, next);
          changed = true;
        }
      }
      if (sameEpoch) {
        for (const [token, touch] of this.touches) {
          const existing = merged.get(token);
          if (!existing || existing.value !== this.entries.get(token)?.value) {
            continue;
          }
          const next = mergeTouch(existing, touch);
          if (next !== existing) {
            merged.set(token, next);
            changed = true;
          }
        }
        for (const [token, source] of this.sourceUpdates) {
          const entry = merged.get(token);
          if (entry && entry.value === this.entries.get(token)?.value) {
            if (entry.source !== source) {
              merged.set(token, { ...entry, source });
              changed = true;
            }
          }
        }
      }
      if (this.knownSnapshot) {
        for (const [token, entry] of merged) {
          const knownSource = this.knownSnapshot.get(entry.value);
          const source = knownSource
            ? knownSource
            : entry.source?.startsWith('known:')
              ? 'detected'
              : entry.source;
          if (source !== entry.source) {
            merged.set(token, { ...entry, source });
            changed = true;
          }
        }
      }
      let retention = state.meta.retention ?? null;
      if (lifecycle) {
        if (lifecycle.retention && lifecycle.retention !== retention) {
          retention = lifecycle.retention;
          changed = true;
        }
        const expiredAt = new Date(nowMs).toISOString();
        const pruned = pruneEntries(merged, {
          retention: retention ?? vaultRetention(this.env),
          nowMs,
          event: lifecycle.event,
          fresh: Boolean(lifecycle.fresh),
          sessionId: lifecycle.sessionId ?? this.sessionId,
        });
        for (const [token, entry] of pruned) {
          state.tombstones.set(token, {
            type: entry.type,
            expired_at: expiredAt,
          });
          changed = true;
        }
        for (const [token, tombstone] of state.tombstones) {
          const expiredMs = Date.parse(tombstone.expired_at);
          if (
            Number.isFinite(expiredMs) &&
            nowMs - expiredMs > TOMBSTONE_MAX_AGE_MS
          ) {
            state.tombstones.delete(token);
            changed = true;
          }
        }
      }
      let epoch = state.meta.epoch ?? null;
      if (changed && !epoch) epoch = newEpoch();
      if (changed) {
        writeState(
          this.file,
          this.projectRoot,
          { entries: merged, tombstones: state.tombstones, epoch, retention },
          key,
        );
      }
      this.tombstones = state.tombstones;
      this.meta = { epoch, retention };
      this.loadedEpoch = epoch;
      this.replaceEntries(merged);
      this.resetPending();
      return changed;
    } finally {
      releaseFileLock(lock);
    }
  }

  record(token, entry) {
    this.entries.set(token, entry);
    this.inserted.add(token);
    // A reported miss may re-record a value another writer already holds
    // under a different source; the reported source must still reach disk.
    if (isReportedSource(entry.source))
      this.sourceUpdates.set(token, entry.source);
    if (!this.byValue.has(entry.value)) this.byValue.set(entry.value, token);
    return token;
  }

  timestamp() {
    return new Date(this.nowMs()).toISOString();
  }

  nowMs() {
    const value = this.now();
    return value instanceof Date ? value.getTime() : Number(value);
  }

  // Record a use. `last_used` is refreshed at most once per hour, so a use
  // within the hour is not a change and costs no write. The first use by a
  // different session records that session as `last_session`.
  touch(token, source) {
    const entry = this.entries.get(token);
    if (!entry) return null;
    // known: wins over everything; a reported miss stays reported so it keeps
    // being matched as a value even though no detector recognises its shape.
    const nextSource = source?.startsWith('known:')
      ? source
      : entry.source?.startsWith('known:')
        ? entry.source
        : isReportedSource(entry.source) && !isReportedSource(source)
          ? entry.source
          : source || entry.source;
    const nowMs = this.nowMs();
    const refresh =
      nowMs - entryTime(entry.last_used, nowMs) >= TOUCH_INTERVAL_MS;
    const sessionChanged =
      Boolean(this.sessionId) && entry.last_session !== this.sessionId;
    const updated = {
      ...entry,
      source: nextSource,
      ...(refresh ? { last_used: new Date(nowMs).toISOString() } : {}),
      ...(sessionChanged ? { last_session: this.sessionId } : {}),
    };
    this.entries.set(token, updated);
    if (!this.inserted.has(token) && (refresh || sessionChanged)) {
      this.touches.set(token, {
        last_used: updated.last_used,
        ...(this.sessionId ? { last_session: this.sessionId } : {}),
      });
    }
    if (
      (source?.startsWith('known:') || isReportedSource(source)) &&
      entry.source !== nextSource
    ) {
      this.sourceUpdates.set(token, nextSource);
    }
    return updated;
  }

  // Returns the token for a value, registering it on first sight.
  tokenFor(type, value, source = 'detected') {
    const known = this.byValue.get(value);
    if (known) {
      this.touch(known, source);
      return known;
    }
    const token = this.nextToken(type, value);
    return this.record(token, this.newEntry(type, value, source));
  }

  newEntry(type, value, source) {
    const now = this.timestamp();
    return {
      type,
      value,
      source,
      first_seen: now,
      last_used: now,
      ...(this.sessionId ? { last_session: this.sessionId } : {}),
    };
  }

  // Record a token another component already chose (the prompt policy engine),
  // so a later restore resolves exactly that token. A conflicting or expired
  // token gets a deterministic suffix-derived alternative instead.
  register(token, type, value, source = 'prompt') {
    const known = this.byValue.get(value);
    if (known) {
      this.touch(known, source);
      return known;
    }
    const existing = this.entries.get(token);
    const selected =
      (!existing && !this.tombstones.has(token)) || existing?.value === value
        ? token
        : this.nextToken(type, value, 1);
    return this.record(selected, this.newEntry(type, value, source));
  }

  // Re-read known values at SessionStart. Entries whose concrete value is no
  // longer present become ordinary detected values without refreshing their
  // last-use time, so the normal retention clock can age them out.
  refreshKnown(known) {
    this.knownSnapshot = new Map(
      known.map((entry) => [entry.value, `known:${entry.name}`]),
    );
    for (const entry of known) {
      this.tokenFor(entry.type, entry.value, `known:${entry.name}`);
    }
    for (const [token, entry] of this.entries) {
      if (
        !entry.source?.startsWith('known:') ||
        this.knownSnapshot.has(entry.value)
      ) {
        continue;
      }
      this.entries.set(token, { ...entry, source: 'detected' });
    }
  }

  // Remove every mapping now. The vault is rewritten empty under a new epoch,
  // so a writer that loaded earlier can add only values it detected itself.
  // Cleared tokens become value-free tombstones.
  clear() {
    removeBackupsOf(this.file);
    if (!existsSync(this.file)) {
      this.resetPending();
      this.replaceEntries(new Map());
      return false;
    }
    ensurePrivateDir(path.dirname(this.file), { env: this.env });
    const lock = acquireFileLock(`${this.file}.lock`, VAULT_LOCK);
    try {
      const key = loadKey(this.env);
      let state;
      try {
        state = readState(this.file, key);
      } catch (error) {
        // A newer vault is never written over; an unreadable one is
        // replaced by an empty one (it still holds the values).
        if (error.code !== 'ZEROH_VAULT_UNREADABLE') throw error;
        state = emptyState();
      }
      const expiredAt = this.timestamp();
      for (const [token, entry] of state.entries) {
        state.tombstones.set(token, {
          type: entry.type,
          expired_at: expiredAt,
        });
      }
      const epoch = newEpoch();
      const retention = state.meta.retention ?? null;
      writeState(
        this.file,
        this.projectRoot,
        { entries: new Map(), tombstones: state.tombstones, epoch, retention },
        key,
      );
      this.tombstones = state.tombstones;
      this.meta = { epoch, retention };
      this.loadedEpoch = epoch;
      this.resetPending();
      this.replaceEntries(new Map());
      return true;
    } finally {
      releaseFileLock(lock);
    }
  }

  resetPending() {
    this.inserted.clear();
    this.touches.clear();
    this.sourceUpdates.clear();
    this.knownSnapshot = null;
  }

  // Read-only aggregates. Never contains a value.
  status() {
    const countsByType = {};
    let oldestAgeMs = null;
    const nowMs = this.nowMs();
    for (const entry of this.entries.values()) {
      countsByType[entry.type] = (countsByType[entry.type] || 0) + 1;
      const ageMs = Math.max(0, nowMs - entryTime(entry.last_used, nowMs));
      oldestAgeMs = oldestAgeMs === null ? ageMs : Math.max(oldestAgeMs, ageMs);
    }
    return {
      retention: this.meta.retention ?? vaultRetention(this.env),
      retention_source: this.meta.retention ? 'vault' : 'configuration',
      total: this.entries.size,
      counts_by_type: Object.fromEntries(
        Object.entries(countsByType).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      oldest_last_use_age_ms: oldestAgeMs,
      expired_tokens: this.tombstones.size,
    };
  }

  // The value-free record of a token that expired, or null.
  tombstoneOf(token) {
    if (this.entries.has(token)) return null;
    return this.tombstones.get(token) ?? null;
  }

  valueOf(token) {
    return this.touch(token)?.value ?? null;
  }

  entryOf(token) {
    return this.touch(token);
  }

  // Persisted values reported after a detector miss must be searchable by the
  // hooks and proxy even when their shape still matches no detector rule.
  knownValues() {
    return [...this.entries.entries()].map(([token, entry]) => ({
      token,
      ...entry,
    }));
  }

  get size() {
    return this.entries.size;
  }
}

// Moves a file aside as `<name>.unreadable-<time>`, mode 0600. Null when
// it was already gone.
function moveAside(file, now) {
  const target = `${file}.unreadable-${now.toISOString().replace(/[:.]/gu, '-')}`;
  try {
    renameWithRetry(file, target, { keepSource: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    chmodSync(target, 0o600);
  } catch {
    // Windows: the home's ACL applies.
  }
  return target;
}

// Copies of a vault file that an earlier build or `doctor --fix
// --keep-backups` kept beside it: they hold its values, so `vault clear`
// removes them too.
function removeBackupsOf(file) {
  const prefix = `${path.basename(file)}.unreadable-`;
  try {
    for (const name of readdirSync(path.dirname(file))) {
      if (name.startsWith(prefix)) {
        removeQuietly(path.join(path.dirname(file), name));
      }
    }
  } catch {
    // No vault folder yet.
  }
}

function vaultFileProject(name) {
  return name.replace(/\.json$/u, '');
}

// The state of one vault file under `key`: 'ok', 'unreadable' (does not
// parse or decrypt), 'newer' (a newer ZeroH wrote it) or 'io' (the file
// could not be read at all: permissions, a lock; nothing is wrong with it).
function vaultFileState(file, key) {
  try {
    readState(file, key);
    return { state: 'ok' };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return {
      state:
        {
          ZEROH_VAULT_UNREADABLE: 'unreadable',
          ZEROH_VAULT_VERSION: 'newer',
        }[error.code] || 'io',
      code: error.cause?.code || error.code,
    };
  }
}

// `doctor`: the vault key and every project vault under ZEROH_HOME, whatever
// folder it runs in (a key problem affects every project; RB-2). `key` is
// 'ok', 'none' (nothing made yet), 'missing', 'damaged' or 'io'; each vault
// names its project key (projectKey of the root) and its state.
export function checkVaults({ env = process.env } = {}) {
  const names = vaultFiles(env);
  let key;
  let keyState;
  try {
    key = readKeyFile(path.join(zerohHome(env), 'vault.key'));
    keyState = key === null ? (names.length ? 'missing' : 'none') : 'ok';
    if (key && key.length !== 32) keyState = names.length ? 'damaged' : 'ok';
  } catch (error) {
    return { key: 'io', code: error.code, vaults: [] };
  }
  const vaults = [];
  for (const name of names) {
    const file = path.join(vaultDirectory(env), name);
    const project = vaultFileProject(name);
    if (keyState !== 'ok') {
      vaults.push({ file, project, state: 'unreadable' });
      continue;
    }
    const state = vaultFileState(file, key);
    if (state) vaults.push({ file, project, ...state });
  }
  return { key: keyState, vaults };
}

// `doctor --fix` and `vault clear` for vaults that cannot be used (D-10: one
// obvious recovery). A missing or damaged key makes every project vault
// unreadable: all of them and the old key go, and a new key is made. Else
// each vault that does not decrypt goes (with `projectRoot`, only that
// project's), and the project starts an empty vault. A vault from a newer
// ZeroH (the fix is a plugin update) and one that could not be read at all
// ('io') are left alone. The files that go still decrypt with the old key and
// hold the values, so they are deleted once the reset worked; with
// `keepBackups` they are kept as <name>.unreadable-<time>, mode 0600.
export function resetVaults({
  env = process.env,
  projectRoot = null,
  keepBackups = false,
  now = new Date(),
} = {}) {
  const found = checkVaults({ env });
  const only = projectRoot ? projectKey(path.resolve(projectRoot)) : null;
  const keyReset = found.key === 'missing' || found.key === 'damaged';
  const targets = found.vaults.filter(
    (vault) =>
      vault.state === 'unreadable' &&
      (keyReset || !only || vault.project === only),
  );
  const moved = [];
  for (const vault of targets) {
    const aside = moveAside(vault.file, now);
    if (aside) moved.push({ project: vault.project, file: aside });
  }
  let keyAside = null;
  if (keyReset) {
    keyAside = moveAside(path.join(zerohHome(env), 'vault.key'), now);
    tokenKeys.delete(path.resolve(zerohHome(env)));
    loadKey(env);
  }
  const backups = [...moved.map(({ file }) => file), keyAside].filter(Boolean);
  if (!keepBackups) for (const file of backups) removeQuietly(file);
  return {
    key: keyReset ? found.key : null,
    reset: moved.map(({ project }) => project),
    backups: keepBackups ? backups : [],
    left: found.vaults.filter((vault) => ['newer', 'io'].includes(vault.state)),
  };
}

// A token that another writer holds for a different value. Callers must not
// hand out the token, so this is never swallowed by saveQuietly.
function conflictError(message) {
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

export function vaultRetention(env = process.env) {
  const configured = String(env.ZEROH_VAULT_RETENTION || '7d').toLowerCase();
  return configured === 'session' || RETENTION_MS.has(configured)
    ? configured
    : '7d';
}

// Remove detected entries the policy no longer keeps and return them. Known
// values (.env, credential files) never expire here.
function pruneEntries(entries, { retention, nowMs, event, fresh, sessionId }) {
  const removed = [];
  const maxAgeMs = RETENTION_MS.get(retention) ?? RETENTION_MS.get('7d');
  for (const [token, entry] of entries) {
    // Known values and values the user reported as a detector miss are kept
    // until they are removed explicitly (vault clear, which tombstones them);
    // expiring a reported value would silently let it through unmasked again.
    if (entry.source?.startsWith('known:') || isReportedSource(entry.source))
      continue;
    const ageMs = nowMs - entryTime(entry.last_used, nowMs);
    let expired;
    if (retention === 'session') {
      expired =
        (event === 'end' &&
          Boolean(sessionId) &&
          entry.last_session === sessionId) ||
        (event === 'start' && fresh && ageMs > SESSION_LEFTOVER_MS);
    } else {
      expired = ageMs > maxAgeMs;
    }
    if (expired) {
      entries.delete(token);
      removed.push([token, entry]);
    }
  }
  return removed;
}

function isReportedSource(source) {
  return typeof source === 'string' && source.startsWith('reported:');
}

// Timestamps in the future (clock set back) read as now; invalid ones too.
function entryTime(value, nowMs) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms <= nowMs ? ms : nowMs;
}

function normalizeEntry(entry, nowMs) {
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
function mergeTouch(existing, touch) {
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

function newEpoch() {
  return randomBytes(8).toString('hex');
}

function emptyState() {
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
function readState(file, key) {
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

function writeState(
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

// A lock whose owning process no longer exists on this machine (a hook killed
// at its timeout) can be taken over at once.
function lockOwnerGone(file) {
  let pid;
  try {
    pid = Number.parseInt(readFileSync(file, 'utf8'), 10);
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

export function acquireFileLock(
  file,
  {
    waitMs = LOCK_WAIT_MS,
    staleMs = LOCK_STALE_MS,
    reclaimDeadOwner = false,
  } = {},
) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      writeFileSync(fd, `${process.pid}\n`);
      return { fd, file };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (
          Date.now() - statSync(file).mtimeMs > staleMs ||
          (reclaimDeadOwner && lockOwnerGone(file))
        ) {
          unlinkSync(file);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
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
