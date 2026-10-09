#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { referencesAllowed } from '../packages/shell-analysis/reference-allow.js';
// PreToolUse: before a tool runs, put real values back for tokens the model
// used (only for allowed hosts), and deny calls that would leak a secret or
// change ZeroH's own settings.
import {
  recordUnchecked,
  uncheckedNotice,
} from '../packages/zeroh-disclosure-core/unchecked.js';
import { shellDestinations } from '../packages/shell-analysis/shell-destinations.js';
import {
  bracedReference,
  inlineReferences,
  referenceFindings,
} from '../packages/shell-analysis/shell-references.js';
import {
  hmacKeyBytes,
  loadSession,
} from '../packages/zeroh-disclosure-core/session.js';
import {
  applyMasked,
  evaluateToolUse,
  mintedTokens,
  restoreForTool,
  summariseFindings,
  tokenMapLines,
} from '../packages/zeroh-disclosure-core/tool-policies.js';
import { saveQuietly } from '../packages/zeroh-disclosure-core/vault.js';
import {
  saveRestorably,
  UNSAVEABLE_REASON,
} from '../packages/zeroh-disclosure-core/restorable.js';
import {
  checkDestinations,
  destinationText,
  expiredTokens,
  hostsIn,
  maskedHost,
  loadAllowRules,
  mcpServerAllowed,
  mcpServerOf,
  networkHostsIn,
} from '../packages/shell-analysis/secrets.js';
import { recordDestinationCheck } from '../packages/zeroh-disclosure-core/report.js';
import { emit, projectDir, readStdinJson } from '../lib/hook-io.js';
import {
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from '../packages/shell-analysis/late-bind.js';
import { styleKey } from '../lib/style.js';
import { BANNER_MODES } from '../lib/banner.js';
import {
  leavingKind,
  referenceName,
  shellArg,
  subjectOf,
  urlHosts,
} from '../lib/hook-steps/pre-tool-use/describe-tool-use.js';
import { guardToolSettings } from '../lib/hook-steps/pre-tool-use/guard-tool-settings.js';
import { guardToolRuntime } from '../lib/hook-steps/pre-tool-use/guard-tool-runtime.js';
import { createToolOutput } from '../lib/hook-steps/pre-tool-use/tool-output.js';

const SAVE_LABEL = 'ZeroH Disclosure (PreToolUse)';

// Fail closed (hooks/run.js): any unexpected error denies the call instead of
// letting the tool run unguarded.
const event = await readStdinJson();
const toolName = event?.tool_name;
const toolInput = event?.tool_input;
const toolUseId = event?.tool_use_id || `anon-${Date.now()}`;
// One project root for sessions, vault and configuration (see projectDir).
const cwd = projectDir(event);
const commandCwd = event?.cwd || cwd; // where a relative command path runs
const sessionId = event?.session_id;

if (!toolName || !toolInput) process.exit(0);

// One-line notices for the user (systemMessage) about what ran without
// ZeroH's full protection (owner rule 2026-09-27: pass by default; see
// packages/zeroh-disclosure-core/unchecked.js). Each emit below carries them.
const notices = [];
// What the model is told when its call runs with a token instead of the
// value (additionalContext), so it can fix the call itself.
const modelNotes = [];
let mode;
let shell;
let vault;
let session;
let pii;
const {
  emitDeny,
  emitDestinationDeny,
  emitNotices,
  finish,
  mcpHeldNote,
  nameOf,
  valueNameOf,
  withExitStatus,
  writeToolAudit,
} = createToolOutput({
  toolName,
  root: projectDir(event),
  notices,
  modelNotes,
  passUnchecked,
  emit,
  getRuntime: () => ({
    mode,
    pii,
    session,
    sessionId,
    shell,
    toolUseId,
    vault,
  }),
});
async function passUnchecked(
  reason,
  { subject = 'command', valueName = null } = {},
) {
  const { notice } = await recordUnchecked({
    reason,
    tool: toolName,
    cwd,
    sessionId,
    subject,
    valueName,
  });
  if (notice && !notices.includes(notice)) notices.push(notice);
}

// The guards run whether or not the configuration can be read: a project
// file that cannot be read must not switch them off. It is read first only
// for the `uncertain` mode (pass by default, see packages/zeroh-disclosure-core/config.js).
const root = projectDir(event);
const guarded = await guardToolSettings({
  toolName,
  toolInput,
  root,
  commandCwd,
  cwd,
  styleKey,
  bannerModes: BANNER_MODES,
  passUnchecked,
  emitDeny,
});
mode = guarded.mode;
if (guarded.exit) process.exit(0);

const runtimeGuard = await guardToolRuntime({
  event,
  toolName,
  toolInput,
  root,
  sessionId,
  mode,
  notices,
  modelNotes,
  passUnchecked,
  emitDeny,
  emitNotices,
});
if (runtimeGuard.exit) process.exit(0);
({ shell, vault } = runtimeGuard);

// A token whose mapping expired has no value to put back. Running the call
// with the literal token would fail silently or write it into a file.
const expired = expiredTokens(toolInput, vault);
if (expired.length && mode !== 'block') {
  // Runs with the token text where the value expired (owner decision
  // 2026-09-27); any other token is still put back below.
  await passUnchecked('token-expired', { subject: subjectOf(toolName) });
  modelNotes.push(
    `ZeroH Disclosure no longer holds the value of ${expired.join(', ')} (it expired), so this call used the token text. Do not use the token again: re-read its source so ZeroH masks it under a new token, or ask the user to share it again.`,
  );
} else if (expired.length) {
  // deny-inventory: expired-token
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

session = await loadSession({ cwd, sessionId });

pii = await evaluateToolUse({
  toolName,
  toolInput,
  hmacKeyBytes: hmacKeyBytes(session),
  vault,
});
// Rule 8 (packages/zeroh-disclosure-core/restorable.js): a token written into the input (a file, a
// subagent prompt, the model's context) must be one ZeroH can put back. When
// the vault can't be saved, only the values already on disk become tokens;
// the rest stay as the model wrote them, with the notice. A raw secret in a
// command or an MCP call is never swapped (its tokens are for the
// destination check only), so it needs no save here.
if (
  (pii.action === 'rewrite' || pii.action === 'warn') &&
  pii.perField.some((field) => field.replacements?.length)
) {
  const { fallback } = saveRestorably(vault, SAVE_LABEL);
  if (fallback) {
    if (mode === 'block') {
      // deny-inventory: vault-unsaveable-tool
      emitDeny(
        '🛡  ZeroH Disclosure denied this tool call because it could not save its vault, so a value it would mask here could never be put back. Try again; if it keeps happening, ask the user to run `/zeroh-disclosure:doctor`.',
      );
      process.exit(0);
    }
    const kept = await evaluateToolUse({
      toolName,
      toolInput,
      hmacKeyBytes: hmacKeyBytes(session),
      vault: fallback,
    });
    const perField = kept.perField
      .filter((field) => field.replacements.length)
      .map((field) => ({
        ...field,
        findings: field.findings.filter((finding) =>
          field.replacements.some(
            (replacement) => replacement.start === finding.start,
          ),
        ),
      }));
    pii = perField.length
      ? { ...kept, perField }
      : { action: 'allow', policy: kept.policy, perField: [] };
    await passUnchecked(UNSAVEABLE_REASON, { subject: subjectOf(toolName) });
  }
}

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

// A secret finding in a Bash or PowerShell command whose whole value, as
// that shell parses it, is variable references (`curl -u "$STRIPE_KEY:"`,
// `-u "$USER:$PASS"`, `$env:KEY`) is not a raw secret the model wrote: it
// names where a value lives (packages/shell-analysis/shell-references.js). The detector masks
// references like any value (it cannot know the interpreter); the stop is
// decided here. What a reference sends is whatever the variable holds,
// which ZeroH cannot see, so a command that sends anything anywhere (a
// host, or a destination it cannot read) is an uncertain destination:
// `pass` mode runs it with a notice, `block` mode stops it, whatever the
// host. A command with no destination runs as it is. A literal anywhere in
// the finding (single quotes, `%X%` or `{{x}}` in Bash, a default, a
// command substitution) keeps it a raw secret.
const references =
  pii.action === 'deny' ? referenceFindings(pii.perField, shell) : new Set();
const isReference = (index, entry) => references.has(`${index}:${entry.start}`);
const onlyReferences =
  references.size > 0 &&
  pii.perField.every((field, index) =>
    (field.replacements || []).every((entry) => isReference(index, entry)),
  );
const referenceSent =
  onlyReferences &&
  (() => {
    const command = String(toolInput.command ?? '');
    return (
      hostsIn(destinationText(toolName, toolInput)).length > 0 ||
      networkHostsIn(command, { shell }).length > 0 ||
      shellDestinations(command, { shell }).uncertain.length > 0
    );
  })();
if (onlyReferences && !referenceSent) {
  await finish(toolInput, null, false);
  process.exit(0);
}
if (onlyReferences) {
  const destinations = shellDestinations(String(toolInput.command ?? ''), {
    shell,
  });
  const hosts = networkHostsIn(String(toolInput.command ?? ''), { shell });
  if (
    !destinations.uncertain.length &&
    referencesAllowed(pii.perField, shell, loadAllowRules(root), hosts)
  ) {
    await finish(toolInput, null, false);
    process.exit(0);
  }
  const valueName = referenceName(pii.perField);
  if (mode === 'block') {
    // deny-inventory: variable-in-command
    emitDeny(
      [
        uncheckedNotice('variable-in-command', { mode: 'block', valueName }),
        '',
        "ZeroH can't check where a variable the command loads itself goes. Ask the user to run the command, or to allow it with /zeroh-disclosure:settings uncertain pass.",
      ].join('\n'),
    );
    process.exit(0);
  }
  await passUnchecked('variable-in-command', { valueName });
  await finish(toolInput, null, false);
  process.exit(0);
}

// D-23: a raw known secret the model wrote into a shell command or an MCP
// call is not swapped and not denied: it gets the same destination rules as
// a restored token. A known-disallowed destination is blocked; an allowed one
// runs; an uncertain one runs with a notice. Tool output stays masked as
// always. `block` mode keeps the rc.1 rule and denies the call.
// WebFetch: a raw secret in its URL gets the same rules (owner decision
// 2026-09-27): the URL's host must be allowed for it.
const rawPass =
  pii.action === 'deny' &&
  mode !== 'block' &&
  (toolName === 'WebFetch' ||
    (!pii.perField.some((field) => field.urlField) &&
      (shell !== null || toolName.startsWith('mcp__'))));
if (rawPass) {
  // References beside a literal are left out: the literal decides.
  const raw = [
    ...new Set(
      pii.perField.flatMap((field, index) =>
        (field.replacements || [])
          .filter((entry) => !isReference(index, entry))
          .map((entry) => entry.replacement),
      ),
    ),
  ].map((token) => ({ token }));
  const rules = loadAllowRules(root);
  if (shell) {
    const command = String(toolInput.command ?? '');
    const text = destinationText(toolName, toolInput);
    const hosts = [
      ...new Set([...hostsIn(text), ...networkHostsIn(command, { shell })]),
    ];
    const check = checkDestinations(raw, text, vault, rules, { hosts });
    await recordDestinationCheck({
      session,
      hosts: hosts.map((host) => maskedHost(host, raw, vault)),
      blockedHosts: check.violations.map((violation) => violation.host),
    });
    if (!check.ok) {
      emitDestinationDeny(check.violations);
      process.exit(0);
    }
    if (shellDestinations(command, { shell }).uncertain.length) {
      await passUnchecked('raw-secret-in-command', {
        valueName: valueNameOf(raw),
      });
    }
  } else if (toolName === 'WebFetch') {
    const hosts = urlHosts(toolInput.url);
    const check = checkDestinations(
      raw,
      destinationText(toolName, toolInput),
      vault,
      rules,
      { hosts },
    );
    await recordDestinationCheck({
      session,
      hosts,
      blockedHosts: check.violations.map((violation) => violation.host),
    });
    if (!check.ok) {
      emitDestinationDeny(check.violations);
      process.exit(0);
    }
    if (!hosts.length) {
      await passUnchecked('raw-secret-in-command', {
        subject: 'tool call',
        valueName: valueNameOf(raw),
      });
    }
  } else {
    const server = mcpServerOf(toolName);
    const blocked = raw.filter(
      ({ token }) =>
        !mcpServerAllowed(
          { token, entry: vault.entryOf(token) },
          rules,
          server,
        ),
    );
    if (blocked.length) {
      const names = [...new Set(blocked.map(({ token }) => nameOf(token)))];
      // deny-inventory: mcp-not-allowed
      emitDeny(
        [
          `🛡  ZeroH Disclosure blocked this ${toolName} call: it holds ${names.join(', ')}, and the user has not allowed ${server ? `the ${server} MCP server` : 'this MCP server'} to receive it.`,
          '',
          'Only the user can allow this. Do not try another way; ask the user to type:',
          ...names.map(
            (name) =>
              `  /zeroh-disclosure:allow ${shellArg(name)} mcp:${server}`,
          ),
        ].join('\n'),
      );
      process.exit(0);
    }
  }
}

if (pii.action === 'deny' && !rawPass) {
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
  // deny-inventory: raw-secret-policy
  emitDeny(reason);
  process.exit(0);
}

if (rawPass) {
  await finish(toolInput, null, false);
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
