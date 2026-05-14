// Anchor the receipt hash on Hedera as the calldata of a self-transfer-of-0
// EVM transaction submitted via Hashio JSON-RPC. Works in any HTTPS-egress
// environment (including sandboxes that block Hedera gRPC). Requires an
// ECDSA-keyed account on Hedera, since EVM signing is secp256k1 only.

const HASHIO_URLS = {
  testnet: 'https://testnet.hashio.io/api',
  mainnet: 'https://mainnet.hashio.io/api',
  previewnet: 'https://previewnet.hashio.io/api',
};
const CHAIN_IDS = { testnet: 296, mainnet: 295, previewnet: 297 };

export function isEvmAnchorEnabled() {
  return (
    process.env.ZEROH_ANCHOR === '1' &&
    !!process.env.HEDERA_EVM_OPERATOR_ID &&
    !!process.env.HEDERA_EVM_OPERATOR_KEY
  );
}

export function evmAnchorEnvSummary() {
  return {
    enabled: isEvmAnchorEnabled(),
    network: process.env.HEDERA_NETWORK || 'testnet',
    operator_id: process.env.HEDERA_EVM_OPERATOR_ID || null,
    has_operator_key: !!process.env.HEDERA_EVM_OPERATOR_KEY,
  };
}

// receiptHashB64u: base64url-encoded SHA-256 (32 bytes) of the receipt's
// compact SD-JWT. We submit those 32 bytes as the EVM tx's calldata; the
// transaction hash + consensus timestamp are the proof of anchoring.
export async function submitEvmAnchor(receiptHashB64u) {
  if (!isEvmAnchorEnabled()) {
    return { anchored: false, type: 'evm', reason: 'EVM anchor not configured' };
  }
  const ethers = await import('ethers').catch((e) => {
    throw new Error(`ethers not installed; run "npm install" in the plugin dir. (${e.message})`);
  });
  const network = process.env.HEDERA_NETWORK || 'testnet';
  const url = HASHIO_URLS[network];
  const chainId = CHAIN_IDS[network];
  if (!url) return { anchored: false, type: 'evm', error: `unknown network: ${network}` };

  const data = b64uToHex(receiptHashB64u);
  if (data.length !== 2 + 64) {
    return { anchored: false, type: 'evm', error: `expected 32-byte receipt hash, got ${(data.length - 2) / 2} bytes` };
  }

  const provider = new ethers.JsonRpcProvider(url, { chainId, name: `hedera-${network}` });
  const keyHex = ensure0x(process.env.HEDERA_EVM_OPERATOR_KEY);
  const wallet = new ethers.Wallet(keyHex, provider);

  try {
    const tx = await wallet.sendTransaction({ to: wallet.address, value: 0n, data });
    const receipt = await tx.wait();
    return {
      anchored: true,
      type: 'evm',
      network,
      tx_hash: tx.hash,
      block_number: receipt?.blockNumber,
      operator_id: process.env.HEDERA_EVM_OPERATOR_ID,
      operator_evm_address: wallet.address,
      hashscan_url: `https://hashscan.io/${network}/transaction/${tx.hash}`,
      submitted_at: new Date().toISOString(),
    };
  } catch (e) {
    return { anchored: false, type: 'evm', error: String(e?.message ?? e) };
  }
}

function b64uToHex(b64u) {
  const b64 = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
  return '0x' + Buffer.from(b64, 'base64').toString('hex');
}

function ensure0x(s) {
  const t = String(s).trim();
  return t.startsWith('0x') ? t : '0x' + t;
}
