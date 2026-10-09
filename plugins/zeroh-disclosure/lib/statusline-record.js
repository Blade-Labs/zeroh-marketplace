// SPDX-License-Identifier: AGPL-3.0-only

import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeSettingsFile } from './claude-settings.js';
import {
  readJsonOr,
  removeQuietly,
  writePrivateFile,
  writePrivateJson,
} from '../packages/zeroh-disclosure-core/private-fs.js';

export const RECORD_FILE = 'statusline.json';

export function readRecord(home) {
  const record = readJsonOr(path.join(path.resolve(home), RECORD_FILE));
  return {
    v: 1,
    choices:
      record?.choices && typeof record.choices === 'object'
        ? record.choices
        : {},
    paths: Array.isArray(record?.paths)
      ? record.paths.filter((entry) => typeof entry === 'string')
      : [],
    wrapped:
      record?.wrapped &&
      typeof record.wrapped === 'object' &&
      !Array.isArray(record.wrapped)
        ? record.wrapped
        : {},
    restore:
      record?.restore &&
      typeof record.restore === 'object' &&
      !Array.isArray(record.restore)
        ? record.restore
        : {},
  };
}

export function writeRecord(home, record) {
  writePrivateJson(path.join(path.resolve(home), RECORD_FILE), record);
}

export function recordChoice(home, settingsPath, choice, now = new Date()) {
  const record = readRecord(home);
  const key = path.resolve(settingsPath);
  record.choices[key] = { choice, at: now.toISOString() };
  if (choice === 'on' && !record.paths.includes(key)) record.paths.push(key);
  writeRecord(home, record);
  return record;
}

export function choiceFor(home, settingsPath) {
  return readRecord(home).choices[path.resolve(settingsPath)]?.choice ?? null;
}

export function rawSettings(settingsPath) {
  try {
    return { exists: true, raw: readFileSync(settingsPath, 'utf8') };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, raw: '' };
    throw error;
  }
}

export function recordStatuslineWrite(
  home,
  settingsPath,
  before,
  after = rawSettings(settingsPath),
) {
  if (!home || !before || !after) return;
  const record = readRecord(home);
  record.restore[path.resolve(settingsPath)] = {
    beforeExists: before.exists,
    before: Buffer.from(before.raw, 'utf8').toString('base64'),
    afterHash: settingsHash(after.raw),
  };
  writeRecord(home, record);
}

export function restoreExactBytes(settingsPath, home, entry) {
  if (!home) return false;
  try {
    // writeSettingsFile intentionally follows a settings symlink. Replacing
    // the link itself to restore bytes would violate that contract, so use
    // the semantic restoration path for links.
    if (lstatSync(settingsPath).isSymbolicLink()) return false;
  } catch {
    // A missing file can still be restored to its former absence below.
  }
  const key = path.resolve(settingsPath);
  const record = readRecord(home);
  const snapshot = record.restore[key];
  if (!snapshot) return false;
  const current = rawSettings(settingsPath);
  if (!matchesSnapshot(snapshot, current)) return false;
  const raw = Buffer.from(snapshot.before || '', 'base64').toString('utf8');
  const original = raw.trim() ? JSON.parse(raw) : {};
  const beforeRest = { ...original };
  const currentRest = { ...JSON.parse(current.raw) };
  delete beforeRest.statusLine;
  delete currentRest.statusLine;
  // Off removes only the status line. Exact restoration must never undo an
  // owned marketplace edit still present, or reinstate one already removed.
  if (!isDeepStrictEqual(beforeRest, currentRest)) return false;
  let result;
  if (snapshot.beforeExists) {
    result = writeSettingsFile(
      settingsPath,
      (document, context) => {
        if (!matchesSnapshot(snapshot, context)) return false;
        for (const key of Object.keys(document)) delete document[key];
        Object.assign(document, original);
        return true;
      },
      {
        writeFile: (target, _formatted, options) =>
          writePrivateFile(target, raw, options),
      },
    );
  } else {
    result = writeSettingsFile(
      settingsPath,
      (document, context) => {
        if (!matchesSnapshot(snapshot, context)) return false;
        for (const key of Object.keys(document)) delete document[key];
        return true;
      },
      {
        writeFile: (target, _formatted, { beforeRename }) => {
          if (!beforeRename()) return false;
          removeQuietly(target);
          return true;
        },
      },
    );
  }
  if (!result.written) return false;
  if (entry && Object.hasOwn(record.wrapped, key)) delete record.wrapped[key];
  delete record.restore[key];
  writeRecord(home, record);
  return true;
}

function settingsHash(raw) {
  return createHash('sha256').update(raw).digest('hex');
}
function matchesSnapshot(snapshot, current) {
  return (
    current.exists &&
    (snapshot.afterHash
      ? settingsHash(current.raw) === snapshot.afterHash
      : current.raw ===
        Buffer.from(snapshot.after || '', 'base64').toString('utf8'))
  );
}

export function pruneStatuslineRestore(home, settingsPath = null) {
  const record = readRecord(home);
  let changed = false;
  for (const [file, snapshot] of Object.entries(record.restore)) {
    if (settingsPath && path.resolve(settingsPath) !== file) continue;
    let current;
    try {
      current = rawSettings(file);
    } catch {
      current = { exists: false, raw: '' };
    }
    if (!matchesSnapshot(snapshot, current)) {
      delete record.restore[file];
      changed = true;
    } else if (snapshot.after) {
      snapshot.afterHash = settingsHash(current.raw);
      delete snapshot.after;
      changed = true;
    }
  }
  if (changed) writeRecord(home, record);
}

// Rebase only a known owned edit; an external save invalidates the backup.
export function advanceStatuslineRestore(home, settingsPath, before, after) {
  const record = readRecord(home);
  const key = path.resolve(settingsPath);
  const snapshot = record.restore[key];
  if (!snapshot) return;
  if (matchesSnapshot(snapshot, before)) {
    snapshot.afterHash = settingsHash(after.raw);
    delete snapshot.after;
  } else delete record.restore[key];
  writeRecord(home, record);
}
