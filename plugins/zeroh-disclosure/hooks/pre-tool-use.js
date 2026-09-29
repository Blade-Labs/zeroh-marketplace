#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// PreToolUse: before a tool runs, put real values back for tokens the model
// used (only for allowed hosts), and deny calls that would leak a secret or
// change ZeroH's own settings.
import path from 'node:path';
import { loadConfig, uncertainMode } from '../lib/config.js';
import { recordUnchecked, uncheckedNotice } from '../lib/unchecked.js';
import { shellDestinations } from '../lib/shell-destinations.js';
import {
  bracedReference,
  inlineReferences,
  referenceFindings,
} from '../lib/shell-references.js';
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
import { saveRestorably, UNSAVEABLE_REASON } from '../lib/restorable.js';
import {
  bashSensitiveReason,
  checkDestinations,
  commandNamesZeroHSecret,
  destinationText,
  expiredTokens,
  hostsIn,
  maskedHost,
  isSensitivePath,
  isZeroHSecretPath,
  loadAllowRules,
  mcpServerAllowed,
  mcpServerOf,
  networkHostsIn,
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
  commandRunsClaudeControlCli,
  commandRunsZeroHManagement,
  deniesElicitationHookEdits,
  deniesUserOnlyCommand,
  deniesZeroHSettings,
  MANAGEMENT_DENY_REASON,
  protectedShellDecision,
  SETTINGS_DENY_REASON,
  USER_ONLY_DENY_REASON,
} from '../lib/settings-guard.js';
import { isSecretType, tokenType } from '../lib/data-kinds.js';
import { shellOf } from '../lib/shell-tools.js';
import { claimUnmaskMcpSession } from '../lib/unmask.js';
import { terminalCommand } from '../lib/fix-command.js';
import { TOKEN_RE } from '../lib/token-pattern.js';

const SAVE_LABEL = 'ZeroH Disclosure (PreToolUse)';

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

// One-line notices for the user (systemMessage) about what ran without
// ZeroH's full protection (owner rule 2026-09-27: pass by default; see
// lib/unchecked.js). Each emit below carries them.
const notices = [];
// What the model is told when its call runs with a token instead of the
// value (additionalContext), so it can fix the call itself.
const modelNotes = [];
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
// for the `uncertain` mode (pass by default, see lib/config.js).
const root = projectDir(event);
let configFailed = false;
try {
  configFailed = (await loadConfig({ cwd })).unreadable?.length > 0;
} catch {
  configFailed = true;
}
const mode = uncertainMode(process.env);
if (deniesUserOnlyCommand(toolName, toolInput)) {
  // deny-inventory: user-only-command
  emitDeny(USER_ONLY_DENY_REASON);
  process.exit(0);
}
// Skill and SlashCommand are matched only for the check above. Their
// arguments become prompt text, so nothing is ever restored into them.
if (toolName === 'Skill' || toolName === 'SlashCommand') process.exit(0);
if (deniesElicitationHookEdits(toolName, toolInput, root)) {
  // deny-inventory: elicitation-hook
  emitDeny(
    'ZeroH Disclosure blocked an attempt to add or change an Elicitation hook. Unmask consent must be answered by the user in Claude Code.',
  );
  process.exit(0);
}
if (shellOf(toolName) && typeof toolInput.command === 'string') {
  // A UX answer: the CLI itself refuses management without the user's
  // authority (lib/user-authority.js); this says so before it runs.
  if (commandRunsZeroHManagement(toolInput.command, shellOf(toolName))) {
    // deny-inventory: management-cli
    emitDeny(MANAGEMENT_DENY_REASON);
    process.exit(0);
  }
  if (!commandRunsClaudeControlCli(toolInput.command)) {
    const decision = protectedShellDecision(toolName, toolInput, root, {
      mode,
    });
    if (decision.deny) {
      // deny-inventory: protected-path-write
      emitDeny(decision.reason);
      process.exit(0);
    }
    if (decision.unchecked) await passUnchecked(decision.unchecked);
  }
}
if (deniesZeroHSettings(toolName, toolInput, root, { mode })) {
  // deny-inventory: zeroh-settings
  emitDeny(SETTINGS_DENY_REASON);
  process.exit(0);
}
// An unreadable .zeroh.env: the defaults (and the user's own settings)
// apply, with a notice (owner decision 2026-09-27); `block` mode denies.
if (configFailed) {
  if (mode === 'block') {
    // deny-inventory: config-unreadable
    emitDeny(
      '🛡  ZeroH Disclosure denied this tool call because it could not read its configuration (.zeroh.env). Ask the user to fix or remove that file.',
    );
    process.exit(0);
  }
  await passUnchecked('config-unreadable', { subject: subjectOf(toolName) });
}

// Private keys, keystores and credential stores never enter the conversation,
// and neither does a secrets file piped through an encoder.
refreshRoute(event);
if (
  /request_unmask$/u.test(toolName) &&
  !claimUnmaskMcpSession(root, sessionId)
) {
  // deny-inventory: unmask-session-claim
  emitDeny(
    'ZeroH Disclosure refused this unmask request because another session is starting one for the same project. Try again after that request finishes.',
  );
  process.exit(0);
}
// Background shells and Monitor stream their output to the model without a
// PostToolUse call, so only the proxy can mask it. Without the proxy they run
// with a notice (D-22); `block` mode stops them.
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
  if (mode === 'block') {
    // deny-inventory: background-no-proxy
    emitDeny(
      [
        uncheckedNotice('proxy-not-running', { mode: 'block' }),
        '',
        `Its output would reach you without passing ZeroH's output masking. ${
          toolName === 'Monitor'
            ? 'Run the command in the foreground with Bash instead, or ask the user to turn the ZeroH proxy on.'
            : 'Run the command in the foreground (without run_in_background), or ask the user to turn the ZeroH proxy on.'
        }`,
      ].join('\n'),
    );
    process.exit(0);
  }
  await passUnchecked('proxy-not-running');
}
// Private keys and credential stores (A2): read by default, their output
// masked by PostToolUse like any other, with a notice; `block` mode stops
// them. A secrets file piped through an encoder would slip past masking: it
// runs with a notice too, and `block` mode stops it. ZeroH's own keys stay
// closed in every mode: reading one would undo the masking itself.
const sensitive = sensitiveReason(toolName, toolInput, root);
if (sensitive) {
  const zerohOwn =
    isZeroHSecretPath(
      toolInput.file_path || toolInput.notebook_path || toolInput.path,
    ) ||
    (typeof toolInput.command === 'string' &&
      commandNamesZeroHSecret(toolInput.command));
  if (zerohOwn || mode === 'block') {
    // deny-inventory: sensitive-file
    emitDeny(
      [
        `🛡  ZeroH Disclosure blocked this ${toolName} call: it ${sensitive}.`,
        '',
        zerohOwn
          ? "ZeroH's own keys are never read into the conversation."
          : 'Files like this are not read into the conversation while ZeroH blocks what it cannot fully protect (uncertain = block). If the task needs a value from it, ask the user to put it in an environment variable and refer to the variable.',
      ].join('\n'),
    );
    process.exit(0);
  }
  await passUnchecked(
    /encoder/u.test(sensitive) ? 'unknown-format' : 'sensitive-file-masked',
    { subject: shell ? 'command' : 'tool call' },
  );
}
let vault;
try {
  vault = new Vault(root, { sessionId });
} catch {
  if (mode === 'block') {
    // deny-inventory: vault-unavailable-tool
    emitDeny(
      '🛡  ZeroH Disclosure denied this tool call because it could not open its vault. Ask the user to run `/zeroh-disclosure:doctor --fix`.',
    );
    process.exit(0);
  }
  // Without the vault nothing can be put back: the call runs as written,
  // tokens and all (owner decision 2026-09-27).
  const holdsToken = new RegExp(TOKEN_RE.source, 'u').test(
    JSON.stringify(toolInput),
  );
  await passUnchecked(
    holdsToken ? 'token-vault-unavailable' : 'vault-unavailable',
    { subject: subjectOf(toolName) },
  );
  if (holdsToken) {
    modelNotes.push(
      `ZeroH Disclosure could not open its vault, so this ${toolName} call ran with the tokens as plain text, not the real values. Tell the user to run /zeroh-disclosure:doctor.`,
    );
  }
  emitNotices();
  process.exit(0);
}

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

const session = await loadSession({ cwd, sessionId });

let pii = await evaluateToolUse({
  toolName,
  toolInput,
  hmacKeyBytes: hmacKeyBytes(session),
  vault,
});
// Rule 8 (lib/restorable.js): a token written into the input (a file, a
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
// names where a value lives (lib/shell-references.js). The detector masks
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
  const valueName = referenceName(pii.perField);
  if (mode === 'block') {
    // deny-inventory: variable-in-command
    emitDeny(
      [
        uncheckedNotice('variable-in-command', { mode: 'block', valueName }),
        '',
        'ZeroH cannot see what the variable holds or check where it goes. Ask the user to run the command, or to allow it with /zeroh-disclosure:settings uncertain pass.',
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
  let restored = plan.restored;
  let restoredInput = plan.input;
  // Last-use bookkeeping only; a failed write must not stop the restore.
  saveQuietly(vault, SAVE_LABEL);
  const notes = context ? [context] : [];
  notes.push(...modelNotes);
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
  // Monitor has no late binding, so it never gets a restore: it runs with
  // the tokens (owner decision 2026-09-27); `block` mode denies it.
  if (restored.length && toolName === 'Monitor') {
    if (mode === 'block') {
      // deny-inventory: monitor-restore
      emitDeny(
        [
          '🛡  ZeroH Disclosure blocked this Monitor call: ZeroH cannot put real values back into a Monitor command.',
          '',
          'Ask the user to run it themselves, or to put the value in an environment variable the command reads.',
        ].join('\n'),
      );
      return;
    }
    await passUnchecked('token-monitor');
    notes.push(
      'ZeroH Disclosure cannot put real values into a Monitor command, so it ran with the tokens as plain text. Run the command with Bash instead, or read the value from an environment variable.',
    );
    restored = [];
    restoredInput = baseInput;
    allowedInput = baseInput;
    restoredForTool = false;
  }
  if (restored.length) {
    const destinations = destinationText(toolName, restoredInput);
    // Shell commands are read with the shell they run in: every network
    // command's destination operands, whatever launcher or quoting (rc.2).
    const shellCommand =
      shell && typeof baseInput.command === 'string' ? baseInput.command : null;
    // An email address put back as data is not a destination (ssh-style
    // operands still are): a local `git -c user.email=<token> commit` must
    // run with the real value (product rule 1).
    const addresses = restored
      .filter((entry) => tokenType(entry.token) === 'EMAIL')
      .map((entry) => vault.valueOf(entry.token))
      .filter(Boolean);
    const hosts = [
      ...new Set([
        ...hostsIn(destinations, { values: addresses }),
        ...(shellCommand ? networkHostsIn(shellCommand, { shell }) : []),
      ]),
    ];
    // A restored value that is itself only a variable reference in this
    // shell (`$STRIPE_KEY:` typed by the user, masked like any value) is
    // judged like a reference the model wrote (above): not a raw secret, an
    // uncertain destination. It is a variable's name, not a value, so it is
    // put back inline, where the token stands, and the shell expands it as
    // the user wrote it (product rule 1): occurrence by occurrence, only
    // where the tokenizer reads `${…}` at that place as an expansion, and
    // braced so the name keeps its boundary (`${STRIPE_KEY}_SUFFIX`). A
    // token with any other occurrence (single quotes, after `--%` …) is a
    // literal there: it is checked and late-bound like any value.
    const braced = new Map();
    if (shellCommand)
      for (const { token } of restored) {
        const text = bracedReference(vault.valueOf(token), shell);
        if (text) braced.set(token, text);
      }
    const inline = braced.size
      ? inlineReferences(shellCommand, shell, braced)
      : { command: shellCommand, inlined: new Set() };
    const references = restored.filter((entry) =>
      inline.inlined.has(entry.token),
    );
    const check = checkDestinations(
      restored.filter((entry) => !inline.inlined.has(entry.token)),
      destinations,
      vault,
      rules,
      { hosts },
    );
    await recordDestinationCheck({
      session,
      hosts: hosts.map((host) => maskedHost(host, restored, vault)),
      blockedHosts: check.violations.map((violation) => violation.host),
    });
    if (!check.ok) {
      emitDestinationDeny(check.violations);
      return;
    }
    if (
      references.length &&
      (hosts.length ||
        shellDestinations(shellCommand, { shell }).uncertain.length)
    ) {
      const valueName =
        /\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)/iu.exec(
          String(vault.valueOf(references[0].token)),
        )?.[1] ?? null;
      if (mode === 'block') {
        // deny-inventory: variable-in-command
        emitDeny(
          [
            uncheckedNotice('variable-in-command', {
              mode: 'block',
              valueName,
            }),
            '',
            'ZeroH cannot see what the variable holds or check where it goes. Ask the user to run the command, or to allow it with /zeroh-disclosure:settings uncertain pass.',
          ].join('\n'),
        );
        return;
      }
      await passUnchecked('variable-in-command', { valueName });
    }
    // Where the value goes cannot always be read: a $HOST, a script, an
    // unknown launcher, a command the tokenizer cannot parse. In `pass` mode
    // (the default) the command runs as it would without ZeroH and the pass
    // is recorded on the turn; in `block` mode it is denied.
    const uncertain = shellCommand
      ? [
          ...new Set(
            shellDestinations(shellCommand, { shell }).uncertain.map(
              (u) => u.reason,
            ),
          ),
        ]
      : [];
    if (uncertain.length && mode === 'block') {
      // deny-inventory: uncertain-destination
      emitDeny(
        [
          uncheckedNotice(uncertain[0], {
            mode: 'block',
            valueName: valueNameOf(restored),
          }),
          '',
          'Name the destination host literally in the command, or ask the user to run it.',
        ].join('\n'),
      );
      return;
    }
    for (const reason of uncertain) {
      await passUnchecked(reason, { valueName: valueNameOf(restored) });
    }
    if (shellCommand) {
      // Monitor never gets here: it has no late binding and was denied above.
      const prepareLateBinding =
        shell === 'powershell'
          ? preparePowerShellLateBinding
          : prepareBashLateBinding;
      const inlined = inline.command;
      const lateBinding = prepareLateBinding({
        command: inlined,
        vault,
        sessionId,
        toolUseId,
      });
      if (!lateBinding.ok && mode === 'block') {
        const tokens = [...new Set(restored.map((entry) => entry.token))];
        // deny-inventory: late-binding-failed
        emitDeny(
          [
            `🛡  ZeroH Disclosure blocked this ${toolName} call: ${tokens.join(', ')} could not be safely late-bound (${lateBinding.reason}).`,
            '',
            'Use the token as a plain argument, inside double quotes, or assign it to a variable.',
            'ZeroH will never put a real value in Bash or PowerShell updatedInput.',
          ].join('\n'),
        );
        return;
      } else if (!lateBinding.ok) {
        // Runs as written, with the tokens (owner decision 2026-09-27).
        await passUnchecked('token-late-binding');
        notes.push(
          `ZeroH Disclosure could not put the real value back safely (${lateBinding.reason}), so this ${toolName} call ran with the tokens as plain text. Use the token as a plain argument, inside double quotes, or assign it to a variable.`,
        );
        allowedInput = baseInput;
        restoredForTool = false;
      } else if (lateBinding.bindings.length > 0) {
        allowedInput = { ...baseInput, command: lateBinding.command };
      } else if (inlined !== baseInput.command) {
        allowedInput = { ...baseInput, command: inlined };
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
  if (!updated && !notes.length && !notices.length) return;
  emit({
    ...(notices.length ? { systemMessage: notices.join('\n') } : {}),
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...(updated ? { updatedInput: shellInput } : {}),
      ...(notes.length ? { additionalContext: notes.join('\n\n') } : {}),
    },
  });
}

// Plain words and the one slash command that allows it (DEST-3).
function emitDestinationDeny(violations) {
  const named = violations.map((violation) => ({
    ...violation,
    label: violation.name || violation.token,
    command: `/zeroh-disclosure:allow ${shellArg(violation.name || violation.token)} ${shellArg(violation.host)}`,
  }));
  const lines = [
    `🛡  ZeroH Disclosure blocked this ${toolName} call: ${leavingKind(violations)} would leave for a host it is not allowed to reach.`,
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
  // deny-inventory: host-not-allowed
  emitDeny(
    lines.join('\n'),
    [
      `ZeroH Disclosure blocked ${named.map((v) => `${v.label} → ${v.host}`).join(', ')}. To allow it, type:`,
      ...commands,
    ].join('\n'),
  );
}

// The name (or type) of the values in `entries` for a notice: the first
// named one.
// The name of the first variable a reference finding names (`STRIPE_KEY`
// from `$STRIPE_KEY:`), for the notice; lib/unchecked.js shows only an
// upper-case identifier.
function referenceName(perField) {
  for (const field of perField)
    for (const entry of field.replacements || []) {
      const text = String(field.original ?? '').slice(entry.start, entry.end);
      const name = /\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)/iu.exec(text);
      if (name) return name[1];
    }
  return null;
}

function valueNameOf(entries) {
  for (const { token } of entries) {
    const entry = vault.entryOf(token);
    const source = String(entry?.source ?? '');
    if (source.startsWith('known:')) return source.slice(6);
    if (entry?.type) return entry.type;
  }
  return null;
}

function nameOf(token) {
  const source = String(vault.entryOf(token)?.source ?? '');
  return source.startsWith('known:') ? source.slice(6) : token;
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

// 'command' for a shell tool, 'tool call' for any other (the notice's words).
function subjectOf(name) {
  return shellOf(name) ? 'command' : 'tool call';
}

// Only the notices: the call runs as the model wrote it.
function emitNotices() {
  if (!notices.length && !modelNotes.length) return;
  emit({
    ...(notices.length ? { systemMessage: notices.join('\n') } : {}),
    ...(modelNotes.length
      ? {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: modelNotes.join('\n\n'),
          },
        }
      : {}),
  });
}

// The host of a WebFetch URL, or none when it can't be read.
function urlHosts(url) {
  try {
    const { hostname } = new URL(String(url));
    return hostname ? [hostname.toLowerCase()] : [];
  } catch {
    return [];
  }
}

function emitDeny(reason, systemMessage = null) {
  const message = [...notices, systemMessage].filter(Boolean).join('\n');
  emit({
    ...(message ? { systemMessage: message } : {}),
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
