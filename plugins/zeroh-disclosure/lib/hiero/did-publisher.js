// Wraps @hiero-did-sdk/registrar so the bootstrap script (and any future
// re-key flow) routes through a single helper. Publishes a did:hedera v2.0
// document to a fresh HCS topic, paid for by an explicit funded operator.
//
// Why this exists: @hiero-did-sdk's `createDID` is a clean one-shot but the
// argument shape is shared between operator/agent identities and easy to get
// wrong. This wrapper normalizes naming (operator vs agent) and key formats
// (hex strings vs PrivateKey objects).

import { createDID } from '@hiero-did-sdk/registrar';
import { PrivateKey } from '@hashgraph/sdk';

/**
 * Publish an agent's did:hedera v2.0 document to a fresh HCS topic.
 *
 * The operator account pays for the topic-create and message-submit fees.
 * The agent's Ed25519 key is the `did-root-key` verification method and the
 * topic's submit key (so only the agent can later mutate its own DID doc —
 * acceptable for V1; multi-controller is a Phase F-2 hardening item).
 *
 * @param {object} args
 * @param {'mainnet'|'testnet'|'previewnet'} args.network
 * @param {{ accountId: string, privateKey: string | PrivateKey }} args.operator
 *   Funded Hedera account that pays. `privateKey` may be a DER-prefixed hex
 *   string or an already-loaded `PrivateKey`.
 * @param {PrivateKey} args.agentPrivateKey  Ed25519 PrivateKey; the agent's
 *   identity key. The corresponding public key lands in the DID document.
 * @returns {Promise<{ did: string, didDocument: object }>}
 */
export async function publishAgentDid({ network, operator, agentPrivateKey }) {
  if (!network) throw new Error('publishAgentDid: network required');
  if (!operator?.accountId) throw new Error('publishAgentDid: operator.accountId required');
  if (!operator?.privateKey) throw new Error('publishAgentDid: operator.privateKey required');
  if (!agentPrivateKey) throw new Error('publishAgentDid: agentPrivateKey required');

  const operatorKey = typeof operator.privateKey === 'string'
    ? PrivateKey.fromStringED25519(operator.privateKey)
    : operator.privateKey;

  const result = await createDID(
    { privateKey: agentPrivateKey },
    {
      clientOptions: {
        accountId: operator.accountId,
        privateKey: operatorKey,
        network,
      },
    },
  );

  return {
    did: result.did,
    didDocument: result.didDocument,
  };
}
