// SPDX-License-Identifier: AGPL-3.0-only

// Vault retention, reset and doctor lifecycle operations.
import { chmodSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { removeQuietly, renameWithRetry, zerohHome } from '../private-fs.js';
import {
  entryTime,
  loadKey,
  isReportedSource,
  projectKey,
  readKeyFile,
  readState,
  tokenKeys,
  vaultDirectory,
  vaultFiles,
} from './store.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TOUCH_INTERVAL_MS = HOUR_MS;
const SESSION_LEFTOVER_MS = DAY_MS;
const TOMBSTONE_MAX_AGE_MS = 90 * DAY_MS;
const RETENTION_MS = new Map([
  ['7d', 7 * DAY_MS],
  ['30d', 30 * DAY_MS],
]);

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
export function removeBackupsOf(file) {
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

export function vaultRetention(env = process.env) {
  const configured = String(env.ZEROH_VAULT_RETENTION || '7d').toLowerCase();
  return configured === 'session' || RETENTION_MS.has(configured)
    ? configured
    : '7d';
}

// Remove detected entries the policy no longer keeps and return them. Known
// values (.env, credential files) never expire here.
export function pruneEntries(
  entries,
  { retention, nowMs, event, fresh, sessionId },
) {
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
