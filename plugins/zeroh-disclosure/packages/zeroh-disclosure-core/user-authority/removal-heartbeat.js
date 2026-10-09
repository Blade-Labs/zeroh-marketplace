// SPDX-License-Identifier: AGPL-3.0-only

// A worker tied to the removal process renews non-Linux ownership while the
// main thread performs synchronous OS cleanup. It dies with that process, so
// a reused PID cannot keep renewing the nonce-bound pending marker.
import { parentPort, workerData } from 'node:worker_threads';

import { renewUninstallPending } from '../uninstall-marker.js';

const { env, nonce, intervalMs } = workerData;
let timer = null;

function renew() {
  try {
    if (renewUninstallPending(env, nonce)) return true;
  } catch {
    // A marker transition is momentarily busy; the next heartbeat retries.
    return true;
  }
  if (timer) clearInterval(timer);
  parentPort?.close();
  return false;
}

if (renew()) timer = setInterval(renew, intervalMs);
