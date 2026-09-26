// SPDX-License-Identifier: AGPL-3.0-only

// A small strict XML well-formedness checker for generated login-item
// definitions: one root element, balanced tags, quoted attributes, valid
// entity references, and comments without "--". Throws on the first error.
const NAME = '[A-Za-z_:][-A-Za-z0-9_.:]*';
const ENTITY_RE = /&(?:#[0-9]+|#x[0-9A-Fa-f]+|lt|gt|amp|quot|apos);/uy;

function checkText(text, where) {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '<') throw new Error(`raw "<" in ${where}`);
    if (char === '&') {
      ENTITY_RE.lastIndex = index;
      if (!ENTITY_RE.test(text)) throw new Error(`bad entity in ${where}`);
    }
  }
}

export function assertWellFormedXml(source) {
  const xml = String(source);
  const stack = [];
  let roots = 0;
  let index = 0;
  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end < 0) throw new Error('unterminated XML declaration');
    index = end + 2;
  }
  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    const text = xml.slice(index, open < 0 ? xml.length : open);
    if (!stack.length && text.trim()) throw new Error('text outside the root');
    checkText(text, 'text');
    if (open < 0) break;
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) throw new Error('unterminated comment');
      const body = xml.slice(open + 4, end);
      if (body.includes('--') || body.endsWith('-')) {
        throw new Error('"--" inside a comment');
      }
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<!DOCTYPE', open)) {
      if (roots || stack.length) throw new Error('DOCTYPE after the root');
      const end = xml.indexOf('>', open);
      if (end < 0) throw new Error('unterminated DOCTYPE');
      index = end + 1;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open);
      if (end < 0) throw new Error('unterminated processing instruction');
      index = end + 2;
      continue;
    }
    const close = xml.indexOf('>', open);
    if (close < 0) throw new Error('unterminated tag');
    const tag = xml.slice(open + 1, close);
    index = close + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) throw new Error(`mismatched </${name}>`);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const match = new RegExp(
      `^(${NAME})((?:\\s+${NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*$`,
      'u',
    ).exec(body);
    if (!match) throw new Error(`malformed tag <${tag}>`);
    for (const [, value] of match[2].matchAll(
      /=\s*(?:"([^"]*)"|'([^']*)')/gu,
    )) {
      checkText(value || '', `attribute of <${match[1]}>`);
    }
    if (!stack.length) {
      roots += 1;
      if (roots > 1) throw new Error('more than one root element');
    }
    if (!selfClosing) stack.push(match[1]);
  }
  if (stack.length) throw new Error(`unclosed <${stack.at(-1)}>`);
  if (roots !== 1) throw new Error('no root element');
  return true;
}
