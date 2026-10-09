// SPDX-License-Identifier: AGPL-3.0-only

import { uninstallFailureNotice } from '../../packages/zeroh-disclosure-core/uninstall-handoff.js';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { PUBLIC_PLUGIN_ID } from '../../packages/zeroh-disclosure-core/product.js';
import { removalState } from './removal-state.js';

export async function executeUninstall(home, context) {
  const {
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
    legacyEmpty,
    legacyHeld,
    deleteReceipts,
    receiptsDir,
  } = context;
  const { beginRemoval, commitRemoval, markRemovalCleanupStarted } =
    await import('../../packages/zeroh-disclosure-core/user-authority.js');
  removalState.lock = beginRemoval();
  // beginRemoval keeps an owned pending tombstone throughout cleanup, so a
  // running session stands down while a dead child can still be detected.
  if (!markRemovalCleanupStarted()) {
    throw new Error('removal ownership was lost before local cleanup');
  }
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
  const { kept, keepFailed, legacyKept, legacyKeepFailed } =
    await keepUninstallReceipts({
      home,
      receiptsDir,
      deleteReceipts,
      legacyHeld,
      keepReceipts,
      keepLegacyReceipts,
      writeSessionReceiptHtml,
    });
  if (legacyKeepFailed) localCleanupFailed = true;
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
  // --delete-receipts: a full wipe, receipts an earlier uninstall kept too
  // (only a folder that holds ZeroH's kept-receipts manifest).
  const keptBefore =
    deleteReceipts && isKeptReceiptsDir(receiptsDir) ? [receiptsDir] : [];
  const { removed, failed } = removeDirectories({
    dirs: [
      home,
      ...legacyEmpty.map((scan) => scan.dir),
      ...legacyRemovable,
      ...keptBefore,
    ],
    home,
    marker: UNINSTALL_MARKER,
    keepFailed,
  });
  if (failed) localCleanupFailed = true;
  // Last: the plugin, whose folder this command runs from.
  removalState.localCleanupDone = removed.includes(home) && !localCleanupFailed;
  if (!removalState.localCleanupDone) {
    throw new Error(
      'local cleanup could not finish; the plugin remains so uninstall can be retried',
    );
  }
  // Local protection state is gone now. Commit only here: a child that dies
  // earlier leaves an owned pending marker, which hooks retire and report.
  commitOwnedRemoval(commitRemoval);
  const plugin = removePlugin();
  removalState.remainingSteps = [
    ...removalState.remainingSteps,
    ...(plugin.unavailable
      ? [`run claude plugin uninstall ${PUBLIC_PLUGIN_ID}`]
      : plugin.failed.map((entry) => `run ${uninstallCommandFor(entry)}`)),
    ...legacyLeft.map(
      (scan) =>
        `delete ${scan.dir} with ${process.platform === 'win32' ? `Remove-Item -Recurse -Force \"${scan.dir}\"` : `rm -rf \"${scan.dir}\"`}`,
    ),
  ];
  return {
    proxy,
    plugin,
    legacyLeft,
    keepFailed,
    kept,
    legacyKept,
    removed,
    statusline,
    marketplaceAutoUpdate,
  };
}

export function commitOwnedRemoval(commitRemoval) {
  if (!commitRemoval())
    throw new Error(uninstallFailureNotice({ ['cleanup_started_at']: true }));
}

function removeDirectories({ dirs, home, marker, keepFailed }) {
  const removed = [];
  let failed = false;
  for (const dir of dirs) {
    try {
      if (dir === home) {
        // Everything but the tombstone, which running sessions still read.
        for (const name of readdirSync(dir)) {
          if (name === marker) continue;
          if (keepFailed && name === 'projects') continue;
          rmSync(path.join(dir, name), { recursive: true, force: true });
        }
      } else {
        rmSync(dir, { recursive: true, force: true });
      }
      removed.push(dir);
    } catch (error) {
      if (dir === home) failed = true;
      else removalState.remainingSteps.push(`remove ${dir}`);
      console.error(
        `zeroh-disclosure: could not remove ${dir} (${error.code || 'error'})`,
      );
    }
  }
  return { removed, failed };
}

async function keepUninstallReceipts({
  home,
  receiptsDir,
  deleteReceipts,
  legacyHeld,
  keepReceipts,
  keepLegacyReceipts,
  writeSessionReceiptHtml,
}) {
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
  let legacyKept = { receipts: 0, folders: [] };
  let legacyKeepFailed = false;
  if (legacyHeld.length && !deleteReceipts) {
    try {
      legacyKept = keepLegacyReceipts({ scans: legacyHeld, dir: receiptsDir });
    } catch (error) {
      legacyKeepFailed = true;
      console.error(
        `zeroh-disclosure: could not copy the receipts of ZeroH Disclosure 0.1 to ${receiptsDir} (${error.code || error.message}); they stay where they are`,
      );
    }
  }
  return { kept, keepFailed, legacyKept, legacyKeepFailed };
}
