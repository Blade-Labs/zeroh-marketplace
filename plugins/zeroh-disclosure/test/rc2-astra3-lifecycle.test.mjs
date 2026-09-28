// SPDX-License-Identifier: AGPL-3.0-only

// Astra rc.2 review, round 3 (F6, F7, F8, F11): what Stop says about a
// prompt that went unmasked, which status lines are ZeroH's, first-run
// setup after a failed write, and the style file's exemption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runHook, tempProject } from './helpers.mjs';
import {
  SEGMENT_COMMAND,
  STATUSLINE_COMMAND,
  choiceFor,
  isOurStatusLine,
  removeEverywhere,
  statuslineEntry,
  turnStatuslineOff,
  turnStatuslineOn,
} from '../lib/statusline-settings.js';
import { applyFirstRunDefaults } from '../lib/first-run.js';
import { isZeroHSettingsPath } from '../lib/settings-guard.js';
import {
  formatStopReceiptLine,
  formatStopTokenLine,
  receiptSummary,
  turnMaskedCount,
} from '../lib/report.js';

const FAKE_PASSWORD = 'ZEROH' + 'FAKE-pw7Q2x9Lm';
const PW = 'pass' + 'word';

test('F6: Stop does not say a prompt sent unmasked was masked or seen as a token', async () => {
  const p = tempProject({ env: false });
  const up = runHook(
    'user-prompt-submit',
    { prompt: `${PW}: "${FAKE_PASSWORD}"` },
    { project: p },
  );
  assert.match(
    up.json?.systemMessage ?? '',
    /this prompt was not protected \(proxy not running\)/u,
  );
  const stop = runHook('stop', {}, { project: p });
  const said = stop.json?.systemMessage ?? '';
  assert.match(said, /1 operation not protected/u);
  assert.doesNotMatch(said, /masked/u);
  assert.doesNotMatch(said, /Claude saw/u);
  assert.ok(!said.includes(FAKE_PASSWORD));
  // The receipt summary, read from the finalised ledger, agrees.
  const summary = await receiptSummary({
    projectRoot: p.dir,
    env: { ...process.env, ZEROH_HOME: p.home, HOME: p.home },
  });
  assert.equal(summary.summaries[0].values_masked, 0);

  // The same for a finalised ledger read back later (receipt, report): the
  // signed decision says the prompt went as typed.
  const ledger = {
    phase: 'finalized',
    replacements: [
      { entity_type: 'PASSWORD', replacement: '[PASSWORD-a1b2c3]' },
    ],
    // The signed receipt's public claim, as Stop leaves it.
    receipt: { public_claims: { decision_action: 'allow' } },
    audit: { unchecked: { 'proxy-not-running': { prompt: 1 } } },
  };
  assert.equal(turnMaskedCount(ledger), 0);
  assert.equal(formatStopTokenLine(ledger), null);
  assert.doesNotMatch(formatStopReceiptLine(1, ledger) ?? '', /masked/u);
  // A prompt the proxy masked still counts.
  const masked = {
    ...ledger,
    receipt: { public_claims: { decision_action: 'mask_and_allow' } },
  };
  assert.equal(turnMaskedCount(masked), 1);
  assert.match(formatStopTokenLine(masked), /Claude saw/u);
});

function settingsFixture(initial) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-astra3-set-'));
  const settingsPath = path.join(base, 'claude', 'settings.json');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (initial !== undefined)
    writeFileSync(settingsPath, `${JSON.stringify(initial, null, 2)}\n`);
  const home = path.join(base, 'zeroh');
  mkdirSync(home, { recursive: true });
  return { base, settingsPath, home };
}

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

test("F7: a status line the user composed around ZeroH's segment stays theirs", () => {
  const composed = [
    `${SEGMENT_COMMAND}; printf " · branch main"`,
    `zeroh=$(${SEGMENT_COMMAND}); printf "%s · branch main" "$zeroh"`,
    `${STATUSLINE_COMMAND}; printf " · main"`,
    `${STATUSLINE_COMMAND} && echo main`,
    `(${STATUSLINE_COMMAND})`,
    `${STATUSLINE_COMMAND} | tr a b`,
    `echo x; ${STATUSLINE_COMMAND}`,
    `node "/h/.zeroh/zeroh-statusline.mjs"; echo main`,
    'zeroh-disclosure statusline | tr a b',
  ];
  for (const command of composed) {
    assert.equal(isOurStatusLine({ type: 'command', command }), false, command);
    const s = settingsFixture({ statusLine: { type: 'command', command } });
    applyFirstRunDefaults({ ...s, pluginRoot: null });
    assert.equal(read(s.settingsPath).statusLine.command, command, command);
    turnStatuslineOff(s);
    assert.equal(read(s.settingsPath).statusLine.command, command, command);
    assert.equal(turnStatuslineOn({ ...s }).result, 'theirs', command);
    removeEverywhere({ home: s.home, settingsPaths: [s.settingsPath] });
    assert.equal(read(s.settingsPath).statusLine.command, command, command);
  }
  // ZeroH's own complete commands are still recognised.
  for (const command of [
    STATUSLINE_COMMAND,
    'node "/home/u/.zeroh/zeroh-statusline.mjs"',
    'node "/p/zeroh-disclosure/bin/zeroh-disclosure.mjs" statusline',
  ])
    assert.equal(isOurStatusLine({ command }), true, command);
});

test('F8: a settings write that fails records nothing, and the next prompt sets up the status line', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) {
    t.skip('needs POSIX permissions and a non-root user');
    return;
  }
  const s = settingsFixture({});
  const directory = path.dirname(s.settingsPath);
  chmodSync(directory, 0o555);
  let failed;
  try {
    failed = applyFirstRunDefaults({ ...s, pluginRoot: null });
  } finally {
    chmodSync(directory, 0o700);
  }
  assert.deepEqual(failed.lines, []);
  assert.deepEqual(read(s.settingsPath), {});
  assert.equal(choiceFor(s.home, s.settingsPath), null);
  const retry = applyFirstRunDefaults({ ...s, pluginRoot: null });
  assert.equal(retry.lines.length, 1);
  assert.deepEqual(read(s.settingsPath).statusLine, statuslineEntry());
  assert.equal(choiceFor(s.home, s.settingsPath), 'on');
  // The user removing it afterwards is still respected.
  const document = read(s.settingsPath);
  delete document.statusLine;
  writeFileSync(s.settingsPath, JSON.stringify(document));
  applyFirstRunDefaults({ ...s, pluginRoot: null });
  assert.equal(choiceFor(s.home, s.settingsPath), 'off');
  assert.equal(
    Object.hasOwn(read(s.settingsPath), 'statusLine'),
    false,
    'not put back',
  );
});

test('F11: a style file that is a link, dangling or not, or a hard link, is protected', () => {
  const p = tempProject();
  mkdirSync(p.home, { recursive: true });
  const style = path.join(p.home, 'statusline-style.json');
  const target = path.join(p.home, 'claude-settings.json');
  const opts = { home: p.home };
  const content = '{"disableAllHooks":true}';
  // Dangling: the protected target does not exist yet.
  symlinkSync(target, style);
  assert.equal(existsSync(style), false);
  assert.equal(isZeroHSettingsPath(style, p.dir, opts), true);
  const hook = runHook(
    'pre-tool-use',
    { tool_name: 'Write', tool_input: { file_path: style, content } },
    { project: p },
  );
  assert.equal(hook.json?.hookSpecificOutput?.permissionDecision, 'deny');
  unlinkSync(style);
  // A hard link to another file.
  writeFileSync(target, '{}');
  linkSync(target, style);
  assert.equal(isZeroHSettingsPath(style, p.dir, opts), true);
  unlinkSync(style);
  // The plain file, or none yet, stays editable.
  assert.equal(isZeroHSettingsPath(style, p.dir, opts), false);
  writeFileSync(style, '{"version":1}');
  assert.equal(isZeroHSettingsPath(style, p.dir, opts), false);
});
