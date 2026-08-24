/**
 * measure-budget — the SINGLE home of the do-arc protocol-load budget: the MEASURED load at the
 * last ratification (operator ruling 2026-08-24), moved only by a diet (down) or a dated ruling
 * (up). Every reader resolves it here — the `roadmap measure --flow do-arc --assert` gate
 * (cli/commands/measure.test.mjs), the ELICIT pass (cli/lib/eval-propose.mjs), and DIET-LEDGER.md's
 * prose — so a re-ratchet is one edit and cannot half-land.
 *
 * The value is the ENFORCED one: what `roadmap measure --flow do-arc --assert <N>` exits 0 against.
 * Strictly greater is a breach; sitting exactly on the budget is within it.
 */
export const PROTOCOL_LOAD_BUDGET_TOKENS = 13257
