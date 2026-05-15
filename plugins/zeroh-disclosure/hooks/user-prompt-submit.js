#!/usr/bin/env node
import { loadConfig } from '../lib/config.js';
import { isToken } from '../lib/tokens.js';
import {
  bumpTurn,
  collectActiveTokens,
  extractTokens,
  loadSession,
  writeTurn,
  writeJson,
} from '../lib/session.js';
import { writeClipboard } from '../lib/clipboard.js';
import { activationFromPrompt } from '../lib/policy-registry.js';
import { applyDisclosurePolicy, ledgerFromDisclosureResult, markDisclosureResultCommitted } from '../lib/disclosure.js';

const event = await readStdinJson();
const userPrompt = event?.prompt ?? event?.user_prompt ?? '';
const cwd = event?.cwd;
await loadConfig({ cwd });
const sessionId = event?.session_id;

if (typeof userPrompt !== 'string' || userPrompt.length === 0) {
  process.exit(0);
}

// Every prompt — clean, tokenized re-submit, or PII-bearing — gets a turn and
// a receipt. The receipt is the deliverable: it records that the policy was
// applied and what it observed, signed and anchored on chain. Masking is one
// possible outcome; "policy applied, 0 findings" is just as valid a proof.

const session = await loadSession({ cwd, sessionId });
const activation = activationFromPrompt(userPrompt);
if (activation) {
  session.state.active_policy_id = activation.policy.policy_id;
  session.state.active_policy_alias = activation.alias;
  session.state.updated_at = new Date().toISOString();
  await writeJson(session.statePath, session.state);
  emitPolicyActivated(activation);
  process.exit(0);
}

const turn = await bumpTurn(session);
const tokens = extractTokens(userPrompt);
const result = await applyDisclosurePolicy({
  text: userPrompt,
  session,
  cwd,
  boundary: defaultClaudeBoundary(),
  intentBinding: intentBindingFromSession(session),
});

if (result.findings.length > 0) {
  await writeTurn({
    dir: session.dir,
    turn,
    payload: ledgerFromDisclosureResult({
      turn,
      phase: 'blocked_pending_user_resubmit',
      result,
      originalText: userPrompt,
      referencedTokens: tokens,
    }),
  });
  await markDisclosureResultCommitted({ session, result });
  await emitBlock({ turn, result });
  process.exit(0);
}

await writeTurn({
  dir: session.dir,
  turn,
  payload: ledgerFromDisclosureResult({
    turn,
    phase: tokens.length > 0 ? 'allowed_tokenized_resubmit' : 'allowed_no_findings',
    result,
    originalText: userPrompt,
    referencedTokens: tokens,
  }),
});
await markDisclosureResultCommitted({ session, result });

if (tokens.length === 0) {
  // Pure clean prompt: receipt still issued at Stop, but no model-facing
  // signal needed.
  process.exit(0);
}

// Tokenized re-submit: clean by detection, but references prior tokens.
// Inject a token map so the model can reason about the placeholders.
const map = await collectActiveTokens(session.dir);
const relevant = tokens.filter((t) => map.has(t)).map((t) => [t, map.get(t)]);
if (relevant.length === 0) process.exit(0);

const ctxLines = [
  '🛡  ZeroH Disclosure: this prompt references tokenized values from earlier in the session.',
  '',
  'Token map (the model never sees the raw values; treat tokens as opaque',
  'placeholders that the user can resolve locally):',
];
for (const [token, type] of relevant) ctxLines.push(`  ${token} = ${type.toLowerCase()}`);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: ctxLines.join('\n'),
    },
  }) + '\n',
);
process.exit(0);

// block emitter ---------------------------------------------------------------

async function emitBlock({ turn, result }) {
  const clipboardTool = result.sanitized_text ? await writeClipboard(result.sanitized_text).catch(() => null) : null;

  const byType = countByType(result.findings);
  const lines = [];
  lines.push('🛡  ZeroH Disclosure: policy applied before the Claude boundary.');
  lines.push('');
  lines.push(`Policy: ${result.receipt.public_claims.policy_id}`);
  lines.push(`Engine: ${result.receipt.public_claims.protection_engine_id}`);
  lines.push(`Receipt: ${result.receipt.receipt_id}`);
  lines.push('');
  lines.push(`Detected ${result.findings.length} item(s): ${formatByType(byType)}`);
  lines.push('');
  if (result.sanitized_text && clipboardTool) {
    const pasteHint = process.platform === 'darwin' ? '⌘V' : process.platform === 'win32' ? 'Ctrl+V' : 'Ctrl+Shift+V';
    lines.push(`✓ Policy-permitted version copied to clipboard (${clipboardTool}). Paste with ${pasteHint} and press Enter to re-submit.`);
  } else if (result.sanitized_text) {
    lines.push('Re-submit using this masked version (copy/paste):');
  } else {
    lines.push('This prompt was blocked by policy. No model-safe rewrite is available.');
  }
  if (result.sanitized_text) {
    lines.push('');
    lines.push('────────────────────────────────────────');
    lines.push(result.sanitized_text);
    lines.push('────────────────────────────────────────');
  }
  if ((result.replacements ?? []).length > 0) {
    lines.push('');
    lines.push('Token mapping (kept locally; the model never sees these values):');
    for (const r of result.replacements) {
      lines.push(`  ${r.replacement}  →  <${r.entity_type.toLowerCase()} #${shortCommit(r.value_commitment)}>`);
    }
  }
  lines.push('');
  lines.push(`Receipt created before boundary release. Turn ${turn} pending re-submit.`);

  // [PERSON-512f3e] hook spec, exit 2 + stderr renders the reason as a visible
  // warning line in the chat for UserPromptSubmit blocks. The JSON
  // decision:"block" path also blocks the prompt but does not surface the
  // reason field in the VSCode extension UI. See:
  // https://code.claude.com/docs/en/hooks-guide (exit-code-2 behavior per event)
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

function emitPolicyActivated({ policy, alias }) {
  const message = [
    `🛡  ZeroH Disclosure: ${policy.name} is now active for this session.`,
    '',
    `policy_id: ${policy.policy_id}`,
    `alias: ${alias}`,
    '',
    'No model call was made for this activation prompt.',
  ].join('\n');
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason: message,
      systemMessage: message,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '',
      },
    }) + '\n',
  );
}

// helpers ---------------------------------------------------------------------

function countByType(replacements) {
  const out = {};
  for (const r of replacements) {
    const type = r.entity_type ?? r.type;
    out[type] = (out[type] ?? 0) + 1;
  }
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

function defaultClaudeBoundary() {
  return {
    destination: process.env.ZEROH_DESTINATION || 'anthropic_claude_api',
    model: process.env.ZEROH_MODEL || 'claude-code',
    retention: process.env.ZEROH_RETENTION || 'unknown',
    destination_jurisdiction: process.env.ZEROH_DESTINATION_JURISDICTION || 'US',
  };
}

function intentBindingFromSession(session) {
  return session.state.vi ? {
    l1_hash: session.state.vi.l1_hash,
    l2_hash: session.state.vi.l2_hash,
    l2_nonce: session.state.vi.l2_nonce,
    mandate_aud: session.state.vi.mandate_aud,
    agent_jwk_kid: session.state.vi.agent_jwk_kid,
    scope_summary: session.state.vi.scope_summary,
    expiry: session.state.vi.expiry,
  } : null;
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

void isToken;
