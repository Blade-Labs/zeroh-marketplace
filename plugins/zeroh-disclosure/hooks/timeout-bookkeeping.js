// SPDX-License-Identifier: AGPL-3.0-only

// Windows watchdog bookkeeping runs off the thread that must answer Claude
// Code. The loader bounds this worker's lifetime; persistence is best effort.
import { parentPort, workerData } from 'node:worker_threads';
import { HOOKS, noticeSubject } from './fail-closed.js';
import { recordUnchecked } from '../packages/zeroh-disclosure-core/unchecked.js';
import { projectRootFromEnv } from '../packages/zeroh-disclosure-core/session.js';
import { recordHookRun } from '../packages/zeroh-disclosure-core/session-status.js';
import { isUninstalled } from '../packages/zeroh-disclosure-core/uninstall-marker.js';

const { name, event, raw, count, ok } = workerData;
const cwd = projectRootFromEnv(event?.cwd);
let notice;
try {
  if (count) {
    ({ notice } = await recordUnchecked({
      reason: 'watchdog-timeout',
      tool: name === 'user-prompt-submit' ? HOOKS[name] : event?.tool_name,
      cwd,
      sessionId: event?.session_id,
      subject: noticeSubject(name, raw),
    }));
  }
} catch {
  // The loader still supplies its generic timeout notice.
}
parentPort.postMessage(notice);
try {
  if (!isUninstalled()) {
    recordHookRun({ cwd, sessionId: event?.session_id, name, ok });
    const { cleanupSessionRunFiles, cleanupStaleRunFiles, TURN_END_GRACE_MS } =
      await import('../packages/shell-analysis/late-bind.js');
    cleanupStaleRunFiles();
    const minAgeMs = {
      stop: TURN_END_GRACE_MS,
      'user-prompt-submit': TURN_END_GRACE_MS,
      'session-end': 0,
    }[name];
    if (minAgeMs !== undefined)
      cleanupSessionRunFiles({ sessionId: event?.session_id, minAgeMs });
  }
} catch {
  // An unavailable filesystem never delays the protective answer.
}
