// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { runHook, tempProject } from '../helpers.mjs';
import {
  deniesZeroHSettings,
  protectedShellDecision,
} from '../../packages/shell-analysis/settings-guard.js';

function fixture() {
  const project = tempProject({ env: false });
  mkdirSync(path.dirname(project.settings), { recursive: true });
  mkdirSync(path.join(project.dir, 'src'));
  writeFileSync(project.settings, '{"theme":"light"}');
  const options = {
    env: {
      ...process.env,
      HOME: process.env.HOME,
      ZEROH_HOME: project.home,
      CLAUDE_CONFIG_DIR: path.join(project.home, 'claude'),
      ZEROH_CLAUDE_SETTINGS: project.settings,
    },
  };
  return { project, options };
}

for (const [operation, input] of [
  [
    'write_file',
    {
      path: '.claude/settings.local.json',
      content: '{"disableAllHooks":true}',
    },
  ],
  [
    'write_file',
    {
      file_path: '.claude/settings.local.json',
      content: '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}',
    },
  ],
  [
    'write_file',
    {
      path: '.claude/settings.custom.json',
      content: '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com"}}',
    },
  ],
  [
    'edit_file',
    {
      path: '.claude/settings.local.json',
      edits: [
        { oldText: '"light"', newText: '"light","disableAllHooks":true' },
      ],
    },
  ],
  [
    'move_file',
    { source: 'payload.json', destination: '.claude/settings.local.json' },
  ],
  [
    'move_file',
    {
      sourcePath: '.claude/settings.local.json',
      destinationPath: 'backup.json',
    },
  ],
  ['delete_file', { filePath: '.claude/settings.local.json' }],
  ['remove_directory', { path: '.claude' }],
  ['move_file', { source: '.claude', destination: 'backup' }],
  [
    'apply_patch',
    {
      files: [
        {
          target_path: '.claude/settings.local.json',
          patch: 'unreadable effect',
        },
      ],
    },
  ],
]) {
  test(`FIX-D1: MCP ${operation} protects ${JSON.stringify(input)}`, () => {
    const { project, options } = fixture();
    assert.equal(
      deniesZeroHSettings(
        `mcp__filesystem__${operation}`,
        input,
        project.dir,
        options,
      ),
      true,
    );
  });
}

test('FIX-D1 round 2: non-destructive MCP operations may name project ancestors', () => {
  const { project, options } = fixture();
  for (const [toolName, input] of [
    ['mcp__filesystem__list_directory_with_sizes', { path: project.dir }],
    ['mcp__filesystem__list_directory_with_sizes', { path: '.claude' }],
    ['mcp__filesystem__create_directory', { path: project.dir }],
    ['mcp__filesystem__create_directory', { path: '.' }],
    ['mcp__filesystem__create_directory', { path: path.dirname(project.dir) }],
    ['mcp__x__y', { directory: project.dir }],
    ['mcp__x__y', { dir: '.' }],
  ]) {
    assert.equal(
      deniesZeroHSettings(toolName, input, project.dir, options),
      false,
      `${toolName}: ${JSON.stringify(input)}`,
    );
  }
});

test('FIX-D1: ordinary MCP file work and harmless settings edits pass', () => {
  const { project, options } = fixture();
  for (const [operation, input] of [
    ['write_file', { path: 'src/file.txt', content: 'ordinary text' }],
    [
      'write_file',
      {
        path: 'src/README.md',
        content:
          'Documentation about .zeroh.env and .claude/settings.local.json',
      },
    ],
    [
      'edit_file',
      { path: 'src/file.txt', edits: [{ oldText: 'a', newText: 'b' }] },
    ],
    ['move_file', { source: 'src/a', destination: 'src/b' }],
    ['delete_file', { path: 'src/file.txt' }],
    [
      'write_file',
      { path: '.claude/settings.local.json', content: '{"theme":"dark"}' },
    ],
    [
      'edit_file',
      {
        path: '.claude/settings.local.json',
        edits: [{ oldText: 'light', newText: 'dark' }],
      },
    ],
    ['read_file', { path: '.claude/settings.local.json' }],
    ['search', { query: 'Claude settings documentation' }],
  ]) {
    assert.equal(
      deniesZeroHSettings(
        `mcp__filesystem__${operation}`,
        input,
        project.dir,
        options,
      ),
      false,
      operation,
    );
  }
  const result = runHook(
    'pre-tool-use',
    {
      cwd: project.dir,
      tool_name: 'mcp__filesystem__write_file',
      tool_input: {
        path: project.settings,
        content: '{"disableAllHooks":true}',
      },
    },
    { project },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.json?.hookSpecificOutput?.permissionDecision,
    'deny',
    result.stdout,
  );
  assert.match(
    result.json.hookSpecificOutput.permissionDecisionReason,
    /only.*user|user.*only/i,
  );
});

test('FIX-D1: MCP aliases, invalid documents and unknown protected effects are denied', () => {
  const { project, options } = fixture();
  const alias = path.join(project.dir, 'alias.json');
  symlinkSync(project.settings, alias);
  for (const [operation, input] of [
    ['write_file', { path: alias, content: '{"disableAllHooks":true}' }],
    ['write_file', { path: project.settings, content: 'invalid JSON' }],
    [
      'edit_file',
      {
        path: project.settings,
        edits: [{ oldText: 'missing', newText: '{}' }],
      },
    ],
    ['unknown_mutation', { paths: [project.settings] }],
    ['read_and_write_file', { path: project.settings, content: '{}' }],
    ['read_file', { path: path.join(project.home, 'vault.key') }],
    ['move_file', { source: project.home, destination: 'backup' }],
  ])
    assert.equal(
      deniesZeroHSettings(
        `mcp__filesystem__${operation}`,
        input,
        project.dir,
        options,
      ),
      true,
      operation,
    );
});

test('FIX-D1: local file URIs and source/destination file aliases carry protected paths', () => {
  const { project, options } = fixture();
  for (const [operation, input] of [
    [
      'write_file',
      {
        uri: pathToFileURL(project.settings).href,
        content: '{"disableAllHooks":true}',
      },
    ],
    [
      'move_file',
      { source_file: 'payload.json', destination_file: project.settings },
    ],
  ])
    assert.equal(
      deniesZeroHSettings(
        `mcp__filesystem__${operation}`,
        input,
        project.dir,
        options,
      ),
      true,
      operation,
    );
  assert.equal(
    deniesZeroHSettings(
      'mcp__filesystem__write_file',
      {
        uri: pathToFileURL(path.join(project.dir, 'src', 'file.txt')).href,
        content: 'ordinary text',
      },
      project.dir,
      options,
    ),
    false,
  );
  assert.equal(
    deniesZeroHSettings(
      'mcp__filesystem__apply_patch',
      [
        {
          file_uri: pathToFileURL(
            path.join(options.env.CLAUDE_CONFIG_DIR, 'settings.json'),
          ).href,
          patch: 'unknown effect',
        },
      ],
      project.dir,
      options,
    ),
    true,
  );
});

test('FIX-D1 round 2: MCP settings edits with duplicate oldText are denied', () => {
  const { project, options } = fixture();
  writeFileSync(
    project.settings,
    JSON.stringify({
      theme: 'light',
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'echo light' }] }],
      },
    }),
  );
  assert.equal(
    deniesZeroHSettings(
      'mcp__filesystem__edit_file',
      {
        path: project.settings,
        edits: [{ oldText: 'light', newText: 'dark' }],
      },
      project.dir,
      options,
    ),
    true,
  );
});

test('FIX-D1 round 2: a unique harmless MCP settings edit preserves hooks', () => {
  const { project, options } = fixture();
  writeFileSync(
    project.settings,
    JSON.stringify({
      theme: 'light',
      hooks: {
        PreToolUse: [
          { hooks: [{ type: 'command', command: 'echo ZEROHFAKE' }] },
        ],
      },
    }),
  );
  assert.equal(
    deniesZeroHSettings(
      'mcp__filesystem__edit_file',
      {
        path: project.settings,
        edits: [{ oldText: 'light', newText: 'dark' }],
      },
      project.dir,
      options,
    ),
    false,
  );
});

for (const event of [
  'UserPromptSubmit',
  'PreToolUse',
  'SessionStart',
  'Stop',
]) {
  test(`FIX-D2: adding or changing ${event} executable hooks is user-only`, () => {
    const { project, options } = fixture();
    const document = (command) => ({
      hooks: { [event]: [{ hooks: [{ type: 'command', command }] }] },
    });
    const input = {
      file_path: project.settings,
      content: JSON.stringify(document('echo ZEROHFAKE')),
    };
    assert.equal(
      deniesZeroHSettings('Write', input, project.dir, options),
      true,
    );
    writeFileSync(project.settings, input.content);
    assert.equal(
      deniesZeroHSettings(
        'Write',
        { ...input, content: JSON.stringify(document('echo changed')) },
        project.dir,
        options,
      ),
      true,
    );
    assert.equal(
      deniesZeroHSettings(
        'Write',
        { file_path: project.settings, content: '{}' },
        project.dir,
        options,
      ),
      true,
      'removal of existing protection hooks',
    );
    assert.equal(
      deniesZeroHSettings(
        'Edit',
        {
          file_path: project.settings,
          old_string: 'ZEROHFAKE',
          new_string: 'changed',
        },
        project.dir,
        options,
      ),
      true,
    );
  });
}

test('FIX-D2: unrelated model settings edits and user editor hook edits pass', () => {
  const { project, options } = fixture();
  const settings = {
    theme: 'light',
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ZEROHFAKE' }] }],
    },
  };
  // The user editor writes directly: no model PreToolUse invocation is made.
  writeFileSync(project.settings, JSON.stringify(settings));
  assert.deepEqual(
    JSON.parse(readFileSync(project.settings, 'utf8')),
    settings,
  );
  assert.equal(
    deniesZeroHSettings(
      'Edit',
      { file_path: project.settings, old_string: 'light', new_string: 'dark' },
      project.dir,
      options,
    ),
    false,
  );
  const result = runHook(
    'pre-tool-use',
    {
      cwd: project.dir,
      tool_name: 'Read',
      tool_input: { file_path: 'src/file.txt' },
    },
    { project },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.notEqual(
    result.json?.hookSpecificOutput?.permissionDecision,
    'deny',
    result.stdout,
  );
});

test('FIX-D round 2: Claude hook denials explain the user hook workflow', () => {
  const { project } = fixture();
  const reason =
    'Claude Code hooks can only be changed by the user: add them with /hooks or in your editor.';
  const before = {
    theme: 'light',
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'echo ZEROHFAKE' }] }],
    },
  };
  writeFileSync(project.settings, JSON.stringify(before));
  for (const [tool_name, tool_input] of [
    [
      'Write',
      {
        file_path: project.settings,
        content: JSON.stringify({ ...before, hooks: { SessionStart: [] } }),
      },
    ],
    [
      'Edit',
      {
        file_path: project.settings,
        old_string: 'echo ZEROHFAKE',
        new_string: 'echo changed',
      },
    ],
    [
      'MultiEdit',
      {
        file_path: project.settings,
        edits: [{ old_string: 'echo ZEROHFAKE', new_string: 'echo changed' }],
      },
    ],
    ['Write', { file_path: project.settings, content: '{"theme":"light"}' }],
    [
      'mcp__filesystem__write_file',
      { path: project.settings, content: '{"hooks":{"SessionStart":[]}}' },
    ],
    [
      'mcp__filesystem__edit_file',
      {
        path: project.settings,
        edits: [{ oldText: 'echo ZEROHFAKE', newText: 'echo changed' }],
      },
    ],
  ]) {
    const result = runHook(
      'pre-tool-use',
      { cwd: project.dir, tool_name, tool_input },
      { project },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.json?.hookSpecificOutput?.permissionDecision,
      'deny',
      result.stdout,
    );
    assert.equal(
      result.json.hookSpecificOutput.permissionDecisionReason,
      reason,
      tool_name,
    );
  }
  const read = runHook(
    'pre-tool-use',
    {
      cwd: project.dir,
      tool_name: 'Read',
      tool_input: { file_path: project.settings },
    },
    { project },
  );
  assert.equal(read.code, 0, read.stderr);
  assert.notEqual(
    read.json?.hookSpecificOutput?.permissionDecision,
    'deny',
    read.stdout,
  );
  const zeroh = runHook(
    'pre-tool-use',
    {
      cwd: project.dir,
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(project.home, 'config.env'),
        content: 'ZEROHFAKE=x',
      },
    },
    { project },
  );
  assert.match(
    zeroh.json?.hookSpecificOutput?.permissionDecisionReason,
    /ZeroH Disclosure settings can only be changed by the user/u,
  );
});

test('FIX-D2: every guarded settings scope protects command, prompt and agent hooks', () => {
  const { project, options } = fixture();
  for (const target of [
    project.settings,
    path.join(project.dir, '.claude', 'settings.json'),
    path.join(project.dir, '.claude', 'settings.custom.json'),
    path.join(project.dir, 'managed-settings.json'),
    path.join(options.env.CLAUDE_CONFIG_DIR, 'settings.json'),
    path.join(options.env.CLAUDE_CONFIG_DIR, 'settings.local.json'),
  ]) {
    for (const type of ['command', 'prompt', 'agent']) {
      const content = JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: '*',
              hooks: [{ type, command: 'echo ZEROHFAKE', prompt: 'ZEROHFAKE' }],
            },
          ],
        },
      });
      assert.equal(
        deniesZeroHSettings(
          'Write',
          { file_path: target, content },
          project.dir,
          options,
        ),
        true,
        `${target}: ${type}`,
      );
      assert.equal(
        deniesZeroHSettings(
          'mcp__filesystem__write_file',
          { path: target, content },
          project.dir,
          options,
        ),
        true,
        `${target}: MCP ${type}`,
      );
    }
  }
});

for (const command of [
  'cd .claude && printf x > settings.local.json',
  'pushd .claude; echo x > settings.json; popd',
  'cd src; cd ../.claude; echo x > settings.json',
  '(cd .claude && echo x > settings.json)',
  'bash -c "cd .claude && echo x > settings.json"',
]) {
  test(`FIX-D3: shell directory changes protect relative targets: ${command}`, () => {
    const { project, options } = fixture();
    for (const mode of ['pass', 'block']) {
      assert.equal(
        protectedShellDecision('Bash', { command }, project.dir, {
          ...options,
          mode,
        }).deny,
        true,
        mode,
      );
    }
  });
}

for (const command of [
  'cd "$ZEROHFAKE_DIR" && echo x > settings.local.json',
  'cd "$(echo .claude)"; rm settings.json',
  'HOME=.claude; cd ~ && echo x > settings.local.json',
  'export HOME=.claude; cd ~ && rm settings.local.json',
  'pushd src; HOME=.claude; popd; cd ~ && echo x > settings.local.json',
  'cd "$WS/.vscode" && cat > settings.json',
  'cd $TMPDIR && printf x > config.env',
]) {
  test(`FIX-D3 round 2: unknown directories follow uncertain mode: ${command}`, () => {
    const { project, options } = fixture();
    const pass = protectedShellDecision('Bash', { command }, project.dir, {
      ...options,
      mode: 'pass',
    });
    assert.equal(pass.deny, false, 'pass mode');
    assert.equal(pass.unchecked, 'script-or-interpreter', 'pass mode notice');
    const block = protectedShellDecision('Bash', { command }, project.dir, {
      ...options,
      mode: 'block',
    });
    assert.equal(block.deny, true, 'block mode');
    assert.equal(
      block.unchecked,
      null,
      'denied calls have no unchecked notice',
    );
  });
}

test('FIX-D3: actual event cwd is used while project policy keeps its root', () => {
  const { project, options } = fixture();
  for (const mode of ['pass', 'block']) {
    const commandCwd = path.dirname(project.settings);
    assert.equal(
      protectedShellDecision(
        'Bash',
        { command: 'echo x > settings.local.json' },
        project.dir,
        { ...options, mode, commandCwd },
      ).deny,
      true,
    );
    assert.equal(
      deniesZeroHSettings(
        'Bash',
        { command: 'echo x > settings.local.json' },
        project.dir,
        { ...options, mode, commandCwd },
      ),
      true,
    );
    const result = runHook(
      'pre-tool-use',
      {
        cwd: commandCwd,
        tool_name: 'Bash',
        tool_input: { command: 'printf x > settings.local.json' },
      },
      { project, extraEnv: { ZEROH_UNCERTAIN: mode } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      result.json?.hookSpecificOutput?.permissionDecision,
      'deny',
      result.stdout,
    );
  }
});

test('FIX-D3: a failed conditional cd keeps the previous protected cwd possible', () => {
  const { project, options } = fixture();
  assert.equal(
    protectedShellDecision(
      'Bash',
      {
        command: 'cd missing && cd src || echo x > settings.local.json',
      },
      project.dir,
      { ...options, mode: 'pass', commandCwd: path.dirname(project.settings) },
    ).deny,
    true,
  );
});

test('FIX-D3: ordinary relative shell writes and directory navigation pass', () => {
  const { project, options } = fixture();
  for (const command of [
    'cd src && echo x > file',
    'cd src && echo x > settings.local.json',
    'pushd src; echo x > file; popd',
    'cd "$ZEROHFAKE_DIR" && echo x > ordinary.txt',
    'echo settings.local.json',
  ]) {
    for (const mode of ['pass', 'block']) {
      assert.equal(
        protectedShellDecision('Bash', { command }, project.dir, {
          ...options,
          mode,
        }).deny,
        false,
        `${mode}: ${command}`,
      );
    }
  }
  for (const command of [
    '(cd .claude && echo x > ordinary.txt); (echo x > settings.local.json)',
    'cd .claude | cat; echo x > settings.local.json',
    'bash -c "cd src && echo x > ordinary.txt"; echo x > settings.local.json',
  ])
    assert.equal(
      protectedShellDecision('Bash', { command }, project.dir, {
        ...options,
        mode: 'pass',
      }).deny,
      false,
      command,
    );
});
