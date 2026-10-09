// SPDX-License-Identifier: AGPL-3.0-only

import { defaultMatchScope } from './match-scope.js';
// Project-scoped token mappings and in-memory vault behavior.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensurePrivateDir, zerohHome } from '../private-fs.js';
import { buildToken, keyedHash6 } from '../tokens.js';
import {
  acquireFileLock,
  conflictError,
  emptyState,
  entryTime,
  isReportedSource,
  loadKey,
  mergeTouch,
  newEpoch,
  normalizeEntry,
  projectKey,
  readState,
  releaseFileLock,
  tokenHashKey,
  VAULT_LOCK,
  writeState,
} from './store.js';
import { pruneEntries, removeBackupsOf, vaultRetention } from './lifecycle.js';

const HOUR_MS = 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = HOUR_MS;
const TOMBSTONE_MAX_AGE_MS = 90 * 24 * HOUR_MS;

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
    // Null: keyed with this install's token key on first use (packages/zeroh-disclosure-core/tokens.js).
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
        const result = applyLifecycle({
          state,
          entries: merged,
          lifecycle,
          retention,
          nowMs,
          env: this.env,
          sessionId: this.sessionId,
        });
        retention = result.retention;
        changed ||= result.changed;
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
  tokenFor(type, value, source = 'detected', { matchScope } = {}) {
    const known = this.byValue.get(value);
    if (known) {
      this.touch(known, source);
      return known;
    }
    const token = this.nextToken(type, value);
    return this.record(token, this.newEntry(type, value, source, matchScope));
  }

  newEntry(type, value, source, matchScope) {
    if (
      matchScope !== undefined &&
      !['bare', 'in-context'].includes(matchScope)
    )
      throw new TypeError('Invalid vault matchScope');
    const now = this.timestamp();
    return {
      type,
      value,
      source,
      matchScope: matchScope ?? defaultMatchScope({ type, value, source }),
      first_seen: now,
      last_used: now,
      ...(this.sessionId ? { last_session: this.sessionId } : {}),
    };
  }

  // Record a token another component already chose (the prompt policy engine),
  // so a later restore resolves exactly that token. A conflicting or expired
  // token gets a deterministic suffix-derived alternative instead.
  register(token, type, value, source = 'prompt', { matchScope } = {}) {
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
    return this.record(
      selected,
      this.newEntry(type, value, source, matchScope),
    );
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

function applyLifecycle({
  state,
  entries,
  lifecycle,
  retention: storedRetention,
  nowMs,
  env,
  sessionId,
}) {
  let retention = storedRetention;
  let changed = false;
  if (lifecycle.retention && lifecycle.retention !== retention) {
    retention = lifecycle.retention;
    changed = true;
  }
  const expiredAt = new Date(nowMs).toISOString();
  const pruned = pruneEntries(entries, {
    retention: retention ?? vaultRetention(env),
    nowMs,
    event: lifecycle.event,
    fresh: Boolean(lifecycle.fresh),
    sessionId: lifecycle.sessionId ?? sessionId,
  });
  for (const [token, entry] of pruned) {
    state.tombstones.set(token, { type: entry.type, expired_at: expiredAt });
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
  return { retention, changed };
}
