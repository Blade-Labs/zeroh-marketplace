// SPDX-License-Identifier: AGPL-3.0-only

import {
  writeWrappedCache,
  wrappedCacheFile,
} from '../../lib/statusline-cache.js';
import { createGrant } from '../../packages/zeroh-disclosure-core/unmask.js';
import {
  proxyPaths,
  writeRoute,
} from '../../packages/local-proxy/proxy-state.js';
import '../helpers.mjs';
import assert from 'node:assert/strict';
import {
  readFileSync,
  readdirSync,
  cpSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PLUGIN, runHook, tempProject } from '../helpers.mjs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { asUser } from '../as-user.mjs';
import { recordPluginRoot } from '../../lib/statusline-settings.js';

const architecture = readFileSync(
  path.join(PLUGIN, 'docs', 'architecture.md'),
  'utf8',
);
const classification = architecture.split('### Model versus user settings')[1];
const homeTable = classification
  .split('Every file family under `ZEROH_HOME` is assigned once below.')[1]
  .split('Claude Code integration outside `ZEROH_HOME`')[0];
const claudeTable = classification
  .split(
    'Claude Code integration outside `ZEROH_HOME` is also classified exactly once:',
  )[1]
  .split('#### macOS path reproduction')[0];

function rowCount(table, name) {
  return table
    .split('\n')
    .filter((line) => line.startsWith('| ') && line.includes(name)).length;
}

test('every ZEROH_HOME file family appears in exactly one classification row', () => {
  for (const name of [
    '`presentation.json`',
    '`banner.json`',
    '`config.env`',
    '`banner-shown`',
    '`statusline.json`',
    '`plugin-root.json`',
    '`first-run.json`',
    '`projects.json`',
    '`receipts-pruned.json`',
    '`vault.key`',
    '`vault/**`',
    '`allow.key`',
    '`projects/*/allow.json`',
    '`unmask.json`',
    '`grants/**`',
    '`run/unmask-mcp/**`',
    '`run/authz/**`',
    '`run/<session>/<tool-use>.sh`',
    '`run/<session>/<tool-use>.csv`',
    '`session-keys/**`',
    '`projects/*/sessions/**`',
    '`reports/**`',
    '`display/**`',
    '`display-trace.log`',
    '`proxy/**`',
    '`logs/proxy.log`',
    '`bin/zeroh-disclosure-proxy/**`',
    '`.acl-protected`',
    '`uninstalled`',
  ]) {
    assert.equal(rowCount(homeTable, name), 1, name);
  }
});

function stateFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? stateFiles(path.join(directory, entry.name), relative)
      : [relative];
  });
}

function classifiedRows(relative) {
  // Runtime temporary files inherit the class of their target.
  const target = relative.replace(
    /\.(?:lock|tmp|stale|unreadable)(?:[-.].*)?$/u,
    '',
  );
  return homeTable.split('\n').filter((row) => {
    if (!row.startsWith('| ')) return false;
    const familyCell = row.split('|')[1];
    return [...familyCell.matchAll(/`([^`]+)`/gu)].some(([, family]) => {
      const pattern = family
        .split(/(\*\*|\*|<[^>]+>)/u)
        .map((part) => {
          if (part === '**') return '.+';
          if (part === '*' || part.startsWith('<')) return '[^/]+';
          return part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        })
        .join('');
      return new RegExp(`^${pattern}$`, 'u').test(target);
    });
  });
}

test('a broad plugin fixture classifies every observed ZEROH_HOME writer', () => {
  const project = tempProject({ env: false, firstRun: true });
  const config = path.join(project.home, 'claude');
  const env = {
    ...process.env,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    CLAUDE_CONFIG_DIR: config,
    ZEROH_PROXY: 'off',
  };
  // CLI presentation, confirmed preferences/authority, first-run launchers,
  // vault, session, receipt and display hooks exercise writers across modules.
  const cli = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
  for (const args of [
    ['style', 'banner', 'off'],
    ['style', 'emoji', 'false'],
    ['receipts', 'keep', '30d'],
    ['uncertain', 'pass'],
    ['allow', 'fixture', 'fixture.invalid'],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      env: asUser(args, env),
      cwd: project.dir,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `fixture command ${args[0]} failed`);
  }
  recordPluginRoot(project.home, PLUGIN, env);
  const session_id = 'classification';
  for (const [hook, event] of [
    ['session-start', { source: 'startup' }],
    ['user-prompt-submit', { prompt: 'fixture prose' }],
    [
      'pre-tool-use',
      {
        tool_name: 'Read',
        tool_use_id: 'fixture-read',
        tool_input: { file_path: path.join(project.dir, 'README.md') },
      },
    ],
    [
      'post-tool-use',
      {
        tool_name: 'Read',
        tool_use_id: 'fixture-read',
        tool_response: { content: 'fixture prose' },
      },
    ],
    ['stop', {}],
  ]) {
    const result = runHook(
      hook,
      { session_id, ...event },
      { project, extraEnv: env },
    );
    assert.equal(result.code, 0, `fixture hook ${hook} failed`);
  }
  // Integration inputs are outside ZEROH_HOME in production; do not put them
  // inside the inventoried tree here. The fake Claude config is never written.
  writeWrappedCache(
    wrappedCacheFile(env, 'classification'),
    'fixture output',
    Date.now(),
  );
  createGrant({
    root: project.dir,
    home: project.home,
    sessionId: 'classification',
    kind: 'EMAIL',
    reason: 'fixture',
    duration: 'session',
  });
  writeRoute(proxyPaths(env), {
    sessionId: 'classification',
    root: project.dir,
    pluginDir: PLUGIN,
  });
  const observed = stateFiles(project.home);
  assert.ok(observed.length >= 10, 'the broad writer inventory is not empty');
  for (const relative of observed)
    assert.equal(
      classifiedRows(relative).length,
      1,
      `unclassified or multiply classified state: ${relative}`,
    );
});

test(
  'classification rejects an undocumented writer added to lib/banner.js',
  {
    skip: process.env.ZEROH_CLASSIFICATION_MUTANT === '1',
  },
  () => {
    const base = mkdtempSync(
      path.join(os.tmpdir(), 'zeroh-classification-mutant-'),
    );
    const copy = path.join(base, 'plugin');
    try {
      cpSync(PLUGIN, copy, { recursive: true });
      const banner = path.join(copy, 'lib', 'banner.js');
      writeFileSync(
        banner,
        readFileSync(banner, 'utf8').replace(
          "'banner.json'",
          "'unclassified-review-state.json'",
        ),
      );
      const childEnv = {
        ...process.env,
        ZEROH_CLASSIFICATION_MUTANT: '1',
        HOME: path.join(base, 'home'),
        ZEROH_HOME: path.join(base, 'zeroh'),
        ZEROH_CREDENTIAL_HOME: path.join(base, 'credentials'),
        CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
        ZEROH_CLAUDE_SETTINGS: path.join(base, 'claude', 'settings.json'),
        ZEROH_SERVICE_MANAGER_DIR: path.join(base, 'services'),
        TMPDIR: base,
      };
      delete childEnv.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        [
          '--test',
          '--test-reporter=tap',
          path.join(copy, 'test', 'host', 'settings-classification.test.mjs'),
        ],
        {
          env: childEnv,
          encoding: 'utf8',
        },
      );
      assert.equal(
        result.status,
        1,
        'a new unclassified banner writer must fail the gate',
      );
      assert.match(result.stdout, /unclassified-review-state\.json/u);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test('every Claude integration key appears in exactly one classification row', () => {
  for (const name of [
    '`env.ANTHROPIC_BASE_URL`',
    '`statusLine`',
    '`extraKnownMarketplaces.<marketplace>.source`',
    '`.autoUpdate`',
    '`enabledPlugins["zeroh-disclosure@…"]`',
    '`hooks`',
    '`disableAllHooks`',
    '`allowManagedHooksOnly`',
    '`plugins/installed_plugins.json`',
    '`plugins/known_marketplaces.json`',
    '`.<settings-name>.zeroh-restore.json`',
  ]) {
    assert.equal(rowCount(claudeTable, name), 1, name);
  }
});

test('the three classes and their authority rules are explicit', () => {
  assert.match(classification, /Model may change/u);
  assert.match(classification, /User only, no confirmation/u);
  assert.match(classification, /User only, confirmed/u);
  assert.match(classification, /style banner <mode>/u);
  assert.match(classification, /ticket\/code authority/u);
});
