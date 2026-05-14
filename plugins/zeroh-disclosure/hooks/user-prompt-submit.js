#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { detectSensitiveData } from '../lib/detector.js';
import { maskText } from '../lib/mask.js';
import { isToken } from '../lib/tokens.js';
import { bumpTurn, hmacKeyBytes, loadSession, writeTurn } from '../lib/session.js';
import { writeClipboard } from '../lib/clipboard.js';

const event = await readStdinJson();
const userPrompt = event?.prompt ?? event?.user_prompt ?? '';
const cwd = event?.cwd;
await loadConfig({ cwd });
const sessionId = event?.session_id;

if (typeof userPrompt !== 'string' || userPrompt.length === 0) {
  process.exit(0);
}

const findings = detectSensitiveData(userPrompt);

if (findings.length === 0) {
  // No PII — allow through silently. Don't bump the turn counter; only do that
  // for prompts we actually act on.
  process.exit(0);
}

const session = await loadSession({ cwd, sessionId });
const turn = await bumpTurn(session);

const masked = await maskText(userPrompt, findings, {
  hmacKeyBytes: hmacKeyBytes(session.state),
});

await writeTurn({
  dir: session.dir,
  turn,
  payload: {
    turn,
    phase: 'blocked_pending_user_resubmit',
    created_at: new Date().toISOString(),
    findings: findings.map(({ type, risk, start, end, length, confidence }) => ({ type, risk, start, end, length, confidence })),
    sanitized_text: masked.sanitized_text,
    replacements: masked.replacements,
    masked_categories: masked.masked_categories,
    // Original prompt stays local; sits under .zeroh/sessions/ (same trust
    // boundary as wallet.key.json). Needed so the Stop hook can build a
    // faithful receipt that records what was actually masked. Never sent.
    local_private: {
      original_text: userPrompt,
      note: 'Local-only. Never leaves disk. Used by the Stop hook to build the receipt.',
    },
  },
});

const clipboardTool = await writeClipboard(masked.sanitized_text).catch(() => null);

const byType = countByType(masked.replacements);
const lines = [];
lines.push('🛡  ZeroH Mask: your prompt contains sensitive data that should not be sent to the model.');
lines.push('');
lines.push(`Detected ${masked.replacements.length} item(s): ${formatByType(byType)}`);
lines.push('');
if (clipboardTool) {
  const pasteHint = process.platform === 'darwin' ? '⌘V' : process.platform === 'win32' ? 'Ctrl+V' : 'Ctrl+Shift+V';
  lines.push(`✓ Masked version copied to clipboard (${clipboardTool}). Paste with ${pasteHint} and press Enter to re-submit.`);
} else {
  lines.push('Re-submit using this masked version (copy/paste):');
}
lines.push('');
lines.push('────────────────────────────────────────');
lines.push(masked.sanitized_text);
lines.push('────────────────────────────────────────');
lines.push('');
lines.push('Token mapping (kept locally; the model never sees these values):');
for (const r of masked.replacements) {
  lines.push(`  ${r.replacement}  →  <${r.entity_type.toLowerCase()} #${shortCommit(r.value_commitment)}>`);
}
lines.push('');
lines.push(`Receipt will be finalized at turn end. Turn ${turn} pending re-submit.`);

const reason = lines.join('\n');

// Block the prompt and present the masked alternative for the user to paste.
// Per Claude Code hook spec, decision:"block" prevents the prompt from being
// processed and erases it from context. The `reason` text is shown to the user.
process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: '',
    },
  }) + '\n',
);
process.exit(0);

// helpers ---------------------------------------------------------------------

function countByType(replacements) {
  const out = {};
  for (const r of replacements) out[r.entity_type] = (out[r.entity_type] ?? 0) + 1;
  return out;
}

function formatByType(map) {
  return Object.entries(map)
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t))
    .join(', ');
}

function shortCommit(b64u) {
  return String(b64u).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
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

// Touch a function so the linter doesn't complain about unused imports during refactors.
void isToken;
