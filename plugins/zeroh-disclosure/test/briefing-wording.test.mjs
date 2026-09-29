// SPDX-License-Identifier: AGPL-3.0-only

// 1.0.1 (Mac /try review C1, H2, H3): what ZeroH tells Claude and the user
// must be true and must not steer Claude around the destination check.
//   C1  Claude Code's session file keeps what the user typed as typed; only
//       tool output and file reads are masked there.
//   H2  no advice to read secrets from environment variables in commands;
//       a variable ZeroH knows is named plainly; no "uncertain" jargon
//       without the command that sets it.
//   H3  a readable host a value may not reach stops the command before
//       anything is sent (B1: only there; an unreadable destination gets
//       the real value, so Claude still asks the user first).
import { FAKE_STRIPE, runHook, tempProject } from './helpers.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PLUGIN } from './helpers.mjs';
import { UNCHECKED_HINTS, uncheckedNotice } from '../lib/unchecked.js';

function briefing() {
  const p = tempProject();
  const res = runHook('session-start', { source: 'startup' }, { project: p });
  // One line of prose per bullet, however it is wrapped.
  return res.json.hookSpecificOutput.additionalContext.replace(/\n +/gu, ' ');
}

test('C1: the briefing says typed prompts stay as typed in Claude Code session files', () => {
  const context = briefing();
  assert.doesNotMatch(context, /transcript keeps the tokens/u);
  assert.match(
    context,
    /Claude Code's own session file .*keeps what the user typed as typed/su,
  );
  assert.match(context, /don't copy, upload or share it/u);
});

test('C1: no shipped text claims the transcript keeps only tokens', () => {
  for (const file of [
    'README.md',
    'docs/how-to.md',
    'docs/architecture.md',
    'skills/about/SKILL.md',
    'hooks/session-start.js',
  ]) {
    const text = readFileSync(path.join(PLUGIN, file), 'utf8');
    assert.doesNotMatch(
      text,
      /(?:transcript|saved conversation) keeps? the tokens|conversation keep the tokens/u,
      file,
    );
  }
  const readme = readFileSync(path.join(PLUGIN, 'README.md'), 'utf8');
  assert.match(readme, /stores? what you type\s+as you typed it/u);
});

test('H2: the briefing tells Claude to write the token in commands, not to read .env', () => {
  const context = briefing();
  assert.doesNotMatch(context, /Prefer reading secrets from environment/u);
  assert.match(
    context,
    /In commands you run, write the token; ZeroH puts the value back and checks the host\. Only code you save to files should read secrets from environment variables\./u,
  );
});

test('H2: a variable ZeroH knows is named plainly, and the hint names the command', () => {
  assert.equal(
    uncheckedNotice('variable-in-command', { valueName: 'STRIPE_KEY' }),
    "ZeroH Disclosure: ZeroH couldn't check where $STRIPE_KEY went (it was loaded inside the command or the shell), so this command ran unchecked.",
  );
  assert.equal(
    UNCHECKED_HINTS.uncertain,
    'Type /zeroh-disclosure:settings uncertain block to stop these instead.',
  );
  assert.equal(
    uncheckedNotice('variable-in-command', {
      valueName: 'STRIPE_KEY',
      hint: true,
    }),
    "ZeroH Disclosure: ZeroH couldn't check where $STRIPE_KEY went (it was loaded inside the command or the shell), so this command ran unchecked. Type /zeroh-disclosure:settings uncertain block to stop these instead.",
  );
  // B4.3: ZeroH knows STRIPE_KEY's value, so no notice says it can't see it.
  assert.match(
    uncheckedNotice('variable-in-command', {
      valueName: 'STRIPE_KEY',
      mode: 'block',
    }),
    /was stopped because ZeroH couldn't check where \$STRIPE_KEY went \(it was loaded inside the command or the shell\)\./u,
  );
  for (const mode of ['pass', 'block'])
    assert.doesNotMatch(
      uncheckedNotice('variable-in-command', { valueName: 'STRIPE_KEY', mode }),
      /value ZeroH cannot see/u,
    );
});

test('H3/B1: a readable host is stopped by ZeroH; an unreadable destination still needs the user', () => {
  const context = briefing();
  assert.match(
    context,
    /For a host ZeroH can read that the value may not reach, ZeroH stops the command before anything is sent and tells the user how to allow it, so you don't need to ask first for that reason\./u,
  );
  assert.match(
    context,
    /Where ZeroH can't tell where a command sends the value \(a script, a variable host, git push\), the real value is put back and the command runs with a notice: before sending a secret somewhere the user didn't ask for, ask the user\./u,
  );
  assert.doesNotMatch(
    context,
    /For any other host|Don't hold back|let ZeroH decide/u,
  );
  const p = tempProject();
  const res = runHook(
    'post-tool-use',
    {
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
      tool_response: { stdout: `STRIPE_KEY=${FAKE_STRIPE}\n`, stderr: '' },
    },
    { project: p },
  );
  const note = JSON.parse(
    JSON.stringify(res.json),
  ).hookSpecificOutput.additionalContext.replace(/\n/gu, ' ');
  assert.doesNotMatch(note, /for allowed destinations\./u);
  assert.doesNotMatch(note, /For any other host|let ZeroH decide/u);
  assert.match(
    note,
    /For a host ZeroH can read that the value may not reach, ZeroH stops the command before anything is sent/u,
  );
  assert.match(
    note,
    /Where ZeroH can't tell where a command sends the value \(a script, a variable host, git push\), the real value is put back and the command runs with a notice: before sending a secret somewhere the user didn't ask for, ask the user\./u,
  );
});

// B4: every "the session file holds what you typed" claim also names the
// other real values Claude Code saves there.
test('B4.2: session-file claims name unmasked values and values put back into edits', async () => {
  const { TRANSCRIPT_BLOCK_REASON, TRANSCRIPT_MODEL_NOTE, TRANSCRIPT_NOTICE } =
    await import('../lib/transcript-files.js');
  const context = briefing();
  assert.match(
    context,
    /keeps what the user typed as typed, values shown under an unmask and the real values ZeroH puts back into Edit, Write and MCP inputs/u,
  );
  for (const text of [TRANSCRIPT_NOTICE, TRANSCRIPT_BLOCK_REASON])
    assert.match(
      text,
      /values you typed, values you unmasked and values ZeroH put back into edits, as they are/u,
    );
  assert.match(
    TRANSCRIPT_MODEL_NOTE,
    /as typed, values shown under an unmask and the real values ZeroH put back into Edit, Write and MCP inputs/u,
  );
  const changelog = readFileSync(path.join(PLUGIN, 'CHANGELOG.md'), 'utf8');
  const release = changelog.slice(
    changelog.indexOf('## 1.0.1'),
    changelog.indexOf('## 1.0.0'),
  );
  for (const [file, text] of [
    [
      'skills/about/SKILL.md',
      readFileSync(path.join(PLUGIN, 'skills/about/SKILL.md'), 'utf8'),
    ],
    ['CHANGELOG.md 1.0.1', release],
    ['README.md', readFileSync(path.join(PLUGIN, 'README.md'), 'utf8')],
    [
      'docs/architecture.md',
      readFileSync(path.join(PLUGIN, 'docs/architecture.md'), 'utf8'),
    ],
  ]) {
    const flat = text.replace(/\s+/gu, ' ');
    assert.match(flat, /under an unmask/u, file);
    assert.match(
      flat,
      /put back into (?:Edit|edits)|puts back into Edit|ZeroH restores into Edit/u,
      file,
    );
  }
  // B4.4: the unmask count is per tool call, not per session or turn.
  assert.doesNotMatch(release, /counted once\.\*\*/u);
  assert.match(release.replace(/\s+/gu, ' '), /counted once per tool call/u);
});

test('B4.1: the report-miss notice names the list command', async () => {
  const { modelReportNotice } = await import('../lib/report-miss.js');
  assert.match(
    modelReportNotice({ value: 'x', where: 'somewhere' }),
    /`\/zeroh-disclosure:report-miss list` shows or deletes these notes\.$/u,
  );
});
