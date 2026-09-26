// SPDX-License-Identifier: AGPL-3.0-only

// Bash scanning shared by the exit-status wrapper and late binding, so both
// agree on where a comment starts and what a heredoc's delimiter is (they
// used to disagree on `<<"EO\"F"`). No imports.

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
