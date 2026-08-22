---
name: "Arc Sweep"
description: "Pre-merge sweep for a built arc: dispose every accumulated compromise (reusing release-sweep's debt vocabulary) and run one whole-arc software-architect review against the arc's singleSeams + designRefs, then report merge-readiness."
user-invocable: true
metadata:
  keywords: arc sweep, pre-merge sweep, sweep arc
  aliases: pre-merge-sweep
---

# Arc Sweep — Pre-Merge Debt + Whole-Arc Review

After `do-arc` builds every phase, `arc-sweep` disposes debt, runs ONE whole-arc architect, and
**reports merge-readiness — it never lands the merge.** Under `do-arc`, Step 8 owns integration after
validate-arc PASS + clean sweep + green suite; standalone `/arc-sweep` holds for the user's go.

**Read `skills/release-sweep/SKILL.md` FIRST.** arc-sweep reuses release-sweep's debt-disposition
vocabulary and `debtResolutions[]` persistence verbatim — never a parallel taxonomy.

**When vs release-sweep:** arc-sweep runs **pre-merge** on an unversioned arc; release-sweep runs
**pre-archive** on versioned phases. arc-sweep is NOT `full-code-review` — it is a lighter,
seam-specific architect pass.

## Step 1: Consolidated debt sweep

Use `do-arc`'s complete `PhaseExecutionResult[]`; if missing/short, call `discoverResults()` to re-read
`phase.executionResult`. Also run `roadmap debt census` and re-read free-text compromises. Never
dispose a truncated set.

**Disposition → persistence (mechanical — read the row):**

| Disposition | Meaning | `debtResolutions[]` | `status` | `via` |
|---|---|---|---|---|
| RESOLVE-NOW | fixed inline now, re-gated | ONE entry | `'fixed'` | `'<commitSHA>'` |
| PLAN-PHASE / **IN-ARC** (default) | authored + executed in-arc | ONE entry | `'planned'` → `'fixed'` after execution | `'phase-<N>'` |
| PLAN-PHASE / **DESCOPE** | dropped, user-ratified (even autonomous) | ONE entry + `Arc.descopes[]` | `"won't_fix"` | `'descope — ratified by … (≥20 chars)'` |
| ACCEPT (won't fix) | correct boundary, reason ≥20 chars | ONE entry | `"won't_fix"` | the reason |
| ACCEPT (dismiss) | never was debt | ONE entry | `'dismissed'` | the reason |
| OPERATOR-PENDING | deploy/operator action, not code | ONE entry (+ `roadmap/followups/<arcId>.md`) | `'operator-pending'` | runbook / DEPLOY.md anchor |

(`limitations` never enter this table — see below.)

Whenever OPERATOR-PENDING creates a NEW `roadmap/followups/<arcId>.md`, prepend the `status` + `trigger`
frontmatter from `skills/release-sweep/references/followup-contract.md`; a headerless birth violates
this rule. The same header rule covers every followup write named below.

**Disposition mode — read `mergePolicy` from `roadmap.config.json` first.** Under do-arc AND
`mergePolicy.arcIntegration: 'autonomous'`, dispose each item YOURSELF by the table — no per-item
prompt on the clean path. Absent config / `'hold'`, or **standalone** invocation → prompt per item
(standalone behavior is unchanged, always interactive). **Autonomous mode STILL stops for a human on
four classes:** a `[PRODUCT]` hard-stop; a `[MULTI-REPO]` hard-stop; a `software-architect`
**ESCALATE** verdict on a tiebreak; and any **DESCOPE** (narrowing what the arc promised ALWAYS needs
user ratification, recorded typed on `Arc.descopes`). On a genuinely ambiguous item, spawn
`software-architect` as a tiebreak advisor (the Prime-Rule-1 pattern) BEFORE disposing.

Each code-disposition persists exactly one `debtResolutions[]` entry (`{ ref: '<taskId>.<field>',
status, via, date }`); an autonomous disposition writes the SAME entry, marking `via` with
`autonomous-sweep`.

- **RESOLVE-NOW** == release-sweep **(f) Fix inline** → invoke `zeroh-roadmap:software-architect` for
  the proper-solution blueprint, apply, re-gate to the phase's `kind`, commit → `{ status: 'fixed',
  via: '<commitSHA>' }`. `'fixed'` is reserved for work EXECUTED in this sweep (a commit that exists),
  never a merely-authored follow-up.
- **PLAN-PHASE** — a real follow-up; **IN-ARC is the DEFAULT**:
  - **IN-ARC (default)** — author the phase NOW (`plan-phase`, stamp `arcId`, claim a number, append
    to `planes`) → `{ status: 'planned', via: 'phase-<N>' }`. **do-arc loops back into the phase loop and
    EXECUTES it before the close-out sweep/validate**; on completion the entry flips `'planned'` → `'fixed'`. Authoring
    alone is NOT resolution.
  - **DESCOPE** — drop it. Requires **explicit user ratification EVEN in autonomous mode**. Record
    BOTH `{ status: "won't_fix", via: 'descope — ratified by <who> <when>' }` AND a typed
    `Arc.descopes[]` `{ item, ratifiedBy, ratifiedAt }` — durable and typed, never buried in prose.
- **ACCEPT** == release-sweep **(w) Won't fix** (reason ≥20 chars → `"won't_fix"`) or **(d) Dismiss**
  (never-was-debt → `'dismissed'`).
- **OPERATOR-PENDING** — a required **deploy/operator action, not code**. Writes `{ status:
  'operator-pending', via: '<runbook / DEPLOY.md anchor>' }` so deploy debt is schema-visible, detail
  in `roadmap/followups/<arcId>.md`. **Exempt from the openFollowups budget** but counted + listed in
  the RunnerSummary notes; stays OPEN until a later release-sweep disposes it post-deploy.

`ref`/`status`/`via`/`date`, the ≥20-char `won't_fix` reason, and the dismissed-ratio nudge are
release-sweep's — do not redefine them.

**`limitations` are out of scope — by design.** The roll-up carries `compromises`/`skipped`/
`hardcoded` but NOT `limitations` (a permanent design constraint, not deferred work) — **release-sweep**
disposes those pre-archive. To avoid a silent hole, arc-sweep re-reads each phase's `limitations` and
LISTS any present in the Step-3 report under "deferred to release-sweep".

**No summary file.** Keep the audit trail in `debtResolutions[]` + transparency reports and the chat
report ephemeral. `roadmap/followups/<arcId>.md` holds only OPERATOR-PENDING detail + ratified-descope rationale.

## Step 2: Whole-arc cross-phase review (against singleSeams + designRefs)

A per-phase gate sees only its own diff — it CANNOT catch a seam one phase quietly forked. **Only a
whole-arc view catches a forked seam** — that is this step's whole job.

Run ONE `zeroh-roadmap:software-architect` over `git diff <arc.baseRef>..HEAD` and judge it as **a
single system** against `arc.singleSeams`: for each seam, did any consumer fork it, or is it a single
implementation across the arc? **Spawn it with `model` per the `modelPolicy.judgeModel` home statement
(review-phase SKILL.md)** — this whole-arc architect is a JUDGE.

**Design-conformance — judge against `arc.designRefs` too.** Read the arc's confirmed `designRefs` and
judge whether the build implements each: a `reused` pattern genuinely followed (not re-invented), a
`designed` pattern matching what was extended in the doc, a `ux` designRef's surface matching the
confirmed preview — layout AND interactions/motion (hover/focus, transitions, animations: same or
unambiguously better, never flattened — skills/validate-arc/references/parity-rubric.md, Interaction & motion). **The design is
the spec** — drift from a confirmed designRef is a finding, disposed like any other (RESOLVE-NOW if
cheap, else PLAN-PHASE). No `designRefs` (mechanical arc) → skip explicitly, never silent.
**Supersession:** the architect also asks whether this arc's build made a PRIOR arc's designRef
claim false (same-seam refs — grep `roadmap/arcs/`). A contradiction is a FINDING disposed through
the Step-1 table; its disposition stamps the old entry's `supersededBy`, and the report names each
stamp.

**Ledger-audit clause (when the arc trims plugin/skill prose).** If the arc diff deletes or compresses
model-loaded skill/agent prose, the sweep verifies EVERY such deletion in the diff carries a
`DIET-LEDGER.md` disposition row, and spot-checks the `enforced-by-code(...)` claims against the named
code (a disposition pointing at code that does not enforce the deleted rule is a BLOCKER finding). A
trimmed passage with no ledger row is a sweep failure, not a style nit.

Apply any **RESOLVE-NOW** fixes the architect identifies and **re-gate each** to its phase's `kind`;
author **PLAN-PHASE** follow-ups for real debt that should not block the merge.

## Step 2.5: Estate ratchets — the whole-tree conformance pack, ONCE per arc

Per-phase gates are diff-scoped by design, so an arc's accumulated drift only shows up where a
WHOLE-TREE check runs. Today that is `arc land` and the release PR — the two most expensive
moments (a v0.36.0 release burned three CI rounds on drift every phase gate had passed, and the
FRONTDOOR land tripped five ratchets at once). Once per arc, here, is the right altitude: too slow
per phase, too late at land.

When the consumer binds `gateCommands.ratchets`, run it **FOREGROUND** after the whole-arc review.
Its scope is the consumer's own conformance estate (count/threshold ratchets, test-inventory and
scan locks, migration-knob cross-checks — whatever the consumer put behind the binding). A red run
is a sweep FINDING disposed through the Step-1 table like any other, with **RESOLVE-NOW as the
default** (ratchet fixes are mechanical: reword the comment, add the knob, ratchet the number down).
No binding → record the named skip (`ratchets: not bound in gateCommands — estate ratchets skipped`)
in the Step-3 report; never a silent pass.

## Step 3: Record, then report merge-readiness

Assemble ONE `SweepReportShape` document (the shape's own docblocks define every field): `arcId` +
the `date` you ran; Step 2.5 as `estateRatchets`; each member phase as `phaseGates`; the Step-1
table as `debtDispositions` (with its `debtResolutions[]` refs); the whole-arc seam +
design-conformance call as `architectVerdict`; `limitations` as `deferredToReleaseSweep`; the call
as `overall` + `blockers`. Pipe it through `roadmap eval record-sweep --arc <ID>`. A refusal is a
sweep BLOCKER — a sweep whose own report will not parse does not report green.

THEN render the chat report FROM that document: it is a PROJECTION, so a fact not in the file does
not exist for any later eval. **arc-sweep never merges — it reports.** Under `do-arc`, hand it
back; standalone, hold for the user's go.
</content>
