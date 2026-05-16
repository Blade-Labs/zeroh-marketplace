// Hedera-rooted wallet adapter (Phase F-1.4).
//
// Replaces the previous did:jwk:<thumbprint> agent identity (Phase E.6) with
// a did:hedera identity provisioned by scripts/blade-agent-bootstrap.mjs.
// The agent's Ed25519 private key is held in process memory (loaded from
// .zeroh/blade-agent.json with 0600 perms); the same key signs every ZH
// disclosure receipt, with iss = did:hedera:..., closing the one-key audit
// chain on a public ledger.
//
// Interface contract: matches P256FileWallet (mock-wallet.js) and ViWallet
// so callers (lib/sdjwt.js, lib/receipt.js) don't need to know which wallet
// is loaded.

import { promises as fs } from 'node:fs';
import { PrivateKey } from '@hashgraph/sdk';

export class BladeWallet {
  constructor({ accountId, network, did, publicJwk, privateKeyHex }) {
    if (!accountId || !network || !did || !publicJwk || !privateKeyHex) {
      throw new Error('BladeWallet: accountId, network, did, publicJwk, privateKeyHex required');
    }
    // Ed25519 / EdDSA. Hedera-native; first-class in Hiero DID v2.0.
    // SD-JWT signing routes through wallet.alg in lib/sdjwt.js, so this
    // is the field that propagates to the receipt's JWS header.
    this.alg = 'EdDSA';
    this.accountId = accountId;
    this.network = network;
    this.did = did;
    this._publicJwk = publicJwk;
    // PrivateKey.fromStringED25519 accepts both DER-prefixed hex
    // (302e020100300506032b657004220420...) and the 32-byte raw hex.
    this._privateKey = PrivateKey.fromStringED25519(privateKeyHex);
  }

  async getAccount() {
    // `did` flows into receipt.js's `iss` claim ahead of the
    // did:hedera:<network>:<accountId> fallback. The fallback would still
    // produce a valid-looking DID but without the published HCS topic
    // suffix, so the explicit `did` from the bootstrap is what we want.
    return { accountId: this.accountId, network: this.network, did: this.did };
  }

  async getPublicKey() {
    return { jwk: this._publicJwk };
  }

  async getKeyId() {
    // Matches the verificationMethod id convention in the published
    // did:hedera v2.0 document (`<did>#did-root-key` per Hiero DID SDK).
    // The publicJwk's kid was set to this value at bootstrap time, so
    // returning the same string here keeps things consistent.
    return this._publicJwk.kid || `${this.did}#did-root-key`;
  }

  async signMessage(bytes) {
    // @hashgraph/sdk PrivateKey.sign returns raw 64-byte Ed25519 (r||s).
    // That's exactly the format JOSE EdDSA expects, so we hand the bytes
    // straight back to the SD-JWT builder (lib/sdjwt.js) for base64url
    // encoding into the JWS signature segment.
    return this._privateKey.sign(bytes);
  }
}

/**
 * Load a BladeWallet from a bootstrap config blob written by
 * scripts/blade-agent-bootstrap.mjs.
 *
 * @param {object} opts
 * @param {string} opts.configPath  Path to blade-agent.json
 * @returns {Promise<BladeWallet>}
 */
export async function loadBladeWallet({ configPath }) {
  if (!configPath) throw new Error('loadBladeWallet: configPath required');
  let cfg;
  try {
    cfg = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`loadBladeWallet: failed to read ${configPath} (${e.message})`);
  }
  // Refuse to load a world-readable bearer-credential file on POSIX.
  // Same posture as ViWallet's documented private-key protection.
  if (process.platform !== 'win32') {
    try {
      const stat = await fs.stat(configPath);
      // mode & 0o077 = any non-owner read/write/execute bits
      if (stat.mode & 0o077) {
        throw new Error(
          `loadBladeWallet: ${configPath} has loose permissions (${(stat.mode & 0o777).toString(8)}); chmod 0600 required`,
        );
      }
    } catch (e) {
      if (e.message.startsWith('loadBladeWallet:')) throw e;
      // ignore stat failures other than perms (e.g. unusual filesystems)
    }
  }
  if (cfg.version !== '1') {
    throw new Error(`loadBladeWallet: unsupported config version ${cfg.version}`);
  }
  return new BladeWallet({
    accountId: cfg.accountId,
    network: cfg.network,
    did: cfg.did,
    publicJwk: cfg.publicJwk,
    privateKeyHex: cfg.privateKeyHex,
  });
}
