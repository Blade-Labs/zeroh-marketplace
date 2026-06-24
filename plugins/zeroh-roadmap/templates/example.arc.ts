/**
 * Example Arc — a named, contiguous block of phases shipped as one unit.
 *
 * Arcs are OPT-IN. Author one with `/plan-arc`, build it with `/do-arc <id>`,
 * and close it with `/arc-sweep`. Delete this example once you author a real arc,
 * or keep it as a reference.
 *
 * `defineArc` validates the shape at import time (the same Zod source of truth as
 * `definePhase`). Each `plane` is a track of phase numbers; `singleSeams` are the
 * "hold these single" invariants the pre-merge arc-sweep judges; `honestyRails`
 * are constraints the whole arc must uphold.
 */

import { defineArc } from '@/lib/roadmap/schema'

export default defineArc({
  id: 'A',
  name: 'Example arc — replace with your own',
  baseRef: 'main',
  planes: [{ name: 'core', phases: [1] }],
  singleSeams: ['The shared config seam stays a single implementation across the arc.'],
  honestyRails: ['No phase-numbered comments; errors are surfaced, never swallowed.'],
})
