// SPDX-License-Identifier: AGPL-3.0-only

import {
  readRecord,
  writeRecord,
  recordChoice,
  recordStatuslineWrite,
  pruneStatuslineRestore,
  restoreExactBytes,
} from './statusline-record.js';
export {
  readRecord,
  writeRecord,
  recordChoice,
  recordStatuslineWrite,
  choiceFor,
} from './statusline-record.js';
// ZeroH's entry in Claude Code's `statusLine` setting (rc.2): the command,
// recognising it, turning it on and off, and the records that let every
// copy be found and removed again.
//
// Who writes it: the first prompt of the first ZeroH session, when the user
// has no status line (lib/first-run.js, owner decision D-26), and the
// user's own `/zeroh-disclosure:settings statusline on`. Only the user turns
// it off; the settings guard stops the model changing any `statusLine`.
//
// The command. ${CLAUDE_PLUGIN_ROOT} is not expanded in `statusLine`, and
// the plugin's folder changes with every version, so the entry is one
// self-contained `node -e` script (STATUSLINE_COMMAND), the minimal resolver:
//   - it runs lib/statusline.js from a plugin root it trusts: a root Claude
//     Code lists as an installPath of zeroh-disclosure@… in
//     <CLAUDE_CONFIG_DIR or ~/.claude>/plugins/installed_plugins.json, or one
//     under <CLAUDE_CODE_PLUGIN_CACHE_DIR or …/plugins/cache>/<marketplace>/
//     zeroh-disclosure/. The root the last SessionStart recorded for this
//     config dir (<ZEROH_HOME>/plugin-root.json) is preferred when it is one
//     of those; any other root (a --plugin-dir checkout) only with
//     ZEROH_STATUSLINE_DEV=1 in the environment;
//   - with no plugin to run (removed without `uninstall`) it prints
//     `🛡️ ZeroH · 🔴 not installed · remove it with /statusline`, and nothing
//     in segment mode;
//   - a positional `segment` argument prints only ZeroH's part, without a
//     line end, for a status line script of the user's own.
// The script has no `$`, backquote, double quote or bare backslash, so Bash,
// Git Bash, PowerShell 7 and Windows PowerShell 5.1 (Claude Code uses Git
// Bash on Windows when installed, else PowerShell) pass it to node unchanged.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, writeSettingsFile } from './claude-settings.js';
import {
  readJsonOr,
  writePrivateJson,
} from '../packages/zeroh-disclosure-core/private-fs.js';

export const PLUGIN_ROOT_FILE = 'plugin-root.json';
export { RECORD_FILE } from './statusline-record.js';
export const DEV_ENV = 'ZEROH_STATUSLINE_DEV';
// Claude Code re-runs the status line when an assistant message arrives;
// the timer also catches what changes between messages (a `proxy off`, a
// crashed hook, an unmask countdown).
export const REFRESH_SECONDS = 10;
export {
  SHIELD,
  NOT_INSTALLED,
  LAUNCHER_DIR,
  LAUNCHER_NAME,
} from './statusline-launcher.js';
import {
  ROOT_RESOLVER_SOURCE,
  LAUNCHER_DIR,
  LAUNCHER_NAME,
  writeLaunchers,
} from './statusline-launcher.js';

const SCRIPT = [
  "const f=require('fs'),p=require('path'),e=process.env,h=require('os').homedir();",
  "const j=(x)=>{try{return JSON.parse(f.readFileSync(x,'utf8'))}catch{return null}};",
  "const z=e.ZEROH_HOME||(process.platform==='win32'?p.join(e.LOCALAPPDATA||p.join(h,'AppData','Local'),'ZeroH'):p.join(h,'.zeroh'));",
  `const d=(${ROOT_RESOLVER_SOURCE})({fs:f,path:p,env:e,home:h});`,
  'const a=process.argv.slice(1);',
  // `wrap <base64url command>` with no plugin to run: the user's own line
  // still shows, then why ZeroH's part is missing.
  // A hard deadline (Astra 1.0.1 A2, as lib/statusline.js runWrapped): the
  // command runs as its own process group and is killed with everything it
  // started after 4 s, and ZeroH's part prints regardless.
  "const o=()=>new Promise((r)=>{if(a[0]!=='wrap')return r('');const q=require('child_process'),W=process.platform==='win32';let c,s='',n=0,g,i='';try{i=f.readFileSync(0)}catch{}const x=(v)=>{if(n)return;n=1;clearTimeout(g);try{c.stdout.destroy();c.stdin.destroy();c.unref()}catch{}r(v)};try{c=q.spawn(Buffer.from(a[1]||'','base64url').toString(),{shell:true,detached:!W,stdio:['pipe','pipe','ignore'],windowsHide:true})}catch{return r('')}g=setTimeout(()=>{try{W?q.spawn('taskkill',['/pid',String(c.pid),'/T','/F'],{stdio:'ignore',windowsHide:true}).unref():process.kill(-c.pid,'SIGKILL')}catch{}x(s.trimEnd())},4000);c.stdout.setEncoding('utf8');c.stdout.on('data',(d)=>{s+=d});c.stdout.on('error',()=>{});c.stdin.on('error',()=>{});c.on('error',()=>x(''));c.on('close',()=>x(s.trimEnd()));c.stdin.end(i)});",
  "const w=(m)=>o().then((t)=>process.stdout.write(a.includes('segment')?'':(t?t+((j(p.join(z,'presentation.json'))||j(p.join(z,'statusline-style.json')))?.position==='end'?' \\u00b7 ':'\\u000a'):'')+'\\u{1F6E1}\\u{FE0F} ZeroH \\u00b7 \\u{1F534} '+m));",
  "d?import(require('url').pathToFileURL(p.join(d,'lib','statusline.js'))).then((m)=>m.statuslineMain(a)).catch(()=>w('status line failed')):w('not installed \\u00b7 remove it with /statusline')",
].join('');

// The statusLine command ZeroH writes (and the README shows).
export const STATUSLINE_COMMAND = `node -e "${SCRIPT}"`;

function zerohHomeForSettings(env, platform) {
  if (env.ZEROH_HOME) return env.ZEROH_HOME;
  if (platform === 'win32') {
    return path.win32.join(
      env.LOCALAPPDATA ||
        path.win32.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local'),
      'ZeroH',
    );
  }
  return path.join(env.HOME || os.homedir(), '.zeroh');
}

export function segmentCommand(
  home,
  platform = process.platform,
  env = process.env,
) {
  if (platform === 'win32') {
    const base = env.ZEROH_HOME || home;
    const file = path.win32
      .join(base, LAUNCHER_DIR, `${LAUNCHER_NAME}.mjs`)
      .replaceAll('\\', '/');
    // Claude Code uses Git Bash, or PowerShell when Bash is absent.
    return `node "${file}"`;
  }
  const base = path.posix.resolve(home);
  const userHome = path.posix.resolve(env.HOME || os.homedir());
  const shown =
    base === path.posix.join(userHome, '.zeroh') ? '~/.zeroh' : base;
  const file = path.posix.join(shown, LAUNCHER_DIR, LAUNCHER_NAME);
  return /\s/u.test(file) ? `"${file}"` : file;
}

// The user's own status line with ZeroH's part after it (1.0.1): `statusline
// on`, typed by the user who already has a status line, sets statusLine to
// the resolver in `wrap` mode. It runs the user's command with the same
// JSON on stdin, prints its output, then ` · ` and ZeroH's segment. The
// user's command rides along as one base64url word: no quoting survives
// Bash, zsh, PowerShell and cmd alike (cmd expands %VAR% even in quotes),
// and base64url has no character any of them reads.
export const WRAP_MODE = 'wrap';
const WRAP_ARG_RE = /^[A-Za-z0-9_-]+$/u;

export function encodeWrapped(command) {
  return Buffer.from(String(command), 'utf8').toString('base64url');
}

export function wrapCommand(command) {
  return `${STATUSLINE_COMMAND} ${WRAP_MODE} ${encodeWrapped(command)}`;
}

// The user's command a wrap entry runs, or null for any other entry.
export function wrappedCommand(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  const match = /^(node -e "[^"]*") wrap (\S+)$/u.exec(command);
  if (!match || !OUR_COMMANDS[0].test(match[1]) || !WRAP_ARG_RE.test(match[2]))
    return null;
  const original = Buffer.from(match[2], 'base64url').toString('utf8');
  // Only a word that is exactly the encoding of some text.
  if (!original || encodeWrapped(original) !== match[2]) return null;
  return original;
}

// A statusLine entry of the user's that shows ZeroH already: it runs ZeroH's
// resolver, an older build's script or the CLI's `statusline` somewhere in
// a command of its own (F7).
export function showsZeroH(entry) {
  const command = typeof entry?.command === 'string' ? entry.command : '';
  return (
    /startsWith\('zeroh-disclosure@'\)[^"]*statuslineMain/u.test(command) ||
    /zeroh-statusline(?:\.mjs)?\b/u.test(command) ||
    /zeroh-disclosure(?:\.mjs"?)? statusline\b/u.test(command)
  );
}

// The entry that wraps the user's `entry`: their keys kept, the command
// wrapped, refreshed at least every REFRESH_SECONDS so ZeroH's part stays
// current.
export function wrapEntry(entry) {
  const refresh =
    typeof entry.refreshInterval === 'number' && entry.refreshInterval > 0
      ? Math.min(entry.refreshInterval, REFRESH_SECONDS)
      : REFRESH_SECONDS;
  return {
    ...entry,
    type: 'command',
    command: wrapCommand(entry.command),
    refreshInterval: refresh,
  };
}

export function statuslineEntry() {
  return {
    type: 'command',
    command: STATUSLINE_COMMAND,
    padding: 0,
    refreshInterval: REFRESH_SECONDS,
  };
}

// The complete commands ZeroH has written, and nothing else (Astra rc.2
// F7): a command of the user's own that contains one of them (`… segment`,
// `zeroh=$(…); printf …`, `…; printf " · main"`) is theirs. Each form is
// anchored at both ends and admits no shell syntax around it:
//   - the `node -e "…"` resolver, any rc.2 text of it (the script holds no
//     double quote, so the quoted part can't end early);
//   - an earlier rc.2 build's `node "<ZEROH_HOME>/zeroh-statusline.mjs"`;
//   - the CLI's `[node "<path>/]zeroh-disclosure[.mjs"] statusline`.
const OUR_COMMANDS = [
  /^node -e "(?=[^"]*startsWith\('zeroh-disclosure@'\))(?=[^"]*statuslineMain)[^"]*"$/u,
  /^node "[^"$`]*[\\/]zeroh-statusline\.mjs"$/u,
  /^(?:node "[^"$`]*[\\/])?zeroh-disclosure(?:\.mjs")? statusline$/u,
];

// True for a statusLine entry ZeroH wrote, in any of its forms (this
// command, an older rc.2 build's `node ".../zeroh-statusline.mjs"`, or the
// CLI's `zeroh-disclosure statusline`); false for the user's own, including
// a script of theirs that adds ZeroH's segment.
export function isOurStatusLine(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const command = typeof entry.command === 'string' ? entry.command.trim() : '';
  if (!command) return false;
  // The current segment launcher belongs to the user's script on every OS. Its
  // basename also matches the older full-line launcher, which lived directly
  // in ZEROH_HOME. Never migrate or remove the current bin/ segment entry.
  if (/^node "[^"$`]*[\\/]bin[\\/]zeroh-statusline\.mjs"$/u.test(command))
    return false;
  return (
    OUR_COMMANDS.some((form) => form.test(command)) ||
    wrappedCommand(entry) !== null
  );
}

// The current form of one of ZeroH's entries: a wrap entry stays a wrap of
// the same command, with the user's other keys.
export function currentEntry(entry) {
  const wrapped = wrappedCommand(entry);
  if (wrapped === null) return statuslineEntry();
  return { ...entry, command: wrapCommand(wrapped) };
}

// True when the entry is ZeroH's but not the current text (an older form).
export function isOutdated(entry) {
  if (!isOurStatusLine(entry)) return false;
  if (wrappedCommand(entry) !== null)
    return entry.command !== currentEntry(entry).command;
  const current = statuslineEntry();
  return (
    entry.command !== current.command ||
    entry.padding !== current.padding ||
    entry.refreshInterval !== current.refreshInterval
  );
}

// The Claude Code config dir a statusLine command resolves plugins in.
export function claudeConfigDir(env = process.env) {
  return path.resolve(
    env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude'),
  );
}

// SessionStart: records the running plugin's root for this config dir.
// Never throws.
export function recordPluginRoot(home, pluginRoot, env = process.env) {
  try {
    const pointer = path.join(path.resolve(home), PLUGIN_ROOT_FILE);
    const root = path.resolve(pluginRoot);
    const config = claudeConfigDir(env);
    let current = null;
    try {
      current = JSON.parse(readFileSync(pointer, 'utf8'));
    } catch {
      current = null;
    }
    const roots =
      current?.v === 2 && current.roots && typeof current.roots === 'object'
        ? current.roots
        : {};
    const recordedAt =
      current?.v === 2 &&
      current.recordedAt &&
      typeof current.recordedAt === 'object'
        ? current.recordedAt
        : {};
    if (roots[config] !== root || !recordedAt[config]) {
      writePrivateJson(pointer, {
        v: 2,
        roots: { ...roots, [config]: root },
        recordedAt: {
          ...recordedAt,
          [config]:
            roots[config] === root && recordedAt[config]
              ? recordedAt[config]
              : new Date().toISOString(),
        },
      });
    }
    pruneStatuslineRestore(home);
    writeLaunchers(home);
    return true;
  } catch {
    return false;
  }
}

// The plugin root the last SessionStart recorded for this config dir.
export function recordedPluginRoot(home, env = process.env) {
  const current = readJsonOr(path.join(path.resolve(home), PLUGIN_ROOT_FILE));
  return current?.v === 2
    ? (current.roots?.[claudeConfigDir(env)] ?? null)
    : null;
}

// --- records ---------------------------------------------------------------
// <ZEROH_HOME>/statusline.json: { v: 1, choices: { <settings path>: {
// choice: 'on' | 'off' | 'theirs' | 'replaced', at } }, paths: [<every settings path
// ZeroH's entry was written to>] }.

// `wrapped: { <settings path>: <the user's statusLine entry> }` keeps each
// status line ZeroH wrapped, to put back exactly (1.0.1).
function writeDocument(settingsPath, document, home = null) {
  const has = Object.hasOwn(document, 'statusLine');
  const entry = document.statusLine;
  let before = null;
  let eligible = false;
  const result = writeSettingsFile(settingsPath, (current, context) => {
    before = { exists: context.exists, raw: context.raw };
    eligible =
      !Object.hasOwn(current, 'statusLine') ||
      !isOurStatusLine(current.statusLine);
    if (has) current.statusLine = entry;
    else delete current.statusLine;
    return true;
  });
  if (home && eligible && result.written) {
    recordStatuslineWrite(home, settingsPath, before, {
      exists: true,
      raw: `${JSON.stringify(result.document, null, 2)}\n`,
    });
  }
}

// Writes ZeroH's entry into `document` of `settingsPath` (on) and records
// it. Returns true when it wrote.
function putEntry(settingsPath, document, home) {
  document.statusLine = statuslineEntry();
  writeDocument(settingsPath, document, home);
  if (home) recordChoice(home, settingsPath, 'on');
  return true;
}

// `on`: returns { result: 'on' | 'wrapped' | 'already' | 'theirs' |
// command, segment }. The user who already has a status line
// typed it, so ZeroH adds its part to theirs ('wrapped'); a line of theirs
// that shows ZeroH already, or one that isn't a command, is left as it is
// ('theirs'). The wrapper uses the same platform shell Claude Code uses for
// statusLine.command on macOS, Linux and Windows.
export function turnStatuslineOn({
  settingsPath,
  home = null,
  pluginRoot = null,
  env = process.env,
  platform = process.platform,
}) {
  const { document } = readSettings(settingsPath);
  const command = STATUSLINE_COMMAND;
  const segment = segmentCommand(
    home ?? zerohHomeForSettings(env, platform),
    platform,
    env,
  );
  if (home && pluginRoot) recordPluginRoot(home, pluginRoot, env);
  if (Object.hasOwn(document, 'statusLine')) {
    const entry = document.statusLine;
    if (!isOurStatusLine(entry)) {
      const wrappable =
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        (entry.type === undefined || entry.type === 'command') &&
        typeof entry.command === 'string' &&
        entry.command.trim() !== '' &&
        !showsZeroH(entry);
      if (!wrappable) {
        if (home) recordChoice(home, settingsPath, 'theirs');
        return {
          result: 'theirs',
          command,
          segment,
        };
      }
      document.statusLine = wrapEntry(entry);
      writeDocument(settingsPath, document, home);
      if (home) {
        const record = recordChoice(home, settingsPath, 'on');
        record.wrapped[path.resolve(settingsPath)] = entry;
        writeRecord(home, record);
      }
      return {
        result: 'wrapped',
        command: document.statusLine.command,
        segment,
      };
    }
    if (!isOutdated(entry)) {
      if (home) recordChoice(home, settingsPath, 'on');
      return {
        result: 'already',
        command: entry.command,
        segment,
        wrapped: wrappedCommand(entry) !== null,
      };
    }
    if (wrappedCommand(entry) !== null) {
      document.statusLine = currentEntry(entry);
      writeDocument(settingsPath, document, home);
      if (home) recordChoice(home, settingsPath, 'on');
      return {
        result: 'wrapped',
        command: document.statusLine.command,
        segment,
      };
    }
  }
  putEntry(settingsPath, document, home);
  return { result: 'on', command, segment };
}

// The user's entry a wrap entry replaced: the one recorded, when it is the
// same command; else the wrap entry with its command put back.
function unwrapped(entry, recorded) {
  const original = wrappedCommand(entry);
  if (
    recorded &&
    typeof recorded === 'object' &&
    !Array.isArray(recorded) &&
    recorded.command === original
  )
    return recorded;
  return { ...entry, command: original };
}

// Removes ZeroH's entry from one settings file, or puts the user's own
// status line back where ZeroH wrapped it. { result: 'off' | 'unwrapped' |
// 'theirs' | 'none' }.
function removeEntry(settingsPath, home = null) {
  if (home) pruneStatuslineRestore(home, settingsPath);
  const { exists, document } = readSettings(settingsPath);
  if (!exists || !Object.hasOwn(document, 'statusLine')) {
    return { result: 'none' };
  }
  if (!isOurStatusLine(document.statusLine)) return { result: 'theirs' };
  const key = path.resolve(settingsPath);
  const wrapped = wrappedCommand(document.statusLine) !== null;
  if (restoreExactBytes(settingsPath, home, wrapped)) {
    return { result: wrapped ? 'unwrapped' : 'off' };
  }
  if (wrapped) {
    const record = home ? readRecord(home) : null;
    document.statusLine = unwrapped(document.statusLine, record?.wrapped[key]);
    writeDocument(settingsPath, document);
    if (record && Object.hasOwn(record.wrapped, key)) {
      delete record.wrapped[key];
      delete record.restore[key];
      writeRecord(home, record);
    }
    return { result: 'unwrapped' };
  }
  delete document.statusLine;
  writeDocument(settingsPath, document);
  if (home) {
    const record = readRecord(home);
    if (Object.hasOwn(record.restore, key)) {
      delete record.restore[key];
      writeRecord(home, record);
    }
  }
  return { result: 'off' };
}

// `off`: removes only ZeroH's entry (or its part of the user's line) and
// records the choice, so nothing puts it back.
export function turnStatuslineOff({ settingsPath, home = null }) {
  const outcome = removeEntry(settingsPath, home);
  if (home) {
    recordChoice(home, settingsPath, 'off');
  }
  return outcome;
}

// Uninstall: ZeroH's entry out of every settings file it was written to (and
// `settingsPaths`), and each status line of the user's it wrapped put back.
// Returns the files it changed. Never throws.
export function removeEverywhere({ home, settingsPaths = [] }) {
  const removed = [];
  let record = { paths: [], wrapped: {} };
  try {
    record = readRecord(home);
  } catch {
    // No record: the settings files named are still cleaned.
  }
  pruneStatuslineRestore(home);
  const paths = new Set(
    [...record.paths, ...Object.keys(record.wrapped), ...settingsPaths].map(
      (file) => path.resolve(file),
    ),
  );
  for (const file of paths) {
    try {
      const { result } = removeEntry(file, home);
      if (result === 'off' || result === 'unwrapped') removed.push(file);
    } catch {
      // An unreadable settings file is left as it is.
    }
  }
  return removed;
}

// Rewrites ZeroH's entry in `settingsPath` when it is an older form. Returns
// true when it wrote. Never throws.
export function migrateEntry(settingsPath, home = null) {
  try {
    const { exists, document } = readSettings(settingsPath);
    if (!exists || !isOutdated(document.statusLine)) return false;
    if (wrappedCommand(document.statusLine) !== null) {
      document.statusLine = currentEntry(document.statusLine);
      writeDocument(settingsPath, document);
      return true;
    }
    document.statusLine = statuslineEntry();
    writeDocument(settingsPath, document);
    if (home) recordChoice(home, settingsPath, 'on');
    return true;
  } catch {
    return false;
  }
}

// What the settings file says: 'ours', 'theirs' or 'none'.
export function statuslineState(settingsPath) {
  const { document } = readSettings(settingsPath);
  if (!Object.hasOwn(document, 'statusLine')) return 'none';
  return isOurStatusLine(document.statusLine) ? 'ours' : 'theirs';
}
