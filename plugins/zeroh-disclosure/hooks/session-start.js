#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { collectActiveTokens, loadSession, writeJson } from '../lib/session.js';
import { isAnchorEnabled } from '../lib/hedera-anchor.js';
import { ingestMandate } from '../lib/vi/index.js';

const event = await readStdinJson();
const cwd = event?.cwd;
const source = event?.source || 'startup';
await loadConfig({ cwd });
const sessionId = event?.session_id;

const session = await loadSession({ cwd, sessionId });

// VI mandate ingest. Silent when no mandate is configured; populated on
// success; surfaces a clear error line on failure (commerce tools become
// hard-deny in the PreToolUse hook).
const viResult = await ingestMandate({ cwd });
if (viResult.present && viResult.ok) {
  session.state.vi = viResult.vi;
  await writeJson(session.statePath, session.state);
} else if (viResult.present && !viResult.ok) {
  // Persist the failure so PreToolUse / Stop don't accidentally treat a
  // failed ingest as "no mandate".
  session.state.vi_error = { source: viResult.source, errors: viResult.errors };
  delete session.state.vi;
  await writeJson(session.statePath, session.state);
}

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

if (session.state.vi) {
  const v = session.state.vi;
  const exp = v.expiry ? new Date(v.expiry * 1000).toISOString().replace(/\.\d+Z$/, 'Z') : 'never';
  lines.push(
    '',
    `Verifiable Intent mandate active: aud=${v.mandate_aud}, expires ${exp}.`,
    `Issuer: ${v.issuer || 'unknown'} · agent kid: ${v.agent_jwk_kid || 'unknown'}`,
  );
  if (v.scope_summary) lines.push(`Scope: ${v.scope_summary}`);
  lines.push('Commerce-tier tools require an `_intent_fulfillment` field matching this scope.');
} else if (session.state.vi_error) {
  lines.push(
    '',
    `⚠ Verifiable Intent mandate ingest FAILED — commerce tools will be denied.`,
    `Source: ${session.state.vi_error.source}`,
  );
  for (const e of session.state.vi_error.errors) lines.push(`  • ${e}`);
}

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
