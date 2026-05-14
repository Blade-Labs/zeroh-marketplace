const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
export const utf8 = (v) => TEXT_ENCODER.encode(String(v));
export const fromUtf8 = (b) => TEXT_DECODER.decode(b);
export function getWebCrypto() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('WebCrypto unavailable. Use Node >=20.');
  return c;
}
export function randomBytes(n = 32) {
  const out = new Uint8Array(n);
  getWebCrypto().getRandomValues(out);
  return out;
}
export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function hexToBytes(hex) {
  const h = String(hex).replace(/^0x/, '');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
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
export function sortForJson(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortForJson);
  const o = {};
  for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = sortForJson(v[k]);
  return o;
}
export function canonicalJson(v) {
  return JSON.stringify(sortForJson(v));
}
export async function sha256Bytes(v) {
  const input = v instanceof Uint8Array ? v : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return new Uint8Array(await getWebCrypto().subtle.digest('SHA-256', input));
}
export async function sha256Hex(v) {
  return bytesToHex(await sha256Bytes(v));
}
export async function sha256B64u(v) {
  return bytesToBase64Url(await sha256Bytes(v));
}
export function randomB64u(n = 32) {
  return bytesToBase64Url(randomBytes(n));
}
export async function importHmacKey(secret) {
  return getWebCrypto().subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function hmacSha256B64u(secret, v) {
  const key = await importHmacKey(secret);
  const input = v instanceof Uint8Array ? v : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return bytesToBase64Url(new Uint8Array(await getWebCrypto().subtle.sign('HMAC', key, input)));
}
export async function generateP256KeyPair() {
  return getWebCrypto().subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}
export async function exportPublicJwk(k) {
  return getWebCrypto().subtle.exportKey('jwk', k);
}
export async function exportPrivateJwk(k) {
  return getWebCrypto().subtle.exportKey('jwk', k);
}
export async function importPublicJwk(jwk) {
  return getWebCrypto().subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}
export async function importPrivateJwk(jwk) {
  return getWebCrypto().subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
}
export async function signP256(privateKey, v) {
  const bytes = v instanceof Uint8Array ? v : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return new Uint8Array(await getWebCrypto().subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, bytes));
}
export async function verifyP256(publicKey, v, sig) {
  const bytes = v instanceof Uint8Array ? v : utf8(typeof v === 'string' ? v : canonicalJson(v));
  return getWebCrypto().subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, bytes);
}
export async function jwkThumbprint(jwk) {
  return sha256B64u(canonicalJson({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}
