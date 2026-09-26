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

export function observationFrom(entry) {
  return `${entry.channel} · ${entry.source}`;
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
