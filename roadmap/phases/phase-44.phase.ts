import { definePhase } from '../../lib/roadmap/schema'

/**
 * NATIVEGREEN code-clarity plane: preserve safety in executable contracts, then remove archaeology.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 44,
  name: 'Encode safety invariants and retire production incident archaeology',
  plannedBy: { model: 'unverified' },
  status: 'backlog',
  category: 'refactor',
  kind: 'hardening',
  source:
    'NATIVEGREEN arc code-clarity plane; concise-current-code criterion and architecture history/worktree/lifecycle contracts.',
  priority: 'MEDIUM',
  arcId: 'NATIVEGREEN',
  dependsOn: [43],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/liveness.mjs',
    'plugins/zeroh-roadmap/cli/lib/liveness.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
    'plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
    'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing.mjs',
    'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
    'plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs',
    'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
  ],
  stakeholderDemo:
    'Production source explains present invariants in compact language, while regression tests, types, names, ADRs and eval records retain every safety boundary previously carried by dated incidents and phase-number stories.',
  userFacing: false,
  testScope: 'full',
  reviewScope: 'full',
  assumptions: [
    {
      claim: 'The targeted production paths still contain dated, phase-numbered, attempt-numbered, or codename incident narration rather than only current semantic contracts.',
      verify:
        'bash -c "rg -n \"20[0-9]{2}-[0-9]{2}-[0-9]{2}|phase [0-9]{2,}|attempt [0-9]+|POLYSEAT|MINESWEEP|EVALCORE|ROADCODE\" plugins/zeroh-roadmap/cli/lib/{liveness,executor-arm,worktree,landing}.mjs plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Phases 37 through 43 have already encoded the semantic reducer, adapters, delivery, history, GC, exact-head CI, and conformance contracts this cleanup must preserve.',
      verify:
        'bash -c "for n in 37 38 39 40 41 42 43; do grep -Eq \"status:.*done\" docs/roadmap/phases/phase-$n.phase.ts || exit 1; done"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Historical Gauntlet, design, phase, and eval records remain available as the correct home for provenance removed from production comments.',
      verify:
        'bash -c "test -f plugins/zeroh-roadmap/DESIGN-NOTES.md && test -f plugins/zeroh-roadmap/GAUNTLET-2.0.md && test -d docs/roadmap/arc-evals && test -d docs/roadmap/phases"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '44.1',
      title: 'Define and mutation-prove the production-comment archaeology policy',
      problem:
        'A broad deletion pass could erase load-bearing safety rationale unless the allowed semantic vocabulary and forbidden historical forms are executable and mutation-tested first.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Define PRODUCTION_HISTORY_TARGETS, ALLOWED_SEMANTIC_LITERALS and FORBIDDEN_ARCHAEOLOGY patterns for dates, phase/attempt IDs, codenames and postmortem narration; exclude tests, ADRs, evals, changelogs and fixtures from the production scan. → verify: node --test --test-name-pattern="policy|scope" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Add mutation fixtures proving a dated incident, phase-number rationale, codename and attempt story RED while protocol versions, schema versions, HTTP status codes, numeric thresholds and current invariant comments GREEN only through explicit semantic allowlisting. → verify: node --test --test-name-pattern="mutation|allowlist" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'The scan is limited to named production files and cannot force deletion from ADRs, tests, eval records, roadmap artifacts, changelogs, generated reports, or fixtures.',
        'Each forbidden historical form has a planted RED and each allowed semantic-data category has a planted GREEN.',
        'Allowlist entries name a semantic reason; no path-wide or generic numeric suppression is accepted.',
      ],
      files: ['plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs'],
      testMode: 'tdd',
      done: false,
      interfaces: { produces: ['PRODUCTION_HISTORY_TARGETS', 'FORBIDDEN_ARCHAEOLOGY'], consumes: [] },
    },
    {
      id: '44.2',
      title: 'Move liveness and executor ownership rationale into names, types, and tests',
      problem:
        'Liveness and executor-arm code contains incident narratives around stale beacons, product overlap, arms and transcript uncertainty; cleanup is safe only after those distinctions are asserted structurally.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/liveness.mjs',
          description:
            'Replace historical prose with concise current contracts and extract or rename predicates/results so live, stalled, exited and unobserved remain distinct and every non-live outcome carries evidence plus a resume action. → verify: node --test plugins/zeroh-roadmap/cli/lib/liveness.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
          description:
            'Replace double-spawn and stale-arm incident narration with named ownership/inactivity predicates and typed refusal reasons; preserve session/executor identity, product-tree overlap, beacon evidence and compare-before-disarm behavior. → verify: node --test plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/liveness.test.mjs',
          description:
            'Preserve existing regression tests and add only missing behavioral assertions for unobservable-not-stalled, live-background-not-stalled, mismatched phase token, product overlap and bounded probe evidence. → verify: node --test plugins/zeroh-roadmap/cli/lib/liveness.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs',
          description:
            'Preserve existing tests and pin one-owner, no-unbound-arm, no-live-disarm, exact identity and overlap behavior without dates or phase-history narration. → verify: node --test plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Liveness retains distinct live, stalled, exited and unobserved semantics with evidence and bounded recovery in tests.',
        'Executor arms still refuse duplicate ownership and unsafe disarm using explicit identity and current evidence.',
        'Production comments in the four changed files pass FORBIDDEN_ARCHAEOLOGY without suppressing the invariant assertions.',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/liveness.mjs',
        'plugins/zeroh-roadmap/cli/lib/liveness.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/executor-arm.mjs',
        'plugins/zeroh-roadmap/cli/lib/executor-arm.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['44.1'],
      interfaces: { consumes: ['FORBIDDEN_ARCHAEOLOGY'], produces: ['current liveness predicates', 'current executor ownership predicates'] },
    },
    {
      id: '44.3',
      title: 'Make worktree disposal and history safety self-explanatory',
      problem:
        'Worktree and history code uses accumulated incident prose to explain destructive boundaries; those boundaries must instead be obvious in classifier/disposer types, refusal names, and adversarial tests.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
          description:
            'Replace provenance narration with concise precondition comments and named identity, inactivity-twice, clean, reachable, recoverable, compare-and-swap and rescue-ref decisions shared by allocation, landing, cancellation, resume and GC. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
          description:
            'Retain existing test names unless misleading and preserve adversarial coverage for dirty, unique, live, human, other-tool, open-PR, merged-ancestor, symlink, identity mismatch and just-before-remove race cases. → verify: node --test plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Add a semantic-surface assertion that every destructive worktree decision exercised above has a named refusal/receipt value before its explanatory archaeology is allowed to disappear. → verify: node --test --test-name-pattern="worktree semantic surface" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'No removal is justified by prefix or age; identity, repeated inactivity, cleanliness, reachability, recoverability and final race recheck remain asserted.',
        'Open-PR branches remain retained and merged branches require ancestry proof.',
        'Every destructive refusal and success path has a stable name or typed receipt consumed by tests and diagnostics.',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/worktree.mjs',
        'plugins/zeroh-roadmap/cli/lib/worktree.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['44.2'],
      interfaces: { consumes: ['FORBIDDEN_ARCHAEOLOGY'], produces: ['named worktree safety decisions'] },
    },
    {
      id: '44.4',
      title: 'Clarify landing and arc workflow invariants without incident narration',
      problem:
        'Landing and the arc-plane workflow contain historical stories around serialization, executor re-await, arm lifecycle and terminal actions; the current transition system should carry those rules directly.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.mjs',
          description:
            'Condense comments to current preconditions and delivery semantics; encode exact-head checks, no cosmetic green rewrite, provider request/receipt persistence, push/PR idempotency and merge authority in named decisions consumed by landing tests. → verify: node --test plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs',
          description:
            'Replace dated/phase-number incident prose with concise state-machine contracts; preserve same-executor re-await, no watchdog kill, typed unobserved, arm-before-spawn, result validation, self-descope halt, verify-complete and serialized groom/emit behavior. → verify: node --test plugins/zeroh-roadmap/workflows/arc-plane.workflow.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
          description:
            'Reuse existing cases and assert exact-head invalidation after push, stable PR reconciliation, default open-PR terminal, held merge authority, no cosmetic rewrite and recovery receipt behavior. → verify: node --test plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Require landing and arc-plane production paths to pass the archaeology scan and assert their current terminal/halt vocabulary remains present after cleanup. → verify: node --test --test-name-pattern="landing|arc-plane" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Landing and workflow suites pass with exact-head, idempotency, authority, recovery, same-executor and typed-halt invariants intact.',
        'Production comments state current why/constraint only and contain no incident dates, phase numbers, attempts, codenames or postmortem narration.',
        'Existing behavior coverage is preserved; source comment cleanup does not require cosmetic test renaming.',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/landing.mjs',
        'plugins/zeroh-roadmap/cli/lib/landing.test.mjs',
        'plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs',
        'plugins/zeroh-roadmap/workflows/arc-plane.workflow.test.mjs',
        'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['44.3'],
      interfaces: { consumes: ['FORBIDDEN_ARCHAEOLOGY', 'current liveness predicates', 'named worktree safety decisions'], produces: ['current landing/workflow invariant vocabulary'] },
    },
    {
      id: '44.5',
      title: 'Relocate non-user provenance and close the concise-code gate',
      problem:
        'Useful rationale removed from production must not vanish, but non-user incident history also does not belong in README or orientation; it needs a durable architecture record and a repository-wide closeout check.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md',
          description:
            `Add a compact Provenance and retained invariants section linking the relevant Gauntlet, eval and Git records for liveness, ownership, landing, history and GC decisions without copying incident narratives into user documentation. → verify: node -e "const s=require('fs').readFileSync('plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md','utf8');for(const x of ['## Provenance and retained invariants','GAUNTLET-3.0.md','docs/roadmap/arc-evals','git log'])if(!s.includes(x))process.exit(1)"`,
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Run the final named production inventory, fail on new unclassified production files in the landing/liveness/arm/worktree/workflow seams, and prove the architecture/history homes are excluded rather than globally sanitized. → verify: node --test plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Add an invariant-preservation checklist that maps each removed safety rationale to an existing behavior assertion and durable source pointer; missing mappings fail, while behavior suites (not mere token presence) establish preservation. → verify: node --test --test-name-pattern="invariant preservation" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'Historical provenance is linked from architecture documentation and remains in Gauntlet/eval/Git homes, not copied into README, orientation, or production comments.',
        'The complete production target inventory passes the archaeology scan twice and rejects an unclassified new source file at a governed seam.',
        'All landing, liveness, arm, guard, worktree and workflow suites pass after cleanup, followed by the full configured gate.',
      ],
      files: [
        'plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md',
        'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['44.4'],
      interfaces: { consumes: ['current landing/workflow invariant vocabulary', 'Gauntlet 3 claim inventory'], produces: ['architecture provenance index', 'concise-code gate'] },
    },
    {
      id: '44.6',
      title: 'Ratchet user diagnostics, comment volume, and Git-backed provenance',
      problem:
        'A comment-only scan can leave incident archaeology in user-visible errors, while moving deleted stories into architecture prose would preserve the same maintenance burden under a different path.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Scan comments and user-visible diagnostic literals separately across the existing named production inventory; apply the same forbidden-history patterns to both, retain semantic allowlists with reasons, and mutation-prove dated, phase, attempt, codename and postmortem diagnostics RED. → verify: node --test --test-name-pattern="diagnostic archaeology" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
          description:
            'Extend the existing DIET-LEDGER.md disposition practice with a bounded comment/provenance volume budget recorded after cleanup; fail growth beyond that reviewed budget, and reject provenance entries that retell an incident instead of naming a current invariant plus an ADR/eval/Gauntlet path and a path-scoped git log command. → verify: node --test --test-name-pattern="volume ratchet|Git provenance" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
        {
          file: 'plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md',
          description:
            'Keep the provenance section as a compact index of current invariant, durable record path, and copy-pasteable `git log -- <path>` lookup; do not reproduce dates, attempts, codenames, incident timelines, or user guidance. → verify: node --test --test-name-pattern="Git provenance" plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        },
      ],
      acceptanceCriteria: [
        'The bounded production inventory contains no forbidden archaeology in either comments or user-visible diagnostic literals, with planted mutations proving every class is detected.',
        'Operative rationale remains in named decisions, types, assertions, tests, or a concise current-invariant comment; deletion alone cannot satisfy the invariant-preservation mapping.',
        'Production-comment and architecture-provenance volume cannot grow silently, and historical lookup is delegated to named durable records plus path-scoped Git commands rather than copied prose.',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/lib/history-comments.test.mjs',
        'plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md',
      ],
      testMode: 'tdd',
      done: false,
      dependsOn: ['44.5'],
      interfaces: { consumes: ['concise-code gate', 'architecture provenance index'], produces: ['diagnostic archaeology gate', 'comment/documentation volume ratchet', 'Git provenance lookup'] },
    },
  ],
  notes:
    'Replan 2026-09-06 against source036b7c5; anchors readLiveness, disposeWorktree, landArc, correctnessDecision and arc-plane workflow already enforce safety. Reuse their behavioral tests and DIET-LEDGER.md; do not introduce a runtime proof checker or scan retained logs/JSON. Keep the original two-pass conformance requirement as focused affected-suite runs, not two full repository gates; prior READY is historical and fresh review is required. Author model identity is not externally attested. Future modules and verifies are implementation obligations, not existing passes. Scoped task checks use the shipped capbuild pool; the configured terminal suite remains full. interview: skipped — arc member; NATIVEGREEN.arc.ts records the cleanup ruling. [FIXED] Added ledger task 44.6 so the arc criterion covers production diagnostics as well as comments, preserves operative rationale through an explicit mapping, delegates historical lookup to path-scoped Git commands, and ratchets comment/provenance volume against silent growth. userFacing false: this phase refactors internal source comments, diagnostics, tests, names and architecture provenance without changing consumer behavior, so no flag applies. Full test and review scopes are deliberate because safety rationale moves across destructive and concurrent seams. Documentation hierarchy ruling: durable engineering rationale goes to a compact docs/architecture index; user tasks and claims remain for phase 45; incident evidence remains in Gauntlet/eval/Git rather than being duplicated. The boundary wrapper stopped in dependency preflight with ERR_PNPM_IGNORED_BUILDS before classifying paths. Mode A review ran --no-queue; backlog remains untouched.',
})
