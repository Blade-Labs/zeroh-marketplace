#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:proxy [off|on]: whether the local masking proxy covers
// this session, or `zeroh-disclosure proxy off|on`. It runs as the command's
// `!` preprocessing, the user's own action: the model never runs it, and
// ZeroH's guard (which denies a model's tool call that changes ZeroH's
// settings) is not in the way.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  sessionProxyState,
  settingsEntryState,
} from '../../lib/proxy-manager.js';
import { commandSessionId } from './_helpers.js';

const action = String(process.argv[2] || '')
  .trim()
  .toLowerCase();
if (action === 'off' || action === 'on') {
  const cli = fileURLToPath(
    new URL('../../bin/zeroh-disclosure.mjs', import.meta.url),
  );
  const result = spawnSync(process.execPath, [cli, 'proxy', action], {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });
  process.stdout.write(result.stdout || '');
  process.stdout.write(result.stderr || '');
  process.exit(result.status ?? 1);
}

const state = await sessionProxyState({
  env: process.env,
  sessionId: commandSessionId(),
});
const lines = [];
if (state.reason === 'opted-out') {
  lines.push(
    'Local masking proxy: off (ZEROH_PROXY=off, ZeroH writes nothing).',
  );
} else if (state.reason === 'turned-off') {
  lines.push(
    'Local masking proxy: off (you turned it off). Typed secrets are stopped, not masked. Turn it back on with /zeroh-disclosure:proxy on.',
  );
} else if (state.reason === 'provider') {
  lines.push(
    'Local masking proxy: not used (Claude Code talks to Bedrock, Vertex or Foundry directly); typed secrets are blocked.',
  );
} else if (state.active) {
  lines.push('Local masking proxy: on for this session.');
} else if (state.reason !== 'not-configured') {
  lines.push(
    `Local masking proxy: configured but not masking this session (${state.reason}). Your next prompt tries to bring it back; if it keeps happening, run /zeroh-disclosure:doctor.`,
  );
} else {
  const entry = settingsEntryState(process.env);
  lines.push(
    entry === 'entry'
      ? 'Local masking proxy: installed; it applies from the next Claude Code session.'
      : entry === 'removed-by-user'
        ? 'Local masking proxy: its entry was removed from your Claude Code settings, so it stays off. To turn it on again, run /zeroh-disclosure:doctor --fix and start a new session.'
        : 'Local masking proxy: not active; the next session starts it.',
  );
}
lines.push(
  'It is on by default: what you type, CLAUDE.md and memory are masked before they reach the model.',
  'In a project where ZeroH Disclosure is disabled, the proxy passes requests through unmasked.',
  'Turn it off with /zeroh-disclosure:proxy off (restores your Claude Code settings and stops it; it stays off until /zeroh-disclosure:proxy on).',
);
console.log(lines.join('\n'));
