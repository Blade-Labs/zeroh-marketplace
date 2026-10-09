// SPDX-License-Identifier: AGPL-3.0-only

import '../helpers.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unionFindings } from '../../vendor/sensitive-data-detectors/src/detector.js';
import { maskText } from '../../packages/zeroh-disclosure-core/mask.js';
import { evaluateDisclosurePolicy } from '../../packages/zeroh-disclosure-core/policy.js';
import { scrub } from '../../packages/shell-analysis/secrets.js';
import { detectSensitiveData } from '../../packages/zeroh-disclosure-core/detector.js';
import { inputFindings } from '../../packages/zeroh-disclosure-core/tool-policies.js';
import { monorepoOnly } from '../monorepo.mjs';

const text = 'ZEROH' + 'FAKE-COVER-9!';
const finding = (type, start, end, generic = false) => ({
  type,
  start,
  end,
  length: end - start,
  risk: 'high',
  confidence: 1,
  ...(generic ? { generic: true } : {}),
});
const specific = [finding('PASSWORD', 3, 8), finding('PRIVATE_KEY', 9, 13)];
const cover = [finding('API_KEY', 0, text.length, true)];

test(
  'all corpora and design rows retain non-generic characters after every downstream filter in every context',
  {
    skip: monorepoOnly(
      'packages/sensitive-data-detectors/test/union-corpus.mjs',
    ),
  },
  async (t) => {
    const { coverageInputs, contexts } =
      await import('../../../../../../packages/sensitive-data-detectors/test/union-corpus.mjs');
    let comparisons = 0;
    const covers = (findings, span) =>
      findings.some((f) => f.start <= span.start && f.end >= span.end);
    for (const [id, input] of coverageInputs())
      for (const profile of ['prompt', 'tool', 'secrets']) {
        const unknown = detectSensitiveData(input, {
          profile,
          region: null,
        }).filter((f) => !f.generic);
        if (!unknown.length) continue;
        for (const context of contexts) {
          const options = { profile, region: null, ...context };
          const merged = detectSensitiveData(input, options);
          if (profile === 'secrets') {
            const kept = inputFindings(input, options);
            for (const span of unknown)
              assert.ok(
                covers(kept, span),
                `${id}: real input filter retains specific characters`,
              );
          }
          for (const type of new Set(unknown.map((f) => f.type))) {
            const spans = unknown.filter((f) => f.type === type);
            const policy = {
              rules: [
                {
                  id: 'specific',
                  when: { any_category: [type] },
                  action: 'mask_and_allow',
                  mask_categories: [type],
                },
              ],
            };
            const decision = evaluateDisclosurePolicy({
              findings: merged,
              policy,
            });
            const masked = await maskText(input, merged, {
              hmacKeyBytes: new Uint8Array(32).fill(7),
              categoriesToMask: decision.mask_categories,
            });
            for (const span of spans)
              assert.ok(
                covers(masked.replacements, span),
                `${id}/${profile}: real category filters retain specific characters`,
              );
            const registered = new Set();
            scrub(input, {
              vault: {
                entries: new Map(),
                tokenFor: (kind, raw) => {
                  registered.add(raw);
                  return `[${kind}-test]`;
                },
              },
              known: [],
              ...options,
              detectFindings: () => merged,
              // Grant every other class: the retained class must still mask.
              unmaskedTypes: [
                ...new Set(
                  merged.flatMap((f) => f.protectionTypes ?? [f.type]),
                ),
              ].filter((kind) => kind !== type),
            });
            const protectedFindings = merged.filter((f) =>
              registered.has(input.slice(f.start, f.end)),
            );
            for (const span of spans)
              assert.ok(
                covers(protectedFindings, span),
                `${id}/${profile}: real grant filter retains specific characters`,
              );
            comparisons += 1;
          }
        }
      }
    t.diagnostic(
      `${comparisons} context/profile/type comparisons through the actual filters`,
    );
  },
);

for (const reverse of [false, true])
  test(`union filters preserve specific classes through a generic covering chain (${reverse})`, async () => {
    const merged = unionFindings(
      ...(reverse ? [cover, specific] : [specific, cover]),
    );
    assert.equal(merged.length, 1);
    assert.ok(!merged[0].generic);
    assert.ok(['PASSWORD', 'PRIVATE_KEY'].includes(merged[0].type));
    assert.deepEqual(
      new Set(merged[0].protectionTypes),
      new Set(['PASSWORD', 'PRIVATE_KEY']),
    );
    for (const type of ['PASSWORD', 'PRIVATE_KEY']) {
      const policy = {
        rules: [
          {
            id: 'specific',
            when: { any_category: [type] },
            action: 'mask_and_allow',
            mask_categories: [type],
          },
        ],
      };
      const decision = evaluateDisclosurePolicy({ findings: merged, policy });
      assert.deepEqual(decision.mask_categories, [type]);
      const result = await maskText(text, merged, {
        hmacKeyBytes: new Uint8Array(32).fill(7),
        categoriesToMask: decision.mask_categories,
      });
      assert.equal(
        result.replacements.length,
        1,
        `${type}: category filter keeps the cover`,
      );
      assert.ok(!result.sanitized_text.includes(text));
      const masked = scrub(text, {
        vault: { entries: [], tokenFor: () => '[SECRET-test]' },
        known: [],
        detectFindings: () => merged,
        unmaskedTypes: [type],
      });
      assert.equal(
        masked.replacements.length,
        1,
        `${type}: one grant cannot expose the other class`,
      );
    }
    const revealed = scrub(text, {
      vault: { entries: [], tokenFor: () => '[SECRET-test]' },
      known: [],
      detectFindings: () => merged,
      unmaskedTypes: ['PASSWORD', 'PRIVATE_KEY'],
    });
    assert.equal(
      revealed.text,
      text,
      'all specific classes granted can reveal the cover',
    );
  });
