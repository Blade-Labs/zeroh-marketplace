// SPDX-License-Identifier: AGPL-3.0-only

// Counting helpers shared by the report modules: count maps ({ key: n }),
// sorted rows, plurals, and the credential/personal split the slip orders by.

import { isSecretType } from './data-kinds.js';

// Anything that is not a credential (or an entropy warning) is personal
// data: the slip previews it by type and last two characters, including
// kinds only an older vault produced.
export function isPersonalType(type) {
  return !isSecretType(type) && !/^ENTROPY_WARNING/u.test(String(type));
}

export function rows(counts, key) {
  return Object.entries(counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([value, count]) => ({ [key]: value, count: Number(count) }))
    .sort(
      (left, right) =>
        right.count - left.count || left[key].localeCompare(right[key]),
    );
}

export function dayRows(counts) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({ date, ...values }));
}

export function add(target, key, amount) {
  const count = Number(amount);
  if (!key || !Number.isFinite(count) || count <= 0) return;
  target[key] = (target[key] ?? 0) + count;
}

export function mergeCounts(target, source = {}) {
  for (const [key, count] of Object.entries(source ?? {}))
    add(target, key, count);
}

export function mergedCounts(list) {
  const out = {};
  for (const counts of list) mergeCounts(out, counts);
  return out;
}

export function sumCounts(counts = {}) {
  return Object.values(counts ?? {}).reduce(
    (sum, count) => sum + (Number(count) || 0),
    0,
  );
}

export function formatCounts(counts) {
  const entries = rows(counts, 'name');
  return entries.length
    ? entries.map((entry) => `${entry.name} × ${entry.count}`).join(', ')
    : '-';
}

export function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}

// "API_KEY×2, EMAIL" for findings or replacements, in first-seen order.
export function typeSummary(items = []) {
  const counts = {};
  for (const item of items) add(counts, item.entity_type ?? item.type, 1);
  return Object.entries(counts)
    .map(([type, count]) => (count > 1 ? `${type}×${count}` : type))
    .join(', ');
}

// The first eight letters and digits of a value commitment, for display.
export function shortCommit(commitment) {
  return String(commitment)
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 8);
}

export function countLabel(count, word) {
  return `${count} ${plural(count, word)}`;
}

// Where a masked value came from, in plain words (1.0.1): the one table
// the Stop line, /zeroh-disclosure:mask-show and receipt.html all use. The
// stored channels stay as they are in receipts; only what is shown changes.
//   typed prompt     in your message
//   file read        in <file name>          (a key name: for STRIPE_KEY)
//   command output   in command output       (a simple cat/head/tail/grep
//                                             of one file: in <file name>)
//   MCP result, web  in <tool> output
//   a known value    for <its name>          (STRIPE_KEY)
//   unmask grant     shown under your unmask
export const SOURCE_WORDS = Object.freeze({
  'typed prompt': 'in your message',
  'command output': 'in command output',
  'unmask grant': 'shown under your unmask',
});

// Channel names as receipt.html's "Withheld values" shows them.
export const CHANNEL_WORDS = Object.freeze({
  'typed prompt': 'your messages',
  'file read': 'files read',
  'command output': 'command output',
  'MCP result': 'MCP tool output',
  web: 'web pages',
});

export function channelWords(channel) {
  return CHANNEL_WORDS[channel] ?? String(channel);
}

const SIMPLE_READERS = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'less']);

function baseName(file) {
  const parts = String(file).split(/[\\/]/u);
  return parts.at(-1) || String(file);
}

// The one file a simple read command names (`cat .env`, `head -n 5
// signup-errors.log`, `grep -n @ users.csv`), or null.
export function commandFile(command) {
  const words = String(command ?? '')
    .trim()
    .split(/\s+/u);
  if (!SIMPLE_READERS.has(words[0])) return null;
  if (/[|;&<>`$()]/u.test(command)) return null;
  const operands = [];
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i].replace(/^(['"])(.*)\1$/u, '$2');
    if (word.startsWith('-')) {
      const takesValue = ['head', 'tail'].includes(words[0])
        ? /^-[nc]$/u
        : /^-[ABCem]$/u;
      if (takesValue.test(word)) i += 1;
      continue;
    }
    operands.push(word);
  }
  // grep and rg take a pattern first.
  const files = ['grep', 'rg'].includes(words[0])
    ? operands.slice(1)
    : operands;
  return files.length === 1 ? baseName(files[0]) : null;
}

// The file a `file read` source names ("docs/team.md · line 4"), and the
// key name when the source ends with one (".env · line 1 · STRIPE_KEY").
function fileSource(source) {
  const parts = String(source).split(' · ');
  const last = parts.at(-1);
  const line = parts.find((part) => /^line \d+$/u.test(part)) ?? null;
  const key = parts.length > 1 && !/^line \d+$/u.test(last) ? last : null;
  return { file: parts[0], name: baseName(parts[0]), line, key };
}

// Short: "in your message", "in team.md", "for STRIPE_KEY".
export function sourcePlace(entry) {
  if (entry.name) return `for ${entry.name}`;
  const channel = entry.channel;
  if (SOURCE_WORDS[channel] && channel !== 'command output')
    return SOURCE_WORDS[channel];
  if (channel === 'file read') {
    const { name, key } = fileSource(entry.source);
    return key ? `for ${key}` : `in ${name}`;
  }
  if (channel === 'command output') {
    const file = commandFile(entry.source);
    return file ? `in ${file}` : SOURCE_WORDS['command output'];
  }
  if (channel === 'MCP result' || channel === 'web')
    return `in ${entry.source} output`;
  return entry.source ? `in ${entry.source}` : 'in tool output';
}

// Full, for the per-token lists: "in docs/team.md, line 4", "in command
// output: cat secrets", "in your message".
export function observationFrom(entry) {
  const channel = entry.channel;
  let where;
  if (channel === 'file read') {
    const { file, line, key } = fileSource(entry.source);
    where = `in ${file}${line ? `, ${line}` : ''}${key ? ` (${key})` : ''}`;
  } else if (channel === 'command output') {
    where = `in command output: ${entry.source}`;
  } else if (channel === 'MCP result' || channel === 'web') {
    where = `in ${entry.source} output`;
  } else {
    where = SOURCE_WORDS[channel] ?? `in ${entry.source}`;
  }
  return entry.name && !where.includes(`(${entry.name})`)
    ? `${where}, for ${entry.name}`
    : where;
}

export const FORMAT_NOTICES = {
  image: 'Images passed unmasked. The free plugin does not redact images.',
  'pdf passed, text layer sparse or absent':
    'Scanned PDFs passed unmasked. The free plugin does not redact them.',
};

export function formatNotice(format) {
  return (
    FORMAT_NOTICES[format] ||
    `${format} passed unmasked; review the local source before sharing it.`
  );
}
