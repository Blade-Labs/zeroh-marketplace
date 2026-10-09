// SPDX-License-Identifier: AGPL-3.0-only

import { SHELL_TOOLS, shellOf } from '../shell-tools.js';
import { analyzeShell } from '../shell-scan.js';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zerohHome } from '../../zeroh-disclosure-core/vault.js';
import { resolveClaudeSettingsPath } from '../claude-settings.js';
import { encodeProjectPath } from '../../zeroh-disclosure-core/session.js';
import { isReadOnlyInspection } from './plain-safe-reads.js';
import {
  commandRunsZeroHManagement,
  commandRunsZeroHPresentation,
  VERIFIED_CLI,
} from './management.js';
import { deniesClaudeControlChange, mcpFilePaths } from './claude-control.js';
import { wordPathValues, words } from './explicit-writes.js';

export const PLUGIN_ROOT = path.dirname(
  path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
);

export const SETTINGS_DENY_REASON =
  'ZeroH Disclosure settings can only be changed by the user. Do not edit or read them; ask the user.';

export const FILE_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Grep',
]);
export const SETTINGS_FILE_RE =
  /(?:allow\.json|vault\.key|allow\.key|unmask\.json|zeroh-restore\.json|grants(?:[\\/]|$))/i;
// Repository settings files the hooks read; the model never writes them.
export const PROJECT_CONFIG_BASENAMES = new Set([
  '.zeroh.env',
  '.zeroh.policy',
]);
export const ALLOW_COMMAND_RE =
  /zeroh-disclosure(?:\.mjs)?[^\r\n;&|]*\ballow\b/i;
export const WINDOWS_HOME_RE =
  /(?:LOCALAPPDATA|AppData[\\/]+Local)[\W_]{0,6}ZeroH(?![\w-])/iu;
export const ANTHROPIC_BASE_URL_RE = /ANTHROPIC_BASE_URL/i;
export const UNMASK_COMMAND_RE =
  /zeroh-disclosure(?:\.mjs)?[^\r\n;&|]*\b(?:unmask|statusline)\b/i;
export const ELICITATION_HOOK_RE = /\bElicitation(?:Result)?\b/u;
export const MODEL_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
// Tools that run a shell command. Monitor runs its command like Bash (its
// output streams back while it runs), so every shell check covers it too.
export { SHELL_TOOLS };

export function comparisonKey(value, platform) {
  let key = String(value);
  if (platform === 'win32') key = key.replace(/\\/g, '/');
  if (platform === 'win32' || platform === 'darwin') key = key.toLowerCase();
  return key;
}

export const STATUSLINE_STYLE_FILE = 'presentation.json';
const STYLE_FILES = [STATUSLINE_STYLE_FILE, 'statusline-style.json'];

export function samePathKey(a, b, { platform }) {
  return comparisonKey(a, platform) === comparisonKey(b, platform);
}

export function inside(candidate, directory, { platform, pathImpl }) {
  const candidateKey = comparisonKey(candidate, platform);
  const directoryKey = comparisonKey(directory, platform);
  const separator = platform === 'win32' ? '/' : pathImpl.sep;
  return (
    candidateKey === directoryKey ||
    candidateKey.startsWith(`${directoryKey}${separator}`)
  );
}

export function realpathWherePossible(absolute, pathImpl) {
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
export function plainFileOrAbsent(file) {
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
  return stat.isFile() && stat.nlink === 1;
}

export function resolvedPair(value, base, pathImpl) {
  const lexical = pathImpl.resolve(base, String(value));
  return { lexical, real: realpathWherePossible(lexical, pathImpl) };
}

export function protectedLocations(root, { home, pathImpl }) {
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
    inside(candidate.lexical, locations.home.real, options) ||
    inside(candidate.real, locations.home.real, options);
  if (!protectedPath) return false;
  // The status line style is the one ZeroH file the model may read and
  // write, when the user asks it to change how the line looks: it can't
  // change what the line says (lib/statusline.js validates it on every
  // read). Only the file itself, never a link to somewhere else: a
  // symbolic link, dangling or not, or a file with other hard links is
  // protected like the rest of the home (Astra rc.2 F11).
  const style = (entry, name) => pathImpl.join(entry, name);
  if (
    STYLE_FILES.some(
      (name) =>
        [
          style(locations.home.lexical, name),
          style(locations.home.real, name),
        ].some((entry) => samePathKey(candidate.lexical, entry, options)) &&
        samePathKey(
          candidate.real,
          style(locations.home.real, name),
          options,
        ) &&
        plainFileOrAbsent(candidate.lexical),
    )
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
    ignoredPath = null,
  } = {},
) {
  const value = String(text);
  const ignored = (candidate) =>
    ignoredControlPath(candidate, ignoredPath, root, { platform, pathImpl });
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
    if (
      word &&
      !ignored(word) &&
      isZeroHSettingsPath(word, root, { platform, pathImpl, home })
    )
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
            !ignored(candidate) &&
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

export function isClaudeSettingsOrHookPath(
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
export function decodeEscapes(value) {
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

export function mentionsElicitation(value) {
  return (
    ELICITATION_HOOK_RE.test(value) ||
    ELICITATION_HOOK_RE.test(decodeEscapes(value))
  );
}

export function commandWritesElicitationHook(command, root, shell = 'bash') {
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

export function stringsIn(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value))
    value.forEach((entry) => stringsIn(entry, found));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((entry) => stringsIn(entry, found));
  return found;
}

export function isProjectClaudeSettings(value, root, { platform, pathImpl }) {
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
  'uninstall',
]);

export const USER_ONLY_DENY_REASON =
  'ZeroH Disclosure: only the user can run this command. Do not run it yourself or try another way; tell the user the exact slash command to type.';

export const USER_ONLY_COMMAND_RE = new RegExp(
  `^/?(?:[\\w.-]+:)*zeroh-disclosure:(${USER_ONLY_COMMANDS.join('|')})$`,
  'iu',
);
export const UNMASK_COMMAND_NAME_RE =
  /^\/?(?:[\w.-]+:)*zeroh-disclosure:unmask$/iu;
export const SETTINGS_COMMAND_NAME_RE =
  /^\/?(?:[\w.-]+:)*zeroh-disclosure:settings$/iu;

function modelMayRunSettings(args) {
  const words = String(args).trim().split(/\s+/u).filter(Boolean);
  return (
    (words[0] === 'banner' && words.length >= 2) ||
    (words[0] === 'statusline' && words[1] === 'style')
  );
}

// The command name and its arguments from a Skill ({skill, args}) or
// SlashCommand ({command: "/name args"}) input.
export function slashInvocation(toolName, input) {
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
  if (SETTINGS_COMMAND_NAME_RE.test(name)) {
    return !modelMayRunSettings(invocation.args);
  }
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
  const presentation =
    SHELL_TOOLS.has(toolName) &&
    typeof input?.command === 'string' &&
    commandRunsZeroHPresentation(
      input.command,
      shellOf(toolName),
      options.commandCwd ?? root,
      options.styleKey,
      options.bannerModes,
    );
  if (
    deniesClaudeControlChange(toolName, input, root, {
      ...options,
      presentationCliPath: presentation ? VERIFIED_CLI : null,
    })
  )
    return true;
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
        ignoredPath: presentation ? VERIFIED_CLI : null,
      })
    );
  if (String(toolName).startsWith('mcp__')) {
    // Structured file inputs were compared above. Content mentioning a
    // protected filename is ordinary text, not a mutation of that filename.
    const targets = mcpFilePaths(input);
    if (targets.length) {
      // Some MCP wrappers accept shell-quoted paths. Keep the existing refusal
      // of quoted ZeroH state references without scanning document content.
      return targets.some(
        (target) =>
          /['"]/u.test(target) && textReferencesZeroHSettings(target, root),
      );
    }
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
// executable hook. File tools are checked by parsing the resulting JSON, so
// escapes and key order do not matter. Shell commands that name these files
// are allowed only when they provably only read.

// Claude Code applies a settings file's `env` to its own process, so to every
// hook and statusLine command it starts: these would move ZeroH's home or
// Claude's, change which programs or modules run, or route around the proxy.

export function ignoredControlPath(
  candidate,
  ignoredPath,
  root,
  { platform, pathImpl },
) {
  if (!ignoredPath) return false;
  const options = { platform, pathImpl };
  const left = resolvedPair(candidate, root, pathImpl);
  const right = resolvedPair(ignoredPath, root, pathImpl);
  return (
    samePathKey(left.lexical, right.lexical, options) ||
    samePathKey(left.real, right.real, options)
  );
}
