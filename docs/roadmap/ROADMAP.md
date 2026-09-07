# zeroh-marketplace — Roadmap

**Created:** 2026-08-23 (scaffold) · rewritten 2026-08-26 (phase 13.6) to describe the process
actually run here
**Status:** Active — the entry document; `roadmap/backlog.ts` answers "what's next", `roadmap
status` answers "what's live"

---

## The lifecycle actually run in this repo

Every change rides a phase. The loop, with the skill/verb that owns each step:

1. **Plan** — `plan-phase` (or `plan-arc` for a multi-phase arc): interview by default, read the
   code first, author `roadmap/phases/phase-N.phase.ts` (`definePhase()` from
   `lib/roadmap/schema.ts`) with known-diff steps ending in `→ verify:` clauses and
   `assumptions[]` tripwires. `roadmap claim` reserves the number; `roadmap phase validate N`
   parses it.
2. **Review + queue** — `review-phase` Mode A: independent plan review against the real tree;
   only a READY plan is queued into `roadmap/backlog.ts` (review-phase is the only queue writer).
3. **Execute** — `do-phase` (arcs: `do-arc` + `roadmap arc next`, capacity-gated since phase 11):
   one task = one commit + a `transparencyReport`; `roadmap phase start N` flips status
   atomically — never a hand edit.
4. **Gate** — `roadmap gate plan N` → `gate run N` (kind-selected slots; the unit tier here is
   `capbuild npm test` in the plugin) → the agent chain: round-0 quality pass, then
   code-reviewer rounds to clean, each recorded via `gate run N --record-round`.
5. **Curate + complete** — `roadmap phase curate N` (born-clean history where the range allows),
   the completion edit (gate/gateRounds/metrics/executionResult), `gate run N
   --verify-complete`, backlog groom, push.

Arcs add: design-first gate (plan-arc), arc-sweep, validate-arc (judge panel vs
acceptanceCriteria), `roadmap arc land`, and a dated eval record.

## Where evidence lives

- **Committed and durable:** the phase file's `gate`/`gateRounds`/`metrics`/`executionResult`,
  `roadmap/arc-evals/*.peval.json` (per-phase eval records with the gate slot rows),
  arc verdicts + evals, `plugins/zeroh-roadmap/CHANGELOG.md` for releases.
- **Checkout-local:** gate run reports under `roadmap/.gate/` are gitignored working evidence —
  a phase record citing `run-00000N-….json` points at THIS checkout's copy; the durable
  substance is the committed `.peval.json` slot rows. Do not chase those paths from a fresh
  clone.

## Git strategy (as practiced)

- Work lands on `feat/roadmap-arcs`, pushed to origin; `main` receives PRs. There is no
  `develop` branch in this repo.
- Shared checkout: stage explicit paths only; commit grammar is binding
  (`docs(roadmap): phase N — …`, task commits carry `phase N` + the task id — the CLI parses
  subjects).

## Planning discipline (the two prime rules)

- **Know the diff before writing the task** — a task you cannot name files/functions for is an
  investigation task, never a vague one.
- **Escalate to the architect before giving up** — the software-architect Decision Contract
  answers technical forks; `ESCALATE_TO_USER` is the only verdict that stops planning.
