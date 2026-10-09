// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveClaudeSettingsPath } from './claude-settings.js';
import {
  zerohHome,
  removeQuietly,
  writePrivateFile,
} from '../packages/zeroh-disclosure-core/private-fs.js';

export const WRAP_CACHE_DIR = 'statusline-cache';
export const WRAP_CACHE_STALE_MS = 3 * 10 * 1000;
export const WRAP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function wrappedCacheFile(env, sessionId = null) {
  const settings = resolveClaudeSettingsPath({ env });
  const session = sessionId || env.CLAUDE_CODE_SESSION_ID || 'session';
  const key = createHash('sha256')
    .update(`${path.resolve(settings)}\0${session}`)
    .digest('hex')
    .slice(0, 24);
  return path.join(path.resolve(zerohHome(env)), WRAP_CACHE_DIR, `${key}.json`);
}

export function readWrappedCache(file, now) {
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    if (
      cached?.v !== 1 ||
      typeof cached.output !== 'string' ||
      !cached.output
    ) {
      return '';
    }
    const at = Date.parse(cached.at ?? '');
    const stale = Number.isFinite(at) && now - at > WRAP_CACHE_STALE_MS;
    return stale ? `${cached.output} [cached]` : cached.output;
  } catch {
    return '';
  }
}

export function writeWrappedCache(file, output, now) {
  try {
    writePrivateFile(
      file,
      `${JSON.stringify({ v: 1, output, at: new Date(now).toISOString() })}\n`,
      { mode: 0o600 },
    );
  } catch {
    // The current output still shows; an unwritable cache affects only fallback.
  }
}

export function removeSessionCache(sessionId, env = process.env) {
  if (!sessionId) return;
  removeQuietly(wrappedCacheFile(env, sessionId));
}

export function pruneWrappedCache(env = process.env, now = Date.now()) {
  const directory = path.join(path.resolve(zerohHome(env)), WRAP_CACHE_DIR);
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const file = path.join(directory, entry.name);
      if (now - statSync(file).mtimeMs > WRAP_CACHE_MAX_AGE_MS)
        removeQuietly(file);
    }
  } catch {
    // Best effort; ending a session also deletes its own cached output.
  }
}
