// SPDX-License-Identifier: AGPL-3.0-only

import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Vault, vaultRetention } from '../lib/vault.js';
import { restore } from '../lib/secrets.js';
import { reportMiss } from '../lib/report-miss.js';
import { tempProject } from './helpers.mjs';

const VAULT_URL = pathToFileURL(
  new URL('../lib/vault.js', import.meta.url).pathname,
).href;
const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const DAY_MS = 24 * 60 * 60 * 1000;

function testEnv(project, retention = '7d') {
  return {
    ...process.env,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ZEROH_VAULT_RETENTION: retention,
  };
}

function clock(start = Date.parse('2026-09-01T00:00:00.000Z')) {
  let value = start;
  return {
    now: () => value,
    advance(days) {
      value += days * DAY_MS;
    },
    iso: () => new Date(value).toISOString(),
  };
}

function saveInChild(project, value) {
  const source = [
    `import { Vault } from ${JSON.stringify(VAULT_URL)};`,
    'const vault = new Vault(process.argv[1]);',
    "vault.tokenFor('SECRET', process.argv[2], 'parallel-test');",
    'vault.save();',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', source, project.dir, value],
      {
        env: { ...process.env, ZEROH_HOME: project.home },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}: ${stderr}`));
    });
  });
}

test('parallel first use creates one key and preserves every saved entry', async () => {
  const p = tempProject({ env: false });
  const values = Array.from(
    { length: 8 },
    (_, index) => `ZEROHFAKE-parallel-secret-${index}`,
  );
  await Promise.all(values.map((value) => saveInChild(p, value)));
  assert.equal(readFileSync(`${p.home}/vault.key`).length, 32);
  const vault = new Vault(p.dir, { env: { ZEROH_HOME: p.home } });
  assert.equal(vault.size, values.length);
  for (const value of values) assert.ok(vault.byValue.has(value), value);
});

test('token collisions derive stable alternatives without overwriting values', () => {
  const p = tempProject({ env: false });
  const hash = (input) => {
    if (String(input).endsWith(':1')) return '111111';
    if (String(input).endsWith(':2')) return '222222';
    return '000000';
  };
  const vault = new Vault(p.dir, { hash });
  const first = vault.tokenFor('SECRET', 'ZEROHFAKE-collision-a');
  const second = vault.tokenFor('SECRET', 'ZEROHFAKE-collision-b');
  assert.equal(first, '[SECRET-000000]');
  assert.equal(second, '[SECRET-111111]');
  assert.equal(vault.tokenFor('SECRET', 'ZEROHFAKE-collision-b'), second);
  assert.equal(vault.valueOf(first), 'ZEROHFAKE-collision-a');
  assert.equal(vault.valueOf(second), 'ZEROHFAKE-collision-b');

  const registered = vault.register(
    first,
    'SECRET',
    'ZEROHFAKE-collision-c',
    'forced-register',
  );
  assert.equal(registered, '[SECRET-222222]');
  assert.equal(vault.valueOf(first), 'ZEROHFAKE-collision-a');
});

function sessionStart(vault, extra = {}) {
  return vault.save({
    lifecycle: {
      event: 'start',
      fresh: true,
      retention: vaultRetention(vault.env),
      ...extra,
    },
  });
}

function sessionEnd(vault, sessionId = vault.sessionId) {
  return vault.save({ lifecycle: { event: 'end', sessionId } });
}

test('7d retention keeps a detected entry at 6 days and prunes it at 8 on SessionStart', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, '7d');
  const vault = new Vault(project.dir, { env, now: time.now });
  const token = vault.tokenFor('SECRET', 'ZEROHFAKE-seven-day-retention');
  vault.save();

  time.advance(6);
  sessionStart(vault);
  assert.equal(vault.size, 1);

  time.advance(2);
  sessionStart(vault);
  assert.equal(vault.size, 0);
  assert.deepEqual(vault.tombstoneOf(token), {
    type: 'SECRET',
    expired_at: time.iso(),
  });
});

test('masking a retained value refreshes last_used without changing its token', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const vault = new Vault(project.dir, { env, now: time.now });
  const first = vault.tokenFor('SECRET', 'ZEROHFAKE-stable-token');
  vault.save();

  time.advance(3);
  const second = vault.tokenFor('SECRET', 'ZEROHFAKE-stable-token');
  vault.save();

  assert.equal(second, first);
  assert.equal(vault.entryOf(first).last_used, time.iso());
});

test('session retention removes the ending session entries at SessionEnd only', () => {
  const project = tempProject({ env: false });
  const env = testEnv(project, 'session');
  const vault = new Vault(project.dir, { env, sessionId: 'session-a' });
  vault.tokenFor('SECRET', 'ZEROHFAKE-session-retention');
  vault.save();
  assert.equal(vault.size, 1);

  sessionEnd(vault);
  assert.equal(vault.size, 0);
});

test('reported misses stay reported and never age out', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, '7d');
  const value = 'ZEROHFAKE-reported-miss-retention';
  const reporter = new Vault(project.dir, { env, now: time.now });
  const token = reporter.tokenFor('SECRET', 'ZEROHFAKE-plain-detected');
  const reported = reporter.tokenFor('SECRET', value, 'reported:rm_ZEROHFAKE');
  reporter.save();

  // A later detector hit must not demote the reported source.
  time.advance(1);
  const later = new Vault(project.dir, { env, now: time.now });
  later.tokenFor('SECRET', value, 'detected');
  later.save();
  assert.equal(later.entryOf(reported).source, 'reported:rm_ZEROHFAKE');

  time.advance(30);
  sessionStart(later);
  assert.equal(later.entryOf(token), null);
  assert.ok(later.tombstoneOf(token));
  assert.equal(later.entryOf(reported).value, value);
  assert.equal(later.tombstoneOf(reported), null);
  assert.ok(
    later.knownValues().some((entry) => entry.token === reported),
    'reported values stay searchable by the hooks and proxy',
  );

  const sessionEnv = testEnv(project, 'session');
  const session = new Vault(project.dir, {
    env: sessionEnv,
    now: time.now,
    sessionId: 'session-reported',
  });
  session.entryOf(reported);
  session.save();
  sessionStart(session);
  sessionEnd(session);
  assert.equal(session.entryOf(reported).source, 'reported:rm_ZEROHFAKE');
});

test('a reported miss survives SessionStart past the window until vault clear tombstones it', () => {
  const project = tempProject({ env: false });
  const env = testEnv(project, '7d');
  const value = 'ZEROHFAKE-reported-until-clear';
  const { token } = reportMiss(
    {
      value,
      type_guess: 'SECRET',
      where: 'Bash output from file notes.txt',
      why: 'random-looking credential',
    },
    { cwd: project.dir, env },
  );
  const writer = new Vault(project.dir, { env });
  const detected = writer.tokenFor(
    'SECRET',
    'ZEROHFAKE-detected-beside-report',
  );
  writer.save();

  // Forty days on, a SessionStart prune removes the detected value only.
  const later = new Vault(project.dir, {
    env,
    now: () => Date.now() + 40 * DAY_MS,
  });
  sessionStart(later);
  assert.equal(later.entryOf(detected), null);
  assert.ok(later.tombstoneOf(detected));
  assert.equal(later.entryOf(token)?.value, value);
  assert.match(later.entryOf(token).source, /^reported:/u);
  assert.equal(later.tombstoneOf(token), null);

  const cleared = runCli(project, env, ['vault', 'clear', '--yes']);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(cleared.stdout.includes(value), false);
  const after = new Vault(project.dir, { env });
  assert.equal(after.size, 0);
  assert.equal(after.byValue.has(value), false);
  assert.equal(after.tombstoneOf(token)?.type, 'SECRET');
  assert.equal(
    restore(`use ${token}`, after).restored.length,
    0,
    'a cleared reported token no longer restores',
  );
});

test('30d retention keeps a detected entry longer than the default window', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, '30d');
  const vault = new Vault(project.dir, { env, now: time.now });
  vault.tokenFor('SECRET', 'ZEROHFAKE-thirty-day-retention');
  vault.save();

  time.advance(8);
  sessionStart(vault);
  assert.equal(vault.size, 1);

  time.advance(23);
  sessionStart(vault);
  assert.equal(vault.size, 0);
});

test('known values are kept while their source is refreshed', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, '7d');
  const vault = new Vault(project.dir, { env, now: time.now });
  vault.refreshKnown([
    {
      name: 'KNOWN_KEY',
      type: 'API_KEY',
      value: 'ZEROHFAKE-known-retention-value',
    },
  ]);
  sessionStart(vault);

  time.advance(365);
  sessionStart(vault);
  assert.equal(vault.size, 1);
});

test('a known value missing on the next session becomes detected and ages out', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, '7d');
  const vault = new Vault(project.dir, { env, now: time.now });
  vault.refreshKnown([
    {
      name: 'REMOVED_KEY',
      type: 'API_KEY',
      value: 'ZEROHFAKE-removed-known-value',
    },
  ]);
  sessionStart(vault);

  time.advance(8);
  const nextSession = new Vault(project.dir, { env, now: time.now });
  nextSession.refreshKnown([]);
  sessionStart(nextSession);
  assert.equal(nextSession.size, 0);
});

test('restore updates last_used and persists it in one save', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const vault = new Vault(project.dir, { env, now: time.now });
  const token = vault.tokenFor('SECRET', 'ZEROHFAKE-restored-value');
  vault.save();

  time.advance(2);
  const restoring = new Vault(project.dir, { env, now: time.now });
  assert.equal(restore(token, restoring).text, 'ZEROHFAKE-restored-value');
  restoring.save();

  const reloaded = new Vault(project.dir, { env, now: time.now });
  assert.equal(reloaded.entryOf(token).last_used, time.iso());
});

test('legacy entries without last_used migrate as used now', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const vault = new Vault(project.dir, { env, now: time.now });
  const token = vault.tokenFor('SECRET', 'ZEROHFAKE-legacy-entry');
  vault.save();
  removeLastUsed(vault.file, path.join(project.home, 'vault.key'));

  time.advance(20);
  const migrated = new Vault(project.dir, { env, now: time.now });
  assert.equal(migrated.entries.get(token).last_used, time.iso());
  sessionStart(migrated);
  const persisted = new Vault(project.dir, { env, now: time.now });
  assert.equal(persisted.entries.get(token).last_used, time.iso());

  time.advance(6);
  sessionStart(persisted);
  assert.equal(persisted.size, 1);
});

test('pruning a stale snapshot preserves entries from another save', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const initial = new Vault(project.dir, { env, now: time.now });
  initial.tokenFor('SECRET', 'ZEROHFAKE-expiring-entry');
  initial.save();

  time.advance(8);
  const pruningWriter = new Vault(project.dir, { env, now: time.now });
  const addingWriter = new Vault(project.dir, { env, now: time.now });
  addingWriter.tokenFor('SECRET', 'ZEROHFAKE-concurrent-entry');
  addingWriter.save();
  sessionStart(pruningWriter);

  const merged = new Vault(project.dir, { env, now: time.now });
  assert.equal(merged.size, 1);
  assert.ok(merged.byValue.has('ZEROHFAKE-concurrent-entry'));
});

test('stale usage writers cannot overwrite authoritative known-source refreshes', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, 'session');
  const value = 'ZEROHFAKE-concurrent-known-source';
  const initial = new Vault(project.dir, { env, now: time.now });
  const token = initial.tokenFor('SECRET', value);
  initial.save();

  time.advance(1);
  const knownWriter = new Vault(project.dir, { env, now: time.now });
  const staleUsageWriter = new Vault(project.dir, {
    env,
    now: time.now,
    sessionId: 'session-a',
  });
  knownWriter.refreshKnown([{ name: 'KNOWN_KEY', type: 'SECRET', value }]);
  sessionStart(knownWriter);

  time.advance(1);
  staleUsageWriter.tokenFor('SECRET', value, 'detected');
  staleUsageWriter.save();

  const merged = new Vault(project.dir, { env, now: time.now });
  assert.equal(merged.entries.get(token).source, 'known:KNOWN_KEY');
  sessionEnd(merged, 'session-a');
  assert.equal(merged.size, 1);
});

test('stale usage writers cannot undo authoritative known-source demotion', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const value = 'ZEROHFAKE-concurrent-demotion';
  const initial = new Vault(project.dir, { env, now: time.now });
  initial.refreshKnown([{ name: 'OLD_KEY', type: 'SECRET', value }]);
  sessionStart(initial);

  time.advance(1);
  const demotingWriter = new Vault(project.dir, { env, now: time.now });
  const staleUsageWriter = new Vault(project.dir, { env, now: time.now });
  demotingWriter.refreshKnown([]);
  sessionStart(demotingWriter);

  time.advance(1);
  staleUsageWriter.tokenFor('SECRET', value, 'detected');
  staleUsageWriter.save();

  const merged = new Vault(project.dir, { env, now: time.now });
  assert.equal(merged.entries.values().next().value.source, 'detected');
});

test('ordinary saves never prune, whatever the process environment says', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const seed = new Vault(project.dir, {
    env: testEnv(project, '30d'),
    now: time.now,
  });
  seed.tokenFor('SECRET', 'ZEROHFAKE-ten-day-old');
  sessionStart(seed);

  time.advance(10);
  // A process that never saw the user's 30d setting (proxy, display hook).
  const hotPath = new Vault(project.dir, {
    env: testEnv(project, '7d'),
    now: time.now,
  });
  hotPath.tokenFor('SECRET', 'ZEROHFAKE-new-detection');
  assert.equal(hotPath.save(), true);
  assert.equal(new Vault(project.dir, { env: testEnv(project) }).size, 2);

  // SessionEnd uses the stored 30d policy, not its own 7d fallback.
  sessionEnd(
    new Vault(project.dir, { env: testEnv(project, '7d'), now: time.now }),
  );
  assert.equal(new Vault(project.dir, { env: testEnv(project) }).size, 2);
});

test('last_used is refreshed at most once per hour and an unchanged vault is not rewritten', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const vault = new Vault(project.dir, { env, now: time.now });
  const token = vault.tokenFor('SECRET', 'ZEROHFAKE-throttled-entry');
  assert.equal(vault.save(), true);
  const before = readFileSync(vault.file, 'utf8');

  time.advance(30 / (24 * 60));
  const reader = new Vault(project.dir, { env, now: time.now });
  assert.equal(reader.valueOf(token), 'ZEROHFAKE-throttled-entry');
  assert.equal(reader.save(), false);
  assert.equal(new Vault(project.dir, { env }).save(), false);
  assert.equal(readFileSync(vault.file, 'utf8'), before);

  time.advance(31 / (24 * 60));
  assert.equal(reader.valueOf(token), 'ZEROHFAKE-throttled-entry');
  assert.equal(reader.save(), true);
  assert.notEqual(readFileSync(vault.file, 'utf8'), before);
  assert.equal(
    new Vault(project.dir, { env, now: time.now }).entries.get(token).last_used,
    time.iso(),
  );
});

test('a writer loaded before vault clear cannot bring cleared values back', () => {
  const project = tempProject({ env: false });
  const env = testEnv(project);
  const first = new Vault(project.dir, { env });
  const token = first.tokenFor('SECRET', 'ZEROHFAKE-cleared-value');
  first.save();

  const stale = new Vault(project.dir, {
    env,
    now: () => Date.now() + 2 * 3_600_000,
  });
  new Vault(project.dir, { env }).clear();
  assert.equal(restore(`use ${token}`, stale).restored.length, 1);
  const fresh = stale.tokenFor('SECRET', 'ZEROHFAKE-detected-after-clear');
  stale.save();

  const after = new Vault(project.dir, { env });
  assert.equal(after.size, 1);
  assert.equal(after.byValue.get('ZEROHFAKE-detected-after-clear'), fresh);
  assert.equal(after.byValue.has('ZEROHFAKE-cleared-value'), false);
  assert.ok(after.tombstoneOf(token));
});

test('a pruned token is never reassigned to a different value', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const hash = (input) => (String(input).endsWith(':1') ? '111111' : '000000');
  const vault = new Vault(project.dir, { env, now: time.now, hash });
  const first = vault.tokenFor('SECRET', 'ZEROHFAKE-reuse-a');
  vault.save();
  time.advance(8);
  sessionStart(vault);
  assert.equal(vault.size, 0);

  const next = new Vault(project.dir, { env, now: time.now, hash });
  const other = next.tokenFor('SECRET', 'ZEROHFAKE-reuse-c');
  assert.equal(first, '[SECRET-000000]');
  assert.equal(other, '[SECRET-111111]');
  next.save();
  const reloaded = new Vault(project.dir, { env, now: time.now, hash });
  assert.equal(reloaded.valueOf(first), null);
  assert.ok(reloaded.tombstoneOf(first));
  assert.equal(
    JSON.stringify([...reloaded.tombstones.values()]).includes('ZEROHFAKE'),
    false,
  );
});

test('tombstones older than 90 days are dropped', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const vault = new Vault(project.dir, { env, now: time.now });
  const token = vault.tokenFor('SECRET', 'ZEROHFAKE-old-tombstone');
  vault.save();
  time.advance(8);
  sessionStart(vault);
  assert.ok(vault.tombstoneOf(token));
  time.advance(91);
  sessionStart(vault);
  assert.equal(vault.tombstoneOf(token), null);
});

test('session retention across two sessions and a fresh start', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project, 'session');
  const a = new Vault(project.dir, { env, now: time.now, sessionId: 'a' });
  const b = new Vault(project.dir, { env, now: time.now, sessionId: 'b' });
  sessionStart(a, { sessionId: 'a' });
  sessionStart(b, { sessionId: 'b' });
  a.tokenFor('SECRET', 'ZEROHFAKE-session-a');
  a.save();
  b.tokenFor('SECRET', 'ZEROHFAKE-session-b');
  b.save();

  // A third session starting now leaves both live sessions' values alone.
  sessionStart(new Vault(project.dir, { env, now: time.now, sessionId: 'c' }), {
    sessionId: 'c',
  });
  assert.equal(new Vault(project.dir, { env }).size, 2);

  sessionEnd(new Vault(project.dir, { env, now: time.now, sessionId: 'a' }));
  const afterA = new Vault(project.dir, { env });
  assert.equal(afterA.byValue.has('ZEROHFAKE-session-a'), false);
  assert.equal(afterA.byValue.has('ZEROHFAKE-session-b'), true);

  // A crash leftover from b is removed by a fresh start a day later.
  time.advance(1.1);
  sessionStart(new Vault(project.dir, { env, now: time.now, sessionId: 'd' }), {
    sessionId: 'd',
  });
  assert.equal(new Vault(project.dir, { env }).size, 0);
});

test('timestamps in the future are clamped to now when read', () => {
  const project = tempProject({ env: false });
  const time = clock();
  const env = testEnv(project);
  const future = new Vault(project.dir, {
    env,
    now: () => time.now() + 100 * DAY_MS,
  });
  const token = future.tokenFor('SECRET', 'ZEROHFAKE-future-entry');
  future.save();

  const reader = new Vault(project.dir, { env, now: time.now });
  assert.equal(reader.entries.get(token).last_used, time.iso());
  assert.equal(reader.entries.get(token).first_seen, time.iso());
  // The next SessionStart persists the clamped time.
  sessionStart(reader);
  assert.equal(
    new Vault(project.dir, { env, now: time.now }).entries.get(token).last_used,
    time.iso(),
  );
  time.advance(8);
  sessionStart(reader);
  assert.equal(
    reader.size,
    0,
    'a future timestamp does not keep an entry forever',
  );
});

test('vault status reports aggregates without values and clear requires consent', () => {
  const project = tempProject({ env: false });
  const env = testEnv(project);
  const value = 'ZEROHFAKE-cli-vault-value';
  const vault = new Vault(project.dir, { env });
  vault.tokenFor('SECRET', value);
  vault.save();

  const beforeStatus = readFileSync(vault.file, 'utf8');
  const status = runCli(project, env, ['vault', 'status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(
    readFileSync(vault.file, 'utf8'),
    beforeStatus,
    'status is read-only',
  );
  assert.equal(status.stdout.includes(value), false);
  const parsedStatus = JSON.parse(status.stdout);
  assert.equal(parsedStatus.retention, '7d');
  assert.equal(parsedStatus.total, 1);
  assert.deepEqual(parsedStatus.counts_by_type, { SECRET: 1 });
  assert.ok(parsedStatus.oldest_last_use_age_ms >= 0);

  const cancelled = runCli(project, env, ['vault', 'clear'], 'no\n');
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(new Vault(project.dir, { env }).size, 1);

  const cleared = runCli(project, env, ['vault', 'clear', '--yes']);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(cleared.stdout.includes(value), false);
  assert.equal(new Vault(project.dir, { env }).size, 0);
});

function runCli(project, env, args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: project.dir,
    env,
    input,
    encoding: 'utf8',
  });
}

function removeLastUsed(file, keyFile) {
  const key = readFileSync(keyFile);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(raw.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(raw.data, 'base64')),
    decipher.final(),
  ]);
  const payload = JSON.parse(plain.toString('utf8'));
  for (const entry of Object.values(payload.entries)) delete entry.last_used;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  writeFileSync(
    file,
    JSON.stringify({
      ...raw,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    }),
    { mode: 0o600 },
  );
}
