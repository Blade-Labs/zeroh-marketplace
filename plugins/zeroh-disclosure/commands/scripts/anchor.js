#!/usr/bin/env node
import { anchorEnvSummary } from '../../lib/hedera-anchor.js';
import { header, latestSession, latestTurn } from './_helpers.js';

const s = await latestSession();
const t = await latestTurn(s.dir);
console.log(header('Hedera anchor status'));
const env = anchorEnvSummary();
console.log(`anchoring_enabled: ${env.enabled}`);
console.log(`network:           ${env.network}`);
console.log(`operator_id:       ${env.operator_id ?? '(not set)'}`);
console.log(`topic_id:          ${env.topic_id ?? '(not set)'}`);
console.log(`operator_key:      ${env.has_operator_key ? '(present)' : '(missing)'}`);

if (!t || !t.ledger.anchor) {
  console.log('\nNo anchor result yet for the latest turn.');
  process.exit(0);
}
const a = t.ledger.anchor;
console.log(header(`Latest turn ${t.t} anchor`));
if (a.anchored) {
  console.log(`tx_id:              ${a.tx_id}`);
  console.log(`topic_id:           ${a.topic_id}`);
  console.log(`sequence_number:    ${a.sequence_number}`);
  console.log(`hashscan tx:        ${a.hashscan_url}`);
  if (a.topic_id && a.network) {
    console.log(`hashscan topic:     https://hashscan.io/${a.network}/topic/${a.topic_id}`);
    console.log(`mirror node:        https://${a.network}.mirrornode.hedera.com/api/v1/topics/${a.topic_id}/messages?limit=10&order=desc`);
  }
} else {
  console.log(`not anchored: ${a.error || a.reason}`);
}
