#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copies the shared detection engine, @bladelabs/sensitive-data-detectors
// (packages/sensitive-data-detectors in the Blade Labs monorepo, MIT), into
// vendor/sensitive-data-detectors/, so the plugin keeps running with no
// install. The copy holds the package's runtime files (src/, vendor/,
// LICENSE, NOTICE), its import scripts (scripts/: the preferred form for
// changing the generated rules, and the --check that proves the vendored
// files are the pinned ones), the package README as PACKAGE-README.md, and two
// generated files: README.md (what this folder is) and SOURCE.json (package
// version, monorepo commit and each file's SHA-256).
//
//   node scripts/sync-detectors.mjs           write the copy
//   node scripts/sync-detectors.mjs --check   fail when the copy differs
//
// Outside the monorepo (the public marketplace tree, an installed plugin)
// the package is not there; both modes then say so and exit 0.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_PATH = 'packages/sensitive-data-detectors';
export const TARGET = path.join(PLUGIN, 'vendor', 'sensitive-data-detectors');

// plugins/zeroh-disclosure → apps/zeroh-marketplace → the monorepo root.
export function monorepoPackage(plugin = PLUGIN) {
  const root = path.resolve(plugin, '..', '..', '..', '..');
  const dir = path.join(root, PACKAGE_PATH);
  return existsSync(path.join(dir, 'package.json')) &&
    existsSync(path.join(dir, 'src', 'index.js'))
    ? { root, dir }
    : null;
}

// The package files the copy holds, and what the copy calls them.
const COPIED_ROOTS = ['scripts', 'src', 'vendor'];
const COPIED_FILES = [
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['README.md', 'PACKAGE-README.md'],
];

function walk(dir, relative = '') {
  const out = [];
  for (const name of readdirSync(path.join(dir, relative)).sort()) {
    const child = relative ? `${relative}/${name}` : name;
    if (statSync(path.join(dir, child)).isDirectory())
      out.push(...walk(dir, child));
    else out.push(child);
  }
  return out;
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

const DIRTY = '-uncommitted';

// The last monorepo commit that changed the package, with DIRTY appended when
// the package has uncommitted changes; null outside git.
function packageCommit(root) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    const commit = git(['log', '-1', '--format=%H', '--', PACKAGE_PATH]);
    if (!commit) return null;
    const dirty = git(['status', '--porcelain', '--', PACKAGE_PATH]);
    return dirty ? `${commit}${DIRTY}` : commit;
  } catch {
    return null;
  }
}

function readme({ name, version, commit }) {
  return `# sensitive-data-detectors (synced copy)

**Do not edit here.** This folder is a copy of the ${name} package from the Blade
Labs monorepo (\`${PACKAGE_PATH}\`). Changes go to the package there; the plugin's
\`scripts/sync-detectors.mjs\` then copies them here, and the plugin's tests fail
when this copy and the package differ.

It is the detection engine ZeroH Disclosure runs: the rules that find API keys,
tokens, passwords, private keys and 33 kinds of personal data in text, on your
machine, with no network calls. The plugin adds its own parts on top (known
values from \`.env\` and credential files, placeholder tokens, the vault,
masking and the hooks) in \`lib/\`.

- **License:** this folder is MIT-licensed ([LICENSE](LICENSE)), while the rest
  of ZeroH Disclosure is AGPL-3.0-only. The vendored upstream code under
  [vendor/](vendor) keeps its own licences.
- **Version:** ${name} ${version}, from monorepo commit
  \`${commit ?? 'unknown'}\`. [SOURCE.json](SOURCE.json) records the SHA-256 of
  every file in this copy.
- **Upstream credits** ([NOTICE](NOTICE)): gitleaks (MIT), validator.js (MIT),
  libphonenumber-js (MIT, with Google libphonenumber metadata under
  Apache-2.0), i18n-iso-countries (MIT), Saudi-ID-Validator (MIT), the IANA
  top-level domain list, Microsoft Presidio (MIT) and the rules reused from
  Blade Labs' ai-ui-chat detector.

[PACKAGE-README.md](PACKAGE-README.md) is the package's own README: the API,
every detected kind and how the vendored code is updated. \`scripts/\` holds
the package's import scripts; \`node scripts/import-validator.mjs --check\`
(and the others) verify the vendored files here against their pins.
`;
}

// Every file of the copy, as { relative path: Buffer }.
export function buildCopy(pkg, { commit } = {}) {
  const manifest = JSON.parse(
    readFileSync(path.join(pkg.dir, 'package.json'), 'utf8'),
  );
  const files = new Map();
  for (const root of COPIED_ROOTS)
    for (const file of walk(pkg.dir, root))
      files.set(file, readFileSync(path.join(pkg.dir, file)));
  for (const [from, to] of COPIED_FILES)
    files.set(to, readFileSync(path.join(pkg.dir, from)));
  const source = {
    package: manifest.name,
    version: manifest.version,
    license: manifest.license,
    monorepo: 'https://github.com/Blade-Labs/zeroh',
    path: PACKAGE_PATH,
    commit: commit ?? null,
    files: Object.fromEntries(
      [...files.keys()].sort().map((file) => [file, sha256(files.get(file))]),
    ),
  };
  files.set(
    'README.md',
    Buffer.from(
      readme({ name: manifest.name, version: manifest.version, commit }),
    ),
  );
  files.set('SOURCE.json', Buffer.from(`${JSON.stringify(source, null, 2)}\n`));
  return files;
}

// Differences between the copy on disk and `files`: missing, changed, extra.
export function compareCopy(files, target = TARGET) {
  const problems = [];
  const present = existsSync(target) ? walk(target) : [];
  for (const [file, data] of files) {
    const at = path.join(target, file);
    if (!existsSync(at)) problems.push(`missing ${file}`);
    else if (!readFileSync(at).equals(data)) problems.push(`differs ${file}`);
  }
  for (const file of present)
    if (!files.has(file)) problems.push(`extra ${file}`);
  return problems;
}

function recordedCommit(target = TARGET) {
  try {
    return JSON.parse(readFileSync(path.join(target, 'SOURCE.json'), 'utf8'))
      .commit;
  } catch {
    return undefined;
  }
}

export function run(argv = process.argv.slice(2), { plugin = PLUGIN } = {}) {
  const check = argv.includes('--check');
  const target = path.join(plugin, 'vendor', 'sensitive-data-detectors');
  const pkg = monorepoPackage(plugin);
  if (!pkg) {
    process.stdout.write(
      `sync-detectors: skipped, ${PACKAGE_PATH} is not in this tree (the copy in vendor/sensitive-data-detectors is used as it is).\n`,
    );
    return 0;
  }
  if (check) {
    // The files must match the package; the commit is the one recorded at
    // the last sync (a later commit that leaves the package alone keeps it).
    // A copy synced from uncommitted package changes is not final: commit
    // the package, then sync again.
    const commit = recordedCommit(target) ?? null;
    const problems = compareCopy(buildCopy(pkg, { commit }), target);
    if (typeof commit === 'string' && commit.endsWith(DIRTY))
      problems.push(
        'synced from uncommitted package changes; commit the package, then sync again',
      );
    if (problems.length) {
      process.stderr.write(
        `vendor/sensitive-data-detectors differs from ${PACKAGE_PATH}; run pnpm nx run zeroh-marketplace:sync-detectors:\n${problems
          .map((problem) => `  - ${problem}`)
          .join('\n')}\n`,
      );
      return 1;
    }
    process.stdout.write('sync-detectors: the copy matches the package.\n');
    return 0;
  }
  const files = buildCopy(pkg, { commit: packageCommit(pkg.root) });
  rmSync(target, { recursive: true, force: true });
  for (const [file, data] of files) {
    const at = path.join(target, file);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, data);
  }
  process.stdout.write(
    `sync-detectors: wrote ${files.size} files to vendor/sensitive-data-detectors.\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = run();
}
