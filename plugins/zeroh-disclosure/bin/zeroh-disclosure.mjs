#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The zeroh-disclosure command line: allow rules, unmask grants, receipts and
// reports, the vault, the proxy, and doctor. Run it from your own terminal.
import { readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.js';
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
  formatStatusline,
  isPersonalDataType,
  isSecretType,
  normaliseKind,
  PERSONAL_DATA_TYPES,
  readGrantStore,
  revokeGrants,
  writeCap,
} from '../lib/unmask.js';
import { writeBannerMode } from '../lib/banner.js';
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

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
// --cwd wins; otherwise the project root the hooks use (projectRootFromEnv:
// CLAUDE_PROJECT_DIR, else the project this directory belongs to).
const cwd = path.resolve(args.cwd || projectRootFromEnv(process.cwd()));
await loadConfig({ cwd });

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
  else help(command ? 1 : 0);
} catch (e) {
  console.error(`zeroh-disclosure: ${e.message}`);
  if (process.env.DEBUG && e.stack) console.error(e.stack);
  process.exit(1);
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
  if (args.list || (!remove && args._.length === 1)) {
    if (loaded.ignored) console.error(ALLOW_FILE_NOTICE);
    const summary = destinationSummary(loadKnownSecrets(cwd), loaded.rules);
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
  const rules = updateAllowRule(loaded.rules, name, host, { remove });
  writeAllowRules(cwd, rules);
  const action = remove ? 'removed' : 'allowed';
  print({ action, name, host, rules }, args.json, [
    `${action}: ${name} → ${host}`,
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

async function cmdStatusline(args, cwd) {
  let stdinSessionId = null;
  if (!process.stdin.isTTY) {
    try {
      stdinSessionId = JSON.parse(await readStdin()).session_id ?? null;
    } catch {
      stdinSessionId = null;
    }
  }
  const grants = activeGrants(cwd, {
    sessionId: args.session || envSessionId() || stdinSessionId,
  });
  const status = formatStatusline(grants);
  if (args.json) print({ status, grants }, true, []);
  else if (status) console.log(status);
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
    // Run from a slash command there is no terminal to ask in (T-37): an
    // answer piped in still counts; none asks for --yes.
    if (!args.yes && !process.stdin.isTTY) {
      const answer = (await readStdin()).trim().toLowerCase();
      if (!answer) {
        throw new Error(
          'vault clear removes every stored value of this project: add --yes to confirm (/zeroh-disclosure:settings vault clear --yes)',
        );
      }
      if (answer !== 'yes') {
        console.log('Vault clear cancelled.');
        return;
      }
    } else if (!args.yes && !(await confirmVaultClear(cwd))) {
      console.log('Vault clear cancelled.');
      return;
    }
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

async function confirmVaultClear(root) {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await readline.question(
      `Clear every stored value for ${root}? Type "yes" to continue: `,
    );
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    readline.close();
  }
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
    `revealed_under_grant: ${formatRevealCounts(result.revealed_under_grant)}`,
    '',
    ...checkLines(result.checks),
  ]);
  if (!result.ok) process.exit(1);
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
    (c) => `${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`,
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
  if (action !== 'off') throw new Error('proxy requires "off" or "on"');
  const { stopDefaultProxy } = await import('../lib/proxy-manager.js');
  const result = await stopDefaultProxy({ remember: true });
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
          result.stopped
            ? 'Stopped the local masking proxy.'
            : 'The local masking proxy was already stopped.',
        ]),
  ]);
}

// Removes everything ZeroH Disclosure keeps on this machine (LV-F8, LP-F6):
// the proxy entry in every Claude Code settings file it wrote to, the proxy
// and its login item, every <project>/.zeroh it knows about, and ZEROH_HOME
// (vault, keys, receipts' commitment keys, reports). Run it before removing
// the plugin; it asks first unless --yes.
//
// A Claude Code session that still runs with the plugin would set ZeroH up
// again at its next prompt, so uninstall refuses while one is live (--force
// when none really is: a session that crashed never said it ended). It never
// deletes a folder that does not look like a ZeroH home (a mistaken
// ZEROH_HOME=%LOCALAPPDATA% must not wipe it).
async function cmdUninstall(args) {
  const home = path.resolve(zerohHome());
  const unsafe = notAZerohHome(home);
  if (unsafe) {
    throw new Error(
      `${home} ${unsafe}, so uninstall leaves it alone. Check ZEROH_HOME; nothing was removed.`,
    );
  }
  const { liveMaskingRoots, proxyPaths } =
    await import('../lib/proxy-state.js');
  const live = [...liveMaskingRoots(proxyPaths())];
  const projects = (await legacyProjectFolders()).filter(
    (dir) => path.resolve(dir) !== home,
  );
  const plan = [
    'This removes ZeroH Disclosure from this machine, in this order:',
    '  - the plugin from Claude Code (claude plugin uninstall), so no new session sets ZeroH up again',
    "  - the local proxy's entry in your Claude Code settings (your own setting goes back), the proxy and its login item",
    `  - ${home} (vault, keys, receipts and reports)`,
    ...projects.map((dir) => `  - ${dir} (left by an earlier test build)`),
  ];
  // From a slash command there is no terminal to ask in (T-38): show what
  // it removes and how to confirm.
  if (!args.yes && !process.stdin.isTTY) {
    print({ plan, removed: [] }, args.json, [
      ...plan,
      '',
      'Nothing was removed yet. To remove all of it, run /zeroh-disclosure:uninstall --yes',
      `(in a terminal: ${terminalCommand(['uninstall', '--yes'])}).`,
    ]);
    return;
  }
  if (
    !args.yes &&
    !(await confirm(`${plan.join('\n')}\nType "yes" to continue: `))
  ) {
    console.log('Uninstall cancelled; nothing was removed.');
    return;
  }
  // The plugin first, so no new session sets ZeroH up again; then the
  // tombstone, so a session still running does nothing more (T-38).
  const { removePlugin, uninstallCommandFor } =
    await import('../lib/plugin-removal.js');
  const plugin = removePlugin();
  const { markUninstalled } = await import('../lib/uninstall-marker.js');
  try {
    markUninstalled();
  } catch {
    // A temporary folder that can't be written: sessions still running may
    // set ZeroH up again until they exit (said below).
  }
  const { removeProxyEverywhere } = await import('../lib/proxy-manager.js');
  const proxy = await removeProxyEverywhere();
  const removed = [];
  for (const dir of [home, ...projects]) {
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch (error) {
      console.error(
        `zeroh-disclosure: could not remove ${dir} (${error.code || 'error'})`,
      );
    }
  }
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
  print({ ...proxy, plugin, removed }, args.json, [
    ...pluginLines,
    proxy.restored.length
      ? `Took the ZeroH entry out of ${proxy.restored.length} Claude Code settings file(s).`
      : 'No Claude Code settings file had a ZeroH entry.',
    `${proxy.stopped ? 'Stopped the local proxy. ' : ''}${proxy.loginItemRemoved ? 'Removed its login item.' : 'No login item was registered.'}`,
    ...removed.map((dir) => `Removed ${dir}`),
    ...(running
      ? [
          'Claude Code sessions that are still open keep running until you exit them. ZeroH no longer acts in them and sets nothing up again, so nothing protects them any more: exit them now. New sessions start without ZeroH.',
        ]
      : [
          'ZeroH Disclosure is removed. New Claude Code sessions start without it.',
        ]),
  ]);
}

// <project>/.zeroh folders left by earlier test builds (D-15: nothing lives in
// the project any more), for the projects ZeroH knows, and only when they
// hold nothing but ZeroH's own files.
async function legacyProjectFolders() {
  // Declared here: the commands run while this module is still loading.
  const ours = new Set(['sessions', 'allow.json', '.gitignore']);
  const roots = await registeredProjectRoots().catch(() => []);
  return roots
    .map((root) => path.join(root, '.zeroh'))
    .filter((dir) => {
      try {
        const names = readdirSync(dir);
        return (
          statSync(dir).isDirectory() &&
          names.length > 0 &&
          names.every((name) => ours.has(name))
        );
      } catch {
        return false;
      }
    });
}

async function removeLegacyProjectFolders() {
  const removed = [];
  for (const dir of await legacyProjectFolders()) {
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Left for uninstall or the next doctor --fix.
    }
  }
  return removed;
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
  ];
  if (names.length && !names.some((name) => markers.includes(name))) {
    return 'holds none of the files ZeroH Disclosure keeps';
  }
  return null;
}

async function confirm(question) {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await readline.question(question)).trim().toLowerCase() === 'yes';
  } finally {
    readline.close();
  }
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

async function cmdBanner(args) {
  const mode = args._[1];
  const file = writeBannerMode(mode);
  print({ mode, file }, args.json, [
    `Banner mode: ${mode}.`,
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
  const { diagnoseProxy } = await import('../lib/proxy-manager.js');
  let proxy;
  try {
    proxy = await diagnoseProxy({ fix });
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
  // Receipts are never touched here (D-15); only folders earlier test
  // builds left inside projects go.
  const legacy = fix ? await removeLegacyProjectFolders() : [];
  const lines = [
    `ZeroH Disclosure doctor${fix ? ' --fix' : ''}`,
    `Checked: your Claude Code settings${proxy.settingsPath ? ` (${proxy.settingsPath})` : ''}, the local proxy and its login item, files left by earlier builds, and the vault key and every project vault in ${path.resolve(zerohHome())}.`,
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
        ...(proxy.loginItemRemoved ? ['Removed the login item.'] : []),
        ...(proxy.findings.includes('files-from-an-earlier-build')
          ? ['Removed files left by earlier builds.']
          : []),
        ...vaults.fixed,
        ...legacy.map(
          (dir) => `Removed ${dir}, left by an earlier test build.`,
        ),
      ]
    : [];
  const open = [
    ...proxy.findings
      .filter((finding) => !fix || finding === 'proxy-check-failed')
      .map(doctorFinding),
    ...vaults.open,
  ];
  if (fix) {
    lines.push(
      ...(fixedLines.length
        ? ['Fixed:', ...fixedLines.map((line) => `  - ${line}`)]
        : ['Nothing to fix: the local proxy was not set up.']),
    );
  }
  if (open.length) {
    lines.push('Found:', ...open.map((finding) => `  - ${finding}`));
    if (proxy.error) lines.push(`    (${proxy.error})`);
  } else if (!fix) {
    lines.push('Nothing to fix.');
  }
  const next = [...vaults.next];
  if (!fix && proxy.findings.length) {
    next.push(
      '/zeroh-disclosure:doctor --fix resets the local proxy: it takes the ZeroH entry out of your Claude Code settings and stops every ZeroH proxy it finds. The next Claude Code session sets it up again.',
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
      findings: [...proxy.findings, ...vaults.open],
      vault: vaults.checked,
      actions: fixedLines,
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
    if (['list', 'fix', 'report', 'keep-backups', 'force'].includes(key)) {
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

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw.trim();
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
  zeroh-disclosure statusline
  zeroh-disclosure vault status
  zeroh-disclosure vault clear [--yes]
  zeroh-disclosure verify --receipt <turn-json>
  zeroh-disclosure verify --bundle <bundle-json>
  zeroh-disclosure receipt [--turn N] [--session ID]
  zeroh-disclosure tokens [--session ID]
  zeroh-disclosure report [--since 7d|30d|90d|all] [--project .|--all-projects] [--html path] [--json path]
  zeroh-disclosure doctor [--fix [--keep-backups]] [--report]
  zeroh-disclosure banner full|compact|off
  zeroh-disclosure proxy off|on
  zeroh-disclosure uninstall [--yes] [--force]
  zeroh-disclosure catalog [--json]
  zeroh-disclosure receipts [keep forever|1y|90d|30d]

Every command acts on the project in --cwd <dir>, else CLAUDE_PROJECT_DIR, else
the current directory.
`);
  process.exit(exit);
}
