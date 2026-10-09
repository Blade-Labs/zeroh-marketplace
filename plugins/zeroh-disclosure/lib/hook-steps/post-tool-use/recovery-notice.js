// SPDX-License-Identifier: AGPL-3.0-only

import { memoizeOutputFindings } from '../../../packages/zeroh-disclosure-core/bash-output-context.js';
import { UNSAVEABLE_REASON } from '../../../packages/zeroh-disclosure-core/restorable.js';
import {
  recordUnchecked,
  uncheckedNotice,
} from '../../../packages/zeroh-disclosure-core/unchecked.js';

// Keep completed masks, but never imply a skipped recovery was clean.
// Reuse the timeout ledger and notice. Even when already noticed this turn,
// emit a line so a skipped scan with no masks cannot exit without an answer.
export async function truncatedOutputNotice({ cwd, event }) {
  const options = { subject: 'tool output', why: 'not fully checked' };
  try {
    const { notice } = await recordUnchecked({
      reason: 'watchdog-timeout',
      tool: event.tool_name,
      cwd,
      sessionId: event.session_id,
      waitMs: 100,
      ...options,
    });
    if (notice) return notice;
  } catch {
    // Bookkeeping failure must not discard completed masks or this notice.
  }
  return uncheckedNotice('watchdog-timeout', options);
}

// Exact vault rewriting can change the detector input/offsets in the disk-only
// fallback. On a memo miss, rerun recovery: its budget marks truncation only
// if recovery does not complete. A completed rerun needs no extra notice.
export function outputFindingMemos() {
  const memos = {};
  return (context) => {
    const route = context.detectFindings ? 'recovered' : 'ordinary';
    memos[route] ??= memoizeOutputFindings(context.detectFindings);
    return memos[route];
  };
}

// The one-line notice for new values that went unmasked because the vault
// could not be saved, recorded on the turn (packages/zeroh-disclosure-core/unchecked.js).
export async function unsaveableOutputNotice({ cwd, event }) {
  try {
    const { notice } = await recordUnchecked({
      reason: UNSAVEABLE_REASON,
      tool: event.tool_name,
      cwd,
      sessionId: event.session_id,
      subject: 'tool output',
    });
    return notice;
  } catch {
    return uncheckedNotice(UNSAVEABLE_REASON, { subject: 'tool output' });
  }
}
