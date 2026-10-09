// SPDX-License-Identifier: AGPL-3.0-only

// The one answer to "does this tool run a shell command, and which shell?"
// Monitor runs its command like Bash, so every guard treats it like Bash
// (the drift between separate lists caused N2). No imports.
const SHELLS = Object.freeze({
  Bash: 'bash',
  Monitor: 'bash',
  PowerShell: 'powershell',
});

export const SHELL_TOOLS = new Set(Object.keys(SHELLS));

// 'bash', 'powershell', or null for a tool that runs no shell command.
export function shellOf(toolName) {
  return Object.hasOwn(SHELLS, toolName) ? SHELLS[toolName] : null;
}
