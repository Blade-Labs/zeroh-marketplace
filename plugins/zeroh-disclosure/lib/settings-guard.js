// SPDX-License-Identifier: AGPL-3.0-only

// Static string checks cannot stop a determined shell from constructing a
// protected path at runtime. They raise the bar and make direct attempts
// visible to the user through a denied tool call.
import { SHELL_TOOLS } from './shell-tools.js';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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

  const resolvedHome = comparisonKey(pathImpl.resolve(home), platform);
  if (comparisonKey(value, platform).includes(resolvedHome)) return true;

  for (const raw of value.split(/[\s'"=<>|;&(){}]+/)) {
    const word = raw.replace(/\\([ .])/g, '$1');
    if (word && isZeroHSettingsPath(word, root, { platform, pathImpl, home }))
      return true;
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

function commandWritesElicitationHook(command, root) {
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
  // programs. Once a protected path and hook keyword are both present, only a
  // narrow, operator-free set of inspection commands is safe to allow.
  return !/^\s*(?:cat|rg|grep|Get-Content|Select-String)\b[^;&|<>]*$/iu.test(
    command,
  );
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
    return commandWritesElicitationHook(input.command, root);
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
    return textReferencesZeroHSettings(input.command, root);
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

const CLAUDE_CONTROL_ENV_RE = /^(?:ZEROH_.*|ANTHROPIC_BASE_URL)$/iu;
const ZEROH_PLUGIN_ID_RE = /^zeroh-disclosure(?:@|$)/iu;
const READ_ONLY_COMMAND_RE =
  /^\s*(?:cat|head|tail|less|more|grep|egrep|fgrep|rg|jq|ls|stat|wc|file|Get-Content|gc|Select-String|sls|Get-Item|Get-ChildItem|Test-Path)\b[^;&|<>`\r\n]*$/iu;
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

// True when the change would switch ZeroH off or let something else answer
// the unmask dialog.
export function settingsChangeWeakensZeroH(before, after) {
  const b = before || {};
  const a = after || {};
  if (truthy(a.disableAllHooks) && !truthy(b.disableAllHooks)) return true;
  if (truthy(a.allowManagedHooksOnly) && !truthy(b.allowManagedHooksOnly)) {
    return true;
  }
  if (stable(elicitationHooks(a)) !== stable(elicitationHooks(b))) return true;
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
    const command = input.command;
    if (commandRunsClaudeControlCli(command)) return true;
    if (!commandNamesClaudeControl(command, root, opts)) return false;
    return !(READ_ONLY_COMMAND_RE.test(command) && !/\$\(/u.test(command));
  }
  return false;
}
