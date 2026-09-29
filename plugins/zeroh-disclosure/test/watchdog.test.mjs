// SPDX-License-Identifier: AGPL-3.0-only

// rc.2 item 5: the hook watchdog. Every hook runs in a worker thread; the
// loader answers fail-closed at the hook's timeout minus 2 s, even when the
// hook is stuck in synchronous code (a runaway regex), and says so plainly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FAKE_STRIPE, PLUGIN, tempProject } from './helpers.mjs';
import { HOOK_TIMEOUTS, hookDeadlineMs } from '../hooks/fail-closed.js';
import { markUninstalled } from '../lib/uninstall-marker.js';
import { sessionDir } from '../lib/session.js';

// A copy of the plugin whose `name` hook body is `body`.
function pluginWith(name, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zeroh-watchdog-plugin-'));
  for (const entry of ['hooks', 'lib', 'bin', '.claude-plugin', 'vendor']) {
    cpSync(path.join(PLUGIN, entry), path.join(dir, entry), {
      recursive: true,
    });
  }
  cpSync(path.join(PLUGIN, 'package.json'), path.join(dir, 'package.json'));
  writeFileSync(path.join(dir, 'hooks', `${name}.js`), body);
  return dir;
}

function run(pluginDir, name, event, project, extraEnv = {}) {
  const started = performance.now();
  const res = spawnSync(
    process.execPath,
    [path.join(pluginDir, 'hooks', 'run.js'), name],
    {
      input: JSON.stringify({
        session_id: 'watchdog',
        cwd: project.dir,
        ...event,
      }),
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: project.home,
        ZEROH_HOME: project.home,
        ZEROH_CREDENTIAL_HOME: project.home,
        ZEROH_CLAUDE_SETTINGS: project.settings,
        ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
        ZEROH_PROXY: 'off',
        CLAUDE_PROJECT_DIR: project.dir,
        TMPDIR: os.tmpdir(),
        ...extraEnv,
      },
      timeout: 40000,
    },
  );
  const out = res.stdout.trim();
  let json = null;
  try {
    json = out ? JSON.parse(out.split('\n').pop()) : null;
  } catch {
    // Plain output: the test reads stdout.
  }
  return {
    code: res.status,
    signal: res.signal,
    stdout: res.stdout,
    stderr: res.stderr,
    json,
    ms: performance.now() - started,
  };
}

const HANG = 'for (;;) {}\n';
const FAST = { ZEROH_HOOK_DEADLINE_MS: '1500' };
const BLOCK = { ...FAST, ZEROH_UNCERTAIN: 'block' };

const EVENTS = {
  'session-start': { source: 'startup' },
  'user-prompt-submit': { prompt: `deploy with ${FAKE_STRIPE}` },
  'pre-tool-use': { tool_name: 'Bash', tool_input: { command: 'echo hi' } },
  'post-tool-use': {
    tool_name: 'Read',
    tool_input: { file_path: '.env' },
    tool_response: {
      type: 'text',
      file: { filePath: '.env', content: `STRIPE_KEY=${FAKE_STRIPE}` },
    },
  },
  'message-display': { delta: 'hello' },
  stop: {},
  'session-end': {},
};

test('the deadline table matches hooks.json, two seconds under each timeout', () => {
  const hooks = JSON.parse(
    readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8'),
  ).hooks;
  for (const [event, entries] of Object.entries(hooks)) {
    const { timeout, command } = entries[0].hooks[0];
    const name = command.split(' ').at(-1);
    assert.equal(HOOK_TIMEOUTS[name], timeout, event);
    assert.equal(hookDeadlineMs(name, {}), (timeout - 2) * 1000);
  }
  assert.deepEqual(
    Object.keys(HOOK_TIMEOUTS).sort(),
    [
      ...new Set(
        Object.values(hooks).map((entries) =>
          entries[0].hooks[0].command.split(' ').at(-1),
        ),
      ),
    ].sort(),
  );
  // An override can only shorten the deadline.
  assert.equal(
    hookDeadlineMs('pre-tool-use', { ZEROH_HOOK_DEADLINE_MS: '1500' }),
    1500,
  );
  assert.equal(
    hookDeadlineMs('pre-tool-use', { ZEROH_HOOK_DEADLINE_MS: '600000' }),
    8000,
  );
});

test('block mode: a hook stuck in synchronous code fails closed at its deadline, for every hook', () => {
  const p = tempProject();
  for (const name of Object.keys(EVENTS)) {
    const plugin = pluginWith(name, HANG);
    const r = run(plugin, name, EVENTS[name], p, BLOCK);
    assert.equal(r.signal, null, `${name} was killed, not answered`);
    assert.ok(r.ms < 6000, `${name} took ${r.ms.toFixed(0)} ms`);
    assert.ok(!r.stdout.includes(FAKE_STRIPE), name);
    if (name === 'user-prompt-submit') {
      assert.equal(r.code, 2);
      assert.match(r.stderr, /timed out/u);
      assert.equal(r.json.decision, 'block');
      assert.match(
        r.json.reason,
        /ZeroH Disclosure: this prompt was stopped because it could not be protected \(timed out\)\./u,
      );
    } else if (name === 'pre-tool-use') {
      assert.equal(r.code, 0);
      assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
      assert.match(
        r.json.hookSpecificOutput.permissionDecisionReason,
        /ZeroH Disclosure: this command was stopped because it could not be protected \(timed out\)\./u,
      );
    } else if (name === 'post-tool-use') {
      assert.equal(r.code, 0);
      const output = r.json.hookSpecificOutput.updatedToolOutput;
      assert.equal(output.type, 'text');
      assert.match(
        output.file.content,
        /this tool output was stopped because it could not be protected \(timed out\)/u,
      );
    } else {
      assert.equal(r.code, 1, name);
      assert.match(r.stderr, /timed out/u, name);
    }
  }
});

test('without an override the deadline is the hooks.json timeout minus 2 s', () => {
  const p = tempProject();
  const plugin = pluginWith('message-display', HANG);
  const r = run(plugin, 'message-display', EVENTS['message-display'], p);
  assert.equal(r.code, 1);
  // The loader names the deadline it used: 5 s - 2 s. Wall time only bounds
  // it from below: process start-up on a Windows runner varied from 0.3 to
  // over 3 s, so an upper bound on it measured the runner, not the deadline.
  assert.match(r.stderr, /timed out \(over 3 s\)/u);
  assert.ok(r.ms >= 2900, `${r.ms.toFixed(0)} ms`);
});

// A MessageDisplay flush that already answered keeps its answer when its
// bookkeeping runs past the deadline: Claude Code shows a failed flush's
// original delta, with its tokens.
test('a MessageDisplay flush that answered before its deadline exits 0', () => {
  const p = tempProject();
  const body = `globalThis.zerohHook.state.emitted = true;
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: 'ZEROHFAKE shown' } }) + '\\n');
for (;;) {}
`;
  const plugin = pluginWith('message-display', body);
  for (const extra of [FAST, BLOCK]) {
    const r = run(
      plugin,
      'message-display',
      EVENTS['message-display'],
      p,
      extra,
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json?.hookSpecificOutput?.displayContent, 'ZEROHFAKE shown');
  }
});

test('block mode: a side effect in progress is reported as possibly half-done', () => {
  const p = tempProject();
  const body = `import { markSideEffect } from '../lib/hook-io.js';
markSideEffect('turning the local proxy off');
for (;;) {}
`;
  const plugin = pluginWith('user-prompt-submit', body);
  const r = run(
    plugin,
    'user-prompt-submit',
    { prompt: '/zeroh-disclosure:proxy off' },
    p,
    BLOCK,
  );
  assert.equal(r.code, 2);
  assert.match(r.json.reason, /turning the local proxy off/u);
  assert.match(r.json.reason, /half-done/u);
  assert.match(r.json.reason, /\/zeroh-disclosure:doctor/u);
});

test('answers written before a hang are kept; exit codes come through the loader', () => {
  const p = tempProject();
  const emitted = pluginWith(
    'pre-tool-use',
    `import { emit } from '../lib/hook-io.js';
emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'ok' } });
for (;;) {}
`,
  );
  const r = run(emitted, 'pre-tool-use', EVENTS['pre-tool-use'], p, BLOCK);
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.additionalContext, 'ok');
  assert.equal(r.stdout.trim().split('\n').length, 1);

  const stopped = pluginWith(
    'user-prompt-submit',
    `import { stopPrompt } from '../lib/hook-io.js';
stopPrompt('stopped for the test');
`,
  );
  const s = run(stopped, 'user-prompt-submit', { prompt: 'x' }, p, FAST);
  assert.equal(s.code, 2);
  assert.equal(s.json.reason, 'stopped for the test');
  assert.match(s.stderr, /stopped for the test/u);

  const exits = pluginWith(
    'stop',
    `process.stdout.write('line one\\n');
process.stderr.write('note\\n');
process.exit(0);
`,
  );
  const e = run(exits, 'stop', {}, p, FAST);
  assert.equal(e.code, 0);
  assert.equal(e.stdout, 'line one\n');
  assert.equal(e.stderr, 'note\n');
});

test('a hook that throws in the worker: denied in block mode, passed with a notice by default', () => {
  const p = tempProject();
  const plugin = pluginWith(
    'pre-tool-use',
    `await Promise.resolve(); throw Object.assign(new Error('boom'), { code: 'EBOOM' });\n`,
  );
  const r = run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, BLOCK);
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
  const passed = run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.equal(passed.code, 0);
  assert.equal(passed.json.hookSpecificOutput, undefined);
  assert.equal(
    passed.json.systemMessage,
    'ZeroH Disclosure: this command was not protected (check failed: EBOOM).',
  );
});

// A session with a current turn, so a timeout can be counted on it.
function withTurn(p) {
  const dir = sessionDir(p.dir, 'watchdog', {
    ZEROH_HOME: p.home,
    HOME: p.home,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 1 }));
  writeFileSync(path.join(dir, 'turn-1.json'), JSON.stringify({ turn: 1 }));
  return () =>
    JSON.parse(readFileSync(path.join(dir, 'turn-1.json'), 'utf8')).audit
      ?.unchecked;
}

test('pass mode (the default): a stuck hook lets the event through, says so once per turn, and counts it', () => {
  const lines = {
    'user-prompt-submit':
      'ZeroH Disclosure: this prompt was not protected (timed out).',
    'pre-tool-use':
      'ZeroH Disclosure: this command was not protected (timed out).',
    'post-tool-use':
      'ZeroH Disclosure: this tool output was not protected (timed out).',
  };
  // Each guarding hook on a turn of its own shows its line.
  for (const name of Object.keys(EVENTS)) {
    const p = tempProject();
    withTurn(p);
    const plugin = pluginWith(name, HANG);
    const r = run(plugin, name, EVENTS[name], p, FAST);
    assert.equal(r.signal, null, name);
    assert.ok(r.ms < 6000, `${name} took ${r.ms.toFixed(0)} ms`);
    if (lines[name]) {
      assert.equal(r.code, 0, name);
      assert.equal(r.json.hookSpecificOutput, undefined, name);
      assert.equal(r.json.decision, undefined, name);
      // The session's first notice says how to tighten.
      assert.equal(
        r.json.systemMessage,
        `${lines[name]} Type /zeroh-disclosure:settings uncertain block to stop these instead.`,
      );
    } else {
      // The hooks that guard nothing: a non-blocking error, not counted.
      assert.equal(r.code, 1, name);
      assert.match(r.stderr, /timed out/u, name);
    }
  }
  // On one turn: said once, counted every time.
  const p = tempProject();
  const unchecked = withTurn(p);
  const pre = pluginWith('pre-tool-use', HANG);
  const post = pluginWith('post-tool-use', HANG);
  const first = run(pre, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.match(
    first.json.systemMessage,
    /^ZeroH Disclosure: this command was not protected \(timed out\)\. Type \/zeroh-disclosure:settings uncertain block/u,
  );
  const second = run(pre, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.equal(second.code, 0);
  assert.equal(second.stdout, '');
  const third = run(post, 'post-tool-use', EVENTS['post-tool-use'], p, FAST);
  assert.equal(third.stdout, '');
  assert.deepEqual(unchecked(), {
    'watchdog-timeout': { Bash: 2, Read: 1 },
  });
});

test('pass mode: a management change cut short is a notice, not a stopped prompt', () => {
  const p = tempProject();
  const plugin = pluginWith(
    'user-prompt-submit',
    `import { markSideEffect } from '../lib/hook-io.js';
markSideEffect('turning the local proxy off');
for (;;) {}
`,
  );
  const r = run(
    plugin,
    'user-prompt-submit',
    { prompt: '/zeroh-disclosure:proxy off' },
    p,
    FAST,
  );
  assert.equal(r.code, 0);
  assert.match(r.json.systemMessage, /turning the local proxy off/u);
  assert.match(r.json.systemMessage, /half-done/u);
  assert.match(r.json.systemMessage, /\/zeroh-disclosure:doctor/u);
});

test('a broken install answers pass even when block is asked for (D-10)', () => {
  const p = tempProject();
  const plugin = pluginWith('pre-tool-use', 'export const = ;\n');
  writeFileSync(path.join(plugin, 'lib', 'config.js'), 'export const = ;\n');
  const r = run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, BLOCK);
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput, undefined);
  assert.match(
    r.json.systemMessage,
    /^ZeroH Disclosure: this command was not protected \(check failed/u,
  );
});

test('a repository can make the mode block through .zeroh.env', () => {
  const p = tempProject();
  writeFileSync(path.join(p.dir, '.zeroh.env'), 'ZEROH_UNCERTAIN=block\n');
  const plugin = pluginWith('pre-tool-use', HANG);
  const r = run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('after uninstall a stuck hook never starts', () => {
  const p = tempProject();
  const env = { ZEROH_HOME: p.home, HOME: p.home };
  markUninstalled(env);
  const plugin = pluginWith('pre-tool-use', HANG);
  const r = run(plugin, 'pre-tool-use', EVENTS['pre-tool-use'], p, FAST);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.ms < 1400, `${r.ms.toFixed(0)} ms`);
});
