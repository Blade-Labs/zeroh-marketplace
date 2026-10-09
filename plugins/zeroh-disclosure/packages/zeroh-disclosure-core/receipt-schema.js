// SPDX-License-Identifier: AGPL-3.0-only

// Metadata for new receipts. Historical 1.0 receipts used a /v2 label without
// numeric schema_version; their signed bytes remain evidence as written.
import { canonicalJson } from './crypto.js';
import { TOKEN_SPECS } from './token-pattern.js';

export function validReceiptMetadata(claims) {
  return (
    claims.schema === 'zeroh-disclosure-receipt/v2' &&
    claims.schema_id === 'zeroh-disclosure-receipt' &&
    claims.schema_version === 2 &&
    typeof claims.signing_key_id === 'string' &&
    claims.signing_key_id.length > 0 &&
    Object.hasOwn(TOKEN_SPECS, claims.token_spec_version?.version ?? '') &&
    canonicalJson(claims.token_spec_version) ===
      canonicalJson(TOKEN_SPECS[claims.token_spec_version?.version] ?? null)
  );
}

export function supportedReceiptSchema(claims) {
  if (
    !['zeroh-disclosure-receipt/v1', 'zeroh-disclosure-receipt/v2'].includes(
      claims.schema,
    )
  )
    return false;
  if (
    claims.schema_version === undefined &&
    claims.token_spec_version === undefined &&
    claims.schema_id === undefined
  )
    return true;
  return validReceiptMetadata(claims);
}
