#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// PostToolUse: mask secrets and personal data in every tool's output before the
// model reads it. The response keeps its shape; only strings change.
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
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
import { shellOf } from '../lib/shell-tools.js';
import { ERROR_WITHHELD, withheldOutput } from './fail-closed.js';
import { deleteValuesFile } from '../lib/late-bind.js';
import {
  extractPdfText,
  extractPdfTextFromBuffer,
  hasUsefulPdfText,
} from '../lib/pdf-text.js';
import { loadKnownSecrets, scrub, scrubDeep } from '../lib/secrets.js';
import { saveQuietly, Vault } from '../lib/vault.js';
import { activeGrants, recordRevealedUnderGrant } from '../lib/unmask.js';
import { recordMaskedOutput, recordMissReported } from '../lib/report.js';
import { NAMING_REMINDER, namingReminder } from '../lib/token-pattern.js';

// Output larger than this is withheld rather than scanned, so the hook finishes
// well inside its 15 s timeout (Claude Code passes the original output through
// when a hook times out). Output dense with findings scans slower than linear:
// about 2 s for 1 MB and 9 s for 2 MB on the reference machine.
const MAX_SCANNED_OUTPUT_BYTES = 1024 * 1024;

const VAULT_WITHHELD =
  'ZeroH Disclosure could not open its vault, so this tool output was withheld. Ask the user to run `/zeroh-disclosure:doctor --fix`.';

// Fail closed (hooks/run.js): an error anywhere, including outside the try
// below, withholds the output in the tool's own shape.
const event = await readStdinJson();
if (!event || event.tool_response === undefined) {
  cleanupValuesFile();
  process.exit(0);
}
let root;
let vault;
let vaultFailed = false;
let readPath;
let grants = [];
let unmaskedTypes = [];
try {
  cleanupValuesFile();
  if (
    Buffer.byteLength(JSON.stringify(event.tool_response) ?? '') >
    MAX_SCANNED_OUTPUT_BYTES
  ) {
    emitWithheld(
      `ZeroH Disclosure withheld this ${event.tool_name} output because it is larger than ${MAX_SCANNED_OUTPUT_BYTES / 1024 / 1024} MB and could not be checked in time. Narrow it (for example with head, grep, or a line range) and try again.`,
    );
    process.exit(0);
  }
  root = projectDir(event);
  await loadConfig({ cwd: root });
  refreshRoute(event);
  grants = activeGrants(root, { sessionId: event.session_id });
  if (
    /__report_missed_secret$/u.test(String(event.tool_name ?? '')) &&
    JSON.stringify(event.tool_response).includes('Masked from now on as ')
  ) {
    await recordMissReported({ cwd: root, sessionId: event.session_id });
  }
  unmaskedTypes = grants.map(({ kind }) => kind);

  try {
    vault = new Vault(root, { sessionId: event.session_id });
  } catch (error) {
    vaultFailed = true;
    throw error;
  }
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
  const replacements = [];
  const revealed = [];
  const masked = scrubDeep(
    event.tool_response,
    { vault, known, profile: piiProfile(), unmaskedTypes },
    replacements,
    revealed,
  );
  recordReveals(revealed);
  if (!replacements.length) process.exit(0);
  saveQuietly(vault, 'ZeroH Disclosure (PostToolUse)');
  await recordMaskedOutput({
    cwd: root,
    sessionId: event.session_id,
    channel: channelForTool(event.tool_name),
    replacements,
    filePath: event.tool_name === 'Read' ? readPath : null,
    observations: tokenObservations(replacements),
  });
  await emitMasked(masked, replacements);
} catch {
  emitWithheld(vaultFailed ? VAULT_WITHHELD : ERROR_WITHHELD);
}

// The late-binding values file is normally removed by the command itself; this
// is the fallback. A failure here must not stop the output from being masked.
function cleanupValuesFile() {
  if (!event?.session_id || !event?.tool_use_id) return;
  try {
    deleteValuesFile({
      sessionId: event.session_id,
      toolUseId: event.tool_use_id,
    });
  } catch {
    // The stale-file sweep at Stop removes it later.
  }
}

function emitWithheld(message) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      updatedToolOutput: withheldOutput(
        event.tool_name,
        event.tool_response,
        readPath,
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
  const name = displayName(filePath, 'PDF');
  const known = loadKnownSecrets(root);
  const result = extraction.text
    ? scrub(extraction.text, {
        vault,
        known,
        profile: piiProfile(),
        unmaskedTypes,
      })
    : { text: '', replacements: [], revealed: [] };
  recordReveals(result.revealed);

  if (!result.replacements.length && !hasUsefulPdfText(extraction)) {
    await recordFormatOutcome({
      cwd: root,
      sessionId: event.session_id,
      passedUnmasked: { 'pdf passed, text layer sparse or absent': 1 },
    });
    const notice = await once(
      'pdf-no-text',
      `ZeroH Disclosure: ${name} was sent unmasked. Scanned PDFs aren't masked in the free plugin.`,
    );
    emitNotice(notice);
    return;
  }

  saveQuietly(vault, 'ZeroH Disclosure (PostToolUse)');
  const content = result.text;
  const lines = content.length === 0 ? 0 : content.split(/\r?\n/u).length;
  await recordFormatOutcome({
    cwd: root,
    sessionId: event.session_id,
    withheld: { 'pdf sent as masked text': 1 },
  });
  await recordMaskedOutput({
    cwd: root,
    sessionId: event.session_id,
    channel: 'file read',
    replacements: result.replacements,
    filePath,
    observations: tokenObservations(result.replacements),
  });
  const notice = await once(
    'pdf-masked-text',
    `ZeroH Disclosure: ${name} was sent as masked text; its layout and images were left out.`,
  );
  await emitMasked(
    {
      type: 'text',
      file: {
        filePath,
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
  const name = displayName(filePath, 'image');
  await recordFormatOutcome({
    cwd: root,
    sessionId: event.session_id,
    passedUnmasked: { image: 1 },
  });
  const notice = await once(
    'image',
    `ZeroH Disclosure: ${name} was sent unmasked. Images aren't masked in the free plugin.`,
  );
  emitNotice(notice);
}

async function handleNotebook() {
  const known = loadKnownSecrets(root);
  const replacements = [];
  const revealed = [];
  const masked = structuredClone(event.tool_response);
  const cells = masked.file?.cells;
  let imageOutputs = 0;

  if (Array.isArray(cells)) {
    for (const cell of cells) {
      if ('source' in cell) cell.source = maskValue(cell.source);
      if (!Array.isArray(cell.outputs)) continue;
      for (const output of cell.outputs) {
        if (hasImage(output)) imageOutputs += 1;
        maskOutput(output);
      }
    }
  }

  if (replacements.length) {
    saveQuietly(vault, 'ZeroH Disclosure (PostToolUse)');
    await recordMaskedOutput({
      cwd: root,
      sessionId: event.session_id,
      channel: 'file read',
      replacements,
      filePath: readPath || masked.file?.filePath,
      observations: tokenObservations(replacements),
    });
  }
  if (imageOutputs) {
    await recordFormatOutcome({
      cwd: root,
      sessionId: event.session_id,
      passedUnmasked: { image: imageOutputs },
    });
  }
  const filePath = readPath || masked.file?.filePath;
  const notice = imageOutputs
    ? await once(
        'image',
        `ZeroH Disclosure: ${displayName(filePath, 'notebook')} image output was sent unmasked. Images aren't masked in the free plugin.`,
      )
    : null;

  recordReveals(revealed);
  if (replacements.length) await emitMasked(masked, replacements, notice);
  else emitNotice(notice);

  function maskValue(value) {
    return scrubDeep(
      value,
      { vault, known, profile: piiProfile(), unmaskedTypes },
      replacements,
      revealed,
    );
  }

  function maskOutput(output) {
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
  }
}

function hasImage(output) {
  if (!output || typeof output !== 'object') return false;
  if (output.image?.media_type?.startsWith('image/')) return true;
  return [output, output.data].some(
    (container) =>
      container &&
      typeof container === 'object' &&
      Object.keys(container).some((key) => key.startsWith('image/')),
  );
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
    "user's machine for allowed destinations. Never ask the user to paste the real value.",
  ];
  for (const [token, replacement] of unique) {
    const name = replacement.source?.startsWith('known:')
      ? ` (${replacement.source.slice(6)})`
      : '';
    lines.push(`  ${token} = ${replacement.type.toLowerCase()}${name}`);
  }
  return lines.join('\n');
}

function recordReveals(revealed) {
  recordRevealedUnderGrant({
    root,
    sessionId: event.session_id,
    grants,
    revealed,
  });
}

function channelForTool(toolName) {
  if (toolName === 'Read') return 'file read';
  if (shellOf(toolName)) return 'command output';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'web';
  if (String(toolName).startsWith('mcp__')) return 'MCP result';
  return 'command output';
}

function tokenObservations(replacements) {
  const channel = channelForTool(event.tool_name);
  return replacements.map((replacement) => ({
    token: replacement.token || replacement.replacement,
    type: replacement.type || replacement.entity_type,
    channel,
    source: sourceForReplacement(replacement),
    ...(replacement.source?.startsWith('known:')
      ? { name: replacement.source.slice(6) }
      : {}),
    count: replacement.count || 1,
  }));
}

function sourceForReplacement(replacement) {
  if (event.tool_name === 'Read') return readSource(replacement);
  if (shellOf(event.tool_name)) {
    return String(event.tool_input?.command || event.tool_name)
      .trim()
      .replace(/\s+/gu, ' ');
  }
  if (String(event.tool_name).startsWith('mcp__')) return event.tool_name;
  return String(event.tool_name || 'tool output');
}

function readSource(replacement) {
  const file = readPath || event.tool_response?.file?.filePath || 'file';
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).replace(/\\/gu, '/');
  const displayPath =
    relative && !relative.startsWith('../') ? relative : String(file);
  const token = replacement.token || replacement.replacement;
  const value = vault.valueOf(token);
  const content = readResponseText(event.tool_response);
  const lines = content.split(/\r?\n/u);
  const lineIndex =
    value == null ? -1 : lines.findIndex((line) => line.includes(value));
  const startLine = Number(event.tool_response?.file?.startLine) || 1;
  const variable = replacement.source?.startsWith('known:')
    ? replacement.source.slice(6)
    : lineIndex >= 0
      ? lines[lineIndex].match(
          /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/u,
        )?.[1]
      : null;
  const parts = [displayPath];
  if (lineIndex >= 0) parts.push(`line ${startLine + lineIndex}`);
  if (variable) parts.push(variable);
  return parts.join(' · ');
}

function readResponseText(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.file?.content === 'string') return value.file.content;
  if (Array.isArray(value)) return value.map(readResponseText).join('\n');
  if (value && typeof value === 'object') {
    return Object.values(value).map(readResponseText).join('\n');
  }
  return '';
}
