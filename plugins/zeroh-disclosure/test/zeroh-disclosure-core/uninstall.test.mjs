// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import { fakeProgram, PLUGIN, runHook, tempProject } from '../helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  installedPluginIds,
  removePlugin,
} from '../../packages/zeroh-disclosure-core/plugin-removal.js';
import {
  hookStandsDown,
  isUninstalled,
  markUninstallCleanupStarted,
  markUninstallPending,
  markUninstalled,
  readUninstallState,
  renewUninstallPending,
  takeUninstallFailure,
  uninstallMarkerPath,
  uninstallOwner,
  uninstallRemovalLockPath,
  uninstallState,
} from '../../packages/zeroh-disclosure-core/uninstall-marker.js';

function fakeClaude(listing) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-fake-claude-'));
  const bin = path.join(dir, 'claude.mjs');
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nif (process.argv[3] === 'list') console.log(${JSON.stringify(JSON.stringify(listing))});\n`,
    { mode: 0o755 },
  );
  return { ...process.env, ZEROH_CLAUDE_BIN: fakeProgram(bin) };
}

function commitUninstall(env) {
  const owner = markUninstallPending(env);
  assert.equal(markUninstalled(env, owner.nonce), true);
}

// T-38: the plugin's installed ids come from Claude Code's own listing,
// whatever its shape; a missing `claude` is reported, never guessed.
test('installed plugin ids are read from `claude plugin list --json`', () => {
  assert.deepEqual(
    installedPluginIds(
      fakeClaude([
        { id: 'zeroh-disclosure@zeroh', scope: 'user' },
        { id: 'zeroh-disclosure@other-marketplace', scope: 'project' },
        { id: 'zeroh-sdd@zeroh', scope: 'user' },
      ]),
    ),
    [
      { id: 'zeroh-disclosure@zeroh', scope: 'user' },
      { id: 'zeroh-disclosure@other-marketplace', scope: 'project' },
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
  commitUninstall(env);
  assert.equal(isUninstalled(env), true);
  assert.equal(
    hookStandsDown(
      'user-prompt-submit',
      { prompt: '/zeroh-disclosure:uninstall' },
      env,
    ),
    false,
  );
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

test('stale cleanup cannot delete a competing pending-to-committed transition', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-race-'));
  const env = { ...process.env, ZEROH_HOME: home };
  markUninstallPending(env, {
    pid: 999_999_999,
    process_start: 'gone',
    nonce: 'ZEROHFAKE-stale-owner',
    lease_until: new Date(Date.now() + 60_000).toISOString(),
  });
  const marker = uninstallMarkerPath(env);
  const originalRead = fs.readFileSync;
  let replaced = false;
  fs.readFileSync = function injectedRead(file, ...args) {
    const result = originalRead(file, ...args);
    if (String(file) === marker && !replaced) {
      replaced = true;
      fs.readFileSync = originalRead;
      syncBuiltinESMExports();
      markUninstalled(env, 'ZEROHFAKE-stale-owner');
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    assert.equal(isUninstalled(env), true);
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
  }
  assert.equal(replaced, true);
  assert.equal(uninstallState(env), 'committed');
});

test('pending uninstall ownership rejects PID reuse and resumes with a notice', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-owner-'));
  const env = { ...process.env, ZEROH_HOME: home };
  markUninstallPending(env, {
    pid: process.pid,
    process_start: 'ZEROHFAKE-not-this-process',
    nonce: 'ZEROHFAKE-reused-owner',
    lease_until: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(
    hookStandsDown('user-prompt-submit', { prompt: 'hello' }, env),
    false,
  );
  assert.equal(uninstallState(env), 'none');
  assert.ok(takeUninstallFailure(env));
});

test('EPERM still checks process identity before trusting a pending owner', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-eperm-'));
  const env = { ...process.env, ZEROH_HOME: home };
  markUninstallPending(env, {
    pid: 1,
    process_start: 'ZEROHFAKE-not-pid-one',
    nonce: 'ZEROHFAKE-eperm-owner',
    lease_until: new Date(Date.now() - 1).toISOString(),
  });
  const originalKill = process.kill;
  process.kill = function deniedKill(pid, signal) {
    if (pid === 1 && signal === 0) {
      const error = new Error('not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return originalKill.call(process, pid, signal);
  };
  try {
    assert.equal(readUninstallState(env), 'none');
  } finally {
    process.kill = originalKill;
  }
});

test('a newly created transition lock gets a write grace before stale recovery', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-lock-'));
  const env = { ...process.env, ZEROH_HOME: home };
  const lock = path.join(
    path.dirname(uninstallRemovalLockPath(env)),
    'marker.lock',
  );
  mkdirSync(path.dirname(lock), { recursive: true });
  closeSync(openSync(lock, 'wx', 0o600));
  const owner = uninstallOwner();
  const originalRead = fs.readFileSync;
  let first = true;
  fs.readFileSync = function delayedLockWrite(file, ...args) {
    if (String(file) === lock) {
      if (first) {
        first = false;
        const error = new Error('writer has not filled the lock yet');
        error.code = 'EACCES';
        throw error;
      }
      return `${JSON.stringify(owner)}\n`;
    }
    return originalRead(file, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => markUninstalled(env, 'ZEROHFAKE-transition-owner'),
      /transition is busy/u,
    );
  } finally {
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
    rmSync(path.dirname(lock), { recursive: true, force: true });
  }
});

test('read-only uninstall state does not retire a dead owner', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-readonly-'));
  const env = { ...process.env, ZEROH_HOME: home };
  markUninstallPending(env, {
    pid: 999_999_999,
    process_start: 'gone',
    nonce: 'ZEROHFAKE-readonly-owner',
    lease_until: new Date(Date.now() - 1).toISOString(),
  });
  assert.equal(readUninstallState(env), 'none');
  assert.equal(existsSync(uninstallMarkerPath(env)), true);
  assert.equal(takeUninstallFailure(env), null);
  assert.equal(uninstallState(env), 'none');
  assert.equal(existsSync(uninstallMarkerPath(env)), false);
  assert.ok(takeUninstallFailure(env));
});

test('a dead owner after cleanup starts leaves a durable failed tombstone', () => {
  const project = tempProject({ env: false });
  const env = { ...process.env, ZEROH_HOME: project.home };
  const nonce = 'ZEROHFAKE-cleanup-owner';
  markUninstallPending(env, {
    pid: 999_999_999,
    process_start: 'gone',
    nonce,
    lease_until: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(markUninstallCleanupStarted(env, nonce), true);
  const expected =
    'ZeroH Disclosure removal incomplete · type /zeroh-disclosure:uninstall to finish';
  for (const source of ['resume', 'clear']) {
    const stopped = runHook('session-start', { source }, { project });
    assert.equal(stopped.code, 0, stopped.stderr);
    assert.equal(stopped.json?.systemMessage, expected);
  }
  assert.equal(readUninstallState(env), 'failed');
  assert.equal(existsSync(uninstallMarkerPath(env)), true);
  assert.equal(
    hookStandsDown('user-prompt-submit', { prompt: 'hello' }, env),
    true,
  );
  assert.equal(
    hookStandsDown(
      'user-prompt-submit',
      { prompt: '/zeroh-disclosure:uninstall' },
      env,
    ),
    false,
  );
  assert.ok(takeUninstallFailure(env));
});

test('a nonce-bound heartbeat keeps a live pending removal past its first lease', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-marker-heartbeat-'));
  const env = { ...process.env, ZEROH_HOME: home };
  const started = Date.now();
  const nonce = 'ZEROHFAKE-heartbeat-owner';
  markUninstallPending(env, {
    pid: process.pid,
    process_start: null,
    nonce,
    lease_until: new Date(started + 10).toISOString(),
  });
  const renewedAt = started + 20;
  assert.equal(renewUninstallPending(env, nonce, renewedAt), true);
  assert.equal(readUninstallState(env, started + 30), 'pending');
  assert.equal(
    renewUninstallPending(env, 'ZEROHFAKE-different-owner', renewedAt),
    false,
  );
});

test('only the owning removal nonce can commit an uninstall', () => {
  const home = mkdtempSync(
    path.join(os.tmpdir(), 'zeroh-marker-commit-owner-'),
  );
  const env = { ...process.env, ZEROH_HOME: home };
  const nonce = 'ZEROHFAKE-commit-owner';
  markUninstallPending(env, {
    pid: process.pid,
    process_start: null,
    nonce,
    lease_until: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(markUninstalled(env, 'ZEROHFAKE-not-owner'), false);
  assert.equal(uninstallState(env), 'pending');
  assert.equal(markUninstalled(env, nonce), true);
  assert.equal(uninstallState(env), 'committed');
});

for (const injectedWindows of [false, true])
  test(`a tombstoned install accepts an uninstall retry through the hook loader${injectedWindows ? ' (injected Windows)' : ''}`, () => {
    const project = tempProject({ env: false, firstRun: true });
    commitUninstall({ ...process.env, ZEROH_HOME: project.home });
    const extraEnv = {
      ZEROH_PROXY: 'on',
      ...(injectedWindows
        ? {
            NODE_OPTIONS:
              '--import=' +
              pathToFileURL(
                path.join(
                  PLUGIN,
                  'test/tools/worker-child-process-preload.mjs',
                ),
              ).href,
            ZEROH_WORKER_TEST_TRACE: path.join(project.dir, 'retry-trace'),
          }
        : {}),
    };
    const result = runHook(
      'user-prompt-submit',
      { prompt: '  /zeroh-disclosure:uninstall', session_id: 'retry' },
      { project, extraEnv },
    );
    assert.match(result.json?.reason ?? '', /no matching request/u);
    const dryRun = runHook(
      'user-prompt-submit',
      { prompt: '/zeroh-disclosure:uninstall --dry-run', session_id: 'retry' },
      { project, extraEnv },
    );
    assert.match(dryRun.json?.reason ?? '', /already removed/u);
    assert.deepEqual(readdirSync(project.home), ['uninstalled']);
    assert.equal(existsSync(project.settings), false);
    assert.equal(existsSync(path.join(project.home, 'proxy')), false);
  });

// The 1.0 help advertised --force. It is accepted and ignored, and must never
// take the next flag as its value: `uninstall --force --dry-run` stays a dry
// run that removes nothing (REL1 review P2).
test('uninstall --force never swallows --dry-run', () => {
  const project = tempProject({ env: false });
  mkdirSync(path.join(project.home, 'vault'), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      path.join(PLUGIN, 'bin/zeroh-disclosure.mjs'),
      // The slash command runs `uninstall --yes $ARGUMENTS`.
      'uninstall',
      '--yes',
      '--force',
      '--dry-run',
    ],
    {
      cwd: project.dir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ZEROH_HOME: project.home,
        CLAUDE_CONFIG_DIR: path.join(project.home, 'claude'),
        ZEROH_CLAUDE_SETTINGS: path.join(
          project.home,
          'claude',
          'settings.json',
        ),
        ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
      },
      encoding: 'utf8',
      timeout: 20000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /This removes ZeroH Disclosure/u);
  assert.deepEqual(readdirSync(project.home).sort(), [
    'statusline.json',
    'vault',
  ]);
});
