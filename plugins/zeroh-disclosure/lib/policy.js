import { qcbAiDisclosurePolicyV1 } from './policies/qcb-ai-disclosure.v1.js';
import { canonicalJson, sha256B64u } from './crypto.js';

export function evaluateDisclosurePolicy({ findings, boundary, policy = qcbAiDisclosurePolicyV1 }) {
  const categories = [...new Set(findings.map((f) => f.type))];
  for (const rule of policy.rules) {
    if (matches(rule.when, { categories, boundary })) {
      return {
        action: rule.action,
        matched_rules: [rule.id],
        reason: rule.reason,
        mask_categories: rule.mask_categories ?? categories,
        approval_required: rule.action === 'approval_required',
        blocked: rule.action === 'block',
      };
    }
  }
  return {
    action: 'allow_with_receipt',
    matched_rules: [],
    reason: 'No matching policy rule; default allow with receipt.',
    mask_categories: [],
    approval_required: false,
    blocked: false,
  };
}

function matches(w = {}, { categories, boundary }) {
  if (w.always) return true;
  if (w.any_category && !w.any_category.some((c) => categories.includes(c))) return false;
  if (w.boundary_type && !w.boundary_type.includes(boundary.boundary_type)) return false;
  if (w.destination_jurisdiction_not && w.destination_jurisdiction_not.includes(boundary.destination_jurisdiction)) return false;
  if (w.retention_not && w.retention_not.includes(boundary.retention)) return false;
  return true;
}

export async function policyHash(policy = qcbAiDisclosurePolicyV1) {
  return sha256B64u(canonicalJson(policy));
}
