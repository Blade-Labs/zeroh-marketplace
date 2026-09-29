// SPDX-License-Identifier: AGPL-3.0-only

// Wording against behaviour (architect review 1.0.0, product rule 5): every
// protection state rendered on every surface that shows it (the SessionStart
// banner in each mode, its warning lines, /zeroh-disclosure:status and the
// status line), in both `uncertain` modes, and no surface may claim
// protection that isn't there. `/zeroh-disclosure:status` used to say a
// secret in the next prompt "is stopped, not sent" in the default pass mode,
// where it is sent with a notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBanner, proxyStatusLines, warningLines } from '../lib/banner.js';
import {
  encodeProjectPath,
  STATUS_FILE,
  statuslineModel,
} from '../lib/statusline.js';
import { PLUGIN } from './helpers.mjs';

// The states lib/hook-io.js proxyState reports, and what each really does
// with what the user types (hooks/user-prompt-submit.js):
//   typing  the proxy masks this session's requests: 'on', and 'ready' (the
//           first prompt writes the settings entry and waits until Claude
//           Code sends through it, T-19);
//   secret  a typed secret the proxy doesn't mask: sent with a "not
//           protected" line by default, stopped with `uncertain block`; a
//           session whose proxy is down can't send at all (D-10).
const STATES = [
  'on',
  'ready',
  'overridden',
  'off',
  'turned-off',
  'provider',
  'down',
];
const MODES = ['pass', 'block'];

function truth(state, mode) {
  return {
    typing: state === 'on' || state === 'ready',
    secret: state === 'down' || mode === 'block' ? 'stopped' : 'sent',
  };
}

// What the status line reads: the proxy word UserPromptSubmit writes to
// status.json for each state.
const STATUS_PROXY = {
  on: 'on',
  ready: 'ready',
  overridden: 'overridden',
  off: 'off',
  'turned-off': 'off',
  provider: 'provider',
  down: 'unreachable',
};

const CLAIMS_TYPING_MASKED =
  /secrets are masked|masks what you type|the proxy masks them/u;
const SAYS_STOPPED = /\bstopped\b/u;
// "sent, with a notice", "is sent with a \"not protected\" line".
const SAYS_SENT_WITH_NOTICE = /\bsent,? with (?:a|the)\b/u;

const RUNTIMES = [
  { installed: true, running: true, loginItem: true },
  { installed: true, running: false, loginItem: false },
  {
    installed: true,
    running: true,
    loginItem: false,
    loginItemRefused: { code: 'EPERM', detail: 'login items are off' },
  },
];

function bannerTexts(state, mode, paused = false) {
  const warnings = warningLines({
    proxy: state,
    uncertain: mode,
    contextFindings: [{ displayPath: 'CLAUDE.md', count: 1 }],
  });
  return ['full', 'big', 'mini', 'compact'].map(
    (bannerMode) =>
      buildBanner({
        mode: bannerMode,
        proxy: state,
        uncertain: mode,
        paused,
        warnings,
      }).text,
  );
}

function statusTexts(state, mode) {
  return RUNTIMES.map((runtime) =>
    proxyStatusLines({ proxy: state, runtime, uncertain: mode }).join('\n'),
  );
}

function statuslineOf(state, { paused = false } = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-surfaces-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'zeroh');
  mkdirSync(root, { recursive: true });
  const dir = path.join(
    home,
    'projects',
    encodeProjectPath(root),
    'sessions',
    's1',
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, STATUS_FILE),
    JSON.stringify({
      v: 1,
      phase: 'ready',
      hooks: { 'session-start': { ok_at: new Date().toISOString() } },
      proxy: STATUS_PROXY[state],
      turn: 1,
      masked: 0,
      sent: 0,
      ...(paused ? { paused: true } : {}),
    }),
  );
  return statuslineModel({
    input: {
      session_id: 's1',
      workspace: { project_dir: root, current_dir: root },
    },
    env: {
      PATH: process.env.PATH,
      HOME: path.join(base, 'home'),
      ZEROH_HOME: home,
      ZEROH_CLAUDE_SETTINGS: path.join(base, 'claude', 'settings.json'),
    },
  });
}

test('no surface says typing is masked where it is not', () => {
  for (const state of STATES) {
    for (const mode of MODES) {
      if (truth(state, mode).typing) continue;
      for (const text of [
        ...bannerTexts(state, mode),
        ...statusTexts(state, mode),
      ]) {
        assert.doesNotMatch(text, CLAIMS_TYPING_MASKED, `${state}/${mode}`);
      }
      assert.notEqual(statuslineOf(state).level, 'protected', state);
    }
  }
});

test('what a surface says happens to a typed secret is what happens, in both modes', () => {
  for (const state of STATES) {
    for (const mode of MODES) {
      const { secret } = truth(state, mode);
      for (const text of [
        ...bannerTexts(state, mode),
        ...statusTexts(state, mode),
      ]) {
        if (secret === 'sent') {
          assert.doesNotMatch(text, SAYS_STOPPED, `${state}/${mode}: ${text}`);
        } else {
          assert.doesNotMatch(
            text,
            SAYS_SENT_WITH_NOTICE,
            `${state}/${mode}: ${text}`,
          );
        }
      }
    }
  }
});

test('/zeroh-disclosure:status names the next prompt by mode', () => {
  const runtime = { installed: true, running: true, loginItem: true };
  const pass = proxyStatusLines({ proxy: 'ready', runtime, uncertain: 'pass' });
  assert.match(
    pass[0],
    /Your next prompt puts it there \(a secret in that prompt is sent, with a "not protected" line\)\./u,
  );
  const block = proxyStatusLines({
    proxy: 'ready',
    runtime,
    uncertain: 'block',
  });
  assert.match(
    block[0],
    /Your next prompt puts it there \(a secret in that prompt is stopped, not sent\)\./u,
  );
});

test('only a session behind a running proxy is "protected" on the status line', () => {
  for (const state of STATES) {
    const model = statuslineOf(state);
    assert.equal(model.level === 'protected', state === 'on', state);
  }
  assert.notEqual(statuslineOf('on', { paused: true }).level, 'protected');
});

test('a vault that cannot be opened is never shown as protected', () => {
  for (const state of STATES) {
    for (const mode of MODES) {
      for (const text of bannerTexts(state, mode, true)) {
        assert.doesNotMatch(text, /✓ Protected/u, `${state}/${mode}`);
      }
    }
  }
});

// The session-only proxy (no login item) masks typing (86b8dcf0): the old
// `no-login-item` state said it could not, and nothing reaches it any more.
test('there is no "no login item, typing can\'t be masked" state left', () => {
  for (const dir of ['lib', 'hooks', 'commands', 'bin']) {
    for (const name of readdirSync(path.join(PLUGIN, dir), {
      recursive: true,
    })) {
      if (!/\.(?:m?js)$/u.test(name)) continue;
      const source = readFileSync(path.join(PLUGIN, dir, name), 'utf8');
      assert.doesNotMatch(source, /'no-login-item'/u, `${dir}/${name}`);
    }
  }
  const refused = { code: 'EPERM', detail: 'login items are off' };
  for (const line of warningLines({
    proxy: 'on',
    loginItemRefused: refused,
  })) {
    assert.doesNotMatch(line, /can't be masked/u);
  }
});
