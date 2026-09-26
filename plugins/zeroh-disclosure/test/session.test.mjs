// SPDX-License-Identifier: AGPL-3.0-only

// One session id rule and one project root rule for sessions (the copies
// used to disagree: loadSession skipped CLAUDE_CODE_SESSION_ID, and a turn
// audit update ignored CLAUDE_PROJECT_DIR).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import './helpers.mjs';
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
test('project folders are encoded as Claude Code encodes them', () => {
  assert.equal(encodeProjectPath('/srv/projects/zeroh'), '-srv-projects-zeroh');
  assert.equal(
    encodeProjectPath('/Users/jürgen/my app.v2'),
    '-Users-j-rgen-my-app-v2',
  );
  const long = `/${'a'.repeat(250)}`;
  const encoded = encodeProjectPath(long);
  assert.equal(encoded.slice(0, 200), `-${'a'.repeat(199)}`);
  assert.match(encoded.slice(200), /^-[0-9a-z]+$/u);
});
