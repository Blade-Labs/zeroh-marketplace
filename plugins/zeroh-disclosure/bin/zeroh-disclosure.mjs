#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The zeroh-disclosure command line: argument parsing and subcommand dispatch.
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { loadConfig } from '../packages/zeroh-disclosure-core/config.js';
import { projectRootFromEnv } from '../packages/zeroh-disclosure-core/session.js';
import { cmdAllow } from '../lib/cli/allow.js';
import { cmdBanner } from '../lib/cli/banner.js';
import { cmdCatalog } from '../lib/cli/catalog.js';
import { cmdDoctor } from '../lib/cli/doctor.js';
import { cmdProxy } from '../lib/cli/proxy.js';
import { cmdReceipt } from '../lib/cli/receipt.js';
import { cmdReceipts } from '../lib/cli/receipts.js';
import { cmdReport } from '../lib/cli/report.js';
import { cmdReports } from '../lib/cli/reports.js';
import { finishUninstall, removalState } from '../lib/cli/removal-state.js';
import { cmdStatusline } from '../lib/cli/statusline.js';
import { cmdStyle } from '../lib/cli/style.js';
import { cmdTokens } from '../lib/cli/tokens.js';
import { cmdUncertain } from '../lib/cli/uncertain.js';
import { cmdUninstall } from '../lib/cli/uninstall.js';
import { cmdUnmask } from '../lib/cli/unmask.js';
import { cmdVault } from '../lib/cli/vault.js';
import { cmdVerify } from '../lib/cli/verify.js';
import { startRemovalHeartbeat } from '../packages/zeroh-disclosure-core/user-authority/removal.js';

if (['--version', '-v'].includes(process.argv[2])) {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  console.log(manifest.version);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
if (command === 'uninstall') startRemovalHeartbeat();
// --cwd wins; otherwise the project root the hooks use (projectRootFromEnv:
// CLAUDE_PROJECT_DIR, else the project this directory belongs to).
const cwd = path.resolve(args.cwd || projectRootFromEnv(process.cwd()));
await loadConfig({ cwd });

try {
  if (command === 'allow') await cmdAllow(args, cwd);
  else if (command === 'unmask') await cmdUnmask(args, cwd);
  else if (command === 'reports') await cmdReports(args);
  else if (command === 'statusline') await cmdStatusline(args, cwd);
  else if (command === 'style') await cmdStyle(args);
  else if (command === 'vault') await cmdVault(args, cwd);
  else if (command === 'verify') await cmdVerify(args);
  else if (command === 'receipt') await cmdReceipt(args, cwd);
  else if (command === 'tokens') await cmdTokens(args, cwd);
  else if (command === 'report') await cmdReport(args, cwd);
  else if (command === 'doctor') await cmdDoctor(args, cwd);
  else if (command === 'proxy') await cmdProxy(args);
  else if (command === 'banner') await cmdBanner(args);
  else if (command === 'uninstall') await cmdUninstall(args);
  else if (command === 'catalog') cmdCatalog(args);
  else if (command === 'receipts') await cmdReceipts(args);
  else if (command === 'uncertain') await cmdUncertain(args);
  else help(command ? 1 : 0);
} catch (error) {
  removalState.failure = error.message;
  console.error(`zeroh-disclosure: ${error.message}`);
  if (process.env.DEBUG && error.stack) console.error(error.stack);
  process.exitCode = 1;
} finally {
  await finishUninstall(command);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === 'yes') {
      out[key] = true;
      continue;
    }
    if (key === 'json') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) out.json = argv[++i];
      else out.json = true;
      continue;
    }
    if (
      [
        'list',
        'fix',
        'report',
        'keep-backups',
        'segment',
        'dry-run',
        'delete-receipts',
        // Accepted for 1.0 habits and ignored: it must never swallow the
        // next flag (`uninstall --force --dry-run` stays a dry run).
        'force',
      ].includes(key)
    ) {
      out[key] = true;
      continue;
    }
    if (key === 'all-projects') {
      out[key] = true;
      continue;
    }
    out[key] = argv[++i];
  }
  return out;
}

function help(exit) {
  console.log(`Usage:
  zeroh-disclosure --version
  zeroh-disclosure allow <NAME|TOKEN|TYPE> <host|mcp:SERVER>
  zeroh-disclosure allow --list
  zeroh-disclosure allow --remove <NAME|TOKEN|TYPE> <host|mcp:SERVER>
  zeroh-disclosure unmask caps <KIND> <15m|1h|session|0>
  zeroh-disclosure unmask caps --list
  zeroh-disclosure unmask
  zeroh-disclosure unmask <KIND> <why>
  zeroh-disclosure unmask revoke [id|all]
  zeroh-disclosure reports list
  zeroh-disclosure reports show <id>
  zeroh-disclosure reports delete <id>
  zeroh-disclosure statusline [segment] [--json]
  zeroh-disclosure statusline segment-command [--json]
  zeroh-disclosure statusline on|off|style
  zeroh-disclosure style show
  zeroh-disclosure style <key> <value>
  zeroh-disclosure style banner big|compact|mini|off
  zeroh-disclosure vault status
  zeroh-disclosure vault clear [--yes]
  zeroh-disclosure verify --receipt <turn-json>
  zeroh-disclosure verify --bundle <bundle-json>
  zeroh-disclosure receipt [--turn N] [--session ID] [--format text|json|html]
  zeroh-disclosure tokens [--session ID]
  zeroh-disclosure report [--since 7d|30d|90d|all] [--project .|--all-projects] [--format text|json|html] [--html path] [--json path]
  zeroh-disclosure doctor [--fix [--keep-backups]] [--report]
  zeroh-disclosure banner big|compact|mini|off
  zeroh-disclosure proxy off|on
  zeroh-disclosure uninstall [--yes] [--dry-run] [--delete-receipts]
  zeroh-disclosure catalog [--json]
  zeroh-disclosure receipts [keep forever|1y|90d|30d]
  zeroh-disclosure uncertain [pass|block]

Presentation changes (style, including style banner) run without a code.
Turning the status line on or off is user-only but also uses no code. Commands
that change what ZeroH protects (allow, unmask caps, vault clear, doctor --fix,
proxy, uninstall --yes, receipts keep and uncertain) run
for your own typed /zeroh-disclosure: command in Claude Code, or in your own
terminal outside Claude Code after you type the code they show.

Every command acts on the project in --cwd <dir>, else CLAUDE_PROJECT_DIR, else
the current directory.
`);
  process.exit(exit);
}
