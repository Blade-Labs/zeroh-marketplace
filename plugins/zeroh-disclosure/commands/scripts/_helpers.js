import path from 'node:path';
import { loadConfig } from '../../lib/config.js';
import { listTurns, loadSession, readJson } from '../../lib/session.js';

export async function latestSession() {
  await loadConfig({ cwd: process.cwd() });
  const session = await loadSession({ cwd: process.cwd(), sessionId: process.env.CLAUDE_SESSION_ID });
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
