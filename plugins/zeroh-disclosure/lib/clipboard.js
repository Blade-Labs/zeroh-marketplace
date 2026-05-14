import { spawn } from 'node:child_process';

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

function pickCandidates() {
  switch (process.platform) {
    case 'darwin':
      return [['pbcopy', []]];
    case 'win32':
      return [['clip', []]];
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
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.stdin.end(input);
  });
}
