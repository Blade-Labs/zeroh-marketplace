// SPDX-License-Identifier: AGPL-3.0-only

// How long receipts are kept (D-16): ZEROH_RECEIPT_RETENTION=forever|1y|90d|30d,
// 90 days by default, from the user's environment or <ZEROH_HOME>/config.env;
// a repository's .zeroh.env may only shorten it (lib/config.js). Pruning runs
// at SessionStart at most once a day and removes whole sessions whose last
// turn is older than the window: receipts, turn records, the session bundle
// and the session's commitment key. Never the current session, never the
// vault. Receipts hold no values.
import { readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { readJsonOr, writePrivateJson } from './private-fs.js';
import { projectDataDir, removeCommitmentKey, sanitizeSid } from './session.js';
import { zerohHome } from './vault.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECEIPT_RETENTION = Object.freeze({
  forever: null,
  '1y': 365 * DAY_MS,
  '90d': 90 * DAY_MS,
  '30d': 30 * DAY_MS,
});
export const DEFAULT_RECEIPT_RETENTION = '90d';
const WORDS = {
  forever: 'until you uninstall',
  '1y': 'for 1 year',
  '90d': 'for 90 days',
  '30d': 'for 30 days',
};

export function validRetention(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return Object.hasOwn(RECEIPT_RETENTION, normalized) ? normalized : null;
}

export function receiptRetention(env = process.env) {
  return (
    validRetention(env.ZEROH_RECEIPT_RETENTION) ?? DEFAULT_RECEIPT_RETENTION
  );
}

// The shorter of two settings ("forever" is the longest).
export function shorterRetention(left, right) {
  const length = (value) => RECEIPT_RETENTION[value] ?? Infinity;
  return length(right) < length(left) ? right : left;
}

// One line for /zeroh-disclosure:status.
export function retentionLine(env = process.env) {
  return `Receipts: kept on this computer ${WORDS[receiptRetention(env)]}; they contain no values.`;
}

// A note for a report whose period reaches past the window, or null.
export function retentionNote(sinceMs, env = process.env) {
  const setting = receiptRetention(env);
  const window = RECEIPT_RETENTION[setting];
  if (window === null || (sinceMs !== null && sinceMs <= window)) return null;
  return `Receipts older than ${setting.replace('1y', '1 year').replace(/(\d+)d$/u, '$1 days')} are removed (ZEROH_RECEIPT_RETENTION=${setting}), so older periods are not in this report.`;
}

function markerFile(env) {
  return path.join(zerohHome(env), 'receipts-pruned.json');
}

// The newest file time in a session folder: when its last turn was written.
function lastActivity(dir) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    try {
      newest = Math.max(newest, statSync(path.join(dir, name)).mtimeMs);
    } catch {
      // Removed meanwhile.
    }
  }
  return newest || statSync(dir).mtimeMs;
}

// Removes the sessions of `roots` whose last turn is older than the window.
// Cheap: runs at most once a day unless `force`. Returns what it did.
export function pruneReceipts({
  env = process.env,
  roots = [],
  currentSessionId = null,
  now = Date.now(),
  force = false,
} = {}) {
  const marker = markerFile(env);
  const last = Date.parse(readJsonOr(marker)?.at ?? '');
  if (!force && Number.isFinite(last) && now - last < DAY_MS) {
    return { skipped: true, removed: 0 };
  }
  const setting = receiptRetention(env);
  const window = RECEIPT_RETENTION[setting];
  const current = currentSessionId ? sanitizeSid(currentSessionId) : null;
  let removed = 0;
  if (window !== null) {
    for (const root of roots) {
      const sessions = path.join(projectDataDir(root, env), 'sessions');
      let names = [];
      try {
        names = readdirSync(sessions);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name === current) continue;
        const dir = path.join(sessions, name);
        try {
          if (!statSync(dir).isDirectory()) continue;
          if (now - lastActivity(dir) <= window) continue;
          rmSync(dir, { recursive: true, force: true });
          removeCommitmentKey(root, name, env);
          removed += 1;
        } catch {
          // Held open (Windows): tried again tomorrow.
        }
      }
    }
  }
  try {
    writePrivateJson(marker, {
      at: new Date(now).toISOString(),
      retention: setting,
      removed,
    });
  } catch {
    // A read-only home: tried again at the next start.
  }
  return { skipped: false, removed, retention: setting };
}
