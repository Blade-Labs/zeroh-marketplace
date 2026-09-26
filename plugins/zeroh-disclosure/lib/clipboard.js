// SPDX-License-Identifier: AGPL-3.0-only

// Clipboard writes for the blocked-prompt path: a masked copy of a stopped
// prompt goes to pbcopy, wl-copy, xclip, xsel or clip, whichever exists.
import { spawn } from 'node:child_process';
import path from 'node:path';

// Best-effort cross-platform clipboard write. Returns the tool name on
// success, or null if no clipboard tool was available.
export async function writeClipboard(text) {
  const candidates = pickCandidates();
  for (const [cmd, args] of candidates) {
    try {
      await runWithStdin(cmd, args, text);
      return cmd;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// On Windows a bare `clip` would be found in the current (project)
// directory first, so the system copy is named by its full path.
export function pickCandidates(platform = process.platform, env = process.env) {
  switch (platform) {
    case 'darwin':
      return [['pbcopy', []]];
    case 'win32':
      return [
        [
          path.win32.join(
            env.SystemRoot || env.windir || 'C:\\Windows',
            'System32',
            'clip.exe',
          ),
          [],
        ],
      ];
    default:
      // Linux / *BSD — Wayland first, then X11, then OSC52 fallback can be added later.
      return [
        ['wl-copy', []],
        ['xclip', ['-selection', 'clipboard']],
        ['xsel', ['--clipboard', '--input']],
      ];
  }
}

function runWithStdin(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
    child.stdin.end(input);
  });
}
