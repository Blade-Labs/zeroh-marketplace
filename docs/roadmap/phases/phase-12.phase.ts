import { definePhase } from '../lib/schema'

/**
 * DEFERRED TODO — closing the SDLC loop: a per-consumer scheduled trigger (nightly builds /
 * detection sweeps) that can open fix PROPOSALS into the normal triage + review gates.
 *
 * User ruling 2026-08-26: "add some todo phase for later, right now don't want to do it. It
 * seems like per-repo setup, like nightly builds that can trigger fixes." Authored as the
 * durable marker of that intent (the Anthropic AI-native-SDLC Stage-6 gap mapped in-session);
 * DO NOT EXECUTE until the user asks. Investigation-shaped by design — the diff is unknowable
 * until the design lands.
 * timing: no reference data for 1-3×surface:false
 */
export default definePhase({
  phase: 12,
  name: 'DEFERRED — closed-loop trigger design: scheduled detection that authors draft fix proposals',
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5' },
  category: 'spike',
  kind: 'logic',
  source:
    'User ruling 2026-08-26 (mid-session, verbatim intent: per-repo nightly-build-style triggers that can open fixes, deferred); gap 2 of the AI-native-SDLC mapping (claude.com/blog/the-ai-native-sdlc-playbook, Stage 6: Maintain — closing the loop).',
  priority: 'LOW',
  dependsOn: [11],
  conflictsWith: [],
  keyFiles: ['plugins/zeroh-roadmap/DESIGN-NOTES.md'],
  stakeholderDemo:
    'A written, user-triageable design for the autonomous half of the roadmap loop: a deterministic scheduled trigger per consumer repo that, on a breach, authors a DRAFT unqueued phase for human triage — never a self-approved change.',
  userFacing: false,
  assumptions: [
    {
      claim: 'The admission primitive the autonomous tier must consult exists: roadmap capacity (phase 11).',
      verify: "bash -c \"test -f plugins/zeroh-roadmap/cli/commands/capacity.mjs && grep -qF 'mandatory admission gate' plugins/zeroh-roadmap/DESIGN-NOTES.md\"",
      onFalse: 'ESCALATE',
    },
    {
      claim: 'The deterministic detection surfaces the design would build on exist: audit-roadmap checks and the followups census CLI.',
      verify: "bash -c \"test -f plugins/zeroh-roadmap/cli/commands/audit.mjs && test -f plugins/zeroh-roadmap/cli/commands/followups.mjs\"",
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '12.1',
      title: 'INVESTIGATION — design the closed-loop trigger (deliverable: DESIGN-NOTES section + user options)',
      problem:
        'Every stage of the roadmap loop needs a human to start it; the AI-native-SDLC Stage-6 pattern (deterministic detection → tiered autonomy → an auto-authored intent artifact re-entering the pipeline) has no plugin counterpart. The parts exist (audit checks, post-merge-watch, followups census, the eval ratchet, roadmap capacity as the spawn-admission gate) but nothing schedules them or turns a breach into a draft proposal.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/DESIGN-NOTES.md',
          description:
            'Author "## Closed-loop trigger design (phase 12)": (1) enumerate the deterministic detection sources with file anchors (audit checks, post-merge-watch marker, followups census, eval ratchet, full-suite nightly); (2) design the tiered response bands (log → diagnose read-only → author a DRAFT unqueued .phase.ts for triage; NEVER queue/execute autonomously) with roadmap capacity as the admission gate for any spawned diagnosis; (3) per-consumer scheduling options (cron, CI nightly, herdr session) with shared-box costs; (4) END with 2-3 options + recommendation — the ruling is user-owned → verify: bash -c "grep -qF \'Closed-loop trigger design\' plugins/zeroh-roadmap/DESIGN-NOTES.md"',
        },
      ],
      acceptanceCriteria: [
        'The section cites every detection source by file anchor verified at execution time, keeps autonomous authority capped at draft-unqueued proposals, and ends with named options + a recommendation; no code mutated',
      ],
      files: ['plugins/zeroh-roadmap/DESIGN-NOTES.md'],
      testMode: 'none',
      done: false,
    },
  ],
  notes:
    'interview: skipped — scope given verbatim in the user\'s 2026-08-26 mid-session ruling (deferred TODO; per-repo nightly-style triggers that can open fixes). ' +
    'STANDING HOLD: the same ruling defers execution — do-phase must not pick this up until the user explicitly asks, regardless of queue position (kept at the backlog tail by LOW + FIFO). ' +
    'Single investigation task below the ~4-task floor for a nameable reason: the phase is a deferred design marker; sharding it would invent work the user declined. Zero-test is legitimate: prose deliverable only.',
})
