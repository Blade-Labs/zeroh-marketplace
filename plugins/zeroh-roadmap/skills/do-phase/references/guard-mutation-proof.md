# The guard mutation proof: prove a new guard falsifiable before you commit it

A guard you cannot make fail is not a check, it is a comment that costs CI time. The plan-time
sibling rule (`skills/plan-phase/references/verify-rehearsal.md`: a verify must fail ONLY when its
claim is false, run it both directions BEFORE writing it) binds the clauses a PLANNER writes.
This binds the guards an EXECUTOR writes mid-build, which nothing covered: they were being carried
to falsifiability by reviewers instead, one serial round at a time, at gate prices.

## What counts as a guard

Any check whose job is to go red when a claim about the TREE stops being true: a ratchet test, a
conformance or lockstep assertion, a scan- or grep-shaped tripwire, a lint rule, a schema gate.

Not every ordinary test. A TDD behavior test proven RED against its own missing implementation and
GREEN after already carries its falsifiability proof by construction. The obligation binds checks
whose subject is the tree's SHAPE, where red-first-against-implementation has no meaning.

## The three mutations

In one line: **planted violation RED, anchor drift loud, decoy GREEN.** Drive all three. Each is one
scratch mutation, one run, one line quoted, then reverted.

1. **Planted violation** — reintroduce the exact defect class the guard exists to catch. The guard
   must go **RED**. A guard that stays green here checks nothing you care about.
2. **Anchor drift** — rename or move the symbol, file, or pattern the guard keys on. The guard must
   go **RED**, or degrade **LOUDLY** (an explicit unresolved-anchor error naming what it could not
   find). Silently passing against nothing is the vacuous class, and it is the one a green suite
   will never tell you about.
3. **Decoy** — the nearest LEGAL pattern the guard must NOT flag. It must stay **GREEN**. This is
   the crying-wolf class: a guard that reds on lawful code gets weakened or deleted by the next
   person, taking the real coverage with it.

**Mutations are NEVER committed.** Mutate, run, quote, revert. Verify the revert (`git diff` on the
touched path is empty) before the task commit. On a shared checkout, mutate only files your own task
owns, and never `git stash`/`git checkout` a sibling session's work to get a clean run.

## The quoting contract

Three one-line results land in the task's `transparencyReport.how` BEFORE the task commit, naming
the guard and what each drive did:

> `no-inline-env` ratchet: planted `process.env.FOO` in src/relay/turn.ts → RED (1 violation);
> renamed the rule id → RED (unknown rule `no-inline-env`); decoy `config.foo` in the same file →
> GREEN.

An unproven guard is undone work, not a finished task. If a mutation is genuinely impossible to
stage (the anchor is generated, the violation cannot be expressed), say so in that line and say why
— a named gap is honest, a silent omission is the failure this protocol exists to stop.

## The reviewer contract

For each NEW guard in the diff:

- **Missing proof is itself a finding.** Name the guard, demand the three quotes. Do not spend the
  round deriving mutations the executor owed you — that trade is what made review rounds the
  expensive place to discover vacuousness.
- **Present proof is audited, not repeated.** Re-run exactly ONE of the three mutations, your
  choice, and confirm it matches the quote. A quote that does not reproduce is a finding about the
  guard AND about the report.

Rounds stay uncapped: round 1 keeps finding real product bugs, and this protocol buys its latency
back by moving guard-debugging into the build window, not by cutting review short.

## Provenance

- azure_private_agent phase 2374: 5 build tasks in 38 minutes, a 3h39m gate, and 8 of its 9 review
  rounds spent on the executor's OWN ratchet (vacuous, then crying wolf at R2/R6/R7) rather than
  product code. Phase 2334 shows the same shape.
- The PAYLOADCMS arc eval: "the guard layer's FIRST cuts were repeatedly unfalsifiable... reviewer
  mutation-testing across four gate rounds carried the guards to falsifiability rather than the
  initial design arriving there."
- mudarabah2 phase 703, gate round 3: "Every new guard falsified by reintroducing its defect" —
  correct practice, discovered at review time, after every task had already been committed.
