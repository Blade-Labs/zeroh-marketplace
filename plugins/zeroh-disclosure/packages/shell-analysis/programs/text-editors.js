// SPDX-License-Identifier: AGPL-3.0-only

import { readOptions } from './options.js';

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
class SedReader {
  constructor(script) {
    this.text = String(script);
    this.out = {
      ok: true,
      writes: [],
      reads: [],
      executes: [],
      reason: null,
    };
    this.i = 0;
  }

  fail(reason) {
    this.out.ok = false;
    this.out.reason = reason;
    return this.out;
  }

  skipBlanks() {
    while (
      this.i < this.text.length &&
      (this.text[this.i] === ' ' || this.text[this.i] === '\t')
    )
      this.i += 1;
  }

  // To the end of the line: a file name or a command.
  restOfLine() {
    this.skipBlanks();
    let end = this.text.indexOf('\n', this.i);
    if (end < 0) end = this.text.length;
    const value = this.text.slice(this.i, end);
    this.i = end;
    return value;
  }

  // A delimited part (`/re/`, the halves of `s`), escapes kept.
  delimited(delimiter) {
    let value = '';
    while (this.i < this.text.length && this.text[this.i] !== delimiter) {
      if (this.text[this.i] === '\\' && this.i + 1 < this.text.length) {
        value += this.text.slice(this.i, this.i + 2);
        this.i += 2;
        continue;
      }
      if (this.text[this.i] === '\n' && delimiter !== '\n') return null;
      value += this.text[this.i];
      this.i += 1;
    }
    if (this.i >= this.text.length) return null;
    this.i += 1;
    return value;
  }

  address() {
    if (/\d/u.test(this.text[this.i] ?? '')) {
      while (/\d/u.test(this.text[this.i] ?? '')) this.i += 1;
      if (this.text[this.i] === '~') {
        this.i += 1;
        while (/\d/u.test(this.text[this.i] ?? '')) this.i += 1;
      }
      return true;
    }
    if (this.text[this.i] === '$') {
      this.i += 1;
      return true;
    }
    if (this.text[this.i] === '/' || this.text[this.i] === '\\') {
      const delimiter =
        this.text[this.i] === '\\' ? this.text[this.i + 1] : '/';
      this.i += this.text[this.i] === '\\' ? 2 : 1;
      if (this.delimited(delimiter) === null) return false;
      while (this.text[this.i] === 'I' || this.text[this.i] === 'M')
        this.i += 1;
      return true;
    }
    return true;
  }

  readText() {
    // Text to the end of the line; a backslash continues it.
    while (this.i < this.text.length) {
      if (this.text[this.i] === '\\' && this.i + 1 < this.text.length) {
        this.i += 2;
        continue;
      }
      if (this.text[this.i] === '\n') break;
      this.i += 1;
    }
  }

  readSubstitution() {
    const delimiter = this.text[this.i];
    if (!delimiter || delimiter === '\n' || delimiter === '\\')
      return this.fail('bad s delimiter');
    this.i += 1;
    if (this.delimited(delimiter) === null) return this.fail('unterminated s');
    let closed = false;
    while (this.i < this.text.length) {
      if (this.text[this.i] === '\\' && this.i + 1 < this.text.length) {
        this.i += 2;
        continue;
      }
      if (this.text[this.i] === delimiter) {
        closed = true;
        this.i += 1;
        break;
      }
      this.i += 1;
    }
    if (!closed) return this.fail('unterminated s');
    while (
      this.i < this.text.length &&
      /[gpiImMe0-9w]/u.test(this.text[this.i])
    ) {
      const flag = this.text[this.i];
      this.i += 1;
      if (flag === 'e') this.out.executes.push('');
      if (flag === 'w') {
        this.out.writes.push(this.restOfLine());
        break;
      }
    }
    return null;
  }

  readCommand(command) {
    switch (command) {
      case '{':
        return null;
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
        return null;
      case 'l':
      case 'L':
      case 'q':
      case 'Q':
        this.skipBlanks();
        while (/\d/u.test(this.text[this.i] ?? '')) this.i += 1;
        return null;
      case ':':
      case 'b':
      case 't':
      case 'T':
      case 'v':
        this.skipBlanks();
        while (this.i < this.text.length && !/[;\n}]/u.test(this.text[this.i]))
          this.i += 1;
        return null;
      case 'a':
      case 'i':
      case 'c':
        this.readText();
        return null;
      case 'r':
      case 'R':
        this.out.reads.push(this.restOfLine());
        return null;
      case 'w':
      case 'W':
        this.out.writes.push(this.restOfLine());
        return null;
      case 'e':
        this.out.executes.push(this.restOfLine());
        return null;
      case 's':
        return this.readSubstitution();
      case 'y': {
        const delimiter = this.text[this.i];
        if (!delimiter || delimiter === '\n' || delimiter === '\\')
          return this.fail('bad y delimiter');
        this.i += 1;
        if (
          this.delimited(delimiter) === null ||
          this.delimited(delimiter) === null
        )
          return this.fail('unterminated y');
        return null;
      }
      default:
        return this.fail(
          `unknown sed command ${JSON.stringify(command ?? '')}`,
        );
    }
  }

  readOne() {
    if (!this.address()) return this.fail('unterminated address');
    this.skipBlanks();
    if (this.text[this.i] === ',') {
      this.i += 1;
      this.skipBlanks();
      if (this.text[this.i] === '+' || this.text[this.i] === '~') this.i += 1;
      if (!this.address()) return this.fail('unterminated address');
      this.skipBlanks();
    }
    while (this.text[this.i] === '!') {
      this.i += 1;
      this.skipBlanks();
    }
    const command = this.text[this.i++];
    const failed = this.readCommand(command);
    if (failed) return failed;
    if (command === '{') return null;
    this.skipBlanks();
    if (this.i < this.text.length && !/[;\n}#]/u.test(this.text[this.i]))
      return this.fail('extra characters after a sed command');
    return null;
  }

  read() {
    while (this.i < this.text.length) {
      while (this.i < this.text.length && /[\s;]/u.test(this.text[this.i]))
        this.i += 1;
      if (this.i >= this.text.length) break;
      if (this.text[this.i] === '#') {
        this.restOfLine();
        continue;
      }
      if (this.text[this.i] === '}') {
        this.i += 1;
        continue;
      }
      const failed = this.readOne();
      if (failed) return failed;
    }
    return this.out;
  }
}

export function readSedScript(script) {
  return new SedReader(script).read();
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
