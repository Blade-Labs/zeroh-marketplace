// SPDX-License-Identifier: AGPL-3.0-only

// PDF text extraction for Read: pdftotext when installed, else a built-in
// extractor, plus the check for whether the text layer is useful.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

// Windows would run a pdftotext.exe from the current (project) directory
// before PATH, so a repository could plant one. Search only absolute PATH
// entries, never the working directory; null when it is not installed.
export function pdftotextCommand(
  platform = process.platform,
  { env = process.env, fileExists = existsSync, cwd = process.cwd() } = {},
) {
  if (platform !== 'win32') return 'pdftotext';
  const win = path.win32;
  const here = win.resolve(cwd).toLowerCase();
  const entries = String(env.Path ?? env.PATH ?? '').split(';');
  for (const raw of entries) {
    const directory = raw.trim().replace(/^"(.*)"$/u, '$1');
    if (!directory || !win.isAbsolute(directory)) continue;
    if (win.resolve(directory).toLowerCase() === here) continue;
    const candidate = win.join(directory, 'pdftotext.exe');
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

export function extractPdfText(
  filePath,
  {
    platform = process.platform,
    run = spawnSync,
    readFile = readFileSync,
    env = process.env,
    fileExists = existsSync,
    cwd = process.cwd(),
  } = {},
) {
  try {
    const command = pdftotextCommand(platform, { env, fileExists, cwd });
    if (!command) throw new Error('pdftotext is not installed');
    const result = run(command, ['-layout', '-enc', 'UTF-8', filePath, '-'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (!result?.error && result?.status === 0) {
      return extracted(String(result.stdout ?? ''), 'pdftotext');
    }
  } catch {
    // The bundled extractor below is the no-dependency fallback.
  }

  try {
    return extractPdfTextFromBuffer(readFile(filePath));
  } catch {
    return { text: '', pageCount: 1, source: 'built-in' };
  }
}

export function extractPdfTextFromBuffer(input) {
  try {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const source = bytes.toString('latin1');
    if (!source.startsWith('%PDF-')) return emptyExtraction();

    const objects = parseObjects(source);
    const cmaps = parseFontCmaps(objects);
    const pages = [...objects.entries()].filter(([, body]) =>
      /\/Type\s*\/Page\b/u.test(body),
    );
    const pageTexts = [];

    for (const [, page] of pages) {
      const streams = contentStreams(page, objects);
      const fontNames = pageFontNames(page, objects);
      pageTexts.push(
        streams
          .map((stream) => parseContentStream(stream, fontNames, cmaps))
          .filter(Boolean)
          .join('\n'),
      );
    }

    if (pageTexts.length === 0) {
      const fallback = [...objects.values()]
        .map(decodedStream)
        .filter((stream) => stream && /\bBT\b/u.test(stream))
        .map((stream) => parseContentStream(stream, new Map(), cmaps))
        .filter(Boolean);
      return {
        ...extracted(
          fallback.join('\n'),
          'built-in',
          Math.max(1, fallback.length),
        ),
      };
    }

    return extracted(
      pageTexts.join('\f'),
      'built-in',
      Math.max(1, pageTexts.length),
    );
  } catch {
    return emptyExtraction();
  }
}

export function hasUsefulPdfText({ text, pageCount }) {
  if (!hasSanePdfText(text)) return false;
  const visible = String(text ?? '').replace(/\s/gu, '').length;
  return visible / Math.max(1, Number(pageCount) || 1) >= 20;
}

export function hasSanePdfText(text) {
  const visible = [...String(text ?? '')].filter(
    (character) => !/\s/u.test(character),
  );
  if (visible.length === 0) return false;

  const nonPrintable = visible.filter((character) =>
    /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u.test(character),
  ).length;
  if (nonPrintable / visible.length > 0.2) return false;

  if (visible.length >= 8 && !/[\p{L}\p{N}]{2,}/u.test(String(text))) {
    return false;
  }
  return true;
}

function emptyExtraction() {
  return { text: '', pageCount: 1, source: 'built-in' };
}

function extracted(text, source, explicitPageCount = null) {
  const pages = text.split('\f');
  if (pages.at(-1) === '') pages.pop();
  return {
    text: hasSanePdfText(text) ? text : '',
    pageCount: Math.max(1, explicitPageCount ?? pages.length),
    source,
  };
}

function parseObjects(source) {
  const objects = new Map();
  const pattern = /(?:^|[\r\n])\s*(\d+)\s+(\d+)\s+obj\b/gu;
  const matches = [...source.matchAll(pattern)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const limit = matches[index + 1]?.index ?? source.length;
    const end = source.lastIndexOf('endobj', limit);
    if (end >= start) objects.set(Number(match[1]), source.slice(start, end));
  }
  return objects;
}

function decodedStream(body) {
  try {
    const marker = /stream\r?\n/u.exec(body);
    if (!marker) return null;
    const start = marker.index + marker[0].length;
    const end = body.lastIndexOf('endstream');
    if (end < start) return null;
    let data = Buffer.from(body.slice(start, end), 'latin1');
    if (/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\b)/u.test(body)) {
      data = inflateSync(data);
    } else if (/\/Filter\b/u.test(body)) {
      return null;
    }
    return data.toString('latin1');
  } catch {
    return null;
  }
}

function contentStreams(page, objects) {
  const match = page.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/u);
  if (!match) return [];
  const refs = [...match[1].matchAll(/(\d+)\s+\d+\s+R/gu)].map((item) =>
    Number(item[1]),
  );
  return refs
    .map((ref) => decodedStream(objects.get(ref) ?? ''))
    .filter(Boolean);
}

function pageFontNames(page, objects) {
  const resources = inheritedResources(page, objects);
  const fontRef = resources.match(/\/Font\s+(\d+)\s+\d+\s+R/u);
  const fontBlock =
    resources.match(/\/Font\s*<<([\s\S]*?)>>/u)?.[1] ??
    objects.get(Number(fontRef?.[1])) ??
    '';
  const names = new Map();
  for (const match of fontBlock.matchAll(/\/(\S+)\s+(\d+)\s+\d+\s+R/gu)) {
    names.set(match[1], Number(match[2]));
  }
  return names;
}

function inheritedResources(page, objects, visited = new Set()) {
  const resourcesRef = page.match(/\/Resources\s+(\d+)\s+\d+\s+R/u);
  if (resourcesRef) {
    return objects.get(Number(resourcesRef[1])) ?? page;
  }
  if (/\/Resources\s*<</u.test(page)) return page;
  const parentRef = page.match(/\/Parent\s+(\d+)\s+\d+\s+R/u);
  const parentId = Number(parentRef?.[1]);
  if (!parentId || visited.has(parentId)) return page;
  visited.add(parentId);
  return inheritedResources(objects.get(parentId) ?? '', objects, visited);
}

function parseFontCmaps(objects) {
  const maps = new Map();
  for (const [id, body] of objects) {
    if (!/\/Type\s*\/Font\b/u.test(body)) continue;
    const ref = body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/u);
    if (!ref) continue;
    const stream = decodedStream(objects.get(Number(ref[1])) ?? '');
    if (stream) maps.set(id, parseCmap(stream));
  }
  return maps;
}

function parseCmap(source) {
  const map = new Map();
  for (const match of source.matchAll(
    /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/gu,
  )) {
    map.set(match[1].toUpperCase(), unicodeHex(match[2]));
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    for (const line of block[1].split(/\r?\n/u)) {
      const range = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(.*)/u);
      if (!range) continue;
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const destinations = [...range[3].matchAll(/<([0-9A-Fa-f]+)>/gu)].map(
        (item) => item[1],
      );
      if (!destinations.length) continue;
      for (let code = start; code <= end && code - start < 4096; code += 1) {
        const offset = code - start;
        let destination = destinations[offset];
        if (!destination && destinations.length === 1) {
          const width = destinations[0].length;
          destination = (Number.parseInt(destinations[0], 16) + offset)
            .toString(16)
            .padStart(width, '0');
        }
        if (destination) {
          map.set(
            code.toString(16).padStart(range[1].length, '0').toUpperCase(),
            unicodeHex(destination),
          );
        }
      }
    }
  }
  return map;
}

function unicodeHex(hex) {
  try {
    const bytes = Buffer.from(hex, 'hex');
    if (bytes.length >= 2 && bytes.length % 2 === 0) {
      let text = '';
      for (let index = 0; index < bytes.length; index += 2) {
        text += String.fromCharCode(bytes.readUInt16BE(index));
      }
      return text;
    }
    return bytes.toString('latin1');
  } catch {
    return '';
  }
}

function parseContentStream(source, fontNames, cmaps) {
  const tokens = lexContent(source);
  const output = [];
  const operands = [];
  let font = null;
  const newline = () => {
    if (output.length && output.at(-1) !== '\n') output.push('\n');
  };
  const text = (value) => output.push(decodePdfString(value, font));

  for (const token of tokens) {
    if (token.kind !== 'operator') {
      operands.push(token);
      continue;
    }
    if (token.value === 'Tf') {
      const name = operands.findLast((item) => item.kind === 'name');
      font = cmaps.get(fontNames.get(name?.value)) ?? null;
    } else if (token.value === 'Tj') {
      const value = operands.findLast((item) => item.kind === 'string');
      if (value) text(value.value);
    } else if (token.value === 'TJ') {
      const array = operands.findLast((item) => item.kind === 'array');
      for (const item of array?.value ?? []) {
        if (item.kind === 'string') text(item.value);
        if (item.kind === 'number' && item.value <= -120) output.push(' ');
      }
    } else if (token.value === "'") {
      newline();
      const value = operands.findLast((item) => item.kind === 'string');
      if (value) text(value.value);
    } else if (token.value === '"') {
      newline();
      const value = operands.findLast((item) => item.kind === 'string');
      if (value) text(value.value);
    } else if (['Td', 'TD'].includes(token.value)) {
      const numbers = operands.filter((item) => item.kind === 'number');
      if (numbers.at(-1)?.value !== 0) newline();
    } else if (token.value === 'T*' || token.value === 'ET') {
      newline();
    }
    operands.length = 0;
  }
  return output
    .join('')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}

function lexContent(source) {
  const tokens = [];
  let index = 0;
  const skip = () => {
    while (index < source.length) {
      if (/\s/u.test(source[index])) index += 1;
      else if (source[index] === '%') {
        while (index < source.length && !/[\r\n]/u.test(source[index]))
          index += 1;
      } else break;
    }
  };
  const next = () => {
    skip();
    if (index >= source.length) return null;
    if (source[index] === '(')
      return literalString(
        source,
        () => index,
        (n) => (index = n),
      );
    if (source[index] === '<' && source[index + 1] !== '<') {
      const end = source.indexOf('>', index + 1);
      if (end === -1) return null;
      const hex = source.slice(index + 1, end).replace(/\s/gu, '');
      index = end + 1;
      return {
        kind: 'string',
        value: Buffer.from(
          hex.padEnd(hex.length + (hex.length % 2), '0'),
          'hex',
        ),
      };
    }
    if (source[index] === '[') {
      index += 1;
      const value = [];
      while (index < source.length) {
        skip();
        if (source[index] === ']') {
          index += 1;
          break;
        }
        const item = next();
        if (!item) break;
        value.push(item);
      }
      return { kind: 'array', value };
    }
    const start = index;
    while (index < source.length && !/[\s()[\]<>]/u.test(source[index]))
      index += 1;
    const value = source.slice(start, index);
    if (!value) {
      index += 1;
      return next();
    }
    if (value.startsWith('/')) return { kind: 'name', value: value.slice(1) };
    const number = Number(value);
    if (Number.isFinite(number)) return { kind: 'number', value: number };
    return { kind: 'operator', value };
  };
  for (let token = next(); token; token = next()) tokens.push(token);
  return tokens;
}

function literalString(source, getIndex, setIndex) {
  let index = getIndex() + 1;
  let depth = 1;
  const bytes = [];
  while (index < source.length && depth > 0) {
    const character = source[index++];
    if (character === '\\') {
      const escaped = source[index++];
      const simple = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      if (simple[escaped] !== undefined) bytes.push(simple[escaped]);
      else if (/[0-7]/u.test(escaped ?? '')) {
        let octal = escaped;
        while (octal.length < 3 && /[0-7]/u.test(source[index] ?? ''))
          octal += source[index++];
        bytes.push(Number.parseInt(octal, 8));
      } else if (escaped === '\r' && source[index] === '\n') index += 1;
      else if (escaped !== '\n' && escaped !== '\r' && escaped !== undefined)
        bytes.push(escaped.charCodeAt(0) & 0xff);
    } else if (character === '(') {
      depth += 1;
      bytes.push(40);
    } else if (character === ')') {
      depth -= 1;
      if (depth > 0) bytes.push(41);
    } else {
      bytes.push(character.charCodeAt(0) & 0xff);
    }
  }
  setIndex(index);
  return { kind: 'string', value: Buffer.from(bytes) };
}

function decodePdfString(bytes, cmap) {
  if (!cmap?.size) return bytes.toString('latin1');
  const widths = [
    ...new Set([...cmap.keys()].map((key) => key.length / 2)),
  ].sort((left, right) => right - left);
  let output = '';
  for (let index = 0; index < bytes.length;) {
    let matched = false;
    for (const width of widths) {
      const key = bytes
        .subarray(index, index + width)
        .toString('hex')
        .toUpperCase();
      if (cmap.has(key)) {
        output += cmap.get(key);
        index += width;
        matched = true;
        break;
      }
    }
    if (!matched) output += String.fromCharCode(bytes[index++]);
  }
  return output;
}
