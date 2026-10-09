// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from '../child-process.js';
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { acquireFileLock } from '../vault.js';
import {
  clearPendingUninstall,
  failUninstallPending,
  handoffUninstallPending,
  markUninstallCleanupStarted,
  markUninstallPending,
  markUninstalled,
  uninstallOwner,
  uninstallRemovalLockPath,
} from '../uninstall-marker.js';
import { mintTicket, TICKET_ENV } from './authority.js';

const CLI = fileURLToPath(
  new URL('../../../bin/zeroh-disclosure.mjs', import.meta.url),
);
let removalHeartbeat = null;

export function startRemovalHeartbeat(
  env = process.env,
  { platform = process.platform, intervalMs = 10_000 } = {},
) {
  if (
    platform === 'linux' ||
    removalHeartbeat ||
    !env.ZEROH_REMOVAL_OWNER ||
    !env.ZEROH_REMOVAL_LOCK
  ) {
    return removalHeartbeat;
  }
  removalHeartbeat = new Worker(
    new URL('./removal-heartbeat.js', import.meta.url),
    {
      workerData: {
        env,
        nonce: env.ZEROH_REMOVAL_OWNER,
        intervalMs,
        ...(platform === 'win32'
          ? {
              processStart: uninstallOwner().process_start,
            }
          : {}),
      },
    },
  );
  removalHeartbeat.unref();
  return removalHeartbeat;
}

export function stopRemovalHeartbeat() {
  const worker = removalHeartbeat;
  removalHeartbeat = null;
  worker?.terminate();
}

function removalLockPath(env) {
  const file = uninstallRemovalLockPath(env);
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return file;
}

function reserveRemoval(env, nonce = null) {
  try {
    const lock = acquireFileLock(removalLockPath(env), {
      waitMs: 0,
      staleMs: 24 * 60 * 60 * 1_000,
      reclaimDeadOwner: true,
    });
    if (nonce) {
      ftruncateSync(lock.fd, 0);
      writeSync(lock.fd, `${nonce}\n`, 0);
    }
    return lock;
  } catch (error) {
    if (/Timed out waiting for ZeroH vault lock/u.test(error.message)) {
      throw new Error('ZeroH Disclosure removal is already running.');
    }
    throw error;
  }
}

function removalOwnerNonce(env) {
  if (env.ZEROH_REMOVAL_OWNER) return env.ZEROH_REMOVAL_OWNER;
  try {
    return readFileSync(removalLockPath(env), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

export function beginRemoval(env = process.env) {
  if (env.ZEROH_REMOVAL_LOCK) {
    const file = removalLockPath(env);
    if (
      env.ZEROH_REMOVAL_LOCK !== file ||
      !env.ZEROH_REMOVAL_OWNER ||
      readFileSync(file, 'utf8').trim() !== env.ZEROH_REMOVAL_OWNER
    ) {
      throw new Error('removal lock was lost');
    }
    handoffUninstallPending(env, env.ZEROH_REMOVAL_OWNER, {
      ...uninstallOwner(),
      nonce: env.ZEROH_REMOVAL_OWNER,
    });
    return file;
  }
  const owner = uninstallOwner();
  const lock = reserveRemoval(env, owner.nonce);
  try {
    markUninstallPending(env, owner);
  } catch (error) {
    closeSync(lock.fd);
    try {
      unlinkSync(lock.file);
    } catch {
      // A later attempt reclaims a lock that could not be removed here.
    }
    throw error;
  }
  closeSync(lock.fd);
  return lock.file;
}

export function markRemovalCleanupStarted(env = process.env) {
  return markUninstallCleanupStarted(env, removalOwnerNonce(env));
}

export function commitRemoval(env = process.env) {
  return markUninstalled(env, removalOwnerNonce(env));
}

export function failRemoval(env = process.env) {
  return failUninstallPending(env, removalOwnerNonce(env));
}

export function finishRemoval(file, { cleanupDirectory = false } = {}) {
  stopRemovalHeartbeat();
  if (!file) return;
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cleanupDirectory) {
    try {
      rmdirSync(path.dirname(file));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }
}

export function startDetachedRemoval({ argv, cwd, env, onLog }) {
  const ticket = mintTicket({ argv, env });
  // The CLI deletes ZEROH_HOME, so its log must live outside that folder.
  const logDir = mkdtempSync(
    path.join(os.tmpdir(), 'zeroh-disclosure-removal-'),
  );
  const log = path.join(logDir, 'removal.log');
  onLog(log);
  const fd = openSync(log, 'w', 0o600);
  let lock;
  let owner;
  try {
    owner = uninstallOwner();
    lock = reserveRemoval(env, owner.nonce);
    markUninstallPending(env, owner);
    const child = spawn(process.execPath, [CLI, ...argv, '--cwd', cwd], {
      cwd,
      env: {
        ...env,
        [TICKET_ENV]: ticket,
        ZEROH_REMOVAL_LOCK: lock.file,
        ZEROH_REMOVAL_OWNER: owner.nonce,
        ZEROH_REMOVAL_LOG_DIR: logDir,
      },
      detached: true,
      stdio: ['ignore', fd, fd],
      ...(process.platform === 'win32' ? { zerohLogFile: log } : {}),
      windowsHide: true,
    });
    if (process.platform === 'win32') child.on('error', () => {});
    if (!child.pid) throw new Error('removal process did not start');
    handoffUninstallPending(env, owner.nonce, {
      ...uninstallOwner(child.pid),
      nonce: owner.nonce,
    });
    child.unref();
    return log;
  } catch (error) {
    if (owner) clearPendingUninstall(env, owner.nonce);
    if (lock) finishRemoval(lock.file);
    throw error;
  } finally {
    closeSync(fd);
    if (lock) closeSync(lock.fd);
  }
}
