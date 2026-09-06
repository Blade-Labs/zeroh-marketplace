import { definePhase } from '../../lib/roadmap/schema'

/** NATIVEGREEN history/worktree plane. timing: no reference data for band 7-9 × surface:false */
export default definePhase({
  phase: 40,
  name: 'Safe pre-PR history normalization and roadmap-owned worktree garbage collection',
  plannedBy: { model: 'gpt-5.6-sol' }, status: 'backlog', category: 'feature', kind: 'hardening',
  source: 'NATIVEGREEN history-and-worktrees plane; plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md §History and worktrees.',
  priority: 'HIGH', arcId: 'NATIVEGREEN', dependsOn: [39], conflictsWith: [],
  keyFiles: ['plugins/zeroh-roadmap/cli/lib/history-normalize.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree-gc.mjs', 'plugins/zeroh-roadmap/cli/lib/landing.mjs', 'plugins/zeroh-roadmap/cli/commands/worktree.mjs'],
  stakeholderDemo: 'A noisy six-phase arc becomes six tree-identical outcome commits before publication, while dry-run/apply cleanup removes only fully proven roadmap-owned inactive integrated lanes and a repeated run is a no-op.',
  userFacing: false, reviewScope: 'full',
  assumptions: [
    { claim: 'Current curation already uses a rescue ref, commit-tree, tree equality, and update-ref compare-and-swap.', verify: 'node --test plugins/zeroh-roadmap/cli/lib/curate.test.mjs', onFalse: 'ESCALATE' },
    { claim: 'Current disposal refuses dirty, live, and uniquely unreachable lane state.', verify: 'node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs', onFalse: 'ESCALATE' },
    { claim: 'Arc landing still contains a raw forced sidecar removal that bypasses disposal proof.', verify: 'bash -c "grep -q \"worktreeRemove:.*--force\" plugins/zeroh-roadmap/cli/lib/landing.mjs && grep -q \"git.worktreeRemove(home, state.sidecar.worktree)\" plugins/zeroh-roadmap/cli/lib/landing.mjs"', onFalse: 'ESCALATE' },
  ],
  tasks: [
    {
      id: '40.1', title: 'Model an auditable pre-publication normalization plan',
      problem: 'Phase-local curation cannot account for trailing gate/fix commits or prove a whole arc maps to one outcome commit per phase.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/history-normalize.mjs', description: 'Derive a deterministic phase-group plan from the arc base, phase metadata, gate evidence, and current head; reject merges, foreign commits, ambiguous ownership, published refs, and already-green PRs. → verify: node --test plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs', description: 'Cover six noisy phases, trailing gate commits, zero/one/two fixes, foreign commits, merge commits, published history, and green-delivery refusal with exact planned parent/tree/message assertions. → verify: node --test plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs' },
      ],
      acceptanceCriteria: ['Each owned phase maps to exactly one ordered tree outcome and retains phase/eval attribution.', 'Any ambiguous, foreign, published, or green input refuses without updating a ref.'],
      files: ['plugins/zeroh-roadmap/cli/lib/history-normalize.mjs', 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['arc base/head', 'phase gate evidence'], produces: ['HistoryNormalizationPlan'] },
    },
    {
      id: '40.2', title: 'Apply normalization with rescue, tree proof, and compare-and-swap',
      problem: 'History surgery is unsafe unless the exact original head is recoverable and concurrent movement cannot be overwritten.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/history-normalize.mjs', description: 'Apply the plan with immutable rescue ref, commit-tree chain, final tree equality, expected-old update-ref, atomic receipt write, and rollback/refusal on every failed proof. → verify: node --test plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/curate.mjs', description: 'Reuse the existing curation primitives rather than duplicating rescue/CAS logic; preserve executeCurate compatibility for phase-local callers. → verify: node --test plugins/zeroh-roadmap/cli/lib/curate.test.mjs plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs' },
      ],
      acceptanceCriteria: ['Normalized head has the original tree and one outcome commit per phase; rescue and receipt identify old/new heads.', 'A concurrent ref advance, tree mismatch, or interrupted receipt refuses and leaves a recoverable ref.'],
      files: ['plugins/zeroh-roadmap/cli/lib/history-normalize.mjs', 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['HistoryNormalizationPlan'], produces: ['HistoryNormalizationReceipt'] },
    },
    {
      id: '40.3', title: 'Expose idempotent normalization at the delivery boundary',
      problem: 'Normalization must occur immediately before first PR publication, not opportunistically after every task or after CI is green.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/commands/arc.mjs', description: 'Add `arc normalize <id> [--apply]` and a callable pre-publish seam; default dry-run, reject post-green cosmetic rewrites, and return the existing receipt on exact replay. → verify: node --test plugins/zeroh-roadmap/cli/commands/arc.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs', description: 'Prove one or two useful correction commits may remain after publication and only a necessary red-CI push may compact a third, using force-with-lease and a fresh rescue. → verify: node --test plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs' },
      ],
      acceptanceCriteria: ['First publish consumes a stable normalization receipt; resume does not create new commits.', 'An already-green PR never receives a cosmetic rewrite; published rewrite is force-with-lease only under the red-CI bound.'],
      files: ['plugins/zeroh-roadmap/cli/commands/arc.mjs', 'plugins/zeroh-roadmap/cli/commands/arc.test.mjs', 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['HistoryNormalizationReceipt'], produces: ['normalized delivery head'] },
    },
    {
      id: '40.4', title: 'Prove whole-arc history losslessness, recovery, and resume',
      problem: 'Unit planning and application checks do not alone fulfill the ledger signal for a six-phase tree-identical history or crash-safe idempotent resume.',
      steps: [
        { file: 'plugins/zeroh-roadmap/test/fixture-consumer/history-normalize.test.mjs', description: 'Create a six-phase repository fixture with task/gate noise, one and two useful fixes, a foreign commit, concurrent ref movement, crashes before/after rescue/CAS/receipt, and repeated resume; compare every original phase boundary tree and final tree to the normalized chain → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/history-normalize.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs', description: 'Mutation-prove tree equality, expected-old CAS, immutable rescue, stable phase attribution, red-only published compaction, and green cosmetic-rewrite refusal by planting one broken guard at a time → verify: node --test plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs' },
      ],
      acceptanceCriteria: ['The six-phase fixture produces exactly six outcome commits whose boundary and final trees equal the recorded originals.', 'Every injected crash or concurrent move preserves an immutable recovery ref and resume converges to the same receipt without another rewrite.', 'One or two useful fixes remain; a third compacts only with an already-required red-CI push, and green is never rewritten.'],
      files: ['plugins/zeroh-roadmap/test/fixture-consumer/history-normalize.test.mjs', 'plugins/zeroh-roadmap/cli/lib/history-normalize.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['HistoryNormalizationReceipt'], produces: ['history normalization conformance evidence'] },
    },
    {
      id: '40.5', title: 'Persist durable identity on every roadmap-created worktree',
      problem: 'A directory prefix, branch name, PID, or age is insufficient proof that Roadmap owns a worktree and may reclaim it.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', description: 'Create an atomic identity record containing schemaVersion, repository identity, worktree id, canonical path, git admin path, branch/ref, purpose, arc/phase/session owner, createdAt, and random nonce; bind registry and journal to that id. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs', description: 'Prove allocation/resume preserves identity and rejects copied, symlinked, mismatched-repo, mismatched-gitdir, duplicate-id, corrupt, and legacy/prefix-only records. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
      ],
      acceptanceCriteria: ['Every newly allocated roadmap worktree has one registry/journal/identity triple joined by an unpredictable id.', 'Copied or incomplete identity never upgrades to owned and never becomes removable.'],
      files: ['plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['worktree allocation request'], produces: ['RoadmapWorktreeIdentity'] },
    },
    {
      id: '40.6', title: 'Classify and garbage-collect only inactive integrated owned lanes',
      problem: 'Inventory is currently observational and cleanup paths do not share a proof that combines ownership, liveness, dirt, reachability, and recoverability.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree-gc.mjs', description: 'Build plan/apply over durable identities: require matching identity, two separately persisted inactive observations separated by the configured interval, clean state, recoverable commits, a fail-closed WorktreeProtectionProbe with no open PR, and ancestor proof before branch deletion; write intent before removal, re-prove at the destructive boundary, then atomically mark performed/reconciled per item. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', description: 'Make surveyLanes expose identity/classification evidence and make disposeWorktree re-run every destructive proof immediately before removal without weakening current refusals. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs' },
      ],
      acceptanceCriteria: ["Classifier units select only matching-ID, independently observed inactive, clean, recoverable, unprotected, integrated lanes.", "Live, dirty, unique, human, other-tool, open-PR, slot, legacy, unknown, symlink, or raced inputs retain the lane with a stable reason."],
      files: ['plugins/zeroh-roadmap/cli/lib/worktree-gc.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['RoadmapWorktreeIdentity'], produces: ['WorktreeProtectionProbe', 'WorktreeGcPlan', 'WorktreeGcReceipt'] },
    },
    {
      id: '40.7', title: 'Route landing, failure, cancellation, and operator GC through one disposer',
      problem: 'Arc landing force-removes its sidecar and cleanup is inconsistent across success and failure terminals.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs', description: 'Delete the raw `worktree remove --force` arc cleanup; invoke the shared GC/disposer after phase/arc land, failure, cancellation, and resume, retaining refused lanes and surfacing per-item receipts. → verify: node --test plugins/zeroh-roadmap/cli/lib/landing.test.mjs plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs' },
        { file: "plugins/zeroh-roadmap/cli/commands/worktree.mjs", description: "Expose worktree gc with apply, inactivity observation, interval, and JSON options; default dry-run, refuse observations below two or a non-positive interval, and never let two observations from one invocation satisfy inactivity. → verify: node --test plugins/zeroh-roadmap/cli/commands/worktree.test.mjs" },
        { file: "plugins/zeroh-roadmap/cli/lib/config.mjs", description: "Add strict worktreeGc policy with enabled, inactiveObservations at least two, positive inactiveIntervalMs, and deleteIntegratedBranches; apply bounded defaults at use sites and treat an unavailable protection probe as protected. → verify: node --test plugins/zeroh-roadmap/cli/lib/config.test.mjs plugins/zeroh-roadmap/cli/commands/worktree.test.mjs" },
        { file: "plugins/zeroh-roadmap/cli/commands/init.mjs", description: "Project worktreeGc into the generated JSON schema and scaffold documented safe values without enabling destructive apply. → verify: node --test plugins/zeroh-roadmap/cli/commands/init.test.mjs plugins/zeroh-roadmap/cli/lib/config.test.mjs" },
      ],
      acceptanceCriteria: ['No landing/failure path calls raw forced worktree removal; all cleanup uses the proof-bearing disposer.', 'Repeated apply is a no-op, partial crashes resume from receipts, and one refusal does not prevent safe independent removals.'],
      files: ['plugins/zeroh-roadmap/cli/lib/landing.mjs', 'plugins/zeroh-roadmap/cli/lib/landing.test.mjs', 'plugins/zeroh-roadmap/cli/commands/worktree.mjs', 'plugins/zeroh-roadmap/cli/commands/worktree.test.mjs', 'plugins/zeroh-roadmap/cli/lib/config.mjs', 'plugins/zeroh-roadmap/cli/lib/config.test.mjs', 'plugins/zeroh-roadmap/cli/commands/init.mjs', 'plugins/zeroh-roadmap/cli/commands/init.test.mjs', 'plugins/zeroh-roadmap/cli/roadmap.config.schema.json'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['WorktreeGcPlan'], produces: ['uniform terminal cleanup'] },
    },
    {
      id: '40.8', title: 'Prove owned-only cleanup under loss, races, and repeated recovery',
      problem: 'The arc ledger requires a 50-lane dry-run/apply proof; per-module tests do not establish zero false deletion across crash and race boundaries.',
      steps: [
        { file: 'plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs', description: 'Create the 50-lane matrix spanning active, closed, open-PR, merged, dirty, unique, slot, legacy, unknown, symlink, copied-id, mismatched-gitdir, and raced lanes; compare dry-run/apply selections and assert only fully proved identities disappear → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs', description: 'Inject process death before and after intent/removal/receipt plus ref, dirt, liveness, PR-protection, and ancestry changes immediately before removal; assert conservative reconciliation, per-item isolation, recoverable refs, retained open-PR branches, and repeat no-op → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs' },
      ],
      acceptanceCriteria: ['Dry-run and apply select the same proved set from all 50 lanes; every unowned, live, dirty, unique, protected, ambiguous, symlinked, or raced lane survives.', 'A crash at every write/removal boundary resumes without false deletion or duplicate destructive action and leaves a recoverable audit trail.', 'A second completed apply is a no-op; one refused item never suppresses another independently safe item.'],
      files: ['plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree-gc.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['WorktreeGcReceipt'], produces: ['owned-worktree GC conformance evidence'] },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes: '## Hypotheses — CONFIRMED cause: terminal orchestration lacks one whole-arc, proof-bearing history/cleanup seam; phase-local curation leaves trailing commits and arc landing calls raw forced sidecar removal (evidence: deriveCurationRange/executeCurate in cli/lib/curate.mjs and defaultGit.worktreeRemove plus landArc in cli/lib/landing.mjs). Refuted rivals: surveyLanes is intentionally observational and disposeWorktree already refuses live, dirty, and unreachable state; the gap is orchestration/identity, not absent low-level guards. Metadata ratification: userFacing false because history and worktree safety are developer-control-plane behavior; full review and TDD are required for history surgery, identity, and destructive cleanup. Suggested config: worktreeGc { enabled?: boolean, inactiveObservations?: integer >= 2, inactiveIntervalMs?: positive integer, deleteIntegratedBranches?: boolean }; defaults apply at use sites. Planned with plan-phase --skip-review; unverified and not queued. designRef: plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md.',
})
