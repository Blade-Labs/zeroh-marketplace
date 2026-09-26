#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:mask-config: session directory, signing key, policy and
// protection engine.
import { header, latestSession } from './_helpers.js';
import { POLICY, POLICY_ALIAS } from '../../lib/policy.js';
import { regexLocalProtectionEngine } from '../../lib/protection-engines/regex-local.js';

const s = await latestSession();
console.log(header('ZeroH Disclosure config'));
console.log(`session_dir:   ${s.dir}`);
console.log(`turn_count:    ${s.state.turnCount}`);
console.log(`signing key:   ${s.signingKey.keyId} (local, ECDSA P-256)`);
console.log(`hmac_key:      (32-byte session key on disk; never echoed)`);
console.log(`policy:        ${POLICY.policy_id} (${POLICY_ALIAS})`);
console.log(
  `engine:        ${regexLocalProtectionEngine.id} (local patterns; no network)`,
);

console.log('\nSettings (environment or ~/.zeroh/config.env):');
console.log(
  '  ZEROH_MASK_PII=on|off   (mask emails, cards, IBANs, phones in tool output; default on)',
);
