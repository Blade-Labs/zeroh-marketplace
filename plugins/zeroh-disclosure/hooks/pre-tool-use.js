#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { hmacKeyBytes, loadSession, writeJson } from '../lib/session.js';
import {
  applyMasked,
  evaluateCommerce,
  evaluateToolUse,
  isCommerceTool,
  summariseFindings,
  tokenMapLines,
} from '../lib/tool-policies.js';

const event = await readStdinJson();
const toolName = event?.tool_name;
const toolInput = event?.tool_input;
const toolUseId = event?.tool_use_id || `anon-${Date.now()}`;
const cwd = event?.cwd;
await loadConfig({ cwd });
const sessionId = event?.session_id;

if (!toolName || !toolInput) {
  // Not enough information to act; let the call through.
  process.exit(0);
}

const session = await loadSession({ cwd, sessionId });

// Commerce gate (Phase E.5). Runs BEFORE the PII rewrite/deny logic so a
// commerce call without a valid mandate is denied immediately and we don't
// waste cycles masking inputs that are about to be rejected anyway.
if (isCommerceTool(toolName, toolInput)) {
  const commerce = evaluateCommerce({ toolName, toolInput, viState: session.state.vi });
  if (commerce.action === 'deny') {
    const auditPath = path.join(session.dir, `tool-${sanitize(toolUseId)}.json`);
    await writeJson(auditPath, {
      tool_use_id: toolUseId,
      tool_name: toolName,
      created_at: new Date().toISOString(),
      action: 'deny',
      tier: 'commerce',
      commerce_reason: commerce.reason,
      violations: commerce.violations || null,
      mandate_active: !!session.state.vi,
    });
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: commerce.message,
      },
    });
    process.exit(0);
  }
  // commerce.action === 'allow' → fall through to the PII gate below.
}

const result = await evaluateToolUse({
  toolName,
  toolInput,
  hmacKeyBytes: hmacKeyBytes(session.state),
});

if (result.action === 'allow') {
  process.exit(0);
}

const summary = summariseFindings(result.perField);
const tokenLines = tokenMapLines(result.perField);

// Write an audit record next to the per-turn ledger. One file per tool call,
// so multiple parallel tool calls in a turn don't trample each other.
const auditPath = path.join(session.dir, `tool-${sanitize(toolUseId)}.json`);
await writeJson(auditPath, {
  tool_use_id: toolUseId,
  tool_name: toolName,
  created_at: new Date().toISOString(),
  action: result.action,
  policy: result.policy,
  fields: result.perField.map((f) => ({
    path: f.path,
    mode: f.mode,
    url_field: f.urlField,
    findings: f.findings.map(({ type, risk, start, end, length, confidence }) => ({
      type, risk, start, end, length, confidence,
    })),
    replacements: f.replacements,
    // Original field text stays on disk so the Stop-hook receipt can audit it.
    local_private: { original: f.original },
  })),
});

if (result.action === 'deny') {
  const reasonLines = [
    `🛡  ZeroH Disclosure: sensitive data detected in ${toolName} input.`,
    '',
    `Detected: ${summary}`,
    '',
    'This tool call was blocked because rewriting its input would either break',
    'the operation (Bash, URL) or leak structure (MCP). Reshape the call to',
    'avoid raw sensitive values — e.g. read the value from an env var, redirect',
    'output to a file the user controls, or ask the user to redact first.',
  ];
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reasonLines.join('\n'),
    },
  });
  process.exit(0);
}

if (result.action === 'warn') {
  const ctxLines = [
    `🛡  ZeroH Disclosure: sensitive data detected in ${toolName} input (${summary}).`,
    '',
    'Not rewritten because the affected fields are find-targets / informational',
    'only. Treat the existing values as sensitive; avoid echoing them into other',
    'tool calls or your response.',
  ];
  if (tokenLines.length > 0) {
    ctxLines.push('', 'If you reference these values, use the canonical tokens:');
    ctxLines.push(...tokenLines);
  }
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: ctxLines.join('\n'),
    },
  });
  process.exit(0);
}

// action === 'rewrite'
const updatedInput = applyMasked(toolInput, result.perField);
const ctxLines = [
  `🛡  ZeroH Disclosure tokenized sensitive data in your ${toolName} input.`,
  '',
  `Tokenized ${summary}. The tool will run with the masked version below.`,
  'Treat tokens as opaque placeholders; they are deterministic — the same raw',
  "value always yields the same token within this session, so you can reason",
  'about identity ("the card from earlier") without seeing the value.',
];
if (tokenLines.length > 0) {
  ctxLines.push('', 'Tokens in this call:');
  ctxLines.push(...tokenLines);
}
emit({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput,
    additionalContext: ctxLines.join('\n'),
  },
});
process.exit(0);

// helpers ---------------------------------------------------------------------

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
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
