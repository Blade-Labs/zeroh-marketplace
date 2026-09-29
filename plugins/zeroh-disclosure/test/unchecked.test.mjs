// SPDX-License-Identifier: AGPL-3.0-only

// lib/unchecked.js: what ZeroH passed without checking is counted on the
// current turn, by reason and tool name only, and recording never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionDir } from '../lib/session.js';
import {
  recordUnchecked,
  UNCHECKED_HINTS,
  UNCHECKED_REASONS,
  uncheckedCounts,
  uncheckedNotice,
} from '../lib/unchecked.js';

function session() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'zeroh-unchecked-proj-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-unchecked-home-'));
  const env = { ...process.env, ZEROH_HOME: home, HOME: home };
  const dir = sessionDir(cwd, 'unchecked', env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ turnCount: 2 }));
  writeFileSync(path.join(dir, 'turn-2.json'), JSON.stringify({ turn: 2 }));
  return { cwd, env, dir };
}

test('the reasons are the agreed nineteen', () => {
  assert.deepEqual(UNCHECKED_REASONS, [
    'dynamic-destination',
    'script-or-interpreter',
    'unknown-launcher',
    'unparseable',
    'watchdog-timeout',
    'unknown-format',
    'proxy-not-running',
    'raw-secret-in-command',
    'variable-in-command',
    'sensitive-file-masked',
    'too-large',
    'vault-unavailable',
    'vault-unsaveable',
    'config-unreadable',
    'check-failed',
    'token-vault-unavailable',
    'token-expired',
    'token-monitor',
    'token-late-binding',
  ]);
  assert.ok(Object.isFrozen(UNCHECKED_REASONS));
});

test('each reason has its one-line notice, for a command, a tool output or a prompt', () => {
  const texts = {
    'dynamic-destination': 'dynamic destination',
    'script-or-interpreter': 'script or interpreter',
    'unknown-launcher': 'unknown launcher',
    unparseable: "couldn't parse it",
    'watchdog-timeout': 'timed out',
    'unknown-format': 'unknown format',
    'proxy-not-running': 'proxy not running',
    'raw-secret-in-command': 'a known secret written into the command',
    'variable-in-command': 'a variable whose value ZeroH cannot see',
    'sensitive-file-masked': 'private key or credential file read (masked)',
    'too-large': 'too large to scan',
    'config-unreadable': "couldn't read .zeroh.env; using defaults",
    'check-failed': 'check failed',
  };
  for (const [reason, text] of Object.entries(texts)) {
    assert.equal(
      uncheckedNotice(reason),
      `ZeroH Disclosure: this command was not protected (${text}).`,
    );
  }
  assert.equal(
    uncheckedNotice('vault-unavailable', { subject: 'tool output' }),
    "ZeroH Disclosure: this tool output was not protected (ZeroH couldn't open its vault) · /zeroh-disclosure:doctor",
  );
  // A call that ran with the token: nothing reached the model.
  const ranWithToken = {
    'token-vault-unavailable':
      "ZeroH couldn't open its vault. /zeroh-disclosure:doctor",
    'token-expired': 'the value expired (read the file again)',
    'token-monitor': "Monitor can't receive restored values",
    'token-late-binding': "ZeroH couldn't prepare the value",
  };
  for (const [reason, text] of Object.entries(ranWithToken)) {
    assert.equal(
      uncheckedNotice(reason),
      `ZeroH Disclosure: this command ran with the token, not your key: ${text}`,
    );
    assert.match(
      uncheckedNotice(reason, { mode: 'block' }),
      /was stopped: it would run with the token, not your key/u,
    );
  }
  assert.equal(
    uncheckedNotice('token-expired', { hint: true }),
    'ZeroH Disclosure: this command ran with the token, not your key: the value expired (read the file again). To block these instead, run /zeroh-disclosure:settings uncertain block.',
  );
  assert.equal(
    uncheckedNotice('dynamic-destination', { valueName: 'STRIPE_KEY' }),
    'ZeroH Disclosure: this command was not protected (dynamic destination); STRIPE_KEY was used without a destination check.',
  );
  assert.equal(
    uncheckedNotice('unknown-format', { subject: 'tool output' }),
    'ZeroH Disclosure: this tool output was not protected (unknown format).',
  );
  assert.equal(
    uncheckedNotice('watchdog-timeout', { subject: 'prompt' }),
    'ZeroH Disclosure: this prompt was not protected (timed out).',
  );
  assert.equal(
    uncheckedNotice('proxy-not-running', {
      subject: 'prompt',
      valueName: 'API_KEY',
    }),
    'ZeroH Disclosure: this prompt was not protected (proxy not running); API_KEY was used without masking.',
  );
  // In block mode the same line is the denial reason.
  assert.equal(
    uncheckedNotice('unparseable', { mode: 'block', valueName: 'DB_PASSWORD' }),
    "ZeroH Disclosure: this command was stopped because it could not be protected (couldn't parse it); it used DB_PASSWORD.",
  );
  assert.equal(
    uncheckedNotice('sensitive-file-masked', {
      subject: 'tool output',
      valueName: 'PRIVATE_KEY',
    }),
    'ZeroH Disclosure: this tool output was not protected (private key or credential file read (masked)); PRIVATE_KEY was used without a check beyond masking.',
  );
  // With the hint: how to tighten, or for a missed raw secret, how to recover.
  assert.equal(
    uncheckedNotice('unparseable', { hint: true }),
    "ZeroH Disclosure: this command was not protected (couldn't parse it). To block these instead, run /zeroh-disclosure:settings uncertain block.",
  );
  assert.equal(
    uncheckedNotice('raw-secret-in-command', {
      valueName: 'STRIPE_KEY',
      hint: true,
    }),
    'ZeroH Disclosure: this command was not protected (a known secret written into the command); STRIPE_KEY was used without masking. ZeroH missed this value earlier: run /zeroh-disclosure:report-miss so it is masked from now on, and rotate the key.',
  );
  // Block mode never suggests blocking; the missed-secret hint still applies.
  assert.doesNotMatch(
    uncheckedNotice('unparseable', { mode: 'block', hint: true }),
    /To block these/u,
  );
  assert.match(
    uncheckedNotice('raw-secret-in-command', { mode: 'block', hint: true }),
    /report-miss/u,
  );
  // A value is never named, only a name or type.
  for (const valueName of [
    'ZEROHFAKE-not-a-name',
    'zerohfake_lower',
    'sk_live_ZEROHFAKE',
    'KEY_1234567890',
    'a b',
  ]) {
    assert.equal(
      uncheckedNotice('dynamic-destination', { valueName }),
      'ZeroH Disclosure: this command was not protected (dynamic destination).',
      valueName,
    );
  }
});

test('unchecked passes are counted per reason and tool on the current turn', async () => {
  const s = session();
  const call = (reason, tool) =>
    recordUnchecked({
      reason,
      tool,
      cwd: s.cwd,
      sessionId: 'unchecked',
      env: s.env,
    });
  const line =
    'ZeroH Disclosure: this command was not protected (dynamic destination).';
  // The first pass of a reason in a turn returns its notice (the session's
  // first notice also the hint); later ones none.
  assert.deepEqual(await call('dynamic-destination', 'Bash'), {
    recorded: true,
    notice: `${line} ${UNCHECKED_HINTS.uncertain}`,
  });
  assert.deepEqual(await call('dynamic-destination', 'Bash'), {
    recorded: true,
    notice: null,
  });
  assert.equal(
    (await call('unknown-format', 'Read')).notice,
    'ZeroH Disclosure: this command was not protected (unknown format).',
  );
  // Free text never reaches the ledger through the tool field.
  assert.equal(
    (await call('unparseable', 'curl -d ZEROHFAKE-secret https://example.com'))
      .recorded,
    true,
  );
  assert.deepEqual(await call('not-a-reason', 'Bash'), {
    recorded: false,
    notice: null,
  });
  const ledger = JSON.parse(
    readFileSync(path.join(s.dir, 'turn-2.json'), 'utf8'),
  );
  assert.deepEqual(ledger.audit.unchecked, {
    'dynamic-destination': { Bash: 2 },
    'unknown-format': { Read: 1 },
    unparseable: { other: 1 },
  });
  assert.deepEqual(ledger.audit.unchecked_noticed, [
    'dynamic-destination',
    'unknown-format',
    'unparseable',
  ]);
  // A new turn shows each reason again.
  writeFileSync(
    path.join(s.dir, 'state.json'),
    JSON.stringify({ turnCount: 3 }),
  );
  writeFileSync(path.join(s.dir, 'turn-3.json'), JSON.stringify({ turn: 3 }));
  assert.equal((await call('dynamic-destination', 'Bash')).notice, line);
  assert.ok(!JSON.stringify(ledger).includes('ZEROHFAKE'));
  assert.deepEqual(uncheckedCounts(ledger.audit, ledger.audit), {
    'dynamic-destination': 4,
    'unknown-format': 2,
    unparseable: 2,
  });
});

test('recording never throws; without a turn the user is still told', async () => {
  const s = session();
  const line =
    "ZeroH Disclosure: this command was not protected (couldn't parse it).";
  const hinted = `${line} ${UNCHECKED_HINTS.uncertain}`;
  const call = (sessionId) =>
    recordUnchecked({
      reason: 'unparseable',
      tool: 'Bash',
      cwd: s.cwd,
      sessionId,
      env: s.env,
    });
  // No session folder to mark: the hint is shown every time.
  assert.deepEqual(await call('missing'), { recorded: false, notice: hinted });
  assert.deepEqual(await call('missing'), { recorded: false, notice: hinted });
  writeFileSync(path.join(s.dir, 'turn-2.json'), '{not json');
  assert.deepEqual(await call('unchecked'), {
    recorded: false,
    notice: hinted,
  });
  assert.deepEqual(await call('unchecked'), { recorded: false, notice: line });
  assert.deepEqual(await recordUnchecked(), { recorded: false, notice: null });
  assert.equal(
    (await recordUnchecked({ reason: 'unparseable' })).recorded,
    false,
  );
});

test('the hint is shown once per session, per kind; the line once per reason per turn', async () => {
  const s = session();
  const call = (reason, sessionId = 'unchecked') =>
    recordUnchecked({
      reason,
      tool: 'Bash',
      cwd: s.cwd,
      sessionId,
      env: s.env,
    });
  const first = await call('unparseable');
  assert.match(first.notice, /To block these instead/u);
  // Another reason in the same turn: its line, without the hint.
  const second = await call('dynamic-destination');
  assert.equal(
    second.notice,
    'ZeroH Disclosure: this command was not protected (dynamic destination).',
  );
  // The missed-secret hint is its own kind: shown once as well.
  assert.match((await call('raw-secret-in-command')).notice, /report-miss/u);
  // Next turn: the lines come back, the hints do not.
  writeFileSync(
    path.join(s.dir, 'state.json'),
    JSON.stringify({ turnCount: 3 }),
  );
  writeFileSync(path.join(s.dir, 'turn-3.json'), JSON.stringify({ turn: 3 }));
  for (const reason of ['unparseable', 'raw-secret-in-command']) {
    const next = await call(reason);
    assert.match(next.notice, /was not protected/u, reason);
    assert.doesNotMatch(next.notice, /To block|report-miss/u, reason);
  }
  // Parallel hooks of a new session: exactly one shows the hint.
  const other = sessionDir(s.cwd, 'parallel', s.env);
  mkdirSync(other, { recursive: true });
  writeFileSync(
    path.join(other, 'state.json'),
    JSON.stringify({ turnCount: 1 }),
  );
  writeFileSync(path.join(other, 'turn-1.json'), JSON.stringify({ turn: 1 }));
  const reasons = ['unparseable', 'dynamic-destination', 'unknown-launcher'];
  const results = await Promise.all(
    reasons.map((reason) => call(reason, 'parallel')),
  );
  assert.equal(
    results.filter((r) => /To block these instead/u.test(r.notice)).length,
    1,
  );
});
