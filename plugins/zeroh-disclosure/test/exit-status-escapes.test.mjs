// SPDX-License-Identifier: AGPL-3.0-only

// 1.0.1 (Mac /try review H1): the `|| echo` suffix goes after the last
// word, and an escaped `\;` (find -exec … \;) is part of that word.
import './helpers.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BASH_FAILURE_LINE,
  bashSuffixPoint,
  wrapBashExitStatus,
} from '../lib/exit-status.js';

const SUFFIX = ` || echo '${BASH_FAILURE_LINE}'`;

function dir() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-exit-esc-'));
  mkdirSync(path.join(base, 'config'));
  writeFileSync(path.join(base, 'config', 'a.txt'), 'A\n');
  writeFileSync(path.join(base, 'config', 'b.txt'), 'B\n');
  return base;
}

// The command goes to bash on stdin, so bash reads exactly this text on
// every OS. As a `-c` argument on Windows it would first pass through the
// Windows command line, where Git Bash's (MSYS) argument parsing turns a
// quoted `\\` into `\` before bash sees it; that happens to any command
// handed over that way, with or without ZeroH's suffix, so it is not what
// these tests check.
const run = (command, cwd) =>
  spawnSync('bash', ['-s'], { cwd, input: command, encoding: 'utf8' });

test('find -exec … \\; keeps its terminator; the suffix goes after it', () => {
  const cwd = dir();
  const command =
    "find config -type f -name '*.txt' -exec sh -c 'cat \"$1\"' _ {} \\;";
  const wrapped = wrapBashExitStatus(command);
  assert.equal(wrapped, `${command}${SUFFIX}`);
  const result = run(wrapped, cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.split('\n').filter(Boolean).sort(), [
    'A',
    'B',
  ]);
});

test('find -exec … + and a quoted ; are left alone', () => {
  const cwd = dir();
  for (const command of [
    'find config -type f -exec cat {} +',
    "find config -type f -exec cat {} ';'",
    'find config -type f -exec cat {} ";"',
  ]) {
    const wrapped = wrapBashExitStatus(command);
    assert.equal(wrapped, `${command}${SUFFIX}`, command);
    const result = run(wrapped, cwd);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, '', command);
    assert.match(result.stdout, /A/u, command);
  }
});

test('an escaped backslash before a real ; still drops the ;', () => {
  const command = 'echo a\\\\;';
  const point = bashSuffixPoint(command);
  assert.equal(point.at, command.length - 1);
  const result = run(wrapBashExitStatus(command));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'a\\\n');
});

test('a line continuation takes no suffix; an escaped backslash at the end does', () => {
  assert.equal(bashSuffixPoint('echo a \\'), null);
  const command = 'echo a\\\\';
  assert.equal(wrapBashExitStatus(command), `${command}${SUFFIX}`);
  assert.equal(run(wrapBashExitStatus(command)).stdout, 'a\\\n');
  // An escaped & is text, not a background job.
  const amp = 'echo a\\&';
  assert.equal(wrapBashExitStatus(amp), `${amp}${SUFFIX}`);
  assert.equal(run(wrapBashExitStatus(amp)).stdout, 'a&\n');
});

test('a failing find -exec still reports the failure', () => {
  const cwd = dir();
  const command = "find config -type f -exec sh -c 'exit 3' _ {} \\;";
  // find itself exits 0 here; a failing program after it shows the line.
  const failing = `${command} && false`;
  const result = run(wrapBashExitStatus(failing), cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ZeroH: the command failed/u);
});
