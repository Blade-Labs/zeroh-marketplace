/**
 * Ordered execution backlog — first entry is next to execute.
 *
 * This file is the single source of truth for execution order.
 * Phase files own status and content; this file owns sequence.
 *
 * - plan-phase does NOT auto-append here (new phases are unqueued
 *   until deliberately sequenced in a planning session).
 * - do-phase reads index 0 when user says "do next phase".
 * - Duplicate phase numbers are rejected at runtime by Zod.
 *
 * Pattern: zeroh2 golden shapes (heuristic — ZeroH-originated construct).
 */

import { defineBacklog } from '@/lib/roadmap/schema'

export default defineBacklog([
  // { phase: 1, name: 'Example phase name' },
])
