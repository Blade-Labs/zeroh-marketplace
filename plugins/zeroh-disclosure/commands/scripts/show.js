#!/usr/bin/env node
import { header, latestSession, latestTurn } from './_helpers.js';

const s = await latestSession();
const t = await latestTurn(s.dir);
if (!t) {
  console.log('No masked turns yet in this session.');
  process.exit(0);
}
const { ledger } = t;
console.log(header(`ZeroH Mask — Turn ${t.t} (${ledger.phase})`));
console.log(`Detected: ${ledger.findings.length} item(s)`);
for (const r of ledger.replacements || []) {
  console.log(`  ${r.replacement}  type=${r.entity_type}  risk=${r.risk}  len=${r.original_length}  commit=${shorten(r.value_commitment)}`);
}
console.log('\nSanitized text the model saw (or would see on re-submit):');
console.log('────────────────────────────────────────');
console.log(ledger.sanitized_text);
console.log('────────────────────────────────────────');

function shorten(s) {
  return String(s).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
}
