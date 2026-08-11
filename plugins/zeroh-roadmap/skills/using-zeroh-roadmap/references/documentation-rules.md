# Documentation rules

The one standard every doc-producing surface cites. A document that fails a rule is
edited or deleted, never explained.

## The four principles

1. **Clear and concise** — skimmable: headings, tables, bullets. No jargon, no walls
   of prose. A reader finds their answer by scanning, not reading.
2. **No duplication** — one source of truth per fact; hyperlink to it instead of
   restating it. A second copy is where staleness is born.
3. **Timeless** — concepts and patterns, never dates, version numbers, or volatile
   paths/line numbers that rot. If a fact will be false in a month, it belongs in a
   report, not a doc.
4. **Current** — an outdated doc causes more friction than a missing one. Touching a
   doc means leaving the WHOLE doc true; delete or fix stale text on sight.

## The decision bar

Docs describe the **as-built** architecture. A standalone decision record exists only
when the decision is CRITICAL — one of:

- a boundary contract (something another team or repo builds against),
- a security/privacy posture,
- expensive to reverse,

— or when the user explicitly says "document this". Every other choice lives in the
phase's `transparencyReport` and dies with the phase. An ordinary implementation
choice never mints a doc.

## Evidence is not documentation

Verification records, audit sweeps, fix logs, screenshots, parity captures: gate-report
and `transparencyReport` material. They prove work happened; they do not describe the
system. Nothing of that class lands under `docs/`.

## Examples

| Bad | Good |
| --- | --- |
| `DECISION-2026-07-14-retry-backoff.md` explaining a retry constant | the constant's own comment states the non-obvious WHY; the choice is in the transparencyReport |
| "As of v0.43.0 the console (see src/routes/console.ts:214)…" | "The console reads ledger and stores only" — the code is the line-number authority |
| A 300-line VERIFICATION.md of command outputs | the gate report carries the run; docs/ stays architecture |
