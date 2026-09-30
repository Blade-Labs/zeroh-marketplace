// Context words for ID numbers whose shape alone (9 to 13 digits) is too
// common in code and logs: the number counts only when a word naming it is
// close to it on the same line (a label or a JSON/YAML/.env key such as
// `"ssn": ` or `QATAR_ID=`: up to 40 characters before it or 20 after), or,
// in a CSV or TSV table, in the header of its column.
//
// Every lookup goes through the caller's TextIndex (../text-index.js), so
// each candidate costs O(log n): minified JSON on one line with thousands of
// 9-digit numbers is not scanned once per number.

const BEFORE = 40;
const AFTER = 20;
const SEPARATORS = [',', '\t', ';', '|'];

// The header of the column `start` sits in, when the text is a table whose
// first line has the same number of separators as the line of `start`.
function columnHeader(index, start, lineStart, lineEnd) {
  if (lineStart === 0) return '';
  const [, headerEnd] = index.lineBounds(0);
  for (const separator of SEPARATORS) {
    const inHeader = index.count(separator, 0, headerEnd);
    if (!inHeader || inHeader !== index.count(separator, lineStart, lineEnd))
      continue;
    const column = index.count(separator, lineStart, start);
    const header = index.memo(`header ${separator}`, (text) =>
      text.slice(0, headerEnd).split(separator),
    );
    return header[column] ?? '';
  }
  return '';
}

// True when `words` (a regular expression) matches near the match on its
// line, or the header of its table column. `index` is a TextIndex of the
// text.
export function hasContext(index, start, end, words) {
  const input = index.text;
  const [lineStart, lineEnd] = index.lineBounds(start);
  const around = `${input.slice(Math.max(lineStart, start - BEFORE), start)} ${input.slice(end, Math.min(lineEnd, end + AFTER))}`;
  words.lastIndex = 0;
  if (words.test(around)) return true;
  words.lastIndex = 0;
  return words.test(columnHeader(index, start, lineStart, lineEnd));
}
