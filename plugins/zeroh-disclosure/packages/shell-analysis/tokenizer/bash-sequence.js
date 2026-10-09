// SPDX-License-Identifier: AGPL-3.0-only

import { commentStarts, readHeredocWord } from './shared.js';
import {
  WORD_END,
  MAX_DEPTH,
  parseFail,
  newWord,
  markDynamic,
  closingParen,
  readDollar,
  readBacktick,
  readWord,
} from './bash-core.js';

export const REDIRECT_OPS = [
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
export const RESERVED_SKIP = new Set([
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
export const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/u;

export function newCommand(origin, depth) {
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

export function skipBlanks(src, i) {
  let j = i;
  while (src[j] === ' ' || src[j] === '\t') j += 1;
  return j;
}

// Commands in an unquoted heredoc body: its substitutions run.
export function heredocSubstitutions(body, ctx, subs) {
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

class SequenceParser {
  constructor(src, terminator, depth, origin) {
    if (depth > MAX_DEPTH) parseFail('nesting too deep');
    this.src = src;
    this.terminator = terminator;
    this.depth = depth;
    this.origin = origin;
    this.ctx = { depth };
    this.commands = [];
    this.pending = [];
    this.command = newCommand(origin, depth);
    this.piped = false;
  }

  finish({ background = false } = {}) {
    if (
      this.command.words.length ||
      this.command.assignments.length ||
      this.command.redirects.length
    ) {
      this.command.piped = this.piped;
      this.command.background = background;
      this.commands.push(this.command);
    }
    this.command = newCommand(this.origin, this.depth);
    this.piped = false;
  }

  readBodies(from) {
    let i = from;
    for (const heredoc of this.pending) {
      let body = '';
      for (;;) {
        if (i >= this.src.length) break;
        const newline = this.src.indexOf('\n', i);
        const line = this.src.slice(i, newline < 0 ? this.src.length : newline);
        i = newline < 0 ? this.src.length : newline + 1;
        const compared = heredoc.stripTabs ? line.replace(/^\t+/u, '') : line;
        if (compared === heredoc.delimiter) break;
        body += `${heredoc.stripTabs ? compared : line}\n`;
      }
      heredoc.redirect.heredoc = { body, quoted: heredoc.quoted };
      if (!heredoc.quoted) {
        const subs = [];
        heredocSubstitutions(body, this.ctx, subs);
        this.commands.push(...subs);
      }
    }
    this.pending = [];
    return i;
  }

  readRedirect(i, fd) {
    const op = REDIRECT_OPS.find((candidate) =>
      this.src.startsWith(candidate, i),
    );
    if (!op) return parseFail('bad redirection');
    const redirect = { op, fd, target: null, heredoc: null };
    if (op === '<<' || op === '<<-') {
      const heredoc = readHeredocWord(this.src, i);
      if (!heredoc || heredoc.error)
        parseFail(heredoc?.error || 'missing heredoc delimiter');
      this.pending.push({ ...heredoc, redirect });
      this.command.redirects.push(redirect);
      return heredoc.end;
    }
    let j = skipBlanks(this.src, i + op.length);
    if (
      (this.src[j] === '<' || this.src[j] === '>') &&
      this.src[j + 1] === '('
    ) {
      const inner = parseSequence(
        this.src,
        j + 2,
        ')',
        this.depth + 1,
        'process',
      );
      this.commands.push(...inner.commands);
      const target = newWord();
      target.value = this.src.slice(j, inner.end);
      target.raw = target.value;
      markDynamic(target);
      target.dynamicAt = 0;
      redirect.target = target;
      this.command.redirects.push(redirect);
      return inner.end;
    }
    const target = readWord(this.src, j, this.ctx);
    if (!target.raw) parseFail('redirection without a target');
    this.commands.push(...target.subs);
    redirect.target = target;
    this.command.redirects.push(redirect);
    return target.end;
  }

  readSyntax(i) {
    const c = this.src[i];
    if (c === ' ' || c === '\t') {
      return { i: i + 1 };
    }
    if (c === '\n') {
      this.finish();
      return { i: this.readBodies(i + 1) };
    }
    if (c === '#' && commentStarts(this.src, i)) {
      while (i < this.src.length && this.src[i] !== '\n') i += 1;
      return { i };
    }
    if (c === ')') {
      if (this.terminator !== ')') parseFail('unexpected )');
      this.finish();
      if (this.pending.length) parseFail('heredoc inside a substitution');
      return { result: { commands: this.commands, end: i + 1 } };
    }
    if (c === ';') {
      this.finish();
      if (this.src[i + 1] === ';') i += this.src[i + 2] === '&' ? 3 : 2;
      else i += this.src[i + 1] === '&' ? 2 : 1;
      return { i };
    }
    if (c === '&') {
      if (this.src[i + 1] === '&') {
        this.finish();
        return { i: i + 2 };
      }
      if (this.src[i + 1] === '>') {
        return { i: this.readRedirect(i, null) };
      }
      this.finish({ background: true });
      return { i: i + 1 };
    }
    if (c === '|') {
      const orElse = this.src[i + 1] === '|';
      this.finish();
      this.piped = !orElse;
      return { i: i + (orElse || this.src[i + 1] === '&' ? 2 : 1) };
    }
    if (c === '(') return { i: this.readGroup(i) };
    if (c === '<' || c === '>') return { i: this.readRedirection(i) };
    return null;
  }

  readGroup(i) {
    if (!this.command.words.length && !this.command.assignments.length) {
      if (this.src[i + 1] === '(') {
        const end = closingParen(this.src, i);
        if (end < 0) parseFail('unterminated ((…))');
        return end;
      }
      const inner = parseSequence(
        this.src,
        i + 1,
        ')',
        this.depth + 1,
        'subshell',
      );
      this.commands.push(...inner.commands);
      return inner.end;
    }
    if (
      this.command.words.length === 1 &&
      /^\(\s*\)/u.test(this.src.slice(i)) &&
      !this.command.words[0].quoted
    ) {
      // `name () { …; }`: a function definition; its body follows.
      this.command = newCommand(this.origin, this.depth);
      return this.src.indexOf(')', i) + 1;
    }
    return parseFail('unexpected (');
  }

  readRedirection(i) {
    if (this.src[i + 1] !== '(') return this.readRedirect(i, null);
    const inner = parseSequence(
      this.src,
      i + 2,
      ')',
      this.depth + 1,
      'process',
    );
    this.commands.push(...inner.commands);
    const word = newWord();
    word.value = this.src.slice(i, inner.end);
    word.raw = word.value;
    word.start = i;
    word.end = inner.end;
    markDynamic(word);
    word.dynamicAt = 0;
    this.command.words.push(word);
    return inner.end;
  }

  readAssignment(word, next, i) {
    const first = !this.command.words.length;
    if (!first || !ASSIGNMENT_RE.test(word.raw)) return null;
    if (first && ASSIGNMENT_RE.test(word.raw)) {
      if (word.raw.endsWith('=') && next === '(') {
        // `name=(a b c)`: an array assignment.
        const end = closingParen(this.src, word.end);
        if (end < 0) parseFail('unterminated array assignment');
        const inner = parseSequence(
          `: ${this.src.slice(word.end + 1, end - 1)}`,
          0,
          null,
          this.depth + 1,
          'array',
        );
        this.commands.push(
          ...inner.commands.filter((entry) => entry.origin !== 'array'),
        );
        markDynamic(word);
        word.raw = this.src.slice(i, end);
        this.command.assignments.push(word);
        return { i: end };
      }
      this.command.assignments.push(word);
      return { i: word.end };
    }
    return null;
  }

  readDoubleBracket(word) {
    this.command.words.push(word);
    let j = word.end;
    for (;;) {
      j = skipBlanks(this.src, j);
      if (j >= this.src.length || this.src[j] === '\n')
        parseFail('unterminated [[');
      if (
        this.src.startsWith(']]', j) &&
        (j + 2 >= this.src.length || WORD_END.has(this.src[j + 2]))
      ) {
        const close = newWord();
        close.value = ']]';
        close.raw = ']]';
        this.command.words.push(close);
        return j + 2;
      }
      const operator = /^(?:&&|\|\||[<>()!])/u.exec(this.src.slice(j));
      if (operator) {
        const op = newWord();
        op.value = operator[0];
        op.raw = operator[0];
        this.command.words.push(op);
        j += operator[0].length;
        continue;
      }
      const inner = readWord(this.src, j, this.ctx);
      if (!inner.raw) parseFail('bad [[ expression');
      this.commands.push(...inner.subs);
      this.command.words.push(inner);
      j = inner.end;
    }
  }

  readCommandWord(i) {
    const word = readWord(this.src, i, this.ctx);
    const next = this.src[word.end];
    if (
      (next === '<' || next === '>') &&
      (/^\d+$/u.test(word.raw) ||
        /^\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(word.raw))
    )
      return this.readRedirect(word.end, word.raw);
    this.commands.push(...word.subs);
    const assigned = this.readAssignment(word, next, i);
    if (assigned) return assigned.i;
    const first = !this.command.words.length;
    if (first && !word.quoted && RESERVED_SKIP.has(word.value)) {
      let end = word.end;
      if (word.value === 'time') {
        // The `time` keyword takes `-p` (and `--`) before the command.
        const j = skipBlanks(this.src, end);
        const option = /^(?:-p|--)(?=[\s;&|()<>]|$)/u.exec(this.src.slice(j));
        if (option) end = j + option[0].length;
      }
      return end;
    }
    if (first && !word.quoted && word.value === 'function') {
      // `function name [()] { …; }`
      let j = skipBlanks(this.src, word.end);
      const name = readWord(this.src, j, this.ctx);
      j = skipBlanks(this.src, name.end);
      if (this.src.startsWith('()', j)) j += 2;
      return j;
    }
    if (first && !word.quoted && word.value === 'case') {
      return parseFail('case statements are not read');
    }
    if (first && !word.quoted && word.value === '[[')
      return this.readDoubleBracket(word);
    this.command.words.push(word);
    return word.end;
  }

  parse(start) {
    let i = start;
    while (i < this.src.length) {
      const syntax = this.readSyntax(i);
      if (syntax?.result) return syntax.result;
      i = syntax ? syntax.i : this.readCommandWord(i);
    }
    if (this.terminator)
      parseFail(
        `unterminated ${this.terminator === ')' ? '(' : this.terminator}`,
      );
    this.finish();
    if (this.pending.length) this.readBodies(this.src.length);
    return { commands: this.commands, end: i };
  }
}

// Parses commands from `start` until `terminator` (`)`) or the end.
export function parseSequence(src, start, terminator, depth, origin) {
  return new SequenceParser(src, terminator, depth, origin).parse(start);
}

// { ok: true, commands } or { ok: false, reason }.
