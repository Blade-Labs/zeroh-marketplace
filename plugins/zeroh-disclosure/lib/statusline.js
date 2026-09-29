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
// (lib/session-status.js), the unmask grants of the project, the user's
// `proxy off` record and the enabledPlugins entries of Claude Code's
// settings. It prints counts and states only, never a value.
//
// `receipt ↗` is an OSC 8 hyperlink to the session's receipt.html. Terminals
// without OSC 8 show the plain text. Colour follows NO_COLOR and TERM=dumb.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node built-ins only, so the status line starts in a few milliseconds. The
// helpers below are copies of lib/private-fs.js (zerohHome, canonicalProjectPath), lib/session.js
// (projectRootFromEnv, encodeProjectPath, sanitizeSid, envSessionId),
// lib/vault.js projectKey, lib/claude-settings.js (resolveClaudeSettingsPath,
// restoreRecordPath), lib/uninstall-marker.js uninstallMarkerPath and
// lib/session-status.js STATUS_FILE; test/statusline.test.mjs checks each
// against the original.
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

// lib/session.js projectRootFromEnv without CLAUDE_PROJECT_DIR.
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
const DOCTOR = '/zeroh-disclosure:doctor';
const PLUGIN_ID_RE = /^zeroh-disclosure@/u;
// A session whose status file is missing this long after it started never
// ran ZeroH's hooks.
export const NEVER_RAN_MS = 20_000;
// The transcript moved on this long after the last hook ran: the hooks
// stopped (the plugin was disabled mid-session, its files are gone).
export const STOPPED_MS = 30_000;

const DOTS = { protected: '🟢', warn: '🟡', off: '🔴' };
const SGR = { protected: '32', warn: '33', off: '31' };

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

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// The project root the hooks key on (lib/session.js projectRootFromEnv).
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
export function pluginEnabled(
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
  const model = {
    level: 'off',
    word: "state can't be read",
    fix: DOCTOR,
    masked: 0,
    sent: 0,
    notProtected: 0,
    counts: false,
    grants: [],
    receipt: null,
  };
  const set = (level, word, fix = null, counts = level !== 'off') => {
    Object.assign(model, { level, word, fix, counts });
    return model;
  };
  try {
    if (existsSync(uninstallMarkerPath(env))) {
      return set('off', 'uninstalled', 'remove it with /statusline');
    }
    const root = path.resolve(projectRootOf(input, env));
    const sessionId =
      (typeof input?.session_id === 'string' && input.session_id) ||
      env.CLAUDE_CODE_SESSION_ID ||
      env.CLAUDE_SESSION_ID ||
      null;
    model.grants = grantsFor(home, root, sessionId, now);
    if (!pluginEnabled(root, env)) {
      return set('off', 'plugin disabled', 'enable it in /plugin');
    }
    if (!sessionId) return set('off', 'no session');
    const dir = path.join(
      path.resolve(home),
      'projects',
      encodeProjectPath(root),
      'sessions',
      sanitizeSid(sessionId),
    );
    const read = readJson(path.join(dir, STATUS_FILE));
    if (read.missing && belowAFile(dir)) {
      return set('off', "state can't be read", DOCTOR);
    }
    if (read.missing) {
      const ran = Number(input?.cost?.total_duration_ms);
      return Number.isFinite(ran) && ran > NEVER_RAN_MS
        ? set('off', 'hooks never ran', DOCTOR)
        : set('warn', 'starting', null, false);
    }
    const status = read.value;
    if (!status || typeof status !== 'object' || status.v !== 1) {
      return set('off', "state can't be read", DOCTOR);
    }
    if (failingHook(status)) return set('off', 'hooks failing', DOCTOR);
    const transcript =
      typeof input?.transcript_path === 'string'
        ? mtimeOf(input.transcript_path)
        : null;
    const heartbeat = mtimeOf(path.join(dir, 'hooks.alive'));
    if (
      transcript !== null &&
      heartbeat !== null &&
      transcript - heartbeat > STOPPED_MS
    ) {
      return set('off', 'hooks stopped', DOCTOR);
    }
    if (status.paused === true)
      return set('off', "vault can't be opened", DOCTOR);
    if (status.phase === 'starting')
      return set('warn', 'starting', null, false);

    model.masked = count(status.masked);
    model.sent = count(status.sent);
    model.notProtected =
      status.unchecked && status.unchecked.turn === status.turn
        ? count(status.unchecked.count)
        : 0;
    const receipt = path.join(dir, 'receipt.html');
    if (existsSync(receipt)) model.receipt = pathToFileURL(receipt).href;
    if (proxyTurnedOff(env)) {
      return set('warn', 'files only', '/zeroh-disclosure:proxy on');
    }
    if (status.proxy === 'ready') {
      return set('warn', 'proxy starts with your first prompt');
    }
    // Put behind the proxy by this very prompt: masked from the next one.
    if (status.proxy === 'not-ready') {
      return set('warn', 'proxy on from your next prompt');
    }
    if (status.proxy !== 'on') return set('warn', 'files only', DOCTOR);
    if (!proxyAlive(home)) return set('warn', 'proxy down', DOCTOR);
    if (model.notProtected) {
      return set('warn', `${model.notProtected} not protected this turn`);
    }
    return set('protected', 'protected');
  } catch {
    return set('off', "state can't be read", DOCTOR);
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

// --- the style (statusline-style.json) -------------------------------------
// How the line looks is the user's (and Claude's, when asked); what it says
// is ZeroH's. <ZEROH_HOME>/statusline-style.json, schema version 1:
//
//   {
//     "version": 1,
//     "fields": ["shield", "name", "state", "fix", "masked", "sent",
//                "notProtected", "unmask", "receipt"],   order, and which show
//     "separator": " · ",                                  at most 5 characters
//     "labels": { "name": "ZeroH", "shield": "🛡️", "masked": "masked",
//                 "sent": "sent", "notProtected": "not protected",
//                 "unmask": "unmask", "receipt": "receipt ↗" },
//     "emoji": true,              the 🛡️ and the 🟢/🟡/🔴 dot
//     "wording": "long",          or "compact" (shorter state words)
//     "colour": true,             colour the state word (NO_COLOR still wins)
//     "onlyWhenNotProtected": false,  print nothing while 🟢
//     "position": "line"          with your own status line (`wrap`): ZeroH's
//                                 part on its own line under yours, or "end":
//                                 after your last line, joined with " · "
//   }
//
// Whatever the style says, while ZeroH is not 🟢 the state and its fix are
// shown (added right after the name when the style leaves them out), a label
// or separator can't carry a state word or a state emoji, and every value is
// checked on every read: anything unknown or invalid falls back to the
// default. The style can change how the state reads, never what it is.
export const STYLE_FILE = 'statusline-style.json';
export const STYLE_VERSION = 1;
export const STYLE_FIELDS = Object.freeze([
  'shield',
  'name',
  'state',
  'fix',
  'masked',
  'sent',
  'notProtected',
  'unmask',
  'receipt',
]);
export const DEFAULT_STYLE = Object.freeze({
  version: STYLE_VERSION,
  fields: STYLE_FIELDS,
  separator: ' · ',
  labels: Object.freeze({
    name: 'ZeroH',
    shield: SHIELD,
    masked: 'masked',
    sent: 'sent',
    notProtected: 'not protected',
    unmask: 'unmask',
    receipt: 'receipt ↗',
  }),
  emoji: true,
  wording: 'long',
  colour: true,
  onlyWhenNotProtected: false,
  position: 'line',
});

// Words and marks only the state may use.
const STATE_MARKS_RE =
  /[\u{1F7E0}-\u{1F7EB}\u{26AA}\u{26AB}\u{2705}\u{2714}\u{274C}\u{274E}\u{26A0}\u{2757}\u{203C}\u{1F534}\u{1F535}]|\b(?:protect\w*|safe|secure\w*|ok|okay|fine|green|files only|starting|proxy|hooks?|installed|uninstalled|disabled|vault|state|doctor)\b/iu;
// eslint-disable-next-line no-control-regex
const CONTROL_RE =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

function safeText(value, max) {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    !CONTROL_RE.test(value) &&
    !STATE_MARKS_RE.test(value)
  );
}

// The style, validated: always a complete, safe style.
export function normaliseStyle(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== STYLE_VERSION) {
    return DEFAULT_STYLE;
  }
  const fields = Array.isArray(raw.fields)
    ? [...new Set(raw.fields.filter((field) => STYLE_FIELDS.includes(field)))]
    : DEFAULT_STYLE.fields;
  const labels = { ...DEFAULT_STYLE.labels };
  if (raw.labels && typeof raw.labels === 'object') {
    for (const key of Object.keys(labels)) {
      if (safeText(raw.labels[key], 24)) labels[key] = raw.labels[key];
    }
  }
  return {
    version: STYLE_VERSION,
    fields: fields.length ? fields : DEFAULT_STYLE.fields,
    separator:
      safeText(raw.separator, 5) && raw.separator !== ''
        ? raw.separator
        : DEFAULT_STYLE.separator,
    labels,
    emoji: typeof raw.emoji === 'boolean' ? raw.emoji : DEFAULT_STYLE.emoji,
    wording: ['long', 'compact'].includes(raw.wording)
      ? raw.wording
      : DEFAULT_STYLE.wording,
    colour: typeof raw.colour === 'boolean' ? raw.colour : DEFAULT_STYLE.colour,
    onlyWhenNotProtected: raw.onlyWhenNotProtected === true,
    position: ['line', 'end'].includes(raw.position)
      ? raw.position
      : DEFAULT_STYLE.position,
  };
}

export function styleFilePath(env = process.env) {
  return path.join(path.resolve(zerohHome(env)), STYLE_FILE);
}

export function readStyle(env = process.env) {
  try {
    return normaliseStyle(readJson(styleFilePath(env)).value);
  } catch {
    return DEFAULT_STYLE;
  }
}

// Shorter state words ("compact"): the same meaning, fewer characters.
const COMPACT_WORDS = {
  protected: 'protected',
  'files only': 'files only',
  'proxy starts with your first prompt': 'proxy next prompt',
  'proxy on from your next prompt': 'proxy next prompt',
  'proxy down': 'proxy down',
  starting: 'starting',
  'hooks failing': 'hooks failing',
  'hooks stopped': 'hooks stopped',
  'hooks never ran': 'no hooks',
  "vault can't be opened": 'vault closed',
  "state can't be read": 'state unreadable',
  'plugin disabled': 'disabled',
  uninstalled: 'uninstalled',
  'no session': 'no session',
};

function stateWord(model, style) {
  if (style.wording !== 'compact') return model.word;
  const match = /^(\d+) not protected this turn$/u.exec(model.word);
  if (match) return `${match[1]} unprotected`;
  return COMPACT_WORDS[model.word] ?? model.word;
}

export function renderStatusline(
  model,
  { env = process.env, now = Date.now(), style = DEFAULT_STYLE } = {},
) {
  let chosen;
  try {
    chosen = normaliseStyle(style);
  } catch {
    chosen = DEFAULT_STYLE;
  }
  const green = model.level === 'protected';
  if (green && chosen.onlyWhenNotProtected) return '';
  const fields = [...chosen.fields];
  // Not 🟢: the state and its fix always show.
  if (!green) {
    if (!fields.includes('state')) {
      const after = Math.max(fields.indexOf('name'), fields.indexOf('shield'));
      fields.splice(after + 1, 0, 'state');
    }
    if (!fields.includes('fix')) {
      fields.splice(fields.indexOf('state') + 1, 0, 'fix');
    }
  }
  const labels = chosen.labels;
  const colour = chosen.colour && colourOn(env);
  const dot = DOTS[model.level] ?? DOTS.off;
  const text = stateWord(model, chosen);
  const word = colour
    ? `\u001b[${SGR[model.level] ?? SGR.off}m${text}\u001b[0m`
    : text;
  const render = {
    shield: () => (chosen.emoji ? labels.shield : null),
    name: () => labels.name,
    state: () => (chosen.emoji ? `${dot} ${word}` : word),
    fix: () => model.fix,
    masked: () => (model.counts ? `${model.masked} ${labels.masked}` : null),
    sent: () => (model.counts ? `${model.sent} ${labels.sent}` : null),
    notProtected: () =>
      model.counts && model.notProtected && !/not protected/u.test(model.word)
        ? `${model.notProtected} ${labels.notProtected}`
        : null,
    unmask: () =>
      model.grants.length
        ? model.grants
            .map(
              (grant) =>
                `${labels.unmask} ${grant.kind} ${grantTimeLeft(grant, now)}`,
            )
            .join(chosen.separator)
        : null,
    receipt: () =>
      model.counts && model.receipt && linksOn(env)
        ? hyperlink(model.receipt, labels.receipt)
        : null,
  };
  const parts = [];
  for (const field of fields) {
    // The shield and the name read as one: "🛡️ ZeroH".
    if (field === 'shield' && fields[fields.indexOf(field) + 1] === 'name') {
      const shield = render.shield();
      if (shield) parts.push(`${shield} ${render.name()}`);
      else parts.push(render.name());
      continue;
    }
    if (field === 'name' && fields[fields.indexOf(field) - 1] === 'shield') {
      continue;
    }
    const value = render[field]();
    if (value) parts.push(value);
  }
  return parts.join(chosen.separator);
}

// --- the data API (--json) ----------------------------------------------------
// `zeroh-disclosure statusline --json` prints this, and it only grows (new
// keys may be added; none is renamed, removed or given a new meaning while
// `schema` stays "zeroh-statusline/1"). docs/statusline.md documents it.
export const JSON_SCHEMA = 'zeroh-statusline/1';

function pluginVersion() {
  try {
    return JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).version;
  } catch {
    return null;
  }
}

export function statuslineData(model) {
  return {
    schema: JSON_SCHEMA,
    plugin_version: pluginVersion(),
    state:
      { protected: 'protected', warn: 'partial', off: 'off' }[model.level] ??
      'off',
    reason: model.word,
    fix: model.fix ?? null,
    counts: model.counts
      ? {
          masked: model.masked,
          sent: model.sent,
          not_protected_this_turn: model.notProtected,
        }
      : null,
    unmask: model.grants.map((grant) => ({
      kind: grant.kind,
      expires_at:
        grant.expiresAt === null
          ? null
          : new Date(grant.expiresAt).toISOString(),
    })),
    receipt: model.receipt
      ? { url: model.receipt, path: fileURLToPath(model.receipt) }
      : null,
  };
}

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function readRaw(stdin) {
  if (typeof stdin === 'string') return stdin;
  if (!stdin || stdin.isTTY) return '';
  let raw = '';
  for await (const chunk of stdin) raw += chunk;
  return raw;
}

function parseInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// The shell Claude Code runs a statusLine command with: /bin/sh on macOS
// and Linux; on Windows Git Bash when it is installed, else PowerShell.
export function statuslineShell(
  env = process.env,
  platform = process.platform,
) {
  if (platform !== 'win32') return true;
  const candidates = [
    env.CLAUDE_CODE_GIT_BASH_PATH,
    ...[
      env.ProgramFiles,
      env['ProgramFiles(x86)'],
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'),
    ]
      .filter(Boolean)
      .map((dir) => path.win32.join(dir, 'Git', 'bin', 'bash.exe')),
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) ?? 'powershell.exe';
}

// How long the user's own status line command may take in `wrap` mode. A
// hard deadline (Astra 1.0.1 A2): spawnSync's timeout only sends SIGTERM and
// then waits, so a command that ignores it, or leaves a child holding its
// output open, would hold back ZeroH's part for as long as it runs.
export const WRAP_DEADLINE_MS = 2000;

// Ends the command and everything it started: its process group on macOS
// and Linux (it runs detached, as a group leader), `taskkill /T /F` on
// Windows.
function killTree(child, platform = process.platform) {
  try {
    if (platform === 'win32')
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

// `wrap`: the user's own status line command, run as Claude Code would run
// it with the same JSON on stdin. Its output without the trailing line end,
// or '' when it fails, runs past the deadline or prints nothing: ZeroH's
// part never breaks the user's line, and the user's never hides ZeroH's.
export function runWrapped(
  command,
  raw,
  { env = process.env, deadlineMs = WRAP_DEADLINE_MS } = {},
) {
  return new Promise((resolve) => {
    let child;
    let out = '';
    let done = false;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child?.stdout?.destroy();
        child?.stdin?.destroy();
        child?.unref();
      } catch {
        // Nothing left to release.
      }
      resolve(value);
    };
    try {
      child = spawn(command, {
        shell: statuslineShell(env),
        env,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish('');
      return;
    }
    timer = setTimeout(() => {
      killTree(child);
      finish('');
    }, deadlineMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stdout.on('error', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => finish(''));
    child.on('close', (status) => finish(status === 0 ? out.trimEnd() : ''));
    child.stdin.end(raw ?? '');
  });
}

// The user's output unchanged, then ZeroH's part: on its own line by
// default (Claude Code shows each printed line as a row, and truncates a long
// row with "…", which would hide a part appended to it), or after the user's
// last line with " · " (`position: "end"`). Either may be empty.
export function joinWrapped(theirs, line, position = DEFAULT_STYLE.position) {
  if (!theirs) return line;
  if (!line) return theirs;
  return position === 'end' ? `${theirs} · ${line}` : `${theirs}\n${line}`;
}

function wrappedArgument(argv) {
  if (argv[0] !== 'wrap' || !/^[A-Za-z0-9_-]+$/u.test(argv[1] ?? ''))
    return null;
  return Buffer.from(argv[1], 'base64url').toString('utf8');
}

// `statusline [segment] [--json] [--session <id>] [--cwd <dir>]`: what
// Claude Code's statusLine command runs (lib/statusline-settings.js), and
// the segment a user adds to their own status line script: `segment` (or
// `--segment`) prints only ZeroH's part, without a line end. `wrap
// <base64url command>` prints the user's own line, ` · `, and ZeroH's part.
export async function statuslineMain(
  argv = [],
  {
    stdin = process.stdin,
    stdout = process.stdout,
    env = process.env,
    now = Date.now(),
  } = {},
) {
  const raw = await readRaw(stdin);
  const input = parseInput(raw);
  const session = argValue(argv, '--session');
  const cwd = argValue(argv, '--cwd');
  if (session) input.session_id = session;
  if (cwd) input.workspace = { ...(input.workspace ?? {}), project_dir: cwd };
  const model = statuslineModel({ input, env, now });
  if (argv.includes('--json')) {
    stdout.write(`${JSON.stringify(statuslineData(model))}\n`);
    return model;
  }
  const style = readStyle(env);
  const line = renderStatusline(model, { env, now, style });
  const wrapped = wrappedArgument(argv);
  if (wrapped !== null) {
    const theirs = await runWrapped(wrapped, raw, { env });
    stdout.write(`${joinWrapped(theirs, line, style.position)}\n`);
    return model;
  }
  const segment = argv.includes('segment') || argv.includes('--segment');
  stdout.write(segment ? line : `${line}\n`);
  return model;
}
