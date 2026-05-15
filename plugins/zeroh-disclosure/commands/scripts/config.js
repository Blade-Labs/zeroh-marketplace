#!/usr/bin/env node
import { anchorEnvSummary } from '../../lib/hedera-anchor.js';
import { evmAnchorEnvSummary } from '../../lib/evm-anchor.js';
import { header, latestSession } from './_helpers.js';
import { listPolicies, resolveActivePolicy } from '../../lib/policy-registry.js';
import { protectionEngineStatus } from '../../lib/disclosure.js';

const s = await latestSession();
const { policy, alias } = await resolveActivePolicy({ cwd: process.cwd(), sessionState: s.state });
console.log(header('ZeroH Disclosure config'));
console.log(`session_dir:   ${s.dir}`);
console.log(`turn_count:    ${s.state.turnCount}`);
console.log(`wallet:        ${s.state.sid ? s.state.sid : '(default)'} on ${(await s.wallet.getAccount()).network}`);
console.log(`hmac_key:      (32-byte session key on disk; never echoed)`);
console.log(`policy:        ${policy.policy_id} (${alias})`);

console.log(header('Policies'));
for (const p of listPolicies()) {
  console.log(`  ${p.policy_id.padEnd(28)} aliases=${(p.aliases || []).join(', ') || '-'}`);
}

console.log(header('Protection engines'));
for (const e of await protectionEngineStatus({ policy })) {
  console.log(`  ${e.id.padEnd(14)} ${e.ok ? 'ok' : `unavailable (${e.error})`}`);
}

console.log(header('Hedera anchor'));
const env = anchorEnvSummary();
for (const [k, v] of Object.entries(env)) console.log(`  ${k}: ${v}`);
const evm = evmAnchorEnvSummary();
for (const [k, v] of Object.entries(evm)) console.log(`  evm_${k}: ${v}`);

console.log('\nEnv vars (set in your shell before running Claude Code):');
console.log('  ZEROH_POLICY=blade|qcb');
console.log('  ZEROH_PROTECTION_ENGINE=regex-local|presidio-http');
console.log('  PRESIDIO_ANALYZER_URL=http://localhost:5002/analyze');
console.log('  PRESIDIO_ANONYMIZER_URL=http://localhost:5001/anonymize');
console.log('  ZEROH_ANCHOR=1');
console.log('  HEDERA_NETWORK=testnet|mainnet');
console.log('  HEDERA_OPERATOR_ID=0.0.xxxx');
console.log('  HEDERA_OPERATOR_KEY=<DER or ED25519 hex>');
console.log('  HEDERA_TOPIC_ID=0.0.yyyy');
