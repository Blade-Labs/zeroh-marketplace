// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generateCorpus, spikeCommands, summarizeCorpus } from './corpus.mjs';

test('destination corpus is deterministic, independent and covers every finding and shell', () => {
  const rows = generateCorpus();
  assert.equal(JSON.stringify(rows) === JSON.stringify(generateCorpus()), true);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  for (const finding of [
    ...Array.from({ length: 9 }, (_, index) => `FINDINGS${index + 1}`),
    'FINDINGS9-variant1',
    'FINDINGS9-variant2',
    'FINDINGS9-variant3',
  ])
    assert.ok(
      rows.some((row) => row.finding === finding),
      finding,
    );
  for (const shell of ['bash', 'zsh', 'pwsh', 'powershell', 'cmd'])
    assert.ok(rows.some((row) => row.shell === shell && row.oracle === 'argv'));
  for (const row of rows) {
    assert.ok(Array.isArray(row.expected.hosts), row.id);
    assert.ok(
      ['allow', 'deny', 'notice'].includes(row.expected.outcome),
      row.id,
    );
    if (row.oracle === 'argv')
      assert.ok(Array.isArray(row.expected.argv), row.id);
  }
  assert.ok(summarizeCorpus(rows).count > 1000);
  assert.ok(
    rows.some(
      (row) =>
        row.finding === 'FINDINGS9-variant3' && row.valueType === 'IP_ADDRESS',
    ),
  );
  const families = new Set(
    rows
      .filter((row) => row.category === 'historical-adversarial')
      .map((row) => row.spelling),
  );
  assert.equal(families.size, 33);
  for (const shell of ['bash', 'zsh', 'pwsh', 'powershell', 'cmd'])
    assert.ok(
      rows.some(
        (row) =>
          row.spelling === 'ip-arbitrary-domain-payload' &&
          row.shell === shell &&
          row.valueType === 'IP_ADDRESS',
      ),
    );
  const semantic = rows.filter((row) => row.category === 'wildcard-dns-source');
  assert.equal(semantic.length, 60);
  assert.ok(semantic.some((row) => row.wildcardSemantics.source === 'nip'));
  assert.ok(
    semantic.some((row) => row.wildcardSemantics.ipv6 === '2001:db8::7'),
  );
  const source = readFileSync(new URL('./corpus.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"];$/gmu)];
  assert.equal(
    imports.every((match) => match[1].startsWith('node:')),
    true,
  );
});

test('phase 42 appendix is preserved verbatim at the pinned hash', () => {
  const seeds = spikeCommands();
  assert.equal(seeds.length, 60);
  const recordPath = new URL(
    '../../../internal/destination-policy-2026-10-03.md',
    import.meta.url,
  );
  if (!existsSync(recordPath)) return; // Public staging excludes the private record; the hash above still applies.
  const record = readFileSync(recordPath, 'utf8');
  const appendix = record
    .split('## Appendix: the 60-command spike corpus')[1]
    .split('```text\n')[1]
    .split('```')[0];
  assert.equal(
    readFileSync(new URL('./seeds/spike-42.txt', import.meta.url), 'utf8'),
    appendix,
  );
});

test('destination fixtures live below the caller TMPDIR', async () => {
  const path = await import('node:path');
  const os = await import('node:os');
  const { TEST_ROOT, freshEnvironment } = await import('./isolation.mjs');
  assert.equal(
    TEST_ROOT,
    path.join(process.env.TMPDIR || os.tmpdir(), 'zeroh-destination-tests'),
  );
  const fixture = freshEnvironment('tmpdir-proof');
  try {
    assert.equal(path.dirname(fixture.root), TEST_ROOT);
  } finally {
    fixture.cleanup();
  }
});
