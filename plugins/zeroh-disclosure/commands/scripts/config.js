#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// /zeroh-disclosure:mask-config: session directory, signing key, policy and
// protection engine.
import { header, latestSession } from './_helpers.js';
import { zerohHome } from '../../packages/zeroh-disclosure-core/vault.js';
import {
  POLICY,
  POLICY_ALIAS,
} from '../../packages/zeroh-disclosure-core/policy.js';
import { regexLocalProtectionEngine } from '../../packages/zeroh-disclosure-core/protection-engines/regex-local.js';

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

console.log(`\nSettings (environment or ${zerohHome()}/config.env):`);
console.log(
  '  ZEROH_MASK_PII=on|off   (output hook only; proxy still masks personal data; default on)',
);
console.log(
  '  Other settings: see README.md, Settings (uncertain mode, retention, routing and display).',
);
