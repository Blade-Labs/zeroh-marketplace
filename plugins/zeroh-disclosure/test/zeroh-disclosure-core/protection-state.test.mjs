// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  deriveProtectionState,
  maskedAgainLine,
  NOT_PROTECTED_LINE,
  PROTECTION_STATE_VALUES,
  ProtectionState,
  protectionWording,
} from '../../packages/zeroh-disclosure-core/protection-state.js';
import {
  PUBLIC_MARKETPLACE_NAME,
  PUBLIC_MARKETPLACE_REPO,
  PUBLIC_PLUGIN_ID,
} from '../../packages/zeroh-disclosure-core/product.js';

const PLUGIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

test('deriveProtectionState covers every externally observable protection state', () => {
  const cases = [
    [{ sessionProxy: 'on' }, ProtectionState.PROTECTED],
    [{ sessionProxy: 'off' }, ProtectionState.FILES_ONLY],
    [{ sessionProxy: 'ready' }, ProtectionState.PROXY_FIRST_PROMPT],
    [{ sessionProxy: 'not-ready' }, ProtectionState.PROXY_NEXT_PROMPT],
    [{ sessionProxy: 'down' }, ProtectionState.PROXY_DOWN],
    [{ config: { starting: true } }, ProtectionState.STARTING],
    [
      { config: { startedBeforeZeroH: true } },
      ProtectionState.STARTED_BEFORE_ZEROH,
    ],
    [{ config: { notProtected: 2 } }, ProtectionState.NOT_PROTECTED_TURN],
    [{ sessionProxy: 'upstream-mismatch' }, ProtectionState.UPSTREAM_MISMATCH],
    [{ sessionProxy: 'credentials' }, ProtectionState.BASE_URL_CREDENTIALS],
    [{ sessionProxy: 'overridden' }, ProtectionState.OVERRIDDEN],
    [{ config: { hooks: 'failing' } }, ProtectionState.HOOKS_FAILING],
    [{ config: { hooks: 'stopped' } }, ProtectionState.HOOKS_STOPPED],
    [{ config: { hooks: 'never-ran' } }, ProtectionState.HOOKS_NEVER_RAN],
    [{ config: { vaultAvailable: false } }, ProtectionState.VAULT_UNAVAILABLE],
    [{ config: { stateReadable: false } }, ProtectionState.STATE_UNREADABLE],
    [{ config: { pluginEnabled: false } }, ProtectionState.PLUGIN_DISABLED],
    [{ config: { uninstalled: true } }, ProtectionState.UNINSTALLED],
    [{ config: { session: false } }, ProtectionState.NO_SESSION],
    [
      {
        config: { startedBeforeZeroH: true, vaultAvailable: false },
      },
      ProtectionState.VAULT_UNAVAILABLE,
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(deriveProtectionState(input), expected, expected);
  }
});

test('repeated protection wording and public identity have one runtime source', () => {
  const runtimeFiles = ['lib', 'hooks', 'commands', 'bin', 'mcp']
    .flatMap((directory) => filesUnder(path.join(PLUGIN, directory)))
    .filter((file) => /\.(?:m?js)$/u.test(file));
  const runtime = runtimeFiles
    .map((file) => `${file}\n${readFileSync(file, 'utf8')}`)
    .join('\n');
  for (const ownCopy of [
    PUBLIC_PLUGIN_ID,
    PUBLIC_MARKETPLACE_REPO,
    `PUBLIC_MARKETPLACE_NAME = '${PUBLIC_MARKETPLACE_NAME}'`,
    NOT_PROTECTED_LINE,
    maskedAgainLine('EMAIL').slice('EMAIL '.length),
  ]) {
    assert.ok(!runtime.includes(ownCopy), `runtime copy: ${ownCopy}`);
  }
  const statusline = readFileSync(
    path.join(PLUGIN, 'lib', 'statusline', 'segments.js'),
    'utf8',
  );
  for (const state of PROTECTION_STATE_VALUES) {
    const word = protectionWording(state, { count: 3 }).word;
    assert.ok(!statusline.includes(`word: ${JSON.stringify(word)}`), word);
  }
});
