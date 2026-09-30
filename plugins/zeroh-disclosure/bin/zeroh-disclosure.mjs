#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The zeroh-disclosure command line: allow rules, unmask grants, receipts and
// reports, the vault, the proxy, and doctor. Every subcommand that changes
// what ZeroH protects asks lib/user-authority.js first (Astra R3): it runs
// for the user's own typed slash command, or after the user confirms it in a
// terminal outside Claude Code; from anywhere else it changes nothing.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { writePrivateFile } from '../lib/private-fs.js';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { requireUserAuthority } from '../lib/user-authority.js';
import { cleanupStaleRunFiles } from '../lib/late-bind.js';
import {
  envSessionId,
  projectRootFromEnv,
  pruneCommitmentKeys,
} from '../lib/session.js';
import {
  verifyReceiptArtifact,
  verifyReceiptBundleArtifact,
} from '../lib/verify-receipt.js';
import {
  ALLOW_FILE_NOTICE,
  readAllowRules,
  allowRuleKey,
  updateAllowRule,
  writeAllowRules,
} from '../lib/allow-rules.js';
import {
  destinationSummary,
  formatDestinationSummary,
} from '../lib/allow-list.js';
import { loadKnownSecrets } from '../lib/secrets.js';
import { detectionCatalog } from '../lib/detector.js';
import { terminalCommand } from '../lib/fix-command.js';
import {
  activeGrants,
  capSummary,
  formatGrantTimeLeft,
  isPersonalDataType,
  isSecretType,
  normaliseKind,
  PERSONAL_DATA_TYPES,
  readGrantStore,
  revokeGrants,
  writeCap,
} from '../lib/unmask.js';
import { normalizeBannerMode, writeBannerMode } from '../lib/banner.js';
import {
  checkVaults,
  isVaultError,
  projectKey,
  resetVaults,
  Vault,
  vaultProblem,
  zerohHome,
} from '../lib/vault.js';
import {
  buildReportForOptions,
  formatLocalReport,
  formatReceiptSummary,
  formatSessionTokenMap,
  receiptSummary,
  registeredProjectRoots,
  sessionTokenMap,
  writeLocalReport,
} from '../lib/report.js';
import { deleteReport, listReports, readReport } from '../lib/report-miss.js';
import {
  deleteProxyReport,
  formatProxyReport,
  isProxyReportId,
  listProxyReports,
  readProxyReport,
} from '../lib/proxy-report.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const command = args._[0];
let removalLock = null;
let localCleanupDone = false;
let removalFailure = null;
let remainingRemovalSteps = [];
// --cwd wins; otherwise the project root the hooks use (projectRootFromEnv:
// CLAUDE_PROJECT_DIR, else the project this directory belongs to).
const cwd = path.resolve(args.cwd || projectRootFromEnv(process.cwd()));
await loadConfig({ cwd });

// True when the user asked for this very command (see lib/user-authority.js);
// otherwise prints why nothing changed. `details`: lines the terminal
// confirmation shows above the code.
async function authorized(details = []) {
  const result = await requireUserAuthority({
    argv: process.argv.slice(2),
    details,
  });
  if (!result.ok) console.log(result.message);
  return result.ok;
}

try {
  if (command === 'allow') await cmdAllow(args, cwd);
  else if (command === 'unmask') await cmdUnmask(args, cwd);
  else if (command === 'reports') await cmdReports(args);
  else if (command === 'statusline') await cmdStatusline(args, cwd);
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
} catch (e) {
  removalFailure = e.message;
  console.error(`zeroh-disclosure: ${e.message}`);
  if (process.env.DEBUG && e.stack) console.error(e.stack);
  process.exitCode = 1;
} finally {
  if (removalLock && !localCleanupDone) {
    const { clearUninstalled } = await import('../lib/uninstall-marker.js');
    clearUninstalled();
  }
  if (command === 'uninstall' && args.yes && !args['dry-run']) {
    console.log(
      localCleanupDone
        ? 'ZeroH Disclosure: local cleanup finished.'
        : `ZeroH Disclosure: local cleanup failed${removalFailure ? ` (${removalFailure})` : ' before completion'}.`,
    );
    if (remainingRemovalSteps.length)
      console.log(`Remaining steps: ${remainingRemovalSteps.join('; ')}`);
  }
  if (removalLock) {
    const { finishRemoval } = await import('../lib/user-authority.js');
    finishRemoval(removalLock, { cleanupDirectory: localCleanupDone });
  }
  if (
    localCleanupDone &&
    !removalFailure &&
    remainingRemovalSteps.length === 0 &&
    process.env.ZEROH_REMOVAL_LOG_DIR
  ) {
    const logDir = process.env.ZEROH_REMOVAL_LOG_DIR;
    if (process.platform === 'win32') {
      // Windows keeps the redirected log open until this process exits.
      const cleaner = spawn(
        process.execPath,
        [
          '-e',
          `const fs=require('node:fs'); const dir=process.argv[1]; const pid=Number(process.argv[2]); let attempts=0; const retry=()=>{if(++attempts>8)return; try{process.kill(pid,0);setTimeout(retry,Math.min(100*attempts,800))}catch{try{fs.rmSync(dir,{recursive:true,force:true})}catch{setTimeout(retry,Math.min(100*attempts,800))}}};retry();`,
          logDir,
          String(process.pid),
        ],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      cleaner.unref();
    } else {
      rmSync(logDir, { recursive: true, force: true });
    }
  }
}

// How long receipts are kept (D-16): `receipts` shows the policy, `receipts
// keep <forever|1y|90d|30d>` writes it to the user's own config.env.
async function cmdReceipts(args) {
  const { RECEIPT_RETENTION, retentionLine, validRetention } =
    await import('../lib/receipt-retention.js');
  const action = args._[1];
  if (!action) {
    print(
      { retention: process.env.ZEROH_RECEIPT_RETENTION || '90d' },
      args.json,
      [retentionLine()],
    );
    return;
  }
  const value = validRetention(args._[2]);
  if (action !== 'keep' || !value) {
    throw new Error(
      `receipts keep needs one of ${Object.keys(RECEIPT_RETENTION).join(', ')}`,
    );
  }
  if (!(await authorized())) return;
  const file = path.join(zerohHome(), 'config.env');
  const { readFileSync: read, existsSync: exists } = await import('node:fs');
  const lines = exists(file)
    ? read(file, 'utf8')
        .split(/\r?\n/u)
        .filter(
          (line) =>
            !/^\s*(?:export\s+)?ZEROH_RECEIPT_RETENTION\s*=/u.test(line),
        )
    : [];
  while (lines.length && lines.at(-1) === '') lines.pop();
  lines.push(`ZEROH_RECEIPT_RETENTION=${value}`, '');
  const { writePrivateFile } = await import('../lib/private-fs.js');
  writePrivateFile(file, lines.join('\n'));
  print({ retention: value, file }, args.json, [
    retentionLine({ ZEROH_RECEIPT_RETENTION: value }),
    `Saved in ${file}. A repository's .zeroh.env may only shorten it. Older receipts go at the next Claude Code start.`,
  ]);
}

// What ZeroH does with a case it cannot prove either way (a destination it
// cannot read, a command it cannot parse): `uncertain` shows it, `uncertain
// pass|block` writes ZEROH_UNCERTAIN to the user's own config.env.
async function cmdUncertain(args) {
  const { uncertainMode } = await import('../lib/config.js');
  const describe = (mode) =>
    mode === 'block'
      ? 'Uncertain cases: block (ZeroH denies what it cannot prove safe, such as a restored secret sent to a destination it cannot read).'
      : 'Uncertain cases: pass (the default: ordinary work is never stopped, and a secret is restored as before when its destination cannot be proven).';
  const value = args._[1];
  if (!value) {
    const mode = uncertainMode();
    print({ uncertain: mode }, args.json, [describe(mode)]);
    return;
  }
  const mode = String(value).toLowerCase();
  if (mode !== 'pass' && mode !== 'block')
    throw new Error('uncertain needs pass or block');
  if (!(await authorized())) return;
  const file = writeUserSetting('ZEROH_UNCERTAIN', mode);
  print({ uncertain: mode, file }, args.json, [
    describe(mode),
    `Saved in ${file}. A repository's .zeroh.env may only make it block. It applies from your next prompt.`,
  ]);
}

// Sets `key` in the user's own <ZEROH_HOME>/config.env, keeping every other
// line. Returns the file.
function writeUserSetting(key, value) {
  const file = path.join(zerohHome(), 'config.env');
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, 'u');
  const lines = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/u)
        .filter((line) => !pattern.test(line))
    : [];
  while (lines.length && lines.at(-1) === '') lines.pop();
  lines.push(`${key}=${value}`, '');
  writePrivateFile(file, lines.join('\n'));
  return file;
}

// What the free plugin detects, from the live rule set (T-35).
function cmdCatalog(args) {
  const catalog = detectionCatalog();
  const personal = Object.fromEntries(
    catalog.personal_data_kinds.map(({ type, label }) => [type, label]),
  );
  print(catalog, args.json, [
    `Provider key formats: ${catalog.provider_formats} (${catalog.source}), from ${catalog.providers.length} providers:`,
    ...catalog.providers.map(
      ({ name, rules }) => `  ${name} (${rules.length}): ${rules.join(', ')}`,
    ),
    `Named by provider on screen (${catalog.named_prefixes.length} public prefixes): ${catalog.named_prefixes
      .map(({ prefix, label }) => `${prefix} ${label}`)
      .join('; ')}`,
    'Also:',
    ...catalog.also.map((line) => `  ${line}`),
    `Personal data: ${catalog.personal_data.map((type) => personal[type] ?? type).join(', ')}`,
    `  validated by ${catalog.personal_data_sources.join(', ')}`,
  ]);
}

async function cmdReports(args) {
  const action = args._[1] || 'list';
  if (action === 'list') {
    // Missed-value reports and proxy diagnostic reports share the folder;
    // each line says which kind it is.
    const reports = listReports().map((report) => ({
      kind: 'miss',
      ...report,
    }));
    const proxyReports = listProxyReports().map((report) => ({
      kind: 'proxy',
      id: report.id,
      date: report.date,
      event: report.event,
      failure: report.failure,
    }));
    const all = [...reports, ...proxyReports].sort((left, right) =>
      String(right.date).localeCompare(String(left.date)),
    );
    print(
      { reports: all },
      args.json,
      all.length
        ? all.map((report) =>
            report.kind === 'proxy'
              ? `${report.id}  ${report.date}  proxy  ${report.event}${report.failure ? ` (${report.failure})` : ''}`
              : `${report.id}  ${report.date}  miss  ${report.shape?.public_prefix || '-'}  ${report.shape?.length ?? '-'} chars  ${report.where}`,
          )
        : ['No local reports.'],
    );
    return;
  }
  const id = args._[2];
  if (!id) throw new Error(`reports ${action} requires <id>`);
  // Deleting a local report is the user's (/zeroh-disclosure:report-miss
  // delete <id>).
  if (action === 'delete' && !(await authorized())) return;
  if (isProxyReportId(id)) {
    if (action === 'show') {
      print(readProxyReport(id), args.json, [
        formatProxyReport(readProxyReport(id)),
      ]);
      return;
    }
    if (action === 'delete') {
      const deleted = deleteProxyReport(id);
      print({ id, deleted }, args.json, [
        deleted ? `Deleted local report ${id}.` : `Report not found: ${id}.`,
      ]);
      return;
    }
  }
  if (action === 'show') {
    const report = readReport(id);
    print(report, args.json, [JSON.stringify(report, null, 2)]);
    return;
  }
  if (action === 'delete') {
    const deleted = deleteReport(id);
    print({ id, deleted }, args.json, [
      deleted ? `Deleted local report ${id}.` : `Report not found: ${id}.`,
    ]);
    return;
  }
  throw new Error(`unknown reports action: ${action}`);
}

async function cmdAllow(args, cwd) {
  const loaded = readAllowRules(cwd);
  const remove = typeof args.remove === 'string';
  // `/zeroh-disclosure:allow` with no arguments lists, like --list.
  // The vault's values, for a typed value's token (Mac /try review M1).
  let held = [];
  try {
    const vault = new Vault(cwd);
    vault.load();
    held = vault.knownValues();
  } catch {
    // No vault (or a locked one): names, types and tokens still work.
  }
  if (args.list || (!remove && args._.length === 1)) {
    if (loaded.ignored) console.error(ALLOW_FILE_NOTICE);
    const summary = destinationSummary(loadKnownSecrets(cwd), loaded.rules, {
      typed: held.filter((entry) => entry.source === 'prompt'),
    });
    print({ rules: loaded.rules, ...summary }, args.json, [
      ...formatDestinationSummary(summary),
    ]);
    return;
  }

  const name = remove ? args.remove : args._[1];
  const host = remove ? args._[1] : args._[2];
  if (!name || !host) {
    throw new Error(
      remove
        ? 'allow --remove requires <NAME|TOKEN|TYPE> <host|mcp:SERVER>'
        : 'allow requires <NAME|TOKEN|TYPE> <host|mcp:SERVER>',
    );
  }
  const key = allowRuleKey(name, { values: held });
  const rules = updateAllowRule(loaded.rules, key, host, { remove });
  if (!(await authorized())) return;
  writeAllowRules(cwd, rules);
  const action = remove ? 'removed' : 'allowed';
  print({ action, name: key, host, rules }, args.json, [
    `${action}: ${key} → ${host}`,
    ...(remove ? [] : ['Ask Claude to try again.']),
  ]);
}

async function cmdUnmask(args, cwd) {
  const action = args._[1];
  if (action === 'caps') {
    if (args.list) {
      const loaded = capSummary();
      print(loaded, args.json, [
        ...(loaded.ignored
          ? [
              'warning: unmask.json failed signature verification; defaults are in effect',
            ]
          : []),
        ...Object.entries(loaded.caps).map(([kind, cap]) => `${kind}: ${cap}`),
      ]);
      return;
    }
    const kind = args._[2];
    const cap = args._[3];
    if (!kind || !cap) {
      throw new Error('unmask caps requires <KIND> <15m|1h|session|0>');
    }
    if (!(await authorized())) return;
    const caps = writeCap(kind, cap);
    print(
      { action: 'cap_updated', kind: kind.toUpperCase(), cap, caps },
      args.json,
      [`${kind.toUpperCase()} unmask cap: ${cap}`],
    );
    return;
  }
  if (action === 'revoke') {
    const target = args._[2] || 'all';
    const revoked = revokeGrants(cwd, target);
    print({ action: 'revoked', target, grants: revoked }, args.json, [
      revoked.length
        ? `Revoked ${revoked.length} unmask grant(s): ${revoked.map(({ id }) => id).join(', ')}`
        : 'No unmask grants to revoke.',
    ]);
    return;
  }
  if (action) {
    unmaskRequest(args, action);
    return;
  }

  const sessionId = args.session || envSessionId();
  const grants = activeGrants(cwd, { sessionId });
  const loaded = readGrantStore(cwd);
  print(
    { grants, ignored: loaded.ignored },
    args.json,
    grants.length
      ? grants.map(
          (grant) =>
            `${grant.id}  ${grant.kind}  ${formatGrantTimeLeft(grant)}  ${grant.reason}`,
        )
      : [
          ...(loaded.ignored
            ? [
                'Warning: the signed grant file was changed by hand and is ignored.',
              ]
            : []),
          'No active unmask grants.',
        ],
  );
  if (!args.json) console.log(unmaskHowToAsk());
}

// A function, not a module constant: main() runs before later constants exist.
function unmaskHowToAsk() {
  return 'To ask Claude to unmask a kind: /zeroh-disclosure:unmask EMAIL <why>. You decide in the dialog; keys are never unmasked.';
}

// `unmask <KIND> <why…>` names a request for Claude to make with the
// request_unmask tool; the grant itself is only ever made in the user's dialog.
function unmaskRequest(args, rawKind) {
  const kind = normaliseKind(rawKind);
  const reason = args._.slice(2).join(' ').trim();
  if (isSecretType(kind)) {
    print({ action: 'refused', kind }, args.json, [
      `${kind} is a secret or credential type. Keys are never unmasked.`,
    ]);
    return;
  }
  if (!isPersonalDataType(kind)) {
    throw new Error(
      `unknown unmask kind ${kind}. Kinds: ${PERSONAL_DATA_TYPES.join(', ')}`,
    );
  }
  if (!reason) {
    print({ action: 'needs_reason', kind }, args.json, [
      `Say why Claude should see ${kind} values: /zeroh-disclosure:unmask ${kind} <why>`,
    ]);
    return;
  }
  print({ action: 'request', kind, reason }, args.json, [
    `Unmask request: kind ${kind}, reason "${reason}". Claude asks with request_unmask; you decide in Claude Code's dialog.`,
  ]);
}

// `statusline` prints ZeroH's status line (lib/statusline.js; Claude Code
// runs it, see lib/statusline-settings.js). `statusline on|off` turns
// Claude Code's statusLine entry on or off (lib/statusline-settings.js), for
// the user only.
async function cmdStatusline(args, cwd) {
  const action = args._[1];
  if (action === 'on' || action === 'off') {
    await cmdStatuslineSetting(args, action);
    return;
  }
  if (action === 'segment-command') {
    // Read-only: the command that prints ZeroH's part, for a status line
    // script of the user's own (docs/statusline.md).
    const { SEGMENT_COMMAND } = await import('../lib/statusline-settings.js');
    print({ command: SEGMENT_COMMAND }, args.json, [SEGMENT_COMMAND]);
    return;
  }
  if (action === 'style') {
    const { readStyle, styleFilePath } = await import('../lib/statusline.js');
    const file = styleFilePath();
    const current = readStyle();
    print({ file, style: current }, args.json, [
      `Status line style: ${file}${existsSync(file) ? '' : ' (not created yet: the default applies)'}`,
      'Ask Claude to change it ("make ZeroH\'s status line compact, no emoji"), or edit it yourself. For example:',
      '',
      JSON.stringify(
        {
          version: 1,
          fields: ['name', 'state', 'masked', 'receipt'],
          separator: ' | ',
          emoji: false,
          wording: 'compact',
        },
        null,
        2,
      ),
      '',
      'While ZeroH is not 🟢 the state and its fix always show. All keys: docs/statusline.md in the plugin.',
    ]);
    return;
  }
  if (action && action !== 'segment') {
    throw new Error(
      'statusline takes on, off, style, segment or segment-command, or nothing to print the status line',
    );
  }
  const { statuslineMain } = await import('../lib/statusline.js');
  const argv = [];
  if (args.segment || action === 'segment') argv.push('segment');
  if (args.json) argv.push('--json');
  if (typeof args.session === 'string') argv.push('--session', args.session);
  if (args.cwd) argv.push('--cwd', cwd);
  await statuslineMain(argv);
}

async function cmdStatuslineSetting(args, action) {
  const { resolveClaudeSettingsPath } =
    await import('../lib/claude-settings.js');
  const settingsPath = resolveClaudeSettingsPath();
  if (!(await authorized())) return;
  const { turnStatuslineOff, turnStatuslineOn } =
    await import('../lib/statusline-settings.js');
  const home = zerohHome();
  if (action === 'off') {
    const { result } = turnStatuslineOff({ settingsPath, home });
    print({ statusline: result, settings: settingsPath }, args.json, [
      {
        off: `Status line off: ZeroH's statusLine entry was removed from ${settingsPath}.`,
        unwrapped: `Status line off: ZeroH's part was taken out of your status line; your own command is back as it was (${settingsPath}).`,
        theirs:
          "Your status line is your own, so ZeroH left it as it is. If your script adds ZeroH's segment, remove that line to hide it.",
        none: 'The ZeroH status line was not on.',
      }[result],
    ]);
    return;
  }
  const { result, command, wrapped } = turnStatuslineOn({
    settingsPath,
    home,
    pluginRoot: PLUGIN_ROOT,
  });
  const lines = {
    on: [
      `Status line on: Claude Code shows "🛡 ZeroH · 🟢 protected · …" under the prompt (${settingsPath}).`,
      "If it doesn't appear within a few seconds, restart Claude Code. /zeroh-disclosure:settings statusline off removes it.",
    ],
    // The user's own line, with ZeroH's part after it (1.0.1): no command
    // to copy, nothing in their script changed.
    wrapped: [
      'Added ZeroH\'s part on its own line under your status line (🛡 ZeroH · 🟢 protected · …). To keep it on your line instead, set "position": "end" in the style file (/zeroh-disclosure:settings statusline style). To undo: /zeroh-disclosure:settings statusline off',
    ],
    already: [
      wrapped
        ? "ZeroH's part is already in your status line. To undo: /zeroh-disclosure:settings statusline off"
        : 'The ZeroH status line is already on. /zeroh-disclosure:settings statusline off removes it.',
    ],
    theirs: [
      `Your status line in ${settingsPath} already shows ZeroH's part, or isn't a command ZeroH can add to, so ZeroH left it as it is.`,
      "To add ZeroH's part by hand, see docs/statusline.md in the plugin.",
    ],
    // 1.0.1 doesn't wrap a status line on Windows (1.1 will).
    windows: [
      `On Windows ZeroH doesn't add its part to your own status line yet, so your status line in ${settingsPath} is left as it is.`,
      "To add ZeroH's part by hand, see docs/statusline.md in the plugin.",
    ],
  }[result];
  // The command stays out of the reply; --json callers get it.
  print(
    { statusline: result, settings: settingsPath, command },
    args.json,
    lines,
  );
}

async function cmdVault(args, cwd) {
  const action = args._[1];
  if (action === 'status') {
    // Read-only: status never writes or prunes the vault.
    let status;
    try {
      status = new Vault(cwd).status();
    } catch (error) {
      if (!isVaultError(error)) throw error;
      const problem = vaultProblem(error);
      throw new Error(
        `this project's vault can't be opened: ${problem.reason}. ${problem.fix}`,
      );
    }
    print({ project: cwd, ...status }, args.json, [
      `project: ${cwd}`,
      `retention: ${status.retention} (${status.retention_source === 'vault' ? 'stored by the last SessionStart' : 'from this configuration'})`,
      `total: ${status.total}`,
      'counts by type:',
      ...Object.entries(status.counts_by_type).map(
        ([type, count]) => `  ${type}: ${count}`,
      ),
      `oldest last-use age: ${formatAge(status.oldest_last_use_age_ms)}`,
      `expired tokens remembered: ${status.expired_tokens}`,
    ]);
    return;
  }
  if (action === 'clear') {
    if (!args.yes) {
      throw new Error(
        'vault clear removes every stored value of this project: add --yes to confirm (/zeroh-disclosure:settings vault clear --yes)',
      );
    }
    if (!(await authorized([`  project: ${cwd}`]))) return;
    const result = clearProject(cwd);
    print({ project: cwd, ...result }, args.json, [
      result.cleared
        ? `Cleared the vault for ${cwd}: ${result.values} stored value(s) removed.`
        : `No vault for ${cwd}; nothing stored to clear.`,
      `Also removed ${result.runFiles} pending restore file(s) and ${result.commitmentKeys} receipt commitment key(s).`,
    ]);
    return;
  }
  throw new Error('vault requires "status" or "clear"');
}

// `vault clear`: every stored value of the project, the restore files that
// still hold values (ZEROH_HOME/run) and the keys behind the receipts'
// commitments, so nothing the user asked to remove stays readable.
function clearProject(root) {
  let vault;
  try {
    vault = new Vault(root);
  } catch (error) {
    if (
      ![
        'ZEROH_VAULT_UNREADABLE',
        'ZEROH_VAULT_KEY_MISSING',
        'ZEROH_VAULT_KEY_INVALID',
      ].includes(error.code)
    ) {
      throw error;
    }
    // Nothing in it can be read: it goes (a lost key: every vault goes, as
    // with doctor --fix), then it is cleared like any other.
    resetVaults({ projectRoot: root });
    vault = new Vault(root);
  }
  const values = vault.size;
  const cleared = vault.clear();
  let runFiles = 0;
  try {
    runFiles = cleanupStaleRunFiles({ maxAgeMs: 0 });
  } catch {
    // Reported as zero; SessionStart removes what is left.
  }
  const commitmentKeys = pruneCommitmentKeys(root);
  return { cleared, values, runFiles, commitmentKeys };
}

function formatAge(ageMs) {
  if (ageMs === null) return '-';
  const seconds = Math.floor(ageMs / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

async function cmdVerify(args) {
  if (args.bundle) {
    const result = await verifyReceiptBundleArtifact(args.bundle);
    print(result, args.json, [
      `ok: ${result.ok}`,
      ...failedLine(result),
      `bundle_hash: ${result.bundle_hash}`,
      `receipts_count: ${result.receipts_count}`,
      '',
      ...checkLines(result.checks),
    ]);
    if (!result.ok) process.exit(1);
    return;
  }
  const file = args.receipt || args.file || args._[1];
  if (!file)
    throw new Error('verify requires --receipt <path> or --bundle <path>');
  const result = await verifyReceiptArtifact(file);
  print(result, args.json, [
    `ok: ${result.ok}`,
    ...failedLine(result),
    `receipt_id: ${result.receipt_id}`,
    `policy_id: ${result.policy_id}`,
    `engine: ${result.protection_engine_id}`,
    `decision: ${result.decision_action}`,
    `covers: ${coverageLabel(result.coverage)}`,
    `revealed_under_grant: ${formatRevealCounts(result.revealed_under_grant)}`,
    '',
    ...checkLines(result.checks),
  ]);
  if (!result.ok) process.exit(1);
}

// What a receipt's signature covers (lib/turn-summary.js). A function, so
// it is defined before the command runs.
function coverageLabel(coverage) {
  return (
    {
      turn: 'every number the receipt shows (signed turn summary)',
      pending:
        'the typed prompt so far; the turn summary is signed when the turn ends',
      'typed-prompt': 'the typed prompt only (a receipt from before 1.0.0)',
    }[coverage] ?? coverage
  );
}

// Name every failed check up front, so a failure is readable without
// scanning the full list.
function failedLine(result) {
  return result.failed?.length
    ? [`failed checks: ${result.failed.join(', ')}`]
    : [];
}

function checkLines(checks) {
  return checks.map(
    (c) =>
      `${c.ok ? '✓' : c.status === 'unavailable' ? '?' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`,
  );
}

function formatRevealCounts(entries = []) {
  if (!entries.length) return 'none';
  return entries
    .map(
      ({ kind, grant_id: grantId, tool_outputs: outputs }) =>
        `${kind}:${outputs} (${grantId})`,
    )
    .join(', ');
}

async function cmdReceipt(args, cwd) {
  const turn = args.turn == null ? null : Number(args.turn);
  if (turn != null && (!Number.isInteger(turn) || turn < 1)) {
    throw new Error('--turn must be a positive integer');
  }
  const summary = await receiptSummary({
    projectRoot: cwd,
    sessionId: args.session || null,
    turn,
  });
  console.log(formatReceiptSummary(summary));
}

async function cmdTokens(args, cwd) {
  const result = await sessionTokenMap({
    projectRoot: cwd,
    sessionId: args.session || null,
  });
  console.log(formatSessionTokenMap(result.rows, { previews: true }));
}

async function cmdReport(args, cwd) {
  if (args.json === true) throw new Error('--json requires a path');
  const report = await buildReportForOptions({
    cwd,
    since: args.since || '7d',
    project: args.project || '.',
    allProjects: !!args['all-projects'],
  });
  const written = await writeLocalReport({
    report,
    htmlPath: args.html || null,
    jsonPath: typeof args.json === 'string' ? args.json : null,
  });
  console.log(formatLocalReport(report, written));
}

async function cmdProxy(args) {
  const action = args._[1];
  if (action !== 'on' && action !== 'off')
    throw new Error('proxy requires "off" or "on"');
  if (!(await authorized())) return;
  if (action === 'on') {
    const { proxyOn } = await import('../lib/proxy-manager.js');
    const result = proxyOn();
    print(result, args.json, [
      result.wasOff
        ? 'The local masking proxy is on again: your next Claude Code session sets it up.'
        : 'The local masking proxy was not turned off; nothing changed.',
    ]);
    return;
  }
  const { stopDefaultProxy } = await import('../lib/proxy-manager.js');
  const result = await stopDefaultProxy({ remember: true, retire: true });
  const remaining = result.remaining || [];
  print(result, args.json, [
    proxySettingsLine(result),
    'It stays off, also in new sessions, until you run /zeroh-disclosure:proxy on (or /zeroh-disclosure:doctor --fix).',
    ...(remaining.length
      ? [
          `The local masking proxy keeps running for ${remaining.length} other Claude Code settings file(s): ${remaining.join(', ')}. Run proxy off with that settings file (CLAUDE_CONFIG_DIR or ZEROH_CLAUDE_SETTINGS) to remove it there too.`,
        ]
      : [
          result.loginItem?.removed
            ? 'Removed the per-user login item.'
            : 'No ZeroH login item was registered.',
          result.retired
            ? 'This session keeps working until you exit; the proxy masks only what it masked before, then stops by itself. New sessions start without it.'
            : result.stopped
              ? 'Stopped the local masking proxy.'
              : 'The local masking proxy was already stopped.',
        ]),
  ]);
}

// Removes everything ZeroH Disclosure keeps on this machine (LV-F8, LP-F6):
// the proxy entry in every Claude Code settings file it wrote to, the proxy
// and its login item, the <project>/.zeroh folders earlier builds left
// (never their receipts, see below), ZEROH_HOME (vault, keys, config, allow
// list, grants, receipts' commitment keys, reports, the proxy's runtime
// copy), and last the plugin itself. The receipts are kept, value-free,
// with the public keys that verify them, in a folder of their own
// (lib/receipt-keep.js), unless --delete-receipts. It asks first unless
// --yes.
//
// Receipts ZeroH Disclosure 0.1 wrote inside a project
// (<project>/.zeroh/sessions/<sid>/) are never deleted, not even with
// --delete-receipts: their public part is copied to the kept-receipts
// folder, and a folder that also holds that version's private keys or typed
// values stays where it is; uninstall says where and how to delete it.
//
// Every module it needs is loaded before anything is removed, and the
// plugin goes last: Claude Code may delete the plugin's folder when it
// uninstalls it, and this command runs from there.
//
// A Claude Code session that still runs with the plugin would set ZeroH up
// again at its next prompt, so the tombstone is written first: a session
// still running then does nothing more (T-38). It never deletes a folder
// that does not look like a ZeroH home (a mistaken ZEROH_HOME=%LOCALAPPDATA%
// must not wipe it).
async function cmdUninstall(args) {
  const home = path.resolve(zerohHome());
  const unsafe = notAZerohHome(home);
  if (unsafe) {
    throw new Error(
      `${home} ${unsafe}, so uninstall leaves it alone. Check ZEROH_HOME; nothing was removed.`,
    );
  }
  const [
    { liveMaskingRoots, proxyPaths },
    { isKeptReceiptsDir, keepLegacyReceipts, keepReceipts, keptReceiptsDir },
    { removePlugin, uninstallCommandFor },
    { markUninstalled, UNINSTALL_MARKER },
    { removeProxyEverywhere },
    { resolveClaudeSettingsPath },
    { removeEverywhere },
    { removeFirstRunMarketplace },
    { writeSessionReceiptHtml },
  ] = await Promise.all([
    import('../lib/proxy-state.js'),
    import('../lib/receipt-keep.js'),
    import('../lib/plugin-removal.js'),
    import('../lib/uninstall-marker.js'),
    import('../lib/proxy-manager.js'),
    import('../lib/claude-settings.js'),
    import('../lib/statusline-settings.js'),
    import('../lib/first-run.js'),
    import('../lib/report.js'),
  ]);
  const live = [...liveMaskingRoots(proxyPaths())];
  const legacy = (await legacyProjectFolders()).filter(
    (scan) => path.resolve(scan.dir) !== home,
  );
  const legacyEmpty = legacy.filter((scan) => scan.files === 0);
  const legacyHeld = legacy.filter((scan) => scan.files > 0);
  const deleteReceipts = Boolean(args['delete-receipts']);
  const receiptsDir = keptReceiptsDir();
  const plan = [
    'This removes ZeroH Disclosure from this machine, in this order:',
    "  - the local proxy's entry in your Claude Code settings (your own setting goes back), the proxy's login item and its runtime copy; a proxy still serving an open session passes it through unmasked until it is idle, then exits, and nothing starts it again",
    "  - ZeroH's status line in your Claude Code settings, if you turned it on (your own status line stays)",
    '  - marketplace auto-update added by ZeroH, if unchanged; your own marketplace entry and source stay',
    deleteReceipts
      ? `  - ${home}: the vault and its key, the signing and allow-list keys, your settings, allow rules, unmask grants, reports and receipts (--delete-receipts)`
      : `  - ${home}: the vault and its key, the signing and allow-list keys, your settings, allow rules, unmask grants and reports`,
    ...(deleteReceipts && isKeptReceiptsDir(receiptsDir)
      ? [`  - ${receiptsDir}: receipts an earlier uninstall kept`]
      : []),
    ...legacyEmpty.map(
      (scan) => `  - ${scan.dir} (empty, left by an earlier build)`,
    ),
    ...legacyHeld.map((scan) =>
      deleteReceipts
        ? `  - not ${scan.dir}: it holds files of ZeroH Disclosure 0.1 (${scan.receipts} receipt(s)); uninstall never deletes them and says how to`
        : `  - ${scan.dir}: files of ZeroH Disclosure 0.1 (${scan.receipts} receipt(s)); their public part is copied to ${receiptsDir}, and the folder is removed only when nothing private is left in it`,
    ),
    '  - last, the plugin from Claude Code (claude plugin uninstall)',
    ...(deleteReceipts
      ? []
      : [
          '',
          `It keeps your receipts: every signed receipt, receipt.html and session receipt bundle, with the public keys that verify them, move to ${receiptsDir}. They hold no values. To delete them too, add --delete-receipts.`,
        ]),
  ];
  // /zeroh-disclosure:uninstall passes --yes: typing that user-only command
  // is the confirmation. In a terminal (where a script could call it) it
  // still takes --yes. --dry-run only shows the plan (T-38).
  if (!args.yes || args['dry-run']) {
    print({ plan, removed: [] }, args.json, [
      ...plan,
      '',
      'Nothing was removed yet. To remove all of it, type /zeroh-disclosure:uninstall',
      `(in a terminal: ${terminalCommand(['uninstall', '--yes'])}).`,
    ]);
    return;
  }
  if (!(await authorized(plan))) return;
  const { beginRemoval } = await import('../lib/user-authority.js');
  removalLock = beginRemoval();
  // The tombstone first, so a session still running does nothing more
  // (T-38).
  markUninstalled();
  const proxy = await removeProxyEverywhere({ retire: true });
  let marketplaceAutoUpdate = false;
  let localCleanupFailed = false;
  try {
    marketplaceAutoUpdate = removeFirstRunMarketplace({
      home,
      settingsPath: resolveClaudeSettingsPath(),
    });
  } catch (error) {
    localCleanupFailed = true;
    console.error(
      `zeroh-disclosure: could not remove the marketplace auto-update entry (${error.message})`,
    );
  }
  // Only ZeroH's own statusLine entry, from every settings file it was
  // written to; a status line of the user's stays.
  let statusline = [];
  try {
    statusline = removeEverywhere({
      home,
      settingsPaths: [resolveClaudeSettingsPath()],
    });
  } catch (error) {
    localCleanupFailed = true;
    console.error(
      `zeroh-disclosure: could not remove the status line entry (${error.message})`,
    );
  }
  // The receipts leave ZEROH_HOME first (lib/receipt-keep.js). If that
  // fails they stay where they are rather than being deleted.
  let kept = { dir: null, receipts: 0, sessions: 0 };
  let keepFailed = null;
  if (!deleteReceipts) {
    try {
      kept = await keepReceipts({
        home,
        dir: receiptsDir,
        renderHtml: (dir) =>
          writeSessionReceiptHtml({ session: { dir }, previews: false }),
      });
    } catch (error) {
      keepFailed = error;
      console.error(
        `zeroh-disclosure: could not keep the receipts in ${receiptsDir} (${error.code || error.message}); they stay in ${path.join(home, 'projects')}`,
      );
    }
  }
  // 0.1 receipts in projects: copied, and a folder is deleted only when all
  // it held is now kept. With --delete-receipts nothing is copied and the
  // folders stay: uninstall never deletes them, it says how to.
  let legacyKept = { receipts: 0, folders: [] };
  if (legacyHeld.length && !deleteReceipts) {
    try {
      legacyKept = keepLegacyReceipts({ scans: legacyHeld, dir: receiptsDir });
    } catch (error) {
      localCleanupFailed = true;
      console.error(
        `zeroh-disclosure: could not copy the receipts of ZeroH Disclosure 0.1 to ${receiptsDir} (${error.code || error.message}); they stay where they are`,
      );
    }
  }
  if (localCleanupFailed || keepFailed) {
    throw new Error(
      'local cleanup could not finish; the plugin remains so uninstall can be retried',
    );
  }
  const legacyRemovable = new Set(
    legacyKept.folders
      .filter((folder) => folder.removable)
      .map((folder) => folder.dir),
  );
  const legacyLeft = legacyHeld.filter(
    (scan) => !legacyRemovable.has(scan.dir),
  );
  const removed = [];
  // --delete-receipts: a full wipe, receipts an earlier uninstall kept too
  // (only a folder that holds ZeroH's kept-receipts manifest).
  const keptBefore =
    deleteReceipts && isKeptReceiptsDir(receiptsDir) ? [receiptsDir] : [];
  for (const dir of [
    home,
    ...legacyEmpty.map((scan) => scan.dir),
    ...legacyRemovable,
    ...keptBefore,
  ]) {
    try {
      if (dir === home) {
        // Everything but the tombstone, which running sessions still read.
        for (const name of readdirSync(dir)) {
          if (name === UNINSTALL_MARKER) continue;
          if (keepFailed && name === 'projects') continue;
          rmSync(path.join(dir, name), { recursive: true, force: true });
        }
      } else {
        rmSync(dir, { recursive: true, force: true });
      }
      removed.push(dir);
    } catch (error) {
      if (dir === home) localCleanupFailed = true;
      else remainingRemovalSteps.push(`remove ${dir}`);
      console.error(
        `zeroh-disclosure: could not remove ${dir} (${error.code || 'error'})`,
      );
    }
  }
  // Last: the plugin, whose folder this command runs from.
  localCleanupDone = removed.includes(home) && !localCleanupFailed;
  if (!localCleanupDone) {
    throw new Error(
      'local cleanup could not finish; the plugin remains so uninstall can be retried',
    );
  }
  const plugin = removePlugin();
  remainingRemovalSteps = [
    ...remainingRemovalSteps,
    ...(plugin.unavailable
      ? ['run claude plugin uninstall zeroh-disclosure@zeroh']
      : plugin.failed.map((entry) => `run ${uninstallCommandFor(entry)}`)),
    ...legacyLeft.map(
      (scan) =>
        `delete ${scan.dir} with ${process.platform === 'win32' ? `Remove-Item -Recurse -Force \"${scan.dir}\"` : `rm -rf \"${scan.dir}\"`}`,
    ),
  ];
  const pluginLines = plugin.unavailable
    ? [
        "Couldn't run Claude Code's `claude` command to remove the plugin. Remove it with: claude plugin uninstall zeroh-disclosure@zeroh",
      ]
    : [
        ...(plugin.removed.length
          ? [
              `Removed the plugin from Claude Code (${plugin.removed.map(({ id, scope }) => `${id}, ${scope}`).join('; ')}).`,
            ]
          : ['The plugin was not installed in Claude Code.']),
        ...plugin.failed.map(
          (entry) =>
            `Couldn't remove ${entry.id} (${entry.scope}); remove it with: ${uninstallCommandFor(entry)}`,
        ),
      ];
  const running = Boolean(process.env.CLAUDE_CODE_SESSION_ID) || live.length;
  const reinstallId =
    plugin.removed?.[0]?.id ??
    plugin.failed?.[0]?.id ??
    'zeroh-disclosure@zeroh';
  const removeCommand = (dir) =>
    process.platform === 'win32'
      ? `Remove-Item -Recurse -Force "${dir}"`
      : `rm -rf "${dir}"`;
  const receiptLines = deleteReceipts
    ? ['Deleted your receipts too (--delete-receipts).']
    : keepFailed
      ? [
          `Couldn't move your receipts to ${receiptsDir}; they stay in ${path.join(home, 'projects')}.`,
        ]
      : kept.receipts
        ? [
            `Kept your receipts: ${kept.receipts} signed receipt(s) of ${kept.sessions} session(s), with receipt.html, the session bundles and the public keys that verify them, in ${receiptsDir}. They hold no values. To delete them, remove that folder (${removeCommand(receiptsDir)}).`,
          ]
        : legacyKept.receipts
          ? []
          : ['There were no receipts to keep.'];
  const legacyLines = [
    ...(legacyKept.receipts
      ? [
          `Kept ${legacyKept.receipts} receipt(s) and ProofPack(s) of ZeroH Disclosure 0.1 from your projects, with the public keys that verify them, in ${path.join(receiptsDir, 'legacy')}. They hold no values.`,
        ]
      : []),
    ...legacyLeft.map((scan) => {
      const copied =
        legacyKept.folders.find((folder) => folder.dir === scan.dir)
          ?.receipts ?? 0;
      return copied
        ? `Left ${scan.dir}: besides the ${copied} receipt(s) and ProofPack(s) copied above, it holds files of ZeroH Disclosure 0.1 that are not kept anywhere else (that version's private signing key, session key or typed values). ZeroH no longer needs them; to delete the folder: ${removeCommand(scan.dir)}`
        : `Left ${scan.dir}: it holds files of ZeroH Disclosure 0.1${scan.receipts ? `, ${scan.receipts} signed receipt(s) and ProofPack(s) among them,` : ''} and uninstall never deletes those. ZeroH no longer needs them; to delete the folder: ${removeCommand(scan.dir)}`;
    }),
  ];
  print(
    {
      ...proxy,
      plugin,
      removed,
      statusline,
      marketplaceAutoUpdate,
      receipts: deleteReceipts
        ? { kept: false, deleted: true }
        : {
            kept: !keepFailed && kept.receipts > 0,
            dir: kept.dir,
            count: kept.receipts,
            sessions: kept.sessions,
          },
      legacy: {
        kept: legacyKept.receipts,
        dir: legacyKept.receipts ? receiptsDir : null,
        left: legacyLeft.map((scan) => scan.dir),
      },
    },
    args.json,
    [
      ...statusline.map((file) => `Removed ZeroH's status line from ${file}.`),
      ...(marketplaceAutoUpdate === 'entry'
        ? ['Removed the marketplace auto-update entry ZeroH created.']
        : marketplaceAutoUpdate === 'autoUpdate'
          ? [
              'Removed auto-update added by ZeroH; kept your marketplace entry and source.',
            ]
          : []),
      proxy.restored.length
        ? `Took the ZeroH entry out of ${proxy.restored.length} Claude Code settings file(s).`
        : 'No Claude Code settings file had a ZeroH entry.',
      `${proxy.stopped ? 'Stopped the local proxy. ' : ''}${proxy.retired ? 'Retired the local proxy: it stops by itself once the sessions still open are idle. ' : ''}${proxy.loginItemRemoved ? 'Removed its login item.' : 'No login item was registered.'}`,
      ...removed.map((dir) =>
        dir === home
          ? `Removed ${dir}: the vault and its key, the signing and allow-list keys, your settings, allow rules, unmask grants, reports and the proxy's runtime copy. Only an empty "${UNINSTALL_MARKER}" marker stays, so sessions still open do nothing; you can delete the folder once they are closed.`
          : `Removed ${dir}`,
      ),
      ...receiptLines,
      ...legacyLines,
      ...pluginLines,
      ...(running
        ? [
            // The retired proxy masks nothing: with the vault and the hooks
            // gone, no token could be put back (rule 8).
            proxy.retired
              ? "This session keeps working until you exit, without ZeroH's masking; new sessions start without ZeroH."
              : 'This session keeps working until you exit; new sessions start without ZeroH.',
          ]
        : [
            'ZeroH Disclosure is removed. New Claude Code sessions start without it.',
          ]),
      `To install it again: claude plugin install ${reinstallId}, then restart Claude Code.`,
    ],
  );
}

// <project>/.zeroh folders earlier builds left (D-15: nothing lives in the
// project any more), for the projects ZeroH knows, and only when they hold
// nothing but ZeroH's own files: each scanned (lib/receipt-keep.js
// scanLegacyFolder), so what they hold is known before anything goes.
async function legacyProjectFolders() {
  const { scanLegacyFolder } = await import('../lib/receipt-keep.js');
  const roots = await registeredProjectRoots().catch(() => []);
  return roots
    .map((root) => scanLegacyFolder(path.join(root, '.zeroh')))
    .filter(Boolean);
}

// doctor --fix: never a receipt or a key. Only a folder with no file in its
// sessions goes; the others are reported (uninstall keeps their receipts).
async function removeLegacyProjectFolders() {
  const removed = [];
  const held = [];
  for (const scan of await legacyProjectFolders()) {
    if (scan.files > 0) {
      held.push(scan);
      continue;
    }
    try {
      rmSync(scan.dir, { recursive: true, force: true });
      removed.push(scan.dir);
    } catch {
      // Left for uninstall or the next doctor --fix.
    }
  }
  return { removed, held };
}

// Why `dir` is not a folder uninstall may delete, or null: it is (or holds)
// the user's home, a system folder or a filesystem root, or it has none of
// the files ZeroH keeps.
function notAZerohHome(dir) {
  const env = process.env;
  const guarded = [
    os.homedir(),
    env.HOME,
    env.USERPROFILE,
    env.LOCALAPPDATA,
    env.APPDATA,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    os.tmpdir(),
  ]
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const same = (a, b) =>
    process.platform === 'win32'
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
  const within = (child, parent) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  };
  if (path.dirname(dir) === dir) return 'is a filesystem root';
  if (guarded.some((entry) => same(entry, dir) || within(entry, dir))) {
    return 'is your home or a system folder (or holds one)';
  }
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    return error.code === 'ENOENT' ? null : `can't be read (${error.code})`;
  }
  const markers = [
    'vault.key',
    'vault',
    'proxy',
    'projects.json',
    'projects',
    'session-keys',
    'statusline.json',
    'first-run.json',
    'plugin-root.json',
    'uninstalled',
  ];
  if (names.length && !names.some((name) => markers.includes(name))) {
    return 'holds none of the files ZeroH Disclosure keeps';
  }
  return null;
}

function proxySettingsLine(result) {
  if (result.restored) {
    return `Removed the ZeroH proxy entry from your Claude Code settings; everything else in the file is unchanged: ${result.settingsPath}`;
  }
  if (result.reason === 'user-changed') {
    return `Claude Code's connection setting was changed by the user and was left untouched: ${result.settingsPath}`;
  }
  if (result.reason === 'invalid-json') {
    return `Claude Code settings are not valid JSON and were left untouched: ${result.settingsPath}`;
  }
  return 'The ZeroH proxy was not installed; settings were unchanged.';
}

// A function, not a module constant: the command runs before later constants
// exist.
function bannerModeWords(mode) {
  return {
    big: 'The ZEROH art block every session.',
    mini: 'One line every session (the default).',
    compact: 'One line with the secret count every session.',
    off: 'No banner; warnings still show.',
  }[mode];
}

async function cmdBanner(args) {
  // `full` (before 1.0.0) is saved as `big`.
  const mode = normalizeBannerMode(args._[1]);
  if (!mode) throw new Error('banner mode must be big, compact, mini, or off');
  if (!(await authorized())) return;
  const file = writeBannerMode(mode);
  print({ mode, file }, args.json, [
    `Banner mode: ${mode}. ${bannerModeWords(mode)}`,
    'ZEROH_BANNER overrides this setting.',
  ]);
}

// What doctor found, in plain words. A function, not a module constant: the
// command runs before later constants exist.
function doctorFinding(id) {
  return (
    {
      'settings-entry-dead':
        'Your Claude Code settings point at a ZeroH proxy that does not answer.',
      'unknown-zeroh-daemon':
        'A ZeroH proxy this install does not control is running (left by a deleted ~/.zeroh or an earlier build).',
      'files-from-an-earlier-build':
        'The proxy folder holds files from an earlier build.',
      'login-item-without-install':
        'A login item starts a proxy that no Claude Code settings file uses.',
      'proxy-check-failed': 'The proxy check itself failed.',
    }[id] || id
  );
}

// Doctor's line for an ANTHROPIC_BASE_URL set outside ZeroH: where it is
// set (lib/proxy-manager.js baseUrlOverrideSource) and that only removing it
// helps. Names the host, never the value.
function baseUrlOverriddenText({ host, file } = {}) {
  const where = file
    ? `in ${file}`
    : process.platform === 'win32'
      ? 'in the environment Claude Code started in (a Windows user or system environment variable: Settings > System > About > Advanced system settings > Environment Variables, or the terminal you started it from)'
      : 'in the environment Claude Code started in (your shell profile, or the terminal you started it from)';
  return `ANTHROPIC_BASE_URL is set ${where}${host ? ` to ${host}` : ''}, so Claude Code sends there instead of through the local proxy and what you type is not masked (files and command output still are). doctor --fix can't change this: remove it and start Claude Code again. If you use that address on purpose, leave it: typed prompts then go as typed, with a notice.`;
}

// The vault key and every project vault under ZEROH_HOME, whatever folder
// doctor runs in (RB-2): a lost key affects every project. Projects are
// named from the registry (and this folder); a vault of a project it does
// not know is named by its file.
async function doctorVaults({ fix, keepBackups, cwd }) {
  const known = [cwd, ...(await registeredProjectRoots().catch(() => []))];
  const vaultDir = path.join(path.resolve(zerohHome()), 'vault');
  const nameOf = (key) => {
    const root = known.find((candidate) => projectKey(candidate) === key);
    return root
      ? `the vault of ${root}`
      : `the vault ${path.join(vaultDir, `${key}.json`)} (a project ZeroH no longer lists)`;
  };
  const checked = checkVaults();
  const unreadable = checked.vaults.filter(
    (vault) => vault.state === 'unreadable',
  );
  const keyBroken = ['missing', 'damaged'].includes(checked.key);
  const open = [];
  const fixed = [];
  const next = [];
  if (checked.key === 'io') {
    open.push(
      `The vault key could not be read (${checked.code || 'error'}): check that ${path.join(path.resolve(zerohHome()), 'vault.key')} is readable for your account.`,
    );
  }
  if (keyBroken && !fix) {
    open.push(
      `The vault key is ${checked.key}, so none of the ${checked.vaults.length} project vault(s) can be read.`,
    );
  }
  if (!keyBroken && !fix) {
    for (const vault of unreadable) {
      open.push(`${capitalise(nameOf(vault.project))} cannot be read.`);
    }
  }
  for (const vault of checked.vaults) {
    if (vault.state === 'newer') {
      open.push(
        `${capitalise(nameOf(vault.project))} was written by a newer ZeroH Disclosure.`,
      );
    } else if (vault.state === 'io') {
      open.push(
        `${capitalise(nameOf(vault.project))} could not be read (${vault.code || 'error'}): another program may hold it, or your account can't read it. doctor --fix leaves it alone.`,
      );
    }
  }
  if (fix && (keyBroken || unreadable.length)) {
    const reset = resetVaults({ keepBackups });
    const kept = reset.backups.length
      ? ` The old files are kept at ${reset.backups.join(', ')} (readable only by you; they still hold the values, so delete them when you no longer need them).`
      : ' The old files were deleted (they held the values).';
    if (reset.key) {
      fixed.push(
        `The vault key was ${reset.key}, so no vault could be read: reset ${reset.reset.length} project vault(s) and made a new key.${kept} Tokens from earlier sessions stay tokens.`,
      );
    } else {
      for (const project of reset.reset) {
        fixed.push(
          `Reset ${nameOf(project)}: it could not be read, and a new, empty vault starts now.`,
        );
      }
      fixed.push(`${kept.trim()} Tokens from earlier sessions stay tokens.`);
    }
  }
  if (checked.vaults.some((vault) => vault.state === 'newer')) {
    next.push(
      'Update the ZeroH Disclosure plugin: a vault written by a newer version is left untouched.',
    );
  }
  if (!fix && (keyBroken || unreadable.length)) {
    next.push(
      '/zeroh-disclosure:doctor --fix resets every vault that cannot be read and starts a new one; tokens from earlier sessions then stay tokens.',
    );
  }
  return { checked, open, fixed, next };
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function cmdDoctor(args, cwd) {
  if (args.report) {
    // Paste-safe: rebuilt from the fixed schema, no values or paths.
    const reports = listProxyReports().slice(0, 3);
    print({ reports }, args.json, [
      reports.length
        ? reports.map(formatProxyReport).join('\n\n')
        : 'No local proxy reports.',
      '',
      'Nothing was sent. To ask for help, paste this into a GitHub issue at https://github.com/Blade-Labs/zeroh-marketplace/issues or an email to hello@bladelabs.io.',
    ]);
    return;
  }
  const fix = Boolean(args.fix);
  if (fix && !(await authorized())) return;
  const { baseUrlOverrideSource, diagnoseProxy } =
    await import('../lib/proxy-manager.js');
  let proxy;
  try {
    proxy = await diagnoseProxy({ fix, retire: true });
  } catch (error) {
    proxy = {
      findings: ['proxy-check-failed'],
      error: error.code || error.message,
    };
  }
  const vaults = await doctorVaults({
    fix,
    keepBackups: Boolean(args['keep-backups']),
    cwd,
  });
  // The plugin folders Claude Code runs (this one, and every one it
  // recorded for zeroh-disclosure, so a CLI running from ZEROH_HOME/bin
  // checks them too): the release it installed, or a folder an earlier build
  // left for that version, which `claude plugin update` keeps
  // (lib/plugin-integrity.js). Told, never removed here: a session's hooks
  // may run from it.
  const { checkPluginIntegrity, installedRoots, integrityLines } =
    await import('../lib/plugin-integrity.js');
  const integrity = [
    ...new Set([path.resolve(PLUGIN_ROOT), ...installedRoots()]),
  ].map((pluginRoot) => checkPluginIntegrity({ pluginRoot }));
  const stale = integrity.filter(({ state }) => state === 'stale');
  const integrityFound = stale.map((result) => integrityLines(result)[0]);
  const integrityFix = stale.map((result) => integrityLines(result)[1]);
  // Receipts are never touched here (D-15): only an empty folder an earlier
  // build left inside a project goes; one that holds 0.1 receipts or keys
  // stays, and is named.
  const legacy = fix
    ? await removeLegacyProjectFolders()
    : { removed: [], held: [] };
  const lines = [
    `ZeroH Disclosure doctor${fix ? ' --fix' : ''}`,
    `Checked: your Claude Code settings${proxy.settingsPath ? ` (${proxy.settingsPath})` : ''}, the plugin folders Claude Code runs, the local proxy and its login item, files left by earlier builds, and the vault key and every project vault in ${path.resolve(zerohHome())}.`,
  ];
  const fixedLines = fix
    ? [
        ...(proxy.restored
          ? [
              'Took the ZeroH entry out of your Claude Code settings (your own ANTHROPIC_BASE_URL, if you had one, is back).',
            ]
          : []),
        ...(proxy.stopped
          ? [`Stopped ${proxy.stopped} ZeroH proxy process(es).`]
          : []),
        ...(proxy.retired
          ? [
              'Retired the local proxy: Claude Code sessions still open keep working through it until you exit them (it masks only what it masked before), then it stops by itself.',
            ]
          : []),
        ...(proxy.loginItemRemoved ? ['Removed the login item.'] : []),
        ...(proxy.findings.includes('files-from-an-earlier-build')
          ? ['Removed files left by earlier builds.']
          : []),
        ...vaults.fixed,
        ...legacy.removed.map(
          (dir) => `Removed ${dir}, left empty by an earlier build.`,
        ),
      ]
    : [];
  const legacyHeldLines = legacy.held.map(
    (scan) =>
      `Left ${scan.dir}: it holds files of ZeroH Disclosure 0.1${scan.receipts ? ` (${scan.receipts} signed receipt(s) and ProofPack(s))` : ''}. doctor never touches receipts; /zeroh-disclosure:uninstall keeps their public part.`,
  );
  const { loginItemFix, loginItemReason } =
    await import('../lib/service-manager.js');
  const { staleMarketplaceName, staleMarketplaceText } =
    await import('../lib/first-run.js');
  const staleMarketplace = staleMarketplaceName();
  // Findings --fix can't change stay open after it.
  const unfixable = ['proxy-check-failed', 'base-url-overridden'];
  const override = proxy.findings.includes('base-url-overridden')
    ? await baseUrlOverrideSource({ cwd })
    : null;
  const open = [
    ...proxy.findings
      .filter((finding) => !fix || unfixable.includes(finding))
      .map((finding) =>
        finding === 'login-item-refused'
          ? `No login item: ${loginItemReason(proxy.loginItemRefused)}. The local proxy runs while Claude Code does (a new session starts it again, and what you type is masked), but nothing starts it after a restart. To fix: ${loginItemFix(proxy.loginItemRefused)}.`
          : finding === 'base-url-overridden'
            ? baseUrlOverriddenText(override)
            : doctorFinding(finding),
      ),
    ...integrityFound,
    ...(staleMarketplace ? [staleMarketplaceText(staleMarketplace)] : []),
    ...vaults.open,
  ];
  if (fix) {
    lines.push(
      ...(fixedLines.length
        ? ['Fixed:', ...fixedLines.map((line) => `  - ${line}`)]
        : ['Nothing to fix: the local proxy was not set up.']),
    );
  }
  if (legacyHeldLines.length) {
    lines.push('Kept:', ...legacyHeldLines.map((line) => `  - ${line}`));
  }
  if (open.length) {
    lines.push('Found:', ...open.map((finding) => `  - ${finding}`));
    if (proxy.error) lines.push(`    (${proxy.error})`);
  } else if (!fix) {
    lines.push('Nothing to fix.');
  }
  const next = [...integrityFix, ...vaults.next];
  if (
    !fix &&
    proxy.findings.some(
      (finding) =>
        !['login-item-refused', 'base-url-overridden'].includes(finding),
    )
  ) {
    next.push(
      '/zeroh-disclosure:doctor --fix resets the local proxy: it takes the ZeroH entry out of your Claude Code settings, retires this proxy (sessions still open keep working until you exit them) and stops any other ZeroH proxy it finds. The next Claude Code session sets it up again.',
    );
  }
  if (fix && fixedLines.length) {
    next.push(
      'Start Claude Code again; the next session sets the proxy up again.',
    );
  }
  if (next.length) lines.push(`Next: ${next.join(' ')}`);
  print(
    {
      ...proxy,
      findings: [
        ...proxy.findings,
        ...(stale.length ? ['plugin-folder-stale'] : []),
        ...(staleMarketplace ? ['marketplace-old-name'] : []),
        ...vaults.open,
      ],
      plugin: integrity,
      vault: vaults.checked,
      actions: fixedLines,
      ...(legacy.held.length
        ? { legacyKept: legacy.held.map((scan) => scan.dir) }
        : {}),
    },
    args.json,
    lines,
  );
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
        'force',
        'segment',
        'dry-run',
        'delete-receipts',
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

function print(obj, asJson, lines) {
  if (asJson) {
    console.log(JSON.stringify(obj, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}

function help(exit) {
  console.log(`Usage:
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
  zeroh-disclosure vault status
  zeroh-disclosure vault clear [--yes]
  zeroh-disclosure verify --receipt <turn-json>
  zeroh-disclosure verify --bundle <bundle-json>
  zeroh-disclosure receipt [--turn N] [--session ID]
  zeroh-disclosure tokens [--session ID]
  zeroh-disclosure report [--since 7d|30d|90d|all] [--project .|--all-projects] [--html path] [--json path]
  zeroh-disclosure doctor [--fix [--keep-backups]] [--report]
  zeroh-disclosure banner big|compact|mini|off
  zeroh-disclosure proxy off|on
  zeroh-disclosure uninstall [--yes] [--force]
  zeroh-disclosure catalog [--json]
  zeroh-disclosure receipts [keep forever|1y|90d|30d]
  zeroh-disclosure uncertain [pass|block]

Commands that change what ZeroH protects (allow, unmask caps, vault clear,
doctor --fix, banner, proxy, uninstall --yes, receipts keep, uncertain,
statusline on|off) run
for your own typed /zeroh-disclosure: command in Claude Code, or in your own
terminal outside Claude Code after you type the code they show.

Every command acts on the project in --cwd <dir>, else CLAUDE_PROJECT_DIR, else
the current directory.
`);
  process.exit(exit);
}
