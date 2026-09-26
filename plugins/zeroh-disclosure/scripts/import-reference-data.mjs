#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Vendors the small reference sources lib/pii uses besides validator.js and
// libphonenumber-js, each pinned and kept unchanged:
//
//   vendor/i18n-iso-countries  codes.json (ISO 3166-1 alpha-2, alpha-3 and
//                              numeric codes) from the i18n-iso-countries npm
//                              package: the nationality code in a Qatar ID.
//   vendor/saudi-id-validator  validateSAID.js from alhazmy13/Saudi-ID-Validator
//                              at a pinned commit: the Saudi national ID and
//                              iqama check digit.
//
//   node scripts/import-reference-data.mjs           verify vendor/ against SOURCE.json
//   node scripts/import-reference-data.mjs --check   the same, silent on success
//   node scripts/import-reference-data.mjs --fetch   download the pinned files,
//                                                    check their digests and
//                                                    refresh vendor/
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNpmTarball, sha256 } from './npm-tarball.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SAUDI_COMMIT = '069fb64846f32f41082bcc0e24ed96b0a5817fe2';

export const SOURCES = Object.freeze([
  {
    dir: 'i18n-iso-countries',
    release: {
      project: 'i18n-iso-countries',
      repository: 'https://github.com/michaelwittig/node-i18n-iso-countries',
      version: '7.14.0',
      license: 'MIT',
      url: 'https://registry.npmjs.org/i18n-iso-countries/-/i18n-iso-countries-7.14.0.tgz',
      integrity:
        'sha512-nXHJZYtNrfsi1UQbyRqm3Gou431elgLjKl//CYlnBGt5aTWdRPH1PiS2T/p/n8Q8LnqYqzQJik3Q7mkwvLokeg==',
    },
    // Tarball path → vendored file name.
    files: { 'package/codes.json': 'codes.json', 'package/LICENSE': 'LICENSE' },
  },
  {
    dir: 'saudi-id-validator',
    release: {
      project: 'alhazmy13/Saudi-ID-Validator',
      repository: 'https://github.com/alhazmy13/Saudi-ID-Validator',
      version: SAUDI_COMMIT,
      license: 'MIT',
    },
    // Raw file URL at the pinned commit → vendored file name and digest.
    raw: {
      'validateSAID.js': {
        url: `https://raw.githubusercontent.com/alhazmy13/Saudi-ID-Validator/${SAUDI_COMMIT}/validateSAID.js`,
        sha256:
          '1203d245e233a37dacba78be06fc4f37b61b1109759c6cf73e43a41122304ff6',
      },
      LICENSE: {
        url: `https://raw.githubusercontent.com/alhazmy13/Saudi-ID-Validator/${SAUDI_COMMIT}/LICENSE`,
        sha256:
          'b806a079ff54e77e51da07d6a4bfd1f158c8fcc677939143a5883090459da0a9',
      },
    },
  },
]);

async function download(url, pin) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url}: download failed (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== pin)
    throw new Error(`${url}: digest ${sha256(data)} does not match the pin`);
  return data;
}

async function fetchSource(source) {
  const vendor = path.join(ROOT, 'vendor', source.dir);
  mkdirSync(vendor, { recursive: true });
  const files = {};
  if (source.files) {
    const tarball = await fetchNpmTarball(source.release);
    for (const [from, to] of Object.entries(source.files)) {
      if (!tarball.has(from)) throw new Error(`${from} is missing`);
      writeFileSync(path.join(vendor, to), tarball.get(from));
      files[to] = { from, sha256: sha256(tarball.get(from)) };
    }
  } else {
    for (const [to, { url, sha256: pin }] of Object.entries(source.raw)) {
      const data = await download(url, pin);
      writeFileSync(path.join(vendor, to), data);
      files[to] = { from: url, sha256: pin };
    }
  }
  writeFileSync(
    path.join(vendor, 'SOURCE.json'),
    `${JSON.stringify({ ...source.release, files }, null, 2)}\n`,
  );
}

export function verifySource(source) {
  const vendor = path.join(ROOT, 'vendor', source.dir);
  let record;
  try {
    record = JSON.parse(readFileSync(path.join(vendor, 'SOURCE.json'), 'utf8'));
  } catch {
    return [`${source.dir}: SOURCE.json is missing`];
  }
  const problems = [];
  if (record.version !== source.release.version)
    problems.push(`${source.dir}: SOURCE.json names a different release`);
  const names = Object.keys(source.files ? {} : source.raw).concat(
    Object.values(source.files ?? {}),
  );
  for (const name of names) {
    let digest = null;
    try {
      digest = sha256(readFileSync(path.join(vendor, name)));
    } catch {
      problems.push(`${source.dir}/${name} is missing`);
      continue;
    }
    const pinned = source.raw?.[name]?.sha256 ?? record.files?.[name]?.sha256;
    if (record.files?.[name]?.sha256 !== digest || pinned !== digest)
      problems.push(`${source.dir}/${name} was modified`);
  }
  return problems;
}

async function main(argv = process.argv.slice(2)) {
  const known = new Set(['--check', '--fetch']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);
  if (argv.includes('--fetch'))
    for (const source of SOURCES) await fetchSource(source);
  const problems = SOURCES.flatMap(verifySource);
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  if (!argv.includes('--check'))
    process.stdout.write(
      `${SOURCES.map((s) => `vendor/${s.dir}`).join(', ')} verified.\n`,
    );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
