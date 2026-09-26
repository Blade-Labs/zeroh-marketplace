// SPDX-License-Identifier: AGPL-3.0-only

import { PERSONAL_DATA_KINDS } from '../pii/index.js';

// The one policy the plugin applies. Each receipt records which rule matched:
// credentials (keys, passwords, tokens, secrets) are blocked, personal data is
// masked, and everything else is allowed with a receipt. A hook that does
// something else with the text (the proxy masks and sends it; without the
// proxy any finding stops the prompt) records that action instead. The rules name what was found, never a regulator.
// Names and currency amounts are not masked by the free policy: they need
// context-aware detection, which is Premium. Every kind lib/pii detects is
// masked; ACCOUNT_NUMBER is no longer detected, but a value the user reported
// under it (or a vault entry from an earlier version) is still masked.
const PERSONAL_DATA = [
  ...PERSONAL_DATA_KINDS.map(({ type }) => type),
  'ACCOUNT_NUMBER',
];

export const zerohDisclosurePolicyV1 = {
  policy_id: 'zeroh-disclosure-v1',
  aliases: ['disclosure', 'zeroh', 'default'],
  name: 'ZeroH Disclosure Policy v1',
  version: '1.0.0',
  raw_content_seen_by_zeroh_saas: false,
  rules: [
    {
      id: 'ZEROH-BLOCK-SECRETS',
      action: 'block',
      when: {
        any_category: ['API_KEY', 'PRIVATE_KEY', 'PASSWORD', 'TOKEN', 'SECRET'],
      },
      reason: 'Secrets, passwords, tokens and private keys are blocked.',
    },
    {
      id: 'ZEROH-MASK-PERSONAL-DATA',
      action: 'mask_and_allow',
      when: { any_category: PERSONAL_DATA },
      mask_categories: PERSONAL_DATA,
      reason: 'Personal data was masked before sending.',
    },
    {
      id: 'ZEROH-ALLOW-WITH-RECEIPT',
      action: 'allow_with_receipt',
      when: { always: true },
      reason: 'Nothing to mask or block; a receipt is still recorded.',
    },
  ],
};
