// SPDX-License-Identifier: AGPL-3.0-only

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
