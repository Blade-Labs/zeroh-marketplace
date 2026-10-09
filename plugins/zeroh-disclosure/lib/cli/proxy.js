// SPDX-License-Identifier: AGPL-3.0-only

import { authorized, print } from './shared.js';

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

export async function cmdProxy(args) {
  const action = args._[1];
  if (action !== 'on' && action !== 'off')
    throw new Error('proxy requires "off" or "on"');
  if (!(await authorized())) return;
  if (action === 'on') {
    const { proxyOn } =
      await import('../../packages/local-proxy/proxy-manager.js');
    const result = proxyOn();
    print(result, args.json, [
      result.wasOff
        ? 'The local masking proxy is on again: your next Claude Code session sets it up.'
        : 'The local masking proxy was not turned off; nothing changed.',
    ]);
    return;
  }
  const { stopDefaultProxy } =
    await import('../../packages/local-proxy/proxy-manager.js');
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
// (packages/zeroh-disclosure-core/receipt-keep.js), unless --delete-receipts. It asks first unless
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
