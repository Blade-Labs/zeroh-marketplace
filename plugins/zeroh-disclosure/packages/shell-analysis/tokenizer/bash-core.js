// SPDX-License-Identifier: AGPL-3.0-only

import { parseSequence } from './bash-sequence.js';

export const WORD_END = new Set([
  ' ',
  '\t',
  '\n',
  ';',
  '&',
  '|',
  '(',
  ')',
  '<',
  '>',
]);
export const MAX_DEPTH = 24;

export class ShellParseError extends Error {}

export function parseFail(reason) {
  throw new ShellParseError(reason);
}

export const ANSI_ESCAPES = Object.freeze({
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
});

// `$'…'` from the character after the opening quote. A NUL ends the string's
// value, as in Bash.
export function readAnsiC(src, start) {
  let out = '';
  let cut = false;
  const add = (text) => {
    if (cut) return;
    const nul = text.indexOf('\0');
    if (nul >= 0) {
      out += text.slice(0, nul);
      cut = true;
    } else out += text;
  };
  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === "'") return { value: out, end: i + 1 };
    if (c !== '\\' || i + 1 >= src.length) {
      add(c);
      i += 1;
      continue;
    }
    const n = src[i + 1];
    if (Object.hasOwn(ANSI_ESCAPES, n)) {
      add(ANSI_ESCAPES[n]);
      i += 2;
    } else if (/[0-7]/u.test(n)) {
      const digits = /^[0-7]{1,3}/u.exec(src.slice(i + 1))[0];
      add(String.fromCharCode(Number.parseInt(digits, 8) & 0xff));
      i += 1 + digits.length;
    } else if (n === 'x') {
      const digits = /^[0-9a-fA-F]{1,2}/u.exec(src.slice(i + 2));
      if (digits) {
        add(String.fromCharCode(Number.parseInt(digits[0], 16)));
        i += 2 + digits[0].length;
      } else {
        add('\\x');
        i += 2;
      }
    } else if (n === 'u' || n === 'U') {
      const digits = (
        n === 'u' ? /^[0-9a-fA-F]{1,4}/u : /^[0-9a-fA-F]{1,8}/u
      ).exec(src.slice(i + 2));
      if (digits) {
        const code = Number.parseInt(digits[0], 16);
        add(code <= 0x10ffff ? String.fromCodePoint(code) : '');
        i += 2 + digits[0].length;
      } else {
        add(`\\${n}`);
        i += 2;
      }
    } else if (n === 'c' && i + 2 < src.length) {
      add(String.fromCharCode(src.charCodeAt(i + 2) & 0x1f));
      i += 3;
    } else {
      add(`\\${n}`);
      i += 2;
    }
  }
  return parseFail("unterminated $'…' string");
}

export function newWord() {
  return {
    value: '',
    raw: '',
    start: 0,
    end: 0,
    quoted: false,
    dynamic: false,
    dynamicAt: -1,
    glob: false,
    tilde: false,
    brace: false,
    subs: [],
    // Where each character of the word's source came from, as
    // { kind, start, end } source ranges: 'literal' (a character of the
    // value as written, quoted or not), 'syntax' (a quote or a line
    // continuation: not part of the value), 'reference' (a plain parameter
    // expansion the shell performs: `$NAME`, `${NAME}`, `$1`; in PowerShell
    // `$NAME`, `$env:NAME`, `${NAME}`, `${env:NAME}`) or 'expansion' (any
    // other expansion: a default, a command substitution, arithmetic).
    // Read by packages/shell-analysis/shell-references.js.
    parts: [],
  };
}

export function addPart(word, kind, start, end) {
  if (end <= start) return;
  const last = word.parts.at(-1);
  if (last && last.kind === kind && last.end === start && kind !== 'reference')
    last.end = end;
  else word.parts.push({ kind, start, end });
}

// A plain Bash parameter expansion: the value of a variable or a positional
// parameter, with nothing of its own (no default, no operator).
export const BASH_REFERENCE =
  /^\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]|\{[A-Za-z_][A-Za-z0-9_]*\}|\{[0-9]+\})$/u;
export function bashExpansionKind(text) {
  return BASH_REFERENCE.test(text) ? 'reference' : 'expansion';
}

export function markDynamic(word) {
  if (!word.dynamic) {
    word.dynamic = true;
    word.dynamicAt = word.value.length;
  }
}

// The index after the `)` that closes `(` at `open`, skipping quotes.
export function closingParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') i += 1;
    else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// `$…` at `i` (src[i] === '$'): the expansion's source text and end, with
// the commands of a command substitution, or null for a literal `$`.
export function readDollar(src, i, ctx, subs) {
  const n = src[i + 1];
  if (n === '(' && src[i + 2] === '(') {
    const end = closingParen(src, i + 1);
    if (end < 0) parseFail('unterminated $((…))');
    return { text: src.slice(i, end), end };
  }
  if (n === '(') {
    const inner = parseSequence(src, i + 2, ')', ctx.depth + 1, 'substitution');
    subs.push(...inner.commands);
    return { text: src.slice(i, inner.end), end: inner.end };
  }
  if (n === '{') {
    let depth = 1;
    let j = i + 2;
    const scratch = newWord();
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '\\') j += 2;
      else if (c === "'") {
        const end = src.indexOf("'", j + 1);
        if (end < 0) parseFail('unterminated quote in ${…}');
        j = end + 1;
      } else if (c === '"') {
        j = readDouble(src, j + 1, scratch, ctx);
      } else if (c === '$') {
        const inner = readDollar(src, j, ctx, subs);
        j = inner ? inner.end : j + 1;
      } else if (c === '`') {
        j = readBacktick(src, j, ctx, subs).end;
      } else {
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        j += 1;
      }
    }
    if (depth > 0) parseFail('unterminated ${…}');
    subs.push(...scratch.subs);
    return { text: src.slice(i, j), end: j };
  }
  if (n !== undefined && /[A-Za-z_]/u.test(n)) {
    const name = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(src.slice(i + 1))[0];
    return { text: `$${name}`, end: i + 1 + name.length };
  }
  if (n !== undefined && /[0-9@*#?$!-]/u.test(n)) {
    return { text: src.slice(i, i + 2), end: i + 2 };
  }
  return null;
}

// A backtick substitution at `i`: its body is parsed as commands.
export function readBacktick(src, i, ctx, subs) {
  let body = '';
  let j = i + 1;
  while (j < src.length && src[j] !== '`') {
    if (src[j] === '\\' && /[`$\\]/u.test(src[j + 1] ?? '')) {
      body += src[j + 1];
      j += 2;
    } else {
      body += src[j];
      j += 1;
    }
  }
  if (j >= src.length) parseFail('unterminated backtick substitution');
  subs.push(
    ...parseSequence(body, 0, null, ctx.depth + 1, 'substitution').commands,
  );
  return { text: src.slice(i, j + 1), end: j + 1 };
}

// The inside of "…" from `i` (after the opening quote) into `word`; returns
// the index after the closing quote.
export function readDouble(src, i, word, ctx) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"') return j + 1;
    if (c === '\\') {
      const n = src[j + 1];
      if (n === '\n') {
        addPart(word, 'syntax', j, j + 2);
        j += 2;
      } else if (n !== undefined && /[$`"\\]/u.test(n)) {
        word.value += n;
        addPart(word, 'literal', j, j + 2);
        j += 2;
      } else {
        word.value += '\\';
        addPart(word, 'literal', j, j + 1);
        j += 1;
      }
      continue;
    }
    if (c === '$') {
      const expansion = readDollar(src, j, ctx, word.subs);
      if (expansion) {
        markDynamic(word);
        word.value += expansion.text;
        addPart(word, bashExpansionKind(expansion.text), j, expansion.end);
        j = expansion.end;
        continue;
      }
    }
    if (c === '`') {
      const sub = readBacktick(src, j, ctx, word.subs);
      markDynamic(word);
      word.value += sub.text;
      addPart(word, 'expansion', j, sub.end);
      j = sub.end;
      continue;
    }
    word.value += c;
    addPart(word, 'literal', j, j + 1);
    j += 1;
  }
  return parseFail('unterminated double quote');
}

// True when an unquoted `{` at `i` starts a brace expansion (`{a,b}`, `{1..3}`).
export function braceExpansionAt(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    const c = src[j];
    if (WORD_END.has(c) || c === '"' || c === "'" || c === '\\') return false;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        const inner = src.slice(i + 1, j);
        return /,|\.\./u.test(inner);
      }
    }
  }
  return false;
}

// One word from `i`. Stops at an unquoted blank or operator character.
export function readWord(src, i, ctx) {
  const word = newWord();
  word.start = i;
  if (src[i] === '~') word.tilde = true;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (WORD_END.has(c)) break;
    if (c === '\\') {
      if (j + 1 >= src.length) {
        word.value += '\\';
        addPart(word, 'literal', j, j + 1);
        j += 1;
      } else if (src[j + 1] === '\n') {
        addPart(word, 'syntax', j, j + 2);
        j += 2;
      } else {
        word.quoted = true;
        word.value += src[j + 1];
        addPart(word, 'literal', j, j + 2);
        j += 2;
      }
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", j + 1);
      if (end < 0) parseFail('unterminated single quote');
      word.quoted = true;
      word.value += src.slice(j + 1, end);
      addPart(word, 'syntax', j, j + 1);
      addPart(word, 'literal', j + 1, end);
      addPart(word, 'syntax', end, end + 1);
      j = end + 1;
      continue;
    }
    if (c === '"') {
      word.quoted = true;
      addPart(word, 'syntax', j, j + 1);
      j = readDouble(src, j + 1, word, ctx);
      addPart(word, 'syntax', j - 1, j);
      continue;
    }
    if (c === '$') {
      if (src[j + 1] === "'") {
        const ansi = readAnsiC(src, j + 2);
        word.quoted = true;
        word.value += ansi.value;
        addPart(word, 'literal', j, ansi.end);
        j = ansi.end;
        continue;
      }
      if (src[j + 1] === '"') {
        word.quoted = true;
        addPart(word, 'syntax', j, j + 2);
        j = readDouble(src, j + 2, word, ctx);
        addPart(word, 'syntax', j - 1, j);
        continue;
      }
      const expansion = readDollar(src, j, ctx, word.subs);
      if (expansion) {
        markDynamic(word);
        word.value += expansion.text;
        addPart(word, bashExpansionKind(expansion.text), j, expansion.end);
        j = expansion.end;
        continue;
      }
    }
    if (c === '`') {
      const sub = readBacktick(src, j, ctx, word.subs);
      markDynamic(word);
      word.value += sub.text;
      addPart(word, 'expansion', j, sub.end);
      j = sub.end;
      continue;
    }
    if (c === '*' || c === '?' || c === '[') word.glob = true;
    if (c === '{' && braceExpansionAt(src, j)) word.brace = true;
    word.value += c;
    addPart(word, 'literal', j, j + 1);
    j += 1;
  }
  word.end = j;
  word.raw = src.slice(i, j);
  return word;
}
