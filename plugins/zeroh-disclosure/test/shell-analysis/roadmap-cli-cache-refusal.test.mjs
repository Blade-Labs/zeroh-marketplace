// SPDX-License-Identifier: AGPL-3.0-only

// Owner session, 2026-11-09: `node <claude config>/plugins/cache/<marketplace>/
// zeroh-roadmap/<version>/bin/roadmap.mjs phase validate …` was denied as
// "would change or run Claude Code settings, plugin files or hooks". A
// read-only allowance was refused in review (Astra, PR #1969): `status` and
// `phase validate` run the repository's TypeScript records, the interpreter
// and inherited loaders are unchecked, and a cache-shaped path is not an
// authenticated install. The command stays denied; the denial now names the
// repository copy of the CLI, which the guard does not stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bashPath, runHook, tempProject } from '../helpers.mjs';
import {
  deniesZeroHSettings,
  PROTECTED_SHELL_BLOCK_REASON,
  PROTECTED_SHELL_DENY_REASON,
  SETTINGS_DENY_REASON,
} from '../../packages/shell-analysis/settings-guard.js';
import { protectedShellDecision } from '../../packages/shell-analysis/guard/plain-safe-reads.js';
import { ROADMAP_CACHE_DENY_REASON } from '../../packages/shell-analysis/guard/roadmap-cli.js';

const onWindows = process.platform === 'win32';

function pluginFile(root, ...parts) {
  const file = path.join(root, 'plugins', ...parts);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '#!/usr/bin/env node\n');
  return file;
}

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zeroh-roadmap-cli-'));
  const home = path.join(directory, 'home');
  const project = path.join(directory, 'project');
  const config = path.join(home, '.claude');
  mkdirSync(project, { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(path.join(config, 'settings.json'), '{}\n');
  const roadmap = pluginFile(
    config,
    'cache',
    'zeroh-marketplace',
    'zeroh-roadmap',
    '0.43.1',
    'bin',
    'roadmap.mjs',
  );
  const env = { HOME: home, CLAUDE_CONFIG_DIR: config };
  return {
    project,
    config,
    roadmap,
    env,
    options: { env, pluginDir: path.join(directory, 'zeroh-plugin') },
  };
}

function decision(f, command, mode) {
  return protectedShellDecision('Bash', { command }, f.project, {
    ...f.options,
    ...(mode ? { mode } : {}),
  });
}

test('node, an interpreter named node, the shebang or a link starting the cached roadmap CLI is refused with the repository-copy hint in warn and block mode; another protected path keeps its own refusal', () => {
  const f = fixture();
  const script = bashPath(f.roadmap);
  const bin = bashPath(path.dirname(f.roadmap));
  const version = bashPath(path.dirname(path.dirname(f.roadmap)));
  const settings = bashPath(path.join(f.config, 'settings.json'));
  const inCache =
    'plugins/cache/zeroh-marketplace/zeroh-roadmap/0.43.1/bin/roadmap.mjs';
  const own = { warn: SETTINGS_DENY_REASON, block: SETTINGS_DENY_REASON };
  const other = {
    warn: PROTECTED_SHELL_DENY_REASON,
    block: PROTECTED_SHELL_BLOCK_REASON,
  };
  // [form, command, expected reason per mode (the hint when omitted)]
  const cases = [
    ['node', `node ${script} phase validate --all --json`],
    ['node, quoted and piped', `node "${script}" status | head -5`],
    ['custom interpreter', `/tmp/node ${script} --help`],
    ['direct shebang', `${script} status`],
    ['env wrapper', `env node ${script} status`],
    ['$HOME', `node $HOME/.claude/${inCache} status`],
    [
      'quoted $CLAUDE_CONFIG_DIR',
      `node "$CLAUDE_CONFIG_DIR/${inCache}" status`,
    ],
    [
      'cd into the version folder',
      `cd ${version} && node bin/roadmap.mjs status`,
    ],
    ['cd into bin, shebang', `cd ${bin} && ./roadmap.mjs status`],
    ['pushd into bin', `pushd ${bin}; node roadmap.mjs status`],
    [
      'also redirecting into Claude settings',
      `node ${script} status > ${settings}`,
      other,
    ],
    [
      'cd into the cache, then out to Claude settings',
      `cd ${bin} && node roadmap.mjs status --out ../../../../../../settings.json`,
      other,
    ],
    [
      'cd into the cache, then a bare .. escape',
      `cd ${bin} && node roadmap.mjs ../../../../../../settings.json`,
      other,
    ],
    [
      'a second command after the cd',
      `cd ${bin} && node roadmap.mjs; rm -rf ../src`,
      other,
    ],
    [
      'a ZeroH file as a relative argument',
      `node ${script} .zeroh.policy`,
      other,
    ],
    [
      'a ZeroH file written first',
      `echo x > .zeroh.policy; node ${script} status`,
      own,
    ],
  ];
  if (!onWindows) {
    const outside = path.join(f.project, 'roadmap.mjs');
    symlinkSync(f.roadmap, outside);
    cases.push(['link resolving to the cache', `node ${outside} status`]);
    // A link inside the version folder that leads out, to a missing file.
    symlinkSync(
      f.config,
      path.join(path.dirname(path.dirname(f.roadmap)), 'up'),
    );
    cases.push([
      'link inside the version folder to a missing file outside',
      `cd ${version} && node bin/roadmap.mjs up/settings.local.json`,
      other,
    ]);
    symlinkSync(
      path.join(f.config, 'plugins', 'cache'),
      path.join(f.project, 'c'),
    );
    cases.push([
      'link to the cache folder',
      'node c/zeroh-marketplace/zeroh-roadmap/0.43.1/bin/roadmap.mjs status',
    ]);
  }
  const hint = {
    warn: ROADMAP_CACHE_DENY_REASON,
    block: ROADMAP_CACHE_DENY_REASON,
  };
  for (const [form, command, reason = hint] of cases)
    for (const mode of ['warn', 'block']) {
      const result = decision(f, command, mode);
      assert.equal(result.deny, true, `${form} (${mode})`);
      assert.equal(result.reason, reason[mode], `${form} (${mode})`);
    }
  assert.match(
    ROADMAP_CACHE_DENY_REASON,
    /node apps\/zeroh-marketplace\/plugins\/zeroh-roadmap\/bin\/roadmap\.mjs phase validate --all/u,
  );
});

test('look-alikes of the roadmap CLI get the generic plugin-file denial', () => {
  const f = fixture();
  const lookalikes = {
    'forged folder outside the cache': pluginFile(
      f.config,
      'marketplaces',
      'zeroh-marketplace',
      'zeroh-roadmap',
      '0.43.1',
      'bin',
      'roadmap.mjs',
    ),
    'another plugin': pluginFile(
      f.config,
      'cache',
      'zeroh-marketplace',
      'evil',
      '1.0.0',
      'bin',
      'roadmap.mjs',
    ),
  };
  for (const [form, file] of Object.entries(lookalikes)) {
    const result = decision(f, `node ${bashPath(file)} status`);
    assert.equal(result.deny, true, form);
    assert.equal(result.reason, PROTECTED_SHELL_DENY_REASON, form);
  }
});

test('the repository copy of the CLI is not stopped', () => {
  const f = fixture();
  pluginFile(
    path.join(f.project, 'apps', 'zeroh-marketplace'),
    'zeroh-roadmap',
    'bin',
    'roadmap.mjs',
  );
  const command =
    'node apps/zeroh-marketplace/plugins/zeroh-roadmap/bin/roadmap.mjs phase validate --all';
  assert.equal(
    deniesZeroHSettings('Bash', { command }, f.project, f.options),
    false,
  );
});

test('PreToolUse: the observed phase validate is denied with the repository-copy hint', () => {
  const f = fixture();
  const command = `node ${bashPath(f.roadmap)} phase validate docs/roadmap/experimental/arcs/ATLAS_M1_DEV.arc.ts`;
  const output = runHook(
    'pre-tool-use',
    { tool_name: 'Bash', tool_input: { command } },
    { project: tempProject(), extraEnv: f.env },
  ).json?.hookSpecificOutput;
  assert.equal(output?.permissionDecision, 'deny');
  assert.equal(output?.permissionDecisionReason, ROADMAP_CACHE_DENY_REASON);
});
