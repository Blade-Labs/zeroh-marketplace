// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writePrivateFile } from '../../packages/zeroh-disclosure-core/private-fs.js';
import { zerohHome } from '../../packages/zeroh-disclosure-core/vault.js';
import { authorized, print } from './shared.js';

export async function cmdUncertain(args) {
  const { uncertainMode } =
    await import('../../packages/zeroh-disclosure-core/config.js');
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
