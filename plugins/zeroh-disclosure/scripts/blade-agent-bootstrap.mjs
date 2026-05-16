#!/usr/bin/env node
// One-shot agent identity provisioning.
//
// Provisions a fresh Hedera-rooted AI-agent identity:
//   1. Ed25519 keypair generated locally (raw, in process)
//   2. Hedera account created for that key (paid by funded operator)
//   3. did:hedera v2.0 document published to a fresh HCS topic
//      (via @hiero-did-sdk/registrar)
//   4. HCS-14 Universal Agent ID built from the DID
//   5. Config blob written to .zeroh/blade-agent.json with 0600 perms
//
// The plugin's runtime (BladeWallet adapter, F-1.4+) loads this blob on
// SessionStart and uses the stored Ed25519 key to sign disclosure receipts
// with iss = did:hedera:..., closing the one-key audit chain on a public
// ledger.
//
// USAGE
//   node scripts/blade-agent-bootstrap.mjs              # live; fails if config exists
//   node scripts/blade-agent-bootstrap.mjs --reuse      # short-circuit if config exists
//   node scripts/blade-agent-bootstrap.mjs --dry-run    # synthetic; no Hedera RPC
//   node scripts/blade-agent-bootstrap.mjs --config-path PATH
//
// REQUIRED ENV (live mode)
//   ZEROH_BLADE_API_KEY      Your Blade SDK API key
//   ZEROH_BLADE_DAPP_CODE    Your Blade dApp code
//   HEDERA_NETWORK           "testnet" or "mainnet" (default: testnet)
//   HEDERA_OPERATOR_ID       0.0.XXXX — funded account that pays fees
//   HEDERA_OPERATOR_KEY      DER-prefixed hex Ed25519 private key
//
// COST (testnet, 2026)
//   ~$0.05 to create Hedera account + ~$0.01 for DID topic + ~$0.001 per
//   DID-doc message. Total ~$0.07 in HBAR. Headroom recommended.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
} from '@hashgraph/sdk';
import { BladeSDK } from '../lib/blade/sdk.js';
import { publishAgentDid } from '../lib/hiero/did-publisher.js';
import { buildUaidFromDid } from '../lib/hashgraph-online/uaid.js';

// --- argv ---------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reuse = args.includes('--reuse');
const cfgFlagIdx = args.indexOf('--config-path');
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = cfgFlagIdx >= 0
  ? args[cfgFlagIdx + 1]
  : path.join(PLUGIN_ROOT, '.zeroh', 'blade-agent.json');

// --- main ---------------------------------------------------------------

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

console.log(bold('ZeroH Disclosure — Blade agent bootstrap'));
console.log(dim(`config: ${configPath}`));
console.log(dim(`mode:   ${dryRun ? 'DRY-RUN (synthetic)' : 'LIVE (Hedera RPC)'}`));
console.log();

// 1. --reuse short-circuit
if (await fileExists(configPath)) {
  if (reuse) {
    const existing = JSON.parse(await fs.readFile(configPath, 'utf8'));
    console.log(green(`✓ Reusing existing config (--reuse)`));
    console.log(dim(`  accountId: ${existing.accountId}`));
    console.log(dim(`  did:       ${existing.did}`));
    console.log(dim(`  uaid:      ${existing.uaid}`));
    process.exit(0);
  } else {
    console.error(yellow(`! Config already exists at ${configPath}`));
    console.error(yellow('  Re-run with --reuse to keep it, or delete and retry.'));
    process.exit(1);
  }
}

// 2. Validate env (live mode)
const env = readEnv();
if (!dryRun) requireLiveEnv(env);

// 3. Generate agent Ed25519 keypair (real RNG even in dry-run)
const agentKey = PrivateKey.generateED25519();
const agentPubBytes = agentKey.publicKey.toBytesRaw();
console.log(`Generated agent Ed25519 keypair`);
console.log(dim(`  pubkey (raw hex): ${bytesToHex(agentPubBytes)}`));
console.log();

// 4. Provision Hedera account
let accountId;
if (dryRun) {
  accountId = '0.0.DRY' + Math.floor(Math.random() * 1_000_000);
  console.log(yellow(`[dry-run] skipping AccountCreateTransaction`));
  console.log(dim(`  synthetic accountId: ${accountId}`));
} else {
  console.log(`Creating Hedera account for agent key...`);
  const operatorKey = PrivateKey.fromStringED25519(env.HEDERA_OPERATOR_KEY);
  const client = clientForNetwork(env.HEDERA_NETWORK).setOperator(env.HEDERA_OPERATOR_ID, operatorKey);
  try {
    const tx = await new AccountCreateTransaction()
      .setKey(agentKey.publicKey)
      .setInitialBalance(new Hbar(1))
      .execute(client);
    const receipt = await tx.getReceipt(client);
    accountId = receipt.accountId.toString();
    console.log(green(`✓ Hedera account created: ${accountId}`));
  } finally {
    client.close();
  }
}
console.log();

// 5. Blade SDK init (diagnostic + future Paymaster hook)
if (dryRun) {
  console.log(yellow(`[dry-run] skipping BladeSDK.init()`));
} else {
  console.log(`Initializing Blade SDK with dAppCode...`);
  const blade = new BladeSDK();
  const bladeNetwork = env.HEDERA_NETWORK.charAt(0).toUpperCase() + env.HEDERA_NETWORK.slice(1);
  try {
    const info = await blade.init(env.ZEROH_BLADE_API_KEY, bladeNetwork, env.ZEROH_BLADE_DAPP_CODE);
    console.log(green(`✓ Blade SDK initialized`));
    console.log(dim(`  sdkVersion: ${info?.sdkVersion ?? 'unknown'}`));
    console.log(dim(`  visitorId:  ${(info?.visitorId ?? '').slice(0, 16)}...`));
  } catch (e) {
    console.error(yellow(`! Blade SDK init failed: ${e?.message ?? e}`));
    console.error(yellow('  Continuing anyway — Blade init is informational in this phase.'));
  }
}
console.log();

// 6. Publish did:hedera v2.0 document
let did, didDocument;
if (dryRun) {
  did = `did:hedera:${env.HEDERA_NETWORK}:z6Mk${bytesToHex(agentPubBytes).slice(0, 32)}_0.0.DRYTOPIC`;
  didDocument = { id: did, '@context': ['https://www.w3.org/ns/did/v1'], verificationMethod: [] };
  console.log(yellow(`[dry-run] skipping publishAgentDid()`));
  console.log(dim(`  synthetic did: ${did}`));
} else {
  console.log(`Publishing did:hedera v2.0 document to HCS...`);
  const result = await publishAgentDid({
    network: env.HEDERA_NETWORK,
    operator: { accountId: env.HEDERA_OPERATOR_ID, privateKey: env.HEDERA_OPERATOR_KEY },
    agentPrivateKey: agentKey,
  });
  did = result.did;
  didDocument = result.didDocument;
  console.log(green(`✓ DID published: ${did}`));
}
console.log();

// 7. Build HCS-14 UAID
const uaid = buildUaidFromDid(did, {
  proto: 'hcs-10',
  nativeId: `hedera:${env.HEDERA_NETWORK}:${accountId}`,
});
console.log(green(`✓ UAID: ${uaid}`));
console.log();

// 8. Write config blob with 0600 perms
const config = {
  version: '1',
  accountId,
  network: env.HEDERA_NETWORK,
  privateKeyHex: agentKey.toString(),  // DER-prefixed hex (Blade + Hedera SDK accept)
  publicJwk: ed25519PublicJwk(agentPubBytes, did),
  did,
  didTopicId: parseTopicFromDid(did),
  uaid,
  createdAt: new Date().toISOString(),
  bootstrap: { dryRun, source: 'blade-agent-bootstrap.mjs' },
};

await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });

console.log(green(bold(`✓ Wrote ${configPath} (chmod 0600)`)));
console.log();

// 9. Summary
console.log(bold('Bootstrap complete.'));
console.log(`  Account:  ${accountId}`);
console.log(`  DID:      ${did}`);
console.log(`  UAID:     ${uaid}`);
if (!dryRun) {
  const hashscan = env.HEDERA_NETWORK === 'mainnet'
    ? `https://hashscan.io/mainnet/account/${accountId}`
    : `https://hashscan.io/testnet/account/${accountId}`;
  console.log(`  Hashscan: ${hashscan}`);
}
console.log();
console.log(dim('To use this identity in the plugin:'));
console.log(dim(`  export ZEROH_BLADE_AGENT_CONFIG=${configPath}`));
console.log(dim('Then start a Claude Code session; receipts will be signed by the agent\'s did:hedera key.'));

// --- helpers ------------------------------------------------------------

function readEnv() {
  return {
    ZEROH_BLADE_API_KEY: process.env.ZEROH_BLADE_API_KEY || '',
    ZEROH_BLADE_DAPP_CODE: process.env.ZEROH_BLADE_DAPP_CODE || '',
    HEDERA_NETWORK: (process.env.HEDERA_NETWORK || 'testnet').toLowerCase(),
    HEDERA_OPERATOR_ID: process.env.HEDERA_OPERATOR_ID || '',
    HEDERA_OPERATOR_KEY: process.env.HEDERA_OPERATOR_KEY || '',
  };
}

function requireLiveEnv(env) {
  const missing = ['ZEROH_BLADE_API_KEY', 'ZEROH_BLADE_DAPP_CODE', 'HEDERA_OPERATOR_ID', 'HEDERA_OPERATOR_KEY']
    .filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(`✗ Missing required env vars for live mode:\n  ${missing.join('\n  ')}`);
    console.error('\nUse --dry-run to test the script flow without credentials.');
    process.exit(1);
  }
  if (!['testnet', 'mainnet', 'previewnet'].includes(env.HEDERA_NETWORK)) {
    console.error(`✗ HEDERA_NETWORK must be testnet/mainnet/previewnet (got: ${env.HEDERA_NETWORK})`);
    process.exit(1);
  }
}

function clientForNetwork(network) {
  if (network === 'mainnet') return Client.forMainnet();
  if (network === 'previewnet') return Client.forPreviewnet();
  return Client.forTestnet();
}

function ed25519PublicJwk(rawBytes, did) {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: bytesToBase64Url(rawBytes),
    kid: `${did}#did-root-key`,
  };
}

function parseTopicFromDid(did) {
  // did:hedera:<network>:<base58key>_<topicId>
  const m = String(did).match(/_(\d+\.\d+\.\d+)$/);
  return m ? m[1] : null;
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
