// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

import { legacyProjectFolders } from './legacy-projects.js';

export async function prepareUninstall(args, home) {
  const [
    { liveMaskingRoots, proxyPaths },
    { isKeptReceiptsDir, keepLegacyReceipts, keepReceipts, keptReceiptsDir },
    { removePlugin, uninstallCommandFor },
    { UNINSTALL_MARKER },
    { removeProxyEverywhere },
    { resolveClaudeSettingsPath },
    { removeEverywhere },
    { removeFirstRunMarketplace },
    { writeSessionReceiptHtml },
  ] = await Promise.all([
    import('../../packages/local-proxy/proxy-state.js'),
    import('../../packages/zeroh-disclosure-core/receipt-keep.js'),
    import('../../packages/zeroh-disclosure-core/plugin-removal.js'),
    import('../../packages/zeroh-disclosure-core/uninstall-marker.js'),
    import('../../packages/local-proxy/proxy-manager.js'),
    import('../claude-settings.js'),
    import('../statusline-settings.js'),
    import('../first-run.js'),
    import('../../packages/zeroh-disclosure-core/report.js'),
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
  return {
    isKeptReceiptsDir,
    keepLegacyReceipts,
    keepReceipts,
    removePlugin,
    uninstallCommandFor,
    UNINSTALL_MARKER,
    removeProxyEverywhere,
    resolveClaudeSettingsPath,
    removeEverywhere,
    removeFirstRunMarketplace,
    writeSessionReceiptHtml,
    live,
    legacyEmpty,
    legacyHeld,
    deleteReceipts,
    receiptsDir,
    plan,
  };
}
