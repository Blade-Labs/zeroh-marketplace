// SPDX-License-Identifier: AGPL-3.0-only

// Copy literal local imports and module URLs, including cold platform branches.
// Hook bodies selected by a computed import remain explicit fixture inputs.
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { javascriptTokens } from './js-tokens.mjs';

export function copyModuleFixture(source, target, entries) {
  const copied = new Set();
  function visit(relative) {
    if (copied.has(relative)) return;
    copied.add(relative);
    const file = path.join(source, relative);
    const destination = path.join(target, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(file, destination);
    if (!/\.[cm]?js$/u.test(relative)) return;
    const tokens = javascriptTokens(readFileSync(file, 'utf8'));
    for (const [index, token] of tokens.entries()) {
      if (token.kind !== 'string' || !token.value.startsWith('.')) continue;
      const previous = tokens[index - 1]?.value;
      const callee = tokens[index - 2]?.value;
      if (
        !['from', 'import'].includes(previous) &&
        !(previous === '(' && ['import', 'URL'].includes(callee))
      )
        continue;
      const dependency = path.normalize(
        path.join(path.dirname(relative), token.value),
      );
      if (dependency.startsWith('..') || path.isAbsolute(dependency))
        throw new Error('fixture import escapes plugin');
      visit(dependency);
    }
  }
  for (const entry of entries) visit(entry);
  return copied;
}
