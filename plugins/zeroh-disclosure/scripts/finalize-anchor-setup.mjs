#!/usr/bin/env node
// Finalize the anchor setup: mint an HCS topic using the creds from the
// plugin's .env (or env vars), then patch the topic id back into .env so
// subsequent runs auto-anchor.
//
// Must be run from a machine with gRPC egress to *.hedera.com:50211 — the
// Claude-Code-on-the-web sandbox blocks this. Your laptop / CI runner works.
//
// Usage:
//   node scripts/finalize-anchor-setup.mjs

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hashgraph/sdk';
import { loadConfig } from '../lib/config.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = path.join(PLUGIN_ROOT, '.env');

await loadConfig({ cwd: process.cwd() });

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY;
const network = process.env.HEDERA_NETWORK || 'testnet';

if (!operatorId || !operatorKeyRaw) {
  console.error('HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set (via env or .env).');
  process.exit(1);
}

const existingTopic = process.env.HEDERA_TOPIC_ID;
if (existingTopic) {
  console.log(`HEDERA_TOPIC_ID already set: ${existingTopic}`);
  console.log('Nothing to do. Edit .env to clear it if you want a fresh topic.');
  process.exit(0);
}

const operatorKey = parseKey(operatorKeyRaw);
const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
client.setOperator(operatorId, operatorKey);

console.log(`Minting HCS topic on ${network} (payer ${operatorId})...`);
const txResp = await new TopicCreateTransaction()
  .setTopicMemo('ZeroH Disclosure receipts (private-marketplace demo)')
  .execute(client);
const receipt = await txResp.getReceipt(client);
const topicId = receipt.topicId.toString();
client.close();

console.log(`✓ topic_id=${topicId}  tx_id=${txResp.transactionId}`);
console.log(`  https://hashscan.io/${network}/topic/${topicId}`);

// Submit a proof message so the topic is non-empty and the full submit-poll
// loop is exercised before the user moves on.
const proofMessage = JSON.stringify({
  setup: 'zeroh-disclosure',
  at: new Date().toISOString(),
  payer: operatorId,
});
console.log('Submitting proof message...');
const sub = await new TopicMessageSubmitTransaction()
  .setTopicId(topicId)
  .setMessage(proofMessage)
  .execute(client);
await sub.getReceipt(client);
console.log(`✓ submit_tx=${sub.transactionId}`);

client.close();

console.log('Polling Mirror Node for the message (consensus lag is usually 1-10s)...');
const mirrorBase = network === 'mainnet'
  ? 'https://mainnet-public.mirrornode.hedera.com'
  : 'https://testnet.mirrornode.hedera.com';
const found = await pollMirror(`${mirrorBase}/api/v1/topics/${topicId}/messages?limit=5&order=desc`, proofMessage, 30_000);
if (found) {
  console.log(`✓ consensus_ts=${found.consensus_timestamp}  seq=${found.sequence_number}`);
} else {
  console.log('✗ message not visible on Mirror Node within 30s (it may show up shortly)');
}

await patchEnv(ENV_PATH, topicId);
console.log();
console.log(`✓ wrote HEDERA_TOPIC_ID=${topicId} to ${path.relative(process.cwd(), ENV_PATH)}`);
console.log();
console.log('Commit the .env change so anyone using this marketplace gets anchoring:');
console.log('  git add plugins/zeroh-disclosure/.env');
console.log("  git commit -m 'chore(zeroh-disclosure): set HEDERA_TOPIC_ID'");

function parseKey(raw) {
  for (const fn of [
    () => PrivateKey.fromString(raw),
    () => PrivateKey.fromStringED25519(raw),
    () => PrivateKey.fromStringECDSA(raw),
  ]) {
    try { return fn(); } catch {}
  }
  throw new Error('Unable to parse HEDERA_OPERATOR_KEY');
}

async function pollMirror(url, expectedMessage, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const hit = (j.messages || []).find((m) => Buffer.from(m.message, 'base64').toString('utf8') === expectedMessage);
        if (hit) return hit;
      }
    } catch {}
    await new Promise((res) => setTimeout(res, 2000));
  }
  return null;
}

async function patchEnv(envPath, topicId) {
  const raw = await fs.readFile(envPath, 'utf8');
  const line = `HEDERA_TOPIC_ID=${topicId}`;
  let next;
  if (/^HEDERA_TOPIC_ID=.*$/m.test(raw)) {
    next = raw.replace(/^HEDERA_TOPIC_ID=.*$/m, line);
  } else if (/^# HEDERA_TOPIC_ID=.*$/m.test(raw)) {
    next = raw.replace(/^# HEDERA_TOPIC_ID=.*$/m, line);
  } else {
    next = raw.replace(/\n*$/, `\n${line}\n`);
  }
  await fs.writeFile(envPath, next);
}
