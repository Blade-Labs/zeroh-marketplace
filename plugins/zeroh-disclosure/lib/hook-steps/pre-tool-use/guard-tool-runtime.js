// SPDX-License-Identifier: AGPL-3.0-only

import { Vault } from '../../../packages/zeroh-disclosure-core/vault.js';
import { uncheckedNotice } from '../../../packages/zeroh-disclosure-core/unchecked.js';
import {
  commandNamesZeroHSecret,
  isZeroHSecretPath,
} from '../../../packages/shell-analysis/secrets.js';
import { shellOf } from '../../../packages/shell-analysis/shell-tools.js';
import { claimUnmaskMcpSession } from '../../../packages/zeroh-disclosure-core/unmask.js';
import { TOKEN_RE } from '../../../packages/zeroh-disclosure-core/token-pattern.js';
import {
  commandUsesSessionFiles,
  TRANSCRIPT_BLOCK_REASON,
  TRANSCRIPT_MODEL_NOTE,
  TRANSCRIPT_NOTICE,
} from '../../../packages/zeroh-disclosure-core/transcript-files.js';
import { proxyActive, refreshRoute } from '../../hook-io.js';
import { sensitiveReason, subjectOf } from './describe-tool-use.js';

export async function guardToolRuntime({
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
}) {
  refreshRoute(event);
  if (
    /request_unmask$/u.test(toolName) &&
    !claimUnmaskMcpSession(root, sessionId)
  ) {
    // deny-inventory: unmask-session-claim
    emitDeny(
      'ZeroH Disclosure refused this unmask request because another session is starting one for the same project. Try again after that request finishes.',
    );
    return { exit: true };
  }

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
      return { exit: true };
    }
    await passUnchecked('proxy-not-running');
  }

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
      return { exit: true };
    }
    await passUnchecked(
      /encoder/u.test(sensitive) ? 'unknown-format' : 'sensitive-file-masked',
      { subject: shell ? 'command' : 'tool call' },
    );
  }

  if (
    shell &&
    typeof toolInput.command === 'string' &&
    commandUsesSessionFiles(toolInput.command, shell)
  ) {
    if (mode === 'block') {
      // deny-inventory: session-transcript
      emitDeny(TRANSCRIPT_BLOCK_REASON);
      return { exit: true };
    }
    if (!notices.includes(TRANSCRIPT_NOTICE)) notices.push(TRANSCRIPT_NOTICE);
    modelNotes.push(TRANSCRIPT_MODEL_NOTE);
  }

  try {
    return {
      exit: false,
      shell,
      vault: new Vault(root, { sessionId }),
    };
  } catch (error) {
    return vaultFailure(error, {
      toolInput,
      root,
      notices,
      emitDeny,
      emitNotices,
      mode,
      modelNotes,
      passUnchecked,
      toolName,
    });
  }
}

async function vaultFailure(
  error,
  {
    toolInput,
    root,
    notices,
    emitDeny,
    emitNotices,
    mode,
    modelNotes,
    passUnchecked,
    toolName,
  },
) {
  if (mode === 'block') {
    // deny-inventory: vault-unavailable-tool
    emitDeny(
      '🛡  ZeroH Disclosure denied this tool call because it could not open its vault. Ask the user to run `/zeroh-disclosure:doctor --fix`.',
    );
    return { exit: true };
  }
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
  return { exit: true };
}
