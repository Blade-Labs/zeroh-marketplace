#!/usr/bin/env node
import { detectorManifest } from '../../lib/detector.js';
import { anchorEnvSummary } from '../../lib/hedera-anchor.js';
import { header, latestSession } from './_helpers.js';

const s = await latestSession();
console.log(header('ZeroH Disclosure config'));
console.log(`session_dir:   ${s.dir}`);
console.log(`turn_count:    ${s.state.turnCount}`);
console.log(`wallet:        ${s.state.sid ? s.state.sid : '(default)'} on ${(await s.wallet.getAccount()).network}`);
console.log(`hmac_key:      (32-byte session key on disk; never echoed)`);

console.log(header('Detector categories'));
for (const c of detectorManifest().categories) {
  console.log(`  ${c.type.padEnd(18)} risk=${c.risk.padEnd(8)} confidence=${c.confidence}`);
}

console.log(header('Hedera anchor'));
const env = anchorEnvSummary();
for (const [k, v] of Object.entries(env)) console.log(`  ${k}: ${v}`);

console.log('\nEnv vars (set in your shell before running Claude Code):');
console.log('  ZEROH_ANCHOR=1');
console.log('  HEDERA_NETWORK=testnet|mainnet');
console.log('  HEDERA_OPERATOR_ID=0.0.xxxx');
console.log('  HEDERA_OPERATOR_KEY=<DER or ED25519 hex>');
console.log('  HEDERA_TOPIC_ID=0.0.yyyy');
