// SPDX-License-Identifier: AGPL-3.0-only

// Shell scanning shared by every guard: where a comment starts and what a
// heredoc's delimiter is (the exit-status wrapper and late binding used to
// disagree on `<<"EO\"F"`), and the one Bash tokenizer (parseBash,
// analyzeBash) and conservative PowerShell parser (parsePowerShell) that the
// settings guard and the destination check read commands with (rc.2). No
// imports.

// Whether a `#` at `index` starts a comment (at a word start).
export function commentStarts(command, index) {
  if (command[index] !== '#') return false;
  if (index === 0) return true;
  return /[\s;&|()<>]/u.test(command[index - 1]);
}

// Reads the heredoc word after `<<` at `start` as Bash does: `<<-` strips
// tabs, quotes and backslashes are removed (inside double quotes a backslash
// escapes the next character) and make the body literal. Returns
// { delimiter, quoted, stripTabs, wordStart, end }, { error } for an
// unterminated quote, or null when there is no heredoc here.
export function readHeredocWord(command, start) {
  if (!command.startsWith('<<', start) || command[start + 2] === '<') {
    return null;
  }
  let index = start + 2;
  let stripTabs = false;
  if (command[index] === '-') {
    stripTabs = true;
    index += 1;
  }
  while (command[index] === ' ' || command[index] === '\t') index += 1;
  const wordStart = index;
  let delimiter = '';
  let quoted = false;
  while (index < command.length) {
    const char = command[index];
    if (/\s|[;&|<>()]/u.test(char)) break;
    if (char === "'" || char === '"') {
      quoted = true;
      index += 1;
      while (index < command.length && command[index] !== char) {
        if (
          char === '"' &&
          command[index] === '\\' &&
          index + 1 < command.length
        ) {
          index += 1;
        }
        delimiter += command[index];
        index += 1;
      }
      if (command[index] !== char) {
        return { error: 'heredoc delimiter has an unterminated quote' };
      }
      index += 1;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      quoted = true;
      delimiter += command[index + 1];
      index += 2;
      continue;
    }
    delimiter += char;
    index += 1;
  }
  if (index === wordStart || !delimiter) return null;
  return { delimiter, quoted, stripTabs, wordStart, end: index };
}

// ---------------------------------------------------------------------------
// The Bash tokenizer (rc.2, Astra R1/R2).
//
// parseBash(source) reads a command line the way Bash does before it runs it:
// quote removal and concatenation (`--p"re"`, `--p\re`, `$'--pre'` and
// `"--"pre` are all the one word `--pre`), backslash escapes and line
// continuations, `$'…'` (ANSI-C) and `$"…"`, heredocs (their bodies are kept,
// and command substitutions in an unquoted body are commands too), operators,
// subshells, `$(…)`, backticks, `<(…)` and redirections. It returns every
// simple command, nested ones included, as a flat list, or { ok: false } for
// anything it cannot read. What a word expands to at run time (`$VAR`, `$(…)`,
// `~`, globs, braces) is not known here: such a word keeps its source text and
// says so (dynamic, dynamicAt, tilde, glob, brace), and the command inside a
// substitution is listed like any other.
//
// analyzeBash(source) adds what each command runs: launchers are unwrapped
// (`env -i A=1`, `timeout 5`, `nohup`, `sudo -u x`, `doas`, `command`,
// `builtin`, `exec -a x`, `nice -n 5`, `ionice`, `stdbuf -o0`, `time -p`,
// `setsid`, `xargs -0`), the program is named by its basename (`/usr/bin/curl`,
// `curl.exe` and `CURL` are `curl`), and code handed to an interpreter as text
// (`bash -c '…'`, `sh -s <<EOF`, `eval …`, `env -S '…'`, `find -exec …`,
// `watch …`, `script -c …`, `su -c …`) is parsed and listed too.
//
// Callers treat whatever this cannot vouch for as unsafe: a guard that needs
// certainty denies an unparseable command.

const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>']);
const MAX_DEPTH = 24;

class ShellParseError extends Error {}

function parseFail(reason) {
  throw new ShellParseError(reason);
}

const ANSI_ESCAPES = Object.freeze({
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
function readAnsiC(src, start) {
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

function newWord() {
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
  };
}

function markDynamic(word) {
  if (!word.dynamic) {
    word.dynamic = true;
    word.dynamicAt = word.value.length;
  }
}

// The index after the `)` that closes `(` at `open`, skipping quotes.
function closingParen(src, open) {
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
function readDollar(src, i, ctx, subs) {
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
function readBacktick(src, i, ctx, subs) {
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
function readDouble(src, i, word, ctx) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"') return j + 1;
    if (c === '\\') {
      const n = src[j + 1];
      if (n === '\n') {
        j += 2;
      } else if (n !== undefined && /[$`"\\]/u.test(n)) {
        word.value += n;
        j += 2;
      } else {
        word.value += '\\';
        j += 1;
      }
      continue;
    }
    if (c === '$') {
      const expansion = readDollar(src, j, ctx, word.subs);
      if (expansion) {
        markDynamic(word);
        word.value += expansion.text;
        j = expansion.end;
        continue;
      }
    }
    if (c === '`') {
      const sub = readBacktick(src, j, ctx, word.subs);
      markDynamic(word);
      word.value += sub.text;
      j = sub.end;
      continue;
    }
    word.value += c;
    j += 1;
  }
  return parseFail('unterminated double quote');
}

// True when an unquoted `{` at `i` starts a brace expansion (`{a,b}`, `{1..3}`).
function braceExpansionAt(src, i) {
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
function readWord(src, i, ctx) {
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
        j += 1;
      } else if (src[j + 1] === '\n') {
        j += 2;
      } else {
        word.quoted = true;
        word.value += src[j + 1];
        j += 2;
      }
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", j + 1);
      if (end < 0) parseFail('unterminated single quote');
      word.quoted = true;
      word.value += src.slice(j + 1, end);
      j = end + 1;
      continue;
    }
    if (c === '"') {
      word.quoted = true;
      j = readDouble(src, j + 1, word, ctx);
      continue;
    }
    if (c === '$') {
      if (src[j + 1] === "'") {
        const ansi = readAnsiC(src, j + 2);
        word.quoted = true;
        word.value += ansi.value;
        j = ansi.end;
        continue;
      }
      if (src[j + 1] === '"') {
        word.quoted = true;
        j = readDouble(src, j + 2, word, ctx);
        continue;
      }
      const expansion = readDollar(src, j, ctx, word.subs);
      if (expansion) {
        markDynamic(word);
        word.value += expansion.text;
        j = expansion.end;
        continue;
      }
    }
    if (c === '`') {
      const sub = readBacktick(src, j, ctx, word.subs);
      markDynamic(word);
      word.value += sub.text;
      j = sub.end;
      continue;
    }
    if (c === '*' || c === '?' || c === '[') word.glob = true;
    if (c === '{' && braceExpansionAt(src, j)) word.brace = true;
    word.value += c;
    j += 1;
  }
  word.end = j;
  word.raw = src.slice(i, j);
  return word;
}

const REDIRECT_OPS = [
  '<<<',
  '<<-',
  '&>>',
  '<<',
  '>>',
  '<&',
  '>&',
  '<>',
  '>|',
  '&>',
  '<',
  '>',
];
const RESERVED_SKIP = new Set([
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  '!',
  '{',
  'time',
  'fi',
  'done',
  'esac',
  '}',
  'coproc',
]);
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/u;

function newCommand(origin, depth) {
  return {
    words: [],
    assignments: [],
    redirects: [],
    origin,
    depth,
    piped: false,
    background: false,
  };
}

function skipBlanks(src, i) {
  let j = i;
  while (src[j] === ' ' || src[j] === '\t') j += 1;
  return j;
}

// Commands in an unquoted heredoc body: its substitutions run.
function heredocSubstitutions(body, ctx, subs) {
  for (let j = 0; j < body.length;) {
    const c = body[j];
    if (c === '\\') j += 2;
    else if (c === '$') {
      const expansion = readDollar(body, j, ctx, subs);
      j = expansion ? expansion.end : j + 1;
    } else if (c === '`') j = readBacktick(body, j, ctx, subs).end;
    else j += 1;
  }
}

// Parses commands from `start` until `terminator` (`)`) or the end.
function parseSequence(src, start, terminator, depth, origin) {
  if (depth > MAX_DEPTH) parseFail('nesting too deep');
  const ctx = { depth };
  const commands = [];
  let pending = [];
  let command = newCommand(origin, depth);
  let piped = false;
  const finish = ({ background = false } = {}) => {
    if (
      command.words.length ||
      command.assignments.length ||
      command.redirects.length
    ) {
      command.piped = piped;
      command.background = background;
      commands.push(command);
    }
    command = newCommand(origin, depth);
    piped = false;
  };
  const readBodies = (from) => {
    let i = from;
    for (const heredoc of pending) {
      let body = '';
      for (;;) {
        if (i >= src.length) break;
        const newline = src.indexOf('\n', i);
        const line = src.slice(i, newline < 0 ? src.length : newline);
        i = newline < 0 ? src.length : newline + 1;
        const compared = heredoc.stripTabs ? line.replace(/^\t+/u, '') : line;
        if (compared === heredoc.delimiter) break;
        body += `${heredoc.stripTabs ? compared : line}\n`;
      }
      heredoc.redirect.heredoc = { body, quoted: heredoc.quoted };
      if (!heredoc.quoted) {
        const subs = [];
        heredocSubstitutions(body, ctx, subs);
        commands.push(...subs);
      }
    }
    pending = [];
    return i;
  };
  const readRedirect = (i, fd) => {
    const op = REDIRECT_OPS.find((candidate) => src.startsWith(candidate, i));
    if (!op) return parseFail('bad redirection');
    const redirect = { op, fd, target: null, heredoc: null };
    if (op === '<<' || op === '<<-') {
      const heredoc = readHeredocWord(src, i);
      if (!heredoc || heredoc.error)
        parseFail(heredoc?.error || 'missing heredoc delimiter');
      pending.push({ ...heredoc, redirect });
      command.redirects.push(redirect);
      return heredoc.end;
    }
    let j = skipBlanks(src, i + op.length);
    if ((src[j] === '<' || src[j] === '>') && src[j + 1] === '(') {
      const inner = parseSequence(src, j + 2, ')', depth + 1, 'process');
      commands.push(...inner.commands);
      const target = newWord();
      target.value = src.slice(j, inner.end);
      target.raw = target.value;
      markDynamic(target);
      target.dynamicAt = 0;
      redirect.target = target;
      command.redirects.push(redirect);
      return inner.end;
    }
    const target = readWord(src, j, ctx);
    if (!target.raw) parseFail('redirection without a target');
    commands.push(...target.subs);
    redirect.target = target;
    command.redirects.push(redirect);
    return target.end;
  };

  let i = start;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }
    if (c === '\n') {
      finish();
      i = readBodies(i + 1);
      continue;
    }
    if (c === '#' && commentStarts(src, i)) {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === ')') {
      if (terminator !== ')') parseFail('unexpected )');
      finish();
      if (pending.length) parseFail('heredoc inside a substitution');
      return { commands, end: i + 1 };
    }
    if (c === ';') {
      finish();
      if (src[i + 1] === ';') i += src[i + 2] === '&' ? 3 : 2;
      else i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === '&') {
      if (src[i + 1] === '&') {
        finish();
        i += 2;
        continue;
      }
      if (src[i + 1] === '>') {
        i = readRedirect(i, null);
        continue;
      }
      finish({ background: true });
      i += 1;
      continue;
    }
    if (c === '|') {
      const orElse = src[i + 1] === '|';
      finish();
      piped = !orElse;
      i += orElse || src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === '(') {
      if (!command.words.length && !command.assignments.length) {
        if (src[i + 1] === '(') {
          const end = closingParen(src, i);
          if (end < 0) parseFail('unterminated ((…))');
          i = end;
          continue;
        }
        const inner = parseSequence(src, i + 1, ')', depth + 1, 'subshell');
        commands.push(...inner.commands);
        i = inner.end;
        continue;
      }
      if (
        command.words.length === 1 &&
        /^\(\s*\)/u.test(src.slice(i)) &&
        !command.words[0].quoted
      ) {
        // `name () { …; }`: a function definition; its body follows.
        i = src.indexOf(')', i) + 1;
        command = newCommand(origin, depth);
        continue;
      }
      return parseFail('unexpected (');
    }
    if (c === '<' || c === '>') {
      if (src[i + 1] === '(') {
        const inner = parseSequence(src, i + 2, ')', depth + 1, 'process');
        commands.push(...inner.commands);
        const word = newWord();
        word.value = src.slice(i, inner.end);
        word.raw = word.value;
        word.start = i;
        word.end = inner.end;
        markDynamic(word);
        word.dynamicAt = 0;
        command.words.push(word);
        i = inner.end;
        continue;
      }
      i = readRedirect(i, null);
      continue;
    }
    const word = readWord(src, i, ctx);
    const next = src[word.end];
    if (
      (next === '<' || next === '>') &&
      (/^\d+$/u.test(word.raw) ||
        /^\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(word.raw))
    ) {
      i = readRedirect(word.end, word.raw);
      continue;
    }
    commands.push(...word.subs);
    const first = !command.words.length;
    if (first && ASSIGNMENT_RE.test(word.raw)) {
      if (word.raw.endsWith('=') && next === '(') {
        // `name=(a b c)`: an array assignment.
        const end = closingParen(src, word.end);
        if (end < 0) parseFail('unterminated array assignment');
        const inner = parseSequence(
          `: ${src.slice(word.end + 1, end - 1)}`,
          0,
          null,
          depth + 1,
          'array',
        );
        commands.push(
          ...inner.commands.filter((entry) => entry.origin !== 'array'),
        );
        markDynamic(word);
        word.raw = src.slice(i, end);
        command.assignments.push(word);
        i = end;
        continue;
      }
      command.assignments.push(word);
      i = word.end;
      continue;
    }
    if (first && !word.quoted && RESERVED_SKIP.has(word.value)) {
      i = word.end;
      if (word.value === 'time') {
        // The `time` keyword takes `-p` (and `--`) before the command.
        const j = skipBlanks(src, i);
        const option = /^(?:-p|--)(?=[\s;&|()<>]|$)/u.exec(src.slice(j));
        if (option) i = j + option[0].length;
      }
      continue;
    }
    if (first && !word.quoted && word.value === 'function') {
      // `function name [()] { …; }`
      let j = skipBlanks(src, word.end);
      const name = readWord(src, j, ctx);
      j = skipBlanks(src, name.end);
      if (src.startsWith('()', j)) j += 2;
      i = j;
      continue;
    }
    if (first && !word.quoted && word.value === 'case') {
      return parseFail('case statements are not read');
    }
    if (first && !word.quoted && word.value === '[[') {
      command.words.push(word);
      let j = word.end;
      for (;;) {
        j = skipBlanks(src, j);
        if (j >= src.length || src[j] === '\n') parseFail('unterminated [[');
        if (
          src.startsWith(']]', j) &&
          (j + 2 >= src.length || WORD_END.has(src[j + 2]))
        ) {
          const close = newWord();
          close.value = ']]';
          close.raw = ']]';
          command.words.push(close);
          j += 2;
          break;
        }
        const operator = /^(?:&&|\|\||[<>()!])/u.exec(src.slice(j));
        if (operator) {
          const op = newWord();
          op.value = operator[0];
          op.raw = operator[0];
          command.words.push(op);
          j += operator[0].length;
          continue;
        }
        const inner = readWord(src, j, ctx);
        if (!inner.raw) parseFail('bad [[ expression');
        commands.push(...inner.subs);
        command.words.push(inner);
        j = inner.end;
      }
      i = j;
      continue;
    }
    command.words.push(word);
    i = word.end;
  }
  if (terminator)
    parseFail(`unterminated ${terminator === ')' ? '(' : terminator}`);
  finish();
  if (pending.length) readBodies(src.length);
  return { commands, end: i };
}

// { ok: true, commands } or { ok: false, reason }.
export function parseBash(source) {
  try {
    const { commands } = parseSequence(String(source ?? ''), 0, null, 0, 'top');
    return { ok: true, commands };
  } catch (error) {
    if (error instanceof ShellParseError)
      return { ok: false, reason: error.message, commands: [] };
    throw error;
  }
}

// A program's name as the guards compare it: the basename, without `.exe`
// (or `.cmd`, `.bat`, `.com`), in lower case.
export function programName(value) {
  return String(value ?? '')
    .replace(/^.*[\\/]/u, '')
    .replace(/\.(?:exe|cmd|bat|com)$/iu, '')
    .toLowerCase();
}

// Launchers and wrappers that run the command after their options. For each:
// options with a value (`args`), options without (`flags`, anything else is
// taken as a flag too), a count of positional words before the command
// (`positional`), and special behaviour.
const LAUNCHERS = Object.freeze({
  env: {
    args: ['-u', '-C', '-P', '--unset', '--chdir'],
    split: ['-S', '--split-string'],
    assignments: true,
  },
  timeout: { args: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  nohup: {},
  sudo: {
    args: [
      '-u',
      '-g',
      '-C',
      '-D',
      '-h',
      '-p',
      '-r',
      '-t',
      '-U',
      '-T',
      '-R',
      '--user',
      '--group',
      '--close-from',
      '--chdir',
      '--host',
      '--prompt',
      '--role',
      '--type',
      '--other-user',
      '--command-timeout',
      '--chroot',
    ],
    assignments: true,
  },
  doas: { args: ['-u', '-C'] },
  command: { lookup: ['-v', '-V'] },
  builtin: {},
  exec: { args: ['-a'] },
  nice: { args: ['-n', '--adjustment'] },
  ionice: {
    args: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'],
  },
  stdbuf: { args: ['-i', '-o', '-e', '--input', '--output', '--error'] },
  time: { args: ['-f', '-o', '--format', '--output'] },
  setsid: {},
  chroot: { args: ['--userspec', '--groups'], positional: 1 },
  xargs: {
    args: [
      '-a',
      '-d',
      '-E',
      '-I',
      '-L',
      '-n',
      '-P',
      '-s',
      '--arg-file',
      '--delimiter',
      '--eof',
      '--replace',
      '--max-lines',
      '--max-args',
      '--max-procs',
      '--max-chars',
      '--process-slot-var',
    ],
    stdinArgs: true,
    defaultProgram: 'echo',
  },
});

export const LAUNCHER_NAMES = Object.freeze(Object.keys(LAUNCHERS));

function takesValue(spec, option) {
  return (
    (spec.args || []).includes(option) || (spec.split || []).includes(option)
  );
}

// Unwraps launchers from a command's words: { program, programWord, args,
// launchers, stdinArgs, lookupOnly, dynamicProgram, splitString }. A launcher
// option that is dynamic (`env $OPTS curl`) hides the program: dynamicProgram.
export function unwrapCommand(words) {
  const out = {
    program: null,
    programWord: null,
    args: [],
    launchers: [],
    stdinArgs: false,
    lookupOnly: false,
    dynamicProgram: false,
    splitString: null,
  };
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word.dynamic || word.brace) {
      out.dynamicProgram = true;
      out.programWord = word;
      out.args = words.slice(index + 1);
      return out;
    }
    const name = programName(word.value);
    const spec = Object.hasOwn(LAUNCHERS, name) ? LAUNCHERS[name] : null;
    if (!spec) {
      out.program = name;
      out.programWord = word;
      out.args = words.slice(index + 1);
      return out;
    }
    out.launchers.push(name);
    if (spec.stdinArgs) out.stdinArgs = true;
    index += 1;
    let positional = spec.positional || 0;
    for (;;) {
      const current = words[index];
      if (!current) break;
      if (current.dynamic || current.brace) {
        out.dynamicProgram = true;
        out.programWord = current;
        out.args = words.slice(index + 1);
        return out;
      }
      const value = current.value;
      if (value === '--') {
        index += 1;
        while (
          spec.assignments &&
          words[index] &&
          !words[index].dynamic &&
          ASSIGNMENT_RE.test(words[index].value)
        )
          index += 1;
        break;
      }
      if (spec.lookup?.includes(value)) {
        out.lookupOnly = true;
        index += 1;
        continue;
      }
      if (spec.assignments && ASSIGNMENT_RE.test(value)) {
        index += 1;
        continue;
      }
      if (value.startsWith('--') && value.length > 2) {
        const [option, inline] = value.split(/=(.*)/su);
        if ((spec.split || []).includes(option)) {
          out.splitString = inline ?? words[index + 1]?.value ?? '';
          out.args = words.slice(index + (inline === undefined ? 2 : 1));
          return out;
        }
        index += inline === undefined && takesValue(spec, option) ? 2 : 1;
        continue;
      }
      if (/^-\d+$/u.test(value) && name === 'nice') {
        index += 1;
        continue;
      }
      if (value.startsWith('-') && value.length > 1) {
        // A cluster (`-iu NAME`): a value option takes the rest or the next word.
        let consumed = 1;
        for (let k = 1; k < value.length; k += 1) {
          const option = `-${value[k]}`;
          if ((spec.split || []).includes(option)) {
            const rest = value.slice(k + 1);
            out.splitString = rest || words[index + 1]?.value || '';
            out.args = words.slice(index + (rest ? 1 : 2));
            return out;
          }
          if (takesValue(spec, option)) {
            if (k === value.length - 1) consumed = 2;
            break;
          }
        }
        index += consumed;
        continue;
      }
      if (positional > 0) {
        positional -= 1;
        index += 1;
        continue;
      }
      break;
    }
    if (index >= words.length) {
      if (spec.defaultProgram) out.program = spec.defaultProgram;
      return out;
    }
  }
  return out;
}

const SHELL_PROGRAMS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'fish',
  'busybox',
]);
const POWERSHELL_PROGRAMS = new Set(['pwsh', 'powershell']);
const FOREIGN_CODE = Object.freeze({
  python: ['-c'],
  python3: ['-c'],
  python2: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  bun: ['-e', '--eval'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
  lua: ['-e'],
  osascript: ['-e'],
  awk: [],
  gawk: [],
});

// Inline code a command hands to an interpreter: [{ language, code, dynamic }].
function inlineCode(resolved, command) {
  const { program, args } = resolved;
  const found = [];
  if (!program) return found;
  const values = args.map((word) => word.value);
  if (SHELL_PROGRAMS.has(program)) {
    let codeFlag = false;
    let index = 0;
    if (program === 'busybox') {
      if (!SHELL_PROGRAMS.has(programName(values[0] ?? ''))) return found;
      index = 1;
    }
    for (; index < args.length; index += 1) {
      const value = values[index];
      if (value === '--') {
        index += 1;
        break;
      }
      if (/^[-+]o$|^[-+]O$/u.test(value)) {
        index += 1;
        continue;
      }
      if (/^[-+][A-Za-z]+$/u.test(value) && !value.startsWith('--')) {
        if (value.startsWith('-') && value.includes('c')) codeFlag = true;
        continue;
      }
      if (value.startsWith('--')) continue;
      break;
    }
    if (codeFlag) {
      const code = args[index];
      if (code)
        found.push({
          language: 'bash',
          code: code.value,
          dynamic: code.dynamic,
        });
      else found.push({ language: 'bash', code: '', dynamic: false });
    } else if (index >= args.length) {
      // `bash <<EOF`, `sh -s < script`, `… | bash`: the script comes on
      // stdin. A pipe or a file gives code that is not known here.
      if (command.piped)
        found.push({ language: 'bash', code: '', dynamic: true });
      for (const redirect of command.redirects) {
        if (redirect.op === '<' && redirect.target)
          found.push({ language: 'bash', code: '', dynamic: true });
        if (redirect.heredoc) {
          found.push({
            language: 'bash',
            code: redirect.heredoc.body,
            dynamic:
              !redirect.heredoc.quoted && /[$`]/u.test(redirect.heredoc.body),
          });
        } else if (redirect.op === '<<<' && redirect.target) {
          found.push({
            language: 'bash',
            code: redirect.target.value,
            dynamic: redirect.target.dynamic,
          });
        }
      }
    }
    return found;
  }
  if (program === 'iex' || program === 'invoke-expression') {
    found.push({
      language: 'powershell',
      code: values.filter((value) => !/^-command$/iu.test(value)).join(' '),
      dynamic: args.some((word) => word.dynamic),
    });
    return found;
  }
  if (program === 'cmd') {
    const index = values.findIndex((value) => /^\/[ck]$/iu.test(value));
    if (index >= 0) {
      const rest = args.slice(index + 1);
      found.push({
        language: 'bash',
        code: rest.map((word) => word.value).join(' '),
        dynamic: rest.some((word) => word.dynamic),
      });
    }
    return found;
  }
  if (program === 'eval') {
    found.push({
      language: 'bash',
      code: values.join(' '),
      dynamic: args.some((word) => word.dynamic),
    });
    return found;
  }
  if (
    program === 'watch' ||
    program === 'script' ||
    program === 'su' ||
    program === 'runuser'
  ) {
    for (let index = 0; index < args.length; index += 1) {
      const value = values[index];
      if (program === 'watch') {
        if (/^-(?:n|d|g|x|e|c|t|b|p|q|-interval)$/u.test(value)) {
          if (/^-n$/u.test(value)) index += 1;
          continue;
        }
        if (value.startsWith('-')) continue;
        found.push({
          language: 'bash',
          code: values.slice(index).join(' '),
          dynamic: args.slice(index).some((word) => word.dynamic),
        });
        return found;
      }
      if (value === '-c' || value === '--command') {
        const code = args[index + 1];
        if (code)
          found.push({
            language: 'bash',
            code: code.value,
            dynamic: code.dynamic,
          });
        return found;
      }
      if (/^--command=/u.test(value)) {
        found.push({
          language: 'bash',
          code: value.slice(10),
          dynamic: args[index].dynamic,
        });
        return found;
      }
    }
    return found;
  }
  if (program === 'find') {
    for (let index = 0; index < args.length; index += 1) {
      if (/^-(?:exec|execdir|ok|okdir)$/u.test(values[index])) {
        const end = values.findIndex(
          (value, k) => k > index && (value === ';' || value === '+'),
        );
        found.push({
          language: 'argv',
          words: args.slice(index + 1, end < 0 ? args.length : end),
        });
        if (end < 0) break;
        index = end;
      }
    }
    return found;
  }
  if (POWERSHELL_PROGRAMS.has(program)) {
    for (let index = 0; index < args.length; index += 1) {
      if (
        /^[-/](?:c|co|com|comm|comma|comman|command|commandwithargs|cwa)$/iu.test(
          values[index],
        )
      ) {
        const rest = args.slice(index + 1);
        found.push({
          language: 'powershell',
          code: rest.map((word) => word.value).join(' '),
          dynamic: rest.some((word) => word.dynamic),
        });
        return found;
      }
      if (/^[-/](?:e|ec|en|enc|encodedcommand)$/iu.test(values[index])) {
        found.push({ language: 'powershell', code: '', dynamic: true });
        return found;
      }
    }
    return found;
  }
  if (Object.hasOwn(FOREIGN_CODE, program)) {
    found.push({ language: 'foreign', code: null, dynamic: false });
  }
  return found;
}

// Every command a Bash command line runs, launchers unwrapped and inline
// code parsed: { ok, reason, commands: [{ ...command, program, programWord,
// args, launchers, stdinArgs, lookupOnly, dynamicProgram, inline,
// foreignCode, dynamicCode }] }. `ok` is false when any part of it could not
// be read, the inline code included.
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
      });
    }
    scripts.push(...inlineCode(resolved, command));
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

function psReadString(src, i, quote, word) {
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (quote === "'") {
      if (c === "'" || c === '\u2019' || c === '\u2018') {
        if (src[j + 1] === "'") {
          word.value += "'";
          j += 2;
          continue;
        }
        return j + 1;
      }
      word.value += c;
      j += 1;
      continue;
    }
    if (c === '"' || c === '\u201c' || c === '\u201d') {
      if (src[j + 1] === '"') {
        word.value += '"';
        j += 2;
        continue;
      }
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
      j += 2;
      continue;
    }
    if (c === '$' && /[A-Za-z_{(:?$^]/u.test(src[j + 1] ?? '')) {
      markDynamic(word);
      if (src[j + 1] === '(') {
        const inner = psGroup(src, j + 1, word);
        word.value += src.slice(j, inner);
        j = inner;
        continue;
      }
      if (src[j + 1] === '{') {
        const close = src.indexOf('}', j + 2);
        if (close < 0) parseFail('unterminated ${…}');
        word.value += src.slice(j, close + 1);
        j = close + 1;
        continue;
      }
      const name =
        /^\$[A-Za-z_?$^][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?/u.exec(
          src.slice(j),
        );
      word.value += name ? name[0] : '$';
      j += name ? name[0].length : 1;
      continue;
    }
    word.value += c;
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
    commands.push(...word.subs);
    command.words.push(word);
    i = end;
  }
  finish();
  return commands;
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
      j = psReadString(src, j + 1, quote, word);
      continue;
    }
    if (c === '`') {
      word.quoted = true;
      if (j + 1 < src.length) word.value += src[j + 1];
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
          j = close + 1;
          continue;
        }
        markDynamic(word);
        const end = psGroup(src, j + 1, word);
        word.value += src.slice(j, end);
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
        j += name[0].length;
        continue;
      }
    }
    if (c === '(' || c === '{') {
      markDynamic(word);
      const end = psGroup(src, j, word);
      word.value += src.slice(j, end);
      j = end;
      continue;
    }
    if (c === ')' || c === '}') parseFail(`unexpected ${c}`);
    word.value += c;
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

// analyzeBash or parsePowerShell, by shell name.
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
