// SPDX-License-Identifier: AGPL-3.0-only

import { shellOf } from '../../../packages/shell-analysis/shell-tools.js';

export function joinLines(...lines) {
  return lines.filter(Boolean).join('\n') || null;
}

export function hasImage(output) {
  if (!output || typeof output !== 'object') return false;
  if (output.image?.media_type?.startsWith('image/')) return true;
  return [output, output.data].some(
    (container) =>
      container &&
      typeof container === 'object' &&
      Object.keys(container).some((key) => key.startsWith('image/')),
  );
}

export function channelForTool(toolName) {
  if (toolName === 'Read') return 'file read';
  if (shellOf(toolName)) return 'command output';
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'web';
  if (String(toolName).startsWith('mcp__')) return 'MCP result';
  return 'command output';
}

export function readResponseText(value) {
  if (typeof value === 'string') return value;
  if (typeof value?.file?.content === 'string') return value.file.content;
  if (Array.isArray(value)) return value.map(readResponseText).join('\n');
  if (value && typeof value === 'object') {
    return Object.values(value).map(readResponseText).join('\n');
  }
  return '';
}

// Image content blocks anywhere in a tool response ({ type: 'image', data |
// source }), as MCP servers return them.
export function imageBlocks(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 20) return 0;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + imageBlocks(item, depth + 1), 0);
  }
  if (value.type === 'image' && (value.data || value.source)) return 1;
  return Object.values(value).reduce(
    (sum, item) => sum + imageBlocks(item, depth + 1),
    0,
  );
}
