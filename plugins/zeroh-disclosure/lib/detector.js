// SPDX-License-Identifier: AGPL-3.0-only

// ZeroH Disclosure's detector: the shared detection engine plus the plugin's
// own parts. The engine (secrets, personal data, entropy warnings, the
// catalog) is vendor/sensitive-data-detectors, an MIT-licensed copy of
// @bladelabs/sensitive-data-detectors that scripts/sync-detectors.mjs keeps
// equal to the package in the Blade Labs monorepo; do not change it here.
// This file adds what only the plugin knows:
//   - its own tokens ([TYPE-xxxxxx]) are never detected again;
//   - ZEROH_PHONE_REGION sets the region for national-format phone numbers
//     (`none` turns them off), before the locale;
//   - the manifest keeps the plugin's detector id, and the catalog lists the
//     exact-match values from .env and credential files (lib/secrets.js).
// Three profiles: prompt (secrets and personal data, for what the user
// types), tool (the same without national-format phone numbers, for tool
// output) and secrets (secrets only).

import * as engine from '../vendor/sensitive-data-detectors/src/index.js';
import { TOKEN_RE } from './token-pattern.js';

export { TOKEN_RE };
export const {
  GITLEAKS_CATALOG,
  looksLikeCodeValue,
  nameType,
  PERSONAL_DATA_KINDS,
  shannonEntropy,
  TOP_LEVEL_DOMAINS,
} = engine;

const DETECTOR_ID = 'zeroh-disclosure-detector-v4';
const KNOWN_VALUES =
  'values from .env files and credential files in the project (exact match, also when encoded)';

// The spans of ZeroH's own tokens in `text`.
function tokenSpans(text) {
  const spans = [];
  TOKEN_RE.lastIndex = 0;
  for (const m of text.matchAll(TOKEN_RE))
    spans.push([m.index, m.index + m[0].length]);
  return spans;
}

// The default region for national-format phone numbers, or null:
// ZEROH_PHONE_REGION (a two-letter region, or `none`), else the locale's
// territory (LC_ALL, LC_TELEPHONE, LANG — `en_GB.UTF-8` → GB).
export function phoneRegion(env = process.env) {
  const explicit = String(env.ZEROH_PHONE_REGION ?? '').trim();
  if (explicit) return engine.supportedRegion(explicit);
  return engine.phoneRegion(env);
}

export function detectSensitiveData(
  text,
  { enabledTypes = null, profile = 'prompt', region } = {},
) {
  return engine.detectSensitiveData(text, {
    enabledTypes,
    profile,
    region: region === undefined ? phoneRegion() : region,
    ignore: tokenSpans,
  });
}

// A random-looking value that no rule masked and that has no key-like name
// in front of it. It is sent as is; the typed-prompt hook only warns.
export function detectEntropyWarnings(text) {
  return engine.detectEntropyWarnings(text, {
    ignore: tokenSpans,
    region: phoneRegion(),
  });
}

export function detectorManifest() {
  return { ...engine.detectorManifest(), id: DETECTOR_ID };
}

// What the free plugin detects, from the live rule set (T-35). The `about`
// skill and `zeroh-disclosure catalog` print this, so answers about coverage
// never drift from the code.
export function detectionCatalog() {
  const catalog = engine.detectionCatalog();
  return { ...catalog, also: [KNOWN_VALUES, ...catalog.also] };
}

// A human provider name for a detected value, from fixed catalog strings
// only. Null when the engine knows none.
export function providerLabel(value) {
  return engine.providerLabel(value, { ignore: tokenSpans });
}
