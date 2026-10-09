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
  baseUrlRoutingState,
  proxyRuntimeStatus,
  sessionProxyState,
  settingsEntryState,
} from '../../packages/local-proxy/proxy-manager.js';
import {
  loginItemFix,
  loginItemReason,
} from '../../packages/local-proxy/service-manager.js';
import {
  deriveProtectionState,
  NOT_PROTECTED_LINE,
  ProtectionSurface,
  protectionWording,
} from '../../packages/zeroh-disclosure-core/protection-state.js';
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
const entry =
  state.reason === 'not-configured' ? settingsEntryState(process.env) : null;
const routing =
  state.reason === 'not-configured'
    ? baseUrlRoutingState({ env: process.env, cwd: process.cwd() })
    : null;
const proxyForModel = state.active
  ? 'on'
  : routing ||
    (state.reason === 'not-configured'
      ? entry === 'entry'
        ? 'not-ready'
        : null
      : 'down');
const protection = protectionWording(
  deriveProtectionState({ sessionProxy: proxyForModel }),
  { surface: ProtectionSurface.STATUS },
);
const lines = [];
if (state.reason === 'opted-out') {
  lines.push(
    'Local masking proxy: off (ZEROH_PROXY=off, ZeroH writes nothing).',
  );
} else if (state.reason === 'turned-off') {
  lines.push(
    `Local masking proxy: off (you turned it off). What you type is not masked: ${NOT_PROTECTED_LINE} (type /zeroh-disclosure:settings uncertain block to stop these instead). Turn it back on with /zeroh-disclosure:proxy on.`,
  );
} else if (state.reason === 'provider') {
  lines.push(
    `Local masking proxy: not used (Claude Code talks to Bedrock, Vertex or Foundry directly); ${NOT_PROTECTED_LINE} (type /zeroh-disclosure:settings uncertain block to stop these instead).`,
  );
} else if (state.active) {
  lines.push(`Local masking proxy: ${protection.word} for this session.`);
} else if (routing === 'upstream-mismatch') {
  lines.push(
    `Local masking proxy: ${protection.word}. This session is not routed through the local proxy; /zeroh-disclosure:doctor shows the session and install sources without showing their URLs.`,
  );
} else if (routing === 'credentials') {
  lines.push(
    `Local masking proxy: ${protection.word}. Remove the credentials and use the provider authorization settings instead.`,
  );
} else if (routing === 'overridden') {
  lines.push(
    `Local masking proxy: ${protection.word}. This session stays outside the local proxy; /zeroh-disclosure:doctor shows where it is set.`,
  );
} else if (state.reason !== 'not-configured') {
  lines.push(
    `Local masking proxy: ${protection.word}. Run /zeroh-disclosure:doctor to check this session.`,
  );
} else {
  lines.push(
    entry === 'entry'
      ? `Local masking proxy: ${protection.word}.`
      : entry === 'removed-by-user'
        ? 'Local masking proxy: its entry was removed from your Claude Code settings, so it stays off. To turn it on again, run /zeroh-disclosure:doctor --fix and start a new session.'
        : `Local masking proxy: ${protection.word}; the next session starts it.`,
  );
}
const runtime = await proxyRuntimeStatus().catch(() => null);
if (runtime?.loginItemRefused) {
  lines.push(
    `No login item: ${loginItemReason(runtime.loginItemRefused)}. The proxy runs only while Claude Code does. To fix: ${loginItemFix(runtime.loginItemRefused)}.`,
  );
}
lines.push(
  'It is on by default: what you type, CLAUDE.md and memory are masked before they reach the model.',
  'In a project where ZeroH Disclosure is disabled, the proxy passes requests through unmasked.',
  'Turn it off with /zeroh-disclosure:proxy off (restores your Claude Code settings and stops it; it stays off until /zeroh-disclosure:proxy on).',
);
console.log(lines.join('\n'));
