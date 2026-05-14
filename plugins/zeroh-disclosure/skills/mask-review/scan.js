#!/usr/bin/env node
import { loadConfig } from '../../lib/config.js';
import { detectSensitiveData } from '../../lib/detector.js';
import { maskText } from '../../lib/mask.js';
import { randomBytes } from '../../lib/crypto.js';

await loadConfig({ cwd: process.cwd() });

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const text = raw.replace(/\n$/, '');

const findings = detectSensitiveData(text);

if (findings.length === 0) {
  console.log('ZeroH Disclosure: no sensitive data detected.');
  console.log('');
  console.log('The passage is safe to send as-is by the current rule set.');
  process.exit(0);
}

const masked = await maskText(text, findings, { hmacKeyBytes: randomBytes(32) });

const byType = {};
for (const r of masked.replacements) byType[r.entity_type] = (byType[r.entity_type] ?? 0) + 1;

console.log(`ZeroH Disclosure: ${masked.replacements.length} item(s) detected.`);
console.log(
  `Categories: ${Object.entries(byType)
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t))
    .join(', ')}`,
);
console.log('');
console.log('Tokenized rewrite (safe to paste):');
console.log('────────────────────────────────────────');
console.log(masked.sanitized_text);
console.log('────────────────────────────────────────');
console.log('');
console.log('Token map (this session only):');
for (const r of masked.replacements) {
  console.log(`  ${r.replacement}  type=${r.entity_type}  risk=${r.risk}  positions=${r.start}..${r.end}`);
}
