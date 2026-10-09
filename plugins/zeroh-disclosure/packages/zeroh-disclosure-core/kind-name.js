// SPDX-License-Identifier: AGPL-3.0-only

import { isSecretType } from './data-kinds.js';
import { PERSONAL_DATA_KINDS, providerLabel } from './detector.js';

const KIND_NAMES = {
  ...Object.fromEntries(
    PERSONAL_DATA_KINDS.map(({ type, name }) => [type, name]),
  ),
  PASSWORD: 'password',
  PRIVATE_KEY: 'private key',
  TOKEN: 'token',
};

// A human name for one value of `type`, never derived from its characters
// beyond the public prefix catalog and rule names.
export function kindName(type, value) {
  if (isSecretType(type)) {
    let label = null;
    try {
      label = providerLabel(value);
    } catch {
      label = null;
    }
    if (label) return label;
  }
  const key = String(type || '').toUpperCase();
  if (KIND_NAMES[key]) return KIND_NAMES[key];
  if (isSecretType(key)) return 'secret';
  return key.toLowerCase().replace(/_/gu, ' ') || 'sensitive value';
}
