// SPDX-License-Identifier: AGPL-3.0-only

// Owner decision (2026-09-27): two UserPromptSubmit stops become a pass with
// a "not protected" line by default; `uncertain block` keeps the stop.
//   - a prompt larger than 256 KB: sent unscanned ("too large to scan");
//   - a vault that can't be opened or saved when the prompt needs masking,
//     with the proxy masking the request: sent ("ZeroH couldn't open its
//     vault", with the doctor hint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runHook, tempProject, withProxy } from './helpers.mjs';
import { Vault } from '../lib/vault.js';

const BLOCK = { ZEROH_UNCERTAIN: 'block' };
const FAKE_EMAIL = ['zerohfake', 'example.com'].join('@');

function prompt(project, text, extraEnv = {}) {
  return runHook(
    'user-prompt-submit',
    { hook_event_name: 'UserPromptSubmit', prompt: text },
    { project, extraEnv },
  );
}

test('a prompt too large to scan is sent with a notice by default, stopped in block mode', () => {
  const text = 'x'.repeat(256 * 1024 + 1);
  const passed = prompt(tempProject(), text);
  assert.equal(passed.code, 0, passed.stderr);
  assert.match(
    passed.json?.systemMessage ?? '',
    /^ZeroH Disclosure: this prompt was not protected \(too large to scan\)\./u,
  );
  const blocked = prompt(tempProject(), text, BLOCK);
  assert.equal(blocked.code, 2);
  assert.match(blocked.stderr, /larger than 256 KB/u);
});

test('an unsaveable vault through the proxy: sent with a notice by default, stopped in block mode', async (t) => {
  for (const [mode, extraEnv] of [
    ['pass', {}],
    ['block', BLOCK],
  ]) {
    const p = tempProject();
    const proxy = await withProxy(p);
    t.after(proxy.stop);
    const vaultDir = path.join(p.home, 'vault');
    mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
    chmodSync(vaultDir, 0o500);
    try {
      const res = runHook(
        'user-prompt-submit',
        { prompt: `Email ${FAKE_EMAIL} about the refund` },
        { ...proxy, extraEnv: { ...proxy.extraEnv, ...extraEnv } },
      );
      if (mode === 'pass') {
        assert.equal(res.code, 0, res.stderr);
        const message = res.json?.systemMessage ?? '';
        assert.match(
          message,
          /ZeroH Disclosure: this prompt was not protected \(ZeroH couldn't open its vault\)/u,
        );
        assert.match(message, /\/zeroh-disclosure:doctor/u);
        assert.ok(!message.includes(FAKE_EMAIL));
      } else {
        assert.equal(res.code, 2, res.stderr);
        assert.match(
          res.stderr,
          /can't save its vault|could not save its vault/u,
        );
      }
    } finally {
      chmodSync(vaultDir, 0o700);
    }
  }
});

test('an unreadable vault through the proxy: sent with a notice by default, stopped in block mode', async (t) => {
  for (const [mode, extraEnv] of [
    ['pass', {}],
    ['block', BLOCK],
  ]) {
    const p = tempProject();
    const proxy = await withProxy(p);
    t.after(proxy.stop);
    // A saved vault whose file is then not a vault.
    const vault = new Vault(p.dir, {
      env: {
        HOME: p.home,
        ZEROH_HOME: p.home,
        ZEROH_CREDENTIAL_HOME: p.home,
      },
    });
    vault.tokenFor('EMAIL', ['zerohfake-old', 'example.com'].join('@'));
    vault.save();
    writeFileSync(vault.file, 'not json');
    const res = runHook(
      'user-prompt-submit',
      { prompt: `Email ${FAKE_EMAIL} about the refund` },
      { ...proxy, extraEnv: { ...proxy.extraEnv, ...extraEnv } },
    );
    if (mode === 'pass') {
      assert.equal(res.code, 0, res.stderr);
      assert.match(
        res.json?.systemMessage ?? '',
        /this prompt was not protected \(ZeroH couldn't open its vault\)/u,
      );
    } else {
      assert.equal(res.code, 2, res.stderr);
    }
  }
});
