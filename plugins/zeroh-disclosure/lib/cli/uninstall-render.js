// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';

import { PUBLIC_PLUGIN_ID } from '../../packages/zeroh-disclosure-core/product.js';
import { print } from './shared.js';

export function renderUninstall(args, home, context, result) {
  const {
    deleteReceipts,
    receiptsDir,
    live,
    uninstallCommandFor,
    UNINSTALL_MARKER,
  } = context;
  const {
    proxy,
    plugin,
    legacyLeft,
    keepFailed,
    kept,
    legacyKept,
    removed,
    statusline,
    marketplaceAutoUpdate,
  } = result;
  const pluginLines = plugin.unavailable
    ? [
        `Couldn't run Claude Code's \`claude\` command to remove the plugin. Remove it with: claude plugin uninstall ${PUBLIC_PLUGIN_ID}`,
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
    plugin.removed?.[0]?.id ?? plugin.failed?.[0]?.id ?? PUBLIC_PLUGIN_ID;
  const { receiptLines, legacyLines } = uninstallReceiptLines({
    home,
    deleteReceipts,
    receiptsDir,
    keepFailed,
    kept,
    legacyKept,
    legacyLeft,
  });
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
              'Removed auto-update added by ZeroH; kept the marketplace entry and its source.',
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

function uninstallReceiptLines({
  home,
  deleteReceipts,
  receiptsDir,
  keepFailed,
  kept,
  legacyKept,
  legacyLeft,
}) {
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
  return { receiptLines, legacyLines };
}
