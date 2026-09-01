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
  {
    phase: 7,
    name: 'Graft measured trial — integration, footprint proof, before/after instrument',
  },
  // ── MINESWEEP arc tier (phases 14, 15, 16, 17, 18, 19, 20 — exact claimed numbers; queued 2026-08-31 after all 7 plan reviews returned READY) ──
  {
    phase: 16,
    name: 'Commit-grammar tolerant attribution: one matcher home, widened read, deviant WARNs, grammar in agent cards',
  },
  {
    phase: 18,
    name: 'Measurement repairs: schema-drift check, lessons merge-back on land, eval-gap visibility, census noise',
  },
  {
    phase: 19,
    name: 'Cross-repo gate awareness: productRepos floors review scope, arm-time product-tree overlap refusal',
  },
  {
    phase: 20,
    name: 'Anti-vacuity: scoped-runner cannot-fail probe, widened polarity lint, executable assumption tripwires',
  },
  // ── DEFERRED (standing user hold 2026-08-26): do NOT execute until the user asks ──
  {
    phase: 12,
    name: 'DEFERRED — closed-loop trigger design: scheduled detection that authors draft fix proposals',
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
