// SPDX-License-Identifier: AGPL-3.0-only

import { normalizeBannerMode, writeBannerMode } from '../banner.js';
import { print } from './shared.js';

function bannerModeWords(mode) {
  return {
    big: 'The ZEROH art block every session.',
    mini: 'One line every session (the default).',
    compact: 'One line with the secret count every session.',
    off: 'No banner; warnings still show.',
  }[mode];
}

export async function cmdBanner(args) {
  // `full` (before 1.0.0) is saved as `big`.
  const mode = normalizeBannerMode(args._[1]);
  if (!mode) throw new Error('banner mode must be big, compact, mini, or off');
  const file = writeBannerMode(mode);
  print({ mode, file }, args.json, [
    `Banner mode: ${mode}. ${bannerModeWords(mode)}`,
    'ZEROH_BANNER overrides this setting.',
  ]);
}

// What doctor found, in plain words. A function, not a module constant: the
// command runs before later constants exist.
