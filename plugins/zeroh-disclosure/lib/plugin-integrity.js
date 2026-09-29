// SPDX-License-Identifier: AGPL-3.0-only

// Whether the plugin folder Claude Code runs is the release it recorded.
//
// Claude Code copies a marketplace plugin into
// <plugins root>/cache/<marketplace>/<plugin>/<version>/ and names that
// folder after the version. `claude plugin update` (and background
// auto-update) reuses a folder that already exists for the new version as it
// is: checked with Claude Code 2.1.283, a folder 1.0.0 left from an earlier
// build stayed in use after an update from 1.0.0-rc.2 to 1.0.0, while
// installed_plugins.json recorded the new commit. `claude plugin install`
// does copy afresh. Such a folder runs old hooks and hands old code to the
// proxy (ZEROH_HOME/bin) under the new version number.
//
// The check compares every file in the plugin folder with the tree of the
// commit Claude Code recorded for the install (`gitCommitSha`), read from its
// clone of the marketplace, by git blob hash. It answers only for a copy in
// the cache of a git-hosted marketplace whose clone still holds that commit;
// anything else (a --plugin-dir or local-directory copy, a clone that moved
// on) is `unverifiable`, never `stale`. Node built-ins and `git` only; never
// throws.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonOr } from './private-fs.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// What Claude Code itself writes into a cached copy.
const CLAUDE_CODE_ENTRIES = new Set([
  '.in_use',
  '.orphaned_at',
  '.mcpb-cache',
  'node_modules',
]);

// Listed at most, per kind, in the lines for the user.
const LIST_LIMIT = 5;

function configDir(env) {
  return env.CLAUDE_CONFIG_DIR
    ? path.resolve(env.CLAUDE_CONFIG_DIR)
    : path.join(env.HOME || os.homedir(), '.claude');
}

// Claude Code's plugins root (CLAUDE_CODE_PLUGIN_CACHE_DIR moves all of it).
export function pluginsRoot(env = process.env) {
  return env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    ? path.resolve(env.CLAUDE_CODE_PLUGIN_CACHE_DIR)
    : path.join(configDir(env), 'plugins');
}

function real(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

// Git's object id for a file's bytes.
export function gitBlobHash(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

// The installed_plugins.json record whose installPath is `pluginRoot`, with
// the marketplace and plugin names from its id. Null when none is.
export function installRecord(pluginRoot, env = process.env) {
  const root = real(pluginRoot);
  const listed = readJsonOr(
    path.join(pluginsRoot(env), 'installed_plugins.json'),
  );
  for (const [id, entries] of Object.entries(listed?.plugins ?? {})) {
    const at = id.lastIndexOf('@');
    if (at <= 0) continue;
    for (const entry of [].concat(entries)) {
      if (typeof entry?.installPath !== 'string') continue;
      if (real(entry.installPath) !== root) continue;
      return {
        id,
        plugin: id.slice(0, at),
        marketplace: id.slice(at + 1),
        version: entry.version ?? null,
        gitCommitSha: entry.gitCommitSha ?? null,
        installPath: entry.installPath,
      };
    }
  }
  return null;
}

// Every folder Claude Code recorded for `plugin` (any marketplace, any
// scope), so a copy of the CLI running from elsewhere (ZEROH_HOME/bin) can
// check the folder Claude Code loads, not only its own.
export function installedRoots(plugin = 'zeroh-disclosure', env = process.env) {
  const listed = readJsonOr(
    path.join(pluginsRoot(env), 'installed_plugins.json'),
  );
  const roots = [];
  for (const [id, entries] of Object.entries(listed?.plugins ?? {})) {
    if (!id.startsWith(`${plugin}@`)) continue;
    for (const entry of [].concat(entries)) {
      if (typeof entry?.installPath === 'string') {
        roots.push(path.resolve(entry.installPath));
      }
    }
  }
  return [...new Set(roots)];
}

function defaultGit(args) {
  return execFileSync('git', args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    // SessionStart runs this: a slow git never holds the session up long
    // (a timeout reads as unverifiable).
    timeout: 2_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

// { path (relative to the plugin, '/'), mode, hash } for every file the
// commit holds under `subdir`.
function releaseTree(git, clone, sha, subdir) {
  const out = git([
    '-C',
    clone,
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    sha,
    '--',
    subdir ? `${subdir}/` : '.',
  ]).toString('utf8');
  const files = new Map();
  for (const record of out.split('\0')) {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/su.exec(record);
    if (!match || match[2] !== 'blob') continue;
    const relative = subdir ? match[4].slice(subdir.length + 1) : match[4];
    files.set(relative, { mode: match[1], hash: match[3] });
  }
  return files;
}

// Every file and link in the copy, as '/' paths, without what Claude Code
// adds and without the top-level dot entries the release doesn't have.
function copyFiles(root, released) {
  const topLevel = new Set(
    [...released.keys()].map((file) => file.split('/')[0]),
  );
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (!relative && CLAUDE_CODE_ENTRIES.has(entry.name)) continue;
      if (
        !relative &&
        entry.name.startsWith('.') &&
        !topLevel.has(entry.name)
      ) {
        continue;
      }
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else files.push(child);
    }
  };
  walk('');
  return files.sort();
}

// Git for Windows clones with core.autocrlf=true by default, so a
// marketplace clone there (and the copy Claude Code makes from it) holds text
// files with CRLF line ends. Git stores such a file with LF, so the file is
// also compared as Git would store it; otherwise every Windows install would
// be reported as stale, and reinstalling would not change that.
const CRLF = Buffer.from('\r\n');

function hashOnDisk(root, relative) {
  const target = path.join(root, ...relative.split('/'));
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    return { link: true, hash: gitBlobHash(Buffer.from(readlinkSync(target))) };
  }
  const bytes = readFileSync(target);
  const hashes = [gitBlobHash(bytes)];
  if (!bytes.includes(0) && bytes.includes(CRLF)) {
    hashes.push(
      gitBlobHash(
        Buffer.from(
          bytes.toString('latin1').replaceAll('\r\n', '\n'),
          'latin1',
        ),
      ),
    );
  }
  return { link: false, hashes };
}

function unverifiable(reason, extra = {}) {
  return { state: 'unverifiable', reason, ...extra };
}

// Compares the plugin folder with the release Claude Code recorded for it.
// Returns { state: 'ok' | 'stale' | 'unverifiable', ... }; `stale` carries
// `changed`, `missing` and `extra` file lists and the install id.
export function checkPluginIntegrity({
  pluginRoot = PLUGIN_ROOT,
  env = process.env,
  git = defaultGit,
} = {}) {
  try {
    const root = real(pluginRoot);
    const cache = real(path.join(pluginsRoot(env), 'cache'));
    const inCache = path.relative(cache, root);
    if (inCache.startsWith('..') || path.isAbsolute(inCache)) {
      return unverifiable('not-a-cached-copy');
    }
    const record = installRecord(root, env);
    if (!record) return unverifiable('no-install-record');
    const manifest = readJsonOr(
      path.join(root, '.claude-plugin', 'plugin.json'),
    );
    const base = {
      id: record.id,
      pluginRoot: root,
      version: manifest?.version ?? null,
      recordedVersion: record.version,
    };
    if (!record.gitCommitSha) return unverifiable('no-recorded-commit', base);
    const known = readJsonOr(
      path.join(pluginsRoot(env), 'known_marketplaces.json'),
    );
    const clone = known?.[record.marketplace]?.installLocation;
    if (typeof clone !== 'string') {
      return unverifiable('no-marketplace-clone', base);
    }
    let catalog;
    try {
      catalog = JSON.parse(
        git([
          '-C',
          clone,
          'show',
          `${record.gitCommitSha}:.claude-plugin/marketplace.json`,
        ]).toString('utf8'),
      );
    } catch (error) {
      return unverifiable(
        error.code === 'ENOENT' ? 'git-not-found' : 'commit-not-in-clone',
        base,
      );
    }
    const entry = catalog?.plugins?.find?.(
      (plugin) => plugin?.name === record.plugin,
    );
    if (typeof entry?.source !== 'string') {
      return unverifiable('source-not-in-marketplace', base);
    }
    const subdir = path.posix
      .normalize(entry.source.replace(/^\.\//u, ''))
      .replace(/\/$/u, '');
    if (subdir.startsWith('..')) {
      return unverifiable('source-not-in-marketplace', base);
    }
    const released = releaseTree(
      git,
      clone,
      record.gitCommitSha,
      subdir === '.' ? '' : subdir,
    );
    if (!released.size) return unverifiable('empty-release-tree', base);

    const changed = [];
    const extra = [];
    const present = new Set();
    for (const file of copyFiles(root, released)) {
      const want = released.get(file);
      if (!want) {
        extra.push(file);
        continue;
      }
      present.add(file);
      if (want.mode === '160000') continue;
      const have = hashOnDisk(root, file);
      const same = have.link
        ? have.hash === want.hash
        : have.hashes.includes(want.hash);
      if (!same || have.link !== (want.mode === '120000')) {
        changed.push(file);
      }
    }
    const missing = [...released.keys()]
      .filter(
        (file) => !present.has(file) && released.get(file).mode !== '160000',
      )
      .sort();
    const versionMismatch =
      record.version != null &&
      base.version != null &&
      record.version !== base.version;
    const stale =
      changed.length || missing.length || extra.length || versionMismatch;
    return {
      ...base,
      state: stale ? 'stale' : 'ok',
      commit: record.gitCommitSha,
      checked: released.size,
      changed,
      missing,
      extra,
    };
  } catch (error) {
    return unverifiable('check-failed', { error: error.code || error.message });
  }
}

function quoted(value, platform) {
  return platform === 'win32'
    ? `'${String(value).replaceAll("'", "''")}'`
    : `'${String(value).replaceAll("'", "'\\''")}'`;
}

function listed(files) {
  const shown = files.slice(0, LIST_LIMIT).join(', ');
  return files.length > LIST_LIMIT
    ? `${shown} and ${files.length - LIST_LIMIT} more`
    : shown;
}

// The shell line that replaces the folder with a fresh copy: remove it, then
// `claude plugin install`, which downloads an installed plugin whose folder
// is missing (an update would not: it keeps whatever folder exists).
export function integrityFixCommand(result, platform = process.platform) {
  const folder = quoted(result.pluginRoot, platform);
  const install = `claude plugin install ${result.id}`;
  return platform === 'win32'
    ? `Remove-Item -Recurse -Force ${folder}; ${install}`
    : `rm -rf ${folder} && ${install}`;
}

// What doctor (or a session) tells the user; empty unless stale.
export function integrityLines(result, platform = process.platform) {
  if (result?.state !== 'stale') return [];
  const differences = [
    result.changed.length
      ? `${result.changed.length} changed (${listed(result.changed)})`
      : null,
    result.missing.length
      ? `${result.missing.length} missing (${listed(result.missing)})`
      : null,
    result.extra.length
      ? `${result.extra.length} not in the release (${listed(result.extra)})`
      : null,
    result.recordedVersion &&
    result.version &&
    result.recordedVersion !== result.version
      ? `its plugin.json says ${result.version}, Claude Code installed ${result.recordedVersion}`
      : null,
  ].filter(Boolean);
  return [
    `The ZeroH Disclosure folder Claude Code runs (${result.pluginRoot}) is not the ${result.recordedVersion || result.version} release it installed: ${differences.join('; ')}. Claude Code keeps a plugin folder that already exists for a version, so a folder left from an earlier build stays in use after an update.`,
    `To fix it, quit Claude Code, run this in a terminal, then start Claude Code again: ${integrityFixCommand(result, platform)}`,
  ];
}
