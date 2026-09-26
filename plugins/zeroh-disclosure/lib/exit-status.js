// SPDX-License-Identifier: AGPL-3.0-only

// Exit-status wrappers for Bash and PowerShell tool calls.
//
// Claude Code sends the output of a command that exits non-zero through
// PostToolUseFailure, whose hooks can add context but cannot replace the output.
// A failing command that printed a secret would reach the model unmasked. So
// PreToolUse rewrites every foreground shell command to finish with status 0 and
// to report a failure in its output instead; PostToolUse then always sees, and
// masks, the output.
//
// Bash: `<command> || echo '<failure line>'` on the command's last line. Claude
// Code's permission rules accept that suffix, so a user's allow rules (for
// example `Bash(npm test:*)`) still match. A command that can leave the shell
// early (`exit`, `logout`, `set -e`, `set -u`, a `${VAR:?}` expansion, sourcing a
// script) or whose last line cannot take a suffix (a trailing comment) gets an
// EXIT trap instead; that form reports the exact status but Claude Code asks the
// user to approve it.
//
// PowerShell: the command is kept as a single-quoted string, compiled with
// [ScriptBlock]::Create and dot-sourced inside try/catch/finally. So a syntax
// error in it is caught like any other error (the wrapper still exits 0 and
// PostToolUse masks the message), and statements that must come first
// (`using`, `param(...)`, `#requires`) still come first in their own script.
// The finally block turns an early `exit` into status 0, and a trailing line
// reports the status Claude Code would have used ($LASTEXITCODE, else $?).

import { commentStarts, readHeredocWord } from './shell-scan.js';

export const BASH_FAILURE_LINE =
  '[ZeroH: the command failed with a non-zero exit status]';

const COMMAND_START = String.raw`(?:^|[;&|(){}\n]|\bthen|\bdo|\belse)[ \t]*`;
const LEAVES_SHELL = new RegExp(
  `${COMMAND_START}(?:(?:exit|logout|source|\\.)(?=[ \\t;&|)]|$)|set[ \\t]+(?:-[A-Za-z]*[eu]|-o[ \\t]+(?:errexit|nounset))|shopt[ \\t]+-s[ \\t]+inherit_errexit)`,
  'mu',
);
// `${VAR:?msg}` and `${VAR?msg}` end a non-interactive shell when VAR is unset.
const EXPANSION_EXITS =
  /\$\{[#!]?(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*])(?:\[[^\]]*\])?:?\?/u;

// The heredoc word at `start`, or null (an unterminated quote included).
function heredocWord(command, start) {
  const word = readHeredocWord(command, start);
  return word && !word.error ? word : null;
}

// Finds where a `|| echo …` suffix can go: after the last command on the last
// line, or at the end of the line that opens a trailing heredoc. Returns
// { at, background } or null when no safe place exists.
export function bashSuffixPoint(command) {
  let quote = null;
  let inComment = false;
  let pending = [];
  let lastBodyStart = -1;
  let lastBodyEnd = -1;
  let commentOnOpener = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (inComment) {
      if (char !== '\n') continue;
      inComment = false;
      if (pending.length) commentOnOpener = true;
    } else if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    } else if (quote) {
      if (char === '\\') index += 1;
      else if (char === (quote === 'ansi' ? "'" : quote)) quote = null;
      continue;
    } else if (char === '\\') {
      index += 1;
      continue;
    } else if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    } else if (char === '$' && command[index + 1] === "'") {
      // An ANSI-C string ends at an unescaped single quote.
      quote = 'ansi';
      index += 1;
      continue;
    } else if (commentStarts(command, index)) {
      inComment = true;
      continue;
    } else if (
      command.startsWith('<<', index) &&
      command[index + 2] !== '<' &&
      command[index - 1] !== '<'
    ) {
      const word = heredocWord(command, index);
      if (!word) return null;
      pending.push(word);
      index = word.end - 1;
      continue;
    }
    if (char === '\n' && pending.length) {
      const bodyStart = index;
      let cursor = index + 1;
      for (const { delimiter, stripTabs } of pending) {
        for (;;) {
          if (cursor > command.length) return null;
          let lineEnd = command.indexOf('\n', cursor);
          if (lineEnd < 0) lineEnd = command.length;
          const line = command.slice(cursor, lineEnd);
          cursor = lineEnd + 1;
          if ((stripTabs ? line.replace(/^\t+/u, '') : line) === delimiter)
            break;
        }
      }
      lastBodyStart = commentOnOpener ? -2 : bodyStart;
      lastBodyEnd = cursor - 1;
      pending = [];
      commentOnOpener = false;
      index = cursor - 2;
    }
  }
  if (quote || pending.length) return null;
  const trimmedEnd = command.trimEnd().length;
  if (lastBodyEnd >= trimmedEnd) {
    // The command ends with a heredoc body: the suffix goes on its opener line.
    if (lastBodyStart < 0) return null;
    return linePoint(command, lastBodyStart);
  }
  if (inComment) return null;
  return linePoint(command, trimmedEnd);
}

function linePoint(command, end) {
  let at = end;
  while (at > 0 && /[ \t]/u.test(command[at - 1])) at -= 1;
  const before = command.slice(0, at);
  if (/(?:\|\||&&|\||\\|;;|[(]|\{)$/u.test(before) || at === 0) return null;
  if (/(?:^|[^&>])&$/u.test(before)) return { at, background: true };
  if (before.endsWith(';')) at -= 1;
  return { at, background: false };
}

export function wrapBashExitStatus(command, { original = command } = {}) {
  if (typeof command !== 'string' || !command.trim()) return command;
  const point =
    LEAVES_SHELL.test(original) || EXPANSION_EXITS.test(original)
      ? null
      : bashSuffixPoint(command);
  if (point?.background) return command;
  if (point) {
    return `${command.slice(0, point.at)} || echo '${BASH_FAILURE_LINE}'${command.slice(point.at)}`;
  }
  return [
    `trap 'zh_status=$?; trap - EXIT; printf "\\n[ZeroH: the command failed with exit status %s]\\n" "$zh_status"; exit 0' EXIT`,
    command,
    `zh_status=$?; trap - EXIT; [ "$zh_status" -eq 0 ] || printf '\\n[ZeroH: the command failed with exit status %s]\\n' "$zh_status"`,
  ].join('\n');
}

function powerShellLiteral(value) {
  return `'${String(value).replace(/['\u2018-\u201b]/gu, (q) => q + q)}'`;
}

export function wrapPowerShellExitStatus(command) {
  if (typeof command !== 'string' || !command.trim()) return command;
  return [
    '$zhDone = $false; $zhThrew = $false; $zhOk = $true',
    `$zhCommand = ${powerShellLiteral(command)}`,
    'try {',
    '$zhParseErrors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($zhCommand, [ref]$null, [ref]$zhParseErrors)',
    'if ($zhParseErrors) { throw ("The command has a syntax error:`n" + (($zhParseErrors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "`n")) }',
    '$zhBlock = [ScriptBlock]::Create($zhCommand + "`n" + \'$zhOk = $?\')',
    '. $zhBlock',
    '$zhDone = $true',
    '} catch { $_ | Out-String | Write-Output; $zhThrew = $true; $zhDone = $true } finally { if (-not $zhDone) { Write-Output "[ZeroH: the command stopped early with exit]"; [Environment]::Exit(0) } }',
    '$zhStatus = if ($zhThrew) { 1 } elseif ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { $LASTEXITCODE } elseif ($zhOk) { 0 } else { 1 }',
    'if ($zhStatus -ne 0) { Write-Output "[ZeroH: the command failed with exit status $zhStatus]" }',
    '$global:LASTEXITCODE = 0',
  ].join('\n');
}
