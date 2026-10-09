// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import { failClosedAnswer, ERROR_WITHHELD } from '../../hooks/fail-closed.js';

function withheld(tool_name, tool_response, tool_input = {}) {
  const answer = failClosedAnswer(
    'post-tool-use',
    JSON.stringify({ tool_name, tool_response, tool_input }),
    {},
    new Error('ZEROHFAKE'),
  );
  return JSON.parse(answer.stdout).hookSpecificOutput.updatedToolOutput;
}

test('A2: MCP structured data retains no payload scalars, even under metadata-like keys', () => {
  const response = {
    content: [{ type: 'text', text: 'ZEROHFAKE text' }],
    structuredContent: {
      customer: {
        name: 'ZEROHFAKE Name',
        id: 'ZEROHFAKE id',
        path: 'ZEROHFAKE path',
        type: 'ZEROHFAKE type',
        age: 987654321,
        active: true,
        nested: [{ name: 'ZEROHFAKE nested', value: 123456789 }],
      },
    },
  };
  const output = withheld('mcp__fake__customer', response);
  assert.deepEqual(output.content, [{ type: 'text', text: ERROR_WITHHELD }]);
  assert.deepEqual(output.structuredContent.customer, {
    name: ERROR_WITHHELD,
    id: ERROR_WITHHELD,
    path: ERROR_WITHHELD,
    type: ERROR_WITHHELD,
    age: 0,
    active: false,
    nested: [{ name: ERROR_WITHHELD, value: 0 }],
  });
});

test('A2: Bash keeps response field types without retaining unchecked numbers or metadata-like values', () => {
  assert.deepEqual(
    withheld('Bash', {
      stdout: 'ZEROHFAKE',
      stderr: 'ZEROHFAKE',
      interrupted: true,
      exitCode: 987654321,
      backgroundTaskId: 'ZEROHFAKE id',
      data: { name: 'ZEROHFAKE', path: 'ZEROHFAKE' },
    }),
    {
      stdout: ERROR_WITHHELD,
      stderr: ERROR_WITHHELD,
      interrupted: false,
      exitCode: 0,
      backgroundTaskId: ERROR_WITHHELD,
      data: { name: ERROR_WITHHELD, path: ERROR_WITHHELD },
    },
  );
});

test('A2: Read emits the accepted text-file schema with only its own path and safe line metadata', () => {
  const output = withheld(
    'Read',
    {
      type: 'pdf',
      file: {
        filePath: 'ZEROHFAKE path',
        base64: 'ZEROHFAKE',
        originalSize: 987654321,
      },
    },
    { file_path: '/tmp/zeroh-fixture/fake.pdf' },
  );
  assert.deepEqual(output, {
    type: 'text',
    file: {
      filePath: '/tmp/zeroh-fixture/fake.pdf',
      content: ERROR_WITHHELD,
      numLines: 1,
      startLine: 1,
      totalLines: 1,
    },
  });
});

for (const mode of ['content', 'files_with_matches', 'count'])
  test(`A2: Grep ${mode} keeps its mode enum and field types while removing paths and counts`, () => {
    assert.deepEqual(
      withheld('Grep', {
        mode,
        filenames: ['ZEROHFAKE path'],
        numFiles: 987654321,
        content: 'ZEROHFAKE content',
        numLines: 123456789,
      }),
      {
        mode,
        filenames: [ERROR_WITHHELD],
        numFiles: 0,
        content: ERROR_WITHHELD,
        numLines: 0,
      },
    );
  });
