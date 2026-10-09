// SPDX-License-Identifier: AGPL-3.0-only

import { emit as emitHook } from '../../hook-io.js';
import { finishToolInput } from './restore-tool-input.js';
import {
  buildDestinationDenial,
  describeMcpHeld,
  describeTokenName,
  describeValueName,
} from './describe-tool-use.js';
import { recordToolAudit } from './record-tool-audit.js';
import { wrapToolExitStatus } from './wrap-exit-status.js';

export function createToolOutput({
  toolName,
  root,
  notices,
  modelNotes,
  passUnchecked,
  getRuntime,
  emit = emitHook,
}) {
  function emitDeny(reason, systemMessage = null) {
    const message = [
      ...new Set([...notices, systemMessage].filter(Boolean)),
    ].join('\n');
    emit({
      ...(message ? { systemMessage: message } : {}),
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    });
  }

  function emitNotices() {
    if (!notices.length && !modelNotes.length) return;
    emit({
      ...(notices.length
        ? { systemMessage: [...new Set(notices)].join('\n') }
        : {}),
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

  function emitDestinationDeny(violations) {
    const { reason, systemMessage } = buildDestinationDenial(violations, {
      toolName,
      root,
    });
    // deny-inventory: host-not-allowed
    emitDeny(reason, systemMessage);
  }

  return {
    emitDeny,
    emitNotices,
    emitDestinationDeny,
    finish(baseInput, context, changed = false) {
      const runtime = getRuntime();
      return finishToolInput(baseInput, context, changed, {
        toolName,
        root,
        ...runtime,
        modelNotes,
        notices,
        passUnchecked,
        emitDeny,
        emitDestinationDeny,
        mcpHeldNote: (held, server) =>
          describeMcpHeld(held, server, {
            vault: runtime.vault,
            toolName,
            root,
          }),
        valueNameOf: (entries) => describeValueName(entries, runtime.vault),
        withExitStatus: (input, original) =>
          wrapToolExitStatus(input, original, {
            toolName,
            shell: runtime.shell,
          }),
        emit,
      });
    },
    valueNameOf(entries) {
      return describeValueName(entries, getRuntime().vault);
    },
    nameOf(token) {
      return describeTokenName(token, getRuntime().vault);
    },
    mcpHeldNote(held, server) {
      return describeMcpHeld(held, server, {
        vault: getRuntime().vault,
        toolName,
        root,
      });
    },
    withExitStatus(input, original) {
      return wrapToolExitStatus(input, original, {
        toolName,
        shell: getRuntime().shell,
      });
    },
    writeToolAudit(options) {
      return recordToolAudit(options);
    },
  };
}
