/**
 * POLYSEAT — one protocol, any model in any role.
 *
 * Generalize the zeroh-roadmap plugin from a Claude-native harness to a
 * multi-driver one: skills stay the single agent-agnostic protocol source
 * (superpowers-style native distribution per harness), protocol spawn points
 * become ROLES a driver fills per its declared capabilities, a driver registry
 * owns launch semantics, attribution is stamped mechanically by the launcher,
 * and the gate emits per-phase eval records so the scorecard's per-model cells
 * finally accumulate samples. Rationale, research digests (superpowers,
 * GPT-5.6 Sol, codex feature audit) live in the execution prompt:
 * roadmap/arc-prompts/POLYSEAT-execution-prompt.md.
 *
 * LOCKED DECISIONS (user rulings, dated):
 * - 2026-08-23: model gauntlet (item E of the review) DEFERRED — this arc measures, it does not rank.
 * - 2026-08-23: arc self-hosts in zeroh-marketplace (this scaffold), not in azure_private_agent's roadmap.
 * - 2026-08-23: architect seat runs the best model, tier order VERBATIM: 1) Fable 2) Sol 5.6 3) Opus 5
 *   (registry ids: claude-fable-5 → gpt-5.6-sol → claude-opus-5); fallback never reduces rigor,
 *   the deciding model is recorded (extends the v0.32.0 architect-card ruling).
 * - 2026-08-23: per-phase eval records are deterministic + attribution ONLY; judge-scored
 *   dimensions stay arc-level.
 * - 2026-08-23: a delegated driver owns its own gate, filled via seats (upholds the
 *   2026-07-22 "the gate is yours too" ruling).
 * - 2026-08-23: multi-harness distribution is superpowers-inspired — ONE agent-agnostic
 *   skill library shipped through each harness's NATIVE plugin system (.codex-plugin
 *   manifest beside .claude-plugin, precedent: zeroh-sdd); the detached launcher lane
 *   remains for delegation, it stops being the only door.
 * - 2026-08-23: Claude must not be privileged — protocol-load parity across drivers is an
 *   acceptance criterion, not an aspiration.
 * - 2026-08-23 (design-gate ratification): both designs GO, one shared doc. Arc id stays
 *   POLYSEAT; plugin name stays zeroh-roadmap ("roadmap is fine for now" — brand closed for
 *   this arc); "seat" renamed to ROLE (cli/lib/roles.mjs, resolveRole) — "crew" REJECTED,
 *   the model lineup is plain config ("its just models"); "plane" stays.
 * - 2026-08-23: capability ladder is a REQUIREMENT, not a fallback apology — a harness with
 *   no native subagents/hooks still receives the full protocol as prompts (child-CLI or
 *   prompt-delivery mode), first-class and recorded; grok-or-any-future-harness slots in by
 *   registry entry alone.
 * - 2026-08-23: codex hooks are SUPPORTED (feature `hooks` stable+true; superpowers'
 *   .codex-plugin manifest carries skills + hooks keys). Phase 4 PROBES which channel works
 *   (manifest vs .codex/hooks.json) and records the verified one — never assumes absence.
 * - 2026-08-23: harness manifests + versions are SINGLE-SOURCED AND GENERATED (one source of
 *   truth: package.json version + ls skills/; superpowers precedent: .version-bump.json),
 *   never hand-edited, plus a ratchet test failing on any drift. "Never stuff on multiple
 *   places, always reusable."
 *
 * DEFERRED (named owner + escalation point):
 * - Grok registry entry: grok CLI is NOT installed on this host; its entry stays empty until
 *   capabilities are verified at registration (owner: user installs; escalation: `roadmap
 *   driver register` refuses an unverified entry, never guesses).
 * - Historical plannedBy/driver backfill across consumer phases: forward-looking
 *   enforcement only (owner: user; escalation: a validate WARNING names the gap per phase).
 * - Model gauntlet (E): re-aim GAUNTLET-PROMPT.md at drivers once cells hold samples.
 * - Per-seat tier chains for the judge panel (validate-arc panel, code-reviewer,
 *   quality-pass): architect's generalize-forward call — only the architect seat gets a real
 *   3-deep chain in this arc; other seats get 1-entry chains equal to today's behavior.
 * - gemini/cursor/copilot registry entries + reconciling their drifted manifests beyond the
 *   version/skill-list ratchet this arc adds.
 *
 * PROMISE LEDGER (Step 2c — every promise names its fulfilling task):
 * | Promise | Fulfilled by |
 * |---|---|
 * | AC any-model-full-protocol (plan+execute off same SKILL.md, no duplication) | 4.2 (delivery + guard) + 4.1 (roles) + validate-arc drives the real run |
 * | AC measure-planner-vs-executor (cells from ≥2 families) | 1.2 (emit) + 1.3 (ingest) + 3.1/3.2 (attribution feeding cells) |
 * | AC no-claude-privilege (measured parity + recorded cross-family firing) | 4.4 (parity instrument) + 4.1 (chain fires, recorded via 3.3 shape) |
 * | AC per-phase-eval-records (deterministic record ingested) | 1.1 + 1.2 + 1.3 |
 * | designRef §1 Role bindings | 4.1 (roles.mjs + MULTI-DRIVER.md §1 + pointer reduction) |
 * | designRef §2 Driver registry | 2.1–2.3 (module, consumption, verify/register) + MULTI-DRIVER.md §2 in 4.1 |
 * | singleSeam 1 (one protocol body) | 4.2 (run lane pays the debt; review lane already conforms) |
 * | singleSeam 2 (one registry, no stray argv) | 2.2 (ratchet) |
 * | singleSeam 3 (one attribution write path) | 3.1 (journal + reconcile) + 3.2 (warning catch) |
 * | singleSeam 4 (lane mechanics stay single) | 2.2 (LANES untouched, pinned by existing tests) |
 * | honesty rail 1 (declared AND verified capabilities) | 2.3 (verify/register refuses unverified) |
 * | honesty rail 2 (unrecorded named, deciding model recorded) | 3.2 (warnings) + 4.1 (substitution records) |
 * | honesty rail 3 (fallback never reduces rigor) | 4.1 (forced-unavailability falsification) |
 * | honesty rail 4 (parity measured never asserted) | 4.4 |
 * | LOCKED: tier order Fable→Sol→Opus verbatim | 4.1 (tierChain literal + test) |
 * | LOCKED: manifests single-sourced + ratchet | 4.3 |
 * | LOCKED: deterministic-only records | 1.1/1.2 (no judge fields; criterion bars them) |
 * | LOCKED: role rename ratified ("seat" collision) | 4.1 (roles.mjs + glossary line in MULTI-DRIVER.md §1) |
 * | User verbatim: "simply provide the prompts to those" (prompts-only harnesses first-class) | 4.1 (inline/prompts is a recorded resolver mode) + 2.1 (roleCapabilities) |
 * | User verbatim: "never stuff on multiple places, always reusable, same with version" | 4.3 (generator + ratchet) |
 *
 * DECISION-COMPLETENESS SWEEP (Step 1c — every load-bearing choice, bucketed):
 * LOCKED (above) or ruled here:
 * - Role-card set IS the role inventory: roles map 1:1 to agents/*.md cards plus the
 *   spawn-site audit the architect enumerated; no invented roles.
 * - Registry lives in code (cli/lib/drivers.mjs) + gitignored per-host provenance
 *   (.building/driver-verify-<id>.json); NOT in roadmap.config.json (per-host facts must
 *   not be per-consumer claims — architect risk 8). Config gains at most ONE optional key
 *   (modelPolicy.roleModels).
 * - Role table lives in cli/lib/roles.mjs (rename ratified 2026-08-23 — 'seat' collides
 *   with the SEATS dispatcher); agent-card frontmatter stays the harness fail-safe ALIAS
 *   (cards cannot carry full model ids — architect risk 1).
 * - attribution.lane semantics: 'how it was launched' stays; driver identity is the model
 *   field + registry id; widening templates/schema.ts lane enum to z.string().min(1) with
 *   an unknown-id WARNING in the validation engine (architect risk 6; phase 2's review
 *   corrected the sweep's original superRefine wording — a refine FAILS the parse,
 *   resurrecting the corruption bug) — hand-synced to consumers by name.
 * - Per-phase eval records: distinct filename class from arc evals so eval-collect's
 *   *.eval.json scan cannot misread one as the other; scorecard ingests both.
 * - Missing attribution = validate WARNING (never RED — 700 historical phases).
 * designRefs (below): seat/registry schema shapes, MULTI-DRIVER.md single doc, verify verbs.
 * DEFERRED: listed above.
 */

import { defineArc } from '@/lib/roadmap/schema'

export default defineArc({
  id: 'POLYSEAT',
  name: 'Multi-model harness — seats, registry, mechanical attribution, eval records',
  baseRef: 'feat/roadmap-arcs',
  // Claimed numbers, dependency order: 1 = eval records (D), 2 = driver registry (B),
  // 3 = mechanical attribution (C), 4 = seat bindings + protocol delivery + native
  // distribution (A). C reads B's registry; A reads both.
  phases: [1, 2, 3, 4],
  designRefs: [
    {
      kind: 'architecture',
      ref: 'plugins/zeroh-roadmap/MULTI-DRIVER.md §1 Role bindings',
      status: 'designed',
      summary:
        'Role = a protocol spawn point with a class (judge|builder), a model tier chain and a fulfillment mode (native|child-cli|inline); cli/lib/roles.mjs owns the table and resolveRole(); generalizes the software-architect card + review-phase HOME statement, which reduce to pointers with DIET-LEDGER rows in the same commit. Architect chain claude-fable-5 → gpt-5.6-sol → claude-opus-5 (user ruling 2026-08-23). Inline fulfillment is a recorded mode, never indistinguishable from native.',
    },
    {
      kind: 'architecture',
      ref: 'plugins/zeroh-roadmap/MULTI-DRIVER.md §2 Driver registry',
      status: 'designed',
      summary:
        'cli/lib/drivers.mjs is the one home for {launch argv, prompt channel, sandbox posture, resume mechanism, verified seat capabilities}; extends the LANES-table idiom in cli/commands/codex.mjs, whose hardcoded codex argv becomes entry #1. Capabilities are PROBED (roadmap driver verify, shaped after zeroh-sdd codex-hook-discovery.mjs) with verifiedAt provenance; roadmap driver register refuses an unverified entry.',
    },
  ],
  // design gate: UX sub-gate skipped — no user-facing surface (CLI + docs only), 2026-08-23.
  singleSeams: [
    'One protocol body per mission: skills/<mission>/SKILL.md is the only protocol source; every lane and harness delivers it by path and overrides only disposition — a second protocol body anywhere is the drift this arc exists to kill.',
    'One driver registry: every launch argv, prompt channel, sandbox posture and resume mechanism lives in the registry module; no model-specific argv outside it.',
    'One attribution write path: the launcher stamps plannedBy / executionResult.driver / seat bindings; a model self-reports only what the launcher cannot know.',
    'Lane mechanics stay single: journal + sentinel + liveness (refuseIfLive/preserveStaleReport/launch) are shared by every lane; a new driver adds a registry entry, never a parallel launcher.',
  ],
  honestyRails: [
    'Capabilities are declared AND verified per driver, never assumed in either direction — an unverifiable capability is recorded absent, not hoped present.',
    'Missing attribution is recorded as unrecorded, never guessed — and the deciding model of every seat is evidence, recorded per decision.',
    'Fallback never reduces rigor: a seat that falls down its tier chain re-runs at full rigor on the next tier and records the substitution.',
    'Parity claims are measured, never asserted: any "same protocol" claim carries the measure/diff command that would falsify it.',
  ],
  acceptanceCriteria: [
    {
      id: 'any-model-full-protocol',
      job: 'codex, claude, grok or other models can simply follow do-arc, review-phase, all of it (user verbatim, 2026-08-23)',
      surfaces: ['console'],
      signal:
        'a Codex driver plans one real phase (plan-phase) and executes one real phase (do-phase) reading the SAME SKILL.md files Claude reads — judged with the phase files and gate records present on disk, after the runs completed, not on a cold stub: the planned phase passes `roadmap phase validate`, the executed phase reaches a green gate, and no codex-specific protocol body exists (grep for protocol-owned strings in lane prompts returns only path references)',
      tier: 'wired',
      bar: 'both artifacts schema-valid with zero protocol duplication; an inline-only fallback run does NOT satisfy this criterion',
    },
    {
      id: 'measure-planner-vs-executor',
      job: 'assess what is best model for planning, what is best model for executing and comparing (user verbatim, 2026-08-23)',
      surfaces: ['console'],
      signal:
        'after this arc lands and its own phases are executed, `roadmap eval scorecard` in THIS repo shows driver and planner cells holding samples from at least two model families (claude + gpt) — judged on the populated scorecard after the arc, not the empty pre-arc one; cells under the N-floor abstain honestly rather than rank',
      tier: 'wired',
      bar: 'cells exist and carry attribution; abstention is acceptable, empty families are not',
    },
    {
      id: 'no-claude-privilege',
      job: 'do not benefit claude by supporting its protocol while omitting codex/grok if they can also be fully harnessed (user verbatim, 2026-08-23)',
      surfaces: ['console'],
      signal:
        'the protocol load delivered to a codex driver and a claude driver for the same mission is measured equivalent (roadmap measure over both delivery paths, asserted in a test), and the codex driver fills its architect seat through the real tier chain (Fable first) with the seat binding recorded in attribution — judged on a run record where the seat actually fired, not on registry declaration alone',
      tier: 'wired',
      bar: 'measured parity + a recorded cross-family seat decision; declaration without a firing record fails',
    },
    {
      id: 'per-phase-eval-records',
      job: 'the measurement pipe fills from ordinary phase work, not only from arcs',
      surfaces: ['console'],
      signal:
        'executing any single phase through the gate in a configured consumer emits a deterministic per-phase eval record (attribution + gate results + metrics, zero judge tokens) that `roadmap eval scorecard` ingests — judged by running one real phase in this repo end-to-end and pasting the record path + a scorecard read that counts it',
      tier: 'wired',
      bar: 'record present, ingested, attributed; a record requiring a judge call fails the ruling',
    },
  ],
})
