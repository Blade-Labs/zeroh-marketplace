// SPDX-License-Identifier: AGPL-3.0-only

// Dependency-free lexical tooling for the subprocess import guard. Literal text,
// comments and regex bodies are opaque; template substitutions are real code.
export function javascriptTokens(source, { templateText = false } = {}) {
  const tokens = [];
  let cursor = 0;
  const emit = (kind, value) => tokens.push({ kind, value });
  function quoted(quote) {
    let value = '';
    cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === quote) break;
      if (char !== '\\') {
        value += char;
        continue;
      }
      const escaped = source[cursor++];
      const simple = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        v: '\v',
        0: '\0',
      };
      if (escaped === '\n') continue;
      if (escaped === '\r') {
        if (source[cursor] === '\n') cursor++;
        continue;
      }
      if (escaped === 'x' || escaped === 'u') {
        const braced = escaped === 'u' && source[cursor] === '{';
        if (braced) cursor++;
        const length = braced
          ? source.indexOf('}', cursor) - cursor
          : escaped === 'x'
            ? 2
            : 4;
        const hex = source.slice(cursor, cursor + length);
        if (/^[\da-f]+$/iu.test(hex)) {
          value += String.fromCodePoint(parseInt(hex, 16));
          cursor += length + Number(braced);
          continue;
        }
      }
      value += simple[escaped] ?? escaped;
    }
    return value;
  }
  function template() {
    const start = cursor++;
    let chunkStart = cursor;
    let interpolated = false;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (source[cursor] === '`') {
        const chunkEnd = cursor;
        cursor++;
        if (!interpolated) {
          const end = cursor;
          cursor = start;
          emit('string', quoted('`'));
          cursor = end;
        } else {
          if (templateText)
            emit('template-text', source.slice(chunkStart, chunkEnd));
          emit('template', 'end');
        }
        return;
      }
      if (source.slice(cursor, cursor + 2) === '${') {
        interpolated = true;
        if (templateText)
          emit('template-text', source.slice(chunkStart, cursor));
        emit('template', 'substitution');
        cursor += 2;
        code(true);
        chunkStart = cursor;
      } else cursor++;
    }
  }
  function regex() {
    cursor++;
    let characterClass = false;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '\\') {
        cursor++;
        continue;
      }
      if (char === '[') characterClass = true;
      if (char === ']') characterClass = false;
      if (char === '/' && !characterClass) break;
    }
    while (/[a-z]/iu.test(source[cursor] || '')) cursor++;
    emit('regex', 'literal');
  }
  function code(substitution = false) {
    let expression = true;
    let previous = '';
    const parentheses = [];
    const braces = [];
    let pendingFunction = null;
    let nextBody = null;
    let beforeAsync = '';
    const statementPosition = (value) =>
      ['', ';', '{', '}', 'export', 'default'].includes(value);
    while (cursor < source.length) {
      const char = source[cursor];
      if (/\s/u.test(char)) {
        cursor++;
        continue;
      }
      if (source.slice(cursor, cursor + 2) === '//') {
        cursor += 2;
        while (cursor < source.length && !/[\r\n]/u.test(source[cursor]))
          cursor++;
        continue;
      }
      if (source.slice(cursor, cursor + 2) === '/*') {
        const end = source.indexOf('*/', cursor + 2);
        cursor = end < 0 ? source.length : end + 2;
        continue;
      }
      if (char === '}' && substitution && !braces.length) {
        cursor++;
        return;
      }
      if (char === '"' || char === "'") {
        emit('string', quoted(char));
        expression = false;
        previous = 'literal';
        continue;
      }
      if (char === '`') {
        template();
        expression = false;
        previous = 'literal';
        continue;
      }
      if (char === '/' && expression) {
        regex();
        expression = false;
        previous = 'literal';
        continue;
      }
      if (
        /[$_\p{ID_Start}]/u.test(
          String.fromCodePoint(source.codePointAt(cursor)),
        )
      ) {
        const start = cursor;
        cursor += String.fromCodePoint(source.codePointAt(cursor)).length;
        while (
          cursor < source.length &&
          /[$\u200c\u200d\p{ID_Continue}]/u.test(
            String.fromCodePoint(source.codePointAt(cursor)),
          )
        )
          cursor += String.fromCodePoint(source.codePointAt(cursor)).length;
        const identifier = source.slice(start, cursor);
        const property = previous === '.' || previous === '?.';
        if (identifier === 'function' && previous !== '.')
          pendingFunction = {
            block: statementPosition(
              previous === 'async' ? beforeAsync : previous,
            ),
          };
        if (identifier === 'class' && previous !== '.')
          nextBody = statementPosition(previous);
        if (identifier === 'async') beforeAsync = previous;
        previous = identifier;
        emit('identifier', previous);
        expression =
          !property &&
          /^(?:return|throw|case|delete|void|typeof|new|in|of|instanceof|yield|await|else|do)$/u.test(
            previous,
          );
        continue;
      }
      if (/\d/u.test(char)) {
        const start = cursor++;
        while (/[\w.]/u.test(source[cursor] || '')) cursor++;
        emit('number', source.slice(start, cursor));
        expression = false;
        previous = 'literal';
        continue;
      }
      cursor++;
      let punctuation = char;
      if (['++', '--', '=>', '?.'].includes(char + source[cursor]))
        punctuation += source[cursor++];
      emit('punctuation', punctuation);
      if (char === '(') {
        parentheses.push({
          control: /^(?:if|while|for|with|switch|catch)$/u.test(previous),
          functionBody: pendingFunction,
        });
        pendingFunction = null;
        expression = true;
      } else if (char === ')') {
        const context = parentheses.pop();
        expression = context?.control || false;
        if (context?.functionBody) nextBody = context.functionBody.block;
      } else if (char === '{') {
        braces.push(
          nextBody ??
            (previous === '=>' ||
              !expression ||
              ['else', 'try', 'finally', 'do', ';', '', ')'].includes(
                previous,
              )),
        );
        nextBody = null;
        expression = true;
      } else if (char === '}') expression = braces.pop() || false;
      else expression = ![']', '.', '++', '--', '?.'].includes(punctuation);
      previous = punctuation;
    }
  }
  code();
  return tokens;
}

export function importsChildProcess(source) {
  const tokens = javascriptTokens(source);
  return tokens.some((token, index) => {
    if (
      token.kind !== 'string' ||
      !/^(?:node:)?child_process$/u.test(token.value)
    )
      return false;
    const previous = tokens[index - 1]?.value;
    if (previous === 'import' || previous === 'from') return true;
    // The previous guard checked the first literal argument of any call,
    // including aliased createRequire and chained calls, without name guesses.
    if (previous !== '(') return false;
    let before = index - 2;
    // Parenthesized first arguments and optional calls still load a module.
    while (tokens[before]?.value === '(') before--;
    if (tokens[before]?.value === '?.') before--;
    const callee = tokens[before];
    return callee?.kind === 'identifier' || [')', ']'].includes(callee?.value);
  });
}
