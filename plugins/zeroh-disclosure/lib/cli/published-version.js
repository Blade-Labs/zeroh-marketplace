// SPDX-License-Identifier: AGPL-3.0-only

// One public, constant request: no installed version, settings, session,
// project path, credentials or other user data is sent to the marketplace.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PUBLIC_MARKETPLACE_REPO,
  PUBLIC_PLUGIN_ID,
} from '../../packages/zeroh-disclosure-core/product.js';
import { PLUGIN_ROOT } from './shared.js';

export const PUBLISHED_PLUGIN_MANIFEST = `https://raw.githubusercontent.com/${PUBLIC_MARKETPLACE_REPO}/main/plugins/zeroh-disclosure/.claude-plugin/plugin.json`;

function parsedVersion(value) {
  if (typeof value !== 'string') return null;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z.-]+))?(?:\+[\da-z.-]+)?$/iu.exec(
      value,
    );
  if (!match) return null;
  const prerelease = match[4]?.split('.') ?? [];
  if (
    prerelease.some(
      (part) =>
        !part ||
        (/^\d+$/u.test(part) && part.length > 1 && part.startsWith('0')),
    )
  )
    return null;
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

export function comparePluginVersions(left, right) {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return !a.prerelease.length && !b.prerelease.length
      ? 0
      : !a.prerelease.length
        ? 1
        : -1;
  }
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^\d+$/u.test(x);
    const numericY = /^\d+$/u.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export async function checkPublishedVersion({
  pluginRoot = PLUGIN_ROOT,
  fetchImpl = globalThis.fetch,
  env = process.env,
  timeoutMs = 1500,
} = {}) {
  let installed = null;
  try {
    installed = JSON.parse(
      await readFile(
        path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    ).version;
    if (!parsedVersion(installed)) throw new Error('invalid installed version');
    if (env.ZEROH_PUBLISHED_VERSION_CHECK === 'off')
      return { state: 'unchecked', installed };
    const response = await fetchImpl(PUBLISHED_PLUGIN_MANIFEST, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('marketplace unavailable');
    const manifest = await response.json();
    if (manifest.name !== 'zeroh-disclosure')
      throw new Error('unexpected manifest');
    const published = manifest.version;
    const compared = comparePluginVersions(published, installed);
    if (compared === null) throw new Error('invalid published version');
    return { state: compared > 0 ? 'newer' : 'current', installed, published };
  } catch {
    // Do not echo URLs, remote content or network errors into user output.
    return { state: 'unchecked', installed };
  }
}

export function publishedVersionLine(result) {
  if (result.state === 'newer') {
    return `Updates: newer version available (${result.published}; installed ${result.installed}). Run claude plugin marketplace update zeroh, then claude plugin update ${PUBLIC_PLUGIN_ID}; restart Claude Code to use it.`;
  }
  if (result.state === 'current') {
    return `Updates: no newer published version (installed ${result.installed}; marketplace ${result.published}).`;
  }
  return 'Updates: could not check the published version (offline or marketplace unavailable).';
}
