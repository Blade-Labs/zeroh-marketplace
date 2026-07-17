# UX design-parity rubric — the canonical home

The single canonical statement of the UX design-parity rubric. Cited by name from four sites — the
`intent-validator` agent (which applies it per criterion), `skills/validate-arc/SKILL.md` (the arc-end
`ux-parity:*` criteria), `skills/plan-arc/SKILL.md` (Step 1b(4) mints the paired criterion), and
`skills/do-phase/SKILL.md` (the per-phase design-parity gate stage). One contract, one home — a reader
pulls it on demand; it is not restated in any of those files.

A parity criterion judges the **SHIPPED surface against a USER-CONFIRMED design artifact 1:1** — the
design is a CONTRACT, not inspiration. "Roughly matches" is a gap.

## 1. Render AND drive both sides
Screenshot the shipped surface (via the `live-ui` binding) in EVERY state the design artifact shows —
default, loading, error, empty, expanded (the states ARE part of the design). Render the design artifact
itself: a static HTML preview opens in the same browser lane and is screenshotted too; a prose layout note
is read as the spec. Then DRIVE the interactions on both sides:
- hover/focus each interactive control the design styles;
- trigger the transitions/animations the design defines (open/close, expand, reveal);
- screenshot the hovered / focused / mid-transition states.

A static screenshot pass is structurally blind to interaction drift — the drift users notice first. Motion
that a still cannot evidence is judged by driving it live and DESCRIBING what ran (named in the evidence —
honest observation, never "assumed present"). Capture the paths for evidence.

## 2. Compare on six axes, in order of severity
1. **Layout structure** — regions, hierarchy, reading order match.
2. **Component presence** — everything the design shows EXISTS (a designed panel/card/action that never
   shipped is the classic drift); nothing user-facing was added that the design forbids.
3. **States** — each designed state renders as designed, not as a raw fallback.
4. **Interaction & motion** — every interaction the design defines behaves as designed: hover and focus
   effects, transitions/animations (presence + easing/duration family — off-family, or instant-where-
   animated, is a deviation), cursor affordances, expand/collapse and reveal behaviors. A designed
   interaction that shipped inert or flattened is a deviation of the SAME rank as a missing state.
5. **Copy** — headings/labels/empty-state text match the design's copy (the consumer's copy rules rode the
   design review; shipped rewrites regress it).
6. **Visual tokens** — typography family, spacing rhythm, color family match. Pixel-identical is NOT
   required; off-family is a deviation.

## 3. Judged-equivalent is allowed; degradation is not — "same or better" governs interaction
A component swapped for the consumer's canonical equivalent (same job, same hierarchy) passes;
missing/moved/renamed/visibly degraded fails. An interaction that shipped unambiguously RICHER than
designed (the designed hover plus a focus ring; the designed transition plus reduced-motion support)
passes as better; different-but-not-better, flattened, or inert fails. When unsure, enumerate the
difference and let the two-judge panel disagree visibly rather than rounding to met.

## 4. Exemptions
ONLY deviations named in the arc's `Ratified descopes` (validate-arc hands the judge the list) or a
recorded design-gate re-opening. A deviation explained only by a commit message or a phase note is NOT
ratified — still a gap.

## 5. Verdict
`met` needs NO material deviation on any axis, with the side-by-side screenshot paths as evidence.
Otherwise `gap`, with `whatsMissing` enumerating each deviation (axis + where) and `suggestedFix` naming
the concrete surface change(s).
</content>
