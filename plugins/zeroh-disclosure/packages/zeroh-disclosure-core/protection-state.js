// SPDX-License-Identifier: AGPL-3.0-only

// One model and one wording table for every surface that describes whether
// ZeroH is protecting a session. I/O stays with each surface; this module is
// deliberately pure so hooks, commands and the status line cannot disagree.
export const ProtectionState = Object.freeze({
  PROTECTED: 'protected',
  FILES_ONLY: 'files-only',
  PROXY_FIRST_PROMPT: 'proxy-first-prompt',
  PROXY_NEXT_PROMPT: 'proxy-next-prompt',
  PROXY_DOWN: 'proxy-down',
  STARTING: 'starting',
  COMPACTING: 'compacting',
  STARTED_BEFORE_ZEROH: 'started-before-zeroh',
  NOT_PROTECTED_TURN: 'not-protected-turn',
  UPSTREAM_MISMATCH: 'upstream-mismatch',
  BASE_URL_CREDENTIALS: 'base-url-credentials',
  OVERRIDDEN: 'overridden',
  HOOKS_FAILING: 'hooks-failing',
  HOOKS_STOPPED: 'hooks-stopped',
  HOOKS_NEVER_RAN: 'hooks-never-ran',
  VAULT_UNAVAILABLE: 'vault-unavailable',
  STATE_UNREADABLE: 'state-unreadable',
  PLUGIN_DISABLED: 'plugin-disabled',
  UNINSTALLED: 'uninstalled',
  REMOVAL_INCOMPLETE: 'removal-incomplete',
  NO_SESSION: 'no-session',
});

export const ProtectionSurface = Object.freeze({
  BANNER: 'banner',
  MINI: 'mini',
  STATUSLINE: 'statusline',
  STATUS: 'status',
  DOCTOR: 'doctor',
  STOP: 'stop',
});

export const ProtectionFix = Object.freeze({
  DOCTOR: '/zeroh-disclosure:doctor',
  PROXY_ON: '/zeroh-disclosure:proxy on',
  RESTART: 'restart Claude Code to protect this session',
  ENABLE: 'enable it in /plugin',
  REMOVE_STATUSLINE: 'remove it with /statusline',
  UNINSTALL: '/zeroh-disclosure:uninstall',
});

const STATES = Object.freeze({
  [ProtectionState.PROTECTED]: {
    level: 'protected',
    long: 'protected',
    compact: 'protected',
    banner: 'Protected: your secrets are masked',
  },
  [ProtectionState.FILES_ONLY]: {
    level: 'warn',
    long: 'files only',
    compact: 'files only',
    banner: 'Protected: files and output are masked',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.PROXY_FIRST_PROMPT]: {
    level: 'warn',
    long: 'proxy starts with your first prompt',
    compact: 'proxy next prompt',
    banner: 'Protected: your secrets are masked',
  },
  [ProtectionState.PROXY_NEXT_PROMPT]: {
    level: 'warn',
    long: 'proxy on from your next prompt',
    compact: 'proxy next prompt',
    banner: 'Protected: files and output are masked',
  },
  [ProtectionState.PROXY_DOWN]: {
    level: 'warn',
    long: 'proxy down',
    compact: 'proxy down',
    banner: 'Protected: files and output are masked',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.STARTING]: {
    level: 'warn',
    long: 'starting',
    compact: 'starting',
  },
  [ProtectionState.COMPACTING]: {
    level: 'warn',
    long: 'compacting',
    compact: 'compacting',
  },
  [ProtectionState.STARTED_BEFORE_ZEROH]: {
    level: 'warn',
    long: 'started before ZeroH',
    compact: 'old session',
    fix: ProtectionFix.RESTART,
  },
  [ProtectionState.NOT_PROTECTED_TURN]: {
    level: 'warn',
    long: ({ count }) => `${count} not protected this turn`,
    compact: ({ count }) => `${count} unprotected`,
  },
  [ProtectionState.UPSTREAM_MISMATCH]: {
    level: 'warn',
    long: 'upstream mismatch',
    compact: 'upstream mismatch',
    banner: 'Protected: files and output are masked',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.BASE_URL_CREDENTIALS]: {
    level: 'warn',
    long: 'credentials in ANTHROPIC_BASE_URL',
    compact: 'URL credentials',
    banner: 'Protected: files and output are masked',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.OVERRIDDEN]: {
    level: 'warn',
    long: 'ANTHROPIC_BASE_URL overridden',
    compact: 'upstream overridden',
    banner: 'Protected: files and output are masked',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.HOOKS_FAILING]: {
    level: 'off',
    long: 'hooks failing',
    compact: 'hooks failing',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.HOOKS_STOPPED]: {
    level: 'off',
    long: 'hooks stopped',
    compact: 'hooks stopped',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.HOOKS_NEVER_RAN]: {
    level: 'off',
    long: 'hooks never ran',
    compact: 'no hooks',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.VAULT_UNAVAILABLE]: {
    level: 'off',
    long: "vault can't be opened",
    compact: 'vault closed',
    banner: 'Paused: see the message below',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.STATE_UNREADABLE]: {
    level: 'off',
    long: "state can't be read",
    compact: 'state unreadable',
    fix: ProtectionFix.DOCTOR,
  },
  [ProtectionState.PLUGIN_DISABLED]: {
    level: 'off',
    long: 'plugin disabled',
    compact: 'disabled',
    fix: ProtectionFix.ENABLE,
  },
  [ProtectionState.UNINSTALLED]: {
    level: 'off',
    long: 'uninstalled',
    compact: 'uninstalled',
    fix: ProtectionFix.REMOVE_STATUSLINE,
  },
  [ProtectionState.REMOVAL_INCOMPLETE]: {
    level: 'off',
    long: 'removal incomplete',
    compact: 'removal incomplete',
    fix: ProtectionFix.UNINSTALL,
  },
  [ProtectionState.NO_SESSION]: {
    level: 'off',
    long: 'no session',
    compact: 'no session',
  },
});

export const PROTECTION_STATE_VALUES = Object.freeze(
  Object.values(ProtectionState),
);

function valueOf(value, context) {
  return typeof value === 'function' ? value(context) : value;
}

export function protectionWording(
  state,
  { surface = ProtectionSurface.STATUSLINE, compact = false, count = 0 } = {},
) {
  const entry = STATES[state] ?? STATES[ProtectionState.STATE_UNREADABLE];
  const context = { count: Math.max(0, Number(count) || 0) };
  const word =
    [ProtectionSurface.BANNER, ProtectionSurface.MINI].includes(surface) &&
    entry.banner
      ? entry.banner
      : valueOf(compact ? entry.compact : entry.long, context);
  return { state, level: entry.level, word, fix: entry.fix ?? null };
}

// Normalized inputs let network-aware surfaces pass a health result while the
// status line passes only its small status.json view.
export function deriveProtectionState({
  sessionProxy = null,
  runtime = null,
  config = {},
  statusJson = null,
} = {}) {
  if (config.uninstalled) return ProtectionState.UNINSTALLED;
  if (config.pluginEnabled === false) return ProtectionState.PLUGIN_DISABLED;
  if (config.session === false) return ProtectionState.NO_SESSION;
  if (config.stateReadable === false) return ProtectionState.STATE_UNREADABLE;
  if (config.hooks === 'failing') return ProtectionState.HOOKS_FAILING;
  if (config.hooks === 'stopped') return ProtectionState.HOOKS_STOPPED;
  if (config.hooks === 'never-ran') return ProtectionState.HOOKS_NEVER_RAN;
  if (config.vaultAvailable === false || statusJson?.paused === true) {
    return ProtectionState.VAULT_UNAVAILABLE;
  }
  if (config.compacting) return ProtectionState.COMPACTING;
  if (config.startedBeforeZeroH) return ProtectionState.STARTED_BEFORE_ZEROH;
  if (statusJson?.phase === 'starting' || config.starting) {
    return ProtectionState.STARTING;
  }
  const unchecked = Number(config.notProtected ?? statusJson?.notProtected);
  if (Number.isFinite(unchecked) && unchecked > 0) {
    return ProtectionState.NOT_PROTECTED_TURN;
  }
  const proxy = sessionProxy ?? statusJson?.proxy;
  if (proxy?.active === true || proxy === 'on')
    return ProtectionState.PROTECTED;
  if (proxy === 'ready') return ProtectionState.PROXY_FIRST_PROMPT;
  if (proxy === 'not-ready') return ProtectionState.PROXY_NEXT_PROMPT;
  if (
    proxy === 'down' ||
    proxy === 'unreachable' ||
    runtime?.running === false
  ) {
    return ProtectionState.PROXY_DOWN;
  }
  if (proxy === 'upstream-mismatch') return ProtectionState.UPSTREAM_MISMATCH;
  if (proxy === 'credentials') return ProtectionState.BASE_URL_CREDENTIALS;
  if (proxy === 'overridden') return ProtectionState.OVERRIDDEN;
  return ProtectionState.FILES_ONLY;
}

export function protectionDisposition(
  state,
  { uncertain = 'pass', channel = 'prompt' } = {},
) {
  if (
    [ProtectionState.PROTECTED, ProtectionState.NOT_PROTECTED_TURN].includes(
      state,
    )
  ) {
    return 'masked';
  }
  if (
    channel === 'output' &&
    [
      ProtectionState.FILES_ONLY,
      ProtectionState.PROXY_FIRST_PROMPT,
      ProtectionState.PROXY_NEXT_PROMPT,
      ProtectionState.PROXY_DOWN,
      ProtectionState.STARTING,
      ProtectionState.UPSTREAM_MISMATCH,
      ProtectionState.BASE_URL_CREDENTIALS,
      ProtectionState.OVERRIDDEN,
    ].includes(state)
  ) {
    return 'masked';
  }
  if (state === ProtectionState.PROXY_DOWN) return 'stopped';
  if (
    [
      ProtectionState.HOOKS_STOPPED,
      ProtectionState.HOOKS_NEVER_RAN,
      ProtectionState.STARTED_BEFORE_ZEROH,
      ProtectionState.PLUGIN_DISABLED,
      ProtectionState.UNINSTALLED,
      ProtectionState.REMOVAL_INCOMPLETE,
      ProtectionState.NO_SESSION,
    ].includes(state)
  ) {
    return 'sent';
  }
  if (uncertain === 'block') {
    return channel === 'output' ? 'withheld' : 'stopped';
  }
  return 'sent';
}

export function typedSecretDisposition(state, uncertain = 'pass') {
  return protectionDisposition(state, { uncertain, channel: 'prompt' });
}

export function compactTypingWord(state, uncertain = 'pass') {
  if (
    [ProtectionState.PROTECTED, ProtectionState.PROXY_FIRST_PROMPT].includes(
      state,
    )
  ) {
    return 'typing masked';
  }
  return uncertain === 'block' ? 'typing stopped' : 'typing not masked';
}

export const NOT_PROTECTED_LINE =
  'a typed secret is sent with a "not protected" line';

export function maskedAgainLine(kind) {
  return `${kind} is masked again: the unmask ended.`;
}
