// VI-aware wallet adapter: signs ZH receipts with the same agent key that's
// bound in the L2 mandate's cnf.jwk. Exposes the same shape as P256FileWallet
// (getAccount / getKeyId / signMessage) so receipt.js doesn't have to know
// which wallet it's holding.
//
// When this wallet is active, an auditor only needs to verify ONE key to
// confirm both:
//   • forward (L3 → merchant / network) — the VI chain
//   • backward (ZH disclosure receipts → anchored on Hedera) — proof of
//     enforcement under the same agent identity
//
// The agent's PRIVATE JWK is loaded from `ZEROH_VI_AGENT_KEY_FILE` at
// session-load time. The public half is reconstructed and compared against
// the public JWK the mandate bound — divergence is a hard error.

import { promises as fs } from 'node:fs';
import { calculateJwkThumbprint, importJWK } from 'jose';

export class ViWallet {
  constructor({ kid, did, privateKey, publicJwk }) {
    this.alg = 'ES256';
    this.accountId = kid;
    this.network = 'jwk';
    this.did = did;
    this._privateKey = privateKey;
    this._publicJwk = publicJwk;
  }
  async getAccount() {
    // `did` flows into receipt.js's iss claim ahead of the
    // `did:hedera:<network>:<accountId>` fallback.
    return { accountId: this.accountId, network: this.network, did: this.did };
  }
  async getPublicKey() {
    return { jwk: this._publicJwk };
  }
  async getKeyId() {
    return this.accountId;
  }
  async signMessage(bytes) {
    // Sign raw bytes with ES256. jose handles RFC 7515 JOSE-style signing
    // (raw r||s, not DER), which is what the SD-JWT receipt expects.
    const { subtle } = await import('node:crypto').then((m) => m.webcrypto);
    const cryptoKey = await subtle.importKey(
      'jwk',
      this._privateKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, bytes);
    return new Uint8Array(sig);
  }
  // exposed for signMessage() — set by loader
  _privateKeyJwk = null;
}

/**
 * Load a VI agent key from disk and return a ready-to-sign wallet.
 *
 * @param {object} opts
 * @param {string} opts.keyFile     path to a JWK file with the private `d`
 * @param {object=} opts.boundJwk   the public JWK the mandate bound (for cross-check)
 * @returns {Promise<ViWallet>}
 */
export async function loadViWallet({ keyFile, boundJwk }) {
  if (!keyFile) throw new Error('loadViWallet: ZEROH_VI_AGENT_KEY_FILE is required when a mandate is active');
  let jwk;
  try {
    jwk = JSON.parse(await fs.readFile(keyFile, 'utf8'));
  } catch (e) {
    throw new Error(`loadViWallet: failed to read ${keyFile} (${e.message})`);
  }
  if (!jwk.d) {
    throw new Error(`loadViWallet: ${keyFile} is missing the private 'd' field`);
  }
  const { d, ...publicJwk } = jwk;
  void d;

  // Cross-check against the bound public JWK so a stale key file can't sign
  // for an unrelated mandate.
  if (boundJwk) {
    const a = await calculateJwkThumbprint(publicJwk, 'sha256');
    const b = await calculateJwkThumbprint(boundJwk, 'sha256');
    if (a !== b) {
      throw new Error(`loadViWallet: key at ${keyFile} does not match the mandate's bound cnf.jwk (thumbprint ${a} vs ${b})`);
    }
  }

  const kid = jwk.kid || (await calculateJwkThumbprint(publicJwk, 'sha256'));
  const did = `did:jwk:${await calculateJwkThumbprint(publicJwk, 'sha256')}`;
  const privateKey = await importJWK(jwk, 'ES256');
  const wallet = new ViWallet({ kid, did, privateKey, publicJwk });
  wallet._privateKeyJwk = jwk;
  return wallet;
}
