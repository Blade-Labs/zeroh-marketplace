#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Vendors a pinned build of libphonenumber-js (MIT; phone metadata from
// Google's libphonenumber, Apache-2.0) into vendor/libphonenumber-js.
//
// The shipped file is the package's own prebuilt `bundle/libphonenumber-max.js`
// (the "max" metadata, which validates the national number digits, not just
// their length), byte for byte, saved with a .cjs extension so Node loads the
// UMD bundle as CommonJS inside this ES-module package.
//
//   node scripts/import-libphonenumber.mjs           verify vendor/ against SOURCE.json
//   node scripts/import-libphonenumber.mjs --check   the same, silent on success
//   node scripts/import-libphonenumber.mjs --fetch   download the pinned tarball,
//                                                    check its npm integrity and
//                                                    refresh vendor/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNpmTarball, sha256 } from './npm-tarball.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'libphonenumber-js');

export const RELEASE = Object.freeze({
  project: 'libphonenumber-js',
  repository: 'https://gitlab.com/catamphetamine/libphonenumber-js',
  version: '1.13.14',
  license: 'MIT (code); Apache-2.0 (Google libphonenumber metadata)',
  url: 'https://registry.npmjs.org/libphonenumber-js/-/libphonenumber-js-1.13.14.tgz',
  integrity:
    'sha512-llihgCcx0BFLksecLP+x1J+6JDE1GsXS1RN/LoPF6qcwpeQcnjj0lcvZxY8AzbEpYwyZWPZW/nDuqkqzm3amiw==',
});

// Tarball path → vendored file name.
export const FILES = Object.freeze({
  'package/bundle/libphonenumber-max.js': 'libphonenumber-max.cjs',
  'package/LICENSE': 'LICENSE',
  'package/LICENSE.Apache': 'LICENSE.Apache',
});

async function fetchRelease() {
  const tarball = await fetchNpmTarball(RELEASE);
  mkdirSync(VENDOR, { recursive: true });
  const files = {};
  for (const [from, to] of Object.entries(FILES)) {
    if (!tarball.has(from))
      throw new Error(`${from} is missing from the tarball`);
    writeFileSync(path.join(VENDOR, to), tarball.get(from));
    files[to] = { from, sha256: sha256(tarball.get(from)) };
  }
  writeFileSync(
    path.join(VENDOR, 'SOURCE.json'),
    `${JSON.stringify({ ...RELEASE, files }, null, 2)}\n`,
  );
}

export function verifyVendor() {
  const problems = [];
  let record;
  try {
    record = JSON.parse(readFileSync(path.join(VENDOR, 'SOURCE.json'), 'utf8'));
  } catch {
    return ['SOURCE.json is missing'];
  }
  if (
    record.version !== RELEASE.version ||
    record.integrity !== RELEASE.integrity
  )
    problems.push('SOURCE.json names a different release');
  for (const to of Object.values(FILES)) {
    let digest = null;
    try {
      digest = sha256(readFileSync(path.join(VENDOR, to)));
    } catch {
      problems.push(`${to} is missing`);
      continue;
    }
    if (record.files?.[to]?.sha256 !== digest)
      problems.push(`${to} was modified`);
  }
  return problems;
}

async function main(argv = process.argv.slice(2)) {
  const known = new Set(['--check', '--fetch']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);
  if (argv.includes('--fetch')) await fetchRelease();
  const problems = verifyVendor();
  if (problems.length) {
    process.stderr.write(`vendor/libphonenumber-js: ${problems.join('; ')}\n`);
    process.exitCode = 1;
    return;
  }
  if (!argv.includes('--check'))
    process.stdout.write(
      `vendor/libphonenumber-js ${RELEASE.version} verified.\n`,
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
