// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import { bashPath, PLUGIN, runHook, tempProject } from '../helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { styleKey } from '../../lib/style.js';
import { BANNER_MODES } from '../../lib/banner.js';
import {
  claudeControlKind,
  commandZeroHManagementKind,
  commandRunsZeroHPresentation,
  commandRunsClaudeControlCli,
  deniesClaudeBaseUrlMutation,
  deniesClaudeControlChange,
  deniesElicitationHookEdits,
  deniesUserOnlyCommand,
  deniesZeroHSettings,
  isZeroHSettingsPath,
  managementDenyReason,
  settingsChangeWeakensZeroH,
  textReferencesZeroHSettings,
} from '../../packages/shell-analysis/settings-guard.js';

const root = '/tmp/zeroh-guard-project';

function presentationCommand(command, shell = 'bash', cwd = process.cwd()) {
  return commandRunsZeroHPresentation(
    command,
    shell,
    cwd,
    styleKey,
    BANNER_MODES,
  );
}

function hookDecision(result, command) {
  assert.equal(
    result.code,
    0,
    `${command}: hook exited ${result.code}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
  );
  return result.json?.hookSpecificOutput?.permissionDecision ?? 'no-decision';
}

function presentationDecision(project, tool, command, cwd = project.dir) {
  const result = runHook(
    'pre-tool-use',
    { cwd, tool_name: tool, tool_input: { command } },
    { project },
  );
  const decision = hookDecision(result, command);
  if (decision === 'no-decision') {
    // Successful presentation calls still return the exit-status wrapper.
    // Empty stdout, a recovery notice or an incomplete answer is not proof
    // that the guard checked and accepted the invocation.
    assert.equal(
      result.json?.hookSpecificOutput?.hookEventName,
      'PreToolUse',
      `${command}: no hook answer\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
    assert.equal(
      typeof result.json.hookSpecificOutput.updatedInput?.command,
      'string',
      `${command}: no checked tool input\nstdout: ${result.stdout}`,
    );
  }
  return decision;
}

test('presentation decision diagnostics distinguish crashes, missing decisions and explicit allow', () => {
  const result = { code: 0, stdout: '', stderr: '', json: null };
  assert.equal(hookDecision(result, 'ZEROHFAKE'), 'no-decision');
  assert.equal(
    hookDecision(
      {
        ...result,
        json: { hookSpecificOutput: { permissionDecision: 'allow' } },
      },
      'ZEROHFAKE',
    ),
    'allow',
  );
  for (const code of [1, null]) {
    assert.throws(
      () =>
        hookDecision(
          { ...result, code, stderr: 'ZEROHFAKE fatal diagnostic' },
          'ZEROHFAKE',
        ),
      /stderr: ZEROHFAKE fatal diagnostic/u,
    );
  }
});

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

test('the macOS physical home spelling keeps the style-file exception', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-mac-home-'));
  const physicalUsers = path.join(
    directory,
    'System',
    'Volumes',
    'Data',
    'Users',
  );
  const logicalUsers = path.join(directory, 'Users');
  const physicalHome = path.join(physicalUsers, 'owner', '.zeroh');
  mkdirSync(physicalHome, { recursive: true });
  symlinkSync(physicalUsers, logicalUsers, 'dir');
  const logicalHome = path.join(logicalUsers, 'owner', '.zeroh');
  const logicalStyle = path.join(logicalHome, 'presentation.json');
  const physicalStyle = path.join(physicalHome, 'presentation.json');
  writeFileSync(logicalStyle, '{"version":1}\n');
  const options = {
    platform: 'darwin',
    // This alias fixture lives on the host filesystem; only its case rules
    // and logical/physical home layout model macOS.
    pathImpl: path,
    home: logicalHome,
  };
  for (const read of [false, true]) {
    assert.equal(
      isZeroHSettingsPath(logicalStyle, directory, { ...options, read }),
      false,
    );
    assert.equal(
      isZeroHSettingsPath(physicalStyle, directory, { ...options, read }),
      false,
    );
  }
  assert.equal(
    isZeroHSettingsPath(path.join(physicalHome, 'banner.json'), directory, {
      ...options,
      read: true,
    }),
    true,
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
        command: `sed -i s/deny/allow/ ${bashPath(path.join(plugin, 'hooks', 'pre-tool-use.js'))}`,
      },
    ],
    [
      'Bash',
      {
        command: `cp /tmp/x.js ${bashPath(plugin)}/packages/shell-analysis/settings-guard.js`,
      },
    ],
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
    // rc.2 pass mode: a read through a substitution is still a read.
    'cat "$(echo .claude/settings.json)"',
    'npm test',
    'git status',
  ]) {
    assert.equal(denied('Bash', command), false, command);
  }
  // rc.2 block mode (opt-in): only plain reads with listed options.
  const blocked = (command) =>
    deniesClaudeControlChange('Bash', { command }, root, {
      ...options,
      mode: 'block',
    });
  assert.equal(blocked('cat "$(echo .claude/settings.json)"'), true);
  assert.equal(blocked('grep -n hooks .claude/settings.local.json'), true);
  assert.equal(blocked('cat .claude/settings.json'), false);
  assert.equal(blocked('jq .permissions .claude/settings.json'), false);
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
    `cp /tmp/x.js ${bashPath(plugin)}/packages/shell-analysis/settings-guard.js`,
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
  // A POSIX home and project, judged as on macOS or Linux on every system.
  const posix = { platform: 'linux', pathImpl: path.posix };
  const home = '/home/alice/.zeroh';
  const root = '/work/shop';
  const receipt = `${home}/projects/-work-shop/sessions/s1/turn-1.json`;
  assert.equal(
    isZeroHSettingsPath(receipt, root, { ...posix, home, read: true }),
    false,
  );
  assert.equal(isZeroHSettingsPath(receipt, root, { ...posix, home }), true);
  assert.equal(
    isZeroHSettingsPath(`${home}/projects/-work-shop/allow.json`, root, {
      ...posix,
      home,
      read: true,
    }),
    true,
  );
  assert.equal(
    isZeroHSettingsPath(
      `${home}/projects/-work-other/sessions/s1/turn-1.json`,
      root,
      { ...posix, home, read: true },
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
    ['Skill', { skill: 'zeroh-disclosure:settings', args: 'statusline on' }],
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
    ['Skill', { skill: 'zeroh-disclosure:settings', args: 'banner mini' }],
    [
      'SlashCommand',
      {
        command: '/zeroh-disclosure:settings statusline style wording compact',
      },
    ],
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

// Astra finding 1: `rg --pre CMD` runs CMD on every file it searches, so an
// "inspection" command could delete or rewrite Claude settings and hook files.
test('inspection commands that can run another program are not read-only (Astra 1)', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-rg-pre-'));
  const home = path.join(directory, 'home');
  const plugin = path.join(directory, 'installed-plugin');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
  const settings = path.join(home, '.claude', 'settings.json');
  const hooks = path.join(plugin, 'hooks', 'hooks.json');
  const options = { env: { HOME: home }, pluginDir: plugin };
  const writeFixtures = () => {
    writeFileSync(settings, '{"env":{"ZEROHFAKE":"1"}}\n');
    writeFileSync(hooks, '{"hooks":{}}\n');
  };
  writeFixtures();
  const denied = [
    `rg --pre rm ZEROHFAKE ${settings}`,
    `rg --pre=rm ZEROHFAKE ${settings}`,
    `rg -i --pre "rm" ZEROHFAKE ${hooks}`,
    `rg --hostname-bin=/tmp/zerohfake-script ZEROHFAKE ${settings}`,
    `rg --pre rm Elicitation ${settings}`,
    `cat \`rm ${settings}\` ${settings}`,
    `less +!rm ${settings}`,
  ];
  for (const tool of ['Bash', 'Monitor', 'PowerShell']) {
    for (const command of denied) {
      assert.equal(
        deniesZeroHSettings(tool, { command }, directory, options),
        true,
        `${tool}: ${command}`,
      );
    }
  }
  // PowerShell's subexpression runs Remove-Item; to Bash the same text is a
  // syntax error that runs nothing (rc.2: it passes there, as unparseable).
  const psDelete = `Get-Content (Remove-Item ${settings})`;
  assert.equal(
    deniesZeroHSettings(
      'PowerShell',
      { command: psDelete },
      directory,
      options,
    ),
    true,
  );
  assert.equal(
    deniesZeroHSettings('Bash', { command: psDelete }, directory, options),
    false,
  );
  assert.equal(
    deniesElicitationHookEdits(
      'Bash',
      { command: `rg --pre rm Elicitation ${directory}/.claude/settings.json` },
      directory,
    ),
    true,
  );
  // Plain reads of the same files stay allowed.
  for (const command of [
    `rg ZEROHFAKE ${settings}`,
    `rg --pre-glob '*.pdf' ZEROHFAKE ${settings}`,
    `cat ${settings}`,
    `Get-Content ${settings}`,
  ]) {
    assert.equal(
      deniesZeroHSettings('Bash', { command }, directory, options),
      false,
      command,
    );
  }
  // The fixture shows what the denied command would have done.
  const rg = spawnSync('rg', ['--version'], { encoding: 'utf8' });
  if (rg.status === 0) {
    spawnSync('rg', ['--pre', 'rm', 'ZEROHFAKE', settings], { cwd: directory });
    assert.equal(existsSync(settings), false, 'rg --pre rm removes the file');
    writeFixtures();
  }
  assert.equal(existsSync(settings), true);
});

// Astra finding 3: the CLI on PATH (or by path) must not let the model turn
// protection off, repair or uninstall from its own shell.
test('protection-changing CLI subcommands are denied from any shell tool (Astra 3)', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-cli-'));
  const options = { env: { HOME: path.join(directory, 'home') } };
  const denied = [
    'zeroh-disclosure proxy off',
    'zeroh-disclosure proxy on',
    'zeroh-disclosure doctor --fix',
    'zeroh-disclosure doctor',
    'zeroh-disclosure uninstall --yes',
    'zeroh-disclosure uninstall --yes --force',
    'zeroh-disclosure vault clear',
    'zeroh-disclosure tokens',
    'zeroh-disclosure --cwd /tmp/x proxy off',
    'npx zeroh-disclosure proxy off',
    'npx -y zeroh-disclosure uninstall --yes',
    'pnpm exec zeroh-disclosure proxy off',
    '/usr/local/bin/zeroh-disclosure proxy off',
    'node /opt/zerohfake/bin/zeroh-disclosure.mjs proxy off',
    'node "C:\\zerohfake\\bin\\zeroh-disclosure.mjs" doctor --fix',
    'ZEROHFAKE=1 zeroh-disclosure proxy off',
    'true && zeroh-disclosure proxy off',
    'echo ok; zeroh-disclosure uninstall --yes',
    'zeroh-disclosure.cmd proxy off',
    '& zeroh-disclosure proxy off',
    'x=$(zeroh-disclosure proxy off)',
    '$(which zeroh-disclosure) proxy off',
    '`command -v zeroh-disclosure` doctor --fix',
    'bash -c "zeroh-disclosure proxy off"',
    'iex "zeroh-disclosure uninstall --yes"',
    '"zeroh-disclosure" proxy off',
  ];
  const allowed = [
    'echo zeroh-disclosure',
    'zeroh-disclosure catalog',
    'zeroh-disclosure --help',
    'zeroh-disclosure verify receipt.json',
    'zeroh-disclosure style wording compact',
    'zeroh-disclosure style banner mini',
    'zeroh-disclosure banner off',
    'git log --grep zeroh-disclosure',
    'npm test',
    // A path that ends in the plugin's folder is an argument, not the CLI.
    'rg ZEROHFAKE apps/zeroh-marketplace/plugins/zeroh-disclosure lib',
    'git diff -- apps/zeroh-marketplace/plugins/zeroh-disclosure hooks',
    'cd apps/zeroh-marketplace/plugins/zeroh-disclosure && npm test',
  ];
  for (const tool of ['Bash', 'Monitor', 'PowerShell']) {
    for (const command of denied) {
      assert.equal(
        deniesZeroHSettings(tool, { command }, directory, options),
        true,
        `${tool}: ${command}`,
      );
    }
    for (const command of allowed) {
      assert.equal(
        deniesZeroHSettings(tool, { command }, directory, options),
        false,
        `${tool}: ${command}`,
      );
    }
  }
  assert.equal(
    commandZeroHManagementKind('zeroh-disclosure statusline on'),
    'statusline',
  );
  assert.doesNotMatch(
    managementDenyReason('zeroh-disclosure statusline on'),
    /changes what ZeroH Disclosure protects/u,
  );
  assert.equal(
    commandZeroHManagementKind('zeroh-disclosure proxy off'),
    'protection',
  );
  assert.match(
    managementDenyReason('zeroh-disclosure proxy off'),
    /changes what ZeroH Disclosure protects/u,
  );
  assert.equal(
    commandZeroHManagementKind('zeroh-disclosure doctor'),
    'user-only',
  );
  assert.doesNotMatch(
    managementDenyReason('zeroh-disclosure doctor'),
    /changes what ZeroH Disclosure protects/u,
  );
});

test('the presentation exception accepts only the exact validated Node invocation', () => {
  const project = tempProject();
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  const quotedCli = `'${cli.replaceAll("'", "'\\''")}'`;
  const decision = (tool, command) =>
    presentationDecision(project, tool, command);

  for (const command of [
    `node ${quotedCli} style show`,
    `node ${quotedCli} style wording compact`,
    `node ${quotedCli} style banner mini`,
  ]) {
    assert.equal(presentationCommand(command), true, command);
    assert.equal(decision('Bash', command), 'no-decision', command);
  }

  const payload = path.join(project.dir, 'payload.cjs');
  writeFileSync(payload, 'module.exports = {};\n');
  const rejectedRunners = [
    `./node ${quotedCli} style show`,
    `bin/node ${quotedCli} style show`,
    `/abs/node ${quotedCli} style show`,
  ];
  const rejected = [
    `node --eval='require("fs").writeFileSync("${project.home}/config.env","ZEROH_UNCERTAIN=pass\\n")' zeroh-disclosure style show`,
    `node --require=${pathToFileURL(payload).href} ${quotedCli} style show`,
    `node -r ${payload} ${quotedCli} style show`,
    `node --import=${pathToFileURL(payload).href} ${quotedCli} style show`,
    `node --loader=${pathToFileURL(payload).href} ${quotedCli} style show`,
    `node --experimental-test-coverage ${quotedCli} style show`,
    `node --inspect ${quotedCli} style show`,
    `node --inspect-brk ${quotedCli} style show`,
    `NODE_OPTIONS=--inspect node ${quotedCli} style show`,
    `env NODE_OPTIONS=--inspect node ${quotedCli} style show`,
    `node ${quotedCli} style show extra`,
    `node ${quotedCli} style banner unsafe`,
    `node ${quotedCli} style unknown value`,
    ...rejectedRunners,
    `node /tmp/zeroh-disclosure.mjs style show`,
  ];
  for (const command of rejected) {
    assert.equal(presentationCommand(command), false, command);
  }
  for (const command of rejected.slice(0, 13)) {
    assert.equal(decision('Bash', command), 'deny', command);
  }
  for (const command of rejectedRunners) {
    assert.equal(decision('Bash', command), 'deny', command);
  }
});

test('relative presentation script paths resolve from the event cwd', () => {
  const project = tempProject();
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  const eventCwd = path.join(project.dir, 'nested');
  mkdirSync(eventCwd);
  const decision = (command, cwd = eventCwd) =>
    presentationDecision(project, 'Bash', command, cwd);
  const relativeFromEvent = `node '${path.relative(eventCwd, cli)}' style show`;
  const relativeFromProject = `node '${path.relative(project.dir, cli)}' style show`;
  assert.equal(presentationCommand(relativeFromEvent, 'bash', eventCwd), true);
  assert.equal(
    presentationCommand(relativeFromProject, 'bash', eventCwd),
    false,
  );
  assert.equal(decision(relativeFromEvent), 'no-decision', relativeFromEvent);
  assert.equal(decision(relativeFromProject), 'deny', relativeFromProject);
});

test('PowerShell alternative readings each accept one safe presentation invocation', () => {
  const project = tempProject();
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const decision = (command) =>
    presentationDecision(project, 'PowerShell', command);

  for (const value of ['a b', '\'"', '../', ';|&', '$()', '`id`']) {
    const command = `node ${quote(cli)} style separator ${quote(value)}`;
    assert.equal(presentationCommand(command, 'powershell'), true);
    assert.equal(decision(command), 'no-decision', value);
  }
  const nodeExe = `node.exe ${quote(cli)} style show`;
  assert.equal(presentationCommand(nodeExe, 'powershell'), true);
  assert.equal(decision(nodeExe), 'no-decision', nodeExe);
  for (const runner of [
    './node',
    'bin/node',
    '/abs/node',
    'C:\\x\\node.exe',
    '.\\node',
  ]) {
    const command = `${runner} ${quote(cli)} style show`;
    assert.equal(presentationCommand(command, 'powershell'), false);
    assert.equal(decision(command), 'deny', command);
  }
  for (const suffix of ['; echo harmless', '&& echo harmless', '| cat']) {
    const command = `node ${quote(cli)} style banner mini ${suffix}`;
    assert.equal(presentationCommand(command, 'powershell'), false);
    for (const mode of ['pass', 'block']) {
      assert.equal(
        deniesZeroHSettings('PowerShell', { command }, project.dir, {
          mode,
          commandCwd: project.dir,
          styleKey,
          bannerModes: BANNER_MODES,
        }),
        true,
        `${mode}: ${suffix}`,
      );
    }
    assert.equal(decision(command), 'deny', suffix);
  }
  // Revisit the failing suffix after successful and rejected invocations;
  // warmed parser/state paths must retain the same explicit denial.
  for (let repeat = 0; repeat < 3; repeat++) {
    assert.equal(decision(nodeExe), 'no-decision', nodeExe);
    assert.equal(
      decision(`node ${quote(cli)} style banner mini | cat`),
      'deny',
      `warm pipe ${repeat}`,
    );
  }
});

test('the presentation guard uses the canonical style-key list', () => {
  const managementSource = readFileSync(
    new URL(
      '../../packages/shell-analysis/guard/management.js',
      import.meta.url,
    ),
    'utf8',
  );
  const hookSource = readFileSync(
    new URL('../../hooks/pre-tool-use.js', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(managementSource, /\bSTYLE_KEYS\b/u);
  assert.doesNotMatch(managementSource, /lib\/style\.js/u);
  assert.doesNotMatch(
    managementSource,
    /\[['"]big['"],\s*['"]compact['"],\s*['"]mini['"],\s*['"]off['"]\]/u,
  );
  assert.match(hookSource, /import\s+\{\s*styleKey\s*\}\s+from/u);
  assert.match(hookSource, /import\s+\{\s*BANNER_MODES\s*\}\s+from/u);
  assert.match(hookSource, /bannerModes:\s*BANNER_MODES/u);
});

test('a presentation match does not exempt its protected path argument from block mode', () => {
  const project = tempProject();
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  const protectedValue = path.join(project.home, 'vault.key');
  const command = `node "${cli}" style separator "${protectedValue}"`;
  assert.equal(presentationCommand(command, 'bash', project.dir), true);
  assert.equal(
    deniesZeroHSettings('Bash', { command }, project.dir, {
      mode: 'block',
      commandCwd: project.dir,
      styleKey,
      bannerModes: BANNER_MODES,
      env: {
        HOME: project.home,
        ZEROH_HOME: project.home,
        ZEROH_CLAUDE_SETTINGS: project.settings,
      },
    }),
    true,
  );
});

// Astra re-review R6: a quoted argument is text unless an interpreter runs
// it. Searching for or printing a management command is allowed; handing it
// to `bash -c`, `eval`, `Invoke-Expression` or `pwsh -Command` is not.
test('quoted CLI text is a command only where an interpreter runs it (Astra R6)', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-guard-quoted-'));
  const options = { env: { HOME: path.join(directory, 'home') } };
  const allowed = [
    "rg 'zeroh-disclosure proxy off' README.md",
    'echo "zeroh-disclosure proxy off"',
    'grep -n "zeroh-disclosure uninstall --yes" docs/troubleshooting.md',
    'Select-String -Pattern "zeroh-disclosure doctor --fix" README.md',
    'git commit -m "document zeroh-disclosure proxy off"',
    'printf \'%s\\n\' "run zeroh-disclosure proxy off in a terminal"',
  ];
  const denied = [
    'bash -c "zeroh-disclosure proxy off"',
    "sh -c 'zeroh-disclosure uninstall --yes'",
    'bash -lc "zeroh-disclosure proxy off"',
    'sudo bash -c "zeroh-disclosure proxy off"',
    'eval "zeroh-disclosure proxy off"',
    'iex "zeroh-disclosure uninstall --yes"',
    'Invoke-Expression "zeroh-disclosure proxy off"',
    'pwsh -Command "zeroh-disclosure proxy off"',
    'powershell.exe -c "zeroh-disclosure doctor --fix"',
    'cmd /c "zeroh-disclosure proxy off"',
  ];
  for (const tool of ['Bash', 'Monitor', 'PowerShell']) {
    for (const command of allowed)
      assert.equal(
        deniesZeroHSettings(tool, { command }, directory, options),
        false,
        `${tool}: ${command}`,
      );
    for (const command of denied)
      assert.equal(
        deniesZeroHSettings(tool, { command }, directory, options),
        true,
        `${tool}: ${command}`,
      );
  }
  // The same decisions through the real PreToolUse hook.
  const project = tempProject();
  const decision = (command) => presentationDecision(project, 'Bash', command);
  assert.notEqual(
    decision("rg 'zeroh-disclosure proxy off' README.md"),
    'deny',
  );
  assert.notEqual(decision('echo "zeroh-disclosure proxy off"'), 'deny');
  assert.equal(decision('bash -c "zeroh-disclosure proxy off"'), 'deny');
});

// Git Bash, Claude Code's Bash on Windows, names drives /c/… (its own `pwd`
// prints /c/Users/…): a command that writes the plugin or Claude's settings
// through that spelling is the same write as through C:\…. Judged with
// Windows path rules, so it runs on every system.
test('on Windows, Git Bash drive paths (/c/…) to the plugin and settings are protected', () => {
  const options = {
    env: { HOME: 'C:\\Users\\me', USERPROFILE: 'C:\\Users\\me' },
    pluginDir: 'C:\\Users\\me\\plugin',
    platform: 'win32',
    pathImpl: path.win32,
  };
  for (const command of [
    'cp /tmp/x.js /c/Users/me/plugin/packages/shell-analysis/settings-guard.js',
    'cp /tmp/x.js /C/Users/me/plugin/packages/shell-analysis/settings-guard.js',
    'sed -i s/deny/allow/ /c/Users/me/plugin/hooks/pre-tool-use.js',
    'rm -rf /c/Users/me/plugin/hooks',
    'echo {} > /c/Users/me/.claude/settings.json',
    'find /c/Users/me/.claude -exec rm {} +',
  ]) {
    assert.equal(
      deniesClaudeControlChange('Bash', { command }, 'C:\\work', options),
      true,
      command,
    );
  }
  for (const command of [
    'cat /c/Users/me/notes.txt',
    'cat /c/Users/me/plugin/README.md',
    'cp /c/Users/me/a.txt /c/Users/me/b.txt',
  ]) {
    assert.equal(
      deniesClaudeControlChange('Bash', { command }, 'C:\\work', options),
      false,
      command,
    );
  }
});
