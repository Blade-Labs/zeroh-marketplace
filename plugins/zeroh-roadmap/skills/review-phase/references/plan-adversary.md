# Plan Adversary Catalogue - the mined plan failures, made structural

Used by review-phase Mode A Step V (§A/§B/§C/§E/§F) and Step H3 (§D). Each section: the failure,
the probe that catches it, the disposition. Provenance: 16 arc-eval reports mined 2026-08-13
plus round-1 blind gauntlet feedback 2026-08-13 (§F); per-section arc names below.

## §A - Verify clauses that cannot fail

For EVERY `verify:` clause (step strings carry `→ verify: <command>`), name the **false world**:
the concrete broken state in which this exact command exits non-zero or visibly changes output.
If you cannot name one, the clause is decoration - NEEDS WORK; auto-repair by rewriting to a
falsifiable command. Then run the clause both directions mentally: it must FAIL before the step
lands and PASS after; a clause that passes in both worlds (or fails in both) is broken.
(UCAUDIT: 8 of 20 member phases shipped an unfalsifiable verify.)

Grade these shapes on sight, no benefit of the doubt:
- **Prose instead of a command** ("confirm it works", "check the output renders").
- **Exit-0-always tails**: `… | wc -l`, `… | head`, `… || true`, `…; echo done` - the pipeline
  reports the tail's exit, and the tail cannot fail.
- **Self-colliding positive grep**: greps for text ANOTHER step of the same phase also adds to
  the same file - it goes green the moment any task lands, proving nothing about this step.
- **Self-colliding negative grep**: asserts a pattern is absent while the plan itself introduces
  that pattern in a comment, string, or test fixture.
- **Runner outside the tier commands**: bare `node --test` / bare `vitest` lose their env under
  capbuild and report green having run ZERO tests. Only the consumer `gateCommands` runners are
  trusted, e.g. `bash scripts/test/run-tier.sh unit-scoped <file>`.
- **Regex/literal mismatch**: an ERE silently missing a literal code fragment - optional-chaining
  `?.`, `$` in template strings, escaped quotes. Auto-repair to `grep -F` for any literal-code
  pattern (commit `98bfbf549`: the ERE missed the optional-chaining dot; the fix was `-F`).
- **Single-phrasing closure grep**: a clause that claims "no other occurrences" by grepping ONE
  literal sentence. It structurally cannot find a differently-worded sibling (a comment, a
  bind-site note). Auto-repair: re-key to the durable code token per the skill's Evidence rules
  (round-1 blind: a closure declared on one phrasing missed the real drift site).

## §B - Stale or misspelled anchors

Open every `steps[].file` (and optional `line`) and confirm the named function/symbol is there
NOW, not at planning time. Search the symbol case-INsensitively first (`grep -rin`, bounded
dirs), then exactly: a case-variant symbol name produced a tripwire false-negative (FLUENTFRONT).
Wrong-but-relocatable anchor = auto-repair `[FIXED]`. Symbol absent from the repo entirely = the
`problem` may not exist → escalate to the Step V source-confirms BLOCKER lane.

## §C - Criteria that only pin the initial state

For each `acceptanceCriteria` entry ask: does it still bind on the SECOND encounter - the warm
cache, the populated store, the re-run, real prod data density? A feature with recurring state
whose every criterion pins only the cold path is unproven where it will actually live
(BRAINVIEW: a cold-layout-only geometry criterion left the fix inert at prod density; caught
only by validate-arc). Auto-repair: add or reword a criterion naming the steady-state observable
and the command that shows it.

## §D - Promise ledger (feeds Step H3)

Extract every commitment sentence from the phase docblock/overview - "appends to X", "updates
Y", "ships Z" (arc reviews: the arc's `honestyRails` and acceptance criteria too). Build the
table: promise → the task.step that fulfills it. An unmapped promise is a finding:
- an existing step covers it and only the mapping/wording was missing → auto-repair the wording;
- fulfilling it would be NEW work → report-only (new scope needs an owner), blocks queueing.
(FLUENTFRONT: a set every member phase's docblock claimed to append to shipped EMPTY; nothing
upstream of validate-arc noticed.)

## §E - Decision-deferral scan

Scan task text for either/or language: "or ", "either", "choose", "decide during execution",
"TBD", option lists, `[NEEDS CLARIFICATION]`. A load-bearing decision left unmade surfaces as a
mid-execution escalation (EVALCORE: the same decision escalated twice inside one task).
- The code resolves it → auto-repair to the resolved arm, citing the file that decided it.
- The code cannot resolve it (product choice, owner ruling) → Step H verdict QUESTION,
  report-only, blocks queueing until ruled.

## §F - Prose-mechanism drift

The plan's descriptive prose about the EXISTING mechanism is a claim like any anchor: what keys
a tolerance (an error code vs an HTTP status), what a route returns, what a flag gates, which
store a write lands in. Verify each such characterization against the deciding source file. A
mischaracterization left standing means the phase would swap one inaccurate description for
another in whatever surface repeats the prose (console copy, docs, comments) even when the code
change itself is right (round-1 blind: a tolerance described as 400-status-keyed was code-keyed;
the winning review was the only one that repaired the wording). Disposition: auto-repair the
plan wording `[FIXED]`, citing the file that decided it; if the true mechanism cannot be
determined from source, report-only as a QUESTION.
