// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from '../../packages/zeroh-disclosure-core/child-process.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHIELD,
  colourOn,
  grantTimeLeft,
  hyperlink,
  linksOn,
  readJson,
  statuslineModel,
  zerohHome,
} from './segments.js';
import {
  ProtectionState,
  protectionWording,
} from '../../packages/zeroh-disclosure-core/protection-state.js';
import {
  removeQuietly,
  writePrivateJson,
} from '../../packages/zeroh-disclosure-core/private-fs.js';
import {
  wrappedCacheFile,
  readWrappedCache,
  writeWrappedCache,
} from '../statusline-cache.js';
export { WRAP_CACHE_STALE_MS } from '../statusline-cache.js';

const DOTS = { protected: '🟢', warn: '🟡', off: '🔴' };
const SGR = { protected: '32', warn: '33', off: '31' };

// --- the style (presentation.json) -------------------------------------
// How the line looks is the user's (and Claude's, when asked); what it says
// is ZeroH's. <ZEROH_HOME>/presentation.json, schema version 1:
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
export const STYLE_FILE = 'presentation.json';
const LEGACY_STYLE_FILE = 'statusline-style.json';
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
  receiptFormat: 'text',
  reportFormat: 'text',
  verbosity: 'normal',
});

// Words and marks only the state may use.
const STATE_MARKS_RE =
  /[\u{1F7E0}-\u{1F7EB}\u{26AA}\u{26AB}\u{2705}\u{2714}\u{274C}\u{274E}\u{26A0}\u{2757}\u{203C}\u{1F534}\u{1F535}]|\b(?:protect\w*|safe|secure\w*|ok|okay|fine|green|files only|start(?:ed|ing)|proxy|hooks?|installed|uninstalled|disabled|vault|state|doctor)\b/iu;
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
    receiptFormat: ['text', 'json', 'html'].includes(raw.receiptFormat)
      ? raw.receiptFormat
      : DEFAULT_STYLE.receiptFormat,
    reportFormat: ['text', 'json', 'html'].includes(raw.reportFormat)
      ? raw.reportFormat
      : DEFAULT_STYLE.reportFormat,
    verbosity: ['concise', 'normal', 'detailed'].includes(raw.verbosity)
      ? raw.verbosity
      : DEFAULT_STYLE.verbosity,
  };
}

export function styleFilePath(env = process.env) {
  return path.join(path.resolve(zerohHome(env)), STYLE_FILE);
}

export function readStyle(env = process.env) {
  try {
    const file = styleFilePath(env);
    const legacy = path.join(path.dirname(file), LEGACY_STYLE_FILE);
    if (!existsSync(file)) {
      const old = readJson(legacy);
      if (old.value && typeof old.value === 'object') {
        writePrivateJson(file, old.value);
        removeQuietly(legacy);
      }
    }
    return normaliseStyle(readJson(file).value);
  } catch {
    return DEFAULT_STYLE;
  }
}

function stateWord(model, style) {
  return protectionWording(model.state ?? ProtectionState.STATE_UNREADABLE, {
    compact: style.wording === 'compact',
    count: model.notProtected,
  }).word;
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
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
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
export const WRAP_DEADLINE_MS = 4000;

// Ends the command and everything it started: its process group on macOS
// and Linux (it runs detached, as a group leader), `taskkill /T /F` on
// Windows.
export function killTree(child, platform = process.platform) {
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
  {
    env = process.env,
    deadlineMs = WRAP_DEADLINE_MS,
    platform = process.platform,
    cacheFile = null,
    now = Date.now(),
  } = {},
) {
  return new Promise((resolve) => {
    let child;
    let out = '';
    let done = false;
    let timer = null;
    const cached = cacheFile ? readWrappedCache(cacheFile, now) : '';
    const finish = (value, good = false) => {
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
      if (good && value && cacheFile) writeWrappedCache(cacheFile, value, now);
      resolve(value || cached);
    };
    try {
      child = spawn(command, {
        shell: statuslineShell(env, platform),
        env,
        detached: platform !== 'win32',
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish('');
      return;
    }
    timer = setTimeout(() => {
      killTree(child, platform);
      finish(out.trimEnd());
    }, deadlineMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stdout.on('error', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => finish(''));
    child.on('close', (status) => {
      const output = out.trimEnd();
      finish(output, status === 0 && Boolean(output));
    });
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
    const theirs = await runWrapped(wrapped, raw, {
      env,
      now,
      cacheFile: wrappedCacheFile(env, input.session_id),
    });
    stdout.write(`${joinWrapped(theirs, line, style.position)}\n`);
    return model;
  }
  const segment = argv.includes('segment') || argv.includes('--segment');
  stdout.write(segment ? line : `${line}\n`);
  return model;
}
