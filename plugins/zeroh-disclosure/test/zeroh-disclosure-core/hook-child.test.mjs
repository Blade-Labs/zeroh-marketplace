// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hookChildDiagnostics,
  runHookChild,
  spawnHookSync,
} from '../tools/hook-child.mjs';

function exercise(results, overrides = {}) {
  const calls = [];
  const logs = [];
  const options = { input: 'ZEROHFAKE-event', encoding: 'utf8' };
  const args = ['ZEROHFAKE/hooks/run.js', 'post-tool-use'];
  const result = spawnHookSync('ZEROHFAKE-node', args, options, {
    platform: 'win32',
    nodeVersion: '26.1.0',
    spawn(...call) {
      calls.push(call);
      return results[calls.length - 1];
    },
    log(message) {
      logs.push(message);
    },
    ...overrides,
  });
  return { result, calls, logs, args, options };
}

test('Windows Node 26 retries exactly once for only the two known V8 crash codes', () => {
  for (const status of [0xc0000005, 0x80000003]) {
    for (const stderr of ['', 'V8_Fatal: Check failed: is_int8(disp)']) {
      const crashed = { status, stderr, stdout: '' };
      for (const second of [
        { status: 0, stderr: '', stdout: 'ZEROHFAKE-answer' },
        { status: 7, stderr: 'real failure', stdout: '' },
        crashed,
      ]) {
        const { result, calls, logs, args, options } = exercise([
          crashed,
          second,
        ]);
        assert.equal(result, second, 'retry result is returned unchanged');
        assert.deepEqual(calls, [
          ['ZEROHFAKE-node', args, options],
          ['ZEROHFAKE-node', args, options],
        ]);
        assert.equal(logs.length, 1);
        assert.match(logs[0], /post-tool-use.*retrying once/u);
        assert.ok(logs[0].includes(`0x${status.toString(16)}`));
      }
    }
  }
});

test('ordinary failures, timeouts, other platforms and other Node versions never retry', () => {
  for (const [first, overrides] of [
    [{ status: 1, stderr: 'V8_Fatal' }, {}],
    [{ status: 2, stderr: '' }, {}],
    [{ status: 0x80000003, stderr: 'Error: assertion failed' }, {}],
    [{ status: 0xc0000005, stderr: ' ' }, {}],
    [{ status: null, stderr: '', signal: 'SIGABRT' }, {}],
    [{ status: 0x80000003, stderr: '', error: new Error('timeout') }, {}],
    [{ status: 0x80000003, stderr: '' }, { platform: 'linux' }],
    [{ status: 0x80000003, stderr: '' }, { platform: 'darwin' }],
    [{ status: 0x80000003, stderr: '' }, { nodeVersion: '22.14.0' }],
    [{ status: 0x80000003, stderr: '' }, { nodeVersion: '27.0.0' }],
    [{ status: 0, stderr: '' }, {}],
  ]) {
    const { result, calls, logs } = exercise([first], overrides);
    assert.equal(result, first);
    assert.equal(calls.length, 1);
    assert.deepEqual(logs, []);
  }
});

test('only deliberate busy-loop fixtures get a second crash retry, still capped at three attempts', async () => {
  for (const status of [0xc0000005, 0x80000003]) {
    for (const stderr of ['', 'V8_Fatal: Check failed: is_int8(disp)']) {
      const crash = { status, stderr, stdout: '' };
      for (const last of [
        crash,
        { status: 0, stderr: '', stdout: 'ZEROHFAKE-answer' },
      ]) {
        const sync = exercise([crash, crash, last], {
          deliberateBusyLoop: true,
        });
        assert.equal(sync.result, last);
        assert.equal(sync.calls.length, 3);
        assert.equal(sync.logs.length, 2);
        assert.match(sync.logs[0], /retry 1 of 2.*deliberate busy-loop/u);
        assert.match(sync.logs[1], /retry 2 of 2.*deliberate busy-loop/u);
        let attempts = 0;
        const logs = [];
        const result = await runHookChild(
          async () => [crash, crash, last][attempts++],
          'pre-tool-use',
          {
            platform: 'win32',
            nodeVersion: '26.1.0',
            deliberateBusyLoop: true,
            log: (message) => logs.push(message),
          },
        );
        assert.equal(result, last);
        assert.equal(attempts, 3);
        assert.equal(logs.length, 2);
      }
    }
  }
});

test('async hook attempts keep the same narrow rule and return the final timing and streams unchanged', async () => {
  const crash = { status: 0xc0000005, signal: null, stderr: '', stdout: '' };
  const stopped = {
    status: 0,
    signal: null,
    stderr: '',
    stdout: '',
    watchdogMs: 1500,
  };
  for (const deliberateBusyLoop of [false, true]) {
    for (const last of [
      stopped,
      { status: 1, stderr: 'real watchdog defect' },
      { ...crash, stderr: 'ordinary error' },
      { ...crash, signal: 'SIGABRT' },
      { ...crash, error: new Error('timeout') },
    ]) {
      let attempts = 0;
      const logs = [];
      const result = await runHookChild(
        async () => [crash, last][attempts++],
        'post-tool-use',
        {
          platform: 'win32',
          nodeVersion: '26.1.0',
          deliberateBusyLoop,
          log: (message) => logs.push(message),
        },
      );
      assert.equal(result, last);
      assert.equal(
        attempts,
        2,
        'never retry an exit-0 missing answer or an ordinary failure',
      );
      assert.equal(logs.length, 1);
    }
  }
  for (const controls of [
    { platform: 'linux', nodeVersion: '26.1.0' },
    { platform: 'darwin', nodeVersion: '26.1.0' },
    { platform: 'win32', nodeVersion: '22.14.0' },
  ]) {
    let attempts = 0;
    assert.equal(
      await runHookChild(
        async () => {
          attempts++;
          return crash;
        },
        'stop',
        {
          ...controls,
          deliberateBusyLoop: true,
          log: () => assert.fail('unexpected retry'),
        },
      ),
      crash,
    );
    assert.equal(attempts, 1);
  }
});

test('child diagnostics distinguish empty-output success, native crash and signal termination', () => {
  for (const result of [
    { status: 0, signal: null, stderr: '', stdout: '' },
    { code: 0xc0000005, signal: null, stderr: 'V8_Fatal', stdout: '' },
    {
      code: null,
      signal: 'SIGTERM',
      stderr: 'ZEROHFAKE diagnostic',
      stdout: '',
    },
  ]) {
    const diagnostic = hookChildDiagnostics(result);
    assert.ok(diagnostic.includes(`exit code=${result.status ?? result.code}`));
    assert.ok(diagnostic.includes(`signal=${result.signal}`));
    assert.ok(diagnostic.includes(`stderr=${result.stderr}`));
  }
});
