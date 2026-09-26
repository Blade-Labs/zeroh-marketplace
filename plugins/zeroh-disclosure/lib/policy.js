// SPDX-License-Identifier: AGPL-3.0-only

// Evaluates the disclosure policy against detection findings and hashes the
// policy so a receipt can prove which rules applied.
import { zerohDisclosurePolicyV1 } from './policies/zeroh-disclosure.v1.js';
import { canonicalJson, sha256B64u } from './crypto.js';

// The plugin ships one policy; receipts name it by id and by this alias.
export const POLICY = zerohDisclosurePolicyV1;
export const POLICY_ALIAS = 'disclosure';

// The policy a receipt names, for the verifier to recompute its hash.
export function policyById(id) {
  if (id === POLICY.policy_id) return POLICY;
  throw new Error(`Unknown ZeroH policy "${id}"`);
}

export function evaluateDisclosurePolicy({
  findings,
  policy = zerohDisclosurePolicyV1,
}) {
  const categories = [...new Set(findings.map((f) => f.type))];
  for (const rule of policy.rules) {
    if (matches(rule.when, categories)) {
      return {
        action: rule.action,
        matched_rules: [rule.id],
        reason: rule.reason,
        // Only what this prompt contained, so the receipt records what was
        // masked rather than the rule's whole list.
        mask_categories: rule.mask_categories
          ? categories.filter((c) => rule.mask_categories.includes(c))
          : categories,
        blocked: rule.action === 'block',
      };
    }
  }
  return {
    action: 'allow_with_receipt',
    matched_rules: [],
    reason: 'No matching policy rule; default allow with receipt.',
    mask_categories: [],
    blocked: false,
  };
}

function matches(w = {}, categories) {
  if (w.always) return true;
  if (w.any_category && !w.any_category.some((c) => categories.includes(c)))
    return false;
  return true;
}

export async function policyHash(policy = zerohDisclosurePolicyV1) {
  return sha256B64u(canonicalJson(policy));
}
