// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { isBuiltin } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PLUGIN } from '../helpers.mjs';
import { importsChildProcess, javascriptTokens } from '../tools/js-tokens.mjs';

test('guard scans nested substitutions, escaped specifiers and comment-separated calls', () => {
  for (const source of [
    '`outer ${`inner ${import("node:child_process")}`} tail`',
    '`outer ${({ nested: `${require("child_process")}` })}`',
    'import(/* comment */ "node:child_process")',
    'require("node:child_\\x70rocess")',
    'import "node:child_\\u0070rocess"',
    'load(`node:child_\\u{70}rocess`)',
    'const ratio = total / count; import("child_process")',
    'const ratio = total / /["`]/.test(text); require("child_process")',
    'if (ready) /["`]/.test(text); import("child_process")',
    'if (ready) {} /["`]/.test(text); import("child_process")',
    'const object = {}; object / 2; import("child_process")',
    'const fn = function() {} / divisor; import("child_process")',
    'const cls = class {} / divisor; import("child_process")',
    'function fn() {} /["`]/.test(text); import("child_process")',
  ])
    assert.equal(importsChildProcess(source), true, source);
});

test('guard ignores quoted prose, raw templates, comments and regex bodies', () => {
  for (const source of [
    'const text = "require(\'child_process\')"',
    'const text = `raw import("child_process") ${42}`',
    'const text = `escaped \\${import("child_process")}`',
    '// import("child_process")\nconst x = 1;',
    '/* require("child_process") */ const x = 1;',
    'const re = /require("child_process")/g',
    'if (ready) /require("child_process")/.test(text)',
    'const re = /["`/]/; const x = total / count;',
    'const text = "child_process";',
  ])
    assert.equal(importsChildProcess(source), false, source);
});

test('all plugin test imports run without installed dependencies', () => {
  const offenders = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:mjs|js|cjs)$/u.test(file)) {
        const tokens = javascriptTokens(readFileSync(file, 'utf8'));
        for (const [index, token] of tokens.entries()) {
          if (token.kind !== 'string') continue;
          const previous = tokens[index - 1]?.value;
          const call =
            previous === '(' &&
            ['import', 'require'].includes(tokens[index - 2]?.value);
          if (!(call || previous === 'from' || previous === 'import')) continue;
          if (isBuiltin(token.value) || /^(?:\.|\/|file:)/u.test(token.value))
            continue;
          offenders.push(`${path.relative(PLUGIN, file)}: ${token.value}`);
        }
      }
    }
  }
  walk(path.join(PLUGIN, 'test'));
  assert.deepEqual(offenders, []);
});
