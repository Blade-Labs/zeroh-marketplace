// SPDX-License-Identifier: AGPL-3.0-only

// Replaces detected spans with tokens and commits to each value with a
// per-session HMAC, so receipts can refer to values without holding them.
import { hmacSha256B64u } from './crypto.js';
import { buildToken } from './tokens.js';

// Keyed deterministic tokens (lib/tokens.js) → the same value always yields the
// same token on this install, and the vault registers exactly these tokens.
// Value commitments are HMAC'd with a
// per-session key so identical values across sessions don't collide visibly
// in shared receipts.
export async function maskText(
  text,
  findings,
  { hmacKeyBytes, categoriesToMask = null } = {},
) {
  const maskSet = categoriesToMask ? new Set(categoriesToMask) : null;
  const replacements = [];
  let out = '',
    cursor = 0;
  for (const f of findings) {
    out += text.slice(cursor, f.start);
    const raw = text.slice(f.start, f.end);
    if (!maskSet || maskSet.has(f.type)) {
      const token = buildToken(f.type, raw);
      out += token;
      replacements.push({
        entity_type: f.type,
        risk: f.risk,
        start: f.start,
        end: f.end,
        original_length: raw.length,
        replacement: token,
        value_commitment: await hmacSha256B64u(hmacKeyBytes, {
          type: f.type,
          value: raw,
        }),
      });
    } else out += raw;
    cursor = f.end;
  }
  out += text.slice(cursor);
  return {
    sanitized_text: out,
    replacements,
    masked_categories: [...new Set(replacements.map((r) => r.entity_type))],
  };
}
