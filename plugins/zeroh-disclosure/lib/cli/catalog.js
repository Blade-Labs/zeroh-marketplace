// SPDX-License-Identifier: AGPL-3.0-only

import { detectionCatalog } from '../../packages/zeroh-disclosure-core/detector.js';
import { print } from './shared.js';

export function cmdCatalog(args) {
  const catalog = detectionCatalog();
  const personal = Object.fromEntries(
    catalog.personal_data_kinds.map(({ type, label }) => [type, label]),
  );
  print(catalog, args.json, [
    `Provider key formats: ${catalog.provider_formats} (${catalog.source}), from ${catalog.providers.length} providers:`,
    ...catalog.providers.map(
      ({ name, rules }) => `  ${name} (${rules.length}): ${rules.join(', ')}`,
    ),
    `Named by provider on screen (${catalog.named_prefixes.length} public prefixes): ${catalog.named_prefixes
      .map(({ prefix, label }) => `${prefix} ${label}`)
      .join('; ')}`,
    'Also:',
    ...catalog.also.map((line) => `  ${line}`),
    `Personal data: ${catalog.personal_data.map((type) => personal[type] ?? type).join(', ')}`,
    `  validated by ${catalog.personal_data_sources.join(', ')}`,
  ]);
}
