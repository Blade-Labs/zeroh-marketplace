// SPDX-License-Identifier: AGPL-3.0-only

import { readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registeredProjectRoots } from '../../packages/zeroh-disclosure-core/report.js';

export async function legacyProjectFolders() {
  const { scanLegacyFolder } =
    await import('../../packages/zeroh-disclosure-core/receipt-keep.js');
  const roots = await registeredProjectRoots().catch(() => []);
  return roots
    .map((root) => scanLegacyFolder(path.join(root, '.zeroh')))
    .filter(Boolean);
}

// doctor --fix: never a receipt or a key. Only a folder with no file in its
// sessions goes; the others are reported (uninstall keeps their receipts).
export async function removeLegacyProjectFolders() {
  const removed = [];
  const held = [];
  for (const scan of await legacyProjectFolders()) {
    if (scan.files > 0) {
      held.push(scan);
      continue;
    }
    try {
      rmSync(scan.dir, { recursive: true, force: true });
      removed.push(scan.dir);
    } catch {
      // Left for uninstall or the next doctor --fix.
    }
  }
  return { removed, held };
}

// Why `dir` is not a folder uninstall may delete, or null: it is (or holds)
// the user's home, a system folder or a filesystem root, or it has none of
// the files ZeroH keeps.
export function notAZerohHome(dir) {
  const env = process.env;
  const guarded = [
    os.homedir(),
    env.HOME,
    env.USERPROFILE,
    env.LOCALAPPDATA,
    env.APPDATA,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    os.tmpdir(),
  ]
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const same = (a, b) =>
    process.platform === 'win32'
      ? a.toLowerCase() === b.toLowerCase()
      : a === b;
  const within = (child, parent) => {
    const relative = path.relative(parent, child);
    return (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    );
  };
  if (path.dirname(dir) === dir) return 'is a filesystem root';
  if (guarded.some((entry) => same(entry, dir) || within(entry, dir))) {
    return 'is your home or a system folder (or holds one)';
  }
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    return error.code === 'ENOENT' ? null : `can't be read (${error.code})`;
  }
  const markers = [
    'vault.key',
    'vault',
    'proxy',
    'projects.json',
    'projects',
    'session-keys',
    'statusline.json',
    'first-run.json',
    'plugin-root.json',
    'uninstalled',
  ];
  if (names.length && !names.some((name) => markers.includes(name))) {
    return 'holds none of the files ZeroH Disclosure keeps';
  }
  return null;
}
