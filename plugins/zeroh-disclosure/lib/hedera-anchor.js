// Live Hedera HCS submission. Lazy-imports @hashgraph/sdk so the plugin still
// loads when the dependency hasn't been installed yet.

export function isAnchorEnabled() {
  return (
    process.env.ZEROH_ANCHOR === '1' &&
    !!process.env.HEDERA_OPERATOR_ID &&
    !!process.env.HEDERA_OPERATOR_KEY &&
    !!process.env.HEDERA_TOPIC_ID
  );
}

export function anchorEnvSummary() {
  return {
    enabled: isAnchorEnabled(),
    network: process.env.HEDERA_NETWORK || 'testnet',
    operator_id: process.env.HEDERA_OPERATOR_ID || null,
    topic_id: process.env.HEDERA_TOPIC_ID || null,
    has_operator_key: !!process.env.HEDERA_OPERATOR_KEY,
  };
}

export async function submitToHcs(messageString) {
  if (!isAnchorEnabled()) {
    return { anchored: false, reason: 'ZEROH_ANCHOR != 1 or Hedera env vars missing' };
  }
  const sdk = await import('@hashgraph/sdk').catch((e) => {
    throw new Error(`@hashgraph/sdk not installed; run "npm install" in the plugin dir. (${e.message})`);
  });
  const { Client, TopicId, TopicMessageSubmitTransaction, PrivateKey } = sdk;
  const network = process.env.HEDERA_NETWORK || 'testnet';
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  const operatorKey = parseHederaPrivateKey(PrivateKey, process.env.HEDERA_OPERATOR_KEY);
  client.setOperator(process.env.HEDERA_OPERATOR_ID, operatorKey);
  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(process.env.HEDERA_TOPIC_ID))
      .setMessage(messageString)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    return {
      anchored: true,
      network,
      tx_id: tx.transactionId.toString(),
      topic_id: process.env.HEDERA_TOPIC_ID,
      sequence_number: receipt.topicSequenceNumber?.toString?.() ?? String(receipt.topicSequenceNumber ?? ''),
      consensus_timestamp: tx.transactionId.validStart?.toString?.() ?? null,
      hashscan_url: `https://hashscan.io/${network}/transaction/${tx.transactionId.toString()}`,
    };
  } finally {
    client.close();
  }
}

function parseHederaPrivateKey(PrivateKey, raw) {
  const s = String(raw).trim();
  // Try DER, then hex (with or without 0x), then ED25519, then ECDSA.
  const attempts = [
    () => PrivateKey.fromString(s),
    () => PrivateKey.fromStringED25519(s),
    () => PrivateKey.fromStringECDSA(s),
  ];
  let lastErr;
  for (const fn of attempts) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Unable to parse HEDERA_OPERATOR_KEY: ${lastErr?.message ?? 'unknown'}`);
}
