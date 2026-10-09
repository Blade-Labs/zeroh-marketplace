// SPDX-License-Identifier: AGPL-3.0-only

import { analyzeBash } from '../shell-scan.js';
import {
  AWK_PROGRAMS,
  awkProgram,
  execCommand,
  GIT_WRITE_SUBCOMMANDS,
  gitCommand,
  interpreterCode,
  interpreterSpec,
  localProgramReach,
  optionWrites,
  optionWritesInto,
  readCode,
  sedProgram,
} from '../shell-programs.js';
import os from 'node:os';
import { isClaudeSettingsOrHookPath, resolvedPair } from './protected-paths.js';
import { claudeControlKind, samePath } from './claude-control.js';
import { codeNamesProtected } from './plain-safe-reads.js';

export const CLAUDE_CONTROL_ENV_RE =
  /^(?:ZEROH_.*|ANTHROPIC_BASE_URL|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|XDG_[A-Z_]+|CLAUDE_CONFIG_DIR|CLAUDE_CODE_PLUGIN_CACHE_DIR|CLAUDE_PROJECT_DIR|PATH|PATHEXT|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_[A-Z_]+|BASH_ENV|ENV|SHELL|COMSPEC|PSMODULEPATH|TMPDIR|TEMP|TMP)$/iu;
export const ZEROH_PLUGIN_ID_RE = /^zeroh-disclosure(?:@|$)/iu;
// ---------------------------------------------------------------------------
// Shell commands that name protected paths (rc.2 item 3, Astra R1).
//
// The command is read with the shared tokenizer (packages/shell-analysis/shell-scan.js), so
// quoting (`--p"re"`, `$'--pre'`, `~/.cl"aude"/settings.json`), launchers and
// nested or inline commands are seen as the shell sees them.
//
// In `pass` mode (the default; owner rule 2026-09-27: ZeroH must not stop
// ordinary work) a command is denied only when it clearly writes, deletes or
// executes against a protected path: rm, mv, cp onto it, sed -i, tee, a `>`
// or `>>` redirection, chmod/chown, truncate, `rg --pre` in any spelling,
// `find -exec`/`-delete`, `xargs rm`, an interpreter given the file as its
// script, and sed, awk or inline code whose write resolves to it
// (protectedEffect). Reads pass. A program that names a protected path but
// whose effect can't be read runs with the notice (`script-or-interpreter`),
// and anything the tokenizer cannot read runs too (`unparseable`).
//
// In `block` mode (opt-in, ZEROH_UNCERTAIN=block) a command naming a
// protected path must be a plain read: cat, head, tail, wc, ls, stat or jq,
// each with only the options listed below, no launcher, no writing
// redirection. Anything else, or anything unparseable, is denied.
//
// ZeroH's own state (the vault, its keys, the signed allow list) is closed to
// shell commands in both modes, as in rc.1 (textReferencesZeroHSettings):
// reading a key file would undo the masking itself.

export const PROTECTED_SHELL_DENY_REASON =
  'ZeroH Disclosure: this command would change or run Claude Code settings, plugin files or hooks. Only the user may change them. To look at these files, use the Read or Grep tool.';
export const PROTECTED_SHELL_BLOCK_REASON =
  'ZeroH Disclosure (uncertain = block): commands that name Claude Code settings, plugin files or hooks may only read them with cat, head, tail, wc, ls, stat or jq. Use the Read or Grep tool to look at these files; only the user may change them.';

// Per-command option allowlists for block mode. Short options may be
// clustered (`-nv`); `values` take the next word or an attached `=value`.
export const SAFE_READERS = Object.freeze({
  cat: {
    flags:
      '-A -b -e -E -n -s -t -T -u -v --show-all --number-nonblank --show-ends --number --squeeze-blank --show-tabs --show-nonprinting',
  },
  head: {
    flags: '-q -v -z --quiet --silent --verbose --zero-terminated',
    values: '-c -n --bytes --lines',
    numeric: true,
  },
  tail: {
    flags:
      '-f -F -q -v -z -r --follow --retry --quiet --silent --verbose --zero-terminated',
    values:
      '-c -n -s --bytes --lines --sleep-interval --pid --max-unchanged-stats',
    numeric: true,
  },
  wc: {
    flags: '-c -m -l -L -w --bytes --chars --lines --max-line-length --words',
  },
  ls: {
    flags:
      '-a -A -b -B -c -C -d -D -f -F -g -G -h -H -i -k -l -L -m -n -N -o -p -q -Q -r -R -s -S -t -u -U -v -x -X -Z -1 ' +
      '--all --almost-all --author --escape --ignore-backups --directory --dired --classify --file-type --no-group ' +
      '--human-readable --si --dereference-command-line --dereference-command-line-symlink-to-dir --inode ' +
      '--kibibytes --dereference --numeric-uid-gid --literal --hide-control-chars --show-control-chars ' +
      '--quote-name --reverse --recursive --size --context --zero --group-directories-first --full-time',
    values:
      '-I -T -w --block-size --color --format --hide --hyperlink --ignore --indicator-style --quoting-style --sort --tabsize --time --time-style --width',
  },
  stat: {
    flags: '-L -f -t --dereference --file-system --terse',
    values: '-c --format --printf --cached',
  },
  jq: {
    flags:
      '-r -j -a -c -n -e -s -S -C -M -R --raw-output --raw-output0 --join-output --ascii-output --compact-output --null-input --exit-status --slurp --sort-keys --color-output --monochrome-output --raw-input --tab --seq --stream --stream-errors',
    values: '--indent',
    pairs: '--arg --argjson',
  },
});

// Programs that read and never write or run anything given these options
// (the Elicitation guard's notion of a plain read).
export const READERS = new Set([
  ...Object.keys(SAFE_READERS),
  'less',
  'more',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'file',
  'bat',
  'get-content',
  'gc',
  'select-string',
  'sls',
  'get-item',
  'gi',
  'get-childitem',
  'gci',
  'dir',
  'test-path',
]);

export const WRITING_REDIRECTS = new Set(['>', '>>', '>|', '<>', '&>', '&>>']);
export const WRITES_ANY_OPERAND = new Set([
  'rm',
  'rmdir',
  'unlink',
  'shred',
  'truncate',
  'chmod',
  'chown',
  'chgrp',
  'touch',
  'tee',
  'sponge',
  'setfacl',
  'chattr',
  'xattr',
  'patch',
  'mv',
  // PowerShell
  'set-content',
  'sc',
  'add-content',
  'ac',
  'out-file',
  'remove-item',
  'del',
  'erase',
  'ri',
  'rd',
  'move-item',
  'move',
  'mi',
  'new-item',
  'ni',
  'clear-content',
  'clc',
  'rename-item',
  'rni',
  'ren',
  'set-item',
  'si',
  'set-acl',
  'tee-object',
]);
export const WRITES_DESTINATION = new Set([
  'cp',
  'install',
  'ln',
  'rsync',
  'scp',
  'copy-item',
  'copy',
  'cpi',
]);
export const SCRIPT_RUNNERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'source',
  '.',
  'python',
  'python3',
  'node',
  'perl',
  'ruby',
  'php',
  'pwsh',
  'powershell',
]);
export const INLINE_CODE_FLAGS = new Set([
  '-c',
  '-e',
  '-E',
  '-r',
  '--eval',
  '-p',
  '--print',
  '-command',
  '-c',
]);

export function splitOptions(list) {
  return new Set(
    String(list ?? '')
      .split(/\s+/u)
      .filter(Boolean),
  );
}

// A word as a path: `~` and the variables the guards know are expanded. On
// Windows, Git Bash (Claude Code's Bash there) names drives /c/…, as its
// own `pwd` does: such a word is also read as C:\… .
export function wordPathValues(word, env, platform = process.platform) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  let value = String(word.value);
  if (word.tilde && (value === '~' || /^~[\\/]/u.test(value)))
    value = home + value.slice(1);
  value = value
    .replace(/^\$(?:\{HOME\}|HOME(?![A-Za-z0-9_]))/u, home)
    .replace(/^\$env:(?:USERPROFILE|HOME)(?![A-Za-z0-9_])/iu, home);
  for (const name of [
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_PLUGIN_ROOT',
    'ZEROH_HOME',
  ]) {
    if (!env[name]) continue;
    value = value.replace(
      new RegExp(
        `^(?:\\$\\{${name}\\}|\\$${name}(?![A-Za-z0-9_])|\\$env:${name}(?![A-Za-z0-9_]))`,
        'iu',
      ),
      env[name],
    );
  }
  const values = [value];
  const attached =
    /^--?[A-Za-z][\w-]*=(.+)$/su.exec(value) || /^of=(.+)$/su.exec(value);
  if (attached) values.push(attached[1]);
  if (platform === 'win32') {
    for (const entry of [...values]) {
      const drive = /^\/([A-Za-z])(?=\/|$)(.*)$/su.exec(entry);
      if (drive) values.push(`${drive[1].toUpperCase()}:${drive[2] || '/'}`);
    }
  }
  return values;
}

export const PROTECTED_VARIABLE_RE =
  /(?:\$env:|\$\{?|%)(?:ZEROH_CLAUDE_SETTINGS|CLAUDE_CONFIG_DIR|CLAUDE_PLUGIN_ROOT)(?:\}|%|\b)/iu;
export const PROTECTED_TEXT_RE =
  /(?:^|[\s'"=:/\\])\.?claude[/\\](?:settings(?:\.local)?\.json|plugins\b)|managed-settings\.json|zeroh-restore\.json/iu;

// A predicate: does this word name a Claude settings file, a plugin file or
// hook, or ZeroH's own state?
export function protectedWordTest(root, opts) {
  const env = opts.env || process.env;
  return (word) => {
    if (!word) return false;
    const raw = String(word.raw ?? word.value ?? '');
    if (PROTECTED_VARIABLE_RE.test(raw) || PROTECTED_TEXT_RE.test(raw))
      return true;
    for (const value of wordPathValues(word, env, opts.platform)) {
      if (!value) continue;
      if (PROTECTED_TEXT_RE.test(value)) return true;
      // The folders that hold them: `find ~/.claude -delete`, `rm -r .claude`.
      const resolved = resolvedPair(value, root, opts.pathImpl);
      for (const folder of [
        opts.configDir,
        opts.pathImpl.join(root, '.claude'),
      ]) {
        const pair = resolvedPair(folder, root, opts.pathImpl);
        if (
          samePath(resolved.lexical, pair.lexical, opts) ||
          samePath(resolved.real, pair.real, opts)
        )
          return true;
      }
      if (claudeControlKind(value, root, opts)) return true;
      if (
        isClaudeSettingsOrHookPath(value, root, {
          platform: opts.platform,
          pathImpl: opts.pathImpl,
          userHome: env.HOME || os.homedir(),
          claudeConfigDir: opts.configDir,
        })
      )
        return true;
    }
    return false;
  };
}

export function words(entry) {
  return [entry.programWord, ...(entry.args || [])].filter(Boolean);
}

export function operandsOf(args) {
  const out = [];
  let rest = false;
  for (const word of args) {
    if (!rest && word.value === '--') {
      rest = true;
      continue;
    }
    if (!rest && word.value.startsWith('-') && word.value.length > 1) continue;
    out.push(word);
  }
  return out;
}

// True when a command clearly writes, deletes or runs against a protected
// path (see the list above), for programs read by their arguments alone.
export function explicitWrite(entry, isProtected, lineNamesProtected) {
  for (const redirect of entry.redirects || []) {
    if (WRITING_REDIRECTS.has(redirect.op) && isProtected(redirect.target))
      return true;
    if (/^[1-6*]?>>?$/u.test(redirect.op) && isProtected(redirect.target))
      return true;
  }
  const program = entry.program;
  if (!program) return false;
  const args = entry.args || [];
  const values = args.map((word) => word.value);
  const anyProtected = words(entry).some(isProtected);
  // A program's own options, read once for the guard and the destination
  // check alike (packages/shell-analysis/shell-programs.js): one that runs another program
  // (`rg --pre`, `tar --to-command`, `sort --compress-program`, `less
  // +!cmd`) against a protected path is a run; one that writes its value
  // (`sort -o`, `tar -cf`) is a write.
  if (localProgramReach(entry).runs) return anyProtected || lineNamesProtected;
  if (optionWrites(entry).some((word) => isProtected(pathWord(word.value))))
    return true;
  if (
    program === 'find' &&
    values.some((v) =>
      /^-(?:exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/u.test(v),
    )
  )
    return anyProtected;
  if (
    entry.stdinArgs &&
    (WRITES_ANY_OPERAND.has(program) || WRITES_DESTINATION.has(program))
  )
    return anyProtected || lineNamesProtected;
  if (WRITES_ANY_OPERAND.has(program)) return args.some(isProtected);
  if (WRITES_DESTINATION.has(program)) {
    const target = args.findIndex((w) =>
      /^(?:-t|--target-directory(?:=.*)?|-destination|-dest)$/iu.test(w.value),
    );
    if (target >= 0) {
      const inline = /^--target-directory=(.*)$/u.exec(values[target]);
      if (inline)
        return isProtected({
          ...args[target],
          value: inline[1],
          raw: inline[1],
        });
      return isProtected(args[target + 1]);
    }
    const operands = operandsOf(args);
    return operands.length > 1 && isProtected(operands.at(-1));
  }
  if (program === 'dd')
    return args.some(
      (w) =>
        /^of=/u.test(w.value) &&
        isProtected({
          ...w,
          value: w.value.slice(3),
          raw: w.raw.replace(/^of=/u, ''),
        }),
    );
  // git's subcommand after its global options (`git -C /tmp rm …`).
  if (
    program === 'git' &&
    GIT_WRITE_SUBCOMMANDS.has(gitCommand(entry).subcommand)
  )
    return args.some(isProtected);
  if (SCRIPT_RUNNERS.has(program) && !interpreterSpec(program)) {
    const operands = operandsOf(args);
    if (operands[0] && isProtected(operands[0])) return true;
    // Shells: their inline code is read as commands (packages/shell-analysis/shell-scan.js);
    // PowerShell's `-Command` too. This covers what that reading can't.
    for (let index = 0; index < args.length; index += 1) {
      if (
        INLINE_CODE_FLAGS.has(values[index].toLowerCase()) ||
        /^-[a-z]*c$/u.test(values[index])
      ) {
        const code = args[index + 1];
        if (code && codeNamesProtected(code.value, isProtected)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// What a command does to protected paths (Astra rc.2 V4): 'write' for a
// recognised write, delete or run against one (a default stop), 'uncertain'
// for a program that names one but whose effect ZeroH can't read (it runs,
// with the notice; block mode denies), null for a recognised read or
// nothing. Programs with a grammar of their own (sed, awk, interpreters) are
// read by it; the others by explicitWrite.
export const WRITE = 'write';
export const UNCERTAIN = 'uncertain';

export function worse(a, b) {
  if (a === WRITE || b === WRITE) return WRITE;
  if (a === UNCERTAIN || b === UNCERTAIN) return UNCERTAIN;
  return null;
}

export function protectedEffect(entry, ctx) {
  if (explicitWrite(entry, ctx.isProtected, ctx.lineNamesProtected))
    return WRITE;
  const program = entry.program;
  if (!program) return null;
  // An extractor writing files ZeroH can't name into a protected folder
  // (`tar -xf a.tar -C ~/.claude`, a plugin's hooks folder): uncertain
  // (Astra pre-1.0.0 R1). Named members are writes, above.
  if (optionWritesInto(entry).some((dir) => extractsIntoProtected(dir, ctx)))
    return UNCERTAIN;
  if (program === 'sed') return sedEffect(entry, ctx);
  if (AWK_PROGRAMS.has(program)) return awkEffect(entry, ctx);
  const interpreter = interpreterCode(entry);
  if (interpreter) return interpreterEffect(interpreter, ctx);
  return null;
}

// A shell command a program runs (sed's `e`, awk's system(), an
// interpreter's os.system): read like any other command line.
export function commandTextEffect(text, ctx) {
  const names = codeNamesProtected(text, ctx.isProtected);
  if (ctx.depth >= 4) return names ? UNCERTAIN : null;
  const analysis = analyzeBash(text);
  if (!analysis.ok) return names ? UNCERTAIN : null;
  let effect = null;
  for (const entry of analysis.commands)
    effect = worse(
      effect,
      protectedEffect(entry, {
        ...ctx,
        depth: ctx.depth + 1,
        lineNamesProtected: ctx.lineNamesProtected || names,
      }),
    );
  return effect;
}

export function extractsIntoProtected(dir, ctx) {
  const base = String(dir.value).replace(/[\\/]+$/u, '');
  return [base, `${base}/settings.json`].some((value) =>
    ctx.isProtected({ ...pathWord(value), raw: value }),
  );
}

// A word for a path the program itself names (a sed `w` file, an awk
// string).
export function pathWord(value) {
  const text = String(value).trim();
  return { value: text, raw: text, tilde: text.startsWith('~') };
}

export function literalNamesProtected(value, ctx) {
  return (
    ctx.isProtected(pathWord(value)) ||
    codeNamesProtected(value, ctx.isProtected)
  );
}

// sed: `-i` on a protected file, a `w`/`W`/`s///w` to one, or one given as
// the script file, is a write; an `e` command is read as a command line; a
// script ZeroH can't see or read (`$SCRIPT`, `-f file`, an unknown
// command) or `s///e` is uncertain when the script or sed's files name a
// protected path.
export function sedEffect(entry, ctx) {
  const { isProtected } = ctx;
  const sed = sedProgram(entry);
  if (sed.inPlace && (entry.args || []).some(isProtected)) return WRITE;
  if (sed.scriptFiles.some(isProtected)) return WRITE;
  const { program } = sed;
  if (program.writes.some((file) => literalNamesProtected(file, ctx)))
    return WRITE;
  let effect = null;
  let unresolved = false;
  for (const command of program.executes) {
    if (!command.trim()) unresolved = true;
    else effect = worse(effect, commandTextEffect(command, ctx));
  }
  if (effect === WRITE) return WRITE;
  const scriptText = sed.scripts.map((word) => word.value).join('\n');
  const named =
    codeNamesProtected(scriptText, isProtected) || sed.files.some(isProtected);
  if (!named) return effect;
  if (!program.ok || sed.scriptFiles.length || unresolved)
    return worse(effect, UNCERTAIN);
  return effect;
}

// awk: `-i inplace` on a protected file, a protected program file, and an
// output redirection or pipe whose target resolves to a protected path (a
// string, FILENAME of a protected input, a `-v`/operand/program variable
// holding one) are writes; system(), print pipes and `cmd | getline` with a
// string command are read as command lines. When the program, its
// assignments or its files name a protected path, a redirection or command
// ZeroH can't resolve, or a program it can't see or read, is uncertain.
export function awkEffect(entry, ctx) {
  const { isProtected } = ctx;
  const awk = awkProgram(entry);
  if (awk.programFiles.some(isProtected)) return WRITE;
  if (awk.inPlace && awk.files.some(isProtected)) return WRITE;
  const variables = { ...awk.scan.assigns };
  for (const word of awk.assignments) {
    const match = /^([A-Za-z_]\w*)=(.*)$/su.exec(String(word.value));
    if (match) variables[match[1]] = word.dynamic ? null : match[2];
  }
  const inputs = awk.files.filter(
    (word) => !/^[A-Za-z_]\w*=/u.test(String(word.value)),
  );
  // A target's paths, or null when it can't be resolved.
  const resolve = (target) => {
    if (target.literal !== undefined) return [target.literal];
    if (target.name === 'FILENAME')
      return inputs.some((word) => word.dynamic)
        ? null
        : inputs.map((word) => String(word.value));
    if (target.name !== undefined)
      return typeof variables[target.name] === 'string'
        ? [variables[target.name]]
        : null;
    return null;
  };
  let effect = null;
  let unresolved = false;
  for (const redirect of awk.scan.redirects) {
    const resolved = resolve(redirect.target);
    if (resolved === null) {
      unresolved = true;
      continue;
    }
    if (redirect.kind === 'file') {
      if (resolved.some((file) => literalNamesProtected(file, ctx)))
        return WRITE;
    } else
      for (const command of resolved)
        effect = worse(effect, commandTextEffect(command, ctx));
  }
  for (const target of [
    ...awk.scan.system,
    ...awk.scan.getline
      .filter((g) => g.kind === 'command')
      .map((g) => g.target),
  ]) {
    if (target.literal === undefined) unresolved = true;
    else effect = worse(effect, commandTextEffect(target.literal, ctx));
  }
  if (effect === WRITE) return WRITE;
  const programText = awk.programs.map((word) => word.value).join('\n');
  const named =
    codeNamesProtected(programText, isProtected) ||
    awk.assignments.some((word) =>
      codeNamesProtected(String(word.value), isProtected),
    ) ||
    awk.files.some(isProtected);
  if (!named) return effect;
  if (
    awk.dynamic ||
    !awk.programs.length ||
    awk.programFiles.length ||
    !awk.scan.ok ||
    unresolved
  )
    return worse(effect, UNCERTAIN);
  return effect;
}

// An interpreter: its script or an in-place edit (`perl -pi`) of a
// protected file is a write; inline code is read by its language's table
// (readCode): a write call naming a protected path is a write, a read call
// is a read, a command it runs is read as a command line, and a write, open
// or run ZeroH can't resolve is uncertain when the code names a protected
// path. Code ZeroH can't see (stdin from a pipe or a file) is uncertain
// when the line names one.
export function interpreterEffect(interpreter, ctx) {
  const { isProtected } = ctx;
  if (interpreter.script && isProtected(interpreter.script)) return WRITE;
  if (interpreter.inPlace && interpreter.operands.some(isProtected))
    return WRITE;
  let effect = null;
  for (const { code, dynamic } of interpreter.code) {
    if (dynamic) {
      if (ctx.lineNamesProtected) effect = worse(effect, UNCERTAIN);
      continue;
    }
    effect = worse(effect, codeEffect(code, interpreter.language, ctx));
    if (effect === WRITE) return WRITE;
  }
  return effect;
}

export function codeEffect(code, language, ctx) {
  const names = (text) => codeNamesProtected(String(text), ctx.isProtected);
  if (!names(code)) return null;
  const scan = readCode(code, language);
  if (!scan.language) return UNCERTAIN;
  const argNames = (arg) =>
    Boolean(arg) &&
    (arg.literal !== null && arg.literal !== undefined
      ? literalNamesProtected(arg.literal, ctx)
      : names(arg.text));
  let effect = scan.ok ? null : UNCERTAIN;
  let unresolved = false;
  for (const call of scan.calls) {
    if (call.kind === 'write') {
      if (call.targets.some(argNames)) return WRITE;
      if (call.targets.some((arg) => arg.literal === null)) unresolved = true;
    } else if (call.kind === 'open') {
      unresolved = true;
    } else if (call.kind === 'exec') {
      const command = execCommand(call);
      if (command === null) unresolved = true;
      else {
        effect = worse(effect, commandTextEffect(command, ctx));
        if (effect === WRITE) return WRITE;
      }
    } else if (call.kind === 'eval' || call.kind === 'dynamic')
      unresolved = true;
  }
  return unresolved ? worse(effect, UNCERTAIN) : effect;
}
