// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { installedPluginIds, removePlugin } from '../lib/plugin-removal.js';
import {
  hookStandsDown,
  isUninstalled,
  markUninstalled,
} from '../lib/uninstall-marker.js';

function fakeClaude(listing) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-fake-claude-'));
  const bin = path.join(dir, 'claude.mjs');
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nif (process.argv[3] === 'list') console.log(${JSON.stringify(JSON.stringify(listing))});\n`,
    { mode: 0o755 },
  );
  return { ...process.env, ZEROH_CLAUDE_BIN: bin };
}

// T-38: the plugin's installed ids come from Claude Code's own listing,
// whatever its shape; a missing `claude` is reported, never guessed.
test('installed plugin ids are read from `claude plugin list --json`', () => {
  assert.deepEqual(
    installedPluginIds(
      fakeClaude([
        { id: 'zeroh-disclosure@zeroh', scope: 'user' },
        { id: 'zeroh-disclosure@zeroh-internal', scope: 'project' },
        { id: 'zeroh-sdd@zeroh', scope: 'user' },
      ]),
    ),
    [
      { id: 'zeroh-disclosure@zeroh', scope: 'user' },
      { id: 'zeroh-disclosure@zeroh-internal', scope: 'project' },
    ],
  );
  assert.deepEqual(
    installedPluginIds(
      fakeClaude({ plugins: { 'zeroh-disclosure@zeroh': { enabled: true } } }),
    ),
    [{ id: 'zeroh-disclosure@zeroh', scope: 'user' }],
  );
  const none = removePlugin({
    ...process.env,
    ZEROH_CLAUDE_BIN: '/nonexistent/claude',
  });
  assert.ok(none.unavailable);
  assert.deepEqual(none.removed, []);
});

test('after uninstall every hook stands down until a new session starts', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-home-'));
  const env = { ...process.env, ZEROH_HOME: home };
  assert.equal(hookStandsDown('user-prompt-submit', {}, env), false);
  markUninstalled(env);
  assert.equal(isUninstalled(env), true);
  for (const [name, event] of [
    ['user-prompt-submit', {}],
    ['pre-tool-use', {}],
    ['post-tool-use', {}],
    ['stop', {}],
    ['session-end', {}],
    ['session-start', { source: 'clear' }],
    ['session-start', { source: 'resume' }],
  ]) {
    assert.equal(hookStandsDown(name, event, env), true, name);
  }
  // Another ZeroH home is not affected.
  assert.equal(
    hookStandsDown('stop', {}, { ...process.env, ZEROH_HOME: `${home}-x` }),
    false,
  );
  // A new session only loads the plugin when it was installed again.
  assert.equal(
    hookStandsDown('session-start', { source: 'startup' }, env),
    false,
  );
  assert.equal(isUninstalled(env), false);
  assert.equal(hookStandsDown('stop', {}, env), false);
});
