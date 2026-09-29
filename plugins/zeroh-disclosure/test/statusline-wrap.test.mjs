// SPDX-License-Identifier: AGPL-3.0-only

// 1.0.1: `statusline on`, typed by a user who already has a status line of
// their own, adds ZeroH's part after it in one step. The statusLine command
// becomes ZeroH's resolver in `wrap` mode, carrying the user's command as
// one base64url word; `off` and uninstall put the user's entry back
// exactly. Isolated temporary homes for every test (see helpers.mjs).
import { tempProject } from './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  currentEntry,
  isOurStatusLine,
  isOutdated,
  migrateEntry,
  readRecord,
  removeEverywhere,
  STATUSLINE_COMMAND,
  turnStatuslineOff,
  turnStatuslineOn,
  wrapCommand,
  wrappedCommand,
} from '../lib/statusline-settings.js';
import { applyFirstRunDefaults } from '../lib/first-run.js';
import * as marker from '../lib/uninstall-marker.js';
import { asUser } from './as-user.mjs';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

function settingsFixture(initial) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-'));
  const settingsPath = path.join(base, 'claude', 'settings.json');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(initial, null, 2)}\n`);
  const home = path.join(base, 'zeroh');
  mkdirSync(home, { recursive: true });
  return { base, settingsPath, home };
}

// A user home where Claude Code lists this checkout as the installed
// plugin, so the resolver runs it.
function installedHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-home-'));
  const config = path.join(home, '.claude');
  mkdirSync(path.join(config, 'plugins'), { recursive: true });
  writeFileSync(
    path.join(config, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'zeroh-disclosure@zeroh': [{ scope: 'user', installPath: PLUGIN }],
      },
    }),
  );
  return {
    home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      ZEROH_HOME: path.join(home, '.zeroh'),
      NO_COLOR: '1',
    },
  };
}

// 1.0.1 writes a wrap entry only on macOS and Linux (on Windows `on` leaves
// the user's line alone, see the Windows test below). The logic that writes
// and removes it takes the platform, so those tests inject a non-Windows one
// and run on every OS; the tests that run the wrapped line itself need a
// POSIX shell for the user's command (the resolver runs it with Node's
// default shell, cmd on Windows), so they are skipped there.
const UNIX = 'linux';
const NO_WRAP_ON_WINDOWS =
  process.platform === 'win32'
    ? {
        skip: "1.0.1 does not wrap on Windows; the user's command would run in cmd",
      }
    : {};

// The command as Claude Code runs it on macOS and Linux.
function runCommand(command, env, input = '{"session_id":"s1"}') {
  return spawnSync('bash', ['-c', command], {
    input,
    env,
    encoding: 'utf8',
  });
}

const ORIGINALS = [
  'bash ~/.claude/statusline.sh',
  `printf '%s' "it's \\"quoted\\""`,
  'echo "$HOME has spaces  and \\$dollars" | tr a A',
  "node -e \"process.stdout.write('x`y`'+String.fromCharCode(37)+'PATH'+String.fromCharCode(37))\"",
  'cat | head -c 0; echo "stdin ok"',
];

test('the wrapper carries any command in one word no shell reads', () => {
  for (const original of ORIGINALS) {
    const command = wrapCommand(original);
    assert.ok(command.startsWith(`${STATUSLINE_COMMAND} wrap `));
    assert.match(command.slice(STATUSLINE_COMMAND.length), /^ wrap [\w-]+$/u);
    assert.equal(wrappedCommand({ command }), original);
    assert.ok(isOurStatusLine({ type: 'command', command }), original);
    assert.ok(!isOutdated({ type: 'command', command }), original);
  }
  // Not a wrap: another word, a bad encoding, or text around it.
  for (const command of [
    `${STATUSLINE_COMMAND} wrap`,
    `${STATUSLINE_COMMAND} wrap a+b`,
    `${STATUSLINE_COMMAND} wrap YQ; rm -rf x`,
    `${wrapCommand('x')} extra`,
    `node -e "console.log(1)" wrap YQ`,
  ])
    assert.equal(isOurStatusLine({ command }), false, command);
});

test(
  "the wrapped line is the user's output, then ZeroH's part; theirs failing or empty shows ZeroH alone",
  NO_WRAP_ON_WINDOWS,
  () => {
    const r = installedHome();
    mkdirSync(path.join(r.home, '.claude'), { recursive: true });
    const script = path.join(r.home, '.claude', 'statusline.sh');
    writeFileSync(
      script,
      '#!/bin/bash\ninput=$(cat)\nprintf "my line %s" "${input:0:13}"\n',
    );
    chmodSync(script, 0o755);
    const full = runCommand(wrapCommand('bash ~/.claude/statusline.sh'), r.env);
    assert.equal(full.status, 0, full.stderr);
    assert.match(
      full.stdout,
      /^my line \{"session_id"\n🛡️ ZeroH · 🟡 [^\n]+\n$/u,
      'same JSON on stdin, then ZeroH',
    );
    for (const original of ORIGINALS.slice(1)) {
      const run = runCommand(wrapCommand(original), r.env);
      const alone = runCommand(original, r.env).stdout.trimEnd();
      assert.equal(run.status, 0, run.stderr);
      assert.ok(
        run.stdout.startsWith(`${alone}\n🛡️ ZeroH · `),
        `${original}: ${run.stdout}`,
      );
    }
    for (const broken of ['exit 3', 'true', 'nonexistent-program-zeroh']) {
      const run = runCommand(wrapCommand(broken), r.env);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /^🛡️ ZeroH · 🟡 /u, broken);
    }
  },
);

test("with the plugin gone the user's line still shows, then why ZeroH's part is missing", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-gone-'));
  // Without the plugin the resolver runs it with Node's default shell (cmd
  // on Windows), so a command both read alike.
  const run = runCommand(wrapCommand('echo mine'), {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    run.stdout,
    'mine\n🛡️ ZeroH · 🔴 not installed · remove it with /statusline',
  );
});

test('the wrapper is the same text for PowerShell', NO_WRAP_ON_WINDOWS, (t) => {
  const r = installedHome();
  const run = spawnSync(
    'pwsh',
    ['-NoProfile', '-Command', wrapCommand('echo "ps $((2+3))"')],
    { input: '{}', env: r.env, encoding: 'utf8' },
  );
  if (run.error?.code === 'ENOENT') {
    t.skip('pwsh is not installed');
    return;
  }
  assert.equal(run.status, 0, run.stderr);
  // PowerShell hands the resolver the same word; the user's command runs in
  // Claude Code's shell for statusLine commands (sh here).
  assert.match(run.stdout, /^ps 5\n🛡️ ZeroH · /u);
});

test('on/off round trip restores the exact entry, keys and all; on twice is already', () => {
  const theirs = {
    type: 'command',
    command: `bash -c 'echo "$(whoami) · $PWD"'`,
    padding: 2,
    refreshInterval: 30,
  };
  const s = {
    ...settingsFixture({ model: 'haiku', statusLine: theirs }),
    platform: UNIX,
  };
  assert.equal(turnStatuslineOn(s).result, 'wrapped');
  const wrapped = read(s.settingsPath).statusLine;
  assert.equal(wrapped.padding, 2);
  assert.equal(wrapped.refreshInterval, 10);
  assert.equal(wrappedCommand(wrapped), theirs.command);
  assert.deepEqual(
    readRecord(s.home).wrapped[path.resolve(s.settingsPath)],
    theirs,
  );
  const again = turnStatuslineOn(s);
  assert.equal(again.result, 'already');
  assert.equal(again.wrapped, true);
  // The first prompt keeps it as it is.
  applyFirstRunDefaults({ ...s, pluginRoot: null });
  assert.deepEqual(read(s.settingsPath).statusLine, wrapped);
  assert.equal(turnStatuslineOff(s).result, 'unwrapped');
  assert.deepEqual(read(s.settingsPath), {
    model: 'haiku',
    statusLine: theirs,
  });
  assert.deepEqual(readRecord(s.home).wrapped, {});
  // Without ZeroH's record, the command comes back from the wrapper itself.
  turnStatuslineOn(s);
  writeFileSync(path.join(s.home, 'statusline.json'), '{}');
  turnStatuslineOff(s);
  assert.equal(read(s.settingsPath).statusLine.command, theirs.command);
});

test('an older resolver text around a wrap is updated and stays a wrap of the same command', () => {
  const original = 'bash ~/.claude/statusline.sh';
  const older = {
    type: 'command',
    command: `${STATUSLINE_COMMAND.replace('const l=[];', 'const l=[];;')} wrap ${Buffer.from(original).toString('base64url')}`,
    padding: 1,
  };
  assert.ok(isOurStatusLine(older));
  assert.ok(isOutdated(older));
  assert.equal(currentEntry(older).command, wrapCommand(original));
  const s = settingsFixture({ statusLine: older });
  assert.equal(migrateEntry(s.settingsPath), true);
  assert.deepEqual(read(s.settingsPath).statusLine, {
    ...older,
    command: wrapCommand(original),
  });
  const f = settingsFixture({ statusLine: older });
  applyFirstRunDefaults({ ...f, pluginRoot: null });
  assert.equal(read(f.settingsPath).statusLine.command, wrapCommand(original));
});

test('uninstall puts every wrapped status line back', () => {
  const theirs = { type: 'command', command: '~/.claude/my-line.sh' };
  const s = settingsFixture({ statusLine: theirs });
  assert.equal(turnStatuslineOn({ ...s, platform: UNIX }).result, 'wrapped');
  assert.deepEqual(removeEverywhere({ home: s.home }), [
    path.resolve(s.settingsPath),
  ]);
  assert.deepEqual(read(s.settingsPath).statusLine, theirs);

  // The CLI's uninstall, as the user.
  const project = tempProject();
  mkdirSync(path.dirname(project.settings), { recursive: true });
  writeFileSync(project.settings, JSON.stringify({ statusLine: theirs }));
  turnStatuslineOn({
    settingsPath: project.settings,
    home: project.home,
    platform: UNIX,
  });
  assert.notDeepEqual(read(project.settings).statusLine, theirs);
  const fakeClaude = path.join(
    os.tmpdir(),
    `fake-claude-wrap-${process.pid}.mjs`,
  );
  writeFileSync(
    fakeClaude,
    "#!/usr/bin/env node\nif (process.argv[3] === 'list') console.log('[]');\n",
    { mode: 0o755 },
  );
  const args = ['uninstall', '--yes'];
  const env = {
    PATH: process.env.PATH,
    HOME: mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-user-')),
    ZEROH_HOME: project.home,
    ZEROH_CREDENTIAL_HOME: project.home,
    ZEROH_CLAUDE_SETTINGS: project.settings,
    ZEROH_SERVICE_MANAGER_DIR: project.serviceManager,
    ZEROH_CLAUDE_BIN: fakeClaude,
  };
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: project.dir,
    env: asUser(args, env),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(project.settings), { statusLine: theirs });
  marker.clearUninstalled({ ZEROH_HOME: project.home });
});

// Astra 1.0.1 A2: the user's command gets a hard deadline. spawnSync's
// timeout only sent SIGTERM and waited, so a command ignoring SIGTERM (or a
// child keeping its output open) held ZeroH's part back for as long as it ran.
const STUCK = (pidFile) =>
  `node -e "require('fs').writeFileSync(process.argv[1],String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)" ${pidFile} & wait`;

function alive(pidFile) {
  let pid;
  try {
    pid = Number(readFileSync(pidFile, 'utf8'));
  } catch {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pidFile) {
  for (let i = 0; i < 40 && alive(pidFile); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 50));
  return !alive(pidFile);
}

test(
  'a stuck user command is stopped at the deadline, with what it started, and ZeroH still shows',
  { skip: process.platform === 'win32' },
  async () => {
    const { runWrapped, WRAP_DEADLINE_MS } =
      await import('../lib/statusline.js');
    assert.ok(WRAP_DEADLINE_MS <= 2000);
    const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-stuck-'));
    let pidFile = path.join(base, 'direct.pid');
    let start = Date.now();
    assert.equal(
      await runWrapped(STUCK(pidFile), '{}', { env: process.env }),
      '',
    );
    assert.ok(
      Date.now() - start < WRAP_DEADLINE_MS + 1500,
      `${Date.now() - start} ms`,
    );
    assert.ok(await gone(pidFile), 'the SIGTERM-ignoring child was killed');

    // Through the installed resolver, as Claude Code runs it.
    const r = installedHome();
    pidFile = path.join(base, 'installed.pid');
    start = Date.now();
    const run = spawnSync('bash', ['-c', wrapCommand(STUCK(pidFile))], {
      input: '{"session_id":"s1"}',
      env: r.env,
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(Date.now() - start < 6000, `${Date.now() - start} ms`);
    assert.match(run.stdout, /^🛡️ ZeroH · /u);
    assert.ok(await gone(pidFile), 'installed: child killed');

    // The plugin-gone fallback in the resolver.
    const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-stuck-gone-'));
    pidFile = path.join(base, 'gone.pid');
    start = Date.now();
    const fallback = spawnSync('bash', ['-c', wrapCommand(STUCK(pidFile))], {
      input: '{}',
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(fallback.status, 0, fallback.stderr);
    assert.ok(Date.now() - start < 6000, `${Date.now() - start} ms`);
    assert.equal(
      fallback.stdout,
      '🛡️ ZeroH · 🔴 not installed · remove it with /statusline',
    );
    assert.ok(await gone(pidFile), 'fallback: child killed');
  },
);

test('a user command that finishes in time still shows, with stdin', async () => {
  const { runWrapped } = await import('../lib/statusline.js');
  assert.equal(
    await runWrapped('cat; echo " ok"', '{"a":1}', { env: process.env }),
    '{"a":1} ok',
  );
  assert.equal(await runWrapped('exit 3', '{}', { env: process.env }), '');
});

// 1.0.1 does not wrap on Windows (owner ruling pending; 1.1): the user's
// line is left as it is and the reply points to docs/statusline.md.
test('on Windows statusline on leaves the user line untouched', () => {
  const theirs = { type: 'command', command: 'bash ~/statusline.sh' };
  const s = settingsFixture({ statusLine: theirs });
  const before = readFileSync(s.settingsPath, 'utf8');
  const result = turnStatuslineOn({ ...s, platform: 'win32' });
  assert.equal(result.result, 'windows');
  assert.equal(readFileSync(s.settingsPath, 'utf8'), before);
  assert.equal(
    readRecord(s.home).wrapped?.[path.resolve(s.settingsPath)],
    undefined,
  );
  const cli = readFileSync(CLI, 'utf8');
  assert.match(
    cli,
    /On Windows ZeroH doesn't add its part to your own status line yet/u,
  );
});

// Owner, 1.0.1: Claude Code cuts a long status row short with "…", so a
// part appended to the user's line could not be seen. ZeroH's part goes on
// its own line by default (Claude Code shows each printed line as a row);
// `position: "end"` appends it to the user's last line.
test("ZeroH's part goes on its own line after the user's last line; position end appends it", async () => {
  const { joinWrapped, normaliseStyle, renderStatusline } =
    await import('../lib/statusline.js');
  const ours = '🛡️ ZeroH · 🟢 protected · 4 masked';
  const long = `~/src/app main · ${'x'.repeat(300)}`;
  assert.equal(joinWrapped(long, ours), `${long}\n${ours}`);
  assert.equal(joinWrapped('one\ntwo', ours), `one\ntwo\n${ours}`);
  assert.equal(joinWrapped('one\ntwo', ours, 'end'), `one\ntwo · ${ours}`);
  assert.equal(joinWrapped('', ours), ours);
  assert.equal(normaliseStyle({ version: 1 }).position, 'line');
  assert.equal(normaliseStyle({ version: 1, position: 'end' }).position, 'end');
  // onlyWhenNotProtected: no ZeroH line at all while 🟢.
  const green = {
    level: 'protected',
    word: 'protected',
    fix: null,
    counts: true,
    masked: 4,
    sent: 0,
    notProtected: 0,
    grants: [],
    receipt: null,
  };
  const quiet = renderStatusline(green, {
    env: { NO_COLOR: '1' },
    style: normaliseStyle({ version: 1, onlyWhenNotProtected: true }),
  });
  assert.equal(quiet, '');
  assert.equal(joinWrapped('my line', quiet), 'my line');
});

test(
  "through the installed resolver ZeroH's part follows the user's last line, or joins it with position end",
  NO_WRAP_ON_WINDOWS,
  () => {
    const long = `~/src/app main · ${'x'.repeat(300)}`;
    const r = installedHome();
    const multi = runCommand(wrapCommand(`printf 'first\\nsecond\\n'`), r.env);
    assert.equal(multi.status, 0, multi.stderr);
    const lines = multi.stdout.trimEnd().split('\n');
    assert.deepEqual(lines.slice(0, 2), ['first', 'second']);
    assert.match(lines[2], /^🛡️ ZeroH · /u);
    assert.equal(lines.length, 3);
    const longRun = runCommand(wrapCommand(`printf '%s' '${long}'`), r.env);
    assert.ok(
      longRun.stdout.startsWith(`${long}\n🛡️ ZeroH · `),
      longRun.stdout,
    );
    mkdirSync(r.env.ZEROH_HOME, { recursive: true });
    writeFileSync(
      path.join(r.env.ZEROH_HOME, 'statusline-style.json'),
      JSON.stringify({ version: 1, position: 'end' }),
    );
    const end = runCommand(wrapCommand(`printf 'first\\nsecond\\n'`), r.env);
    assert.match(end.stdout, /^first\nsecond · 🛡️ ZeroH · [^\n]+\n$/u);

    // The plugin-gone fallback follows the same position.
    const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-wrap-pos-'));
    const goneEnv = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      ZEROH_HOME: path.join(home, 'z'),
    };
    assert.equal(
      runCommand(wrapCommand('echo mine'), goneEnv).stdout,
      'mine\n🛡️ ZeroH · 🔴 not installed · remove it with /statusline',
    );
    mkdirSync(goneEnv.ZEROH_HOME, { recursive: true });
    writeFileSync(
      path.join(goneEnv.ZEROH_HOME, 'statusline-style.json'),
      JSON.stringify({ version: 1, position: 'end' }),
    );
    assert.equal(
      runCommand(wrapCommand('echo mine'), goneEnv).stdout,
      'mine · 🛡️ ZeroH · 🔴 not installed · remove it with /statusline',
    );
  },
);
