// SPDX-License-Identifier: AGPL-3.0-only

// Records what happened to non-text formats (PDFs, images, notebooks) on the
// current turn, and shows each kind's notice once per session.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { formatCounts } from './report-counts.js';
import { ensureDir, readJson, sessionDir, writeJson } from './session.js';
import { acquireFileLock, releaseFileLock } from './vault.js';

export async function recordFormatOutcome({
  cwd,
  sessionId,
  withheld = {},
  passedUnmasked = {},
}) {
  try {
    const dir = sessionDir(cwd, sessionId);
    await ensureDir(dir);
    const state = await readJson(path.join(dir, 'state.json'));
    const turn = Number(state?.turnCount ?? 0);
    if (turn < 1) return;

    const turnPath = path.join(dir, `turn-${turn}.json`);
    const lock = acquireFileLock(`${turnPath}.lock`);
    try {
      const ledger = await readJsonWithRetry(turnPath);
      if (!ledger) return;
      const formatDisclosure = ledger.format_disclosure ?? {
        withheld: {},
        passed_unmasked: {},
      };
      addCounts(formatDisclosure.withheld, withheld);
      addCounts(formatDisclosure.passed_unmasked, passedUnmasked);
      ledger.format_disclosure = formatDisclosure;
      await writeJson(turnPath, ledger);
    } finally {
      releaseFileLock(lock);
    }
  } catch {
    // Audit persistence must never turn an otherwise readable file into a deny.
  }
}

async function readJsonWithRetry(file, attempts = 5) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readJson(file);
    } catch (error) {
      if (!(error instanceof SyntaxError) || attempt >= attempts - 1)
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export async function firstFormatNotice({ cwd, sessionId, kind }) {
  const notices = path.join(sessionDir(cwd, sessionId), 'format-notices');
  await ensureDir(notices);
  const marker = path.join(notices, safeKind(kind));
  try {
    const handle = await fs.open(marker, 'wx', 0o600);
    await handle.close();
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    // If persistence is unavailable, prefer repeating a warning to hiding it.
    return true;
  }
}

// True for the first caller on the current turn (the naming reminder goes to
// the model once per turn, not once per tool call). The marker holds the turn.
export async function firstNoticeThisTurn({ cwd, sessionId, kind }) {
  try {
    const dir = sessionDir(cwd, sessionId);
    const state = await readJson(path.join(dir, 'state.json'));
    const turn = Number(state?.turnCount ?? 0);
    const notices = path.join(dir, 'format-notices');
    await ensureDir(notices);
    const marker = path.join(notices, `${safeKind(kind)}.turn`);
    const seen = await fs.readFile(marker, 'utf8').catch(() => null);
    if (seen === String(turn)) return false;
    await fs.writeFile(marker, String(turn), { mode: 0o600 });
    return true;
  } catch {
    // If persistence is unavailable, prefer repeating a line to dropping it.
    return true;
  }
}

export function formatReceiptLines(formatDisclosure = {}) {
  return [
    `withheld:                ${formatCounts(formatDisclosure.withheld)}`,
    `passed unmasked:         ${formatCounts(formatDisclosure.passed_unmasked)}`,
  ];
}

export function displayName(filePath, fallback) {
  const value = String(filePath || '');
  if (!value) return fallback;
  return value.includes('\\')
    ? path.win32.basename(value)
    : path.basename(value);
}

function addCounts(target, additions) {
  for (const [kind, count] of Object.entries(additions)) {
    const amount = Number(count);
    if (amount > 0) target[kind] = (target[kind] ?? 0) + amount;
  }
}

function safeKind(kind) {
  return String(kind)
    .replace(/[^A-Za-z0-9_-]/gu, '_')
    .slice(0, 64);
}
