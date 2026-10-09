// SPDX-License-Identifier: AGPL-3.0-only

// The one rule for "is this kind a secret?": keys, passwords, tokens,
// private keys and secrets, their encoded forms, and anything named like a
// credential. Everything else ZeroH masks is personal data. Secrets are
// never unmasked; the slip previews personal data by type. No imports.
export const SECRET_TYPES = Object.freeze([
  'API_KEY',
  'PASSWORD',
  'TOKEN',
  'PRIVATE_KEY',
  'SECRET',
]);

export function normaliseKind(kind) {
  return String(kind || '')
    .trim()
    .toUpperCase();
}

export function isSecretType(kind) {
  const value = normaliseKind(kind);
  return (
    SECRET_TYPES.includes(value) ||
    /(?:^|_)(?:API_KEY|PASSWORD|TOKEN|PRIVATE_KEY|SECRET)(?:_|$)/u.test(
      value,
    ) ||
    /(?:CREDENTIAL|AUTHORIZATION|ACCESS_KEY|PASSPHRASE|WEBHOOK)/u.test(value)
  );
}

// The type in a token (the part before its last hyphen), bracketed either way.
export function tokenType(token) {
  const text = String(token);
  return text.slice(1, text.lastIndexOf('-'));
}
