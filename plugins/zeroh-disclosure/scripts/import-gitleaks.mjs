#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Regenerates lib/rules/gitleaks.generated.json from the vendored gitleaks
// rule set (vendor/gitleaks). `--check` fails when the JSON is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'vendor', 'gitleaks', 'gitleaks-v8.30.1.toml');
const OUTPUT = path.join(ROOT, 'lib', 'rules', 'gitleaks.generated.json');

const SOURCE_METADATA = Object.freeze({
  project: 'gitleaks/gitleaks',
  version: 'v8.30.1',
  commit: '83d9cd684c87',
  license: 'MIT',
  file: 'vendor/gitleaks/gitleaks-v8.30.1.toml',
});

function assignmentEnd(text, start) {
  let quote = null;
  let triple = false;
  let escaped = false;
  let square = 0;
  let curly = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const three = text.slice(index, index + 3);
    if (triple) {
      if (three === quote.repeat(3)) {
        triple = false;
        quote = null;
        index += 2;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\' && quote === '"') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (three === "'''" || three === '\"\"\"') {
      quote = char;
      triple = true;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === '\n' && square === 0 && curly === 0) return index;
  }
  return text.length;
}

function splitArray(source) {
  const values = [];
  let start = 0;
  let quote = null;
  let triple = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index];
    const three = source.slice(index, index + 3);
    if (triple) {
      if (three === quote.repeat(3)) {
        triple = false;
        quote = null;
        index += 2;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\' && quote === '"') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (three === "'''" || three === '\"\"\"') {
      quote = char;
      triple = true;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
    else if ((char === ',' || index === source.length) && depth === 0) {
      const value = source.slice(start, index).trim();
      if (value && !value.startsWith('#')) values.push(parseTomlValue(value));
      start = index + 1;
    }
  }
  return values;
}

function stripComments(value) {
  return value
    .split(/\r?\n/u)
    .map((line) => {
      let quote = null;
      let escaped = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (escaped) escaped = false;
        else if (char === '\\' && quote === '"') escaped = true;
        else if (quote && char === quote) quote = null;
        else if (!quote && (char === '"' || char === "'")) quote = char;
        else if (!quote && char === '#') return line.slice(0, index);
      }
      return line;
    })
    .join('\n')
    .trim();
}

export function parseTomlValue(raw) {
  const value = stripComments(raw);
  if (value.startsWith("'''") && value.endsWith("'''")) {
    return value.slice(3, -3);
  }
  if (value.startsWith('\"\"\"') && value.endsWith('\"\"\"')) {
    return value.slice(3, -3);
  }
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitArray(value.slice(1, -1));
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  return value;
}

function parseAssignments(text) {
  const result = {};
  const keyPattern = /^\s*([A-Za-z][A-Za-z0-9]*)\s*=\s*/gmu;
  let match;
  while ((match = keyPattern.exec(text))) {
    const end = assignmentEnd(text, keyPattern.lastIndex);
    result[match[1]] = parseTomlValue(text.slice(keyPattern.lastIndex, end));
    keyPattern.lastIndex = end + 1;
  }
  return result;
}

export function parseGitleaksToml(text) {
  const starts = [...text.matchAll(/^\[\[rules\]\]\s*$/gmu)];
  return starts.map((entry, index) => {
    const body = text.slice(
      entry.index + entry[0].length,
      starts[index + 1]?.index ?? text.length,
    );
    const allowlistMarker = /^\[\[rules\.allowlists\]\]\s*$/gmu;
    const markers = [...body.matchAll(allowlistMarker)];
    const ruleText = body.slice(0, markers[0]?.index ?? body.length);
    const rule = parseAssignments(ruleText);
    rule.allowlists = markers.map((marker, markerIndex) =>
      parseAssignments(
        body.slice(
          marker.index + marker[0].length,
          markers[markerIndex + 1]?.index ?? body.length,
        ),
      ),
    );
    return rule;
  });
}

const POSIX_CLASSES = new Map([
  ['alnum', 'A-Za-z0-9'],
  ['alpha', 'A-Za-z'],
  ['ascii', '\\x00-\\x7f'],
  ['blank', ' \\t'],
  ['cntrl', '\\x00-\\x1f\\x7f'],
  ['digit', '0-9'],
  ['graph', '\\x21-\\x7e'],
  ['lower', 'a-z'],
  ['print', '\\x20-\\x7e'],
  ['punct', '!-/:-@[-`{-~'],
  ['space', '\\s'],
  ['upper', 'A-Z'],
  ['word', 'A-Za-z0-9_'],
  ['xdigit', 'A-Fa-f0-9'],
]);

function translatePosixClasses(source) {
  return source.replace(/\[:(\^?)([a-z]+):\]/gu, (whole, negate, name) => {
    const replacement = POSIX_CLASSES.get(name);
    if (!replacement || negate) return whole;
    return replacement;
  });
}

function foldClass(source) {
  let out = translatePosixClasses(source);
  if (/a-z/u.test(out) && !/A-Z/u.test(out))
    out = out.replace(/a-z/gu, 'a-zA-Z');
  if (/A-Z/u.test(out) && !/a-z/u.test(out))
    out = out.replace(/A-Z/gu, 'A-Za-z');
  out = out.replace(/(?<!\\)([A-Za-z])(?!-)/gu, (letter) => {
    const other =
      letter === letter.toLowerCase()
        ? letter.toUpperCase()
        : letter.toLowerCase();
    return `${letter}${other}`;
  });
  return out;
}

function translateSegment(
  source,
  initial = { insensitive: false, dotAll: false },
) {
  let out = '';
  let state = { ...initial };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      const next = source[index + 1];
      if (next === 'z') out += '(?![\\s\\S])';
      else if (next === 'A') out += '^';
      else {
        out += char + (next ?? '');
      }
      index += 1;
      continue;
    }
    if (char === '[') {
      let end = index + 1;
      let escaped = false;
      for (; end < source.length; end += 1) {
        if (
          !escaped &&
          source[end] === ']' &&
          !(source[index + 1] === '[' && source[end - 1] === ':')
        )
          break;
        escaped = !escaped && source[end] === '\\';
        if (source[end] !== '\\') escaped = false;
      }
      if (end >= source.length) throw new Error('unterminated character class');
      const body = source.slice(index + 1, end);
      out += `[${state.insensitive ? foldClass(body) : translatePosixClasses(body)}]`;
      index = end;
      continue;
    }
    if (source.startsWith('(?', index)) {
      const flag = source
        .slice(index)
        .match(/^\(\?([ims]*)(?:-([ims]*))?(?::|\))/u);
      if (flag && (flag[1] || flag[2])) {
        const enabled = new Set(flag[1]);
        const disabled = new Set(flag[2] || '');
        const nextState = {
          insensitive: disabled.has('i')
            ? false
            : enabled.has('i')
              ? true
              : state.insensitive,
          dotAll: disabled.has('s')
            ? false
            : enabled.has('s')
              ? true
              : state.dotAll,
        };
        const markerLength = flag[0].length;
        if (flag[0].endsWith(')')) {
          state = nextState;
          index += markerLength - 1;
          continue;
        }
        let depth = 1;
        let cursor = index + markerLength;
        let escaped = false;
        let inClass = false;
        for (; cursor < source.length; cursor += 1) {
          const current = source[cursor];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (current === '\\') {
            escaped = true;
            continue;
          }
          if (current === '[') inClass = true;
          else if (current === ']') inClass = false;
          else if (!inClass && current === '(') depth += 1;
          else if (!inClass && current === ')' && --depth === 0) break;
        }
        if (depth !== 0) throw new Error('unterminated inline-flag group');
        out += `(?:${translateSegment(source.slice(index + markerLength, cursor), nextState)})`;
        index = cursor;
        continue;
      }
    }
    if (char === '(') {
      const end = matchingParen(source, index);
      if (end === -1) throw new Error('unterminated group');
      let prefix = '(';
      let bodyStart = index + 1;
      if (source.startsWith('?:', bodyStart)) {
        prefix = '(?:';
        bodyStart += 2;
      } else if (source.startsWith('?<', bodyStart)) {
        const nameEnd = source.indexOf('>', bodyStart + 2);
        if (nameEnd === -1 || nameEnd > end)
          throw new Error('unterminated named group');
        prefix = source.slice(index, nameEnd + 1);
        bodyStart = nameEnd + 1;
      } else if (source[bodyStart] === '?') {
        throw new Error('unsupported RE2 group construct');
      }
      out += `${prefix}${translateSegment(source.slice(bodyStart, end), state)})`;
      index = end;
      continue;
    }
    if (state.insensitive && /[A-Za-z]/u.test(char)) {
      out += `[${char.toLowerCase()}${char.toUpperCase()}]`;
    } else if (char === '.' && state.dotAll) out += '[\\s\\S]';
    else out += char;
  }
  return out;
}

export function translateRe2(source) {
  if (typeof source !== 'string' || !source) throw new Error('missing regex');
  if (/\\C|\(\?P=|\(\?<([=!])/u.test(source)) {
    throw new Error('unsupported RE2 construct');
  }
  const translated = translateSegment(
    source.replace(/\(\?P<([A-Za-z][A-Za-z0-9_]*)>/gu, '(?<$1>'),
  );
  if (/\[\[:|\(\?[ims-]/u.test(translated)) {
    throw new Error('untranslated RE2 syntax');
  }
  try {
    new RegExp(translated, 'gd');
  } catch (error) {
    throw new Error(`invalid JavaScript regex: ${error.message}`);
  }
  return { regex: translated, flags: 'g' };
}

function translateAllowlist(allowlist) {
  const translated = { ...allowlist };
  if (Array.isArray(allowlist.regexes)) {
    translated.regexes = allowlist.regexes.map((regex) => translateRe2(regex));
  }
  return translated;
}

function ruleType(rule) {
  return /(?:^|[-_ ])token(?:$|[-_ ])|oauth|bearer|pat(?:$|[-_ ])/iu.test(
    `${rule.id} ${rule.description}`,
  )
    ? 'TOKEN'
    : 'API_KEY';
}

export function generateCatalog(text = readFileSync(SOURCE, 'utf8')) {
  const parsed = parseGitleaksToml(text);
  const rules = [];
  const skipped = [];
  for (const sourceRule of parsed) {
    try {
      const translated = translateRe2(sourceRule.regex);
      const allowlists = sourceRule.allowlists.map(translateAllowlist);
      rules.push({
        id: sourceRule.id,
        description: sourceRule.description,
        regex: translated.regex,
        flags: translated.flags,
        type: ruleType(sourceRule),
        ...(sourceRule.secretGroup === undefined
          ? {}
          : { secretGroup: sourceRule.secretGroup }),
        ...(sourceRule.keywords === undefined
          ? {}
          : { keywords: sourceRule.keywords }),
        ...(sourceRule.entropy === undefined
          ? {}
          : { entropy: sourceRule.entropy }),
        ...(allowlists.length ? { allowlists } : {}),
      });
    } catch (error) {
      skipped.push({
        id: sourceRule.id ?? '(missing id)',
        reason: error.message,
      });
    }
  }
  return {
    generatedFrom: SOURCE_METADATA,
    counts: {
      source: parsed.length,
      imported: rules.length,
      skipped: skipped.length,
    },
    rules,
    skipped,
  };
}

function classCharacters(source) {
  const body = source.replace(/^\^/u, '');
  const chars = [];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '\\') {
      const code = body[index + 1];
      if (code === 'w') chars.push(...'Aa0_');
      else if (code === 'd') chars.push(...'0123456789');
      else if (code === 's') chars.push(' ');
      else if (
        code === 'x' &&
        /^[0-9a-f]{2}$/iu.test(body.slice(index + 2, index + 4))
      ) {
        chars.push(
          String.fromCharCode(
            Number.parseInt(body.slice(index + 2, index + 4), 16),
          ),
        );
        index += 2;
      } else if (code) chars.push(code);
      index += 1;
    } else if (index + 2 < body.length && body[index + 1] === '-') {
      const first = body.charCodeAt(index);
      const last = body.charCodeAt(index + 2);
      const width = Math.min(last - first, 25);
      for (let offset = 0; offset <= width; offset += 1) {
        chars.push(String.fromCharCode(first + offset));
      }
      index += 2;
    } else chars.push(body[index]);
  }
  const usable = [...new Set(chars)].filter((char) =>
    /[A-Za-z0-9_+=.@:-]/u.test(char),
  );
  if (source.startsWith('^')) {
    return [...'ZEROHFAKE0123456789_-'].filter(
      (char) => !usable.includes(char),
    );
  }
  return usable.length ? usable : ['Z'];
}

function parseQuantifier(source, index) {
  if (source[index] === '?') return { count: 1, end: index };
  if (source[index] === '*') return { count: 0, end: index };
  if (source[index] === '+') return { count: 2, end: index };
  if (source[index] !== '{') return { count: 1, end: index - 1 };
  const end = source.indexOf('}', index + 1);
  if (end === -1) return { count: 1, end: index - 1 };
  const [minimum] = source.slice(index + 1, end).split(',');
  return { count: Number(minimum || 0), end };
}

function chooseAlternative(source, variant) {
  const alternatives = [];
  let start = 0;
  let depth = 0;
  let inClass = false;
  let escaped = false;
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (!inClass && char === '(') depth += 1;
    else if (!inClass && char === ')') depth -= 1;
    else if ((char === '|' || index === source.length) && depth === 0) {
      alternatives.push(source.slice(start, index));
      start = index + 1;
    }
  }
  return alternatives[variant % alternatives.length];
}

function matchingParen(source, start) {
  let depth = 1;
  let inClass = false;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) escaped = false;
    else if (char === '\\') escaped = true;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (!inClass && char === '(') depth += 1;
    else if (!inClass && char === ')' && --depth === 0) return index;
  }
  return -1;
}

function sampleSequence(source, variant, offset = 0) {
  const selected = chooseAlternative(source, variant);
  let output = '';
  let atomIndex = 0;
  for (let index = 0; index < selected.length; index += 1) {
    let atom = '';
    const char = selected[index];
    if (char === '^' || char === '$') continue;
    if (selected.startsWith('(?![\\s\\S])', index)) {
      index += 10;
      continue;
    }
    if (char === '\\') {
      const code = selected[index + 1];
      if (['b', 'B', 'A', 'z'].includes(code)) atom = '';
      else if (code === 'd') atom = String((variant + atomIndex) % 10);
      else if (code === 'w') atom = 'Z';
      else if (code === 's') atom = ' ';
      else if (code === 'S') atom = 'Z';
      else if (code === 'r') atom = '\r';
      else if (code === 'n') atom = '\n';
      else if (code === 't') atom = '\t';
      else if (
        code === 'x' &&
        /^[0-9a-f]{2}$/iu.test(selected.slice(index + 2, index + 4))
      ) {
        atom = String.fromCharCode(
          Number.parseInt(selected.slice(index + 2, index + 4), 16),
        );
        index += 2;
      } else atom = code || '';
      index += 1;
    } else if (char === '[') {
      let end = index + 1;
      let escaped = false;
      for (; end < selected.length; end += 1) {
        if (
          !escaped &&
          selected[end] === ']' &&
          !(selected[index + 1] === '[' && selected[end - 1] === ':')
        )
          break;
        escaped = !escaped && selected[end] === '\\';
        if (selected[end] !== '\\') escaped = false;
      }
      atom = { chars: classCharacters(selected.slice(index + 1, end)) };
      index = end;
    } else if (char === '(') {
      const end = matchingParen(selected, index);
      if (end === -1) throw new Error('unbalanced group');
      let bodyStart = index + 1;
      if (selected.startsWith('?:', bodyStart)) bodyStart += 2;
      atom = sampleSequence(
        selected.slice(bodyStart, end),
        variant + atomIndex + 1,
        offset + output.length,
      );
      index = end;
    } else if (char === '.') atom = 'Z';
    else atom = char;

    const quantifier = parseQuantifier(selected, index + 1);
    if (quantifier.end >= index + 1) index = quantifier.end;
    const count = quantifier.count;
    if (typeof atom === 'object') {
      const preferred =
        'ZEROHFAKE0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_+-=';
      for (let repeat = 0; repeat < count; repeat += 1) {
        atomIndex += 1;
        const wanted =
          preferred[(variant + offset + atomIndex) % preferred.length];
        output += atom.chars.includes(wanted)
          ? wanted
          : atom.chars[(variant + offset + atomIndex) % atom.chars.length];
      }
    } else output += atom.repeat(count);
    atomIndex += 1;
  }
  return output;
}

export function shannonEntropy(value) {
  if (!value) return 0;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function sampleAllowlisted(rule, secret, match) {
  for (const allowlist of rule.allowlists ?? []) {
    if (allowlist.paths?.length || allowlist.commits?.length) continue;
    const target = allowlist.regexTarget === 'match' ? match[0] : secret;
    const checks = [];
    if (allowlist.stopwords?.length) {
      checks.push(
        allowlist.stopwords.some((word) =>
          target.toLowerCase().includes(String(word).toLowerCase()),
        ),
      );
    }
    if (allowlist.regexes?.length) {
      checks.push(
        allowlist.regexes.some((entry) =>
          new RegExp(entry.regex, entry.flags.replace('g', '')).test(target),
        ),
      );
    }
    if (
      checks.length &&
      (allowlist.condition === 'AND'
        ? checks.every(Boolean)
        : checks.some(Boolean))
    ) {
      return true;
    }
  }
  return false;
}

// Indices of the unnamed capture groups in a translated regex (the same
// scan as lib/detector.js; named groups label alternatives, not secrets).
export function unnamedGroups(source) {
  const out = [];
  let index = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') {
      if (source[i + 1] !== '?') out.push((index += 1));
      else if (source[i + 2] === '<' && !/[=!]/u.test(source[i + 3]))
        index += 1;
    }
  }
  return out;
}

// The secret gitleaks reports for a match: `secretGroup` when set, otherwise
// the first non-empty unnamed capture group, otherwise the whole match. A
// group that captured its own quotes yields the value inside them.
export function secretOf(rule, match) {
  let secret = match[0];
  if (rule.secretGroup) secret = match[rule.secretGroup];
  else {
    const index = unnamedGroups(rule.regex).find((i) => match[i]);
    if (index) secret = match[index];
  }
  if (secret && rule.id === 'kubernetes-secret-yaml')
    secret = secret.replace(/^[\w.-]+:(?:[ \t]*(?:\||>[-+]?)\s+)?[ \t]*/u, '');
  if (secret && /^(["'`]).+\1$/su.test(secret)) secret = secret.slice(1, -1);
  return secret;
}

// `accept(sample, secret)` lets a caller skip variants its detector refuses
// (a letters-only value is read as a name, not a password).
export function sampleRule(rule, accept = () => true) {
  const expression = new RegExp(rule.regex, rule.flags.replace('g', ''));
  for (let variant = 0; variant < 256; variant += 1) {
    let sample;
    try {
      sample = sampleSequence(rule.regex, variant);
    } catch {
      return null;
    }
    if (
      rule.keywords?.length &&
      !rule.keywords.some((word) =>
        sample.toLowerCase().includes(word.toLowerCase()),
      )
    ) {
      sample = `${rule.keywords[variant % rule.keywords.length]} ${sample}`;
    }
    const match = expression.exec(sample);
    if (!match) continue;
    const secret = secretOf(rule, match);
    if (!secret) continue;
    if (rule.entropy !== undefined && shannonEntropy(secret) < rule.entropy)
      continue;
    if (sampleAllowlisted(rule, secret, match)) continue;
    if (!accept(sample, secret)) continue;
    return { sample, secret };
  }
  return null;
}

export function samplesForCatalog(catalog, accept) {
  const samples = [];
  const uncovered = [];
  for (const rule of catalog.rules) {
    const generated = sampleRule(rule, accept);
    if (generated) samples.push({ id: rule.id, ...generated });
    else
      uncovered.push({
        id: rule.id,
        reason:
          'sampler could not satisfy regex, keyword and entropy constraints',
      });
  }
  return { samples, uncovered };
}

export function renderCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const unknown = argv.filter((arg) => arg !== '--check');
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);
  const rendered = renderCatalog(generateCatalog());
  if (check) {
    let current = '';
    try {
      current = readFileSync(OUTPUT, 'utf8');
    } catch {
      // Report the same useful drift message for a missing generated file.
    }
    // Compare the parsed catalog, not bytes: the workspace formatter may lay the file out
    // differently, and only the rules matter.
    let same = false;
    try {
      same =
        JSON.stringify(JSON.parse(current)) ===
        JSON.stringify(JSON.parse(rendered));
    } catch {
      same = false;
    }
    if (!same) {
      process.stderr.write(
        'gitleaks.generated.json is stale; run node scripts/import-gitleaks.mjs\n',
      );
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(OUTPUT, rendered);
  const catalog = JSON.parse(rendered);
  process.stdout.write(
    `Imported ${catalog.counts.imported} gitleaks rules; skipped ${catalog.counts.skipped}.\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
