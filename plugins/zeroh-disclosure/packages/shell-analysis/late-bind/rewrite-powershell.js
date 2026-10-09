// SPDX-License-Identifier: AGPL-3.0-only

import { stopParsingRanges } from '../shell-scan.js';
import { containsToken } from '../../zeroh-disclosure-core/token-pattern.js';
import { bindingAt } from './detect.js';

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
class PowerShellRewriter {
  constructor(command, vault) {
    this.command = command;
    this.vault = vault;
    this.bindings = new Map();
    this.contexts = [
      {
        kind: 'code',
        comment: null,
        subexpression: false,
        parenDepth: 0,
      },
    ];
    this.output = '';
  }

  current() {
    return this.contexts.at(-1);
  }

  readBinding(index, frame) {
    const binding = bindingAt(this.command, index, this.vault);
    if (binding && !(frame.kind === 'code' && frame.comment)) {
      this.bindings.set(binding.token, binding);
      this.output += `\${${binding.variable}}`;
      return index + binding.token.length;
    }
    return null;
  }

  readEscape(index) {
    if (this.command[index] !== '`' || index + 1 >= this.command.length)
      return null;
    const escapedBinding = bindingAt(this.command, index + 1, this.vault);
    if (escapedBinding) {
      this.bindings.set(escapedBinding.token, escapedBinding);
      this.output += `\${${escapedBinding.variable}}`;
      return index + escapedBinding.token.length + 1;
    }
    this.output += this.command[index] + this.command[index + 1];
    return index + 2;
  }

  openSubexpression(index) {
    this.output += '$(';
    this.contexts.push({
      kind: 'code',
      comment: null,
      subexpression: true,
      parenDepth: 0,
    });
    return index + 2;
  }

  readDouble(index) {
    const char = this.command[index];
    const escaped = this.readEscape(index);
    if (escaped !== null) return escaped;
    if (char === '$' && this.command[index + 1] === '(')
      return this.openSubexpression(index);
    this.output += char;
    if (char === '"') this.contexts.pop();
    return index + 1;
  }

  readHereDouble(index, frame) {
    if (frame.lineStart && this.command.startsWith('"@', index)) {
      this.output += '"@';
      this.contexts.pop();
      return index + 2;
    }
    const escaped = this.readEscape(index);
    if (escaped !== null) return escaped;
    const char = this.command[index];
    if (char === '$' && this.command[index + 1] === '(') {
      frame.lineStart = false;
      return this.openSubexpression(index);
    }
    this.output += char;
    frame.lineStart = char === '\n';
    return index + 1;
  }

  readComment(index, frame) {
    const char = this.command[index];
    if (frame.comment === 'line') {
      this.output += char;
      if (char === '\n') frame.comment = null;
      return index + 1;
    }
    if (frame.comment === 'block') {
      if (this.command.startsWith('#>', index)) {
        this.output += '#>';
        frame.comment = null;
        return index + 2;
      }
      this.output += char;
      return index + 1;
    }
    return null;
  }

  readCode(index, frame) {
    const char = this.command[index];
    if (this.command.startsWith('<#', index)) {
      this.output += '<#';
      frame.comment = 'block';
      return { index: index + 2 };
    }
    if (char === '#') {
      this.output += char;
      frame.comment = 'line';
      return { index: index + 1 };
    }
    if (this.command.startsWith("@'", index)) {
      const rewritten = powerShellHereStringAt(
        this.command,
        index,
        this.vault,
        this.bindings,
      );
      if (!rewritten.ok)
        return { failure: powerShellFailure(rewritten.reason) };
      this.output += rewritten.text;
      return { index: rewritten.end };
    }
    if (this.command.startsWith('@"', index)) {
      this.output += '@"';
      this.contexts.push({ kind: 'here-double', lineStart: false });
      return { index: index + 2 };
    }
    const escaped = this.readEscape(index);
    if (escaped !== null) return { index: escaped };
    const whole =
      char === "'" || char === '"'
        ? powerShellWholeTokenString(this.command, index, this.vault)
        : null;
    if (whole) {
      // A string that is exactly one token becomes the bare variable: an
      // expandable string ("${...}") is one more thing Claude Code's
      // PowerShell check asks about.
      this.bindings.set(whole.binding.token, whole.binding);
      this.output += `\${${whole.binding.variable}}`;
      return { index: whole.end };
    }
    if (char === "'") {
      const rewritten = rewritePowerShellSingleString(
        this.command,
        index,
        this.vault,
        this.bindings,
      );
      if (!rewritten.ok)
        return { failure: powerShellFailure(rewritten.reason) };
      if (frame.subexpression && rewritten.containsCloseParen) {
        return {
          failure: powerShellFailure(
            'PowerShell quoted ) inside $() is not safely rewritable',
          ),
        };
      }
      this.output += rewritten.text;
      return { index: rewritten.end };
    }
    if (char === '"') {
      this.output += char;
      this.contexts.push({ kind: 'double' });
      return { index: index + 1 };
    }
    if (char === '$' && this.command[index + 1] === '(')
      return { index: this.openSubexpression(index) };
    if (frame.subexpression && char === '(') {
      frame.parenDepth += 1;
      this.output += char;
      return { index: index + 1 };
    }
    if (frame.subexpression && char === ')') {
      this.output += char;
      if (frame.parenDepth > 0) frame.parenDepth -= 1;
      else this.contexts.pop();
      return { index: index + 1 };
    }
    this.output += char;
    return { index: index + 1 };
  }

  finish() {
    const frame = this.current();
    if (frame.kind === 'double')
      return powerShellFailure(
        'PowerShell double-quoted string is unterminated',
      );
    if (frame.kind === 'here-double')
      return powerShellFailure('PowerShell here-string is unterminated');
    if (frame.kind === 'code' && frame.comment === 'block')
      return powerShellFailure('PowerShell block comment is unterminated');
    if (this.contexts.length > 1)
      return powerShellFailure('PowerShell $() subexpression is unterminated');
    return {
      ok: true,
      command: this.output,
      bindings: [...this.bindings.values()],
    };
  }

  rewrite() {
    if (POWERSHELL_TYPOGRAPHIC_QUOTES.test(this.command))
      return powerShellFailure(
        'typographic PowerShell quotes are not safely rewritable',
      );
    if (tokenAfterStopParsing(this.command, this.vault))
      return powerShellFailure(
        'a token after --%: PowerShell passes that text as written, so no variable there is read',
      );
    for (let index = 0; index < this.command.length;) {
      const frame = this.current();
      const bindingEnd = this.readBinding(index, frame);
      if (bindingEnd !== null) {
        index = bindingEnd;
        continue;
      }
      const commentEnd = this.readComment(index, frame);
      if (commentEnd !== null) {
        index = commentEnd;
        continue;
      }
      let next;
      if (frame.kind === 'double') next = { index: this.readDouble(index) };
      else if (frame.kind === 'here-double')
        next = { index: this.readHereDouble(index, frame) };
      else next = this.readCode(index, frame);
      if (next.failure) return next.failure;
      index = next.index;
    }
    return this.finish();
  }
}

export function rewritePowerShellCommand(command, vault) {
  return new PowerShellRewriter(command, vault).rewrite();
}
