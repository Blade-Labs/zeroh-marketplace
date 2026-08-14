# Queue Placement Discipline - counting, FIFO, placement-only scope

Used by review-phase Mode A Step 8 (and its placement-only / `--no-queue` form). Provenance:
round-1 blind gauntlet feedback 2026-08-13 - one review lost outright on a position miscount,
another on an unexplained FIFO jump.

## Index counting (disqualifier class)

A cited position that does not match the file is a disqualifier, not a rounding error. Positions
count entries of the EXPORTED ARRAY in `roadmap/backlog.ts` ONLY. The docblock near the top of
that file carries EXAMPLE entry rows that look identical to real rows and are NOT queue entries
(the round-1 loss: six positions each off by one after counting a doc-comment example as a row).

Derive every index mechanically, from the raw file, in this session:

1. Locate the array open: `grep -nF "export const" roadmap/backlog.ts` and take the backlog
   array's line number, `<start>`.
2. Locate the target row: `grep -nF "phase: <N>" roadmap/backlog.ts`. A hit ABOVE `<start>` is
   docblock text - discard it; the entry's line is `<hit>`.
3. Count entries in between: `sed -n '<start>,<hit>p' roadmap/backlog.ts | grep -cF "phase:"`
   (fixed-string, bounded to the one file; never a wildcard regex on this shared host).
4. Compute TOTAL the same way with `<hit>` = end of file, and state every position as
   `K of TOTAL`. The checksum catches the off-by-one a single count hides.

Cross-check any position you will cite for a SECOND phase (a dependency, a conflict, a
neighbor) by its own step-2/step-3 run - never by counting on from a previous answer. If two
probes disagree, Read the file slice and count entries by eye before emitting anything.

## FIFO among equals

Equal priority = strict arrival order: the new phase goes AFTER the LAST existing entry of its
tier inside the eligible range. Placing it ahead of ANY older equal-tier entry is a FIFO
violation unless a named higher rule (dependency floor, conflict spacing) forces that exact
spot - when one does, state the forcing rule and the forcing entries in the report. An
insertion that jumps older equal-tier groups on unstated judgment is a finding against the
review itself. Name the rules in the report in their fixed order: dependency floor, then
conflict spacing, then priority/FIFO.

## Placement-only invocations

When the invoker asks only where a phase should sit (validation-only, `--no-queue`, "is K the
right slot?"), the placement question IS the scope:

- Report: the rules applied in order with their evidence, the correct position as `K of TOTAL`,
  plausible counter-positions rejected with evidence, and exactly one outcome token from
  `QUEUED at K | ALREADY at K | MOVED K1→K2 | NOT QUEUED`.
- Do NOT emit holistic or phase-verdict tokens (SOUND/RESHAPE/QUESTION, CLEAN/HAS CONCERNS/
  BLOCKED) - those grade a review that was not asked for.
- Evidence discovered en route that bears on placement (live state contradicting the phase's
  premise, a dependency already done) is reported AS placement evidence, ungraded.
- Frame every proposed edit explicitly as UNAPPLIED; `backlog.ts` is untouched.
