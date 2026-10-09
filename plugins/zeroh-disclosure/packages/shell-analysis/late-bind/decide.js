// SPDX-License-Identifier: AGPL-3.0-only

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { zerohHome } from '../../zeroh-disclosure-core/vault.js';
import {
  BACKSLASH_VARIABLE,
  LOAD_FAILURE_LINE,
  LOAD_FAILURE_TEXT,
  RUN_FILE_MAX_AGE_MS,
  TURN_END_GRACE_MS,
  bashFailure,
  gitBashPath,
  powerShellSingleQuote,
  safePart,
  singleQuote,
  valuesFilePath,
} from './detect.js';
import { rewriteBashCommand } from './rewrite-bash.js';
import { rewritePowerShellCommand } from './rewrite-powershell.js';

export function prepareBashLateBinding({
  command,
  vault,
  sessionId,
  toolUseId,
  home = zerohHome(),
}) {
  let rewritten = rewriteBashCommand(command, vault);
  if (!rewritten.ok || rewritten.bindings.length === 0) return rewritten;
  if (
    claudeCodeBraceQuoteRefusal(rewritten.command) &&
    !claudeCodeBraceQuoteRefusal(command)
  ) {
    // A token inside an unquoted { ... } (a group, or ${var:-...}) would put a
    // quote after the brace; a plain value needs none.
    rewritten = rewriteBashCommand(command, vault, { bareWhenPlain: true });
    if (!rewritten.ok) return rewritten;
  }

  const file = valuesFilePath({ sessionId, toolUseId, home });
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const contents = [
    ...(rewritten.backslash
      ? [`${BACKSLASH_VARIABLE}=${singleQuote('\\')}`]
      : []),
    ...rewritten.bindings.map(
      ({ variable, value }) => `${variable}=${singleQuote(value)}`,
    ),
  ].join('\n');
  writeFileSync(file, `${contents}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);

  const sourceFile = singleQuote(gitBashPath(file));
  // A file that cannot be read says so and the command does not run; a file
  // that cannot be removed (a read-only run directory) does not stop it. The
  // command sits in the `then` branch rather than in a `{ … }` group: Claude
  // Code refuses a command with an unquoted `{` followed by a quote before the
  // next `}` (claudeCodeBraceQuoteRefusal), and the rewritten command almost
  // always has a quote there.
  const wrapped = `if . ${sourceFile}; then rm -f ${sourceFile} 2>/dev/null\n${rewritten.command}\nelse echo '${LOAD_FAILURE_LINE}'; rm -f ${sourceFile} 2>/dev/null; false; fi`;
  if (
    claudeCodeBraceQuoteRefusal(wrapped) &&
    !claudeCodeBraceQuoteRefusal(command)
  ) {
    // The rewrite itself would trip the check (a token inside the user's own
    // `{ … }` group becomes a quoted variable): Claude Code would refuse the
    // command and the values file would wait for the sweep.
    deleteRunFile(file);
    return bashFailure(
      "a token inside a { ... } group would be refused by Claude Code's shell check once put back",
    );
  }
  return { ...rewritten, file, command: wrapped };
}

function deleteRunFile(file) {
  try {
    unlinkSync(file);
  } catch {
    // The sweep removes it.
  }
}

// Claude Code's own Bash safety check, as shipped in 2.1.283 (the compiled
// `claude` executable, function iAe with the helper that blanks quoted braces):
//   if (rt.test(Re(e))) return { kind: "too-complex",
//     reason: "Contains brace with quote character (expansion obfuscation)",
//     differential: !0 };
//   rt = /\{[^}]*['"]/
// Re(e) replaces every `{` inside '…', "…" or `…` with a space and leaves
// everything else (comments included) as it is. A "too-complex" command is
// never matched by allow rules: headless runs refuse it, interactive runs ask.
// Returns true when Claude Code 2.1.283 would refuse `command` that way.
export function claudeCodeBraceQuoteRefusal(command) {
  return /\{[^}]*['"]/u.test(blankQuotedBraces(String(command)));
}

function blankQuotedBraces(e) {
  if (!e.includes('{')) return e;
  const out = [];
  let single = false;
  let double = false;
  let backtick = false;
  let wordStart = true;
  let i = 0;
  const blank = (c) => (c === '{' ? ' ' : c);
  while (i < e.length) {
    const c = e[i];
    if (backtick) {
      if (c === '\\' && ['`', '\\', '$'].includes(e[i + 1])) {
        out.push(c, e[i + 1]);
        i += 2;
      } else {
        if (c === '`') backtick = false;
        out.push(blank(c));
        i += 1;
      }
    } else if (single) {
      if (c === "'") single = false;
      out.push(blank(c));
      i += 1;
    } else if (double) {
      if (c === '\\' && ['"', '\\', '`'].includes(e[i + 1])) {
        out.push(c, e[i + 1]);
        i += 2;
      } else if (c === '`') {
        backtick = true;
        out.push(c);
        i += 1;
      } else {
        if (c === '"') double = false;
        out.push(blank(c));
        i += 1;
      }
    } else if (c === '\\' && i + 1 < e.length) {
      out.push(c, e[i + 1]);
      if (e[i + 1] !== '\n') wordStart = false;
      i += 2;
    } else if (c === '#' && wordStart) {
      while (i < e.length && e[i] !== '\n') {
        out.push(e[i]);
        i += 1;
      }
      wordStart = true;
    } else if (c === '`') {
      backtick = true;
      wordStart = false;
      out.push(c);
      i += 1;
    } else {
      if (c === "'") single = true;
      else if (c === '"') double = true;
      wordStart = [' ', '\t', '\n', ';', '|', '&', '(', ')', '<', '>'].includes(
        c,
      );
      out.push(c);
      i += 1;
    }
  }
  return out.join('');
}

export function preparePowerShellLateBinding({
  command,
  vault,
  sessionId,
  toolUseId,
  home = zerohHome(),
}) {
  const rewritten = rewritePowerShellCommand(command, vault);
  if (!rewritten.ok || rewritten.bindings.length === 0) return rewritten;

  const file = valuesFilePath({
    sessionId,
    toolUseId,
    home,
    shell: 'powershell',
  });
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const csvField = (value) => `"${String(value).replace(/"/gu, '""')}"`;
  const contents = [
    '"Name","Value"',
    ...rewritten.bindings.map(
      ({ variable, value }) => `${csvField(variable)},${csvField(value)}`,
    ),
  ].join('\n');
  writeFileSync(file, `${contents}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);

  const quotedFile = powerShellSingleQuote(file);
  const remove = `Remove-Item -LiteralPath ${quotedFile} -Force -ErrorAction SilentlyContinue`;
  // Cmdlets only: no .NET method call, type literal, $() or script block, each
  // of which Claude Code's PowerShell checks ask about (2.1.283: "Command
  // invokes .NET methods", "Command contains subexpressions $()", ...).
  // Import-Csv keeps every character of a quoted field (CR, LF, quotes);
  // -Encoding UTF8 reads the BOM-less file the same way on Windows
  // PowerShell 5.1 and PowerShell 7. A file that cannot be read stops the
  // command with a message the model can relay; a failed removal does not.
  const loads = rewritten.bindings.map(
    ({ variable }) =>
      `Import-Csv -LiteralPath ${quotedFile} -Encoding UTF8 -ErrorAction Stop | Where-Object Name -CEQ '${variable}' | Select-Object -ExpandProperty Value | Set-Variable -Name ${variable}`,
  );
  return {
    ...rewritten,
    file,
    command: [
      'try {',
      ...loads,
      `} catch { ${remove}; throw '${LOAD_FAILURE_TEXT}' }`,
      remove,
      rewritten.command,
    ].join('\n'),
  };
}

export function deleteValuesFile({ sessionId, toolUseId, home = zerohHome() }) {
  const files = ['bash', 'powershell'].map((shell) =>
    valuesFilePath({ sessionId, toolUseId, home, shell }),
  );
  for (const file of files) {
    try {
      unlinkSync(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    rmdirSync(path.dirname(files[0]));
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
  }
}

// Removes run files older than `maxAgeMs` (0: all of them, for `vault
// clear`) and returns how many it removed. A file another process removed
// meanwhile is skipped.
export function cleanupStaleRunFiles({
  home = zerohHome(),
  now = Date.now(),
  maxAgeMs = RUN_FILE_MAX_AGE_MS,
} = {}) {
  const run = path.join(home, 'run');
  if (!existsSync(run)) return 0;
  let removed = 0;
  for (const session of readdirSync(run, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const directory = path.join(run, session.name);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(directory, entry.name);
      try {
        if (maxAgeMs === 0 || now - statSync(file).mtimeMs > maxAgeMs) {
          unlinkSync(file);
          removed += 1;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    try {
      rmdirSync(directory);
    } catch (error) {
      if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error;
    }
  }
  return removed;
}

// Removes one session's run files older than `minAgeMs` (0: all of them, at
// SessionEnd) and returns how many it removed.
export function cleanupSessionRunFiles({
  sessionId,
  home = zerohHome(),
  now = Date.now(),
  minAgeMs = TURN_END_GRACE_MS,
} = {}) {
  if (!sessionId) return 0;
  const directory = path.join(home, 'run', safePart(sessionId, 'anonymous'));
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(directory, entry.name);
    try {
      if (minAgeMs === 0 || now - statSync(file).mtimeMs >= minAgeMs) {
        unlinkSync(file);
        removed += 1;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  try {
    rmdirSync(directory);
  } catch (error) {
    if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error;
  }
  return removed;
}
