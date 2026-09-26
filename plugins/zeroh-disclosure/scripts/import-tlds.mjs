#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Regenerates lib/rules/tlds.generated.json from the vendored IANA top-level
// domain list (vendor/iana).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'vendor', 'iana', 'tlds-alpha-by-domain.txt');
const OUTPUT = path.join(ROOT, 'lib', 'rules', 'tlds.generated.json');

export function parseTlds(text) {
  const lines = String(text).trim().split(/\r?\n/u);
  const header = lines
    .shift()
    ?.match(/^# Version (\d+), Last Updated (.+ UTC)$/u);
  if (!header) throw new Error('missing IANA root-zone version/date header');

  const tlds = lines.map((line) => line.trim().toLowerCase());
  if (
    !tlds.length ||
    tlds.some((tld) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(tld)) ||
    new Set(tlds).size !== tlds.length
  ) {
    throw new Error('invalid or duplicate TLD in IANA root-zone list');
  }

  return {
    source: 'IANA Root Zone Database',
    url: 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt',
    version: header[1],
    lastUpdated: header[2],
    tlds,
  };
}

export function renderTlds(text = readFileSync(SOURCE, 'utf8')) {
  return `${JSON.stringify(parseTlds(text), null, 2)}\n`;
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const unknown = argv.filter((arg) => arg !== '--check');
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);

  const rendered = renderTlds();
  if (check) {
    let current = '';
    try {
      current = readFileSync(OUTPUT, 'utf8');
    } catch {
      // A missing generated file is stale too.
    }
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
        'tlds.generated.json is stale; run node scripts/import-tlds.mjs\n',
      );
      process.exitCode = 1;
    }
    return;
  }

  writeFileSync(OUTPUT, rendered);
  process.stdout.write(
    `Imported ${JSON.parse(rendered).tlds.length} IANA top-level domains.\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
