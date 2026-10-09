// SPDX-License-Identifier: AGPL-3.0-only

import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';

export const STOPPED_MS = 30_000;
export const TAIL_BYTES = 256 * 1024;
const TAIL_CHUNK = 64 * 1024;
const NEWLINE = 0x0a;

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// A real prompt or tool result newer than the hook heartbeat means the hook
// did not run. Claude Code's own transcript bookkeeping does not.
export function hooksStopped(transcriptPath, heartbeatPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return false;
  const heartbeat = mtimeOf(heartbeatPath);
  const moved = mtimeOf(transcriptPath);
  if (heartbeat === null || moved === null) return false;
  if (moved - heartbeat <= STOPPED_MS) return false;
  const hooked = lastHookedEntryAt(transcriptPath, TAIL_BYTES, heartbeat);
  return hooked !== null && hooked - heartbeat > STOPPED_MS;
}

export function compactionInProgress(transcriptPath, heartbeatPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return false;
  const heartbeat = mtimeOf(heartbeatPath);
  if (heartbeat === null) return false;
  const boundary = lastCompactBoundaryAt(transcriptPath);
  const prompt = lastPromptEntryAt(transcriptPath, TAIL_BYTES);
  return (
    boundary !== null &&
    boundary > heartbeat &&
    (prompt === null || prompt <= boundary)
  );
}

// The transcript is read from its end, at most TAIL_BYTES of it. Partial or
// invalid lines are skipped, and a missing entry is safer than guessing.
export function lastHookedEntryAt(
  file,
  maxBytes = TAIL_BYTES,
  heartbeat = null,
) {
  const compactBoundary = lastCompactBoundaryAt(file, maxBytes);
  const promptAfterCompact = lastPromptEntryAt(file, maxBytes);
  const promptResumedAt =
    compactBoundary !== null &&
    promptAfterCompact !== null &&
    promptAfterCompact > compactBoundary
      ? promptAfterCompact
      : null;
  const heartbeatResumedAt =
    compactBoundary !== null && heartbeat > compactBoundary ? heartbeat : null;
  const resumedAt =
    promptResumedAt === null
      ? heartbeatResumedAt
      : heartbeatResumedAt === null
        ? promptResumedAt
        : Math.min(promptResumedAt, heartbeatResumedAt);
  return lastTranscriptEntryAt(file, maxBytes, (bytes) =>
    hookedEntryAt(bytes, compactBoundary, resumedAt),
  );
}

export function lastCompactBoundaryAt(file, maxBytes = TAIL_BYTES) {
  return lastTranscriptEntryAt(file, maxBytes, compactBoundaryAt);
}

function lastTranscriptEntryAt(file, maxBytes, readEntry) {
  let fd;
  try {
    fd = openSync(file, 'r');
    let position = fstatSync(fd).size;
    const floor = Math.max(0, position - maxBytes);
    let carry = Buffer.alloc(0);
    while (position > floor) {
      const length = Math.min(TAIL_CHUNK, position - floor);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const got = readSync(fd, chunk, 0, length, position);
      const data = Buffer.concat([chunk.subarray(0, got), carry]);
      let end = data.length;
      while (end > 0) {
        const newline = data.lastIndexOf(NEWLINE, end - 1);
        if (newline < 0) break;
        const at = readEntry(data.subarray(newline + 1, end));
        if (at !== null) return at;
        end = newline;
      }
      carry = data.subarray(0, end);
    }
    return position === 0 ? readEntry(carry) : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Nothing to do.
      }
    }
  }
}

function compactBoundaryAt(bytes) {
  if (bytes.length < 2) return null;
  try {
    const item = JSON.parse(bytes.toString('utf8'));
    if (item?.type !== 'system' || item?.subtype !== 'compact_boundary') {
      return null;
    }
    const at = Date.parse(item.timestamp ?? '');
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

const INJECTED_RE = /^\s*(?:<[a-z][\w-]*[\s>]|\[Request interrupted)/u;

function userEntry(bytes) {
  if (bytes.length < 2) return null;
  try {
    const item = JSON.parse(bytes.toString('utf8'));
    return item && typeof item === 'object' && item.type === 'user'
      ? item
      : null;
  } catch {
    return null;
  }
}

function promptEntryAt(bytes) {
  const item = userEntry(bytes);
  if (!item) return null;
  if (item.isMeta || item.isCompactSummary || item.isVisibleInTranscriptOnly) {
    return null;
  }
  const at = Date.parse(item.timestamp);
  if (!Number.isFinite(at)) return null;
  const content = item.message?.content;
  const prompt = (text) =>
    item.isSidechain !== true && !INJECTED_RE.test(text) ? at : null;
  if (typeof content === 'string') return prompt(content);
  if (!Array.isArray(content) || content.length === 0) return null;
  if (content.some((block) => block?.type === 'tool_result')) return null;
  const text = content.find((block) => block?.type === 'text');
  return prompt(typeof text?.text === 'string' ? text.text : '');
}

function lastPromptEntryAt(file, maxBytes) {
  return lastTranscriptEntryAt(file, maxBytes, promptEntryAt);
}

function hookedEntryAt(bytes, compactBoundary = null, resumedAt = null) {
  const promptAt = promptEntryAt(bytes);
  if (promptAt !== null) return promptAt;
  const item = userEntry(bytes);
  if (!item) return null;
  const at = Date.parse(item.timestamp);
  if (!Number.isFinite(at)) return null;
  const content = item.message?.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const results = content.filter((block) => block?.type === 'tool_result');
  if (results.length > 0) {
    if (
      item.isSidechain === true ||
      (compactBoundary !== null &&
        at > compactBoundary &&
        (resumedAt === null || at < resumedAt))
    ) {
      return null;
    }
    return results.some((block) => block.is_error !== true) ? at : null;
  }
  return null;
}

export function transcriptStartedAt(file) {
  if (typeof file !== 'string' || !file) return null;
  let fd;
  try {
    fd = openSync(file, 'r');
    const length = Math.min(fstatSync(fd).size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const got = readSync(fd, buffer, 0, length, 0);
    for (const line of buffer.subarray(0, got).toString('utf8').split('\n')) {
      try {
        const at = Date.parse(JSON.parse(line)?.timestamp ?? '');
        if (Number.isFinite(at)) return at;
      } catch {
        // Bookkeeping and partial lines prove nothing.
      }
    }
  } catch {
    // Unknown is safer than guessing an old session.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}
