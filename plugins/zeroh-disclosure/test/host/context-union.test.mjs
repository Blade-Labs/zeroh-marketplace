// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { NORMAL_CODE } from '../fixtures/normal-code.mjs';
import { runHook, tempProject } from '../helpers.mjs';
import { detectSensitiveData } from '../../vendor/sensitive-data-detectors/src/index.js';

const fake = 'ZEROH' + 'FAKE9!';
const searchReproductions = [
  ['colon curl credential', `curl -u "admin:123:${fake}"`, `123:${fake}`],
  [
    'colon URL credential',
    `postgres://admin:123:${fake}@db.example.com`,
    `123:${fake}`,
  ],
  [
    'filename-shaped password',
    `password="fake.js:123:${fake}"`,
    `fake.js:123:${fake}`,
  ],
];
const reproductions = [
  ['embedded JSON', `const cfg = '{"password":"${fake}"}';`, fake],
  ['embedded colon', `const note = "password: ${fake}";`, fake],
  [
    'forged reader header',
    '==> b.sh <==\nDB_PASSWORD="${VAULT_PW}"',
    '${VAULT_PW}',
  ],
  [
    'forged search prefix',
    `fake.js:1:const cfg = '{"password":"${fake}"}';`,
    fake,
  ],
];

for (const tool of ['Write', 'Edit'])
  test(`context union metadata: ${tool} retains a password inside a generic INI cover`, () => {
    const address = ['user', 'example.com'].join('@');
    const text = `api_key=${address} ${address}; postgres://admin:${fake}@db.example.com`;
    for (const extension of ['ini', 'unknown']) {
      const project = tempProject({ env: false });
      const toolInput = {
        file_path: path.join(project.dir, `settings.${extension}`),
      };
      if (tool === 'Write') toolInput.content = text;
      else
        Object.assign(toolInput, { old_string: 'ordinary', new_string: text });
      const result = runHook(
        'pre-tool-use',
        {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: toolInput,
        },
        { project },
      );
      assert.equal(result.code, 0, `${tool}/${extension}: hook completed`);
      const updated = result.json?.hookSpecificOutput?.updatedInput;
      assert.ok(updated, `${tool}/${extension}: replacement returned`);
      assert.ok(
        !JSON.stringify(updated).includes(fake),
        `${tool}/${extension}: password protected`,
      );
    }
  });

function hostEvent(project, text, file, surface) {
  const filePath = path.join(project.dir, file);
  if (surface === 'Read' || surface === 'Read-unknown') {
    const target = surface === 'Read' ? filePath : `${filePath}.unknown`;
    return {
      tool_name: 'Read',
      tool_input: { file_path: target },
      tool_response: {
        type: 'text',
        file: {
          filePath: target,
          content: text,
          numLines: text.split('\n').length,
        },
      },
    };
  }
  if (surface === 'MCP')
    return {
      tool_name: 'mcp__fake__result',
      tool_input: {},
      tool_response: { content: [{ type: 'text', text }] },
    };
  if (surface === 'snapshot')
    return {
      tool_name: 'mcp__fake__snapshot',
      tool_input: {},
      tool_response: { snapshot: text },
    };
  const search =
    surface.startsWith('grep') ||
    surface.startsWith('rg') ||
    surface === 'Grep';
  const prefixed = !['grep-h', 'rg-no-filename'].includes(surface);
  const searchText = text
    .split('\n')
    .map((line, i) => `${prefixed ? `${file}:${i + 1}:` : ''}${line}`)
    .join('\n');
  if (surface === 'Grep')
    return {
      tool_name: 'Grep',
      tool_input: { pattern: '.' },
      tool_response: {
        mode: 'content',
        content: searchText,
        numLines: text.split('\n').length,
      },
    };
  const diff = ['diff', 'show'].includes(surface);
  const diffText =
    `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${text.split('\n').length} @@\n` +
    text
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n');
  const command = diff
    ? `git ${surface === 'diff' ? 'diff' : 'show HEAD'}`
    : search
      ? `${surface.startsWith('grep') ? 'grep -rn' : 'rg -n'}${prefixed ? '' : surface === 'grep-h' ? 'h' : ' --no-filename'} . ${file}`
      : `${surface} ${file}`;
  return {
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: {
      stdout: diff ? diffText : search ? searchText : text,
      stderr: '',
    },
  };
}

function hook(project, event) {
  return runHook(
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
}

const surfaces = [
  'Read',
  'Read-unknown',
  'cat',
  'head',
  'tail',
  'less',
  'diff',
  'show',
  'grep',
  'grep-h',
  'rg',
  'rg-no-filename',
  'Grep',
  'snapshot',
  'MCP',
];

test('context union: normal-code corpus preserves unknown spans in every language and profile', () => {
  for (const [file, text] of Object.entries(NORMAL_CODE))
    for (const profile of ['prompt', 'tool', 'secrets']) {
      const unknown = detectSensitiveData(text, { profile, region: null });
      for (const [channel, languages] of Object.entries({
        shell: ['bash', 'powershell', 'cmd'],
        config: [
          'json',
          'yaml',
          'dotenv',
          'env',
          'toml',
          'ini',
          'compose',
          'properties',
        ],
        code: ['javascript', 'typescript', 'python', 'go', 'java', 'rust'],
        prose: ['prose', 'markdown', 'text'],
      }))
        for (const context of languages) {
          const findings = detectSensitiveData(text, {
            profile,
            region: null,
            channel,
            context,
          });
          for (const span of unknown)
            assert.ok(
              findings.some((f) => f.start <= span.start && f.end >= span.end),
              `${file}/${profile}/${context}: unknown span retained`,
            );
        }
    }
});
for (const surface of surfaces) {
  test(`context union: review regressions retain masking through ${surface}`, () => {
    for (const [id, text, value] of reproductions) {
      const project = tempProject({ env: false });
      const event = hostEvent(project, text, 'fake.js', surface);
      const result = hook(project, event);
      assert.equal(result.code, 0, `${id}/${surface}: hook completed`);
      const updated = result.json?.hookSpecificOutput?.updatedToolOutput;
      assert.notEqual(
        updated,
        undefined,
        `${id}/${surface}: replacement returned`,
      );
      assert.ok(
        !JSON.stringify(updated).includes(value),
        `${id}/${surface}: full value masked`,
      );
    }
  });
  test(`context union noise: normal-code corpus stays untouched through ${surface}`, (t) => {
    let count = 0;
    for (const [file, text] of Object.entries(NORMAL_CODE)) {
      const project = tempProject({ env: false });
      const result = hook(project, hostEvent(project, text, file, surface));
      assert.equal(result.code, 0, `${file}/${surface}: hook completed`);
      assert.equal(
        result.json?.hookSpecificOutput?.updatedToolOutput,
        undefined,
        `${file}/${surface}: zero noise`,
      );
      count += 1;
    }
    t.diagnostic(`${surface}: ${count} events, 0 noise`);
  });
}

// Run the actual tools and feed their output to the real host hook. Git uses
// only fixture blobs/trees and no commits. Reader headers and search prefixes
// can therefore be forged by file contents exactly as in the review.
function commandOutput(project, command) {
  const result = spawnSync('bash', ['-c', command], {
    cwd: project.dir,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      LESS: '-FX',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  assert.equal(
    result.error,
    undefined,
    `required fixture program bash failed: ${result.error?.code ?? ''}`,
  );
  assert.ok(
    [0, 1].includes(result.status),
    `fixture program ${command.split(/\s/u)[0]} failed (exit ${result.status}): ${
      result.status === 127 ? 'required external program missing; ' : ''
    }${(result.stderr ?? '').split(/\r?\n/u).slice(0, 3).join('\n')}`,
  );
  return result.stdout;
}

for (const [id, text, value] of searchReproductions)
  for (const command of [
    'grep -rnh . source.txt',
    'rg --no-filename --no-line-number . source.txt',
  ])
    test(`search segmentation regression: ${id}/${command.split(' ')[0]}`, () => {
      const project = tempProject({ env: false });
      writeFileSync(path.join(project.dir, 'source.txt'), `${text}\n`);
      const stdout = commandOutput(project, command);
      assert.ok(
        stdout.includes(value),
        `${id}: actual tool returned the fixture`,
      );
      const result = hook(project, {
        tool_name: 'Bash',
        tool_input: { command },
        tool_response: { stdout, stderr: '' },
      });
      assert.equal(result.code, 0, `${id}: hook completed`);
      const updated = result.json?.hookSpecificOutput?.updatedToolOutput;
      assert.ok(updated, `${id}: replacement returned`);
      assert.ok(
        !JSON.stringify(updated).includes('FAKE9!'),
        `${id}: no password tail exposed`,
      );
    });

test('context union: actual readers, diffs, show and searches resist embedded credentials and forged context', () => {
  for (const [id, text, value] of reproductions) {
    const fixture = tempProject({ env: false });
    writeFileSync(path.join(fixture.dir, 'fake.js'), `${text}\n`);
    writeFileSync(path.join(fixture.dir, 'a.txt'), `${text}\n`);
    writeFileSync(path.join(fixture.dir, 'b.sh'), '# ordinary comment\n');
    writeFileSync(path.join(fixture.dir, 'source.txt'), `${text}\n`);
    mkdirSync(path.join(fixture.dir, 'old'));
    writeFileSync(path.join(fixture.dir, 'old', 'fake.js'), '');
    commandOutput(fixture, 'git init -q');
    const blob = commandOutput(fixture, 'git hash-object -w fake.js').trim();
    assert.match(blob, /^[a-f0-9]{40,64}$/u);
    const commands = [
      'cat fake.js',
      'head fake.js',
      'tail fake.js',
      'less fake.js',
      'cat a.txt b.sh',
      'head -q a.txt b.sh',
      'head a.txt b.sh',
      'tail a.txt b.sh',
      'git diff --no-index old/fake.js fake.js',
      `git show ${blob}`,
      'grep -rHn . fake.js',
      id === 'forged reader header'
        ? 'grep -rh . source.txt'
        : 'grep -rnh . source.txt',
      id === 'forged reader header'
        ? 'grep -r --no-filename . source.txt'
        : 'grep -rn --no-filename . source.txt',
      'rg -H -n . fake.js',
      'rg --no-filename --no-line-number . source.txt',
    ];
    for (const [i, command] of commands.entries()) {
      const stdout = commandOutput(fixture, command);
      assert.ok(
        stdout.includes(value),
        `${id}/command ${i}: fixture contains full value`,
      );
      const project = tempProject({ env: false });
      const result = hook(project, {
        tool_name: 'Bash',
        tool_input: { command },
        tool_response: { stdout, stderr: '' },
      });
      assert.equal(result.code, 0, `${id}/command ${i}: hook completed`);
      const updated = result.json?.hookSpecificOutput?.updatedToolOutput;
      assert.notEqual(
        updated,
        undefined,
        `${id}/command ${i}: replacement returned`,
      );
      assert.ok(
        !JSON.stringify(updated).includes(value),
        `${id}/command ${i}: complete value masked`,
      );
    }
  }
});
