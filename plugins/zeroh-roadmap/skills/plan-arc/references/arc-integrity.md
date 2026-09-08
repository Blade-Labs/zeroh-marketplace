# Arc integrity rails - provenance + templates

Templates and evidence behind plan-arc Steps 1 (entity + judge-state), 1c, 2c, 3 and 4.
Every rail here exists because a real arc shipped without it; the provenance files live in
the consumer's `<root>/arc-evals/` and are cited per section. Read the section at the
step that cites it - this file is not a linear read.

## §0. Arc entity template (cited from Step 1)

Author `<root>/arcs/<id>.arc.ts` from this shape. Every enum-valued field in the roadmap
corpus takes its value from the `z.enum` unions in `<root>/lib/schema.ts` or a
schema-valid file at HEAD, never a guessed word - `roadmap phase validate` rejects
guesses, and a guessed status ships an unexecutable queue:

```ts
import { defineArc } from '../lib/schema'

export default defineArc({
  id: '<id>',
  name: '<arc name - the why, one line>',
  baseRef: '<git ref the arc branches from / merges into>',
  planes: [{ name: '<plane name>', phases: [/* filled in Step 2a */] }], // ordered, sequential-within
  singleSeams: ['<shared type/factory/config that must stay ONE impl across the arc>'],
  honestyRails: ['<honesty constraint the whole arc upholds>'],
  acceptanceCriteria: [ // experience-level Definition of Done - validate-arc judges each
    {
      id: '<short-handle>',
      job: '<the job a user came to do, in user terms>',
      surfaces: ['<surface id, e.g. console | office-pane | chat>'],
      signal: '<the observable proof, INCLUDING the state it is judged under - §1>',
      tier: 'wired', // wired = in-process logic · live-ui = rendered UX · live-host = real model/masking
      bar: '<the quality bar beyond "it works">',
    },
  ],
})
```

## §1. Judge-state rule for acceptance criteria (cited from Step 1)

Author every criterion's `signal` against the LIVED state, not the demo state. For each
criterion, ask the three probes and write the answer into the `signal` text:
1. **Density** - does the signal hold with production-scale data? Name the number ("50
   agents", "300 ledger rows"), not "some data".
2. **Return visit** - does it hold on the second run / repeat visit, after caches and
   persisted state exist?
3. **Churn** - does it hold after the natural follow-on mutation (an item added, renamed,
   deleted)?

A criterion that is only true cold passes planning and fails production: BRAINVIEW's
geometry criteria were authored cold-layout-only; the shipped fix was inert at real prod
density and the gap surfaced only at validation
(`<root>/arc-evals/BRAINVIEW-2026-08-12.json`, the arc-eval minimum for both
plan-quality and verified-vs-intent in the 16-report mining window ending 2026-08-12).

## §2. Decision-completeness sweep (cited from Step 1c)

The load-bearing test: **would two reasonable executors build it differently?** If yes,
the choice is load-bearing and needs a bucket NOW. Sweep each planned plane against this
checklist - one pass, before `roadmap claim`:

- Names: new FlagIds, event kinds, contract names, route paths, file locations.
- Data: storage home, retention, migration order, backfill-or-not.
- Contracts: new/changed shapes in `src/contracts/` (consumer golden rule) - exact fields.
- Surfaces: which surface(s), placement, empty/loading/error behavior.
- Posture: flag default, fail-open vs fail-closed, who approves.
- Sequencing: what blocks what across planes; what ships dark.

Every row lands in exactly ONE bucket: `LOCKED DECISIONS` (interview output - go decide
it now if missing) · `designRefs` (gate output) · `DEFERRED - <owner> decides at <named
point>` (an explicit hand-off, never an implicit gap). Provenance: EVALCORE escalated the
same unmade decision twice inside one task, stalling the executor both times
(`<root>/arc-evals/EVALCORE-2026-07-28.json`).

## §3. Promise ledger (cited from Step 2c)

Write the ledger as a comment block in `<root>/arcs/<id>.arc.ts`, one row per promise.
Row sources, exhaustively: every `acceptanceCriteria[].id` · every `designRefs[].ref` ·
every `honestyRails[]` entry · every `singleSeams[]` entry · every LOCKED DECISION that
implies a build change · **every item/outcome the user's request states, quoted
verbatim** (the request is a promise source of equal rank - this row class is what
catches a plan quietly delivering a cheaper proxy for the user's literal ask). Template:

```
// PROMISE LEDGER (plan-arc Step 2c - audited by arc-sweep / validate-arc)
// promise                        | kind        | fulfilled by
// ux-parity:console-shell        | criterion   | 2211.3 (visual diff) + 2212.4 (wired itest)
// masking-service.md §external   | designRef   | 2211.1
// "no fabricated counts"         | honestyRail | 2213.2 (named sentinel + test)
// selectModel factory            | singleSeam  | 2211.2 (single impl; consumers 2212.1, 2214.3)
// LOCKED: storage = Postgres     | decision    | 2212.1
// USER ASK: "<verbatim quote>"   | request     | 2214.2 (delivers the quoted signal itself)
// "<item unfulfillable as is>"   | request     | REFRAMED -> <the real file/command/store>, 2213.1
// UNMAPPED                       | <kind>      | FORBIDDEN at queue time - add the task or
//                                                delete the promise WITH the user
```

**Reframe, never drop.** A request item unfulfillable as written (it names a tool that
does not exist, a report nothing produces) is mapped to its nearest REAL mechanism -
name the actual file/command/store in the row and surface the mapping in the closing
report. Dropping the item, or silently fulfilling a different one, is the failure this
row class exists to catch; a deferral of the literal ask to an out-of-scope follow-up
needs the user's approval, not a ledger footnote.

Queue-time check (put it in the Step 4 closing report): `grep -c UNMAPPED
<root>/arcs/<id>.arc.ts` returns 0. Provenance: FLUENTFRONT - a set every member phase's
docblock claimed to append to shipped EMPTY; every phase passed its gate and only
validate-arc caught the unkept promise (`<root>/arc-evals/FLUENTFRONT-2026-07-23.json`).

## §4. Reviewer packet (cited from Step 3)

Give each review agent this packet verbatim, with the placeholders filled:

```
PHASE UNDER REVIEW: <root>/phases/phase-<N>.phase.ts   - edit ONLY this file.
ARC (read-only): <root>/arcs/<id>.arc.ts. Your ledger rows: <rows naming phase N>.

LANE A - spec compliance (mechanical; any miss = NEEDS WORK, fabricated evidence = BLOCKER):
 A1 Ledger coverage: each of your ledger rows is implemented by a named task in THIS phase.
 A2 Anchors: existing files/symbols resolve at the inspected ref. Planned additions name their
    creating task and contract; absence is expected until implementation.
 A3 Verification: apply plan-phase/references/verify-rehearsal.md. Run cheap current assumptions
    and polarity probes; judge future behavior tests without executing suites or inventing results.
    Record observed evidence and pending execution separately. A non-discriminating check still
    needs repair; an exit-0-always pipeline cannot prove the changed behavior.
 LANE B - plan quality: run review-phase Mode A with --no-queue, model per
    modelPolicy.judgeModel in roadmap.config.json. ELIGIBILITY (plan-arc Step 3 band):
    skipped only for kind:mockup / docs-only / all-tasks-batchMode phases with no
    gateSpecialists keyFile and not the arc keystone; a skip is recorded, never silent.

RETURN: verdict READY | NEEDS WORK | BLOCKER, findings, and the Lane A command log.
NEVER touch <root>/backlog.ts or another phase's file - the orchestrator's git-status
sweep reverts violations and redoes the review serially.
```

Provenance for A3: UCAUDIT queued 20 phases of which 8 carried verifies that could not
fail - exit-0-always pipelines or prose where a command belonged
(`<root>/arc-evals/UCAUDIT-2026-08-02.json`); two standing consumer memory rulings say
the same ("a tripwire must fail ONLY when its claim is false - run it both directions").
Provenance for A2: FLUENTFRONT's tripwire false-negative came from a case-variant symbol
name, which case-insensitive grep masked.

## §5. Closing report contract (cited from Step 4)

Close the run with this report - every "done" claim carries the command that would have
failed it, so an unearned claim is mechanically distinguishable from an earned one. Every
count and every tool verdict in it is pasted command output (Evidence discipline, SKILL):

```
## Arc <id> planned
- Design gate: <reused|designed|inherited|skipped> - designRefs: <refs>, confirmed by user
  (or UNRATIFIED - user go pending, named as a hold).
  Would have failed on: an unconfirmed designRef reaching Step 2b.
- Decisions: <n> LOCKED, <m> DEFERRED-with-owner, 0 unbucketed.
  Would have failed on: a load-bearing sweep row (§2) with no bucket.
- Promise ledger: <n> rows, all mapped (user-ask rows quoted verbatim; REFRAMED mappings
  listed here for the user).
  Would have failed on: grep -c UNMAPPED <root>/arcs/<id>.arc.ts  ≠ 0
- Validation: roadmap phase validate <N|file> on every member phase + the .arc.ts;
  each exit code + output line pasted VERBATIM below - never summarized as "accepted".
  Would have failed on: any exit 2, or a validation claim with no pasted run.
- Reviews: <k> READY (queued), <m> NEEDS WORK / BLOCKER (NOT queued - findings above).
  Lane A ran <j> verify falsification probes; every one produced its red.
  Lane B: <ran on p phases | band-skipped (<reason>) per phase - list each>.
- Queued: one arc tier "<arc> (phases <exact claimed numbers>)" in <root>/backlog.ts -
  OR: NOT queued - review pending (<reason Lane B could not run>).
  Would have failed on: crossValidate rejecting planes↔phases drift at import, or a
  range-style label spanning numbers another arc claimed.
- Next: /do-arc <id>  (or: re-run Step 3 review, then queue)
```
