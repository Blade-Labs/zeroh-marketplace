// Verify a VI L1→L2 chain. We use `jose` for the JWS signature checks so the
// IETF spec stays the source of truth; the higher-level structural checks
// (expiry, sd_hash binding, audience match) live here.
//
// What v1 verifies:
//   • L1 issuer JWT signed by a key in `trustedIssuerJwks` (matched by `kid`)
//   • L2 issuer JWT signed by L1.cnf.jwk (the user's bound key)
//   • L1.exp > now and L2.exp > now
//   • L2.sd_hash === B64U(SHA-256(L1Compact))
//   • L2.aud === expectedAud  (when provided)
//
// What v1 does NOT verify (deferred to a later phase):
//   • Live JWKS fetch over HTTPS from a real issuer URL
//   • L2 selective disclosure expansion
//   • L3 chain (agent → merchant / network)
//   • Mandate revocation lookup
//
// Output is a structured `{ ok, errors[], … }`; failures don't throw, so
// callers can surface a single clean error string to the user.

import { compactVerify, importJWK } from 'jose';
import { sha256 } from '@noble/hashes/sha256';
import { decodeIssuerJwt } from './parse.js';

const SUPPORTED_ALG = new Set(['ES256']);

/**
 * @param {object} args
 * @param {string} args.l1Compact
 * @param {string} args.l2Compact
 * @param {{ keys: object[] }} args.trustedIssuerJwks
 * @param {string=} args.expectedAud   defaults to 'commerce'
 * @param {number=} args.now           unix seconds; defaults to Date.now()/1000
 * @returns {Promise<{ ok: boolean, errors: string[], l1Payload?: object, l2Payload?: object, l1Hash?: string, l2Hash?: string, agentJwk?: object }>}
 */
export async function verifyChain({ l1Compact, l2Compact, trustedIssuerJwks, expectedAud = 'commerce', now }) {
  const errors = [];
  const out = { ok: false, errors };
  if (!l1Compact || !l2Compact) {
    errors.push('verifyChain: l1Compact and l2Compact are required');
    return out;
  }
  now = now ?? Math.floor(Date.now() / 1000);

  // --- L1 ---
  let l1Header, l1Payload, l1Jwt;
  try {
    const d = decodeIssuerJwt(l1Compact);
    l1Header = d.header;
    l1Payload = d.payload;
    l1Jwt = d.raw;
  } catch (e) {
    errors.push(`L1: decode failed (${e.message})`);
    return out;
  }
  if (!SUPPORTED_ALG.has(l1Header.alg)) {
    errors.push(`L1: alg ${l1Header.alg} not supported`);
    return out;
  }
  const issuerJwk = pickIssuerJwk(trustedIssuerJwks, l1Header.kid);
  if (!issuerJwk) {
    errors.push(`L1: no matching issuer JWK for kid=${l1Header.kid ?? '<absent>'}`);
    return out;
  }
  try {
    const key = await importJWK(issuerJwk, 'ES256');
    await compactVerify(l1Jwt, key);
  } catch (e) {
    errors.push(`L1: signature invalid (${e.code || e.message})`);
    return out;
  }
  if (typeof l1Payload.exp === 'number' && l1Payload.exp <= now) {
    errors.push(`L1: expired (exp=${l1Payload.exp}, now=${now})`);
    return out;
  }
  if (!l1Payload.cnf?.jwk) {
    errors.push('L1: missing cnf.jwk (cannot bind L2 verifier)');
    return out;
  }

  // --- L2 ---
  let l2Header, l2Payload, l2Jwt;
  try {
    const d = decodeIssuerJwt(l2Compact);
    l2Header = d.header;
    l2Payload = d.payload;
    l2Jwt = d.raw;
  } catch (e) {
    errors.push(`L2: decode failed (${e.message})`);
    return out;
  }
  if (!SUPPORTED_ALG.has(l2Header.alg)) {
    errors.push(`L2: alg ${l2Header.alg} not supported`);
    return out;
  }
  try {
    const key = await importJWK(l1Payload.cnf.jwk, 'ES256');
    await compactVerify(l2Jwt, key);
  } catch (e) {
    errors.push(`L2: signature does not verify against L1.cnf.jwk (${e.code || e.message})`);
    return out;
  }
  if (typeof l2Payload.exp === 'number' && l2Payload.exp <= now) {
    errors.push(`L2: expired (exp=${l2Payload.exp}, now=${now})`);
    return out;
  }
  if (expectedAud && l2Payload.aud !== expectedAud) {
    errors.push(`L2: aud=${l2Payload.aud ?? '<absent>'} expected ${expectedAud}`);
    return out;
  }

  // --- L1↔L2 binding ---
  const l1Hash = base64url(sha256(new TextEncoder().encode(l1Compact)));
  if (l2Payload.sd_hash && l2Payload.sd_hash !== l1Hash) {
    errors.push('L2: sd_hash does not match SHA-256(L1Compact)');
    return out;
  }
  const l2Hash = base64url(sha256(new TextEncoder().encode(l2Compact)));

  // Agent key — autonomous mode binds it in delegate_payload.{checkout,payment}_mandate.cnf.jwk.
  const checkoutCnf = l2Payload.delegate_payload?.checkout_mandate?.cnf?.jwk;
  const paymentCnf = l2Payload.delegate_payload?.payment_mandate?.cnf?.jwk;
  const agentJwk = checkoutCnf || paymentCnf || null;

  return {
    ok: true,
    errors: [],
    l1Header,
    l1Payload,
    l2Header,
    l2Payload,
    l1Hash,
    l2Hash,
    agentJwk,
  };
}

function pickIssuerJwk(jwks, kid) {
  const keys = jwks?.keys || [];
  if (kid) return keys.find((k) => k.kid === kid) ?? null;
  return keys[0] ?? null;
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
