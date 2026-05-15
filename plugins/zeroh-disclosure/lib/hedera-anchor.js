// Live Hedera HCS submission. Lazy-imports @hashgraph/sdk so the plugin still
// loads when the dependency hasn't been installed yet.
import { findHcsMessageByPayload, verifyHcsAnchor } from './anchor-verify.js';

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
    timeout_config: hcsTimeoutConfig(),
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
  const timeoutConfig = hcsTimeoutConfig();
  const startedAt = Date.now();
  let stage = 'configure_client';
  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  try {
    validateHcsTimeoutConfig(timeoutConfig);
    const operatorKey = parseHederaPrivateKey(PrivateKey, process.env.HEDERA_OPERATOR_KEY);
    client.setOperator(process.env.HEDERA_OPERATOR_ID, operatorKey);
    if (typeof client.setGrpcDeadline === 'function') client.setGrpcDeadline(timeoutConfig.grpc_deadline_ms);
    client.setRequestTimeout(timeoutConfig.request_timeout_ms);
    if (typeof client.setMaxAttempts === 'function') client.setMaxAttempts(timeoutConfig.max_attempts);

    stage = 'execute_submit';
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(process.env.HEDERA_TOPIC_ID))
      .setMessage(messageString)
      .execute(client);
    const txId = tx.transactionId.toString();
    let receipt;
    try {
      stage = 'get_receipt';
      receipt = await tx.getReceipt(client);
    } catch (e) {
      stage = 'mirror_confirm';
      const found = await findHcsMessageByPayload({
        network,
        topicId: process.env.HEDERA_TOPIC_ID,
        expectedMessageString: messageString,
        timeoutMs: timeoutConfig.mirror_confirm_timeout_ms,
      });
      if (found) {
        return {
          anchored: true,
          verified: true,
          type: 'hcs',
          network,
          tx_id: txId,
          topic_id: process.env.HEDERA_TOPIC_ID,
          sequence_number: String(found.sequence_number ?? ''),
          consensus_timestamp: found.consensus_timestamp ?? null,
          hashscan_url: `https://hashscan.io/${network}/transaction/${txId}`,
          stage: 'mirror_confirm',
          duration_ms: Date.now() - startedAt,
          timeout_config: timeoutConfig,
          verification_detail: 'receipt lookup failed; mirror node confirmed matching topic message',
          receipt_error: String(e?.message ?? e),
        };
      }
      throw stageError('get_receipt', `receipt lookup failed and mirror confirmation did not find the message: ${e?.message ?? e}`, startedAt, timeoutConfig);
    }
    const anchor = {
      anchored: true,
      type: 'hcs',
      network,
      tx_id: txId,
      topic_id: process.env.HEDERA_TOPIC_ID,
      sequence_number: receipt.topicSequenceNumber?.toString?.() ?? String(receipt.topicSequenceNumber ?? ''),
      consensus_timestamp: tx.transactionId.validStart?.toString?.() ?? null,
      hashscan_url: `https://hashscan.io/${network}/transaction/${txId}`,
    };
    stage = 'mirror_confirm';
    const verified = await verifyHcsAnchor(anchor, {
      expectedMessageString: messageString,
      timeoutMs: timeoutConfig.mirror_confirm_timeout_ms,
    });
    return {
      ...anchor,
      verified: verified.verified,
      consensus_timestamp: verified.consensus_timestamp ?? anchor.consensus_timestamp,
      mirror_status: verified.status,
      verification_detail: verified.detail,
      stage: 'complete',
      duration_ms: Date.now() - startedAt,
      timeout_config: timeoutConfig,
    };
  } catch (e) {
    throw enrichStageError(e, stage, startedAt, timeoutConfig);
  } finally {
    client.close();
  }
}

export function hcsTimeoutConfig() {
  return {
    grpc_deadline_ms: Number(process.env.ZEROH_HCS_GRPC_DEADLINE_MS || 10_000),
    request_timeout_ms: Number(process.env.ZEROH_HCS_TIMEOUT_MS || 30_000),
    max_attempts: Number(process.env.ZEROH_HCS_MAX_ATTEMPTS || 4),
    mirror_confirm_timeout_ms: Number(process.env.ZEROH_HCS_MIRROR_TIMEOUT_MS || 20_000),
  };
}

function validateHcsTimeoutConfig(config) {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value <= 0) throw stageError('configure_client', `${name} must be a positive number`, Date.now(), config);
  }
  if (config.request_timeout_ms <= config.grpc_deadline_ms) {
    throw stageError(
      'configure_client',
      `ZEROH_HCS_TIMEOUT_MS (${config.request_timeout_ms}) must be greater than ZEROH_HCS_GRPC_DEADLINE_MS (${config.grpc_deadline_ms})`,
      Date.now(),
      config,
    );
  }
}

function enrichStageError(error, stage, startedAt, timeoutConfig) {
  if (error?.zeroh_hcs_stage) return error;
  return stageError(stage, error?.message ?? String(error), startedAt, timeoutConfig);
}

function stageError(stage, message, startedAt, timeoutConfig) {
  const e = new Error(message);
  e.zeroh_hcs_stage = stage;
  e.duration_ms = Math.max(0, Date.now() - startedAt);
  e.timeout_config = timeoutConfig;
  return e;
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
