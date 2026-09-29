// SPDX-License-Identifier: AGPL-3.0-only

// User authority for changes to ZeroH's own protection (rc.2 item 1, Astra
// R3). Turning the proxy off, repairing, uninstalling, allowing a secret to a
// host, raising an unmask cap, clearing the vault, keeping receipts longer and
// switching the banner or the status line are the user's decisions, never the model's. The
// shell-text guard (lib/settings-guard.js) only denies the spellings it
// recognises, early and with a friendly message; this module is where the
// decision is enforced, independently of how a command was spelled:
//
//   1. A management slash command's `!` block runs the CLI, which records a
//      PENDING request here (run/authz/pending-*.json, 0600, 60 s) and changes
//      nothing. Claude Code runs `!` preprocessing before UserPromptSubmit.
//   2. The UserPromptSubmit hook sees the user's raw typed prompt. Only when
//      it is that same slash command, for the same session, with the same
//      arguments, does it claim the pending request (rename, then unlink: at
//      most once) and mint a one-time TICKET (run/authz/tickets, 0600, 15 s)
//      whose secret it hands only to the CLI child it starts.
//   3. Every state-changing CLI subcommand calls requireUserAuthority() before
//      any side effect. It accepts that ticket, bound to its exact argv, or a
//      human's confirmation in a terminal outside Claude Code (below).
//      Anything else records a pending request and changes nothing.
//
// The model can run the CLI under any spelling, launcher or wrapper; without
// the ticket it only records a request that nothing applies unless the user
// then types that very command. The terminal fallback and the limits of all
// of this (code running as the same OS user) are described in
// docs/architecture.md, "Threat model".
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  closeSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminalCommand } from './fix-command.js';
import {
  ensurePrivateDir,
  removeQuietly,
  renameWithRetry,
  writePrivateJson,
  zerohHome,
} from './private-fs.js';

export const PENDING_TTL_MS = 60_000;
export const TICKET_TTL_MS = 15_000;
export const TICKET_ENV = 'ZEROH_USER_TICKET';
export const DONE_LINE =
  '✓ Done by ZeroH Disclosure (your command ran here and was not sent to Claude):';
const CLI = fileURLToPath(
  new URL('../bin/zeroh-disclosure.mjs', import.meta.url),
);

// Under ZEROH_HOME as `env` names it (its HOME too, so a caller preparing a
// child's environment finds the child's folder).
export function authzDir(env = process.env) {
  const homedir = () =>
    (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || os.homedir();
  return path.join(zerohHome(env, homedir), 'run', 'authz');
}

// --- which argv changes protection --------------------------------------

// The argv a request is matched on: the CLI's own arguments without the
// project folder (`--cwd`), which the `!` block and the hook each add.
export function canonicalArgv(argv) {
  const out = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--cwd') {
      index += 1;
      continue;
    }
    out.push(String(argv[index]));
  }
  if (out[0] === 'proxy' && out[1]) out[1] = out[1].toLowerCase();
  return out;
}

function argvHash(argv) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalArgv(argv)))
    .digest('hex');
}

// What a state-changing argv does, in plain words, or null for a read-only
// one (status, lists, catalog, verify, receipts views, doctor without --fix,
// uninstall without --yes or with --dry-run, which only shows its plan).
export function managementAction(argv) {
  const [command, ...rest] = canonicalArgv(argv);
  const flags = new Set(rest.filter((arg) => arg.startsWith('--')));
  const words = rest.filter((arg) => !arg.startsWith('--'));
  if (command === 'proxy' && (words[0] === 'off' || words[0] === 'on'))
    return `turn the local masking proxy ${words[0]}`;
  if (command === 'doctor' && flags.has('--fix'))
    return 'repair ZeroH Disclosure (doctor --fix): reset the local proxy and any vault that cannot be read';
  if (command === 'uninstall' && flags.has('--yes') && !flags.has('--dry-run'))
    return 'remove ZeroH Disclosure from this computer (plugin, proxy, vault, keys and receipts)';
  if (command === 'allow' && !flags.has('--list')) {
    const removeAt = rest.indexOf('--remove');
    if (removeAt >= 0) {
      const name = rest[removeAt + 1];
      const host = rest.filter(
        (arg, index) => index !== removeAt + 1 && !arg.startsWith('--'),
      )[0];
      if (name && host) return `stop allowing ${name} to reach ${host}`;
      return null;
    }
    if (words.length >= 2) return `allow ${words[0]} to reach ${words[1]}`;
    return null;
  }
  if (command === 'unmask' && words[0] === 'caps' && !flags.has('--list')) {
    if (words.length >= 3)
      return `set the ${words[1].toUpperCase()} unmask cap to ${words[2]}`;
    return null;
  }
  if (command === 'vault' && words[0] === 'clear' && flags.has('--yes'))
    return "clear every stored value of this project's vault";
  if (command === 'receipts' && words[0] === 'keep' && words[1])
    return `keep receipts for ${words[1]}`;
  if (command === 'banner' && words[0]) return `set the banner to ${words[0]}`;
  if (command === 'uncertain' && words[0])
    return `set uncertain cases to ${words[0]}`;
  if (command === 'statusline' && (words[0] === 'on' || words[0] === 'off'))
    return `turn the ZeroH status line ${words[0]} in your Claude Code settings`;
  return null;
}

// --- slash commands -------------------------------------------------------

// The management slash commands and the CLI argv their `!` block runs (see
// commands/*.md and commands/scripts/*.js). Null when the command or its
// arguments change nothing.
export function slashToCli(name, args) {
  let argv = null;
  if (name === 'proxy') {
    const action = String(args[0] || '').toLowerCase();
    if (args.length === 1 && (action === 'off' || action === 'on'))
      argv = ['proxy', action];
  } else if (name === 'settings') {
    if (
      ['banner', 'receipts', 'vault', 'uncertain', 'statusline'].includes(
        args[0],
      )
    )
      argv = [...args];
  } else if (name === 'uninstall') {
    // Typing the user-only command is the confirmation: its `!` block runs
    // `uninstall --yes $ARGUMENTS` (commands/uninstall.md); --dry-run only
    // shows the plan.
    argv = ['uninstall', '--yes', ...args];
  } else if (['allow', 'doctor', 'unmask'].includes(name)) {
    argv = [name, ...args];
  }
  return argv && managementAction(argv) ? argv : null;
}

// The slash command a management argv is typed as, for messages.
export function slashFor(argv) {
  const [command, ...rest] = canonicalArgv(argv);
  if (
    ['banner', 'receipts', 'vault', 'uncertain', 'statusline'].includes(command)
  )
    return `/zeroh-disclosure:settings ${[command, ...rest].join(' ')}`;
  return `/zeroh-disclosure:${[command, ...rest].join(' ')}`;
}

// Words of the arguments as a shell splits `$ARGUMENTS` in the `!` block:
// whitespace separates, single and double quotes group, a backslash outside
// single quotes escapes the next character.
export function splitArguments(text) {
  const out = [];
  let word = null;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (char === '\\' && index + 1 < text.length) {
      word = (word ?? '') + text[(index += 1)];
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      word ??= '';
    } else if (/\s/u.test(char)) {
      if (word !== null) out.push(word);
      word = null;
    } else word = (word ?? '') + char;
  }
  if (word !== null) out.push(word);
  return out;
}

// `/zeroh-disclosure:<name> <args>` (or the short `/<name> <args>` Claude Code
// also accepts) when the whole typed prompt is one slash command, else null.
export function parseSlashPrompt(prompt) {
  const match =
    /^\/(?:(zeroh-disclosure):)?([a-z][a-z-]*)(?:\s+([\s\S]*))?$/u.exec(
      String(prompt).trim(),
    );
  if (!match) return null;
  return {
    name: match[2],
    namespaced: Boolean(match[1]),
    args: splitArguments(match[3] ?? ''),
  };
}

// --- pending requests -----------------------------------------------------

function sweep(dir, prefix, now) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const live = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!(record?.exp > now)) removeQuietly(file);
    else live.push({ file, record });
  }
  return live;
}

// Records that `argv` was asked for in `sessionId`. It authorises nothing by
// itself: the user's matching typed prompt does.
export function recordPending({
  argv,
  sessionId = null,
  env = process.env,
  now = Date.now(),
}) {
  const dir = authzDir(env);
  ensurePrivateDir(dir);
  sweep(dir, 'pending-', Date.now());
  const record = {
    v: 1,
    session: sessionId || null,
    subcommand: canonicalArgv(argv)[0],
    argv_hash: argvHash(argv),
    created: now,
    exp: now + PENDING_TTL_MS,
  };
  const file = path.join(dir, `pending-${randomBytes(9).toString('hex')}.json`);
  writePrivateJson(file, record);
  return record;
}

// Claims the live pending request for exactly `argv` in `sessionId`, at most
// once: the file is renamed away before it is read as claimed.
export function claimPending({
  argv,
  sessionId = null,
  env = process.env,
  now = Date.now(),
}) {
  const dir = authzDir(env);
  const hash = argvHash(argv);
  for (const { file, record } of sweep(dir, 'pending-', now)) {
    if (record.argv_hash !== hash) continue;
    if (record.session && sessionId && record.session !== sessionId) continue;
    if (record.session && !sessionId) continue;
    const claimed = `${file}.claimed-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      renameWithRetry(file, claimed, { attempts: 1, keepSource: true });
    } catch {
      continue;
    }
    removeQuietly(claimed);
    return record;
  }
  return null;
}

// --- tickets --------------------------------------------------------------

// A one-time ticket for `argv`: `<id>.<secret>`. Only the secret's hash is
// written; the secret goes to the one CLI child the hook starts.
export function mintTicket({ argv, env = process.env, now = Date.now() }) {
  const dir = path.join(authzDir(env), 'tickets');
  ensurePrivateDir(dir);
  sweep(dir, 'ticket-', now);
  const id = randomBytes(9).toString('hex');
  const secret = randomBytes(32).toString('hex');
  writePrivateJson(path.join(dir, `ticket-${id}.json`), {
    v: 1,
    argv_hash: argvHash(argv),
    secret_hash: createHash('sha256').update(secret).digest('hex'),
    exp: now + TICKET_TTL_MS,
  });
  return `${id}.${secret}`;
}

function redeemTicket(value, argv, env, now) {
  const [id, secret] = String(value).split('.');
  if (
    !/^[0-9a-f]{18}$/u.test(id || '') ||
    !/^[0-9a-f]{64}$/u.test(secret || '')
  )
    return false;
  const file = path.join(authzDir(env), 'tickets', `ticket-${id}.json`);
  const claimed = `${file}.claimed-${process.pid}`;
  try {
    renameWithRetry(file, claimed, { attempts: 1, keepSource: true });
  } catch {
    return false;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(claimed, 'utf8'));
  } catch {
    record = null;
  } finally {
    removeQuietly(claimed);
  }
  if (!record || !(record.exp > now)) return false;
  const want = Buffer.from(String(record.secret_hash), 'hex');
  const got = createHash('sha256').update(secret).digest();
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  return record.argv_hash === argvHash(argv);
}

// --- the terminal fallback ------------------------------------------------

// Claude Code's own environment: the Bash tool, `!` blocks and hooks carry it.
const CLAUDE_ENV = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
];
const CLAUDE_PROCESS =
  /(?:^|[\\/\s])claude(?:\.exe)?(?:\s|$)|@anthropic-ai[\\/]claude-code|claude-code[\\/]cli\.js/iu;

// The command lines of this process's ancestors, nearest first (Linux /proc,
// macOS ps; none on Windows, where only the environment is checked).
export function processAncestry({
  platform = process.platform,
  pid = process.ppid,
} = {}) {
  const out = [];
  try {
    for (let depth = 0; pid > 1 && depth < 32; depth += 1) {
      if (platform === 'linux') {
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
          .split('\0')
          .filter(Boolean)
          .join(' ');
        out.push(cmdline);
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      } else if (platform === 'darwin') {
        const ps = spawnSync(
          'ps',
          ['-o', 'ppid=,command=', '-p', String(pid)],
          {
            encoding: 'utf8',
          },
        );
        const line = String(ps.stdout || '').trim();
        if (!line) break;
        const [, parent, command] = /^(\d+)\s+(.*)$/u.exec(line) || [];
        out.push(command || '');
        pid = Number(parent);
      } else break;
    }
  } catch {
    // An ancestor that cannot be read ends the walk.
  }
  return out;
}

export function insideClaudeCode(env, ancestry) {
  if (CLAUDE_ENV.some((key) => env[key])) return true;
  return ancestry().some((command) => CLAUDE_PROCESS.test(command));
}

// The controlling terminal, read and written directly (never stdin or stdout,
// which a caller can pipe): /dev/tty on macOS and Linux, the console on
// Windows. Null when there is none.
export function openTerminal({ platform = process.platform } = {}) {
  if (platform === 'win32') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
    return {
      write: (text) => process.stdout.write(text),
      readLine: async () => {
        const { createInterface } = await import('node:readline/promises');
        const readline = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          return await readline.question('');
        } finally {
          readline.close();
        }
      },
    };
  }
  let fd;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  return {
    write: (text) => writeSync(fd, text),
    readLine: async () => {
      const buffer = Buffer.alloc(1);
      let line = '';
      try {
        while (readSync(fd, buffer, 0, 1, null) === 1) {
          const char = buffer.toString('utf8');
          if (char === '\n') break;
          line += char;
        }
      } finally {
        closeSync(fd);
      }
      return line.replace(/\r$/u, '');
    },
  };
}

const CODE_ALPHABET = 'ACDEFHJKMNPRTUVWXY34679';
function oneTimeCode() {
  return [...randomBytes(4)]
    .map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    .join('');
}

// --- the check -------------------------------------------------------------

function refusal(argv) {
  const action = managementAction(argv) || canonicalArgv(argv).join(' ');
  return `Nothing changed: ${action} changes what ZeroH Disclosure protects, so only you can do it. Type ${slashFor(argv)} in Claude Code, or run ${terminalCommand(canonicalArgv(argv))} in your own terminal outside Claude Code.`;
}

// { ok: true, via: 'prompt' | 'terminal' } when the user asked for `argv`,
// else { ok: false, message } (a pending request is recorded when it came from
// neither path). `details` are extra lines the terminal confirmation shows.
export async function requireUserAuthority({
  argv,
  details = [],
  env = process.env,
  ancestry = processAncestry,
  terminal = undefined,
  now = Date.now(),
}) {
  const ticket = env[TICKET_ENV];
  if (ticket) {
    // A ticket is spent here, and nothing it starts inherits it.
    delete env[TICKET_ENV];
    if (redeemTicket(ticket, argv, env, now))
      return { ok: true, via: 'prompt' };
    return {
      ok: false,
      message: `Nothing changed: ZeroH could not confirm this request (it expired or was for another command). Type ${slashFor(argv)} again.`,
    };
  }
  const action = managementAction(argv) || canonicalArgv(argv).join(' ');
  if (!insideClaudeCode(env, ancestry)) {
    const term = terminal === undefined ? openTerminal() : terminal;
    if (term) {
      const code = oneTimeCode();
      term.write(
        [
          `ZeroH Disclosure: ${action}`,
          `  (${canonicalArgv(argv).join(' ')})`,
          ...details,
          `This changes what ZeroH Disclosure protects. To confirm, type the code ${code} and press Enter (anything else cancels): `,
        ].join('\n'),
      );
      const answer = String((await term.readLine()) ?? '')
        .trim()
        .toUpperCase();
      if (answer === code) return { ok: true, via: 'terminal' };
      return { ok: false, message: 'Cancelled; nothing changed.' };
    }
  }
  try {
    recordPending({
      argv,
      sessionId: env.CLAUDE_CODE_SESSION_ID || null,
      env,
      now,
    });
  } catch {
    // Without a request the user's typed command reports that nothing matched.
  }
  return { ok: false, message: refusal(argv) };
}

// --- the UserPromptSubmit side ----------------------------------------------

// Runs the CLI for `argv` with a fresh ticket (the user's own authority) and
// returns what it printed. Used by the UserPromptSubmit hook only.
export function runAsUser({ argv, cwd, env = process.env, timeoutMs = 6000 }) {
  const ticket = mintTicket({ argv, env });
  const result = spawnSync(process.execPath, [CLI, ...argv, '--cwd', cwd], {
    cwd,
    encoding: 'utf8',
    env: { ...env, [TICKET_ENV]: ticket },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
  };
}

// True when the typed prompt is one of ZeroH's own (namespaced) management
// slash commands. Never throws.
export function isManagementPrompt(prompt) {
  try {
    const slash = parseSlashPrompt(prompt);
    return Boolean(slash?.namespaced && slashToCli(slash.name, slash.args));
  } catch {
    return false;
  }
}

// For a typed prompt that is one of the management slash commands: applies
// it when its `!` block recorded the same request in this session, and
// returns the message to show; null for any other prompt.
export function handleManagementPrompt({
  prompt,
  sessionId,
  cwd,
  env = process.env,
  // lib/hook-io.js markSideEffect: a timeout mid-change then says so.
  markSideEffect = () => {},
}) {
  const slash = parseSlashPrompt(prompt);
  if (!slash) return null;
  const argv = slashToCli(slash.name, slash.args);
  if (!argv) return null;
  const pending = claimPending({ argv, sessionId, env });
  if (!pending) {
    // The short form may be another plugin's or a built-in command: only
    // ZeroH's own namespaced command is answered here.
    if (!slash.namespaced) return null;
    return {
      applied: false,
      message: `Nothing changed: ZeroH found no matching request for ${slashFor(argv)} (it expires after a minute, and must be typed exactly as the command received it). Type it again.`,
    };
  }
  markSideEffect(`running ${slashFor(argv)}`);
  const run = runAsUser({
    argv,
    cwd,
    env: {
      ...env,
      CLAUDE_CODE_SESSION_ID: sessionId || '',
      CLAUDE_PROJECT_DIR: cwd,
    },
  });
  markSideEffect(null);
  if (run.timedOut)
    return {
      applied: false,
      message: `ZeroH started ${slashFor(argv)} but it did not finish in time. /zeroh-disclosure:status shows where it stands.`,
    };
  const applied =
    run.status === 0 && !/^(?:Nothing changed|Cancelled)/u.test(run.output);
  // Claude Code shows this under "operation blocked by hook": the command
  // ran here and is not sent to the model, so the first line says it is done.
  return {
    applied,
    message: applied
      ? `${DONE_LINE}\n${run.output || slashFor(argv)}`
      : run.output || `Nothing changed: ${slashFor(argv)} failed.`,
  };
}
