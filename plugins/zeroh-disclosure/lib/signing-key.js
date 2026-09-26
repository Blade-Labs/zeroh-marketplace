// SPDX-License-Identifier: AGPL-3.0-only

// The local receipt signing key (ECDSA P-256).
import {
  exportPrivateJwk,
  exportPublicJwk,
  generateP256KeyPair,
  importPrivateJwk,
  importPublicJwk,
  jwkThumbprint,
  signP256,
  verifyP256,
} from './crypto.js';

// The local key that signs receipts: an ECDSA P-256 key pair kept in the
// session directory (signing-key.json holds the public half,
// signing-key.private.json the private JWK), so every hook in a session signs
// with the same key. It never leaves this machine.
export class LocalSigningKey {
  constructor({ keyId, publicKey, privateKey, publicJwk }) {
    this.keyId = keyId;
    this.alg = 'ES256';
    this._publicKey = publicKey;
    this._privateKey = privateKey;
    this._publicJwk = publicJwk;
  }
  async getPublicKey() {
    return { jwk: this._publicJwk };
  }
  async getKeyId() {
    return `jwk-thumbprint:${await jwkThumbprint(this._publicJwk)}`;
  }
  async sign(bytes) {
    return signP256(this._privateKey, bytes);
  }
  async verify(bytes, sig) {
    return verifyP256(this._publicKey, bytes, sig);
  }
}

export async function loadOrCreateSigningKey({
  readJson,
  writeJson,
  publicPath,
  privatePath,
  keyId,
}) {
  const existing = await readJson(publicPath);
  const existingPriv = await readJson(privatePath);
  if (existing && existingPriv) {
    return new LocalSigningKey({
      keyId: existing.keyId,
      publicKey: await importPublicJwk(existing.publicJwk),
      privateKey: await importPrivateJwk(existingPriv),
      publicJwk: existing.publicJwk,
    });
  }
  const kp = await generateP256KeyPair();
  const publicJwk = await exportPublicJwk(kp.publicKey);
  const privateJwk = await exportPrivateJwk(kp.privateKey);
  await writeJson(publicPath, { keyId, publicJwk });
  await writeJson(privatePath, privateJwk);
  return new LocalSigningKey({
    keyId,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicJwk,
  });
}
