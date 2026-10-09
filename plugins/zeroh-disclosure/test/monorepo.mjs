// SPDX-License-Identifier: AGPL-3.0-only

import { monorepoPackage } from '../scripts/sync-detectors.mjs';

// Use the same detection as the synced-copy integrity check. An installed
// plugin has the vendored runtime, but not the repository's test inputs.
export const MONOREPO = monorepoPackage();

export function monorepoOnly(input) {
  return MONOREPO
    ? false
    : `requires the Blade Labs monorepo: ${input} is absent from the published plugin`;
}
