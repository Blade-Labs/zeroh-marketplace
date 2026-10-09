// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable camelcase -- persisted uninstall marker fields are snake_case */
// Atomic parent-to-child uninstall ownership shared by hooks and statusline.
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from './child-process.js';
import { isMainThread, workerData } from 'node:worker_threads';
import {
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePrivateFile, zerohHome } from './private-fs.js';

export const UNINSTALL_MARKER = 'uninstalled';
const FAILURE_MARKER = 'uninstall-failed.json';
const LEGACY_PENDING_MS = 15_000;
export const FALLBACK_OWNER_LEASE_MS = 60_000;
const TRANSITION_WAIT_MS = 1_000;
const TRANSITION_LOCK_WRITE_GRACE_MS = 100;

export function uninstallMarkerPath(env = process.env) {
  return path.join(path.resolve(zerohHome(env)), UNINSTALL_MARKER);
}

function failureMarkerPath(env) {
  return path.join(path.resolve(zerohHome(env)), FAILURE_MARKER);
}

export function uninstallRemovalLockPath(env = process.env) {
  const home = path.resolve(zerohHome(env));
  const key = createHash('sha256').update(home).digest('hex').slice(0, 24);
  return path.join(
    path.dirname(home),
    `.zeroh-disclosure-removal-${key}`,
    'removal.lock',
  );
}

function legacyMarkerPath(env) {
  const home = path.resolve(zerohHome(env));
  const id = createHash('sha256').update(home).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `zeroh-disclosure-uninstalled-${id}`);
}

function processStart(pid) {
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return afterName[19] || null;
    } catch {
      return null;
    }
  }
  let command;
  let args;
  if (process.platform === 'darwin') {
    command = 'ps';
    args = ['-o', 'lstart=', '-p', String(pid)];
  } else if (process.platform === 'win32') {
    command = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    args = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
    ];
  } else {
    return null;
  }
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 1_000,
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() || null : null;
}

// The removal heartbeat runs while the CLI main thread may be synchronously
// busy. Its own PID identity was already checked there before it was started.
let thisProcessStart =
  process.platform === 'win32' && !isMainThread
    ? workerData?.processStart
    : undefined;
function currentProcessStart(pid) {
  if (pid !== process.pid) return processStart(pid);
  if (process.platform === 'win32' && !isMainThread) {
    if (thisProcessStart === undefined) thisProcessStart = processStart(pid);
  } else thisProcessStart ??= processStart(pid);
  return thisProcessStart;
}

export function uninstallOwner(pid = process.pid, now = Date.now()) {
  return {
    pid,
    process_start: currentProcessStart(pid),
    nonce: randomBytes(18).toString('base64url'),
    lease_until: new Date(now + FALLBACK_OWNER_LEASE_MS).toISOString(),
  };
}

function markerDocument(file) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile()) return null;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      return null;
    }
    const raw = readFileSync(file, 'utf8');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? { raw, value } : null;
  } catch {
    return null;
  }
}

function ownerAlive(owner, now = Date.now()) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code !== 'EPERM') return false;
  }
  const currentStart = currentProcessStart(pid);
  if (owner.process_start && currentStart) {
    return owner.process_start === currentStart;
  }
  return Date.parse(owner.lease_until ?? '') >= now;
}

function transitionLockIsYoung(file, now = Date.now()) {
  try {
    return now - lstatSync(file).mtimeMs <= TRANSITION_LOCK_WRITE_GRACE_MS;
  } catch {
    return false;
  }
}

function transitionLockPath(env) {
  return path.join(path.dirname(uninstallRemovalLockPath(env)), 'marker.lock');
}

function acquireTransitionLock(env) {
  const file = transitionLockPath(env);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + TRANSITION_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      writeFileSync(fd, `${JSON.stringify(uninstallOwner())}\n`);
      return { fd, file };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const held = markerDocument(file);
      if (!transitionLockIsYoung(file) && (!held || !ownerAlive(held.value))) {
        const retired = `${file}.stale-${process.pid}-${randomBytes(8).toString('hex')}`;
        try {
          renameSync(file, retired);
          unlinkSync(retired);
          continue;
        } catch (retireError) {
          if (retireError?.code === 'ENOENT') continue;
        }
      }
      if (Date.now() >= deadline) {
        throw new Error('uninstall marker transition is busy');
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function withTransitionLock(env, change) {
  const lock = acquireTransitionLock(env);
  try {
    return change();
  } finally {
    closeSync(lock.fd);
    try {
      unlinkSync(lock.file);
    } catch {
      // A dead short-lived lock is reclaimed by the next transition.
    }
  }
}

function atomicTransition(env, expectedRaw, value) {
  const file = uninstallMarkerPath(env);
  return writePrivateFile(file, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    durable: true,
    beforeRename: () => {
      try {
        return readFileSync(file, 'utf8') === expectedRaw;
      } catch {
        return false;
      }
    },
  });
}

function noteRemovalFailure(env, cleanupStartedAt = null) {
  try {
    writePrivateFile(
      failureMarkerPath(env),
      `${JSON.stringify({
        failed_at: new Date().toISOString(),
        ...(cleanupStartedAt ? { cleanup_started_at: cleanupStartedAt } : {}),
      })}\n`,
      { mode: 0o600, durable: true },
    );
  } catch {
    // The marker state remains authoritative when its explanatory note fails.
  }
}

function clearOwnedRemovalLock(env, nonce) {
  if (!nonce) return;
  const file = uninstallRemovalLockPath(env);
  const retired = `${file}.stale-${process.pid}-${randomBytes(8).toString('hex')}`;
  let expected;
  try {
    expected = readFileSync(file, 'utf8').trim();
    if (expected !== nonce) return;
    renameSync(file, retired);
    if (readFileSync(retired, 'utf8').trim() !== expected) {
      try {
        linkSync(retired, file);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    unlinkSync(retired);
  } catch {
    if (existsSync(retired) && !existsSync(file)) {
      try {
        renameSync(retired, file);
      } catch {
        // A newer lock owns the path now.
      }
    }
  }
}

// Marker writers and stale cleanup share the transition lock. Re-read under
// that lock, then unlink the exact stale marker in one visible transition:
// hooks see the pending marker before it or no marker after it, never the
// rename-away comparison window that let a prompt route during removal.
function retireSnapshot(env, snapshot) {
  return withTransitionLock(env, () => {
    const current = markerDocument(uninstallMarkerPath(env));
    if (!current) return true;
    if (current.raw !== snapshot.raw) return false;
    unlinkSync(uninstallMarkerPath(env));
    clearOwnedRemovalLock(env, snapshot.value.owner?.nonce);
    noteRemovalFailure(env);
    return true;
  });
}

function failSnapshot(env, snapshot, now = Date.now()) {
  return withTransitionLock(env, () => {
    const current = markerDocument(uninstallMarkerPath(env));
    if (!current || current.raw !== snapshot.raw) return false;
    const changed = atomicTransition(env, current.raw, {
      ...current.value,
      state: 'failed',
      failed_at: new Date(now).toISOString(),
    });
    if (changed) {
      clearOwnedRemovalLock(env, current.value.owner?.nonce);
      noteRemovalFailure(env, current.value.cleanup_started_at);
    }
    return changed;
  });
}

export function markUninstallPending(
  env = process.env,
  owner = uninstallOwner(),
  now = Date.now(),
) {
  const file = uninstallMarkerPath(env);
  const normalized =
    Number.isInteger(owner) && owner > 0
      ? {
          pid: owner,
          process_start: processStart(owner),
          nonce: randomBytes(18).toString('base64url'),
          lease_until: new Date(now + FALLBACK_OWNER_LEASE_MS).toISOString(),
        }
      : owner;
  withTransitionLock(env, () => {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writePrivateFile(
      file,
      `${JSON.stringify({
        v: 2,
        state: 'pending',
        owner: normalized,
        pending_at: new Date(now).toISOString(),
      })}\n`,
      { mode: 0o600, durable: true },
    );
  });
  return normalized;
}

export function handoffUninstallPending(
  env,
  expectedNonce,
  owner = uninstallOwner(),
) {
  return withTransitionLock(env, () => {
    const snapshot = markerDocument(uninstallMarkerPath(env));
    if (
      snapshot?.value?.state !== 'pending' ||
      snapshot.value.owner?.nonce !== expectedNonce
    ) {
      return false;
    }
    return atomicTransition(env, snapshot.raw, {
      ...snapshot.value,
      owner,
      handed_off_at: new Date().toISOString(),
    });
  });
}

export function renewUninstallPending(env, expectedNonce, now = Date.now()) {
  return withTransitionLock(env, () => {
    const snapshot = markerDocument(uninstallMarkerPath(env));
    if (
      snapshot?.value?.state !== 'pending' ||
      snapshot.value.owner?.nonce !== expectedNonce
    ) {
      return false;
    }
    return atomicTransition(env, snapshot.raw, {
      ...snapshot.value,
      owner: {
        ...snapshot.value.owner,
        lease_until: new Date(now + FALLBACK_OWNER_LEASE_MS).toISOString(),
      },
      heartbeat_at: new Date(now).toISOString(),
    });
  });
}

export function markUninstallCleanupStarted(
  env,
  expectedNonce,
  now = Date.now(),
) {
  if (!expectedNonce) return false;
  return withTransitionLock(env, () => {
    const snapshot = markerDocument(uninstallMarkerPath(env));
    if (
      snapshot?.value?.state !== 'pending' ||
      snapshot.value.owner?.nonce !== expectedNonce
    ) {
      return false;
    }
    return atomicTransition(env, snapshot.raw, {
      ...snapshot.value,
      cleanup_started_at: new Date(now).toISOString(),
    });
  });
}

export function failUninstallPending(env, expectedNonce, now = Date.now()) {
  if (!expectedNonce) return false;
  const snapshot = markerDocument(uninstallMarkerPath(env));
  if (
    snapshot?.value?.state !== 'pending' ||
    snapshot.value.owner?.nonce !== expectedNonce
  ) {
    return false;
  }
  if (snapshot.value.cleanup_started_at) {
    return failSnapshot(env, snapshot, now);
  }
  return clearPendingUninstall(env, expectedNonce);
}

export function clearPendingUninstall(env, expectedNonce) {
  const snapshot = markerDocument(uninstallMarkerPath(env));
  if (
    snapshot?.value?.state !== 'pending' ||
    snapshot.value.owner?.nonce !== expectedNonce
  ) {
    return false;
  }
  return retireSnapshot(env, snapshot);
}

export function markUninstalled(
  env = process.env,
  expectedNonce,
  now = Date.now(),
) {
  if (!expectedNonce) return false;
  const changed = withTransitionLock(env, () => {
    const snapshot = markerDocument(uninstallMarkerPath(env));
    if (
      snapshot?.value?.state !== 'pending' ||
      snapshot.value.owner?.nonce !== expectedNonce
    ) {
      return false;
    }
    return atomicTransition(env, snapshot.raw, {
      v: 2,
      state: 'committed',
      uninstalled_at: new Date(now).toISOString(),
    });
  });
  if (changed) rmSync(failureMarkerPath(env), { force: true });
  return changed;
}

export function uninstallState(env = process.env, now = Date.now()) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = markerDocument(uninstallMarkerPath(env));
    if (!snapshot) return 'none';
    const marker = snapshot.value;
    if (marker.state === 'committed' || marker.uninstalled_at) {
      return 'committed';
    }
    if (marker.state === 'failed') return 'failed';
    if (marker.state === 'pending') {
      if (ownerAlive(marker.owner, now)) return 'pending';
      if (marker.cleanup_started_at) {
        if (failSnapshot(env, snapshot, now)) return 'failed';
        continue;
      }
      if (retireSnapshot(env, snapshot)) return 'none';
      continue;
    }
    // Compatibility with the abandoned 1.0.5 pending-marker shape. Its age
    // bounds PID reuse; all new ownership uses a nonce plus process identity.
    if (marker.pending === true) {
      const pendingAt = Date.parse(
        marker.pending_at ?? marker.started_at ?? '',
      );
      const fresh = Number.isFinite(pendingAt)
        ? now - pendingAt <= LEGACY_PENDING_MS
        : false;
      if (
        fresh &&
        ownerAlive(
          {
            pid: marker.pid,
            lease_until: new Date(now + LEGACY_PENDING_MS).toISOString(),
          },
          now,
        )
      ) {
        return 'pending';
      }
      if (retireSnapshot(env, snapshot)) return 'none';
      continue;
    }
    return 'none';
  }
  return 'none';
}

// Statusline and other read-only surfaces use the same liveness rule without
// retiring a stale marker, removing a lock, or writing the dead-child notice.
export function readUninstallState(env = process.env, now = Date.now()) {
  const marker = markerDocument(uninstallMarkerPath(env))?.value;
  if (!marker) return 'none';
  if (marker.state === 'committed' || marker.uninstalled_at) {
    return 'committed';
  }
  if (marker.state === 'failed') return 'failed';
  if (marker.state === 'pending') {
    if (ownerAlive(marker.owner, now)) return 'pending';
    return marker.cleanup_started_at ? 'failed' : 'none';
  }
  if (marker.pending === true) {
    const pendingAt = Date.parse(marker.pending_at ?? marker.started_at ?? '');
    const fresh = Number.isFinite(pendingAt)
      ? now - pendingAt <= LEGACY_PENDING_MS
      : false;
    return fresh &&
      ownerAlive(
        {
          pid: marker.pid,
          lease_until: new Date(now + LEGACY_PENDING_MS).toISOString(),
        },
        now,
      )
      ? 'pending'
      : 'none';
  }
  return 'none';
}

export function isUninstalled(env = process.env) {
  return uninstallState(env) !== 'none';
}

export function takeUninstallFailure(env = process.env) {
  const file = failureMarkerPath(env);
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    rmSync(file, { force: true });
    return value;
  } catch {
    return null;
  }
}

export function uninstallFailureNotice(failure) {
  return failure?.cleanup_started_at
    ? 'ZeroH Disclosure removal stopped during local cleanup. Protection remains stopped because the install may be partly removed; type /zeroh-disclosure:uninstall again to finish.'
    : 'ZeroH Disclosure removal stopped before local cleanup began. Protection is still active; type /zeroh-disclosure:uninstall again to retry.';
}

export function clearUninstalled(env = process.env) {
  withTransitionLock(env, () => {
    for (const file of [uninstallMarkerPath(env), legacyMarkerPath(env)]) {
      try {
        rmSync(file, { force: true });
      } catch {
        // Removed at the next start.
      }
    }
  });
}

export function hookStandsDown(name, event, env = process.env) {
  const state = uninstallState(env);
  if (state === 'none') return false;
  if (
    name === 'user-prompt-submit' &&
    /^\/zeroh-disclosure:uninstall(?:\s|$)/u.test(
      String(event?.prompt ?? event?.user_prompt ?? '').trim(),
    )
  ) {
    return false;
  }
  if (
    state === 'committed' &&
    name === 'session-start' &&
    (event?.source ?? 'startup') === 'startup'
  ) {
    clearUninstalled(env);
    return false;
  }
  return true;
}
