#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// The feature list (docs/features.json) and its public table
// (docs/features.md): one row per user-visible feature, with its status on
// every platform ZeroH Disclosure targets. docs/features.json is the source;
// the table between the markers in docs/features.md is generated from it.
//
//   node scripts/features.mjs --write   regenerate the table
//   node scripts/features.mjs --check   fail when the table, the JSON or an
//                                       evidence path is out of date
//
// test/features.test.mjs runs the check, and the release pipeline
// (apps/zeroh-marketplace/release/publish-public.mjs) refuses a release whose
// feature list is stale. Node built-ins only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
export const PLATFORMS = Object.freeze(['claude-code', 'codex', 'opencode']);
export const PLATFORM_NAMES = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
});
export const STATUSES = Object.freeze([
  'shipped',
  'partial',
  'planned',
  'not possible',
  'unknown',
]);
export const TABLE_START =
  '<!-- features:start (generated from features.json by scripts/features.mjs) -->';
export const TABLE_END = '<!-- features:end -->';
const ID_RE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/u;

export function featuresPaths(root = PLUGIN_ROOT) {
  return {
    json: path.join(root, 'docs', 'features.json'),
    markdown: path.join(root, 'docs', 'features.md'),
  };
}

export function loadFeatures(root = PLUGIN_ROOT) {
  return JSON.parse(readFileSync(featuresPaths(root).json, 'utf8'));
}

// Every problem with the feature list, as plain sentences (none: []).
export function validateFeatures(data, { root = PLUGIN_ROOT } = {}) {
  const errors = [];
  if (!data || typeof data !== 'object')
    return ['features.json is not an object'];
  if (typeof data.version !== 'string' || !data.version) {
    errors.push('features.json has no version');
  }
  if (JSON.stringify(data.platforms) !== JSON.stringify(PLATFORMS)) {
    errors.push(`features.json platforms must be ${PLATFORMS.join(', ')}`);
  }
  if (!Array.isArray(data.features) || data.features.length === 0) {
    errors.push('features.json lists no features');
    return errors;
  }
  const seen = new Set();
  for (const feature of data.features) {
    const id = feature?.id;
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push(`invalid feature id ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) errors.push(`${id} is listed twice`);
    seen.add(id);
    for (const field of ['description', 'claude_code']) {
      if (typeof feature[field] !== 'string' || !feature[field].trim()) {
        errors.push(`${id} has no ${field}`);
      }
    }
    if (!Array.isArray(feature.evidence) || feature.evidence.length === 0) {
      errors.push(`${id} names no code or test path`);
    } else {
      for (const evidence of feature.evidence) {
        if (
          typeof evidence !== 'string' ||
          path.isAbsolute(evidence) ||
          evidence.split(/[\\/]/u).includes('..') ||
          !existsSync(path.join(root, evidence))
        ) {
          errors.push(`${id}: ${evidence} does not exist`);
        }
      }
    }
    for (const platform of PLATFORMS) {
      const entry = feature.platforms?.[platform];
      if (!entry || !STATUSES.includes(entry.status)) {
        errors.push(
          `${id}: ${platform} needs a status (${STATUSES.join(', ')})`,
        );
        continue;
      }
      if (typeof entry.note !== 'string')
        errors.push(`${id}: ${platform} note must be a string`);
      if (entry.status === 'not possible' && !entry.note?.trim()) {
        errors.push(`${id}: ${platform} is "not possible" without a reason`);
      }
    }
    for (const platform of Object.keys(feature.platforms ?? {})) {
      if (!PLATFORMS.includes(platform))
        errors.push(`${id}: unknown platform ${platform}`);
    }
  }
  return errors;
}

function cell(text) {
  return String(text ?? '')
    .replace(/\|/gu, '\\|')
    .replace(/\s*\n\s*/gu, ' ');
}

function statusCell({ status, note }) {
  return note ? `${status}: ${cell(note)}` : status;
}

export function renderFeaturesTable(data) {
  const header = [
    'ID',
    'Feature',
    'In Claude Code',
    ...PLATFORMS.map((platform) => PLATFORM_NAMES[platform]),
  ];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  for (const feature of data.features) {
    lines.push(
      `| \`${feature.id}\` | ${cell(feature.description)} | ${cell(feature.claude_code)} | ${PLATFORMS.map((platform) => statusCell(feature.platforms[platform])).join(' | ')} |`,
    );
  }
  return lines.join('\n');
}

// The generated block of docs/features.md, or null without the markers.
export function tableBlock(markdown) {
  const start = markdown.indexOf(TABLE_START);
  const end = markdown.indexOf(TABLE_END);
  if (start < 0 || end < start) return null;
  return markdown.slice(start + TABLE_START.length, end).trim();
}

export function withTable(markdown, data) {
  const start = markdown.indexOf(TABLE_START);
  const end = markdown.indexOf(TABLE_END);
  if (start < 0 || end < start) {
    throw new Error(
      `docs/features.md needs the ${TABLE_START} and ${TABLE_END} markers`,
    );
  }
  return `${markdown.slice(0, start + TABLE_START.length)}\n\n${renderFeaturesTable(data)}\n\n${markdown.slice(end)}`;
}

// Normalises a Markdown table for comparison, so a formatter's column
// padding does not count as a difference.
function normaliseTable(text) {
  return String(text)
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/\s*\|\s*/gu, '|')
        .replace(/\|-{3,}(?=\|)/gu, '|---'),
    )
    .filter(Boolean)
    .join('\n');
}

// Problems with the feature list and its table (none: []).
export function checkFeatures({ root = PLUGIN_ROOT, version = null } = {}) {
  const paths = featuresPaths(root);
  let data;
  try {
    data = loadFeatures(root);
  } catch (error) {
    return [`docs/features.json can't be read: ${error.message}`];
  }
  const errors = validateFeatures(data, { root });
  if (version && data.version !== version) {
    errors.push(
      `docs/features.json is for ${data.version}, not ${version}: update it for this release`,
    );
  }
  let markdown = '';
  try {
    markdown = readFileSync(paths.markdown, 'utf8');
  } catch (error) {
    errors.push(`docs/features.md can't be read: ${error.message}`);
    return errors;
  }
  const block = tableBlock(markdown);
  if (block === null) {
    errors.push('docs/features.md has no generated table markers');
  } else if (
    normaliseTable(block) !== normaliseTable(renderFeaturesTable(data))
  ) {
    errors.push(
      'docs/features.md is out of date: run node scripts/features.mjs --write',
    );
  }
  return errors;
}

// The "Features:" line of a CHANGELOG section: `Features: +statusline,
// ~pass.uncertain-notice, -old.id` (+ added, ~ changed, - removed).
export function parseFeaturesLine(section) {
  // The paragraph that starts with "Features:" (it may wrap), without a
  // trailing "(see …)" remark.
  const match = /^Features:[ \t]*([\s\S]*?)(?:\n[ \t]*\n|$(?![\s\S]))/mu.exec(
    String(section ?? ''),
  );
  if (!match) return null;
  return match[1]
    .replace(/\([^)]*(?:\([^)]*\)[^)]*)*\)\s*$/u, '')
    .split(/[,\s]+/u)
    .map((part) => part.trim().replace(/^`|`$/gu, ''))
    .filter(Boolean)
    .map((part) => {
      const kind = { '+': 'added', '~': 'changed', '-': 'removed' }[part[0]];
      const id = (kind ? part.slice(1) : part).replace(/^`|`$/gu, '').trim();
      return { kind: kind ?? 'changed', id };
    });
}

// IDs whose Claude Code status differs between two feature lists (added ones
// included; removed ones too).
export function changedClaudeCodeIds(previous, current) {
  const before = new Map(
    (previous?.features ?? []).map((feature) => [
      feature.id,
      feature.platforms?.['claude-code']?.status,
    ]),
  );
  const after = new Map(
    (current?.features ?? []).map((feature) => [
      feature.id,
      feature.platforms?.['claude-code']?.status,
    ]),
  );
  const changed = [];
  for (const [id, status] of after) {
    if (before.get(id) !== status) changed.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) changed.push(id);
  return changed;
}

// The "Feature parity" table for release notes: the features `ids` names.
export function parityTable(data, ids) {
  const wanted = new Set(ids);
  const rows = data.features.filter((feature) => wanted.has(feature.id));
  if (!rows.length) return '';
  const header = [
    'Feature',
    ...PLATFORMS.map((platform) => PLATFORM_NAMES[platform]),
  ];
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (feature) =>
        `| \`${feature.id}\` | ${PLATFORMS.map((platform) => feature.platforms[platform].status).join(' | ')} |`,
    ),
  ].join('\n');
}

function main(argv) {
  if (argv.includes('--write')) {
    const data = loadFeatures();
    const errors = validateFeatures(data);
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
      return;
    }
    const file = featuresPaths().markdown;
    writeFileSync(file, withTable(readFileSync(file, 'utf8'), data));
    console.log(`Wrote the table in ${path.relative(process.cwd(), file)}`);
    return;
  }
  const errors = checkFeatures();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('docs/features.json and docs/features.md are in sync.');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
