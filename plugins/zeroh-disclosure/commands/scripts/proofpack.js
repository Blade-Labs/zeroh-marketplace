#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { header, latestSession } from './_helpers.js';

const s = await latestSession();
const entries = await fs.readdir(s.dir).catch(() => []);
const packs = entries.filter((e) => /\.proofpack\.json$/.test(e)).sort();
if (packs.length === 0) {
  console.log('No ProofPacks yet. End a turn to trigger the Stop hook.');
  process.exit(0);
}
const latest = packs.at(-1);
const full = path.join(s.dir, latest);
const buf = await fs.readFile(full, 'utf8');
const pack = JSON.parse(buf);
console.log(header(`ProofPack: ${full}`));
console.log(`schema:           ${pack.schema}`);
console.log(`audience:         ${pack.audience}`);
console.log(`period:           ${pack.period}`);
console.log(`generated_at:     ${pack.generated_at}`);
console.log(`proofpack_hash:   ${pack.proofpack_hash}`);
console.log(`receipts_count:   ${pack.summary.receipts_count}`);
console.log(`decision_counts:  ${JSON.stringify(pack.summary.decision_counts)}`);
console.log(`detected:         ${JSON.stringify(pack.summary.detected_categories)}`);
console.log(`masked:           ${JSON.stringify(pack.summary.masked_categories)}`);
console.log(`raw_seen_by_saas: ${pack.summary.raw_content_seen_by_zeroh_saas}`);
