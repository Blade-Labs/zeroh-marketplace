# MINESWEEP — execution prompt (the one home of arc rationale)

Read before driving any member phase. Source corpus: the 2026-08-31 cross-repo eval
mining over zeroh-marketplace, atlas, mudarabah2, azure_private_agent (synthesis with
per-finding evidence paths: `.building/eval-mining-2026-08-31.md` — gitignored working
input; the durable claims are restated here with their strongest evidence).

**The bar.** Every fix is a long-term rail at the owning seam — never a symptom patch
(user mandate 2026-08-31: "high confidence long term fixes"). Zero growth of the metered
protocol load: `roadmap measure --flow do-arc --assert 13257` must exit 0 at every phase
gate; all fixes live in CLI code, tests, and (diet-funded) agent cards.

## §lanes — worktree/lane lifecycle (phase 14)

Live census 2026-08-31: 19 stray sibling worktrees ~6.5 GB across four consumers; every
sampled journal pgid dead, none archived. Causes, all mechanical: run-lane disposal fires
only inside `phase land`/`arc land` (never reached under hold-for-user merge policies or
hand-harvests — atlas: 11 merged-and-done lanes squatting); the plan lane has NO
done-moment (statusCodex archives only the review lane; atlas-codex-plan-22 dead since
2026-08-29); an already-gone lane's merged branch survives disposal (marketplace phase-6
recorded residue); nothing surfaces the accumulation. Operator ruling stands: NO sweep
verb, no timer reaper — the arc adds visibility (audit check 15, status stray count) and
done-moments (plan-lane consume-close mirroring archiveReviewLane; next-step hints).
The plan-lane close rests on the lane's ONE-FILE invariant: harvest is a cherry-pick
(content-carried, new SHA), so the proof is byte-equality of the phase file at the
integration ref — disposeWorktree's SHA-reachability check structurally cannot serve it.

## §codex — lane bootstrap + envelope (phase 15)

Codex JUDGMENT is good (atlas phase-22 plan: 400-line entity, self-caught vacuous Nx
commands; azure phase-2186 proper entity). Operations are the weakness: `npm ci`
hardcoded (atlas phase-25: "every prior lane run only worked because its worktree
pre-existed… Plugin fix owed upstream in zeroh-marketplace"; mudarabah2 HANDOFF.md);
`roadmap` absent from PATH (both azure lane reports, exit 127); 9/9 atlas codex logs end
in usage-limit death; `codex plan --arc` dies in a raw stack trace (probed 2026-08-31).
The user's "it created a file not phase" memory maps to CODEX-PLAN.md — the untracked
by-design hand-off that holds all plan rationale and goes unread/clobbered; the honest
fixes are archival at close (14.6) + post-run entity validation (15.4). Codex ARC
planning is DEFERRED with a loud refusal (15.5): plan-arc's design gate is interactive
by contract, the lane is no-reachable-user by contract — resolving that contradiction is
a user ruling, not a flag.

## §grammar — commit-subject attribution (phase 16)

The `phase N —` em-dash boundary is load-bearing (collision-free attribution: 21 vs 214)
and brittle: mudarabah2 has ELEVEN phases whose curation never ran (its executors wrote
`phase N task N.X — …` / `fix(phase-N): …` / `docs(roadmap): mark phase N complete`);
marketplace phase 1 recorded an unrecoverable misclassification, phase 10 a refused
squash range (gate agent's subject); atlas 30's ASCII hyphen collapsed gate scope to a
1-file diff and skipped quality-pass. Ruling: READ-side tolerance only (one matcher home
`phaseOwnPatterns` in gitscan.mjs, consumed by curate + gate + start-derivation), the
canonical write grammar stays the one taught form, every tolerated deviant still WARNs,
and the three committing agent cards carry the grammar (diet-funded, DIET-LEDGER rows).

## §integrity — delegated-lane gate (phase 17)

"Codex never self-judges" is ratified (azure backlog.ts:1040) and toothless: mudarabah2
720 landed on a lone `codex-self-review` round and shipped a false green; azure 2422's
honest self-review record and 2423's three software-architect RESHAPE rounds both
bounced off the five-member gateRounds agent enum (identity laundered into free text);
atlas 33 reached done with `agents: []`. Fix at the one shared choke point
(checkPhaseConsistency): widen the enum (+software-architect, +self-review, both schema
homes line-identical) and refuse a codex-lane completion (reviewScope ≠ none) without at
least one independent recorded round.

## §measure — the eval loop (phase 18)

Silent degradations, each now surfaced: consumer schema drift killed atlas's entire eval
output (13 phases recorded the identical soft note; zero records from 25 landed phases)
→ export-inventory diff in config check + audit check 16; 15 lessons stranded in atlas
lane-worktree lessons.jsonl copies → mergeLaneLessons on both land verbs, before
disposal; azure: 9 arcs with sweeps/verdicts and no report, newest report 4/7 dims
pending-judge → report-time unjudged summary + status `eval: none` marker on all-done
arcs; 41 explanatory-empty census rows ("None — …") across 9 azure sweeps → prefix-keyed
exclusion, counted visibly. Already fixed at HEAD (do NOT re-fix): eval argv 128KB
(stdin lane in tsx-bridge), attribution.roles projection (projectRoleModels).

## §crossrepo — the gate's blind spot (phase 19)

product-repos.mjs (the 2026-08-17 incident fix) already feeds liveness + the arm's
diagnostic preflight — but gate plan still derives scope from the local diff alone:
atlas 33 derived reviewScope light off ONE roadmap file against ~3.9k product lines in a
sibling repo (round 0, run anyway, found four defects light would skip); azure 2333 put
two executors on one product branch (nothing interlocks the product tree). Fixes:
productRepos floors reviewScope to full (named in plan notes + JSON), and executor-arm
refuses an arm whose derived product repos intersect a sibling arm's (--force with
recorded override). Cross-repo METRICS stay executor-owned — a gate-side aggregation
would be fabricated measurement (rejected).

## §vacuity — proof of proof (phase 20, keystone)

The largest mined class (~20 incidents, all four repos): checks that pass regardless.
Mechanized here: the cannot-fail probe (a scoped runner given a provably-nonexistent
target through its OWN template must exit non-zero — atlas plan-22 self-caught this
class, azure 2333 shipped it) surfaced as a gate-plan HIGH warning; the polarity lint's
three missing recorded classes (plain node/npx/tsx judged through a pipe — azure 2421's
`| tail -1` masked a pushed red phase file; `|| true`; trailing bare `echo`); and
`phase validate --assumptions` executing a plan's tripwires so Lane A's green direction
is one command. Judgment-side classes (fixture-from-plan, guard-encodes-the-bug) stay
with review-phase Lane A / verify-rehearsal — the recorded boundary, not a gap.

## §budget — the 12,500 question (no build; evidence ruling)

History: 12,000 → 12,500 aspirational (user ruling 2026-07-27, PRE-gauntlet). The
gauntlet (2026-08-13/14, v0.30.0) installed blind-trial WINNERS for do-arc/do-phase/
using-zeroh-roadmap — larger bodies that beat the smaller dieted texts in sealed finals
(GAUNTLET-2026-08.md lesson 1: ~40% of nicer-looking rewrites were regressions only
blind trials caught) — creating the 14,917 standing red azure kept recording. The
2026-08-24 operator ruling replaced the aspiration with the measured zero-growth
ratchet: `PROTOCOL_LOAD_BUDGET_TOKENS = 13257` (measure-budget.mjs), and the diet pass
funded it; measured 2026-08-31: 13,256/13,257, green. Ruling: neither cater to 12,500
nor raise — chasing 12,500 means rewording load-bearing protocol, exactly the edit class
the gauntlet proved unsafe without a sealed-set re-run; raising is unneeded because
every MINESWEEP fix is mechanical. New prose stays deletion-with-disposition-funded.
