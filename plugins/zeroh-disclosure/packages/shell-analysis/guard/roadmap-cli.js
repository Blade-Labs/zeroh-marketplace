// SPDX-License-Identifier: AGPL-3.0-only

// The zeroh-roadmap CLI run from an installed plugin cache (owner session,
// 2026-11-09):
//
//   node ~/.claude/plugins/cache/<marketplace>/zeroh-roadmap/<version>/bin/roadmap.mjs status
//
// stays denied like any other plugin file: the guard does not run code from
// the Claude plugins folder. An allowance was tried for `status` and `phase
// validate` and refused in review (Astra, PR #1969):
//
// - Both commands import the repository's TypeScript records through tsx, so
//   they run model-editable code that can change settings, hooks or plugin
//   files, or read ZeroH keys, without naming any of those paths.
// - The interpreter (`/tmp/node`, PATH, the shebang) and inherited loaders
//   (`NODE_OPTIONS=--require …` from the environment) are outside what the
//   guard can see in the command.
// - A cache-shaped path proves nothing about who wrote the file, and the file
//   can change between the check and the run.
//
// This module recognizes the command when node, an interpreter named node,
// the script's own shebang or a link starts it, and says what to do instead:
// run the CLI from a copy outside the plugins folder, such as the
// repository's own checkout. Other runners (tsx, bun, deno, ts-node), an
// inline `node -e "import(…)"`, a path held in a shell variable and the stdin
// forms are not recognized here; they keep whatever the protected-path check
// decides. It never relaxes a decision, and it only speaks when the cached
// CLI is the reason: a line that also writes or reads another protected path
// keeps the protected-path refusal (plain-safe-reads.js).
import { comparisonKey, realpathWherePossible } from './protected-paths.js';
import { wordPathValues } from './explicit-writes.js';

export const ROADMAP_CACHE_DENY_REASON =
  'ZeroH Disclosure: this command runs the zeroh-roadmap CLI from the Claude plugins folder. ZeroH does not run plugin files from there, because the CLI also runs the repository’s TypeScript records and could change Claude Code settings, plugin files or hooks. Run a copy outside the plugins folder instead, for example the repository’s own: in the ZeroH repository, `node apps/zeroh-marketplace/plugins/zeroh-roadmap/bin/roadmap.mjs phase validate --all` or `pnpm roadmap:status`. To look at the plugin’s files, use the Read or Grep tool.';

const NODE_PROGRAMS = new Set(['node', 'nodejs']);
const CD_PROGRAMS = new Set(['cd', 'pushd']);
const CHAIN = ['bin', '*', 'zeroh-roadmap', '*', 'cache', 'plugins'];

// True when `file` is spelled
// <anything>/plugins/cache/<marketplace>/zeroh-roadmap/<version>/bin/roadmap.mjs.
function cacheShaped(file, pathImpl, platform) {
  if (comparisonKey(pathImpl.basename(file), platform) !== 'roadmap.mjs')
    return false;
  let cursor = pathImpl.dirname(file);
  for (const name of CHAIN) {
    const base = pathImpl.basename(cursor);
    if (!base || base === '.' || base === '..') return false;
    if (name !== '*' && comparisonKey(base, platform) !== name) return false;
    cursor = pathImpl.dirname(cursor);
  }
  return true;
}

// The paths `word` may name from the entry's possible `directories`,
// lexically and through a link; none for a word that cannot be read as one
// path. A word spelled with a variable counts once `wordPathValues` has
// expanded it fully ($HOME, $CLAUDE_CONFIG_DIR); one that still holds a `$`
// or a backtick does not.
function wordPaths(word, directories, opts) {
  if (!word || word.glob || word.brace) return [];
  const paths = [];
  for (const value of wordPathValues(
    word,
    opts.env || process.env,
    opts.platform,
  )) {
    if (word.dynamic && /[$`]/u.test(value)) continue;
    for (const directory of directories || []) {
      const lexical = opts.pathImpl.resolve(directory, value);
      // A missing leaf is followed through its nearest existing folder.
      paths.push(lexical, realpathWherePossible(lexical, opts.pathImpl));
    }
  }
  return paths;
}

// The cache-shaped roadmap.mjs paths `word` names.
function cachedCliPaths(word, directories, opts) {
  return wordPaths(word, directories, opts).filter((file) =>
    cacheShaped(file, opts.pathImpl, opts.platform),
  );
}

// The cached roadmap.mjs paths `entry` runs, directly or as node's script
// (after any node options).
function cachedCliPathsRunBy(entry, directories, opts) {
  if (!entry?.program || entry.dynamicProgram) return [];
  const candidates = [entry.programWord];
  if (NODE_PROGRAMS.has(entry.program)) candidates.push(...(entry.args || []));
  return candidates.flatMap((word) => cachedCliPaths(word, directories, opts));
}

function cachedCliPathsRun(contexts, opts) {
  return contexts.flatMap(({ entries }) =>
    entries.flatMap((context) =>
      cachedCliPathsRunBy(context.entry, context.directories, opts),
    ),
  );
}

// True when `folder` is a folder above `file`.
function holds(folder, file, { pathImpl, platform }) {
  const relative = pathImpl.relative(
    comparisonKey(folder, platform),
    comparisonKey(file, platform),
  );
  return Boolean(
    relative && !relative.startsWith('..') && !pathImpl.isAbsolute(relative),
  );
}

// True when a plain relative `word` of an entry that runs the cached CLI is
// protected (by the guard's per-directory `protectedFrom`) only because the
// entry runs inside the CLI's own version folder
// (`cd <version>/bin && node roadmap.mjs status`: `node` and `status` then
// resolve into the plugins folder). A word that leaves that folder, such as
// `../../../../../settings.json`, is still another protected path.
function insideCliFolderOnly(word, { directories, protectedFrom }, run, opts) {
  const { pathImpl } = opts;
  if (word.dynamic || word.glob || word.brace || word.tilde) return false;
  if (pathImpl.isAbsolute(String(word.value))) return false;
  const versions = run.map((file) => pathImpl.dirname(pathImpl.dirname(file)));
  return (directories || []).every(
    (directory) =>
      !protectedFrom(directory, word) ||
      // A folder reached through a link is compared by where it really is.
      wordPaths(word, [realpathWherePossible(directory, pathImpl)], opts).every(
        (file) => versions.some((version) => holds(version, file, opts)),
      ),
  );
}

// A test (context, word) for the words that are the cached CLI rather than
// another protected path: the CLI itself, the folder a `cd` or `pushd` enters
// on the way to a cached CLI the line runs, and the CLI's own relative
// arguments once the line is inside its folder.
export function cachedRoadmapCliWordTest(contexts, opts) {
  const run = cachedCliPathsRun(contexts, opts);
  return (context, word) => {
    const { entry, directories } = context;
    if (cachedCliPaths(word, directories, opts).length) return true;
    if (CD_PROGRAMS.has(entry.program))
      return (
        word !== entry.programWord &&
        wordPaths(word, directories, opts).some((folder) =>
          run.some((file) => holds(folder, file, opts)),
        )
      );
    return (
      cachedCliPathsRunBy(entry, directories, opts).length > 0 &&
      insideCliFolderOnly(word, context, run, opts)
    );
  };
}

// The denial when any entry of the parsed `contexts` runs the cached
// zeroh-roadmap CLI, or null.
export function cachedRoadmapCliDenial(contexts, opts) {
  if (!cachedCliPathsRun(contexts, opts).length) return null;
  return {
    deny: true,
    reason: ROADMAP_CACHE_DENY_REASON,
    unchecked: null,
  };
}
