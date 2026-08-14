# Verify rehearsal: run checks both directions before writing them

A verify must fail ONLY when its claim is false. A verify that fires backwards is worse than none:
a red one sends the executor to "escalate" over healthy code, and a green one certifies work nobody
did. This is the single most repeated authoring defect on record: arc SEODESKFIX produced four
backward verifies across three phases, written by four different authors; in arc UCAUDIT, 8 of 20
member phases carried a verify that could not fail. Rehearsal makes the defect structurally hard:
you do not reason about polarity, you EXECUTE both directions at plan time.

## Where rehearsal runs: never in the shared checkout

Rehearsal is read-and-probe, never edit. Do not apply the diff-to-be to the shared tree, do not
`git reset`/`git stash`/`git clean` sibling state to get a clean run (consumer CLAUDE.md
shared-tree rules; discarding a sibling session's in-flight work is unrecoverable). A rehearsal
that needs a mutated file (item 4's dry-run, or confirming a red-now clause goes green once the
symbol exists) uses a scratch COPY under the session scratchpad, or a throwaway
`git worktree add <scratchdir>/rehearse HEAD` removed with `git worktree remove` afterward.
Dry-run greps with `grep -F` (fixed strings) against explicit paths; never an unbounded regex on
this shared host, and never any regex against a minified file.

## The rehearsal protocol (per clause, during Step 3)

1. **`assumptions[].verify` claims CURRENT truth. Execute it now; expect exit 0.**
   - Red now = the assumption is already false: the plan changes NOW (Prime Rule 2), not at
     execution time.
   - Green now: name the falsifier in one clause (what concrete change to the tree would flip it
     red). If you cannot name one, the check is vacuous; rewrite it until you can.

2. **A step's `→ verify: <command>` claims POST-diff truth. Execute it now; expect non-zero.**
   - Green now = vacuous: it passes before the work exists, so it certifies nothing. Rewrite so
     that today's tree reds it.
   - Red now: confirm the FAILURE REASON is exactly what the task's diff removes (the symbol the
     task adds is missing; the test naming the new behavior fails on the new behavior). Red for a
     reason the diff will not touch (missing loader, wrong script name, a file no task creates) is
     the wrong-invocation shape: it fails identically whether the work succeeded or not.

3. **`→ verify: <observable>` clauses** (`dashboard shows $48`, `card renders the title`) are
   exempt from execution but must name a concrete surface AND the expected value. "Works
   correctly" / "verified" are not observables.

4. **Negative greps (asserting removal) get three extra checks:**
   - Anchor the pattern on text unique to the code being REMOVED, never on words the replacement
     will also contain.
   - Grep your own task descriptions for the same pattern: if it matches a line a task tells the
     executor to WRITE, the check is self-colliding and will red on success.
   - Pair it with a positive assertion on the replacement, and dry-run against a scratch copy of
     the file carrying the line the task will add (scratch copy per the section above, never the
     shared tree). A regex lint cannot catch this shape; only the scratch-copy run can.

## Budget: the mandatory core when time-boxed

Full per-clause rehearsal is the standard. Under a hard time budget, run this core and never less:
every negative grep (item 4, the shape no lint catches), every clause whose polarity you are not
certain of, and one representative per command family (same runner and flags, different file); the
family's remaining clauses inherit and are attested "inherited from <representative clause>" in
closure check 10. A clause with a novel shape always runs. A probe already executed under Step 3's
run-every-runnable-probe rule counts as its own rehearsal: encode the observed result, don't
re-run. Cut breadth here before ever cutting Step 7's executed review.

## The three lint-warned backward shapes

`roadmap phase validate` (cli/lib/validate.mjs) WARNs on these, for phase files NEW to git only;
the lint is the reminder, review-phase Mode A is the enforcement:

- **Inverted absence**: a bare `grep -c` asserting ABSENCE exits 1 on a count of 0, so it reds
  exactly when the thing you wanted gone is gone. Compare explicitly:
  `test "$(grep -c x f)" = "0"`.
- **Piped judgement**: `npm run type-check | head -5` reports *head's* exit code, so a red compile
  reads green (this one masked a real typecheck failure in a shipped consumer). Redirect to a file
  and read `$?`.
- **Wrong invocation**: `node --test foo.ts` cannot run TypeScript without a loader, so it fails
  identically either way. Use the consumer's own test script form (commonly
  `node --import tsx --test`).

The fourth shape, **self-colliding or vacuous**, is regex-blind; protocol item 4 above is its only
defense.
