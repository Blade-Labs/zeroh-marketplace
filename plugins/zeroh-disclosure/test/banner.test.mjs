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
  readBannerMode,
  renderBanner,
  warningLines,
  writeBannerMode,
} from '../lib/banner.js';

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

test('full, banner, compact, and off modes render their promised content', () => {
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
  assert.match(
    full,
    /Masks what you type, files Claude reads, command output and tool results\./u,
  );
  assert.match(full, /Images and scanned PDFs are not masked/u);
  assert.match(full, /Local proxy: running; this session goes through it\./u);
  assert.ok(
    full.endsWith("\nAsk Claude: 'what does ZeroH Disclosure protect?'"),
  );
  assert.doesNotMatch(full, /ZEROH_BANNER|Receipts:|text, prompts/u);
  const granted = buildBanner({
    ...status,
    mode: 'full',
    proxy: 'off',
    unmaskStatus: 'EMAIL unmasked · 12 min left',
    warnings: ['⚠ proxy off: typed secrets will be stopped, not masked'],
  }).text;
  assert.match(granted, /Masks files Claude reads.*stopped, not sent\./u);
  assert.match(granted, /Unmasked now: EMAIL unmasked · 12 min left\./u);
  assert.match(granted, /⚠ proxy off[^\n]*\nAsk Claude: /u);

  const banner = buildBanner({ ...status, mode: 'banner' }).text;
  assert.match(banner, /^\n███████/u);
  assert.doesNotMatch(banner, /Images and scanned PDFs|Ask Claude/u);

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
      '⚠ proxy off: typed secrets will be stopped, not masked',
    ],
  );
  assert.deepEqual(
    warningLines({
      contextFindings: [{ displayPath: 'CLAUDE.md', count: 1 }],
      proxy: 'on',
    }),
    ['⚠ CLAUDE.md has 1 secret: the proxy masks them'],
  );
  // T-16/T-19: the session that installs the proxy goes through it from its
  // first prompt, so it says nothing about restarting. (A secret typed in
  // that very first prompt is stopped, not masked: the proxy has not seen
  // the session yet.)
  assert.deepEqual(warningLines({ proxy: 'ready' }), []);
  assert.match(
    buildBanner({ mode: 'banner', proxy: 'ready' }).text,
    /✓ Protected: your secrets are masked/u,
  );
  for (const proxy of ['provider', 'down', 'overridden', 'off']) {
    const lines = warningLines({ proxy });
    assert.equal(lines.length, 1, proxy);
    assert.match(lines[0], /^⚠ .*typed secrets/u, proxy);
    assert.match(
      buildBanner({ mode: 'banner', proxy }).text,
      /✓ Protected: files and output are masked/u,
      proxy,
    );
  }
});

test('plan text is Free and no known secret value enters any banner mode', () => {
  assert.equal(getPlan(), 'Free');
  for (const mode of ['full', 'banner', 'compact', 'off']) {
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
  for (const mode of ['full', 'compact', 'off']) {
    const result = spawnSync(process.execPath, [CLI, 'banner', mode], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        ZEROH_HOME: home,
        ZEROH_CREDENTIAL_HOME: path.join(home, 'credentials'),
        ZEROH_CLAUDE_SETTINGS: settings,
        ZEROH_SERVICE_MANAGER_DIR: serviceManager,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(bannerFiles(home).config)).mode, mode);
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
    assert.match(quiet.stdout, /███/u);
    assert.doesNotMatch(quiet.stdout, /\u001b|\\u001b/u);
  }
});

test('the banner is plain unless colour is asked for', () => {
  assert.doesNotMatch(buildBanner({ mode: 'banner' }).text, /\u001b/u);
  const coloured = buildBanner({ mode: 'banner', colour: true }).text;
  assert.match(coloured, /\u001b\[38;2;0;188;125m/u);
  assert.equal(colourAllowed({ TERM: 'xterm-256color' }), true);
  assert.equal(colourAllowed({ TERM: 'xterm', NO_COLOR: '' }), false);
  assert.equal(colourAllowed({ TERM: 'dumb' }), false);
  assert.equal(colourAllowed({}), false);
});
