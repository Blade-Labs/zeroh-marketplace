import { canonicalJson } from './crypto.js';

export function anchorIntentToHederaMessage(anchorIntent) {
  if (anchorIntent.type !== 'hedera_hcs_topic_message_submit_intent') {
    throw new Error('Unsupported anchor intent type');
  }
  return canonicalJson(anchorIntent.message);
}
