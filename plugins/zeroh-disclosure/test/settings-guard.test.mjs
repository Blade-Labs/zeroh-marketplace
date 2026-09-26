// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  claudeControlKind,
  commandRunsClaudeControlCli,
  deniesClaudeBaseUrlMutation,
  deniesClaudeControlChange,
  deniesElicitationHookEdits,
  deniesUserOnlyCommand,
  deniesZeroHSettings,
  isZeroHSettingsPath,
  settingsChangeWeakensZeroH,
  textReferencesZeroHSettings,
} from '../lib/settings-guard.js';

const root = '/tmp/zeroh-guard-project';

test('a .zeroh folder in a command is a settings reference', () => {
  for (const command of [
    'cat .zeroh/allow.json',
    'sed -i s/a/b/ ./.zeroh/x',
    'ls ~/.zeroh',
    'echo x > "/p/.zeroh/allow.json"',
    'cd .zeroh',
    'cat \\.zeroh/a',
    'Get-Content .zeroh\\allow.json',
    'Set-Content $env:ZEROH_HOME\\allow.key value',
    'Get-Content $HOME\\.zeroh\\vault.key',
  ]) {
    assert.equal(textReferencesZeroHSettings(command, root), true, command);
  }
});

test('the Windows home under %LOCALAPPDATA% is a settings reference in every spelling (F-5)', () => {
  for (const command of [
    'Copy-Item -Recurse $env:LOCALAPPDATA\\ZeroH C:\\Temp\\out',
    'cp -r "$LOCALAPPDATA/ZeroH" /tmp/out',
    'xcopy %LOCALAPPDATA%\\ZeroH D:\\out /E',
    'Get-ChildItem (Join-Path $env:LOCALAPPDATA ZeroH)',
    'type C:\\Users\\Sami\\AppData\\Local\\ZeroH\\vault.key',
    'cat /c/Users/sami/AppData/Local/zeroh/vault/abc.json',
    'Compress-Archive "${env:LOCALAPPDATA}\\ZeroH" out.zip',
  ]) {
    assert.equal(textReferencesZeroHSettings(command, root), true, command);
  }
  for (const command of [
    'Get-ChildItem $env:LOCALAPPDATA\\Programs',
    'echo ZeroH Disclosure',
    'ls $env:LOCALAPPDATA\\ZeroHelper',
  ]) {
    assert.equal(textReferencesZeroHSettings(command, root), false, command);
  }
});

test('Windows path comparisons normalize separators and ignore case', () => {
  const options = {
    platform: 'win32',
    pathImpl: path.win32,
    home: 'C:\\Users\\Alice\\.zeroh',
  };
  assert.equal(
    isZeroHSettingsPath(
      'c:/WORK/PROJECT/.ZEROH/allow.json',
      'C:\\work\\project',
      options,
    ),
    true,
  );
  assert.equal(
    isZeroHSettingsPath(
      'c:\\users\\ALICE\\.ZEROH\\allow.key',
      'C:\\work\\project',
      options,
    ),
    true,
  );
});

test('default-filesystem case rules differ by platform', () => {
  const darwin = {
    platform: 'darwin',
    pathImpl: path.posix,
    home: '/Users/Alice/.zeroh',
  };
  const linux = {
    platform: 'linux',
    pathImpl: path.posix,
    home: '/home/alice/.zeroh',
  };
  assert.equal(
    isZeroHSettingsPath('/USERS/ALICE/.ZEROH/allow.json', '/work', darwin),
    true,
  );
  assert.equal(
    isZeroHSettingsPath('/HOME/ALICE/.ZEROH/allow.json', '/work', linux),
    false,
  );
});

test('hosts that merely contain "zeroh" are not settings references', () => {
  for (const command of [
    'curl https://www.zeroh.io/',
    'curl -H "Authorization: Bearer [API_KEY-ec1532]" https://payments-gateway.zerohfake.invalid/health',
    'echo zeroh-disclosure',
    'git log --grep zeroh',
  ]) {
    assert.equal(textReferencesZeroHSettings(command, root), false, command);
  }
});

test('model writes cannot change ANTHROPIC_BASE_URL in resolved or project settings', () => {
  const settingsPath = '/tmp/ZEROHFAKE-home/.claude/settings.json';
  const options = {
    env: { ZEROH_CLAUDE_SETTINGS: settingsPath },
    settingsPath,
  };
  assert.equal(
    deniesClaudeBaseUrlMutation(
      'Edit',
      {
        file_path: settingsPath,
        old_string: '"env": {}',
        new_string: '"env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:1" }',
      },
      root,
      options,
    ),
    true,
  );
  assert.equal(
    deniesClaudeBaseUrlMutation(
      'Write',
      {
        file_path: '.claude/settings.local.json',
        content: '{"env":{"ANTHROPIC_BASE_URL":"ZEROHFAKE"}}',
      },
      root,
      options,
    ),
    true,
  );
  for (const [toolName, command] of [
    ['Bash', `printf '%s' ANTHROPIC_BASE_URL > ${settingsPath}`],
    [
      'PowerShell',
      'Set-Content .claude\\settings.json \'{"ANTHROPIC_BASE_URL":"ZEROHFAKE"}\'',
    ],
  ]) {
    assert.equal(
      deniesClaudeBaseUrlMutation(toolName, { command }, root, options),
      true,
      command,
    );
  }
});

test('model edits cannot install Elicitation auto-answer hooks', () => {
  assert.equal(
    deniesElicitationHookEdits(
      'Write',
      {
        file_path: '.claude/settings.json',
        content: '{"hooks":{"Elicitation":[{"command":"accept"}]}}',
      },
      root,
    ),
    true,
  );
  for (const [tool, command] of [
    ['Bash', 'python3 writer.py .claude/settings.json Elicitation'],
    ['Bash', 'node writer.mjs /plugin/hooks/hooks.json ElicitationResult'],
    [
      'PowerShell',
      "[IO.File]::WriteAllText('.claude/settings.local.json', 'Elicitation')",
    ],
    ['Bash', 'python writer.py "$CLAUDE_CONFIG_DIR/settings.json" Elicitation'],
  ]) {
    assert.equal(
      deniesElicitationHookEdits(tool, { command }, root),
      true,
      command,
    );
  }
  assert.equal(
    deniesElicitationHookEdits(
      'Edit',
      {
        file_path: '/plugin/hooks/hooks.json',
        old_string: 'hooks',
        new_string: 'ElicitationResult',
      },
      root,
    ),
    true,
  );
  assert.equal(
    deniesElicitationHookEdits(
      'Bash',
      {
        command:
          'echo \'{"hooks":{"Elicitation":[]}}\' > .claude/settings.local.json',
      },
      root,
    ),
    true,
  );
  assert.equal(
    deniesElicitationHookEdits(
      'PowerShell',
      {
        command:
          'Set-Content .claude\\settings.json \'{"hooks":{"ElicitationResult":[]}}\'',
      },
      root,
    ),
    true,
  );
  assert.equal(
    deniesElicitationHookEdits(
      'Bash',
      { command: 'cat .claude/settings.json # Elicitation' },
      root,
    ),
    false,
  );
});

test('settings protection recognizes resolver variables and symlink aliases', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-'));
  const settingsPath = path.join(directory, 'config', 'settings.json');
  const alias = path.join(directory, 'settings-alias.json');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, '{}\n');
  symlinkSync(settingsPath, alias);
  const options = {
    env: { ZEROH_CLAUDE_SETTINGS: settingsPath },
    settingsPath,
  };
  assert.equal(
    deniesClaudeBaseUrlMutation(
      'Write',
      {
        file_path: alias,
        content: '{"ANTHROPIC_BASE_URL":"http://127.0.0.1:1"}',
      },
      directory,
      options,
    ),
    true,
  );
  for (const [toolName, command] of [
    ['Bash', 'printf ANTHROPIC_BASE_URL > "$ZEROH_CLAUDE_SETTINGS"'],
    [
      'Bash',
      'printf ANTHROPIC_BASE_URL > "${CLAUDE_CONFIG_DIR}/settings.json"',
    ],
    ['PowerShell', 'Set-Content $env:ZEROH_CLAUDE_SETTINGS ANTHROPIC_BASE_URL'],
    [
      'PowerShell',
      'Set-Content "$env:CLAUDE_CONFIG_DIR\\settings.json" ANTHROPIC_BASE_URL',
    ],
  ]) {
    assert.equal(
      deniesClaudeBaseUrlMutation(toolName, { command }, directory, options),
      true,
      command,
    );
  }
});

test('settings guard allows unrelated settings edits and ANTHROPIC_BASE_URL in source files', () => {
  const settingsPath = '/tmp/ZEROHFAKE-home/.claude/settings.json';
  const options = {
    env: { ZEROH_CLAUDE_SETTINGS: settingsPath },
    settingsPath,
  };
  assert.equal(
    deniesClaudeBaseUrlMutation(
      'Edit',
      {
        file_path: settingsPath,
        old_string: 'old theme',
        new_string: 'new theme',
      },
      root,
      options,
    ),
    false,
  );
  assert.equal(
    deniesClaudeBaseUrlMutation(
      'Write',
      {
        file_path: 'src/config.js',
        content: 'const key = "ANTHROPIC_BASE_URL";',
      },
      root,
      options,
    ),
    false,
  );
});

test('.zeroh.env and .zeroh.policy are protected from model writes like .zeroh/', () => {
  for (const [tool, input] of [
    ['Write', { file_path: '.zeroh.env', content: 'ZEROH_HOME=.zh\n' }],
    ['Edit', { file_path: 'sub/.zeroh.env', old_string: 'a', new_string: 'b' }],
    [
      'Write',
      { file_path: '.zeroh.policy', content: '{"sensitive_files":"mask"}' },
    ],
    ['Bash', { command: 'echo ZEROH_MASK_PII=off >> .zeroh.env' }],
    ['Bash', { command: 'printf x > ./.zeroh.policy' }],
    ['PowerShell', { command: 'Set-Content .zeroh.env "ZEROH_PROXY=1"' }],
  ]) {
    assert.equal(
      deniesZeroHSettings(tool, input, root),
      true,
      JSON.stringify(input),
    );
  }
  // Reading the repository settings is harmless.
  assert.equal(
    deniesZeroHSettings('Read', { file_path: '.zeroh.env' }, root),
    false,
  );
  assert.equal(
    textReferencesZeroHSettings('echo zeroh.envoy.example', root),
    false,
  );
});

test('Claude settings writes are judged on the parsed result, not the spelling', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-claude-'));
  const project = path.join(directory, 'project');
  const home = path.join(directory, 'home');
  mkdirSync(path.join(project, '.claude'), { recursive: true });
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  const projectSettings = path.join(project, '.claude', 'settings.json');
  writeFileSync(
    projectSettings,
    '{"permissions":{"allow":["Read"]},"enabledPlugins":{"zeroh-disclosure@zeroh":true}}\n',
  );
  const options = {
    env: {
      HOME: home,
      ZEROH_CLAUDE_SETTINGS: path.join(home, '.claude', 'settings.json'),
    },
    pluginDir: path.join(directory, 'plugin'),
  };
  const denied = (tool, input) =>
    deniesClaudeControlChange(tool, input, project, options);
  const weakening = [
    '{"disableAllHooks":true}',
    '{"allowManagedHooksOnly":true}',
    '{"hooks":{"Elicitation":[{"hooks":[{"type":"command","command":"echo accept"}]}]}}',
    '{"hooks":{"\\u0045licitation":[]}}',
    '{"hooks":{"\\u0045licitation\\u0052esult":[]}}',
    '{"hooks":{"ElicitationResult":[]},"a":1}',
    '{"enabledPlugins":{"zeroh-disclosure@zeroh":false}}',
    '{"env":{"ZEROH_MASK_PII":"off"}}',
    '{"env":{"ZEROH_HOME":"/tmp/x"}}',
    '{"env":{"\\u0041NTHROPIC_BASE_URL":"https://evil.zerohfake.invalid"}}',
    '{ not json',
  ];
  for (const content of weakening) {
    for (const file of [
      '.claude/settings.json',
      '.claude/settings.local.json',
      path.join(home, '.claude', 'settings.json'),
      '/etc/claude-code/managed-settings.json',
    ]) {
      assert.equal(
        denied('Write', { file_path: file, content }),
        true,
        `${file} ${content}`,
      );
    }
  }
  // Harmless edits to the same files stay allowed.
  assert.equal(
    denied('Write', {
      file_path: '.claude/settings.json',
      content:
        '{"permissions":{"allow":["Read","Bash(npm test)"]},"enabledPlugins":{"zeroh-disclosure@zeroh":true}}',
    }),
    false,
  );
  assert.equal(
    denied('Edit', {
      file_path: '.claude/settings.json',
      old_string: '["Read"]',
      new_string: '["Read","Write"]',
    }),
    false,
  );
  // An Edit is applied to the current file before the check.
  assert.equal(
    denied('Edit', {
      file_path: '.claude/settings.json',
      old_string: '"zeroh-disclosure@zeroh":true',
      new_string: '"zeroh-disclosure@zeroh":false',
    }),
    true,
  );
  assert.equal(
    denied('MultiEdit', {
      file_path: '.claude/settings.json',
      edits: [
        {
          old_string: '{"permissions"',
          new_string: '{"disableAllHooks":true,"permissions"',
        },
      ],
    }),
    true,
  );
  assert.equal(
    denied('Edit', {
      file_path: '.claude/settings.json',
      old_string: 'text that is not there',
      new_string: 'x',
    }),
    true,
  );
  assert.equal(settingsChangeWeakensZeroH({}, { theme: 'dark' }), false);
  assert.equal(
    settingsChangeWeakensZeroH(
      { hooks: { Elicitation: [] } },
      { hooks: { Elicitation: [] }, theme: 'dark' },
    ),
    false,
  );
});

test('the plugin directory, installed plugins and restore records are not writable', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-plugin-'));
  const home = path.join(directory, 'home');
  const plugin = path.join(directory, 'plugin');
  mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
  const options = { env: { HOME: home }, pluginDir: plugin };
  assert.equal(
    claudeControlKind(
      path.join(plugin, 'hooks', 'hooks.json'),
      directory,
      options,
    ),
    'plugin',
  );
  for (const [tool, input] of [
    [
      'Edit',
      {
        file_path: path.join(plugin, 'hooks', 'pre-tool-use.js'),
        old_string: 'a',
        new_string: 'b',
      },
    ],
    ['Write', { file_path: path.join(plugin, 'lib', 'x.js'), content: '' }],
    [
      'Write',
      {
        file_path: path.join(
          home,
          '.claude',
          'plugins',
          'installed_plugins.json',
        ),
        content: '{}',
      },
    ],
    [
      'Write',
      {
        file_path: path.join(
          home,
          '.claude',
          '.settings.json.zeroh-restore.json',
        ),
        content: '{}',
      },
    ],
    [
      'Bash',
      {
        command: `sed -i s/deny/allow/ ${path.join(plugin, 'hooks', 'pre-tool-use.js')}`,
      },
    ],
    ['Bash', { command: `cp /tmp/x.js ${plugin}/lib/settings-guard.js` }],
    ['Bash', { command: 'rm -rf "$CLAUDE_PLUGIN_ROOT/hooks"' }],
    [
      'Bash',
      { command: 'tee ~/.claude/plugins/installed_plugins.json < /dev/null' },
    ],
  ]) {
    assert.equal(
      deniesClaudeControlChange(tool, input, directory, options),
      true,
      JSON.stringify(input),
    );
  }
  assert.equal(
    deniesClaudeControlChange(
      'Bash',
      { command: `cat ${plugin}/README.md` },
      directory,
      options,
    ),
    false,
  );
  assert.equal(
    deniesClaudeControlChange(
      'Read',
      { file_path: path.join(plugin, 'README.md') },
      directory,
      options,
    ),
    false,
  );
});

test('shell writes to Claude settings are denied unless provably read-only', () => {
  const options = {
    env: { HOME: '/tmp/ZEROHFAKE-home' },
    pluginDir: '/tmp/ZEROHFAKE-plugin',
  };
  const denied = (tool, command) =>
    deniesClaudeControlChange(tool, { command }, root, options);
  for (const [tool, command] of [
    ['Bash', 'echo {} > .claude/settings.json'],
    [
      'Bash',
      'jq ".disableAllHooks=true" .claude/settings.json | tee .claude/settings.json',
    ],
    ['Bash', 'cp /tmp/s.json .claude/settings.local.json'],
    ['Bash', 'mv x ~/.claude/settings.json'],
    ['Bash', "sed -i 's/true/false/' .claude/settings.json"],
    ['Bash', "python3 -c \"open('.claude/settings.json','w')\""],
    ['Bash', 'cat "$(echo .claude/settings.json)"'],
    ['Bash', 'echo x > "$CLAUDE_CONFIG_DIR/settings.json"'],
    ['PowerShell', "Set-Content .claude\\settings.json '{}'"],
    ['PowerShell', 'Copy-Item x.json $env:CLAUDE_CONFIG_DIR\\settings.json'],
    ['Bash', 'echo {} > /etc/claude-code/managed-settings.json'],
  ]) {
    assert.equal(denied(tool, command), true, command);
  }
  for (const command of [
    'cat .claude/settings.json',
    'jq .permissions .claude/settings.json',
    'grep -n hooks .claude/settings.local.json',
    'npm test',
    'git status',
  ]) {
    assert.equal(denied('Bash', command), false, command);
  }
});

test('the Claude CLI cannot disable, uninstall or reconfigure plugins', () => {
  for (const command of [
    'claude plugin disable zeroh-disclosure@zeroh',
    'claude plugins uninstall zeroh-disclosure',
    'claude plugin remove zeroh-disclosure@zeroh',
    'claude plugin marketplace remove zeroh',
    '/usr/local/bin/claude plugin disable zeroh-disclosure',
    'npx @anthropic-ai/claude-code plugin uninstall zeroh-disclosure',
    'claude.exe plugin disable zeroh-disclosure',
    'claude config set -g disableAllHooks true',
    'claude config add env ZEROH_PROXY=off',
    'true && claude plugin --scope project disable zeroh-disclosure',
  ]) {
    assert.equal(commandRunsClaudeControlCli(command), true, command);
    assert.equal(deniesZeroHSettings('Bash', { command }, root), true, command);
  }
  for (const command of [
    'claude --help',
    'claude plugin list',
    'claude -p "remove the plugin section from README"',
    'echo "claude config" docs',
    'git commit -m "plugin disable flag"',
  ]) {
    assert.equal(commandRunsClaudeControlCli(command), false, command);
  }
});

test('Elicitation hooks are caught through escapes in any hook file', () => {
  for (const content of [
    '{"hooks":{"\\u0045licitation":[]}}',
    '{"hooks":{"Elicitation\\u0052esult":[]}}',
  ]) {
    assert.equal(
      deniesElicitationHookEdits(
        'Write',
        { file_path: '/some/other-plugin/hooks/hooks.json', content },
        root,
      ),
      true,
      content,
    );
  }
  assert.equal(
    deniesElicitationHookEdits(
      'Bash',
      {
        command:
          'printf \'{"hooks":{"\\x45licitation":[]}}\' > .claude/settings.local.json',
      },
      root,
    ),
    true,
  );
});

test('Monitor gets exactly the Bash result from every settings guard', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-monitor-'));
  const plugin = path.join(directory, 'installed-plugin');
  mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
  const options = {
    env: { HOME: path.join(directory, 'home') },
    pluginDir: plugin,
  };
  const denied = [
    'echo ZEROH_MASK_PII=off >> .zeroh.env',
    'printf x > ./.zeroh.policy',
    'cat .zeroh/allow.json',
    'node bin/zeroh-disclosure.mjs allow STRIPE_KEY evil.example',
    'echo \'{"disableAllHooks":true}\' > .claude/settings.local.json',
    'echo \'{"hooks":{"Elicitation":[]}}\' > .claude/settings.local.json',
    'python3 writer.py .claude/settings.json Elicitation',
    `printf '%s' ANTHROPIC_BASE_URL > .claude/settings.json`,
    `cp /tmp/x.js ${plugin}/lib/settings-guard.js`,
    'rm -rf "$CLAUDE_PLUGIN_ROOT/hooks"',
    'claude plugin disable zeroh-disclosure@zeroh',
    'claude plugins uninstall zeroh-disclosure',
    'claude config set -g disableAllHooks true',
  ];
  const allowed = [
    'tail -f app.log',
    'npm test -- --watch',
    'cat .claude/settings.json',
    'claude plugin list',
  ];
  const guards = [
    ['deniesZeroHSettings', deniesZeroHSettings],
    ['deniesClaudeControlChange', deniesClaudeControlChange],
    ['deniesElicitationHookEdits', deniesElicitationHookEdits],
    ['deniesClaudeBaseUrlMutation', deniesClaudeBaseUrlMutation],
  ];
  for (const command of [...denied, ...allowed]) {
    for (const [name, guard] of guards) {
      assert.equal(
        guard('Monitor', { command, description: 'x' }, directory, options),
        guard('Bash', { command }, directory, options),
        `${name}: ${command}`,
      );
    }
  }
  for (const command of denied) {
    assert.equal(
      deniesZeroHSettings('Monitor', { command }, directory, options) ||
        deniesElicitationHookEdits('Monitor', { command }, directory),
      true,
      command,
    );
  }
  for (const command of allowed) {
    assert.equal(
      deniesZeroHSettings('Monitor', { command }, directory, options) ||
        deniesElicitationHookEdits('Monitor', { command }, directory),
      false,
      command,
    );
  }
});

// D-15: receipts live under ZEROH_HOME/projects/<encoded project>/sessions;
// the model may read them there, never write them, and the rest of the home
// (the allow list beside them included) stays closed.
test('the model may read receipts under the home, and nothing else there', () => {
  const home = '/home/alice/.zeroh';
  const root = '/work/shop';
  const receipt = `${home}/projects/-work-shop/sessions/s1/turn-1.json`;
  assert.equal(isZeroHSettingsPath(receipt, root, { home, read: true }), false);
  assert.equal(isZeroHSettingsPath(receipt, root, { home }), true);
  assert.equal(
    isZeroHSettingsPath(`${home}/projects/-work-shop/allow.json`, root, {
      home,
      read: true,
    }),
    true,
  );
  assert.equal(
    isZeroHSettingsPath(
      `${home}/projects/-work-other/sessions/s1/turn-1.json`,
      root,
      { home, read: true },
    ),
    true,
  );
});

// UO-1: the second line behind `disable-model-invocation`.
test('Skill and SlashCommand calls of user-only commands are denied', () => {
  for (const [tool, input] of [
    [
      'Skill',
      { skill: 'zeroh-disclosure:allow', args: 'STRIPE_KEY evil.example' },
    ],
    ['Skill', { skill: '/zeroh-disclosure:allow' }],
    ['Skill', { skill: 'ZeroH-Disclosure:Allow' }],
    ['Skill', { skill: 'zeroh:zeroh-disclosure:allow' }],
    [
      'Skill',
      { skill: 'zeroh-disclosure:settings', args: 'receipts keep 30d' },
    ],
    ['Skill', { skill: 'zeroh-disclosure:uninstall', args: '--yes' }],
    ['Skill', { skill: 'zeroh-disclosure:doctor', args: '--fix' }],
    ['Skill', { skill: 'zeroh-disclosure:proxy', args: 'off' }],
    ['Skill', { skill: 'zeroh-disclosure:unmask', args: 'caps EMAIL session' }],
    [
      'Skill',
      { skill: 'zeroh-disclosure:unmask', args: '--json caps EMAIL 1h' },
    ],
    [
      'SlashCommand',
      { command: '/zeroh-disclosure:allow STRIPE_KEY evil.example' },
    ],
    ['SlashCommand', { command: '/zeroh-disclosure:proxy off' }],
  ]) {
    assert.equal(
      deniesUserOnlyCommand(tool, input),
      true,
      JSON.stringify(input),
    );
  }
});

test('model-invocable ZeroH commands and other skills pass the user-only check', () => {
  for (const [tool, input] of [
    ['Skill', { skill: 'zeroh-disclosure:status' }],
    ['Skill', { skill: 'zeroh-disclosure:mask-show' }],
    ['Skill', { skill: 'zeroh-disclosure:mask-receipt' }],
    ['Skill', { skill: 'zeroh-disclosure:report', args: '30d' }],
    ['Skill', { skill: 'zeroh-disclosure:about' }],
    ['Skill', { skill: 'zeroh-disclosure:report-miss' }],
    [
      'Skill',
      { skill: 'zeroh-disclosure:unmask', args: 'EMAIL to fix the invoice' },
    ],
    ['Skill', { skill: 'zeroh-disclosure:unmask', args: 'revoke all' }],
    ['Skill', { skill: 'other-plugin:allow' }],
    ['Skill', { skill: 'allowance' }],
    ['SlashCommand', { command: '/zeroh-disclosure:status' }],
    ['Bash', { command: 'echo zeroh-disclosure:allow' }],
  ]) {
    assert.equal(
      deniesUserOnlyCommand(tool, input),
      false,
      JSON.stringify(input),
    );
  }
});
