// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

import { shellOf } from '../../../packages/shell-analysis/shell-tools.js';
import { channelForTool, readResponseText } from './inspect-response.js';

export function describeTokenObservations(
  replacements,
  { event, readPath, root, vault, maskLabel },
) {
  const channel = channelForTool(event.tool_name);
  // A dense output can repeat the same value thousands of times. Its source
  // label needs one scan per call, with this call's current masking vault.
  const sources = new Map();
  const sourceFor = (replacement) => {
    const raw = rawSourceFor(replacement, { event, readPath, root, vault });
    if (!sources.has(raw)) sources.set(raw, maskLabel(raw) || 'tool output');
    return sources.get(raw);
  };
  return replacements.map((replacement) => ({
    token: replacement.token || replacement.replacement,
    type: replacement.type || replacement.entity_type,
    channel,
    source: sourceFor(replacement),
    ...(replacement.source?.startsWith('known:')
      ? { name: replacement.source.slice(6) }
      : {}),
    count: replacement.count || 1,
  }));
}

function rawSourceFor(replacement, context) {
  const { event } = context;
  if (event.tool_name === 'Read') return readSource(replacement, context);
  if (shellOf(event.tool_name)) {
    return String(event.tool_input?.command || event.tool_name)
      .trim()
      .replace(/\s+/gu, ' ');
  }
  if (String(event.tool_name).startsWith('mcp__')) return event.tool_name;
  return String(event.tool_name || 'tool output');
}

function readSource(replacement, { event, readPath, root, vault }) {
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
