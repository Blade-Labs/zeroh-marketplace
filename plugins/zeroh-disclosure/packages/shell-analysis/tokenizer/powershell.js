// SPDX-License-Identifier: AGPL-3.0-only

import { analyzeBash } from '../scan.js';
import {
  ShellParseError,
  addPart,
  markDynamic,
  newWord,
  parseFail,
} from './bash-core.js';
import { newCommand } from './bash-sequence.js';
import { inlineCode, programName, unwrapCommand } from './cmd.js';

const PS_VARIABLE =
  '\\$(?:(?:env:)?[A-Za-z_][A-Za-z0-9_]*|\\{(?:env:)?[A-Za-z_][A-Za-z0-9_]*\\})';
const PS_REFERENCE = new RegExp(
  `^(?:${PS_VARIABLE}|\\$\\([ \\t]*${PS_VARIABLE}[ \\t]*\\))$`,
  'iu',
);
function psExpansionKind(text) {
  return PS_REFERENCE.test(text) ? 'reference' : 'expansion';
}

function psReadString(src, i, quote, word) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (quote === "'") {
      if (c === "'" || c === '\u2019' || c === '\u2018') {
        if (src[j + 1] === "'") {
          word.value += "'";
          addPart(word, 'literal', j, j + 2);
          j += 2;
          continue;
        }
        addPart(word, 'syntax', j, j + 1);
        return j + 1;
      }
      word.value += c;
      addPart(word, 'literal', j, j + 1);
      j += 1;
      continue;
    }
    if (c === '"' || c === '\u201c' || c === '\u201d') {
      if (src[j + 1] === '"') {
        word.value += '"';
        addPart(word, 'literal', j, j + 2);
        j += 2;
        continue;
      }
      addPart(word, 'syntax', j, j + 1);
      return j + 1;
    }
    if (c === '`') {
      const n = src[j + 1];
      const map = {
        n: '\n',
        t: '\t',
        r: '\r',
        0: '\0',
        a: '\x07',
        b: '\b',
        f: '\f',
        v: '\v',
        e: '\x1b',
      };
      word.value += Object.hasOwn(map, n) ? map[n] : (n ?? '');
      addPart(word, 'literal', j, j + 2);
      j += 2;
      continue;
    }
    if (c === '$' && /[A-Za-z_{(:?$^]/u.test(src[j + 1] ?? '')) {
      markDynamic(word);
      if (src[j + 1] === '(') {
        const inner = psGroup(src, j + 1, word);
        word.value += src.slice(j, inner);
        addPart(word, psExpansionKind(src.slice(j, inner)), j, inner);
        j = inner;
        continue;
      }
      if (src[j + 1] === '{') {
        const close = src.indexOf('}', j + 2);
        if (close < 0) parseFail('unterminated ${…}');
        word.value += src.slice(j, close + 1);
        addPart(word, psExpansionKind(src.slice(j, close + 1)), j, close + 1);
        j = close + 1;
        continue;
      }
      const name =
        /^\$[A-Za-z_?$^][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?/u.exec(
          src.slice(j),
        );
      word.value += name ? name[0] : '$';
      addPart(
        word,
        name ? psExpansionKind(name[0]) : 'literal',
        j,
        j + (name ? name[0].length : 1),
      );
      j += name ? name[0].length : 1;
      continue;
    }
    word.value += c;
    addPart(word, 'literal', j, j + 1);
    j += 1;
  }
  return parseFail(`unterminated ${quote} string`);
}

const PS_OPEN = { '(': ')', '{': '}' };

// A bracketed group at `i` (`(`, `{`): its inside is parsed as commands and
// added to `word.subs`; returns the index after the closing bracket.
function psGroup(src, i, word) {
  const open = src[i];
  const close = PS_OPEN[open];
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === "'" || c === '"') {
      const string = newWord();
      j = psReadString(src, j + 1, c, string);
      word.subs.push(...string.subs);
      continue;
    }
    if (c === '`') {
      j += 2;
      continue;
    }
    if (c === '(' || c === '{') depth += 1;
    else if (c === ')' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        if (c !== close) parseFail('mismatched brackets');
        const body = src.slice(i + 1, j);
        if (open === '{' && src[i - 1] === '@') {
          // A hashtable literal: its values are data, and only the groups
          // inside them (`$(…)`, `(…)`) run commands.
          psSubgroups(body, word);
        } else {
          word.subs.push(...psParse(body));
        }
        return j + 1;
      }
    }
    j += 1;
  }
  return parseFail(`unterminated ${open}`);
}

// The commands in the groups of a hashtable literal's body.
function psSubgroups(body, word) {
  for (let j = 0; j < body.length;) {
    const c = body[j];
    if (c === "'" || c === '"') {
      const string = newWord();
      j = psReadString(body, j + 1, c, string);
      word.subs.push(...string.subs);
    } else if (c === '`') j += 2;
    else if (c === '(' || c === '{') j = psGroup(body, j, word);
    else j += 1;
  }
}

const PS_WORD_END = new Set([' ', '\t', '\r', '\n', ';', '|']);

function psParse(src) {
  const commands = [];
  let command = newCommand('powershell', 0);
  let piped = false;
  const finish = () => {
    if (command.words.length || command.redirects.length) {
      command.piped = piped;
      commands.push(command);
    }
    command = newCommand('powershell', 0);
    piped = false;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '`' && (src[i + 1] === '\n' || src[i + 1] === '\r')) {
      i += src[i + 1] === '\r' && src[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (c === '\n' || c === ';') {
      finish();
      i += 1;
      continue;
    }
    if (c === '|' || c === '&') {
      if (src[i + 1] === c) {
        finish();
        i += 2;
        continue;
      }
      if (c === '|') {
        finish();
        piped = true;
        i += 1;
        continue;
      }
    }
    if (c === '<' && src[i + 1] === '#') {
      const end = src.indexOf('#>', i + 2);
      if (end < 0) parseFail('unterminated block comment');
      i = end + 2;
      continue;
    }
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    // Redirections: `>`, `>>`, `2>`, `2>&1`, `*>`, `<`.
    const redirect = /^(?:[1-6*]?>>?(?:&[12])?|<)/u.exec(src.slice(i));
    if (
      redirect &&
      (i === 0 || /[\s;|]/u.test(src[i - 1]) || /^[1-6*]/u.test(redirect[0]))
    ) {
      const op = redirect[0];
      let j = i + op.length;
      if (/&[12]$/u.test(op)) {
        command.redirects.push({ op, fd: null, target: null, heredoc: null });
        i = j;
        continue;
      }
      while (src[j] === ' ' || src[j] === '\t') j += 1;
      const target = psWord(src, j);
      command.redirects.push({
        op,
        fd: null,
        target: target.word,
        heredoc: null,
      });
      commands.push(...target.word.subs);
      i = target.end;
      continue;
    }
    if (
      !command.words.length &&
      (c === '&' || c === '.') &&
      /[\s'"$]/u.test(src[i + 1] ?? '')
    ) {
      // The call and dot-source operators: the next word is the program.
      i += 1;
      continue;
    }
    const { word, end } = psWord(src, i);
    if (word.raw === '--%' && command.words.length) {
      // The stop-parsing token: the rest of the line, up to a newline or a
      // `|`, goes to the program as written, with no expansion, no quote
      // removal by PowerShell and no escapes (a `%NAME%` is expanded by
      // Windows, not PowerShell, and is dynamic here). Every character of
      // it is literal: nothing after `--%` is a pure reference.
      const stop = stopParsingWords(src, end);
      command.words.push(...stop.words);
      i = stop.end;
      continue;
    }
    commands.push(...word.subs);
    command.words.push(word);
    i = end;
  }
  finish();
  return commands;
}

// The words after PowerShell's `--%`: split on blanks, `"…"` kept together
// with its quotes removed from the value (the program's own argument
// parser removes them on Windows), every character a literal part.
function stopParsingWords(src, i) {
  const words = [];
  let j = i;
  while (j < src.length && src[j] !== '\n' && src[j] !== '|') {
    if (src[j] === ' ' || src[j] === '\t' || src[j] === '\r') {
      j += 1;
      continue;
    }
    const word = newWord();
    word.start = j;
    let quoted = false;
    while (j < src.length && src[j] !== '\n' && src[j] !== '|') {
      const c = src[j];
      if (!quoted && (c === ' ' || c === '\t' || c === '\r')) break;
      if (c === '"') {
        quoted = !quoted;
        word.quoted = true;
      } else {
        if (c === '%' && /^%[A-Za-z_][A-Za-z0-9_]*%/u.test(src.slice(j)))
          markDynamic(word);
        word.value += c;
      }
      j += 1;
    }
    addPart(word, 'literal', word.start, j);
    word.end = j;
    word.raw = src.slice(word.start, j);
    word.stopParsed = true;
    words.push(word);
  }
  return { words, end: j };
}

function psWord(src, i) {
  const word = newWord();
  word.start = i;
  let j = i;
  if (src.startsWith("@'", j) || src.startsWith('@"', j)) {
    const quote = src[j + 1];
    if (!/^[ \t]*\r?\n/u.test(src.slice(j + 2))) parseFail('bad here-string');
    const closeRe = quote === "'" ? /\r?\n'@/u : /\r?\n"@/u;
    const rest = src.slice(j + 2);
    const close = closeRe.exec(rest);
    if (!close) parseFail('unterminated here-string');
    const body = rest.slice(rest.indexOf('\n') + 1, close.index);
    word.value = body;
    word.quoted = true;
    if (quote === '"' && /\$[A-Za-z_{(]/u.test(body)) {
      markDynamic(word);
      word.dynamicAt = body.search(/\$[A-Za-z_{(]/u);
      if (/\$\(/u.test(body)) parseFail('subexpression in a here-string');
    }
    j += 2 + close.index + close[0].length;
    addPart(word, 'literal', i, j);
    word.end = j;
    word.raw = src.slice(i, j);
    return { word, end: j };
  }
  while (j < src.length) {
    const c = src[j];
    if (PS_WORD_END.has(c)) break;
    if (c === '&' && src[j + 1] === '&') break;
    if (
      c === "'" ||
      c === '"' ||
      c === '\u2018' ||
      c === '\u2019' ||
      c === '\u201c' ||
      c === '\u201d'
    ) {
      word.quoted = true;
      const quote = c === '"' || c === '\u201c' || c === '\u201d' ? '"' : "'";
      addPart(word, 'syntax', j, j + 1);
      j = psReadString(src, j + 1, quote, word);
      continue;
    }
    if (c === '`') {
      word.quoted = true;
      if (j + 1 < src.length) word.value += src[j + 1];
      addPart(word, 'literal', j, Math.min(j + 2, src.length));
      j += 2;
      continue;
    }
    if (c === '$' || c === '@') {
      const n = src[j + 1];
      if (n === '(' || n === '{') {
        if (c === '$' && n === '{') {
          const close = src.indexOf('}', j + 2);
          if (close < 0) parseFail('unterminated ${…}');
          markDynamic(word);
          word.value += src.slice(j, close + 1);
          addPart(word, psExpansionKind(src.slice(j, close + 1)), j, close + 1);
          j = close + 1;
          continue;
        }
        markDynamic(word);
        const end = psGroup(src, j + 1, word);
        word.value += src.slice(j, end);
        addPart(
          word,
          c === '$' ? psExpansionKind(src.slice(j, end)) : 'expansion',
          j,
          end,
        );
        j = end;
        continue;
      }
      if (c === '$' && n !== undefined && /[A-Za-z_?$^]/u.test(n)) {
        markDynamic(word);
        const name =
          /^\$[A-Za-z_?$^][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?/u.exec(
            src.slice(j),
          );
        word.value += name[0];
        addPart(word, psExpansionKind(name[0]), j, j + name[0].length);
        j += name[0].length;
        continue;
      }
    }
    if (c === '(' || c === '{') {
      markDynamic(word);
      const end = psGroup(src, j, word);
      word.value += src.slice(j, end);
      addPart(word, 'expansion', j, end);
      j = end;
      continue;
    }
    if (c === ')' || c === '}') parseFail(`unexpected ${c}`);
    word.value += c;
    addPart(word, 'literal', j, j + 1);
    j += 1;
  }
  word.end = j;
  word.raw = src.slice(i, j);
  return { word, end: j };
}

// { ok, reason, commands } like analyzeBash, for a PowerShell command line.
// Commands carry program (lower case, `.exe` removed), args and
// dynamicProgram; there are no launchers to unwrap.
export function parsePowerShell(source, { depth = 0 } = {}) {
  try {
    const commands = [];
    let ok = true;
    let reason = null;
    for (const command of psParse(String(source ?? ''))) {
      // External launchers exist for PowerShell on Unix too (`sudo bash -c …`).
      const resolved = {
        ...command,
        ...unwrapCommand(command.words),
        inline: false,
        foreignCode: false,
        dynamicCode: false,
      };
      commands.push(resolved);
      // Code handed to an interpreter as text: iex, pwsh -Command, cmd /c.
      const scripts = inlineCode(resolved, command);
      resolved.scripts = scripts;
      resolved.inlineParsed = scripts.some(
        (script) => script.language !== 'foreign' && !script.dynamic,
      );
      for (const script of scripts) {
        if (script.language === 'foreign') {
          resolved.foreignCode = true;
          continue;
        }
        if (script.dynamic) resolved.dynamicCode = true;
        if (script.language === 'argv' || depth >= 4) continue;
        const inner =
          script.language === 'powershell'
            ? parsePowerShell(script.code, { depth: depth + 1 })
            : analyzeBash(script.code, { depth: depth + 1 });
        if (!inner.ok) {
          ok = false;
          reason = `inline ${script.language} code: ${inner.reason}`;
        }
        for (const entry of inner.commands)
          commands.push({ ...entry, inline: true });
      }
    }
    return { ok, reason, commands };
  } catch (error) {
    if (error instanceof ShellParseError)
      return { ok: false, reason: error.message, commands: [] };
    throw error;
  }
}

// The source ranges PowerShell passes as written after a stop-parsing
// token `--%` (a `--%` inside a string or a comment is text, not one), as
// [start, end) pairs; null when the command cannot be parsed.
export function stopParsingRanges(source) {
  const text = String(source ?? '');
  let commands;
  try {
    commands = psParse(text);
  } catch (error) {
    if (error instanceof ShellParseError) return null;
    throw error;
  }
  return commands
    .flatMap((command) => command.words)
    .filter(
      (word) =>
        word.stopParsed && text.slice(word.start, word.end) === word.raw,
    )
    .map((word) => [word.start, word.end]);
}

// analyzeBash or parsePowerShell, by shell name.
