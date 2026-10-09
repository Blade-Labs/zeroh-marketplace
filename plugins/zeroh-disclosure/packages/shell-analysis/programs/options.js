// SPDX-License-Identifier: AGPL-3.0-only

// How programs read their own arguments (Astra rc.2 F1, F2, F4, F5), shared
// by the settings guard (packages/shell-analysis/settings-guard.js) and the destination check
// (packages/shell-analysis/shell-destinations.js), so an option means the same thing to both
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
// Words are packages/shell-analysis/shell-scan.js words ({ value, raw, dynamic, … }).

// A set of option names from a Set, an array or a space-separated string.
export function optionSet(list) {
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
