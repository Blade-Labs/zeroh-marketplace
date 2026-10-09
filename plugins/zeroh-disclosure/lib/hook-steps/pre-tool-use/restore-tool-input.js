// SPDX-License-Identifier: AGPL-3.0-only

import { recordDestinationCheck } from '../../../packages/zeroh-disclosure-core/report.js';
import {
  mintedTokens,
  restoreForTool,
} from '../../../packages/zeroh-disclosure-core/tool-policies.js';
import { saveQuietly } from '../../../packages/zeroh-disclosure-core/vault.js';
import { tokenType } from '../../../packages/zeroh-disclosure-core/data-kinds.js';
import { uncheckedNotice } from '../../../packages/zeroh-disclosure-core/unchecked.js';
import {
  bracedReference,
  inlineReferences,
} from '../../../packages/shell-analysis/shell-references.js';
import { shellDestinations } from '../../../packages/shell-analysis/shell-destinations.js';
import {
  checkDestinations,
  destinationText,
  hostsIn,
  loadAllowRules,
  maskedHost,
  networkHostsIn,
} from '../../../packages/shell-analysis/secrets.js';
import {
  prepareBashLateBinding,
  preparePowerShellLateBinding,
} from '../../../packages/shell-analysis/late-bind.js';

const SAVE_LABEL = 'ZeroH Disclosure (PreToolUse)';

export async function finishToolInput(
  baseInput,
  context,
  changed,
  {
    toolName,
    root,
    vault,
    pii,
    modelNotes,
    mode,
    shell,
    session,
    sessionId,
    toolUseId,
    notices,
    passUnchecked,
    emitDeny,
    emitDestinationDeny,
    mcpHeldNote,
    valueNameOf,
    withExitStatus,
    emit,
  },
) {
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
  notes.push(...heldTokenNotes(plan, toolName, mcpHeldNote));
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
    const destination = await checkRestoredDestinations({
      restored,
      restoredInput,
      baseInput,
      rules,
      state: {
        toolName,
        shell,
        vault,
        session,
        mode,
        emitDestinationDeny,
        emitDeny,
        passUnchecked,
        valueNameOf,
      },
    });
    if (!destination) return;
    const prepared = await prepareRestoredInput({
      restored,
      baseInput,
      allowedInput,
      restoredForTool,
      ...destination,
      state: {
        toolName,
        shell,
        vault,
        sessionId,
        toolUseId,
        mode,
        emitDeny,
        passUnchecked,
        notes,
      },
    });
    if (!prepared) return;
    ({ allowedInput, restoredForTool } = prepared);
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

function heldTokenNotes(plan, toolName, mcpHeldNote) {
  if (plan.held.length && plan.scope.mode === 'mcp') {
    return [mcpHeldNote(plan.held, plan.scope.server)];
  }
  if (!plan.held.length) return [];
  const held = [...new Set(plan.held.map((replacement) => replacement.token))];
  return [
    `ZeroH Disclosure left ${held.join(', ')} as tokens in this ${toolName} input: it goes to a model or a service ZeroH does not restore into. Keep using the tokens.`,
  ];
}

async function checkRestoredDestinations({
  restored,
  restoredInput,
  baseInput,
  rules,
  state: {
    toolName,
    shell,
    vault,
    session,
    mode,
    emitDestinationDeny,
    emitDeny,
    passUnchecked,
    valueNameOf,
  },
}) {
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
          "ZeroH can't check where a variable the command loads itself goes. Ask the user to run the command, or to allow it with /zeroh-disclosure:settings uncertain pass.",
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
  return { shellCommand, inline };
}

async function prepareRestoredInput({
  restored,
  baseInput,
  shellCommand,
  inline,
  allowedInput,
  restoredForTool,
  state: {
    toolName,
    shell,
    vault,
    sessionId,
    toolUseId,
    mode,
    emitDeny,
    passUnchecked,
    notes,
  },
}) {
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
  return { allowedInput, restoredForTool };
}
