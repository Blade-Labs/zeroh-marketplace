// SPDX-License-Identifier: AGPL-3.0-only

import {
  ignoredControlPath,
  isZeroHSettingsPath,
  realpathWherePossible,
  SETTINGS_DENY_REASON,
} from './protected-paths.js';
import { SHELL_TOOLS, shellOf } from '../shell-tools.js';
import { analyzeShell, shellReadings } from '../shell-scan.js';
import {
  localProgramReach,
  optionWrites,
  optionWritesInto,
} from '../shell-programs.js';
import { uncertainMode } from '../../zeroh-disclosure-core/config.js';
import {
  PROTECTED_SHELL_BLOCK_REASON,
  PROTECTED_SHELL_DENY_REASON,
  PROTECTED_TEXT_RE,
  PROTECTED_VARIABLE_RE,
  READERS,
  SAFE_READERS,
  UNCERTAIN,
  WRITE,
  extractsIntoProtected,
  pathWord,
  protectedEffect,
  protectedWordTest,
  splitOptions,
  worse,
  words,
  wordPathValues,
} from './explicit-writes.js';
import { commandNamesClaudeControl, controlOptions } from './claude-control.js';
import { VERIFIED_CLI } from './management.js';
import {
  cachedRoadmapCliDenial,
  cachedRoadmapCliWordTest,
} from './roadmap-cli.js';

export function codeNamesProtected(code, isProtected) {
  if (PROTECTED_TEXT_RE.test(code) || PROTECTED_VARIABLE_RE.test(code))
    return true;
  return code
    .split(/[\s'"=<>|;&(){},]+/u)
    .filter(Boolean)
    .some((part) =>
      isProtected({ value: part, raw: part, tilde: part.startsWith('~') }),
    );
}

export function optionsAllowed(spec, args) {
  const flags = splitOptions(spec.flags);
  const values = splitOptions(spec.values);
  const pairs = splitOptions(spec.pairs);
  let operandsOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    const value = word.value;
    if (operandsOnly || !value.startsWith('-') || value === '-') continue;
    if (value === '--') {
      operandsOnly = true;
      continue;
    }
    if (word.dynamic) return false;
    if (spec.numeric && /^-\d+$/u.test(value)) continue;
    if (value.startsWith('--')) {
      const [name, inline] = value.split(/=(.*)/su);
      if (flags.has(name) && inline === undefined) continue;
      if (values.has(name)) {
        if (inline === undefined) index += 1;
        continue;
      }
      if (pairs.has(name)) {
        index += 2;
        continue;
      }
      return false;
    }
    for (let k = 1; k < value.length; k += 1) {
      const option = `-${value[k]}`;
      if (flags.has(option)) continue;
      if (values.has(option)) {
        if (k === value.length - 1) index += 1;
        break;
      }
      return false;
    }
  }
  return true;
}

export function harmlessRedirect(redirect) {
  const target = redirect.target?.value;
  if (redirect.op === '>&' || redirect.op === '<&')
    return /^(?:[0-2]|-)$/u.test(target ?? '');
  if (redirect.op === '>' || redirect.op === '>>')
    return redirect.fd === '2' && target === '/dev/null';
  if (redirect.op === '<') return target === '/dev/null';
  return false;
}

// Block mode: every command is a listed reader with listed options.
export function plainSafeRead(analysis) {
  if (!analysis.ok || !analysis.commands.length) return false;
  return analysis.commands.every((entry) => {
    if (
      entry.inline ||
      entry.dynamicProgram ||
      entry.dynamicCode ||
      entry.foreignCode
    )
      return false;
    if (entry.launchers?.length || entry.assignments?.length || entry.stdinArgs)
      return false;
    if (!(entry.redirects || []).every(harmlessRedirect)) return false;
    const spec = Object.hasOwn(SAFE_READERS, entry.program ?? '')
      ? SAFE_READERS[entry.program]
      : null;
    return Boolean(spec) && optionsAllowed(spec, entry.args || []);
  });
}

// The Elicitation guard's plain read: listed readers, no option that runs
// another program, no writing redirection.
export function isReadOnlyInspection(command, shell = 'bash') {
  const analysis = analyzeShell(String(command), shell);
  if (!analysis.ok || !analysis.commands.length) return false;
  return analysis.commands.every((entry) => {
    if (
      entry.inline ||
      entry.dynamicProgram ||
      entry.dynamicCode ||
      entry.foreignCode
    )
      return false;
    if (entry.launchers?.length || entry.stdinArgs) return false;
    if (!(entry.redirects || []).every(harmlessRedirect)) return false;
    if (!READERS.has(entry.program ?? '')) return false;
    // An option that runs another program (packages/shell-analysis/shell-programs.js).
    return !localProgramReach(entry).runs;
  });
}

// The parser lists commands in execution order, with nested shell origins.
// Keep directory state local to each shell scope. Where control flow or an
// expansion prevents an exact directory, keep the uncertainty explicit.
function commandEnd(entry) {
  return Math.max(
    ...(entry.words || []).map((word) => word.end ?? 0),
    ...(entry.redirects || []).map((redirect) => redirect.target?.end ?? 0),
  );
}

function updateDirectoryScope(entry, scope, command, opts) {
  const state = scope.state;
  const program = entry.program?.toLowerCase();
  const changesDirectory = [
    'cd',
    'chdir',
    'pushd',
    'push-location',
    'set-location',
    'sl',
    'popd',
    'pop-location',
  ].includes(program);
  const startsPipeline = /^\|(?!\|)/u.test(
    command.slice(commandEnd(entry)).trimStart(),
  );
  if (
    !entry.piped &&
    !entry.background &&
    !startsPipeline &&
    changesDirectory
  ) {
    const args = (entry.args || []).filter(
      (word) =>
        !['--', '-L', '-P', '-literalpath', '-path'].includes(word.value),
    );
    let next = null;
    if (program === 'popd' || program === 'pop-location') {
      next = args.length === 0 ? state.stack.at(-1) : null;
      scope.state = next
        ? {
            ...next,
            stack: state.stack.slice(0, -1),
            homeChanged: state.homeChanged,
            cdpathChanged: state.cdpathChanged,
          }
        : { ...state, unknown: true };
    } else {
      const target = args[0];
      const value =
        args.length === 0
          ? opts.env.HOME
          : wordPathValues(target, opts.env, opts.platform)[0];
      const determinable =
        args.length <= 1 &&
        value &&
        !/[\$`%*?{}]/u.test(value) &&
        value !== '-' &&
        !target?.dynamic &&
        !target?.glob &&
        !target?.brace &&
        !opts.env.CDPATH &&
        !state.cdpathChanged &&
        !(state.homeChanged && (target?.tilde || !args.length));
      if (determinable) {
        const absolute = opts.pathImpl.isAbsolute(value);
        const directories = state.directories.flatMap((directory) => {
          const lexical = opts.pathImpl.resolve(directory, value);
          return [lexical, realpathWherePossible(lexical, opts.pathImpl)];
        });
        next = {
          ...state,
          directories: [...new Set(directories)],
          unknown: state.unknown && !absolute,
        };
      }
      if (program === 'pushd' || program === 'push-location') {
        const stack = [...state.stack, state];
        scope.state = next
          ? { ...next, stack }
          : { ...state, unknown: true, stack };
      } else scope.state = next || { ...state, unknown: true };
    }
    // A failing cd before `;` may leave the old cwd; a successful cd before
    // `&&` establishes the new cwd. Both possible paths must be guarded.
    scope.state = {
      ...scope.state,
      failedDirectories: [
        ...new Set([...(state.failedDirectories || []), ...state.directories]),
      ],
      failedUnknown: state.failedUnknown || state.unknown,
    };
    const end = commandEnd(entry);
    const following = command.slice(end).trimStart();
    if (
      !following.startsWith('&&') ||
      entry.inline ||
      entry.piped ||
      entry.background
    ) {
      scope.state = {
        ...scope.state,
        directories: [
          ...new Set([...scope.state.directories, ...state.directories]),
        ],
        unknown: scope.state.unknown || state.unknown,
      };
    }
  }
}

function commandDirectories(reading, initialCwd, command, opts) {
  const initial = { directories: [initialCwd], unknown: false, stack: [] };
  const scopes = [{ key: 'false:top:0', state: initial }];
  let previous = null;
  return reading.commands.map((entry) => {
    const key = `${Boolean(entry.inline)}:${entry.origin}:${entry.depth}`;
    let existing = scopes.findLastIndex((scope) => scope.key === key);
    // Sibling subshells/substitutions have the same origin and depth. Their
    // directories start from the parent, rather than from the previous group.
    if (existing > 0 && entry.origin !== 'top' && scopes[existing].previous) {
      const between = command.slice(
        commandEnd(scopes[existing].previous),
        entry.programWord?.start,
      );
      if (between.trimStart().startsWith(')')) {
        scopes.splice(existing);
        existing = -1;
      }
    }
    if (existing >= 0) scopes.splice(existing + 1);
    else {
      const parent = scopes.at(-1).state;
      scopes.push({ key, state: { ...parent, stack: [...parent.stack] } });
    }
    const scope = scopes.at(-1);
    const gap = scope.previous
      ? command.slice(commandEnd(scope.previous), entry.programWord?.start)
      : '';
    // Later OR/sequence commands can run after an earlier cd in an AND chain
    // failed. Do not lose that original cwd when narrowing the success path.
    if (scope.previous && (entry.inline || /\|\||[;\n]/u.test(gap))) {
      scope.state = {
        ...scope.state,
        directories: [
          ...new Set([
            ...scope.state.directories,
            ...(scope.state.failedDirectories || []),
          ]),
        ],
        unknown: scope.state.unknown || scope.state.failedUnknown,
      };
    }
    for (const word of [...(entry.words || []), ...(entry.assignments || [])]) {
      if (/^HOME=/u.test(word.value)) {
        scope.state = { ...scope.state, homeChanged: true };
      }
      if (/^CDPATH=/u.test(word.value)) {
        scope.state = { ...scope.state, cdpathChanged: true };
      }
    }
    const state = scope.state;
    const result = {
      entry,
      directories: state.directories,
      unknown: state.unknown,
    };
    updateDirectoryScope(entry, scope, command, opts);
    // A new inline script uses offsets from its own string. The flat parser
    // cannot establish its scope after another inline script: remain cautious.
    if (
      entry.inline &&
      previous?.inline &&
      entry.programWord?.start < previous.programWord?.start
    )
      result.unknown = true;
    previous = entry;
    scope.previous = entry;
    return result;
  });
}

function unknownProtectedName(word, opts) {
  return wordPathValues(word, opts.env, opts.platform).some((value) => {
    if (opts.pathImpl.isAbsolute(value)) return false;
    const base = opts.pathImpl.basename(value).toLowerCase();
    return (
      /^(?:settings(?:\.[^/\\]+)?\.json|managed-settings\.json|config\.env|\.zeroh\.(?:env|policy)|(?:vault|allow)\.key|allow\.json|unmask\.json)$/u.test(
        base,
      ) || base === opts.pathImpl.basename(opts.settingsPath).toLowerCase()
    );
  });
}

// A path an option names only with its value attached (`-C/…/.claude`,
// `unzip -d/…`, `7z -o/…`) is named too, as the shared reader reads it.
function entryOptionsNameProtected(entry, isProtected) {
  return (
    optionWrites(entry).some((word) => isProtected(pathWord(word.value))) ||
    optionWritesInto(entry).some((dir) =>
      extractsIntoProtected(dir, { isProtected }),
    )
  );
}

// True when `entry` names a matching path: a word (`wordTest`), or a redirect
// target or option path (`targetTest`).
function entryNames(entry, wordTest, targetTest = wordTest) {
  return (
    words(entry).some(wordTest) ||
    (entry.redirects || []).some((redirect) => targetTest(redirect.target)) ||
    entryOptionsNameProtected(entry, targetTest)
  );
}

// The decision for a shell command that may name protected paths:
// { deny, reason, unchecked } where `unchecked` is a packages/zeroh-disclosure-core/unchecked.js reason
// for a command that passed without being read.
export function protectedShellDecision(
  toolName,
  input,
  root = process.cwd(),
  options = {},
) {
  const none = { deny: false, reason: null, unchecked: null };
  if (!SHELL_TOOLS.has(toolName) || typeof input?.command !== 'string')
    return none;
  const opts = controlOptions(root, options);
  const mode = options.mode || uncertainMode(opts.env);
  const command = input.command;
  const shell = shellOf(toolName);
  const commandCwd = options.commandCwd || root;
  const ignoredPath = options.presentationCliPath;
  let zeroHNamed = false;
  const contexts = shellReadings(command, shell)
    .filter((reading) => reading.ok)
    .map((reading) => ({
      entries: commandDirectories(reading, commandCwd, command, opts).map(
        (context) => {
          // A ZeroH CLI path supplied relative to the policy root is still
          // an attempted plugin invocation when run from another cwd. Only
          // the validated presentation invocation may use that plugin file.
          const verifiedCli = (word) =>
            !ignoredPath &&
            !word.dynamic &&
            ignoredControlPath(word.value, VERIFIED_CLI, root, opts);
          // Does `word` name a protected path when the entry runs from
          // `directory`?
          const protectedFrom = (directory, word) => {
            if (verifiedCli(word)) return true;
            if (
              ignoredPath &&
              !word.dynamic &&
              ignoredControlPath(word.value, ignoredPath, directory, opts)
            )
              return false;
            if (protectedWordTest(directory, opts)(word)) return true;
            const zeroH = wordPathValues(word, opts.env, opts.platform).some(
              (value) =>
                isZeroHSettingsPath(
                  opts.pathImpl.resolve(directory, value),
                  root,
                  { ...opts, home: opts.env.ZEROH_HOME },
                ),
            );
            if (zeroH) zeroHNamed = true;
            return zeroH;
          };
          return {
            ...context,
            protectedFrom,
            isUncertain: (word) =>
              Boolean(
                word && context.unknown && unknownProtectedName(word, opts),
              ),
            isProtected: (word) =>
              Boolean(word) &&
              (verifiedCli(word) ||
                context.directories.some((directory) =>
                  protectedFrom(directory, word),
                )),
          };
        },
      ),
    }));
  const namesProtected = commandNamesClaudeControl(
    command,
    commandCwd,
    opts,
    ignoredPath,
  );
  const tokenNamed = contexts.some(({ entries }) =>
    entries.some(({ entry, isProtected }) => entryNames(entry, isProtected)),
  );
  const unknownTarget = contexts.some(({ entries }) =>
    entries.some(({ entry, isUncertain }) => entryNames(entry, isUncertain)),
  );
  if (!namesProtected && !tokenNamed && !unknownTarget) return none;
  const decision = protectedPathDecision(contexts, {
    none,
    mode,
    command,
    shell,
    zeroHNamed,
    lineNamesProtected: namesProtected || tokenNamed || unknownTarget,
  });
  // The zeroh-roadmap CLI run from a plugin cache, by node, an interpreter
  // named node, its own shebang or a link, is denied in both modes; the denial names
  // the repository copy instead (roadmap-cli.js, Astra PR #1969). When the
  // same line also writes or reads another protected path (a redirect into
  // Claude settings, ZeroH's own files), the protected-path refusal above
  // keeps its message: the cached CLI is not the only reason.
  const roadmapDenial = cachedRoadmapCliDenial(contexts, opts);
  if (!roadmapDenial) return decision;
  if (
    decision.deny &&
    (zeroHNamed || unknownTarget || protectedBeyondCache(contexts, opts))
  )
    return decision;
  return roadmapDenial;
}

// True when an entry names a protected path other than the cached
// zeroh-roadmap CLI itself (or the folder a `cd` enters to reach it): another
// word, a redirect target or an option path.
function protectedBeyondCache(contexts, opts) {
  const cacheWord = cachedRoadmapCliWordTest(contexts, opts);
  return contexts.some(({ entries }) =>
    entries.some((context) =>
      entryNames(
        context.entry,
        (word) => context.isProtected(word) && !cacheWord(context, word),
        context.isProtected,
      ),
    ),
  );
}

// The protected-path decision for a line that names one (the body of
// protectedShellDecision before the roadmap CLI special case).
function protectedPathDecision(
  contexts,
  { none, mode, command, shell, zeroHNamed, lineNamesProtected },
) {
  if (mode === 'block') {
    // The shell's own reading decides; it must be a plain read.
    return plainSafeRead(analyzeShell(command, shell))
      ? none
      : {
          deny: true,
          reason: zeroHNamed
            ? SETTINGS_DENY_REASON
            : PROTECTED_SHELL_BLOCK_REASON,
          unchecked: null,
        };
  }
  if (!contexts.length)
    return { deny: false, reason: null, unchecked: 'unparseable' };
  const ctx = { lineNamesProtected, depth: 0 };
  let effect = null;
  for (const { entries } of contexts)
    for (const { entry, isProtected, isUncertain } of entries) {
      const entryEffect = protectedEffect(entry, { ...ctx, isProtected });
      effect = worse(effect, entryEffect);
      if (entryNames(entry, isUncertain)) effect = worse(effect, UNCERTAIN);
    }
  if (effect === WRITE)
    return {
      deny: true,
      reason: zeroHNamed ? SETTINGS_DENY_REASON : PROTECTED_SHELL_DENY_REASON,
      unchecked: null,
    };
  // Names a protected path, but what it does to it can't be read: it runs,
  // with the notice (principle 4; block mode denied above).
  if (effect === UNCERTAIN)
    return { deny: false, reason: null, unchecked: 'script-or-interpreter' };
  return none;
}

// ---------------------------------------------------------------------------
// The ZeroH CLI from a model's shell (a UX layer since rc.2; Astra R3/R6).
//
// The enforcement is in the CLI itself: every state-changing subcommand
// requires the user's authority (packages/zeroh-disclosure-core/user-authority.js). This check only
// answers early, with a clear message, when a command plainly runs a
// management subcommand: the CLI by any path or launcher, in command position
// (`zeroh-disclosure proxy off`, `env -u X zeroh-disclosure …`, `node
// …/bin/zeroh-disclosure.mjs …`, `npx zeroh-disclosure …`, `$(which
// zeroh-disclosure) …`, `bash -c "…"`), or after a program ZeroH does not
// know followed by a known management subcommand. A quoted argument is text
// unless an interpreter runs it (`rg 'zeroh-disclosure proxy off' README.md`).
