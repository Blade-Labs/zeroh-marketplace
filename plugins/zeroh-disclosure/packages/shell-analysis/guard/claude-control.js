// SPDX-License-Identifier: AGPL-3.0-only

import { SHELL_TOOLS } from '../shell-tools.js';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudeSettingsPath } from '../claude-settings.js';
import {
  MODEL_EDIT_TOOLS,
  PLUGIN_ROOT,
  comparisonKey,
  inside,
  resolvedPair,
  ignoredControlPath,
  isZeroHSettingsPath,
  SETTINGS_DENY_REASON,
} from './protected-paths.js';
import { protectedShellDecision } from './plain-safe-reads.js';
import {
  CLAUDE_CONTROL_ENV_RE,
  ZEROH_PLUGIN_ID_RE,
} from './explicit-writes.js';

export const CLAUDE_CLI_RE =
  /(?:^|[\s(`'"])(?:[^\s;&|'"`()]*[\\/])?claude(?:-code)?(?:\.exe|\.cmd|\.ps1)?(?=$|[\s'"])/iu;
export const PLUGIN_CLI_RE =
  /\bplugins?\b(?:\s+marketplace)?\s+(?:[-\w=]+\s+)*?(?:disable|uninstall|remove|rm)\b/iu;
export const CONFIG_CLI_RE =
  /\bconfig\s+(?:[-\w=]+\s+)*?(?:set|add|remove|rm)\b/iu;
export const MANAGED_SETTINGS_RE = /^managed-settings\.json$/iu;
export const SETTINGS_BASENAME_RE = /^settings(?:\.[^/\\]+)?\.json$/iu;
export const CLAUDE_HOOKS_DENY_REASON =
  'Claude Code hooks can only be changed by the user: add them with /hooks or in your editor.';

export function claudeConfigDirectory(env, pathImpl) {
  return env.CLAUDE_CONFIG_DIR
    ? pathImpl.resolve(env.CLAUDE_CONFIG_DIR)
    : pathImpl.join(env.HOME || env.USERPROFILE || os.homedir(), '.claude');
}

export function controlOptions(root, options = {}) {
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
    commandCwd: options.commandCwd,
    platform,
    pathImpl,
    env,
    configDir,
    settingsPath,
    pluginDirs,
    root,
  };
}

export function samePath(a, b, { platform }) {
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

export function parseSettingsText(text) {
  const value = JSON.parse(String(text).replace(/^﻿/u, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('settings root is not an object');
  }
  return value;
}

export function applyEdit(current, edit) {
  const oldString = edit?.old_string;
  const newString = edit?.new_string;
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    return null;
  }
  if (oldString === '') return current === '' ? newString : null;
  if (!current.includes(oldString)) return null;
  if (
    edit.require_unique &&
    current.indexOf(oldString, current.indexOf(oldString) + 1) !== -1
  )
    return null;
  return edit.replace_all
    ? current.split(oldString).join(newString)
    : current.replace(oldString, () => newString);
}

// The settings document a file tool would leave behind, or null when that
// cannot be worked out (which denies the call).
export function proposedSettings(toolName, input, target, readFile) {
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

// MCP has no shared file-tool schema. Recognise common path fields, including
// nested batches, but never treat arbitrary content or search text as a path.
export function mcpFilePaths(input, found = [], options = {}) {
  if (!input || typeof input !== 'object') return found;
  if (Array.isArray(input)) {
    for (const value of input) mcpFilePaths(value, found, options);
  } else {
    for (const [key, value] of Object.entries(input)) {
      const field = key.replace(/_/gu, '').toLowerCase();
      if (
        /^(?:paths?|filepaths?|file|filename|source(?:path|file|filepath)?|destination(?:path|file|filepath)?|dest(?:path|file)?|target(?:path|file)?|oldpath|newpath|from|to|directory(?:path)?|dir)$/u.test(
          field,
        ) ||
        (/^(?:uri|fileuri)$/u.test(field) &&
          typeof value === 'string' &&
          /^file:/iu.test(value))
      ) {
        if (typeof value === 'string') found.push(value);
        if (Array.isArray(value)) {
          found.push(...value.filter((entry) => typeof entry === 'string'));
        }
      }
      if (value && typeof value === 'object')
        mcpFilePaths(value, found, options);
    }
  }
  return [
    ...new Set(
      found.map((value) => {
        if (!/^file:/iu.test(value)) return value;
        try {
          return fileURLToPath(value, {
            windows: (options.platform || process.platform) === 'win32',
          });
        } catch {
          return value;
        }
      }),
    ),
  ];
}

function mcpFileChangeReason(toolName, input, root, opts, readFile) {
  const operation = String(toolName)
    .split('__')
    .at(-1)
    .replace(/([a-z])([A-Z])/gu, '$1_$2')
    .toLowerCase();
  // Explicit readers do not mutate settings. Unknown operations against a
  // protected path cannot establish their effect and remain user-only.
  const readOnly =
    /^(?:read_(?:file|text_file|media_file|multiple_files)|list_(?:directory|directory_with_sizes|allowed_directories)|directory_tree|get_file_info|search_files|stat|inspect_file)$/u.test(
      operation,
    );
  const destructive =
    /(?:^|_)(?:move|rename|delete|remove|rm|trash|unlink|rmdir)(?:_|$)/u.test(
      operation,
    );
  const targets = mcpFilePaths(input, [], opts);
  for (const target of targets) {
    if (
      isZeroHSettingsPath(target, root, {
        ...opts,
        home: opts.env.ZEROH_HOME,
        read: readOnly,
      })
    )
      return SETTINGS_DENY_REASON;
    if (readOnly) continue;
    const pair = resolvedPair(target, root, opts.pathImpl);
    const kind = claudeControlKind(target, root, opts);
    const protectedDirectory =
      destructive &&
      [
        opts.pathImpl.join(root, '.claude'),
        opts.configDir,
        opts.settingsPath,
        opts.pathImpl.join(root, '.zeroh'),
        opts.env.ZEROH_HOME,
        ...opts.pluginDirs,
      ]
        .filter(Boolean)
        .some((location) => {
          const protectedPair = resolvedPair(location, root, opts.pathImpl);
          return (
            inside(protectedPair.lexical, pair.lexical, opts) ||
            inside(protectedPair.real, pair.real, opts)
          );
        });
    if (!kind && !protectedDirectory) continue;
    if (kind !== 'settings') return SETTINGS_DENY_REASON;
    // Only these complete replacement / literal-edit schemas have an effect
    // we can compare. Moves, deletes, patches and unknown edits are denied.
    let proposed = null;
    if (targets.length === 1 && operation === 'write_file') {
      proposed = proposedSettings(
        'Write',
        { content: input.content },
        pair.lexical,
        readFile,
      );
    } else if (
      targets.length === 1 &&
      operation === 'edit_file' &&
      Array.isArray(input.edits)
    ) {
      // MCP servers differ on first-match versus replace-all semantics. Only
      // unique literal matches have an effect independent of that choice.
      // Whitespace-fuzzy matches cannot be established and remain denied.
      // Claude Code's Edit schema uses snake_case keys.
      const edits = input.edits.map((edit) =>
        Object.fromEntries([
          ['old_string', edit.oldText],
          ['new_string', edit.newText],
          ['replace_all', false],
          ['require_unique', true],
        ]),
      );
      proposed = proposedSettings(
        'MultiEdit',
        { edits },
        pair.lexical,
        readFile,
      );
    }
    const reason = settingsChangeReason(proposed);
    if (reason) return reason;
  }
  return null;
}

function settingsChangeReason(proposed) {
  if (!proposed) return SETTINGS_DENY_REASON;
  if (stable(proposed.before.hooks) !== stable(proposed.after.hooks)) {
    return CLAUDE_HOOKS_DENY_REASON;
  }
  return settingsChangeWeakensZeroH(proposed.before, proposed.after)
    ? SETTINGS_DENY_REASON
    : null;
}

export function truthy(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function elicitationHooks(document) {
  const hooks = document?.hooks;
  if (!hooks || typeof hooks !== 'object') return {};
  return Object.fromEntries(
    Object.entries(hooks).filter(([event]) =>
      /^elicitation/iu.test(String(event).trim()),
    ),
  );
}

export function entriesMatching(object, pattern) {
  if (!object || typeof object !== 'object') return {};
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => pattern.test(key)),
  );
}

// True when the change would switch ZeroH off, touch any status line, move
// the environment its hooks run in, or install/change executable hooks that
// Claude runs outside the model tool guard.
export function settingsChangeWeakensZeroH(before, after) {
  const b = before || {};
  const a = after || {};
  if (truthy(a.disableAllHooks) && !truthy(b.disableAllHooks)) return true;
  if (truthy(a.allowManagedHooksOnly) && !truthy(b.allowManagedHooksOnly)) {
    return true;
  }
  // Hook commands (and prompt/agent hooks) execute outside PreToolUse. The
  // entire hook definition, including matchers, is user-controlled. This also
  // protects removal of ZeroH's own hooks and preserves unchanged hooks when
  // the model edits ordinary settings. User editor writes never call this.
  if (stable(a.hooks) !== stable(b.hooks)) return true;
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

export function commandNamesClaudeControl(
  command,
  root,
  opts,
  ignoredPath = null,
) {
  const text = String(command)
    .split(/([\s'"=<>|;&(){}]+)/u)
    .map((word) =>
      ignoredControlPath(word, ignoredPath, root, opts) ? '' : word,
    )
    .join('');
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

export function claudeControlChangeReason(
  toolName,
  input,
  root = process.cwd(),
  options = {},
) {
  const opts = controlOptions(root, options);
  const readFile = options.readFile || readFileSync;
  if (String(toolName).startsWith('mcp__')) {
    return mcpFileChangeReason(toolName, input, root, opts, readFile);
  }
  if (MODEL_EDIT_TOOLS.has(toolName) || toolName === 'NotebookEdit') {
    const target = input?.file_path || input?.notebook_path || input?.path;
    const kind = claudeControlKind(target, root, opts);
    if (!kind) return null;
    if (kind === 'plugin' || toolName === 'NotebookEdit')
      return SETTINGS_DENY_REASON;
    const absolute = opts.pathImpl.resolve(root, target);
    const proposed = proposedSettings(toolName, input, absolute, readFile);
    return settingsChangeReason(proposed);
  }
  if (SHELL_TOOLS.has(toolName) && typeof input?.command === 'string') {
    if (commandRunsClaudeControlCli(input.command)) return SETTINGS_DENY_REASON;
    const decision = protectedShellDecision(toolName, input, root, {
      ...opts,
      presentationCliPath: options.presentationCliPath,
    });
    return decision.deny ? decision.reason : null;
  }
  return null;
}

export function deniesClaudeControlChange(toolName, input, root, options) {
  return Boolean(claudeControlChangeReason(toolName, input, root, options));
}
