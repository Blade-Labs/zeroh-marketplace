#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Vendors the validator.js (MIT) modules ZeroH Disclosure uses into
// vendor/validator: the entry validators below and every module they
// require, copied byte for byte from the package's CommonJS build (lib/).
// vendor/validator/package.json (written here) marks the folder CommonJS so
// Node loads the unchanged files inside this ES-module package.
//
//   node scripts/import-validator.mjs           verify vendor/ against SOURCE.json
//   node scripts/import-validator.mjs --check   the same, silent on success
//   node scripts/import-validator.mjs --fetch   download the pinned tarball,
//                                               check its npm integrity and
//                                               refresh vendor/
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNpmTarball, sha256 } from './npm-tarball.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'validator');

export const RELEASE = Object.freeze({
  project: 'validator',
  repository: 'https://github.com/validatorjs/validator.js',
  version: '13.15.35',
  license: 'MIT',
  url: 'https://registry.npmjs.org/validator/-/validator-13.15.35.tgz',
  integrity:
    'sha512-TQ5pAGhd5whStmqWvYF4OjQROlmv9SMFVt37qoCBdqRffuuklWYQlCNnEs2ZaIBD1kZRNnikiZOS1eqgkar0iw==',
});

// The validators lib/pii calls.
export const ENTRY_MODULES = Object.freeze([
  'isEmail',
  'isIBAN',
  'isCreditCard',
  'isIdentityCard',
  'isTaxID',
  'isIP',
  'isPassportNumber',
  'isBtcAddress',
  'isEthereumAddress',
]);

const PACKAGE_JSON = `${JSON.stringify(
  {
    private: true,
    type: 'commonjs',
    description:
      'Unchanged CommonJS modules from validator (see SOURCE.json); this file only tells Node they are CommonJS.',
  },
  null,
  2,
)}\n`;

// Every module the entries require, transitively (`require("./x")`).
export function closure(read, entries = ENTRY_MODULES) {
  const seen = new Set();
  const queue = entries.map((name) => `lib/${name}.js`);
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    const source = read(file);
    if (source === undefined) throw new Error(`${file} not found`);
    seen.add(file);
    for (const m of source.matchAll(/require\("(\.[^"]+)"\)/gu)) {
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), m[1]),
      );
      queue.push(target.endsWith('.js') ? target : `${target}.js`);
    }
    if (/require\("(?!\.)/u.test(source))
      throw new Error(`${file} requires a package outside validator`);
  }
  return [...seen].sort();
}

async function fetchRelease() {
  const tarball = await fetchNpmTarball(RELEASE);
  const read = (file) => tarball.get(`package/${file}`)?.toString('utf8');
  const modules = closure(read);
  rmSync(VENDOR, { recursive: true, force: true });
  const files = {};
  for (const file of [...modules, 'LICENSE']) {
    const data = tarball.get(`package/${file}`);
    const target = path.join(VENDOR, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    files[file] = sha256(data);
  }
  writeFileSync(path.join(VENDOR, 'package.json'), PACKAGE_JSON);
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
  const read = (file) => {
    try {
      return readFileSync(path.join(VENDOR, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  let modules = [];
  try {
    modules = closure(read);
  } catch (error) {
    problems.push(error.message);
  }
  const expected = [...modules, 'LICENSE'].sort();
  if (
    JSON.stringify(Object.keys(record.files ?? {}).sort()) !==
    JSON.stringify(expected)
  )
    problems.push(
      'the vendored module set differs from what the entries require',
    );
  for (const file of expected) {
    const data = read(file);
    if (data === undefined) problems.push(`${file} is missing`);
    else if (record.files?.[file] !== sha256(Buffer.from(data, 'utf8')))
      problems.push(`${file} was modified`);
  }
  if (read('package.json') !== PACKAGE_JSON)
    problems.push('package.json differs');
  return problems;
}

async function main(argv = process.argv.slice(2)) {
  const known = new Set(['--check', '--fetch']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error(`unknown option: ${unknown.join(', ')}`);
  if (argv.includes('--fetch')) await fetchRelease();
  const problems = verifyVendor();
  if (problems.length) {
    process.stderr.write(`vendor/validator: ${problems.join('; ')}\n`);
    process.exitCode = 1;
    return;
  }
  if (!argv.includes('--check'))
    process.stdout.write(`vendor/validator ${RELEASE.version} verified.\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
