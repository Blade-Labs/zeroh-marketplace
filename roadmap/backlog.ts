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
 * **Queue-only file.** One line per phase entry. No track narratives, no
 * "shipped on" notes, no completed-work summaries, no refresh-date prose.
 * Those belong elsewhere: commit history (git log), the phase file's
 * `compromises` + `gateRounds` fields, `reviews/changelog.json`, or a
 * curated CHANGELOG.md. The backlog answers one question — "what's next?"
 * — and accreted narrative makes that question harder to answer.
 *
 * Two input forms are supported (schema v5+):
 *   1. Flat array — `defineBacklog([{ phase: 1, name: '...' }])`
 *   2. Tiered     — `defineBacklog({ tiers: [{ tier: 0, label: '...', items: [...] }] })`
 *
 * To switch from flat to tiered, replace the array argument with a
 * `{ tiers: [...] }` object — the rest of the lifecycle is unchanged.
 * The flat form is normalized into a single `tier: 0` tier on parse, so
 * downstream code only ever sees the tiered shape.
 *
 * Pattern: zeroh2 golden shapes (heuristic — ZeroH-originated construct).
 */

import { defineBacklog } from '@/lib/roadmap/schema'

export default defineBacklog([
  // ── ARC POLYSEAT tier — phases 1-4 exactly (claimed 2026-08-23), plane order =
  // dependency order: 1 eval records (independent, fills the pipe first) → 2 driver
  // registry → 3 attribution (dependsOn 2) → 4 roles+delivery+manifests (dependsOn 2,3).
  // Queued after 4 Mode A reviews returned READY/CLEAN (2026-08-23). Execute: /do-arc POLYSEAT
  { phase: 1, name: 'Per-phase eval records — the gate emits, the scorecard ingests' },
  {
    phase: 2,
    name: 'Driver registry — one home for launch semantics, probed capabilities, open lane field',
  },
  {
    phase: 3,
    name: 'Mechanical attribution — launcher stamps, validator warns, roles shape lands',
  },
  {
    phase: 4,
    name: 'Role bindings + do-phase delivered by path + manifests generated from one source',
  },
  // ── Standalone, post-arc (dependsOn 4: manifest generator + ratchet) ──────
  {
    phase: 5,
    name: 'Handoff skill — route context into phases first, residue to .building/HANDOFF.md',
  },
  {
    phase: 6,
    name: 'Worktree disposal owned by the done-verbs — land cleans, review-complete archives',
  },
  // ── Post-arc spike (dependsOn 1: peval pipe; LOW — after the fenced 6) ────
  {
    phase: 7,
    name: 'Graft measured trial — integration, footprint proof, before/after instrument',
  },
  // Flat form (back-compat):
  // { phase: 1, name: 'Example phase name' },
  //
  // Or tiered form — comment-out the array and uncomment the block below:
  // {
  //   tiers: [
  //     {
  //       tier: 0,
  //       label: 'Sentinel becomes daily driver',
  //       items: [
  //         { phase: 1, name: 'Example phase name' },
  //       ],
  //     },
  //   ],
  // }
])
