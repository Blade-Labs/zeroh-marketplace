// SPDX-License-Identifier: AGPL-3.0-only

// How a message tells the user to fix something (T-37). Users install the
// plugin from the marketplace and never get a `zeroh-disclosure` command on
// their PATH, so a fix names the slash command first and, for when Claude
// Code can't start, the exact terminal command with this copy's absolute
// path. The proxy daemon runs from its own copy under ZEROH_HOME, which
// carries the CLI too, so its messages name a path that survives the
// plugin's removal. Node built-ins only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function cliPath(root = ROOT) {
  return path.join(root, 'bin', 'zeroh-disclosure.mjs');
}

// One argument quoted for the platform's usual shell: double quotes (single
// quotes on macOS and Linux when the text holds $, `, " or \\), bare when
// nothing needs quoting and `always` is not set.
export function quoteArg(value, platform = process.platform, always = false) {
  const text = String(value);
  if (!always && /^[A-Za-z0-9_/.:,+@%=-]+$/u.test(text)) return text;
  if (platform === 'win32') return `"${text.replace(/"/gu, '""')}"`;
  if (/[$`"\\]/u.test(text)) return `'${text.replace(/'/gu, `'\\''`)}'`;
  return `"${text}"`;
}

// The copy-pasteable terminal command: node "<abs>/bin/zeroh-disclosure.mjs" <args>.
export function terminalCommand(
  args,
  { platform = process.platform, root = ROOT } = {},
) {
  const pathImpl = platform === 'win32' ? path.win32 : path.posix;
  const cli = pathImpl.join(root, 'bin', 'zeroh-disclosure.mjs');
  return [
    'node',
    quoteArg(cli, platform, true),
    ...args.map((arg) => quoteArg(arg, platform)),
  ].join(' ');
}

// "`/zeroh-disclosure:doctor --fix` (if Claude Code can't start, in a
// terminal: node '<abs>/bin/zeroh-disclosure.mjs' doctor --fix)".
export function fixHint(slash, args, options = {}) {
  return `\`${slash}\` (if Claude Code can't start, in a terminal: \`${terminalCommand(args, options)}\`)`;
}

export const DOCTOR_FIX = () =>
  fixHint('/zeroh-disclosure:doctor --fix', ['doctor', '--fix']);
export const DOCTOR = () => fixHint('/zeroh-disclosure:doctor', ['doctor']);
export const PROXY_OFF = () =>
  fixHint('/zeroh-disclosure:proxy off', ['proxy', 'off']);
export const PROXY_ON = () =>
  fixHint('/zeroh-disclosure:proxy on', ['proxy', 'on']);
