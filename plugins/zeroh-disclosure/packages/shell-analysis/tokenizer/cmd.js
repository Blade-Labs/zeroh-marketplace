// SPDX-License-Identifier: AGPL-3.0-only

import { ASSIGNMENT_RE } from './bash-sequence.js';

export function programName(value) {
  return String(value ?? '')
    .replace(/^.*[\\/]/u, '')
    .replace(/\.(?:exe|cmd|bat|com)$/iu, '')
    .toLowerCase();
}

// Launchers and wrappers that run the command after their options. For each:
// options with a value (`args`), options without (`flags`, anything else is
// taken as a flag too), a count of positional words before the command
// (`positional`), and special behaviour.
export const LAUNCHERS = Object.freeze({
  env: {
    args: ['-u', '-C', '-P', '--unset', '--chdir'],
    split: ['-S', '--split-string'],
    assignments: true,
  },
  timeout: { args: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
  nohup: {},
  sudo: {
    args: [
      '-u',
      '-g',
      '-C',
      '-D',
      '-h',
      '-p',
      '-r',
      '-t',
      '-U',
      '-T',
      '-R',
      '--user',
      '--group',
      '--close-from',
      '--chdir',
      '--host',
      '--prompt',
      '--role',
      '--type',
      '--other-user',
      '--command-timeout',
      '--chroot',
    ],
    assignments: true,
  },
  doas: { args: ['-u', '-C'] },
  command: { lookup: ['-v', '-V'] },
  builtin: {},
  exec: { args: ['-a'] },
  nice: { args: ['-n', '--adjustment'] },
  ionice: {
    args: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'],
  },
  stdbuf: { args: ['-i', '-o', '-e', '--input', '--output', '--error'] },
  time: { args: ['-f', '-o', '--format', '--output'] },
  setsid: {},
  chroot: { args: ['--userspec', '--groups'], positional: 1 },
  xargs: {
    args: [
      '-a',
      '-d',
      '-E',
      '-I',
      '-L',
      '-n',
      '-P',
      '-s',
      '--arg-file',
      '--delimiter',
      '--eof',
      '--replace',
      '--max-lines',
      '--max-args',
      '--max-procs',
      '--max-chars',
      '--process-slot-var',
    ],
    stdinArgs: true,
    defaultProgram: 'echo',
  },
});

export const LAUNCHER_NAMES = Object.freeze(Object.keys(LAUNCHERS));

export function takesValue(spec, option) {
  return (
    (spec.args || []).includes(option) || (spec.split || []).includes(option)
  );
}

// Unwraps launchers from a command's words: { program, programWord, args,
// launchers, stdinArgs, lookupOnly, dynamicProgram, splitString }. A launcher
// option that is dynamic (`env $OPTS curl`) hides the program: dynamicProgram.
export function unwrapCommand(words) {
  const out = {
    program: null,
    programWord: null,
    args: [],
    launchers: [],
    stdinArgs: false,
    lookupOnly: false,
    dynamicProgram: false,
    splitString: null,
    splitWord: null,
  };
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word.dynamic || word.brace) {
      out.dynamicProgram = true;
      out.programWord = word;
      out.args = words.slice(index + 1);
      return out;
    }
    const name = programName(word.value);
    const spec = Object.hasOwn(LAUNCHERS, name) ? LAUNCHERS[name] : null;
    if (!spec) {
      out.program = name;
      out.programWord = word;
      out.args = words.slice(index + 1);
      return out;
    }
    out.launchers.push(name);
    if (spec.stdinArgs) out.stdinArgs = true;
    index += 1;
    let positional = spec.positional || 0;
    for (;;) {
      const current = words[index];
      if (!current) break;
      if (current.dynamic || current.brace) {
        out.dynamicProgram = true;
        out.programWord = current;
        out.args = words.slice(index + 1);
        return out;
      }
      const value = current.value;
      if (value === '--') {
        index += 1;
        while (
          spec.assignments &&
          words[index] &&
          !words[index].dynamic &&
          ASSIGNMENT_RE.test(words[index].value)
        )
          index += 1;
        break;
      }
      if (spec.lookup?.includes(value)) {
        out.lookupOnly = true;
        index += 1;
        continue;
      }
      if (spec.assignments && ASSIGNMENT_RE.test(value)) {
        index += 1;
        continue;
      }
      if (value.startsWith('--') && value.length > 2) {
        const [option, inline] = value.split(/=(.*)/su);
        if ((spec.split || []).includes(option)) {
          out.splitString = inline ?? words[index + 1]?.value ?? '';
          out.splitWord = words[index + (inline === undefined ? 1 : 0)] ?? null;
          out.args = words.slice(index + (inline === undefined ? 2 : 1));
          return out;
        }
        index += inline === undefined && takesValue(spec, option) ? 2 : 1;
        continue;
      }
      if (/^-\d+$/u.test(value) && name === 'nice') {
        index += 1;
        continue;
      }
      if (value.startsWith('-') && value.length > 1) {
        // A cluster (`-iu NAME`): a value option takes the rest or the next word.
        let consumed = 1;
        for (let k = 1; k < value.length; k += 1) {
          const option = `-${value[k]}`;
          if ((spec.split || []).includes(option)) {
            const rest = value.slice(k + 1);
            out.splitString = rest || words[index + 1]?.value || '';
            out.splitWord = words[index + (rest ? 0 : 1)] ?? null;
            out.args = words.slice(index + (rest ? 1 : 2));
            return out;
          }
          if (takesValue(spec, option)) {
            if (k === value.length - 1) consumed = 2;
            break;
          }
        }
        index += consumed;
        continue;
      }
      if (positional > 0) {
        positional -= 1;
        index += 1;
        continue;
      }
      break;
    }
    if (index >= words.length) {
      if (spec.defaultProgram) out.program = spec.defaultProgram;
      return out;
    }
  }
  return out;
}

export const SHELL_PROGRAMS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'fish',
  'busybox',
]);
export const POWERSHELL_PROGRAMS = new Set(['pwsh', 'powershell']);
export const FOREIGN_CODE = Object.freeze({
  python: ['-c'],
  python3: ['-c'],
  python2: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  bun: ['-e', '--eval'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
  lua: ['-e'],
  osascript: ['-e'],
  awk: [],
  gawk: [],
});

function shellInlineCode(program, args, values, command) {
  const found = [];
  let codeFlag = false;
  let index = 0;
  if (program === 'busybox') {
    if (!SHELL_PROGRAMS.has(programName(values[0] ?? ''))) return found;
    index = 1;
  }
  for (; index < args.length; index += 1) {
    const value = values[index];
    if (value === '--') {
      index += 1;
      break;
    }
    if (/^[-+]o$|^[-+]O$/u.test(value)) {
      index += 1;
      continue;
    }
    if (/^[-+][A-Za-z]+$/u.test(value) && !value.startsWith('--')) {
      if (value.startsWith('-') && value.includes('c')) codeFlag = true;
      continue;
    }
    if (value.startsWith('--')) continue;
    break;
  }
  if (codeFlag) {
    const code = args[index];
    if (code)
      found.push({
        language: 'bash',
        code: code.value,
        dynamic: code.dynamic,
        words: [code],
      });
    else found.push({ language: 'bash', code: '', dynamic: false });
  } else if (index >= args.length) {
    // `bash <<EOF`, `sh -s < script`, `… | bash`: the script comes on
    // stdin. A pipe or a file gives code that is not known here.
    if (command.piped)
      found.push({ language: 'bash', code: '', dynamic: true });
    for (const redirect of command.redirects) {
      if (redirect.op === '<' && redirect.target)
        found.push({ language: 'bash', code: '', dynamic: true });
      if (redirect.heredoc) {
        found.push({
          language: 'bash',
          code: redirect.heredoc.body,
          dynamic:
            !redirect.heredoc.quoted && /[$`]/u.test(redirect.heredoc.body),
        });
      } else if (redirect.op === '<<<' && redirect.target) {
        found.push({
          language: 'bash',
          code: redirect.target.value,
          dynamic: redirect.target.dynamic,
        });
      }
    }
  }
  return found;
}

function wrapperInlineCode(program, args, values) {
  const found = [];
  if (program === 'iex' || program === 'invoke-expression') {
    found.push({
      language: 'powershell',
      code: values.filter((value) => !/^-command$/iu.test(value)).join(' '),
      dynamic: args.some((word) => word.dynamic),
      words: args.filter((word) => !/^-command$/iu.test(word.value)),
    });
    return found;
  }
  if (program === 'cmd') {
    const index = values.findIndex((value) => /^\/[ck]$/iu.test(value));
    if (index >= 0) {
      const rest = args.slice(index + 1);
      found.push({
        language: 'bash',
        code: rest.map((word) => word.value).join(' '),
        dynamic: rest.some((word) => word.dynamic),
        // cmd's own syntax (`%X%`, `^`, `&`) is not Bash: never proven.
        words: rest,
        foreignSyntax: true,
      });
    }
    return found;
  }
  if (program === 'eval') {
    found.push({
      language: 'bash',
      code: values.join(' '),
      dynamic: args.some((word) => word.dynamic),
      words: args,
    });
    return found;
  }
  if (
    program === 'watch' ||
    program === 'script' ||
    program === 'su' ||
    program === 'runuser'
  ) {
    for (let index = 0; index < args.length; index += 1) {
      const value = values[index];
      if (program === 'watch') {
        if (/^-(?:n|d|g|x|e|c|t|b|p|q|-interval)$/u.test(value)) {
          if (/^-n$/u.test(value)) index += 1;
          continue;
        }
        if (value.startsWith('-')) continue;
        found.push({
          language: 'bash',
          code: values.slice(index).join(' '),
          dynamic: args.slice(index).some((word) => word.dynamic),
          words: args.slice(index),
        });
        return found;
      }
      if (value === '-c' || value === '--command') {
        const code = args[index + 1];
        if (code)
          found.push({
            language: 'bash',
            code: code.value,
            dynamic: code.dynamic,
            words: [code],
          });
        return found;
      }
      if (/^--command=/u.test(value)) {
        found.push({
          language: 'bash',
          code: value.slice(10),
          dynamic: args[index].dynamic,
          words: [args[index]],
          foreignSyntax: true,
        });
        return found;
      }
    }
  }
  return found;
}

function findInlineCode(args, values) {
  const found = [];
  for (let index = 0; index < args.length; index += 1) {
    if (/^-(?:exec|execdir|ok|okdir)$/u.test(values[index])) {
      const end = values.findIndex(
        (value, k) => k > index && (value === ';' || value === '+'),
      );
      found.push({
        language: 'argv',
        words: args.slice(index + 1, end < 0 ? args.length : end),
      });
      if (end < 0) break;
      index = end;
    }
  }
  return found;
}

function powerShellInlineCode(args, values) {
  const found = [];
  for (let index = 0; index < args.length; index += 1) {
    if (
      /^[-/](?:c|co|com|comm|comma|comman|command|commandwithargs|cwa)$/iu.test(
        values[index],
      )
    ) {
      const rest = args.slice(index + 1);
      found.push({
        language: 'powershell',
        code: rest.map((word) => word.value).join(' '),
        dynamic: rest.some((word) => word.dynamic),
        words: rest,
      });
      return found;
    }
    if (/^[-/](?:e|ec|en|enc|encodedcommand)$/iu.test(values[index])) {
      found.push({ language: 'powershell', code: '', dynamic: true });
      return found;
    }
  }
  return found;
}

// Inline code a command hands to an interpreter: [{ language, code, dynamic }].
export function inlineCode(resolved, command) {
  const { program, args } = resolved;
  if (!program) return [];
  const values = args.map((word) => word.value);
  if (SHELL_PROGRAMS.has(program))
    return shellInlineCode(program, args, values, command);
  if (
    program === 'iex' ||
    program === 'invoke-expression' ||
    program === 'cmd' ||
    program === 'eval' ||
    ['watch', 'script', 'su', 'runuser'].includes(program)
  )
    return wrapperInlineCode(program, args, values);
  if (program === 'find') return findInlineCode(args, values);
  if (POWERSHELL_PROGRAMS.has(program))
    return powerShellInlineCode(args, values);
  if (Object.hasOwn(FOREIGN_CODE, program)) {
    return [{ language: 'foreign', code: null, dynamic: false }];
  }
  return [];
}

// Every command a Bash command line runs, launchers unwrapped and inline
// code parsed: { ok, reason, commands: [{ ...command, program, programWord,
// args, launchers, stdinArgs, lookupOnly, dynamicProgram, inline,
// foreignCode, dynamicCode }] }. `ok` is false when any part of it could not
// be read, the inline code included.
