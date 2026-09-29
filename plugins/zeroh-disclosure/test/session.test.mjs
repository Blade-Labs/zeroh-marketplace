// SPDX-License-Identifier: AGPL-3.0-only

// One session id rule and one project root rule for sessions (the copies
// used to disagree: loadSession skipped CLAUDE_CODE_SESSION_ID, and a turn
// audit update ignored CLAUDE_PROJECT_DIR).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import './helpers.mjs';
import { projectKey } from '../lib/vault.js';
import {
  encodeProjectPath,
  envSessionId,
  loadSession,
  projectRootFromEnv,
  sessionDir,
} from '../lib/session.js';

test('sessions resolve their id and project root the same way everywhere', async (t) => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'zeroh-session-rule-'));
  const saved = { ...process.env };
  t.after(() => {
    for (const key of [
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_SESSION_ID',
      'CLAUDE_PROJECT_DIR',
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  process.env.CLAUDE_CODE_SESSION_ID = 'ZEROHFAKE-code-id';
  process.env.CLAUDE_SESSION_ID = 'ZEROHFAKE-old-id';
  process.env.CLAUDE_PROJECT_DIR = project;
  assert.equal(envSessionId(), 'ZEROHFAKE-code-id');
  assert.equal(envSessionId({ CLAUDE_SESSION_ID: 'x' }), 'x');
  assert.equal(envSessionId({}), null);
  assert.equal(projectRootFromEnv('/elsewhere'), project);
  // Without CLAUDE_PROJECT_DIR (the CLI in a terminal, S-2): the nearest
  // folder up that ZeroH knows as a project, else the folder itself.
  const home = path.join(project, 'zh-home');
  const nested = path.join(project, 'src', 'deep');
  mkdirSync(nested, { recursive: true });
  const bare = { ZEROH_HOME: home };
  assert.equal(projectRootFromEnv(nested, bare), nested);
  // A project ZeroH keeps files for (D-15: under ZEROH_HOME/projects, named
  // as Claude Code names ~/.claude/projects folders).
  mkdirSync(path.join(home, 'projects', encodeProjectPath(project)), {
    recursive: true,
  });
  assert.equal(projectRootFromEnv(nested, bare), project);
  // A .zeroh folder in the project no longer marks it.
  mkdirSync(path.join(nested, '.zeroh'), { recursive: true });
  assert.equal(projectRootFromEnv(nested, bare), project);
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(home, 'projects.json'),
    JSON.stringify({ projects: [{ root: path.join(project, 'src') }] }),
  );
  assert.equal(projectRootFromEnv(nested, bare), path.join(project, 'src'));
  const expected = path.join(
    process.env.ZEROH_HOME,
    'projects',
    encodeProjectPath(project),
    'sessions',
    'ZEROHFAKE-code-id',
  );
  assert.equal(sessionDir(), expected);
  const session = await loadSession({ cwd: project });
  assert.equal(session.dir, expected);
});

// D-15: project folders under ZEROH_HOME/projects are named as Claude Code
// 2.1.283 names ~/.claude/projects folders, so the two line up.
// The examples are absolute on the system under test: on Windows an absolute
// path starts with a drive, and Claude Code's folder then starts "C--".
test('project folders are encoded as Claude Code encodes them', () => {
  const windows = process.platform === 'win32';
  assert.equal(
    encodeProjectPath(
      windows ? 'C:\\srv\\projects\\zeroh' : '/srv/projects/zeroh',
    ),
    windows ? 'C--srv-projects-zeroh' : '-srv-projects-zeroh',
  );
  assert.equal(
    encodeProjectPath(
      windows ? 'C:\\Users\\jürgen\\my app.v2' : '/Users/jürgen/my app.v2',
    ),
    windows ? 'C--Users-j-rgen-my-app-v2' : '-Users-j-rgen-my-app-v2',
  );
  const long = windows ? `C:\\${'a'.repeat(250)}` : `/${'a'.repeat(250)}`;
  const encoded = encodeProjectPath(long);
  assert.equal(
    encoded.slice(0, 200),
    windows ? `C--${'a'.repeat(197)}` : `-${'a'.repeat(199)}`,
  );
  assert.match(encoded.slice(200), /^-[0-9a-z]+$/u);
});

// macOS reports a folder under /var or /tmp as /private/var or /private/tmp
// to a process's working directory, and a project may sit under a linked
// folder anywhere. The CLI in a terminal, Claude Code and the hooks may then
// spell one project two ways; both spellings must reach the same vault,
// allow list and sessions.
test('a project reached through a linked folder keys the same as its real path', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-linked-'));
  const real = path.join(base, 'real');
  mkdirSync(path.join(real, 'src', 'deep'), { recursive: true });
  const link = path.join(base, 'link');
  symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');

  assert.equal(projectKey(link), projectKey(real));
  assert.equal(encodeProjectPath(link), encodeProjectPath(real));
  // A folder that doesn't exist yet keeps its tail under the resolved parent.
  assert.equal(
    encodeProjectPath(path.join(link, 'not-yet')),
    encodeProjectPath(path.join(real, 'not-yet')),
  );

  const env = { ZEROH_HOME: path.join(base, 'home') };
  mkdirSync(path.join(env.ZEROH_HOME, 'projects', encodeProjectPath(real)), {
    recursive: true,
  });
  assert.equal(
    projectKey(projectRootFromEnv(path.join(link, 'src', 'deep'), env)),
    projectKey(real),
  );
});
