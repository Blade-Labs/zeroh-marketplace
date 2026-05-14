// Decode a compact SD-JWT into its parts. Wraps @sd-jwt — we never reach
// for raw base64 / JSON ourselves so the IETF SD-JWT spec stays the source
// of truth.

import { SDJwtVcInstance } from '@sd-jwt/sd-jwt-vc';
import { digest } from '@sd-jwt/crypto-nodejs';
import { base64urlDecode } from '@sd-jwt/utils';

const decoder = new SDJwtVcInstance({ hasher: digest, hashAlg: 'sha-256' });

/**
 * Decode (no signature verify) the issuer-signed portion of a compact SD-JWT.
 * Useful when you only need to read the iss/aud/exp/cnf claims before
 * deciding whether to verify.
 *
 * @param {string} compact   The full "<jwt>~<d1>~<d2>~...~<kbjwt>" string.
 * @returns {{ header: object, payload: object, raw: string }}
 */
export function decodeIssuerJwt(compact) {
  if (typeof compact !== 'string' || !compact.includes('.')) {
    throw new Error('decodeIssuerJwt: not a compact SD-JWT');
  }
  const issuerJwt = compact.split('~')[0];
  const [hRaw, pRaw] = issuerJwt.split('.');
  return {
    header: JSON.parse(base64urlDecode(hRaw)),
    payload: JSON.parse(base64urlDecode(pRaw)),
    raw: issuerJwt,
  };
}

/**
 * Decode a compact SD-JWT into header + payload + disclosures, resolving the
 * selectively-disclosable claims into the payload. No signature verification.
 *
 * @param {string} compact
 * @returns {Promise<{ header: object, payload: object, disclosures: object[] }>}
 */
export async function decodeFull(compact) {
  const parsed = await decoder.decode(compact);
  return {
    header: parsed.jwt?.header || {},
    payload: parsed.jwt?.payload || {},
    disclosures: parsed.disclosures || [],
  };
}
