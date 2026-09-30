// Positions in one text, computed once per detect call. Checks that run for
// every candidate (the line a match sits on, its column in a table, whether
// the text is a diff) look them up in O(log n) instead of scanning the text
// again, so a long single line of tool output with many candidates stays
// linear. The lookups mirror String#indexOf and String#lastIndexOf.

// Index of the first element of the sorted `list` that is >= `value`.
export function lowerBound(list, value) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class TextIndex {
  #text;
  #positions = new Map();
  #memo = new Map();

  constructor(text) {
    this.#text = text;
  }

  get text() {
    return this.#text;
  }

  // The sorted offsets of the single character `char`, built on first use.
  positions(char) {
    let list = this.#positions.get(char);
    if (!list) {
      list = [];
      const text = this.#text;
      for (
        let at = text.indexOf(char);
        at !== -1;
        at = text.indexOf(char, at + 1)
      )
        list.push(at);
      this.#positions.set(char, list);
    }
    return list;
  }

  // How many times `char` occurs at offsets in [from, to).
  count(char, from, to) {
    const list = this.positions(char);
    return lowerBound(list, to) - lowerBound(list, from);
  }

  // text.lastIndexOf(char, at): a negative `at` searches offset 0 only.
  lastIndexOf(char, at) {
    const list = this.positions(char);
    const found = lowerBound(list, Math.max(0, at) + 1) - 1;
    return found >= 0 ? list[found] : -1;
  }

  // text.indexOf(char, at).
  indexOf(char, at) {
    const list = this.positions(char);
    const found = lowerBound(list, Math.max(0, at));
    return found < list.length ? list[found] : -1;
  }

  // [start, end) of the line `at` sits on, without its line feed.
  lineBounds(at) {
    const start = this.lastIndexOf('\n', at - 1) + 1;
    const newline = this.indexOf('\n', at);
    return [start, newline < 0 ? this.#text.length : newline];
  }

  // A value derived from the whole text, computed once.
  memo(key, compute) {
    if (!this.#memo.has(key)) this.#memo.set(key, compute(this.#text));
    return this.#memo.get(key);
  }
}

// An index for `text`: `index` itself when it was built for the same text.
export function textIndex(text, index) {
  return index && index.text === text ? index : new TextIndex(text);
}
