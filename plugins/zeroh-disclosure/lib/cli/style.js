// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync } from 'node:fs';
import {
  BANNER_MODES,
  normalizeBannerMode,
  readBannerMode,
  writeBannerMode,
} from '../banner.js';
import { readStyle, styleFilePath } from '../statusline.js';
import { writeStyle } from '../style.js';
import { print } from './shared.js';

export async function cmdStyle(args) {
  const key = args._[1];
  if (!key || key === 'show') {
    print(
      {
        file: styleFilePath(),
        style: readStyle(),
        banner: readBannerMode(),
      },
      args.json,
      [
        `Presentation style: ${styleFilePath()}${existsSync(styleFilePath()) ? '' : ' (not created yet: the default applies)'}`,
        JSON.stringify(readStyle(), null, 2),
        'While ZeroH is not protected, the state and its fix always show.',
        `Banner: ${readBannerMode()}. ZEROH_BANNER overrides the saved banner mode.`,
      ],
    );
    return;
  }
  if (key === 'banner') {
    const mode = normalizeBannerMode(args._[2]);
    if (!mode)
      throw new Error(`style banner must be ${BANNER_MODES.join(', ')}`);
    const file = writeBannerMode(mode);
    print({ key, value: mode, file }, args.json, [
      `Banner style: ${mode}.`,
      'ZEROH_BANNER overrides the saved banner mode.',
    ]);
    return;
  }
  const { file, style, key: savedKey } = writeStyle(key, args._[2]);
  print({ key: savedKey, value: style[savedKey], file }, args.json, [
    `Presentation style ${savedKey}: ${JSON.stringify(style[savedKey])}.`,
  ]);
}
