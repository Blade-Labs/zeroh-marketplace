// SPDX-License-Identifier: AGPL-3.0-only

// Claude Code's own session files (1.0.1, Mac /try review C1).
//
// The proxy masks what reaches the model, and PostToolUse masks tool output
// and file reads before Claude Code stores them. But Claude Code's local
// session file (<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<project>/
// <session>.jsonl) also stores what the user typed as typed, values shown
// under an unmask grant, and the real values ZeroH put back into Edit, Write
// and MCP inputs (docs/architecture.md): ZeroH never sees that file being
// written. A shell command that copies, uploads, prints or reads these files
// may spread those values, so PreToolUse says so (pass mode) or stops it
// (`uncertain block`).
//
// A command names them when a word or redirection target, as the shell reads
// it (lib/shell-scan.js), is in a Claude config folder (`.claude`, or
// `.claude-<name>` / `.claude.<name>`, but not `.claude-plugin`) and is its
// `projects` folder, a project folder in it, or a `.jsonl` file below that
// (`~/.claude/projects/…`, `~/.claude-work/projects/…`,
// `$CLAUDE_CONFIG_DIR/projects/…`). Claude Code's auto-memory
// (`projects/<project>/memory/…`) is not a session file. A command the
// tokenizer can't read is judged on its text. The check is best effort: a
// command that reaches the files through `cd ~/.claude && cp projects/…` or
// `tar -C ~ .claude` is not recognised.
import os from 'node:os';
import path from 'node:path';
import { shellReadings } from './shell-scan.js';

const HOLDS =
  'values you typed, values you unmasked and values ZeroH put back into edits, as they are';

export const TRANSCRIPT_NOTICE = `ZeroH Disclosure: this command uses Claude Code's session files; they may hold ${HOLDS} (ZeroH masks what reaches Claude, not what Claude Code saves). Check before you copy or share them.`;

export const TRANSCRIPT_MODEL_NOTE =
  "ZeroH Disclosure: Claude Code's session files (…/projects/*.jsonl) store the user's prompts as typed, values shown under an unmask and the real values ZeroH put back into Edit, Write and MCP inputs, so they may hold real secrets. Don't copy, upload or share them without telling the user that.";

export const TRANSCRIPT_BLOCK_REASON = `🛡  ZeroH Disclosure stopped this command: it uses Claude Code's session files, which may hold ${HOLDS}. With /zeroh-disclosure:settings uncertain block these commands are stopped; ask the user to copy or share such a file themselves if they want to.`;

// `.claude`, `.claude-a`, `.claude.work`, … (not `.claude-plugin`) then
// `projects`; the rest of the path is judged by sessionRest.
const CONFIG_PROJECTS_RE =
  /(?:^|[\\/])\.claude(?:[-.](?!plugins?(?:[\\/"'\s]|$))[^\\/\s"']+)?[\\/]+projects(?=[\\/"'\s]|$)([^\s"']*)/giu;
const VARIABLE_PROJECTS_RE =
  /(?:\$\{?|\$env:|%)CLAUDE_CONFIG_DIR(?:\}|%)?["']?[\\/]+["']?projects(?=[\\/"'\s]|$)([^\s"']*)/giu;

// What follows `projects`: nothing, a project folder, or a path below one
// that may be a session file (`.jsonl`, or a glob), but not auto-memory.
function sessionRest(rest) {
  const parts = String(rest ?? '')
    .split(/[\\/]+/u)
    .filter(Boolean);
  if (parts.length <= 1) return true;
  if (parts[1].toLowerCase() === 'memory') return false;
  const last = parts.at(-1);
  return /\.jsonl$/iu.test(last) || /[*?[]/u.test(last);
}

function matchesPattern(re, text) {
  re.lastIndex = 0;
  for (const match of String(text ?? '').matchAll(re))
    if (sessionRest(match[1])) return true;
  return false;
}

function namesByText(text) {
  return (
    matchesPattern(CONFIG_PROJECTS_RE, text) ||
    matchesPattern(VARIABLE_PROJECTS_RE, text)
  );
}

function claudeConfigDir(env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
}

// A word's path spellings: `~`, $HOME and $CLAUDE_CONFIG_DIR expanded.
function spellings(word, env) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  let value = String(word?.value ?? '');
  if (word?.tilde && (value === '~' || /^~[\\/]/u.test(value)))
    value = home + value.slice(1);
  value = value.replace(/^\$(?:\{HOME\}|HOME(?![A-Za-z0-9_]))/u, home);
  if (env.CLAUDE_CONFIG_DIR)
    value = value.replace(
      /^(?:\$\{CLAUDE_CONFIG_DIR\}|\$CLAUDE_CONFIG_DIR(?![A-Za-z0-9_])|\$env:CLAUDE_CONFIG_DIR(?![A-Za-z0-9_]))/iu,
      env.CLAUDE_CONFIG_DIR,
    );
  const out = [value];
  const attached = /^--?[A-Za-z][\w-]*=(.+)$/su.exec(value);
  if (attached) out.push(attached[1]);
  return out;
}

function namesSessionFiles(text, env) {
  const value = String(text ?? '');
  if (namesByText(value)) return true;
  if (!path.isAbsolute(value)) return false;
  const projects = path.join(claudeConfigDir(env), 'projects');
  const resolved = path.resolve(value);
  if (resolved === projects) return true;
  return (
    resolved.startsWith(`${projects}${path.sep}`) &&
    sessionRest(resolved.slice(projects.length))
  );
}

// True when the shell command names Claude Code's session files.
export function commandUsesSessionFiles(
  command,
  shell = 'bash',
  { env = process.env } = {},
) {
  const text = String(command ?? '');
  const readings = shellReadings(text, shell);
  if (!readings.some((reading) => reading.ok)) return namesByText(text);
  for (const reading of readings) {
    if (!reading.ok) continue;
    for (const entry of reading.commands) {
      const words = [
        entry.programWord,
        ...(entry.args || []),
        ...(entry.redirects || []).map((redirect) => redirect.target),
      ].filter(Boolean);
      for (const word of words) {
        if (matchesPattern(VARIABLE_PROJECTS_RE, word.raw)) return true;
        if (spellings(word, env).some((value) => namesSessionFiles(value, env)))
          return true;
      }
    }
  }
  return false;
}
