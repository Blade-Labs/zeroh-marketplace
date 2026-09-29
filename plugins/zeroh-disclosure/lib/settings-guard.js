// SPDX-License-Identifier: AGPL-3.0-only

// Static string checks cannot stop a determined shell from constructing a
// protected path at runtime. They raise the bar and make direct attempts
// visible to the user through a denied tool call.
import { SHELL_TOOLS, shellOf } from './shell-tools.js';
import {
  analyzeBash,
  analyzeShell,
  programName,
  shellReadings,
} from './shell-scan.js';
import {
  AWK_PROGRAMS,
  awkProgram,
  execCommand,
  GIT_WRITE_SUBCOMMANDS,
  gitCommand,
  interpreterCode,
  interpreterSpec,
  localProgramReach,
  optionWrites,
  optionWritesInto,
  readCode,
  sedProgram,
} from './shell-programs.js';
import { uncertainMode } from './config.js';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zerohHome } from './vault.js';
import { resolveClaudeSettingsPath } from './claude-settings.js';
import { encodeProjectPath } from './session.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SETTINGS_DENY_REASON =
  'ZeroH Disclosure settings can only be changed by the user. Do not edit or read them; ask the user.';

const FILE_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Grep',
]);
const SETTINGS_FILE_RE =
  /(?:allow\.json|vault\.key|allow\.key|unmask\.json|zeroh-restore\.json|grants(?:[\\/]|$))/i;
// Repository settings files the hooks read; the model never writes them.
const PROJECT_CONFIG_BASENAMES = new Set(['.zeroh.env', '.zeroh.policy']);
const ALLOW_COMMAND_RE = /zeroh-disclosure(?:\.mjs)?[^\r\n;&|]*\ballow\b/i;
const WINDOWS_HOME_RE =
  /(?:LOCALAPPDATA|AppData[\\/]+Local)[\W_]{0,6}ZeroH(?![\w-])/iu;
const ANTHROPIC_BASE_URL_RE = /ANTHROPIC_BASE_URL/i;
const UNMASK_COMMAND_RE =
  /zeroh-disclosure(?:\.mjs)?[^\r\n;&|]*\b(?:unmask|statusline)\b/i;
const ELICITATION_HOOK_RE = /\bElicitation(?:Result)?\b/u;
const MODEL_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
// Tools that run a shell command. Monitor runs its command like Bash (its
// output streams back while it runs), so every shell check covers it too.
export { SHELL_TOOLS };

function comparisonKey(value, platform) {
  let key = String(value);
  if (platform === 'win32') key = key.replace(/\\/g, '/');
  if (platform === 'win32' || platform === 'darwin') key = key.toLowerCase();
  return key;
}

export const STATUSLINE_STYLE_FILE = 'statusline-style.json';

function samePathKey(a, b, { platform }) {
  return comparisonKey(a, platform) === comparisonKey(b, platform);
}

function inside(candidate, directory, { platform, pathImpl }) {
  const candidateKey = comparisonKey(candidate, platform);
  const directoryKey = comparisonKey(directory, platform);
  const separator = platform === 'win32' ? '/' : pathImpl.sep;
  return (
    candidateKey === directoryKey ||
    candidateKey.startsWith(`${directoryKey}${separator}`)
  );
}

function realpathWherePossible(absolute, pathImpl) {
  if (existsSync(absolute)) return realpathSync(absolute);
  const tail = [];
  let cursor = absolute;
  while (!existsSync(cursor)) {
    const parent = pathImpl.dirname(cursor);
    if (parent === cursor) return absolute;
    tail.unshift(pathImpl.basename(cursor));
    cursor = parent;
  }
  return pathImpl.join(realpathSync(cursor), ...tail);
}

// True for a regular file with one link, or nothing at all, at `file`
// (lstat: a symbolic link is itself, not what it points to).
function plainFileOrAbsent(file) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
  return stat.isFile() && stat.nlink === 1;
}

function resolvedPair(value, base, pathImpl) {
  const lexical = pathImpl.resolve(base, String(value));
  return { lexical, real: realpathWherePossible(lexical, pathImpl) };
}

function protectedLocations(root, { home, pathImpl }) {
  const project = resolvedPair(pathImpl.join(root, '.zeroh'), root, pathImpl);
  const userHome = resolvedPair(home, root, pathImpl);
  // Receipts (D-15) live under the home, and the model may read them.
  const receipts = resolvedPair(
    pathImpl.join(
      home,
      'projects',
      encodeProjectPath(root, pathImpl),
      'sessions',
    ),
    root,
    pathImpl,
  );
  return { project, home: userHome, receipts };
}

export function isZeroHSettingsPath(
  value,
  root = process.cwd(),
  {
    read = false,
    platform = process.platform,
    pathImpl = platform === 'win32' ? path.win32 : path,
    home = zerohHome(),
  } = {},
) {
  if (typeof value !== 'string' || !value) return false;
  const options = { home, pathImpl, platform };
  const candidate = resolvedPair(value, root, pathImpl);
  if (
    !read &&
    [candidate.lexical, candidate.real].some((entry) =>
      PROJECT_CONFIG_BASENAMES.has(pathImpl.basename(entry).toLowerCase()),
    )
  ) {
    return true;
  }
  const locations = protectedLocations(pathImpl.resolve(root), options);
  const protectedPath =
    inside(candidate.lexical, locations.project.lexical, options) ||
    inside(candidate.real, locations.project.real, options) ||
    inside(candidate.lexical, locations.home.lexical, options) ||
    inside(candidate.real, locations.home.real, options);
  if (!protectedPath) return false;
  // The status line style is the one ZeroH file the model may read and
  // write, when the user asks it to change how the line looks: it can't
  // change what the line says (lib/statusline.js validates it on every
  // read). Only the file itself, never a link to somewhere else: a
  // symbolic link, dangling or not, or a file with other hard links is
  // protected like the rest of the home (Astra rc.2 F11).
  const style = (entry) => pathImpl.join(entry, STATUSLINE_STYLE_FILE);
  if (
    samePathKey(candidate.lexical, style(locations.home.lexical), options) &&
    samePathKey(candidate.real, style(locations.home.real), options) &&
    plainFileOrAbsent(candidate.lexical)
  ) {
    return false;
  }
  if (
    read &&
    inside(candidate.lexical, locations.receipts.lexical, options) &&
    inside(candidate.real, locations.receipts.real, options)
  ) {
    return false;
  }
  return true;
}

export function textReferencesZeroHSettings(
  text,
  root = process.cwd(),
  {
    platform = process.platform,
    pathImpl = platform === 'win32' ? path.win32 : path,
    home = zerohHome(),
    shell = null,
  } = {},
) {
  const value = String(text);
  if (/ZEROH_HOME/i.test(value)) return true;
  // `.zeroh` as a folder name only: `www.zeroh.io` or `x.zerohfake.test` are hosts, not settings.
  if (
    /(?:^|[\s'"=:/\\])\\?\.zeroh(?:\\?\.(?:env|policy))?(?=$|[\s'"/\\;&|)>])/i.test(
      value,
    )
  )
    return true;
  // The Windows home, %LOCALAPPDATA%\ZeroH, in any spelling a shell accepts:
  // $env:LOCALAPPDATA\ZeroH, %LOCALAPPDATA%\ZeroH, "$LOCALAPPDATA/ZeroH",
  // Join-Path $env:LOCALAPPDATA ZeroH, C:\Users\me\AppData\Local\ZeroH.
  if (WINDOWS_HOME_RE.test(value)) return true;
  if (SETTINGS_FILE_RE.test(value)) return true;
  if (ALLOW_COMMAND_RE.test(value)) return true;
  if (UNMASK_COMMAND_RE.test(value)) return true;

  for (const raw of value.split(/[\s'"=<>|;&(){}]+/)) {
    const word = raw.replace(/\\([ .])/g, '$1');
    if (word && isZeroHSettingsPath(word, root, { platform, pathImpl, home }))
      return true;
  }
  // The same paths however the shell spells them (`~/.ze"roh"/…`, `$'…'`).
  if (shell) {
    const analysis = analyzeShell(value, shell);
    const env = { ...process.env, ZEROH_HOME: home };
    for (const entry of analysis.commands) {
      for (const word of [
        ...words(entry),
        ...(entry.redirects || []).map((redirect) => redirect.target),
      ]) {
        if (!word) continue;
        for (const candidate of wordPathValues(word, env, platform)) {
          if (
            candidate &&
            (/(?:^|[\\/])\.zeroh(?:[\\/]|$)/iu.test(candidate) ||
              SETTINGS_FILE_RE.test(candidate) ||
              isZeroHSettingsPath(candidate, root, {
                platform,
                pathImpl,
                home,
              }))
          )
            return true;
        }
      }
    }
  }
  return false;
}

function isClaudeSettingsOrHookPath(
  value,
  root,
  {
    platform = process.platform,
    pathImpl = platform === 'win32' ? path.win32 : path,
    userHome = os.homedir(),
    claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ||
      pathImpl.join(userHome, '.claude'),
  } = {},
) {
  if (typeof value !== 'string' || !value) return false;
  const candidate = comparisonKey(pathImpl.resolve(root, value), platform);
  const projectSettings = [
    pathImpl.join(root, '.claude', 'settings.json'),
    pathImpl.join(root, '.claude', 'settings.local.json'),
    pathImpl.join(claudeConfigDir, 'settings.json'),
  ].map((entry) => comparisonKey(pathImpl.resolve(entry), platform));
  if (projectSettings.includes(candidate)) return true;
  return /(?:^|[\\/])hooks[\\/][^\\/]+$/iu.test(candidate);
}

// JSON and shell text can spell the event name with escapes.
function decodeEscapes(value) {
  return String(value)
    .replace(
      /\\u\{([0-9a-f]{1,6})\}|\\u([0-9a-f]{4})/giu,
      (match, braced, plain) => {
        const code = Number.parseInt(braced || plain, 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : match;
      },
    )
    .replace(/\\x([0-9a-f]{2})/giu, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\([0-7]{3})/gu, (_, octal) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
}

function mentionsElicitation(value) {
  return (
    ELICITATION_HOOK_RE.test(value) ||
    ELICITATION_HOOK_RE.test(decodeEscapes(value))
  );
}

function commandWritesElicitationHook(command, root, shell = 'bash') {
  if (!mentionsElicitation(command)) return false;
  let targetsProtectedPath = false;
  if (/\.claude[\\/]settings(?:\.local)?\.json/iu.test(command))
    targetsProtectedPath = true;
  if (/(?:^|[\s'"=])~?[\\/]?\.claude[\\/]settings\.json/iu.test(command))
    targetsProtectedPath = true;
  if (/\bCLAUDE_CONFIG_DIR[}%)"']*[\\/]settings\.json\b/iu.test(command))
    targetsProtectedPath = true;
  if (/(?:^|[\\/])hooks[\\/][^\s'";&|]+/iu.test(command))
    targetsProtectedPath = true;
  for (const raw of command.split(/[\s'"=<>|;&(){}]+/u)) {
    if (isClaudeSettingsOrHookPath(raw, root)) targetsProtectedPath = true;
  }
  if (!targetsProtectedPath) return false;

  // Shells can write through interpreters, .NET methods, or arbitrary helper
  // programs. Once a protected path and the hook keyword are both present,
  // only a plain read passes (as in rc.1: adding an Elicitation hook would let
  // something other than the user answer unmask consent).
  return !isReadOnlyInspection(command, shell);
}

export function deniesElicitationHookEdits(
  toolName,
  input,
  root = process.cwd(),
) {
  if (MODEL_EDIT_TOOLS.has(toolName)) {
    const target = input?.file_path || input?.path;
    if (!isClaudeSettingsOrHookPath(target, root)) return false;
    return stringsIn(input).some((value) => mentionsElicitation(value));
  }
  if (SHELL_TOOLS.has(toolName) && typeof input?.command === 'string') {
    return commandWritesElicitationHook(input.command, root, shellOf(toolName));
  }
  return false;
}

function stringsIn(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value))
    value.forEach((entry) => stringsIn(entry, found));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((entry) => stringsIn(entry, found));
  return found;
}

function isProjectClaudeSettings(value, root, { platform, pathImpl }) {
  if (typeof value !== 'string' || !value) return false;
  const candidate = comparisonKey(pathImpl.resolve(root, value), platform);
  const directory = comparisonKey(pathImpl.resolve(root, '.claude'), platform);
  const separator = platform === 'win32' ? '/' : pathImpl.sep;
  if (!candidate.startsWith(`${directory}${separator}`)) return false;
  return /^settings(?:\.[^/\\]+)?\.json$/iu.test(pathImpl.basename(candidate));
}

export function deniesClaudeBaseUrlMutation(
  toolName,
  input,
  root = process.cwd(),
  {
    env = process.env,
    platform = process.platform,
    pathImpl = platform === 'win32' ? path.win32 : path,
    settingsPath = resolveClaudeSettingsPath({ env, platform }),
  } = {},
) {
  const strings = stringsIn(input);
  if (!strings.some((value) => ANTHROPIC_BASE_URL_RE.test(value))) {
    return false;
  }
  const settingsPair = resolvedPair(settingsPath, root, pathImpl);
  const exactSettings = comparisonKey(settingsPair.lexical, platform);
  const realSettings = comparisonKey(settingsPair.real, platform);
  if (toolName === 'Edit' || toolName === 'Write') {
    const target = input?.file_path || input?.path;
    if (typeof target !== 'string') return false;
    const targetPair = resolvedPair(target, root, pathImpl);
    const resolved = comparisonKey(targetPair.lexical, platform);
    const realResolved = comparisonKey(targetPair.real, platform);
    return (
      resolved === exactSettings ||
      realResolved === realSettings ||
      isProjectClaudeSettings(target, root, { platform, pathImpl })
    );
  }
  if (!SHELL_TOOLS.has(toolName)) return false;
  const command = input?.command;
  if (typeof command !== 'string') return false;
  const normalized = comparisonKey(command, platform);
  const namesResolvedSettings = normalized.includes(exactSettings);
  const namesResolverVariable =
    /(?:\$env:|\$\{?|%)(?:ZEROH_CLAUDE_SETTINGS|CLAUDE_CONFIG_DIR)(?:\}|%|\b)/iu.test(
      command,
    );
  const namesProjectSettings =
    /(?:^|[\s'"=:/\\])\.?claude[/\\]settings(?:\.[^\s'"/\\]+)?\.json\b/iu.test(
      command,
    );
  return namesResolvedSettings || namesResolverVariable || namesProjectSettings;
}

// ---------------------------------------------------------------------------
// User-only slash commands (UO-1).
//
// These commands widen where a value may go or change how ZeroH protects the
// user. Their frontmatter sets `disable-model-invocation: true`; this is the
// second line: a Skill or SlashCommand call naming one is denied, so the model
// can never run `/zeroh-disclosure:allow NAME host` itself. `unmask caps`
// raises how long an unmask grant may last, so it is user-only too; the rest
// of unmask goes through the user's own dialog.

export const USER_ONLY_COMMANDS = Object.freeze([
  'allow',
  'doctor',
  'proxy',
  'settings',
  'uninstall',
]);

export const USER_ONLY_DENY_REASON =
  'ZeroH Disclosure: only the user can run this command. Do not run it yourself or try another way; tell the user the exact slash command to type.';

const USER_ONLY_COMMAND_RE = new RegExp(
  `^/?(?:[\\w.-]+:)*zeroh-disclosure:(${USER_ONLY_COMMANDS.join('|')})$`,
  'iu',
);
const UNMASK_COMMAND_NAME_RE = /^\/?(?:[\w.-]+:)*zeroh-disclosure:unmask$/iu;

// The command name and its arguments from a Skill ({skill, args}) or
// SlashCommand ({command: "/name args"}) input.
function slashInvocation(toolName, input) {
  if (toolName === 'Skill') {
    return {
      name: String(input?.skill ?? '').trim(),
      args: String(input?.args ?? '').trim(),
    };
  }
  if (toolName === 'SlashCommand') {
    const text = String(input?.command ?? '').trim();
    const space = text.search(/\s/u);
    return space < 0
      ? { name: text, args: '' }
      : { name: text.slice(0, space), args: text.slice(space).trim() };
  }
  return null;
}

export function deniesUserOnlyCommand(toolName, input) {
  const invocation = slashInvocation(toolName, input);
  if (!invocation) return false;
  const name = invocation.name.replace(/\s+/gu, '');
  if (USER_ONLY_COMMAND_RE.test(name)) return true;
  if (UNMASK_COMMAND_NAME_RE.test(name)) {
    // Any word `caps`: flags such as --json may come before it.
    return /(?:^|\s)caps(?:\s|$)/iu.test(invocation.args);
  }
  return false;
}

export function deniesZeroHSettings(
  toolName,
  input,
  root = process.cwd(),
  options = {},
) {
  if (deniesClaudeControlChange(toolName, input, root, options)) return true;
  if (deniesClaudeBaseUrlMutation(toolName, input, root, options)) return true;
  if (FILE_TOOLS.has(toolName)) {
    const target = input?.file_path || input?.notebook_path || input?.path;
    return isZeroHSettingsPath(target, root, {
      read: toolName === 'Read' || toolName === 'Grep',
    });
  }
  if (SHELL_TOOLS.has(toolName) && typeof input?.command === 'string')
    return (
      commandRunsZeroHManagement(input.command, shellOf(toolName)) ||
      textReferencesZeroHSettings(input.command, root, {
        shell: shellOf(toolName),
      })
    );
  if (String(toolName).startsWith('mcp__')) {
    const strings = stringsIn(input);
    return (
      strings.some((value) => textReferencesZeroHSettings(value, root)) ||
      textReferencesZeroHSettings(strings.join(' '), root)
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Claude Code settings, plugin files and the Claude CLI.
//
// The model may still edit Claude settings for its own work (permissions, a
// theme), but never in a way that turns ZeroH off: disabling hooks, disabling
// or removing the plugin, setting ZEROH_* or ANTHROPIC_BASE_URL, or adding an
// Elicitation hook. File tools are checked by parsing the resulting JSON, so
// escapes and key order do not matter. Shell commands that name these files
// are allowed only when they provably only read.

// Claude Code applies a settings file's `env` to its own process, so to every
// hook and statusLine command it starts: these would move ZeroH's home or
// Claude's, change which programs or modules run, or route around the proxy.
const CLAUDE_CONTROL_ENV_RE =
  /^(?:ZEROH_.*|ANTHROPIC_BASE_URL|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|XDG_[A-Z_]+|CLAUDE_CONFIG_DIR|CLAUDE_CODE_PLUGIN_CACHE_DIR|CLAUDE_PROJECT_DIR|PATH|PATHEXT|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z_]+|BASH_ENV|ENV|SHELL|COMSPEC|PSMODULEPATH|TMPDIR|TEMP|TMP)$/iu;
const ZEROH_PLUGIN_ID_RE = /^zeroh-disclosure(?:@|$)/iu;
// ---------------------------------------------------------------------------
// Shell commands that name protected paths (rc.2 item 3, Astra R1).
//
// The command is read with the shared tokenizer (lib/shell-scan.js), so
// quoting (`--p"re"`, `$'--pre'`, `~/.cl"aude"/settings.json`), launchers and
// nested or inline commands are seen as the shell sees them.
//
// In `pass` mode (the default; owner rule 2026-09-27: ZeroH must not stop
// ordinary work) a command is denied only when it clearly writes, deletes or
// executes against a protected path: rm, mv, cp onto it, sed -i, tee, a `>`
// or `>>` redirection, chmod/chown, truncate, `rg --pre` in any spelling,
// `find -exec`/`-delete`, `xargs rm`, an interpreter given the file as its
// script, and sed, awk or inline code whose write resolves to it
// (protectedEffect). Reads pass. A program that names a protected path but
// whose effect can't be read runs with the notice (`script-or-interpreter`),
// and anything the tokenizer cannot read runs too (`unparseable`).
//
// In `block` mode (opt-in, ZEROH_UNCERTAIN=block) a command naming a
// protected path must be a plain read: cat, head, tail, wc, ls, stat or jq,
// each with only the options listed below, no launcher, no writing
// redirection. Anything else, or anything unparseable, is denied.
//
// ZeroH's own state (the vault, its keys, the signed allow list) is closed to
// shell commands in both modes, as in rc.1 (textReferencesZeroHSettings):
// reading a key file would undo the masking itself.

export const PROTECTED_SHELL_DENY_REASON =
  'ZeroH Disclosure: this command would change or run Claude Code settings, plugin files or hooks. Only the user may change them. To look at these files, use the Read or Grep tool.';
export const PROTECTED_SHELL_BLOCK_REASON =
  'ZeroH Disclosure (uncertain = block): commands that name Claude Code settings, plugin files or hooks may only read them with cat, head, tail, wc, ls, stat or jq. Use the Read or Grep tool to look at these files; only the user may change them.';

// Per-command option allowlists for block mode. Short options may be
// clustered (`-nv`); `values` take the next word or an attached `=value`.
const SAFE_READERS = Object.freeze({
  cat: {
    flags:
      '-A -b -e -E -n -s -t -T -u -v --show-all --number-nonblank --show-ends --number --squeeze-blank --show-tabs --show-nonprinting',
  },
  head: {
    flags: '-q -v -z --quiet --silent --verbose --zero-terminated',
    values: '-c -n --bytes --lines',
    numeric: true,
  },
  tail: {
    flags:
      '-f -F -q -v -z -r --follow --retry --quiet --silent --verbose --zero-terminated',
    values:
      '-c -n -s --bytes --lines --sleep-interval --pid --max-unchanged-stats',
    numeric: true,
  },
  wc: {
    flags: '-c -m -l -L -w --bytes --chars --lines --max-line-length --words',
  },
  ls: {
    flags:
      '-a -A -b -B -c -C -d -D -f -F -g -G -h -H -i -k -l -L -m -n -N -o -p -q -Q -r -R -s -S -t -u -U -v -x -X -Z -1 ' +
      '--all --almost-all --author --escape --ignore-backups --directory --dired --classify --file-type --no-group ' +
      '--human-readable --si --dereference-command-line --dereference-command-line-symlink-to-dir --inode ' +
      '--kibibytes --dereference --numeric-uid-gid --literal --hide-control-chars --show-control-chars ' +
      '--quote-name --reverse --recursive --size --context --zero --group-directories-first --full-time',
    values:
      '-I -T -w --block-size --color --format --hide --hyperlink --ignore --indicator-style --quoting-style --sort --tabsize --time --time-style --width',
  },
  stat: {
    flags: '-L -f -t --dereference --file-system --terse',
    values: '-c --format --printf --cached',
  },
  jq: {
    flags:
      '-r -j -a -c -n -e -s -S -C -M -R --raw-output --raw-output0 --join-output --ascii-output --compact-output --null-input --exit-status --slurp --sort-keys --color-output --monochrome-output --raw-input --tab --seq --stream --stream-errors',
    values: '--indent',
    pairs: '--arg --argjson',
  },
});

// Programs that read and never write or run anything given these options
// (the Elicitation guard's notion of a plain read).
const READERS = new Set([
  ...Object.keys(SAFE_READERS),
  'less',
  'more',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'file',
  'bat',
  'get-content',
  'gc',
  'select-string',
  'sls',
  'get-item',
  'gi',
  'get-childitem',
  'gci',
  'dir',
  'test-path',
]);

const WRITING_REDIRECTS = new Set(['>', '>>', '>|', '<>', '&>', '&>>']);
const WRITES_ANY_OPERAND = new Set([
  'rm',
  'rmdir',
  'unlink',
  'shred',
  'truncate',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'tee',
  'sponge',
  'setfacl',
  'chattr',
  'xattr',
  'patch',
  'mv',
  // PowerShell
  'set-content',
  'sc',
  'add-content',
  'ac',
  'out-file',
  'remove-item',
  'del',
  'erase',
  'ri',
  'rd',
  'move-item',
  'move',
  'mi',
  'new-item',
  'ni',
  'clear-content',
  'clc',
  'rename-item',
  'rni',
  'ren',
  'set-item',
  'si',
  'set-acl',
  'tee-object',
]);
const WRITES_DESTINATION = new Set([
  'cp',
  'install',
  'ln',
  'rsync',
  'scp',
  'copy-item',
  'copy',
  'cpi',
]);
const SCRIPT_RUNNERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'source',
  '.',
  'python',
  'python3',
  'node',
  'perl',
  'ruby',
  'php',
  'pwsh',
  'powershell',
]);
const INLINE_CODE_FLAGS = new Set([
  '-c',
  '-e',
  '-E',
  '-r',
  '--eval',
  '-p',
  '--print',
  '-command',
  '-c',
]);

function splitOptions(list) {
  return new Set(
    String(list ?? '')
      .split(/\s+/u)
      .filter(Boolean),
  );
}

// A word as a path: `~` and the variables the guards know are expanded. On
// Windows, Git Bash (Claude Code's Bash there) names drives /c/…, as its
// own `pwd` does: such a word is also read as C:\… .
function wordPathValues(word, env, platform = process.platform) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  let value = String(word.value);
  if (word.tilde && (value === '~' || /^~[\\/]/u.test(value)))
    value = home + value.slice(1);
  value = value
    .replace(/^\$(?:\{HOME\}|HOME(?![A-Za-z0-9_]))/u, home)
    .replace(/^\$env:(?:USERPROFILE|HOME)(?![A-Za-z0-9_])/iu, home);
  for (const name of [
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_PLUGIN_ROOT',
    'ZEROH_HOME',
  ]) {
    if (!env[name]) continue;
    value = value.replace(
      new RegExp(
        `^(?:\\$\\{${name}\\}|\\$${name}(?![A-Za-z0-9_])|\\$env:${name}(?![A-Za-z0-9_]))`,
        'iu',
      ),
      env[name],
    );
  }
  const values = [value];
  const attached =
    /^--?[A-Za-z][\w-]*=(.+)$/su.exec(value) || /^of=(.+)$/su.exec(value);
  if (attached) values.push(attached[1]);
  if (platform === 'win32') {
    for (const entry of [...values]) {
      const drive = /^\/([A-Za-z])(?=\/|$)(.*)$/su.exec(entry);
      if (drive) values.push(`${drive[1].toUpperCase()}:${drive[2] || '/'}`);
    }
  }
  return values;
}

const PROTECTED_VARIABLE_RE =
  /(?:\$env:|\$\{?|%)(?:ZEROH_CLAUDE_SETTINGS|CLAUDE_CONFIG_DIR|CLAUDE_PLUGIN_ROOT)(?:\}|%|\b)/iu;
const PROTECTED_TEXT_RE =
  /(?:^|[\s'"=:/\\])\.?claude[/\\](?:settings(?:\.local)?\.json|plugins\b)|managed-settings\.json|zeroh-restore\.json/iu;

// A predicate: does this word name a Claude settings file, a plugin file or
// hook, or ZeroH's own state?
function protectedWordTest(root, opts) {
  const env = opts.env || process.env;
  return (word) => {
    if (!word) return false;
    const raw = String(word.raw ?? word.value ?? '');
    if (PROTECTED_VARIABLE_RE.test(raw) || PROTECTED_TEXT_RE.test(raw))
      return true;
    for (const value of wordPathValues(word, env, opts.platform)) {
      if (!value) continue;
      if (PROTECTED_TEXT_RE.test(value)) return true;
      // The folders that hold them: `find ~/.claude -delete`, `rm -r .claude`.
      const resolved = resolvedPair(value, root, opts.pathImpl);
      for (const folder of [
        opts.configDir,
        opts.pathImpl.join(root, '.claude'),
      ]) {
        const pair = resolvedPair(folder, root, opts.pathImpl);
        if (
          samePath(resolved.lexical, pair.lexical, opts) ||
          samePath(resolved.real, pair.real, opts)
        )
          return true;
      }
      if (claudeControlKind(value, root, opts)) return true;
      if (
        isClaudeSettingsOrHookPath(value, root, {
          platform: opts.platform,
          pathImpl: opts.pathImpl,
          userHome: env.HOME || os.homedir(),
          claudeConfigDir: opts.configDir,
        })
      )
        return true;
    }
    return false;
  };
}

function words(entry) {
  return [entry.programWord, ...(entry.args || [])].filter(Boolean);
}

function operandsOf(args) {
  const out = [];
  let rest = false;
  for (const word of args) {
    if (!rest && word.value === '--') {
      rest = true;
      continue;
    }
    if (!rest && word.value.startsWith('-') && word.value.length > 1) continue;
    out.push(word);
  }
  return out;
}

// True when a command clearly writes, deletes or runs against a protected
// path (see the list above), for programs read by their arguments alone.
function explicitWrite(entry, isProtected, lineNamesProtected) {
  for (const redirect of entry.redirects || []) {
    if (WRITING_REDIRECTS.has(redirect.op) && isProtected(redirect.target))
      return true;
    if (/^[1-6*]?>>?$/u.test(redirect.op) && isProtected(redirect.target))
      return true;
  }
  const program = entry.program;
  if (!program) return false;
  const args = entry.args || [];
  const values = args.map((word) => word.value);
  const anyProtected = words(entry).some(isProtected);
  // A program's own options, read once for the guard and the destination
  // check alike (lib/shell-programs.js): one that runs another program
  // (`rg --pre`, `tar --to-command`, `sort --compress-program`, `less
  // +!cmd`) against a protected path is a run; one that writes its value
  // (`sort -o`, `tar -cf`) is a write.
  if (localProgramReach(entry).runs) return anyProtected || lineNamesProtected;
  if (optionWrites(entry).some((word) => isProtected(pathWord(word.value))))
    return true;
  if (
    program === 'find' &&
    values.some((v) =>
      /^-(?:exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/u.test(v),
    )
  )
    return anyProtected;
  if (
    entry.stdinArgs &&
    (WRITES_ANY_OPERAND.has(program) || WRITES_DESTINATION.has(program))
  )
    return anyProtected || lineNamesProtected;
  if (WRITES_ANY_OPERAND.has(program)) return args.some(isProtected);
  if (WRITES_DESTINATION.has(program)) {
    const target = args.findIndex((w) =>
      /^(?:-t|--target-directory(?:=.*)?|-destination|-dest)$/iu.test(w.value),
    );
    if (target >= 0) {
      const inline = /^--target-directory=(.*)$/u.exec(values[target]);
      if (inline)
        return isProtected({
          ...args[target],
          value: inline[1],
          raw: inline[1],
        });
      return isProtected(args[target + 1]);
    }
    const operands = operandsOf(args);
    return operands.length > 1 && isProtected(operands.at(-1));
  }
  if (program === 'dd')
    return args.some(
      (w) =>
        /^of=/u.test(w.value) &&
        isProtected({
          ...w,
          value: w.value.slice(3),
          raw: w.raw.replace(/^of=/u, ''),
        }),
    );
  // git's subcommand after its global options (`git -C /tmp rm …`).
  if (
    program === 'git' &&
    GIT_WRITE_SUBCOMMANDS.has(gitCommand(entry).subcommand)
  )
    return args.some(isProtected);
  if (SCRIPT_RUNNERS.has(program) && !interpreterSpec(program)) {
    const operands = operandsOf(args);
    if (operands[0] && isProtected(operands[0])) return true;
    // Shells: their inline code is read as commands (lib/shell-scan.js);
    // PowerShell's `-Command` too. This covers what that reading can't.
    for (let index = 0; index < args.length; index += 1) {
      if (
        INLINE_CODE_FLAGS.has(values[index].toLowerCase()) ||
        /^-[a-z]*c$/u.test(values[index])
      ) {
        const code = args[index + 1];
        if (code && codeNamesProtected(code.value, isProtected)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// What a command does to protected paths (Astra rc.2 V4): 'write' for a
// recognised write, delete or run against one (a default stop), 'uncertain'
// for a program that names one but whose effect ZeroH can't read (it runs,
// with the notice; block mode denies), null for a recognised read or
// nothing. Programs with a grammar of their own (sed, awk, interpreters) are
// read by it; the others by explicitWrite.
const WRITE = 'write';
const UNCERTAIN = 'uncertain';

function worse(a, b) {
  if (a === WRITE || b === WRITE) return WRITE;
  if (a === UNCERTAIN || b === UNCERTAIN) return UNCERTAIN;
  return null;
}

function protectedEffect(entry, ctx) {
  if (explicitWrite(entry, ctx.isProtected, ctx.lineNamesProtected))
    return WRITE;
  const program = entry.program;
  if (!program) return null;
  // An extractor writing files ZeroH can't name into a protected folder
  // (`tar -xf a.tar -C ~/.claude`, a plugin's hooks folder): uncertain
  // (Astra pre-1.0.0 R1). Named members are writes, above.
  if (optionWritesInto(entry).some((dir) => extractsIntoProtected(dir, ctx)))
    return UNCERTAIN;
  if (program === 'sed') return sedEffect(entry, ctx);
  if (AWK_PROGRAMS.has(program)) return awkEffect(entry, ctx);
  const interpreter = interpreterCode(entry);
  if (interpreter) return interpreterEffect(interpreter, ctx);
  return null;
}

// A shell command a program runs (sed's `e`, awk's system(), an
// interpreter's os.system): read like any other command line.
function commandTextEffect(text, ctx) {
  const names = codeNamesProtected(text, ctx.isProtected);
  if (ctx.depth >= 4) return names ? UNCERTAIN : null;
  const analysis = analyzeBash(text);
  if (!analysis.ok) return names ? UNCERTAIN : null;
  let effect = null;
  for (const entry of analysis.commands)
    effect = worse(
      effect,
      protectedEffect(entry, {
        ...ctx,
        depth: ctx.depth + 1,
        lineNamesProtected: ctx.lineNamesProtected || names,
      }),
    );
  return effect;
}

function extractsIntoProtected(dir, ctx) {
  const base = String(dir.value).replace(/[\\/]+$/u, '');
  return [base, `${base}/settings.json`].some((value) =>
    ctx.isProtected({ ...pathWord(value), raw: value }),
  );
}

// A word for a path the program itself names (a sed `w` file, an awk
// string).
function pathWord(value) {
  const text = String(value).trim();
  return { value: text, raw: text, tilde: text.startsWith('~') };
}

function literalNamesProtected(value, ctx) {
  return (
    ctx.isProtected(pathWord(value)) ||
    codeNamesProtected(value, ctx.isProtected)
  );
}

// sed: `-i` on a protected file, a `w`/`W`/`s///w` to one, or one given as
// the script file, is a write; an `e` command is read as a command line; a
// script ZeroH can't see or read (`$SCRIPT`, `-f file`, an unknown
// command) or `s///e` is uncertain when the script or sed's files name a
// protected path.
function sedEffect(entry, ctx) {
  const { isProtected } = ctx;
  const sed = sedProgram(entry);
  if (sed.inPlace && (entry.args || []).some(isProtected)) return WRITE;
  if (sed.scriptFiles.some(isProtected)) return WRITE;
  const { program } = sed;
  if (program.writes.some((file) => literalNamesProtected(file, ctx)))
    return WRITE;
  let effect = null;
  let unresolved = false;
  for (const command of program.executes) {
    if (!command.trim()) unresolved = true;
    else effect = worse(effect, commandTextEffect(command, ctx));
  }
  if (effect === WRITE) return WRITE;
  const scriptText = sed.scripts.map((word) => word.value).join('\n');
  const named =
    codeNamesProtected(scriptText, isProtected) || sed.files.some(isProtected);
  if (!named) return effect;
  if (!program.ok || sed.scriptFiles.length || unresolved)
    return worse(effect, UNCERTAIN);
  return effect;
}

// awk: `-i inplace` on a protected file, a protected program file, and an
// output redirection or pipe whose target resolves to a protected path (a
// string, FILENAME of a protected input, a `-v`/operand/program variable
// holding one) are writes; system(), print pipes and `cmd | getline` with a
// string command are read as command lines. When the program, its
// assignments or its files name a protected path, a redirection or command
// ZeroH can't resolve, or a program it can't see or read, is uncertain.
function awkEffect(entry, ctx) {
  const { isProtected } = ctx;
  const awk = awkProgram(entry);
  if (awk.programFiles.some(isProtected)) return WRITE;
  if (awk.inPlace && awk.files.some(isProtected)) return WRITE;
  const variables = { ...awk.scan.assigns };
  for (const word of awk.assignments) {
    const match = /^([A-Za-z_]\w*)=(.*)$/su.exec(String(word.value));
    if (match) variables[match[1]] = word.dynamic ? null : match[2];
  }
  const inputs = awk.files.filter(
    (word) => !/^[A-Za-z_]\w*=/u.test(String(word.value)),
  );
  // A target's paths, or null when it can't be resolved.
  const resolve = (target) => {
    if (target.literal !== undefined) return [target.literal];
    if (target.name === 'FILENAME')
      return inputs.some((word) => word.dynamic)
        ? null
        : inputs.map((word) => String(word.value));
    if (target.name !== undefined)
      return typeof variables[target.name] === 'string'
        ? [variables[target.name]]
        : null;
    return null;
  };
  let effect = null;
  let unresolved = false;
  for (const redirect of awk.scan.redirects) {
    const resolved = resolve(redirect.target);
    if (resolved === null) {
      unresolved = true;
      continue;
    }
    if (redirect.kind === 'file') {
      if (resolved.some((file) => literalNamesProtected(file, ctx)))
        return WRITE;
    } else
      for (const command of resolved)
        effect = worse(effect, commandTextEffect(command, ctx));
  }
  for (const target of [
    ...awk.scan.system,
    ...awk.scan.getline
      .filter((g) => g.kind === 'command')
      .map((g) => g.target),
  ]) {
    if (target.literal === undefined) unresolved = true;
    else effect = worse(effect, commandTextEffect(target.literal, ctx));
  }
  if (effect === WRITE) return WRITE;
  const programText = awk.programs.map((word) => word.value).join('\n');
  const named =
    codeNamesProtected(programText, isProtected) ||
    awk.assignments.some((word) =>
      codeNamesProtected(String(word.value), isProtected),
    ) ||
    awk.files.some(isProtected);
  if (!named) return effect;
  if (
    awk.dynamic ||
    !awk.programs.length ||
    awk.programFiles.length ||
    !awk.scan.ok ||
    unresolved
  )
    return worse(effect, UNCERTAIN);
  return effect;
}

// An interpreter: its script or an in-place edit (`perl -pi`) of a
// protected file is a write; inline code is read by its language's table
// (readCode): a write call naming a protected path is a write, a read call
// is a read, a command it runs is read as a command line, and a write, open
// or run ZeroH can't resolve is uncertain when the code names a protected
// path. Code ZeroH can't see (stdin from a pipe or a file) is uncertain
// when the line names one.
function interpreterEffect(interpreter, ctx) {
  const { isProtected } = ctx;
  if (interpreter.script && isProtected(interpreter.script)) return WRITE;
  if (interpreter.inPlace && interpreter.operands.some(isProtected))
    return WRITE;
  let effect = null;
  for (const { code, dynamic } of interpreter.code) {
    if (dynamic) {
      if (ctx.lineNamesProtected) effect = worse(effect, UNCERTAIN);
      continue;
    }
    effect = worse(effect, codeEffect(code, interpreter.language, ctx));
    if (effect === WRITE) return WRITE;
  }
  return effect;
}

function codeEffect(code, language, ctx) {
  const names = (text) => codeNamesProtected(String(text), ctx.isProtected);
  if (!names(code)) return null;
  const scan = readCode(code, language);
  if (!scan.language) return UNCERTAIN;
  const argNames = (arg) =>
    Boolean(arg) &&
    (arg.literal !== null && arg.literal !== undefined
      ? literalNamesProtected(arg.literal, ctx)
      : names(arg.text));
  let effect = scan.ok ? null : UNCERTAIN;
  let unresolved = false;
  for (const call of scan.calls) {
    if (call.kind === 'write') {
      if (call.targets.some(argNames)) return WRITE;
      if (call.targets.some((arg) => arg.literal === null)) unresolved = true;
    } else if (call.kind === 'open') {
      unresolved = true;
    } else if (call.kind === 'exec') {
      const command = execCommand(call);
      if (command === null) unresolved = true;
      else {
        effect = worse(effect, commandTextEffect(command, ctx));
        if (effect === WRITE) return WRITE;
      }
    } else if (call.kind === 'eval' || call.kind === 'dynamic')
      unresolved = true;
  }
  return unresolved ? worse(effect, UNCERTAIN) : effect;
}

function codeNamesProtected(code, isProtected) {
  if (PROTECTED_TEXT_RE.test(code) || PROTECTED_VARIABLE_RE.test(code))
    return true;
  return code
    .split(/[\s'"=<>|;&(){},]+/u)
    .filter(Boolean)
    .some((part) =>
      isProtected({ value: part, raw: part, tilde: part.startsWith('~') }),
    );
}

function optionsAllowed(spec, args) {
  const flags = splitOptions(spec.flags);
  const values = splitOptions(spec.values);
  const pairs = splitOptions(spec.pairs);
  let operandsOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    const value = word.value;
    if (operandsOnly || !value.startsWith('-') || value === '-') continue;
    if (value === '--') {
      operandsOnly = true;
      continue;
    }
    if (word.dynamic) return false;
    if (spec.numeric && /^-\d+$/u.test(value)) continue;
    if (value.startsWith('--')) {
      const [name, inline] = value.split(/=(.*)/su);
      if (flags.has(name) && inline === undefined) continue;
      if (values.has(name)) {
        if (inline === undefined) index += 1;
        continue;
      }
      if (pairs.has(name)) {
        index += 2;
        continue;
      }
      return false;
    }
    for (let k = 1; k < value.length; k += 1) {
      const option = `-${value[k]}`;
      if (flags.has(option)) continue;
      if (values.has(option)) {
        if (k === value.length - 1) index += 1;
        break;
      }
      return false;
    }
  }
  return true;
}

function harmlessRedirect(redirect) {
  const target = redirect.target?.value;
  if (redirect.op === '>&' || redirect.op === '<&')
    return /^(?:[0-2]|-)$/u.test(target ?? '');
  if (redirect.op === '>' || redirect.op === '>>')
    return redirect.fd === '2' && target === '/dev/null';
  if (redirect.op === '<') return target === '/dev/null';
  return false;
}

// Block mode: every command is a listed reader with listed options.
function plainSafeRead(analysis) {
  if (!analysis.ok || !analysis.commands.length) return false;
  return analysis.commands.every((entry) => {
    if (
      entry.inline ||
      entry.dynamicProgram ||
      entry.dynamicCode ||
      entry.foreignCode
    )
      return false;
    if (entry.launchers?.length || entry.assignments?.length || entry.stdinArgs)
      return false;
    if (!(entry.redirects || []).every(harmlessRedirect)) return false;
    const spec = Object.hasOwn(SAFE_READERS, entry.program ?? '')
      ? SAFE_READERS[entry.program]
      : null;
    return Boolean(spec) && optionsAllowed(spec, entry.args || []);
  });
}

// The Elicitation guard's plain read: listed readers, no option that runs
// another program, no writing redirection.
export function isReadOnlyInspection(command, shell = 'bash') {
  const analysis = analyzeShell(String(command), shell);
  if (!analysis.ok || !analysis.commands.length) return false;
  return analysis.commands.every((entry) => {
    if (
      entry.inline ||
      entry.dynamicProgram ||
      entry.dynamicCode ||
      entry.foreignCode
    )
      return false;
    if (entry.launchers?.length || entry.stdinArgs) return false;
    if (!(entry.redirects || []).every(harmlessRedirect)) return false;
    if (!READERS.has(entry.program ?? '')) return false;
    // An option that runs another program (lib/shell-programs.js).
    return !localProgramReach(entry).runs;
  });
}

// The decision for a shell command that may name protected paths:
// { deny, reason, unchecked } where `unchecked` is a lib/unchecked.js reason
// for a command that passed without being read.
export function protectedShellDecision(
  toolName,
  input,
  root = process.cwd(),
  options = {},
) {
  const none = { deny: false, reason: null, unchecked: null };
  if (!SHELL_TOOLS.has(toolName) || typeof input?.command !== 'string')
    return none;
  const opts = controlOptions(root, options);
  const mode = options.mode || uncertainMode(opts.env);
  const command = input.command;
  const shell = shellOf(toolName);
  const isProtected = protectedWordTest(root, opts);
  const namesProtected = commandNamesClaudeControl(command, root, opts);
  const readings = shellReadings(command, shell).filter(
    (reading) => reading.ok,
  );
  // A path an option names only with its value attached (`-C/…/.claude`,
  // `unzip -d/…`, `7z -o/…`) is named too, as the shared reader reads it.
  const optionNamed = (entry) =>
    optionWrites(entry).some((word) => isProtected(pathWord(word.value))) ||
    optionWritesInto(entry).some((dir) =>
      extractsIntoProtected(dir, { isProtected }),
    );
  const tokenNamed = readings.some((reading) =>
    reading.commands.some(
      (entry) =>
        words(entry).some(isProtected) ||
        (entry.redirects || []).some((redirect) =>
          isProtected(redirect.target),
        ) ||
        optionNamed(entry),
    ),
  );
  if (!namesProtected && !tokenNamed) return none;
  if (mode === 'block') {
    // The shell's own reading decides; it must be a plain read.
    return plainSafeRead(analyzeShell(command, shell))
      ? none
      : { deny: true, reason: PROTECTED_SHELL_BLOCK_REASON, unchecked: null };
  }
  if (!readings.length)
    return { deny: false, reason: null, unchecked: 'unparseable' };
  const ctx = {
    isProtected,
    lineNamesProtected: namesProtected || tokenNamed,
    depth: 0,
  };
  let effect = null;
  for (const reading of readings)
    for (const entry of reading.commands)
      effect = worse(effect, protectedEffect(entry, ctx));
  if (effect === WRITE)
    return { deny: true, reason: PROTECTED_SHELL_DENY_REASON, unchecked: null };
  // Names a protected path, but what it does to it can't be read: it runs,
  // with the notice (principle 4; block mode denied above).
  if (effect === UNCERTAIN)
    return { deny: false, reason: null, unchecked: 'script-or-interpreter' };
  return none;
}

// ---------------------------------------------------------------------------
// The ZeroH CLI from a model's shell (a UX layer since rc.2; Astra R3/R6).
//
// The enforcement is in the CLI itself: every state-changing subcommand
// requires the user's authority (lib/user-authority.js). This check only
// answers early, with a clear message, when a command plainly runs a
// management subcommand: the CLI by any path or launcher, in command position
// (`zeroh-disclosure proxy off`, `env -u X zeroh-disclosure …`, `node
// …/bin/zeroh-disclosure.mjs …`, `npx zeroh-disclosure …`, `$(which
// zeroh-disclosure) …`, `bash -c "…"`), or after a program ZeroH does not
// know followed by a known management subcommand. A quoted argument is text
// unless an interpreter runs it (`rg 'zeroh-disclosure proxy off' README.md`).

export const MANAGEMENT_DENY_REASON =
  'ZeroH Disclosure settings can only be changed by the user (proxy, doctor, uninstall, allow, settings, unmask caps, vault, receipts, banner). Do not run the ZeroH CLI yourself or try another way; tell the user the exact slash command to type, for example /zeroh-disclosure:proxy off. A person can also run it in their own terminal.';

const ZEROH_CLI_NAMES = new Set([
  'zeroh-disclosure',
  'zeroh-disclosure.mjs',
  'zeroh-disclosure.js',
  'zeroh-disclosure.ps1',
]);
const ZEROH_CLI_READ_ONLY = new Set([
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
  'banner',
  'uninstall',
  'settings',
  'authorize',
]);
const MANAGEMENT = new Set(ZEROH_MANAGEMENT_SUBCOMMANDS);
// Runners that start a script or package named by a later word.
const CLI_RUNNERS = new Set([
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
const RUNNER_WORDS = new Set(['exec', 'dlx', 'x', 'run', 'run-script']);
// Programs whose arguments are text: a CLI name among them is data.
const TEXT_PROGRAMS = new Set([
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

function cliWord(word) {
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

function subcommandAfter(list, index) {
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

function entryRunsManagement(entry) {
  const all = words(entry);
  if (!all.length) return false;
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
    const sub = subcommandAfter(all, start);
    if (sub !== undefined && !ZEROH_CLI_READ_ONLY.has(sub)) return true;
  }
  if (TEXT_PROGRAMS.has(entry.program ?? '') || entry.lookupOnly) return false;
  // An unknown wrapper: the CLI name anywhere, then a known management word.
  for (let k = 0; k < all.length; k += 1) {
    if (!cliWord(all[k])) continue;
    const sub = subcommandAfter(all, k);
    if (sub !== undefined && MANAGEMENT.has(sub)) return true;
  }
  return false;
}

const UNREADABLE_CLI_RE =
  /(?:^|[\s;&|`(])(?:[^\s;&|`()'"]*[\\/])?zeroh-disclosure(?:\.mjs|\.js|\.cmd|\.ps1|\.exe)?\s+(?:-\S+\s+)*(\w+)/iu;

export function commandRunsZeroHManagement(command, shell = 'bash') {
  const text = String(command);
  if (!/zeroh-disclosure/iu.test(text)) return false;
  const readings = shellReadings(text, shell).filter((reading) => reading.ok);
  if (!readings.length) {
    // Unreadable: the plain spelling at a command start still counts.
    const plain = UNREADABLE_CLI_RE.exec(text);
    return Boolean(plain && MANAGEMENT.has(plain[1].toLowerCase()));
  }
  return readings.some((reading) => reading.commands.some(entryRunsManagement));
}
const CLAUDE_CLI_RE =
  /(?:^|[\s(`'"])(?:[^\s;&|'"`()]*[\\/])?claude(?:-code)?(?:\.exe|\.cmd|\.ps1)?(?=$|[\s'"])/iu;
const PLUGIN_CLI_RE =
  /\bplugins?\b(?:\s+marketplace)?\s+(?:[-\w=]+\s+)*?(?:disable|uninstall|remove|rm)\b/iu;
const CONFIG_CLI_RE = /\bconfig\s+(?:[-\w=]+\s+)*?(?:set|add|remove|rm)\b/iu;
const MANAGED_SETTINGS_RE = /^managed-settings\.json$/iu;
const SETTINGS_BASENAME_RE = /^settings(?:\.local)?\.json$/iu;

function claudeConfigDirectory(env, pathImpl) {
  return env.CLAUDE_CONFIG_DIR
    ? pathImpl.resolve(env.CLAUDE_CONFIG_DIR)
    : pathImpl.join(env.HOME || env.USERPROFILE || os.homedir(), '.claude');
}

function controlOptions(root, options = {}) {
  if (options.resolvedControl) return options;
  const platform = options.platform || process.platform;
  const pathImpl =
    options.pathImpl || (platform === 'win32' ? path.win32 : path);
  const env = options.env || process.env;
  const configDir =
    options.claudeConfigDir || claudeConfigDirectory(env, pathImpl);
  const settingsPath =
    options.settingsPath || resolveClaudeSettingsPath({ env, platform });
  const pluginDirs = [
    options.pluginDir || PLUGIN_ROOT,
    env.CLAUDE_PLUGIN_ROOT,
    pathImpl.join(configDir, 'plugins'),
  ].filter(Boolean);
  return {
    resolvedControl: true,
    mode: options.mode,
    platform,
    pathImpl,
    env,
    configDir,
    settingsPath,
    pluginDirs,
    root,
  };
}

function samePath(a, b, { platform }) {
  return comparisonKey(a, platform) === comparisonKey(b, platform);
}

// 'settings' for a Claude Code settings file, 'plugin' for ZeroH's own files
// and installed plugins, else null.
export function claudeControlKind(value, root, options = {}) {
  if (typeof value !== 'string' || !value) return null;
  const opts = controlOptions(root, options);
  const { pathImpl } = opts;
  const pair = resolvedPair(value, root, pathImpl);
  for (const candidate of [pair.lexical, pair.real]) {
    const base = pathImpl.basename(candidate);
    if (/\.zeroh-restore\.json$/iu.test(base)) return 'plugin';
    if (MANAGED_SETTINGS_RE.test(base)) return 'settings';
    if (
      SETTINGS_BASENAME_RE.test(base) &&
      pathImpl.basename(pathImpl.dirname(candidate)).toLowerCase() === '.claude'
    ) {
      return 'settings';
    }
    for (const settings of [
      opts.settingsPath,
      pathImpl.join(opts.configDir, 'settings.json'),
      pathImpl.join(opts.configDir, 'settings.local.json'),
    ]) {
      const settingsPair = resolvedPair(settings, root, pathImpl);
      if (
        samePath(candidate, settingsPair.lexical, opts) ||
        samePath(candidate, settingsPair.real, opts)
      ) {
        return 'settings';
      }
    }
    for (const directory of opts.pluginDirs) {
      const dirPair = resolvedPair(directory, root, pathImpl);
      if (
        inside(candidate, dirPair.lexical, opts) ||
        inside(candidate, dirPair.real, opts)
      ) {
        return 'plugin';
      }
    }
  }
  return null;
}

function parseSettingsText(text) {
  const value = JSON.parse(String(text).replace(/^﻿/u, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('settings root is not an object');
  }
  return value;
}

function applyEdit(current, edit) {
  const oldString = edit?.old_string;
  const newString = edit?.new_string;
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return null;
  }
  if (oldString === '') return current === '' ? newString : null;
  if (!current.includes(oldString)) return null;
  return edit.replace_all
    ? current.split(oldString).join(newString)
    : current.replace(oldString, () => newString);
}

// The settings document a file tool would leave behind, or null when that
// cannot be worked out (which denies the call).
function proposedSettings(toolName, input, target, readFile) {
  let current = '';
  try {
    current = readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') return null;
  }
  let next = null;
  if (toolName === 'Write') {
    next = typeof input?.content === 'string' ? input.content : null;
  } else if (toolName === 'Edit') {
    next = applyEdit(current, input);
  } else if (toolName === 'MultiEdit' && Array.isArray(input?.edits)) {
    next = current;
    for (const edit of input.edits) {
      next = next === null ? null : applyEdit(next, edit);
    }
  }
  if (next === null) return null;
  let before = {};
  try {
    before = current.trim() ? parseSettingsText(current) : {};
  } catch {
    before = {};
  }
  try {
    return { before, after: parseSettingsText(next) };
  } catch {
    return null;
  }
}

function truthy(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function elicitationHooks(document) {
  const hooks = document?.hooks;
  if (!hooks || typeof hooks !== 'object') return {};
  return Object.fromEntries(
    Object.entries(hooks).filter(([event]) =>
      /^elicitation/iu.test(String(event).trim()),
    ),
  );
}

function entriesMatching(object, pattern) {
  if (!object || typeof object !== 'object') return {};
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => pattern.test(key)),
  );
}

// True when the change would switch ZeroH off, touch any status line, move
// the environment its hooks run in, or let something else answer the unmask
// dialog.
export function settingsChangeWeakensZeroH(before, after) {
  const b = before || {};
  const a = after || {};
  if (truthy(a.disableAllHooks) && !truthy(b.disableAllHooks)) return true;
  if (truthy(a.allowManagedHooksOnly) && !truthy(b.allowManagedHooksOnly)) {
    return true;
  }
  if (stable(elicitationHooks(a)) !== stable(elicitationHooks(b))) return true;
  // ZeroH's status line says whether the session is protected. The model
  // may not add, change or remove a `statusLine` in any settings file: a new
  // one in a higher scope would shadow ZeroH's, and a changed one could run
  // anything. Only the user changes it (/zeroh-disclosure:settings
  // statusline, or /statusline).
  if (stable(a.statusLine) !== stable(b.statusLine)) return true;
  const pluginsBefore = entriesMatching(b.enabledPlugins, ZEROH_PLUGIN_ID_RE);
  const pluginsAfter = entriesMatching(a.enabledPlugins, ZEROH_PLUGIN_ID_RE);
  for (const id of new Set([
    ...Object.keys(pluginsBefore),
    ...Object.keys(pluginsAfter),
  ])) {
    if (pluginsAfter[id] !== pluginsBefore[id] && pluginsAfter[id] !== true) {
      return true;
    }
  }
  if (
    stable(entriesMatching(a.env, CLAUDE_CONTROL_ENV_RE)) !==
    stable(entriesMatching(b.env, CLAUDE_CONTROL_ENV_RE))
  ) {
    return true;
  }
  return false;
}

export function commandRunsClaudeControlCli(command) {
  for (const segment of String(command).split(/[;&|\r\n]+/u)) {
    if (!CLAUDE_CLI_RE.test(segment)) continue;
    const afterCli = segment.slice(segment.search(CLAUDE_CLI_RE));
    if (PLUGIN_CLI_RE.test(afterCli) || CONFIG_CLI_RE.test(afterCli)) {
      return true;
    }
  }
  return false;
}

function commandNamesClaudeControl(command, root, opts) {
  const text = String(command);
  if (
    /(?:^|[\s'"=:/\\])\.?claude[/\\](?:settings(?:\.local)?\.json|plugins\b)/iu.test(
      text,
    )
  ) {
    return true;
  }
  if (/managed-settings\.json|zeroh-restore\.json/iu.test(text)) return true;
  if (
    /(?:\$env:|\$\{?|%)(?:ZEROH_CLAUDE_SETTINGS|CLAUDE_CONFIG_DIR|CLAUDE_PLUGIN_ROOT)(?:\}|%|\b)/iu.test(
      text,
    )
  ) {
    return true;
  }
  const normalized = comparisonKey(text, opts.platform);
  for (const location of [opts.settingsPath, ...opts.pluginDirs]) {
    const pair = resolvedPair(location, root, opts.pathImpl);
    for (const entry of [pair.lexical, pair.real]) {
      if (normalized.includes(comparisonKey(entry, opts.platform))) return true;
    }
  }
  for (const raw of text.split(/[\s'"=<>|;&(){}]+/u)) {
    const word = raw.replace(/\\([ .])/gu, '$1');
    if (word && claudeControlKind(word, root, opts)) return true;
  }
  return false;
}

export function deniesClaudeControlChange(
  toolName,
  input,
  root = process.cwd(),
  options = {},
) {
  const opts = controlOptions(root, options);
  const readFile = options.readFile || readFileSync;
  if (MODEL_EDIT_TOOLS.has(toolName) || toolName === 'NotebookEdit') {
    const target = input?.file_path || input?.notebook_path || input?.path;
    const kind = claudeControlKind(target, root, opts);
    if (!kind) return false;
    if (kind === 'plugin' || toolName === 'NotebookEdit') return true;
    const absolute = opts.pathImpl.resolve(root, target);
    const proposed = proposedSettings(toolName, input, absolute, readFile);
    return (
      !proposed || settingsChangeWeakensZeroH(proposed.before, proposed.after)
    );
  }
  if (SHELL_TOOLS.has(toolName) && typeof input?.command === 'string') {
    if (commandRunsClaudeControlCli(input.command)) return true;
    return protectedShellDecision(toolName, input, root, opts).deny;
  }
  return false;
}
