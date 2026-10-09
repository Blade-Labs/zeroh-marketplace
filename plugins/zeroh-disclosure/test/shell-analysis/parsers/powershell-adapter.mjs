// SPDX-License-Identifier: AGPL-3.0-only

// SPDX-License-Identifier: MIT
import { spawnFileSync } from './process-files.mjs';
import { fileURLToPath } from 'node:url';

export function parsePowerShellCommands(
  commands,
  { executable = 'pwsh', env = process.env, timeout = 8000 } = {},
) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive'];
  if (/powershell(?:\.exe)?$/i.test(executable))
    args.push('-ExecutionPolicy', 'Bypass');
  args.push('-File', fileURLToPath(new URL('./parse.ps1', import.meta.url)));
  const result = spawnFileSync(executable, args, {
    env,
    encoding: 'utf8',
    input: JSON.stringify({ commands }),
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error('PowerShell parser process failed');
  return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
}

export function parsePowerShell(command, options) {
  return parsePowerShellCommands([command], options).results[0];
}
