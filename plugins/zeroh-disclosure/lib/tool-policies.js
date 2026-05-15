// Per-tool extraction + policy for PreToolUse. Pure functions; the hook glues
// them together. Detector hits in URL-shaped fields always force deny (a URL
// with PII can't be rewritten without breaking the request); warn-mode fields
// (e.g. Edit's old_string) never change the action — they only contribute
// additionalContext so Claude knows the file already contains sensitive data.

import { detectSensitiveData } from './detector.js';
import { maskText } from './mask.js';
import { evaluateCommerceIntent } from './evidence-events.js';

const VALID_POLICIES = new Set(['deny', 'rewrite', 'warn']);

const TOOLS = {
  Bash: { defaultPolicy: 'deny', envVar: 'ZEROH_BASH_POLICY' },
  Write: { defaultPolicy: 'rewrite', envVar: 'ZEROH_WRITE_POLICY' },
  Edit: { defaultPolicy: 'rewrite', envVar: 'ZEROH_EDIT_POLICY' },
  WebFetch: { defaultPolicy: 'rewrite', envVar: 'ZEROH_WEBFETCH_POLICY' },
  Agent: { defaultPolicy: 'rewrite', envVar: 'ZEROH_AGENT_POLICY' },
};

const MCP_POLICY_ENV = 'ZEROH_MCP_POLICY';
const MCP_DEFAULT = 'deny';

export function policyFor(toolName) {
  if (typeof toolName !== 'string') return null;
  if (toolName.startsWith('mcp__')) return readPolicy(MCP_POLICY_ENV, MCP_DEFAULT);
  const config = TOOLS[toolName];
  if (!config) return null;
  return readPolicy(config.envVar, config.defaultPolicy);
}

function readPolicy(envVar, fallback) {
  const raw = process.env[envVar];
  if (raw && VALID_POLICIES.has(raw.toLowerCase())) return raw.toLowerCase();
  return fallback;
}

export function extractFields(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  if (toolName.startsWith('mcp__')) {
    return collectStrings(toolInput, []).map((s) => ({ ...s, mode: 'enforce' }));
  }
  switch (toolName) {
    case 'Bash':
      return strField(toolInput, 'command');
    case 'Write':
      return strField(toolInput, 'content');
    case 'Edit':
      return [
        ...strField(toolInput, 'new_string'),
        ...strField(toolInput, 'old_string', { mode: 'warn' }),
      ];
    case 'WebFetch':
      return [
        ...strField(toolInput, 'url', { urlField: true }),
        ...strField(toolInput, 'prompt'),
      ];
    case 'Agent':
      return [
        ...strField(toolInput, 'prompt'),
        ...strField(toolInput, 'description'),
      ];
    default:
      return [];
  }
}

function strField(obj, key, { mode = 'enforce', urlField = false } = {}) {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) return [];
  return [{ path: [key], value: v, mode, urlField }];
}

function collectStrings(node, path) {
  if (typeof node === 'string') return node.length > 0 ? [{ path, value: node, urlField: false }] : [];
  if (Array.isArray(node)) return node.flatMap((v, i) => collectStrings(v, [...path, i]));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => collectStrings(v, [...path, k]));
  return [];
}

export async function evaluateToolUse({ toolName, toolInput, hmacKeyBytes }) {
  const policy = policyFor(toolName);
  if (!policy) return { action: 'allow', policy: null, perField: [] };

  const fields = extractFields(toolName, toolInput);
  if (fields.length === 0) return { action: 'allow', policy, perField: [] };

  const perField = [];
  for (const f of fields) {
    const findings = detectSensitiveData(f.value);
    if (findings.length === 0) continue;
    const masked = await maskText(f.value, findings, { hmacKeyBytes });
    perField.push({
      path: f.path,
      mode: f.mode,
      urlField: !!f.urlField,
      original: f.value,
      masked: masked.sanitized_text,
      findings,
      replacements: masked.replacements,
    });
  }

  if (perField.length === 0) return { action: 'allow', policy, perField: [] };

  const hasUrlHit = perField.some((f) => f.urlField);
  const hasEnforceHit = perField.some((f) => f.mode === 'enforce' && !f.urlField);

  let action;
  if (hasUrlHit) action = 'deny';
  else if (hasEnforceHit) action = policy === 'warn' ? 'warn' : policy;
  else action = 'warn';

  return { action, policy, perField };
}

export function applyMasked(toolInput, perField) {
  const out = structuredClone(toolInput);
  for (const f of perField) {
    if (f.mode !== 'enforce' || f.urlField) continue;
    setAt(out, f.path, f.masked);
  }
  return out;
}

function setAt(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = value;
}

export function summariseFindings(perField) {
  const counts = {};
  for (const f of perField) {
    for (const r of f.replacements) counts[r.entity_type] = (counts[r.entity_type] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t))
    .join(', ');
}

export function tokenMapLines(perField) {
  const seen = new Set();
  const lines = [];
  for (const f of perField) {
    for (const r of f.replacements || []) {
      if (seen.has(r.replacement)) continue;
      seen.add(r.replacement);
      lines.push(`  ${r.replacement} = ${r.entity_type.toLowerCase()} (commit ${shortCommit(r.value_commitment)})`);
    }
  }
  return lines;
}

function shortCommit(b64u) {
  return String(b64u).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
}

// === Commerce-tier (VI) — separate path from the PII rewrite/deny logic. ===
// A tool call is commerce-tier when its name matches a payment/checkout MCP
// pattern OR it's a WebFetch to a host explicitly listed in
// ZEROH_COMMERCE_HOSTS (comma-separated, no scheme). Commerce-tier calls
// require an active VI mandate and commerce fulfillment. Strict agent mode
// requires deterministic fields extracted from the actual tool input; legacy
// `_intent_fulfillment` remains a non-strict compatibility path.

const COMMERCE_NAME_RE = /^mcp__.*(payment|checkout|commerce)/i;

export function isCommerceTool(toolName, toolInput) {
  if (typeof toolName !== 'string') return false;
  if (COMMERCE_NAME_RE.test(toolName)) return true;
  if (toolName === 'WebFetch') {
    const hostsRaw = process.env.ZEROH_COMMERCE_HOSTS || '';
    if (!hostsRaw.trim()) return false;
    const hosts = hostsRaw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    try {
      const u = new URL(toolInput?.url);
      return hosts.includes(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Gate a commerce-tier tool call against an active VI mandate.
 *
 * Returns one of:
 *   { action: 'allow' }                                — checks pass
 *   { action: 'deny', reason: 'no_mandate' | 'missing_fulfillment' | 'scope_violation',
 *     message: string, violations?: { type, reason }[] }
 *
 * Caller (pre-tool-use hook) translates this into the Claude Code hook
 * output JSON.
 */
export function evaluateCommerce(args) {
  return evaluateCommerceIntent(args);
}
