// SPDX-License-Identifier: AGPL-3.0-only

// The vault and local state through their lifecycle (D-13, review LC-vault):
// first run, breakage, a newer format, clearing and leaving. Fake values only.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMaskingProxy, listen } from '../lib/proxy.js';
import { ensurePrivateDir } from '../lib/private-fs.js';
import { commitmentKeyPath } from '../lib/session.js';
import {
  projectKey,
  protectWindowsPath,
  Vault,
  zerohHome,
} from '../lib/vault.js';
import {
  fakeUpstream,
  PLUGIN,
  postJson,
  runHook,
  tempProject,
  stateDirOf,
} from './helpers.mjs';

const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const VAULT_URL = pathToFileURL(
  fileURLToPath(new URL('../lib/vault.js', import.meta.url)),
).href;
const FAKE_PHONE = '+974 5512 3456';
const isRoot = process.getuid?.() === 0;

function envFor(project, extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: project.home,
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ZEROH_PROXY: 'off',
    ...extra,
  };
}

function cli(project, args, { cwd = project.dir, input, extra = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: envFor(project, extra),
    input,
    encoding: 'utf8',
  });
}

function saveOne(project, value = 'zerohfake@example.com') {
  const vault = new Vault(project.dir, { env: envFor(project) });
  const token = vault.tokenFor('EMAIL', value);
  vault.save();
  return { vault, token };
}

test(
  'an interrupted first key write never leaves a short key in use (LV-B1)',
  {
    skip: process.platform === 'win32' ? 'needs ulimit' : false,
  },
  () => {
    const project = tempProject({ env: false });
    const env = envFor(project);
    // A full disk on the very first write: the key cannot be written at all.
    const script = [
      `import { Vault } from ${JSON.stringify(VAULT_URL)};`,
      'try { const v = new Vault(process.argv[1]); v.tokenFor("EMAIL", "zerohfake@example.com"); v.save(); console.log("saved"); }',
      'catch (e) { console.log("failed", e.code || ""); }',
    ].join('\n');
    const full = spawnSync(
      'sh',
      [
        '-c',
        `trap '' XFSZ; ulimit -f 0; "${process.execPath}" --input-type=module --eval '${script.replaceAll("'", "'\\''")}' "${project.dir}"`,
      ],
      { env, encoding: 'utf8' },
    );
    assert.match(full.stdout, /failed/u, full.stderr);
    const key = path.join(project.home, 'vault.key');
    assert.ok(
      !existsSync(key) || statSync(key).size === 32,
      'no short key is left behind',
    );
    // Space is back: the next run works and the key is whole.
    const { vault } = saveOne(project);
    assert.equal(readFileSync(key).length, 32);
    assert.equal(new Vault(project.dir, { env }).size, vault.size);
  },
);

test('a damaged or missing key is never silently replaced while vaults exist', () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  const key = path.join(project.home, 'vault.key');
  // A short key with nothing encrypted under it yet is replaced.
  mkdirSync(project.home, { recursive: true });
  writeFileSync(key, '');
  saveOne(project);
  assert.equal(readFileSync(key).length, 32);

  // With a vault on disk, a damaged key is refused, never used or replaced.
  writeFileSync(key, 'ZEROHFAKE-short');
  assert.throws(
    () => new Vault(project.dir, { env }),
    (error) => error.code === 'ZEROH_VAULT_KEY_INVALID',
  );
  assert.equal(readFileSync(key, 'utf8'), 'ZEROHFAKE-short');

  // A deleted key is reported, and no new key orphans the vaults.
  const other = tempProject({ env: false });
  saveOne(other);
  const otherKey = path.join(other.home, 'vault.key');
  spawnSync('rm', ['-f', otherKey]);
  assert.throws(
    () => new Vault(other.dir, { env: envFor(other) }),
    (error) => error.code === 'ZEROH_VAULT_KEY_MISSING',
  );
  assert.equal(existsSync(otherKey), false);
});

test('a vault from a newer ZeroH is refused and never written over (LV-B5)', () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  const { vault } = saveOne(project);
  const newer = JSON.stringify({
    v: 3,
    iv: 'AAAAAAAAAAAAAAAA',
    tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    data: 'AAAA',
  });
  writeFileSync(vault.file, newer);
  assert.throws(
    () => new Vault(project.dir, { env }),
    (error) => error.code === 'ZEROH_VAULT_VERSION',
  );
  // A writer that loaded before the upgrade can neither save nor clear it.
  vault.tokenFor('EMAIL', 'zerohfake-2@example.com');
  assert.throws(() => vault.save(), /newer/u);
  assert.throws(() => vault.clear(), /newer/u);
  assert.equal(readFileSync(vault.file, 'utf8'), newer);
  // doctor --fix leaves it alone and says to update the plugin.
  const fixed = cli(project, ['doctor', '--fix']);
  assert.match(fixed.stdout, /newer ZeroH Disclosure/u);
  assert.match(fixed.stdout, /Update the ZeroH Disclosure plugin/u);
  assert.equal(readFileSync(vault.file, 'utf8'), newer);
});

test('doctor --fix resets an unreadable vault, deletes the old file, and says which project (LV-B2)', () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  const { vault } = saveOne(project);
  writeFileSync(vault.file, '{"v":2,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');

  const found = cli(project, ['doctor']);
  assert.match(found.stdout, /The vault of .* cannot be read/u);
  assert.ok(found.stdout.includes(project.dir));
  assert.match(
    found.stdout,
    /\/zeroh-disclosure:doctor --fix resets every vault/u,
  );

  const fixed = cli(project, ['doctor', '--fix']);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /Reset the vault of .*a new, empty vault/u);
  assert.match(fixed.stdout, /The old files were deleted/u);
  // The old file held the values: nothing of it is left behind.
  assert.deepEqual(
    readdirSync(path.dirname(vault.file)).filter((name) =>
      name.includes('.unreadable-'),
    ),
    [],
  );
  assert.equal(new Vault(project.dir, { env }).size, 0);
});

test('doctor --fix from any folder repairs a lost key for every project (RB-2)', () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  saveOne(project);
  const second = path.join(project.dir, 'second');
  mkdirSync(second, { recursive: true });
  const saved = new Vault(second, { env });
  saved.tokenFor('EMAIL', 'zerohfake-b@example.com');
  saved.save();
  rmSync(path.join(project.home, 'vault.key'));
  // The hooks are paused in the project...
  assert.throws(
    () => new Vault(project.dir, { env }),
    (error) => error.code === 'ZEROH_VAULT_KEY_MISSING',
  );
  // ...and the advice is run from a new terminal, in an unrelated folder.
  const elsewhere = path.join(project.home, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  const found = cli(project, ['doctor'], { cwd: elsewhere });
  assert.match(found.stdout, /The vault key is missing, so none of the 2/u);
  const fixed = cli(project, ['doctor', '--fix'], { cwd: elsewhere });
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /vault key was missing.*reset 2 project vault/u);
  assert.doesNotMatch(fixed.stdout, /Nothing to fix/u);
  assert.equal(new Vault(project.dir, { env }).size, 0);
  assert.equal(new Vault(second, { env }).size, 0);
  assert.equal(readFileSync(path.join(project.home, 'vault.key')).length, 32);
  assert.deepEqual(
    readdirSync(path.join(project.home, 'vault')).filter((name) =>
      name.includes('.unreadable-'),
    ),
    [],
  );
  assert.match(
    cli(project, ['doctor'], { cwd: elsewhere }).stdout,
    /Nothing to fix\./u,
  );
});

test('doctor --fix --keep-backups keeps private copies; vault clear removes them', () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  const { vault } = saveOne(project);
  writeFileSync(vault.file, 'not json');
  const fixed = cli(project, ['doctor', '--fix', '--keep-backups']);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.match(fixed.stdout, /kept at .*unreadable-.*delete them/u);
  const backups = readdirSync(path.dirname(vault.file)).filter((name) =>
    name.includes('.unreadable-'),
  );
  assert.equal(backups.length, 1);
  if (process.platform !== 'win32') {
    assert.equal(
      statSync(path.join(path.dirname(vault.file), backups[0])).mode & 0o777,
      0o600,
    );
  }
  const cleared = cli(project, ['vault', 'clear', '--yes']);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.deepEqual(
    readdirSync(path.dirname(vault.file)).filter((name) =>
      name.includes('.unreadable-'),
    ),
    [],
  );
  assert.equal(new Vault(project.dir, { env }).size, 0);
});

test(
  'a vault that cannot be read for an I/O reason is not reset (F-7)',
  { skip: isRoot || process.platform === 'win32' ? 'needs file modes' : false },
  () => {
    const project = tempProject({ env: false });
    const env = envFor(project);
    const { vault } = saveOne(project);
    const before = readFileSync(vault.file);
    chmodSync(vault.file, 0o000);
    try {
      assert.throws(
        () => new Vault(project.dir, { env }),
        (error) => error.code === 'ZEROH_VAULT_IO',
      );
      const fixed = cli(project, ['doctor', '--fix']);
      assert.equal(fixed.status, 0, fixed.stderr);
      assert.match(
        fixed.stdout,
        /could not be read \(EACCES\).*leaves it alone/u,
      );
    } finally {
      chmodSync(vault.file, 0o600);
    }
    assert.deepEqual(readFileSync(vault.file), before);
    assert.equal(new Vault(project.dir, { env }).size, 1);
  },
);

test('an unreadable vault is told to the user, once, and the proxy names the fix (LV-B2)', async (t) => {
  const project = tempProject({ env: false });
  const { vault } = saveOne(project);
  writeFileSync(vault.file, 'not json');

  const start = runHook(
    'session-start',
    { session_id: 'told', source: 'startup' },
    { project },
  );
  assert.equal(start.code, 0, start.stderr);
  const message = start.json.systemMessage;
  assert.match(message, /can't open its vault for this project/u);
  assert.match(message, /doctor --fix/u);
  assert.doesNotMatch(message, /✓ Protected/u);
  assert.match(message, /⚠ Paused/u);

  const first = runHook(
    'user-prompt-submit',
    { session_id: 'told', prompt: 'please list the files' },
    { project },
  );
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.json?.systemMessage ?? '', /doctor --fix/u);
  const second = runHook(
    'user-prompt-submit',
    { session_id: 'told', prompt: 'and now the tests' },
    { project },
  );
  assert.equal(second.code, 0, second.stderr);
  assert.doesNotMatch(second.json?.systemMessage ?? '', /vault/u);

  // The proxy refuses at once, without a retry, and says what to do.
  const upstream = await fakeUpstream();
  t.after(() => upstream.close());
  const previous = process.env.ZEROH_HOME;
  process.env.ZEROH_HOME = project.home;
  t.after(() => {
    process.env.ZEROH_HOME = previous;
  });
  const server = createMaskingProxy({
    resolveUpstream: () => upstream.url,
    route: () => ({ action: 'mask', root: project.dir }),
    onInactive: () => {},
  });
  const port = await listen(server);
  t.after(() => server.close());
  const answer = await postJson(
    `http://127.0.0.1:${port}/v1/messages`,
    JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
  );
  assert.equal(answer.status, 400);
  assert.equal(answer.headers['x-should-retry'], 'false');
  assert.match(answer.text, /can't open this project's vault/u);
  assert.match(answer.text, /doctor --fix/u);
  assert.equal(upstream.seen.length, 0, 'nothing was sent');
});

test('vault clear from a subdirectory clears the project, its restore files and commitment keys (LV-B6)', () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  const start = runHook(
    'session-start',
    { session_id: 'clear-1', source: 'startup' },
    { project },
  );
  assert.equal(start.code, 0, start.stderr);
  saveOne(project);
  // A late-bound values file of a command that never ran.
  const runFile = path.join(project.home, 'run', 'clear-1', 'toolu_1.sh');
  mkdirSync(path.dirname(runFile), { recursive: true });
  writeFileSync(runFile, "export ZH_V='sk_live_ZEROHFAKE0000000000000000'\n");
  const keyFile = commitmentKeyPath(project.dir, 'clear-1', env);
  assert.ok(existsSync(keyFile), 'the session has a commitment key');

  const sub = path.join(project.dir, 'src', 'deep');
  mkdirSync(sub, { recursive: true });
  const cleared = cli(project, ['vault', 'clear', '--yes'], { cwd: sub });
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.match(cleared.stdout, /Cleared the vault for .*: 1 stored value/u);
  assert.match(cleared.stdout, /1 pending restore file\(s\)/u);
  assert.equal(new Vault(project.dir, { env }).size, 0);
  assert.equal(existsSync(runFile), false);
  assert.equal(existsSync(keyFile), false);

  // Nothing stored: it says so instead of "cleared".
  const empty = tempProject({ env: false });
  const none = cli(empty, ['vault', 'clear', '--yes']);
  assert.match(none.stdout, /No vault for .*nothing stored to clear/u);
});

test('receipts alone cannot recover a typed phone number (LV-B4)', async () => {
  const project = tempProject({ env: false });
  const env = envFor(project);
  const blocked = runHook(
    'user-prompt-submit',
    {
      session_id: 'brute',
      prompt: `please call the customer on ${FAKE_PHONE} today`,
    },
    { project },
  );
  assert.equal(blocked.code, 2, 'the prompt was stopped (proxy off)');
  const sessionDir = path.join(stateDirOf(project), 'sessions', 'brute');
  const turn = JSON.parse(
    readFileSync(path.join(sessionDir, 'turn-1.json'), 'utf8'),
  );
  const replacement = turn.replacements.find(
    (entry) => entry.entity_type === 'PHONE_NUMBER',
  );
  assert.ok(replacement?.value_commitment, 'the receipt commits to the value');
  const commit = (key) =>
    createHmac('sha256', key)
      .update(JSON.stringify({ type: 'PHONE_NUMBER', value: FAKE_PHONE }))
      .digest('base64url');

  // No key-shaped value anywhere next to the receipts opens the commitment.
  const candidates = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/[A-Za-z0-9_-]{43}/gu)) {
          candidates.add(match[0]);
        }
      }
    }
  };
  walk(stateDirOf(project));
  const state = JSON.parse(
    readFileSync(path.join(sessionDir, 'state.json'), 'utf8'),
  );
  assert.equal(state.hmacKeyB64u, undefined, 'no key next to the receipts');
  for (const candidate of candidates) {
    assert.notEqual(
      commit(Buffer.from(candidate, 'base64url')),
      replacement.value_commitment,
    );
  }
  // The key lives under ZEROH_HOME (the test is meaningful: it opens it).
  const keyFile = commitmentKeyPath(project.dir, 'brute', env);
  assert.equal(commit(readFileSync(keyFile)), replacement.value_commitment);
  // vault clear shreds it: the commitment becomes noise.
  const cleared = cli(project, ['vault', 'clear', '--yes']);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(existsSync(keyFile), false);
});

test(
  'a read-only project keeps its session state under ZEROH_HOME; with nothing writable clean prompts pass (LV-B3)',
  {
    skip: isRoot || process.platform === 'win32' ? 'needs POSIX modes' : false,
  },
  (t) => {
    const project = tempProject();
    chmodSync(project.dir, 0o555);
    t.after(() => chmodSync(project.dir, 0o755));
    const clean = runHook(
      'user-prompt-submit',
      { session_id: 'ro-1', prompt: 'please list the files' },
      { project },
    );
    assert.equal(clean.code, 0, clean.stderr);
    const tool = runHook(
      'pre-tool-use',
      {
        session_id: 'ro-1',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        tool_use_id: 'toolu_ro',
      },
      { project },
    );
    assert.equal(tool.code, 0, tool.stderr);
    assert.notEqual(
      tool.json?.hookSpecificOutput?.permissionDecision,
      'deny',
      'ls is not denied',
    );
    assert.equal(existsSync(path.join(project.dir, '.zeroh')), false);
    const moved = path.join(
      stateDirOf(project),
      'sessions',
      'ro-1',
      'turn-1.json',
    );
    assert.ok(existsSync(moved), 'the ledger is kept under ZEROH_HOME');

    // Nothing writable: a clean prompt still passes, a secret is stopped.
    spawnSync('chmod', ['-R', 'a-w', project.home]);
    t.after(() => spawnSync('chmod', ['-R', 'u+w', project.home]));
    const start = runHook(
      'session-start',
      { session_id: 'ro-2', source: 'startup' },
      { project },
    );
    assert.equal(start.code, 0, start.stderr);
    assert.match(
      start.json.systemMessage,
      /read-only, so no receipts are kept/u,
    );
    const cleanAgain = runHook(
      'user-prompt-submit',
      { session_id: 'ro-2', prompt: 'please run the tests' },
      { project },
    );
    assert.equal(cleanAgain.code, 0, cleanAgain.stderr);
    const secret = runHook(
      'user-prompt-submit',
      {
        session_id: 'ro-2',
        prompt: 'deploy with sk_live_ZEROHFAKE1111111111111111 now',
      },
      { project },
    );
    assert.equal(secret.code, 2);
    assert.doesNotMatch(secret.stderr, /could not check it/u);
  },
);

test('Windows keeps ZeroH in %LOCALAPPDATA% with a user-only ACL (LV-F5)', () => {
  assert.equal(
    zerohHome(
      { LOCALAPPDATA: 'C:\\Users\\Jürgen\\AppData\\Local' },
      () => 'C:\\Users\\Jürgen',
      'win32',
    ),
    'C:\\Users\\Jürgen\\AppData\\Local\\ZeroH',
  );
  assert.equal(
    zerohHome({}, () => 'C:\\Users\\Sami', 'win32'),
    'C:\\Users\\Sami\\AppData\\Local\\ZeroH',
  );
  assert.equal(
    zerohHome({}, () => '/Users/p', 'darwin'),
    '/Users/p/.zeroh',
  );
  assert.equal(
    zerohHome({ ZEROH_HOME: 'D:\\zh' }, () => 'x', 'win32'),
    'D:\\zh',
  );

  const calls = [];
  const execute = (file, args) => {
    calls.push([file, ...args]);
    return file === 'C:\\Windows\\System32\\whoami.exe'
      ? '"AzureAD\\\\Sami","S-1-12-1-111-222-333-444"\r\n'
      : '';
  };
  assert.equal(
    protectWindowsPath('D:\\zh', { platform: 'win32', execute, env: {} }),
    true,
  );
  assert.deepEqual(calls[1], [
    'C:\\Windows\\System32\\icacls.exe',
    'D:\\zh',
    '/inheritance:r',
    '/grant:r',
    '*S-1-12-1-111-222-333-444:(OI)(CI)F',
    '/grant:r',
    '*S-1-5-18:(OI)(CI)F',
  ]);
  assert.equal(
    protectWindowsPath('/tmp/x', { platform: 'linux', execute, env: {} }),
    false,
  );
  assert.equal(PLUGIN.length > 0, true);
});

test('on Windows the first private write into the home protects all of it, once (F-6)', () => {
  const project = tempProject({ env: false });
  const env = { ZEROH_HOME: path.join(project.home, 'win-home') };
  const calls = [];
  const execute = (file, args) => {
    calls.push([file, ...args]);
    return file.endsWith('whoami.exe') ? '"PC\\\\sami","S-1-5-21-7"\r\n' : '';
  };
  const windows = { env, platform: 'win32', execute };
  // SessionStart writes the proxy folder first, not the vault: the home is
  // protected all the same, before anything is written into it.
  ensurePrivateDir(path.join(env.ZEROH_HOME, 'proxy', 'routes'), windows);
  assert.deepEqual(
    calls.map(([file]) => path.win32.basename(file)),
    ['whoami.exe', 'icacls.exe'],
  );
  assert.equal(calls[1][1], path.resolve(env.ZEROH_HOME));
  assert.ok(existsSync(path.join(env.ZEROH_HOME, '.acl-protected')));
  ensurePrivateDir(path.join(env.ZEROH_HOME, 'vault'), windows);
  assert.equal(calls.length, 2, 'once');
  // A folder outside the home is left to its own ACL.
  ensurePrivateDir(path.join(project.dir, '.zeroh'), windows);
  assert.equal(calls.length, 2);
});
