import { definePhase } from '@/lib/roadmap/schema'

/**
 * MINESWEEP plane 2 — cross-repo gate awareness: never derive `light` off the wrong diff.
 *
 * A cross-repo phase keeps its bookkeeping in the roadmap repo and its product diff in a
 * sibling checkout. The liveness side already learned this (product-repos.mjs, the
 * 2026-08-17 incident fix, consumed by liveness + the arm's diagnostic preflight) — but
 * the GATE still derives scope from the roadmap-repo diff alone: atlas 33 derived
 * reviewScope light off ONE roadmap file while ~3.9k product lines sat in another repo
 * (round 0, run anyway, found four defects light would have skipped), atlas 3 hit the
 * same one-file mis-derivation, and azure 2333 put two executors on one product branch
 * because nothing interlocks the product tree.
 * Evidence: roadmap/arc-prompts/MINESWEEP-execution-prompt.md §crossrepo.
 *
 * ## Hypotheses (why cross-repo phases mis-gate)
 * 1. CONFIRMED — the gate's scope inputs are single-repo by construction: gate plan feeds
 *    deriveTestScope/deriveReviewScope from phaseOwnFiles + the local diff (gate.mjs:331,
 *    :344) and never consults productRepos (probe: 0 hits in gate.mjs), so a foreign-repo
 *    phase presents as a tiny local diff and under-derives every floor.
 * 2. REFUTED — "the executor should just declare reviewScope full": atlas 33's plan did
 *    not, atlas 3's did not — a per-plan discipline failed twice where a derivation-time
 *    floor cannot; the declared-scope ladder stays, this adds the missing mechanical arm.
 *
 * timing: no reference data for 1-3×surface:false
 */
export default definePhase({
  phase: 19,
  name: 'Cross-repo gate awareness: productRepos floors review scope, arm-time product-tree overlap refusal',
  status: 'backlog',
  plannedBy: { model: 'claude-fable-5' },
  category: 'fix',
  kind: 'hardening',
  arcId: 'MINESWEEP',
  source:
    'MINESWEEP plane "Integrity & measurement" — 2026-08-31 mining §Q3 item 4 (atlas 33/3 mis-derivation; azure 2333 double-executor incident).',
  priority: 'MEDIUM',
  dependsOn: [],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/commands/gate.mjs',
    'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
    'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs',
    'plugins/zeroh-roadmap/cli/commands/executor-arm-disarm.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/product-repos.mjs',
  ],
  stakeholderDemo:
    'A phase whose product lives in a sibling repo can no longer gate as a one-file diff: review scope floors to full with the foreign repos named, and a second executor arming onto an overlapping product tree is refused with the evidence instead of silently sharing a branch.',
  userFacing: false,
  assumptions: [
    {
      claim: 'gate plan never consults productRepos — the scope derivation is single-repo (0 references in gate.mjs).',
      verify: 'bash -c "test \\"$(grep -cF productRepos plugins/zeroh-roadmap/cli/commands/gate.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: "The arm preflight is diagnostic-only by its own comment ('the preflight is diagnostic, never a gate') — no overlap refusal exists between arms.",
      verify:
        'bash -c "grep -qF \'the preflight is diagnostic, never a gate\' plugins/zeroh-roadmap/cli/commands/executor-arm.mjs && test \\"$(grep -cF overlap plugins/zeroh-roadmap/cli/commands/executor-arm.mjs)\\" = \\"0\\""',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'Arm files are enumerable as .building/<N>-executor.armed JSON (executor-arm.mjs armPath) — but armPath is PER-WORKTREE (each lane has its own .building), so sibling-LANE arms are reachable only through the worktree registry (`git worktree list` off the common dir); that registry plus each root\'s phase files give the overlap inputs without new state.',
      verify: 'bash -c "grep -qF \'-executor.armed\' plugins/zeroh-roadmap/cli/lib/executor-arm.mjs"',
      onFalse: 'ESCALATE',
    },
    {
      claim: 'productRepos derives foreign repos from a phase\'s ABSOLUTE keyFiles only (relative paths yield nothing) — the floor can only fire on phases that declared them, which is the honest bound.',
      verify: 'bash -c "grep -qF \'isAbsolute\' plugins/zeroh-roadmap/cli/lib/product-repos.mjs"',
      onFalse: 'ESCALATE',
    },
  ],
  tasks: [
    {
      id: '19.1',
      title: 'gate plan: foreign product repos floor reviewScope to full, named in plan and report',
      problem:
        'deriveReviewScope sees a one-file local diff and derives light — structurally blind to the sibling-repo product lines the phase actually writes (atlas 33: four defects found only because round 0 was run against the real diff by hand).',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.mjs',
          description:
            "INSIDE buildPlan, immediately after the deriveReviewScope call (gate.mjs:344) and BEFORE the agent-chain derivation (:387-391) — architect amendment A4: the agents chain is computed from reviewScope.effective inside buildPlan, and `gate run` shares buildPlan, so a post-hoc floor in the plan renderer would leave the chain un-floored and the run/verify report inconsistent; both subcommands inherit the floor by construction here: repos = productRepos(phase.keyFiles, { worktree: toplevel }); when non-empty, floor the DERIVED reviewScope to 'full', and a DECLARED lower rung becomes a refusal naming the repos, surfaced through the plan's existing refused → exit-2 mapping (the specialist hard floor's EXACT asymmetry per ladder.mjs deriveReviewScope: derivation is floored, a low declaration is REFUSED with reason + remedy, never silently overridden); append a note `cross-repo: derivation is structurally blind to <repos> — reviewScope floored to full; mechanical slots run against THIS repo only, the product diff is reviewed from the foreign checkout` and carry `productRepos` in the plan/report JSON → verify: bash -c \"grep -qF 'structurally blind' plugins/zeroh-roadmap/cli/commands/gate.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs',
          description:
            'Fixture-consumer tests: a phase declaring one absolute foreign-repo keyFile (a second tmp git repo) floors effective reviewScope to full with the note and JSON field; the same phase with local-only keyFiles derives exactly as before (regression pin); a declared reviewScope light + foreign repos → REFUSED naming the repos (the exit-2 path — the specialist-floor asymmetry, declaration never silently overridden) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'structurally blind\' cli/commands/gate.test.mjs && capbuild node --test cli/commands/gate.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'Foreign-repo phases floor DERIVED review to full with the repos named in notes + JSON; local phases derive byte-identically to today; a DECLARED lower rung is a refusal naming the repos, never a silent override (three directions tested)',
      ],
      files: ['plugins/zeroh-roadmap/cli/commands/gate.mjs', 'plugins/zeroh-roadmap/cli/commands/gate.test.mjs'],
      testMode: 'tdd',
      interfaces: { consumes: ['productRepos(keyFiles, {worktree}) from cli/lib/product-repos.mjs'], produces: [] },
      done: false,
    },
    {
      id: '19.2',
      title: 'executor-arm: refuse an arm whose product repos overlap a sibling arm',
      problem:
        'azure 2333 verbatim: "two executors then shared one working tree and one branch" — `phase start` flips roadmap state but nothing claims the product tree, and the arm preflight that already derives the repos only narrates them.',
      steps: [
        {
          file: 'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs',
          description:
            "Before writing the arm: enumerate sibling arms across EVERY worktree of this repository — `git worktree list --porcelain` from the common dir gives each root; scan <root>/.building/*-executor.armed for other phase numbers, consulting the lib's liveArm semantics rather than raw file presence (architect note N4 — a disarm-swept or TTL-stale sibling arm must never block) (armPath is PER-WORKTREE, each lane has its own .building, so a single-root scan is blind to sibling lanes — the sidecar.mjs precedent: cross-lane state resolves through the repo, never one worktree's own .building); for each sibling arm, load that phase's file from ITS OWN root's roadmap/phases and derive its productRepos with that root as worktree; a non-empty TOPLEVEL intersection with THIS phase's derived set → refuse (exit 2) naming both phases, the shared repo root(s), and the override (`--force`, the existing evidence-first wording pattern) — toplevel, not common dir, is the deliberate key: two arms in two different worktrees of one product repo do not share a tree/branch (the sanctioned parallel path), same toplevel = same checkout = the 2333 hazard; --force proceeds and stderr-records the overridden overlap. A pruned/unreadable sibling root is skipped with a stderr note. No sibling arms or empty intersection → arm exactly as today → verify: bash -c \"grep -qF 'overlap' plugins/zeroh-roadmap/cli/commands/executor-arm.mjs\"",
        },
        {
          file: 'plugins/zeroh-roadmap/cli/commands/executor-arm-disarm.test.mjs',
          description:
            'Tests: two phases declaring keyFiles in the same foreign tmp repo, armed from two LINKED worktrees of one tmp roadmap repo — the second arm refuses naming both phases and the repo (the cross-lane direction the single-root scan would miss); a same-root sibling arm refuses identically; disjoint foreign repos both arm; --force arms with the recorded override; local-only phases never trip it (five directions) → verify: bash -c "cd plugins/zeroh-roadmap && grep -qF \'overlap\' cli/commands/executor-arm-disarm.test.mjs && capbuild node --test cli/commands/executor-arm-disarm.test.mjs >/dev/null 2>&1"',
        },
      ],
      acceptanceCriteria: [
        'An overlapping second arm is a named refusal ACROSS lane worktrees (the arm registry is the git worktree list, not one root\'s .building) with the force override recorded when used; disjoint and local arms are untouched (all five directions in the suite)',
        'A stale sibling arm (its phase file gone) or a pruned/unreadable sibling worktree never blocks — treated as no overlap with a stderr note, tested',
      ],
      files: [
        'plugins/zeroh-roadmap/cli/commands/executor-arm.mjs',
        'plugins/zeroh-roadmap/cli/commands/executor-arm-disarm.test.mjs',
      ],
      testMode: 'tdd',
      interfaces: { consumes: ['productRepos(keyFiles, {worktree}) from cli/lib/product-repos.mjs'], produces: [] },
      done: false,
    },
  ],
  notes:
    'interview: skipped — arc member; scope from the MINESWEEP arc record (DEFERRED there: cross-repo METRICS stay executor-owned — this phase only stops the gate mis-deriving and the arm double-booking; a fake linesAdded aggregation was rejected as dishonest measurement). ' +
    'reviewScope full (gate-derivation semantics). 2 tasks below the 4-floor for a nameable reason: the phase is two surgical mechanical arms on one existing lib seam; the neighboring repair classes (grammar, measurement) already have their own phases and padding this one would blur plane boundaries. ' +
    'Blast radius, checked: liveness/watch already consume productRepos (the 2375.2 fix — no edit); curate ranges are roadmap-repo by design (no edit); `roadmap claim` stays number-reservation only (the product-tree lock is the ARM, which is the execution-time act — decision recorded). ' +
    'Verify rehearsal attestation: red-now probes executed 2026-08-31 — productRepos 0 hits and `structurally blind` 0 hits in gate.mjs, overlap 0 hits in executor-arm.mjs (step-verifies red for exactly what each diff adds); assumption probes all exit 0 (diagnostic-only comment present; armPath literal present; isAbsolute guard present); runner clauses inherit polarity from their grep representatives. ' +
    'review-phase Mode A repairs 2026-08-31: (1) declared-lower reviewScope is a REFUSAL, not an override — ladder.mjs deriveReviewScope honors declaration both directions EXCEPT the specialist hard floor, which refuses (never silently overrides); the cross-repo floor mirrors that exact asymmetry. (2) arm-overlap scan enumerates ALL worktree roots via `git worktree list` — armPath is per-worktree, a single-root scan cannot see sibling lanes (sidecar.mjs precedent: cross-lane state never lives in one worktree\'s own .building); overlap keys on foreign TOPLEVEL (same checkout = 2333 hazard; different worktrees of one product repo = the sanctioned parallel path, not an overlap). (3) runner verifies capbuild-prefixed (the house scoped-runner idiom, phase-1/phase-13 precedent; bare `node --test` is hook-refused on this host).',
})
