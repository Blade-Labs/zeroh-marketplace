import { definePhase } from '../lib/schema'

/** NATIVEGREEN history/worktree plane. timing: no reference data for band 7-9 × surface:false */
export default definePhase({
  phase: 40,
  name: 'Safe pre-PR history normalization and roadmap-owned worktree garbage collection',
  plannedBy: { model: 'unverified' }, status: 'in-progress', category: 'feature', kind: 'hardening',
  source: 'NATIVEGREEN history-and-worktrees plane; plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md §History and worktrees.',
  priority: 'HIGH', arcId: 'NATIVEGREEN', dependsOn: [39], conflictsWith: [],
  keyFiles: ['plugins/zeroh-roadmap/cli/lib/history-normalize.mjs', 'plugins/zeroh-roadmap/cli/lib/curate.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs', 'plugins/zeroh-roadmap/cli/lib/landing.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/worktree.mjs'],
  stakeholderDemo: 'A noisy six-phase arc becomes six tree-identical outcome commits before publication, while dry-run/apply cleanup removes only fully proven roadmap-owned inactive integrated lanes and a repeated run is a no-op.',
  userFacing: false, reviewScope: 'full',
  assumptions: [
    {
      "claim": "Existing curation and disposal owners and their behavior tests are present.",
      "verify": "grep -qF 'export function executeCurate' plugins/zeroh-roadmap/cli/lib/curate.mjs && grep -qF 'export function disposeWorktree' plugins/zeroh-roadmap/cli/lib/worktree.mjs && test -f plugins/zeroh-roadmap/cli/lib/curate.test.mjs && test -f plugins/zeroh-roadmap/cli/lib/worktree.test.mjs",
      "onFalse": "ESCALATE"
    }
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
      id: '40.5', title: 'Bind roadmap-owned identity across the existing journal and registry',
      problem: 'A directory prefix, branch name, PID, or age is insufficient proof that Roadmap owns a worktree and may reclaim it.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/codex-journal.mjs', description: 'Extend the existing atomic lane-journal writer/parser with one unambiguous ownership id and repository/worktree binding; do not create another identity store. → verify: node --test plugins/zeroh-roadmap/cli/lib/codex-journal.test.mjs plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs', description: 'At each run, plan, and review allocation, mint the ownership id once, register the canonical repository/worktree/git-admin/branch/owner binding through worktree.mjs, and pass the same id and binding to writeJournal before launch; refuse and unwind a partial allocation when either durable record cannot be written. → verify: node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs plugins/zeroh-roadmap/cli/lib/codex-journal.test.mjs plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', description: 'Resolve ownership only when journal and registry independently parse and agree on identity, repository, canonical path, git-admin path, branch, and owner; names, prefixes, PIDs, age, copied records, and either record alone never prove ownership. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
      ],
      acceptanceCriteria: ['Every newly allocated roadmap worktree has matching journal and registry records joined by one unambiguous ownership id.', 'Copied, incomplete, conflicting, prefix-only, or single-record identity never upgrades to owned and never becomes removable.'],
      files: ['plugins/zeroh-roadmap/cli/lib/codex-journal.mjs', 'plugins/zeroh-roadmap/cli/lib/codex-journal.test.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['worktree allocation request'], produces: ['RoadmapWorktreeIdentity'] },
    },
    {
      id: '40.6', title: 'Classify and garbage-collect only inactive integrated owned lanes',
      problem: 'Inventory is currently observational and cleanup paths do not share a proof that combines ownership, liveness, dirt, reachability, and recoverability.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', description: 'Extend surveyLanes and disposeWorktree with dry-run/apply classification over matched journal/registry identity: require two persisted inactive observations from distinct invocations separated by policy interval, clean state, recoverable commits, no provider protection, and integration ancestry. Persist observation and per-item planned/removing/removed-or-held receipt transitions atomically on the existing registry record; an absent worktree after a crash converges the same receipt, and no standalone GC journal is introduced. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs', description: 'At the destructive boundary re-read both identities and re-run liveness, dirt, reachability, provider protection, and ancestry proofs; unavailable, ownership-uncertain, or changed evidence records a stable hold, and disposeWorktree remains the only destructive rail. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
      ],
      acceptanceCriteria: ["Classifier units select only matching-ID, independently observed inactive, clean, recoverable, unprotected, integrated lanes.", "Live, dirty, unique, human, other-tool, open-PR, slot, legacy, unknown, symlink, or raced inputs retain the lane with a stable reason."],
      files: ['plugins/zeroh-roadmap/cli/lib/worktree.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['RoadmapWorktreeIdentity'], produces: ['WorktreeProtectionProbe', 'WorktreeCleanupPlan', 'WorktreeCleanupReceipt'] },
    },
    {
      id: '40.7', title: 'Route landing, failure, cancellation, and operator GC through one disposer',
      problem: 'Arc landing force-removes its sidecar and cleanup is inconsistent across success and failure terminals.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs', description: 'Delete the raw sidecar removal and route phase/arc land, failure, cancellation, and resume through the existing disposeWorktree rail, retaining refused lanes and surfacing per-item evidence. → verify: node --test plugins/zeroh-roadmap/cli/lib/landing.test.mjs plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/codex.mjs', description: 'Route run/plan/review completion, failed launch cleanup, cancellation, and status-driven resume through the same ownership-aware disposer and receipt transition API; retain every uncertain/refused lane with its stable reason. → verify: node --test plugins/zeroh-roadmap/cli/commands/codex.test.mjs plugins/zeroh-roadmap/cli/lib/worktree.test.mjs' },
        { file: "plugins/zeroh-roadmap/cli/commands/worktree.mjs", description: "Expose worktree gc with apply, inactivity observation, interval, and JSON options; default dry-run, refuse observations below two or a non-positive interval, and never let two observations from one invocation satisfy inactivity. → verify: node --test plugins/zeroh-roadmap/cli/commands/worktree.test.mjs" },
        { file: "plugins/zeroh-roadmap/cli/lib/config.mjs", description: "Add strict worktreeGc policy with enabled, inactiveObservations at least two, positive inactiveIntervalMs, and deleteIntegratedBranches; apply bounded defaults at use sites and treat an unavailable protection probe as protected. → verify: node --test plugins/zeroh-roadmap/cli/lib/config.test.mjs plugins/zeroh-roadmap/cli/commands/worktree.test.mjs" },
        { file: "plugins/zeroh-roadmap/cli/commands/init.mjs", description: "Project worktreeGc into the generated JSON schema and scaffold documented safe values without enabling destructive apply. → verify: node --test plugins/zeroh-roadmap/cli/commands/init.test.mjs plugins/zeroh-roadmap/cli/lib/config.test.mjs" },
      ],
      acceptanceCriteria: ['No landing/failure path calls raw forced worktree removal; all cleanup uses the proof-bearing disposer.', 'Repeated apply is a no-op, partial crashes resume from receipts, and one refusal does not prevent safe independent removals.'],
      files: ['plugins/zeroh-roadmap/cli/lib/landing.mjs', 'plugins/zeroh-roadmap/cli/lib/landing.test.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.mjs', 'plugins/zeroh-roadmap/cli/commands/codex.test.mjs', 'plugins/zeroh-roadmap/cli/commands/worktree.mjs', 'plugins/zeroh-roadmap/cli/commands/worktree.test.mjs', 'plugins/zeroh-roadmap/cli/lib/config.mjs', 'plugins/zeroh-roadmap/cli/lib/config.test.mjs', 'plugins/zeroh-roadmap/cli/commands/init.mjs', 'plugins/zeroh-roadmap/cli/commands/init.test.mjs', 'plugins/zeroh-roadmap/cli/roadmap.config.schema.json'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['WorktreeCleanupPlan'], produces: ['uniform terminal cleanup'] },
    },
    {
      id: '40.8', title: 'Prove owned-only cleanup under loss, races, and repeated recovery',
      problem: 'The arc ledger requires a 50-lane dry-run/apply proof; per-module tests do not establish zero false deletion across crash and race boundaries.',
      steps: [
        { file: 'plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs', description: 'Create an explicit table of exactly 50 uniquely labelled lanes spanning active, closed, open-PR, merged, dirty, unique, slot, legacy, unknown, symlink, copied-id, mismatched-gitdir, ownership-uncertain, unavailable-provider, crash-boundary, and disposal-race cases; assert table length 50, compare dry-run/apply selections by label, and assert only fully proved identities disappear. → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs', description: 'Deterministically cover all 50 lanes and disposal-boundary races, then run bounded native Git confirmation over representative clean-owned, dirty, unique, protected, and raced lanes; provider credentials remain external and unavailable usage records observed: unknown. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs' },
      ],
      acceptanceCriteria: ['Dry-run and apply select the same proved set from all 50 lanes; every unowned, live, dirty, unique, protected, ambiguous, symlinked, or raced lane survives.', 'A crash at every write/removal boundary resumes without false deletion or duplicate destructive action and leaves a recoverable audit trail.', 'A second completed apply is a no-op; one refused item never suppresses another independently safe item.'],
      files: ['plugins/zeroh-roadmap/test/fixture-consumer/worktree-gc.test.mjs', 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs'], testMode: 'tdd', done: false,
      interfaces: { consumes: ['WorktreeCleanupPlan'], produces: ['owned-worktree cleanup conformance evidence'] },
    },
  ],
  reviewRecord: { date: '2026-09-06', model: 'unverified (requested gpt-5.6-sol)', verdict: 'READY', via: 'executed' },
  notes: 'Resume preflight repair: absence of future modules and presence of defects are historical observations at036b7c5, not runtime prerequisites. The original observation remains in Git; legitimate in-progress work must not be stopped because earlier tasks repaired it. Preflights are cheap; behavior suites belong to task/gate verification. ## Hypotheses — CONFIRMED cause: terminal orchestration lacks one whole-arc history seam and proof-bearing cleanup classification on the existing disposer; phase-local curation leaves trailing commits and landArc directly removes its sidecar (evidence: deriveCurationRange/executeCurate in cli/lib/curate.mjs, disposeWorktree in cli/lib/worktree.mjs, landArc in cli/lib/landing.mjs). Refuted rivals: codex-journal, surveyLanes, disposeWorktree, and landing already own identity evidence, inventory, refusal safety, and terminal cleanup; extend those homes and do not create a parallel journal or GC transaction framework. Metadata ratification: userFacing false because history and worktree safety are developer-control-plane behavior; full review and TDD are required. Requested planner model was gpt-5.6-sol; runtime identity was not attested, so plannedBy.model is unverified. Suggested config: worktreeGc { enabled?: boolean, inactiveObservations?: integer >= 2, inactiveIntervalMs?: positive integer, deleteIntegratedBranches?: boolean }. Planned with plan-phase --skip-review; unverified and not queued. designRef: plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md.',
})
