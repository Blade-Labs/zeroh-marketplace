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
import { agentEvidenceEnabled, applyToolEvidence, toolTier } from '../lib/evidence-events.js';
import { resolveActivePolicy } from '../lib/policy-registry.js';

const event = await readStdinJson();
const toolName = event?.tool_name;
const toolInput = event?.tool_input;
const toolUseId = event?.tool_use_id || `anon-${Date.now()}`;
const cwd = event?.cwd;
await loadConfig({ cwd });
const sessionId = event?.session_id;

if (!toolName || !toolInput) process.exit(0);

const session = await loadSession({ cwd, sessionId });
const { policy, alias } = await resolveActivePolicy({ cwd, sessionState: session.state });
const tier = toolTier(toolName);
const evidenceOn = agentEvidenceEnabled(policy);
let commerce = null;

if (isCommerceTool(toolName, toolInput)) {
  commerce = await evaluateCommerce({
    toolName,
    toolInput,
    viState: session.state.vi,
    strict: evidenceOn,
  });
  if (commerce.action === 'deny') {
    await writeLegacyToolAudit({ session, toolUseId, toolName, action: 'deny', tier: 'commerce', commerce });
    await applyToolEvidence({
      session,
      cwd,
      policyAlias: evidenceOn ? alias : null,
      toolName,
      toolUseId,
      toolInput,
      action: 'deny',
      reason: commerce.reason,
      tier: 'commerce',
      commerce,
    });
    emitDeny(commerce.message);
    process.exit(0);
  }
}

const pii = await evaluateToolUse({
  toolName,
  toolInput,
  hmacKeyBytes: hmacKeyBytes(session.state),
});

if (pii.action === 'allow') {
  if (evidenceOn || commerce) {
    await applyToolEvidence({
      session,
      cwd,
      policyAlias: evidenceOn ? alias : null,
      toolName,
      toolUseId,
      toolInput,
      allowedToolInput: toolInput,
      action: 'allow',
      reason: commerce ? 'commerce_constraints_satisfied' : 'agent_clean_allow',
      tier,
      commerce,
    });
  }
  process.exit(0);
}

const summary = summariseFindings(pii.perField);
const tokenLines = tokenMapLines(pii.perField);
await writeLegacyToolAudit({ session, toolUseId, toolName, action: pii.action, policy: pii.policy, perField: pii.perField });

if (pii.action === 'deny') {
  const reason = [
    `🛡  ZeroH Disclosure: sensitive data detected in ${toolName} input.`,
    '',
    `Detected: ${summary}`,
    '',
    'This tool call was blocked because rewriting its input would either break',
    'the operation (Bash, URL) or leak structure (MCP). Reshape the call to',
    'avoid raw sensitive values — e.g. read the value from an env var, redirect',
    'output to a file the user controls, or ask the user to redact first.',
  ].join('\n');
  if (evidenceOn || commerce) {
    await applyToolEvidence({
      session, cwd, policyAlias: evidenceOn ? alias : null, toolName, toolUseId, toolInput,
      action: 'deny', reason: 'sensitive_tool_input_denied', tier, commerce,
      findings: pii.perField.flatMap((f) => f.findings || []),
    });
  }
  emitDeny(reason);
  process.exit(0);
}

if (pii.action === 'warn') {
  const ctxLines = [
    `🛡  ZeroH Disclosure: sensitive data detected in ${toolName} input (${summary}).`,
    '',
    'Not rewritten because the affected fields are find-targets / informational',
    'only. Treat the existing values as sensitive; avoid echoing them into other',
    'tool calls or your response.',
  ];
  if (tokenLines.length > 0) ctxLines.push('', 'If you reference these values, use the canonical tokens:', ...tokenLines);
  if (evidenceOn || commerce) {
    await applyToolEvidence({
      session, cwd, policyAlias: evidenceOn ? alias : null, toolName, toolUseId, toolInput,
      allowedToolInput: toolInput, action: 'warn', reason: 'sensitive_tool_input_warn', tier, commerce,
      findings: pii.perField.flatMap((f) => f.findings || []),
      replacements: pii.perField.flatMap((f) => f.replacements || []),
    });
  }
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: ctxLines.join('\n') } });
  process.exit(0);
}

const updatedInput = applyMasked(toolInput, pii.perField);
const ctxLines = [
  `🛡  ZeroH Disclosure tokenized sensitive data in your ${toolName} input.`,
  '',
  `Tokenized ${summary}. The tool will run with the masked version below.`,
  'Treat tokens as opaque placeholders; they are deterministic — the same raw',
  "value always yields the same token within this session, so you can reason",
  'about identity ("the card from earlier") without seeing the value.',
];
if (tokenLines.length > 0) ctxLines.push('', 'Tokens in this call:', ...tokenLines);
if (evidenceOn || commerce) {
  await applyToolEvidence({
    session, cwd, policyAlias: evidenceOn ? alias : null, toolName, toolUseId, toolInput,
    allowedToolInput: updatedInput, action: 'rewrite', reason: 'sensitive_tool_input_rewritten', tier, commerce,
    findings: pii.perField.flatMap((f) => f.findings || []),
    replacements: pii.perField.flatMap((f) => f.replacements || []),
  });
}
emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput, additionalContext: ctxLines.join('\n') } });
process.exit(0);

async function writeLegacyToolAudit({ session, toolUseId, toolName, action, tier = null, policy = null, perField = [], commerce = null }) {
  await writeJson(path.join(session.dir, `tool-${sanitize(toolUseId)}.json`), {
    tool_use_id: toolUseId,
    tool_name: toolName,
    created_at: new Date().toISOString(),
    action,
    tier,
    policy,
    commerce_reason: commerce?.reason ?? null,
    violations: commerce?.violations ?? null,
    mandate_active: !!session.state.vi,
    fields: perField.map((f) => ({
      path: f.path,
      mode: f.mode,
      url_field: f.urlField,
      findings: f.findings.map(({ type, risk, start, end, length, confidence }) => ({ type, risk, start, end, length, confidence })),
      replacements: f.replacements,
      local_private: { original: f.original },
    })),
  });
}

function emitDeny(reason) {
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

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
