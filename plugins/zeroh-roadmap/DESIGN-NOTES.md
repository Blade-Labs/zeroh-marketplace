# zeroh-roadmap — Design Notes (relocation archive)

**Contract.** This file is the relocation home for every dated incident narration and
retired-experiment rationale removed from a model-loaded skill or agent card during the
ROADCODE prose diet (arc ROADCODE, phase 1659; staged by 1658). It is **never model-loaded**:
no skill, agent card, hook, or CLI reads it as an instruction — it carries no operative rule,
only the history behind rules that now live in code (the `roadmap` CLI + hooks) or in the thin
judgment skills. A rule the model must still follow lives in a skill or card, never here.

The incidents below are preserved verbatim in spirit so the *why* survives the byte cut. Each
section names the origin file; the DIET-LEDGER.md `relocated(DESIGN-NOTES.md §<anchor>)`
dispositions point here.

---

## do-arc — watchdog & recovery-ladder incidents

The mechanics these stories taught are now enforced by `roadmap watch` (exit 3 STALLED / 4
EXITED) and `hooks/executor-result-guard.mjs` (Stop/SubagentStop). The narrations:

- **2026-07-05 — the mid-build pause (backgrounded run, no resume).** An executor backgrounded
  a long gate run, its turn ended, the run finished or died, and it never resumed — the arc
  stalled until a human nudged it. Root cause: a hand-rolled watcher. The fix that stuck:
  commit before you background; never background the terminal run; arm the plugin watcher, never
  hand-improvised forensics.
- **2026-07-09 — five hours lost to a bare prose turn end.** An executor ended a turn on a plain
  status line between tasks. Nothing re-invokes a finished turn; the phase died where it stood.
  A hand-rolled watcher read the corpse as ALIVE for five hours. The `executor-result-guard`
  hook now BLOCKS a bare-prose mid-phase turn end structurally.
- **2026-07-03 — false-positive from a symlinked transcript stub.** Hand-probing a symlinked
  transcript stub produced a false ALIVE verdict. The liveness reader now realpath-resolves
  transcript growth, so the symlink-stat trap is structurally gone.
- **2026-07-11/12, arc RAGFID phase 1537 — four poller deaths in one phase.** An executor parked
  awaiting a detached external run; its session-bound completion poller was reaped by
  account/login events four times. A completed 90-min run sat unnoticed for 37 min, a failed
  training launch for 3 h, until an orchestrator probe caught each. Lesson: an executor's own
  poller is best-effort; the durable wake chain is the orchestrator watchdog + resume-from-disk,
  and the `background-run` beacon (pid + sid + host + log + DONE marker) is what makes the resume
  lossless. Probe with `kill -0` + fresh log, never a pattern `pgrep`, and ON THE BEACON'S HOST.

The full recovery-ladder prose (nudge → respawn-with-resume → fail+escalate) is now the thin
do-arc's ~4-line reaction over the `roadmap watch` verdict; the sentinel/beacon probing
mechanics live in the executor-reference long-run protocol (kept as behavior code cannot perform
it for the model).

## do-arc — execution-prompt generation spec

The full deterministic emit spec for `roadmap/arc-prompts/arc-<id>-execution-prompt.md` (the
BAR preamble, the eight rendered sections mapping `arc.name` / `stakeholderDemo` / `singleSeams`
/ `honestyRails` / `designRefs` / `acceptanceCriteria`) was staged out of do-arc. plan-arc owns
the generator (§5 row 7); the thin do-arc keeps only a one-line pointer. The section renderings,
preserved for the generator's authoring reference: (1) title with phase range; (2) the reusable
senior-architect BAR preamble verbatim; (3) *What this arc delivers* from `arc.name` + member
`stakeholderDemo`; (4) *Build sequence* — phases in dependency order with `kind` + task count;
(5) *Pre-merge arc sweep* — `singleSeams` as "hold these single" bullets; (6) *Honesty rails* —
`honestyRails` one bullet each; (7) *Design spec* — `designRefs` as `**<kind>/<status>** \`ref\`
— summary`, empty → the explicit "None — design gate skipped" line; (8) *Acceptance criteria* —
`acceptanceCriteria` as `**<job>** — signal · tier · bar`, empty → the explicit no-op line.

---

## phase-executor — turn-end incidents

The three-legal-turn-ends rule is kept verbatim on the card; the hook enforces it. The stories:

- **2026-07-05 — a backgrounded terminal run stranded the phase.** A backgrounded final
  validation run is a stall the executor caused, not a handoff: the Monitor's re-invocation is
  not guaranteed for a terminal run. Hence "never background the TERMINAL run."
- **2026-07-09 — five hours, ended mid-phase on "committed 1397.1, prepping 1397.2".** A bare
  status line between tasks is not a legal turn end: the turn is simply OVER, nothing re-invokes
  the executor, and the phase dies where it stood.

---

## executor-reference — long-run survival & foreign-red incidents

The long-run protocol (commit-before-background, never background the terminal run, detached
>30-min workers, DONE markers, beacons, proof-before-yield) is KEPT on the card because it
directs behavior code cannot perform for the model. The dated stories behind it are relocated
here:

- **2026-07-05, phase 537 — uncommitted background-and-yield.** The executor backgrounded a run
  on top of 6 uncommitted files and yielded; the turn never resumed and the work was stranded. A
  backgrounded run must sit on a COMMITTED checkpoint so a non-resuming turn is losslessly
  recoverable.
- **2026-07-09 — a bare turn end is the same death without the excuse.** No long run was in
  flight; the executor committed a task then ended its turn on a plain status line. The liveness
  reader now reports that as EXITED.
- **2026-07-11/12, arc RAGFID phase 1537 — two ~90-min generation runs lost to session-limit
  reaping; the one detached run survived.** A session-limit / account-refresh event kills the API
  loop AND reaps every process in the harness session tree. Hence: launch >30-min external
  workers DETACHED (`nohup setsid`), by default. Poller-dead + worker-alive is a NORMAL state
  after an account refresh, never evidence the run failed.
- **2026-07-11 — pattern `pgrep` misreads (both directions).** A pattern match on the launcher
  script name read a live detached worker as terminal once the launcher shell exited, and can
  self-match the poller. Trust `kill -0` + a fresh log only.
- **2026-07-12, RAGFID 1537 — the five-bug launcher loop.** Yielding on a launch that had not yet
  logged real work turned four serial first-run launcher bugs (a bootstrap install failure,
  flash-attn build order, an unsupported CLI flag, a transformers API rename) into a full
  wake-cycle each — ~4 h of wall clock for ~4 min of fixes. The fix: a bounded foreground smoke
  of the EXACT command before the real detached launch, and align all version/API-mismatch errors
  in ONE pass, not serially.
- **2026-07-06 — foreign-red, right instinct / unbounded mechanics.** A session correctly noticed
  a sibling session's phase was red but chased it with unbounded mechanics. Foreign-red conduct is
  now a bounded rule on the card.

---

## Design-parity origin incident (relocated from plan-arc / arc-sweep / validate-arc)

**2026-07 — Ask Ali web, the Studio builder, and Agent HQ each shipped OFF their confirmed
previews.** Each arc had a user-ratified UX preview at the design gate, but the delivered surface
drifted because nothing downstream re-opened the design artifact: the per-phase gate judged code,
arc-sweep judged the diff, and nobody put the rendered pixels next to the design until the user did
it in production. The closure (now enforced in code + thin skills, so the story no longer needs to
ride in the model-loaded prose):
- plan-arc Step 1b(4) MINTS a paired `ux-parity:*` acceptance criterion for every confirmed `ux`
  designRef (a confirmed design is a 1:1 CONTRACT, not "inspiration");
- validate-arc DERIVES that criterion as a fail-safe when an arc has `ux` designRefs but no
  `ux-parity:*` criterion (the drifted-arc shape);
- the per-phase design-parity gate stage (thin do-phase) re-opens the artifact and compares
  layout + states + interaction/motion against the parity rubric;
- arc-sweep's design-conformance check judges the built surface against the confirmed designRefs.

## Measure scoping (rationale for cli/measure-manifest.json)

`roadmap measure --flow F` sums `bytes/4` over the files the model actually loads into flow
`F`'s driving context. The scoping decision — which files belong to which flow — is derived, not
asserted, and each manifest entry carries a `why` naming the instruction site (skill file + line)
that causes the load.

- **`--flow do-arc` = the ORCHESTRATING session's context.** It loads: `using-zeroh-roadmap`
  (the always-active router), `do-arc` (the orchestration skill), `do-phase` (the inline
  arc-mode worst case — an inline/inline-supervised band runs do-phase in the main session),
  `arc-sweep` (the pre-merge sweep runs in-session), and `validate-arc` + its `driving-tiers.md`
  reference (the terminal intent gate runs in-session). This is the ≤12k-token budget the arc's
  protocol-load-cut criterion measures against the audited ~49k baseline.
- **Subagent cards are EXCLUDED from do-arc.** `phase-executor`, `executor-reference`,
  `code-reviewer`, `quality-pass`, `software-architect`, `intent-validator`, etc. load in FRESH
  subagent contexts, not the orchestrator's — spending orchestrator tokens on them would
  double-count. They are covered by `--flow do-phase` (do-phase + phase-executor +
  executor-reference — the executor subagent's own context).
- **`--flow plan-arc`** covers the planning session: plan-arc + design-gate + ux-craft +
  plan-phase + review-phase.

If a flow's derived set exceeds its budget at target sizes, the fix is to DEEPEN the trims
(deletion-with-disposition), never to drop a genuinely-loaded file from the manifest — hiding a
file the model still loads would make the meter lie. A renamed skill breaks the meter loudly
(exit 1 on a missing manifest path) rather than silently shrinking the total.
</content>
</invoke>
