// SPDX-License-Identifier: AGPL-3.0-only

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireUserAuthority } from '../../packages/zeroh-disclosure-core/user-authority.js';

export const PLUGIN_ROOT = path.dirname(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
);

// True when the user asked for this very command; otherwise prints why
// nothing changed.
export async function authorized(details = []) {
  const result = await requireUserAuthority({
    argv: process.argv.slice(2),
    details,
  });
  if (!result.ok) console.log(result.message);
  return result.ok;
}

export function print(obj, asJson, lines) {
  if (asJson) {
    console.log(JSON.stringify(obj, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}
