import { defineArc } from '../lib/schema'

/**
 * NATIVEGREEN — native Claude/Codex intent-to-green-PR.
 *
 * LOCKED DECISIONS (user rulings, dated):
 * - 2026-09-04: every actionable review finding is in scope; documentation is last.
 * - 2026-09-04: no local ELI5 skill/invocation copy; repository documentation supplies truth.
 * - 2026-09-04: marketplace roadmap and schema move atomically under docs/roadmap.
 * - 2026-09-04: one arc = one PR; separate independent/stacked arcs; grouping is explicit.
 * - 2026-09-04: default terminal is an open green PR; merge/queue is config-authorized.
 * - 2026-09-04: repair causal and owned pre-existing CI failures; leave unrelated failures.
 * - 2026-09-04: normalize before PR; 1-2 useful fixes may remain; never rewrite green for cosmetics.
 * - 2026-09-04: reclaim only mechanically proven roadmap-owned inactive worktrees.
 * - 2026-09-04: plan-arc go confirms Disclosure canon and evolved-orientation visual arm.
 *
 * - 2026-09-06: "update roadmap plugin in cache, and replan remaining of NATIVEGREEN so rest can be done as arc? test it this way?" Planning/cache rehearsal; implementation remains a subsequent execution.
 * - 2026-09-06: interview/design reused from ratified Sep04 decisions; current source036b7c5 includes owner model ruling849635f and bounded repair23c7786.
 *
 * Review repair 2026-09-04: phase 39 owns non-vacuous import validation and all active
 * post-migration plan/config/script paths; phases 42/45 must pass migrated-layout preflights.
 * PROMISE LEDGER (existing task ranges expand only within their named phase)
 * packaging-valid | criterion | 36.1–36.4 +43.4
 * semantic-parity | criterion | 37.1–37.3 +37.6 +38.1–38.6 +43.7
 * one-roadmap-root | criterion | 39.1–39.5
 * clean-review-input | criterion | 37.4–37.6
 * curated-history | criterion | 40.1–40.4
 * owned-worktree-gc | criterion | 40.5–40.8
 * idempotent-green-pr | criterion | 41.1–41.7 +42.1–42.8
 * gauntlet-conformance | criterion | 43.1–43.8
 * concise-current-code | criterion | 44.1–44.6
 * truthful-visual-docs | criterion | 45.1–45.8
 * plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md | designRef | 36.1–36.2 +37.1–37.6 +38.1–38.6 +39.1–39.5 +40.1–40.8 +41.1–41.7 +42.1–42.8 +43.1–43.8
 * plugins/zeroh-roadmap/docs/ux-previews/intent-to-green-pr-visual-guide-layout.md | designRef | 45.1–45.8
 * harness-neutral reducer | singleSeam | 37.1–37.3 +41.1 +42.2
 * role/driver registry | singleSeam | 36.2 +38.1–38.6
 * discovered root | singleSeam | 39.1–39.5
 * delivery reducer/receipt | singleSeam | 41.1–41.7 +42.1–42.8
 * inventory/classifier/disposer | singleSeam | 40.5–40.8
 * documentation projections | singleSeam | 45.1–45.8
 * no authority enlargement | honestyRail | 36.1–36.2 +38.2–38.5 +41.3 +41.5 +43.6
 * exact-head green | honestyRail | 42.1–42.2 +42.5–42.8
 * unrelated/indeterminate untouched | honestyRail | 42.3–42.4 +42.6 +42.8
 * no cosmetic green rewrite | honestyRail | 40.1–40.4 +42.5
 * no unowned worktree removal | honestyRail | 40.5–40.8
 * truthful docs/no ELI5 invocation | honestyRail | 43.8 +45.1–45.8
 * all actionable findings; documentation last | locked | 36.1–45.8 (existing phase task sets; no intervening task IDs inferred)
 * atomic marketplace roadmap/schema move | locked | 39.1–39.5
 * one arc/one PR; independent/stacked; explicit grouping | locked | 41.2 +41.4 +41.7 +43.5
 * default open green PR; configured merge/queue | locked | 41.5–41.7 +42.6–42.8
 * causal and owned repair; unrelated left | locked | 42.3–42.8
 * normalize before PR;1–2 useful fixes; no cosmetic green rewrite | locked | 40.1–40.4 +42.5
 * owned inactive cleanup only | locked | 40.5–40.8
 * Disclosure canon/evolved orientation | locked | 45.5 +45.8
 * no local ELI5 invocation | locked | 45.2–45.3 +45.7–45.8
 * original review R1 packaging | source-finding | 36.3–36.4
 * original review R2/R3 adapters/parity | source-finding | 38.1–38.6 +43.1–43.8
 * original review R4 PR terminal | source-finding | 41.1–41.7 +42.1–42.8
 * original review R5 lifecycle/eval/recovery | source-finding | 37.1–37.3 +37.6
 * original review R6 governance | source-finding | 36.1–36.2
 * original review R7 exact-head identity | source-finding | 37.4–37.6 +38.2
 * original strong recommendations: neutral actions/current capabilities | source-finding | 38.1–38.6
 * original strong recommendations: source-edit-constrained judges | source-finding | 41.3 +41.7 +43.3
 * original strong recommendations: post-land failure/no replay | source-finding | 37.3 +41.6
 * original strong recommendations: foreign dirt preserved | source-finding | 36.1–36.2 +39.1–39.5 +40.5–40.8
 * original review documentation/clarity addenda | source-finding | 44.1–44.6 +45.1–45.8
 * Sep04 import/pending-path review repairs | source-finding | 39.3–39.5
 * "replan remaining of NATIVEGREEN so rest can be done as arc? test it this way?" | request | 36.1–45.8; cache/plan rehearsal recorded in arc-evals/NATIVEGREEN-replan-2026-09-06.md
 * "update roadmap plugin in cache" | request | completed setup outside implementation tasks; same closing report records installed paths/source identity
 */
export default defineArc({
  id: 'NATIVEGREEN',
  name: 'Native Claude/Codex intent-to-green-PR with bounded repair, clean history, and owned cleanup',
  baseRef: 'fix/roadmap-bounded-intent-repairs',
  planes: [
    { name: 'governance', phases: [36] },
    { name: 'semantic-core', phases: [37] },
    { name: 'harness-adapters', phases: [38] },
    { name: 'artifact-root', phases: [39] },
    { name: 'history-and-worktrees', phases: [40] },
    { name: 'pr-delivery', phases: [41] },
    { name: 'ci-repair', phases: [42] },
    { name: 'conformance', phases: [43] },
    { name: 'code-clarity', phases: [44] },
    { name: 'documentation', phases: [45] },
  ],
  designRefs: [
    { kind: 'architecture', ref: 'plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md', status: 'reused', summary: 'Reuse the ratified design and shipped 0.40.x primitives; one typed semantic core with Claude/Codex/provider adapters, green-PR repair, branch/history policy, owned GC, root-first artifacts, and generated documentation.' },
    { kind: 'ux', ref: 'plugins/zeroh-roadmap/docs/ux-previews/intent-to-green-pr-visual-guide-layout.md', status: 'reused', summary: 'Evolve orientation with Disclosure canon after conformance; Markdown stays complete and HTML is generated enhancement.' },
  ],
  rejectedAlternatives: [
    { option: 'prompt-only-cross-harness', why: 'No durable identity, idempotent external action, or equal enforcement.', decidedBy: 'user after architect recommendation', decidedAt: '2026-09-04' },
    { option: 'hosted-orchestrator-v1', why: 'Adds deployment/auth/data boundaries before the local contract exists.', decidedBy: 'user after architect recommendation', decidedAt: '2026-09-04' },
    { option: 'one-pr-for-all-active-arcs', why: 'Weakens attribution and rollback; grouping remains explicit.', decidedBy: 'user', decidedAt: '2026-09-04' },
    { option: 'automatic-merge-default', why: 'Open green PR is the default; merge is explicit policy.', decidedBy: 'user', decidedAt: '2026-09-04' },
    { option: 'prefix-only-worktree-cleanup', why: 'Names prove neither ownership, inactivity, nor recovery.', decidedBy: 'user after audit', decidedAt: '2026-09-04' },
    { option: 'rewrite-green-history', why: 'Cosmetic force-pushes waste CI and destabilize review.', decidedBy: 'user', decidedAt: '2026-09-04' },
    { option: 'new-docs-microsite', why: 'Evolve the existing engineer surface rather than compete with it.', decidedBy: 'user after UX recommendation', decidedAt: '2026-09-04' },
    { option: 'other-visual-canons', why: 'Disclosure best fits the technical control-plane surface.', decidedBy: 'user via plan-arc go', decidedAt: '2026-09-04' },
  ],
  singleSeams: [
    'One harness-neutral reducer owns role, run, halt, delivery, correction, evaluation, and terminal transitions.',
    'One role/driver registry maps semantic roles to adapters; native type is not semantic identity.',
    'One discovered root owns records, schema, imports, config, and migration; dual marked roots refuse.',
    'One ArcDelivery receipt/reducer owns branch, PR, exact-head CI, correction, merge authority, and terminal state.',
    'One worktree inventory/classifier/disposer serves allocation, landing, cancellation, resume, and GC.',
    'One projection source owns lifecycle, support, command, model, and version facts for README/Markdown/HTML.',
  ],
  honestyRails: [
    'No adapter, override, resume, PR, push, queue, merge, rewrite, or cleanup enlarges recorded authority.',
    'Green means every configured check accepted for current head SHA; a push invalidates prior green.',
    'CI correction requires evidence: causal or owned may repair; unrelated or indeterminate holds.',
    'No rewrite beautifies an already-green PR; published rewrite uses force-with-lease and rescue.',
    'No worktree removal from prefix/age; ownership, inactive-twice, clean, reachable, recoverable are mandatory.',
    'Documentation states only phase-43-proven behavior and contains no ELI5 invocation instructions.',
  ],
  acceptanceCriteria: [
    { id: 'packaging-valid', job: 'Install and operate natively from Claude Code or Codex without validator warnings, unsafe hidden authority, or semantic drift.', surfaces: ['claude-code', 'codex'], signal: 'On clean second installs at recorded versions, both validators pass and both parents plan/execute the same fixture; reinstall leaves one mapping and identical semantic receipts.', tier: 'live-host', bar: 'Zero owned warnings, no bypass posture, and differences only for declared host capability/provenance.' },
    { id: 'semantic-parity', job: 'Make every lifecycle transition executable, resumable, bounded, and equivalent under Claude and Codex.', surfaces: ['cli', 'claude-code', 'codex'], signal: 'Fresh/resumed matrices drive done, blocked, stalled, unobserved, exited, review-exhausted, gaps, held auth/permission, PR failure, CI red/green, eval, complete; 20 concurrent lanes preserve one owner/result.', tier: 'live-host', bar: 'No duplicate executor/action, dangling state, or uncapped review; every halt names resume.' },
    { id: 'one-roadmap-root', job: 'Keep marketplace roadmap beside docs without breaking CLI, imports, schema, hooks, fixtures, or records.', surfaces: ['repository', 'cli'], signal: 'Only docs/roadmap is marked and owns lib; status/validate/audit/gate/claim/emit pass from root/nested cwd and second checkout; both-root fixture refuses.', tier: 'wired', bar: 'Old roots absent, no lost records/hardcoded active paths, every pending phase preflight resolves after migration, valid imports pass and stale-import/path mutations fail, and one-commit revert restores old tree.' },
    { id: 'clean-review-input', job: 'Make repeated plan/review judge repaired HEAD and converge without open-ended rediscovery.', surfaces: ['cli', 'codex'], signal: 'Stale, dirty, live, reusable, and absent lane relaunches reset/refuse correctly and read requested HEAD; ten incomplete criteria enter delta-only capped review and material tokens have mutation-red verifies.', tier: 'wired', bar: 'Zero stale review, no unsafe reset, bounded rounds/fingerprints, incomplete artifacts fail lint.' },
    { id: 'curated-history', job: 'Present outcome commits instead of task/gate noise or fix1 through fix52 without wasting green CI.', surfaces: ['git', 'pull-request'], signal: 'Six-phase fixture normalizes pre-publish to one tree-identical commit per phase with rescue/receipt; two fixes may remain if green, third compacts only with a necessary red-CI push; resume is idempotent.', tier: 'wired', bar: 'No foreign rewrite, tree/CAS proof, force-with-lease only, no cosmetic green push, eval attribution survives.' },
    { id: 'owned-worktree-gc', job: 'Remove finished roadmap worktrees without risking live, dirty, unique, human, or other-tool work.', surfaces: ['cli', 'filesystem'], signal: 'Across 50 active/closed/open-PR/merged/dirty/unique/slot/legacy/unknown/symlink/race lanes, dry-run/apply agree; only matching-ID inactive-twice clean recoverable lanes disappear; repeat is no-op.', tier: 'wired', bar: 'Zero false deletion, atomic receipts, per-item isolation, open-PR branch retained, merged branch needs ancestor proof.' },
    { id: 'idempotent-green-pr', job: 'Turn a validated arc into one open green PR, repair owned failures, and leave unrelated failures alone.', surfaces: ['cli', 'github'], signal: 'Independent, stacked, and explicit-group fixtures create/update by stable key and survive interruption; causal/owned red takes a bounded reviewed correction pass; larger changes use planned correction phases; unrelated/indeterminate/flaky/auth/quota/timeout/repeat fingerprint holds without unrelated edits; base churn rechecks latest SHA.', tier: 'live-host', bar: 'One PR receipt per target, configured checks green on exact SHA, default open/non-draft, merge/queue requires config and authority.' },
    { id: 'gauntlet-conformance', job: 'Prove intent-to-green-PR under both native parents and cross-driver children before advertising it.', surfaces: ['claude-code', 'codex', 'github'], signal: 'Gauntlet 3 runs four parent/child lanes plus baselines through 3 concurrent arcs, 20 lanes, migration, branch strategies, interruption, owned/unrelated red, correction, normalization, GC, green PR, optional merge, eval, and second resume.', tier: 'live-host', bar: 'All deterministic sentinels pass; no invalid absolute score, unjudged-as-pass, or unsupported claim.' },
    { id: 'concise-current-code', job: 'Make comments explain current invariants rather than incident archaeology.', surfaces: ['source'], signal: 'Production comments/errors contain no dates, phase IDs, attempts, codenames, or postmortem narration except allowlisted semantic data; landing/liveness/arm/guard/workflow tests pass twice.', tier: 'wired', bar: 'Safety rationale remains in names/types/assertions/tests or concise comments; history stays in ADR/eval/Git.' },
    { id: 'truthful-visual-docs', job: 'Let a senior developer understand in five minutes what the plugin does, why, how it differs from Superpowers, and how to use either parent.', surfaces: ['github', 'visual-guide'], signal: 'At 320px/desktop on first/second visits, README, Markdown, and orientation show proven lifecycle, install/support, artifacts/recovery, delivery/history/GC, and versioned neutral comparison; links/snippets/validators/accessibility/drift/offline pass.', tier: 'live-ui', bar: 'No stale facts or ELI5 invocation text; text equivalents, AA contrast, keyboard/focus/reduced motion, one source per fact.' },
  ],
  criteriaRatifications: ['2026-09-06: the owner-approved bounded intent-repair implementation23c7786 replaces mandatory per-gap correction phases for small owned fixes; exact-head green, independent intent judgment, scope authority and bounded budgets remain unchanged. Larger changes still require planning.'],
  status: 'planning',
})
