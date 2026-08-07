---
name: "Test Strategy"
description: "Test pyramid, coverage targets, and conventions. Use when writing tests, reviewing test quality, or planning test phases."
user-invocable: true
metadata:
  keywords: test, coverage, unit, integration, e2e, pyramid, conventions
---

# Test Strategy

**This skill is consumer-bound.** The runner, commands, layout, and mock seams are the
consumer repo's, never this plugin's. Two bindings, both in the consumer's `roadmap.config.json`:

1. **`testConventions`** — the repo's test runner, test file layout (colocated vs `__tests__/`),
   mock seam (which boundary to fake), fixture home, assertion style. Read it before writing any
   test. Absent → infer from 2-3 existing test files nearest the code under test and say so.
2. **`gateCommands`** — the `unit` / `integration` / `e2e` slots bind the commands (resolved by
   `roadmap gate run`).

Also check the consumer's own test-strategy document if one exists (e.g. `docs/TEST-STRATEGY.md`)
— it outranks the generic guidance below.

## Test Pyramid (generic shape — counts/runtimes are the consumer's)

| Tier | What | Bound by |
|------|------|----------|
| 1a — Unit | Pure logic, no I/O, colocated with source | the `unit` slot |
| 1b — Integration | Real wiring through the app's entrypoints, external boundaries faked | the `integration` slot |
| 2 — E2E | Real user journeys against a running instance | the `e2e` slot |

Push every assertion as far DOWN the pyramid as it can live: a rule provable in a unit test
does not belong in an E2E test.

## What gets a test at all — the declarative-artifact rule

The pyramid ranks WHERE an assertion lives; this rule decides WHETHER one exists. Before writing
a test, name what a RED would mean. *A function's behavior changed* is a test. *A data file's
contents changed* is not: declarative artifacts (yaml/json/md, images, manifests, lockfiles, seed
data) get no bespoke test file, and never a byte-for-byte content assertion — that is a second
copy of the data that moves with it, guarding nothing. The honest guard for an artifact is its
INVARIANT (parses, references resolve, set exhaustive, ids unique), expressed as one more CASE in
a lane the consumer already runs (`gateCommands.ratchets` / `lint` / `emit`, or its documented
validator script). One scan extended with a case beats one new file per rule: a new `*.test.ts`
is permanently wired into the unit tier (inventory checks, coverage floors), while a lane leg is
one line.

This is NOT a carve-out for the loader, resolver, or schema parser that reads an artifact — that
is runtime logic and carries the full coverage targets below. Nor for checks that execute a
mapping function over a contract union, nor for the wired test a new governed surface owes.

## Coverage Targets

Coverage scores EXECUTABLE LOGIC only; a declarative artifact has no coverage number.

| Risk Tier | Target |
|-----------|--------|
| Core business rules / money math (as the consumer defines them) | 90%+ |
| Auth/security | 80%+ |
| New code | 80%+ minimum |

## Quality Bar

- Tests enforce INVARIANTS, not just outputs
- Tests fail if the bug existed — mentally revert the fix and check the test goes red
- No test capitulation (changing tests to match broken behavior)
- No no-op assertions (always-true checks) and no conditional assertions wrapped in `if` blocks
- Mock at the consumer's declared mock seam; verify call ARGUMENTS, not just call counts
- Boundary tests sit EXACTLY at thresholds

## E2E Rules & Patterns

E2E rules (real-user-flow principle, selector priority, spec structure) belong to the
consumer — look for an "E2E" section in its CLAUDE.md or test-strategy doc, and reuse its
existing spec files as the pattern source.
