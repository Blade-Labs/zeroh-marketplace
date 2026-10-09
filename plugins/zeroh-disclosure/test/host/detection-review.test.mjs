// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GITLEAKS_CATALOG } from '../../vendor/sensitive-data-detectors/src/index.js';
import { runHook, tempProject } from '../helpers.mjs';

const fake = 'ZEROH' + 'FAKE';
const collisions = GITLEAKS_CATALOG.globalAllowlist.stopwords.flatMap(
  (word) => [
    `${fake}_${word}_9x!`,
    `${word}_${fake}9x!`,
    `${fake}9x!_${word}`,
    `${fake}_${word.toUpperCase()}_9x!`,
    `${fake}9x!${word}`,
  ],
);

// Actual host events: a known Bash interpreter, an unknown MCP producer and
// JSON Read content (which cannot prove shell interpolation). Every event
// has a fresh vault, so an earlier masking cannot rescue a later detector miss.
function probe(text, value, tool) {
  const project = tempProject();
  const event =
    tool === 'Bash'
      ? {
          tool_name: tool,
          tool_input: { command: 'printf fake-output' },
          tool_response: { stdout: text, stderr: '' },
        }
      : tool === 'Read'
        ? {
            tool_name: tool,
            tool_input: { file_path: `${project.dir}/config.json` },
            tool_response: {
              type: 'text',
              file: {
                filePath: `${project.dir}/config.json`,
                content: JSON.stringify({ sample: text }),
                numLines: 1,
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
    {
      hook_event_name: 'PostToolUse',
      ...event,
    },
    {
      project,
      extraEnv: {
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        TMPDIR: process.env.TMPDIR,
        ZEROH_CLAUDE_BIN: process.env.ZEROH_CLAUDE_BIN,
      },
    },
  );
  assert.equal(result.code, 0, 'hook completed');
  const output = result.json?.hookSpecificOutput?.updatedToolOutput;
  return output !== undefined && !JSON.stringify(output).includes(value);
}

test('review 52 B1: PostToolUse masks all ten stopword collisions on Bash, MCP and Read', () => {
  const failures = [];
  for (const [i, value] of collisions.entries())
    for (const tool of ['Bash', 'MCP', 'Read'])
      if (!probe(`curl -u "admin:${value}" https://example.com`, value, tool))
        failures.push(`${i}/${tool}`);
  assert.deepEqual(failures, [], 'unmasked collision case ids');
});

test('review 52 B2: PostToolUse masks literal braces, parentheses and apostrophes', () => {
  const value = `${fake}-literal9!`;
  const cases = [
    [`curl -u "admin{:${value}" https://example.com`, value],
    [`curl -u "admin(:${value}" https://example.com`, value],
    ['curl -u "admin:Test\'" https://example.com', "Test'"],
  ];
  const failures = [];
  for (const [i, [text, secret]] of cases.entries())
    for (const tool of ['Bash', 'MCP', 'Read'])
      if (!probe(text, secret, tool)) failures.push(`${i}/${tool}`);
  assert.deepEqual(failures, [], 'unmasked punctuation case ids');
});
