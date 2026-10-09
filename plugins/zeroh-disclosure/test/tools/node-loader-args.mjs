// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { javascriptTokens } from './js-tokens.mjs';

// A conservative static guard: unresolved argument expressions fail. Follow
// local bindings rather than trusting names such as "preload" or "loaderURL".
export function unsafeNodeLoaderArguments(source) {
  const tokens = javascriptTokens(source, { templateText: true });
  const values = (expression) => expression.map((token) => token.value);
  function expressionAt(start) {
    let depth = 0;
    let end = start;
    for (; end < tokens.length; end++) {
      const token = tokens[end];
      if (token.kind === 'template-text' || token.kind === 'template') break;
      if (!depth && [',', ';', ']', ')', '}'].includes(token.value)) break;
      if (['(', '[', '{'].includes(token.value)) depth++;
      if ([')', ']', '}'].includes(token.value)) depth--;
    }
    return tokens.slice(start, end);
  }
  const bindings = new Map();
  for (let i = 0; i < tokens.length - 3; i++) {
    if (
      tokens[i].value === 'const' &&
      tokens[i + 1].kind === 'identifier' &&
      tokens[i + 2].value === '='
    ) {
      const name = tokens[i + 1].value;
      bindings.set(name, [...(bindings.get(name) ?? []), expressionAt(i + 3)]);
    }
  }
  function safe(expression, seen = new Set()) {
    if (!expression.length) return false;
    const v = values(expression);
    if (v[0] === '(' && v.at(-1) === ')')
      return safe(expression.slice(1, -1), seen);
    if (expression.length === 1) {
      const token = expression[0];
      if (token.kind === 'string')
        return (
          /^file:\/\//u.test(token.value) ||
          /^(?:node:[\w/.-]+|(?:@[\w.-]+\/)?[\w-][\w/.-]*)$/u.test(token.value)
        );
      if (token.kind !== 'identifier' || seen.has(token.value)) return false;
      const definitions = bindings.get(token.value);
      const next = new Set([...seen, token.value]);
      return (
        !!definitions?.length && definitions.every((entry) => safe(entry, next))
      );
    }
    if (v.slice(0, 4).join(' ') === 'JSON . stringify (' && v.at(-1) === ')')
      return safe(expression.slice(4, -1), seen);
    // Require the complete expression, so a safe URL elsewhere in a ternary
    // cannot conceal a raw path branch or concatenated suffix.
    const entireCall = (opening) => {
      let depth = 0;
      for (let i = opening; i < v.length - 2; i++) {
        if (v[i] === '(') depth++;
        if (v[i] === ')') depth--;
        if (!depth) return i === v.length - 3;
      }
      return false;
    };
    if (
      v[0] === 'pathToFileURL' &&
      v[1] === '(' &&
      v.slice(-3).join(' ') === ') . href' &&
      entireCall(1)
    ) {
      return true;
    }
    if (
      v[0] === 'new' &&
      v[1] === 'URL' &&
      v[2] === '(' &&
      v.slice(-3).join(' ') === ') . href' &&
      entireCall(2)
    ) {
      const specifier = expression[3];
      return (
        specifier?.kind === 'string' &&
        (/^file:\/\//u.test(specifier.value) ||
          (/^\.\.?\//u.test(specifier.value) &&
            v.slice(4).join(' ') === ', import . meta . url ) . href'))
      );
    }
    return false;
  }
  const failures = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!['string', 'template-text'].includes(token.kind)) continue;
    const flag = /^(--(?:import|loader|require))$/u.exec(token.value);
    if (flag && tokens[i + 1]?.value === ',') {
      const expression = expressionAt(i + 2);
      if (!safe(expression))
        failures.push(`${flag[1]} ${values(expression).join(' ')}`);
      continue;
    }
    // Ordinary prose can describe these flags without supplying an argument.
    if (token.kind === 'string' && !/^(?:node\s+)?--/u.test(token.value.trim()))
      continue;
    const option = /(?:^|\s)(--(?:import|loader|require))(?:=|\s+)(.*)$/u.exec(
      token.value,
    );
    if (!option) continue;
    const suffix = option[2].replace(/^"|"$/gu, '');
    if (suffix) {
      if (
        tokens[i + 1]?.value !== '+' &&
        safe([{ kind: 'string', value: suffix }])
      )
        continue;
      failures.push(`${option[1]} ${suffix}`);
      continue;
    }
    let start = i + 1;
    if (tokens[start]?.value === '+' || tokens[start]?.value === 'substitution')
      start++;
    const expression = expressionAt(start);
    if (!safe(expression))
      failures.push(`${option[1]} ${values(expression).join(' ')}`);
  }
  return failures;
}

export function scanNodeLoaderArguments(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return scanNodeLoaderArguments(file);
    if (!/\.(?:mjs|js|cjs)$/u.test(entry.name)) return [];
    return unsafeNodeLoaderArguments(readFileSync(file, 'utf8')).map(
      (argument) => `${file}: ${argument}`,
    );
  });
}
