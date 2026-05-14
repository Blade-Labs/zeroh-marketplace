#!/usr/bin/env node
// Hedera smoke test: prove the proof chain works end-to-end on testnet.
//
// Stages:
//   1. Generate a fresh ED25519 keypair (always; no creds needed).
//   2. Hit Mirror Node for testnet network status (always; no creds needed).
//   3. If HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY are set, run the full flow:
//      a. Create a new account from the fresh key (operator pays).
//      b. Create an HCS topic (operator pays).
//      c. Submit a deterministic test message to the topic.
//      d. Poll Mirror Node until the message appears (proves end-to-end).
//
// Usage:
//   node scripts/hedera-smoketest.mjs                       # partial (no creds)
//   HEDERA_OPERATOR_ID=0.0.x HEDERA_OPERATOR_KEY=... \
//     node scripts/hedera-smoketest.mjs                     # full

import {
  AccountCreateTransaction,
  Client,
  Hbar,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';

const network = process.env.HEDERA_NETWORK || 'testnet';
const mirrorBase = network === 'mainnet'
  ? 'https://mainnet-public.mirrornode.hedera.com'
  : 'https://testnet.mirrornode.hedera.com';
const hashscanBase = `https://hashscan.io/${network}`;

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log(bold('Hedera smoke test'));
console.log(dim(`network: ${network}`));
console.log(dim(`mirror:  ${mirrorBase}`));
console.log();

const results = [];

await step('1. Generate fresh ED25519 keypair', async () => {
  const key = PrivateKey.generateED25519();
  const pub = key.publicKey;
  return {
    pubkey_DER: pub.toStringDer().slice(0, 32) + '…',
    pubkey_raw: pub.toStringRaw(),
    note: 'Private key NOT printed (sensitive)',
    saved_to: stash(key),
  };
});

await step('2. Mirror Node connectivity (network status)', async () => {
  const r = await fetchJson(`${mirrorBase}/api/v1/network/nodes?limit=1`);
  const node = r.nodes?.[0];
  if (!node) throw new Error('empty nodes response');
  return {
    sample_node: node.node_account_id,
    description: node.description?.slice(0, 30) + '…',
    file_id: node.file_id,
  };
});

await step('2b. Mirror Node — fetch a known account', async () => {
  const targetAccount = '0.0.2'; // Hedera Foundation, exists since genesis
  const r = await fetchJson(`${mirrorBase}/api/v1/accounts/${targetAccount}`);
  if (r.account !== targetAccount) throw new Error('account mismatch');
  return {
    account: r.account,
    balance_hbar: (Number(r.balance?.balance || 0) / 1e8).toFixed(2),
  };
});

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKeyRaw = process.env.HEDERA_OPERATOR_KEY;

if (!operatorId || !operatorKeyRaw) {
  console.log();
  console.log(yellow('▸ Stages 3a–3d skipped: HEDERA_OPERATOR_ID + HEDERA_OPERATOR_KEY not set.'));
  console.log();
  console.log('To run the full flow, fund a testnet account:');
  console.log(`  ${dim('1.')} Get a free testnet account at ${bold('https://portal.hedera.com/')}`);
  console.log(`  ${dim('2.')} Set ${bold('HEDERA_OPERATOR_ID')} and ${bold('HEDERA_OPERATOR_KEY')} in env`);
  console.log(`  ${dim('3.')} Re-run: ${dim('node scripts/hedera-smoketest.mjs')}`);
  printSummary();
  process.exit(0);
}

const operatorKey = parseKey(operatorKeyRaw);
const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
client.setOperator(operatorId, operatorKey);

let newAccountId, topicId;

await step('3a. Create new account from fresh ED25519 key', async () => {
  const freshKey = PrivateKey.generateED25519();
  const txResp = await new AccountCreateTransaction()
    .setKey(freshKey.publicKey)
    .setInitialBalance(new Hbar(0))
    .execute(client);
  const receipt = await txResp.getReceipt(client);
  newAccountId = receipt.accountId.toString();
  return {
    new_account_id: newAccountId,
    tx_id: txResp.transactionId.toString(),
    hashscan: `${hashscanBase}/account/${newAccountId}`,
  };
});

await step('3b. Create HCS topic', async () => {
  const txResp = await new TopicCreateTransaction()
    .setTopicMemo('ZeroH disclosure anchor smoke test')
    .execute(client);
  const receipt = await txResp.getReceipt(client);
  topicId = receipt.topicId.toString();
  return {
    topic_id: topicId,
    tx_id: txResp.transactionId.toString(),
    hashscan: `${hashscanBase}/topic/${topicId}`,
  };
});

const testMessage = JSON.stringify({
  smoketest: true,
  at: new Date().toISOString(),
  nonce: Math.random().toString(36).slice(2, 10),
});
let submitTxId;

await step('3c. Submit test message to topic', async () => {
  const txResp = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(testMessage)
    .execute(client);
  await txResp.getReceipt(client);
  submitTxId = txResp.transactionId.toString();
  return { tx_id: submitTxId, bytes: testMessage.length };
});

await step('3d. Poll Mirror Node until message appears', async () => {
  // Mirror lags consensus by 1–10 seconds typically.
  const start = Date.now();
  const deadline = start + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetchJson(`${mirrorBase}/api/v1/topics/${topicId}/messages?limit=10&order=desc`);
      const found = (r.messages || []).find((m) => {
        if (!m.message) return false;
        const decoded = Buffer.from(m.message, 'base64').toString('utf8');
        return decoded === testMessage;
      });
      if (found) {
        return {
          consensus_timestamp: found.consensus_timestamp,
          sequence_number: found.sequence_number,
          poll_seconds: ((Date.now() - start) / 1000).toFixed(1),
        };
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(2000);
  }
  throw new Error(`message not found within 30s${lastError ? ` (last: ${lastError.message})` : ''}`);
});

client.close();

printSummary();
process.exit(0);

// helpers ---------------------------------------------------------------------

async function step(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const detail = await fn();
    const det = Object.entries(detail || {})
      .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '…' : v}`)
      .join('  ');
    console.log(green('✓ ') + (det ? dim(det) : ''));
    results.push({ name, pass: true });
  } catch (e) {
    console.log(red('✗ ') + red(e.message));
    if (process.env.DEBUG) console.log(dim(e.stack));
    results.push({ name, pass: false, error: e.message });
  }
}

function parseKey(raw) {
  for (const fn of [
    () => PrivateKey.fromString(raw),
    () => PrivateKey.fromStringED25519(raw),
    () => PrivateKey.fromStringECDSA(raw),
  ]) {
    try { return fn(); } catch {}
  }
  throw new Error('unable to parse HEDERA_OPERATOR_KEY');
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${url}`);
  return r.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stash(key) {
  // Don't write the private key anywhere from the smoke test — leaving keys
  // around without a clear lifecycle is a foot-gun. Print a hint instead.
  return '(in-memory; recreate with PrivateKey.generateED25519() — smoke test does not persist)';
}

function printSummary() {
  console.log();
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  if (failed === 0) {
    console.log(bold(green(`✓ All ${passed} checks passed.`)));
  } else {
    console.log(bold(red(`✗ ${failed} / ${results.length} checks failed.`)));
    for (const r of results.filter((r) => !r.pass)) console.log(red(`  ✗ ${r.name}: ${r.error}`));
  }
}
