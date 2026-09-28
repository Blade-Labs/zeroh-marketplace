#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:settings (T-37): the settings a user changes from inside
// Claude Code, each passed to the CLI: banner <mode>, receipts keep <period>,
// uncertain <pass|block>, statusline <on|off>, vault status and vault clear
// --yes. Nothing else
// runs from here. Without arguments it shows the current values. A change
// only records the request here; the user's own typed command applies it
// (lib/user-authority.js).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBannerMode } from '../../lib/banner.js';
import { loadConfig, uncertainMode } from '../../lib/config.js';
import { retentionLine } from '../../lib/receipt-retention.js';
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
      `Banner: ${readBannerMode() === 'banner' ? 'default (the full view once, then the short banner)' : readBannerMode()} (/zeroh-disclosure:settings banner full|compact|off)`,
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
const result = spawnSync(process.execPath, [CLI, ...args, '--cwd', root], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.stdout.write(`${result.stdout || ''}${result.stderr || ''}`);

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
