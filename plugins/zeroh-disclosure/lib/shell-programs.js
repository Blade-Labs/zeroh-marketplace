// SPDX-License-Identifier: AGPL-3.0-only

// How programs read their own arguments (Astra rc.2 F1, F2, F4, F5), shared
// by the settings guard (lib/settings-guard.js) and the destination check
// (lib/shell-destinations.js), so an option means the same thing to both
// however it is spelled.
//
// `readOptions` reads options as getopt does: short options clustered
// (`-sK`), a value attached (`-Kfile`, `-c'code'`) or in the next word, long
// options with `=value` or the next word, `--` ending the options. The
// program readers below build on it:
//   interpreterCode  the inline code an interpreter runs (`python3 -c'…'`,
//                    `node --eval=…`, `perl -ne …`, a heredoc on stdin);
//   sedProgram       a sed script's commands: `w`/`W` and `s///w` write a
//                    file, `e` and `s///e` run a command, `r`/`R` read one;
//   awkProgram       an awk program: output redirection, pipes, system();
//   gitCommand       git's subcommand, after its global options.
// Words are lib/shell-scan.js words ({ value, raw, dynamic, … }).

// A set of option names from a Set, an array or a space-separated string.
function optionSet(list) {
  if (list instanceof Set) return list;
  return new Set(
    Array.isArray(list)
      ? list
      : String(list ?? '')
          .split(/\s+/u)
          .filter(Boolean),
  );
}

// { options: [{ name, value, index }], operands: [word], end } for a
// command's words. `spec`:
//   values        options that take a value (attached, or the next word);
//   optional      options whose value is only ever attached (`sed -i.bak`,
//                 `perl -i.orig`, `--in-place=.bak`);
//   stop          options after which every word is an operand (`python -c
//                 CODE arg…`, `python -m mod arg…`);
//   operandStops  the first operand ends the options (an interpreter's
//                 script: the words after it are the script's arguments);
//   aliases       whole words a program reads as another option (`node -pe`
//                 is `--print --eval`, not a cluster);
//   singleDash    options are whole words after one dash (`openssl s_client
//                 -connect host:443`), never clusters;
//   optionalPatterns  { option: RegExp } for a short option whose attached
//                 value has its own grammar, after which the cluster goes on
//                 (Perl's `-l[octal]` and `-0[octal/hex]`: `-le CODE` is
//                 `-l -e CODE`, `-l015e CODE` is `-l015 -e CODE`);
//   longs         every long option of a GNU program, which getopt_long
//                 accepts abbreviated to any unique prefix (`sed --expr=…`
//                 is `--expression=…`).
// `value` is a word; an attached value is the same word with only that part
// as its value. An unquoted `$ARGS` may be options and operands alike: it
// is an operand here, with `dynamic` set, for the caller to judge.
export function readOptions(args, spec = {}) {
  const values = optionSet(spec.values);
  const optional = optionSet(spec.optional);
  const stop = optionSet(spec.stop);
  const aliases = spec.aliases || {};
  const patterns = spec.optionalPatterns || {};
  const longs = optionSet(spec.longs);
  // `--expr` is `--expression` when no other long option starts with it.
  const longName = (name) => {
    if (!longs.size || longs.has(name) || !name.startsWith('--')) return name;
    const matches = [...longs].filter((long) => long.startsWith(name));
    return matches.length === 1 ? matches[0] : name;
  };
  const options = [];
  const operands = [];
  const attached = (word, rest) => ({ ...word, value: rest, attached: true });
  let index = 0;
  const rest = () => {
    operands.push(...args.slice(index));
    index = args.length;
  };
  for (; index < args.length; index += 1) {
    const word = args[index];
    const value = String(word.value);
    if (word.dynamic && word.dynamicAt === 0 && !word.quoted) {
      operands.push(word);
      if (spec.operandStops) {
        index += 1;
        rest();
      }
      continue;
    }
    if (value === '--') {
      index += 1;
      rest();
      break;
    }
    if (!value.startsWith('-') || value === '-') {
      operands.push(word);
      if (spec.operandStops) {
        index += 1;
        rest();
        break;
      }
      continue;
    }
    if (Object.hasOwn(aliases, value)) {
      args = [
        ...args.slice(0, index),
        { ...word, value: aliases[value] },
        ...args.slice(index + 1),
      ];
      index -= 1;
      continue;
    }
    if (value.startsWith('--') || spec.singleDash) {
      const eq = value.indexOf('=');
      const name = longName(eq > 0 ? value.slice(0, eq) : value);
      let optionValue = null;
      if (eq > 0) optionValue = attached(word, value.slice(eq + 1));
      else if (values.has(name) && !optional.has(name)) {
        optionValue = args[index + 1] ?? null;
        index += 1;
      }
      options.push({ name, value: optionValue, index });
      if (stop.has(name)) {
        index += 1;
        rest();
        break;
      }
      continue;
    }
    // A cluster of short options: the first one that takes a value takes
    // the rest of the word, or the next word.
    let stopped = false;
    for (let k = 1; k < value.length; k += 1) {
      const name = `-${value[k]}`;
      const tail = value.slice(k + 1);
      if (Object.hasOwn(patterns, name)) {
        const taken = patterns[name].exec(tail)?.[0] ?? '';
        options.push({
          name,
          value: taken ? attached(word, taken) : null,
          index,
        });
        k += taken.length;
        continue;
      }
      if (optional.has(name)) {
        options.push({
          name,
          value: tail ? attached(word, tail) : null,
          index,
        });
        break;
      }
      if (values.has(name)) {
        let optionValue;
        if (tail) optionValue = attached(word, tail);
        else {
          optionValue = args[index + 1] ?? null;
          index += 1;
        }
        options.push({ name, value: optionValue, index });
        stopped = stop.has(name);
        break;
      }
      options.push({ name, value: null, index });
      if (stop.has(name)) {
        stopped = true;
        break;
      }
    }
    if (stopped) {
      index += 1;
      rest();
      break;
    }
  }
  return { options, operands, end: index };
}

// ---------------------------------------------------------------------------
// Interpreters: the options that carry inline code, and the ones that take
// a value (so a cluster such as `perl -Mstrict -ne CODE` reads right).

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

const SED_OPTIONS = {
  values: '-e --expression -f --file -l --line-length',
  optional: '-i --in-place',
  longs:
    '--quiet --silent --debug --expression --file --follow-symlinks --in-place --line-length --null-data --zero-terminated --posix --regexp-extended --separate --sandbox --unbuffered --help --version',
};

// Reads a sed script: { ok, writes: [file], reads: [file], executes:
// [command], reason }. GNU and BSD syntax: addresses (`1`, `$`, `/re/`,
// `\%re%`, `1~2`, `addr,+3`), `!`, blocks, and one command per `;` or line.
// Anything else makes `ok` false.
export function readSedScript(script) {
  const text = String(script);
  const out = { ok: true, writes: [], reads: [], executes: [], reason: null };
  const n = text.length;
  let i = 0;
  const fail = (reason) => {
    out.ok = false;
    out.reason = reason;
    return out;
  };
  const skipBlanks = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i += 1;
  };
  // To the end of the line: a file name or a command.
  const restOfLine = () => {
    skipBlanks();
    let end = text.indexOf('\n', i);
    if (end < 0) end = n;
    const value = text.slice(i, end);
    i = end;
    return value;
  };
  // A delimited part (`/re/`, the halves of `s`), escapes kept.
  const delimited = (delimiter) => {
    let value = '';
    while (i < n && text[i] !== delimiter) {
      if (text[i] === '\\' && i + 1 < n) {
        value += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (text[i] === '\n' && delimiter !== '\n') return null;
      value += text[i];
      i += 1;
    }
    if (i >= n) return null;
    i += 1;
    return value;
  };
  const address = () => {
    if (/\d/u.test(text[i] ?? '')) {
      while (/\d/u.test(text[i] ?? '')) i += 1;
      if (text[i] === '~') {
        i += 1;
        while (/\d/u.test(text[i] ?? '')) i += 1;
      }
      return true;
    }
    if (text[i] === '$') {
      i += 1;
      return true;
    }
    if (text[i] === '/' || text[i] === '\\') {
      const delimiter = text[i] === '\\' ? text[i + 1] : '/';
      i += text[i] === '\\' ? 2 : 1;
      if (delimited(delimiter) === null) return false;
      while (text[i] === 'I' || text[i] === 'M') i += 1;
      return true;
    }
    return true;
  };
  while (i < n) {
    while (i < n && /[\s;]/u.test(text[i])) i += 1;
    if (i >= n) break;
    if (text[i] === '#') {
      restOfLine();
      continue;
    }
    if (text[i] === '}') {
      i += 1;
      continue;
    }
    if (!address()) return fail('unterminated address');
    skipBlanks();
    if (text[i] === ',') {
      i += 1;
      skipBlanks();
      if (text[i] === '+' || text[i] === '~') i += 1;
      if (!address()) return fail('unterminated address');
      skipBlanks();
    }
    while (text[i] === '!') {
      i += 1;
      skipBlanks();
    }
    const command = text[i];
    i += 1;
    switch (command) {
      case '{':
        continue;
      case '=':
      case 'd':
      case 'D':
      case 'g':
      case 'G':
      case 'h':
      case 'H':
      case 'n':
      case 'N':
      case 'p':
      case 'P':
      case 'x':
      case 'z':
      case 'F':
        break;
      case 'l':
      case 'L':
      case 'q':
      case 'Q':
        skipBlanks();
        while (/\d/u.test(text[i] ?? '')) i += 1;
        break;
      case ':':
      case 'b':
      case 't':
      case 'T':
      case 'v':
        skipBlanks();
        while (i < n && !/[;\n}]/u.test(text[i])) i += 1;
        break;
      case 'a':
      case 'i':
      case 'c': {
        // Text to the end of the line; a backslash continues it.
        while (i < n) {
          if (text[i] === '\\' && i + 1 < n) {
            i += 2;
            continue;
          }
          if (text[i] === '\n') break;
          i += 1;
        }
        break;
      }
      case 'r':
      case 'R':
        out.reads.push(restOfLine());
        break;
      case 'w':
      case 'W':
        out.writes.push(restOfLine());
        break;
      case 'e':
        out.executes.push(restOfLine());
        break;
      case 's': {
        const delimiter = text[i];
        if (!delimiter || delimiter === '\n' || delimiter === '\\')
          return fail('bad s delimiter');
        i += 1;
        if (delimited(delimiter) === null) return fail('unterminated s');
        // The replacement may continue over escaped newlines.
        let closed = false;
        while (i < n) {
          if (text[i] === '\\' && i + 1 < n) {
            i += 2;
            continue;
          }
          if (text[i] === delimiter) {
            closed = true;
            i += 1;
            break;
          }
          i += 1;
        }
        if (!closed) return fail('unterminated s');
        while (i < n && /[gpiImMe0-9w]/u.test(text[i])) {
          const flag = text[i];
          i += 1;
          if (flag === 'e') out.executes.push('');
          if (flag === 'w') {
            out.writes.push(restOfLine());
            break;
          }
        }
        break;
      }
      case 'y': {
        const delimiter = text[i];
        if (!delimiter || delimiter === '\n' || delimiter === '\\')
          return fail('bad y delimiter');
        i += 1;
        if (delimited(delimiter) === null || delimited(delimiter) === null)
          return fail('unterminated y');
        break;
      }
      default:
        return fail(`unknown sed command ${JSON.stringify(command ?? '')}`);
    }
    skipBlanks();
    if (i < n && !/[;\n}#]/u.test(text[i]))
      return fail('extra characters after a sed command');
  }
  return out;
}

// { inPlace, scripts: [word], scriptFiles: [word], files: [word], program }
// for a sed command, with `program` its scripts read (readSedScript).
export function sedProgram(entry) {
  const read = readOptions(entry.args || [], SED_OPTIONS);
  const scripts = [];
  const scriptFiles = [];
  let inPlace = false;
  for (const option of read.options) {
    if (option.name === '-e' || option.name === '--expression') {
      if (option.value) scripts.push(option.value);
    } else if (option.name === '-f' || option.name === '--file') {
      if (option.value) scriptFiles.push(option.value);
    } else if (option.name === '-i' || option.name === '--in-place')
      inPlace = true;
  }
  let files = read.operands;
  if (!scripts.length && !scriptFiles.length && files.length) {
    scripts.push(files[0]);
    files = files.slice(1);
  }
  const dynamic = scripts.some((word) => word.dynamic);
  const program = readSedScript(scripts.map((word) => word.value).join('\n'));
  if (dynamic) {
    program.ok = false;
    program.reason = 'script known only at run time';
  }
  return { inPlace, scripts, scriptFiles, files, program };
}

// ---------------------------------------------------------------------------
// awk

const AWK_OPTIONS = {
  values:
    '-f --file -v --assign -F --field-separator -e --source -i --include -l --load -E --exec -W',
  longs:
    '--assign --bignum --characters-as-bytes --copyright --csv --debug --dump-variables --exec --field-separator --file --gen-pot --help --include --lint --load --no-optimize --non-decimal-data --optimize --posix --pretty-print --profile --re-interval --sandbox --source --traditional --use-lc-numeric --version',
};

// Reads an awk program for what it does outside its data (Astra rc.2 F2,
// V2, V4): { ok, redirects: [{ kind: 'file' | 'pipe' | 'coprocess', target
// }], system: [target], getline: [{ kind: 'command' | 'file', target }],
// assigns: { name: literal } }. A target is { literal } for a string,
// { name } for a variable or FILENAME, { expression: true } otherwise.
// Tokens come from an awk lexer: strings and regex literals are read whole
// (a `;` or `>` inside them is text), `\`-newline continues a line, and a
// print statement's `>`, `>>` and `|` redirect only outside parentheses
// (`print (a > b)` is a comparison).
function awkTokens(text) {
  const tokens = [];
  const n = text.length;
  let i = 0;
  let ok = true;
  const operand = () => {
    const last = tokens.at(-1);
    return (
      last &&
      (last.type === 'name' ||
        last.type === 'num' ||
        last.type === 'str' ||
        last.type === 're' ||
        (last.type === 'op' && /^(?:\)|\]|\$|\+\+|--)$/u.test(last.value)))
    );
  };
  while (i < n) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i += 1;
      continue;
    }
    if (c === '#') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '\n') {
      tokens.push({ type: 'nl', value: '\n' });
      i += 1;
      continue;
    }
    if (c === '"') {
      let value = '';
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const next = text[i + 1];
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        if (text[i] === '\n') break;
        value += text[i];
        i += 1;
      }
      if (text[i] !== '"') ok = false;
      i += 1;
      tokens.push({ type: 'str', value });
      continue;
    }
    if (c === '/' && !operand()) {
      i += 1;
      let inClass = false;
      while (i < n && (inClass || text[i] !== '/')) {
        if (text[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (text[i] === '\n') break;
        if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        i += 1;
      }
      if (text[i] !== '/') ok = false;
      i += 1;
      tokens.push({ type: 're' });
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(text.slice(i, i + 256));
    if (name) {
      tokens.push({ type: 'name', value: name[0] });
      i += name[0].length;
      continue;
    }
    const number = /^(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/u.exec(
      text.slice(i, i + 64),
    );
    if (number) {
      tokens.push({ type: 'num', value: number[0] });
      i += number[0].length;
      continue;
    }
    const op = /^(?:\|&|\|\||&&|>>|==|!=|<=|>=|!~|\+\+|--|[-+*/%^]=|.)/su.exec(
      text.slice(i, i + 2),
    )[0];
    tokens.push({ type: 'op', value: op });
    i += op.length;
  }
  return { tokens, ok };
}

const AWK_ENDS = new Set([';', '{', '}']);

export function readAwkProgram(program) {
  const { tokens, ok } = awkTokens(program);
  const out = { ok, redirects: [], system: [], getline: [], assigns: {} };
  const ends = (token) =>
    !token ||
    token.type === 'nl' ||
    (token.type === 'op' && AWK_ENDS.has(token.value));
  // The target after a redirection operator at `k`: a string or a name that
  // ends the statement (or closes the enclosing parenthesis), else an
  // expression.
  const targetAt = (k) => {
    const first = tokens[k];
    const after = tokens[k + 1];
    const closes = ends(after) || (after?.type === 'op' && after.value === ')');
    if (first?.type === 'str' && closes) return { literal: first.value };
    if (first?.type === 'name' && closes) return { name: first.value };
    return { expression: true };
  };
  let depth = 0;
  let printDepth = null;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (
      token.type === 'nl' ||
      (token.type === 'op' && AWK_ENDS.has(token.value))
    ) {
      if (depth === 0 || token.value !== '\n') printDepth = null;
      if (token.value === '{' || token.value === '}') depth = 0;
      continue;
    }
    if (token.type === 'op' && (token.value === '(' || token.value === '[')) {
      depth += 1;
      continue;
    }
    if (token.type === 'op' && (token.value === ')' || token.value === ']')) {
      depth = Math.max(0, depth - 1);
      if (printDepth !== null && depth < printDepth) printDepth = null;
      continue;
    }
    if (token.type === 'name') {
      if (token.value === 'print' || token.value === 'printf') {
        printDepth = depth;
        continue;
      }
      if (
        token.value === 'system' &&
        tokens[k + 1]?.type === 'op' &&
        tokens[k + 1].value === '('
      ) {
        const arg = tokens[k + 2];
        const close = tokens[k + 3];
        out.system.push(
          arg?.type === 'str' && close?.type === 'op' && close.value === ')'
            ? { literal: arg.value }
            : { expression: true },
        );
        continue;
      }
      if (
        tokens[k + 1]?.type === 'op' &&
        tokens[k + 1].value === '=' &&
        tokens[k + 2]?.type === 'str' &&
        ends(tokens[k + 3])
      )
        out.assigns[token.value] = tokens[k + 2].value;
      if (token.value === 'getline') {
        // `getline < file`, `getline var < file`.
        const lt =
          tokens[k + 1]?.value === '<'
            ? k + 1
            : tokens[k + 2]?.value === '<'
              ? k + 2
              : -1;
        if (lt > 0)
          out.getline.push({ kind: 'file', target: targetAt(lt + 1) });
      }
      continue;
    }
    if (token.type !== 'op') continue;
    if (token.value === '|' || token.value === '|&') {
      if (tokens[k + 1]?.type === 'name' && tokens[k + 1].value === 'getline') {
        // `"cmd" | getline`: the command is the string just before.
        const before = tokens[k - 1];
        out.getline.push({
          kind: 'command',
          target:
            before?.type === 'str' &&
            (k < 2 || ends(tokens[k - 2]) || tokens[k - 2].value === '(')
              ? { literal: before.value }
              : { expression: true },
        });
        continue;
      }
      if (printDepth !== null && depth === printDepth) {
        out.redirects.push({
          kind: token.value === '|&' ? 'coprocess' : 'pipe',
          target: targetAt(k + 1),
        });
        printDepth = null;
      }
      continue;
    }
    if (
      (token.value === '>' || token.value === '>>') &&
      printDepth !== null &&
      depth === printDepth
    ) {
      out.redirects.push({ kind: 'file', target: targetAt(k + 1) });
      printDepth = null;
    }
  }
  return out;
}

// { programs: [word], programFiles: [word], assignments: [word], files:
// [word], inPlace, scan, executes, dynamic } for an awk command, with
// `scan` from readAwkProgram.
export function awkProgram(entry) {
  const read = readOptions(entry.args || [], AWK_OPTIONS);
  const programs = [];
  const programFiles = [];
  const assignments = [];
  let inPlace = false;
  for (const option of read.options) {
    const { name, value } = option;
    if (!value) continue;
    if (name === '-e' || name === '--source') programs.push(value);
    else if (['-f', '--file', '-E', '--exec'].includes(name))
      programFiles.push(value);
    else if (name === '-v' || name === '--assign') assignments.push(value);
    else if (
      (name === '-i' || name === '--include') &&
      value.value === 'inplace'
    )
      inPlace = true;
  }
  let files = read.operands;
  if (!programs.length && !programFiles.length && files.length) {
    programs.push(files[0]);
    files = files.slice(1);
  }
  // `var=value` operands are assignments too.
  for (const word of files)
    if (/^[A-Za-z_]\w*=/u.test(String(word.value))) assignments.push(word);
  const scan = readAwkProgram(programs.map((word) => word.value).join('\n'));
  return {
    programs,
    programFiles,
    assignments,
    files,
    inPlace,
    scan,
    // Runs another program: system(), a print pipe or coprocess, `cmd |
    // getline`.
    executes:
      scan.system.length > 0 ||
      scan.redirects.some((r) => r.kind !== 'file') ||
      scan.getline.some((g) => g.kind === 'command'),
    dynamic: programs.some((word) => word.dynamic),
  };
}

export const AWK_PROGRAMS = new Set([
  'awk',
  'gawk',
  'mawk',
  'nawk',
  'busybox-awk',
]);

// ---------------------------------------------------------------------------
// git

const GIT_OPTIONS = {
  values:
    '-C -c --git-dir --work-tree --namespace --super-prefix --config-env --list-cmds --attr-source',
  operandStops: true,
};
// Subcommands that talk to a remote. Where it is comes from the repository's
// configuration, or an operand.
const GIT_NETWORK = new Set(
  (
    'push fetch pull clone ls-remote remote submodule send-email request-pull ' +
    'svn p4 lfs fetch-pack send-pack http-fetch http-push imap-send ' +
    'cvsimport cvsexportcommit archimport daemon instaweb credential'
  ).split(/\s+/u),
);
// Subcommands that only work on the local repository.
const GIT_LOCAL = new Set(
  (
    'add am annotate apply archive bisect blame branch bundle cat-file check-attr ' +
    'check-ignore check-mailmap check-ref-format checkout checkout-index cherry ' +
    'cherry-pick clean commit commit-graph commit-tree config count-objects describe ' +
    'diff diff-files diff-index diff-tree fast-export fast-import for-each-ref ' +
    'format-patch fsck gc get-tar-commit-id grep hash-object help index-pack init ' +
    'interpret-trailers log ls-files ls-tree mailinfo mailsplit maintenance merge ' +
    'merge-base merge-file merge-tree mktag mktree multi-pack-index mv name-rev notes ' +
    'pack-objects pack-refs prune prune-packed range-diff read-tree rebase reflog ' +
    'repack replace rerere reset restore rev-list rev-parse revert rm shortlog show ' +
    'show-branch show-index show-ref sparse-checkout stash status stripspace switch ' +
    'symbolic-ref tag unpack-file unpack-objects update-index update-ref ' +
    'update-server-info var verify-commit verify-pack verify-tag version whatchanged ' +
    'worktree write-tree'
  ).split(/\s+/u),
);
// `remote` subcommands that stay local.
const GIT_REMOTE_LOCAL = new Set([
  'add',
  'rename',
  'remove',
  'rm',
  'set-branches',
  'set-url',
  'get-url',
  '-v',
  '--verbose',
]);
// Configuration that names a program to run or where a remote is.
const GIT_COMMAND_CONFIG_RE =
  /^(?:alias\..+|core\.(?:sshcommand|pager|editor|askpass|fsmonitor|hookspath|gitproxy)|sequence\.editor|gpg\.(?:.+\.)?program|diff\.external|credential\..+|url\..+|remote\..+|include(?:if\..+)?\.path|.+\.(?:command|cmd|helper|textconv|driver|process|clean|smudge|tool|proxy))$/iu;

// { subcommand, kind: 'local' | 'network' | 'unknown', commandConfig, urls:
// [word] } for a git command: `network` talks to a remote, `unknown` is an
// alias or an external `git-foo`. `commandConfig`: a `-c` names a program
// to run or where a remote is.
export function gitCommand(entry) {
  const read = readOptions(entry.args || [], GIT_OPTIONS);
  const commandConfig = read.options.some(
    (option) =>
      (option.name === '-c' || option.name === '--config-env') &&
      GIT_COMMAND_CONFIG_RE.test(
        String(option.value?.value ?? '').replace(/=.*$/su, ''),
      ),
  );
  const [first, ...rest] = read.operands;
  const subcommand = first ? String(first.value) : null;
  let kind = 'local';
  if (first?.dynamic) kind = 'unknown';
  else if (subcommand === null) kind = 'local';
  else if (GIT_NETWORK.has(subcommand)) {
    kind = 'network';
    if (subcommand === 'remote') {
      const sub = rest.find((word) => !String(word.value).startsWith('-'));
      if (!sub || GIT_REMOTE_LOCAL.has(String(sub.value))) kind = 'local';
      // `remote add -f` / `--fetch` fetches the new remote at once.
      if (
        String(sub?.value) === 'add' &&
        readOptions(rest.slice(rest.indexOf(sub) + 1), {
          values: '-t -m --track --master',
          longs: '--fetch --track --master --tags --no-tags --mirror',
        }).options.some((o) => o.name === '-f' || o.name === '--fetch')
      )
        kind = 'network';
      if (
        String(sub?.value) === 'show' &&
        rest.some((word) => word.value === '-n')
      )
        kind = 'local';
    }
  } else if (GIT_LOCAL.has(subcommand)) {
    if (
      subcommand === 'archive' &&
      rest.some((w) => /^--remote(?:=|$)/u.test(w.value))
    )
      kind = 'network';
    if (subcommand === 'bisect' && rest.some((word) => word.value === 'run'))
      kind = 'unknown';
  } else kind = 'unknown';
  // Remote URLs named on the line (`git push https://host/x`, `git clone
  // user@host:repo`).
  const urls = rest
    .map((word) => {
      // `archive --remote=URL`, `clone --upload-pack` aside, a URL operand.
      const remote = /^--remote=(.+)$/su.exec(String(word.value));
      return remote ? { ...word, value: remote[1] } : word;
    })
    .filter((word) =>
      /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|[\w.-]+@[\w.-]+:)/u.test(
        String(word.value),
      ),
    );
  return { subcommand, kind, commandConfig, urls };
}

// ---------------------------------------------------------------------------
// Assignments a command runs under: `NAME=value cmd` and `env NAME=value
// cmd`. { NAME: word } with the word's value after the `=`.
export function commandAssignments(entry) {
  const found = {};
  const words = entry.words || [];
  const upTo = entry.programWord ? words.indexOf(entry.programWord) : -1;
  for (const word of [
    ...(entry.assignments || []),
    ...(upTo > 0 ? words.slice(0, upTo) : []),
  ]) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/su.exec(String(word.value));
    if (match) found[match[1]] = { ...word, value: match[2] };
  }
  return found;
}

// A URL's host, lower case, or null.
function urlHost(value) {
  const match =
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/:?#]+)/u.exec(
      String(value),
    );
  return match ? match[1].replace(/^\[|\]$/gu, '').toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// gh, GitHub's CLI. Every subcommand but a few local ones talks to a GitHub
// host: the one named on the line (`--hostname`, a URL operand, `-R
// HOST/OWNER/REPO`, `GH_HOST=`), else the one in gh's configuration, which
// is not known here.

const GH_OPTIONS = {
  values:
    '-R --repo --hostname -X --method -H --header -f -F --field --raw-field -q --jq -t --template --input -p --preview --cache -b --body -B --base -T --title -l --label -a --assignee -m --milestone -w --web -e --env -o --org -u --user -s --state -L --limit -A --author -S --search -c --commit -n --name -r --ref -v --visibility',
};
const GH_LOCAL = new Set(['help', 'version', 'completion', 'config', 'alias']);
const GH_AUTH_LOCAL = new Set(['token', 'setup-git', 'switch']);
const GH_NETWORK = new Set(
  (
    'api attestation auth browse cache codespace copilot extension gist gpg-key ' +
    'issue label org pr project release repo ruleset run search secret ' +
    'ssh-key status variable workflow agent-task preview'
  ).split(/\s+/u),
);

// { kind: 'local' | 'network' | 'unknown', subcommand, hosts: [host],
// dynamicHost } for a gh command: `unknown` is an alias or an extension.
export function ghCommand(entry) {
  const read = readOptions(entry.args || [], GH_OPTIONS);
  const [first, second] = read.operands;
  const subcommand = first ? String(first.value) : null;
  let kind = 'local';
  if (first?.dynamic) kind = 'unknown';
  else if (subcommand === null || GH_LOCAL.has(subcommand)) kind = 'local';
  else if (subcommand === 'auth' && GH_AUTH_LOCAL.has(String(second?.value)))
    kind = 'local';
  else if (GH_NETWORK.has(subcommand)) kind = 'network';
  else kind = 'unknown';
  // `gh extension exec NAME`: runs a local extension, which can send what
  // it is given anywhere, whatever host gh is set to (Astra rc.2 V6).
  if (
    subcommand === 'extension' &&
    ['exec', 'x'].includes(String(second?.value))
  )
    kind = 'unknown';
  const hosts = [];
  let dynamicHost = false;
  const addHost = (word, host) => {
    if (word?.dynamic) dynamicHost = true;
    else if (host) hosts.push(host.toLowerCase());
  };
  for (const option of read.options) {
    if (!option.value) continue;
    if (option.name === '--hostname') addHost(option.value, option.value.value);
    if (option.name === '-R' || option.name === '--repo') {
      const repo = String(option.value.value);
      const parts = repo.split('/');
      addHost(
        option.value,
        urlHost(repo) ?? (parts.length === 3 ? parts[0] : null),
      );
    }
  }
  for (const word of read.operands.slice(1)) {
    const host = urlHost(word.value);
    if (host) addHost(word, host);
  }
  const assigned = commandAssignments(entry).GH_HOST;
  if (assigned) addHost(assigned, String(assigned.value));
  // github.com's API lives at api.github.com; an enterprise host serves both.
  const all = hosts.flatMap((host) =>
    host === 'github.com' ? [host, 'api.github.com'] : [host],
  );
  return { kind, subcommand, hosts: [...new Set(all)], dynamicHost };
}

// ---------------------------------------------------------------------------
// openssl: s_client, s_time and ocsp connect to a host; s_server listens and
// answers whoever connects; every other subcommand works on local data.

const OPENSSL_OPTIONS = {
  singleDash: true,
  values:
    '-connect -host -port -proxy -proxy_user -proxy_pass -url -servername -bind -accept ' +
    '-CAfile -CApath -CAstore -cert -key -pass -in -out -sess_in -sess_out -starttls ' +
    '-xmpphost -name -verify -verify_hostname -keylogfile -msgfile -time -www -WWW ' +
    '-cipher -ciphersuites -groups -curves -sigalgs -alpn -nextprotoneg -psk -psk_identity ' +
    '-issuer -serial -reqout -respout -reqin -respin -signer -signkey -VAfile -timeout ' +
    '-server -path -ref -secret -cmd -subject -newkey -certout -chainout -trusted -srvcert ' +
    '-recipient -expect_sender -tls_host -tls_cert -tls_key -tls_trusted -config -section ' +
    '-keyform -certform -inform -outform -passin -passout -days -set_serial -extfile -extensions',
};
// Subcommands that talk to a server by design; the ones that only listen;
// and the ones that work on local data only (openssl help lists them). Any
// other subcommand, and any subcommand given a server option, is read for
// its server options, and one ZeroH doesn't know is not taken as local
// (Astra rc.2 V7).
const OPENSSL_CONNECT = new Set(['s_client', 's_time', 'ocsp', 'cmp']);
const OPENSSL_LISTEN = new Set(['s_server']);
const OPENSSL_LOCAL = new Set(
  (
    'asn1parse ca ciphers cms crl crl2pkcs7 dgst dhparam dsa dsaparam ec ecparam enc engine ' +
    'errstr fipsinstall gendsa genpkey genrsa help info kdf list mac nseq passwd pkcs12 ' +
    'pkcs7 pkcs8 pkey pkeyparam pkeyutl prime rand rehash req rsa rsautl sess_id smime ' +
    'speed spkac srp storeutl ts verify version x509 skeyutl configutl ' +
    'md5 sha1 sha256 sha384 sha512 base64 aes-128-cbc aes-256-cbc des3 zlib'
  ).split(/\s+/u),
);
// Options that name a server: data goes there.
const OPENSSL_SERVER_OPTIONS = [
  '-connect',
  '-host',
  '-proxy',
  '-url',
  '-server',
];
// Options that make openssl fetch from addresses it finds at run time.
const OPENSSL_FETCH_OPTIONS = ['-crl_download', '-ocsp_check_all'];

// { kind: 'local' | 'connect' | 'listen' | 'unknown', subcommand, targets:
// [word], fetches } for an openssl command: the words naming where it
// connects (`-connect host:port`, `-host`, `-proxy`, `-url`, `-server`, or a
// `host:port` operand of a connecting subcommand).
export function opensslCommand(entry) {
  const args = entry.args || [];
  const subcommand = args[0] ? String(args[0].value) : null;
  if (OPENSSL_LISTEN.has(subcommand))
    return { kind: 'listen', subcommand, targets: [], fetches: false };
  const read = readOptions(args.slice(1), OPENSSL_OPTIONS);
  const targets = read.options
    .filter(
      (option) => option.value && OPENSSL_SERVER_OPTIONS.includes(option.name),
    )
    .map((option) => option.value);
  const fetches = read.options.some((option) =>
    OPENSSL_FETCH_OPTIONS.includes(option.name),
  );
  if (OPENSSL_CONNECT.has(subcommand)) {
    // OpenSSL 3 takes `host:port` as an operand too; nothing else is a
    // host (a value of an option not listed may land here).
    for (const word of read.operands)
      if (
        /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d+$/u.test(String(word.value))
      )
        targets.push(word);
    return { kind: 'connect', subcommand, targets, fetches };
  }
  if (targets.length) return { kind: 'connect', subcommand, targets, fetches };
  if (subcommand === null || OPENSSL_LOCAL.has(subcommand))
    return { kind: 'local', subcommand, targets, fetches };
  return { kind: 'unknown', subcommand, targets, fetches };
}

// ---------------------------------------------------------------------------
// Local programs that can still reach another machine or run another
// program, by their own options:
//   tar   an archive named `[user@]host:path` is opened over rsh/ssh (GNU
//         tar, unless --force-local); -I, --to-command, --rsh-command,
//         --info-script and --checkpoint-action=exec run programs;
//   rg    --pre and --hostname-bin run a program;
//   sort  --compress-program runs one;
//   zip   -TT / --unzip-command runs one;
//   less, more  a `+` command can run a shell command (`+!cmd`).
// And any program given a UNC path (`\\host\share\file`) reaches that host
// over SMB.

const RUNNER_OPTIONS = Object.freeze({
  tar: {
    spec: {
      values:
        '-f --file -C --directory -I --use-compress-program -F --info-script --new-volume-script --to-command --rsh-command --checkpoint-action -b -g -K -L -N -T -V -X -H --exclude --transform',
      longs:
        '--file --directory --use-compress-program --info-script --new-volume-script --to-command --rsh-command --checkpoint-action --checkpoint --exclude --transform --force-local --create --extract --list --append --update --verbose --gzip --bzip2 --xz --zstd --to-stdout --totals',
    },
    runs: [
      '-I',
      '--use-compress-program',
      '-F',
      '--info-script',
      '--new-volume-script',
      '--to-command',
      '--rsh-command',
    ],
  },
  rg: {
    spec: {
      values:
        '-e -f -g -m -A -B -C -j -M -r -t -T -E --pre --hostname-bin --pre-glob --type-add --glob --regexp --file',
    },
    runs: ['--pre', '--hostname-bin'],
  },
  sort: {
    spec: {
      values: '-k -t -o -S -T --compress-program --key --output',
      longs:
        '--compress-program --key --output --buffer-size --temporary-directory --field-separator --numeric-sort --reverse --unique --stable --check --merge --parallel --files0-from --random-source --sort --debug',
    },
    runs: ['--compress-program'],
  },
  zip: {
    spec: {
      values: '-b -n -t -tt -x -i -O --unzip-command',
      aliases: { '-TT': '--unzip-command' },
    },
    runs: ['--unzip-command'],
  },
});

// `tar cf x` is `tar -cf x`: old-style options without a dash.
function tarArgs(args) {
  const first = args[0];
  if (first && /^[A-Za-z]+$/u.test(String(first.value)) && !first.dynamic)
    return [{ ...first, value: `-${first.value}` }, ...args.slice(1)];
  return args;
}

// The UNC host a word names (`\\host\share\…`, also after `-Path:`).
export function uncHost(word) {
  const match = /^(?:-[A-Za-z]+:)?\\\\([^\\/\s@]+)(?:@[^\\/\s]*)?[\\/]/u.exec(
    String(word?.value ?? ''),
  );
  return match ? match[1].toLowerCase() : null;
}

// { runs: detail | null, remote: detail | null, unc: [{ word, host }] } for a
// program otherwise local.
export function localProgramReach(entry) {
  const out = { runs: null, remote: null, unc: [] };
  const program = entry.program;
  const args = program === 'tar' ? tarArgs(entry.args || []) : entry.args || [];
  const runner = Object.hasOwn(RUNNER_OPTIONS, program)
    ? RUNNER_OPTIONS[program]
    : null;
  if (runner) {
    const read = readOptions(args, runner.spec);
    for (const option of read.options) {
      if (runner.runs.includes(option.name))
        out.runs ??= `${program} ${option.name}`;
      if (
        option.name === '--checkpoint-action' &&
        /^exec=/u.test(String(option.value?.value ?? ''))
      )
        out.runs ??= `${program} --checkpoint-action=exec`;
    }
    if (program === 'tar') {
      const forceLocal = read.options.some((o) => o.name === '--force-local');
      const archives = read.options
        .filter((o) => (o.name === '-f' || o.name === '--file') && o.value)
        .map((o) => String(o.value.value));
      if (
        !forceLocal &&
        archives.some(
          (file) =>
            /^(?:[^/:@\s]+@)?[^/:\s]+:/u.test(file) &&
            !/^[A-Za-z]:[\\/]/u.test(file),
        )
      )
        out.remote = 'tar remote archive';
    }
  }
  if (
    (program === 'less' || program === 'more') &&
    args.some((word) => String(word.value).startsWith('+'))
  )
    out.runs = `${program} +command`;
  for (const word of args) {
    const host = uncHost(word);
    if (host) out.unc.push({ word, host });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inline interpreter code (Astra rc.2 V4): which calls read, write or run
// something, and with what arguments, so that reading a protected file with
// `python3 -c 'print(open(PATH).read())'` runs, writing it is a stop, and
// what can't be told apart is uncertain.
//
// readCode(code, language) → { ok, calls: [{ name, kind, args, receiver,
// mode }], literals: [string] }. A call is `name(…)`, `a.b.name(…)`, a
// method on a call's result (`Path(PATH).write_text(…)`: the receiver's
// arguments count as the target), or, in Perl and Ruby, a known builtin
// without parentheses (`unlink PATH;`). `args` are the top-level
// arguments, each { text, literal } where `literal` is the string when the
// argument is one plain string literal (no interpolation). Perl and Ruby
// backticks are calls to the shell. `kind` comes from the language's table:
//   read    reads a file: `open(PATH)`, `readFileSync`, `File.read`;
//   write   changes one: `writeFileSync`, `unlink`, `os.remove`, `open(PATH,
//           "w")`, Perl's `open(F, ">", PATH)`;
//   open    opens with a mode ZeroH can't read (a variable);
//   exec    runs a command: `os.system`, `execSync`, `system`, backticks;
//   eval    runs code built at run time.
// Anything else is `other`.

const CODE_KINDS = Object.freeze({
  python: {
    read: 'read_text read_bytes exists isfile is_file stat lstat getsize listdir scandir glob iterdir load loads',
    write:
      'write_text write_bytes unlink remove rename replace rmtree move copy copyfile copy2 copytree touch chmod chown lchmod symlink symlink_to hardlink_to link truncate rmdir',
    open: 'open fdopen',
    exec: 'system popen run call check_call check_output Popen getoutput getstatusoutput execv execve execl execlp execvp execvpe spawnl spawnv startfile',
    eval: 'exec eval compile __import__',
  },
  javascript: {
    read: 'readFileSync readFile createReadStream existsSync statSync stat lstatSync lstat accessSync access readdirSync readdir readlinkSync realpathSync',
    write:
      'writeFileSync writeFile appendFileSync appendFile rmSync rm unlinkSync unlink renameSync rename copyFileSync copyFile cpSync cp truncateSync truncate chmodSync chmod chownSync chown symlinkSync symlink linkSync link rmdirSync rmdir createWriteStream utimesSync utimes',
    open: 'openSync open',
    exec: 'exec execSync spawn spawnSync execFile execFileSync fork',
    eval: 'eval Function runInNewContext runInThisContext',
  },
  perl: {
    read: 'stat lstat opendir readlink',
    write: 'unlink rename truncate chmod chown utime symlink link rmdir mkdir',
    open: 'open sysopen',
    exec: 'system exec qx readpipe',
    eval: 'eval do require',
  },
  ruby: {
    read: 'read readlines foreach binread exist? exists? file? size stat lstat readlink',
    write:
      'write binwrite delete unlink rename truncate chmod chown symlink link rm rm_f rm_r rm_rf cp mv copy_file install touch rmdir',
    open: 'open new',
    exec: 'system exec spawn popen popen3 capture2 capture2e capture3',
    eval: 'eval instance_eval class_eval load require',
  },
  php: {
    read: 'file_get_contents file readfile file_exists is_file filesize stat lstat is_readable',
    write:
      'file_put_contents unlink rename copy touch chmod chown symlink link rmdir',
    open: 'fopen',
    exec: 'exec system shell_exec passthru popen proc_open pcntl_exec',
    eval: 'eval assert include require include_once require_once',
  },
  lua: {
    read: 'lines',
    write: 'remove rename',
    open: 'open',
    exec: 'execute popen',
    eval: 'load loadstring dofile loadfile',
  },
});

const CODE_TABLES = Object.fromEntries(
  Object.entries(CODE_KINDS).map(([language, kinds]) => {
    const table = new Map();
    for (const [kind, names] of Object.entries(kinds))
      for (const name of names.split(/\s+/u)) table.set(name, kind);
    return [language, table];
  }),
);
const PARENLESS = new Set(['perl', 'ruby']);
const HASH_COMMENTS = new Set(['python', 'perl', 'ruby', 'php']);
const SLASH_COMMENTS = new Set(['javascript', 'php']);

// A string literal at `i`: { end, value, interpolated, backtick } or null.
function codeString(code, i, language) {
  let start = i;
  let prefix = '';
  if (language === 'python') {
    const p = /^[rRbBuUfF]{1,2}(?=["'])/u.exec(code.slice(i, i + 3));
    if (p) {
      prefix = p[0].toLowerCase();
      start += p[0].length;
    }
  }
  const quote = code[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  if (quote === '`' && language === 'python') return null;
  const triple =
    language === 'python' && code.slice(start, start + 3) === quote.repeat(3);
  const close = triple ? quote.repeat(3) : quote;
  let k = start + close.length;
  let value = '';
  const raw = prefix.includes('r');
  for (;;) {
    if (k >= code.length) return { end: k, value, unterminated: true };
    if (code.startsWith(close, k)) break;
    if (code[k] === '\\' && !raw && k + 1 < code.length) {
      const next = code[k + 1];
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      k += 2;
      continue;
    }
    value += code[k];
    k += 1;
  }
  const interpolated = prefix.includes('f')
    ? /\{/u.test(value)
    : quote === '`' && language === 'javascript'
      ? /\$\{/u.test(value)
      : quote === '"' && (language === 'perl' || language === 'php')
        ? /[$@]/u.test(value)
        : quote === '"' && language === 'ruby'
          ? /#\{/u.test(value)
          : false;
  return {
    end: k + close.length,
    value,
    interpolated,
    backtick: quote === '`' && (language === 'perl' || language === 'ruby'),
  };
}

// Blanks out strings and comments, keeping offsets: { masked, strings:
// [{ start, end, value, interpolated, backtick }], ok }.
function maskCode(code, language) {
  let masked = '';
  const strings = [];
  let ok = true;
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (
      (c === '#' && HASH_COMMENTS.has(language)) ||
      (c === '/' && code[i + 1] === '/' && SLASH_COMMENTS.has(language)) ||
      (c === '-' && code[i + 1] === '-' && language === 'lua')
    ) {
      // `#` in Perl after `$` is `$#array`, not a comment.
      if (!(c === '#' && language === 'perl' && code[i - 1] === '$')) {
        while (i < code.length && code[i] !== '\n') {
          masked += ' ';
          i += 1;
        }
        continue;
      }
    }
    if (c === '/' && code[i + 1] === '*' && SLASH_COMMENTS.has(language)) {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? code.length : end + 2;
      masked += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    const string = /[A-Za-z0-9_]/u.test(code[i - 1] ?? '')
      ? null
      : codeString(code, i, language);
    if (string) {
      if (string.unterminated) ok = false;
      strings.push({ start: i, ...string });
      masked += `"${' '.repeat(Math.max(0, string.end - i - 2))}"`.slice(
        0,
        string.end - i,
      );
      i = string.end;
      continue;
    }
    masked += c;
    i += 1;
  }
  return { masked, strings, ok };
}

// Matching brackets of masked code, in one pass: { match: Int32Array
// (open ↔ close, -1 when unmatched), depth: the deepest nesting }.
function bracketPairs(masked) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const match = new Int32Array(masked.length).fill(-1);
  const stack = [];
  let depth = 0;
  for (let k = 0; k < masked.length; k += 1) {
    const c = masked[k];
    if (pairs[c]) {
      stack.push(k);
      depth = Math.max(depth, stack.length);
    } else if (c === ')' || c === ']' || c === '}') {
      const open = stack.at(-1);
      if (open !== undefined && pairs[masked[open]] === c) {
        stack.pop();
        match[open] = k;
        match[k] = open;
      }
    }
  }
  return { match, depth };
}

// Code nested deeper than this, or longer, is not read (ok: false): a
// reader must answer within the hook's time.
const CODE_MAX_DEPTH = 64;
const CODE_MAX_LENGTH = 256 * 1024;

// Top-level comma-separated pieces of [start, end) in masked code.
function splitArgs(masked, start, end) {
  const pieces = [];
  let depth = 0;
  let from = start;
  for (let k = start; k < end; k += 1) {
    const c = masked[k];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) {
      pieces.push([from, k]);
      from = k + 1;
    }
  }
  if (masked.slice(from, end).trim()) pieces.push([from, end]);
  return pieces;
}

export function readCode(code, language) {
  const text = String(code);
  const table = CODE_TABLES[language] ?? null;
  if (text.length > CODE_MAX_LENGTH)
    return {
      ok: false,
      language: table ? language : null,
      calls: [],
      literals: [],
    };
  const { masked, strings, ok } = maskCode(text, language);
  const { match: pair, depth } = bracketPairs(masked);
  if (depth > CODE_MAX_DEPTH)
    return {
      ok: false,
      language: table ? language : null,
      calls: [],
      literals: [],
    };
  const closing = (_, open) => (pair[open] < 0 ? -1 : pair[open] + 1);
  const literalIn = (from, to) => {
    const inside = strings.filter((s) => s.start >= from && s.end <= to);
    const bare = masked.slice(from, to).trim();
    if (
      inside.length === 1 &&
      bare ===
        `"${' '.repeat(Math.max(0, bare.length - 2))}"`.slice(0, bare.length)
    )
      return inside[0].interpolated ? null : inside[0].value;
    return null;
  };
  const argsOf = (from, to) =>
    splitArgs(masked, from, to).map(([a, b]) => ({
      text: text.slice(a, b).trim(),
      literal: literalIn(a, b),
      list: /^\s*[[(]/u.test(masked.slice(a, b))
        ? strings
            .filter((s) => s.start >= a && s.end <= b)
            .map((s) => (s.interpolated ? null : s.value))
        : null,
      keyword: /^\s*[A-Za-z_]\w*\s*=(?!=)/u.test(masked.slice(a, b)),
      object: /^\s*\{/u.test(masked.slice(a, b)),
    }));
  const calls = [];
  const nameRe = /[A-Za-z_$][\w$]*[?!]?/gu;
  for (const match of masked.matchAll(nameRe)) {
    const name = match[0];
    const at = match.index;
    if (at > 0 && /[\w$]/u.test(masked[at - 1])) continue;
    let k = at + name.length;
    while (masked[k] === ' ' || masked[k] === '\t') k += 1;
    const kind = table?.get(name) ?? 'other';
    let args = null;
    if (masked[k] === '(') {
      const end = closing(masked, k);
      if (end < 0) continue;
      args = argsOf(k + 1, end - 1);
    } else if (
      PARENLESS.has(language) &&
      kind !== 'other' &&
      k > at + name.length &&
      /[\s]/u.test(masked[at + name.length])
    ) {
      // `unlink PATH;`, `open F, ">PATH" or die`, `File.write PATH, x`.
      let end = k;
      let depth = 0;
      while (end < masked.length) {
        const c = masked[end];
        if ('([{'.includes(c)) depth += 1;
        else if (')]}'.includes(c)) {
          if (depth === 0) break;
          depth -= 1;
        } else if (depth === 0 && (c === ';' || c === '\n')) break;
        else if (
          depth === 0 &&
          /^\s(?:or|and|if|unless)\b|^\s*(?:\|\||&&)/u.test(
            masked.slice(end, end + 8),
          )
        )
          break;
        end += 1;
      }
      args = argsOf(k, end);
    } else continue;
    // The receiver's arguments: `Path(PATH).write_text(…)`.
    let receiver = null;
    let back = at - 1;
    if (masked[back] === '.' && masked[back - 1] === ')') {
      const open = pair[back - 1];
      if (open >= 0) receiver = argsOf(open + 1, back - 1);
    }
    calls.push({ name, kind, args, receiver });
  }
  // A call through a computed name (`fs[op](p)`, `getattr(os, f)(p)`,
  // `f()(p)`) can't be classified.
  for (const match of masked.matchAll(/[)\]]\s*\(/gu)) {
    const end = closing(masked, match.index + match[0].length - 1);
    if (end < 0) continue;
    const start = match.index + match[0].length;
    // `print(open(p).read())`: a call on a call's result named after a dot
    // is a method call, read above; only `](` and `)(` directly count.
    calls.push({
      name: '(computed)',
      kind: 'dynamic',
      args: argsOf(start, end - 1),
      receiver: null,
    });
  }
  for (const string of strings)
    if (string.backtick)
      calls.push({
        name: '`',
        kind: 'exec',
        args: [
          { text: '', literal: string.interpolated ? null : string.value },
        ],
        receiver: null,
      });
  return {
    ok,
    language: table ? language : null,
    calls: calls.map((call) => ({ ...call, ...classifyCall(call, language) })),
    literals: strings.filter((s) => !s.interpolated).map((s) => s.value),
  };
}

// Python pathlib methods act on the path they are called on.
const PATHLIB_METHODS = new Set(
  'open write_text write_bytes read_text read_bytes unlink touch chmod lchmod rename replace symlink_to hardlink_to exists is_file stat rmdir'.split(
    ' ',
  ),
);
// Copies read their first argument and write only the last.
const COPIES = new Set(
  'copy copyfile copy2 copytree copyFileSync copyFile cpSync cp copy_file install'.split(
    ' ',
  ),
);

// A call's kind (an open resolved to read, write or exec by its mode) and
// the arguments naming what it reads or changes: { kind, targets: [arg],
// command }.
function classifyCall(call, language) {
  const positional = (call.args ?? []).filter((a) => !a.keyword && !a.object);
  const onReceiver =
    language === 'python' &&
    call.receiver?.length &&
    PATHLIB_METHODS.has(call.name);
  if (call.kind === 'open') {
    if (onReceiver) {
      const mode = positional[0]?.literal;
      return {
        kind:
          positional[0] === undefined
            ? 'read'
            : mode === null
              ? 'open'
              : /[waxWAX+]/u.test(mode)
                ? 'write'
                : 'read',
        targets: [call.receiver[0]],
      };
    }
    const { kind, target, command } = openMode(call, language);
    return { kind, targets: target ? [target] : [], command };
  }
  if (onReceiver) return { kind: call.kind, targets: [call.receiver[0]] };
  if (call.kind === 'write' && COPIES.has(call.name))
    return { kind: 'write', targets: positional.slice(-1) };
  return { kind: call.kind, targets: positional };
}

// An open call's mode: { kind: 'read' | 'write' | 'open' | 'exec', target,
// command }. `target` is the argument naming the file.
function openMode(call, language) {
  const args = call.args ?? [];
  const positional = args.filter((a) => !a.keyword && !a.object);
  if (language === 'perl') {
    // open(FH, MODE, PATH) or open(FH, "MODE PATH"); sysopen(FH, PATH, FLAGS).
    if (call.name === 'sysopen') {
      const flags = positional[2]?.text ?? '';
      return {
        kind: /O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)/u.test(flags)
          ? 'write'
          : /O_RDONLY/u.test(flags)
            ? 'read'
            : 'open',
        target: positional[1] ?? null,
      };
    }
    if (positional.length >= 3) {
      const mode = positional[1].literal;
      if (mode === null) return { kind: 'open', target: positional[2] };
      return {
        kind: /^\s*(?:\+?>|>>|\+<|\|-|-\|)/u.test(mode)
          ? /\|/u.test(mode)
            ? 'exec'
            : 'write'
          : 'read',
        target: positional[2],
      };
    }
    const spec = positional[1];
    if (!spec) return { kind: 'open', target: null };
    const both = spec.literal;
    if (both === null) {
      // "<$file" style: the mode is known even when the path is not.
      const head = /^["'](\s*(?:>>|\+?[<>]|\|)?)/u.exec(spec.text)?.[1]?.trim();
      return {
        kind:
          head === undefined
            ? 'open'
            : head === '' || head === '<'
              ? 'read'
              : head.includes('|')
                ? 'exec'
                : 'write',
        target: spec,
      };
    }
    const mode = /^\s*(>>|\+?[<>]|\|)?/u.exec(both)[1] ?? '';
    const piped = /\|\s*$/u.test(both) || mode === '|';
    const path = both
      .replace(/^\s*(?:>>|\+?[<>]|\|)?\s*/u, '')
      .replace(/\s*\|\s*$/u, '');
    return {
      kind: piped ? 'exec' : mode === '' || mode === '<' ? 'read' : 'write',
      target: { text: spec.text, literal: path },
      command: piped ? path : undefined,
    };
  }
  // open(PATH[, MODE]) in Python, Ruby, PHP, Lua; openSync(PATH, FLAGS) in
  // Node. A mode keyword (`mode="w"`) counts too.
  const modeArg =
    args.find((a) => a.keyword && /^\s*(?:mode|flags)\s*=/u.test(a.text)) ??
    positional[1];
  const target = positional[0] ?? null;
  if (!modeArg) {
    // Ruby's File.new/open and Python's open default to reading.
    return { kind: 'read', target };
  }
  const literal =
    modeArg.literal ??
    /^\s*\w+\s*=\s*["']([^"']*)["']\s*$/u.exec(modeArg.text)?.[1] ??
    null;
  if (literal === null) {
    if (/O_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND)/u.test(modeArg.text))
      return { kind: 'write', target };
    return { kind: 'open', target };
  }
  return { kind: /[waxWAX+]/u.test(literal) ? 'write' : 'read', target };
}

// The shell command an exec call runs, when every argument is a plain
// string (or a list of them): `os.system("…")`, `execSync("…")`,
// `subprocess.run(["rm", PATH])`, `system("rm", PATH)`, backticks. Null
// when any part is built at run time.
export function execCommand(call) {
  if (call.command !== undefined) return call.command;
  const parts = [];
  for (const arg of call.args ?? []) {
    if (arg.keyword || arg.object) continue;
    if (arg.literal !== null) parts.push({ literal: arg.literal });
    else if (arg.list && arg.list.every((item) => item !== null))
      parts.push({ list: arg.list });
    else return null;
  }
  if (!parts.length) return null;
  if (parts.length === 1 && parts[0].literal !== undefined)
    return parts[0].literal;
  const quote = (word) => `'${String(word).replaceAll("'", `'\\''`)}'`;
  return parts
    .flatMap((part) => (part.list ? part.list : [part.literal]))
    .map(quote)
    .join(' ');
}
