// SPDX-License-Identifier: AGPL-3.0-only

import { parseBash } from './tokenizer/bash.js';
import { newCommand } from './tokenizer/bash-sequence.js';
import { inlineCode, unwrapCommand } from './tokenizer/cmd.js';
import { parsePowerShell } from './tokenizer/powershell.js';

export function analyzeBash(source, { depth = 0 } = {}) {
  const parsed = parseBash(source);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, commands: [] };
  const commands = [];
  let ok = true;
  let reason = null;
  const visit = (command, inline) => {
    const resolved = { ...command, ...unwrapCommand(command.words), inline };
    resolved.foreignCode = false;
    resolved.dynamicCode = false;
    commands.push(resolved);
    const scripts = [];
    if (resolved.splitString !== null) {
      scripts.push({
        language: 'bash',
        code: resolved.splitString,
        dynamic: false,
        // env -S expands `${VAR}` itself: never proven.
        words: resolved.splitWord ? [resolved.splitWord] : [],
        foreignSyntax: true,
      });
    }
    scripts.push(...inlineCode(resolved, command));
    resolved.scripts = scripts;
    // The code this command runs is read and listed below.
    resolved.inlineParsed = scripts.some(
      (script) => script.language !== 'foreign' && !script.dynamic,
    );
    for (const script of scripts) {
      if (script.language === 'foreign') {
        resolved.foreignCode = true;
        continue;
      }
      if (script.dynamic) resolved.dynamicCode = true;
      if (script.language === 'argv') {
        visit(
          { ...newCommand('exec', command.depth + 1), words: script.words },
          true,
        );
        continue;
      }
      if (depth >= 4) {
        ok = false;
        reason = 'inline code nested too deep';
        continue;
      }
      const inner =
        script.language === 'powershell'
          ? parsePowerShell(script.code)
          : analyzeBash(script.code, { depth: depth + 1 });
      if (!inner.ok) {
        ok = false;
        reason = `inline ${script.language} code: ${inner.reason}`;
      }
      for (const entry of inner.commands)
        commands.push({ ...entry, inline: true });
    }
  };
  for (const command of parsed.commands) visit(command, false);
  return { ok, reason, commands };
}

// ---------------------------------------------------------------------------
// PowerShell, read conservatively (rc.2). Words are split on blanks, `'…'`
// (with `''`) and `"…"` (with backtick escapes and `$` expansions) are quote-
// removed, `;`, `|`, `&&`, `||` and newlines separate commands, a leading
// `&` or `.` calls the next word, and `$(…)`, `(…)`, `@(…)`, `@{…}` and `{…}`
// are opaque dynamic words whose inside is parsed as commands of its own.
// Here-strings are read. Anything else unusual makes the parse fail, and a
// guard that needs certainty then denies.

// A plain PowerShell variable: `$NAME`, `$env:NAME`, `${NAME}`,
// `${env:NAME}`, and a subexpression that holds only one of them
// (`$($env:NAME)`, the usual way to end a name before `:`), which evaluates
// to exactly the variable's value (see newWord's parts).

export function analyzeShell(source, shell = 'bash') {
  return shell === 'powershell' ? parsePowerShell(source) : analyzeBash(source);
}

// Every reading a guard should weigh: Bash's, and for the PowerShell tool
// PowerShell's first and Bash's too, so a Bash-shaped command sent to
// PowerShell (`sudo bash -c …` on a Unix pwsh) is judged as well.
export function shellReadings(source, shell = 'bash') {
  return shell === 'powershell'
    ? [parsePowerShell(source), analyzeBash(source)]
    : [analyzeBash(source)];
}
