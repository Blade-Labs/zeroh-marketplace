// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bashPath, runHook, tempProject } from '../helpers.mjs';
import { NORMAL_CODE } from '../fixtures/normal-code.mjs';

function hook(name, text, surface) {
  const project = tempProject({ env: false });
  const filePath = `${project.dir}/${name}${surface === 'Read unknown' ? '.unknown' : ''}`;
  const event =
    surface === 'Read' || surface === 'Read unknown'
      ? {
          tool_name: 'Read',
          tool_input: { file_path: filePath },
          tool_response: { type: 'text', file: { filePath, content: text } },
        }
      : surface === 'MCP'
        ? {
            tool_name: 'mcp__fake__result',
            tool_input: {},
            tool_response: { content: [{ type: 'text', text }] },
          }
        : {
            tool_name: 'Bash',
            tool_input: {
              command:
                surface === 'snapshot'
                  ? 'pnpm test'
                  : surface === 'cat POSIX unquoted'
                    ? `cat /zerohfake/${name}`
                    : surface === 'cat native double quoted'
                      ? `cat "D:\\a\\x\\${name}"`
                      : surface === 'cat native single quoted'
                        ? `cat 'D:\\a\\x\\${name}'`
                        : `${surface} "${bashPath(filePath)}"`,
            },
            tool_response: {
              stdout: surface.startsWith('git')
                ? `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1,${text.split('\n').length} @@\n${text
                    .split('\n')
                    .map((line) => `+${line}`)
                    .join('\n')}`
                : surface.startsWith('grep') || surface === 'rg'
                  ? text
                      .split('\n')
                      .map((line, i) => `${name}:${i + 1}:${line}`)
                      .join('\n')
                  : surface === 'snapshot'
                    ? `FAIL ${name}\nSnapshot mismatch:\n${text}`
                    : text,
              stderr: '',
            },
          };
  const result = runHook(
    'post-tool-use',
    { hook_event_name: 'PostToolUse', ...event },
    {
      project,
      extraEnv: {
        TMPDIR: process.env.TMPDIR,
        CLAUDE_CONFIG_DIR: `${project.home}/claude`,
        ZEROH_CLAUDE_BIN: process.env.ZEROH_CLAUDE_BIN,
      },
    },
  );
  assert.equal(
    result.code,
    0,
    `${surface}/${name}: hook completed; command=${event.tool_input.command ?? 'Read'}; stderr=${result.stderr}`,
  );
  return {
    json: result.json,
    response: event.tool_response,
    updated: result.json?.hookSpecificOutput?.updatedToolOutput,
  };
}
for (const surface of [
  'cat',
  'cat POSIX unquoted',
  'cat native double quoted',
  'cat native single quoted',
  'git diff',
  'grep -rn',
  'snapshot',
  'MCP',
  'Read',
  'Read unknown',
  'head',
  'tail',
  'less',
  'git show',
  'rg',
])
  test(`ordinary output: ${surface}, all 18 files have zero findings`, () => {
    assert.equal(Object.keys(NORMAL_CODE).length, 18);
    for (const [name, text] of Object.entries(NORMAL_CODE)) {
      const { json, updated } = hook(name, text, surface);
      assert.equal(
        json,
        null,
        `${surface}/${name}: scan completed without an unchecked notice`,
      );
      assert.equal(
        updated,
        undefined,
        `${surface}/${name}: ordinary output unchanged`,
      );
    }
  });
for (const [name, text, value] of [
  [
    'fake.js',
    'const conn = "Server=local;User Id=app;Password=ZEROHFAKE9!;Database=local";',
    'ZEROHFAKE9!',
  ],
  [
    'fake.py',
    'conn = "Server=local;User Id=app;Password=ZEROHFAKE9!;Database=local"',
    'ZEROHFAKE9!',
  ],
  [
    'fake.js',
    'config = "DB_PASSWORD=ZEROHFAKE9!;API_TOKEN=ZEROHFAKE8!"',
    'ZEROHFAKE9!',
  ],
  [
    'fake.py',
    'config = "DB_PASSWORD=ZEROHFAKE9!;API_TOKEN=ZEROHFAKE8!"',
    'ZEROHFAKE9!',
  ],
  ['fake.yaml', 'password: |\n  ZEROHFAKE9!\nnext: ordinary', 'ZEROHFAKE9!'],
  ['fake.yaml', 'password: >\n  ZEROHFAKE9!\nnext: ordinary', 'ZEROHFAKE9!'],
  ['fake.sh', "DB_PASSWORD='F9!'tail", 'tail'],
  ['fake.sh', "DB_PASSWORD='${DB_PASSWORD}'", '${DB_PASSWORD}'],
])
  for (const surface of name.endsWith('.js') || name.endsWith('.py')
    ? ['Read', 'cat', 'git diff', 'grep -rn']
    : [
        'Read',
        'cat',
        'cat POSIX unquoted',
        'cat native double quoted',
        'cat native single quoted',
      ])
    test(`known scalar hook: ${name}/${surface}/${text.includes('Server') ? 'connection' : 'assignment'}`, () => {
      const { updated } = hook(name, text, surface);
      assert.ok(updated, 'masked response returned');
      assert.ok(
        !JSON.stringify(updated).includes(value),
        'whole credential masked',
      );
      if (text.includes('next: ordinary'))
        assert.ok(
          JSON.stringify(updated).includes('next: ordinary'),
          'following field preserved',
        );
    });
