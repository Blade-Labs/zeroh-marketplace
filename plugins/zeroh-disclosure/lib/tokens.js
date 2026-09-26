// SPDX-License-Identifier: AGPL-3.0-only

// Token names: [TYPE-xxxxxx], six hex characters per token.
//
// New tokens are keyed: the six characters come from HMAC-SHA256 over
// "TYPE:value" with a per-install token key derived from the vault key
// (lib/vault.js tokenHashKey). The key never leaves this machine and cannot be
// derived from a token, so a token no longer lets anyone test guesses of a
// low-entropy value (a phone number, an ID) offline. The same value still gets
// the same token on this install, so the model can reason about "the same
// value" and prompts stay cacheable. Tokens already in a vault keep working:
// a vault resolves values to their stored token first.
import { createHmac } from 'node:crypto';
import { tokenHashKey } from './vault.js';

// A keyed six-hex-character hash for one token key.
export function keyedHash6(key) {
  return (input) =>
    createHmac('sha256', key)
      .update(String(input), 'utf8')
      .digest('hex')
      .slice(0, 6);
}

// The keyed hash for this install (ZEROH_HOME in `env`).
export function installHash(env = process.env) {
  return keyedHash6(tokenHashKey(env));
}

export function buildToken(type, value, attempt = 0, hash = null) {
  const input =
    attempt === 0 ? `${type}:${value}` : `${type}:${value}:${attempt}`;
  return `[${type}-${(hash ?? installHash())(input)}]`;
}

export { isToken } from './token-pattern.js';
