// SPDX-License-Identifier: AGPL-3.0-only

import { writeClipboard } from '../../clipboard.js';
import { emit, stopPrompt } from '../../hook-io.js';
import { stopMessage } from '../../stop-message.js';
import {
  buildSentAsTypedDecision,
  collectDistinctSentValues,
  collectUnsavedValues,
  findMentionedFileSecrets,
  recordPromptTokenEntries,
} from './process-prompt-values.js';

export function createPromptOutput({ getRuntime }) {
  const entropyWarningLine = (warning) =>
    `ZeroH Disclosure: a random-looking value (${warning.length} characters) matches no rule; it was sent as is. /zeroh-disclosure:report-miss masks it from now on.`;

  function emitPromptNotice({
    additionalContext = null,
    systemMessage = null,
  }) {
    const { grantEndedContext } = getRuntime();
    additionalContext =
      [additionalContext, grantEndedContext].filter(Boolean).join('\n\n') ||
      null;
    if (!additionalContext && !systemMessage) return;
    emit({
      ...(systemMessage ? { systemMessage } : {}),
      ...(additionalContext
        ? {
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext,
            },
          }
        : {}),
    });
  }

  return {
    entropyWarningLine,
    emitPromptNotice,
    emitEntropyWarning(warning) {
      emitPromptNotice({
        additionalContext: entropyWarningLine(warning),
        systemMessage: [getRuntime().grantStatus, entropyWarningLine(warning)]
          .filter(Boolean)
          .join('\n'),
      });
    },
    async emitBlock({ result, masked, knownHits, fileHits }) {
      const { userPrompt, stopReason, switchedNow, grantStatus } = getRuntime();
      const rewrite = fileHits.length ? null : masked;
      const copied = rewrite
        ? Boolean(await writeClipboard(rewrite).catch(() => null))
        : false;
      const values = [
        ...(result.replacements ?? []).map((replacement) => ({
          type: replacement.entity_type,
          value: userPrompt.slice(replacement.start, replacement.end),
        })),
        ...knownHits.map((hit) => ({ type: hit.type, value: hit.value })),
      ];
      // deny-inventory: typed-secret-no-proxy
      stopPrompt(
        stopMessage({
          values,
          files: fileHits,
          reason: stopReason ?? 'unreachable',
          masked: rewrite,
          copied,
          nextMasked: stopReason === 'not-ready' && switchedNow,
        }),
        { systemMessage: grantStatus || null },
      );
    },
    distinctSentValues() {
      const { result, userPrompt, knownHits, fileHits } = getRuntime();
      return collectDistinctSentValues({
        result,
        userPrompt,
        knownHits,
        fileHits,
      });
    },
    unsavedValues() {
      const { vault, result, userPrompt, knownHits, promptTokens } =
        getRuntime();
      return collectUnsavedValues({
        vault,
        result,
        userPrompt,
        knownHits,
        promptTokens,
      });
    },
    sentAsTypedDecision(policyDecision, findings) {
      return buildSentAsTypedDecision(
        policyDecision,
        findings,
        getRuntime().knownHits,
      );
    },
    mentionedFileSecrets(prompt, dir) {
      const { vault, known } = getRuntime();
      return findMentionedFileSecrets(prompt, dir, { vault, known });
    },
    recordPromptTokens(entries, { countMasked = false } = {}) {
      const { root, sessionId } = getRuntime();
      return recordPromptTokenEntries(entries, {
        countMasked,
        root,
        sessionId,
      });
    },
  };
}
