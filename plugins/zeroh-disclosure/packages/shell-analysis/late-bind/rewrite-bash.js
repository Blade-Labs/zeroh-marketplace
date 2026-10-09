// SPDX-License-Identifier: AGPL-3.0-only

import { commentStarts } from '../shell-scan.js';
import {
  BACKSLASH,
  bashFailure,
  bashReplacement,
  bashWordAt,
  bindingAt,
  heredocAt,
  replaceHeredocLine,
} from './detect.js';

class BashRewriter {
  constructor(command, vault, options) {
    this.command = command;
    this.vault = vault;
    this.options = options;
    this.bindings = new Map();
    this.uses = { backslash: false };
    this.pendingHeredocs = [];
    this.heredoc = null;
    this.contexts = [
      { kind: 'root', quote: 'unquoted', outerQuote: null, parenDepth: 0 },
    ];
    this.output = '';
  }

  current() {
    return this.contexts.at(-1);
  }

  readHeredoc(index) {
    const newline = this.command.indexOf('\n', index);
    const end = newline === -1 ? this.command.length : newline;
    const rawLine = this.command.slice(index, end);
    const comparison = (
      this.heredoc.stripTabs ? rawLine.replace(/^\t+/, '') : rawLine
    ).replace(/\r$/, '');
    if (comparison === this.heredoc.delimiter) {
      this.output += rawLine;
      if (newline !== -1) this.output += '\n';
      this.heredoc = this.pendingHeredocs.shift() || null;
    } else {
      const replaced = replaceHeredocLine(
        rawLine,
        this.vault,
        this.bindings,
        this.heredoc.quoted,
        this.uses,
      );
      this.output += replaced.text;
      if (newline !== -1) this.output += '\n';
    }
    return newline === -1 ? end : end + 1;
  }

  readBinding(index, frame) {
    const binding = bindingAt(this.command, index, this.vault);
    if (!binding || frame.quote === 'comment') return null;
    const activeCase = frame.cases?.at(-1);
    if (activeCase?.phase === 'subject-start') activeCase.phase = 'subject';
    this.bindings.set(binding.token, binding);
    this.output += bashReplacement(binding, frame.quote, this.options);
    return index + binding.token.length;
  }

  openExpansion(index, frame) {
    const state = frame.quote;
    if (
      ['unquoted', 'double'].includes(state) &&
      this.command.startsWith('$((', index)
    ) {
      this.output += '$((';
      this.contexts.push({
        kind: 'arithmetic',
        quote: 'unquoted',
        outerQuote: state,
        parenDepth: 0,
      });
      return index + 3;
    }
    if (
      ['unquoted', 'double'].includes(state) &&
      this.command[index] === '$' &&
      this.command[index + 1] === '('
    ) {
      this.output += '$(';
      this.contexts.push({
        kind: 'dollar',
        quote: 'unquoted',
        outerQuote: state,
        parenDepth: 0,
        cases: [],
        commandPosition: true,
      });
      return index + 2;
    }
    if (
      (frame.kind === 'backtick' || ['unquoted', 'double'].includes(state)) &&
      this.command[index] === '`'
    ) {
      this.output += '`';
      if (frame.kind === 'backtick') this.contexts.pop();
      else
        this.contexts.push({
          kind: 'backtick',
          quote: 'unquoted',
          outerQuote: state,
          parenDepth: 0,
        });
      return index + 1;
    }
    return null;
  }

  readQuoted(index, frame) {
    const state = frame.quote;
    const char = this.command[index];
    if (state === 'comment') {
      this.output += char;
      if (char === '\n') {
        frame.quote = 'unquoted';
        this.heredoc = this.pendingHeredocs.shift() || null;
      }
      return index + 1;
    }
    if (state === 'single') {
      this.output += char;
      if (char === "'") frame.quote = 'unquoted';
      return index + 1;
    }
    if (state === 'ansi') {
      this.output += char;
      index += 1;
      if (char === '\\' && index < this.command.length) {
        this.output += this.command[index];
        index += 1;
      } else if (char === "'") frame.quote = 'unquoted';
      return index;
    }
    if (state !== 'double') return null;
    if (char === '\\' && index + 1 < this.command.length) {
      const escapedBinding = bindingAt(this.command, index + 1, this.vault);
      if (escapedBinding) {
        this.bindings.set(escapedBinding.token, escapedBinding);
        this.uses.backslash = true;
        this.output += `${BACKSLASH}\${${escapedBinding.variable}}`;
        return index + escapedBinding.token.length + 1;
      }
      if (['$', '`', '"', '\\', '\n'].includes(this.command[index + 1])) {
        this.output += char + this.command[index + 1];
        return index + 2;
      }
    }
    this.output += char;
    if (char === '"') frame.quote = 'unquoted';
    return index + 1;
  }

  readEscaped(index) {
    if (this.command[index] !== '\\' || index + 1 >= this.command.length)
      return null;
    const escapedBinding = bindingAt(this.command, index + 1, this.vault);
    if (escapedBinding) {
      this.bindings.set(escapedBinding.token, escapedBinding);
      this.output += `"\${${escapedBinding.variable}}"`;
      return index + escapedBinding.token.length + 1;
    }
    this.output += this.command[index] + this.command[index + 1];
    return index + 2;
  }

  readDollarCase(index, frame) {
    if (frame.kind !== 'dollar') return null;
    const activeCase = frame.cases.at(-1);
    if (frame.commandPosition && bashWordAt(this.command, index, 'case')) {
      frame.cases.push({ phase: 'subject-start' });
      frame.commandPosition = false;
      this.output += 'case';
      return index + 4;
    }
    if (
      activeCase?.phase === 'subject' &&
      bashWordAt(this.command, index, 'in')
    ) {
      activeCase.phase = 'pattern';
      this.output += 'in';
      return index + 2;
    }
    if (
      activeCase &&
      frame.commandPosition &&
      bashWordAt(this.command, index, 'esac')
    ) {
      frame.cases.pop();
      frame.commandPosition = false;
      this.output += 'esac';
      return index + 4;
    }
    if (
      activeCase?.phase === 'body' &&
      (this.command.startsWith(';;&', index) ||
        this.command.startsWith(';;', index) ||
        this.command.startsWith(';&', index))
    ) {
      const terminator = this.command.startsWith(';;&', index)
        ? ';;&'
        : this.command.slice(index, index + 2);
      activeCase.phase = 'pattern';
      frame.commandPosition = true;
      this.output += terminator;
      return index + terminator.length;
    }
    if (
      activeCase?.phase === 'pattern' &&
      this.command[index] === ')' &&
      frame.parenDepth === 0
    ) {
      activeCase.phase = 'body';
      frame.commandPosition = true;
      this.output += ')';
      return index + 1;
    }
    if (
      activeCase?.phase === 'subject-start' &&
      !/\s/u.test(this.command[index])
    )
      activeCase.phase = 'subject';
    return null;
  }

  readParen(index, frame) {
    const char = this.command[index];
    if (frame.kind === 'arithmetic' && char === '(') {
      frame.parenDepth += 1;
      this.output += char;
      return { index: index + 1 };
    }
    if (frame.kind === 'arithmetic' && char === ')') {
      if (frame.parenDepth > 0) {
        frame.parenDepth -= 1;
        this.output += char;
        return { index: index + 1 };
      }
      if (this.command[index + 1] === ')') {
        this.output += '))';
        this.contexts.pop();
        return { index: index + 2 };
      }
      return { failure: bashFailure('arithmetic expansion is unbalanced') };
    }
    if (frame.kind === 'dollar' && char === '(') {
      frame.parenDepth += 1;
      this.output += char;
      return { index: index + 1 };
    }
    if (frame.kind === 'dollar' && char === ')') {
      if (frame.parenDepth === 0 && frame.cases.length > 0)
        return { failure: bashFailure('case/esac inside $() is unbalanced') };
      this.output += char;
      if (frame.parenDepth > 0) frame.parenDepth -= 1;
      else this.contexts.pop();
      return { index: index + 1 };
    }
    return null;
  }

  readSyntax(index, frame) {
    const char = this.command[index];
    if (char === '$' && this.command[index + 1] === "'") {
      this.output += "$'";
      frame.quote = 'ansi';
      return { index: index + 2 };
    }
    if (char === "'") frame.quote = 'single';
    else if (char === '"') frame.quote = 'double';
    else if (commentStarts(this.command, index)) frame.quote = 'comment';
    else {
      const spec =
        frame.kind !== 'arithmetic' && char === '<'
          ? heredocAt(this.command, index)
          : null;
      if (spec) {
        if (spec.error) return { failure: bashFailure(spec.error) };
        this.output += spec.header;
        this.pendingHeredocs.push(spec);
        return { index: spec.end };
      }
      this.output += char;
      if (char === '\n') this.heredoc = this.pendingHeredocs.shift() || null;
      if (frame.kind === 'dollar') {
        if (/\s/u.test(char)) {
          if (char === '\n') frame.commandPosition = true;
        } else if ([';', '&', '|'].includes(char)) frame.commandPosition = true;
        else frame.commandPosition = false;
      }
      return { index: index + 1 };
    }
    this.output += char;
    return { index: index + 1 };
  }

  step(index) {
    if (this.heredoc) return { index: this.readHeredoc(index) };
    const frame = this.current();
    const bindingEnd = this.readBinding(index, frame);
    if (bindingEnd !== null) return { index: bindingEnd };
    const quotedEnd =
      frame.quote === 'comment' ? this.readQuoted(index, frame) : null;
    if (quotedEnd !== null) return { index: quotedEnd };
    const expansionEnd = this.openExpansion(index, frame);
    if (expansionEnd !== null) return { index: expansionEnd };
    const stateEnd = this.readQuoted(index, frame);
    if (stateEnd !== null) return { index: stateEnd };
    const escapedEnd = this.readEscaped(index);
    if (escapedEnd !== null) return { index: escapedEnd };
    const caseEnd = this.readDollarCase(index, frame);
    if (caseEnd !== null) return { index: caseEnd };
    return this.readParen(index, frame) ?? this.readSyntax(index, frame);
  }

  finish() {
    if (this.heredoc || this.pendingHeredocs.length > 0)
      return bashFailure('heredoc is unterminated');
    if (this.contexts.length > 1)
      return bashFailure(
        `${this.contexts.at(-1).kind === 'backtick' ? 'backtick' : '$()'} command substitution is unterminated`,
      );
    if (!['unquoted', 'comment'].includes(this.current().quote))
      return bashFailure(`${this.current().quote} quote is unterminated`);
    return {
      ok: true,
      command: this.output,
      bindings: [...this.bindings.values()],
      ...(this.uses.backslash ? { backslash: true } : {}),
    };
  }

  rewrite() {
    for (let index = 0; index < this.command.length;) {
      const next = this.step(index);
      if (next.failure) return next.failure;
      index = next.index;
    }
    return this.finish();
  }
}

export function rewriteBashCommand(command, vault, options = {}) {
  return new BashRewriter(command, vault, options).rewrite();
}
