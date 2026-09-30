// SPDX-License-Identifier: AGPL-3.0-only

// Windows re-test (rc.2), finding 9: a profile that added the public
// marketplace before 25 September 2026 keeps it registered as
// `zeroh-marketplace`, so `zeroh-disclosure@zeroh` is not found. ZeroH says
// so once at the first prompt and in doctor, with the three commands. A
// local directory marketplace, or another repository, named
// `zeroh-marketplace` from a different source is a different marketplace.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import './helpers.mjs';
import {
  applyFirstRunDefaults,
  staleMarketplaceName,
  staleMarketplaceText,
} from '../lib/first-run.js';

function profile(known) {
  const base = mkdtempSync(path.join(os.tmpdir(), 'zeroh-mkt-'));
  const config = path.join(base, 'claude');
  mkdirSync(path.join(config, 'plugins'), { recursive: true });
  writeFileSync(
    path.join(config, 'plugins', 'known_marketplaces.json'),
    JSON.stringify(known),
  );
  const settingsPath = path.join(config, 'settings.json');
  writeFileSync(settingsPath, '{}\n');
  const home = path.join(base, 'zeroh');
  mkdirSync(home, { recursive: true });
  return { env: { CLAUDE_CONFIG_DIR: config }, settingsPath, home };
}

const PUBLIC = { source: 'github', repo: 'Blade-Labs/zeroh-marketplace' };

test('the public marketplace under its old name is found, and only it', () => {
  assert.equal(
    staleMarketplaceName(
      profile({ 'zeroh-marketplace': { source: PUBLIC } }).env,
    ),
    'zeroh-marketplace',
  );
  assert.equal(
    staleMarketplaceName(
      profile({
        'zeroh-marketplace': {
          source: {
            source: 'git',
            url: 'https://github.com/blade-labs/zeroh-marketplace.git',
          },
        },
      }).env,
    ),
    'zeroh-marketplace',
  );
  for (const known of [
    { zeroh: { source: PUBLIC } },
    {
      'zeroh-marketplace': {
        source: {
          source: 'directory',
          path: '/srv/projects/zeroh-marketplace',
        },
      },
    },
    {
      'zeroh-marketplace': {
        source: {
          source: 'github',
          repo: 'Example-Org/other-marketplace',
        },
      },
    },
    {},
  ]) {
    assert.equal(staleMarketplaceName(profile(known).env), null);
  }
  assert.equal(
    staleMarketplaceName({ CLAUDE_CONFIG_DIR: '/nonexistent/zeroh' }),
    null,
  );
});

test('the first prompt says it once, with the commands that fix it', () => {
  const p = profile({ 'zeroh-marketplace': { source: PUBLIC } });
  const first = applyFirstRunDefaults({ ...p, pluginRoot: null });
  const text = staleMarketplaceText('zeroh-marketplace');
  assert.ok(first.lines.includes(text));
  assert.match(text, /claude plugin marketplace remove zeroh-marketplace/u);
  assert.match(
    text,
    /claude plugin marketplace add Blade-Labs\/zeroh-marketplace and claude plugin install zeroh-disclosure@zeroh/u,
  );
  const second = applyFirstRunDefaults({ ...p, pluginRoot: null });
  assert.ok(!second.lines.includes(text));
});
