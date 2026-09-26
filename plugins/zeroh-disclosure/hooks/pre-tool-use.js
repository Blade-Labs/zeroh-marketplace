#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// PreToolUse: before a tool runs, put real values back for tokens the model
// used (only for allowed hosts), and deny calls that would leak a secret or
// change ZeroH's own settings.
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
import { hmacKeyBytes, loadSession, writeJson } from '../lib/session.js';
import {
  applyMasked,
  evaluateToolUse,
  mintedTokens,
  restoreForTool,
  summariseFindings,
  tokenMapLines,
} from '../lib/tool-policies.js';
import { saveQuietly, Vault } from '../lib/vault.js';
import {
  bashSensitiveReason,
  checkDestinations,
  destinationText,
  expiredTokens,
  hostsIn,
  isSensitivePath,
  loadAllowRules,
  powershellSensitiveReason,
} from '../lib/secrets.js';
import { recordDestinationCheck } from '../lib/report.js';
import {
  emit,
  projectDir,
  proxyActive,
  readStdinJson,
  refreshRoute,
} from '../lib/hook-io.js';
import {
  wrapBashExitStatus,
  wrapPowerShellExitStatus,
} from '../lib/exit-status.js';
import {
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from '../lib/late-bind.js';
import {
  deniesElicitationHookEdits,
  deniesUserOnlyCommand,
  deniesZeroHSettings,
  SETTINGS_DENY_REASON,
  USER_ONLY_DENY_REASON,
} from '../lib/settings-guard.js';
import { isSecretType, tokenType } from '../lib/data-kinds.js';
import { shellOf } from '../lib/shell-tools.js';
import { claimUnmaskMcpSession } from '../lib/unmask.js';
import { terminalCommand } from '../lib/fix-command.js';

// Fail closed (hooks/run.js): any unexpected error denies the call instead of
// letting the tool run unguarded.
const event = await readStdinJson();
const toolName = event?.tool_name;
const toolInput = event?.tool_input;
const toolUseId = event?.tool_use_id || `anon-${Date.now()}`;
// One project root for sessions, vault and configuration (see projectDir).
const cwd = projectDir(event);
const sessionId = event?.session_id;

if (!toolName || !toolInput) process.exit(0);

// The guards need no configuration, so they run before it is loaded: a project
// file that cannot be read must not switch them off.
const root = projectDir(event);
if (deniesUserOnlyCommand(toolName, toolInput)) {
  emitDeny(USER_ONLY_DENY_REASON);
  process.exit(0);
}
// Skill and SlashCommand are matched only for the check above. Their
// arguments become prompt text, so nothing is ever restored into them.
if (toolName === 'Skill' || toolName === 'SlashCommand') process.exit(0);
if (deniesElicitationHookEdits(toolName, toolInput, root)) {
  emitDeny(
    'ZeroH Disclosure blocked an attempt to add or change an Elicitation hook. Unmask consent must be answered by the user in Claude Code.',
  );
  process.exit(0);
}
if (deniesZeroHSettings(toolName, toolInput, root)) {
  emitDeny(SETTINGS_DENY_REASON);
  process.exit(0);
}
try {
  await loadConfig({ cwd });
} catch {
  emitDeny(
    '🛡  ZeroH Disclosure denied this tool call because it could not read its configuration (.zeroh.env). Ask the user to fix or remove that file.',
  );
  process.exit(0);
}

// Private keys, keystores and credential stores never enter the conversation,
// and neither does a secrets file piped through an encoder.
refreshRoute(event);
if (
  /request_unmask$/u.test(toolName) &&
  !claimUnmaskMcpSession(root, sessionId)
) {
  emitDeny(
    'ZeroH Disclosure refused this unmask request because another session is starting one for the same project. Try again after that request finishes.',
  );
  process.exit(0);
}
// Background shells and Monitor stream their output to the model without a
// PostToolUse call, so only the proxy can mask it.
const shell = shellOf(toolName);
const background =
  toolName === 'Monitor' ||
  (shell !== null && toolInput.run_in_background === true);
if (
  background &&
  !(await proxyActive({
    sessionId: event?.session_id ?? null,
    requireSeen: true,
  }))
) {
  emitDeny(
    [
      `🛡  ZeroH Disclosure blocked this ${toolName === 'Monitor' ? 'Monitor' : `background ${toolName}`} call: its output reaches you without passing ZeroH's output masking, and the ZeroH proxy is not active in this session.`,
      '',
      toolName === 'Monitor'
        ? 'Run the command in the foreground with Bash instead, or ask the user to turn the ZeroH proxy on.'
        : 'Run the command in the foreground (without run_in_background), or ask the user to turn the ZeroH proxy on.',
    ].join('\n'),
  );
  process.exit(0);
}
const sensitive = sensitiveReason(toolName, toolInput, root);
if (sensitive) {
  emitDeny(
    [
      `🛡  ZeroH Disclosure blocked this ${toolName} call: it ${sensitive}.`,
      '',
      'Files like this are never read into the conversation. If the task needs a value from',
      'it, ask the user to put it in an environment variable and refer to the variable.',
    ].join('\n'),
  );
  process.exit(0);
}
let vault;
try {
  vault = new Vault(root, { sessionId });
} catch {
  emitDeny(
    '🛡  ZeroH Disclosure denied this tool call because it could not open its vault. Ask the user to run `/zeroh-disclosure:doctor --fix`.',
  );
  process.exit(0);
}

// A token whose mapping expired has no value to put back. Running the call
// with the literal token would fail silently or write it into a file.
const expired = expiredTokens(toolInput, vault);
if (expired.length) {
  emitDeny(
    [
      `🛡  ZeroH Disclosure blocked this ${toolName} call: ${expired.join(', ')} expired and ZeroH no longer holds the value.`,
      '',
      'Do not use the token again. Tell the user the value expired and ask them to share it again,',
      'or re-read its source, so ZeroH can mask it under a new token.',
    ].join('\n'),
  );
  process.exit(0);
}

const session = await loadSession({ cwd, sessionId });

const pii = await evaluateToolUse({
  toolName,
  toolInput,
  hmacKeyBytes: hmacKeyBytes(session),
  vault,
});

if (pii.action === 'allow') {
  await finish(toolInput, null, false);
  process.exit(0);
}

const summary = summariseFindings(pii.perField);
const tokenLines = tokenMapLines(pii.perField);
await writeToolAudit({
  session,
  toolUseId,
  toolName,
  action: pii.action,
  policy: pii.policy,
  perField: pii.perField,
});

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
  if (tokenLines.length > 0)
    ctxLines.push(
      '',
      'If you reference these values, use the canonical tokens:',
      ...tokenLines,
    );
  await finish(toolInput, ctxLines.join('\n'), false);
  process.exit(0);
}

const updatedInput = applyMasked(toolInput, pii.perField);
const ctxLines = [
  `🛡  ZeroH Disclosure tokenized sensitive data in your ${toolName} input.`,
  '',
  `Tokenized ${summary}. The tool will run with the masked version below.`,
  'Treat tokens as opaque placeholders; they are deterministic — the same raw',
  'value always yields the same token within this session, so you can reason',
  'about identity ("the card from earlier") without seeing the value.',
];
if (tokenLines.length > 0)
  ctxLines.push('', 'Tokens in this call:', ...tokenLines);
await finish(updatedInput, ctxLines.join('\n'), true);
process.exit(0);

// Put real values back for tokens the model used, after checking that each
// restored secret goes only to hosts allowed for it. `changed` means the
// input already differs from what the model wrote.
async function finish(baseInput, context, changed = false) {
  // Tokens minted above for raw values the model wrote stay tokens.
  const rules = loadAllowRules(root);
  const plan = restoreForTool(
    toolName,
    baseInput,
    vault,
    mintedTokens(pii.perField),
    { rules },
  );
  const restored = plan.restored;
  const restoredInput = plan.input;
  // Last-use bookkeeping only; a failed write must not stop the restore.
  saveQuietly(vault, 'ZeroH Disclosure (PreToolUse)');
  const notes = context ? [context] : [];
  if (plan.held.length && plan.scope.mode === 'mcp') {
    notes.push(mcpHeldNote(plan.held, plan.scope.server));
  } else if (plan.held.length) {
    const held = [...new Set(plan.held.map((r) => r.token))];
    notes.push(
      `ZeroH Disclosure left ${held.join(', ')} as tokens in this ${toolName} input: it goes to a model or a service ZeroH does not restore into. Keep using the tokens.`,
    );
  }
  let allowedInput = restoredInput;
  let restoredForTool = restored.length > 0;
  // Monitor has no late binding, so it never gets a restore.
  if (restored.length && toolName === 'Monitor') {
    emitDeny(
      [
        '🛡  ZeroH Disclosure blocked this Monitor call: ZeroH cannot put real values back into a Monitor command.',
        '',
        'Ask the user to run it themselves, or to put the value in an environment variable the command reads.',
      ].join('\n'),
    );
    return;
  }
  if (restored.length) {
    const destinations = destinationText(toolName, restoredInput);
    const hosts = hostsIn(destinations);
    const check = checkDestinations(restored, destinations, vault, rules);
    await recordDestinationCheck({
      session,
      hosts,
      blockedHosts: check.violations.map((violation) => violation.host),
    });
    if (!check.ok) {
      // Plain words and the one slash command that allows it (DEST-3).
      const named = check.violations.map((violation) => ({
        ...violation,
        label: violation.name || violation.token,
        command: `/zeroh-disclosure:allow ${shellArg(violation.name || violation.token)} ${shellArg(violation.host)}`,
      }));
      const lines = [
        `🛡  ZeroH Disclosure blocked this ${toolName} call: ${leavingKind(check.violations)} would leave for a host it is not allowed to reach.`,
        '',
        ...named.map((v) => `${v.label} may not be sent to ${v.host}.`),
        '',
        'Only the user can allow this. Do not try another way; ask the user to type:',
        ...named.map((v) => `  ${v.command}`),
      ];
      // --cwd pins the rule to the project the hook reads, even when the
      // user's shell sits in a subdirectory.
      const commands = named.map(
        (v) =>
          `${v.command}  (terminal: ${terminalCommand(['allow', '--cwd', root, v.name || v.token, v.host])})`,
      );
      emitDeny(
        lines.join('\n'),
        [
          `ZeroH Disclosure blocked ${named.map((v) => `${v.label} → ${v.host}`).join(', ')}. To allow it, type:`,
          ...commands,
        ].join('\n'),
      );
      return;
    }
    if (shell && typeof baseInput.command === 'string') {
      // Monitor never gets here: it has no late binding and was denied above.
      const prepareLateBinding =
        shell === 'powershell'
          ? preparePowerShellLateBinding
          : prepareBashLateBinding;
      const lateBinding = prepareLateBinding({
        command: baseInput.command,
        vault,
        sessionId,
        toolUseId,
      });
      if (!lateBinding.ok) {
        const tokens = [...new Set(restored.map((entry) => entry.token))];
        emitDeny(
          [
            `🛡  ZeroH Disclosure blocked this ${toolName} call: ${tokens.join(', ')} could not be safely late-bound (${lateBinding.reason}).`,
            '',
            'Use the token as a plain argument, inside double quotes, or assign it to a variable.',
            'ZeroH will never put a real value in Bash or PowerShell updatedInput.',
          ].join('\n'),
        );
        return;
      } else if (lateBinding.bindings.length > 0) {
        allowedInput = { ...baseInput, command: lateBinding.command };
      } else {
        allowedInput = baseInput;
        restoredForTool = false;
      }
    } else {
      notes.push(
        `ZeroH Disclosure restored literally for ${toolName} because that tool requires the real value in its input.`,
      );
    }
    if (restoredForTool) {
      const names = [...new Set(restored.map((r) => r.token))];
      notes.push(
        `ZeroH Disclosure put the real value back for ${names.join(', ')} on the user's machine. The value is not shown to you; keep using the tokens.`,
      );
    }
  }
  const shellInput = withExitStatus(
    restored.length || changed ? allowedInput : baseInput,
    baseInput,
  );
  const updated = restored.length || changed || shellInput !== baseInput;
  if (!updated && !notes.length) return;
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...(updated ? { updatedInput: shellInput } : {}),
      ...(notes.length ? { additionalContext: notes.join('\n\n') } : {}),
    },
  });
}

// Tokens an MCP tool receives unrestored: the value stays masked for this tool
// unless the user allows its MCP server for the value.
function mcpHeldNote(held, server) {
  const tokens = [...new Set(held.map((r) => r.token))];
  const names = [
    ...new Set(
      tokens.map((token) => {
        const source = String(vault.entryOf(token)?.source ?? '');
        return source.startsWith('known:') ? source.slice(6) : token;
      }),
    ),
  ];
  const lines = [
    `ZeroH Disclosure passed ${tokens.join(', ')} to ${toolName} as ${tokens.length > 1 ? 'tokens' : 'a token'}: the real value stays masked for this MCP tool, because the user has not allowed ${server ? `the ${server} MCP server` : 'this MCP server'} to receive it.`,
  ];
  if (server) {
    lines.push(
      'If the tool needs the real value, ask the user to allow it:',
      ...names.map(
        (name) =>
          `  /zeroh-disclosure:allow ${shellArg(name)} mcp:${server}  (terminal: ${terminalCommand(['allow', '--cwd', root, name, `mcp:${server}`])})`,
      ),
    );
  }
  lines.push('Keep using the tokens; do not ask the user for the value.');
  return lines.join('\n');
}

// A foreground Bash or PowerShell command always ends with status 0 and reports
// a failure in its output, so its output reaches PostToolUse (see
// lib/exit-status.js). Background commands keep their own status: their output
// never passes PostToolUse and only the proxy masks it.
function withExitStatus(input, original) {
  if (input?.run_in_background === true || typeof input?.command !== 'string')
    return input;
  // Monitor streams its output instead of finishing with a status.
  if (toolName === 'Monitor') return input;
  if (shell === 'bash') {
    return {
      ...input,
      command: wrapBashExitStatus(input.command, {
        original: original.command,
      }),
    };
  }
  if (shell === 'powershell') {
    return { ...input, command: wrapPowerShellExitStatus(input.command) };
  }
  return input;
}

function sensitiveReason(name, input, dir) {
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    const p = input.file_path || input.notebook_path || input.path;
    if (p && isSensitivePath(p, dir))
      return `touches ${p}, a private key or credential store`;
  }
  if (typeof input.command !== 'string') return null;
  if (shellOf(name) === 'bash') return bashSensitiveReason(input.command, dir);
  if (shellOf(name) === 'powershell') {
    return powershellSensitiveReason(input.command, dir);
  }
  return null;
}

async function writeToolAudit({
  session,
  toolUseId,
  toolName,
  action,
  policy = null,
  perField = [],
}) {
  await writeJson(path.join(session.dir, `tool-${sanitize(toolUseId)}.json`), {
    tool_use_id: toolUseId,
    tool_name: toolName,
    created_at: new Date().toISOString(),
    action,
    policy,
    fields: perField.map((f) => ({
      path: f.path,
      mode: f.mode,
      url_field: f.urlField,
      findings: f.findings.map(
        ({ type, risk, start, end, length, confidence }) => ({
          type,
          risk,
          start,
          end,
          length,
          confidence,
        }),
      ),
      replacements: f.replacements,
    })),
  });
}

function emitDeny(reason, systemMessage = null) {
  emit({
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function shellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:[\]-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function sanitize(s) {
  return String(s)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80);
}

// "a secret", "personal data" or both, from the token types in the
// violations (`[EMAIL-…]` is personal data, `[API_KEY-…]` a secret).
function leavingKind(violations) {
  const kinds = new Set(
    violations.map((v) =>
      isSecretType(tokenType(v.token)) ? 'secret' : 'personal',
    ),
  );
  if (kinds.size > 1) return 'a secret or personal data';
  return kinds.has('personal') ? 'personal data' : 'a secret';
}
