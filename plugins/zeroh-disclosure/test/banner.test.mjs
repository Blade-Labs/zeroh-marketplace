// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ART_LINES,
  bannerFiles,
  buildBanner,
  colourAllowed,
  getPlan,
  normalizeBannerMode,
  protectionState,
  readBannerMode,
  renderBanner,
  warningLines,
  writeBannerMode,
} from '../lib/banner.js';
import { asUser } from './as-user.mjs';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(PLUGIN, 'bin', 'zeroh-disclosure.mjs');
const FAKE_SECRET = 'sk_live_ZEROHFAKEbanner-unit-000000';
const KNOWN = [
  { name: 'ONE', value: FAKE_SECRET, type: 'API_KEY', source: '.env' },
  { name: 'TWO', value: 'ZEROHFAKE-two', type: 'SECRET', source: '.env' },
  { name: 'THREE', value: 'ZEROHFAKE-three', type: 'SECRET', source: '.env' },
];

function tempHome() {
  return mkdtempSync(path.join(os.tmpdir(), 'zeroh-banner-home-'));
}

test('the exact five art lines have equal display width', () => {
  assert.deepEqual(ART_LINES, [
    '███████ ███████ ██████   ██████  ██   ██',
    '   ███  ██      ██   ██ ██    ██ ██   ██',
    '  ███   █████   ██████  ██ ▗▖ ██ ███████',
    ' ███    ██      ██   ██ ██ ▟▙ ██ ██   ██',
    '███████ ███████ ██   ██  ██████  ██   ██',
  ]);
  assert.equal(new Set(ART_LINES.map((line) => [...line].length)).size, 1);
});

test('full, big, mini, compact, and off modes render their promised content', () => {
  const status = {
    known: KNOWN,
    proxy: 'on',
    version: 'ZEROHFAKE-version',
  };
  const full = buildBanner({ ...status, mode: 'full' }).text;
  assert.match(full, /^\n███████/u);
  assert.match(full, /██ {3}ZeroH Disclosure \S+ · Free/u);
  assert.match(full, /Protected: your secrets are masked/u);
  const sized = buildBanner({ ...status, version: '1.0.0', mode: 'full' });
  assert.match(sized.text, /ZeroH Disclosure 1\.0\.0 · Free/u);
  for (const line of sized.text.split('\n').filter((l) => l.includes('█'))) {
    assert.ok(line.length <= 80, `banner line wider than 80 columns: ${line}`);
  }
  // T-34: what is protected now and what needs attention, in plain words,
  // ending with the one question to ask Claude; no settings or paths.
  // Three lines under the art (owner, 2026-09-28): where it runs and what
  // it masks, what passes, and the question; no proxy line.
  assert.equal(
    full.split('\n\n')[1],
    [
      'Runs on your machine: masks what you type, files Claude reads, command output and tool results.',
      'Images and scanned PDFs are not masked; they pass with a notice.',
      "Ask Claude: 'what does ZeroH Disclosure protect?'",
    ].join('\n'),
  );
  assert.doesNotMatch(full, /Local proxy:/u);
  assert.ok(
    full.endsWith("\nAsk Claude: 'what does ZeroH Disclosure protect?'"),
  );
  assert.doesNotMatch(full, /ZEROH_BANNER|Receipts:|text, prompts/u);
  const granted = buildBanner({
    ...status,
    mode: 'full',
    proxy: 'off',
    unmaskStatus: 'EMAIL unmasked · 12 min left',
    warnings: warningLines({ proxy: 'off' }),
  }).text;
  // rc.2 default (pass): a typed secret without the proxy is sent with a
  // notice; `uncertain block` stops it.
  assert.match(
    granted,
    /Runs on your machine: masks files Claude reads.*What you type is not masked: a prompt with a secret is sent, with a notice\./u,
  );
  assert.match(
    buildBanner({ ...status, mode: 'full', proxy: 'off', uncertain: 'block' })
      .text,
    /Runs on your machine: masks files Claude reads.*stopped, not sent\./u,
  );
  assert.match(granted, /Unmasked now: EMAIL unmasked · 12 min left\./u);
  assert.match(granted, /⚠ proxy off[^\n]*\nAsk Claude: /u);
  // Without the proxy line, every proxy problem still has its warning.
  for (const proxy of ['off', 'turned-off', 'overridden', 'provider', 'down']) {
    const view = buildBanner({
      ...status,
      mode: 'full',
      proxy,
      warnings: warningLines({ proxy }),
    }).text;
    assert.match(view, /\n⚠ [^\n]+\nAsk Claude: /u, proxy);
    assert.doesNotMatch(view, /Local proxy:/u, proxy);
  }

  const big = buildBanner({ ...status, mode: 'big' }).text;
  assert.match(big, /^\n███████/u);
  assert.doesNotMatch(big, /Images and scanned PDFs|Ask Claude/u);

  const mini = buildBanner({ ...status, mode: 'mini' }).text;
  assert.equal(
    mini,
    'ZeroH Disclosure ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status',
  );

  const compact = buildBanner({ ...status, mode: 'compact' }).text;
  assert.equal(
    compact,
    '🛡 ZeroH Disclosure · Free · 3 secrets protected · typing masked',
  );

  const off = buildBanner({
    ...status,
    mode: 'off',
    warnings: ['⚠ ZEROHFAKE warning'],
  }).text;
  assert.equal(off, '⚠ ZEROHFAKE warning');
});

test('the default full view is recorded once in ZEROH_HOME', () => {
  const home = tempHome();
  const options = {
    home,
    env: { TERM: 'dumb' },
    known: KNOWN,
    proxy: 'on',
  };
  const first = renderBanner(options);
  const second = renderBanner(options);
  assert.match(first, /Images and scanned PDFs are not masked/u);
  assert.doesNotMatch(second, /Images and scanned PDFs are not masked/u);
  assert.equal(readFileSync(bannerFiles(home).shown, 'utf8'), '');
});

test('warning lines cover context, unmask, and every proxy state with one line at most', () => {
  assert.deepEqual(
    warningLines({
      contextFindings: [{ displayPath: 'CLAUDE.md', count: 2 }],
      proxy: 'off',
      unmaskWarnings: ['EMAIL unmasked for 37 more minutes'],
    }),
    [
      '⚠ CLAUDE.md has 2 secrets: they reach the model: the proxy is off',
      '⚠ EMAIL unmasked for 37 more minutes',
      `⚠ proxy off: what you type isn't masked; a typed secret is sent with a "not protected" line`,
    ],
  );
  assert.deepEqual(warningLines({ proxy: 'off', uncertain: 'block' }), [
    "⚠ proxy off: what you type isn't masked; typed secrets are stopped, not sent",
  ]);
  assert.deepEqual(
    warningLines({
      contextFindings: [{ displayPath: 'CLAUDE.md', count: 1 }],
      proxy: 'on',
    }),
    ['⚠ CLAUDE.md has 1 secret: the proxy masks them'],
  );
  // T-16/T-19: the session that installs the proxy goes through it from its
  // first prompt, so it says nothing about restarting. (A secret typed in
  // that very first prompt is sent with a notice, or stopped in block mode:
  // the proxy has not seen the session yet.)
  assert.deepEqual(warningLines({ proxy: 'ready' }), []);
  assert.match(
    buildBanner({ mode: 'big', proxy: 'ready' }).text,
    /✓ Protected: your secrets are masked/u,
  );
  for (const proxy of ['provider', 'down', 'overridden', 'off']) {
    const lines = warningLines({ proxy });
    assert.equal(lines.length, 1, proxy);
    assert.match(lines[0], /^⚠ .*typed secret/u, proxy);
    assert.match(
      buildBanner({ mode: 'big', proxy }).text,
      /✓ Protected: files and output are masked/u,
      proxy,
    );
  }
});

test('plan text is Free and no known secret value enters any banner mode', () => {
  assert.equal(getPlan(), 'Free');
  for (const mode of ['full', 'big', 'mini', 'compact', 'off', 'default']) {
    const output = buildBanner({
      mode,
      known: KNOWN,
      proxy: 'on',
      warnings: ['⚠ safe warning'],
    }).text;
    assert.ok(!output.includes(FAKE_SECRET), mode);
  }
});

test('stored banner settings work and ZEROH_BANNER wins', () => {
  const home = tempHome();
  writeBannerMode('compact', { home, env: {} });
  assert.equal(readBannerMode({ home, env: {} }), 'compact');
  assert.equal(readBannerMode({ home, env: { ZEROH_BANNER: 'off' } }), 'off');
});

test('the CLI writes every supported mode under ZEROH_HOME', () => {
  const home = tempHome();
  const settings = path.join(home, 'claude', 'settings.json');
  const serviceManager = path.join(home, 'service-manager');
  for (const [mode, saved] of [
    ['big', 'big'],
    ['compact', 'compact'],
    ['mini', 'mini'],
    ['off', 'off'],
    // `full` from before 1.0.0 is saved as `big`.
    ['full', 'big'],
  ]) {
    const result = spawnSync(process.execPath, [CLI, 'banner', mode], {
      encoding: 'utf8',
      env: asUser(['banner', mode], {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        ZEROH_HOME: home,
        ZEROH_CREDENTIAL_HOME: path.join(home, 'credentials'),
        ZEROH_CLAUDE_SETTINGS: settings,
        ZEROH_SERVICE_MANAGER_DIR: serviceManager,
      }),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      JSON.parse(readFileSync(bannerFiles(home).config)).mode,
      saved,
    );
  }
});

test('the status command uses pre-model command expansion', () => {
  const command = readFileSync(
    path.join(PLUGIN, 'commands', 'status.md'),
    'utf8',
  );
  assert.match(
    command,
    /^allowed-tools: Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/commands\/scripts\/status\.js"\), PowerShell\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/commands\/scripts\/status\.js"\)$/mu,
  );
  assert.match(
    command,
    /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/commands\/scripts\/status\.js"`$/mu,
  );
  assert.match(command, /Do not call any tool/u);
});

// T-24, T-28: every command's `!` output is shown as plain text, so none of
// it may carry ANSI escape codes, even in a terminal that supports colour.
// Only the SessionStart banner (systemMessage), which Claude Code renders in
// colour, is green; the model's context never carries escape codes.
test('no command output contains an ANSI escape code; only the SessionStart banner is coloured', () => {
  const home = tempHome();
  const project = mkdtempSync(path.join(os.tmpdir(), 'zeroh-banner-project-'));
  writeFileSync(path.join(project, '.env'), `ONE=${FAKE_SECRET}\n`);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    ZEROH_HOME: home,
    ZEROH_CREDENTIAL_HOME: path.join(home, 'credentials'),
    ZEROH_CLAUDE_SETTINGS: path.join(home, 'claude', 'settings.json'),
    ZEROH_SERVICE_MANAGER_DIR: path.join(home, 'service-manager'),
    ZEROH_PROXY: 'off',
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_CODE_SESSION_ID: 'ZEROHFAKE-ansi',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'iTerm.app',
  };
  // Exactly the `!` lines of the slash commands.
  const commands = readdirSync(path.join(PLUGIN, 'commands'))
    .filter((name) => name.endsWith('.md'))
    .flatMap((name) =>
      [
        ...readFileSync(path.join(PLUGIN, 'commands', name), 'utf8').matchAll(
          /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"(?: \$ARGUMENTS)?`$/gmu,
        ),
      ].map((match) => match[1]),
    );
  assert.ok(commands.length >= 6, commands.join(', '));
  for (const script of commands) {
    const result = spawnSync(process.execPath, [path.join(PLUGIN, script)], {
      cwd: project,
      env,
      encoding: 'utf8',
    });
    assert.doesNotMatch(result.stdout + result.stderr, /\u001b/u, script);
  }
  const start = spawnSync(
    process.execPath,
    [path.join(PLUGIN, 'hooks', 'run.js'), 'session-start'],
    {
      input: JSON.stringify({ session_id: 'ZEROHFAKE-ansi', cwd: project }),
      env,
      encoding: 'utf8',
    },
  );
  assert.equal(start.status, 0, start.stderr);
  const output = JSON.parse(start.stdout);
  assert.match(output.systemMessage, /███/u);
  // Green art, the Blade triangle in the terminal's own colour.
  assert.match(output.systemMessage, /\u001b\[38;2;0;188;125m███/u);
  assert.match(output.systemMessage, /\u001b\[0m▗▖\u001b\[38;2;0;188;125m/u);
  assert.doesNotMatch(
    output.hookSpecificOutput?.additionalContext ?? '',
    /\u001b/u,
  );
  for (const plain of [{ NO_COLOR: '1' }, { TERM: 'dumb' }]) {
    const quiet = spawnSync(
      process.execPath,
      [path.join(PLUGIN, 'hooks', 'run.js'), 'session-start'],
      {
        input: JSON.stringify({ session_id: 'ZEROHFAKE-ansi', cwd: project }),
        env: { ...env, ...plain },
        encoding: 'utf8',
      },
    );
    assert.equal(quiet.status, 0, quiet.stderr);
    // A later session: the one mini line, plain.
    assert.doesNotMatch(quiet.stdout, /███/u);
    assert.match(
      JSON.parse(quiet.stdout).systemMessage,
      /^ZeroH Disclosure ✓ Protected: [^\n]* · Free · \/zeroh-disclosure:/u,
    );
    assert.doesNotMatch(quiet.stdout, /\u001b|\\u001b/u);
  }
});

test('the banner is plain unless colour is asked for', () => {
  for (const mode of ['big', 'mini']) {
    assert.doesNotMatch(buildBanner({ mode }).text, /\u001b/u, mode);
    const coloured = buildBanner({ mode, colour: true }).text;
    assert.match(coloured, /\u001b\[38;2;0;188;125m/u, mode);
  }
  assert.equal(
    buildBanner({ mode: 'mini', proxy: 'on', colour: true }).text,
    '\u001b[38;2;0;188;125mZeroH Disclosure\u001b[0m ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status',
  );
  assert.equal(colourAllowed({ TERM: 'xterm-256color' }), true);
  assert.equal(colourAllowed({ TERM: 'xterm', NO_COLOR: '' }), false);
  assert.equal(colourAllowed({ TERM: 'dumb' }), false);
  assert.equal(colourAllowed({}), false);
});

// Big once, then one line (owner, 2026-09-28): every later session shows
// the mini line, built from the art block's own state.
test('the mini line says each state and its fix in one line', () => {
  const cases = [
    [
      { proxy: 'on' },
      'ZeroH Disclosure ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status',
    ],
    [
      { proxy: 'ready' },
      'ZeroH Disclosure ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status',
    ],
    [
      { proxy: 'on', paused: true },
      'ZeroH Disclosure ⚠ Paused: see the message below · Free · /zeroh-disclosure:doctor',
    ],
    [
      { proxy: 'off' },
      'ZeroH Disclosure ✓ Protected: files and output are masked · Free · /zeroh-disclosure:doctor',
    ],
    [
      { proxy: 'turned-off' },
      'ZeroH Disclosure ✓ Protected: files and output are masked · Free · /zeroh-disclosure:proxy on',
    ],
    [
      { proxy: 'down' },
      'ZeroH Disclosure ✓ Protected: files and output are masked · Free · /zeroh-disclosure:doctor',
    ],
    [
      { proxy: 'provider' },
      'ZeroH Disclosure ✓ Protected: files and output are masked · Free · /zeroh-disclosure:status',
    ],
  ];
  for (const [state, expected] of cases) {
    const mini = buildBanner({ mode: 'mini', known: KNOWN, ...state }).text;
    assert.equal(mini, expected, JSON.stringify(state));
    // One source: the mini line carries the art block's own state words.
    const big = buildBanner({ mode: 'big', ...state }).text;
    const { mark, words } = protectionState(state);
    assert.ok(big.includes(`${mark} ${words}`), JSON.stringify(state));
    assert.ok(mini.includes(`${mark} ${words}`), JSON.stringify(state));
  }
  // Warnings still print below the one line.
  const warned = buildBanner({
    mode: 'mini',
    proxy: 'turned-off',
    warnings: warningLines({ proxy: 'turned-off' }),
  }).text.split('\n');
  assert.equal(warned.length, 2);
  assert.match(warned[0], /^ZeroH Disclosure ✓ /u);
  assert.match(warned[1], /^⚠ proxy off \(you turned it off\)/u);
});

test('with nothing saved: the full view after the install, then mini', () => {
  const home = tempHome();
  const options = { home, env: { TERM: 'dumb' }, known: KNOWN, proxy: 'on' };
  assert.equal(readBannerMode({ home, env: {} }), 'default');
  const first = renderBanner(options);
  assert.match(first, /███████ ███████ ██████/u);
  assert.match(first, /Ask Claude:/u);
  for (const later of [renderBanner(options), renderBanner(options)]) {
    assert.equal(
      later,
      'ZeroH Disclosure ✓ Protected: your secrets are masked · Free · /zeroh-disclosure:status',
    );
  }
  // /zeroh-disclosure:status still shows the full view, marker untouched.
  const fresh = tempHome();
  renderBanner({ ...options, home: fresh, mode: 'full', markShown: false });
  assert.match(renderBanner({ ...options, home: fresh }), /Ask Claude:/u);
});

test('each chosen mode shows every later session; big is the art block', () => {
  const home = tempHome();
  renderBanner({ home, env: { TERM: 'dumb' } });
  for (const mode of ['big', 'compact', 'mini', 'off']) {
    writeBannerMode(mode, { home, env: {} });
    const text = renderBanner({
      home,
      env: {},
      known: KNOWN,
      proxy: 'on',
    });
    if (mode === 'big') {
      assert.match(text, /^\n███████/u);
      assert.doesNotMatch(text, /Ask Claude:/u);
    }
    if (mode === 'mini') assert.match(text, /^ZeroH Disclosure ✓ /u);
    if (mode === 'compact') assert.match(text, /^🛡 ZeroH Disclosure · Free/u);
    if (mode === 'off') assert.equal(text, '');
  }
});

test('a saved full from before 1.0.0 keeps working as big, and ZEROH_BANNER wins', () => {
  const home = tempHome();
  // Exactly what 1.0.0-rc.3 and earlier wrote for `banner full`.
  writeFileSync(
    bannerFiles(home).config,
    JSON.stringify({ version: 1, mode: 'full' }),
  );
  assert.equal(readBannerMode({ home, env: {} }), 'big');
  assert.match(
    renderBanner({ home, env: {}, proxy: 'on', markShown: false }),
    /^\n███████/u,
  );
  assert.equal(readBannerMode({ home, env: { ZEROH_BANNER: 'full' } }), 'big');
  assert.equal(readBannerMode({ home, env: { ZEROH_BANNER: 'MINI' } }), 'mini');
  assert.equal(readBannerMode({ home, env: { ZEROH_BANNER: 'off' } }), 'off');
  // An unknown value is ignored: the saved mode stands.
  assert.equal(readBannerMode({ home, env: { ZEROH_BANNER: 'huge' } }), 'big');
  const unset = tempHome();
  assert.equal(
    readBannerMode({ home: unset, env: { ZEROH_BANNER: 'banner' } }),
    'default',
  );
  assert.equal(normalizeBannerMode('full'), 'big');
  assert.equal(normalizeBannerMode('banner'), null);
  assert.throws(
    () => writeBannerMode('banner', { home, env: {} }),
    /big, compact, mini, or off/u,
  );
});

// Windows re-test (rc.2), findings 2 and 7: a refused login item is said on
// every banner and in status, with the system's reason and the fix, while
// typing is still masked (the proxy runs for the session).
test('a refused login item is a warning line with the reason and the fix', () => {
  const windows = {
    at: '2026-09-28T10:00:00.000Z',
    platform: 'win32',
    code: 'EPERM',
    detail: 'ERROR: The task XML is malformed.',
  };
  const [line] = warningLines({ proxy: 'ready', loginItemRefused: windows });
  assert.match(
    line,
    /^⚠ no login item: schtasks refused it: "ERROR: The task XML is malformed\."/u,
  );
  assert.match(line, /The local proxy runs while Claude Code does/u);
  assert.match(line, /To fix: update ZeroH Disclosure/u);
  const [linux] = warningLines({
    proxy: 'on',
    loginItemRefused: { platform: 'linux', code: 'ENOLOGINITEM' },
  });
  assert.match(linux, /no systemd user session and no desktop session/u);
  assert.match(linux, /loginctl enable-linger/u);
  const [mac] = warningLines({
    proxy: 'on',
    loginItemRefused: { platform: 'darwin', code: 'EPERM' },
  });
  assert.match(mac, /launchctl refused it \(EPERM\)/u);
  assert.match(mac, /Login Items & Extensions/u);
  // A string record from an earlier release still reads.
  assert.equal(
    warningLines({ proxy: 'on', loginItemRefused: '2026-09-27T00:00:00Z' })
      .length,
    1,
  );
  // With the proxy off the proxy's own line says it; no second line.
  assert.equal(
    warningLines({ proxy: 'off', loginItemRefused: windows }).length,
    1,
  );
  assert.deepEqual(warningLines({ proxy: 'ready' }), []);
});
