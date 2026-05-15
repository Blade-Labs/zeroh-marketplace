// VI constraint checker — one entry per `type` value in the L2 mandate.
// Mirrors the registry in verifiable-intent/src/verifiable_intent/models/
// constraints.py. Each check returns a plain `{ satisfied, reason }` so the
// caller can aggregate violations without try/catch.

const CHECKS = {
  'mandate.checkout.allowed_merchants': (c, f) => {
    if (!f?.merchant) return fail('missing fulfillment field: merchant');
    const m = f.merchant;
    const ok = (c.allowed || []).some((a) => matchParty(a, m));
    return ok ? pass() : fail(`merchant ${describeParty(m)} not in allowed_merchants`);
  },

  'mandate.checkout.line_items': (c, f) => {
    if (!Array.isArray(f?.line_items)) return fail('missing fulfillment field: line_items');
    const constraintItems = c.items || [];
    const mode = c.match_mode === 'exact' ? 'exact' : 'subset';
    // Each fulfillment line item must be allowed and quantity within cap.
    for (const item of f.line_items) {
      const ci = constraintItems.find((x) =>
        (x.id && x.id === item.id) || (x.acceptable_items || []).includes(item.id),
      );
      if (!ci) return fail(`line item ${item.id} not allowed`);
      if (typeof ci.quantity === 'number' && (item.quantity || 0) > ci.quantity) {
        return fail(`line item ${item.id} quantity ${item.quantity} exceeds cap ${ci.quantity}`);
      }
    }
    if (mode === 'exact' && f.line_items.length !== constraintItems.length) {
      return fail(`exact line_items required ${constraintItems.length} entries, got ${f.line_items.length}`);
    }
    return pass();
  },

  'mandate.payment.allowed_payees': (c, f) => {
    if (!f?.payee) return fail('missing fulfillment field: payee');
    const ok = (c.allowed || []).some((a) => matchParty(a, f.payee));
    return ok ? pass() : fail(`payee ${describeParty(f.payee)} not in allowed_payees`);
  },

  'mandate.payment.amount_range': (c, f) => {
    if (typeof f?.amount !== 'number') return fail('missing fulfillment field: amount');
    if (c.currency && f.currency && c.currency !== f.currency) {
      return fail(`currency ${f.currency} ≠ constraint ${c.currency}`);
    }
    if (typeof c.min === 'number' && f.amount < c.min) {
      return fail(`amount ${f.amount} below min ${c.min} ${c.currency}`);
    }
    if (typeof c.max === 'number' && f.amount > c.max) {
      return fail(`amount ${f.amount} above max ${c.max} ${c.currency}`);
    }
    return pass();
  },

  'mandate.payment.budget': (c, f) => {
    // SPEC AMBIGUITY: budget is normally cumulative across a window (e.g.
    // monthly). The v1 plugin can't see prior transactions across sessions,
    // so we only enforce that THIS single amount is within budget.max. The
    // network/issuer is expected to enforce the cumulative bound.
    if (typeof f?.amount !== 'number') return fail('missing fulfillment field: amount');
    if (c.currency && f.currency && c.currency !== f.currency) {
      return fail(`currency ${f.currency} ≠ budget ${c.currency}`);
    }
    if (typeof c.max === 'number' && f.amount > c.max) {
      return fail(`amount ${f.amount} exceeds budget ${c.max} ${c.currency}`);
    }
    return pass();
  },

  'mandate.payment.recurrence': (c) => {
    // SPEC AMBIGUITY: recurrence is enforced by the payment network at
    // schedule time; a single tool call has no recurrence dimension. v1
    // marks this as satisfied and lets downstream verifiers cross-check.
    void c;
    return pass();
  },

  'mandate.payment.agent_recurrence': (c) => {
    // Same posture as recurrence: out-of-band for the per-call gate.
    void c;
    return pass();
  },

  'mandate.payment.reference': (c, f) => {
    if (!c.conditional_transaction_id) return pass();
    if (!f?.reference) return fail('missing fulfillment field: reference (mandate requires conditional_transaction_id)');
    if (f.reference !== c.conditional_transaction_id) {
      return fail(`reference ${f.reference} ≠ mandate.conditional_transaction_id ${c.conditional_transaction_id}`);
    }
    return pass();
  },
};

/**
 * Run every constraint in a list against a fulfillment object.
 * Returns the full failure list (not just the first) so the user sees the
 * full picture.
 *
 * @param {object[]} constraints  Array of L2 constraints (any of the 8 types)
 * @param {object} fulfillment    Normalized commerce fulfillment.
 * @returns {{ satisfied: boolean, violations: { type: string, reason: string }[] }}
 */
export function evaluateConstraints(constraints, fulfillment) {
  const violations = [];
  for (const c of constraints || []) {
    const check = CHECKS[c.type];
    if (!check) {
      violations.push({ type: c.type, reason: `unknown constraint type ${c.type}` });
      continue;
    }
    const r = check(c, fulfillment);
    if (!r.satisfied) violations.push({ type: c.type, reason: r.reason });
  }
  return { satisfied: violations.length === 0, violations };
}

// helpers ---------------------------------------------------------------------

function pass() { return { satisfied: true }; }
function fail(reason) { return { satisfied: false, reason }; }

function matchParty(allowed, given) {
  if (allowed.id && given.id && allowed.id === given.id) return true;
  if (allowed.website && given.website && allowed.website === given.website) return true;
  if (allowed.name && given.name && allowed.name.toLowerCase() === given.name.toLowerCase()) return true;
  return false;
}

function describeParty(p) {
  return p?.id || p?.website || p?.name || '<unknown>';
}
