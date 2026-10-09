// SPDX-License-Identifier: AGPL-3.0-only

import {
  wrapBashExitStatus,
  wrapPowerShellExitStatus,
} from '../../../packages/shell-analysis/exit-status.js';

export function wrapToolExitStatus(input, original, { toolName, shell }) {
  if (input?.run_in_background === true || typeof input?.command !== 'string') {
    return input;
  }
  // Monitor streams its output instead of finishing with a status.
  if (toolName === 'Monitor') return input;
  if (shell === 'bash') {
    return {
      ...input,
      command: wrapBashExitStatus(input.command, {
        original: original.command,
      }),
    };
  }
  if (shell === 'powershell') {
    return { ...input, command: wrapPowerShellExitStatus(input.command) };
  }
  return input;
}
