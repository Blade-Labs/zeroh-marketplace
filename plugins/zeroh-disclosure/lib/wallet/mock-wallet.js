import {
  base64UrlToBytes,
  bytesToBase64Url,
  exportPrivateJwk,
  exportPublicJwk,
  generateP256KeyPair,
  importPrivateJwk,
  importPublicJwk,
  jwkThumbprint,
  signP256,
  verifyP256,
} from '../crypto.js';

// Minimal non-custodial wallet adapter. P-256 keypair persisted to a JWK file
// under .zeroh/session/<sid>/wallet.json so signatures are stable across hook
// invocations within a session.
export class P256FileWallet {
  constructor({ accountId, network = 'testnet', publicKey, privateKey, publicJwk }) {
    this.accountId = accountId;
    this.network = network;
    this.alg = 'ES256';
    this._publicKey = publicKey;
    this._privateKey = privateKey;
    this._publicJwk = publicJwk;
  }
  async getAccount() {
    return { accountId: this.accountId, network: this.network };
  }
  async getPublicKey() {
    return { jwk: this._publicJwk };
  }
  async getKeyId() {
    return `jwk-thumbprint:${await jwkThumbprint(this._publicJwk)}`;
  }
  async signMessage(bytes) {
    return signP256(this._privateKey, bytes);
  }
  async verifyMessage(bytes, sig) {
    return verifyP256(this._publicKey, bytes, sig);
  }
  toSerialized() {
    return { accountId: this.accountId, network: this.network, publicJwk: this._publicJwk };
  }
}

export async function loadOrCreateMockWallet({ readJson, writeJson, walletPath, privateJwkPath, accountId, network = 'testnet' }) {
  const existing = await readJson(walletPath);
  const existingPriv = await readJson(privateJwkPath);
  if (existing && existingPriv) {
    const publicKey = await importPublicJwk(existing.publicJwk);
    const privateKey = await importPrivateJwk(existingPriv);
    return new P256FileWallet({
      accountId: existing.accountId,
      network: existing.network,
      publicKey,
      privateKey,
      publicJwk: existing.publicJwk,
    });
  }
  const kp = await generateP256KeyPair();
  const publicJwk = await exportPublicJwk(kp.publicKey);
  const privateJwk = await exportPrivateJwk(kp.privateKey);
  await writeJson(walletPath, { accountId, network, publicJwk });
  await writeJson(privateJwkPath, privateJwk);
  return new P256FileWallet({
    accountId,
    network,
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    publicJwk,
  });
}

export { base64UrlToBytes, bytesToBase64Url };
