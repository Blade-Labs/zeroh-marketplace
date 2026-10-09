#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:settings (T-37): the settings a user changes from inside
// Claude Code. Presentation changes run here immediately; user-only changes
// record a request that the user's own typed command applies.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBannerMode } from '../../lib/banner.js';
import {
  loadConfig,
  uncertainMode,
} from '../../packages/zeroh-disclosure-core/config.js';
import { retentionLine } from '../../packages/zeroh-disclosure-core/receipt-retention.js';
import { resolveClaudeSettingsPath } from '../../lib/claude-settings.js';
import { statuslineState } from '../../lib/statusline-settings.js';
import { commandRoot } from './_helpers.js';

const CLI = fileURLToPath(
  new URL('../../bin/zeroh-disclosure.mjs', import.meta.url),
);
const ALLOWED = new Set([
  'banner',
  'receipts',
  'vault',
  'uncertain',
  'statusline',
]);
const args = process.argv.slice(2);
const root = commandRoot();
await loadConfig({ cwd: root });

if (args.length === 0) {
  console.log(
    [
      `Banner: ${bannerWords(readBannerMode())} (/zeroh-disclosure:settings banner big|compact|mini|off)`,
      `${retentionLine()} (/zeroh-disclosure:settings receipts keep forever|1y|90d|30d)`,
      `Uncertain cases: ${uncertainMode()} (/zeroh-disclosure:settings uncertain pass|block; pass, the default, never stops ordinary work)`,
      `Status line: ${statuslineWords()} (/zeroh-disclosure:settings statusline on|off|style)`,
      'Vault: /zeroh-disclosure:settings vault status, or vault clear --yes to remove every stored value of this project',
    ].join('\n'),
  );
  process.exit(0);
}
if (!ALLOWED.has(args[0])) {
  console.log(
    `Unknown setting "${args[0]}". Use banner, receipts, uncertain, statusline or vault; /zeroh-disclosure:settings lists them.`,
  );
  process.exit(0);
}
const cliArgs =
  args[0] === 'banner'
    ? ['style', 'banner', ...args.slice(1)]
    : args[0] === 'statusline' && args[1] === 'style'
      ? ['style', ...(args.length === 2 ? ['show'] : args.slice(2))]
      : args;
const result = spawnSync(process.execPath, [CLI, ...cliArgs, '--cwd', root], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.stdout.write(`${result.stdout || ''}${result.stderr || ''}`);

function bannerWords(mode) {
  return mode === 'default'
    ? 'mini (the default: the big view after the install, then one line)'
    : mode;
}

function statuslineWords() {
  try {
    return {
      ours: 'on',
      theirs: 'your own status line',
      none: 'off',
    }[statuslineState(resolveClaudeSettingsPath())];
  } catch {
    return "unknown (Claude Code's settings can't be read)";
  }
}
