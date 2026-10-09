// SPDX-License-Identifier: AGPL-3.0-only

import { optionSet, readOptions } from './options.js';

export const INTERPRETER_OPTIONS = Object.freeze({
  python: {
    language: 'python',
    code: ['-c'],
    values: '-c -m -W -X -Q',
    stop: '-c -m',
    operandStops: true,
    module: ['-m'],
  },
  node: {
    language: 'javascript',
    code: ['-e', '--eval', '-p', '--print'],
    values:
      '-e --eval -p --print -r --require --import --loader --experimental-loader --input-type -C --conditions --env-file --title --inspect-port --stack-size --max-old-space-size',
    stop: '-e --eval -p --print',
    operandStops: true,
    aliases: { '-pe': '--print' },
  },
  bun: {
    language: 'javascript',
    code: ['-e', '--eval', '-p', '--print'],
    values: '-e --eval -p --print -r --preload --cwd --env-file --config',
    operandStops: true,
  },
  // perlrun: -0[octal/hex] and -l[octal] take an optional number and the
  // cluster goes on (`perl -le CODE`, `-0777e CODE`); -C, -i, -x, -d, -D and
  // -F take the rest of the word (`-CSe` is Unicode options "Se", an error);
  // -e, -E, -I, -M and -m the rest or the next word.
  perl: {
    language: 'perl',
    code: ['-e', '-E'],
    values: '-e -E -I -M -m',
    optional: '-i -x -d -D -F -C',
    optionalPatterns: {
      '-0': /^(?:[xX][0-9A-Fa-f]+|[0-7]+)/u,
      '-l': /^[0-7]+/u,
    },
    operandStops: true,
  },
  // ruby: -0[octal] and -W[level] take an optional number; -i, -x the rest.
  ruby: {
    language: 'ruby',
    code: ['-e'],
    values: '-e -I -r -C -E -F --encoding',
    optional: '-i -x -d',
    optionalPatterns: { '-0': /^[0-7]+/u, '-W': /^[0-2]/u },
    operandStops: true,
  },
  php: {
    language: 'php',
    code: ['-r', '-R', '-B', '-E'],
    values: '-r -R -B -E -F -d -c -f -z -t',
    operandStops: true,
  },
  lua: { language: 'lua', code: ['-e'], values: '-e -l', operandStops: true },
  osascript: {
    language: 'applescript',
    code: ['-e'],
    values: '-e -l -s',
    operandStops: true,
  },
  deno: {
    language: 'javascript',
    code: [],
    values: '',
    operandStops: false,
    subcommandCode: 'eval',
  },
});
const INTERPRETER_ALIASES = Object.freeze({
  python2: 'python',
  python3: 'python',
  pypy: 'python',
  pypy3: 'python',
  nodejs: 'node',
  luajit: 'lua',
});

export function interpreterSpec(program) {
  const name = Object.hasOwn(INTERPRETER_ALIASES, program)
    ? INTERPRETER_ALIASES[program]
    : /^python\d(?:\.\d+)?$/u.test(program ?? '')
      ? 'python'
      : program;
  return Object.hasOwn(INTERPRETER_OPTIONS, name ?? '')
    ? INTERPRETER_OPTIONS[name]
    : null;
}

// Code the command's stdin carries: a heredoc or here-string body. A pipe
// or an input file gives code that is not known here (`dynamic`).
function stdinCode(entry) {
  const found = [];
  for (const redirect of entry.redirects || []) {
    if (redirect.heredoc)
      found.push({ code: redirect.heredoc.body, dynamic: false });
    else if (redirect.op === '<<<' && redirect.target)
      found.push({
        code: String(redirect.target.value),
        dynamic: Boolean(redirect.target.dynamic),
      });
    else if (redirect.op === '<' && redirect.target)
      found.push({ code: '', dynamic: true, file: redirect.target });
  }
  if (entry.piped) found.push({ code: '', dynamic: true });
  return found;
}

// { code: [{ code, dynamic }], script: word | null, operands, inPlace } for an
// interpreter command, or null for a program that is not one. `code` lists
// every inline program: options such as `-c`, `-e` and `--eval` in any
// spelling, `deno eval CODE`, and stdin (`python3 - <<EOF`, `node <<<…`)
// when no script file is named.
export function interpreterCode(entry) {
  const spec = interpreterSpec(entry.program);
  if (!spec) return null;
  const args = entry.args || [];
  if (spec.subcommandCode) {
    const at = args.findIndex((word) => !String(word.value).startsWith('-'));
    const sub = args[at];
    if (sub?.value === spec.subcommandCode) {
      const code = args
        .slice(at + 1)
        .find((word) => !String(word.value).startsWith('-'));
      return {
        code: code ? [{ code: code.value, dynamic: code.dynamic }] : [],
        script: null,
        operands: args.slice(at + 1),
        inPlace: false,
        language: spec.language,
      };
    }
    return {
      code: [],
      script: sub ?? null,
      operands: args,
      inPlace: false,
      language: spec.language,
    };
  }
  const read = readOptions(args, spec);
  const code = [];
  const codeOptions = new Set(spec.code);
  for (const option of read.options) {
    if (!codeOptions.has(option.name)) continue;
    code.push({
      code: option.value ? String(option.value.value) : '',
      dynamic: Boolean(option.value?.dynamic),
    });
  }
  // `python3 -m json.tool FILE`: a module runs, and FILE is its argument.
  const module = read.options.some((option) =>
    (spec.module ?? []).includes(option.name),
  );
  const first = read.operands[0] ?? null;
  const script =
    code.length || module || !first || first.value === '-' ? null : first;
  if (!code.length && !script && !module) code.push(...stdinCode(entry));
  // `perl -pi`, `ruby -i`: the files are edited in place.
  const inPlace =
    optionSet(spec.optional).has('-i') &&
    read.options.some((option) => option.name === '-i');
  return {
    code,
    script,
    operands: read.operands,
    inPlace,
    language: spec.language,
  };
}

// ---------------------------------------------------------------------------
// sed
