/**
 * measure-budget — the SINGLE home of the do-arc protocol-load budget.
 *
 * The number had drifted into three disagreeing homes (eval-propose's own constant at 12000, the
 * enforced `roadmap measure --assert` in measure.test.mjs at 12500, and DIET-LEDGER.md's prose at
 * 12,000), which is how a proposal pass came to assert a breach the gate did not see. Every reader
 * — the ELICIT pass that cites tokens, the test that gates the real tree, the ledger prose that
 * names the figure — resolves it here, so a re-ratchet is one edit and cannot half-land.
 *
 * The value is the ENFORCED one: what `roadmap measure --flow do-arc --assert <N>` exits 0 against.
 * Strictly greater is a breach; sitting exactly on the budget is within it.
 */

/**
 * Re-ratcheted 12000 → 12500 by user ruling 2026-07-27 (phase 1995 escalation): the tree was
 * already red at 12268 before 1995's four mandated recorder/attribution lines took it to 12442.
 * A hold-the-line number, not a growth allowance — the EVALLOOP diet lane owns winning bytes back.
 */
export const PROTOCOL_LOAD_BUDGET_TOKENS = 12500
