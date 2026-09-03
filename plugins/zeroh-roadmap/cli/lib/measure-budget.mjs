/**
 * measure-budget — the SINGLE home of the do-arc protocol-load budget: the MEASURED load at the
 * last ratification under the operator's standing ruling, moved only by a diet (down) or a new
 * ruling (up). Every reader resolves it here — the `roadmap measure --flow do-arc --assert` gate
 * (cli/commands/measure.test.mjs), the ELICIT pass (cli/lib/eval-propose.mjs), and DIET-LEDGER.md's
 * prose — so a re-ratchet is one edit and cannot half-land.
 *
 * The value is the ENFORCED one: what `roadmap measure --flow do-arc --assert <N>` exits 0 against.
 * Strictly greater is a breach; sitting exactly on the budget is within it.
 *
 * The router's Layout rule is a CORRECTNESS fix, not accretion: without it half of consumers read
 * paths that do not exist there. Its measured load is therefore ratcheted into the enforced value
 * rather than dieted away; the standing zero-growth bar remains unchanged.
 */
export const PROTOCOL_LOAD_BUDGET_TOKENS = 11065
