#!/usr/bin/env node
// One-shot helper: create a Hedera HCS topic on the configured network so the
// plugin has something to submit anchors to. Reads HEDERA_OPERATOR_ID,
// HEDERA_OPERATOR_KEY, and HEDERA_NETWORK from the environment.
//
// Usage:
//   HEDERA_NETWORK=testnet HEDERA_OPERATOR_ID=0.0.xxxx HEDERA_OPERATOR_KEY=... \
//     node scripts/create-topic.mjs

import { Client, PrivateKey, TopicCreateTransaction } from '@hashgraph/sdk';
import { loadConfig } from '../lib/config.js';

await loadConfig({ cwd: process.cwd() });

const operator = process.env.HEDERA_OPERATOR_ID;
const keyRaw = process.env.HEDERA_OPERATOR_KEY;
const network = process.env.HEDERA_NETWORK || 'testnet';

if (!operator || !keyRaw) {
  console.error('Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY first.');
  process.exit(1);
}

const key = (() => {
  for (const fn of [() => PrivateKey.fromString(keyRaw), () => PrivateKey.fromStringED25519(keyRaw), () => PrivateKey.fromStringECDSA(keyRaw)]) {
    try {
      return fn();
    } catch {}
  }
  throw new Error('Unable to parse HEDERA_OPERATOR_KEY');
})();

const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
client.setOperator(operator, key);

const tx = await new TopicCreateTransaction()
  .setTopicMemo('ZeroH Mask disclosure anchors (demo)')
  .execute(client);
const receipt = await tx.getReceipt(client);
const topicId = receipt.topicId.toString();

console.log(`Topic created: ${topicId}`);
console.log(`HashScan: https://hashscan.io/${network}/topic/${topicId}`);
console.log('');
console.log('Add this to your shell before running Claude Code:');
console.log(`  export HEDERA_TOPIC_ID=${topicId}`);
console.log('  export ZEROH_ANCHOR=1');

client.close();
