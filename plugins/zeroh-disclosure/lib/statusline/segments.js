// SPDX-License-Identifier: AGPL-3.0-only

// The ZeroH status line (rc.2): one line under Claude Code's prompt that
// always says whether this session is protected.
//
//   🛡️ ZeroH · 🟢 protected · 4 masked · 0 sent · unmask EMAIL 12m · receipt ↗
//
//   🟢 protected   the hooks are healthy and the proxy masks what you type
//   🟡 …           protected in part: files only (no proxy route), the proxy
//                  starts with the first prompt, the proxy is down, the
//                  session is starting, or something passed unchecked this
//                  turn; the line names the fix
//   🔴 …           not protecting: a hook failed, the hooks stopped or never
//                  ran, the vault is paused, the plugin is disabled or
//                  uninstalled, or the state can't be read
//
// Claude Code runs the status line command on every update with a JSON event
// on stdin (session_id, workspace.project_dir, workspace.current_dir). It must
// answer in a few milliseconds, so it asks nothing of the proxy or the vault
// and reads only small files the hooks keep: the session's status.json
// (packages/zeroh-disclosure-core/session-status.js), the unmask grants of the project, the user's
// `proxy off` record and the enabledPlugins entries of Claude Code's
// settings. It prints counts and states only, never a value.
//
// `receipt ↗` is an OSC 8 hyperlink to the session's receipt.html. Terminals
// without OSC 8 show the plain text. Colour follows NO_COLOR and TERM=dumb.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ProtectionState,
  protectionWording,
} from '../../packages/zeroh-disclosure-core/protection-state.js';
import { readUninstallState } from '../../packages/zeroh-disclosure-core/uninstall-marker.js';
import {
  transcriptStartedAt,
  compactionInProgress,
  hooksStopped,
} from './transcript.js';
export {
  compactionInProgress,
  hooksStopped,
  lastCompactBoundaryAt,
  lastHookedEntryAt,
  STOPPED_MS,
  TAIL_BYTES,
} from './transcript.js';

// Node built-ins only, so the status line starts in a few milliseconds. The
// helpers below are copies of packages/zeroh-disclosure-core/private-fs.js (zerohHome, canonicalProjectPath), packages/zeroh-disclosure-core/session.js
// (projectRootFromEnv, encodeProjectPath, sanitizeSid, envSessionId),
// packages/zeroh-disclosure-core/vault.js projectKey, lib/claude-settings.js (resolveClaudeSettingsPath,
// restoreRecordPath), packages/zeroh-disclosure-core/uninstall-marker.js uninstallMarkerPath and
// packages/zeroh-disclosure-core/session-status.js STATUS_FILE and packages/zeroh-disclosure-core/plugin-integrity.js pluginsRoot;
// test/statusline.test.mjs checks each against the original.
export const STATUS_FILE = 'status.json';

export function zerohHome(env = process.env, platform = process.platform) {
  if (env.ZEROH_HOME) return env.ZEROH_HOME;
  if (platform === 'win32') {
    return path.win32.join(
      env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local'),
      'ZeroH',
    );
  }
  return path.posix.join(os.homedir(), '.zeroh');
}

// The one spelling of a project folder that every key is made from: the
// absolute path with symbolic links resolved (a missing tail is kept as
// written). macOS reports /var and /tmp as /private/var and /private/tmp to
// a process's own working directory, and any project may sit under a linked
// folder; Claude Code, a terminal and the hooks can each spell the same
// folder differently, and all must find the same vault, allow list, grants
// and sessions. Windows short names (RUNNER~1) are left as they are.
export function canonicalProjectPath(root) {
  const absolute = path.resolve(root);
  const tail = [];
  let cursor = absolute;
  for (;;) {
    try {
      return path.join(realpathSync(cursor), ...tail);
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) return absolute;
      tail.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

export function encodeProjectPath(root) {
  const resolved = canonicalProjectPath(root);
  const name = resolved.replace(/[^a-zA-Z0-9]/gu, '-');
  if (name.length <= 200) return name;
  let hash = 0;
  for (let index = 0; index < resolved.length; index += 1) {
    hash = ((hash << 5) - hash + resolved.charCodeAt(index)) | 0;
  }
  return `${name.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

export function sanitizeSid(sid) {
  return String(sid)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 64);
}

export function projectKey(projectRoot) {
  return createHash('sha256')
    .update(canonicalProjectPath(projectRoot))
    .digest('hex')
    .slice(0, 16);
}

function isDirectory(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// packages/zeroh-disclosure-core/session.js projectRootFromEnv without CLAUDE_PROJECT_DIR.
export function projectRootFrom(start, env = process.env) {
  const from = path.resolve(start || process.cwd());
  const home = path.resolve(zerohHome(env));
  let registered = new Set();
  try {
    registered = new Set(
      (
        JSON.parse(readFileSync(path.join(home, 'projects.json'), 'utf8'))
          ?.projects ?? []
      )
        .map((entry) => entry?.root)
        .filter((root) => typeof root === 'string')
        .map((root) => canonicalProjectPath(root)),
    );
  } catch {
    // No registry: only the folders under ZEROH_HOME/projects count.
  }
  for (let dir = from; ; dir = path.dirname(dir)) {
    // Compared by canonical path: a linked spelling finds its project.
    if (registered.has(canonicalProjectPath(dir))) return dir;
    if (isDirectory(path.join(home, 'projects', encodeProjectPath(dir)))) {
      return dir;
    }
    if (path.dirname(dir) === dir) return from;
  }
}

export function resolveClaudeSettingsPath(env = process.env) {
  if (env.ZEROH_CLAUDE_SETTINGS) return path.resolve(env.ZEROH_CLAUDE_SETTINGS);
  if (env.CLAUDE_CONFIG_DIR) {
    return path.join(path.resolve(env.CLAUDE_CONFIG_DIR), 'settings.json');
  }
  const home =
    process.platform === 'win32'
      ? env.USERPROFILE || os.homedir()
      : env.HOME || os.homedir();
  return path.join(path.resolve(home), '.claude', 'settings.json');
}

export function restoreRecordPath(settingsPath) {
  const resolved = path.resolve(settingsPath);
  return path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.zeroh-restore.json`,
  );
}

export function uninstallMarkerPath(env = process.env) {
  return path.join(path.resolve(zerohHome(env)), 'uninstalled');
}

export function pluginsRoot(env = process.env) {
  if (env.CLAUDE_CODE_PLUGIN_CACHE_DIR) {
    return path.resolve(env.CLAUDE_CODE_PLUGIN_CACHE_DIR);
  }
  const config = env.CLAUDE_CONFIG_DIR
    ? path.resolve(env.CLAUDE_CONFIG_DIR)
    : path.join(env.HOME || os.homedir(), '.claude');
  return path.join(config, 'plugins');
}

// Claude Code's managed settings file for this OS.
export function managedSettingsPath(
  platform = process.platform,
  env = process.env,
) {
  if (platform === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  if (platform === 'win32') {
    return path.win32.join(
      env.ProgramData || env.PROGRAMDATA || 'C:\\ProgramData',
      'ClaudeCode',
      'managed-settings.json',
    );
  }
  return '/etc/claude-code/managed-settings.json';
}

export const SHIELD = '\u{1F6E1}\u{FE0F}';
const PLUGIN_ID_RE = /^zeroh-disclosure@/u;
// A session whose status file is missing this long after it started never
// ran ZeroH's hooks.
export const NEVER_RAN_MS = 20_000;

// True when the nearest existing folder of `target` is a file: nothing can
// ever be written there. POSIX reports reading below a file as ENOTDIR;
// Windows as ENOENT, like a file not written yet.
function belowAFile(target) {
  for (let dir = path.resolve(target); ; dir = path.dirname(dir)) {
    try {
      return !statSync(dir).isDirectory();
    } catch {
      if (path.dirname(dir) === dir) return false;
    }
  }
}

export function readJson(file, read = readFileSync) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { value: JSON.parse(read(file, 'utf8')) };
    } catch (error) {
      // An antivirus scanner or a writer's rename can hold the file for a
      // moment on Windows: read once more.
      if (attempt === 0 && ['EBUSY', 'EPERM'].includes(error?.code)) continue;
      return { missing: error?.code === 'ENOENT', value: null };
    }
  }
}

// Claude Code's list of installed plugins, which is small; a larger file is
// not read (the status line runs every few seconds).
const INSTALLED_PLUGINS_MAX_BYTES = 1024 * 1024;

function sameProject(left, right, platform = process.platform) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// A user-scope install, or a project or local one of this project.
function appliesToProject(entry, root) {
  if (entry?.scope === 'user') return true;
  if (!['project', 'local'].includes(entry?.scope)) return false;
  return (
    typeof entry.projectPath === 'string' &&
    sameProject(entry.projectPath, root)
  );
}

// The latest time Claude Code installed or updated a ZeroH Disclosure copy
// this session would load: an enabled plugin id (enabledIds) installed for
// the user or this project. Null when that can't be told, so the line stays
// red rather than explain away missing hooks with an unrelated copy.
export function installedAt(root, env) {
  const enabled = enabledIds(root, env);
  if (!enabled.size) return null;
  const file = path.join(pluginsRoot(env), 'installed_plugins.json');
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > INSTALLED_PLUGINS_MAX_BYTES) return null;
  } catch {
    return null;
  }
  const listed = readJson(file).value;
  if (!listed || typeof listed !== 'object') return null;
  let latest = null;
  for (const [id, entries] of Object.entries(listed?.plugins ?? {})) {
    if (!enabled.has(id)) continue;
    for (const entry of [].concat(entries)) {
      if (!appliesToProject(entry, root)) continue;
      for (const field of ['lastUpdated', 'installedAt']) {
        const at = Date.parse(entry?.[field] ?? '');
        if (Number.isFinite(at) && (latest === null || at > latest)) {
          latest = at;
        }
      }
    }
  }
  return latest;
}

export function sessionTranscriptPath({
  root,
  sessionId,
  env = process.env,
} = {}) {
  if (!sessionId) return null;
  if (env.CLAUDE_TRANSCRIPT_PATH) return env.CLAUDE_TRANSCRIPT_PATH;
  const config = env.CLAUDE_CONFIG_DIR
    ? path.resolve(env.CLAUDE_CONFIG_DIR)
    : path.join(env.HOME || os.homedir(), '.claude');
  return path.join(
    config,
    'projects',
    encodeProjectPath(root),
    `${sanitizeSid(sessionId)}.jsonl`,
  );
}

// The one install/session comparison used by the status line, /status and
// doctor. Unknown install or session times never excuse missing hooks.
export function sessionPredatesInstall({
  root,
  env = process.env,
  sessionId = null,
  transcriptPath = null,
  sessionStartedAt = null,
} = {}) {
  const installed = installedAt(path.resolve(root), env);
  if (installed === null) return false;
  const status = sessionId
    ? readJson(
        path.join(
          zerohHome(env),
          'projects',
          encodeProjectPath(root),
          'sessions',
          sanitizeSid(sessionId),
          STATUS_FILE,
        ),
      )
    : { missing: true };
  // A saved session is a resumed process: its SessionStart is authoritative.
  if (!status.missing) {
    const started = Date.parse(
      status.value?.hooks?.['session-start']?.ok_at ?? '',
    );
    return Number.isFinite(started) && started < installed;
  }
  const started = Number.isFinite(sessionStartedAt)
    ? sessionStartedAt
    : transcriptStartedAt(
        transcriptPath ?? sessionTranscriptPath({ root, sessionId, env }),
      );
  return Number.isFinite(started) && started < installed;
}

// The project root the hooks key on (packages/zeroh-disclosure-core/session.js projectRootFromEnv).
// Claude Code's own project dir wins, as CLAUDE_PROJECT_DIR does for hooks.
function projectRootOf(input, env) {
  const workspace = input?.workspace ?? {};
  if (env.CLAUDE_PROJECT_DIR) return env.CLAUDE_PROJECT_DIR;
  if (typeof workspace.project_dir === 'string' && workspace.project_dir) {
    return workspace.project_dir;
  }
  const start =
    (typeof workspace.current_dir === 'string' && workspace.current_dir) ||
    (typeof input?.cwd === 'string' && input.cwd) ||
    process.cwd();
  return projectRootFrom(start, env);
}

// False when the settings Claude Code reads turn every zeroh-disclosure@…
// entry off: user, then project, then local, then managed settings, each
// overriding the one before for the same id; the plugin counts as enabled
// while any id is on or no file names one.
// ZeroH Disclosure plugin ids and whether Claude Code's settings files
// (user, project, local, managed; later ones win) enable them.
function enabledById(
  root,
  env = process.env,
  managedPath = managedSettingsPath(process.platform, env),
) {
  const byId = new Map();
  for (const file of [
    resolveClaudeSettingsPath(env),
    path.join(root, '.claude', 'settings.json'),
    path.join(root, '.claude', 'settings.local.json'),
    managedPath,
  ]) {
    const plugins = readJson(file).value?.enabledPlugins;
    if (!plugins || typeof plugins !== 'object') continue;
    for (const [id, value] of Object.entries(plugins)) {
      if (PLUGIN_ID_RE.test(id)) byId.set(id, value !== false);
    }
  }
  return byId;
}

// The ids settings explicitly enable.
function enabledIds(root, env) {
  return new Set(
    [...enabledById(root, env)].filter(([, on]) => on).map(([id]) => id),
  );
}

export function pluginEnabled(
  root,
  env = process.env,
  managedPath = managedSettingsPath(process.platform, env),
) {
  const byId = enabledById(root, env, managedPath);
  return byId.size === 0 || [...byId.values()].some(Boolean);
}

function proxyTurnedOff(env) {
  const record = readJson(
    restoreRecordPath(resolveClaudeSettingsPath(env)),
  ).value;
  return record?.off === true;
}

// False when the proxy daemon's pid file names a process that is gone.
function proxyAlive(home) {
  const pid = Number(
    readJson(path.join(path.resolve(home), 'proxy', 'daemon.pid')).value?.pid,
  );
  if (!Number.isInteger(pid) || pid < 2) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

// Active unmask grants of the project for this session: { kind, expiresAt }.
// Read without checking the signature: this only shows them, and a forged
// grant would show an unmask that is not there, never hide one.
function grantsFor(home, root, sessionId, now) {
  const document = readJson(
    path.join(path.resolve(home), 'grants', `${projectKey(root)}.json`),
  ).value;
  const grants = document?.store?.grants;
  if (!Array.isArray(grants)) return [];
  return grants
    .filter((grant) => grant && typeof grant.kind === 'string')
    .filter((grant) => {
      if (grant.expires_at === null) {
        return Boolean(sessionId) && grant.session_id === String(sessionId);
      }
      const expires = Date.parse(grant.expires_at);
      return Number.isFinite(expires) && expires > now;
    })
    .map((grant) => ({
      kind: grant.kind.replace(/[^A-Z0-9_]/giu, '').slice(0, 24),
      expiresAt:
        grant.expires_at === null ? null : Date.parse(grant.expires_at),
    }));
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// The hook whose last failure no later success of the same hook cleared.
function failingHook(status) {
  const hooks =
    status.hooks && typeof status.hooks === 'object' ? status.hooks : {};
  for (const [name, entry] of Object.entries(hooks)) {
    const failed = Date.parse(entry?.failed_at ?? '');
    const ok = Date.parse(entry?.ok_at ?? '');
    if (Number.isFinite(failed) && !(ok > failed)) return name;
  }
  return null;
}

function statusSession(input, env, home) {
  const root = path.resolve(projectRootOf(input, env));
  const sessionId =
    (typeof input?.session_id === 'string' && input.session_id) ||
    env.CLAUDE_CODE_SESSION_ID ||
    env.CLAUDE_SESSION_ID ||
    null;
  const dir = sessionId
    ? path.join(
        path.resolve(home),
        'projects',
        encodeProjectPath(root),
        'sessions',
        sanitizeSid(sessionId),
      )
    : null;
  return { root, sessionId, dir };
}

function inputSessionPredatesInstall({ root, sessionId, input, env, now }) {
  const ran = Number(input?.cost?.total_duration_ms);
  return sessionPredatesInstall({
    root,
    env,
    sessionId,
    transcriptPath: input?.transcript_path,
    sessionStartedAt: Number.isFinite(ran) ? now - ran : null,
  });
}

// Everything the line shows, from the files the hooks keep.
//   level  'protected' | 'warn' | 'off'
//   word   what the state is, in a few words
//   fix    what to do about it, or null
export function statuslineModel({
  input = {},
  env = process.env,
  now = Date.now(),
} = {}) {
  const home = zerohHome(env);
  const initial = protectionWording(ProtectionState.STATE_UNREADABLE);
  const model = {
    state: ProtectionState.STATE_UNREADABLE,
    level: initial.level,
    word: initial.word,
    fix: initial.fix,
    masked: 0,
    sent: 0,
    notProtected: 0,
    counts: false,
    grants: [],
    receipt: null,
  };
  const set = (state, counts = null) => {
    const words = protectionWording(state, { count: model.notProtected });
    Object.assign(model, {
      state,
      level: words.level,
      word: words.word,
      fix: words.fix,
      counts: counts ?? words.level !== 'off',
    });
    return model;
  };
  try {
    const removal = readUninstallState(env, now);
    if (removal === 'failed') {
      return set(ProtectionState.REMOVAL_INCOMPLETE);
    }
    if (removal !== 'none') {
      return set(ProtectionState.UNINSTALLED);
    }
    const { root, sessionId, dir } = statusSession(input, env, home);
    model.grants = grantsFor(home, root, sessionId, now);
    if (!pluginEnabled(root, env)) {
      return set(ProtectionState.PLUGIN_DISABLED);
    }
    if (!sessionId) return set(ProtectionState.NO_SESSION);
    const read = readJson(path.join(dir, STATUS_FILE));
    if (read.missing && belowAFile(dir)) {
      return set(ProtectionState.STATE_UNREADABLE);
    }
    if (read.missing) {
      const ran = Number(input?.cost?.total_duration_ms);
      if (Number.isFinite(ran) && ran > NEVER_RAN_MS) {
        if (inputSessionPredatesInstall({ root, sessionId, input, env, now })) {
          return set(ProtectionState.STARTED_BEFORE_ZEROH, false);
        }
        return set(ProtectionState.HOOKS_NEVER_RAN);
      }
      return set(ProtectionState.STARTING, false);
    }
    const status = read.value;
    if (!status || typeof status !== 'object' || status.v !== 1) {
      return set(ProtectionState.STATE_UNREADABLE);
    }
    if (failingHook(status)) return set(ProtectionState.HOOKS_FAILING);
    const heartbeatPath = path.join(dir, 'hooks.alive');
    if (hooksStopped(input?.transcript_path, heartbeatPath)) {
      return set(ProtectionState.HOOKS_STOPPED);
    }
    if (compactionInProgress(input?.transcript_path, heartbeatPath)) {
      return set(ProtectionState.COMPACTING, false);
    }
    if (status.paused === true) return set(ProtectionState.VAULT_UNAVAILABLE);
    if (inputSessionPredatesInstall({ root, sessionId, input, env, now })) {
      return set(ProtectionState.STARTED_BEFORE_ZEROH, false);
    }
    if (status.phase === 'starting')
      return set(ProtectionState.STARTING, false);

    model.masked = count(status.masked);
    model.sent = count(status.sent);
    model.notProtected =
      status.unchecked && status.unchecked.turn === status.turn
        ? count(status.unchecked.count)
        : 0;
    const receipt = path.join(dir, 'receipt.html');
    if (existsSync(receipt)) model.receipt = pathToFileURL(receipt).href;
    if (proxyTurnedOff(env)) {
      const result = set(ProtectionState.FILES_ONLY);
      result.fix = '/zeroh-disclosure:proxy on';
      return result;
    }
    if (status.proxy === 'ready') {
      return set(ProtectionState.PROXY_FIRST_PROMPT);
    }
    // Put behind the proxy by this very prompt: masked from the next one.
    if (status.proxy === 'not-ready') {
      return set(ProtectionState.PROXY_NEXT_PROMPT);
    }
    if (status.proxy === 'upstream-mismatch') {
      return set(ProtectionState.UPSTREAM_MISMATCH);
    }
    if (status.proxy === 'credentials') {
      return set(ProtectionState.BASE_URL_CREDENTIALS);
    }
    if (status.proxy === 'overridden') return set(ProtectionState.OVERRIDDEN);
    if (status.proxy !== 'on') return set(ProtectionState.FILES_ONLY);
    if (!proxyAlive(home)) return set(ProtectionState.PROXY_DOWN);
    if (model.notProtected) {
      return set(ProtectionState.NOT_PROTECTED_TURN);
    }
    return set(ProtectionState.PROTECTED);
  } catch {
    return set(ProtectionState.STATE_UNREADABLE);
  }
}

// "12m", "1h 5m", "session".
export function grantTimeLeft(grant, now = Date.now()) {
  if (grant.expiresAt === null) return 'session';
  const minutes = Math.max(1, Math.ceil((grant.expiresAt - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function colourOn(env = process.env) {
  if (Object.hasOwn(env, 'NO_COLOR')) return false;
  return String(env.TERM || '').toLowerCase() !== 'dumb';
}

// Terminals that print an OSC 8 link's escape codes instead of the link.
export function linksOn(env = process.env) {
  return env.TERM_PROGRAM !== 'Apple_Terminal';
}

// An OSC 8 hyperlink, closed with BEL (the form most terminals accept).
export function hyperlink(url, text) {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}
