// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDaemonMode,
  DAEMON_MODES,
  DAEMON_TRANSITIONS,
} from '../../packages/local-proxy/daemon-mode.js';

const EXPECTED_TRANSITIONS = [
  ['serving', 'serving-session-only'],
  ['serving', 'retired'],
  ['serving', 'draining'],
  ['serving', 'stopping'],
  ['serving-session-only', 'serving'],
  ['serving-session-only', 'retired'],
  ['serving-session-only', 'draining'],
  ['serving-session-only', 'stopping'],
  ['retired', 'stopping'],
  ['draining', 'stopping'],
  ['stopping', 'retired'],
  ['stopping', 'draining'],
];

test('proxy mode names every daemon lifecycle state', () => {
  assert.deepEqual(DAEMON_MODES, [
    'serving',
    'serving-session-only',
    'retired',
    'draining',
    'stopping',
  ]);
});

test('proxy mode allows every lifecycle transition, including orphan draining', () => {
  assert.deepEqual(DAEMON_TRANSITIONS, EXPECTED_TRANSITIONS);
  for (const [from, to] of EXPECTED_TRANSITIONS) {
    const observed = [];
    const state = createDaemonMode({
      initial: from,
      onTransition: (transition) => observed.push(transition),
    });
    assert.equal(state.transition(to, 'test transition'), to);
    assert.equal(state.mode, to);
    assert.deepEqual(observed, [{ from, to, why: 'test transition' }]);
  }
});

test('proxy mode rejects every transition the daemon does not perform', () => {
  const expected = new Set(
    EXPECTED_TRANSITIONS.map(([from, to]) => `${from}:${to}`),
  );
  for (const from of DAEMON_MODES) {
    for (const to of DAEMON_MODES) {
      if (expected.has(`${from}:${to}`)) continue;
      const state = createDaemonMode({ initial: from });
      assert.throws(
        () => state.transition(to, 'not performed'),
        /invalid daemon mode transition/,
      );
    }
  }
});
