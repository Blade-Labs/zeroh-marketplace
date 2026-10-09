// SPDX-License-Identifier: AGPL-3.0-only

import { readHeredocWord } from '../shell-scan.js';
import path from 'node:path';
import { zerohHome } from '../../zeroh-disclosure-core/vault.js';

export const TOKEN_AT = /^\[([A-Z_]+)-([0-9a-f]{6})\]/;
export const RUN_FILE_MAX_AGE_MS = 10 * 60 * 1000;
// At a turn's end (Stop) or the next prompt, a values file of the session
// older than this belongs to a command that was refused, denied or cancelled:
// one that runs loads its file within milliseconds of PreToolUse. The grace
// covers a background agent's command still waiting for its permission.
export const TURN_END_GRACE_MS = 60 * 1000;
export const LOAD_FAILURE_TEXT =
  'ZeroH could not load the restored values, so the command did not run';
export const LOAD_FAILURE_LINE = `[${LOAD_FAILURE_TEXT}]`;

export function safePart(value, fallback) {
  const safe = String(value || fallback)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120);
  return safe || fallback;
}

export function valuesFilePath({
  sessionId,
  toolUseId,
  home = zerohHome(),
  shell = 'bash',
}) {
  // PowerShell reads its values with Import-Csv, not by dot-sourcing a
  // script: no execution policy applies, and no .NET call is needed.
  const extension = shell === 'powershell' ? 'csv' : 'sh';
  return path.join(
    home,
    'run',
    safePart(sessionId, 'anonymous'),
    `${safePart(toolUseId, 'anonymous')}.${extension}`,
  );
}

export function singleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// PowerShell also ends a single-quoted string at the typographic quotes
// U+2018..U+201B; doubling each keeps it literal.
export function powerShellSingleQuote(value) {
  return `'${String(value).replace(/['\u2018-\u201b]/gu, (q) => q + q)}'`;
}

export function gitBashPath(file, platform = process.platform) {
  return platform === 'win32' ? String(file).replace(/\\/g, '/') : file;
}

export function bindingAt(command, index, vault) {
  const match = command.slice(index).match(TOKEN_AT);
  if (!match) return null;
  const token = match[0];
  const entry = vault.entryOf(token);
  if (!entry) return null;
  return {
    token,
    type: match[1],
    hash: match[2],
    variable: `ZH_${match[1]}_${match[2]}`,
    value: entry.value,
  };
}

export function heredocAt(command, start) {
  const word = readHeredocWord(command, start);
  if (!word || word.error) return word;
  if (word.quoted && !/^[A-Za-z0-9_]+$/.test(word.delimiter)) {
    return {
      error: 'quoted heredoc delimiter cannot be made safely unquoted',
    };
  }
  return {
    ...word,
    header: word.quoted
      ? `${command.slice(start, word.wordStart)}${word.delimiter}`
      : command.slice(start, word.end),
  };
}

// A lone backslash the rewrite must escape is written as ${ZH_BACKSLASH},
// which the values file sets to one backslash, so the rewrite never makes a
// new pair of backslashes out of one. Claude Code starts Git Bash on Windows
// as `bash -c -l "<command>"`, and Git Bash reads a pair of backslashes inside
// that quoted argument as one: a quoted heredoc's `before\` at a line end,
// escaped as `before\\`, arrived as `before\` and joined the next line; a
// `"\[TOKEN]"`, written `"\\${ZH_…}"`, printed the variable's name.
export const BACKSLASH_VARIABLE = 'ZH_BACKSLASH';
export const BACKSLASH = `\${${BACKSLASH_VARIABLE}}`;

export function replaceHeredocLine(line, vault, bindings, quoted, uses) {
  let output = '';
  for (let index = 0; index < line.length;) {
    const binding = bindingAt(line, index, vault);
    if (binding) {
      bindings.set(binding.token, binding);
      output += `\${${binding.variable}}`;
      index += binding.token.length;
      continue;
    }
    const escapedBinding =
      line[index] === '\\' ? bindingAt(line, index + 1, vault) : null;
    if (escapedBinding) {
      bindings.set(escapedBinding.token, escapedBinding);
      uses.backslash = true;
      output += `${BACKSLASH}\${${escapedBinding.variable}}`;
      index += escapedBinding.token.length + 1;
      continue;
    }
    const char = line[index];
    if (quoted && char === '\\' && line[index + 1] === '\\') {
      // A pair stays a pair of escaped backslashes: where Git Bash reads the
      // user's pair as one, it reads this as one escaped backslash too.
      output += '\\\\\\\\';
      index += 2;
      continue;
    }
    if (quoted && char === '\\') {
      uses.backslash = true;
      output += BACKSLASH;
    } else {
      output += quoted && ['$', '`'].includes(char) ? `\\${char}` : char;
    }
    index += 1;
  }
  return { ok: true, text: output };
}

// A value with no IFS whitespace and nothing a glob or extglob pattern needs
// is the same word unquoted as quoted (expansion results get no quote removal
// and no brace expansion); an empty one would vanish.
export const BARE_SAFE_VALUE = /^[^\s*?[\]()]+$/u;

export function bashReplacement(
  binding,
  quote,
  { bareWhenPlain = false } = {},
) {
  if (
    quote === 'unquoted' &&
    bareWhenPlain &&
    BARE_SAFE_VALUE.test(String(binding.value))
  )
    return `\${${binding.variable}}`;
  if (quote === 'single') return `'"\${${binding.variable}}"'`;
  if (quote === 'ansi') return `'"\${${binding.variable}}"$'`;
  if (quote === 'double') return `\${${binding.variable}}`;
  return `"\${${binding.variable}}"`;
}

export function bashFailure(reason) {
  return { ok: false, reason, bindings: [] };
}

export function bashWordAt(command, index, word) {
  if (!command.startsWith(word, index)) return false;
  const before = command[index - 1];
  const after = command[index + word.length];
  return (
    (!before || !/[A-Za-z0-9_]/u.test(before)) &&
    (!after || !/[A-Za-z0-9_]/u.test(after))
  );
}

// This is deliberately a quoting scanner rather than a shell parser. It only
// distinguishes the contexts that change whether parameter expansion occurs.
