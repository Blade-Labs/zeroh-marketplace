// SPDX-License-Identifier: AGPL-3.0-only

import { programName, shellReadings } from '../shell-scan.js';
import { words } from './explicit-writes.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERIFIED_CLI = path.join(
  path.dirname(
    path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
  ),
  'bin',
  'zeroh-disclosure.mjs',
);
export const MANAGEMENT_DENY_REASON =
  'This command changes what ZeroH Disclosure protects; that can only be changed by the user. Do not run the ZeroH CLI yourself or try another way; tell the user the exact slash command to type, for example /zeroh-disclosure:proxy off. A person can also run it in their own terminal. For presentation changes, use zeroh-disclosure style instead.';
export const STATUSLINE_DENY_REASON =
  'Turning the ZeroH Disclosure status line on or off changes Claude Code settings and is user-only. Ask the user to type /zeroh-disclosure:settings statusline on|off, or run it in their own terminal; it does not ask for a confirmation code. For presentation changes, use zeroh-disclosure style instead.';
export const USER_ONLY_CLI_DENY_REASON =
  'This ZeroH Disclosure command is user-only. Do not run it yourself or try another way; tell the user the exact slash command to type. A person can also run it in their own terminal. For presentation changes, use zeroh-disclosure style instead.';

export const ZEROH_CLI_NAMES = new Set([
  'zeroh-disclosure',
  'zeroh-disclosure.mjs',
  'zeroh-disclosure.js',
  'zeroh-disclosure.ps1',
]);
export const ZEROH_CLI_READ_ONLY = new Set([
  'catalog',
  'verify',
  'help',
  '--help',
  '-h',
  '--version',
  '-v',
]);
export const ZEROH_MANAGEMENT_SUBCOMMANDS = Object.freeze([
  'allow',
  'unmask',
  'statusline',
  'vault',
  'receipt',
  'receipts',
  'reports',
  'report',
  'tokens',
  'doctor',
  'proxy',
  'uninstall',
  'settings',
  'authorize',
]);
export const MANAGEMENT = new Set(ZEROH_MANAGEMENT_SUBCOMMANDS);
export const MODEL_PRESENTATION_SUBCOMMANDS = new Set(['banner', 'style']);
// Runners that start a script or package named by a later word.
export const CLI_RUNNERS = new Set([
  'node',
  'nodejs',
  'bun',
  'deno',
  'npx',
  'pnpx',
  'bunx',
  'pnpm',
  'npm',
  'yarn',
  'tsx',
  'ts-node',
]);
export const RUNNER_WORDS = new Set(['exec', 'dlx', 'x', 'run', 'run-script']);
// Programs whose arguments are text: a CLI name among them is data.
export const TEXT_PROGRAMS = new Set([
  'echo',
  'printf',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'git',
  'gh',
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'man',
  'which',
  'whereis',
  'type',
  'ls',
  'find',
  'sed',
  'awk',
  'jq',
  'wc',
  'diff',
  'cd',
  'write-output',
  'write-host',
  'select-string',
  'sls',
  'get-command',
  'gcm',
  'get-help',
  'get-content',
  'gc',
  'test-path',
  'get-childitem',
  'gci',
  'dir',
]);
// Kept for callers of the pre-rc.2 name.
export const CLI_LAUNCHERS = Object.freeze([...CLI_RUNNERS]);

export function cliWord(word) {
  if (!word) return false;
  if (word.dynamic) return /zeroh-disclosure/iu.test(word.raw || word.value);
  return (
    ZEROH_CLI_NAMES.has(programName(word.value)) ||
    ZEROH_CLI_NAMES.has(
      String(word.value)
        .replace(/^.*[\\/]/u, '')
        .toLowerCase(),
    )
  );
}

export function subcommandAfter(list, index) {
  for (let k = index + 1; k < list.length; k += 1) {
    const value = list[k].value;
    if (value.startsWith('-') && !ZEROH_CLI_READ_ONLY.has(value)) {
      if (value === '--cwd') k += 1;
      continue;
    }
    return value.toLowerCase();
  }
  return undefined;
}

function cliKind(subcommand, args) {
  if (!subcommand || ZEROH_CLI_READ_ONLY.has(subcommand)) return null;
  if (MODEL_PRESENTATION_SUBCOMMANDS.has(subcommand)) return null;
  const flags = new Set(args.filter((arg) => arg.startsWith('-')));
  const words = args.filter((arg) => !arg.startsWith('-'));
  if (subcommand === 'statusline') {
    return words[0] === 'on' || words[0] === 'off' ? 'statusline' : 'user-only';
  }
  if (
    (subcommand === 'proxy' && ['on', 'off'].includes(words[0])) ||
    (subcommand === 'doctor' && flags.has('--fix')) ||
    (subcommand === 'uninstall' &&
      flags.has('--yes') &&
      !flags.has('--dry-run')) ||
    (subcommand === 'allow' && !flags.has('--list')) ||
    (subcommand === 'unmask' && words[0] === 'caps' && !flags.has('--list')) ||
    (subcommand === 'vault' && words[0] === 'clear') ||
    (subcommand === 'receipts' && words[0] === 'keep') ||
    (subcommand === 'uncertain' && words.length > 0) ||
    (subcommand === 'reports' && words[0] === 'delete')
  ) {
    return 'protection';
  }
  return 'user-only';
}

function subcommandAndArgs(list, index) {
  for (let k = index + 1; k < list.length; k += 1) {
    const value = list[k].value;
    if (value.startsWith('-') && !ZEROH_CLI_READ_ONLY.has(value)) {
      if (value === '--cwd') k += 1;
      continue;
    }
    return {
      subcommand: value.toLowerCase(),
      args: list.slice(k + 1).map((word) => word.value.toLowerCase()),
    };
  }
  return { subcommand: undefined, args: [] };
}

export function entryManagementKind(entry) {
  const all = words(entry);
  if (!all.length) return null;
  let start = 0;
  // `node x/bin/zeroh-disclosure.mjs`, `npx -y zeroh-disclosure`, `pnpm exec …`
  if (CLI_RUNNERS.has(entry.program ?? '')) {
    start = 1;
    while (
      start < all.length &&
      (all[start].value.startsWith('-') || RUNNER_WORDS.has(all[start].value))
    )
      start += 1;
  }
  if (
    cliWord(all[start]) &&
    (entry.dynamicProgram || start === 0
      ? true
      : CLI_RUNNERS.has(entry.program ?? ''))
  ) {
    const { subcommand, args } = subcommandAndArgs(all, start);
    return cliKind(subcommand, args);
  }
  if (TEXT_PROGRAMS.has(entry.program ?? '') || entry.lookupOnly) return null;
  // An unknown wrapper: the CLI name anywhere, then a known management word.
  for (let k = 0; k < all.length; k += 1) {
    if (!cliWord(all[k])) continue;
    const { subcommand, args } = subcommandAndArgs(all, k);
    if (subcommand !== undefined && MANAGEMENT.has(subcommand))
      return cliKind(subcommand, args);
  }
  return null;
}

export function entryRunsManagement(entry) {
  return entryManagementKind(entry) !== null;
}

function exactNodeRunner(value, shell) {
  const runner = String(value ?? '');
  if (/[\\/]/u.test(runner)) return false;
  if (shell === 'powershell') {
    return (
      runner.toLowerCase() === 'node' || runner.toLowerCase() === 'node.exe'
    );
  }
  return runner === 'node';
}

export function entryRunsPresentation(
  entry,
  shell = 'bash',
  cwd = process.cwd(),
  canonicalStyleKey = () => null,
  bannerModes = [],
) {
  if (
    entry.program !== 'node' ||
    entry.dynamicProgram ||
    entry.inline ||
    entry.dynamicCode ||
    entry.launchers?.length ||
    entry.assignments?.length ||
    entry.redirects?.length ||
    entry.piped ||
    entry.background
  ) {
    return false;
  }
  const all = words(entry);
  if (all.some((word) => word.dynamic || word.brace || word.subs?.length))
    return false;
  const [runner, script, subcommand, key, value, ...extra] = all;
  if (
    !exactNodeRunner(runner?.value, shell) ||
    !script?.value ||
    path.resolve(cwd, script.value) !== path.resolve(VERIFIED_CLI) ||
    subcommand?.value !== 'style' ||
    extra.length
  ) {
    return false;
  }
  if (key?.value === 'show') return value === undefined;
  if (key?.value === 'banner') {
    return bannerModes.includes(value?.value);
  }
  return canonicalStyleKey(key?.value) !== null && value !== undefined;
}

export const UNREADABLE_CLI_RE =
  /(?:^|[\s;&|`(])(?:[^\s;&|`()'"]*[\\/])?zeroh-disclosure(?:\.mjs|\.js|\.cmd|\.ps1|\.exe)?\s+(?:-\S+\s+)*(\w+)/iu;

export function commandZeroHManagementKind(command, shell = 'bash') {
  const text = String(command);
  if (!/zeroh-disclosure/iu.test(text)) return null;
  const readings = shellReadings(text, shell).filter((reading) => reading.ok);
  if (!readings.length) {
    // Unreadable: the plain spelling at a command start still counts.
    const plain = UNREADABLE_CLI_RE.exec(text);
    const sub = plain?.[1]?.toLowerCase();
    if (!sub || !MANAGEMENT.has(sub)) return null;
    return sub === 'statusline' ? 'statusline' : 'user-only';
  }
  const kinds = readings.flatMap((reading) =>
    reading.commands.map(entryManagementKind).filter(Boolean),
  );
  if (kinds.includes('protection')) return 'protection';
  if (kinds.includes('statusline')) return 'statusline';
  if (kinds.includes('user-only')) return 'user-only';
  return null;
}

export function commandRunsZeroHManagement(command, shell = 'bash') {
  return commandZeroHManagementKind(command, shell) !== null;
}

export function commandRunsZeroHPresentation(
  command,
  shell = 'bash',
  cwd = process.cwd(),
  canonicalStyleKey = () => null,
  bannerModes = [],
) {
  const text = String(command);
  if (!/zeroh-disclosure/iu.test(text)) return false;
  const readings = shellReadings(text, shell).filter((reading) => reading.ok);
  return (
    readings.length > 0 &&
    readings.every(
      (reading) =>
        reading.commands.length === 1 &&
        entryRunsPresentation(
          reading.commands[0],
          shell,
          cwd,
          canonicalStyleKey,
          bannerModes,
        ),
    )
  );
}

export function managementDenyReason(command, shell = 'bash') {
  const kind = commandZeroHManagementKind(command, shell);
  if (kind === 'statusline') return STATUSLINE_DENY_REASON;
  if (kind === 'protection') return MANAGEMENT_DENY_REASON;
  return USER_ONLY_CLI_DENY_REASON;
}
