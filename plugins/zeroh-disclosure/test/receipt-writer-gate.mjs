// SPDX-License-Identifier: AGPL-3.0-only

// Structural gate: receipt I/O uses named sink functions. Every other disk
// writer call is a reviewed, exact local-state call site, not a payload-name
// heuristic. New or changed raw writes require classification here.
const RAW_WRITERS = [
  'write',
  'writeSync',
  'rename',
  'renameSync',
  'cp',
  'cpSync',
  'writeJson',
  'writeLocalJson',
  'writeFile',
  'writeFileSync',
  'writePrivateJson',
  'writePrivateFile',
  'copyFile',
  'copyFileSync',
  'appendFile',
  'appendFileSync',
  'createWriteStream',
];

export function rawWriterCalls(source) {
  // Retain strings/templates so the destination and record shape participate
  // in the inventory. Walk balanced arguments rather than stopping at ';'.
  // Remove comments while retaining strings/templates and their call sites.
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if ('\'"`'.includes(ch)) quote = ch;
    else if (source.startsWith('//', i) || source.startsWith('/*', i)) {
      const end = source.startsWith('//', i)
        ? source.indexOf('\n', i)
        : source.indexOf('*/', i + 2) + 2;
      const stop = end <= i ? source.length : end;
      source = source.slice(0, i) + ' '.repeat(stop - i) + source.slice(stop);
      i = stop - 1;
    }
  }
  const names = new Set(RAW_WRITERS);
  for (const imported of source.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/gu,
  )) {
    for (const item of imported[1].split(',')) {
      const alias = /^\s*(\w+)\s+as\s+(\w+)\s*$/u.exec(item);
      if (alias && names.has(alias[1])) names.add(alias[2]);
    }
  }
  // Follow assignment/destructuring aliases, including bracket-access methods.
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of source.matchAll(
      /\b(\w+)\s*=\s*(?:[\w.]+\s*\.\s*(\w+)|[\w.]+\s*\[\s*['"](\w+)['"]\s*\]|(\w+))\s*(?=[;,\n])/gu,
    )) {
      if (names.has(match[2] ?? match[3] ?? match[4]) && !names.has(match[1])) {
        names.add(match[1]);
        changed = true;
      }
    }
    for (const match of source.matchAll(/\b(\w+)\s*:\s*(\w+)\s*(?=[,}])/gu)) {
      if (names.has(match[1]) && !names.has(match[2])) {
        names.add(match[2]);
        changed = true;
      }
    }
  }
  const alternatives = [...names].join('|');
  const call = new RegExp(
    `\\b(?:${alternatives})\\s*\\(|\\[\\s*['"](?:${alternatives})['"]\\s*\\]\\s*\\(`,
    'gu',
  );
  const calls = [];
  for (const match of source.matchAll(call)) {
    if (/\bfunction\s*$/u.test(source.slice(0, match.index))) continue;
    let depth = 1;
    let argumentQuote = null;
    let end = match.index + match[0].length;
    for (; end < source.length && depth; end++) {
      const ch = source[end];
      if (argumentQuote) {
        if (ch === '\\') end++;
        else if (ch === argumentQuote) argumentQuote = null;
      } else if ('\'"`'.includes(ch)) argumentQuote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (/^\s*\{/u.test(source.slice(end))) continue; // method declaration
    // Keep the receiver: a stdout exemption cannot authorize a file handle.
    const receiver = (
      match[0].startsWith('[')
        ? /[\w$]+(?:\s*\.\s*[\w$]+)*\s*$/u
        : /[\w$]+(?:\s*\.\s*[\w$]+)*\s*\.\s*$/u
    ).exec(source.slice(0, match.index));
    const start = receiver ? receiver.index : match.index;
    calls.push(source.slice(start, end).replace(/\s+/gu, ' ').trim());
  }
  return calls;
}

export function receiptWriterViolations(source, approvedLocalCalls = []) {
  const remaining = [...approvedLocalCalls];
  return rawWriterCalls(source).filter((call) => {
    // Generic session.writeJson is always forbidden in production, including
    // indirect receipt updates with innocuous variable names.
    if (/^writeJson\s*\(/u.test(call)) return true;
    const index = remaining.indexOf(call);
    if (index === -1) return true;
    remaining.splice(index, 1);
    return false;
  });
}
