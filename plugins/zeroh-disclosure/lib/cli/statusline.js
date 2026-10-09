// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync } from 'node:fs';
import { zerohHome } from '../../packages/zeroh-disclosure-core/vault.js';
import { authorized, PLUGIN_ROOT, print } from './shared.js';

export async function cmdStatusline(args, cwd) {
  const action = args._[1];
  if (action === 'on' || action === 'off') {
    await cmdStatuslineSetting(args, action);
    return;
  }
  if (action === 'segment-command') {
    // Read-only: the command that prints ZeroH's part, for a status line
    // script of the user's own (docs/statusline.md).
    const { segmentCommand } = await import('../statusline-settings.js');
    const command = segmentCommand(zerohHome());
    print({ command }, args.json, [command]);
    return;
  }
  if (action === 'style') {
    const { readStyle, styleFilePath } = await import('../statusline.js');
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
  const { statuslineMain } = await import('../statusline.js');
  const argv = [];
  if (args.segment || action === 'segment') argv.push('segment');
  if (args.json) argv.push('--json');
  if (typeof args.session === 'string') argv.push('--session', args.session);
  if (args.cwd) argv.push('--cwd', cwd);
  await statuslineMain(argv);
}

async function cmdStatuslineSetting(args, action) {
  const { resolveClaudeSettingsPath } = await import('../claude-settings.js');
  const settingsPath = resolveClaudeSettingsPath();
  if (!(await authorized())) return;
  const { turnStatuslineOff, turnStatuslineOn } =
    await import('../statusline-settings.js');
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
  }[result];
  // The command stays out of the reply; --json callers get it.
  print(
    { statusline: result, settings: settingsPath, command },
    args.json,
    lines,
  );
}
