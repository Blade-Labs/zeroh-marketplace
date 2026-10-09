// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bashPath, runHook, tempProject } from '../helpers.mjs';

// Exercise the host hook, not just its detector adapter. Each event gets a
// fresh vault so a previously remembered secret cannot repair a detector miss.
const rows = [
  [
    'H01',
    'Password=orchardlantern,velvetmeadow',
    ['orchardlantern,velvetmeadow'],
    '.env',
  ],
  [
    'H02',
    'FIRST_PASSWORD={F:\nSECOND_PASSWORD=p4ss,w0rd!',
    ['{F:', 'p4ss,w0rd!'],
    '.env',
  ],
  [
    'H03',
    'result = await f(\n api_token=Fx!,next=ordinary\n)',
    ['Fx!'],
    '.py',
    'next=ordinary',
  ],
  ['H04', 'result = await f(\n api_token=ordinary,next=ordinary\n)', [], '.py'],
  ['H05', 'api_token: {source: environment}', [], '.yaml'],
  ['H06', '- DB_PASSWORD: p4ss,w0rd!', ['p4ss,w0rd!'], '.yaml'],
  ['H07', '> DB_PASSWORD=p4ss,w0rd!', ['p4ss,w0rd!'], '.md'],
  [
    'H08',
    'My config is DB_PASSWORD=hunter2,x9! and more',
    ['hunter2,x9!'],
    '.md',
    ' and more',
  ],
];

for (const [id, text, secrets, extension, retained] of rows)
  for (const tool of [
    'Bash',
    'Bash POSIX unquoted',
    'Bash native double quoted',
    'Bash native single quoted',
    'Read',
  ])
    test(`assignment hook ${id}: ${tool}${tool === 'Read' ? extension : ''}`, () => {
      const project = tempProject({ env: false });
      const filePath = `${project.dir}/fake-settings${extension}`;
      const event = tool.startsWith('Bash')
        ? {
            tool_name: 'Bash',
            tool_input: {
              command:
                tool === 'Bash POSIX unquoted'
                  ? `cat /zerohfake/fake-settings${extension}`
                  : tool === 'Bash native double quoted'
                    ? `cat "D:\\a\\x\\fake-settings${extension}"`
                    : tool === 'Bash native single quoted'
                      ? `cat 'D:\\a\\x\\fake-settings${extension}'`
                      : `cat "${bashPath(filePath)}"`,
            },
            tool_response: { stdout: text, stderr: '' },
          }
        : tool === 'Read'
          ? {
              tool_name: 'Read',
              tool_input: { file_path: filePath },
              tool_response: {
                type: 'text',
                file: {
                  filePath,
                  content: text,
                  numLines: text.split('\n').length,
                },
              },
            }
          : {
              tool_name: 'mcp__fake__result',
              tool_input: {},
              tool_response: { content: [{ type: 'text', text }] },
            };
      const result = runHook(
        'post-tool-use',
        { hook_event_name: 'PostToolUse', ...event },
        {
          project,
          extraEnv: {
            CLAUDE_CONFIG_DIR: `${project.home}/claude`,
            TMPDIR: process.env.TMPDIR,
            ZEROH_CLAUDE_BIN: process.env.ZEROH_CLAUDE_BIN,
          },
        },
      );
      assert.equal(result.code, 0, `${id}: hook completed`);
      const updated = result.json?.hookSpecificOutput?.updatedToolOutput;
      if (!secrets.length)
        assert.equal(updated, undefined, `${id}: ordinary output unchanged`);
      else {
        assert.notEqual(updated, undefined, `${id}: replacement returned`);
        const output = JSON.stringify(updated);
        for (const secret of secrets)
          assert.ok(!output.includes(secret), `${id}: complete scalar masked`);
        if (retained)
          assert.ok(
            output.includes(retained),
            `${id}: surrounding output retained`,
          );
        if (id === 'H01')
          assert.ok(
            !output.includes('velvetmeadow'),
            `${id}: second list word masked too`,
          );
      }
    });
