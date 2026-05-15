import { base64UrlToBytes, bytesToHex, canonicalJson } from './crypto.js';

const MIRROR_BASES = {
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  testnet: 'https://testnet.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com',
};

export function mirrorBaseForNetwork(network = 'testnet') {
  return MIRROR_BASES[network] ?? MIRROR_BASES.testnet;
}

export async function verifyAnchorEvidence(anchor, { receiptHash, tokenHash = null, timeoutMs = defaultVerifyTimeoutMs() } = {}) {
  if (!anchor) {
    return {
      ok: true,
      status: 'missing',
      anchored: false,
      verified: false,
      type: 'none',
      detail: 'no anchor evidence in artifact',
    };
  }
  if (!anchor.anchored) {
    return {
      ok: true,
      status: 'unanchored',
      anchored: false,
      verified: false,
      type: anchor.type || 'none',
      detail: anchor.reason || anchor.error || 'not anchored',
    };
  }
  if (anchor.type === 'evm') return verifyEvmAnchor(anchor, { receiptHash, timeoutMs });
  if (anchor.type === 'hcs' || anchor.topic_id) return verifyHcsAnchor(anchor, { receiptHash, tokenHash, timeoutMs });
  return {
    ok: false,
    status: 'missing',
    anchored: true,
    verified: false,
    type: anchor.type || 'unknown',
    detail: 'anchored evidence has no supported verifier',
  };
}

export async function verifyHcsAnchor(anchor, {
  receiptHash = null,
  tokenHash = null,
  expectedMessageString = null,
  timeoutMs = defaultVerifyTimeoutMs(),
} = {}) {
  const network = anchor.network || process.env.HEDERA_NETWORK || 'testnet';
  const topicId = anchor.topic_id || process.env.HEDERA_TOPIC_ID;
  const expected = expectedMessageString ? expectedFromMessageString(expectedMessageString) : { receiptHash, tokenHash };
  if (!topicId) {
    return hcsResult(false, 'missing', anchor, 'missing topic_id');
  }

  if (anchor.sequence_number) {
    const found = await pollUntil(timeoutMs, async () => {
      const r = await fetchJson(`${mirrorBaseForNetwork(network)}/api/v1/topics/${topicId}/messages/${anchor.sequence_number}`);
      if (r.status === 404) return null;
      if (!r.ok) return { error: `mirror node ${r.status}` };
      return r.json;
    });
    if (!found) return hcsResult(false, 'missing', anchor, 'message not visible on mirror node');
    if (found.error) return hcsResult(false, 'missing', anchor, found.error);
    return verifyHcsMessage(found, expected, anchor);
  }

  if (expectedMessageString) {
    const found = await findHcsMessageByPayload({ network, topicId, expectedMessageString, timeoutMs });
    if (found) return verifyHcsMessage(found, expected, { ...anchor, sequence_number: found.sequence_number, consensus_timestamp: found.consensus_timestamp });
  }

  return hcsResult(false, 'missing', anchor, 'missing sequence_number and no matching mirror message found');
}

export async function findHcsMessageByPayload({ network = 'testnet', topicId, expectedMessageString, timeoutMs = defaultVerifyTimeoutMs() }) {
  const expectedCanonical = canonicalizeMessageString(expectedMessageString);
  return pollUntil(timeoutMs, async () => {
    const r = await fetchJson(`${mirrorBaseForNetwork(network)}/api/v1/topics/${topicId}/messages?limit=100&order=desc`);
    if (!r.ok) return null;
    for (const msg of r.json?.messages ?? []) {
      const decoded = decodeMirrorMessage(msg.message);
      if (canonicalizeMessageString(decoded) === expectedCanonical) return msg;
    }
    return null;
  });
}

export async function verifyEvmAnchor(anchor, { receiptHash, timeoutMs = defaultVerifyTimeoutMs() } = {}) {
  const network = anchor.network || process.env.HEDERA_NETWORK || 'testnet';
  if (!anchor.tx_hash) {
    return evmResult(false, 'missing', anchor, 'missing tx_hash');
  }
  if (!receiptHash) {
    return evmResult(false, 'missing', anchor, 'missing receipt hash for calldata comparison');
  }
  const expectedData = receiptHashToHex(receiptHash);
  const found = await pollUntil(timeoutMs, async () => {
    const r = await fetchJson(`${mirrorBaseForNetwork(network)}/api/v1/contracts/results/${anchor.tx_hash}`);
    if (r.status === 404) return null;
    if (!r.ok) return { error: `mirror node ${r.status}` };
    return r.json;
  });
  if (!found) return evmResult(false, 'missing', anchor, 'transaction not visible on mirror node');
  if (found.error) return evmResult(false, 'missing', anchor, found.error);
  const actual = String(found.function_parameters || '').toLowerCase();
  if (actual !== expectedData.toLowerCase()) {
    return evmResult(false, 'mismatch', anchor, `calldata mismatch: expected ${expectedData}, got ${actual || 'missing'}`);
  }
  return {
    ok: true,
    status: 'anchored',
    anchored: true,
    verified: true,
    type: 'evm',
    tx_hash: anchor.tx_hash,
    block_number: found.block_number ?? anchor.block_number ?? null,
    detail: `block=${found.block_number ?? 'unknown'}`,
  };
}

export function receiptHashToHex(receiptHash) {
  return `0x${bytesToHex(base64UrlToBytes(receiptHash))}`;
}

function verifyHcsMessage(message, expected, anchor) {
  const decoded = decodeMirrorMessage(message.message);
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return hcsResult(false, 'mismatch', anchor, 'mirror message is not JSON');
  }
  if (expected.receiptHash && parsed.receipt_hash !== expected.receiptHash) {
    return hcsResult(false, 'mismatch', anchor, `receipt_hash mismatch: expected ${expected.receiptHash}, got ${parsed.receipt_hash || 'missing'}`);
  }
  if (expected.tokenHash && parsed.token_hash !== expected.tokenHash) {
    return hcsResult(false, 'mismatch', anchor, `token_hash mismatch: expected ${expected.tokenHash}, got ${parsed.token_hash || 'missing'}`);
  }
  return {
    ok: true,
    status: 'anchored',
    anchored: true,
    verified: true,
    type: 'hcs',
    tx_id: anchor.tx_id ?? null,
    topic_id: anchor.topic_id ?? message.topic_id ?? process.env.HEDERA_TOPIC_ID ?? null,
    sequence_number: String(message.sequence_number ?? anchor.sequence_number ?? ''),
    consensus_timestamp: message.consensus_timestamp ?? anchor.consensus_timestamp ?? null,
    detail: `seq=${message.sequence_number ?? anchor.sequence_number}`,
  };
}

function hcsResult(ok, status, anchor, detail) {
  return {
    ok,
    status,
    anchored: !!anchor?.anchored,
    verified: false,
    type: 'hcs',
    tx_id: anchor?.tx_id ?? null,
    topic_id: anchor?.topic_id ?? null,
    sequence_number: anchor?.sequence_number ?? null,
    detail,
  };
}

function evmResult(ok, status, anchor, detail) {
  return {
    ok,
    status,
    anchored: !!anchor?.anchored,
    verified: false,
    type: 'evm',
    tx_hash: anchor?.tx_hash ?? null,
    block_number: anchor?.block_number ?? null,
    detail,
  };
}

function expectedFromMessageString(messageString) {
  try {
    const msg = JSON.parse(messageString);
    return { receiptHash: msg.receipt_hash ?? null, tokenHash: msg.token_hash ?? null };
  } catch {
    return { receiptHash: null, tokenHash: null };
  }
}

function canonicalizeMessageString(value) {
  try {
    return canonicalJson(JSON.parse(value));
  } catch {
    return String(value);
  }
}

function decodeMirrorMessage(message) {
  return Buffer.from(String(message || ''), 'base64').toString('utf8');
}

async function pollUntil(timeoutMs, fn, intervalMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultVerifyTimeoutMs() {
  return Number(process.env.ZEROH_ANCHOR_VERIFY_TIMEOUT_MS || 20_000);
}
