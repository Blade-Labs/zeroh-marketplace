// SPDX-License-Identifier: AGPL-3.0-only

// Late binding keeps restored shell values out of Claude Code's saved hook
// output. The command sources a private, short-lived values file instead.
import { commentStarts, readHeredocWord } from './shell-scan.js';
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
import { zerohHome } from './vault.js';

const TOKEN_AT = /^\[([A-Z_]+)-([0-9a-f]{6})\]/;
export const RUN_FILE_MAX_AGE_MS = 10 * 60 * 1000;
const LOAD_FAILURE_TEXT =
  'ZeroH could not load the restored values, so the command did not run';
export const LOAD_FAILURE_LINE = `[${LOAD_FAILURE_TEXT}]`;

function safePart(value, fallback) {
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
  // PowerShell reads its values as base64 lines through .NET, not by
  // dot-sourcing a script: no execution policy applies, and Windows
  // PowerShell 5.1 cannot misread a BOM-less file's encoding.
  const extension = shell === 'powershell' ? 'b64' : 'sh';
  return path.join(
    home,
    'run',
    safePart(sessionId, 'anonymous'),
    `${safePart(toolUseId, 'anonymous')}.${extension}`,
  );
}

function singleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// PowerShell also ends a single-quoted string at the typographic quotes
// U+2018..U+201B; doubling each keeps it literal.
function powerShellSingleQuote(value) {
  return `'${String(value).replace(/['\u2018-\u201b]/gu, (q) => q + q)}'`;
}

export function gitBashPath(file, platform = process.platform) {
  return platform === 'win32' ? String(file).replace(/\\/g, '/') : file;
}

function bindingAt(command, index, vault) {
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

function heredocAt(command, start) {
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

function replaceHeredocLine(line, vault, bindings, quoted) {
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
      output += quoted
        ? `\\\\\${${escapedBinding.variable}}`
        : `\\\\\${${escapedBinding.variable}}`;
      index += escapedBinding.token.length + 1;
      continue;
    }
    const char = line[index];
    output += quoted && ['\\', '$', '`'].includes(char) ? `\\${char}` : char;
    index += 1;
  }
  return { ok: true, text: output };
}

function bashReplacement(binding, quote) {
  if (quote === 'single') return `'"\${${binding.variable}}"'`;
  if (quote === 'ansi') return `'"\${${binding.variable}}"$'`;
  if (quote === 'double') return `\${${binding.variable}}`;
  return `"\${${binding.variable}}"`;
}

function bashFailure(reason) {
  return { ok: false, reason, bindings: [] };
}

function bashWordAt(command, index, word) {
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
export function rewriteBashCommand(command, vault) {
  const bindings = new Map();
  const pendingHeredocs = [];
  let heredoc = null;
  const contexts = [
    { kind: 'root', quote: 'unquoted', outerQuote: null, parenDepth: 0 },
  ];
  let output = '';

  const current = () => contexts.at(-1);

  for (let index = 0; index < command.length;) {
    if (heredoc) {
      const newline = command.indexOf('\n', index);
      const end = newline === -1 ? command.length : newline;
      const rawLine = command.slice(index, end);
      const comparison = (
        heredoc.stripTabs ? rawLine.replace(/^\t+/, '') : rawLine
      ).replace(/\r$/, '');
      if (comparison === heredoc.delimiter) {
        output += rawLine;
        if (newline !== -1) output += '\n';
        index = newline === -1 ? end : end + 1;
        heredoc = pendingHeredocs.shift() || null;
        continue;
      }
      const replaced = replaceHeredocLine(
        rawLine,
        vault,
        bindings,
        heredoc.quoted,
      );
      output += replaced.text;
      if (newline !== -1) output += '\n';
      index = newline === -1 ? end : end + 1;
      continue;
    }

    const frame = current();
    const state = frame.quote;
    const binding = bindingAt(command, index, vault);
    if (binding && state !== 'comment') {
      const activeCase = frame.cases?.at(-1);
      if (activeCase?.phase === 'subject-start') activeCase.phase = 'subject';
      bindings.set(binding.token, binding);
      output += bashReplacement(binding, state);
      index += binding.token.length;
      continue;
    }

    const char = command[index];
    if (state === 'comment') {
      output += char;
      index += 1;
      if (char === '\n') {
        frame.quote = 'unquoted';
        heredoc = pendingHeredocs.shift() || null;
      }
      continue;
    }

    if (
      ['unquoted', 'double'].includes(state) &&
      command.startsWith('$((', index)
    ) {
      output += '$((';
      index += 3;
      contexts.push({
        kind: 'arithmetic',
        quote: 'unquoted',
        outerQuote: state,
        parenDepth: 0,
      });
      continue;
    }
    if (
      ['unquoted', 'double'].includes(state) &&
      char === '$' &&
      command[index + 1] === '('
    ) {
      output += '$(';
      index += 2;
      contexts.push({
        kind: 'dollar',
        quote: 'unquoted',
        outerQuote: state,
        parenDepth: 0,
        cases: [],
        commandPosition: true,
      });
      continue;
    }
    if (
      (frame.kind === 'backtick' || ['unquoted', 'double'].includes(state)) &&
      char === '`'
    ) {
      output += char;
      index += 1;
      if (frame.kind === 'backtick') {
        contexts.pop();
      } else {
        contexts.push({
          kind: 'backtick',
          quote: 'unquoted',
          outerQuote: state,
          parenDepth: 0,
        });
      }
      continue;
    }

    if (state === 'single') {
      output += char;
      index += 1;
      if (char === "'") frame.quote = 'unquoted';
      continue;
    }

    if (state === 'ansi') {
      output += char;
      index += 1;
      if (char === '\\' && index < command.length) {
        output += command[index];
        index += 1;
      } else if (char === "'") {
        frame.quote = 'unquoted';
      }
      continue;
    }

    if (state === 'double') {
      if (char === '\\' && index + 1 < command.length) {
        const escapedBinding = bindingAt(command, index + 1, vault);
        if (escapedBinding) {
          bindings.set(escapedBinding.token, escapedBinding);
          output += `\\\\\${${escapedBinding.variable}}`;
          index += escapedBinding.token.length + 1;
          continue;
        }
        if (['$', '`', '"', '\\', '\n'].includes(command[index + 1])) {
          output += char + command[index + 1];
          index += 2;
          continue;
        }
      }
      output += char;
      index += 1;
      if (char === '"') frame.quote = 'unquoted';
      continue;
    }

    if (char === '\\' && index + 1 < command.length) {
      const escapedBinding = bindingAt(command, index + 1, vault);
      if (escapedBinding) {
        bindings.set(escapedBinding.token, escapedBinding);
        output += `"\${${escapedBinding.variable}}"`;
        index += escapedBinding.token.length + 1;
      } else {
        output += char + command[index + 1];
        index += 2;
      }
      continue;
    }
    if (frame.kind === 'dollar') {
      const activeCase = frame.cases.at(-1);
      if (frame.commandPosition && bashWordAt(command, index, 'case')) {
        frame.cases.push({ phase: 'subject-start' });
        frame.commandPosition = false;
        output += 'case';
        index += 4;
        continue;
      }
      if (activeCase?.phase === 'subject' && bashWordAt(command, index, 'in')) {
        activeCase.phase = 'pattern';
        output += 'in';
        index += 2;
        continue;
      }
      if (
        activeCase &&
        frame.commandPosition &&
        bashWordAt(command, index, 'esac')
      ) {
        frame.cases.pop();
        frame.commandPosition = false;
        output += 'esac';
        index += 4;
        continue;
      }
      if (
        activeCase?.phase === 'body' &&
        (command.startsWith(';;&', index) ||
          command.startsWith(';;', index) ||
          command.startsWith(';&', index))
      ) {
        const terminator = command.startsWith(';;&', index)
          ? ';;&'
          : command.slice(index, index + 2);
        activeCase.phase = 'pattern';
        frame.commandPosition = true;
        output += terminator;
        index += terminator.length;
        continue;
      }
      if (
        activeCase?.phase === 'pattern' &&
        char === ')' &&
        frame.parenDepth === 0
      ) {
        activeCase.phase = 'body';
        frame.commandPosition = true;
        output += char;
        index += 1;
        continue;
      }
      if (activeCase?.phase === 'subject-start' && !/\s/u.test(char)) {
        activeCase.phase = 'subject';
      }
    }
    if (frame.kind === 'arithmetic' && char === '(') {
      frame.parenDepth += 1;
      output += char;
      index += 1;
      continue;
    }
    if (frame.kind === 'arithmetic' && char === ')') {
      if (frame.parenDepth > 0) {
        frame.parenDepth -= 1;
        output += char;
        index += 1;
      } else if (command[index + 1] === ')') {
        output += '))';
        index += 2;
        contexts.pop();
      } else {
        return bashFailure('arithmetic expansion is unbalanced');
      }
      continue;
    }
    if (frame.kind === 'dollar' && char === '(') {
      frame.parenDepth += 1;
      output += char;
      index += 1;
      continue;
    }
    if (frame.kind === 'dollar' && char === ')') {
      if (frame.parenDepth === 0 && frame.cases.length > 0) {
        return bashFailure('case/esac inside $() is unbalanced');
      }
      output += char;
      index += 1;
      if (frame.parenDepth > 0) frame.parenDepth -= 1;
      else contexts.pop();
      continue;
    }
    if (char === '$' && command[index + 1] === "'") {
      output += "$'";
      index += 2;
      frame.quote = 'ansi';
      continue;
    }
    if (char === "'") {
      output += char;
      index += 1;
      frame.quote = 'single';
      continue;
    }
    if (char === '"') {
      output += char;
      index += 1;
      frame.quote = 'double';
      continue;
    }
    if (commentStarts(command, index)) {
      output += char;
      index += 1;
      frame.quote = 'comment';
      continue;
    }
    const heredocSpec =
      frame.kind !== 'arithmetic' && char === '<'
        ? heredocAt(command, index)
        : null;
    if (heredocSpec) {
      if (heredocSpec.error) return bashFailure(heredocSpec.error);
      output += heredocSpec.header;
      pendingHeredocs.push(heredocSpec);
      index = heredocSpec.end;
      continue;
    }
    output += char;
    index += 1;
    if (char === '\n') heredoc = pendingHeredocs.shift() || null;
    if (frame.kind === 'dollar') {
      if (/\s/u.test(char)) {
        if (char === '\n') frame.commandPosition = true;
      } else if ([';', '&', '|'].includes(char)) {
        frame.commandPosition = true;
      } else {
        frame.commandPosition = false;
      }
    }
  }

  if (heredoc || pendingHeredocs.length > 0)
    return bashFailure('heredoc is unterminated');
  if (contexts.length > 1)
    return bashFailure(
      `${contexts.at(-1).kind === 'backtick' ? 'backtick' : '$()'} command substitution is unterminated`,
    );
  if (!['unquoted', 'comment'].includes(current().quote))
    return bashFailure(`${current().quote} quote is unterminated`);
  return { ok: true, command: output, bindings: [...bindings.values()] };
}

const POWERSHELL_TYPOGRAPHIC_QUOTES = /[‘’‚‛“”„]/u;

function rewritePowerShellSingleString(command, start, vault, bindings) {
  let output = '"';
  let containsCloseParen = false;
  let changed = false;
  for (let index = start + 1; index < command.length;) {
    const binding = bindingAt(command, index, vault);
    if (binding) {
      bindings.set(binding.token, binding);
      output += `\${${binding.variable}}`;
      changed = true;
      index += binding.token.length;
      continue;
    }
    const char = command[index];
    if (char === "'" && command[index + 1] === "'") {
      output += "'";
      index += 2;
      continue;
    }
    if (char === "'") {
      output += '"';
      return {
        ok: true,
        end: index + 1,
        text: changed ? output : command.slice(start, index + 1),
        containsCloseParen,
      };
    }
    if (char === ')') containsCloseParen = true;
    if (char === '`') output += '``';
    else if (char === '$') output += '`$';
    else if (char === '"') output += '`"';
    else output += char;
    index += 1;
  }
  return {
    ok: false,
    reason: 'PowerShell single-quoted string is unterminated',
  };
}

function powerShellHereStringAt(command, start, vault, bindings) {
  const single = command.startsWith("@'", start);
  const opening = single ? "@'" : '@"';
  const terminator = single ? "'@" : '"@';
  let lineStart = false;
  let end = -1;
  for (let index = start + 2; index < command.length; index += 1) {
    if (lineStart && command.startsWith(terminator, index)) {
      end = index;
      break;
    }
    lineStart = command[index] === '\n';
  }
  if (end === -1) {
    return { ok: false, reason: 'PowerShell here-string is unterminated' };
  }
  const body = command.slice(start + 2, end);
  let bodyOutput = '';
  let changed = false;
  for (let index = 0; index < body.length;) {
    const binding = bindingAt(body, index, vault);
    if (binding) {
      bindings.set(binding.token, binding);
      bodyOutput += `\${${binding.variable}}`;
      changed = true;
      index += binding.token.length;
      continue;
    }
    const escapedBinding =
      body[index] === '`' ? bindingAt(body, index + 1, vault) : null;
    if (escapedBinding) {
      bindings.set(escapedBinding.token, escapedBinding);
      bodyOutput += `${single ? '``' : ''}\${${escapedBinding.variable}}`;
      changed = true;
      index += escapedBinding.token.length + 1;
      continue;
    }
    const char = body[index];
    if (single && char === '`') bodyOutput += '``';
    else if (single && char === '$') bodyOutput += '`$';
    else bodyOutput += char;
    index += 1;
  }
  if (single && changed && /(?:^|\r?\n)[ \t]*"@/u.test(body)) {
    return {
      ok: false,
      reason:
        'PowerShell single-quoted here-string contains a line that would terminate the rewritten double-quoted here-string',
    };
  }
  return {
    ok: true,
    end: end + 2,
    text: changed
      ? `${single ? '@"' : opening}${bodyOutput}${single ? '"@' : terminator}`
      : command.slice(start, end + 2),
  };
}

function powerShellFailure(reason) {
  return { ok: false, reason, bindings: [] };
}

// PowerShell has no shell-neutral parser in Node. This scanner deliberately
// handles only contexts where variable interpolation is unambiguous. Callers
// deny anything this scanner cannot prove safe.
export function rewritePowerShellCommand(command, vault) {
  const bindings = new Map();
  const contexts = [
    {
      kind: 'code',
      comment: null,
      subexpression: false,
      parenDepth: 0,
    },
  ];
  let output = '';

  const current = () => contexts.at(-1);

  if (POWERSHELL_TYPOGRAPHIC_QUOTES.test(command)) {
    return powerShellFailure(
      'typographic PowerShell quotes are not safely rewritable',
    );
  }

  for (let index = 0; index < command.length;) {
    const frame = current();
    const binding = bindingAt(command, index, vault);
    if (binding && !(frame.kind === 'code' && frame.comment)) {
      bindings.set(binding.token, binding);
      output += `\${${binding.variable}}`;
      index += binding.token.length;
      continue;
    }

    const char = command[index];
    if (frame.kind === 'double') {
      if (char === '`' && index + 1 < command.length) {
        const escapedBinding = bindingAt(command, index + 1, vault);
        if (escapedBinding) {
          bindings.set(escapedBinding.token, escapedBinding);
          output += `\${${escapedBinding.variable}}`;
          index += escapedBinding.token.length + 1;
        } else {
          output += char + command[index + 1];
          index += 2;
        }
        continue;
      }
      if (char === '$' && command[index + 1] === '(') {
        output += '$(';
        index += 2;
        contexts.push({
          kind: 'code',
          comment: null,
          subexpression: true,
          parenDepth: 0,
        });
        continue;
      }
      output += char;
      index += 1;
      if (char === '"') contexts.pop();
      continue;
    }

    if (frame.kind === 'here-double') {
      if (frame.lineStart && command.startsWith('"@', index)) {
        output += '"@';
        index += 2;
        contexts.pop();
        continue;
      }
      if (char === '`' && index + 1 < command.length) {
        const escapedBinding = bindingAt(command, index + 1, vault);
        if (escapedBinding) {
          bindings.set(escapedBinding.token, escapedBinding);
          output += `\${${escapedBinding.variable}}`;
          index += escapedBinding.token.length + 1;
        } else {
          output += char + command[index + 1];
          index += 2;
        }
        continue;
      }
      if (char === '$' && command[index + 1] === '(') {
        output += '$(';
        index += 2;
        frame.lineStart = false;
        contexts.push({
          kind: 'code',
          comment: null,
          subexpression: true,
          parenDepth: 0,
        });
        continue;
      }
      output += char;
      index += 1;
      frame.lineStart = char === '\n';
      continue;
    }

    if (frame.comment === 'line') {
      output += char;
      index += 1;
      if (char === '\n') frame.comment = null;
      continue;
    }
    if (frame.comment === 'block') {
      if (command.startsWith('#>', index)) {
        output += '#>';
        index += 2;
        frame.comment = null;
      } else {
        output += char;
        index += 1;
      }
      continue;
    }

    if (command.startsWith('<#', index)) {
      output += '<#';
      index += 2;
      frame.comment = 'block';
      continue;
    }
    if (char === '#') {
      output += char;
      index += 1;
      frame.comment = 'line';
      continue;
    }
    if (command.startsWith("@'", index)) {
      const rewritten = powerShellHereStringAt(command, index, vault, bindings);
      if (!rewritten.ok) return powerShellFailure(rewritten.reason);
      output += rewritten.text;
      index = rewritten.end;
      continue;
    }
    if (command.startsWith('@"', index)) {
      output += '@"';
      index += 2;
      contexts.push({ kind: 'here-double', lineStart: false });
      continue;
    }
    if (char === '`' && index + 1 < command.length) {
      const escapedBinding = bindingAt(command, index + 1, vault);
      if (escapedBinding) {
        bindings.set(escapedBinding.token, escapedBinding);
        output += `\${${escapedBinding.variable}}`;
        index += escapedBinding.token.length + 1;
      } else {
        output += char + command[index + 1];
        index += 2;
      }
      continue;
    }
    if (char === "'") {
      const rewritten = rewritePowerShellSingleString(
        command,
        index,
        vault,
        bindings,
      );
      if (!rewritten.ok) return powerShellFailure(rewritten.reason);
      if (frame.subexpression && rewritten.containsCloseParen) {
        return powerShellFailure(
          'PowerShell quoted ) inside $() is not safely rewritable',
        );
      }
      output += rewritten.text;
      index = rewritten.end;
      continue;
    }
    if (char === '"') {
      output += char;
      index += 1;
      contexts.push({ kind: 'double' });
      continue;
    }
    if (char === '$' && command[index + 1] === '(') {
      output += '$(';
      index += 2;
      contexts.push({
        kind: 'code',
        comment: null,
        subexpression: true,
        parenDepth: 0,
      });
      continue;
    }
    if (frame.subexpression && char === '(') {
      frame.parenDepth += 1;
      output += char;
      index += 1;
      continue;
    }
    if (frame.subexpression && char === ')') {
      output += char;
      index += 1;
      if (frame.parenDepth > 0) frame.parenDepth -= 1;
      else contexts.pop();
      continue;
    }
    output += char;
    index += 1;
  }

  const frame = current();
  if (frame.kind === 'double')
    return powerShellFailure('PowerShell double-quoted string is unterminated');
  if (frame.kind === 'here-double')
    return powerShellFailure('PowerShell here-string is unterminated');
  if (frame.kind === 'code' && frame.comment === 'block')
    return powerShellFailure('PowerShell block comment is unterminated');
  if (contexts.length > 1)
    return powerShellFailure('PowerShell $() subexpression is unterminated');
  return { ok: true, command: output, bindings: [...bindings.values()] };
}

export function prepareBashLateBinding({
  command,
  vault,
  sessionId,
  toolUseId,
  home = zerohHome(),
}) {
  const rewritten = rewriteBashCommand(command, vault);
  if (!rewritten.ok || rewritten.bindings.length === 0) return rewritten;

  const file = valuesFilePath({ sessionId, toolUseId, home });
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const contents = rewritten.bindings
    .map(({ variable, value }) => `${variable}=${singleQuote(value)}`)
    .join('\n');
  writeFileSync(file, `${contents}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);

  const sourceFile = singleQuote(gitBashPath(file));
  // A file that cannot be read says so and the command does not run; a file
  // that cannot be removed (a read-only run directory) does not stop it.
  return {
    ...rewritten,
    file,
    command: `if . ${sourceFile}; then rm -f ${sourceFile} 2>/dev/null; true; else echo '${LOAD_FAILURE_LINE}'; rm -f ${sourceFile} 2>/dev/null; false; fi && {\n${rewritten.command}\n}`,
  };
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
  const contents = rewritten.bindings
    .map(
      ({ variable, value }) =>
        `${variable}=${Buffer.from(String(value), 'utf8').toString('base64')}`,
    )
    .join('\n');
  writeFileSync(file, `${contents}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);

  const quotedFile = powerShellSingleQuote(file);
  // A failed load throws a message the model can relay (the exit wrapper
  // prints it); a failed removal does not stop the command.
  return {
    ...rewritten,
    file,
    command: [
      `try { $zhLines = [IO.File]::ReadAllLines(${quotedFile}) } catch { throw "${LOAD_FAILURE_TEXT}: $($_.Exception.Message)" }`,
      `Remove-Item -LiteralPath ${quotedFile} -Force -ErrorAction SilentlyContinue`,
      "foreach ($zhLine in $zhLines) { if ($zhLine) { $zhName, $zhB64 = $zhLine -split '=', 2; Set-Variable -Name $zhName -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($zhB64))) } }",
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
