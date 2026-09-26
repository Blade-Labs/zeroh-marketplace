// SPDX-License-Identifier: AGPL-3.0-only

// Isolated temporary homes for every test (see helpers.mjs).
import './helpers.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixHint, terminalCommand } from '../lib/fix-command.js';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));

// T-37: the fallback is the exact command with the absolute path, quoted for
// the platform's shell.
test('terminal commands name the absolute CLI path, quoted per platform', () => {
  assert.equal(
    terminalCommand(['doctor', '--fix'], {
      platform: 'darwin',
      root: '/Users/ana/p',
    }),
    'node "/Users/ana/p/bin/zeroh-disclosure.mjs" doctor --fix',
  );
  assert.equal(
    terminalCommand(['doctor'], { platform: 'linux', root: '/home/$x' }),
    "node '/home/$x/bin/zeroh-disclosure.mjs' doctor",
  );
  assert.equal(
    terminalCommand(['allow', 'STRIPE_KEY', 'api.example.com'], {
      platform: 'win32',
      root: 'C:\\Users\\Ana Lee\\.claude\\plugins\\zeroh',
    }),
    'node "C:\\Users\\Ana Lee\\.claude\\plugins\\zeroh\\bin\\zeroh-disclosure.mjs" allow STRIPE_KEY api.example.com',
  );
  assert.equal(
    terminalCommand(['allow', '--cwd', '/work/my app', 'K', 'h'], {
      platform: 'linux',
      root: '/p',
    }),
    'node "/p/bin/zeroh-disclosure.mjs" allow --cwd "/work/my app" K h',
  );
  assert.match(
    fixHint('/zeroh-disclosure:doctor --fix', ['doctor', '--fix']),
    /^`\/zeroh-disclosure:doctor --fix` \(if Claude Code can't start, in a terminal: `node ".+\/bin\/zeroh-disclosure\.mjs" doctor --fix`\)$/u,
  );
});

// No message tells a user to run a bare `zeroh-disclosure`: it is not on a
// marketplace user's PATH.
test('no user-facing message names a bare zeroh-disclosure command', () => {
  const files = [];
  for (const dir of ['lib', 'hooks', 'mcp', path.join('commands', 'scripts')]) {
    for (const name of readdirSync(path.join(PLUGIN, dir))) {
      if (/\.(?:m?js)$/u.test(name)) files.push(path.join(dir, name));
    }
  }
  files.push(path.join('bin', 'zeroh-disclosure.mjs'));
  for (const file of files) {
    const lines = readFileSync(path.join(PLUGIN, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(?:\/\/|\*)/u.test(line)) return;
      if (/^\s{2}zeroh-disclosure [a-z]/u.test(line)) return; // CLI usage text
      assert.doesNotMatch(
        line,
        /[`'"(]zeroh-disclosure (?:doctor|proxy|allow|vault|uninstall|tokens|report|banner|receipts)\b/u,
        `${file}:${index + 1}`,
      );
    });
  }
});
