// SPDX-License-Identifier: AGPL-3.0-only

// Windows-only regression tests for the Windows re-test of 1.0.0-rc.2: the
// same findings as test/windows-retest.test.mjs, run against the real tools
// on a Windows machine (the CI unit leg on windows-latest) instead of with
// platform injection. Elsewhere they skip and say why. On a Windows machine
// where a tool is missing they also skip, unless ZEROH_WINDOWS_REAL_TESTS is
// `required` (CI sets it), where a missing tool fails the test.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { wrapBashExitStatus } from '../lib/exit-status.js';
import { prepareBashLateBinding } from '../lib/late-bind.js';
import { windowsSystemTool } from '../lib/private-fs.js';
import { createServiceManager } from '../lib/service-manager.js';
import { claudeCodeRefuses } from './claude-code-check.mjs';

const WINDOWS = process.platform === 'win32';
const REQUIRED = process.env.ZEROH_WINDOWS_REAL_TESTS === 'required';
const NOT_WINDOWS = `needs Windows (runs on the windows-latest CI leg); this is ${process.platform}`;

// Git Bash, as Claude Code finds it: CLAUDE_CODE_GIT_BASH_PATH, then Git for
// Windows' usual places.
function gitBash() {
  const candidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Git',
      'bin',
      'bash.exe',
    ),
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Git',
      'bin',
      'bash.exe',
    ),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function missing(t, what) {
  if (REQUIRED) assert.fail(`${what} is missing on this Windows machine`);
  t.skip(`${what} is missing on this Windows machine`);
}

test('Windows re-test 1 (real Windows): schtasks /Create /XML registers the task file ZeroH writes', (t) => {
  if (!WINDOWS) {
    t.skip(NOT_WINDOWS);
    return;
  }
  const schtasks = windowsSystemTool('schtasks.exe', process.env);
  if (!existsSync(schtasks)) {
    missing(t, 'schtasks.exe');
    return;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), 'zeroh-real-task-'));
  const manager = createServiceManager({
    env: { ...process.env, ZEROH_SERVICE_MANAGER_DIR: root },
    platform: 'win32',
    definitionRoot: root,
    // Writes the definition only; this test registers it under its own name.
    executeCommands: false,
  });
  const { definition } = manager.register({
    runtime: path.join(root, 'runtime'),
    config: path.join(root, 'proxy.json'),
  });
  const bytes = readFileSync(definition);
  assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
  const name = `ZeroH Disclosure CI ${process.pid}-${Date.now()}`;
  const run = (args) =>
    spawnSync(schtasks, args, { encoding: 'latin1', windowsHide: true });
  try {
    const created = run(['/Create', '/TN', name, '/XML', definition, '/F']);
    assert.equal(
      created.status,
      0,
      `schtasks refused the task file: ${created.stderr || created.stdout}`,
    );
    const queried = run(['/Query', '/TN', name]);
    assert.equal(queried.status, 0, queried.stderr || queried.stdout);
  } finally {
    run(['/Delete', '/TN', name, '/F']);
  }
  assert.notEqual(
    run(['/Query', '/TN', name]).status,
    0,
    'the task was removed',
  );
});

test('Windows re-test 5 (real Windows): the restore wrapper passes Claude Code’s check and runs in Git Bash', (t) => {
  if (!WINDOWS) {
    t.skip(NOT_WINDOWS);
    return;
  }
  const bash = gitBash();
  if (!bash) {
    missing(t, 'Git Bash');
    return;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-real-bash-'));
  const home = path.join(dir, 'zeroh-home');
  const token = '[API_KEY-7a3f9e]';
  const value = 'ZEROHFAKE_windows_value_0000';
  const vault = {
    entryOf: (candidate) =>
      candidate === token ? { value, type: 'API_KEY' } : null,
  };
  for (const command of [
    `printf '%s' "${token}" > argv`,
    `printf '%s' ${token} > argv`,
    `printf '%s' "Bearer ${token}" | tail -c ${value.length} > argv`,
  ]) {
    const result = prepareBashLateBinding({
      command,
      vault,
      sessionId: 'windows-real',
      toolUseId: 'bash',
      home,
    });
    assert.equal(result.ok, true, command);
    const full = wrapBashExitStatus(result.command, { original: command });
    assert.equal(
      claudeCodeRefuses(full),
      false,
      `Claude Code would refuse: ${full}`,
    );
    const run = spawnSync(bash, ['-c', `${full}; cat argv`], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(run.stdout, value, `${command}\n${run.stderr}`);
    assert.equal(existsSync(result.file), false, 'the values file is removed');
  }
});
