// SPDX-License-Identifier: AGPL-3.0-only

// Cryptographic primitives on WebCrypto and node:crypto only: hashing, HMAC,
// AES-GCM, P-256 signing, base64url and canonical JSON.
import { timingSafeEqual } from 'node:crypto';

const TEXT_ENCODER = new TextEncoder();
export const utf8 = (v) => TEXT_ENCODER.encode(String(v));
function getWebCrypto() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto unavailable. Use Node >=20.');
  return c;
}
export function randomBytes(n = 32) {
  const out = new Uint8Array(n);
  getWebCrypto().getRandomValues(out);
  return out;
}
export function bytesToBase64Url(bytes) {
  const u = new Uint8Array(bytes);
  let b64;
  if (typeof btoa === 'function') {
    let s = '';
    for (const b of u) s += String.fromCharCode(b);
    b64 = btoa(s);
  } else b64 = Buffer.from(u).toString('base64');
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export function base64UrlToBytes(value) {
  let b64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  if (typeof atob === 'function') {
    const s = atob(b64);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
function sortForJson(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortForJson);
  const o = {};
  for (const k of Object.keys(v).sort())
    if (v[k] !== undefined) o[k] = sortForJson(v[k]);
  return o;
}
export function canonicalJson(v) {
  return JSON.stringify(sortForJson(v));
}
async function sha256Bytes(v) {
  const input =
    v instanceof Uint8Array
      ? v
      : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return new Uint8Array(await getWebCrypto().subtle.digest('SHA-256', input));
}
export async function sha256B64u(v) {
  return bytesToBase64Url(await sha256Bytes(v));
}
export function randomB64u(n = 32) {
  return bytesToBase64Url(randomBytes(n));
}
async function importHmacKey(secret) {
  return getWebCrypto().subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
export async function hmacSha256B64u(secret, v) {
  const key = await importHmacKey(secret);
  const input =
    v instanceof Uint8Array
      ? v
      : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return bytesToBase64Url(
    new Uint8Array(await getWebCrypto().subtle.sign('HMAC', key, input)),
  );
}
export async function generateP256KeyPair() {
  return getWebCrypto().subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
}
export async function exportPublicJwk(k) {
  return getWebCrypto().subtle.exportKey('jwk', k);
}
export async function exportPrivateJwk(k) {
  return getWebCrypto().subtle.exportKey('jwk', k);
}
export async function importPublicJwk(jwk) {
  return getWebCrypto().subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
}
export async function importPrivateJwk(jwk) {
  return getWebCrypto().subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );
}
export async function signP256(privateKey, v) {
  const bytes =
    v instanceof Uint8Array
      ? v
      : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return new Uint8Array(
    await getWebCrypto().subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      bytes,
    ),
  );
}
export async function verifyP256(publicKey, v, sig) {
  const bytes =
    v instanceof Uint8Array
      ? v
      : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return getWebCrypto().subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    sig,
    bytes,
  );
}
export async function jwkThumbprint(jwk) {
  return sha256B64u(
    canonicalJson({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }),
  );
}

// Constant-time comparison of two secrets (access keys, tokens, proofs).
export function sameSecret(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
