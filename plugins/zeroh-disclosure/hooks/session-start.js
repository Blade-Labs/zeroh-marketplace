#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { collectActiveTokens, loadSession } from '../lib/session.js';
import { isAnchorEnabled } from '../lib/hedera-anchor.js';

const event = await readStdinJson();
const cwd = event?.cwd;
const source = event?.source || 'startup';
await loadConfig({ cwd });
const sessionId = event?.session_id;

const session = await loadSession({ cwd, sessionId });

const lines = [
  '🛡  ZeroH Disclosure plugin active.',
  '',
  'Sensitive data in your tool inputs and the user\'s prompts is tokenized to',
  '`[TYPE-xxxxxx]`. Tokens are deterministic per session — the same raw value',
  'always yields the same token, so you can reason about identity ("the card',
  'from earlier") without seeing the underlying value. Pass tokens through',
  'unchanged; never try to reconstruct the raw form.',
];

const issuer = session.wallet?.accountId
  ? `${session.wallet.accountId} on ${session.wallet.network}`
  : 'unconfigured';
lines.push('', `Signing identity: ${issuer}.`);
lines.push(`Anchoring: ${isAnchorEnabled() ? 'live (Hedera HCS)' : 'intent-only (no submission)'}.`);

const tokens = await collectActiveTokens(session.dir);
if (tokens.size > 0) {
  lines.push('', 'Active tokens carried in from prior turns:');
  for (const [token, type] of tokens) {
    lines.push(`  ${token} = ${type.toLowerCase()}`);
  }
}

if (source === 'compact') {
  lines.push(
    '',
    '(Context was just compacted. Tokens are durable; refer to them rather',
    'than the original values.)',
  );
}

emit({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
});
process.exit(0);

// helpers ---------------------------------------------------------------------

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
