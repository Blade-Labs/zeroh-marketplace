// SPDX-License-Identifier: AGPL-3.0-only

// The status line's style file and data API (rc.2): the look is the user's,
// the state is ZeroH's. Isolated temporary homes (see helpers.mjs).
import { PLUGIN, runHook, tempProject } from './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_STYLE,
  encodeProjectPath,
  JSON_SCHEMA,
  normaliseStyle,
  readStyle,
  renderStatusline,
  statuslineData,
  statuslineMain,
  styleFilePath,
} from '../lib/statusline.js';
import {
  deniesZeroHSettings,
  isZeroHSettingsPath,
} from '../lib/settings-guard.js';
import { statuslineEntry } from '../lib/statusline-settings.js';

const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);
const ENV = { NO_COLOR: '1' };
const GREEN = {
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
const YELLOW = {
  ...GREEN,
  level: 'warn',
  word: 'files only',
  fix: '/zeroh-disclosure:doctor',
};
const RED = {
  ...GREEN,
  level: 'off',
  word: 'hooks failing',
  fix: '/zeroh-disclosure:doctor',
  counts: false,
};
const draw = (model, style) => renderStatusline(model, { env: ENV, style });

test('the default style draws the line as before', () => {
  assert.equal(
    draw(GREEN, undefined),
    '🛡️ ZeroH · 🟢 protected · 4 masked · 0 sent',
  );
  assert.equal(draw(GREEN, DEFAULT_STYLE), draw(GREEN, undefined));
});

test('style variations: fields, order, separator, labels, emoji, wording, colour', () => {
  assert.equal(
    draw(GREEN, { version: 1, fields: ['shield', 'state'] }),
    '🛡️ · 🟢 protected',
  );
  assert.equal(
    draw(GREEN, {
      version: 1,
      fields: ['name', 'state', 'fix', 'masked', 'receipt'],
      separator: ' | ',
      emoji: false,
      wording: 'compact',
      labels: { masked: 'm', receipt: '↗' },
    }),
    'ZeroH | protected | 4 m',
  );
  assert.equal(
    draw(GREEN, {
      version: 1,
      fields: ['masked', 'sent', 'name'],
      labels: { name: '🔒', masked: 'hidden', sent: 'leaked' },
    }),
    '4 hidden · 0 leaked · 🔒',
  );
  assert.equal(
    draw(
      { ...YELLOW, word: 'proxy on from your next prompt', fix: null },
      {
        version: 1,
        fields: ['name', 'state'],
        wording: 'compact',
        emoji: false,
      },
    ),
    'ZeroH · proxy next prompt',
  );
  // Colour on and off.
  const coloured = renderStatusline(GREEN, { env: {}, style: DEFAULT_STYLE });
  assert.match(coloured, /\u001b\[32mprotected/u);
  const plain = renderStatusline(GREEN, {
    env: {},
    style: { version: 1, colour: false },
  });
  assert.doesNotMatch(plain, /\u001b\[/u);
  // Only while something is wrong.
  const quiet = { version: 1, onlyWhenNotProtected: true };
  assert.equal(draw(GREEN, quiet), '');
  assert.equal(draw(YELLOW, quiet), draw(YELLOW, undefined));
});

test('while ZeroH is not 🟢 the state and its fix always show', () => {
  for (const model of [YELLOW, RED]) {
    for (const style of [
      { version: 1, fields: ['name'] },
      { version: 1, fields: ['masked', 'receipt'] },
      { version: 1, fields: ['shield', 'name'], onlyWhenNotProtected: true },
      { version: 1, fields: ['name', 'state'], emoji: false },
    ]) {
      const text = draw(model, style);
      assert.ok(text.includes(model.word), `${model.word}: ${text}`);
      assert.ok(text.includes(model.fix), `${model.fix}: ${text}`);
    }
  }
  // Right after the name when the style leaves it out.
  assert.equal(
    draw(YELLOW, { version: 1, fields: ['shield', 'name', 'masked'] }),
    '🛡️ ZeroH · 🟡 files only · /zeroh-disclosure:doctor · 4 masked',
  );
});

test('a style cannot fake 🟢: state words and marks in labels or separators are refused', () => {
  const fakes = [
    '🟢 protected',
    'protected',
    'OK',
    '✅',
    'safe',
    'Secure',
    'files only',
    'proxy on',
    '🟡',
    'hooks',
    '\u001b[32mgo',
    'a\nb',
    '‮ZeroH',
    'x'.repeat(25),
    42,
  ];
  for (const fake of fakes) {
    const style = normaliseStyle({
      version: 1,
      separator: fake,
      labels: { name: fake, shield: fake, masked: fake, receipt: fake },
    });
    assert.equal(style.labels.name, DEFAULT_STYLE.labels.name, String(fake));
    assert.equal(style.labels.masked, DEFAULT_STYLE.labels.masked);
    assert.equal(style.separator, DEFAULT_STYLE.separator);
    for (const model of [YELLOW, RED]) {
      const text = draw(model, {
        version: 1,
        fields: ['name', 'masked'],
        labels: { name: fake, masked: fake },
      });
      assert.doesNotMatch(text, /🟢|✅/u);
      assert.ok(text.includes(model.word));
    }
  }
});

test('an invalid or unknown style falls back to the default, and drawing never throws', () => {
  for (const raw of [
    null,
    'not an object',
    [],
    { version: 2, fields: ['name'] },
    { fields: ['name'] },
    { version: '1' },
    { version: 1, fields: 'name' },
    { version: 1, fields: ['nope', 'zzz'] },
    { version: 1, emoji: 'no', wording: 'tiny', colour: 0, separator: '' },
    { version: 1, labels: 'x' },
    { version: 1, onlyWhenNotProtected: 'yes' },
  ]) {
    const style = normaliseStyle(raw);
    assert.deepEqual(
      { ...style, fields: [...style.fields] },
      {
        ...DEFAULT_STYLE,
        fields: [...DEFAULT_STYLE.fields],
        labels: { ...DEFAULT_STYLE.labels },
      },
      JSON.stringify(raw),
    );
    assert.doesNotThrow(() => draw(GREEN, raw));
  }
  // A style whose getters throw.
  const hostile = {
    get version() {
      throw new Error('boom');
    },
  };
  assert.equal(draw(GREEN, hostile), draw(GREEN, undefined));
  // The file: missing, broken, or a directory.
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-style-'));
  const env = { ZEROH_HOME: home };
  assert.equal(readStyle(env), DEFAULT_STYLE);
  writeFileSync(styleFilePath(env), '{broken');
  assert.equal(readStyle(env), DEFAULT_STYLE);
  writeFileSync(
    styleFilePath(env),
    JSON.stringify({ version: 1, separator: ' | ', unknownKey: true }),
  );
  assert.equal(readStyle(env).separator, ' | ');
});

// A session with a status file, drawn through statuslineMain with the style
// file in place, as Claude Code runs it.
function session(status) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-style-session-'));
  const root = path.join(base, 'project');
  const home = path.join(base, 'zeroh');
  const dir = path.join(
    home,
    'projects',
    encodeProjectPath(root),
    'sessions',
    's1',
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  const env = {
    HOME: path.join(base, 'home'),
    ZEROH_HOME: home,
    ZEROH_CLAUDE_SETTINGS: path.join(base, 'settings.json'),
    NO_COLOR: '1',
  };
  const run = async (argv = []) => {
    let out = '';
    await statuslineMain([...argv, '--session', 's1', '--cwd', root], {
      stdin: null,
      stdout: { write: (chunk) => (out += chunk) },
      env,
    });
    return out;
  };
  return { home, env, run };
}

const HEALTHY = {
  v: 1,
  phase: 'ready',
  hooks: { 'session-start': { ok_at: '2026-09-27T11:59:00Z' } },
  proxy: 'on',
  turn: 1,
  masked: 2,
  sent: 0,
};

test('the style file is read on every draw', async () => {
  const s = session(HEALTHY);
  assert.equal(await s.run(), '🛡️ ZeroH · 🟢 protected · 2 masked · 0 sent\n');
  writeFileSync(
    styleFilePath(s.env),
    JSON.stringify({
      version: 1,
      fields: ['name', 'state'],
      emoji: false,
      separator: ' | ',
    }),
  );
  assert.equal(await s.run(), 'ZeroH | protected\n');
  assert.equal(await s.run(['segment']), 'ZeroH | protected');
});

// A receipt file URL as this system writes one (file:///C:/… on Windows).
const RECEIPT_PATH = path.resolve('/tmp/x/receipt.html');
const RECEIPT_URL = pathToFileURL(RECEIPT_PATH).href;

test('--json: the versioned data schema', async () => {
  const s = session({
    ...HEALTHY,
    proxy: 'off',
    unchecked: { turn: 1, count: 1 },
  });
  const data = JSON.parse(await s.run(['--json']));
  assert.deepEqual(Object.keys(data).sort(), [
    'counts',
    'fix',
    'plugin_version',
    'reason',
    'receipt',
    'schema',
    'state',
    'unmask',
  ]);
  assert.equal(data.schema, JSON_SCHEMA);
  assert.equal(JSON_SCHEMA, 'zeroh-statusline/1');
  assert.equal(
    data.plugin_version,
    JSON.parse(readFileSync(path.join(PLUGIN, 'package.json'), 'utf8')).version,
  );
  assert.equal(data.state, 'partial');
  assert.equal(data.reason, 'files only');
  assert.equal(data.fix, '/zeroh-disclosure:doctor');
  assert.deepEqual(data.counts, {
    masked: 2,
    sent: 0,
    not_protected_this_turn: 1,
  });
  assert.deepEqual(data.unmask, []);
  assert.equal(data.receipt, null);
  // The style never changes the data.
  writeFileSync(
    styleFilePath(s.env),
    JSON.stringify({ version: 1, fields: ['name'] }),
  );
  assert.deepEqual(JSON.parse(await s.run(['--json'])), data);
  // 🟢, 🔴, a grant and a receipt.
  assert.equal(statuslineData(GREEN).state, 'protected');
  assert.equal(statuslineData(RED).state, 'off');
  assert.equal(statuslineData(RED).counts, null);
  const withAll = statuslineData({
    ...GREEN,
    grants: [
      { kind: 'EMAIL', expiresAt: Date.parse('2026-09-27T12:12:00Z') },
      { kind: 'PHONE', expiresAt: null },
    ],
    receipt: RECEIPT_URL,
  });
  assert.deepEqual(withAll.unmask, [
    { kind: 'EMAIL', expires_at: '2026-09-27T12:12:00.000Z' },
    { kind: 'PHONE', expires_at: null },
  ]);
  assert.deepEqual(withAll.receipt, {
    url: RECEIPT_URL,
    path: RECEIPT_PATH,
  });
});

test('the guard lets the model edit the style file only, never the entry', () => {
  const p = tempProject();
  const style = path.join(p.home, 'statusline-style.json');
  const opts = { home: p.home };
  assert.equal(isZeroHSettingsPath(style, p.dir, opts), false);
  assert.equal(
    isZeroHSettingsPath(style, p.dir, { ...opts, read: true }),
    false,
  );
  for (const other of [
    'statusline.json',
    'plugin-root.json',
    'vault.key',
    'first-run.json',
  ]) {
    assert.equal(
      isZeroHSettingsPath(path.join(p.home, other), p.dir, opts),
      true,
      other,
    );
  }
  // A link in its place to a protected file is not the style file.
  mkdirSync(p.home, { recursive: true });
  writeFileSync(path.join(p.home, 'vault.key'), 'x');
  symlinkSync(path.join(p.home, 'vault.key'), style);
  assert.equal(isZeroHSettingsPath(style, p.dir, opts), true);
  // Through the hook, as the model's Write tool call.
  const q = tempProject();
  const write = (file, content) =>
    runHook(
      'pre-tool-use',
      { tool_name: 'Write', tool_input: { file_path: file, content } },
      { project: q },
    ).json?.hookSpecificOutput?.permissionDecision ?? 'allow';
  assert.equal(
    write(path.join(q.home, 'statusline-style.json'), '{"version":1}'),
    'allow',
  );
  assert.equal(write(path.join(q.home, 'statusline.json'), '{}'), 'deny');
  // The statusLine entry in Claude Code's settings stays the user's.
  mkdirSync(path.dirname(q.settings), { recursive: true });
  writeFileSync(q.settings, JSON.stringify({ statusLine: statuslineEntry() }));
  assert.equal(
    write(
      q.settings,
      JSON.stringify({ statusLine: { type: 'command', command: 'mine.sh' } }),
    ),
    'deny',
  );
  assert.equal(
    deniesZeroHSettings(
      'Edit',
      {
        file_path: q.settings,
        old_string: 'node -e',
        new_string: 'echo',
      },
      q.dir,
    ),
    true,
  );
});

test('/zeroh-disclosure:settings statusline style shows the path and an example', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'zeroh-style-cli-'));
  const script = path.join(PLUGIN, 'commands', 'scripts', 'settings.js');
  const run = spawnSync(process.execPath, [script, 'statusline', 'style'], {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      ZEROH_HOME: home,
      CLAUDE_PROJECT_DIR: home,
    },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes(path.join(home, 'statusline-style.json')));
  assert.match(run.stdout, /not created yet/u);
  assert.match(run.stdout, /"version": 1/u);
  assert.match(run.stdout, /state and its fix always show/u);
  const json = spawnSync(
    process.execPath,
    [CLI, 'statusline', 'style', '--json'],
    {
      cwd: home,
      env: { PATH: process.env.PATH, HOME: home, ZEROH_HOME: home },
      encoding: 'utf8',
    },
  );
  assert.equal(JSON.parse(json.stdout).style.version, 1);
});

test('docs/statusline.md examples draw as documented', () => {
  const doc = readFileSync(path.join(PLUGIN, 'docs', 'statusline.md'), 'utf8');
  const examples = [
    [{ version: 1, fields: ['shield', 'state'] }, GREEN, '🛡️ · 🟢 protected'],
    [
      {
        version: 1,
        fields: ['name', 'state', 'fix', 'masked', 'receipt'],
        separator: ' | ',
        emoji: false,
        wording: 'compact',
        labels: { masked: 'm', receipt: '↗' },
      },
      YELLOW,
      'ZeroH | files only | /zeroh-disclosure:doctor | 4 m',
    ],
    [
      {
        version: 1,
        fields: ['name', 'state', 'masked'],
        labels: { name: '🔒' },
      },
      GREEN,
      '🔒 · 🟢 protected · 4 masked',
    ],
    [
      { version: 1, onlyWhenNotProtected: true },
      RED,
      '🛡️ ZeroH · 🔴 hooks failing · /zeroh-disclosure:doctor',
    ],
  ];
  for (const [style, model, expected] of examples) {
    assert.equal(draw(model, style), expected);
    assert.ok(doc.includes(expected), expected);
  }
});

test("a user who replaces ZeroH's entry with their own script is told once, and left alone", async () => {
  const { applyFirstRunDefaults, FIRST_RUN_LINES } =
    await import('../lib/first-run.js');
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-style-replaced-'));
  const settingsPath = path.join(base, 'settings.json');
  writeFileSync(settingsPath, '{}');
  const home = path.join(base, 'zeroh');
  const apply = () =>
    applyFirstRunDefaults({ home, settingsPath, env: { HOME: base } }).lines;
  assert.deepEqual(apply(), [FIRST_RUN_LINES.statuslineOn]);
  const mine = { type: 'command', command: '~/.claude/my-line.sh' };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: mine }));
  const told = apply();
  assert.deepEqual(told, [FIRST_RUN_LINES.replaced]);
  assert.match(told[0], /statusline --json/u);
  assert.deepEqual(apply(), []);
  assert.deepEqual(
    JSON.parse(readFileSync(settingsPath, 'utf8')).statusLine,
    mine,
  );
});
