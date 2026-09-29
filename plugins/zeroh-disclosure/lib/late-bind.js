// SPDX-License-Identifier: AGPL-3.0-only

// Late binding keeps restored shell values out of Claude Code's saved hook
// output. The command sources a private, short-lived values file instead.
import {
  commentStarts,
  readHeredocWord,
  stopParsingRanges,
} from './shell-scan.js';
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
import { containsToken } from './token-pattern.js';

const TOKEN_AT = /^\[([A-Z_]+)-([0-9a-f]{6})\]/;
export const RUN_FILE_MAX_AGE_MS = 10 * 60 * 1000;
// At a turn's end (Stop) or the next prompt, a values file of the session
// older than this belongs to a command that was refused, denied or cancelled:
// one that runs loads its file within milliseconds of PreToolUse. The grace
// covers a background agent's command still waiting for its permission.
export const TURN_END_GRACE_MS = 60 * 1000;
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

// A lone backslash the rewrite must escape is written as ${ZH_BACKSLASH},
// which the values file sets to one backslash, so the rewrite never makes a
// new pair of backslashes out of one. Claude Code starts Git Bash on Windows
// as `bash -c -l "<command>"`, and Git Bash reads a pair of backslashes inside
// that quoted argument as one: a quoted heredoc's `before\` at a line end,
// escaped as `before\\`, arrived as `before\` and joined the next line; a
// `"\[TOKEN]"`, written `"\\${ZH_…}"`, printed the variable's name.
const BACKSLASH_VARIABLE = 'ZH_BACKSLASH';
const BACKSLASH = `\${${BACKSLASH_VARIABLE}}`;

function replaceHeredocLine(line, vault, bindings, quoted, uses) {
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
const BARE_SAFE_VALUE = /^[^\s*?[\]()]+$/u;

function bashReplacement(binding, quote, { bareWhenPlain = false } = {}) {
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
export function rewriteBashCommand(command, vault, options = {}) {
  const bindings = new Map();
  const uses = { backslash: false };
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
        uses,
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
      output += bashReplacement(binding, state, options);
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
          uses.backslash = true;
          output += `${BACKSLASH}\${${escapedBinding.variable}}`;
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
  return {
    ok: true,
    command: output,
    bindings: [...bindings.values()],
    ...(uses.backslash ? { backslash: true } : {}),
  };
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

// '<token>' or "<token>" standing alone as an argument or a value: between
// whitespace, the start or end, or ( ) , ; | = { }.
function powerShellWholeTokenString(command, start, vault) {
  const quote = command[start];
  const binding = bindingAt(command, start + 1, vault);
  if (!binding) return null;
  const end = start + 1 + binding.token.length;
  if (command[end] !== quote) return null;
  const before = command[start - 1];
  const after = command[end + 1];
  if (before !== undefined && !/[\s(,;|={]/u.test(before)) return null;
  if (after !== undefined && !/[\s),;|}]/u.test(after)) return null;
  return { binding, end: end + 1 };
}

// True when a token ZeroH knows stands where PowerShell's stop-parsing
// token `--%` makes text pass as written (the tokenizer's reading; a `--%`
// in a string or a comment is text): `${ZH_…}` would arrive as those
// characters. A real value is never written into the command text instead;
// the caller's late-binding failure rule applies (pass: runs with the token
// and a notice; block: stopped). A command the tokenizer cannot read is
// judged the same way when a `--%` word is anywhere in it.
function tokenAfterStopParsing(command, vault) {
  const ranges = stopParsingRanges(command);
  if (ranges === null)
    return /(?:^|\s)--%(?:\s|$)/u.test(command) && containsToken(command);
  return ranges.some(([start, end]) => {
    for (
      let i = command.indexOf('[', start);
      i >= 0 && i < end;
      i = command.indexOf('[', i + 1)
    )
      if (bindingAt(command, i, vault)) return true;
    return false;
  });
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
  if (tokenAfterStopParsing(command, vault)) {
    return powerShellFailure(
      'a token after --%: PowerShell passes that text as written, so no variable there is read',
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
    const whole =
      char === "'" || char === '"'
        ? powerShellWholeTokenString(command, index, vault)
        : null;
    if (whole) {
      // A string that is exactly one token becomes the bare variable: an
      // expandable string ("${...}") is one more thing Claude Code's
      // PowerShell check asks about.
      bindings.set(whole.binding.token, whole.binding);
      output += `\${${whole.binding.variable}}`;
      index = whole.end;
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
