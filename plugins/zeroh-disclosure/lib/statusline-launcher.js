// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { writePrivateFile } from '../packages/zeroh-disclosure-core/private-fs.js';

export const SHIELD = '\u{1F6E1}\u{FE0F}';
export const NOT_INSTALLED = `${SHIELD} ZeroH · 🔴 not installed · remove it with /statusline`;
export const SEGMENT_NOT_INSTALLED = `${SHIELD} ZeroH · 🔴 not installed · remove ZeroH from your status line script`;
export const LAUNCHER_DIR = 'bin';
export const LAUNCHER_NAME = 'zeroh-statusline';

export function resolveStatuslineRoot({ fs: f, path: p, env: e, home: h }) {
  const read = (file) => {
    try {
      return JSON.parse(f.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  const config = p.resolve(e.CLAUDE_CONFIG_DIR || p.join(h, '.claude'));
  const cache = p.resolve(
    e.CLAUDE_CODE_PLUGIN_CACHE_DIR || p.join(config, 'plugins', 'cache'),
  );
  const home =
    e.ZEROH_HOME ||
    (process.platform === 'win32'
      ? p.join(e.LOCALAPPDATA || p.join(h, 'AppData', 'Local'), 'ZeroH')
      : p.join(h, '.zeroh'));
  const listed = [];
  for (const [id, entries] of Object.entries(
    read(p.join(config, 'plugins', 'installed_plugins.json'))?.plugins || {},
  )) {
    if (!id.startsWith('zeroh-disclosure@')) continue;
    for (const entry of [].concat(entries))
      if (typeof entry?.installPath === 'string')
        listed.push(p.resolve(entry.installPath));
  }
  const trusted = (root) => {
    if (typeof root !== 'string') return false;
    const resolved = p.resolve(root);
    const relative = p.relative(cache, resolved);
    return (
      listed.includes(resolved) ||
      (!relative.startsWith('..') &&
        !p.isAbsolute(relative) &&
        relative.split(p.sep)[1] === 'zeroh-disclosure') ||
      e.ZEROH_STATUSLINE_DEV === '1'
    );
  };
  return [
    read(p.join(home, 'plugin-root.json'))?.roots?.[config],
    ...listed,
  ].find(
    (root) =>
      trusted(root) && f.existsSync(p.join(root, 'lib', 'statusline.js')),
  );
}

export const ROOT_RESOLVER_SOURCE = resolveStatuslineRoot
  .toString()
  .replace(/\s+/gu, ' ');

const LAUNCHER_MODULE = `#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=(${ROOT_RESOLVER_SOURCE})({fs:{existsSync,readFileSync},path,env:process.env,home:os.homedir()});
if(!root){process.stdout.write(${JSON.stringify(SEGMENT_NOT_INSTALLED)});process.exit(0)}
const mod=await import(pathToFileURL(path.join(root,'lib','statusline.js')));
await mod.statuslineMain(['segment',...process.argv.slice(2)]);
`;

export function writeLaunchers(home) {
  const directory = path.join(path.resolve(home), LAUNCHER_DIR);
  writePrivateFile(
    path.join(directory, `${LAUNCHER_NAME}.mjs`),
    LAUNCHER_MODULE,
    { mode: 0o700 },
  );
  writePrivateFile(
    path.join(directory, LAUNCHER_NAME),
    '#!/bin/sh\nexec node "$(dirname "$0")/zeroh-statusline.mjs" "$@"\n',
    { mode: 0o700 },
  );
  writePrivateFile(
    path.join(directory, `${LAUNCHER_NAME}.cmd`),
    '@node "%~dp0zeroh-statusline.mjs" %*\r\n',
    { mode: 0o600 },
  );
}
