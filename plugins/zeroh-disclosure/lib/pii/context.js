// SPDX-License-Identifier: AGPL-3.0-only

// Context words for ID numbers whose shape alone (9 to 13 digits) is too
// common in code and logs: the number counts only when a word naming it is
// close to it on the same line (a label or a JSON/YAML/.env key such as
// `"ssn": ` or `QATAR_ID=`: up to 40 characters before it or 20 after), or,
// in a CSV or TSV table, in the header of its column.

const BEFORE = 40;
const AFTER = 20;

function lineBounds(input, start) {
  const from = input.lastIndexOf('\n', start - 1) + 1;
  const newline = input.indexOf('\n', start);
  return [from, newline < 0 ? input.length : newline];
}

// The header of the column `start` sits in, when `input` is a table whose
// first line has the same number of separators as the line of `start`.
function columnHeader(input, start, lineStart, lineEnd) {
  if (lineStart === 0) return '';
  const firstEnd = input.indexOf('\n');
  const header = input.slice(0, firstEnd < 0 ? input.length : firstEnd);
  const line = input.slice(lineStart, lineEnd);
  for (const separator of [',', '\t', ';', '|']) {
    const count = (text) => text.split(separator).length - 1;
    if (!count(header) || count(header) !== count(line)) continue;
    const column = count(input.slice(lineStart, start));
    return header.split(separator)[column] ?? '';
  }
  return '';
}

// True when `words` (a regular expression) matches near the match on its
// line, or the header of its table column.
export function hasContext(input, start, end, words) {
  const [lineStart, lineEnd] = lineBounds(input, start);
  const around = `${input.slice(Math.max(lineStart, start - BEFORE), start)} ${input.slice(end, Math.min(lineEnd, end + AFTER))}`;
  words.lastIndex = 0;
  if (words.test(around)) return true;
  words.lastIndex = 0;
  return words.test(columnHeader(input, start, lineStart, lineEnd));
}
