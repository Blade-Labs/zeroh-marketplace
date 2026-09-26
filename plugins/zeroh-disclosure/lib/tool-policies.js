// SPDX-License-Identifier: AGPL-3.0-only

// Per-tool extraction + policy for PreToolUse. Pure functions; the hook glues
// them together. Detector hits in URL-shaped fields always force deny (a URL
// with PII can't be rewritten without breaking the request); warn-mode fields
// (e.g. Edit's old_string) never change the action — they only contribute
// additionalContext so Claude knows the file already contains sensitive data.

import { detectSensitiveData } from './detector.js';
import { hmacSha256B64u } from './crypto.js';
import { mcpServerAllowed, mcpServerOf, restoreDeep } from './secrets.js';
import { shortCommit, typeSummary } from './report-counts.js';
import { shellOf } from './shell-tools.js';

// What happens when the model writes a raw secret into a tool's input. Fixed:
// a shell command or an MCP call that carries one is denied (rewriting it
// would break the command or leak its structure); a file write, a URL fetch
// or a subagent prompt gets tokens instead of the value.
const POLICIES = {
  Bash: 'deny',
  Monitor: 'deny',
  PowerShell: 'deny',
  Write: 'rewrite',
  Edit: 'rewrite',
  WebFetch: 'rewrite',
  Agent: 'rewrite',
};

export function policyFor(toolName) {
  if (typeof toolName !== 'string') return null;
  if (toolName.startsWith('mcp__')) return 'deny';
  return POLICIES[toolName] ?? null;
}

export function extractFields(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  if (toolName.startsWith('mcp__')) {
    return collectStrings(toolInput, []).map((s) => ({
      ...s,
      mode: 'enforce',
    }));
  }
  if (shellOf(toolName)) return strField(toolInput, 'command');
  switch (toolName) {
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
  if (typeof node === 'string')
    return node.length > 0 ? [{ path, value: node, urlField: false }] : [];
  if (Array.isArray(node))
    return node.flatMap((v, i) => collectStrings(v, [...path, i]));
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([k, v]) =>
      collectStrings(v, [...path, k]),
    );
  return [];
}

// Tool input is written by the model, not typed by the user, so it is checked
// for raw secrets only: personal data the model writes into a file, a commit
// message or an issue title is its own output (the loose typed-prompt rules
// would turn issue numbers and dates into phone numbers or IDs). Rewritten
// values get tokens registered in `vault`, so every token that reaches a file
// can be resolved later; PreToolUse does not restore them into this call.
//
// Only shape-certain findings act on tool input: provider formats, PEM keys,
// URL credentials, Bearer headers. The key-name rules (`password: …`,
// generic-api-key) are not used here: the model never saw a real value it
// could write (every real value reached it as a token), so a key-name hit in
// its own Write, Edit, heredoc or MCP call is code (`process.env.X!`,
// `apiKey: API_KEY`), and rewriting it would corrupt the file on disk. Those
// rules still mask tool output.
export const TOOL_INPUT_PROFILE = 'secrets';

function inputFindings(text) {
  return detectSensitiveData(text, { profile: TOOL_INPUT_PROFILE }).filter(
    (finding) => !finding.generic,
  );
}

export async function evaluateToolUse({
  toolName,
  toolInput,
  hmacKeyBytes,
  vault,
}) {
  const policy = policyFor(toolName);
  if (!policy) return { action: 'allow', policy: null, perField: [] };

  const fields = extractFields(toolName, toolInput);
  if (fields.length === 0) return { action: 'allow', policy, perField: [] };

  const perField = [];
  for (const f of fields) {
    const findings = inputFindings(f.value);
    if (findings.length === 0) continue;
    const masked = await maskWithVault(f.value, findings, {
      vault,
      hmacKeyBytes,
    });
    perField.push({
      path: f.path,
      mode: f.mode,
      urlField: !!f.urlField,
      original: f.value,
      masked: masked.text,
      findings,
      replacements: masked.replacements,
    });
  }

  if (perField.length === 0) return { action: 'allow', policy, perField: [] };

  const hasUrlHit = perField.some((f) => f.urlField);
  const hasEnforceHit = perField.some(
    (f) => f.mode === 'enforce' && !f.urlField,
  );

  let action;
  if (hasUrlHit) action = 'deny';
  else if (hasEnforceHit) action = policy;
  else action = 'warn';

  return { action, policy, perField };
}

async function maskWithVault(text, findings, { vault, hmacKeyBytes }) {
  if (!vault) throw new Error('evaluateToolUse needs the vault to mint tokens');
  const replacements = [];
  let out = '';
  let cursor = 0;
  for (const f of findings) {
    const raw = text.slice(f.start, f.end);
    const token = vault.tokenFor(f.type, raw, 'detected');
    out += text.slice(cursor, f.start) + token;
    cursor = f.end;
    replacements.push({
      entity_type: f.type,
      risk: f.risk,
      start: f.start,
      end: f.end,
      original_length: raw.length,
      replacement: token,
      value_commitment: await hmacSha256B64u(hmacKeyBytes, {
        type: f.type,
        value: raw,
      }),
    });
  }
  return { text: out + text.slice(cursor), replacements };
}

// Tokens this module put into an input (never restored in the same call).
export function mintedTokens(perField) {
  return new Set(
    perField.flatMap((f) => (f.replacements || []).map((r) => r.replacement)),
  );
}

// Where PreToolUse may put real values back for a tool (I2):
//   all      local tools: files, search, shell (shell is late-bound and checked)
//   fields   only these input fields (WebFetch: the URL, host-checked; its
//            `prompt` goes to a model and keeps tokens)
//   none     Agent/Task/Skill/SlashCommand: the text goes to a model; tokens pass
//            through and the subagent's own tool calls are restored
//   mcp      other MCP tools: only values the user allowed for this MCP server
//            (`zeroh-disclosure allow NAME mcp:<server>`); every other token
//            passes through as a token. Hosts the input mentions never count.
//   passthrough  ZeroH's own MCP tools: tokens stay tokens
export function restoreScope(toolName) {
  const name = String(toolName ?? '');
  if (['Agent', 'Task', 'Skill', 'SlashCommand'].includes(name))
    return { mode: 'none' };
  if (name === 'WebFetch') return { mode: 'fields', fields: ['url'] };
  if (name.startsWith('mcp__')) {
    if (
      /zeroh-disclosure.*__(?:request_unmask|end_unmask|report_missed_secret)$/u.test(
        name,
      )
    )
      return { mode: 'passthrough' };
    return { mode: 'mcp', server: mcpServerOf(name) };
  }
  return { mode: 'all' };
}

// Put real values back into `input` as far as restoreScope(toolName) allows.
// `restored` lists the tokens restored; `held` the vault tokens left as tokens.
// `rules` are the user's signed allow rules (needed for MCP tools).
export function restoreForTool(
  toolName,
  input,
  vault,
  minted = null,
  { rules = {} } = {},
) {
  const scope = restoreScope(toolName);
  const restored = [];
  if (scope.mode === 'mcp') {
    const found = [];
    restoreDeep(input, vault, found, minted);
    const skip = new Set(minted ?? []);
    const held = [];
    for (const entry of found) {
      const allowed = mcpServerAllowed(
        { token: entry.token, entry: vault.entryOf(entry.token) },
        rules,
        scope.server,
      );
      if (!allowed) {
        skip.add(entry.token);
        held.push(entry);
      }
    }
    const out = restoreDeep(input, vault, restored, skip);
    return { scope, input: out, restored, held };
  }
  if (scope.mode === 'none' || scope.mode === 'passthrough') {
    const held = [];
    restoreDeep(input, vault, held, minted);
    return { scope, input, restored, held };
  }
  if (scope.mode === 'fields') {
    const out = { ...input };
    const held = [];
    for (const [key, value] of Object.entries(input)) {
      if (scope.fields.includes(key))
        out[key] = restoreDeep(value, vault, restored, minted);
      else restoreDeep(value, vault, held, minted);
    }
    return { scope, input: out, restored, held };
  }
  const out = restoreDeep(input, vault, restored, minted);
  return { scope, input: out, restored, held: [] };
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
  return typeSummary(perField.flatMap((field) => field.replacements));
}

export function tokenMapLines(perField) {
  const seen = new Set();
  const lines = [];
  for (const f of perField) {
    for (const r of f.replacements || []) {
      if (seen.has(r.replacement)) continue;
      seen.add(r.replacement);
      lines.push(
        `  ${r.replacement} = ${r.entity_type.toLowerCase()} (commit ${shortCommit(r.value_commitment)})`,
      );
    }
  }
  return lines;
}
