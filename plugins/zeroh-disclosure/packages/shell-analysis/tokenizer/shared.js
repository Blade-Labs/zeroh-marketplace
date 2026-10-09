// SPDX-License-Identifier: AGPL-3.0-only

// Shell scanning shared by every guard: where a comment starts and what a
// heredoc's delimiter is (the exit-status wrapper and late binding used to
// disagree on `<<"EO\"F"`), and the one Bash tokenizer (parseBash,
// analyzeBash) and conservative PowerShell parser (parsePowerShell) that the
// settings guard and the destination check read commands with (rc.2). No
// imports.

// Whether a `#` at `index` starts a comment (at a word start).
export function commentStarts(command, index) {
  if (command[index] !== '#') return false;
  if (index === 0) return true;
  return /[\s;&|()<>]/u.test(command[index - 1]);
}

// Reads the heredoc word after `<<` at `start` as Bash does: `<<-` strips
// tabs, quotes and backslashes are removed (inside double quotes a backslash
// escapes the next character) and make the body literal. Returns
// { delimiter, quoted, stripTabs, wordStart, end }, { error } for an
// unterminated quote, or null when there is no heredoc here.
export function readHeredocWord(command, start) {
  if (!command.startsWith('<<', start) || command[start + 2] === '<') {
    return null;
  }
  let index = start + 2;
  let stripTabs = false;
  if (command[index] === '-') {
    stripTabs = true;
    index += 1;
  }
  while (command[index] === ' ' || command[index] === '\t') index += 1;
  const wordStart = index;
  let delimiter = '';
  let quoted = false;
  while (index < command.length) {
    const char = command[index];
    if (/\s|[;&|<>()]/u.test(char)) break;
    if (char === "'" || char === '"') {
      quoted = true;
      index += 1;
      while (index < command.length && command[index] !== char) {
        if (
          char === '"' &&
          command[index] === '\\' &&
          index + 1 < command.length
        ) {
          index += 1;
        }
        delimiter += command[index];
        index += 1;
      }
      if (command[index] !== char) {
        return { error: 'heredoc delimiter has an unterminated quote' };
      }
      index += 1;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      quoted = true;
      delimiter += command[index + 1];
      index += 2;
      continue;
    }
    delimiter += char;
    index += 1;
  }
  if (index === wordStart || !delimiter) return null;
  return { delimiter, quoted, stripTabs, wordStart, end: index };
}

// ---------------------------------------------------------------------------
// The Bash tokenizer (rc.2, Astra R1/R2).
//
// parseBash(source) reads a command line the way Bash does before it runs it:
// quote removal and concatenation (`--p"re"`, `--p\re`, `$'--pre'` and
// `"--"pre` are all the one word `--pre`), backslash escapes and line
// continuations, `$'…'` (ANSI-C) and `$"…"`, heredocs (their bodies are kept,
// and command substitutions in an unquoted body are commands too), operators,
// subshells, `$(…)`, backticks, `<(…)` and redirections. It returns every
// simple command, nested ones included, as a flat list, or { ok: false } for
// anything it cannot read. What a word expands to at run time (`$VAR`, `$(…)`,
// `~`, globs, braces) is not known here: such a word keeps its source text and
// says so (dynamic, dynamicAt, tilde, glob, brace), and the command inside a
// substitution is listed like any other.
//
// analyzeBash(source) adds what each command runs: launchers are unwrapped
// (`env -i A=1`, `timeout 5`, `nohup`, `sudo -u x`, `doas`, `command`,
// `builtin`, `exec -a x`, `nice -n 5`, `ionice`, `stdbuf -o0`, `time -p`,
// `setsid`, `xargs -0`), the program is named by its basename (`/usr/bin/curl`,
// `curl.exe` and `CURL` are `curl`), and code handed to an interpreter as text
// (`bash -c '…'`, `sh -s <<EOF`, `eval …`, `env -S '…'`, `find -exec …`,
// `watch …`, `script -c …`, `su -c …`) is parsed and listed too.
//
// Callers treat whatever this cannot vouch for as unsafe: a guard that needs
// certainty denies an unparseable command.
