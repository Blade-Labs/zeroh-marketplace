# GRAFT trial — pre-registration

**This is a pre-registration record, not an architecture doc.** It is written BEFORE any
treatment data exists, and it is deliberately dated and sha-stamped: a protocol that can be
edited after seeing the numbers measures nothing.

**Phase 7 renders NO adoption verdict.** It delivers the integration, this protocol, and the
slicing instrument (`scripts/graft-trial-report.mjs`). The adoption call, if one is ever made,
comes from measured phase records read against the bar below — never from inspection.

---

## 1. What is under test

[Graft](https://www.npmjs.com/package/@nanonets/graft) (`@nanonets/graft`, pinned exactly at
`0.12.0`) builds a tree-sitter repo map as linked markdown plus a `wiring.json` code graph,
queried via CLI or MCP with no resident daemon.

### The configuration under test is a NAMED DEVIATION from stock

Stock graft could not be merged here. `mergePolicy.primaryCheckout` is the fleet's shared
checkout, and stock wiring arms a `Stop` hook that spawns a detached, uncapped `graft build`
after every turn that dirties the graph — measured below at ~485 MB RSS — outside the host's
mandatory `capbuild` cgroup, on a box that runs ~6 concurrent sessions on 31 GB.

| | stock | under test |
|---|---|---|
| `Stop` hook | spawns detached `graft build` | **removed** |
| auto-refresh (CLI + MCP query paths) | on | **off** (`GRAFT_NO_REFRESH=1`) |
| rebuild | implicit, uncapped | **explicit only**: `capbuild npx graft build .` |

Consequence, pre-registered: **graft's auto-refresh mechanism is OUT OF SCOPE for this trial.**
Any adoption proposal owes a separate decision on how to cap it on this host. What is measured
is a graph that is fresh as of the last explicit build, not a continuously synced one.

Files `graft init --no-global --no-agents` wrote, all reviewed before commit in task 7.2:

| file | role |
|---|---|
| `.claude/settings.json` | statusline + SessionStart / UserPromptSubmit / PostToolUse hooks, permissions, the `GRAFT_NO_REFRESH` env |
| `.claude/helpers/graft-hooks.cjs` | hook shim |
| `.claude/helpers/graft-statusline.cjs` | statusline shim |
| `.claude/skills/graft/SKILL.md` | the skill an agent reads |
| `.mcp.json` | MCP server registration |

`--no-global` was mandatory: the default would also have written `~/.codex/config.toml`,
`~/.codex/hooks.json`, `~/.codex/hooks/graft/graft-hooks.cjs` and `~/.gemini/…` — out-of-repo
writes affecting every repo on the box.

## 2. Measured footprint (task 7.1, this repo, structural build only)

| | |
|---|---|
| elapsed | 19.367 s wall (20.73 s user, 0.84 s sys) |
| max RSS | 484 696 kB |
| on disk | 19 M (`graft/`) |
| resident after | **zero** processes (probe run from a script whose path cannot self-match) |
| graph | 2 551 nodes, 6 859 edges, 261 cards; 261/261 files parsed |
| `--deep` LLM pass | `deepPassVerdict=skipped-no-key` — never provisioned a key; cost, latency and footprint of the deep pass are UNMEASURED |

## 3. Arms and the cut

Design: **before/after with cohort matching**, not a randomized A/B. There is no way to run two
arms concurrently in one repo.

| | |
|---|---|
| cut event (truth) | `2b8e87fcf906b4d3b11d3eca43a97c3a7af95c01` — the 7.2 wiring commit, 2026-09-03T03:38:21Z |
| cut phase (instrument proxy) | **25** |
| baseline arm | phases `<= 25` — every phase gated before the wiring commit |
| treatment arm | phases `> 25` — in practice **from phase 27 onward** |

**Why sha and phase number disagree.** The plan assumed phase 7 would execute in numeric order.
It did not: phases 8–25 were planned, executed and gated between the plan date (2026-08-23) and
the wiring commit. Phase numbers are therefore chronological only from 27 onward, and a
phase-number cut of 7 would misclassify 17 pre-graft records (8–25) as treatment. The cut is
defined by the fact — *gated before the wiring commit* — and 25 is the number that implements it.
`--cut 7` is a **misclassification in this repo**; task 7.4 records its output anyway, as
evidence of the anomaly.

### Transition phases — EXCLUDED from both arms

Neither is a clean member of either arm, so both are dropped before any aggregate is computed.
**The canonical invocation is therefore:**

```
node scripts/graft-trial-report.mjs --cut 25 --exclude 7,26
```

The exclusion is enforced by the instrument, not by the reader. Naming the phases in each cell's
member list is necessary but not sufficient: a reader can see a contaminating phase in the list
and still have no way to subtract it back out of the median — and the median is what the decision
bar is read off. The instrument prints which phases it dropped, so an exclusion can never be
confused with a corpus that never held them.

- **Phase 7** — straddles the cut (7.1/7.2 before the wiring, 7.3/7.4 after) and its gate runs in
  a session that started before the commit, so the hooks and env never reached it. Without the
  flag it lands in baseline under `--cut 25`. **Drop it.**
- **Phase 26** — the parent of this trial; its early tasks completed pre-wiring. Its record will
  arrive after the cut and be labelled treatment. **Drop it.**

## 4. Cohorts

Cohort key is `bandFor(taskCount) × surfaceOf(keyFiles)`, both imported from the plugin's
`eval-score.mjs`. The instrument reuses the plugin's helpers throughout — a second metrics
dialect is the drift this repo's singleSeam discipline exists to kill.

**The surface axis is degenerate here.** `surfaceOf` is a `web/ | office/ | spa/` path heuristic
and is `false` for all 23 baseline records — this repo has no such directories. The key reduces
to `bandFor` in practice. The two-axis key is kept as pre-registered anyway: a treatment record
that ever lands in a `surface:true` cell is unmatched by construction and must abstain. No new
surface heuristic is written for this trial.

Baseline cell census at pre-registration time:

| cohort | n | clears `SCORECARD_N_FLOOR` (5)? |
|---|---|---|
| `4-6 × false` | 17 | yes |
| `7+ × false` | 3 | no |
| `1-3 × false` | 3 | no |

So decision 5's ">= 1 cohort" can realistically only ever be the `4-6` cell, and reaching a
verdict needs **>= 5 treatment phases of 4–6 tasks each**. That is the trial's real cost, stated
up front.

## 5. Compared metrics

Only fields `PhaseEvalRecordShape` actually carries. Absence is reported as absence, never as
zero — the instrument reuses the scorecard's own conventions rather than inventing them.

| metric | convention |
|---|---|
| median `spanMinutes` | the primary endpoint. Null for a record without `startedAt` (phase 6 today); such a record stays out of the median. |
| `haltCount` | optional under the honest-absent convention. Present in 17/23 baseline records (1–5, 8–11, 13–20), absent in 6 (6, 21–25). A record without it stays OUT of the halt denominator, never enters as 0; an arm with no halt evidence prints `no-halt-evidence`. |
| gate slot `durationMs` | two slots carry it in these records — `unit` and `history-comments` — but `history-comments` is `0` in every one, so `unit` is the only slot with real elapsed work and is the one compared. |
| `gate.green` rate | `true` in all 23 baseline records, so "green rate does not regress" means treatment must also be 100 % at n >= 5. |

**Instrument note:** `readPhaseEvalSamples` returns projections that drop `gate` and `date`, so
the two gate-derived metrics are read from the raw records in the same directory. That is
reading, not a second dialect — no metric math is duplicated.

### UNMEASURED — session token spend

Token and dollar cost are **not** in `PhaseEvalRecordShape`. **No cost claim of any kind can come
out of this trial**, in either direction. Graft's own README claims (−32 % cost, +60 % latency,
SWE-bench 66 % vs 54 %) are its numbers and are not tested here.

## 6. Confounds

- **Ordering / learning effects — NAMED, MITIGATED, NOT ELIMINATED.** The arms are sequential, so
  anything that changed over the same period (the protocol itself, the executing models, plan
  quality, phase mix) is confounded with the treatment. Cohort matching on `bandFor × surfaceOf`
  controls phase size only. This is the design's central weakness and no result should be read as
  causal.
- **Degenerate surface axis** (§4) halves the matching that was pre-registered.
- **Small-repo risk.** Graft targets large-repo exploration; this is a small `.mjs` codebase
  (261 files). The signal may stay under the floor or under-represent the real effect. That
  outcome reads **EXTEND-OR-MOVE** — try a larger consumer, a separate operator decision under
  this phase's no-other-repos fence — and is **never** a negative verdict on Graft.
- **Auto-refresh out of scope** (§1): the trialled configuration is not stock.

## 7. The decision bar

Pre-registered, and binding:

> Adoption is proposed **only if** treatment median `spanMinutes` improves by **>= 20 %** in
> **>= 1 cohort**, with **n >= `SCORECARD_N_FLOOR` (5) per arm** in that cohort, **and** the
> `gate.green` rate does not regress.

- Below the floor → **extend the trial**. Never rank, never rate, never "lean toward".
- Above the floor but under 20 % → no adoption proposal.
- Meeting the bar → an adoption *proposal*, which still owes a separate answer on capping
  auto-refresh (§1) before anything reaches the shared checkout.

Reading numbers from a cohort below the floor is the failure mode this bar exists to prevent.
