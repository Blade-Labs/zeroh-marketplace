// SPDX-License-Identifier: AGPL-3.0-only

// Shared helpers for the slash-command scripts: the project root and session
// id the hooks use.
import path from 'node:path';
import { loadConfig } from '../../lib/config.js';
import {
  envSessionId,
  listTurns,
  loadSession,
  projectRootFromEnv,
  readJson,
} from '../../lib/session.js';

// The project root the hooks use, so a command run from a subdirectory reads
// the same sessions and vault.
export function commandRoot() {
  return projectRootFromEnv();
}

// Claude Code sets CLAUDE_CODE_SESSION_ID for commands.
export function commandSessionId() {
  return envSessionId();
}

export async function latestSession() {
  const root = commandRoot();
  await loadConfig({ cwd: root });
  const session = await loadSession({
    cwd: root,
    sessionId: commandSessionId(),
  });
  return session;
}

export async function latestTurn(dir) {
  const turns = await listTurns({ dir });
  if (turns.length === 0) return null;
  const t = turns.at(-1);
  const ledger = await readJson(path.join(dir, `turn-${t}.json`));
  return { t, ledger };
}

export function header(title) {
  const line = '─'.repeat(Math.max(8, Math.min(60, title.length + 4)));
  return `\n${line}\n  ${title}\n${line}`;
}
