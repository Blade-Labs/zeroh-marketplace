// SPDX-License-Identifier: AGPL-3.0-only

import { readOptions } from './options.js';

export const RUNNER_OPTIONS = Object.freeze({
  tar: {
    spec: {
      values:
        '-f --file -C --directory -I --use-compress-program -F --info-script --new-volume-script --to-command --rsh-command --checkpoint-action -b -g -K -L -N -T -V -X -H --exclude --transform --xform --files-from --strip-components',
      longs:
        '--file --directory --use-compress-program --info-script --new-volume-script --to-command --rsh-command --checkpoint-action --checkpoint --exclude --transform --xform --files-from --strip-components --wildcards --absolute-names --force-local --create --extract --get --list --append --update --verbose --gzip --bzip2 --xz --zstd --to-stdout --totals',
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

// The words a program's own options write to, for the programs of
// RUNNER_OPTIONS: `sort -o FILE`, and the archive `tar -c/-r/-u -f FILE`
// creates or changes; and the files an archive extractor writes when its
// members are named (`tar -xf a.tar -C DIR settings.json` writes
// DIR/settings.json; Astra pre-1.0.0 R1). An attached value is its own word
// ({ value }).
export function optionWrites(entry) {
  return archiveWrites(entry).writes;
}

// The directories an extractor writes files into that ZeroH can't name: all
// members (`tar -xf a.tar -C DIR`, `unzip a.zip -d DIR`), patterns, a member
// list from a file, renamed or stripped paths, cpio and 7z -o.
export function optionWritesInto(entry) {
  return archiveWrites(entry).into;
}

// A word for DIR/MEMBER as the extractor writes it (the working directory
// when there is no DIR). Without -P tar drops a member's leading `/`.
function memberWord(dir, member, absolute) {
  const name = String(member.value);
  if (absolute && /^\//u.test(name)) return member;
  const relative = name.replace(/^\/+/u, '');
  if (!dir) return { ...member, value: relative, raw: relative };
  const joined = `${String(dir.value).replace(/[\\/]+$/u, '')}/${relative}`;
  return { ...dir, value: joined, raw: joined, attached: false };
}

// A member ZeroH can't turn into one path: a pattern, a variable, a glob.
function unnamedMember(word) {
  return word.dynamic || word.glob || /[*?[]/u.test(String(word.value));
}

const CURRENT_DIRECTORY = Object.freeze({ value: '.', raw: '.' });

function extraction(dir, members, { absolute = false, unknown = false } = {}) {
  if (unknown || !members.length || members.some(unnamedMember))
    return { writes: [], into: [dir ?? CURRENT_DIRECTORY] };
  return {
    writes: members.map((member) => memberWord(dir, member, absolute)),
    into: [],
  };
}

const NO_WRITES = Object.freeze({ writes: [], into: [] });

function archiveWrites(entry) {
  const program = entry.program;
  const args = program === 'tar' ? tarArgs(entry.args || []) : entry.args || [];
  if (program === 'sort' || program === 'tar') {
    const read = readOptions(args, RUNNER_OPTIONS[program].spec);
    const has = (names) =>
      read.options.some((option) => names.includes(option.name));
    const valuesOf = (names) =>
      read.options
        .filter((option) => names.includes(option.name) && option.value)
        .map((option) => option.value);
    if (program === 'sort')
      return { writes: valuesOf(['-o', '--output']), into: [] };
    if (has(['-c', '-r', '-u', '--create', '--append', '--update']))
      return { writes: valuesOf(['-f', '--file']), into: [] };
    if (!has(['-x', '--extract', '--get']) || has(['-O', '--to-stdout']))
      return NO_WRITES;
    const dirs = valuesOf(['-C', '--directory']);
    return extraction(dirs.at(-1) ?? null, read.operands, {
      absolute: has(['-P', '--absolute-names']),
      unknown:
        dirs.length > 1 ||
        has([
          '-T',
          '--files-from',
          '--transform',
          '--xform',
          '--strip-components',
          '--wildcards',
        ]),
    });
  }
  if (program === 'unzip') return unzipWrites(args);
  if (program === 'cpio') return cpioWrites(args);
  if (['7z', '7za', '7zz', '7zr'].includes(program))
    return sevenZipWrites(args);
  return NO_WRITES;
}

// unzip [-opts] ARCHIVE [MEMBER…] [-x EXCLUDED…] [-d DIR]: options may come
// after the operands; -l, -t, -v, -p, -c, -z and -Z write no file, -j drops
// the members' folders.
function unzipWrites(args) {
  let dir = null;
  let archive = null;
  let excluding = false;
  let junk = false;
  const members = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    const value = String(word.value);
    if (value.startsWith('-') && value.length > 1 && !word.dynamic) {
      excluding = false;
      const flags = value.slice(1);
      const d = flags.indexOf('d');
      const before = d >= 0 ? flags.slice(0, d) : flags;
      if (/[ltvpczZ]/u.test(before)) return NO_WRITES;
      if (before.includes('j')) junk = true;
      if (d >= 0) {
        const rest = flags.slice(d + 1);
        dir = rest ? { ...word, value: rest, attached: true } : args[index + 1];
        if (!rest) index += 1;
      } else if (before.endsWith('x')) excluding = true;
      // -P takes the password as the next word.
      else if (before.endsWith('P')) index += 1;
      continue;
    }
    if (excluding) continue;
    if (!archive) archive = word;
    else members.push(word);
  }
  if (!archive) return NO_WRITES;
  return extraction(dir ?? null, members, { unknown: junk });
}

// cpio -i (extract) or -p (pass-through, into its DIR operand); -D/--directory
// changes the directory. Its members are always patterns.
function cpioWrites(args) {
  const read = readOptions(args, {
    values:
      '-D --directory -E --pattern-file -F --file -H --format -I -O -R --owner -M --message --rsh-command --block-size -C --io-size',
  });
  const has = (names) =>
    read.options.some((option) => names.includes(option.name));
  const dirs = read.options
    .filter((o) => ['-D', '--directory'].includes(o.name) && o.value)
    .map((o) => o.value);
  const dir = dirs.at(-1) ?? null;
  if (has(['-i', '--extract']) && !has(['-t', '--list']))
    return { writes: [], into: [dir ?? CURRENT_DIRECTORY] };
  if (has(['-p', '--pass-through'])) {
    const target = read.operands.at(-1);
    return { writes: [], into: [target ?? dir ?? CURRENT_DIRECTORY] };
  }
  return NO_WRITES;
}

// 7z x|e ARCHIVE [MEMBER…] [-oDIR]: `e` flattens paths, so only `x` names
// where a member goes.
function sevenZipWrites(args) {
  const command = String(args[0]?.value ?? '');
  if (command !== 'x' && command !== 'e') return NO_WRITES;
  let dir = null;
  const operands = [];
  for (const word of args.slice(1)) {
    const value = String(word.value);
    if (/^-o/u.test(value))
      dir = { ...word, value: value.slice(2), attached: true };
    else if (!value.startsWith('-') || word.dynamic) operands.push(word);
  }
  const [archive, ...members] = operands;
  if (!archive) return NO_WRITES;
  return extraction(dir, members, { unknown: command === 'e' });
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
