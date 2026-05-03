/**
 * Ordered execution backlog — first entry is next to execute.
 *
 * This file is the single source of truth for execution order.
 * Phase files own status and content; this file owns sequence.
 *
 * Grooming is automatic across the phase lifecycle:
 * - plan-phase does NOT edit this file directly.
 * - review-phase Mode A queues a phase ONLY when the verdict is READY
 *   (no findings, no unresolved [NEEDS CLARIFICATION] markers), at a
 *   position reasoned from priority + dependsOn + conflictsWith.
 * - do-phase reads index 0 when the user says "do next phase".
 * - do-phase Step 5 removes the phase entry when status flips to 'done',
 *   in the same commit that records completion.
 * - audit-roadmap flags stale entries (done phases still listed here).
 *
 * Manual edits remain valid — re-running review-phase on a queued phase
 * validates the position against the rules and proposes a move if
 * incorrect.
 *
 * Duplicate phase numbers are rejected at runtime by Zod.
 *
 * Pattern: zeroh2 golden shapes (heuristic — ZeroH-originated construct).
 */

import { defineBacklog } from '@/lib/roadmap/schema'

export default defineBacklog([
  // { phase: 1, name: 'Example phase name' },
])
