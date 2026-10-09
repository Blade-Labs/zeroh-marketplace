// SPDX-License-Identifier: AGPL-3.0-only

import { writePrivateJson } from '../packages/zeroh-disclosure-core/private-fs.js';
import { normaliseStyle, readStyle, styleFilePath } from './statusline.js';

const KEY_ALIASES = Object.freeze({
  color: 'colour',
  'only-when-not-protected': 'onlyWhenNotProtected',
  onlywhennotprotected: 'onlyWhenNotProtected',
  'receipt-format': 'receiptFormat',
  receiptformat: 'receiptFormat',
  'report-format': 'reportFormat',
  reportformat: 'reportFormat',
});

const STYLE_KEYS = new Set([
  'version',
  'fields',
  'separator',
  'labels',
  'emoji',
  'wording',
  'colour',
  'onlyWhenNotProtected',
  'position',
  'receiptFormat',
  'reportFormat',
  'verbosity',
]);

export function styleKey(value) {
  const raw = String(value ?? '').trim();
  const key = KEY_ALIASES[raw] ?? KEY_ALIASES[raw.toLowerCase()] ?? raw;
  return STYLE_KEYS.has(key) ? key : null;
}

function jsonValue(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return value;
  }
}

export function parseStyleValue(key, value) {
  if (value == null) throw new Error(`style ${key} requires a value`);
  if (key === 'fields') {
    const parsed = jsonValue(value);
    return Array.isArray(parsed)
      ? parsed
      : String(value)
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
  }
  if (key === 'labels') {
    const parsed = jsonValue(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('style labels requires a JSON object');
    }
    return parsed;
  }
  if (['emoji', 'colour', 'onlyWhenNotProtected'].includes(key)) {
    if (String(value).toLowerCase() === 'true') return true;
    if (String(value).toLowerCase() === 'false') return false;
    throw new Error(`style ${key} must be true or false`);
  }
  if (key === 'version') {
    if (String(value) === '1') return 1;
    throw new Error('style version must be 1');
  }
  return String(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function writeStyle(keyInput, valueInput, env = process.env) {
  const key = styleKey(keyInput);
  if (!key) throw new Error(`unknown style key: ${keyInput}`);
  const value = parseStyleValue(key, valueInput);
  const current = readStyle(env);
  const candidate = {
    ...current,
    [key]: key === 'labels' ? { ...current.labels, ...value } : value,
  };
  const style = normaliseStyle(candidate);
  if (key === 'labels') {
    for (const [label, text] of Object.entries(value)) {
      if (!Object.hasOwn(style.labels, label) || style.labels[label] !== text) {
        throw new Error(`style labels.${label} is not allowed`);
      }
    }
  } else if (!sameValue(style[key], value)) {
    throw new Error(`style ${key} value is not allowed`);
  }
  const file = styleFilePath(env);
  writePrivateJson(file, style);
  return { file, key, style };
}
