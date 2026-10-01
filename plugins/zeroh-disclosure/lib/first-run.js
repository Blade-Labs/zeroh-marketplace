// SPDX-License-Identifier: AGPL-3.0-only

// What ZeroH turns on in the user's Claude Code settings by itself (owner
// decision D-26, 2026-09-27), so the install prompt stays two commands:
//
//   - its status line, when the settings have no `statusLine` and ZeroH has
//     no recorded choice for that file. A status line of the user's own is
//     left as it is and recorded as `theirs`; an entry of ZeroH's the user
//     deleted (`/statusline`, or by hand) is recorded as `off`; either is
//     never undone. The choice and every file written are recorded in
//     <ZEROH_HOME>/statusline.json (lib/statusline-settings.js);
//   - auto-update for the marketplace ZeroH was installed from, when the
//     user hasn't set it either way, once per settings file
//     (<ZEROH_HOME>/first-run.json).
//
// It runs at the first prompt of a session, the same moment ZeroH puts its
// proxy entry into those settings: Claude Code applies a settings change to
// the running session only once it watches the file, which it doesn't yet
// during SessionStart, so a status line written then would only show from
// the next session. Each change gets one line above that prompt. An entry of
// ZeroH's in an older form is rewritten to the current one. Never throws: a
// settings file that can't be read is tried again at the next prompt.
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import {
  installId,
  readSettings,
  resolveClaudeSettingsPath,
  writeSettingsFile,
} from './claude-settings.js';
import { readJsonOr, writePrivateJson } from './private-fs.js';
import {
  choiceFor,
  currentEntry,
  isOurStatusLine,
  isOutdated,
  recordChoice,
  recordedPluginRoot,
  statuslineEntry,
} from './statusline-settings.js';

export const FIRST_RUN_FILE = 'first-run.json';

// Remove only the auto-update entry this install created. A user's later
// changes to that entry, and entries for other marketplaces, stay theirs.
export function removeFirstRunMarketplace({
  home,
  settingsPath,
  env = process.env,
}) {
  const record = readJsonOr(path.join(path.resolve(home), FIRST_RUN_FILE));
  const added = record?.installs?.[installId(settingsPath)]?.autoUpdate;
  if (added?.decision !== 'on' || !added.marketplace) return false;
  const { document } = readSettings(settingsPath);
  const markets = document.extraKnownMarketplaces;
  const entry = markets?.[added.marketplace];
  const source = added.source ?? knownSource(added.marketplace, env);
  if (!source || !isDeepStrictEqual(entry, { source, autoUpdate: true })) {
    return false;
  }
  // Records written before 1.0.4 (by 1.0.2 and 1.0.3) do not say whether
  // ZeroH created the entry or added autoUpdate to the user's own, so only
  // the entry ZeroH is known to have created goes; otherwise only autoUpdate.
  if (added.created !== true) {
    delete entry.autoUpdate;
  } else {
    delete markets[added.marketplace];
    if (!Object.keys(markets).length) delete document.extraKnownMarketplaces;
  }
  writeSettingsFile(settingsPath, `${JSON.stringify(document, null, 2)}\n`);
  return added.created === true ? 'entry' : 'autoUpdate';
}

export const FIRST_RUN_LINES = Object.freeze({
  statuslineOn:
    'Status line on · /zeroh-disclosure:settings statusline off to remove',
  statuslineTheirs:
    'You have your own status line · /zeroh-disclosure:settings statusline on adds ZeroH to it',
  autoUpdate: (name) =>
    `Auto-update on for the ${name} marketplace · turn it off in /plugin, Marketplaces`,
  replaced:
    "Your own status line replaced ZeroH's · /zeroh-disclosure:settings statusline on adds ZeroH's part to it",
  shadowed: (file) =>
    `${file} sets its own status line, so ZeroH's isn't shown in this project`,
});

// The marketplace a plugin copy was installed from: Claude Code keeps it at
// <plugins cache>/<marketplace>/zeroh-disclosure/<version>, or lists it in
// installed_plugins.json (a local directory marketplace installs in place).
// Null for a copy loaded some other way (--plugin-dir).
export function marketplaceOf(pluginRoot, env = process.env) {
  const resolved = path.resolve(pluginRoot);
  const parts = resolved.split(/[\\/]+/u);
  const at = parts.lastIndexOf('zeroh-disclosure');
  if (at >= 2 && parts[at - 2] === 'cache' && parts[at - 1]) {
    return parts[at - 1];
  }
  // Otherwise the id Claude Code lists for this install path.
  const listed = readJsonOr(
    path.join(claudeConfigDir(env), 'plugins', 'installed_plugins.json'),
  );
  const ids = [];
  for (const [id, entries] of Object.entries(listed?.plugins ?? {})) {
    const match = /^zeroh-disclosure@(.+)$/u.exec(id);
    if (!match) continue;
    ids.push(match[1]);
    for (const entry of [].concat(entries)) {
      if (
        typeof entry?.installPath === 'string' &&
        path.resolve(entry.installPath) === resolved
      ) {
        return match[1];
      }
    }
  }
  // Claude Code runs a directory marketplace's plugin from its source, not
  // from the listed copy: the installed marketplace whose folder holds it.
  const known = readJsonOr(
    path.join(claudeConfigDir(env), 'plugins', 'known_marketplaces.json'),
  );
  for (const name of ids) {
    const source = known?.[name]?.source;
    if (source?.source !== 'directory' || typeof source.path !== 'string') {
      continue;
    }
    const relative = path.relative(path.resolve(source.path), resolved);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) return name;
  }
  return null;
}

function claudeConfigDir(env) {
  return env.CLAUDE_CONFIG_DIR
    ? path.resolve(env.CLAUDE_CONFIG_DIR)
    : path.join(env.HOME || os.homedir(), '.claude');
}

// Where Claude Code says a marketplace comes from ({ source: 'github', repo }).
function knownSource(name, env) {
  const known = readJsonOr(
    path.join(claudeConfigDir(env), 'plugins', 'known_marketplaces.json'),
  );
  const source = known?.[name]?.source;
  return source && typeof source === 'object' ? source : null;
}

// ZeroH's public marketplace. Until 25 September 2026 its manifest was named
// `zeroh-marketplace`; a profile that added it then keeps it registered
// under that name, so `zeroh-disclosure@zeroh` is "not found in marketplace
// zeroh" and Claude Code's hint names the wrong marketplace (Windows re-test,
// finding 9). Only a GitHub source for this repository counts: a local
// directory or another repository with the same name is a different
// marketplace and is left alone.
export const PUBLIC_MARKETPLACE_REPO = 'Blade-Labs/zeroh-marketplace';
export const PUBLIC_MARKETPLACE_NAME = 'zeroh';

function isPublicMarketplaceSource(source) {
  if (!source || typeof source !== 'object') return false;
  const want = PUBLIC_MARKETPLACE_REPO.toLowerCase();
  if (source.source === 'github') {
    return String(source.repo ?? '').toLowerCase() === want;
  }
  if (source.source === 'git' || source.source === 'url') {
    const url = String(source.url ?? '')
      .toLowerCase()
      .replace(/\.git$/u, '')
      .replace(/\/+$/u, '');
    return (
      url === `https://github.com/${want}` || url === `git@github.com:${want}`
    );
  }
  return false;
}

// The name the public marketplace is registered under when it is not
// `zeroh`, or null.
export function staleMarketplaceName(env = process.env) {
  const known = readJsonOr(
    path.join(claudeConfigDir(env), 'plugins', 'known_marketplaces.json'),
  );
  if (!known || typeof known !== 'object') return null;
  for (const [name, entry] of Object.entries(known)) {
    if (name === PUBLIC_MARKETPLACE_NAME) continue;
    if (isPublicMarketplaceSource(entry?.source)) return name;
  }
  return null;
}

export function staleMarketplaceText(name) {
  return `Claude Code has ZeroH's public marketplace (GitHub ${PUBLIC_MARKETPLACE_REPO}) registered under its old name "${name}", so zeroh-disclosure@zeroh is not found and updates may stop. In a terminal, run: claude plugin marketplace remove ${name}, then claude plugin marketplace add ${PUBLIC_MARKETPLACE_REPO} and claude plugin install zeroh-disclosure@zeroh; then restart Claude Code.`;
}

// The status line part. Mutates `document`; returns { changed, line,
// choice }: `choice` is what to record for the file, once the settings are
// written (null: nothing to record).
function statuslineDefault({ document, settingsPath, home }) {
  const choice = choiceFor(home, settingsPath);
  const entry = document.statusLine;
  const has = Object.hasOwn(document, 'statusLine');
  if (has && isOurStatusLine(entry)) {
    const record = choice !== 'on' ? 'on' : null;
    if (isOutdated(entry)) {
      // A wrap of the user's own line stays one (lib/statusline-settings.js).
      document.statusLine = currentEntry(entry);
      return { changed: true, line: null, choice: 'on' };
    }
    return { changed: false, line: null, choice: record };
  }
  if (has) {
    if (choice === 'theirs')
      return { changed: false, line: null, choice: null };
    // Told once: their own status line from the start, or one that replaced
    // ZeroH's (the user's choice; ZeroH doesn't put its own back).
    return {
      changed: false,
      line:
        choice === 'on'
          ? FIRST_RUN_LINES.replaced
          : choice
            ? null
            : FIRST_RUN_LINES.statuslineTheirs,
      choice: 'theirs',
    };
  }
  if (choice === 'on') {
    // ZeroH's entry was there and the user removed it: respected.
    return { changed: false, line: null, choice: 'off' };
  }
  if (choice) return { changed: false, line: null, choice: null };
  document.statusLine = statuslineEntry();
  return { changed: true, line: FIRST_RUN_LINES.statuslineOn, choice: 'on' };
}

// Decisions are recorded only after the settings file that carries them is
// written (Astra rc.2 F8): a write that fails leaves nothing recorded, so the
// next prompt tries again, and a missing entry still means the user removed
// it.
export function applyFirstRunDefaults({
  home,
  // Default: the plugin the last SessionStart recorded for this config dir.
  pluginRoot = undefined,
  env = process.env,
  settingsPath = resolveClaudeSettingsPath({ env }),
  now = new Date(),
} = {}) {
  const lines = [];
  try {
    pluginRoot ??= recordedPluginRoot(home, env);
    const file = path.join(path.resolve(home), FIRST_RUN_FILE);
    const record = readJsonOr(file) ?? {};
    const installs =
      record.installs && typeof record.installs === 'object'
        ? record.installs
        : {};
    const id = installId(settingsPath);
    const decided = { ...(installs[id] ?? {}) };
    let decidedChanged = false;

    const { document } = readSettings(settingsPath);
    let changed = false;
    const at = now.toISOString();

    const statusline = statuslineDefault({ document, settingsPath, home });
    changed ||= statusline.changed;
    if (statusline.line) lines.push(statusline.line);

    if (!decided.autoUpdate) {
      const name = pluginRoot ? marketplaceOf(pluginRoot, env) : null;
      if (name) {
        const markets =
          document.extraKnownMarketplaces &&
          typeof document.extraKnownMarketplaces === 'object' &&
          !Array.isArray(document.extraKnownMarketplaces)
            ? document.extraKnownMarketplaces
            : null;
        const entry = markets?.[name];
        if (entry && Object.hasOwn(entry, 'autoUpdate')) {
          decided.autoUpdate = { decision: 'user', at };
        } else {
          const source = entry?.source ?? knownSource(name, env);
          if (!source) {
            decided.autoUpdate = { decision: 'no-source', at };
          } else {
            document.extraKnownMarketplaces = {
              ...(markets ?? {}),
              [name]: { ...(entry ?? {}), source, autoUpdate: true },
            };
            changed = true;
            decided.autoUpdate = {
              decision: 'on',
              marketplace: name,
              source,
              created: !entry,
              at,
            };
            lines.push(FIRST_RUN_LINES.autoUpdate(name));
          }
        }
        decidedChanged = true;
      }
    }

    // Said once per settings file; doctor says it every time.
    const stale = staleMarketplaceName(env);
    if (stale && decided.staleMarketplace !== stale) {
      lines.push(staleMarketplaceText(stale));
      decided.staleMarketplace = stale;
      decidedChanged = true;
    }

    if (changed) {
      writeSettingsFile(settingsPath, `${JSON.stringify(document, null, 2)}\n`);
    }
    if (statusline.choice) recordChoice(home, settingsPath, statusline.choice);
    if (decidedChanged) {
      installs[id] = decided;
      writePrivateJson(file, { v: 1, installs });
    }
    return { lines };
  } catch {
    // Unreadable or unwritable settings, or a read-only home: nothing was
    // recorded that the settings don't show, so the next prompt tries again.
    return { lines: [] };
  }
}

// SessionStart: one line when a project or managed settings file, which
// Claude Code reads over the user's, sets a status line of its own over
// ZeroH's. Null otherwise. Never throws.
export function shadowedStatusline({
  root,
  env = process.env,
  settingsPath = resolveClaudeSettingsPath({ env }),
  managedPath = null,
} = {}) {
  try {
    const ours = isOurStatusLine(
      readSettings(settingsPath).document.statusLine,
    );
    if (!ours) return null;
    const higher = [
      path.join(root, '.claude', 'settings.json'),
      path.join(root, '.claude', 'settings.local.json'),
      ...(managedPath ? [managedPath] : []),
    ].filter((file) => path.resolve(file) !== path.resolve(settingsPath));
    for (const file of higher.reverse()) {
      const document = readJsonOr(file);
      if (
        document &&
        Object.hasOwn(document, 'statusLine') &&
        !isOurStatusLine(document.statusLine)
      ) {
        const shown = path.relative(root, file);
        return FIRST_RUN_LINES.shadowed(
          shown && !shown.startsWith('..') ? shown : file,
        );
      }
    }
    return null;
  } catch {
    return null;
  }
}
