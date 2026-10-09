#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import {
  outputRecoveryBudget,
  scrubBashResponse,
  scrubGrepResponse,
} from '../packages/zeroh-disclosure-core/bash-output-context.js';
import { fileDetectionOptions } from '../packages/zeroh-disclosure-core/detection-context.js';
import {
  loadConfig,
  uncertainMode,
} from '../packages/zeroh-disclosure-core/config.js';
import {
  displayName,
  firstFormatNotice,
  firstNoticeThisTurn,
  recordFormatOutcome,
} from '../lib/format-audit.js';
import {
  emit,
  piiProfile,
  projectDir,
  readStdinJson,
  refreshRoute,
} from '../lib/hook-io.js';
import { shellOf } from '../packages/shell-analysis/shell-tools.js';
import { ERROR_WITHHELD, withheldOutput } from './fail-closed.js';
import { cleanupValuesFile } from '../lib/hook-steps/post-tool-use/cleanup-values.js';
import {
  extractPdfText,
  extractPdfTextFromBuffer,
  hasUsefulPdfText,
} from '../packages/zeroh-disclosure-core/pdf-text.js';
import {
  loadKnownSecrets,
  scrub,
  scrubDeep,
} from '../packages/shell-analysis/secrets.js';
import { saveRestorably } from '../packages/zeroh-disclosure-core/restorable.js';
import {
  activeGrants,
  recordRevealedUnderGrant,
} from '../packages/zeroh-disclosure-core/unmask.js';
import {
  recordMaskedOutput,
  recordMissReported,
} from '../packages/zeroh-disclosure-core/report.js';
import { modelReportNotice } from '../packages/zeroh-disclosure-core/report-miss.js';
import {
  recordUnchecked,
  uncheckedNotice,
} from '../packages/zeroh-disclosure-core/unchecked.js';
import {
  NAMING_REMINDER,
  namingReminder,
} from '../packages/zeroh-disclosure-core/token-pattern.js';
import {
  channelForTool,
  hasImage,
  imageBlocks,
  joinLines,
  readResponseText,
} from '../lib/hook-steps/post-tool-use/inspect-response.js';
import {
  outputFindingMemos,
  truncatedOutputNotice,
  unsaveableOutputNotice,
} from '../lib/hook-steps/post-tool-use/recovery-notice.js';
import { describeTokenObservations } from '../lib/hook-steps/post-tool-use/describe-output-source.js';

import { Vault } from '../packages/zeroh-disclosure-core/vault.js';

// PostToolUse: mask secrets and personal data in every tool's output before the
// model reads it. The response keeps its shape; only strings change.
// Output larger than this is withheld rather than scanned, so the hook finishes
// well inside its 15 s timeout (Claude Code passes the original output through
// when a hook times out). Output dense with findings scans slower than linear:
// about 2 s for 1 MB and 9 s for 2 MB on the reference machine.
const MAX_SCANNED_OUTPUT_BYTES = 1024 * 1024;
const recoveryBudget = outputRecoveryBudget({
  hookStart: globalThis.zerohHook?.hookStart ?? performance.now(),
});

const VAULT_WITHHELD =
  'ZeroH Disclosure could not open its vault, so this tool output was withheld. Ask the user to run `/zeroh-disclosure:doctor --fix`.';
const VAULT_UNSAVEABLE_WITHHELD =
  'ZeroH Disclosure could not save its vault, so this tool output was withheld: a value masked now could never be put back. Try again; if it keeps happening, ask the user to run `/zeroh-disclosure:doctor`.';
const SAVE_LABEL = 'ZeroH Disclosure (PostToolUse)';

// An error in the try below passes the output with a notice by default and
// withholds it in `block` mode; an error outside it is the loader's
// (hooks/run.js), which does the same.
const event = await readStdinJson();
if (!event || event.tool_response === undefined) {
  cleanupValuesFile(event);
  process.exit(0);
}
// The configuration first, for the `uncertain` mode: what can't be checked
// passes with a notice by default, and is withheld in `block` mode (owner
// decision 2026-09-27).
let root;
try {
  root = projectDir(event);
  await loadConfig({ cwd: root });
} catch {
  // An unreadable config.env: the environment and the defaults apply.
}
const mode = uncertainMode(process.env);
let vault;
// The read-only view of the values on disk after a failed save
// (packages/zeroh-disclosure-core/restorable.js): receipt labels are masked with it from then on.
let labelVault = null;
let vaultFailed = false;
let readPath;
let grants = [];
let unmaskedTypes = [];
// Known secrets for masking receipt labels, loaded on first use.
let labelKnown = null;
// The one-line notice when Claude reported a missed value itself.
let missNotice = null;
try {
  cleanupValuesFile(event);
  if (
    Buffer.byteLength(JSON.stringify(event.tool_response) ?? '') >
    MAX_SCANNED_OUTPUT_BYTES
  ) {
    if (mode === 'block') {
      // deny-inventory: output-too-large
      emitWithheld(
        `ZeroH Disclosure withheld this ${event.tool_name} output because it is larger than ${MAX_SCANNED_OUTPUT_BYTES / 1024 / 1024} MB and could not be checked in time. Narrow it (for example with head, grep, or a line range) and try again.`,
      );
    } else {
      await passUnscanned('too-large');
    }
    process.exit(0);
  }
  root ??= projectDir(event);
  refreshRoute(event);
  grants = activeGrants(root, { sessionId: event.session_id });
  if (
    /__report_missed_secret$/u.test(String(event.tool_name ?? '')) &&
    JSON.stringify(event.tool_response).includes('Masked from now on as ')
  ) {
    await recordMissReported({ cwd: root, sessionId: event.session_id });
    // Claude reported it itself (a value in the call; the user's own
    // /zeroh-disclosure:report-miss has none): no dialog, one line. The
    // place is named once the vault can mask it (below).
    if (typeof event.tool_input?.value === 'string')
      missNotice = modelReportNotice(event.tool_input);
  }
  unmaskedTypes = grants.map(({ kind }) => kind);

  try {
    vault = new Vault(root, { sessionId: event.session_id });
  } catch (error) {
    vaultFailed = true;
    throw error;
  }
  if (missNotice)
    missNotice = modelReportNotice(event.tool_input, { maskPlace: maskLabel });
  readPath =
    event.tool_name === 'Read'
      ? event.tool_input?.file_path || event.tool_input?.path
      : null;
  const responseType = event.tool_response?.type;
  if (event.tool_name === 'Read' && responseType === 'pdf') {
    await handlePdf();
    process.exit(0);
  }
  if (event.tool_name === 'Read' && responseType === 'image') {
    await handleImage();
    process.exit(0);
  }
  if (event.tool_name === 'Read' && responseType === 'notebook') {
    await handleNotebook();
    process.exit(0);
  }

  const known = loadKnownSecrets(root);
  // A failed save masks again with the disk-only vault. Reuse deterministic
  // findings for identical detector input/options, including all recovery
  // completed before the shared budget expired. Ordinary metadata and
  // recovered output use separate caches because their detectors differ.
  const findingsFor = outputFindingMemos(recoveryBudget, () => labelVault);
  const maskOutput = (maskWith) => {
    const replacements = [];
    const revealed = [];
    const scan = (value, context = {}) => {
      return scrubDeep(
        value,
        {
          vault: maskWith,
          known,
          profile: piiProfile(),
          unmaskedTypes,
          ...context,
          detectFindings: findingsFor(context),
        },
        replacements,
        revealed,
      );
    };
    const masked =
      event.tool_name === 'Bash'
        ? scrubBashResponse(
            event.tool_response,
            event.tool_input?.command,
            scan,
            recoveryBudget,
          )
        : event.tool_name === 'Grep'
          ? scrubGrepResponse(event.tool_response, scan, recoveryBudget)
          : scan(event.tool_response, fileDetectionOptions(readPath));
    return { masked, replacements, revealed };
  };
  let result = maskOutput(vault);
  if (recoveryBudget.truncated && mode === 'block') {
    // deny-inventory: output-check-failed
    emitWithheld(ERROR_WITHHELD);
    process.exit(0);
  }
  // Image blocks in any other tool's output (an MCP screenshot): their
  // strings were scanned, the picture was not.
  const images = imageBlocks(event.tool_response);
  const imageLine = joinLines(
    missNotice,
    images ? await noteUncheckedFormat(images) : null,
    recoveryBudget.truncated
      ? await truncatedOutputNotice({ cwd: root, event })
      : null,
  );
  if (!result.replacements.length) {
    recordReveals(result.revealed);
    emitNotice(imageLine);
    process.exit(0);
  }
  // Labels are masked before the vault is saved: masking can mint a token.
  let observations = tokenObservations(result.replacements);
  let auditPath = event.tool_name === 'Read' ? maskLabel(readPath) : null;
  let notice = imageLine;
  if (!(await savedOrFallback())) process.exit(0);
  if (labelVault) {
    // Rule 8: only the values on disk stay masked; the new ones go as the
    // tool returned them.
    result = maskOutput(labelVault);
    observations = tokenObservations(result.replacements);
    auditPath = event.tool_name === 'Read' ? maskLabel(readPath) : null;
    notice = joinLines(
      await unsaveableOutputNotice({ cwd: root, event }),
      imageLine,
      recoveryBudget.truncated && !imageLine?.includes('not fully checked')
        ? await truncatedOutputNotice({ cwd: root, event })
        : null,
    );
  }
  recordReveals(result.revealed);
  if (!result.replacements.length) {
    emitNotice(notice);
    process.exit(0);
  }
  await recordMaskedOutput({
    cwd: root,
    sessionId: event.session_id,
    channel: channelForTool(event.tool_name),
    replacements: result.replacements,
    filePath: auditPath,
    observations,
  });
  await emitMasked(result.masked, result.replacements, notice);
} catch (error) {
  if (mode === 'block') {
    // deny-inventory: output-check-failed
    emitWithheld(vaultFailed ? VAULT_WITHHELD : ERROR_WITHHELD);
  } else {
    // A vault that can't be opened: masking now would leave tokens that can
    // never be turned back into values, so the output goes as it is, with
    // the line (owner decision 2026-09-27).
    await passUnscanned(vaultFailed ? 'vault-unavailable' : 'check-failed');
  }
}

// Saves the vault after masking (rule 8, packages/zeroh-disclosure-core/restorable.js). True when the
// masking stands, or when the save failed and `labelVault` now holds the
// view of the values on disk to mask with again. False when block mode
// withheld the output instead (already answered).
async function savedOrFallback() {
  const { fallback } = saveRestorably(vault, SAVE_LABEL);
  if (!fallback) return true;
  if (mode === 'block') {
    // deny-inventory: vault-unsaveable-output
    emitWithheld(VAULT_UNSAVEABLE_WITHHELD);
    return false;
  }
  labelVault = fallback;
  return true;
}

// The output goes to the model as the tool returned it, with the one-line
// "not protected" notice, recorded on the turn (packages/zeroh-disclosure-core/unchecked.js).
async function passUnscanned(reason) {
  // An answer already written stands.
  if (globalThis.zerohHook?.state?.emitted) return;
  let notice = null;
  try {
    ({ notice } = await recordUnchecked({
      reason,
      tool: event.tool_name,
      cwd: root ?? projectDir(event),
      sessionId: event.session_id,
      subject: 'tool output',
    }));
  } catch {
    notice = uncheckedNotice(reason, { subject: 'tool output' });
  }
  emitNotice(notice);
}

function emitWithheld(message) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: withheldOutput(
        event.tool_name,
        event.tool_response,
        maskLabel(readPath),
        message,
      ),
    },
  });
}

async function handlePdf() {
  const filePath = readPath || event.tool_response.file?.filePath;
  let extraction = extractPdfText(filePath);
  if (!extraction.text && event.tool_response.file?.base64) {
    try {
      const embedded = extractPdfTextFromBuffer(
        Buffer.from(event.tool_response.file.base64, 'base64'),
      );
      if (embedded.text) extraction = embedded;
    } catch {
      // A malformed response is treated like a PDF without a text layer.
    }
  }
  const name = displayName(maskLabel(filePath), 'PDF');
  const known = loadKnownSecrets(root);
  const maskText = (maskWith) =>
    extraction.text
      ? scrub(extraction.text, {
          vault: maskWith,
          known,
          profile: piiProfile(),
          unmaskedTypes,
        })
      : { text: '', replacements: [], revealed: [] };
  let result = maskText(vault);

  if (!result.replacements.length && !hasUsefulPdfText(extraction)) {
    recordReveals(result.revealed);
    await recordFormatOutcome({
      cwd: root,
      sessionId: event.session_id,
      passedUnmasked: { 'pdf passed, text layer sparse or absent': 1 },
    });
    const line = await noteUncheckedFormat();
    // The first time in a session the notice explains why; after that the
    // plain line, once per turn.
    const notice = await once(
      'pdf-no-text',
      `ZeroH Disclosure: ${name} was sent unmasked. Scanned PDFs aren't masked in the free plugin.`,
    );
    emitNotice(notice ?? line);
    return;
  }

  let observations = tokenObservations(result.replacements);
  let maskedPath = maskLabel(filePath);
  if (result.replacements.length && !(await savedOrFallback())) return;
  let unsaved = null;
  if (labelVault) {
    result = maskText(labelVault);
    observations = tokenObservations(result.replacements);
    maskedPath = maskLabel(filePath);
    unsaved = await unsaveableOutputNotice({ cwd: root, event });
  }
  recordReveals(result.revealed);
  const content = result.text;
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/u).length;
  await recordFormatOutcome({
    cwd: root,
    sessionId: event.session_id,
    withheld: { 'pdf sent as masked text': 1 },
  });
  if (result.replacements.length) {
    await recordMaskedOutput({
      cwd: root,
      sessionId: event.session_id,
      channel: 'file read',
      replacements: result.replacements,
      filePath: maskedPath,
      observations,
    });
  }
  const notice = joinLines(
    unsaved,
    await once(
      'pdf-masked-text',
      `ZeroH Disclosure: ${name} was sent as masked text; its layout and images were left out.`,
    ),
  );
  await emitMasked(
    {
      type: 'text',
      file: {
        filePath: maskedPath,
        content,
        numLines: lines,
        startLine: 1,
        totalLines: lines,
      },
    },
    result.replacements,
    notice,
  );
}

async function handleImage() {
  const filePath = readPath || event.tool_response.file?.filePath;
  const name = displayName(maskLabel(filePath), 'image');
  await recordFormatOutcome({
    cwd: root,
    sessionId: event.session_id,
    passedUnmasked: { image: 1 },
  });
  const line = await noteUncheckedFormat();
  const notice = await once(
    'image',
    `ZeroH Disclosure: ${name} was sent unmasked. Images aren't masked in the free plugin.`,
  );
  emitNotice(notice ?? line);
}

async function handleNotebook() {
  const known = loadKnownSecrets(root);
  let { masked, replacements, revealed, imageOutputs } = maskNotebook(vault);
  let formatLine = null;
  let unsaved = null;

  if (replacements.length) {
    let observations = tokenObservations(replacements);
    let maskedPath = maskLabel(readPath || masked.file?.filePath);
    if (!(await savedOrFallback())) return;
    if (labelVault) {
      ({ masked, replacements, revealed, imageOutputs } =
        maskNotebook(labelVault));
      observations = tokenObservations(replacements);
      maskedPath = maskLabel(readPath || masked.file?.filePath);
      unsaved = await unsaveableOutputNotice({ cwd: root, event });
    }
    if (replacements.length) {
      await recordMaskedOutput({
        cwd: root,
        sessionId: event.session_id,
        channel: 'file read',
        replacements,
        filePath: maskedPath,
        observations,
      });
    }
  }
  if (imageOutputs) {
    await recordFormatOutcome({
      cwd: root,
      sessionId: event.session_id,
      passedUnmasked: { image: imageOutputs },
    });
    formatLine = await noteUncheckedFormat(imageOutputs);
  }
  const filePath = readPath || masked.file?.filePath;
  const notice = joinLines(
    unsaved,
    imageOutputs
      ? ((await once(
          'image',
          `ZeroH Disclosure: ${displayName(maskLabel(filePath), 'notebook')} image output was sent unmasked. Images aren't masked in the free plugin.`,
        )) ?? formatLine)
      : null,
  );

  recordReveals(revealed);
  if (replacements.length) await emitMasked(masked, replacements, notice);
  else emitNotice(notice);

  // The notebook with every text field masked with `maskWith`.
  function maskNotebook(maskWith) {
    const found = [];
    const shown = [];
    const copy = structuredClone(event.tool_response);
    const cells = copy.file?.cells;
    let images = 0;
    const maskValue = (value) =>
      scrubDeep(
        value,
        {
          vault: maskWith,
          known,
          profile: piiProfile(),
          unmaskedTypes,
          ...fileDetectionOptions(readPath),
        },
        found,
        shown,
      );
    const maskOutput = (output) => {
      if (!output || typeof output !== 'object') return;
      if ('text' in output) output.text = maskValue(output.text);
      if ('traceback' in output) output.traceback = maskValue(output.traceback);
      if ('evalue' in output) output.evalue = maskValue(output.evalue);
      for (const container of [output, output.data]) {
        if (!container || typeof container !== 'object') continue;
        for (const type of [
          'text/plain',
          'text/html',
          'text/markdown',
          'application/json',
        ]) {
          if (type in container) container[type] = maskValue(container[type]);
        }
      }
    };
    if (Array.isArray(cells)) {
      for (const cell of cells) {
        if ('source' in cell) cell.source = maskValue(cell.source);
        if (!Array.isArray(cell.outputs)) continue;
        for (const output of cell.outputs) {
          if (hasImage(output)) images += 1;
          maskOutput(output);
        }
      }
    }
    return {
      masked: copy,
      replacements: found,
      revealed: shown,
      imageOutputs: images,
    };
  }
}

async function once(kind, message) {
  return (await firstFormatNotice({
    cwd: root,
    sessionId: event.session_id,
    kind,
  }))
    ? message
    : null;
}

function emitNotice(systemMessage) {
  if (systemMessage) emit({ systemMessage });
}

// The first masked output of a turn also carries the naming reminder.
async function emitMasked(
  updatedToolOutput,
  replacements,
  systemMessage = null,
) {
  const reminder =
    replacements.length &&
    (await firstNoticeThisTurn({
      cwd: root,
      sessionId: event.session_id,
      kind: NAMING_REMINDER,
    }))
      ? namingReminder(replacements[0].token || replacements[0].replacement)
      : null;
  emit({
    ...(systemMessage ? { systemMessage } : {}),
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput,
      ...(replacements.length
        ? {
            additionalContext: [maskedContext(replacements), reminder]
              .filter(Boolean)
              .join('\n'),
          }
        : {}),
    },
  });
}

function maskedContext(replacements) {
  const unique = new Map();
  for (const replacement of replacements) {
    unique.set(replacement.token, replacement);
  }
  const lines = [
    `ZeroH Disclosure masked ${unique.size} value(s) in this ${event.tool_name} output before you saw it.`,
    'Use the tokens exactly as written. When a command runs, ZeroH puts the real value back on the',
    "user's machine. For a host ZeroH can read that the value may not reach, ZeroH stops the command",
    "before anything is sent and tells the user how to allow it, so you don't need to ask first for that reason.",
    "Where ZeroH can't tell where a command sends the value (a script, a variable host, git push), the real",
    "value is put back and the command runs with a notice: before sending a secret somewhere the user didn't",
    'ask for, ask the user. Never ask the user to paste the real value.',
  ];
  for (const [token, replacement] of unique) {
    const name = replacement.source?.startsWith('known:')
      ? ` (${replacement.source.slice(6)})`
      : '';
    lines.push(`  ${token} = ${replacement.type.toLowerCase()}${name}`);
  }
  return lines.join('\n');
}

// Values shown under a grant reached the model in plain text: they count as
// "sent" on the status line too (docs/receipt-format.md, values sent).
function recordReveals(revealed) {
  recordRevealedUnderGrant({
    root,
    sessionId: event.session_id,
    grants,
    revealed,
  });
}

function tokenObservations(replacements) {
  return describeTokenObservations(replacements, {
    event,
    readPath,
    root,
    vault,
    maskLabel,
  });
}

// A path, command or label with every vault value, known secret and detected
// value replaced by its token: the file stays recognisable by its masked name.
// Unmask grants do not apply; receipts outlive them. Without a vault, or on
// any error, nothing of the label is kept.
function maskLabel(text) {
  if (text === null || text === undefined || text === '') return text;
  if (!vault) return '';
  try {
    labelKnown ??= loadKnownSecrets(root);
    return scrub(String(text), {
      vault: labelVault ?? vault,
      known: labelKnown,
      profile: piiProfile(),
    }).text;
  } catch {
    return '';
  }
}

// A format passed without its content being read (a scan or image, which may
// show text): counted on the turn as unknown-format (packages/zeroh-disclosure-core/unchecked.js), tool
// name only. Returns the one-line notice for the user, or null when that was
// already shown this turn.
async function noteUncheckedFormat(count = 1) {
  const { notice } = await recordUnchecked({
    reason: 'unknown-format',
    tool: event.tool_name,
    cwd: root,
    sessionId: event.session_id,
    subject: 'tool output',
    count,
  });
  return notice;
}
