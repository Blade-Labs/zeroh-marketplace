// SPDX-License-Identifier: AGPL-3.0-only

export const DAEMON_MODES = Object.freeze([
  'serving',
  'serving-session-only',
  'retired',
  'draining',
  'stopping',
]);

export const DAEMON_TRANSITIONS = Object.freeze([
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
]);

const ALLOWED = new Set(
  DAEMON_TRANSITIONS.map(([from, to]) => `${from}:${to}`),
);

export function createDaemonMode({
  initial = 'serving',
  onTransition = () => {},
} = {}) {
  if (!DAEMON_MODES.includes(initial)) {
    throw new Error(`unknown daemon mode: ${initial}`);
  }
  let mode = initial;

  return {
    get mode() {
      return mode;
    },
    transition(to, why = '') {
      if (!DAEMON_MODES.includes(to)) {
        throw new Error(`unknown daemon mode: ${to}`);
      }
      const from = mode;
      if (!ALLOWED.has(`${from}:${to}`)) {
        throw new Error(`invalid daemon mode transition: ${from} -> ${to}`);
      }
      onTransition({ from, to, why });
      mode = to;
      return mode;
    },
  };
}
