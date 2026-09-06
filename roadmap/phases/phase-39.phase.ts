import { definePhase } from '../../lib/roadmap/schema'

/**
 * NATIVEGREEN artifact-root plane: move the marketplace's live roadmap and its schema as one
 * tree while preserving legacy consumers through an explicit schema fallback.
 *
 * timing: band 4-6 × surface:false, N=4, median 148.8 min, p80 196.4 min
 */
export default definePhase({
  phase: 39,
  name: 'Atomic docs/roadmap migration with one root-first schema seam',
  plannedBy: { model: 'gpt-5.6-sol' },
  status: 'backlog',
  category: 'refactor',
  kind: 'hardening',
  source: 'NATIVEGREEN artifact-root plane; plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md §Root and documentation projections; NATIVEGREEN execution prompt §Constraints.',
  priority: 'HIGH',
  arcId: 'NATIVEGREEN',
  dependsOn: [38],
  conflictsWith: [],
  keyFiles: [
    'plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs',
    'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs',
    'plugins/zeroh-roadmap/cli/lib/root-migration.mjs',
    'plugins/zeroh-roadmap/cli/commands/root.mjs',
    'plugins/zeroh-roadmap/templates/registry.ts',
    'plugins/zeroh-roadmap/cli/lib/validate.mjs',
    'docs/roadmap/lib/schema.ts',
  ],
  stakeholderDemo: 'A clean checkout contains only docs/roadmap, and status, validation, audit, gates, claims, and emit resolve the same records from root or nested directories while an intentionally dual-root fixture refuses.',
  userFacing: false,
  reviewScope: 'full',
  assumptions: [
    { claim: 'Root discovery already refuses two marked candidates.', verify: `bash -c "grep -qF \"throw new RoadmapRootError('ambiguous'\" plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs && grep -qF \"marked.length > 1\" plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs"`, onFalse: 'ESCALATE' },
    { claim: 'The marketplace still has the legacy roadmap root and schema seam before migration.', verify: 'bash -c "test -d roadmap && test -f lib/roadmap/schema.ts && test ! -e docs/roadmap/roadmap.config.json"', onFalse: 'ESCALATE' },
    { claim: 'The consumer bridge resolves a root-local schema before its legacy fallback.', verify: `bash -c "grep -q \"join(roadmapRoot(dir), 'lib', 'schema.ts')\" plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs && grep -q \"join(dir, 'lib', 'roadmap', 'schema.ts')\" plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs"`, onFalse: 'ESCALATE' },
  ],
  tasks: [
    {
      id: '39.1', title: 'Make root and schema resolution one strict root-first contract',
      problem: 'The runtime resolver is strict, but template and command consumers can still encode candidate order or the legacy schema path independently.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs', description: 'Export one resolver result carrying absolute root, repository-relative root, root-local schema, and the explicitly labeled legacy schema fallback; preserve ROADMAP_ROOT precedence and dual-marked refusal. → verify: node --test plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs' },
        { file: 'plugins/zeroh-roadmap/templates/registry.ts', description: 'Generate the same root-first/ambiguity semantics in consumer code and remove its silent first-match implementation. → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs' },
      ],
      acceptanceCriteria: ['Root-local schema wins when present; legacy lib/roadmap/schema.ts is read only when it is the sole schema seam.', 'Two marked roots fail with the same actionable ambiguity kind from CLI and generated registry.'],
      files: ['plugins/zeroh-roadmap/cli/lib/roadmap-root.mjs', 'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs', 'plugins/zeroh-roadmap/cli/lib/tsx-bridge.test.mjs', 'plugins/zeroh-roadmap/templates/registry.ts', 'plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs'],
      testMode: 'tdd', done: false, interfaces: { consumes: ['ArtifactRoot design contract'], produces: ['strict resolved roadmap descriptor'] },
    },
    {
      id: '39.2', title: 'Remove hard-coded active-root assumptions from runtime consumers',
      problem: 'Validation, watch sidecars, evaluation, and slots retain path expressions that can select roadmap/ even after docs/roadmap is active.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/validate.mjs', description: 'Derive phase paths and roadmap containment from roadmapRoot/roadmapRootRel instead of the `/roadmap/` regex and literal replacement. → verify: node --test plugins/zeroh-roadmap/cli/lib/validate.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/watch.mjs', description: 'Resolve an arc-id sidecar through roadmapRoot(mainCheckout(cwd)) while retaining an explicit sidecar-path argument. → verify: node --test plugins/zeroh-roadmap/cli/commands/watch.test.mjs' },
        { file: 'plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs', description: 'Replace phase, arc, backlog, and gate paths joined from repoRoot/roadmap with the resolved roadmap root descriptor. → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs' },
        { file: 'plugins/zeroh-roadmap/scripts/migrate/audit.ts', description: 'Resolve backlog, phase, and schema migration targets through the selected root instead of legacy roadmap and lib/roadmap literals. → verify: npx --no-install tsx plugins/zeroh-roadmap/scripts/migrate/audit.ts --help' },
      ],
      acceptanceCriteria: ['No executable consumer outside roadmap-root twins/templates spells an active `roadmap/` location.', 'Root and nested-cwd fixtures produce identical status, watch, validate, and eval paths.'],
      files: ['plugins/zeroh-roadmap/cli/lib/validate.mjs', 'plugins/zeroh-roadmap/cli/lib/validate.test.mjs', 'plugins/zeroh-roadmap/cli/commands/watch.mjs', 'plugins/zeroh-roadmap/cli/commands/watch.test.mjs', 'plugins/zeroh-roadmap/workflows/arc-plane.workflow.mjs', 'plugins/zeroh-roadmap/test/fixture-consumer/lifecycle.test.mjs', 'plugins/zeroh-roadmap/scripts/migrate/audit.ts', 'plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs'],
      testMode: 'tdd', done: false, interfaces: { consumes: ['strict resolved roadmap descriptor'], produces: ['root-independent CLI consumers'] },
    },
    {
      id: '39.3', title: 'Implement a preflighted atomic root migration',
      problem: 'A manual move can expose two marked roots or split records from their schema between commits.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/root-migration.mjs', description: 'Implement plan/apply with source identity, destination absence, clean relevant paths, rename-only manifest, schema relocation, post-move parse, rollback-on-failure, and an atomic receipt; refuse partial/ambiguous states. → verify: node --test plugins/zeroh-roadmap/cli/lib/root-migration.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/commands/root.mjs', description: 'Expose `roadmap root migrate --to docs/roadmap [--apply]`, default dry-run, with stable JSON and refusal exit codes; mount it in the command tree. → verify: node --test plugins/zeroh-roadmap/cli/commands/root.test.mjs' },
      ],
      acceptanceCriteria: ['Dry-run is mutation-free and apply either yields one complete destination root plus receipt or restores the original tree.', 'A dirty, partial, existing-destination, symlink-escape, or dual-root fixture refuses before its first rename.'],
      files: ['plugins/zeroh-roadmap/cli/lib/root-migration.mjs', 'plugins/zeroh-roadmap/cli/lib/root-migration.test.mjs', 'plugins/zeroh-roadmap/cli/commands/root.mjs', 'plugins/zeroh-roadmap/cli/commands/root.test.mjs', 'plugins/zeroh-roadmap/bin/roadmap.mjs'],
      testMode: 'tdd', done: false, interfaces: { consumes: ['strict resolved roadmap descriptor'], produces: ['atomic root migration receipt'] },
    },
    {
      id: '39.4', title: 'Move marketplace records and schema in one commit',
      problem: 'The marketplace itself must exercise the supported migration without a commit interval containing both roots or neither schema.',
      steps: [
        { file: 'docs/roadmap/roadmap.config.json', description: 'Apply the migration so every tracked roadmap/* entry becomes docs/roadmap/* and lib/roadmap/* becomes docs/roadmap/lib/* in the same commit, preserving record payloads except required relative imports and active executable path references. Rewrite pending assumptions/verifiers, root config gate commands, tsconfig includes, registry/emit entrypoints, and scripts in the same commit; historical prose stays unchanged. → verify: bash -c "test -f docs/roadmap/roadmap.config.json && test -f docs/roadmap/lib/schema.ts && test ! -e roadmap && test ! -e lib/roadmap"' },
        { file: 'docs/roadmap/phases/phase-39.phase.ts', description: 'Rewrite every moved typed-artifact import to ../lib/schema; verify all files, then import them through tsx/Zod. Use the committed non-vacuous validator, never rg -L. → verify: node scripts/check-roadmap-imports.mjs docs/roadmap && node --test scripts/nativegreen-review-regressions.test.mjs' },
      ],
      acceptanceCriteria: ['The migration commit has no parent-to-child interval in which both roots are marked or the active root lacks lib/schema.ts.', 'All moved arc and phase files import ../lib/schema and validate without an alias loader.', 'Pending phase 40-45 preflights and repository gate entrypoints use the migrated root; execute their path-only checks on a migrated fixture before landing. A stale path mutation must fail.'],
      files: ['docs/roadmap/roadmap.config.json', 'docs/roadmap/lib/schema.ts', 'docs/roadmap/arcs/NATIVEGREEN.arc.ts', 'docs/roadmap/phases/phase-39.phase.ts', 'scripts/check-roadmap-imports.mjs', 'scripts/nativegreen-review-regressions.test.mjs', 'tsconfig.json'],
      testMode: 'none', batchMode: true, done: false, interfaces: { consumes: ['atomic root migration receipt'], produces: ['docs/roadmap canonical artifact tree'] },
    },
    {
      id: '39.5', title: 'Exercise every record operation across cwd and checkout layouts',
      problem: 'A successful status check alone cannot prove claims, gates, emits, hooks, and typed loading all follow the migrated root.',
      steps: [
        { file: 'plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs', description: 'Add a matrix for root, nested cwd, linked checkout, override, legacy-schema-only, root-schema-only, both-root, and missing-schema fixtures across status/validate/audit/gate/claim/emit. → verify: node --test plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs' },
        { file: 'plugins/zeroh-roadmap/hooks/lib/roadmap-root.test.mjs', description: 'Prove the shell resolver matches Node for marked, unmarked, overridden, nested, and ambiguous layouts and never blocks while reporting ambiguity. → verify: node --test plugins/zeroh-roadmap/hooks/lib/roadmap-root.test.mjs' },
      ],
      acceptanceCriteria: ['All listed operations select docs/roadmap from both primary and linked checkouts.', 'Node and shell twins return identical roots or the documented equivalent ambiguity refusal.'],
      files: ['plugins/zeroh-roadmap/test/fixture-consumer/layout-docs.test.mjs', 'plugins/zeroh-roadmap/hooks/lib/roadmap-root.sh', 'plugins/zeroh-roadmap/hooks/lib/roadmap-root.test.mjs'],
      testMode: 'tdd', done: false, interfaces: { consumes: ['docs/roadmap canonical artifact tree'], produces: ['root-layout conformance matrix'] },
    },
    {
      id: '39.6', title: 'Ratchet the single-root estate and prove reversibility',
      problem: 'Future literals or copied schema seams could silently recreate the split this migration removes.',
      steps: [
        { file: 'plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs', description: 'Add an estate scan allowing root literals only in the resolver twins, templates, migration implementation, tests, and historical docs; fail new active joins or dual schema owners. → verify: node --test plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs' },
        { file: 'plugins/zeroh-roadmap/cli/lib/root-migration.test.mjs', description: 'Prove the produced migration commit is one-commit reversible to the byte-identical legacy tree and re-applying from the receipt is idempotent. → verify: node --test plugins/zeroh-roadmap/cli/lib/root-migration.test.mjs' },
      ],
      acceptanceCriteria: ['The estate scan identifies zero unallowlisted active-root literals or duplicate schema owners.', 'Revert restores the old tree byte-for-byte; resumed apply converges to one destination without duplicate records.'],
      files: ['plugins/zeroh-roadmap/cli/lib/roadmap-root.test.mjs', 'plugins/zeroh-roadmap/cli/lib/root-migration.test.mjs'],
      testMode: 'tdd', done: false, interfaces: { consumes: ['root-layout conformance matrix'], produces: ['single-root regression ratchet'] },
    },
  ],
  reviewRecord: { date: '2026-09-04', model: 'gpt-5.6-sol', verdict: 'READY', via: 'executed' },
  notes: 'userFacing false ratified: repository/control-plane storage has no product flag surface. reviewScope full ratified: root selection, schema loading, migration rollback, and record writes are governed seams. testMode ratified: resolver/migration logic and conformance guards use TDD; the rename-only marketplace move is mechanical and uses none with batchMode because it spans more than ten tracked artifacts. No external dependency or asset is introduced. designRef: plugins/zeroh-roadmap/docs/architecture/intent-to-green-pr-design.md. [FIXED review] Corrected the design heading and fixture path; replaced a suite assumption with a source tripwire; added arc-plane and migration-audit production blast radius; replaced the vacuous import verify; marked the whole-tree move mechanical batchMode.',
})
