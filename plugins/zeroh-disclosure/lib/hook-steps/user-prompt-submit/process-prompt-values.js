// SPDX-License-Identifier: AGPL-3.0-only

import { fileDetectionOptions } from '../../../packages/zeroh-disclosure-core/detection-context.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { recordMaskedOutput } from '../../../packages/zeroh-disclosure-core/report.js';
import { persistedEntries } from '../../../packages/zeroh-disclosure-core/restorable.js';
import { scrub } from '../../../packages/shell-analysis/secrets.js';

function countByType(values) {
  const by_type = {};
  for (const type of values) by_type[type] = (by_type[type] ?? 0) + 1;
  return by_type;
}

export function collectDistinctSentValues({
  result,
  userPrompt,
  knownHits,
  fileHits,
}) {
  const byValue = new Map();
  const note = (value, type) => {
    if (typeof value !== 'string' || !value || byValue.has(value)) return;
    byValue.set(value, type || 'UNKNOWN');
  };
  for (const replacement of result.replacements ?? []) {
    if (
      Number.isInteger(replacement.start) &&
      Number.isInteger(replacement.end)
    ) {
      note(
        userPrompt.slice(replacement.start, replacement.end),
        replacement.entity_type,
      );
    }
  }
  for (const finding of result.findings ?? []) {
    if (Number.isInteger(finding.start) && Number.isInteger(finding.end)) {
      note(userPrompt.slice(finding.start, finding.end), finding.type);
    }
  }
  for (const hit of knownHits) note(hit.value, hit.type);
  for (const hit of fileHits) {
    for (const entry of hit.values ?? []) note(entry.value, entry.type);
  }
  return { count: byValue.size, by_type: countByType(byValue.values()) };
}

// Names for the one-line unprotected notice. A known value keeps its safe
// variable name (STRIPE_KEY), while every other distinct value contributes
// its detector kind (EMAIL). Values, paths and hosts never enter this list.
export function collectSentValueNames({
  result,
  userPrompt,
  knownHits,
  fileHits,
}) {
  const labels = [];
  const seenLabels = new Set();
  const knownValues = new Set();
  const add = (label) => {
    const value = String(label ?? '');
    if (
      !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ||
      /\d{6,}/u.test(value) ||
      seenLabels.has(value)
    ) {
      return false;
    }
    seenLabels.add(value);
    labels.push(value);
    return true;
  };
  for (const hit of knownHits) {
    if (add(hit.name)) knownValues.add(hit.value);
  }
  const noteFinding = (finding) => {
    if (!Number.isInteger(finding.start) || !Number.isInteger(finding.end)) {
      return;
    }
    const value = userPrompt.slice(finding.start, finding.end);
    if (!knownValues.has(value)) add(finding.entity_type ?? finding.type);
  };
  for (const replacement of result.replacements ?? []) noteFinding(replacement);
  for (const finding of result.findings ?? []) noteFinding(finding);
  for (const hit of fileHits) {
    for (const entry of hit.values ?? []) {
      if (!knownValues.has(entry.value)) add(entry.type);
    }
  }
  return labels;
}

export function collectUnsavedValues({
  vault,
  result,
  userPrompt,
  knownHits,
  promptTokens,
}) {
  const onDisk = new Set(persistedEntries(vault).map((entry) => entry.value));
  const sent = new Map();
  const note = (value, type) => {
    if (typeof value !== 'string' || !value || onDisk.has(value)) return;
    if (!sent.has(value)) sent.set(value, type || 'UNKNOWN');
  };
  for (const replacement of result.replacements ?? []) {
    if (
      Number.isInteger(replacement.start) &&
      Number.isInteger(replacement.end)
    ) {
      note(
        userPrompt.slice(replacement.start, replacement.end),
        replacement.entity_type,
      );
    }
  }
  for (const finding of result.findings ?? []) {
    if (Number.isInteger(finding.start) && Number.isInteger(finding.end)) {
      note(userPrompt.slice(finding.start, finding.end), finding.type);
    }
  }
  for (const hit of knownHits) note(hit.value, hit.type);
  const masked = [...promptTokens.values()].filter((entry) =>
    onDisk.has(vault.valueOf(entry.token)),
  );
  return {
    sent: { count: sent.size, by_type: countByType(sent.values()) },
    masked,
  };
}

export function buildSentAsTypedDecision(policyDecision, findings, knownHits) {
  const extra = knownHits.map((hit) => hit.type);
  return {
    ...policyDecision,
    action: 'allow',
    enforced: 'sent_unmasked',
    policy_action: policyDecision.action,
    reason:
      "ZeroH couldn't save its vault, so the local proxy masked only the values already in it; the others were sent as typed (uncertain cases: pass).",
    mask_categories: [...new Set([...findings.map((f) => f.type), ...extra])],
    extra_categories: extra,
    blocked: false,
  };
}

export function enforcePromptDecision(
  policyDecision,
  findings,
  { knownHits, fileHits, passUnmasked, proxyOn },
) {
  const extra = knownHits.map((hit) => hit.type);
  if (!findings.length && !extra.length && !fileHits.length) {
    return policyDecision;
  }
  const categories = [...new Set([...findings.map((f) => f.type), ...extra])];
  if (passUnmasked) {
    return {
      ...policyDecision,
      action: 'allow',
      enforced: 'sent_unmasked',
      policy_action: policyDecision.action,
      reason:
        'The local proxy was not in the route, so the prompt was sent as typed (uncertain cases: pass).',
      // Masked only in the ledger copy; what was sent was not masked.
      mask_categories: categories,
      extra_categories: extra,
      ...(fileHits.length
        ? { mentioned_files_with_findings: fileHits.length }
        : {}),
      blocked: false,
    };
  }
  if (proxyOn) {
    return {
      ...policyDecision,
      action: 'mask_and_allow',
      enforced: 'masked_by_proxy',
      policy_action: policyDecision.action,
      reason: 'The local proxy masked these values before the prompt was sent.',
      mask_categories: categories,
      extra_categories: extra,
      blocked: false,
    };
  }
  return {
    ...policyDecision,
    action: 'block',
    enforced: 'stopped',
    policy_action: policyDecision.action,
    reason:
      'The prompt was stopped before sending; the user was offered a masked copy.',
    // Masked only in the copy offered to the user, which was not sent.
    mask_categories: categories,
    extra_categories: extra,
    ...(fileHits.length
      ? { mentioned_files_with_findings: fileHits.length }
      : {}),
    blocked: true,
  };
}

export function findMentionedFileSecrets(prompt, dir, { vault, known }) {
  const hits = [];
  for (const match of prompt.matchAll(/(?:^|\s)@((?:[\w.~/-]|\\ )+)/g)) {
    const relative = match[1].replace(/\\ /g, ' ');
    const absolute = path.resolve(
      dir,
      relative.replace(/^~(?=\/)/, process.env.HOME || '~'),
    );
    try {
      if (
        !existsSync(absolute) ||
        !statSync(absolute).isFile() ||
        statSync(absolute).size > 512 * 1024
      ) {
        continue;
      }
      const { replacements } = scrub(readFileSync(absolute, 'utf8'), {
        ...fileDetectionOptions(absolute),
        vault,
        known,
        profile: 'tool',
      });
      if (replacements.length) {
        hits.push({
          path: relative,
          count: replacements.length,
          values: replacements
            .map((replacement) => ({
              value: vault.entryOf(replacement.token)?.value,
              type: replacement.type,
            }))
            .filter((entry) => typeof entry.value === 'string'),
        });
      }
    } catch {
      // Unreadable: nothing to report.
    }
  }
  return hits;
}

export async function recordPromptTokenEntries(
  entries,
  { countMasked = false, root, sessionId } = {},
) {
  if (!entries.length) return;
  await recordMaskedOutput({
    cwd: root,
    sessionId,
    channel: 'typed prompt',
    replacements: countMasked ? entries : [],
    countMasked,
    observations: entries.map((entry) => ({
      ...entry,
      channel: 'typed prompt',
      source: 'typed prompt',
    })),
  });
}
