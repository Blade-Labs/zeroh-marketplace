// SPDX-License-Identifier: AGPL-3.0-only

import {
  isSecretType,
  tokenType,
} from '../../../packages/zeroh-disclosure-core/data-kinds.js';
import { terminalCommand } from '../../../packages/zeroh-disclosure-core/fix-command.js';
import {
  bashSensitiveReason,
  isSensitivePath,
  powershellSensitiveReason,
} from '../../../packages/shell-analysis/secrets.js';
import { shellOf } from '../../../packages/shell-analysis/shell-tools.js';

export function referenceName(perField) {
  for (const field of perField) {
    for (const entry of field.replacements || []) {
      const text = String(field.original ?? '').slice(entry.start, entry.end);
      const name = /\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)/iu.exec(text);
      if (name) return name[1];
    }
  }
  return null;
}

export function describeValueName(entries, vault) {
  for (const { token } of entries) {
    const entry = vault.entryOf(token);
    const source = String(entry?.source ?? '');
    if (source.startsWith('known:')) return source.slice(6);
    if (entry?.type) return entry.type;
  }
  return null;
}

export function describeTokenName(token, vault) {
  const source = String(vault.entryOf(token)?.source ?? '');
  return source.startsWith('known:') ? source.slice(6) : token;
}

export function describeMcpHeld(held, server, { vault, toolName, root }) {
  const tokens = [...new Set(held.map((replacement) => replacement.token))];
  const names = [
    ...new Set(tokens.map((token) => describeTokenName(token, vault))),
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

export function buildDestinationDenial(violations, { toolName, root }) {
  const named = violations.map((violation) => ({
    ...violation,
    label: violation.name || violation.token,
    command: `/zeroh-disclosure:allow ${shellArg(violation.name || violation.token)} ${shellArg(violation.host)}`,
  }));
  const lines = [
    `🛡  ZeroH Disclosure blocked this ${toolName} call: ${leavingKind(violations)} would leave for a host it is not allowed to reach.`,
    '',
    ...named.map(
      (violation) => `${violation.label} may not be sent to ${violation.host}.`,
    ),
    '',
    'Only the user can allow this. Do not try another way; ask the user to type:',
    ...named.map((violation) => `  ${violation.command}`),
  ];
  return {
    reason: lines.join('\n'),
    systemMessage: [
      `ZeroH Disclosure blocked ${named.map((violation) => `${violation.label} → ${violation.host}`).join(', ')}. To allow it, type:`,
      ...named.map((violation) => violation.command),
    ].join('\n'),
  };
}

export function sensitiveReason(name, input, dir) {
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) {
    const file = input.file_path || input.notebook_path || input.path;
    if (file && isSensitivePath(file, dir)) {
      return `touches ${file}, a private key or credential store`;
    }
  }
  if (typeof input.command !== 'string') return null;
  if (shellOf(name) === 'bash') return bashSensitiveReason(input.command, dir);
  if (shellOf(name) === 'powershell') {
    return powershellSensitiveReason(input.command, dir);
  }
  return null;
}

export function subjectOf(name) {
  return shellOf(name) ? 'command' : 'tool call';
}

export function urlHosts(url) {
  try {
    const { hostname } = new URL(String(url));
    return hostname ? [hostname.toLowerCase()] : [];
  } catch {
    return [];
  }
}

export function shellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:[\]-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function leavingKind(violations) {
  const kinds = new Set(
    violations.map((violation) =>
      isSecretType(tokenType(violation.token)) ? 'secret' : 'personal',
    ),
  );
  if (kinds.size > 1) return 'a secret or personal data';
  return kinds.has('personal') ? 'personal data' : 'a secret';
}
