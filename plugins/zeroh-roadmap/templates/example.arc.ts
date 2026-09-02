/**
 * Example Arc — a named, contiguous block of phases shipped as one unit.
 *
 * Arcs are OPT-IN. Author one with `/plan-arc`, build it with `/do-arc <id>`,
 * and close it with `/arc-sweep`. Delete this example once you author a real arc,
 * or keep it as a reference.
 *
 * `defineArc` validates the shape at import time (the same Zod source of truth as
 * `definePhase`). A single-track arc lists its phases via the flat `phases:`
 * field (shown here) — it normalizes to one `Default` plane. A multi-track arc
 * declares named `planes: [{ name, phases }]` instead. `singleSeams` are the
 * "hold these single" invariants the pre-merge arc-sweep judges; `honestyRails`
 * are constraints the whole arc must uphold; `acceptanceCriteria` are the
 * experience-level Definition of Done the terminal `validate-arc` stage drives the
 * real flow and judges against (the JTBD as observable signals — author them WITH
 * the user, pick the cheapest tier that can honestly judge each).
 */

import { defineArc } from '../lib/schema'

export default defineArc({
  id: 'A',
  name: 'Example arc — replace with your own',
  baseRef: 'main',
  phases: [1],
  singleSeams: ['The shared config seam stays a single implementation across the arc.'],
  honestyRails: ['No phase-numbered comments; errors are surfaced, never swallowed.'],
  acceptanceCriteria: [
    {
      id: 'core-job',
      job: 'a user completes the arc’s headline task without hitting a dead end',
      surfaces: ['console'],
      signal: 'the task’s result renders with real data and a clear next step',
      tier: 'wired',
      bar: 'reads as finished — no raw error, no placeholder, no unlabeled row',
    },
  ],
})
